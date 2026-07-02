import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getBarberSession } from '@/lib/actions/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { extractWithAi } from '@/lib/receipts/extract'
import type { ExtractedReceipt } from '@/lib/receipts/schema'
import type { ReceiptStatus } from '@/lib/types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

interface OcrBody {
  engine: 'ai' | 'ocr'
  imageBase64: string
  mediaType?: string
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

export async function POST(req: NextRequest) {
  const session = await getBarberSession()
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  let body: OcrBody
  try {
    body = (await req.json()) as OcrBody
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const orgId = session.organization_id
  const branchId = session.branch_id
  const supabase = createAdminClient()
  const mediaType = body.mediaType || 'image/webp'
  const expectedAmount = body.expectedAmount != null ? Number(body.expectedAmount) : null

  // ── 1) Extracción ────────────────────────────────────────
  let extracted: ExtractedReceipt | null = null
  const usedEngine: 'ai' | 'ocr' = body.engine === 'ocr' ? 'ocr' : 'ai'

  if (body.engine === 'ocr') {
    // Motor gratis: el cliente ya parseó con Tesseract; sólo persistimos + validamos.
    extracted = body.parsed ?? null
  } else {
    // Motor IA (pago): key global de plataforma, fallback a la de la org.
    let apiKey = process.env.ANTHROPIC_API_KEY ?? null
    if (!apiKey) {
      const { data: cfg } = await supabase
        .from('organization_ai_config')
        .select('anthropic_api_key')
        .eq('organization_id', orgId)
        .maybeSingle()
      apiKey = cfg?.anthropic_api_key ?? null
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Falta la API key de IA. Configurala o usá el motor OCR gratis.', code: 'no_key' },
        { status: 422 },
      )
    }
    if (!body.imageBase64) {
      return NextResponse.json({ error: 'Falta la imagen' }, { status: 400 })
    }
    try {
      extracted = await extractWithAi(Buffer.from(body.imageBase64, 'base64'), mediaType, apiKey)
    } catch (e) {
      // La lectura falló → guardamos la imagen igual y queda 'needs_review' (en revisión).
      console.error('[comprobante ocr] extractWithAi:', e instanceof Error ? e.message : String(e))
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
    .select('amount_tolerance')
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

  // ── 4) Estado ────────────────────────────────────────────
  let status: ReceiptStatus
  if (!extracted || extracted.amount == null) status = 'needs_review'
  else if (amountMatches === false) status = 'amount_mismatch'
  else status = 'verified'

  // Anti-duplicado: mismo nº de operación ya usado en un comprobante válido.
  if (status !== 'needs_review' && extracted?.operationNumber) {
    const { data: dup } = await supabase
      .from('payment_receipts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('operation_number', extracted.operationNumber)
      .in('status', ['verified', 'amount_mismatch', 'manual_ok', 'overridden'])
      .limit(1)
      .maybeSingle()
    if (dup) status = 'duplicate'
  }

  // ── 5) Persistir: UPDATE si es reintento (evita huérfanos), INSERT si es nuevo ──
  const fields = {
    organization_id: orgId,
    branch_id: branchId,
    barber_id: session.staff_id,
    client_id: body.clientId ?? null,
    payment_account_id: body.paymentAccountId ?? null,
    image_path: imagePath,
    capture_method: body.captureMethod ?? 'front_camera',
    extraction_engine: usedEngine,
    extracted_amount: extracted?.amount ?? null,
    extracted_datetime: extracted?.datetime ?? null,
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
