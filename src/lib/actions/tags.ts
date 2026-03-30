'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'

export async function getServiceTags() {
  const supabase = await createClient()

  // Filtrar etiquetas por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return []

  const { data } = await supabase
    .from('service_tags')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name')
  return data ?? []
}

export async function upsertServiceTag(name: string, id?: string) {
  const supabase = await createClient()

  // Filtrar etiquetas por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  if (id) {
    const { error } = await supabase
      .from('service_tags')
      .update({ name })
      .eq('id', id)
      .eq('organization_id', orgId)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase
      .from('service_tags')
      .insert({ name, organization_id: orgId })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/servicios')
  return { success: true }
}

export async function deleteServiceTag(id: string) {
  const supabase = await createClient()

  // Filtrar etiquetas por organización
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { error } = await supabase
    .from('service_tags')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/servicios')
  return { success: true }
}
