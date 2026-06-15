'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getAssistantContext } from '@/lib/asistente/context'
import {
  seedKnowledgeBase,
  backfillInboundMessages,
  embedPendingChunks,
  getRagStats,
  type RagStats,
} from '@/lib/asistente/rag'
import { revalidatePath } from 'next/cache'

// ── Hilos / historial ───────────────────────────────────────────────
export interface AssistantThread {
  id: string
  title: string | null
  pinned: boolean
  updated_at: string
}

export async function getAssistantThreads(limit = 40): Promise<AssistantThread[]> {
  const ctx = await getAssistantContext()
  if (!ctx) return []
  const supabase = createAdminClient()
  let q = supabase
    .from('assistant_conversations')
    .select('id, title, pinned, updated_at')
    .eq('organization_id', ctx.orgId)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (ctx.userId) q = q.eq('user_id', ctx.userId)
  const { data } = await q
  return (data as AssistantThread[]) ?? []
}

export async function getThreadMessages(conversationId: string) {
  const ctx = await getAssistantContext()
  if (!ctx) return []
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('assistant_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('organization_id', ctx.orgId)
    .order('created_at', { ascending: true })
  return data ?? []
}

export async function renameThread(conversationId: string, title: string) {
  const ctx = await getAssistantContext()
  if (!ctx) return { error: 'No autorizado' }
  const supabase = createAdminClient()
  await supabase
    .from('assistant_conversations')
    .update({ title: title.slice(0, 120) })
    .eq('id', conversationId)
    .eq('organization_id', ctx.orgId)
  return { success: true }
}

export async function deleteThread(conversationId: string) {
  const ctx = await getAssistantContext()
  if (!ctx) return { error: 'No autorizado' }
  const supabase = createAdminClient()
  await supabase
    .from('assistant_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('organization_id', ctx.orgId)
  return { success: true }
}

// ── Configuración del asistente ─────────────────────────────────────
export interface AssistantConfigView {
  assistant_model: string
  embedding_model: string
  assistant_temperature: number
  assistant_max_tokens: number
  assistant_persona: string
  assistant_system_prompt: string
  assistant_data_access: Record<string, boolean>
  assistant_suggested_prompts: unknown
  assistant_pro_mode: boolean
  hasOpenAiKey: boolean
  hasAnthropicKey: boolean
  hasOpenRouterKey: boolean
  isOwnerOrAdmin: boolean
}

const DEFAULT_DATA_ACCESS = {
  finanzas: true, salarios: true, estadisticas: true, clientes: true, resenas: true, turnos: true, fidelizacion: true,
}

export async function getAssistantConfigView(): Promise<AssistantConfigView | null> {
  const ctx = await getAssistantContext()
  if (!ctx) return null
  const c = ctx.config
  return {
    assistant_model: c?.assistant_model || 'claude-sonnet-4-6',
    embedding_model: c?.embedding_model || 'text-embedding-3-small',
    assistant_temperature: c?.assistant_temperature ?? 0.4,
    assistant_max_tokens: c?.assistant_max_tokens ?? 1800,
    assistant_persona: c?.assistant_persona ?? '',
    assistant_system_prompt: c?.assistant_system_prompt ?? '',
    assistant_data_access: (c?.assistant_data_access as Record<string, boolean>) ?? DEFAULT_DATA_ACCESS,
    assistant_suggested_prompts: c?.assistant_suggested_prompts ?? null,
    assistant_pro_mode: Boolean(c?.assistant_pro_mode),
    hasOpenAiKey: Boolean(c?.openai_api_key),
    hasAnthropicKey: Boolean(c?.anthropic_api_key),
    hasOpenRouterKey: Boolean(c?.openrouter_api_key),
    isOwnerOrAdmin: ctx.isOwnerOrAdmin,
  }
}

export interface SaveAssistantConfigInput {
  openai_api_key?: string
  anthropic_api_key?: string
  openrouter_api_key?: string
  assistant_model?: string
  embedding_model?: string
  assistant_temperature?: number
  assistant_max_tokens?: number
  assistant_persona?: string
  assistant_system_prompt?: string
  assistant_data_access?: Record<string, boolean>
  assistant_suggested_prompts?: unknown
  assistant_pro_mode?: boolean
}

export async function saveAssistantConfig(input: SaveAssistantConfigInput) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  // Gate de feature (Enterprise / add-on)
  const { requireFeature } = await import('./entitlements')
  const { EntitlementError } = await import('@/lib/billing/types')
  try {
    await requireFeature('ai.enabled')
  } catch (e) {
    if (e instanceof EntitlementError) return { error: e.message, entitlement: e.toResponse() }
    throw e
  }

  const supabase = createAdminClient()
  const payload: Record<string, unknown> = {
    organization_id: orgId,
    is_active: true,
    updated_at: new Date().toISOString(),
  }
  // Solo se escriben los campos provistos (upsert no toca columnas ausentes).
  if (input.openai_api_key !== undefined) payload.openai_api_key = input.openai_api_key || null
  if (input.anthropic_api_key !== undefined) payload.anthropic_api_key = input.anthropic_api_key || null
  if (input.openrouter_api_key !== undefined) payload.openrouter_api_key = input.openrouter_api_key || null
  if (input.assistant_model !== undefined) payload.assistant_model = input.assistant_model
  if (input.embedding_model !== undefined) payload.embedding_model = input.embedding_model
  if (input.assistant_temperature !== undefined) payload.assistant_temperature = input.assistant_temperature
  if (input.assistant_max_tokens !== undefined) payload.assistant_max_tokens = input.assistant_max_tokens
  if (input.assistant_persona !== undefined) payload.assistant_persona = input.assistant_persona
  if (input.assistant_system_prompt !== undefined) payload.assistant_system_prompt = input.assistant_system_prompt
  if (input.assistant_data_access !== undefined) payload.assistant_data_access = input.assistant_data_access
  if (input.assistant_suggested_prompts !== undefined) payload.assistant_suggested_prompts = input.assistant_suggested_prompts
  if (input.assistant_pro_mode !== undefined) payload.assistant_pro_mode = input.assistant_pro_mode

  const { error } = await supabase
    .from('organization_ai_config')
    .upsert(payload, { onConflict: 'organization_id' })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/asistente')
  revalidatePath('/dashboard/asistente/configuracion')
  return { success: true }
}

// ── Base de conocimiento / indexación ───────────────────────────────
export async function getKnowledgeStats(): Promise<RagStats | null> {
  const ctx = await getAssistantContext()
  if (!ctx) return null
  return getRagStats(ctx.orgId)
}

export async function reindexKnowledge(): Promise<{ documents: number; embedded?: number; error?: string }> {
  const ctx = await getAssistantContext()
  if (!ctx) return { documents: 0, error: 'No autorizado' }
  if (!ctx.isOwnerOrAdmin) return { documents: 0, error: 'Solo dueño/admin puede reindexar.' }

  const seeded = await seedKnowledgeBase(ctx.orgId, ctx.orgName)
  const msgs = await backfillInboundMessages(ctx.orgId)
  // Embeber un primer lote ya mismo (el resto lo drena el cron)
  const { embedded } = await embedPendingChunks(150)
  revalidatePath('/dashboard/asistente/configuracion')
  return { documents: seeded + msgs, embedded }
}

export async function embedNow(): Promise<{ embedded: number }> {
  const ctx = await getAssistantContext()
  if (!ctx) return { embedded: 0 }
  const { embedded } = await embedPendingChunks(200)
  return { embedded }
}
