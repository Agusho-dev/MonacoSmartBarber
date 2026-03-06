import { createClient } from '@/lib/supabase/server'
import { ConfiguracionClient } from './configuracion-client'

export default async function ConfiguracionPage() {
  const supabase = await createClient()

  const { data: appSettings } = await supabase
    .from('app_settings')
    .select('*')
    .single()

  const { data: rewardsConfig } = await supabase
    .from('rewards_config')
    .select('*')

  return (
    <ConfiguracionClient
      appSettings={appSettings}
      rewardsConfig={rewardsConfig ?? []}
    />
  )
}
