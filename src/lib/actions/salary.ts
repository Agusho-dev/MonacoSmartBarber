'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { SalaryScheme } from '@/lib/types/database'
import { validateBranchAccess, getCurrentOrgId } from './org'
import { getActiveTimezone } from '@/lib/i18n'

// Tipos locales para las nuevas tablas (migración 037/044)
export type SalaryReportType = 'commission' | 'base_salary' | 'bonus' | 'advance' | 'hybrid_deficit' | 'product_commission'
export type SalaryReportStatus = 'pending' | 'paid'

export interface SalaryReport {
  id: string
  staff_id: string
  branch_id: string
  type: SalaryReportType
  amount: number
  notes: string | null
  report_date: string
  period_start: string | null
  period_end: string | null
  status: SalaryReportStatus
  batch_id: string | null
  created_at: string
  updated_at: string
}

export interface SalaryPaymentBatch {
  id: string
  staff_id: string
  branch_id: string
  total_amount: number
  paid_at: string
  notes: string | null
  created_at: string
}

// ─── Acciones originales (sin cambios) ───────────────────────────────────────

export async function getSalaryConfig(staffId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null

  const supabase = createAdminClient()

  // Verificar que el barbero pertenece a la organización
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!staffRow) return null

  const { data } = await supabase
    .from('salary_configs')
    .select('*')
    .eq('staff_id', staffId)
    .single()
  return data
}

export async function upsertSalaryConfig(staffId: string, scheme: SalaryScheme, baseAmount: number, commissionPct: number) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  // Usar admin client para evitar bloqueo por RLS en salary_configs
  const supabase = createAdminClient()

  // Verificar que el barbero pertenece a la organización
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!staffRow) return { error: 'No autorizado' }

  const { error } = await supabase
    .from('salary_configs')
    .upsert(
      { staff_id: staffId, scheme, base_amount: baseAmount, commission_pct: commissionPct },
      { onConflict: 'staff_id' }
    )
  if (error) return { error: error.message }

  // Sincronizar staff.commission_pct para mantener compatibilidad con triggers de visits
  await supabase
    .from('staff')
    .update({ commission_pct: commissionPct })
    .eq('id', staffId)

  revalidatePath('/dashboard/sueldos')
  revalidatePath('/dashboard/barberos')
  revalidatePath('/dashboard/finanzas')
  return { success: true }
}

export async function calculateAndSaveSalary(staffId: string, periodStart: string, periodEnd: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que el barbero pertenece a la organización
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!staffRow) return { error: 'No autorizado' }

  const { data: amount } = await supabase.rpc('calculate_barber_salary', {
    p_staff_id: staffId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })

  const { data, error } = await supabase
    .from('salary_payments')
    .insert({
      staff_id: staffId,
      period_start: periodStart,
      period_end: periodEnd,
      calculated_amount: amount ?? 0,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true, paymentId: data.id, calculatedAmount: amount ?? 0 }
}

export async function markSalaryAsPaid(paymentId: string, notes?: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que el pago pertenece a la organización a través del staff
  const { data: payment } = await supabase
    .from('salary_payments')
    .select('id, staff:staff(organization_id)')
    .eq('id', paymentId)
    .maybeSingle()
  const staffOrg = payment?.staff as unknown as { organization_id: string | null } | null
  if (!payment || staffOrg?.organization_id !== orgId) {
    return { error: 'No autorizado' }
  }

  const { error } = await supabase
    .from('salary_payments')
    .update({ is_paid: true, paid_at: new Date().toISOString(), notes: notes ?? null })
    .eq('id', paymentId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

export async function getSalaryHistory(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('salary_payments')
    .select('*, staff:staff(id, full_name, branch_id)')
    .order('period_start', { ascending: false })

  const filtered = (data ?? []).filter(
    (p) => (p.staff as { branch_id: string | null } | null)?.branch_id === branchId
  )
  return { data: filtered, error }
}

export async function getAllBarbersWithSalaryConfig(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, commission_pct, salary_configs(*)')
    .eq('branch_id', branchId)
    .eq('role', 'barber')
    .eq('is_active', true)
    .order('full_name')
  return { data: data ?? [], error }
}

export async function previewSalary(staffId: string, periodStart: string, periodEnd: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { amount: 0 }

  const supabase = createAdminClient()

  // Verificar que el barbero pertenece a la organización
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!staffRow) return { amount: 0 }

  const { data: amount } = await supabase.rpc('calculate_barber_salary', {
    p_staff_id: staffId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  return { amount: amount ?? 0 }
}

// ─── Nuevas acciones (modelo de reportes — migración 037) ─────────────────────

/**
 * Obtiene los reportes pendientes de un barbero en una sucursal,
 * ordenados por fecha descendente.
 */
export async function getSalaryReports(staffId: string, branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('salary_reports')
    .select('*')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('status', 'pending')
    .order('report_date', { ascending: false })

  if (error) {
    console.error('Error al obtener reportes de sueldo:', error)
    return { error: 'Error al obtener los reportes pendientes.' }
  }

  return { success: true, data: data as SalaryReport[] }
}

/**
 * Crea un reporte manual de tipo 'bonus' o 'advance'.
 * Los adelantos se guardan con monto negativo.
 */
export async function createManualSalaryReport(
  staffId: string,
  branchId: string,
  type: 'bonus' | 'advance',
  amount: number,
  notes: string,
  reportDate: string
) {
  if (!staffId || !branchId) {
    return { error: 'El barbero y la sucursal son obligatorios.' }
  }
  if (!amount || amount <= 0) {
    return { error: 'El monto debe ser mayor a cero.' }
  }
  if (!notes || notes.trim().length === 0) {
    return { error: 'Las notas son obligatorias para reportes manuales.' }
  }
  if (!reportDate) {
    return { error: 'La fecha del reporte es obligatoria.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Los adelantos se registran como monto negativo
  const finalAmount = type === 'advance' ? -Math.abs(amount) : Math.abs(amount)

  const { error } = await supabase
    .from('salary_reports')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      type,
      amount: finalAmount,
      notes: notes.trim(),
      report_date: reportDate,
      status: 'pending',
    })

  if (error) {
    console.error('Error al crear reporte manual:', error)
    return { error: 'Error al crear el reporte.' }
  }

  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

/**
 * Genera un reporte de comisión sumando commission_amount de visitas del día.
 * Usa la comisión ya calculada en cada visita (fuente de verdad desde completeService).
 */
export async function generateCommissionReport(
  staffId: string,
  branchId: string,
  reportDate: string
) {
  if (!staffId || !branchId || !reportDate) {
    return { error: 'El barbero, la sucursal y la fecha son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que no exista ya un reporte de comisión para este día
  const { count: existingCount } = await supabase
    .from('salary_reports')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('type', 'commission')
    .eq('report_date', reportDate)

  if (existingCount && existingCount > 0) {
    return { error: 'Ya existe un reporte de comisión para este día.' }
  }

  // Sumar commission_amount de visitas completadas en el día (fuente de verdad)
  const tz = await getActiveTimezone()
  const { getDayBounds } = await import('@/lib/time-utils')
  const { start: dayStart, end: dayEnd } = getDayBounds(reportDate, tz)
  const { data: visits, error: visitsError } = await supabase
    .from('visits')
    .select('commission_amount, amount')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .gte('completed_at', dayStart)
    .lt('completed_at', dayEnd)

  if (visitsError) {
    console.error('Error al obtener visitas para comisión:', visitsError)
    return { error: 'Error al calcular las comisiones del día.' }
  }

  const commissionAmount = (visits ?? []).reduce((sum, v) => sum + Number(v.commission_amount ?? 0), 0)
  const totalRevenue = (visits ?? []).reduce((sum, v) => sum + Number(v.amount), 0)

  if (commissionAmount <= 0) {
    return { error: 'No hay comisiones para este día.' }
  }

  const { error: insertError } = await supabase
    .from('salary_reports')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      type: 'commission',
      amount: commissionAmount,
      notes: null,
      report_date: reportDate,
      status: 'pending',
    })

  if (insertError) {
    console.error('Error al insertar reporte de comisión:', insertError)
    return { error: 'Error al guardar el reporte de comisión.' }
  }

  revalidatePath('/dashboard/sueldos')
  return { success: true, data: { commissionAmount, totalRevenue } }
}

/**
 * Genera un reporte de sueldo base para un período dado.
 * Solo aplicable a esquemas 'fixed' o 'hybrid'.
 */
export async function generateBaseSalaryReport(
  staffId: string,
  branchId: string,
  periodStart: string,
  periodEnd: string
) {
  if (!staffId || !branchId || !periodStart || !periodEnd) {
    return { error: 'El barbero, la sucursal y el período son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: salaryConfig, error: configError } = await supabase
    .from('salary_configs')
    .select('base_amount, scheme')
    .eq('staff_id', staffId)
    .single()

  if (configError || !salaryConfig) {
    return { error: 'No se encontró configuración salarial para este barbero.' }
  }

  if (salaryConfig.scheme === 'commission') {
    return { error: 'Este barbero tiene esquema de comisión pura, no tiene sueldo base.' }
  }

  if (!salaryConfig.base_amount || salaryConfig.base_amount <= 0) {
    return { error: 'El monto base configurado no es válido.' }
  }

  const { error: insertError } = await supabase
    .from('salary_reports')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      type: 'base_salary',
      amount: salaryConfig.base_amount,
      notes: null,
      report_date: periodEnd,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'pending',
    })

  if (insertError) {
    console.error('Error al insertar reporte de sueldo base:', insertError)
    return { error: 'Error al guardar el reporte de sueldo base.' }
  }

  revalidatePath('/dashboard/sueldos')
  return { success: true, data: { baseAmount: salaryConfig.base_amount } }
}

/**
 * Paga los reportes seleccionados creando un lote de pago (batch).
 * Suma los montos, inserta el batch y marca los reportes como pagados.
 */
export async function paySelectedReports(
  reportIds: string[],
  staffId: string,
  branchId: string,
  notes?: string
) {
  if (!reportIds || reportIds.length === 0) {
    return { error: 'Debe seleccionar al menos un reporte para pagar.' }
  }
  if (!staffId || !branchId) {
    return { error: 'El barbero y la sucursal son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Buscar los reportes seleccionados para calcular el total
  const { data: reports, error: reportsError } = await supabase
    .from('salary_reports')
    .select('id, amount, status')
    .in('id', reportIds)
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)

  if (reportsError || !reports) {
    console.error('Error al obtener reportes para pago:', reportsError)
    return { error: 'Error al obtener los reportes seleccionados.' }
  }

  // Verificar que todos los reportes encontrados estén pendientes
  const nonPending = reports.filter((r) => r.status !== 'pending')
  if (nonPending.length > 0) {
    return { error: 'Algunos reportes seleccionados ya fueron pagados.' }
  }

  // Verificar que se encontraron todos los IDs solicitados
  if (reports.length !== reportIds.length) {
    return { error: 'Algunos reportes no se encontraron o no pertenecen a este barbero.' }
  }

  const totalAmount = reports.reduce((sum, r) => sum + Number(r.amount), 0)

  // Insertar el lote de pago
  const { data: batch, error: batchError } = await supabase
    .from('salary_payment_batches')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      total_amount: totalAmount,
      paid_at: new Date().toISOString(),
      notes: notes ?? null,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    console.error('Error al crear lote de pago:', batchError)
    return { error: 'Error al registrar el pago.' }
  }

  // Marcar los reportes como pagados y asociarlos al batch
  const { error: updateError } = await supabase
    .from('salary_reports')
    .update({ status: 'paid', batch_id: batch.id })
    .in('id', reportIds)

  if (updateError) {
    console.error('Error al marcar reportes como pagados:', updateError)
    return { error: 'El pago fue registrado pero hubo un error al actualizar los reportes.' }
  }

  revalidatePath('/dashboard/sueldos')
  return { success: true, data: { batchId: batch.id, totalAmount } }
}

/**
 * Obtiene el historial de lotes de pago de un barbero con sus reportes asociados.
 */
export async function getPaymentBatches(staffId: string, branchId: string) {
  if (!staffId || !branchId) {
    return { error: 'El barbero y la sucursal son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: batches, error: batchesError } = await supabase
    .from('salary_payment_batches')
    .select('*')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .order('paid_at', { ascending: false })

  if (batchesError) {
    console.error('Error al obtener lotes de pago:', batchesError)
    return { error: 'Error al obtener el historial de pagos.' }
  }

  if (!batches || batches.length === 0) {
    return { success: true, data: [] }
  }

  // Obtener los reportes asociados a cada batch en una sola consulta
  const batchIds = batches.map((b) => b.id)
  const { data: reports, error: reportsError } = await supabase
    .from('salary_reports')
    .select('*')
    .in('batch_id', batchIds)
    .order('report_date', { ascending: false })

  if (reportsError) {
    console.error('Error al obtener reportes de los lotes:', reportsError)
    return { error: 'Error al obtener el detalle de los pagos.' }
  }

  // Agrupar los reportes por batch_id
  const reportsByBatch = (reports ?? []).reduce<Record<string, SalaryReport[]>>((acc, report) => {
    const r = report as SalaryReport
    if (!acc[r.batch_id!]) acc[r.batch_id!] = []
    acc[r.batch_id!].push(r)
    return acc
  }, {})

  const result = (batches as SalaryPaymentBatch[]).map((batch) => ({
    batch,
    reports: reportsByBatch[batch.id] ?? [],
  }))

  return { success: true, data: result }
}

/**
 * Elimina un reporte salarial, solo si su estado es 'pending'.
 */
export async function deleteSalaryReport(reportId: string) {
  if (!reportId) {
    return { error: 'El ID del reporte es obligatorio.' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Verificar que el reporte existe, está pendiente y pertenece a la organización
  const { data: report, error: fetchError } = await supabase
    .from('salary_reports')
    .select('id, status, staff:staff(organization_id)')
    .eq('id', reportId)
    .single()

  if (fetchError || !report) {
    return { error: 'Reporte no encontrado.' }
  }

  if ((report.staff as unknown as { organization_id: string | null } | null)?.organization_id !== orgId) {
    return { error: 'No autorizado' }
  }

  if (report.status !== 'pending') {
    return { error: 'Solo se pueden eliminar reportes con estado pendiente.' }
  }

  const { error: deleteError } = await supabase
    .from('salary_reports')
    .delete()
    .eq('id', reportId)

  if (deleteError) {
    console.error('Error al eliminar reporte:', deleteError)
    return { error: 'Error al eliminar el reporte.' }
  }

  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

// ─── Generación automática al checkout ──────────────────────────────────────

/**
 * Genera un reporte de comisión automáticamente al hacer checkout.
 * Busca el último clock_in del día, suma visitas entre entrada y salida,
 * y crea el salary_report correspondiente según el esquema del barbero.
 */
export async function generateCheckoutCommissionReport(
  staffId: string,
  branchId: string
) {
  // Validar staff+branch+org cruzado antes de cualquier query
  const orgId = await getCurrentOrgId()
  if (!orgId) return

  const supabase = createAdminClient()

  const { data: staffCheck } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('branch_id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!staffCheck) return

  // Fecha local de hoy en el TZ de la org
  const tz = await getActiveTimezone()
  const now = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)

  const { getDayBounds } = await import('@/lib/time-utils')
  const { start: dayStart, end: dayEnd } = getDayBounds(todayStr, tz)

  // Buscar el último clock_in de hoy para determinar el inicio del turno
  const { data: clockInLog } = await supabase
    .from('attendance_logs')
    .select('created_at')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('action_type', 'clock_in')
    .gte('created_at', dayStart)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Si no hay clock_in hoy, usar inicio del día
  const shiftStart = clockInLog?.created_at ?? dayStart
  const shiftEnd = now.toISOString()

  // Sumar commission_amount de TODAS las visitas del día completo
  // (no solo del turno, para incluir ventas directas de productos)
  const { data: visits } = await supabase
    .from('visits')
    .select('commission_amount')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .gte('completed_at', dayStart)
    .lt('completed_at', dayEnd)

  const totalCommission = (visits ?? []).reduce(
    (sum, v) => sum + Number(v.commission_amount ?? 0), 0
  )

  if (totalCommission <= 0) {
    return { success: true, skipped: true, reason: 'Sin comisiones en el día' }
  }

  // Obtener configuración salarial para registrar el esquema en las notas
  const { data: salaryConfig } = await supabase
    .from('salary_configs')
    .select('scheme')
    .eq('staff_id', staffId)
    .single()

  const scheme = salaryConfig?.scheme ?? 'commission'

  // Verificar si ya existe un reporte de comisión para hoy (puede venir de venta de productos)
  const { data: existingReport } = await supabase
    .from('salary_reports')
    .select('id, amount')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('type', 'commission')
    .eq('report_date', todayStr)
    .eq('status', 'pending')
    .maybeSingle()

  if (existingReport) {
    // Actualizar el reporte existente con el total real del día
    if (Math.round(Number(existingReport.amount)) === Math.round(totalCommission)) {
      return { success: true, skipped: true }
    }
    const { error: updateError } = await supabase
      .from('salary_reports')
      .update({
        amount: totalCommission,
        notes: `Generado automáticamente al checkout (${scheme})`,
        period_start: shiftStart,
        period_end: shiftEnd,
      })
      .eq('id', existingReport.id)

    if (updateError) {
      console.error('Error al actualizar reporte de comisión:', updateError)
      return { error: updateError.message }
    }
    return { success: true, data: { totalCommission, scheme, updated: true } }
  }

  // No existe reporte para hoy, crear uno nuevo
  const { error: insertError } = await supabase
    .from('salary_reports')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      type: 'commission',
      amount: totalCommission,
      notes: `Generado automáticamente al checkout (${scheme})`,
      report_date: todayStr,
      period_start: shiftStart,
      period_end: shiftEnd,
      status: 'pending',
    })

  if (insertError) {
    console.error('Error al insertar reporte de comisión automático:', insertError)
    return { error: insertError.message }
  }

  return { success: true, data: { totalCommission, scheme } }
}

// ─── Liquidación de período híbrido ─────────────────────────────────────────

/**
 * Liquida un período para un barbero con esquema híbrido.
 * - Si las comisiones >= sueldo base → paga comisiones (limpias para el barbero)
 * - Si las comisiones < sueldo base → paga sueldo fijo + registra déficit
 * Cada período arranca en cero, sin acumulación de déficit.
 */
export async function settleHybridPeriod(
  staffId: string,
  branchId: string,
  periodStart: string,
  periodEnd: string,
  notes?: string
) {
  if (!staffId || !branchId || !periodStart || !periodEnd) {
    return { error: 'El barbero, la sucursal y el período son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  // Obtener configuración salarial
  const { data: salaryConfig, error: configError } = await supabase
    .from('salary_configs')
    .select('scheme, base_amount, commission_pct')
    .eq('staff_id', staffId)
    .single()

  if (configError || !salaryConfig) {
    return { error: 'No se encontró configuración salarial para este barbero.' }
  }

  if (salaryConfig.scheme !== 'hybrid') {
    return { error: 'Esta acción solo aplica a barberos con esquema híbrido.' }
  }

  const baseAmount = salaryConfig.base_amount ?? 0
  if (baseAmount <= 0) {
    return { error: 'El monto base configurado no es válido.' }
  }

  // Obtener comisiones pendientes del período (servicio + producto)
  const { data: pendingReports, error: reportsError } = await supabase
    .from('salary_reports')
    .select('id, amount')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .in('type', ['commission', 'product_commission'])
    .eq('status', 'pending')
    .gte('report_date', periodStart)
    .lte('report_date', periodEnd)

  if (reportsError) {
    return { error: 'Error al obtener comisiones del período.' }
  }

  const totalCommissions = (pendingReports ?? []).reduce(
    (sum, r) => sum + Number(r.amount), 0
  )
  const reportIds = (pendingReports ?? []).map(r => r.id)

  const exceededBase = totalCommissions >= baseAmount
  const paymentAmount = exceededBase ? totalCommissions : baseAmount
  const deficit = exceededBase ? 0 : baseAmount - totalCommissions

  // Crear batch de pago
  const { data: batch, error: batchError } = await supabase
    .from('salary_payment_batches')
    .insert({
      staff_id: staffId,
      branch_id: branchId,
      total_amount: paymentAmount,
      paid_at: new Date().toISOString(),
      notes: notes ?? (exceededBase
        ? `Híbrido: comisiones superaron base ($${totalCommissions} >= $${baseAmount})`
        : `Híbrido: se pagó sueldo fijo (comisiones $${totalCommissions} < base $${baseAmount})`),
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return { error: 'Error al crear el lote de pago.' }
  }

  // Marcar comisiones como pagadas
  if (reportIds.length > 0) {
    await supabase
      .from('salary_reports')
      .update({ status: 'paid', batch_id: batch.id })
      .in('id', reportIds)
  }

  // Si no llegó al base, registrar el sueldo base y el déficit
  if (!exceededBase) {
    await supabase
      .from('salary_reports')
      .insert([
        {
          staff_id: staffId,
          branch_id: branchId,
          type: 'base_salary' as const,
          amount: baseAmount,
          notes: `Sueldo fijo aplicado — comisiones no alcanzaron el piso`,
          report_date: periodEnd,
          period_start: periodStart,
          period_end: periodEnd,
          status: 'paid' as const,
          batch_id: batch.id,
        },
        {
          staff_id: staffId,
          branch_id: branchId,
          type: 'hybrid_deficit' as const,
          amount: deficit,
          notes: `Diferencia entre sueldo fijo ($${baseAmount}) y comisiones ($${totalCommissions})`,
          report_date: periodEnd,
          period_start: periodStart,
          period_end: periodEnd,
          status: 'paid' as const,
          batch_id: batch.id,
        },
      ])
  }

  revalidatePath('/dashboard/sueldos')
  revalidatePath('/dashboard/finanzas')

  return {
    success: true,
    data: {
      batchId: batch.id,
      paymentAmount,
      totalCommissions,
      baseAmount,
      exceededBase,
      deficit,
    }
  }
}

// ─── Historial de pagos agrupado por mes/semana ─────────────────────────────

export interface GroupedBatchWeek {
  weekLabel: string
  weekStart: string
  batches: { batch: SalaryPaymentBatch; reports: SalaryReport[] }[]
}

export interface GroupedBatchMonth {
  monthKey: string
  monthLabel: string
  weeks: GroupedBatchWeek[]
  totalAmount: number
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d.toISOString().slice(0, 10)
}

const MONTH_NAMES: Record<string, string> = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
}

/**
 * Obtiene el historial de pagos agrupado por mes y semana.
 * Útil tanto para la sección de sueldos como para perfiles de barberos.
 */
export async function getPaymentBatchesGrouped(staffId: string, branchId: string): Promise<{
  error?: string
  data?: GroupedBatchMonth[]
}> {
  if (!staffId || !branchId) {
    return { error: 'El barbero y la sucursal son obligatorios.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()

  const { data: batches, error: batchesError } = await supabase
    .from('salary_payment_batches')
    .select('*')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .order('paid_at', { ascending: false })

  if (batchesError) {
    return { error: 'Error al obtener el historial de pagos.' }
  }

  if (!batches || batches.length === 0) {
    return { data: [] }
  }

  const batchIds = batches.map((b) => b.id)
  const { data: reports } = await supabase
    .from('salary_reports')
    .select('*')
    .in('batch_id', batchIds)
    .order('report_date', { ascending: false })

  const reportsByBatch = (reports ?? []).reduce<Record<string, SalaryReport[]>>((acc, report) => {
    const r = report as SalaryReport
    if (!acc[r.batch_id!]) acc[r.batch_id!] = []
    acc[r.batch_id!].push(r)
    return acc
  }, {})

  // Agrupar por mes → semana
  const monthMap = new Map<string, Map<string, { batch: SalaryPaymentBatch; reports: SalaryReport[] }[]>>()

  for (const batch of batches as SalaryPaymentBatch[]) {
    const paidDate = new Date(batch.paid_at)
    const monthKey = batch.paid_at.slice(0, 7) // YYYY-MM
    const weekStart = getWeekStart(paidDate)

    if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map())
    const weekMap = monthMap.get(monthKey)!
    if (!weekMap.has(weekStart)) weekMap.set(weekStart, [])
    weekMap.get(weekStart)!.push({ batch, reports: reportsByBatch[batch.id] ?? [] })
  }

  const result: GroupedBatchMonth[] = [...monthMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, weekMap]) => {
      const [y, m] = monthKey.split('-')
      const weeks: GroupedBatchWeek[] = [...weekMap.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([weekStart, weekBatches]) => {
          const ws = new Date(weekStart + 'T12:00')
          const weekNum = getISOWeekNumber(ws)
          return {
            weekLabel: `Semana ${weekNum}`,
            weekStart,
            batches: weekBatches,
          }
        })
      const totalAmount = weeks.reduce(
        (sum, w) => sum + w.batches.reduce((s, b) => s + b.batch.total_amount, 0), 0
      )
      return {
        monthKey,
        monthLabel: `${MONTH_NAMES[m] ?? m} ${y}`,
        weeks,
        totalAmount,
      }
    })

  return { data: result }
}

// ─── Consultas de comisiones para el dashboard de finanzas ──────────────────

/**
 * Obtiene el resumen de comisiones pagadas y pendientes para el dashboard.
 */
export async function getCommissionSummary(branchId?: string | null) {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    return {
      totalPending: 0,
      totalPaid: 0,
      pendingCount: 0,
      paidCount: 0,
      pendingByBarber: [],
    }
  }

  const supabase = createAdminClient()

  let pendingQuery = supabase
    .from('salary_reports')
    .select('amount, staff_id')
    .in('type', ['commission', 'product_commission'])
    .eq('status', 'pending')

  let paidQuery = supabase
    .from('salary_reports')
    .select('amount, staff_id')
    .in('type', ['commission', 'product_commission'])
    .eq('status', 'paid')

  if (branchId) {
    // Validar que el branch pertenece a la org antes de filtrar
    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branchId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!branch) {
      return {
        totalPending: 0,
        totalPaid: 0,
        pendingCount: 0,
        paidCount: 0,
        pendingByBarber: [],
      }
    }
    pendingQuery = pendingQuery.eq('branch_id', branchId)
    paidQuery = paidQuery.eq('branch_id', branchId)
  } else {
    // Sin branchId específico: limitar a los branches de la org
    const { data: orgBranches } = await supabase
      .from('branches')
      .select('id')
      .eq('organization_id', orgId)
    const orgBranchIds = orgBranches?.map(b => b.id) ?? []
    if (orgBranchIds.length > 0) {
      pendingQuery = pendingQuery.in('branch_id', orgBranchIds)
      paidQuery = paidQuery.in('branch_id', orgBranchIds)
    }
  }

  const [{ data: pending }, { data: paid }] = await Promise.all([
    pendingQuery,
    paidQuery,
  ])

  const totalPending = (pending ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const totalPaid = (paid ?? []).reduce((s, r) => s + Number(r.amount), 0)

  // Agrupar pendientes por barbero
  const byBarber = new Map<string, number>()
  for (const r of pending ?? []) {
    byBarber.set(r.staff_id, (byBarber.get(r.staff_id) ?? 0) + Number(r.amount))
  }

  return {
    totalPending,
    totalPaid,
    pendingCount: pending?.length ?? 0,
    paidCount: paid?.length ?? 0,
    pendingByBarber: Array.from(byBarber.entries()).map(([staffId, amount]) => ({
      staffId,
      amount,
    })),
  }
}
