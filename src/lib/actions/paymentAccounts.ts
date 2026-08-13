'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { revalidatePath } from 'next/cache'
import { getLocalDayBounds, getPeriodBoundsStr } from '@/lib/time-utils'
import { getActiveTimezone } from '@/lib/i18n'
import { validateBranchAccess } from './org'
import { getScopedBranchIds } from './branch-access'
import { requireOrgAccessToEntity } from './guard'
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

/** Período del panel de Finanzas: "últimos `monthsBack` meses terminando en `endMonth`". */
export interface AccountBalancePeriod {
  /** Meses hacia atrás incluyendo el final. 0 = todo el historial. */
  monthsBack: number
  /** "YYYY-MM" del mes final. null = mes en curso. */
  endMonth?: string | null
}

/**
 * Movimiento de un destino de cobro en el período.
 *
 * `charges` es la pieza que reconcilia: la suma de los `charges` de todos los destinos
 * es EXACTAMENTE el ingreso del período que informa /dashboard/estadisticas ("Ingresos
 * por método de pago"). Las propinas y los gastos van aparte a propósito — netearlos
 * dentro del mismo número hacía que Efectivo mostrara $308.315 en julio contra los
 * $1.666.000 de Estadísticas, y que el gráfico comparara cuentas en bruto contra
 * efectivo en neto.
 */
export interface AccountPeriodTotals {
  id: string
  name: string
  /** Cobros del período (sin propina). Es lo que ata con Estadísticas. */
  charges: number
  /** Propinas acreditadas en ese destino. */
  tips: number
  /** Gastos pagados DESDE ese destino (0 en tarjeta). */
  expenses: number
  /** charges + tips: todo lo que entró. */
  income: number
  /** income - expenses. */
  balance: number
}

// IDs de los destinos que no son una `payment_accounts` real. Sin `export`: en un
// archivo 'use server' sólo se pueden exportar funciones async.
const CASH_ACCOUNT_ID = 'cash_virtual_id'
const CARD_ACCOUNT_ID = 'card_virtual_id'
/** Destino virtual de los cobros por transferencia que no quedaron atados a ninguna cuenta. */
const UNASSIGNED_TRANSFER_ID = 'unassigned_transfer_virtual_id'

export async function getAllAccountBalanceTotals(
  branchId?: string | null,
  period?: AccountBalancePeriod,
): Promise<AccountPeriodTotals[]> {
  // Movimiento del PERÍODO, no de toda la vida de la cuenta. Sin este filtro el card
  // sumaba desde el primer cobro registrado: la cuenta de un barbero que dejó de
  // cobrar en julio seguía mostrando sus ~$10M en agosto, y cambiar de mes no movía
  // el número (mismo bug en "Egresos por categoría"). El rango sale del mismo helper
  // que usa `fetchFinancialData`, así las dos mitades de la pantalla no pueden
  // discrepar. Sin `period` → all-time (compatibilidad con callers viejos).
  const tz = await getActiveTimezone()
  const range = period
    ? getPeriodBoundsStr(period.monthsBack, tz, period.endMonth)
    : null

  // Scope de sucursales UNA vez, aplicado a TODAS las queries. Con admin client (RLS bypass)
  // las lecturas de efectivo tienen que scopearse explícitamente: sin branchId ("todas las
  // sucursales") filtrarían plata de otras orgs. Con createClient() la RLS branch-scoped daba
  // el problema inverso: un admin viendo otra sucursal recibía $0 (incidente 16/jul/2026).
  let scopeBranchIds: string[]
  if (branchId) {
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return []
    scopeBranchIds = [branchId]
  } else {
    scopeBranchIds = await getScopedBranchIds()
    if (scopeBranchIds.length === 0) return []
  }

  const supabase = createAdminClient()

  const accountsQuery = supabase
    .from('payment_accounts')
    .select('id, name')
    .in('branch_id', scopeBranchIds)
    .order('sort_order')

  // Acota una query al período. `timestamptz` usa el rango ISO completo; las columnas
  // `date` (expense_tickets.expense_date) sólo la parte YYYY-MM-DD.
  type Rangeable = { gte: (c: string, v: string) => Rangeable; lte: (c: string, v: string) => Rangeable }
  const withRange = <T extends Rangeable>(q: T, col: string, dateOnly = false): T => {
    if (!range) return q
    const from = dateOnly ? range.start.slice(0, 10) : range.start
    const to = dateOnly ? range.end.slice(0, 10) : range.end
    return q.gte(col, from).lte(col, to) as T
  }

  // Aun acotadas al período, estas queries pueden superar el cap de 1000 filas de
  // PostgREST (Rondeau hace ~700 cobros/mes). Paginar con range() drena todo:
  // truncar acá devolvería un saldo silenciosamente bajo.
  //
  // Efectivo y tarjeta salen de la MISMA query que usa Estadísticas (`visits`), para
  // que los dos tableros no puedan divergir. La tarjeta faltaba por completo: en julio
  // eran $626.000 de Caseros que no aparecían en ningún destino del gráfico.
  const cashCardVisitsPromise = fetchAll<{
    amount: number
    payment_method: string
    tip_amount: number | null
    tip_payment_method: string | null
  }>((from, to) =>
    withRange(
      supabase
        .from('visits')
        .select('amount, payment_method, tip_amount, tip_payment_method')
        .in('payment_method', ['cash', 'card'])
        .in('branch_id', scopeBranchIds),
      'completed_at'
    )
      .order('completed_at')
      .range(from, to)
  )

  const cashExpensesPromise = fetchAll<{ amount: number }>((from, to) =>
    withRange(
      supabase
        .from('expense_tickets')
        .select('amount')
        .is('payment_account_id', null)
        .in('branch_id', scopeBranchIds),
      'expense_date',
      true
    )
      .order('expense_date')
      .range(from, to)
  )

  // Fetch cuentas + cash/tarjeta en paralelo
  const [{ data: accounts }, cashCardVisits, cashExpenses] = await Promise.all([
    accountsQuery,
    cashCardVisitsPromise,
    cashExpensesPromise,
  ])

  const accountIds = accounts?.map(a => a.id) || []

  // Transfers + expenses de cuentas en paralelo.
  //
  // EL SCOPE ES LA SUCURSAL DEL MOVIMIENTO, NO LA DE LA CUENTA. Antes estas dos queries
  // filtraban por `payment_account_id IN accountIds`, o sea por las cuentas registradas en la
  // sucursal elegida. El ledger está bien (el trigger copia `visits.branch_id`), pero una
  // cuenta puede cobrar en una sucursal distinta de la que tiene cargada: la cuenta
  // "Alejo Jofre" (`payment_accounts.branch_id` = Test) cobró 810 visitas de PARANÁ por
  // $13.270.000. Con Paraná elegido esos cobros desaparecían del gráfico ($10.414.000 en
  // `transfer_logs`), y con Test elegido aparecían $3.436.000 de cobros en un mes en que Test
  // facturó $1.000. Era la causa del 98% de la rotura del invariante
  // `sum(charges) == Ingresos de Estadísticas`.
  //
  // OJO: el order() tiene que ser por una columna que exista. transfer_logs NO tiene
  // `created_at`: ordenar por ahí hacía fallar la query, fetchAll se comía el error y
  // TODAS las cuentas mostraban $0 de ingresos.
  const [allTransfers, allExpenses, unassignedTransfers] = await Promise.all([
    fetchAll<AccountAmountRow>((from, to) =>
      withRange(
        supabase
          .from('transfer_logs')
          .select(TRANSFER_INCOME_COLUMNS)
          .in('branch_id', scopeBranchIds),
        'transferred_at'
      )
        .order('transferred_at')
        .range(from, to)
    ),
    accountIds.length > 0
      ? fetchAll<{ payment_account_id: string; amount: number }>((from, to) =>
          withRange(
            supabase
              .from('expense_tickets')
              .select('payment_account_id, amount')
              .in('payment_account_id', accountIds),
            'expense_date',
            true
          )
            .order('expense_date')
            .range(from, to)
        )
      : Promise.resolve([] as { payment_account_id: string; amount: number }[]),
    // Cobros por transferencia SIN cuenta asignada. El trigger no les crea fila en
    // `transfer_logs` (el ledger es por cuenta), así que no estaban en ningún destino: ni en
    // una cuenta, ni en Efectivo, ni en Tarjeta. Se restaban del total en silencio — $559.000
    // en la org, $166.000 en Paraná (abr $96.000, may $54.000, jul $16.000), y el de julio
    // demuestra que no es un episodio histórico cerrado. Mostrarlos como destino propio hace
    // que el invariante cierre por construcción y que el dueño VEA que hay plata sin atribuir.
    fetchAll<{ amount: number; tip_amount: number | null }>((from, to) =>
      withRange(
        supabase
          .from('visits')
          .select('amount, tip_amount')
          .eq('payment_method', 'transfer')
          .is('payment_account_id', null)
          .in('branch_id', scopeBranchIds),
        'completed_at'
      )
        .order('completed_at')
        .range(from, to)
    ),
  ])

  // La propina se atribuye por `tip_payment_method`, no por `payment_method`: existe el
  // caso (raro pero real) de un corte pagado en efectivo con la propina transferida.
  const sumBy = (method: 'cash' | 'card') => ({
    charges: cashCardVisits
      .filter(v => v.payment_method === method)
      .reduce((s, v) => s + Number(v.amount), 0),
    tips: cashCardVisits
      .filter(v => v.tip_payment_method === method)
      .reduce((s, v) => s + Number(v.tip_amount ?? 0), 0),
  })
  const cash = sumBy('cash')
  const card = sumBy('card')
  const cashTotalExpenses = cashExpenses.reduce((s, e) => s + Number(e.amount), 0)

  // Cuentas que COBRARON en estas sucursales pero están registradas en otra. Hay que
  // resolverles el nombre acá: si la lista de destinos siguiera saliendo sólo de
  // `payment_accounts.branch_id`, los cobros que ahora sí trae la query quedarían huérfanos y
  // volveríamos al mismo agujero de $10,4M por el otro camino. Las cuentas de la sucursal sin
  // movimiento se conservan (aparecen en $0), que es lo que hace legible el gráfico.
  const idsConMovimiento = new Set(
    (allTransfers ?? []).map(t => t.payment_account_id).filter(Boolean)
  )
  const idsForaneos = [...idsConMovimiento].filter(id => !accountIds.includes(id))
  let cuentasForaneas: { id: string; name: string }[] = []
  if (idsForaneos.length > 0) {
    const { data: foraneas } = await supabase
      .from('payment_accounts')
      .select('id, name')
      .in('id', idsForaneos)
    cuentasForaneas = foraneas ?? []
  }

  const balances: AccountPeriodTotals[] = [...(accounts || []), ...cuentasForaneas].map(acc => {
    const rows = (allTransfers ?? []).filter(t => t.payment_account_id === acc.id)
    const charges = rows.reduce((s, t) => s + Number(t.amount), 0)
    const tips = rows.reduce((s, t) => s + Number(t.tip_amount ?? 0), 0)
    const expenses = (allExpenses ?? [])
      .filter(e => e.payment_account_id === acc.id)
      .reduce((s, e) => s + Number(e.amount), 0)
    return {
      id: acc.id,
      name: acc.name,
      charges,
      tips,
      expenses,
      income: charges + tips,
      balance: charges + tips - expenses,
    }
  })

  // Destinos virtuales. "Efectivo" a secas y no "Efectivo en caja": nadie registra los
  // retiros, así que esto es lo que pasó por la caja en el período, no lo que hay hoy
  // en el cajón (Caseros llegó a mostrar $5.383.015 "en caja" sin un solo cierre de turno).
  balances.push({
    id: CASH_ACCOUNT_ID,
    name: 'Efectivo',
    charges: cash.charges,
    tips: cash.tips,
    expenses: cashTotalExpenses,
    income: cash.charges + cash.tips,
    balance: cash.charges + cash.tips - cashTotalExpenses,
  })

  // Tarjeta no es una `payment_accounts` y por eso faltaba, pero es plata cobrada que
  // tiene que estar: sin ella el gráfico no sumaba el ingreso del período y no había
  // forma de cuadrarlo contra Estadísticas.
  balances.push({
    id: CARD_ACCOUNT_ID,
    name: 'Tarjeta',
    charges: card.charges,
    tips: card.tips,
    expenses: 0,
    income: card.charges + card.tips,
    balance: card.charges + card.tips,
  })

  // Transferencias que se cobraron sin elegir cuenta. Se agrega SÓLO si tiene movimiento:
  // un destino en $0 permanente sería ruido, y su presencia es justamente la señal de que
  // hay plata que hay que ir a atribuir.
  const sinCuentaCharges = unassignedTransfers.reduce((s, v) => s + Number(v.amount), 0)
  const sinCuentaTips = unassignedTransfers.reduce((s, v) => s + Number(v.tip_amount ?? 0), 0)
  if (sinCuentaCharges + sinCuentaTips > 0) {
    balances.push({
      id: UNASSIGNED_TRANSFER_ID,
      name: 'Transferencia sin cuenta asignada',
      charges: sinCuentaCharges,
      tips: sinCuentaTips,
      expenses: 0,
      income: sinCuentaCharges + sinCuentaTips,
      balance: sinCuentaCharges + sinCuentaTips,
    })
  }

  return balances
}

export async function getAccountBalanceSummary(
  accountId: string,
  range?: { from?: string; to?: string } // ISO datetimes; if omitted se usa el día actual
) {
  const { start: todayStart, end: todayEnd } = getLocalDayBounds()

  const fromISO = range?.from ?? todayStart
  const toISO = range?.to ?? todayEnd
  const fromDate = fromISO.slice(0, 10) // YYYY-MM-DD
  const toDate = toISO.slice(0, 10)

  // Gate: admin client saltea RLS → validamos que la cuenta sea de la org del caller.
  // (Antes con createClient la RLS scopeaba las lecturas por sucursal del staff, así que un
  // admin viendo una cuenta de otra sucursal recibía $0. Ahora admin + gate explícito.)
  const access = await requireOrgAccessToEntity('payment_accounts', accountId)
  if (!access.ok) {
    return {
      totalIncome: 0,
      totalExpenses: 0,
      estimatedBalance: 0,
      transfers: [],
      expenses: [],
      range: { from: fromISO, to: toISO },
    }
  }

  const supabase = createAdminClient()

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
