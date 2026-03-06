import { createClient } from '@/lib/supabase/server'
import { ServiciosClient } from './servicios-client'

export default async function ServiciosPage() {
  const supabase = await createClient()

  const [{ data: services }, { data: branches }] = await Promise.all([
    supabase.from('services').select('*, branch:branches(*)').order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
  ])

  return <ServiciosClient services={services ?? []} branches={branches ?? []} />
}
