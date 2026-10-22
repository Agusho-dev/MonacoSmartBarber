'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { revalidatePath } from 'next/cache'
import { getPeriodBoundsStr } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import { calcularResumenFinanciero, resumenFinancieroVacio } from '@/lib/finanzas-nucleo'
import { validateBranchAccess, getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'

export interface MonthlyFinancial {
  month: string
  label: string
  revenue: number
  commissions: number
  fixedExpenses: number
  variableExpenses: number
  bonuses: number
  advances: number
  salaryPayments: number
  baseSalaryPaid: number   // sueldos fijos y híbridos pagados (base_salary + hybrid_deficit)
  totalExpenses: number
  netProfit: number
  cuts: number
}

export interface BreakEvenData {
  cutsNeeded: number
  avgRevenuePerCut: number
  avgCommissionPerCut: number
  netPerCut: number
  monthlyFixedExpenses: number
}

export interface MoMChange {
  revenue: number | null        // % cambio vs mes anterior (null si sin dato previo)
  commissions: number | null
  variableExpenses: number | null
  netProfit: number | null
  cuts: number | null
  /**
   * true = el mes de referencia es el mes EN CURSO, o sea incompleto. Cuando es true, los
   * porcentajes de arriba comparan contra el MISMO TRAMO DE DÍAS del mes anterior, no contra
   * el mes anterior completo, y la UI tiene que decirlo.
   *
   * Antes se comparaba medio mes contra un mes entero: el 13/08/2026 la pantalla informaba
   * -50% de ingresos y -50% de cortes en Paraná cuando el like-for-like (1-13 ago vs 1-13 jul)
   * era +17,8% en las dos métricas. Le decía al dueño que se le cayó el negocio a la mitad
   * justo en su mejor mes.
   */
  isPartial: boolean
  daysElapsed: number
  daysInMonth: number
}

export interface BarberPerformance {
  staffId: string
  name: string
  revenue: number
  commissions: number
  netContribution: number  // revenue - commissions
  cuts: number
  avgTicket: number
  marginPct: number        // Math.round((netContribution / revenue) * 100), 0 si revenue=0
}

export interface ServiceRevenue {
  serviceId: string | null
  serviceName: string
  revenue: number
  cuts: number
  avgTicket: number
}

export interface FinancialSummary {
  months: MonthlyFinancial[]
  breakEven: BreakEvenData
  totals: {
    revenue: number
    commissions: number
    fixedExpenses: number
    variableExpenses: number
    bonuses: number          // desglose informativo: YA está dentro de salaryPayments
    advances: number         // desglose informativo: NO se suma ni se resta del neto
    salaryPayments: number
    /** Egresos del período. Es la suma de `months[].totalExpenses`, no una re-derivación. */
    totalExpenses: number
    netProfit: number
    cuts: number
  }
  // Campos adicionales para análisis comparativo y desglose
  momChange: MoMChange
  currentMonthCuts: number       // cortes del mes actual (último mes del array)
  currentMonthRevenue: number    // ingresos del mes actual
  barberPerformance: BarberPerformance[]
  serviceRevenue: ServiceRevenue[]
}

/** Fila mínima que necesita el gráfico "Egresos por categoría". */
export interface PeriodExpenseRow {
  category: string
  amount: number
  payment_account_id: string | null
  branch_id: string
  /**
   * `manual` | `fixed_expense_period` | `salary_batch` | `tip_batch`.
   *
   * El donut muestra TODA la plata que salió, así que necesita distinguir de dónde viene cada
   * peso: la tarjeta "Gastos variables" cuenta sólo `manual`, y sin este campo el donut decía
   * $27.769.880 al lado de una tarjeta de $23.934.865 sin ninguna forma de explicar la
   * diferencia.
   */
  source: string
}

/**
 * Egresos del período, para el gráfico por categoría del resumen.
 *
 * Existe porque ese gráfico se alimentaba de la lista de la pestaña "Egresos":
 * `.limit(100)` y SIN filtro de fecha. Sumaba todos los gastos desde el primer día
 * (en agosto seguía mostrando el alquiler de julio) y, pasados 100 tickets, los más
 * viejos desaparecían sin aviso. Acá el rango es el mismo del resto de la pantalla
 * y `fetchAll` drena todas las filas.
 */
export async function fetchExpensesByCategory(
  monthsBack: number,
  branchId?: string | null,
  endMonth?: string | null,
): Promise<PeriodExpenseRow[]> {
  const supabase = createAdminClient()

  let scopeBranchIds: string[]
  if (branchId) {
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return []
    scopeBranchIds = [branchId]
  } else {
    scopeBranchIds = await getScopedBranchIds()
    if (scopeBranchIds.length === 0) return []
  }

  const tz = await getActiveTimezone()
  const range = getPeriodBoundsStr(monthsBack, tz, endMonth)

  return fetchAll<PeriodExpenseRow>((from, to) => {
    let q = supabase
      .from('expense_tickets')
      .select('category, amount, payment_account_id, branch_id, source')
      .in('branch_id', scopeBranchIds)
    if (range) {
      q = q.gte('expense_date', range.start.slice(0, 10)).lte('expense_date', range.end.slice(0, 10))
    }
    // `id` desempata: muchos tickets comparten fecha, y sin un orden estable dos páginas
    // pueden repetir o saltear filas.
    return q.order('expense_date').order('id').range(from, to)
  }, { contexto: 'egresos por categoría' })
}

export async function fetchFinancialData(
  monthsBack: number,   // 0 = desde el primer registro histórico
  branchId?: string | null,
  endMonth?: string | null  // "YYYY-MM" — si se pasa, se usa como mes final en vez del actual
): Promise<FinancialSummary> {
  // El cálculo vive en `src/lib/finanzas-nucleo.ts`, compartido con Tex (`finanzas_pyl`).
  // Esta action resuelve el alcance desde la sesión y lo llama en modo NO estricto: ante una
  // lectura que falla, la pantalla sigue con lo que pudo leer y el error queda en el log.
  //
  // La validación del `branchId` es OBLIGATORIA: este archivo es `'use server'`, así que cada
  // export es un endpoint HTTP con un action-id que viaja en el bundle del cliente, y el núcleo
  // corre con service role. Sin este chequeo alcanzaría el UUID de una sucursal ajena para leer
  // las finanzas completas de otra organización.
  let sucursalesIds: string[]
  let orgId: string | null
  if (branchId) {
    orgId = await validateBranchAccess(branchId)
    if (!orgId) return resumenFinancieroVacio()
    sucursalesIds = [branchId]
  } else {
    orgId = await getCurrentOrgId()
    sucursalesIds = await getScopedBranchIds()
    if (sucursalesIds.length === 0) return resumenFinancieroVacio()
  }

  return calcularResumenFinanciero({
    monthsBack,
    sucursalesIds,
    unaSucursal: Boolean(branchId),
    orgId,
    endMonth,
    tz: await getActiveTimezone(),
    estricto: false,
  })
}

/* ─── Fixed Expenses CRUD ─── */

export async function getFixedExpenses(branchId?: string | null) {
  const supabase = await createClient()
  let q = supabase
    .from('fixed_expenses')
    .select('*, branch:branches(name)')
    .order('name')
  if (branchId) {
    q = q.eq('branch_id', branchId)
  } else {
    const orgBranchIds = await getScopedBranchIds()
    q = q.in('branch_id', orgBranchIds)
  }
  const { data } = await q
  return data ?? []
}

export async function upsertFixedExpense(data: {
  id?: string
  branch_id: string
  name: string
  category?: string | null
  amount: number
  due_day?: number | null   // día de vencimiento del mes
  is_active?: boolean
}) {
  // NOTA: duplicado MUERTO. El catálogo de gastos fijos usa las versiones vivas de
  // `fixed-expenses.ts` (createAdminClient). Estas dos (upsert/delete) no tienen callers.
  // Se dejan alineadas al patrón admin+validateBranchAccess por si alguna vez se re-wirean.
  const orgId = await validateBranchAccess(data.branch_id)
  if (!orgId) return { error: 'No tienes acceso a esta sucursal' }

  const supabase = createAdminClient()

  if (data.id) {
    // Validar la fila existente (no confiar en el branch del form) antes de update por id.
    const { data: existing } = await supabase
      .from('fixed_expenses')
      .select('branch_id')
      .eq('id', data.id)
      .maybeSingle()
    if (!existing) return { error: 'Gasto fijo no encontrado' }
    if (!(await validateBranchAccess(existing.branch_id))) return { error: 'No autorizado' }

    const { error } = await supabase
      .from('fixed_expenses')
      .update({
        name: data.name,
        category: data.category || null,
        amount: data.amount,
        due_day: data.due_day ?? null,
        is_active: data.is_active ?? true,
      })
      .eq('id', data.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('fixed_expenses').insert({
      branch_id: data.branch_id,
      name: data.name,
      category: data.category || null,
      amount: data.amount,
      due_day: data.due_day ?? null,
      is_active: data.is_active ?? true,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/finanzas')
  return { success: true }
}

export async function deleteFixedExpense(id: string) {
  // Duplicado MUERTO (ver upsertFixedExpense arriba): el catálogo usa fixed-expenses.ts.
  const supabase = createAdminClient()

  // Obtener el gasto para verificar a qué sucursal pertenece
  const { data: expense, error: fetchError } = await supabase
    .from('fixed_expenses')
    .select('branch_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    console.error('Error al obtener gasto fijo:', fetchError)
    return { error: 'Error al verificar el gasto fijo' }
  }
  if (!expense) return { error: 'Gasto fijo no encontrado' }

  // Validar que la sucursal del gasto pertenece a la organización del usuario
  const orgId = await validateBranchAccess(expense.branch_id)
  if (!orgId) return { error: 'No tienes acceso a esta sucursal' }

  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/finanzas')
  return { success: true }
}
