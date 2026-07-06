import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { resolveReceiptContext } from '@/lib/receipts/context'
import { createAdminClient } from '@/lib/supabase/server'
import { extractWithVision, DEFAULT_OPENAI_VISION, DEFAULT_ANTHROPIC_VISION, type VisionOpts } from '@/lib/receipts/extract'
import type { ExtractedReceipt } from '@/lib/receipts/schema'
import type { ReceiptStatus } from '@/lib/types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

interface OcrBody {
  engine: 'ai' | 'ocr'
  imageBase64: string
  mediaType?: string
  branchId?: string | null
  barberId?: string | null
  expectedAmount?: number | null
  paymentAccountId?: string | null
  clientId?: string | null
  captureMethod?: 'front_camera' | 'qr_upload' | 'gallery'
  // Sólo en engine='ocr': campos ya extraídos client-side por Tesseract (sin costo de server).
  parsed?: ExtractedReceipt | null
  // Reintento: si viene, se ACTUALIZA ese comprobante (aún sin visita) en vez de crear uno nuevo.
  priorReceiptId?: string | null
}

/** Normaliza alias/CBU para comparar (minúsculas, sin puntos/espacios/guiones). */
function normAlias(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[\s.\-]/g, '')
}

/** Instante del comprobante en ms. Si la fecha no trae zona horaria, asume AR (-03:00). */
function parseReceiptInstant(iso: string | null): number | null {
  if (!iso) return null
  let s = iso.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Sólo fecha (sin hora) → mediodía AR, para que caiga en el día correcto.
    s = s + 'T12:00:00-03:00'
  } else if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s + '-03:00'
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/** Día calendario en Argentina (YYYY-MM-DD) de un instante ms. */
function arDayString(ms: number): string {
  return new Date(ms - 3 * 3600000).toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const ctx = await resolveReceiptContext()
  if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  let body: OcrBody
  try {
    body = (await req.json()) as OcrBody
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const orgId = ctx.organizationId
  const supabase = createAdminClient()

  // La sucursal viene del cobro (funciona igual desde panel barbero o dashboard);
  // validamos que pertenezca a la org del que está cobrando.
  if (!body.branchId) return NextResponse.json({ error: 'Falta la sucursal' }, { status: 400 })
  const { data: br } = await supabase
    .from('branches').select('organization_id').eq('id', body.branchId).maybeSingle()
  if (!br || br.organization_id !== orgId) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 403 })
  }
  const branchId = body.branchId
  const mediaType = body.mediaType || 'image/webp'
  const expectedAmount = body.expectedAmount != null ? Number(body.expectedAmount) : null

  // ── 1) Extracción ────────────────────────────────────────
  let extracted: ExtractedReceipt | null = null
  const usedEngine: 'ai' | 'ocr' = body.engine === 'ocr' ? 'ocr' : 'ai'

  if (body.engine === 'ocr') {
    // Motor gratis: el cliente ya parseó con Tesseract; sólo persistimos + validamos.
    extracted = body.parsed ?? null
  } else {
    // Motor IA (pago): prioriza OpenAI (más barato/rápido y normalmente ya cargado),
    // fallback a Anthropic. Key global de plataforma o la de la org.
    const { data: cfg } = await supabase
      .from('organization_ai_config')
      .select('openai_api_key, anthropic_api_key')
      .eq('organization_id', orgId)
      .maybeSingle()
    const openaiKey = process.env.OPENAI_API_KEY ?? cfg?.openai_api_key ?? null
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? cfg?.anthropic_api_key ?? null

    let vopts: VisionOpts | null = null
    if (openaiKey) vopts = { provider: 'openai', apiKey: openaiKey, model: DEFAULT_OPENAI_VISION }
    else if (anthropicKey) vopts = { provider: 'anthropic', apiKey: anthropicKey, model: DEFAULT_ANTHROPIC_VISION }

    if (!vopts) {
      return NextResponse.json(
        { error: 'Configurá una cuenta de IA (OpenAI o Anthropic) o usá el motor OCR gratis.', code: 'no_key' },
        { status: 422 },
      )
    }
    if (!body.imageBase64) {
      return NextResponse.json({ error: 'Falta la imagen' }, { status: 400 })
    }
    try {
      extracted = await extractWithVision(Buffer.from(body.imageBase64, 'base64'), mediaType, vopts)
    } catch (e) {
      // La lectura falló → guardamos la imagen igual y queda 'needs_review' (en revisión).
      console.error('[comprobante ocr] extractWithVision:', e instanceof Error ? e.message : String(e))
      extracted = null
    }
  }

  // ── 2) Subir la imagen SIEMPRE (evidencia), aunque la lectura falle ──
  const receiptId = randomUUID()
  let imagePath: string | null = null
  if (body.imageBase64) {
    imagePath = `${orgId}/${receiptId}.webp`
    const { error: upErr } = await supabase.storage
      .from('transfer-receipts')
      .upload(imagePath, Buffer.from(body.imageBase64, 'base64'), {
        contentType: mediaType,
        upsert: true,
      })
    if (upErr) {
      console.error('[comprobante ocr] upload:', upErr.message)
      imagePath = null
    }
  }

  // ── 3) Matching monto + alias ────────────────────────────
  const { data: settings } = await supabase
    .from('transfer_receipt_settings')
    .select('amount_tolerance, date_tolerance_minutes')
    .eq('organization_id', orgId)
    .maybeSingle()
  const tolerance = Number(settings?.amount_tolerance ?? 1)

  const amountMatches =
    extracted?.amount != null && expectedAmount != null
      ? Math.abs(extracted.amount - expectedAmount) <= tolerance
      : null

  let aliasMatches: boolean | null = null
  if (body.paymentAccountId && extracted?.recipientCbuAlias) {
    const { data: acc } = await supabase
      .from('payment_accounts')
      .select('alias_or_cbu')
      .eq('id', body.paymentAccountId)
      .maybeSingle()
    const want = normAlias(acc?.alias_or_cbu)
    const got = normAlias(extracted.recipientCbuAlias)
    if (want && got) aliasMatches = want === got || want.includes(got) || got.includes(want)
  }

  // Frescura de la fecha: el comprobante debe ser RECIENTE (anti-fraude "comprobante viejo").
  // true = reciente · false = viejo o futuro · null = no se pudo leer la fecha.
  const toleranceMin = Number(settings?.date_tolerance_minutes ?? 180)
  let dateOk: boolean | null = null
  const receiptInstant = parseReceiptInstant(extracted?.datetime ?? null)
  if (receiptInstant != null) {
    const nowMs = Date.now()
    // Robusto a lecturas de hora imprecisas (cámara de baja resolución): el
    // comprobante vale si es del MISMO DÍA (AR) o cae dentro de la ventana
    // (esta última cubre el borde de medianoche). Sólo se marca "viejo" si es
    // de OTRO día y fuera de la ventana.
    const sameDay = arDayString(receiptInstant) === arDayString(nowMs)
    const ageMs = nowMs - receiptInstant
    const withinWindow = ageMs >= -15 * 60000 && ageMs <= toleranceMin * 60000
    dateOk = sameDay || withinWindow
  }

  // ── 4) Estado (cascada por prioridad de riesgo) ──────────
  // Anti-duplicado: mismo nº de operación ya usado en un comprobante válido.
  let isDuplicate = false
  if (extracted?.operationNumber) {
    const { data: dup } = await supabase
      .from('payment_receipts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('operation_number', extracted.operationNumber)
      .in('status', ['verified', 'amount_mismatch', 'manual_ok', 'overridden'])
      .limit(1)
      .maybeSingle()
    if (dup) isDuplicate = true
  }

  let status: ReceiptStatus
  if (!extracted || extracted.amount == null) status = 'needs_review'
  else if (isDuplicate) status = 'duplicate'
  else if (dateOk === false) status = 'date_mismatch'       // comprobante viejo o futuro
  else if (dateOk === null) status = 'needs_review'         // fecha ilegible → revisar (fail-closed)
  else if (amountMatches === false) status = 'amount_mismatch'
  else status = 'verified'

  // ── 5) Persistir: UPDATE si es reintento (evita huérfanos), INSERT si es nuevo ──
  const fields = {
    organization_id: orgId,
    branch_id: branchId,
    barber_id: body.barberId ?? ctx.staffId,
    client_id: body.clientId ?? null,
    payment_account_id: body.paymentAccountId ?? null,
    image_path: imagePath,
    capture_method: body.captureMethod ?? 'front_camera',
    extraction_engine: usedEngine,
    extracted_amount: extracted?.amount ?? null,
    // Normalizado a ISO válido (o null). La IA a veces devuelve el string "null"
    // u otra basura para la fecha; escribirlo crudo en un timestamptz rompía el
    // insert ("invalid input syntax for type timestamp with time zone: null").
    extracted_datetime: receiptInstant != null ? new Date(receiptInstant).toISOString() : null,
    operation_number: extracted?.operationNumber ?? null,
    sender_name: extracted?.senderName ?? null,
    sender_cbu_alias: extracted?.senderCbuAlias ?? null,
    recipient_name: extracted?.recipientName ?? null,
    recipient_cbu_alias: extracted?.recipientCbuAlias ?? null,
    bank_or_wallet: extracted?.bankOrWallet ?? null,
    canal: extracted?.canal ?? null,
    confidence: extracted?.confidence ?? null,
    raw_extraction: extracted?.raw ?? null,
    expected_amount: expectedAmount,
    amount_matches: amountMatches,
    alias_matches: aliasMatches,
    date_ok: dateOk,
  }

  let savedId: string | null = null

  if (body.priorReceiptId) {
    const { data: prior } = await supabase
      .from('payment_receipts')
      .select('id, image_path')
      .eq('id', body.priorReceiptId)
      .eq('organization_id', orgId)
      .is('visit_id', null)
      .maybeSingle()
    if (prior) {
      const patch = { ...fields, image_path: imagePath ?? prior.image_path }
      let upd = await supabase.from('payment_receipts').update({ ...patch, status }).eq('id', prior.id).select('id').single()
      if (upd.error && upd.error.code === '23505') {
        status = 'duplicate'
        upd = await supabase.from('payment_receipts').update({ ...patch, status }).eq('id', prior.id).select('id').single()
      }
      if (upd.error) {
        console.error('[comprobante ocr] update:', upd.error.message)
        return NextResponse.json({ error: 'No se pudo guardar el comprobante' }, { status: 500 })
      }
      savedId = upd.data.id
    }
  }

  if (!savedId) {
    let ins = await supabase.from('payment_receipts').insert({ id: receiptId, ...fields, status }).select('id').single()
    if (ins.error && ins.error.code === '23505') {
      status = 'duplicate'
      ins = await supabase.from('payment_receipts').insert({ id: receiptId, ...fields, status }).select('id').single()
    }
    if (ins.error) {
      console.error('[comprobante ocr] insert:', ins.error.message)
      return NextResponse.json({ error: 'No se pudo guardar el comprobante' }, { status: 500 })
    }
    savedId = ins.data.id
  }

  return NextResponse.json({
    receiptId: savedId,
    status,
    engine: usedEngine,
    extracted,
    amountMatches,
    aliasMatches,
    imageStored: imagePath != null,
  })
}
