'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, validateBranchAccess } from './org'
import { getActiveTimezone } from '@/lib/i18n'
import { getLocalDateStr } from '@/lib/time-utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TipPaymentMethod = 'cash' | 'card' | 'transfer'
export type TipReportStatus = 'pending' | 'paid'

export interface TipReport {
  id: string
  staff_id: string
  branch_id: string
  amount: number
  notes: string | null
  report_date: string
  status: TipReportStatus
  batch_id: string | null
  tip_payment_method: TipPaymentMethod | null
  source_visit_id: string | null
  created_at: string
}

export interface BarberTipBucket {
  staff_id: string
  staff_name: string
  branch_id: string
  branch_name: string
  pending_count: number
  pending_total: number
  pending_cash: number
  pending_card: number
  pending_transfer: number
  paid_total: number
  first_pending_date: string | null
  last_pending_date: string | null
}

export interface TipsOrgSummary {
  pending_total: number
  paid_total: number
  pending_count: number
  paid_count: number
  pending_cash: number
  pending_card: number
  pending_transfer: number
  barbers_with_pending: number
  branches_with_pending: number
  first_tip_date: string | null
  last_tip_date: string | null
  by_barber: BarberTipBucket[]
}

export interface TipsMonthlyPoint {
  month: string         // YYYY-MM
  total_amount: number
  count: number
  cash: number
  card: number
  transfer: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveOrgBranchIds(branchId?: string | null): Promise<string[] | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null
  const supabase = createAdminClient()

  if (branchId) {
    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('organization_id', orgId)
      .maybeSingle()
    return branch ? [branch.id] : []
  }

  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)
  return (branches ?? []).map((b) => b.id)
}

// ─── Lecturas ─────────────────────────────────────────────────────────────────

/**
 * Resumen org-wide (o por sucursal): cuánto se debe en propinas, cuánto se
 * pagó, mix de método, y desglose por barbero. Usado por el panel de finanzas.
 */
export async function getOrgTipsSummary(branchId?: string | null): Promise<TipsOrgSummary> {
  const branchIds = await resolveOrgBranchIds(branchId)

  const empty: TipsOrgSummary = {
    pending_total: 0, paid_total: 0,
    pending_count: 0, paid_count: 0,
    pending_cash: 0, pending_card: 0, pending_transfer: 0,
    barbers_with_pending: 0, branches_with_pending: 0,
    first_tip_date: null, last_tip_date: null,
    by_barber: [],
  }

  if (!branchIds || branchIds.length === 0) return empty

  const supabase = createAdminClient()

  // Traer TODOS los tip reports (paginado por seguridad: org grande podría tener miles)
  const reports = await fetchAll<TipReport>((from, to) =>
    supabase
      .from('salary_reports')
      .select('id, staff_id, branch_id, amount, notes, report_date, status, batch_id, tip_payment_method, source_visit_id, created_at')
      .eq('type', 'tip')
      .in('branch_id', branchIds)
      .order('report_date', { ascending: true })
      .range(from, to)
  )

  if (reports.length === 0) return empty

  // Resolver nombres de staff/branch en una sola query
  const staffIds = Array.from(new Set(reports.map((r) => r.staff_id)))
  const branchSet = Array.from(new Set(reports.map((r) => r.branch_id)))
  const [{ data: staffRows }, { data: branchRows }] = await Promise.all([
    supabase.from('staff').select('id, full_name').in('id', staffIds),
    supabase.from('branches').select('id, name').in('id', branchSet),
  ])
  const staffNames = new Map((staffRows ?? []).map((s) => [s.id, s.full_name]))
  const branchNames = new Map((branchRows ?? []).map((b) => [b.id, b.name]))

  // Agregados org-level
  const summary: TipsOrgSummary = { ...empty }
  const buckets = new Map<string, BarberTipBucket>() // key = staff_id|branch_id

  for (const r of reports) {
    const amt = Number(r.amount)
    const method = r.tip_payment_method
    const dateStr = r.report_date

    if (r.status === 'pending') {
      summary.pending_total += amt
      summary.pending_count += 1
      if (method === 'cash') summary.pending_cash += amt
      else if (method === 'card') summary.pending_card += amt
      else if (method === 'transfer') summary.pending_transfer += amt
      summary.first_tip_date =
        !summary.first_tip_date || dateStr < summary.first_tip_date ? dateStr : summary.first_tip_date
      summary.last_tip_date =
        !summary.last_tip_date || dateStr > summary.last_tip_date ? dateStr : summary.last_tip_date
    } else {
      summary.paid_total += amt
      summary.paid_count += 1
    }

    const key = `${r.staff_id}|${r.branch_id}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        staff_id: r.staff_id,
        staff_name: staffNames.get(r.staff_id) ?? '—',
        branch_id: r.branch_id,
        branch_name: branchNames.get(r.branch_id) ?? '—',
        pending_count: 0, pending_total: 0,
        pending_cash: 0, pending_card: 0, pending_transfer: 0,
        paid_total: 0,
        first_pending_date: null, last_pending_date: null,
      }
      buckets.set(key, bucket)
    }

    if (r.status === 'pending') {
      bucket.pending_count += 1
      bucket.pending_total += amt
      if (method === 'cash') bucket.pending_cash += amt
      else if (method === 'card') bucket.pending_card += amt
      else if (method === 'transfer') bucket.pending_transfer += amt
      bucket.first_pending_date =
        !bucket.first_pending_date || dateStr < bucket.first_pending_date ? dateStr : bucket.first_pending_date
      bucket.last_pending_date =
        !bucket.last_pending_date || dateStr > bucket.last_pending_date ? dateStr : bucket.last_pending_date
    } else {
      bucket.paid_total += amt
    }
  }

  summary.by_barber = Array.from(buckets.values())
    .sort((a, b) => b.pending_total - a.pending_total)

  summary.barbers_with_pending = summary.by_barber.filter((b) => b.pending_total > 0).length
  summary.branches_with_pending = new Set(
    summary.by_barber.filter((b) => b.pending_total > 0).map((b) => b.branch_id)
  ).size

  return summary
}

/**
 * Histórico mensual de propinas para un gráfico de tendencia. Devuelve
 * cubre desde la primera propina registrada hasta hoy.
 */
export async function getTipsMonthlyTrend(branchId?: string | null): Promise<TipsMonthlyPoint[]> {
  const branchIds = await resolveOrgBranchIds(branchId)
  if (!branchIds || branchIds.length === 0) return []

  const supabase = createAdminClient()
  const reports = await fetchAll<{ amount: number; report_date: string; tip_payment_method: TipPaymentMethod | null }>(
    (from, to) =>
      supabase
        .from('salary_reports')
        .select('amount, report_date, tip_payment_method')
        .eq('type', 'tip')
        .in('branch_id', branchIds)
        .order('report_date', { ascending: true })
        .range(from, to)
  )

  const byMonth = new Map<string, TipsMonthlyPoint>()
  for (const r of reports) {
    const month = r.report_date.slice(0, 7)
    let p = byMonth.get(month)
    if (!p) {
      p = { month, total_amount: 0, count: 0, cash: 0, card: 0, transfer: 0 }
      byMonth.set(month, p)
    }
    const amt = Number(r.amount)
    p.total_amount += amt
    p.count += 1
    if (r.tip_payment_method === 'cash') p.cash += amt
    else if (r.tip_payment_method === 'card') p.card += amt
    else if (r.tip_payment_method === 'transfer') p.transfer += amt
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month))
}

export interface TipReportWithAccount extends TipReport {
  account_id: string | null
  account_name: string | null
  account_alias: string | null
  account_is_active: boolean | null
}

/**
 * Detalle día-a-día de propinas pendientes de un barbero (drill-down).
 * Cada item incluye la cuenta de cobro a la que entró el dinero (visits.payment_account_id),
 * incluso si la cuenta está dada de baja — para que el dueño sepa de dónde sacar para pagar.
 */
export async function getBarberTipsDetail(staffId: string, branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, organization_id')
    .eq('id', staffId)
    .maybeSingle()
  if (!staffRow || staffRow.organization_id !== orgId) return { error: 'No autorizado' }

  const { data: reports, error } = await supabase
    .from('salary_reports')
    .select('id, staff_id, branch_id, amount, notes, report_date, status, batch_id, tip_payment_method, source_visit_id, created_at')
    .eq('type', 'tip')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .order('report_date', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[getBarberTipsDetail]', error.message)
    return { error: 'Error al traer las propinas del barbero.' }
  }

  if (!reports || reports.length === 0) return { data: [] as TipReportWithAccount[] }

  // Resolver payment_account_id desde la visita asociada (puede estar inactiva)
  const visitIds = reports.map((r) => r.source_visit_id).filter(Boolean) as string[]
  const accountByVisit = new Map<string, { id: string; name: string; alias: string | null; is_active: boolean }>()

  if (visitIds.length > 0) {
    const { data: visits } = await supabase
      .from('visits')
      .select('id, payment_account_id, account:payment_accounts(id, name, alias_or_cbu, is_active)')
      .in('id', visitIds)

    for (const v of (visits ?? [])) {
      const acc = v.account as unknown as { id: string; name: string; alias_or_cbu: string | null; is_active: boolean } | null
      if (acc) {
        accountByVisit.set(v.id, { id: acc.id, name: acc.name, alias: acc.alias_or_cbu, is_active: acc.is_active })
      }
    }
  }

  const enriched: TipReportWithAccount[] = reports.map((r) => {
    const acc = r.source_visit_id ? accountByVisit.get(r.source_visit_id) : null
    return {
      ...(r as TipReport),
      account_id: acc?.id ?? null,
      account_name: acc?.name ?? null,
      account_alias: acc?.alias ?? null,
      account_is_active: acc?.is_active ?? null,
    }
  })

  return { data: enriched }
}

// ─── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Pagar TODAS las propinas pendientes de un barbero (atajo "pagar todo").
 * Reusa la maquinaria de paySelectedReports vía un INSERT en
 * salary_payment_batches y UPDATE de los reports.
 */
export async function payAllPendingTipsForBarber(
  staffId: string,
  branchId: string,
  paymentMethod: 'cash' | 'transfer' | 'card' | 'other' = 'cash',
  paymentAccountId?: string | null,
  notes?: string,
) {
  if (!staffId || !branchId) return { error: 'Barbero y sucursal son obligatorios.' }
  if (paymentMethod === 'transfer' && !paymentAccountId) {
    return { error: 'Para pagos por transferencia seleccioná una cuenta.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  if (paymentMethod === 'transfer' && paymentAccountId) {
    const { data: account } = await supabase
      .from('payment_accounts')
      .select('id, branch_id, is_active')
      .eq('id', paymentAccountId)
      .eq('branch_id', branchId)
      .maybeSingle()
    if (!account) return { error: 'La cuenta seleccionada no pertenece a esta sucursal.' }
    if (!account.is_active) return { error: 'La cuenta seleccionada está inactiva.' }
  }

  // Traer pendientes
  const { data: pending, error: pErr } = await supabase
    .from('salary_reports')
    .select('id, amount')
    .eq('type', 'tip')
    .eq('status', 'pending')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)

  if (pErr) {
    console.error('[payAllPendingTipsForBarber] fetch', pErr.message)
    return { error: 'Error al obtener propinas pendientes.' }
  }
  if (!pending || pending.length === 0) {
    return { error: 'Este barbero no tiene propinas pendientes.' }
  }

  const total = pending.reduce((s, r) => s + Number(r.amount), 0)
  const reportIds = pending.map((r) => r.id)

  const { data: staffRow } = await supabase
    .from('staff')
    .select('full_name')
    .eq('id', staffId)
    .maybeSingle()
  const staffName = staffRow?.full_name ?? 'barbero'

  const { data: batch, error: bErr } = await supabase
    .from('salary_payment_batches')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      total_amount: total,
      paid_at: new Date().toISOString(),
      notes: notes ?? `Propinas — ${pending.length} cobro${pending.length === 1 ? '' : 's'}`,
      payment_method: paymentMethod,
      payment_account_id: paymentMethod === 'transfer' ? paymentAccountId ?? null : null,
    })
    .select('id')
    .single()

  if (bErr || !batch) {
    console.error('[payAllPendingTipsForBarber] batch', bErr?.message)
    return { error: 'Error al registrar el pago.' }
  }

  // Generar expense_ticket — categoría "Propinas" para que se distinga en finanzas
  const tz = await getActiveTimezone()
  const today = getLocalDateStr(tz)
  const { data: expenseTicket, error: eErr } = await supabase
    .from('expense_tickets')
    .insert({
      branch_id: branchId,
      amount: total,
      category: 'Propinas',
      description: `Pago de propinas a ${staffName} (${pending.length} cobro${pending.length === 1 ? '' : 's'})`,
      payment_account_id: paymentMethod === 'transfer' ? paymentAccountId ?? null : null,
      expense_date: today,
    })
    .select('id')
    .single()

  if (eErr) {
    console.error('[payAllPendingTipsForBarber] expense_ticket', eErr.message)
  } else if (expenseTicket) {
    await supabase
      .from('salary_payment_batches')
      .update({ expense_ticket_id: expenseTicket.id })
      .eq('id', batch.id)

    if (paymentMethod === 'transfer' && paymentAccountId) {
      await supabase.rpc('increment_account_accumulated', {
        p_account_id: paymentAccountId,
        p_amount: total,
      })
    }
  }

  // Marcar todos los reports como pagados
  const { error: uErr } = await supabase
    .from('salary_reports')
    .update({ status: 'paid', batch_id: batch.id })
    .in('id', reportIds)

  if (uErr) {
    console.error('[payAllPendingTipsForBarber] update reports', uErr.message)
    return { error: 'El pago se registró pero hubo un error al actualizar los reportes.' }
  }

  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/sueldos')
  revalidatePath('/dashboard/caja')
  return { success: true, data: { batchId: batch.id, totalAmount: total, count: pending.length } }
}

/**
 * Recovery / debug: re-procesa visits con tip_amount > 0 que no tengan
 * salary_report 'tip' asociado. Idempotente. Útil si el trigger se cae o
 * si se importan visits desde un sistema externo.
 */
export async function reconcileTipReports() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const tz = await getActiveTimezone()

  const { data: branches } = await supabase
    .from('branches')
    .select('id, timezone')
    .eq('organization_id', orgId)
  const branchIds = (branches ?? []).map((b) => b.id)
  if (branchIds.length === 0) return { success: true, data: { created: 0 } }

  const visits = await fetchAll<{
    id: string
    barber_id: string | null
    branch_id: string
    tip_amount: number
    tip_payment_method: TipPaymentMethod | null
    completed_at: string | null
  }>((from, to) =>
    supabase
      .from('visits')
      .select('id, barber_id, branch_id, tip_amount, tip_payment_method, completed_at')
      .gt('tip_amount', 0)
      .not('completed_at', 'is', null)
      .not('barber_id', 'is', null)
      .in('branch_id', branchIds)
      .order('completed_at')
      .range(from, to)
  )
  if (visits.length === 0) return { success: true, data: { created: 0 } }

  const visitIds = visits.map((v) => v.id)
  const { data: existing } = await supabase
    .from('salary_reports')
    .select('source_visit_id')
    .eq('type', 'tip')
    .in('source_visit_id', visitIds)
  const covered = new Set((existing ?? []).map((r) => r.source_visit_id))

  const tzByBranch = new Map(
    (branches ?? []).map((b) => [b.id, b.timezone || tz])
  )

  const dateInTz = (iso: string, zone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(iso))

  const toInsert = visits
    .filter((v) => !covered.has(v.id))
    .map((v) => {
      const noteByMethod: Record<string, string> = {
        cash: 'Propina del cliente — efectivo',
        card: 'Propina del cliente — tarjeta',
        transfer: 'Propina del cliente — transferencia',
      }
      return {
        staff_id: v.barber_id!,
        branch_id: v.branch_id,
        type: 'tip' as const,
        amount: Number(v.tip_amount),
        notes: v.tip_payment_method ? noteByMethod[v.tip_payment_method] : 'Propina del cliente',
        report_date: dateInTz(v.completed_at!, tzByBranch.get(v.branch_id) || tz),
        status: 'pending' as const,
        tip_payment_method: v.tip_payment_method,
        source_visit_id: v.id,
      }
    })

  if (toInsert.length === 0) return { success: true, data: { created: 0 } }

  const { error: insErr } = await supabase.from('salary_reports').insert(toInsert)
  if (insErr) {
    console.error('[reconcileTipReports]', insErr.message)
    return { error: 'Error al reconciliar propinas.' }
  }

  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/sueldos')
  return { success: true, data: { created: toInsert.length } }
}

// ─── Métricas planas para tarjetas ────────────────────────────────────────────

/** Para tomar el rango temporal cubierto por las propinas (header del panel). */
export async function getTipsCoverageRange(): Promise<{ first: string | null; last: string | null }> {
  const branchIds = await resolveOrgBranchIds()
  if (!branchIds || branchIds.length === 0) return { first: null, last: null }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('salary_reports')
    .select('report_date')
    .eq('type', 'tip')
    .in('branch_id', branchIds)
    .order('report_date', { ascending: true })
    .limit(1)

  const { data: dataLast } = await supabase
    .from('salary_reports')
    .select('report_date')
    .eq('type', 'tip')
    .in('branch_id', branchIds)
    .order('report_date', { ascending: false })
    .limit(1)

  return {
    first: data?.[0]?.report_date ?? null,
    last: dataLast?.[0]?.report_date ?? null,
  }
}

