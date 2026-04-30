import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { ClientesClient } from './clientes-client'

interface RawVisit {
  id: string
  client_id: string
  branch_id: string
  barber_id: string
  amount: number
  completed_at: string
  notes: string | null
  tags: string[] | null
  service: { name: string } | { name: string }[] | null
  barber: { full_name: string } | { full_name: string }[] | null
}

interface RawPointsRow {
  client_id: string
  points_balance: number
}

function pickRel<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export default async function ClientesPage() {
  const supabase = createAdminClient()
  const orgId = await getCurrentOrgId()

  if (!orgId) {
    return <div className="p-8 text-center text-muted-foreground">Organización no encontrada</div>
  }

  const scopedIds = await getScopedBranchIds()
  const { data: orgBranches } = scopedIds.length > 0
    ? await supabase
        .from('branches')
        .select('id, name')
        .eq('organization_id', orgId)
        .in('id', scopedIds)
        .eq('is_active', true)
        .order('name')
    : { data: [] }

  const branchIds = (orgBranches ?? []).map((b) => b.id)

  // Segmentación de clientes: solo necesitamos los últimos 90 días para calcular
  // totalVisits, last30Visits y lastVisitDate. Reducir de fetchAll-sin-límite
  // (potencialmente 60k+ filas) a un rango acotado baja el tiempo de carga de
  // 5-15 segundos a <1 segundo en orgs grandes.
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString()

  const [clients, visits, points, { data: orgRow }] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .order('name')
        .range(from, to)
    ),
    branchIds.length > 0
      ? supabase
          .from('visits')
          .select(
            'id, client_id, branch_id, amount, completed_at, notes, tags, barber_id, service:services(name), barber:staff(full_name)'
          )
          .in('branch_id', branchIds)
          .gte('completed_at', ninetyDaysAgoStr)
          .order('completed_at', { ascending: false })
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    branchIds.length > 0
      ? supabase
          .from('client_points')
          .select('client_id, points_balance')
          .in('branch_id', branchIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])

  const normalizedVisits = (visits as unknown as RawVisit[]).map((v) => ({
    id: v.id,
    client_id: v.client_id,
    branch_id: v.branch_id,
    barber_id: v.barber_id,
    amount: v.amount,
    completed_at: v.completed_at,
    notes: v.notes,
    tags: v.tags,
    service: pickRel(v.service),
    barber: pickRel(v.barber),
  }))

  const normalizedPoints = (points as unknown as RawPointsRow[])

  return (
    <ClientesClient
      clients={clients}
      visits={normalizedVisits}
      points={normalizedPoints}
      branches={orgBranches ?? []}
      orgName={orgRow?.name ?? 'BarberOS'}
    />
  )
}
