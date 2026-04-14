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

export async function createConversationTag(
  name: string,
  color: string,
  description?: string,
  aiAutoAssign?: boolean
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: null, error: 'No autorizado' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversation_tags')
    .insert({
      organization_id: orgId,
      name: name.trim(),
      color,
      description: description?.trim() || null,
      ai_auto_assign: aiAutoAssign ?? false,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { data, error: null }
}

export async function updateConversationTag(
  tagId: string,
  updates: {
    name?: string
    color?: string
    description?: string | null
    ai_auto_assign?: boolean
  }
) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }

  const supabase = createAdminClient()
  const payload: Record<string, unknown> = {}
  if (updates.name !== undefined) payload.name = updates.name.trim()
  if (updates.color !== undefined) payload.color = updates.color
  if (updates.description !== undefined) payload.description = updates.description?.trim() || null
  if (updates.ai_auto_assign !== undefined) payload.ai_auto_assign = updates.ai_auto_assign

  const { error } = await supabase
    .from('conversation_tags')
    .update(payload)
    .eq('id', tagId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { error: null }
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

// ─── Auto-etiquetado con IA ──────────────────────────────────────────────────

/**
 * Ejecuta el auto-etiquetado con IA sobre una conversación.
 * Lee los últimos mensajes + las etiquetas con ai_auto_assign=true,
 * construye un prompt de clasificación y asigna las etiquetas resultantes.
 */
export async function autoTagConversation(conversationId: string) {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { applied: [], error: 'No autorizado' }

  const supabase = createAdminClient()

  // 1. Obtener etiquetas con auto-assign activado
  const { data: aiTags } = await supabase
    .from('conversation_tags')
    .select('id, name, description')
    .eq('organization_id', orgId)
    .eq('ai_auto_assign', true)

  if (!aiTags || aiTags.length === 0) {
    return { applied: [], error: 'No hay etiquetas con auto-asignación IA activada' }
  }

  // 2. Obtener config IA
  const { data: aiConfig } = await supabase
    .from('organization_ai_config')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (!aiConfig) {
    return { applied: [], error: 'Configurá la IA primero en Config → IA' }
  }

  // 3. Últimos mensajes de la conversación
  const { data: messages } = await supabase
    .from('messages')
    .select('direction, content, content_type')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive'])
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15)

  if (!messages || messages.length === 0) {
    return { applied: [], error: 'No hay mensajes para analizar' }
  }

  const conversation = messages
    .reverse()
    .filter(m => m.content?.trim())
    .map(m => `[${m.direction === 'inbound' ? 'Cliente' : 'Negocio'}]: ${m.content}`)
    .join('\n')

  // 4. Etiquetas actuales de la conversación (para no re-asignar)
  const { data: currentTags } = await supabase
    .from('conversation_tag_assignments')
    .select('tag_id')
    .eq('conversation_id', conversationId)

  const currentTagIds = new Set((currentTags ?? []).map(t => t.tag_id))

  // 5. Construir prompt
  const tagList = aiTags
    .map(t => `- ID: "${t.id}" | Nombre: "${t.name}" | Descripción: ${t.description || 'Sin descripción'}`)
    .join('\n')

  const systemPrompt = `Sos un asistente de clasificación de conversaciones de un negocio.
Tu tarea es analizar la conversación y determinar qué etiquetas aplican.

ETIQUETAS DISPONIBLES:
${tagList}

REGLAS:
- Analizá el contenido y la intención de los mensajes del cliente
- Devolvé ÚNICAMENTE un JSON array con los IDs de las etiquetas que aplican
- Si ninguna etiqueta aplica, devolvé un array vacío: []
- No inventes IDs, usá solo los que están en la lista
- Podés asignar múltiples etiquetas si aplican
- Sé conservador: solo asigná si hay evidencia clara en la conversación

Respondé SOLO con el JSON array, sin explicación ni markdown.`

  const userMessage = `CONVERSACIÓN:\n${conversation}`

  // 6. Llamar a la IA
  const model = aiConfig.auto_tag_model || aiConfig.default_model || 'gpt-4o-mini'
  const provider = getAiProviderForModel(model)
  const apiKey = provider === 'anthropic'
    ? aiConfig.anthropic_api_key
    : provider === 'openrouter'
      ? aiConfig.openrouter_api_key
      : aiConfig.openai_api_key

  if (!apiKey) {
    const providerName = provider === 'anthropic' ? 'Anthropic' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'
    return { applied: [], error: `No hay API key de ${providerName} configurada` }
  }

  try {
    const aiResponse = await callAiForTagging({ model, systemPrompt, userMessage, apiKey, provider })
    
    // 7. Parsear respuesta
    let tagIds: string[] = []
    try {
      const cleaned = aiResponse.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
      tagIds = JSON.parse(cleaned)
      if (!Array.isArray(tagIds)) tagIds = []
    } catch {
      return { applied: [], error: 'La IA devolvió una respuesta inválida' }
    }

    // Filtrar solo IDs válidos que existen en aiTags
    const validIds = new Set(aiTags.map(t => t.id))
    tagIds = tagIds.filter(id => typeof id === 'string' && validIds.has(id))

    // 8. Asignar etiquetas nuevas (no re-asignar las que ya tiene)
    const applied: string[] = []
    for (const tagId of tagIds) {
      if (currentTagIds.has(tagId)) continue
      const { error } = await supabase
        .from('conversation_tag_assignments')
        .upsert({ conversation_id: conversationId, tag_id: tagId }, { onConflict: 'conversation_id,tag_id' })
      if (!error) applied.push(tagId)
    }

    return { applied, error: null }
  } catch (err) {
    return { applied: [], error: (err as Error).message }
  }
}

// Helper: Determina el provider de IA según el modelo
function getAiProviderForModel(model: string): 'openai' | 'anthropic' | 'openrouter' {
  if (model.startsWith('claude') || model.startsWith('anthropic/')) return 'anthropic'
  if (model.includes('/')) return 'openrouter'
  return 'openai'
}

// Helper: Llama a la IA para clasificación de etiquetas
async function callAiForTagging(params: {
  model: string
  systemPrompt: string
  userMessage: string
  apiKey: string
  provider: 'openai' | 'anthropic' | 'openrouter'
}): Promise<string> {
  const { model, systemPrompt, userMessage, apiKey, provider } = params

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? '[]'
  }

  // OpenAI / OpenRouter
  const baseUrl = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1'
    : 'https://api.openai.com/v1'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })
  if (!res.ok) throw new Error(`${provider} API error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? '[]'
}
