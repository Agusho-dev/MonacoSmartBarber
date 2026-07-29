import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getCurrentUserPermissions } from '@/lib/actions/permissions-gate'
import { fetchClientsDirectory } from '@/lib/actions/clients-directory'
import { ClientesClient } from './clientes-client'

export default async function ClientesPage() {
  const permissions = await getCurrentUserPermissions()
  if (!permissions['clients.view']) redirect('/dashboard')

  const orgId = await getCurrentOrgId()
  if (!orgId) {
    return <div className="p-8 text-center text-muted-foreground">Organización no encontrada</div>
  }

  const supabase = createAdminClient()
  const scopedIds = await getScopedBranchIds()

  const [branchesRes, initial, orgRes] = await Promise.all([
    scopedIds.length > 0
      ? supabase
          .from('branches')
          .select('id, name')
          .eq('organization_id', orgId)
          .in('id', scopedIds)
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    // Primera página con los defaults de la UI (tienen que coincidir EXACTAMENTE
    // con el estado inicial de ClientesClient, que omite el primer refetch).
    // Orden por última visita: abrir la pantalla y ver quién vino recién es más útil
    // que un listado alfabético que arranca con los walk-ins sin nombre.
    fetchClientsDirectory({ page: 1, pageSize: 50, sort: 'last_visit', dir: 'desc' }),
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])

  if (branchesRes.error) {
    console.error('[clientes/page] branches:', branchesRes.error.message)
  }

  return (
    <ClientesClient
      initial={initial}
      branches={branchesRes.data ?? []}
      orgName={orgRes.data?.name ?? 'BarberOS'}
      canEdit={permissions['clients.edit'] === true}
    />
  )
}
