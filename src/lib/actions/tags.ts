'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
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

// ─── Etiquetas de conversaciones (CRM) ───────────────────────────────────────

export async function getConversationTags() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversation_tags')
    .select('*')
    .eq('organization_id', orgId)
    .order('name')

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function createConversationTag(name: string, color: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversation_tags')
    .insert({ organization_id: orgId, name: name.trim(), color })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null }
}

export async function deleteConversationTag(tagId: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversation_tags')
    .delete()
    .eq('id', tagId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { error: null }
}

export async function assignConversationTag(conversationId: string, tagId: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversation_tag_assignments')
    .upsert({ conversation_id: conversationId, tag_id: tagId }, { onConflict: 'conversation_id,tag_id' })

  if (error) return { error: error.message }
  return { error: null }
}

export async function removeConversationTag(conversationId: string, tagId: string) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversation_tag_assignments')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('tag_id', tagId)

  if (error) return { error: error.message }
  return { error: null }
}
