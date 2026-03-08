import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FidelizacionClient } from './fidelizacion-client'

export default async function FidelizacionPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch branches for config filtering
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name')
    .order('name')

  // Fetch reward configs
  const { data: configs } = await supabase
    .from('rewards_config')
    .select('*')

  // Fetch top points balances with clients
  const { data: topClients } = await supabase
    .from('client_points')
    .select('points_balance, total_earned, total_redeemed, clients(name, phone, email), branches(name)')
    .order('points_balance', { ascending: false })
    .limit(50)

  return (
    <FidelizacionClient
      branches={branches || []}
      initialConfigs={configs || []}
      topClients={(topClients as any) || []}
    />
  )
}
