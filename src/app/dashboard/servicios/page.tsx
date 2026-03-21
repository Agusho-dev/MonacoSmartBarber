import { createClient } from '@/lib/supabase/server'
import { ServiciosClient } from './servicios-client'

export default async function ServiciosPage() {
  const supabase = await createClient()

  const [{ data: services }, { data: branches }, { data: barbers }, { data: commissions }] =
    await Promise.all([
      supabase.from('services').select('*, branch:branches(*)').order('name'),
      supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('staff')
        .select('id, full_name, branch_id, is_active')
        .eq('role', 'barber')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('staff_service_commissions')
        .select('*'),
    ])

  return (
    <ServiciosClient
      services={services ?? []}
      branches={branches ?? []}
      barbers={barbers ?? []}
      commissions={commissions ?? []}
    />
  )
}
