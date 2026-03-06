import { createClient } from '@/lib/supabase/server'
import { fetchFinancialData, getFixedExpenses } from '@/lib/actions/finances'
import { FinanzasClient } from './finanzas-client'

export default async function FinanzasPage() {
  const supabase = await createClient()

  const financialData = await fetchFinancialData(6)
  const expenses = await getFixedExpenses()

  const { data: branches } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('name')

  return (
    <FinanzasClient
      initialData={financialData}
      initialExpenses={expenses}
      branches={branches ?? []}
    />
  )
}
