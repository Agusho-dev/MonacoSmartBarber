import { createAdminClient } from '@/lib/supabase/server'
import { SueldosClient } from './sueldos-client'
import type { Metadata } from 'next'
import type { SalaryConfig } from '@/lib/types/database'

export const metadata: Metadata = {
  title: 'Sueldos | Monaco Smart Barber',
}

export interface BarberWithConfig {
  id: string
  full_name: string
  commission_pct: number
  branch_id: string | null
  salary_configs: SalaryConfig[]
}

export default async function SueldosPage() {
  const supabase = await createAdminClient()

  const [{ data: branches }, { data: barbersRaw }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, commission_pct, branch_id, salary_configs(*)')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
  ])

  return (
    <SueldosClient
      branches={branches ?? []}
      barbers={(barbersRaw ?? []) as BarberWithConfig[]}
    />
  )
}
