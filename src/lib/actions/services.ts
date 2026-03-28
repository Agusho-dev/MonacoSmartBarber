'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ServiceAvailability } from '@/lib/types/database'

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

  let serviceId = data.id

  if (data.id) {
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

  // Verificar que no tenga visitas asociadas
  const { count } = await supabase
    .from('visits')
    .select('*', { count: 'exact', head: true })
    .eq('service_id', id)

  if (count && count > 0) {
    return { error: 'No se puede eliminar el servicio porque tiene visitas asociadas. Desactivalo en su lugar.' }
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
