'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'

export interface OrgAiConfig {
  id: string
  organization_id: string
  openai_api_key: string | null
  anthropic_api_key: string | null
  default_model: string
  default_system_prompt: string
  default_temperature: number
  default_max_tokens: number
  is_active: boolean
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
  default_model?: string
  default_system_prompt?: string
  default_temperature?: number
  default_max_tokens?: number
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
        default_model: config.default_model || 'gpt-4o-mini',
        default_system_prompt: config.default_system_prompt || '',
        default_temperature: config.default_temperature ?? 0.7,
        default_max_tokens: config.default_max_tokens ?? 500,
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
