import { createClient } from '@/lib/supabase/server'
import { DescansosDashboard } from './descansos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Descansos | Monaco Smart Barber',
}

export default async function DescansosPage() {
  const supabase = await createClient()
  const [{ data: breakConfigs }, { data: branches }, { data: barbers }] = await Promise.all([
    supabase.from('break_configs').select('*').order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase
      .from('staff')
      .select('id, full_name, status, break_config_id, break_started_at, break_ends_at, branch_id, break_configs:break_config_id(name, duration_minutes, tolerance_minutes)')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name'),
  ])
  return (
    <DescansosDashboard
      breakConfigs={breakConfigs ?? []}
      branches={branches ?? []}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      barbers={(barbers ?? []) as any}
    />
  )
}
