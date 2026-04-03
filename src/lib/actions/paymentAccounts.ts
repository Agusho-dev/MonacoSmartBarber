'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getLocalDateStr, getLocalDayBounds } from '@/lib/time-utils'
import { validateBranchAccess, getOrgBranchIds } from './org'

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

export async function upsertPaymentAccount(formData: FormData) {
  const supabase = createAdminClient()
  const id = formData.get('id') as string | null
  const branchId = formData.get('branch_id') as string
  const name = (formData.get('name') as string).trim()
  const aliasOrCbu = (formData.get('alias_or_cbu') as string | null)?.trim() || null
  const dailyLimitStr = formData.get('daily_limit') as string | null
  const sortOrderStr = formData.get('sort_order') as string | null
  const isActiveStr = formData.get('is_active') as string | null

  const dailyLimit = dailyLimitStr && dailyLimitStr !== '' ? Number(dailyLimitStr) : null
  const sortOrder = sortOrderStr && sortOrderStr !== '' ? Number(sortOrderStr) : 0
  const isActive = isActiveStr !== null ? isActiveStr === 'true' : true

  if (!branchId || !name) return { error: 'Nombre y sucursal son obligatorios' }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  if (id) {
    const { error } = await supabase
      .from('payment_accounts')
      .update({
        branch_id: branchId,
        name,
        alias_or_cbu: aliasOrCbu,
        daily_limit: dailyLimit,
        sort_order: sortOrder,
        is_active: isActive,
      })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('payment_accounts')
      .insert({
        branch_id: branchId,
        name,
        alias_or_cbu: aliasOrCbu,
        daily_limit: dailyLimit,
        sort_order: sortOrder,
        is_active: isActive,
      })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/cuentas')
  revalidatePath('/dashboard/finanzas')
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
  return { success: true }
}

export async function deletePaymentAccount(id: string) {
  const supabase = createAdminClient()
  const { data: acc } = await supabase.from('payment_accounts').select('branch_id').eq('id', id).single()
  if (!acc) return { error: 'Cuenta no encontrada' }
  const orgId = await validateBranchAccess(acc.branch_id)
  if (!orgId) return { error: 'No autorizado' }

  const { error } = await supabase
    .from('payment_accounts')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/cuentas')
  return { success: true }
}

export async function resetDailyAccumulation() {
  const branchIds = await getOrgBranchIds()
  if (branchIds.length === 0) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const todayDate = getLocalDateStr()

  const { error } = await supabase
    .from('payment_accounts')
    .update({
      accumulated_today: 0,
      last_reset_date: todayDate
    })
    .in('branch_id', branchIds)
    .lt('last_reset_date', todayDate)

  if (error) return { error: error.message }
  return { success: true }
}

export async function getActiveAccountForTransfer(branchId: string, transferAmount: number) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { account_id: null, error: 'No autorizado' }

  const supabase = await createClient()

  // First ensure daily accumulations are reset if it's a new day
  await resetDailyAccumulation()

  // Get all active accounts for the branch ordered by sort_order
  const { data: accounts, error } = await supabase
    .from('payment_accounts')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !accounts || accounts.length === 0) {
    return { account_id: null, error: error?.message || 'No hay cuentas activas disponibles' }
  }

  // Find the first account that can accept the transfer amount without exceeding daily_limit
  let selectedAccount = null
  for (const account of accounts) {
    if (account.daily_limit === null) {
      selectedAccount = account
      break
    }

    if ((account.accumulated_today + transferAmount) <= account.daily_limit) {
      selectedAccount = account
      break
    }
  }

  // If all accounts are full, fallback to the last account regardless of limit (or a default branch behavior)
  if (!selectedAccount) {
    selectedAccount = accounts[accounts.length - 1]
  }

  return { account_id: selectedAccount.id, error: null }
}

export async function recordTransfer(visitId: string, accountId: string, amount: number, branchId: string) {
  const supabase = createAdminClient()

  // 1. Log the transfer
  const { error: logError } = await supabase
    .from('transfer_logs')
    .insert({
      visit_id: visitId,
      payment_account_id: accountId,
      amount: amount,
      branch_id: branchId
    })

  if (logError) return { error: logError.message }

  // 2. We need to increment the accumulated_today for the account.
  // The best way to do this concurrently is via a database RPC, but since there's no RPC,
  // we'll fetch the current value and update it. A small race condition exists here.
  const { data: acc } = await supabase
    .from('payment_accounts')
    .select('accumulated_today')
    .eq('id', accountId)
    .single()

  if (acc) {
    await supabase
      .from('payment_accounts')
      .update({ accumulated_today: acc.accumulated_today + amount })
      .eq('id', accountId)
  }

  return { success: true }
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
    const orgBranchIds = await getOrgBranchIds()
    if (orgBranchIds.length === 0) return []
    accountsQuery = accountsQuery.in('branch_id', orgBranchIds)
  }

  // Preparar query de cash en paralelo con la de cuentas
  let cashVisitsQuery = supabase
    .from('visits')
    .select('amount')
    .eq('payment_method', 'cash')
  if (branchId) cashVisitsQuery = cashVisitsQuery.eq('branch_id', branchId)

  let cashExpensesQuery = supabase
    .from('expense_tickets')
    .select('amount')
    .is('payment_account_id', null)
  if (branchId) cashExpensesQuery = cashExpensesQuery.eq('branch_id', branchId)

  // Fetch cuentas + cash en paralelo
  const [{ data: accounts }, { data: cashVisits }, { data: cashExpenses }] = await Promise.all([
    accountsQuery,
    cashVisitsQuery,
    cashExpensesQuery,
  ])

  const accountIds = accounts?.map(a => a.id) || []

  // Transfers + expenses de cuentas en paralelo
  const [{ data: allTransfers }, { data: allExpenses }] = await Promise.all([
    accountIds.length > 0
      ? supabase.from('transfer_logs').select('payment_account_id, amount').in('payment_account_id', accountIds)
      : Promise.resolve({ data: [] as { payment_account_id: string; amount: number }[] }),
    accountIds.length > 0
      ? supabase.from('expense_tickets').select('payment_account_id, amount').in('payment_account_id', accountIds)
      : Promise.resolve({ data: [] as { payment_account_id: string; amount: number }[] }),
  ])

  const cashIncome = (cashVisits ?? []).reduce((s, v) => s + Number(v.amount), 0)
  const cashTotalExpenses = (cashExpenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  const balances = (accounts || []).map(acc => {
    const income = (allTransfers ?? [])
      .filter(t => t.payment_account_id === acc.id)
      .reduce((s, t) => s + Number(t.amount), 0)
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

export async function getAccountBalanceSummary(accountId: string) {
  const supabase = await createClient()
  const today = getLocalDateStr()
  const { start: todayStart, end: todayEnd } = getLocalDayBounds()

  // Get income (transfer_logs) for this account today
  const { data: todayTransfers } = await supabase
    .from('transfer_logs')
    .select('id, amount, transferred_at, visit:visits(client:clients(name), barber:staff(full_name))')
    .eq('payment_account_id', accountId)
    .gte('transferred_at', todayStart)
    .lte('transferred_at', todayEnd)
    .order('transferred_at', { ascending: false })

  // Get expenses (expense_tickets) associated with this account today
  const { data: todayExpenses } = await supabase
    .from('expense_tickets')
    .select('id, amount, category, description, expense_date, created_by_staff:created_by(full_name)')
    .eq('payment_account_id', accountId)
    .eq('expense_date', today)
    .order('created_at', { ascending: false })

  const totalIncome = (todayTransfers ?? []).reduce((s, t) => s + Number(t.amount), 0)
  const totalExpenses = (todayExpenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  return {
    totalIncome,
    totalExpenses,
    estimatedBalance: totalIncome - totalExpenses,
    transfers: todayTransfers ?? [],
    expenses: todayExpenses ?? [],
  }
}
