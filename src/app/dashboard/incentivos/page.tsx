import { createClient } from '@/lib/supabase/server'
import { IncentivosClient } from './incentivos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Incentivos | Monaco Smart Barber',
}

export default async function IncentivosPage() {
  const supabase = await createClient()
  const today = new Date()
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [{ data: branches }, { data: rules }, { data: barbers }, { data: achievements }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase.from('incentive_rules').select('*').order('name'),
    supabase.from('staff').select('id, full_name, branch_id').eq('role', 'barber').eq('is_active', true).order('full_name'),
    supabase.from('incentive_achievements').select('*, rule:incentive_rules(name)').eq('period_label', defaultPeriod),
  ])

  return (
    <IncentivosClient
      branches={branches ?? []}
      rules={rules ?? []}
      barbers={barbers ?? []}
      achievements={achievements ?? []}
      defaultPeriod={defaultPeriod}
    />
  )
}
