'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'

export interface AudienceFilters {
  segments?: string[]           // 'nuevo'|'regular'|'vip'|'en_riesgo'|'perdido'
  lastContactDays?: number      // max days since last contact (null = no filter)
  lastContactMin?: number       // min days since last contact
  tagIds?: string[]             // conversation tag IDs
  manualClientIds?: string[]    // manually selected client IDs
  hasPhone?: boolean            // only clients with phone number
  branchIds?: string[]          // filtrar por sucursales donde el cliente tuvo visitas
  lastVisitMaxDays?: number     // máx días desde la última visita
  lastVisitMinDays?: number     // mín días desde la última visita
  minVisits?: number            // mínimo de visitas totales
  maxVisits?: number            // máximo de visitas totales
}

interface ClientWithSegment {
  id: string
  name: string
  phone: string | null
  instagram: string | null
  segment: string
  lastContactDate: string | null
  totalVisits: number
}

// Calcula el segmento del cliente (misma lógica que clientes-client.tsx)
function computeSegment(
  createdAt: string,
  totalVisits: number,
  last30Visits: number,
  lastVisitDate: string | null
): string {
  const now = new Date()
  const created = new Date(createdAt)
  const daysSinceCreated = Math.floor((now.getTime() - created.getTime()) / 86400000)

  if (daysSinceCreated <= 30 || totalVisits === 0) return 'nuevo'

  if (lastVisitDate) {
    const daysSinceVisit = Math.floor((now.getTime() - new Date(lastVisitDate).getTime()) / 86400000)
    if (daysSinceVisit >= 40) return 'perdido'
    if (daysSinceVisit >= 25) return 'en_riesgo'
  } else {
    if (daysSinceCreated > 30) return 'perdido'
  }

  if (last30Visits >= 4) return 'vip'
  if (totalVisits >= 2) return 'regular'
  return 'nuevo'
}

// Retorna la audiencia preview con count y muestra de clientes
export async function previewAudience(filters: AudienceFilters): Promise<{
  count: number
  sample: Array<{ id: string; name: string; phone: string | null; segment: string }>
  error?: string
}> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { count: 0, sample: [], error: 'No autorizado' }

  const clients = await getFilteredClients(orgId, filters)
  return {
    count: clients.length,
    sample: clients.slice(0, 20).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      segment: c.segment,
    })),
  }
}

// Retorna IDs y teléfonos de clientes que matchean los filtros
export async function getFilteredClientIds(filters: AudienceFilters): Promise<{
  clients: Array<{ id: string; phone: string }>
  error?: string
}> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { clients: [], error: 'No autorizado' }

  const all = await getFilteredClients(orgId, filters)
  return {
    clients: all
      .filter(c => c.phone)
      .map(c => ({ id: c.id, phone: c.phone! })),
  }
}

async function fetchAllRows<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let offset = 0
   
  while (true) {
    const { data } = await queryFn(offset, offset + PAGE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

async function batchIn<T>(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  selectCols: string,
  inColumn: string,
  inValues: string[],
  extraFilters?: (q: any) => any
): Promise<T[]> {
  const BATCH = 500
  const all: T[] = []
  for (let i = 0; i < inValues.length; i += BATCH) {
    const chunk = inValues.slice(i, i + BATCH)
    let q = supabase.from(table).select(selectCols).in(inColumn, chunk)
    if (extraFilters) q = extraFilters(q)
    const { data } = await q
    if (data) all.push(...(data as T[]))
  }
  return all
}

async function getFilteredClients(orgId: string, filters: AudienceFilters): Promise<ClientWithSegment[]> {
  const supabase = createAdminClient()

  // Obtener TODOS los clientes de la org (paginado para superar el límite de 1000)
  const rawClients = await fetchAllRows<{
    id: string; name: string; phone: string | null; instagram: string | null; created_at: string
  }>((from, to) =>
    supabase
      .from('clients')
      .select('id, name, phone, instagram, created_at')
      .eq('organization_id', orgId)
      .order('name')
      .range(from, to)
  )

  if (rawClients.length === 0) return []

  const clientIds = rawClients.map(c => c.id)

  // Obtener visitas en lotes para evitar límites de URL y filas
  const visits = await batchIn<{ client_id: string; completed_at: string }>(
    supabase, 'visits', 'client_id, completed_at', 'client_id', clientIds,
    (q: any) => q.not('completed_at', 'is', null)
  )

  // Obtener último mensaje por cliente (via conversations) en lotes
  const conversations = await batchIn<{ client_id: string; last_message_at: string }>(
    supabase, 'conversations', 'client_id, last_message_at', 'client_id', clientIds,
    (q: any) => q.not('last_message_at', 'is', null)
  )

  // Agregar datos de visitas
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const visitMap = new Map<string, { total: number; last30: number; lastDate: string | null }>()
  for (const v of visits) {
    const entry = visitMap.get(v.client_id) ?? { total: 0, last30: 0, lastDate: null }
    entry.total++
    if (new Date(v.completed_at) >= thirtyDaysAgo) entry.last30++
    if (!entry.lastDate || v.completed_at > entry.lastDate) entry.lastDate = v.completed_at
    visitMap.set(v.client_id, entry)
  }

  // Último mensaje por cliente
  const msgMap = new Map<string, string>()
  for (const c of conversations) {
    if (c.client_id) {
      const existing = msgMap.get(c.client_id)
      if (!existing || c.last_message_at > existing) {
        msgMap.set(c.client_id, c.last_message_at)
      }
    }
  }

  // Construir resultado enriquecido
  let enriched: ClientWithSegment[] = rawClients.map(c => {
    const vd = visitMap.get(c.id)
    const lastMsg = msgMap.get(c.id)
    const lastVisit = vd?.lastDate ?? null
    // Ultimo contacto = mas reciente entre último mensaje y última visita
    let lastContact: string | null = null
    if (lastMsg && lastVisit) lastContact = lastMsg > lastVisit ? lastMsg : lastVisit
    else lastContact = lastMsg || lastVisit

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      instagram: c.instagram,
      segment: computeSegment(c.created_at, vd?.total ?? 0, vd?.last30 ?? 0, vd?.lastDate ?? null),
      lastContactDate: lastContact,
      totalVisits: vd?.total ?? 0,
    }
  })

  // Filtro por sucursal: solo clientes que visitaron alguna de las branches seleccionadas
  if (filters.branchIds && filters.branchIds.length > 0) {
    const branchVisits = await batchIn<{ client_id: string }>(
      supabase, 'visits', 'client_id', 'client_id', clientIds,
      (q: any) => q.in('branch_id', filters.branchIds!).not('completed_at', 'is', null)
    )
    const visitedSet = new Set(branchVisits.map(v => v.client_id))
    enriched = enriched.filter(c => visitedSet.has(c.id))
  }

  // Aplicar filtros
  if (filters.hasPhone !== false) {
    enriched = enriched.filter(c => !!c.phone)
  }

  if (filters.segments && filters.segments.length > 0) {
    enriched = enriched.filter(c => filters.segments!.includes(c.segment))
  }

  if (filters.lastContactDays != null) {
    const cutoff = new Date(now.getTime() - filters.lastContactDays * 86400000)
    enriched = enriched.filter(c => {
      if (!c.lastContactDate) return true
      return new Date(c.lastContactDate) <= cutoff
    })
  }

  if (filters.lastContactMin != null) {
    const cutoff = new Date(now.getTime() - filters.lastContactMin * 86400000)
    enriched = enriched.filter(c => {
      if (!c.lastContactDate) return false
      return new Date(c.lastContactDate) >= cutoff
    })
  }

  // Filtro por última visita (días)
  if (filters.lastVisitMaxDays != null) {
    const cutoff = new Date(now.getTime() - filters.lastVisitMaxDays * 86400000)
    enriched = enriched.filter(c => {
      const vd = visitMap.get(c.id)
      if (!vd?.lastDate) return true
      return new Date(vd.lastDate) <= cutoff
    })
  }

  if (filters.lastVisitMinDays != null) {
    const cutoff = new Date(now.getTime() - filters.lastVisitMinDays * 86400000)
    enriched = enriched.filter(c => {
      const vd = visitMap.get(c.id)
      if (!vd?.lastDate) return false
      return new Date(vd.lastDate) >= cutoff
    })
  }

  // Filtro por cantidad de visitas
  if (filters.minVisits != null) {
    enriched = enriched.filter(c => c.totalVisits >= filters.minVisits!)
  }

  if (filters.maxVisits != null) {
    enriched = enriched.filter(c => c.totalVisits <= filters.maxVisits!)
  }

  if (filters.manualClientIds && filters.manualClientIds.length > 0) {
    const manualSet = new Set(filters.manualClientIds)
    enriched = enriched.filter(c => manualSet.has(c.id))
  }

  return enriched
}
