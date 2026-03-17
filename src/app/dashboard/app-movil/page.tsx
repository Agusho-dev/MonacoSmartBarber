import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppMovilClient } from './app-movil-client'

export default async function AppMovilPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [
    { data: branches },
    { data: configs },
    { data: catalog },
    { data: billboard },
  ] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    supabase.from('rewards_config').select('*'),
    supabase.from('reward_catalog').select('*').order('created_at', { ascending: false }),
    supabase.from('billboard_items').select('*, branch:branches(name)').order('sort_order'),
  ])

  return (
    <AppMovilClient
      branches={branches || []}
      initialConfigs={configs || []}
      initialCatalog={catalog || []}
      initialBillboard={(billboard as any) || []}
    />
  )
}
