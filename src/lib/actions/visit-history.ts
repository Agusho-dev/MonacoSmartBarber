'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function saveVisitDetails(
  visitId: string,
  notes: string | null,
  tags: string[] | null,
  photoPaths: string[]
) {
  const supabase = await createClient()

  const { error: updateError } = await supabase
    .from('visits')
    .update({ notes, tags })
    .eq('id', visitId)

  if (updateError) return { error: updateError.message }

  if (photoPaths.length > 0) {
    const { error: photoError } = await supabase
      .from('visit_photos')
      .insert(
        photoPaths.map((path, i) => ({
          visit_id: visitId,
          storage_path: path,
          order_index: i,
        }))
      )
    if (photoError) return { error: photoError.message }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/clientes')
  return { success: true }
}

export interface ClientProfileVisit {
  id: string
  completed_at: string
  amount: number
  notes: string | null
  tags: string[] | null
  service_name: string | null
  barber_name: string
  barber_id: string
  photos: Array<{ id: string; storage_path: string; order_index: number }>
}

export interface ClientProfileData {
  visits: ClientProfileVisit[]
  frequentBarber: { name: string; count: number } | null
  totalVisits: number
}

export async function getClientProfile(
  clientId: string
): Promise<ClientProfileData> {
  const supabase = await createClient()

  const { data: visits } = await supabase
    .from('visits')
    .select(
      'id, completed_at, amount, notes, tags, barber_id, barber:staff(full_name), service:services(name)'
    )
    .eq('client_id', clientId)
    .order('completed_at', { ascending: false })
    .limit(20)

  const visitIds = (visits ?? []).map((v) => v.id)

  let photos: Array<{
    visit_id: string
    id: string
    storage_path: string
    order_index: number
  }> = []
  if (visitIds.length > 0) {
    const { data } = await supabase
      .from('visit_photos')
      .select('id, visit_id, storage_path, order_index')
      .in('visit_id', visitIds)
      .order('order_index')
    photos = data ?? []
  }

  const photoMap = new Map<string, typeof photos>()
  for (const p of photos) {
    const arr = photoMap.get(p.visit_id) || []
    arr.push(p)
    photoMap.set(p.visit_id, arr)
  }

  const barberCounts = new Map<string, { name: string; count: number }>()
  for (const v of visits ?? []) {
    const name =
      (v.barber as unknown as { full_name: string } | null)?.full_name ?? '?'
    const existing = barberCounts.get(v.barber_id) || { name, count: 0 }
    existing.count++
    barberCounts.set(v.barber_id, existing)
  }
  let frequentBarber: { name: string; count: number } | null = null
  for (const [, data] of barberCounts) {
    if (!frequentBarber || data.count > frequentBarber.count) {
      frequentBarber = data
    }
  }

  const { count } = await supabase
    .from('visits')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  return {
    visits: (visits ?? []).map((v) => ({
      id: v.id,
      completed_at: v.completed_at,
      amount: v.amount,
      notes: v.notes,
      tags: v.tags,
      service_name:
        (v.service as unknown as { name: string } | null)?.name ?? null,
      barber_name:
        (v.barber as unknown as { full_name: string } | null)?.full_name ??
        '?',
      barber_id: v.barber_id,
      photos: photoMap.get(v.id) ?? [],
    })),
    frequentBarber,
    totalVisits: count ?? 0,
  }
}

export async function createManualVisit(params: {
  branchId: string
  clientId: string | null
  barberId: string
  serviceId: string
  paymentMethod: 'cash' | 'card' | 'transfer'
  paymentAccountId?: string | null
  amount: number
  completedAt: string
  notes?: string | null
  tags?: string[] | null
}): Promise<{ success: true; visitId: string } | { error: string }> {
  // Usamos el cliente admin igual que completeService — las visitas manuales
  // se registran desde el panel de administración, sin sesión de barber PIN
  const supabase = createAdminClient()

  // 1. Obtener comisión global del barbero como fallback
  const { data: barber, error: barberError } = await supabase
    .from('staff')
    .select('commission_pct')
    .eq('id', params.barberId)
    .single()

  if (barberError || !barber) {
    console.error('createManualVisit: error obteniendo barbero', barberError)
    return { error: 'No se pudo obtener la información del barbero' }
  }

  // 2. Obtener comisión por defecto del servicio
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('default_commission_pct')
    .eq('id', params.serviceId)
    .single()

  if (serviceError || !service) {
    console.error('createManualVisit: error obteniendo servicio', serviceError)
    return { error: 'No se pudo obtener la información del servicio' }
  }

  // 3. Buscar override específico barbero+servicio en staff_service_commissions
  const { data: override } = await supabase
    .from('staff_service_commissions')
    .select('commission_pct')
    .eq('staff_id', params.barberId)
    .eq('service_id', params.serviceId)
    .maybeSingle()

  // 4. Resolver comisión: override → default del servicio → global del barbero
  let commissionPct: number
  if (override) {
    commissionPct = Number(override.commission_pct)
  } else if (Number(service.default_commission_pct) > 0) {
    commissionPct = Number(service.default_commission_pct)
  } else {
    commissionPct = Number(barber.commission_pct)
  }

  const commissionAmount = params.amount * (commissionPct / 100)

  // 5. Insertar la visita manual (sin queue_entry_id)
  const { data: newVisit, error: insertError } = await supabase
    .from('visits')
    .insert({
      branch_id: params.branchId,
      client_id: params.clientId,
      barber_id: params.barberId,
      service_id: params.serviceId,
      queue_entry_id: null,
      payment_method: params.paymentMethod,
      payment_account_id: params.paymentAccountId ?? null,
      amount: params.amount,
      commission_pct: commissionPct,
      commission_amount: commissionAmount,
      notes: params.notes ?? null,
      tags: params.tags ?? null,
      started_at: params.completedAt,
      completed_at: params.completedAt,
    })
    .select('id')
    .single()

  if (insertError || !newVisit) {
    console.error('createManualVisit: error insertando visita', insertError)
    return { error: 'No se pudo registrar la visita manual' }
  }

  revalidatePath('/dashboard/servicios')
  revalidatePath('/dashboard/estadisticas')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/clientes')

  return { success: true, visitId: newVisit.id }
}
