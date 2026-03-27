'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { SalaryScheme } from '@/lib/types/database'

// Tipos locales para las nuevas tablas (migración 037/044)
export type SalaryReportType = 'commission' | 'base_salary' | 'bonus' | 'advance' | 'hybrid_deficit'
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
  const supabase = await createClient()
  const { data } = await supabase
    .from('salary_configs')
    .select('*')
    .eq('staff_id', staffId)
    .single()
  return data
}

export async function upsertSalaryConfig(staffId: string, scheme: SalaryScheme, baseAmount: number, commissionPct: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('salary_configs')
    .upsert(
      { staff_id: staffId, scheme, base_amount: baseAmount, commission_pct: commissionPct },
      { onConflict: 'staff_id' }
    )
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

export async function calculateAndSaveSalary(staffId: string, periodStart: string, periodEnd: string) {
  const supabase = await createClient()

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
  const supabase = await createClient()
  const { error } = await supabase
    .from('salary_payments')
    .update({ is_paid: true, paid_at: new Date().toISOString(), notes: notes ?? null })
    .eq('id', paymentId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/sueldos')
  return { success: true }
}

export async function getSalaryHistory(branchId: string) {
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()
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
  const supabase = await createClient()

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

  const supabase = await createClient()

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
 * Genera un reporte de comisión calculando el total de visitas del día indicado.
 * Usa el commission_pct de salary_configs o, como fallback, el de staff.
 */
export async function generateCommissionReport(
  staffId: string,
  branchId: string,
  reportDate: string
) {
  if (!staffId || !branchId || !reportDate) {
    return { error: 'El barbero, la sucursal y la fecha son obligatorios.' }
  }

  const supabase = await createClient()

  // Sumar los montos de visitas completadas en el día indicado
  const { data: visits, error: visitsError } = await supabase
    .from('visits')
    .select('amount')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .gte('completed_at', `${reportDate}T00:00:00.000Z`)
    .lt('completed_at', `${reportDate}T23:59:59.999Z`)

  if (visitsError) {
    console.error('Error al obtener visitas para comisión:', visitsError)
    return { error: 'Error al calcular las comisiones del día.' }
  }

  const totalRevenue = (visits ?? []).reduce((sum, v) => sum + Number(v.amount), 0)

  if (totalRevenue === 0) {
    return { error: 'No hay comisiones para este día.' }
  }

  // Obtener el porcentaje de comisión desde salary_configs o desde staff como fallback
  const { data: salaryConfig } = await supabase
    .from('salary_configs')
    .select('commission_pct')
    .eq('staff_id', staffId)
    .single()

  let commissionPct: number

  if (salaryConfig?.commission_pct != null) {
    commissionPct = salaryConfig.commission_pct
  } else {
    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('commission_pct')
      .eq('id', staffId)
      .single()

    if (staffError || !staffData) {
      console.error('Error al obtener porcentaje de comisión del barbero:', staffError)
      return { error: 'Error al obtener la configuración de comisión del barbero.' }
    }

    commissionPct = staffData.commission_pct
  }

  const commissionAmount = totalRevenue * (commissionPct / 100)

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
  return { success: true, data: { commissionAmount, commissionPct, totalRevenue } }
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

  const supabase = await createClient()

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

  const supabase = await createClient()

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

  const supabase = await createClient()

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

  const supabase = await createClient()

  // Verificar que el reporte existe y está pendiente antes de eliminar
  const { data: report, error: fetchError } = await supabase
    .from('salary_reports')
    .select('id, status')
    .eq('id', reportId)
    .single()

  if (fetchError || !report) {
    return { error: 'Reporte no encontrado.' }
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

const TZ = 'America/Argentina/Buenos_Aires'

/**
 * Genera un reporte de comisión automáticamente al hacer checkout.
 * Busca el último clock_in del día, suma visitas entre entrada y salida,
 * y crea el salary_report correspondiente según el esquema del barbero.
 */
export async function generateCheckoutCommissionReport(
  staffId: string,
  branchId: string
) {
  const supabase = await createClient()

  // Fecha local de hoy en Argentina
  const now = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)

  // Buscar el último clock_in de hoy para determinar el inicio del turno
  const { data: clockInLog } = await supabase
    .from('attendance_logs')
    .select('created_at')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('action_type', 'clock_in')
    .gte('created_at', `${todayStr}T00:00:00.000Z`)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Si no hay clock_in hoy, usar inicio del día
  const shiftStart = clockInLog?.created_at ?? `${todayStr}T00:00:00.000Z`
  const shiftEnd = now.toISOString()

  // Verificar que no exista ya un reporte de comisión para este día
  const { count: existingCount } = await supabase
    .from('salary_reports')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('type', 'commission')
    .eq('report_date', todayStr)

  if (existingCount && existingCount > 0) {
    return { success: true, skipped: true }
  }

  // Sumar commission_amount de visitas en el turno
  const { data: visits } = await supabase
    .from('visits')
    .select('commission_amount')
    .eq('barber_id', staffId)
    .eq('branch_id', branchId)
    .gte('completed_at', shiftStart)
    .lte('completed_at', shiftEnd)

  const totalCommission = (visits ?? []).reduce(
    (sum, v) => sum + Number(v.commission_amount ?? 0), 0
  )

  if (totalCommission <= 0) {
    return { success: true, skipped: true, reason: 'Sin comisiones en el turno' }
  }

  // Obtener configuración salarial para registrar el esquema en las notas
  const { data: salaryConfig } = await supabase
    .from('salary_configs')
    .select('scheme')
    .eq('staff_id', staffId)
    .single()

  const scheme = salaryConfig?.scheme ?? 'commission'

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

  const supabase = await createClient()

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

  // Obtener comisiones pendientes del período
  const { data: pendingReports, error: reportsError } = await supabase
    .from('salary_reports')
    .select('id, amount')
    .eq('staff_id', staffId)
    .eq('branch_id', branchId)
    .eq('type', 'commission')
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

// ─── Consultas de comisiones para el dashboard de finanzas ──────────────────

/**
 * Obtiene el resumen de comisiones pagadas y pendientes para el dashboard.
 */
export async function getCommissionSummary(branchId?: string | null) {
  const supabase = await createClient()

  let pendingQuery = supabase
    .from('salary_reports')
    .select('amount, staff_id')
    .eq('type', 'commission')
    .eq('status', 'pending')

  let paidQuery = supabase
    .from('salary_reports')
    .select('amount, staff_id')
    .eq('type', 'commission')
    .eq('status', 'paid')

  if (branchId) {
    pendingQuery = pendingQuery.eq('branch_id', branchId)
    paidQuery = paidQuery.eq('branch_id', branchId)
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
