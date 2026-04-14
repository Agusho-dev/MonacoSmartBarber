'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

export interface OrgAiConfig {
  id: string
  organization_id: string
  openai_api_key: string | null
  anthropic_api_key: string | null
  openrouter_api_key: string | null
  default_model: string
  default_system_prompt: string
  default_temperature: number
  default_max_tokens: number
  is_active: boolean
  auto_tag_enabled: boolean
  auto_tag_model: string
  created_at: string
  updated_at: string
}

export async function getOrgAiConfig() {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('organization_ai_config')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as OrgAiConfig | null, error: null }
}

export async function saveOrgAiConfig(config: {
  openai_api_key?: string
  anthropic_api_key?: string
  openrouter_api_key?: string
  default_model?: string
  default_system_prompt?: string
  default_temperature?: number
  default_max_tokens?: number
  auto_tag_enabled?: boolean
  auto_tag_model?: string
}) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('organization_ai_config')
    .upsert(
      {
        organization_id: orgId,
        openai_api_key: config.openai_api_key || null,
        anthropic_api_key: config.anthropic_api_key || null,
        openrouter_api_key: config.openrouter_api_key || null,
        default_model: config.default_model || 'gpt-4o-mini',
        default_system_prompt: config.default_system_prompt || '',
        default_temperature: config.default_temperature ?? 0.7,
        default_max_tokens: config.default_max_tokens ?? 500,
        auto_tag_enabled: config.auto_tag_enabled ?? false,
        auto_tag_model: config.auto_tag_model || 'gpt-4o-mini',
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' }
    )
    .select()
    .single()

  if (error) return { data: null, error: error.message }

  revalidatePath('/dashboard/mensajeria')
  return { data: data as OrgAiConfig, error: null }
}

/**
 * Obtiene la config de IA para una org específica (usado por el workflow engine).
 * No requiere sesión — se llama desde webhooks con service role.
 */
export async function getAiConfigForOrg(orgId: string): Promise<OrgAiConfig | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organization_ai_config')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  return data as OrgAiConfig | null
}

export interface AiExecutionLog {
  id: string
  executed_at: string
  status: 'success' | 'error' | 'skipped'
  model: string | null
  error_message: string | null
  used_fallback: boolean
  response_preview: string | null
  conversation_id: string | null
  client_name: string | null
  client_phone: string | null
}

/**
 * Lee los últimos logs de nodos AI (éxito + error) para el panel de diagnóstico.
 * Incluye preview de respuesta, modelo usado y si se activó el fallback.
 */
export async function getAiExecutionLogs(limit = 50): Promise<{ data: AiExecutionLog[]; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()

  // Join con workflow_executions → conversations → clients para dar contexto humano
  const { data, error } = await supabase
    .from('workflow_execution_log')
    .select(`
      id, executed_at, status, node_type, output_data, error_message,
      execution:workflow_executions!inner (
        id,
        conversation:conversations!inner (
          id,
          organization_id,
          client:clients ( name, phone )
        )
      )
    `)
    .eq('node_type', 'ai_response')
    .eq('execution.conversation.organization_id', orgId)
    .order('executed_at', { ascending: false })
    .limit(limit)

  if (error) return { data: [], error: error.message }

  const rows: AiExecutionLog[] = (data ?? []).map((row: any) => {
    const out = (row.output_data ?? {}) as Record<string, unknown>
    const conv = row.execution?.conversation
    return {
      id: row.id,
      executed_at: row.executed_at,
      status: row.status,
      model: (out.model as string) ?? null,
      error_message: row.error_message ?? null,
      used_fallback: out.used_fallback === true,
      response_preview: (out.response_preview as string) ?? null,
      conversation_id: conv?.id ?? null,
      client_name: conv?.client?.name ?? null,
      client_phone: conv?.client?.phone ?? null,
    }
  })

  return { data: rows, error: null }
}
