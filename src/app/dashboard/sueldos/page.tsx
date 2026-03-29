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
  const supabase = createAdminClient()

  const [{ data: branches }, { data: barbersRaw }, { data: salaryConfigsRaw }] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, commission_pct, branch_id')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('salary_configs').select('*'),
  ])

  const configsByStaffId = new Map((salaryConfigsRaw ?? []).map((c) => [c.staff_id, c]))
  const barbers: BarberWithConfig[] = (barbersRaw ?? []).map((b) => {
    const cfg = configsByStaffId.get(b.id)
    return { ...b, salary_configs: cfg ? [cfg] : [] }
  })

  return (
    <SueldosClient
      branches={branches ?? []}
      barbers={barbers}
    />
  )
}
