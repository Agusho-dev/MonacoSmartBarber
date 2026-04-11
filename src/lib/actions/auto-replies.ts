'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

async function requireOrgId(): Promise<{ orgId: string } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    console.error('[AutoReplies] getCurrentOrgId returned null — session may have expired')
    return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  }
  return { orgId }
}

export async function getAutoReplyRules() {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auto_reply_rules')
    .select('*, tag:conversation_tags(id, name, color)')
    .eq('organization_id', orgId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}

export async function createAutoReplyRule(input: {
  name: string
  triggerType: string
  triggerConfig?: Record<string, unknown>
  keywords?: string[]
  matchMode?: string
  responseType: string
  responseText?: string
  responseTemplateName?: string
  platform?: string
  priority?: number
  tagClientId?: string | null
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  if (!input.name.trim()) return { error: 'El nombre es requerido' }

  // Validar según trigger_type
  const triggerType = input.triggerType || 'keyword'
  if (triggerType === 'keyword' && (!input.keywords || input.keywords.length === 0)) {
    return { error: 'Las palabras clave son requeridas para reglas por keyword' }
  }
  if (triggerType === 'days_after_visit') {
    const days = (input.triggerConfig as any)?.delay_days
    if (!days || days < 1) return { error: 'Debe indicar los días de espera (mínimo 1)' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('auto_reply_rules')
    .insert({
      organization_id: orgId,
      name: input.name.trim(),
      trigger_type: triggerType,
      trigger_config: input.triggerConfig ?? {},
      keywords: (input.keywords ?? []).map(k => k.toLowerCase().trim()).filter(Boolean),
      match_mode: input.matchMode || 'contains',
      response_type: input.responseType || 'text',
      response_text: input.responseText || null,
      response_template_name: input.responseTemplateName || null,
      platform: input.platform || 'all',
      priority: input.priority ?? 0,
      tag_client_id: input.tagClientId || null,
      is_active: true,
    })
    .select('*, tag:conversation_tags(id, name, color)')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null }
}

export async function updateAutoReplyRule(id: string, input: {
  name?: string
  triggerType?: string
  triggerConfig?: Record<string, unknown>
  keywords?: string[]
  matchMode?: string
  responseType?: string
  responseText?: string
  responseTemplateName?: string
  platform?: string
  priority?: number
  tagClientId?: string | null
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) update.name = input.name.trim()
  if (input.triggerType !== undefined) update.trigger_type = input.triggerType
  if (input.triggerConfig !== undefined) update.trigger_config = input.triggerConfig
  if (input.keywords !== undefined) update.keywords = input.keywords.map(k => k.toLowerCase().trim()).filter(Boolean)
  if (input.matchMode !== undefined) update.match_mode = input.matchMode
  if (input.responseType !== undefined) update.response_type = input.responseType
  if (input.responseText !== undefined) update.response_text = input.responseText || null
  if (input.responseTemplateName !== undefined) update.response_template_name = input.responseTemplateName || null
  if (input.platform !== undefined) update.platform = input.platform
  if (input.priority !== undefined) update.priority = input.priority
  if (input.tagClientId !== undefined) update.tag_client_id = input.tagClientId || null

  const { error } = await supabase
    .from('auto_reply_rules')
    .update(update)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function deleteAutoReplyRule(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('auto_reply_rules')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function toggleAutoReplyRule(id: string, isActive: boolean) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }
  const orgId = result.orgId

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('auto_reply_rules')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
