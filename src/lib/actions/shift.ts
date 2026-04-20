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
      cash_expected: 0, avg_duration_minutes: 0,
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
