import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { ClientesClient } from './clientes-client'

const PAGE_SIZE = 1000

async function fetchAll<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  while (true) {
    const { data } = await queryFn(from, from + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export default async function ClientesPage() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()

  if (!orgId) {
    return <div className="p-8 text-center text-muted-foreground">Organización no encontrada</div>
  }

  const { data: orgBranches } = await supabase
    .from('branches')
    .select('id, name')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name')

  const branchIds = (orgBranches ?? []).map((b) => b.id)

  const [clients, visits, points] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')
        .range(from, to)
    ),
    branchIds.length > 0
      ? fetchAll((from, to) =>
          supabase
            .from('visits')
            .select(
              'id, client_id, branch_id, amount, completed_at, notes, tags, barber_id, service:services(name), barber:staff(full_name)'
            )
            .in('branch_id', branchIds)
            .order('completed_at', { ascending: false })
            .range(from, to)
        )
      : [],
    supabase
      .from('client_points')
      .select('client_id, points_balance')
      .then(({ data }) => data ?? []),
  ])

  return (
    <ClientesClient
      clients={clients}
      visits={visits as any}
      points={points as any}
      branches={orgBranches ?? []}
    />
  )
}
