'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateBranchAccess } from './org'
import { isValidUUID } from '@/lib/validation'
import { getBarberSession } from './auth'

export interface BarberDaySummary {
  cuts: number
  revenue: number
  commission: number
  tips: number
  cash_total: number
  transfer_total: number
  card_total: number
  tips_cash: number
  opening_cash: number
  cash_expected: number
  avg_duration_minutes: number
}

/**
 * Trae el resumen del día actual (en timezone de la sucursal) para el barbero.
 * Usa RPC `get_barber_day_summary` que encapsula el cálculo de fecha local.
 */
export async function fetchBarberShiftSummary(
  staffId: string,
  branchId: string,
): Promise<BarberDaySummary | { error: string }> {
  if (!isValidUUID(staffId) || !isValidUUID(branchId)) {
    return { error: 'IDs inválidos' }
  }

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_barber_day_summary', {
    p_staff_id: staffId,
    p_branch_id: branchId,
  })

  if (error) return { error: error.message }

  // RPC retorna tabla — tomamos la primera fila.
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return {
      cuts: 0, revenue: 0, commission: 0, tips: 0,
      cash_total: 0, transfer_total: 0, card_total: 0, tips_cash: 0,
      opening_cash: 0, cash_expected: 0, avg_duration_minutes: 0,
    }
  }

  return {
    cuts: Number(row.cuts) || 0,
    revenue: Number(row.revenue) || 0,
    commission: Number(row.commission) || 0,
    tips: Number(row.tips) || 0,
    cash_total: Number(row.cash_total) || 0,
    transfer_total: Number(row.transfer_total) || 0,
    card_total: Number(row.card_total) || 0,
    tips_cash: Number(row.tips_cash) || 0,
    opening_cash: Number(row.opening_cash) || 0,
    cash_expected: Number(row.cash_expected) || 0,
    avg_duration_minutes: Number(row.avg_duration_minutes) || 0,
  }
}

export interface ShiftCloseResult {
  id: string
  cashExpected: number
  cashCounted: number | null
  cashDiff: number | null
  cuts: number
  revenue: number
}

/**
 * Cierra el turno del barbero autenticado. Idempotente por (staff, branch, date):
 * si se llama de nuevo el mismo día, hace upsert con los números actualizados.
 */
export async function closeBarberShift(formData: FormData): Promise<
  { success: true; data: ShiftCloseResult } | { error: string }
> {
  const session = await getBarberSession()
  if (!session) return { error: 'Sesión inválida' }

  const cashCountedRaw = formData.get('cash_counted') as string | null
  const notesRaw = formData.get('notes') as string | null

  const cashCounted = cashCountedRaw && cashCountedRaw.trim() !== ''
    ? Number(cashCountedRaw.replace(/[^0-9.-]/g, ''))
    : null
  if (cashCounted !== null && !Number.isFinite(cashCounted)) {
    return { error: 'Monto contado inválido' }
  }
  if (cashCounted !== null && cashCounted < 0) {
    return { error: 'El monto contado no puede ser negativo' }
  }

  const notes = notesRaw?.trim().slice(0, 1000) || null

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('close_barber_shift', {
    p_staff_id: session.staff_id,
    p_branch_id: session.branch_id,
    p_cash_counted: cashCounted,
    p_notes: notes,
  })

  if (error) return { error: 'Error al cerrar turno: ' + error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { error: 'Error: cierre no retornado' }

  revalidatePath('/barbero/cerrar-turno')
  revalidatePath('/barbero/fila')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/dashboard')

  return {
    success: true,
    data: {
      id: row.id,
      cashExpected: Number(row.cash_expected) || 0,
      cashCounted: row.cash_counted !== null && row.cash_counted !== undefined ? Number(row.cash_counted) : null,
      cashDiff: row.cash_diff !== null && row.cash_diff !== undefined ? Number(row.cash_diff) : null,
      cuts: Number(row.total_cuts) || 0,
      revenue: Number(row.total_revenue) || 0,
    },
  }
}

// ─── Admin: vuelto inicial por sucursal ───────────────────────────────────────

export async function setBranchOpeningCash(
  branchId: string,
  amount: number,
): Promise<{ success: true } | { error: string }> {
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Monto inválido' }

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('branches')
    .update({ default_opening_cash: amount })
    .eq('id', branchId)

  if (error) return { error: 'Error al guardar: ' + error.message }

  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard/caja')
  return { success: true }
}

// ─── Admin: cierres del día (caja) ────────────────────────────────────────────

export interface ShiftCloseRow {
  id: string
  staffId: string
  staffName: string
  branchId: string
  branchName: string
  localDate: string
  closedAt: string
  totalCuts: number
  openingCash: number
  cashTotal: number
  tipsCash: number
  cashExpected: number
  cashCounted: number | null
  cashDiff: number | null
  notes: string | null
}

export async function fetchShiftClosesForCaja(params: {
  branchId: string | null
  date: string
}): Promise<{ data: ShiftCloseRow[]; error: string | null }> {
  const { getCurrentOrgId } = await import('./org')
  const { getScopedBranchIds } = await import('./branch-access')

  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const orgBranchIds = await getScopedBranchIds()
  if (params.branchId && !orgBranchIds.includes(params.branchId)) {
    return { data: [], error: 'No autorizado para esta sucursal' }
  }
  const branchIds = params.branchId ? [params.branchId] : orgBranchIds
  if (branchIds.length === 0) return { data: [], error: null }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('shift_closes')
    .select(`
      id, staff_id, branch_id, local_date, closed_at,
      total_cuts, opening_cash, cash_expected, cash_counted, cash_diff,
      breakdown, notes,
      staff:staff!inner(full_name),
      branch:branches!inner(name)
    `)
    .eq('local_date', params.date)
    .in('branch_id', branchIds)
    .order('closed_at', { ascending: false })

  if (error) return { data: [], error: error.message }

  const rows: ShiftCloseRow[] = (data ?? []).map(r => {
    const staff = r.staff as unknown as { full_name: string }
    const branch = r.branch as unknown as { name: string }
    const breakdown = (r.breakdown ?? {}) as { cash_total?: number; tips_cash?: number }
    return {
      id: r.id,
      staffId: r.staff_id,
      staffName: staff.full_name,
      branchId: r.branch_id,
      branchName: branch.name,
      localDate: r.local_date,
      closedAt: r.closed_at,
      totalCuts: Number(r.total_cuts) || 0,
      openingCash: Number(r.opening_cash) || 0,
      cashTotal: Number(breakdown.cash_total) || 0,
      tipsCash: Number(breakdown.tips_cash) || 0,
      cashExpected: Number(r.cash_expected) || 0,
      cashCounted: r.cash_counted !== null && r.cash_counted !== undefined ? Number(r.cash_counted) : null,
      cashDiff: r.cash_diff !== null && r.cash_diff !== undefined ? Number(r.cash_diff) : null,
      notes: r.notes,
    }
  })

  return { data: rows, error: null }
}

export async function updateShiftCloseOpeningCash(
  shiftCloseId: string,
  openingCash: number,
): Promise<{ success: true } | { error: string }> {
  if (!isValidUUID(shiftCloseId)) return { error: 'ID inválido' }
  if (!Number.isFinite(openingCash) || openingCash < 0) return { error: 'Monto inválido' }

  const supabase = createAdminClient()
  const { data: existing, error: readErr } = await supabase
    .from('shift_closes')
    .select('id, branch_id, breakdown, cash_counted')
    .eq('id', shiftCloseId)
    .maybeSingle()

  if (readErr || !existing) return { error: 'Cierre no encontrado' }

  const orgAccess = await validateBranchAccess(existing.branch_id)
  if (!orgAccess) return { error: 'No autorizado' }

  const breakdown = (existing.breakdown ?? {}) as Record<string, unknown>
  const cashTotal = Number(breakdown.cash_total) || 0
  const tipsCash = Number(breakdown.tips_cash) || 0
  const newExpected = openingCash + cashTotal + tipsCash
  const cashCounted = existing.cash_counted !== null && existing.cash_counted !== undefined
    ? Number(existing.cash_counted)
    : null
  const newDiff = cashCounted === null ? null : cashCounted - newExpected

  const { error } = await supabase
    .from('shift_closes')
    .update({
      opening_cash: openingCash,
      cash_expected: newExpected,
      cash_diff: newDiff,
      breakdown: { ...breakdown, opening_cash: openingCash },
    })
    .eq('id', shiftCloseId)

  if (error) return { error: 'Error al actualizar: ' + error.message }

  revalidatePath('/dashboard/caja')
  return { success: true }
}
