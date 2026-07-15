'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { revalidatePath } from 'next/cache'
import { getLocalDayBounds } from '@/lib/time-utils'
import { validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import type { TransferAccountState } from '@/lib/payment-accounts'

/**
 * Cuentas de cobro (migración 160).
 *
 * El ingreso de una cuenta SIEMPRE se deriva de `transfer_logs`, que la DB mantiene
 * como proyección exacta de las visitas cobradas por transferencia (trigger
 * `trg_visits_sync_transfer_log`). No hay contador denormalizado: el que había
 * (`accumulated_today` + RPC `increment_account_accumulated`) nunca escribió un peso
 * —la RPC fallaba siempre con 42702— y por eso la rotación por tope nunca funcionó.
 *
 * Ingreso de la cuenta = cobro (`amount`) + propina transferida (`tip_amount`).
 * Los sueldos/gastos pagados DESDE la cuenta son egresos: bajan el saldo, NO consumen
 * el tope (decisión del dueño, 14/jul/2026).
 */

const TRANSFER_INCOME_COLUMNS = 'payment_account_id, amount, tip_amount'

type AccountAmountRow = { payment_account_id: string; amount: number; tip_amount: number | null }

function incomeOf(rows: AccountAmountRow[], accountId: string): number {
  return rows
    .filter((t) => t.payment_account_id === accountId)
    .reduce((sum, t) => sum + Number(t.amount) + Number(t.tip_amount ?? 0), 0)
}

export async function getPaymentAccounts(branchId: string) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado', data: null }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('branch_id', branchId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { error: error.message, data: null }
  return { data, error: null }
}

/**
 * Acumulado del mes en curso de cada cuenta (activas e inactivas) de las sucursales
 * visibles para el usuario. Lo calcula la DB en la TZ de cada sucursal.
 */
export async function getPaymentAccountsMonthIncome(): Promise<
  Record<string, { monthIncome: number; monthCount: number }>
> {
  const branchIds = await getScopedBranchIds()
  if (branchIds.length === 0) return {}

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_payment_accounts_month_income', {
    p_branch_ids: branchIds,
  })

  if (error) {
    console.error('[getPaymentAccountsMonthIncome]', error.message)
    return {}
  }

  const map: Record<string, { monthIncome: number; monthCount: number }> = {}
  for (const row of (data ?? []) as Array<{
    account_id: string
    month_income: number
    month_count: number
  }>) {
    map[row.account_id] = {
      monthIncome: Number(row.month_income ?? 0),
      monthCount: Number(row.month_count ?? 0),
    }
  }
  return map
}

/**
 * Estado de las cuentas ACTIVAS de una sucursal (la que recibe el cobro sale de
 * `pickTransferAccount`). La tablet del barbero llama a la misma RPC directo desde
 * el browser: corre con rol anon (el panel se autentica por PIN, no por Supabase Auth).
 */
export async function getTransferAccountsState(branchId: string): Promise<TransferAccountState[]> {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_transfer_accounts_state', {
    p_branch_id: branchId,
  })

  if (error) {
    console.error('[getTransferAccountsState]', error.message)
    return []
  }

  return ((data ?? []) as TransferAccountState[]).map((a) => ({
    ...a,
    monthly_limit: a.monthly_limit != null ? Number(a.monthly_limit) : null,
    month_income: Number(a.month_income ?? 0),
  }))
}

export async function upsertPaymentAccount(formData: FormData) {
  const supabase = createAdminClient()
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const aliasOrCbu = (formData.get('alias_or_cbu') as string | null)?.trim() || null
  const monthlyLimitStr = formData.get('monthly_limit') as string | null
  const sortOrderStr = formData.get('sort_order') as string | null
  const isActiveStr = formData.get('is_active') as string | null
  const isSalaryAccountStr = formData.get('is_salary_account') as string | null

  const monthlyLimit = monthlyLimitStr && monthlyLimitStr !== '' ? Number(monthlyLimitStr) : null
  const sortOrder = sortOrderStr && sortOrderStr !== '' ? Number(sortOrderStr) : 0
  const isActive = isActiveStr !== null ? isActiveStr === 'true' : true
  const isSalaryAccount = isSalaryAccountStr === 'true'

  if (!branchId || !name) return { error: 'Nombre y sucursal son obligatorios' }
  // Tope null = sin tope. Tope 0 sería contradictorio (la cuenta nace "llena" y nunca
  // rota): lo rechazamos para que el único "sin tope" sea vacío/null.
  if (monthlyLimit !== null && (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0)) {
    return { error: 'El tope mensual tiene que ser mayor a cero. Dejalo vacío si la cuenta no tiene tope.' }
  }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  // Mover una cuenta que ya cobró a otra sucursal reescribe el pasado: las visitas viejas
  // quedan imputadas a una cuenta que "pertenece" a otra sucursal, y el tope del mes se
  // mide donde no corresponde. Ya pasó una vez (810 visitas de Paraná, $13,27M, quedaron
  // colgadas de una cuenta que terminó en otra sucursal). Si tiene historial, no se mueve.
  if (id) {
    const { data: current } = await supabase
      .from('payment_accounts')
      .select('branch_id')
      .eq('id', id)
      .maybeSingle()

    if (current && current.branch_id !== branchId) {
      const { count } = await supabase
        .from('transfer_logs')
        .select('id', { count: 'exact', head: true })
        .eq('payment_account_id', id)

      if (count && count > 0) {
        return {
          error:
            'Esta cuenta ya tiene cobros registrados, así que no se puede cambiar de sucursal (descuadraría el historial). Creá una cuenta nueva en la otra sucursal y desactivá esta.',
        }
      }
    }
  }

  const payload = {
    branch_id: branchId,
    name,
    alias_or_cbu: aliasOrCbu,
    monthly_limit: monthlyLimit,
    sort_order: sortOrder,
    is_active: isActive,
    is_salary_account: isSalaryAccount,
  }

  const { error } = id
    ? await supabase.from('payment_accounts').update(payload).eq('id', id)
    : await supabase.from('payment_accounts').insert(payload)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/cuentas')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/caja')
  return { success: true }
}

export async function togglePaymentAccount(id: string, isActive: boolean) {
  const supabase = createAdminClient()
  const { data: acc } = await supabase.from('payment_accounts').select('branch_id').eq('id', id).single()
  if (!acc) return { error: 'Cuenta no encontrada' }
  const orgId = await validateBranchAccess(acc.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  const { error } = await supabase
    .from('payment_accounts')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/cuentas')
  revalidatePath('/dashboard/finanzas')
  return { success: true }
}

type DeleteAccountResult =
  | { error: string }
  | { blocked: true; transferCount: number }
  | { success: true }

export async function deletePaymentAccount(id: string): Promise<DeleteAccountResult> {
  const supabase = createAdminClient()
  const { data: acc } = await supabase.from('payment_accounts').select('branch_id').eq('id', id).single()
  if (!acc) return { error: 'Cuenta no encontrada' }
  const orgId = await validateBranchAccess(acc.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  // Una cuenta con transferencias registradas es historia contable: alimenta los
  // balances, el cierre de caja y la conciliación de comprobantes (mig 157). Borrarla
  // dejaría ese ledger huérfano (FK transfer_logs, NO ACTION a propósito) y descuadraría
  // la caja hacia atrás. En ese caso NO se elimina: se desactiva (is_active=false).
  const { count } = await supabase
    .from('transfer_logs')
    .select('id', { count: 'exact', head: true })
    .eq('payment_account_id', id)

  if (count && count > 0) {
    return { blocked: true as const, transferCount: count }
  }

  const { error } = await supabase
    .from('payment_accounts')
    .delete()
    .eq('id', id)
  if (error) {
    // Red de seguridad: si a futuro otra tabla referencia la cuenta con una FK dura,
    // devolvemos el mismo flujo amigable en vez de filtrar el SQL crudo al usuario.
    if (error.code === '23503') return { blocked: true as const, transferCount: 0 }
    return { error: 'No se pudo eliminar la cuenta. Probá de nuevo en un momento.' }
  }
  revalidatePath('/dashboard/cuentas')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/caja')
  return { success: true as const }
}

export async function getAllAccountBalanceTotals(branchId?: string | null) {
  const supabase = await createClient()

  if (branchId) {
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return []
  }

  let accountsQuery = supabase
    .from('payment_accounts')
    .select('id, name')
    .order('sort_order')

  if (branchId) {
    accountsQuery = accountsQuery.eq('branch_id', branchId)
  } else {
    const orgBranchIds = await getScopedBranchIds()
    if (orgBranchIds.length === 0) return []
    accountsQuery = accountsQuery.in('branch_id', orgBranchIds)
  }

  // Cash balance histórico: estas queries acumulan filas indefinidamente (no
  // hay filtro temporal). Sin paginación, una vez que la org supera 1000
  // visitas en efectivo el saldo de caja queda truncado y mal calculado para
  // siempre. Paginar con range() drena todas las filas vía PostgREST.
  const cashVisitsPromise = fetchAll<{ amount: number }>((from, to) => {
    let q = supabase
      .from('visits')
      .select('amount')
      .eq('payment_method', 'cash')
      .order('completed_at')
      .range(from, to)
    if (branchId) q = q.eq('branch_id', branchId)
    return q
  })

  const cashExpensesPromise = fetchAll<{ amount: number }>((from, to) => {
    let q = supabase
      .from('expense_tickets')
      .select('amount')
      .is('payment_account_id', null)
      .order('expense_date')
      .range(from, to)
    if (branchId) q = q.eq('branch_id', branchId)
    return q
  })

  // Fetch cuentas + cash en paralelo
  const [{ data: accounts }, cashVisits, cashExpenses] = await Promise.all([
    accountsQuery,
    cashVisitsPromise,
    cashExpensesPromise,
  ])

  const accountIds = accounts?.map(a => a.id) || []

  // Transfers + expenses de cuentas en paralelo (también sin filtro temporal:
  // mismo riesgo de truncado a 1000 cuando crece el historial).
  // OJO: el order() tiene que ser por una columna que exista. transfer_logs NO tiene
  // `created_at`: ordenar por ahí hacía fallar la query, fetchAll se comía el error y
  // TODAS las cuentas mostraban $0 de ingresos.
  const [allTransfers, allExpenses] = await Promise.all([
    accountIds.length > 0
      ? fetchAll<AccountAmountRow>((from, to) =>
          supabase
            .from('transfer_logs')
            .select(TRANSFER_INCOME_COLUMNS)
            .in('payment_account_id', accountIds)
            .order('transferred_at')
            .range(from, to)
        )
      : Promise.resolve([] as AccountAmountRow[]),
    accountIds.length > 0
      ? fetchAll<{ payment_account_id: string; amount: number }>((from, to) =>
          supabase
            .from('expense_tickets')
            .select('payment_account_id, amount')
            .in('payment_account_id', accountIds)
            .order('expense_date')
            .range(from, to)
        )
      : Promise.resolve([] as { payment_account_id: string; amount: number }[]),
  ])

  const cashIncome = cashVisits.reduce((s, v) => s + Number(v.amount), 0)
  const cashTotalExpenses = cashExpenses.reduce((s, e) => s + Number(e.amount), 0)

  const balances = (accounts || []).map(acc => {
    const income = incomeOf(allTransfers ?? [], acc.id)
    const expenses = (allExpenses ?? [])
      .filter(e => e.payment_account_id === acc.id)
      .reduce((s, e) => s + Number(e.amount), 0)
    return {
      id: acc.id,
      name: acc.name,
      balance: income - expenses,
      income,
      expenses,
    }
  })

  // Add virtual cash account
  balances.push({
    id: 'cash_virtual_id',
    name: 'Efectivo en caja',
    balance: cashIncome - cashTotalExpenses,
    income: cashIncome,
    expenses: cashTotalExpenses
  })

  return balances
}

export async function getAccountBalanceSummary(
  accountId: string,
  range?: { from?: string; to?: string } // ISO datetimes; if omitted se usa el día actual
) {
  const supabase = await createClient()
  const { start: todayStart, end: todayEnd } = getLocalDayBounds()

  const fromISO = range?.from ?? todayStart
  const toISO = range?.to ?? todayEnd
  const fromDate = fromISO.slice(0, 10) // YYYY-MM-DD
  const toDate = toISO.slice(0, 10)

  // Ingresos: cobro + propina transferida (las dos cosas entran en la misma
  // transferencia del cliente, a la misma cuenta).
  const { data: transfers } = await supabase
    .from('transfer_logs')
    .select('id, amount, tip_amount, transferred_at, visit:visits(client:clients(name), barber:staff(full_name))')
    .eq('payment_account_id', accountId)
    .gte('transferred_at', fromISO)
    .lte('transferred_at', toISO)
    .order('transferred_at', { ascending: false })

  // Get expenses (expense_tickets) in range
  const { data: expenses } = await supabase
    .from('expense_tickets')
    .select('id, amount, category, description, expense_date, created_by_staff:created_by(full_name)')
    .eq('payment_account_id', accountId)
    .gte('expense_date', fromDate)
    .lte('expense_date', toDate)
    .order('created_at', { ascending: false })

  const totalIncome = (transfers ?? []).reduce(
    (s, t) => s + Number(t.amount) + Number(t.tip_amount ?? 0),
    0
  )
  const totalExpenses = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  return {
    totalIncome,
    totalExpenses,
    estimatedBalance: totalIncome - totalExpenses,
    transfers: transfers ?? [],
    expenses: expenses ?? [],
    range: { from: fromISO, to: toISO },
  }
}

/**
 * Acumulado (ingresos acreditados: cobros + propinas transferidas) de una cuenta en un
 * mes dado. Permite ver el histórico de meses cerrados, no sólo el mes en curso.
 * Los bordes del mes los calcula la DB en la TZ de la sucursal (RPC), para que coincida
 * exactamente con el acumulado del mes en curso que muestra el resto del dashboard.
 */
export async function getAccountMonthlyAccumulated(accountId: string, year: number, month: number) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('get_payment_account_month_income', {
    p_account_id: accountId,
    p_year: year,
    p_month: month,
  })

  if (error) {
    console.error('[getAccountMonthlyAccumulated]', error.message)
    return { total: 0, count: 0, error: error.message }
  }

  const row = (data ?? [])[0] as { month_income: number; month_count: number } | undefined
  return { total: Number(row?.month_income ?? 0), count: Number(row?.month_count ?? 0), error: null }
}
