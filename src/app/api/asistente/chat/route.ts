import { NextRequest, NextResponse } from 'next/server'
import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
} from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { requireFeature, requireMonthlyCap, incrementUsage } from '@/lib/actions/entitlements'
import { EntitlementError } from '@/lib/billing/types'
import { getAssistantContext } from '@/lib/asistente/context'
import { buildTools } from '@/lib/asistente/tools'
import { buildSystemPrompt } from '@/lib/asistente/system-prompt'
import { providerForModel, DEFAULT_CHAT_MODEL, isReasoningModel, supportsTemperature } from '@/lib/asistente/models'

export const runtime = 'nodejs'
export const maxDuration = 60

const DOMAIN_KEYS = ['finanzas', 'salarios', 'estadisticas', 'clientes', 'resenas', 'turnos', 'fidelizacion'] as const

function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  let body: { messages?: UIMessage[]; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Body inválido')
  }
  const messages = body.messages ?? []
  const conversationId = body.conversationId ?? null

  // 1) Contexto + org
  const ctx = await getAssistantContext()
  if (!ctx) return jsonError(401, 'No autorizado')

  // 2) Entitlement (Enterprise / add-on)
  try {
    await requireFeature('ai.enabled')
    await requireMonthlyCap('ai_messages_monthly')
  } catch (e) {
    if (e instanceof EntitlementError) return jsonError(403, e.message)
    throw e
  }

  // 3) Rate limit por usuario
  const rl = await rateLimit('asistente_chat', ctx.userId ?? ctx.orgId, { limit: 30, window: 60 })
  if (!rl.allowed) return jsonError(429, 'Demasiadas consultas seguidas. Esperá un momento.')

  // 4) Resolver modelo + key de la org
  const config = ctx.config
  const modelId = config?.assistant_model || DEFAULT_CHAT_MODEL
  const provider = providerForModel(modelId)

  let languageModel
  if (provider === 'anthropic') {
    if (!config?.anthropic_api_key)
      return jsonError(422, 'Falta la API key de Anthropic. Configurala en los ajustes del asistente.', 'no_key')
    languageModel = createAnthropic({ apiKey: config.anthropic_api_key })(modelId)
  } else if (provider === 'openrouter') {
    if (!config?.openrouter_api_key)
      return jsonError(422, 'Falta la API key de OpenRouter.', 'no_key')
    languageModel = createOpenAI({ apiKey: config.openrouter_api_key, baseURL: 'https://openrouter.ai/api/v1' })(modelId)
  } else {
    if (!config?.openai_api_key)
      return jsonError(422, 'Falta la API key de OpenAI. Configurala en los ajustes del asistente.', 'no_key')
    languageModel = createOpenAI({ apiKey: config.openai_api_key })(modelId)
  }

  // 5) System prompt + herramientas
  const enabledDomains = DOMAIN_KEYS.filter((d) => ctx.dataAccess[d] !== false).map((d) => d)
  const system = buildSystemPrompt({
    orgName: ctx.orgName,
    today: new Date().toISOString().slice(0, 10),
    currency: ctx.currency,
    persona: config?.assistant_persona,
    customPrompt: config?.assistant_system_prompt,
    enabledDomains,
    proMode: ctx.proMode,
    branches: ctx.branches,
  })
  const tools = buildTools(ctx)

  // Ajustes por familia de modelo (evita fallos silenciosos):
  // - Los modelos de razonamiento (GPT-5, o1/o3) rechazan `temperature` ≠ 1 → la omitimos.
  // - Su `max_output_tokens` incluye el razonamiento → damos headroom o la respuesta sale vacía.
  const reasoning = isReasoningModel(modelId)
  const temperature = supportsTemperature(modelId) ? (config?.assistant_temperature ?? 0.4) : undefined
  const maxOutputTokens = reasoning
    ? Math.max(config?.assistant_max_tokens ?? 0, 8000)
    : (config?.assistant_max_tokens ?? 2000)
  // Razonamiento bajo: precisión de tools alta con latencia contenida para un chat.
  const providerOptions =
    reasoning && provider === 'openai' ? { openai: { reasoningEffort: 'low' as const } } : undefined

  // 6) Persistir el hilo + el mensaje del usuario (best-effort)
  void persistUserTurn(ctx.orgId, ctx.userId, conversationId, messages)

  // 7) Stream agéntico (usa el fetch propio del AI SDK, sin el timeout de 8s de Supabase)
  const result = streamText({
    model: languageModel,
    system,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
    ...(temperature !== undefined ? { temperature } : {}),
    maxOutputTokens,
    ...(providerOptions ? { providerOptions } : {}),
    onFinish: async ({ text }) => {
      void incrementUsage('ai_messages', 1, ctx.orgId)
      if (conversationId && text) {
        try {
          const supabase = createAdminClient()
          await supabase.from('assistant_messages').insert({
            conversation_id: conversationId,
            organization_id: ctx.orgId,
            role: 'assistant',
            content: text,
          })
          await supabase
            .from('assistant_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        } catch { /* no bloquear */ }
      }
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('[asistente/chat] stream error:', error)
      return 'Tuve un problema al responder. Probá de nuevo en un momento.'
    },
  })
}

async function persistUserTurn(
  orgId: string,
  userId: string | null,
  conversationId: string | null,
  messages: UIMessage[],
) {
  if (!conversationId) return
  try {
    const supabase = createAdminClient()
    const last = messages[messages.length - 1]
    const lastText =
      last?.role === 'user'
        ? (last.parts ?? [])
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join(' ')
            .trim()
        : ''

    // Crear el hilo si no existe (título desde el primer mensaje)
    const { data: existing } = await supabase
      .from('assistant_conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()

    if (!existing) {
      await supabase.from('assistant_conversations').insert({
        id: conversationId,
        organization_id: orgId,
        user_id: userId,
        title: lastText ? lastText.slice(0, 80) : 'Nueva conversación',
      })
    }

    if (lastText) {
      await supabase.from('assistant_messages').insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: 'user',
        content: lastText,
      })
    }
  } catch {
    /* best-effort */
  }
}
