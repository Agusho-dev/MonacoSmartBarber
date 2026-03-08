import { createClient } from '@/lib/supabase/server'
import { ClientesClient } from './clientes-client'

export default async function ClientesPage() {
  const supabase = await createClient()

  const [{ data: clients }, { data: visits }, { data: points }] =
    await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase
        .from('visits')
        .select(
          'id, client_id, branch_id, amount, completed_at, notes, tags, barber_id, service:services(name), barber:staff(full_name)'
        )
        .order('completed_at', { ascending: false }),
      supabase.from('client_points').select('client_id, points_balance'),
    ])

  return (
    <ClientesClient
      clients={clients ?? []}
      visits={(visits as any) ?? []}
      points={points ?? []}
    />
  )
}
