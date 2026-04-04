import { createClient } from '@/lib/supabase/server'
import { ConfiguracionClient } from './configuracion-client'

export default async function ConfiguracionPage() {
  const supabase = await createClient()

  const [{ data: appSettings }, { data: branches }] = await Promise.all([
    supabase.from('app_settings').select('*').single(),
    supabase.from('branches').select('id, name, checkin_bg_color').order('name'),
  ])

  return (
    <ConfiguracionClient appSettings={appSettings} branches={branches ?? []} />
  )
}
