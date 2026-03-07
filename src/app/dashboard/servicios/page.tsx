import { createClient } from '@/lib/supabase/server'
import { ServiciosClient } from './servicios-client'

export default async function ServiciosPage() {
  const supabase = await createClient()

  const [{ data: services }, { data: branches }, { data: tags }] =
    await Promise.all([
      supabase.from('services').select('*, branch:branches(*)').order('name'),
      supabase
        .from('branches')
        .select('*')
        .eq('is_active', true)
        .order('name'),
      supabase.from('service_tags').select('*').order('name'),
    ])

  return (
    <ServiciosClient
      services={services ?? []}
      branches={branches ?? []}
      tags={tags ?? []}
    />
  )
}
