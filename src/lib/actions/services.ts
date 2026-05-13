'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ServiceAvailability } from '@/lib/types/database'
import { getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'

export async function upsertService(data: {
  id?: string
  name: string
  price: number
  duration_minutes: number | null
  branch_id: string | null
  availability: ServiceAvailability
  default_commission_pct: number
  booking_mode?: 'self_service' | 'manual_only' | 'both'
  barberOverrides?: Record<string, number>
}) {
  const supabase = createAdminClient()

  // Verificar organización del usuario actual
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // Si el servicio tiene branch_id, verificar que la sucursal pertenece a esta org
  if (data.branch_id) {
    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('id')
      .eq('id', data.branch_id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (branchError || !branch) {
      return { error: 'La sucursal no pertenece a esta organización' }
    }
  }

  let serviceId = data.id

  if (data.id) {
    // Al actualizar, validar el branch_id ORIGINAL del registro (no el del form)
    const { data: existing } = await supabase
      .from('services')
      .select('branch_id')
      .eq('id', data.id)
      .maybeSingle()

    if (!existing) return { error: 'Servicio no encontrado' }

    if (existing.branch_id) {
      const { data: ownerBranch } = await supabase
        .from('branches')
        .select('id')
        .eq('id', existing.branch_id)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (!ownerBranch) return { error: 'El servicio no pertenece a esta organización' }
    }

    const { error } = await supabase
      .from('services')
      .update({
        name: data.name,
        price: data.price,
        duration_minutes: data.duration_minutes,
        branch_id: data.branch_id,
        availability: data.availability,
        default_commission_pct: data.default_commission_pct,
        booking_mode: data.booking_mode ?? 'self_service',
      })
      .eq('id', data.id)

    if (error) return { error: error.message }
  } else {
    const { data: inserted, error } = await supabase
      .from('services')
      .insert({
        name: data.name,
        price: data.price,
        duration_minutes: data.duration_minutes,
        branch_id: data.branch_id,
        availability: data.availability,
        default_commission_pct: data.default_commission_pct,
        booking_mode: data.booking_mode ?? 'self_service',
      })
      .select('id')
      .single()

    if (error) return { error: error.message }
    serviceId = inserted.id
  }

  // Guardar overrides de comisión por barbero
  if (serviceId && data.barberOverrides) {
    await supabase
      .from('staff_service_commissions')
      .delete()
      .eq('service_id', serviceId)

    const rows = Object.entries(data.barberOverrides)
      .filter(([, val]) => val >= 0)
      .map(([staffId, val]) => ({
        staff_id: staffId,
        service_id: serviceId!,
        commission_pct: val,
      }))

    if (rows.length > 0) {
      const { error: commError } = await supabase
        .from('staff_service_commissions')
        .insert(rows)
      if (commError) return { error: commError.message }
    }
  }

  revalidatePath('/dashboard/servicios')
  return { success: true }
}

export async function toggleService(id: string, isActive: boolean) {
  const supabase = createAdminClient()

  // Verificar que el servicio pertenece a la org via su branch_id
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: service, error: fetchError } = await supabase
    .from('services')
    .select('id, branch_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !service) return { error: 'Servicio no encontrado' }

  // Los servicios globales (branch_id = null) son legado — permitir si no hay branch
  if (service.branch_id) {
    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('id', service.branch_id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!branch) return { error: 'No tenés permisos para modificar este servicio' }
  }

  const { error } = await supabase
    .from('services')
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/servicios')
  return { success: true }
}

// ─── Tiempos reales por servicio ─────────────────────────────────────────────

export type ServiceTimingsResult =
  | { error: string }
  | {
      service: { id: string; name: string; duration_minutes: number | null }
      summary: {
        totalVisits: number
        avgMinutes: number
        medianMinutes: number
        minMinutes: number
        maxMinutes: number
      } | null
      byBarber: Array<{
        barberId: string
        fullName: string
        count: number
        avgMinutes: number
        medianMinutes: number
        minMinutes: number
        maxMinutes: number
      }>
      recent: Array<{
        visitId: string
        date: string
        barberName: string | null
        clientName: string | null
        clientPhone: string | null
        minutes: number
      }>
      daysBack: number
    }

// Outliers: cualquier visita con duración fuera de este rango se ignora para
// agregados (probablemente abandonada o el barbero olvidó marcar fin).
const OUTLIER_MIN = 1
const OUTLIER_MAX = 120

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function getServiceTimings(
  serviceId: string,
  daysBack = 90,
): Promise<ServiceTimingsResult> {
  const supabase = createAdminClient()

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // Verificar que el servicio sea visible para esta org
  const { data: service, error: svcErr } = await supabase
    .from('services')
    .select('id, name, duration_minutes, branch_id, branch:branches(organization_id)')
    .eq('id', serviceId)
    .maybeSingle()

  if (svcErr || !service) return { error: 'Servicio no encontrado' }

  if (service.branch_id) {
    const branchOrgId = Array.isArray(service.branch)
      ? service.branch[0]?.organization_id
      : (service.branch as { organization_id?: string } | null)?.organization_id
    if (branchOrgId !== orgId) return { error: 'Servicio fuera de la organización' }
  }

  const branchIds = await getScopedBranchIds()
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  let visitsQuery = supabase
    .from('visits')
    .select(
      'id, started_at, completed_at, barber_id, barber:staff(full_name), client:clients(name, phone)',
    )
    .eq('service_id', serviceId)
    .eq('organization_id', orgId)
    .gte('created_at', since)
    .order('completed_at', { ascending: false })
    .limit(5000)

  if (branchIds.length > 0) {
    visitsQuery = visitsQuery.in('branch_id', branchIds)
  }

  const { data: visits, error: visitsErr } = await visitsQuery
  if (visitsErr) return { error: visitsErr.message }

  type VisitRow = {
    id: string
    started_at: string
    completed_at: string
    barber_id: string | null
    barber: { full_name: string } | { full_name: string }[] | null
    client: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
  }

  const rows = (visits ?? []) as VisitRow[]

  // Calcular duración por visita y filtrar outliers
  type Enriched = {
    visitId: string
    barberId: string | null
    barberName: string | null
    clientName: string | null
    clientPhone: string | null
    completedAt: string
    minutes: number
  }

  const enriched: Enriched[] = rows
    .map((v) => {
      const start = new Date(v.started_at).getTime()
      const end = new Date(v.completed_at).getTime()
      const minutes = (end - start) / 60_000
      const barber = Array.isArray(v.barber) ? v.barber[0] : v.barber
      const client = Array.isArray(v.client) ? v.client[0] : v.client
      return {
        visitId: v.id,
        barberId: v.barber_id,
        barberName: barber?.full_name ?? null,
        clientName: client?.name ?? null,
        clientPhone: client?.phone ?? null,
        completedAt: v.completed_at,
        minutes,
      }
    })
    .filter((v) => Number.isFinite(v.minutes))

  const cleaned = enriched.filter((v) => v.minutes >= OUTLIER_MIN && v.minutes <= OUTLIER_MAX)

  // Resumen global
  let summary: Extract<ServiceTimingsResult, { service: unknown }>['summary'] = null
  if (cleaned.length > 0) {
    const sorted = cleaned.map((v) => v.minutes).sort((a, b) => a - b)
    const sum = sorted.reduce((acc, n) => acc + n, 0)
    summary = {
      totalVisits: cleaned.length,
      avgMinutes: sum / cleaned.length,
      medianMinutes: median(sorted),
      minMinutes: sorted[0],
      maxMinutes: sorted[sorted.length - 1],
    }
  }

  // Breakdown por barbero
  const groups = new Map<string, { fullName: string; vals: number[] }>()
  for (const v of cleaned) {
    if (!v.barberId) continue
    const key = v.barberId
    if (!groups.has(key)) {
      groups.set(key, { fullName: v.barberName ?? 'Sin nombre', vals: [] })
    }
    groups.get(key)!.vals.push(v.minutes)
  }

  const byBarber = Array.from(groups.entries())
    .map(([barberId, { fullName, vals }]) => {
      const sorted = [...vals].sort((a, b) => a - b)
      const sum = sorted.reduce((acc, n) => acc + n, 0)
      return {
        barberId,
        fullName,
        count: sorted.length,
        avgMinutes: sum / sorted.length,
        medianMinutes: median(sorted),
        minMinutes: sorted[0],
        maxMinutes: sorted[sorted.length - 1],
      }
    })
    .sort((a, b) => a.avgMinutes - b.avgMinutes)

  // Últimas 20 visitas (sin filtrar outliers — al usuario le interesa ver casos extremos también)
  const recent = enriched.slice(0, 20).map((v) => ({
    visitId: v.visitId,
    date: v.completedAt,
    barberName: v.barberName,
    clientName: v.clientName,
    clientPhone: v.clientPhone,
    minutes: v.minutes,
  }))

  return {
    service: {
      id: service.id,
      name: service.name,
      duration_minutes: service.duration_minutes,
    },
    summary,
    byBarber,
    recent,
    daysBack,
  }
}

export async function deleteService(id: string) {
  const supabase = createAdminClient()

  // Verificar que el servicio pertenece a la org via su branch_id
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { data: service, error: fetchError } = await supabase
    .from('services')
    .select('id, branch_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !service) return { error: 'Servicio no encontrado' }

  // Los servicios globales (branch_id = null) son legado — permitir si no hay branch
  if (service.branch_id) {
    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('id', service.branch_id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!branch) return { error: 'No tenés permisos para eliminar este servicio' }
  }

  // Verificar que no tenga visitas asociadas
  const { count } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('service_id', id)

  if (count && count > 0) {
    return { error: 'No se puede eliminar el servicio porque tiene visitas asociadas. Desactivalo en su lugar.' }
  }

  // Verificar que no tenga clientes en fila o historial de fila
  const { count: queueCount } = await supabase
    .from('queue_entries')
    .select('*', { count: 'exact', head: true })
    .eq('service_id', id)

  if (queueCount && queueCount > 0) {
    return { error: 'No se puede eliminar el servicio porque tiene historial en la fila de espera. Desactivalo en su lugar.' }
  }

  // Eliminar overrides de comisión primero
  await supabase
    .from('staff_service_commissions')
    .delete()
    .eq('service_id', id)

  const { error } = await supabase
    .from('services')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/servicios')
  return { success: true }
}
