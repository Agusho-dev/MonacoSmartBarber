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

async function getFilteredClients(orgId: string, filters: AudienceFilters): Promise<ClientWithSegment[]> {
  const supabase = createAdminClient()

  // Obtener todos los clientes de la org con teléfono
  const { data: rawClients } = await supabase
    .from('clients')
    .select('id, name, phone, instagram, created_at')
    .eq('organization_id', orgId)
    .order('name')

  if (!rawClients || rawClients.length === 0) return []

  const clientIds = rawClients.map(c => c.id)

  // Obtener visitas agrupadas por cliente
  const { data: visits } = await supabase
    .from('visits')
    .select('client_id, completed_at')
    .in('client_id', clientIds)
    .not('completed_at', 'is', null)

  // Obtener último mensaje por cliente (via conversations)
  const { data: conversations } = await supabase
    .from('conversations')
    .select('client_id, last_message_at')
    .in('client_id', clientIds)
    .not('last_message_at', 'is', null)

  // Agregar datos de visitas
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const visitMap = new Map<string, { total: number; last30: number; lastDate: string | null }>()
  for (const v of visits ?? []) {
    const entry = visitMap.get(v.client_id) ?? { total: 0, last30: 0, lastDate: null }
    entry.total++
    if (new Date(v.completed_at) >= thirtyDaysAgo) entry.last30++
    if (!entry.lastDate || v.completed_at > entry.lastDate) entry.lastDate = v.completed_at
    visitMap.set(v.client_id, entry)
  }

  // Último mensaje por cliente
  const msgMap = new Map<string, string>()
  for (const c of conversations ?? []) {
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
      if (!c.lastContactDate) return true // Sin contacto = incluir
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

  if (filters.manualClientIds && filters.manualClientIds.length > 0) {
    const manualSet = new Set(filters.manualClientIds)
    enriched = enriched.filter(c => manualSet.has(c.id))
  }

  return enriched
}
