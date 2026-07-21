'use server'

import { randomUUID } from 'node:crypto'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { resolveReceiptContext } from '@/lib/receipts/context'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getEffectivePermissions } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
import type { ReceiptEngine, ReceiptStatus } from '@/lib/types/database'

export interface TransferReceiptSettingsView {
  isEnabled: boolean
  engine: ReceiptEngine
  requiredSince: string | null
  amountTolerance: number
  dateToleranceMinutes: number
}

const DEFAULTS: TransferReceiptSettingsView = {
  isEnabled: false,
  engine: 'ai',
  requiredSince: null,
  amountTolerance: 1,
  dateToleranceMinutes: 180,
}

/**
 * Config de comprobantes para la org del barbero logueado (panel/tablet).
 * Si no hay fila, la feature está apagada (default seguro multi-tenant).
 */
export async function getTransferReceiptSettings(): Promise<TransferReceiptSettingsView> {
  const ctx = await resolveReceiptContext()
  if (!ctx) return DEFAULTS

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('transfer_receipt_settings')
    .select('is_enabled, extraction_engine, required_since, amount_tolerance, date_tolerance_minutes')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()

  if (!data) return DEFAULTS
  return {
    isEnabled: data.is_enabled,
    engine: (data.extraction_engine as ReceiptEngine) ?? 'ai',
    requiredSince: data.required_since,
    amountTolerance: Number(data.amount_tolerance ?? 1),
    dateToleranceMinutes: Number(data.date_tolerance_minutes ?? 180),
  }
}

/**
 * Vincula un comprobante ya escaneado a la visita recién creada por
 * completeService, y resuelve su transfer_log_id (el ledger del movimiento).
 * Idempotente: sólo escribe si el comprobante existe y es de la misma org.
 */
export async function linkReceiptToVisit(
  receiptId: string,
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await resolveReceiptContext()
  if (!ctx) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // El transfer_log ya existe: lo crea el trigger trg_visits_sync_transfer_log cuando
  // completeService marca la visita como cobrada por transferencia (mig 160).
  const { data: log } = await supabase
    .from('transfer_logs')
    .select('id')
    .eq('visit_id', visitId)
    .maybeSingle()

  const { data: updated, error } = await supabase
    .from('payment_receipts')
    .update({ visit_id: visitId, transfer_log_id: log?.id ?? null })
    .eq('id', receiptId)
    .eq('organization_id', ctx.organizationId)
    .select('covers_group')
    .maybeSingle()

  if (error) {
    console.error('[linkReceiptToVisit]', error.message)
    return { error: 'No se pudo vincular el comprobante' }
  }

  // Pago conjunto (mig 164): el corte que escaneó el comprobante-ancla también entra
  // al grupo vía covering_receipt_id, para que la conciliación sume SU monto (junto con
  // los cortes colgados) contra el total del comprobante.
  if (updated?.covers_group) {
    const { error: cvErr } = await supabase
      .from('visits')
      .update({ covering_receipt_id: receiptId })
      .eq('id', visitId)
    if (cvErr) console.error('[linkReceiptToVisit] covering_receipt_id:', cvErr.message)
  }
  return { ok: true }
}

export interface OpenJointReceipt {
  id: string
  amount: number            // total transferido (monto del comprobante ancla)
  assigned: number          // ya repartido en cortes del grupo
  remaining: number         // amount - assigned (lo que queda por cubrir)
  accountName: string | null
  barberName: string | null
  createdAt: string
}

/**
 * Comprobantes-ancla de pago conjunto ABIERTOS de una sucursal (últimas ~6h) que
 * todavía tienen monto sin asignar. Es la lista que ve el 2º barbero para colgar su
 * corte del pago que ya hizo el cliente, sin volver a escanear. Corre con sesión de
 * barbero (PIN) o admin, vía resolveReceiptContext.
 */
export async function getOpenJointReceipts(branchId: string): Promise<OpenJointReceipt[]> {
  const ctx = await resolveReceiptContext()
  if (!ctx) return []
  const supabase = createAdminClient()

  const sinceIso = new Date(Date.now() - 6 * 3600_000).toISOString()
  const { data: anchors } = await supabase
    .from('payment_receipts')
    .select('id, extracted_amount, created_at, payment_account_id, account:payment_accounts(name), barber:staff(full_name)')
    .eq('organization_id', ctx.organizationId)
    .eq('branch_id', branchId)
    .eq('covers_group', true)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(20)
  if (!anchors || anchors.length === 0) return []

  const ids = (anchors as { id: string }[]).map((a) => a.id)
  const { data: covered } = await supabase
    .from('visits')
    .select('covering_receipt_id, amount, tip_amount, tip_payment_method')
    .in('covering_receipt_id', ids)

  const assignedById = new Map<string, number>()
  for (const v of covered ?? []) {
    const key = v.covering_receipt_id as string
    const charge = Number(v.amount ?? 0) + (v.tip_payment_method === 'transfer' ? Number(v.tip_amount ?? 0) : 0)
    assignedById.set(key, (assignedById.get(key) ?? 0) + charge)
  }

  const out: OpenJointReceipt[] = []
  for (const a of anchors as unknown as Record<string, unknown>[]) {
    const amount = a.extracted_amount != null ? Number(a.extracted_amount) : 0
    const assigned = assignedById.get(a.id as string) ?? 0
    const remaining = Math.round((amount - assigned) * 100) / 100
    if (remaining <= 0) continue
    out.push({
      id: a.id as string,
      amount,
      assigned,
      remaining,
      accountName: (firstOf(a.account as never) as { name?: string } | null)?.name ?? null,
      barberName: (firstOf(a.barber as never) as { full_name?: string } | null)?.full_name ?? null,
      createdAt: a.created_at as string,
    })
  }
  return out
}

// ============================================================
// Fallback QR — el cliente sube el comprobante desde su propio celular
// ============================================================
// El barbero abre un QR en la tablet → el cliente lo escanea → sube la foto
// desde su cel a `/upload-comprobante/[token]`. La imagen va SIEMPRE al bucket
// privado `transfer-receipts` (path efímero `{org}/qr/{token}.webp`). La tablet
// hace polling (robusto en el panel PIN, sin depender de Realtime anon) y cuando
// llega la corre por el mismo pipeline que la cámara frontal.

const QR_TMP = (orgId: string, token: string) => `${orgId}/qr/${token}.webp`

/** Crea una sesión de subida QR para la org del barbero. Devuelve el token. */
export async function createReceiptUploadSession(): Promise<{ token: string } | { error: string }> {
  const ctx = await resolveReceiptContext()
  if (!ctx) return { error: 'No autorizado' }
  const supabase = createAdminClient()
  const token = randomUUID()
  const { error } = await supabase
    .from('qr_photo_sessions')
    .insert({ token, organization_id: ctx.organizationId })
  if (error) { console.error('[createReceiptUploadSession]', error.message); return { error: 'No se pudo iniciar' } }
  return { token }
}

/** La tablet pregunta si ya llegó la imagen. Devuelve una signed URL cuando existe. */
export async function pollReceiptUpload(token: string): Promise<{ url: string } | { pending: true } | { error: string }> {
  const ctx = await resolveReceiptContext()
  if (!ctx) return { error: 'No autorizado' }
  const supabase = createAdminClient()
  const { data } = await supabase.storage
    .from('transfer-receipts')
    .createSignedUrl(QR_TMP(ctx.organizationId, token), 300)
  if (data?.signedUrl) return { url: data.signedUrl }
  return { pending: true }
}

/**
 * Subida desde el celular del cliente (página pública `/upload-comprobante`).
 * Sin sesión de barbero: se valida por el token (capability). Sube al bucket
 * PRIVADO. El barber NO es usuario Supabase auth → va por service role.
 */
export async function submitReceiptUpload(
  token: string,
  base64: string,
  mediaType: string,
): Promise<{ ok: true } | { error: string }> {
  if (!token || !base64) return { error: 'Datos incompletos' }
  const supabase = createAdminClient()
  const { data: sess } = await supabase
    .from('qr_photo_sessions')
    .select('organization_id, is_active')
    .eq('token', token)
    .maybeSingle()
  if (!sess || !sess.is_active) return { error: 'El código expiró. Pedile al barbero que genere uno nuevo.' }

  const { error } = await supabase.storage
    .from('transfer-receipts')
    .upload(QR_TMP(sess.organization_id, token), Buffer.from(base64, 'base64'), {
      contentType: mediaType || 'image/webp',
      upsert: true,
    })
  if (error) { console.error('[submitReceiptUpload]', error.message); return { error: 'No se pudo subir la imagen' } }
  return { ok: true }
}

// ============================================================
// Dashboard admin — conciliación
// ============================================================

export type ReconState =
  | 'conciliado' | 'sin_comprobante' | 'monto' | 'fecha' | 'duplicado' | 'revision' | 'huerfano' | 'historico'

export interface ReconReceipt {
  id: string
  status: ReceiptStatus
  extractedAmount: number | null
  operationNumber: string | null
  senderName: string | null
  recipientAlias: string | null
  bankOrWallet: string | null
  confidence: number | null
  imagePath: string | null
  amountMatches: boolean | null
  aliasMatches: boolean | null
  dateOk: boolean | null
  extractedDatetime: string | null
  captureMethod: string
  engine: string | null
  reviewNote: string | null
  reconciledAt: string | null
  coversGroup: boolean
  createdAt: string
}

export interface ReconRow {
  kind: 'payment' | 'orphan'
  id: string
  receiptId: string | null
  datetime: string
  barberName: string | null
  clientName: string | null
  accountName: string | null
  chargedAmount: number | null
  expectedAmount: number | null
  state: ReconState
  /**
   * Flag interno "revisar fecha": el cobro está conciliado por monto, pero la fecha
   * leída parece de otro día y nadie la revisó todavía. Es un aviso suave para el
   * admin — NO cuenta como brecha ni frenó el cobro en la caja.
   */
  dateReview: boolean
  /**
   * Flag interno "cobro conjunto" (mig 164): este corte se pagó dentro de una
   * transferencia que cubre varios cortes. Es un aviso para que el admin verifique
   * que el comprobante-ancla cubre la suma. Se limpia al revisar el ancla.
   */
  jointReview: boolean
  /** Detalle del grupo cuando el corte es cobro conjunto. */
  jointInfo: { receiptAmount: number; groupTotal: number; count: number } | null
  receipt: ReconReceipt | null
}

export interface ReconSummary {
  totalTransferido: number
  totalRespaldado: number
  brecha: number
  pctConciliado: number
  scopeCount: number
  /** Cobros conciliados pero con fecha a revisar (aviso interno, no es brecha). */
  dateReview: number
  /** Cortes cobrados en conjunto pendientes de revisar (aviso interno). */
  jointReview: number
  counts: Record<ReconState, number>
}

export interface ReconResult {
  rows: ReconRow[]
  summary: ReconSummary
  truncated: boolean
}

const EMPTY_COUNTS: Record<ReconState, number> = {
  conciliado: 0, sin_comprobante: 0, monto: 0, fecha: 0, duplicado: 0, revision: 0, huerfano: 0, historico: 0,
}
const EMPTY_RESULT: ReconResult = {
  rows: [],
  summary: { totalTransferido: 0, totalRespaldado: 0, brecha: 0, pctConciliado: 100, scopeCount: 0, dateReview: 0, jointReview: 0, counts: { ...EMPTY_COUNTS } },
  truncated: false,
}

/** Resuelve permisos efectivos del usuario del dashboard (owner/admin + rol). */
async function getDashboardPerms(): Promise<Record<string, boolean>> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return {}
  const { data: staff } = await authClient
    .from('staff')
    .select('id, role, role_id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  const isOwnerAdmin = ['owner', 'admin'].includes(staff?.role || '')
  let rolePerms: Record<string, boolean> | null = null
  if (staff?.role_id) {
    const { data: role } = await authClient.from('roles').select('permissions').eq('id', staff.role_id).single()
    rolePerms = (role?.permissions as Record<string, boolean> | null) ?? null
  }
  return getEffectivePermissions(rolePerms ?? undefined, isOwnerAdmin)
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

function mapReceipt(r: Record<string, unknown> | null): ReconReceipt | null {
  if (!r) return null
  return {
    id: r.id as string,
    status: r.status as ReceiptStatus,
    extractedAmount: r.extracted_amount != null ? Number(r.extracted_amount) : null,
    operationNumber: (r.operation_number as string) ?? null,
    senderName: (r.sender_name as string) ?? null,
    recipientAlias: (r.recipient_cbu_alias as string) ?? null,
    bankOrWallet: (r.bank_or_wallet as string) ?? null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    imagePath: (r.image_path as string) ?? null,
    amountMatches: (r.amount_matches as boolean | null) ?? null,
    aliasMatches: (r.alias_matches as boolean | null) ?? null,
    dateOk: (r.date_ok as boolean | null) ?? null,
    extractedDatetime: (r.extracted_datetime as string) ?? null,
    captureMethod: (r.capture_method as string) ?? 'front_camera',
    engine: (r.extraction_engine as string) ?? null,
    reviewNote: (r.review_note as string) ?? null,
    reconciledAt: (r.reconciled_at as string) ?? null,
    coversGroup: (r.covers_group as boolean) ?? false,
    createdAt: r.created_at as string,
  }
}

/**
 * Estado de conciliación (del DINERO) a partir del comprobante. La fecha NO define
 * el estado: desde que dejó de bloquear el escaneo, un cobro con monto correcto está
 * respaldado aunque la fecha leída parezca vieja. La discrepancia de fecha se expone
 * aparte como `dateReview` (ver dateReviewFor). El estado legacy `date_mismatch`
 * (comprobantes viejos, antes de este cambio) se reinterpreta acá mismo.
 */
function stateFromReceipt(receipt: ReconReceipt): ReconState {
  switch (receipt.status) {
    case 'verified':
    case 'manual_ok': return 'conciliado'
    case 'amount_mismatch': return 'monto'
    case 'duplicate': return 'duplicado'
    case 'date_mismatch':
      // Legacy: el dinero está respaldado si el monto coincidió; si no, es un
      // problema de monto real (no de fecha).
      return receipt.amountMatches === false ? 'monto' : 'conciliado'
    case 'needs_review':
    case 'overridden':
    default: return 'revision'
  }
}

/**
 * Flag interno "revisar fecha": conciliado por monto pero la fecha leída parece de
 * otro día, y todavía nadie lo revisó (`reconciled_at`). Se limpia solo cuando el
 * admin actúa sobre el comprobante (dar por válido / guardar nota / marcar revisada).
 */
function dateReviewFor(receipt: ReconReceipt | null, state: ReconState): boolean {
  return state === 'conciliado' && receipt?.dateOk === false && receipt?.reconciledAt == null
}

const RECON_LIMIT = 2000

/**
 * Concilia los cobros por transferencia (visits.payment_method='transfer') contra
 * sus comprobantes escaneados (payment_receipts). Devuelve las filas cruzadas +
 * el resumen (total transferido, respaldado, brecha, % conciliado, conteos).
 *
 * Los cobros anteriores a `required_since` (histórico / pre-feature) quedan como
 * 'historico' y NO cuentan como "sin comprobante" — así el tablero no grita sobre
 * miles de transferencias viejas.
 */
export async function getReconciliation(params: {
  from: string
  to: string
  branchId?: string | null
  accountId?: string | null
}): Promise<ReconResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return EMPTY_RESULT
  const scoped = await getScopedBranchIds()
  const branchIds = params.branchId ? [params.branchId].filter((b) => scoped.includes(b)) : scoped
  if (branchIds.length === 0) return EMPTY_RESULT

  const supabase = createAdminClient()

  const { data: settings } = await supabase
    .from('transfer_receipt_settings')
    .select('required_since, amount_tolerance')
    .eq('organization_id', orgId)
    .maybeSingle()
  const requiredSince = settings?.required_since ? new Date(settings.required_since).getTime() : null
  const amountTolerance = Number(settings?.amount_tolerance ?? 1)

  let vq = supabase
    .from('visits')
    .select(`id, amount, tip_amount, tip_payment_method, completed_at, payment_account_id, covering_receipt_id,
      client:clients(name),
      barber:staff(full_name),
      account:payment_accounts(name),
      receipt:payment_receipts(id, status, extracted_amount, operation_number, sender_name, recipient_cbu_alias, bank_or_wallet, confidence, image_path, amount_matches, alias_matches, date_ok, extracted_datetime, capture_method, extraction_engine, review_note, reconciled_at, covers_group, created_at, expected_amount)`)
    .eq('organization_id', orgId)
    .eq('payment_method', 'transfer')
    .in('branch_id', branchIds)
    .gte('completed_at', params.from)
    .lte('completed_at', params.to)
    .order('completed_at', { ascending: false })
    .limit(RECON_LIMIT)
  if (params.accountId) vq = vq.eq('payment_account_id', params.accountId)
  const { data: visits, error: vErr } = await vq
  if (vErr) { console.error('[getReconciliation visits]', vErr.message); return EMPTY_RESULT }

  let oq = supabase
    .from('payment_receipts')
    .select(`id, status, extracted_amount, operation_number, sender_name, recipient_cbu_alias, bank_or_wallet, confidence, image_path, amount_matches, alias_matches, date_ok, extracted_datetime, capture_method, extraction_engine, review_note, reconciled_at, created_at, expected_amount, payment_account_id, barber:staff(full_name), account:payment_accounts(name)`)
    .eq('organization_id', orgId)
    .is('visit_id', null)
    .in('branch_id', branchIds)
    .gte('created_at', params.from)
    .lte('created_at', params.to)
    .order('created_at', { ascending: false })
    .limit(500)
  if (params.accountId) oq = oq.eq('payment_account_id', params.accountId)
  const { data: orphans } = await oq

  // Cobro conjunto (mig 164): los cortes con covering_receipt_id se respaldan con un
  // comprobante-ancla (uno cubre varios cortes). Resolvemos las anclas y el total de
  // cada grupo (sumando TODOS sus cortes, aun fuera del rango, para validar la cobertura).
  const coveringIds = Array.from(new Set(
    (visits ?? [])
      .map((v) => (v as Record<string, unknown>).covering_receipt_id as string | null)
      .filter((x): x is string => !!x),
  ))
  const anchorById = new Map<string, ReconReceipt>()
  const groupTotalById = new Map<string, number>()
  const groupCountById = new Map<string, number>()
  if (coveringIds.length > 0) {
    const [{ data: anchors }, { data: groupCuts }] = await Promise.all([
      supabase
        .from('payment_receipts')
        .select('id, status, extracted_amount, operation_number, sender_name, recipient_cbu_alias, bank_or_wallet, confidence, image_path, amount_matches, alias_matches, date_ok, extracted_datetime, capture_method, extraction_engine, review_note, reconciled_at, covers_group, created_at, expected_amount')
        .in('id', coveringIds),
      supabase
        .from('visits')
        .select('covering_receipt_id, amount, tip_amount, tip_payment_method')
        .in('covering_receipt_id', coveringIds),
    ])
    for (const a of anchors ?? []) {
      const rec = mapReceipt(a as Record<string, unknown>)
      if (rec) anchorById.set(rec.id, rec)
    }
    for (const gc of groupCuts ?? []) {
      const key = gc.covering_receipt_id as string
      const charge = Number(gc.amount ?? 0) + (gc.tip_payment_method === 'transfer' ? Number(gc.tip_amount ?? 0) : 0)
      groupTotalById.set(key, (groupTotalById.get(key) ?? 0) + charge)
      groupCountById.set(key, (groupCountById.get(key) ?? 0) + 1)
    }
  }

  const rows: ReconRow[] = []

  for (const v of (visits ?? []) as unknown as Record<string, unknown>[]) {
    // Lo que el cliente transfirió de verdad = cobro + propina, cuando la propina también
    // fue por transferencia (el alias de la tablet pide el total junto). Comparar sólo
    // contra visits.amount marcaba como "monto no coincide" comprobantes que estaban bien.
    const charged =
      Number(v.amount ?? 0) +
      (v.tip_payment_method === 'transfer' ? Number(v.tip_amount ?? 0) : 0)

    const coveringId = (v.covering_receipt_id as string | null) ?? null
    let receipt: ReconReceipt | null
    let state: ReconState
    let dateReview = false
    let jointReview = false
    let jointInfo: { receiptAmount: number; groupTotal: number; count: number } | null = null
    let expectedAmount = charged

    if (coveringId && anchorById.has(coveringId)) {
      // ── Cobro conjunto: respaldado por el comprobante-ancla ──
      const anchor = anchorById.get(coveringId)!
      receipt = anchor
      const receiptAmount = anchor.extractedAmount ?? 0
      const groupTotal = groupTotalById.get(coveringId) ?? charged
      const count = groupCountById.get(coveringId) ?? 1
      jointInfo = { receiptAmount, groupTotal, count }
      expectedAmount = receiptAmount
      // El grupo está respaldado si la suma de sus cortes NO supera el comprobante.
      // Si lo supera, el comprobante "no alcanza" → problema de monto real.
      const covered = receiptAmount > 0 && groupTotal <= receiptAmount + amountTolerance
      state = covered ? 'conciliado' : 'monto'
      // Alerta interna hasta que el admin revise el ancla (reconciled_at).
      jointReview = anchor.reconciledAt == null
    } else {
      const rRaw = firstOf(v.receipt as Record<string, unknown> | Record<string, unknown>[] | null)
      receipt = mapReceipt(rRaw)
      if (receipt) {
        state = stateFromReceipt(receipt)
      } else {
        const ts = new Date(v.completed_at as string).getTime()
        state = requiredSince != null && ts >= requiredSince ? 'sin_comprobante' : 'historico'
      }
      dateReview = dateReviewFor(receipt, state)
      if (rRaw?.expected_amount != null) expectedAmount = Number(rRaw.expected_amount)
    }

    rows.push({
      kind: 'payment',
      id: v.id as string,
      receiptId: receipt?.id ?? null,
      datetime: v.completed_at as string,
      barberName: (firstOf(v.barber as never) as { full_name?: string } | null)?.full_name ?? null,
      clientName: (firstOf(v.client as never) as { name?: string } | null)?.name ?? null,
      accountName: (firstOf(v.account as never) as { name?: string } | null)?.name ?? null,
      chargedAmount: charged,
      expectedAmount,
      state,
      dateReview,
      jointReview,
      jointInfo,
      receipt,
    })
  }

  for (const o of (orphans ?? []) as unknown as Record<string, unknown>[]) {
    const receipt = mapReceipt(o)
    rows.push({
      kind: 'orphan',
      id: o.id as string,
      receiptId: o.id as string,
      datetime: o.created_at as string,
      barberName: (firstOf(o.barber as never) as { full_name?: string } | null)?.full_name ?? null,
      clientName: null,
      accountName: (firstOf(o.account as never) as { name?: string } | null)?.name ?? null,
      chargedAmount: null,
      expectedAmount: o.expected_amount != null ? Number(o.expected_amount) : null,
      state: 'huerfano',
      dateReview: false,
      jointReview: false,
      jointInfo: null,
      receipt,
    })
  }

  const counts: Record<ReconState, number> = { ...EMPTY_COUNTS }
  let totalTransferido = 0, totalRespaldado = 0, brecha = 0, scopeCount = 0, dateReview = 0, jointReview = 0
  for (const row of rows) {
    counts[row.state]++
    if (row.dateReview) dateReview++
    if (row.jointReview) jointReview++
    if (row.kind === 'payment') {
      const amt = row.chargedAmount ?? 0
      totalTransferido += amt
      if (row.state !== 'historico') {
        scopeCount++
        if (row.state === 'conciliado') totalRespaldado += amt
        else brecha += amt
      }
    }
  }
  const pctConciliado = scopeCount > 0 ? Math.round((counts.conciliado / scopeCount) * 100) : 100

  return {
    rows,
    summary: { totalTransferido, totalRespaldado, brecha, pctConciliado, scopeCount, dateReview, jointReview, counts },
    truncated: (visits?.length ?? 0) >= RECON_LIMIT,
  }
}

/** URL firmada (1h) de la imagen del comprobante — bucket privado, scope por org. */
export async function getReceiptSignedUrl(imagePath: string): Promise<string | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId || !imagePath.startsWith(orgId + '/')) return null
  const supabase = createAdminClient()
  const { data } = await supabase.storage.from('transfer-receipts').createSignedUrl(imagePath, 3600)
  return data?.signedUrl ?? null
}

/**
 * Acción manual del admin sobre un comprobante:
 *  - `manual_ok`     → dar por válido a mano (sella + status manual_ok).
 *  - `date_reviewed` → confirmar la fecha marcada "a revisar" (sella, sin tocar status).
 *  - `note`          → sólo guardar una nota, SIN sellar.
 * Sólo las acciones de RESOLUCIÓN explícita setean `reconciled_at`: guardar una nota
 * no da el comprobante por revisado, así el aviso "revisar fecha" no se limpia sin querer.
 */
export async function reviewReceipt(
  receiptId: string,
  action: 'manual_ok' | 'note' | 'date_reviewed' | 'joint_reviewed',
  note?: string,
): Promise<{ ok: true } | { error: string }> {
  const perms = await getDashboardPerms()
  if (!perms['comprobantes.manage']) return { error: 'No tenés permiso para conciliar' }
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let staffId: string | null = null
  if (user) {
    const { data: s } = await authClient.from('staff').select('id').eq('auth_user_id', user.id).single()
    staffId = s?.id ?? null
  }

  const patch: Record<string, unknown> = {
    review_note: note ?? null,
  }
  if (action === 'manual_ok' || action === 'date_reviewed' || action === 'joint_reviewed') {
    patch.reconciled_at = new Date().toISOString()
    patch.reconciled_by = staffId
  }
  if (action === 'manual_ok') patch.status = 'manual_ok'

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('payment_receipts')
    .update(patch)
    .eq('id', receiptId)
    .eq('organization_id', orgId)
  if (error) { console.error('[reviewReceipt]', error.message); return { error: 'No se pudo guardar' } }
  revalidatePath('/dashboard/comprobantes')
  return { ok: true }
}

/** Config de comprobantes para el dashboard (contexto org, no barber panel). */
export async function getReceiptSettingsForOrg(): Promise<TransferReceiptSettingsView> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return DEFAULTS
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('transfer_receipt_settings')
    .select('is_enabled, extraction_engine, required_since, amount_tolerance, date_tolerance_minutes')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!data) return DEFAULTS
  return {
    isEnabled: data.is_enabled,
    engine: (data.extraction_engine as ReceiptEngine) ?? 'ai',
    requiredSince: data.required_since,
    amountTolerance: Number(data.amount_tolerance ?? 1),
    dateToleranceMinutes: Number(data.date_tolerance_minutes ?? 180),
  }
}

/** Activa/desactiva la feature y elige el motor. Al activar por 1ra vez fija required_since. */
export async function updateReceiptSettings(input: {
  isEnabled: boolean
  engine: ReceiptEngine
  dateToleranceMinutes?: number
}): Promise<{ ok: true } | { error: string }> {
  const perms = await getDashboardPerms()
  if (!perms['comprobantes.manage']) return { error: 'No tenés permiso para configurar' }
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data: existing } = await supabase
    .from('transfer_receipt_settings')
    .select('required_since')
    .eq('organization_id', orgId)
    .maybeSingle()
  const requiredSince = input.isEnabled
    ? existing?.required_since ?? new Date().toISOString()
    : existing?.required_since ?? null

  const row: Record<string, unknown> = {
    organization_id: orgId,
    is_enabled: input.isEnabled,
    extraction_engine: input.engine,
    required_since: requiredSince,
    updated_at: new Date().toISOString(),
  }
  if (input.dateToleranceMinutes != null) {
    row.date_tolerance_minutes = Math.max(5, Math.round(input.dateToleranceMinutes))
  }

  const { error } = await supabase
    .from('transfer_receipt_settings')
    .upsert(row, { onConflict: 'organization_id' })
  if (error) { console.error('[updateReceiptSettings]', error.message); return { error: 'No se pudo guardar' } }
  revalidatePath('/dashboard/comprobantes')
  return { ok: true }
}
