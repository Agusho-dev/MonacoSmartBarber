'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ServiceAvailability } from '@/lib/types/database'
import { getCurrentOrgId } from './org'

export async function upsertService(data: {
  id?: string
  name: string
  price: number
  duration_minutes: number | null
  branch_id: string | null
  availability: ServiceAvailability
  default_commission_pct: number
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
