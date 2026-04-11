'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

async function requireOrgId(): Promise<{ orgId: string } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    console.error('[QuickReplies] getCurrentOrgId returned null — session may have expired')
    return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  }
  return { orgId }
}

export async function getQuickReplies() {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('quick_replies')
    .select('*')
    .eq('organization_id', orgId)
    .order('sort_order')
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function createQuickReply(input: {
  title: string
  content: string
  shortcut?: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId
  if (!input.title.trim() || !input.content.trim()) return { error: 'Titulo y contenido son requeridos' }

  const supabase = createAdminClient()

  // Obtener max sort_order
  const { data: maxRow } = await supabase
    .from('quick_replies')
    .select('sort_order')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('quick_replies')
    .insert({
      organization_id: orgId,
      title: input.title.trim(),
      content: input.content.trim(),
      shortcut: input.shortcut?.trim() || null,
      sort_order: nextOrder,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null }
}

export async function updateQuickReply(id: string, input: {
  title?: string
  content?: string
  shortcut?: string
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}
  if (input.title !== undefined) update.title = input.title.trim()
  if (input.content !== undefined) update.content = input.content.trim()
  if (input.shortcut !== undefined) update.shortcut = input.shortcut?.trim() || null

  const { error } = await supabase
    .from('quick_replies')
    .update(update)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function deleteQuickReply(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function reorderQuickReplies(orderedIds: string[]) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()

  // Actualizar sort_order en batch
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from('quick_replies')
      .update({ sort_order: i })
      .eq('id', orderedIds[i])
      .eq('organization_id', orgId)
  }

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
