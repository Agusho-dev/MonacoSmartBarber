/**
 * Motor de ejecución de workflows de automatización.
 *
 * Se ejecuta dentro de los webhooks (route handlers), NO como server action.
 * Recibe un SupabaseClient con service_role y el orgId directamente.
 *
 * Flujo:
 * 1. evaluateIncomingMessage() — punto de entrada, decide si hay workflow activo o trigger nuevo
 * 2. executeNode() — ejecuta un nodo y avanza al siguiente
 * 3. handleInteractiveReply() — procesa respuestas de botones/listas
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const META_API_VERSION = 'v22.0'

// ─── Tipos internos ──────────────────────────────────────────────

interface WaConfig {
  whatsapp_access_token: string
  whatsapp_phone_id: string
}

interface IgConfig {
  instagram_page_access_token: string
}

interface WorkflowNode {
  id: string
  workflow_id: string
  node_type: string
  label: string
  config: Record<string, unknown>
  is_entry_point: boolean
}

interface WorkflowEdge {
  id: string
  source_node_id: string
  target_node_id: string
  source_handle: string
  condition_value: string | null
}

interface ExecutionContext {
  last_button_id?: string
  last_button_title?: string
  last_text_reply?: string
  client_name?: string
  client_first_name?: string
  variables?: Record<string, string>
  [key: string]: unknown
}

// Trae los últimos N mensajes de la conversación como historial para la IA.
async function fetchConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data: messages } = await supabase
    .from('messages')
    .select('direction, content, content_type, created_at')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive'])
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (!messages || messages.length === 0) return []

  return messages
    .reverse()
    .filter(m => m.content?.trim())
    .map(m => ({
      role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
      content: m.content!,
    }))
}

// Devuelve el nombre completo y el primer nombre del contacto de una conversación.
// Prioriza clients.name (si la conversación está linkeada a un cliente), y si no
// cae en platform_user_name (display name del provider).
async function fetchClientInfo(
  supabase: SupabaseClient,
  conversationId: string
): Promise<{ fullName: string; firstName: string }> {
  const { data } = await supabase
    .from('conversations')
    .select('platform_user_name, client:clients(name)')
    .eq('id', conversationId)
    .maybeSingle()
  const rawClient = data?.client as { name?: string } | { name?: string }[] | null | undefined
  const clientName = Array.isArray(rawClient) ? rawClient[0]?.name : rawClient?.name
  const fullName = (clientName ?? data?.platform_user_name ?? '').trim()
  const firstName = fullName.split(/\s+/)[0] ?? ''
  return { fullName, firstName }
}

// ─── Helpers ─────────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Resuelve la branch_id de una conversación a través del canal social.
async function getConversationBranchId(
  supabase: SupabaseClient,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('channel:social_channels(branch_id)')
    .eq('id', conversationId)
    .maybeSingle()
  const channel = data?.channel as { branch_id?: string } | { branch_id?: string }[] | null
  const branchId = Array.isArray(channel) ? channel[0]?.branch_id : channel?.branch_id
  return branchId ?? null
}

// Filtra workflows por branch: incluye los de esa branch + los generales (sin branch).
function matchesBranch(wf: { branch_id?: string | null }, branchId: string | null): boolean {
  if (!wf.branch_id) return true // workflow general → aplica a todas
  if (!branchId) return true // no se pudo resolver branch → no filtrar
  return wf.branch_id === branchId
}

// ─── Punto de entrada principal ──────────────────────────────────

/**
 * Evalúa un mensaje entrante y ejecuta el workflow correspondiente.
 * Llamado desde los webhooks de WhatsApp e Instagram.
 */
export async function evaluateIncomingMessage(params: {
  orgId: string
  conversationId: string
  text: string
  platform: 'whatsapp' | 'instagram'
  messageType: string // 'text' | 'interactive' | 'button'
  interactivePayload?: {
    type?: string // 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  waConfig?: WaConfig | null
  igConfig?: IgConfig | null
  platformUserId: string // número de teléfono o ID del usuario
}): Promise<void> {
  const supabase = getSupabase()
  const { orgId, conversationId, text, platform, messageType, interactivePayload } = params

  // Cacheamos el nombre del cliente y la branch de la conversación
  const [clientInfo, branchId] = await Promise.all([
    fetchClientInfo(supabase, conversationId),
    getConversationBranchId(supabase, conversationId),
  ])

  try {
    // 1. Chequear si hay un workflow en estado waiting_reply para esta conversación
    let { data: activeExec } = await supabase
      .from('workflow_executions')
      .select('*, current_node:workflow_nodes(*)')
      .eq('conversation_id', conversationId)
      .in('status', ['waiting_reply'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // 1b. Si no hay ejecución activa en esta conversación, buscar en conversaciones
    // duplicadas del mismo teléfono (safety net para datos legacy con dedup roto)
    if (!activeExec && params.platformUserId) {
      const phoneSuffix = params.platformUserId.slice(-10)
      if (phoneSuffix.length === 10) {
        const { data: siblingConvs } = await supabase
          .from('conversations')
          .select('id')
          .neq('id', conversationId)
          .ilike('platform_user_id', `%${phoneSuffix}`)
        const siblingIds = siblingConvs?.map(c => c.id) ?? []
        if (siblingIds.length > 0) {
          const { data: siblingExec } = await supabase
            .from('workflow_executions')
            .select('*, current_node:workflow_nodes(*)')
            .in('conversation_id', siblingIds)
            .in('status', ['waiting_reply'])
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (siblingExec) {
            // Migrar la ejecución a la conversación canónica (la actual del webhook)
            await supabase
              .from('workflow_executions')
              .update({ conversation_id: conversationId })
              .eq('id', siblingExec.id)
            activeExec = siblingExec
          }
        }
      }
    }

    if (activeExec) {
      // Hay un workflow esperando respuesta — procesar
      const node = activeExec.current_node as WorkflowNode | null
      if (node) {
        const ctx: ExecutionContext = (activeExec.context as ExecutionContext) ?? {}
        // Refrescar identidad del cliente en el contexto si cambió o falta
        if (clientInfo.fullName) ctx.client_name = clientInfo.fullName
        if (clientInfo.firstName) ctx.client_first_name = clientInfo.firstName

        // Limpiar valores de la iteración anterior antes de procesar la nueva respuesta
        ctx.last_button_id = undefined
        ctx.last_button_title = undefined
        ctx.last_text_reply = undefined

        if (messageType === 'interactive' || messageType === 'button') {
          // Respuesta interactiva (botón o lista)
          const buttonReply = interactivePayload?.button_reply ?? interactivePayload?.list_reply
          if (buttonReply) {
            ctx.last_button_id = buttonReply.id
            ctx.last_button_title = buttonReply.title
          }
        } else {
          // Respuesta de texto
          ctx.last_text_reply = text
        }

        // Actualizar contexto y seguir ejecutando
        await supabase
          .from('workflow_executions')
          .update({
            status: 'active',
            context: ctx,
            conversation_id: conversationId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeExec.id)

        // Log
        await logExecution(supabase, activeExec.id, node.id, node.node_type, 'success', { reply: text || interactivePayload })

        // El nodo wait_reply terminó. Buscar el siguiente edge.
        await advanceFromNode(supabase, activeExec.id, activeExec.workflow_id, node.id, ctx, params)
        return
      }
    }

    // 2. No hay workflow activo — buscar por keyword trigger
    if (text && messageType === 'text') {
      const { data: matchedWorkflows } = await supabase
        .from('automation_workflows')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .eq('trigger_type', 'keyword')
        .order('priority', { ascending: false })

      if (matchedWorkflows && matchedWorkflows.length > 0) {
        const lowerText = text.toLowerCase()
        for (const wf of matchedWorkflows) {
          // Chequear branch (workflows de esa branch + generales)
          if (!matchesBranch(wf, branchId)) continue
          // Chequear canal
          const channels = wf.channels as string[]
          if (!channels.includes('all') && !channels.includes(platform)) continue

          // Chequear keywords
          const config = wf.trigger_config as Record<string, unknown>
          const keywords = (config.keywords as string[]) ?? []
          const matchMode = (config.match_mode as string) ?? 'contains'

          const matched = matchMode === 'exact'
            ? keywords.some(kw => lowerText === kw.toLowerCase())
            : keywords.some(kw => lowerText.includes(kw.toLowerCase()))

          if (matched) {
            await startWorkflowExecution(supabase, wf.id, conversationId, 'keyword', params, {
              client_name: clientInfo.fullName,
              client_first_name: clientInfo.firstName,
            })
            return
          }
        }
      }
    }

    // 3. Si es un interactive reply sin workflow activo, buscar por template_reply trigger
    if (messageType === 'interactive' || messageType === 'button') {
      const buttonReply = interactivePayload?.button_reply ?? interactivePayload?.list_reply
      if (buttonReply) {
        const { data: templateWorkflows } = await supabase
          .from('automation_workflows')
          .select('*')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .eq('trigger_type', 'template_reply')
          .order('priority', { ascending: false })

        if (templateWorkflows && templateWorkflows.length > 0) {
          for (const wf of templateWorkflows) {
            // Chequear branch
            if (!matchesBranch(wf, branchId)) continue
            const channels = wf.channels as string[]
            if (!channels.includes('all') && !channels.includes(platform)) continue

            // Iniciar workflow con contexto del botón
            const initialContext: ExecutionContext = {
              last_button_id: buttonReply.id,
              last_button_title: buttonReply.title,
              client_name: clientInfo.fullName,
              client_first_name: clientInfo.firstName,
            }
            await startWorkflowExecution(supabase, wf.id, conversationId, 'template_reply', params, initialContext)
            return
          }
        }
      }
    }

    // 4. Trigger genérico: message_received (cualquier mensaje, menor prioridad)
    {
      const { data: anyMsgWorkflows } = await supabase
        .from('automation_workflows')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .eq('trigger_type', 'message_received')
        .order('priority', { ascending: false })

      if (anyMsgWorkflows && anyMsgWorkflows.length > 0) {
        for (const wf of anyMsgWorkflows) {
          if (!matchesBranch(wf, branchId)) continue
          const channels = wf.channels as string[]
          if (!channels.includes('all') && !channels.includes(platform)) continue

          await startWorkflowExecution(supabase, wf.id, conversationId, 'message_received', params, {
            client_name: clientInfo.fullName,
            client_first_name: clientInfo.firstName,
            last_text_reply: text,
          })
          return
        }
      }
    }

    // 5. Fallback: ejecutar auto_reply_rules legacy (retrocompatibilidad)
    // Esto mantiene las reglas viejas funcionando hasta que se migren
    if (text && messageType === 'text') {
      await executeLegacyAutoReply(supabase, orgId, conversationId, text, platform, params)
    }

    // 6. Polling oportunista: avanzar delays largos vencidos.
    // Funciona como red de seguridad si el cron no está configurado.
    // No bloquea el flujo si falla.
    processExpiredDelays().catch(err => console.error('[WorkflowEngine] processExpiredDelays fallback:', err))
  } catch (err) {
    console.error('[WorkflowEngine] Error evaluando mensaje:', err)
  } finally {
    // Auto-tag global con IA: debe ejecutarse también cuando hay return temprano
    // (workflow activo, keyword, message_received, etc.) — antes solo corría en el “happy path”.
    runGlobalAutoTag(supabase, orgId, conversationId).catch(err =>
      console.error('[WorkflowEngine] Auto-tag error:', err)
    )
  }
}

// Verifica si el nodo inmediatamente siguiente espera una respuesta del usuario
// (condition con button_response, wait_reply, o send_buttons).
async function nextNodeExpectsReply(
  supabase: SupabaseClient,
  workflowId: string,
  currentNodeId: string,
): Promise<boolean> {
  const { data: edges } = await supabase
    .from('workflow_edges')
    .select('target_node_id')
    .eq('workflow_id', workflowId)
    .eq('source_node_id', currentNodeId)
    .limit(1)

  if (!edges || edges.length === 0) return false

  const { data: nextNode } = await supabase
    .from('workflow_nodes')
    .select('node_type, config')
    .eq('id', edges[0].target_node_id)
    .maybeSingle()

  if (!nextNode) return false

  if (nextNode.node_type === 'wait_reply') return true
  if (nextNode.node_type === 'condition') {
    const condType = (nextNode.config as Record<string, unknown>)?.type as string | undefined
    return condType === 'button_response'
  }
  return false
}

// ─── Iniciar ejecución de workflow ───────────────────────────────

async function startWorkflowExecution(
  supabase: SupabaseClient,
  workflowId: string,
  conversationId: string,
  triggeredBy: string,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  initialContext?: ExecutionContext
): Promise<void> {
  // Cancelar ejecuciones activas previas de esta conversación
  await supabase
    .from('workflow_executions')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .in('status', ['active', 'waiting_reply'])

  // Buscar nodo de entrada
  const { data: entryNode } = await supabase
    .from('workflow_nodes')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('is_entry_point', true)
    .limit(1)
    .maybeSingle()

  if (!entryNode) {
    console.warn('[WorkflowEngine] Workflow sin nodo de entrada:', workflowId)
    return
  }

  // Crear ejecución
  const { data: execution } = await supabase
    .from('workflow_executions')
    .insert({
      workflow_id: workflowId,
      conversation_id: conversationId,
      current_node_id: entryNode.id,
      status: 'active',
      context: initialContext ?? {},
      triggered_by: triggeredBy,
    })
    .select('id')
    .single()

  if (!execution) return

  // El trigger node no hace nada por sí mismo, avanzar al siguiente
  await logExecution(supabase, execution.id, entryNode.id, 'trigger', 'success', { triggeredBy })
  await advanceFromNode(supabase, execution.id, workflowId, entryNode.id, initialContext ?? {}, params)
}

// ─── Avanzar desde un nodo al siguiente ──────────────────────────

async function advanceFromNode(
  supabase: SupabaseClient,
  executionId: string,
  workflowId: string,
  currentNodeId: string,
  context: ExecutionContext,
  params: Parameters<typeof evaluateIncomingMessage>[0]
): Promise<void> {
  // Protección anti-infinite: máximo 100 nodos por ejecución
  context.variables = context.variables ?? {}
  const stepCount = parseInt(context.variables._step_count ?? '0') + 1
  context.variables._step_count = String(stepCount)
  if (stepCount > 100) {
    await supabase
      .from('workflow_executions')
      .update({ status: 'error', context, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', executionId)
    await logExecution(supabase, executionId, currentNodeId, 'system', 'error', {}, 'Límite de 100 nodos alcanzado — posible loop infinito')
    return
  }

  // Buscar edges que salen del nodo actual
  const { data: edges } = await supabase
    .from('workflow_edges')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('source_node_id', currentNodeId)
    .order('sort_order')

  if (!edges || edges.length === 0) {
    // No hay siguiente — workflow completado
    await supabase
      .from('workflow_executions')
      .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', executionId)
    return
  }

  // Determinar qué edge seguir
  let targetNodeId: string | null = null

  // Si el nodo actual tiene edges con condition_value, matchear
  const conditionalEdges = edges.filter(e => e.condition_value)

  // Routing especial para loop nodes: usar la dirección interna
  const loopDirection = context.variables?.[`_loop_${currentNodeId}_direction`]
  if (loopDirection && conditionalEdges.length > 0) {
    const matchedEdge = conditionalEdges.find(e =>
      (e.condition_value as string)?.toLowerCase() === loopDirection
    ) ?? edges.find(e => e.source_handle === loopDirection)
    if (matchedEdge) targetNodeId = matchedEdge.target_node_id
    // Limpiar la dirección temporal
    delete context.variables[`_loop_${currentNodeId}_direction`]
  }

  if (!targetNodeId) {
    // Meta envía button_reply.id (ej. btn_1) y title (ej. "Si"). Las aristas guardan cond.id:
    // debe coincidir con el id de Meta O con el texto del botón / mensaje libre.
    const replyId = (context.last_button_id ?? '').trim()
    const replyTitle = (context.last_button_title ?? '').trim()
    const replyText = (context.last_text_reply ?? '').trim()
    const replyForMatch = replyId || replyTitle || replyText

    const matchesConditionValue = (cv: string | null | undefined): boolean => {
      if (cv == null) return false
      const c = String(cv).trim()
      if (!c) return false
      if (replyId && replyId === c) return true
      if (replyTitle && replyTitle.toLowerCase() === c.toLowerCase()) return true
      if (!replyId && replyText && replyText.toLowerCase() === c.toLowerCase()) return true
      return false
    }

    if (conditionalEdges.length > 0 && replyForMatch) {
      const matchedEdge = conditionalEdges.find(e => matchesConditionValue(e.condition_value as string))
      if (matchedEdge) {
        targetNodeId = matchedEdge.target_node_id
      } else {
        // Buscar edge "default" (sin condition_value)
        const defaultEdge = edges.find(e => !e.condition_value || e.source_handle === 'default')
        if (defaultEdge) targetNodeId = defaultEdge.target_node_id
      }
    } else {
      // Sin condiciones — tomar el primer edge (default)
      targetNodeId = edges[0].target_node_id
    }
  }

  if (!targetNodeId) {
    await supabase
      .from('workflow_executions')
      .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', executionId)
    return
  }

  // Cargar el nodo target y ejecutarlo
  const { data: nextNode } = await supabase
    .from('workflow_nodes')
    .select('*')
    .eq('id', targetNodeId)
    .single()

  if (!nextNode) {
    await supabase
      .from('workflow_executions')
      .update({ status: 'error', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', executionId)
    return
  }

  // Actualizar current_node_id
  await supabase
    .from('workflow_executions')
    .update({ current_node_id: nextNode.id, context, updated_at: new Date().toISOString() })
    .eq('id', executionId)

  // Ejecutar el nodo
  await executeNode(supabase, executionId, workflowId, nextNode as WorkflowNode, context, params)
}

// ─── Ejecutar un nodo ────────────────────────────────────────────

async function executeNode(
  supabase: SupabaseClient,
  executionId: string,
  workflowId: string,
  node: WorkflowNode,
  context: ExecutionContext,
  params: Parameters<typeof evaluateIncomingMessage>[0]
): Promise<void> {
  const config = node.config

  try {
    switch (node.node_type) {
      case 'send_message': {
        const text = resolveVariables(config.text as string || '', context, params)
        await sendPlatformMessage(supabase, params, text)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { text })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'send_media': {
        const caption = resolveVariables(config.caption as string || '', context, params)
        const mediaUrl = config.media_url as string
        const mediaType = config.media_type as string || 'image'
        await sendPlatformMedia(supabase, params, mediaUrl, mediaType, caption)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { mediaUrl, mediaType })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'send_buttons': {
        const body = resolveVariables(
          (config.body as string) || (config.text as string) || '',
          context,
          params
        )
        const raw = (config.buttons as Array<{ id: string; title: string }>) ?? []
        const buttons = raw.filter(b => b && String(b.id).trim() && String(b.title).trim())
        if (buttons.length === 0) {
          const fallback = body.trim() || 'Mensaje sin botones configurados.'
          await sendPlatformMessage(supabase, params, fallback)
          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { warning: 'sin_botones', fallback })
        } else if (params.platform === 'whatsapp' && params.waConfig) {
          await sendWhatsAppButtons(supabase, params, body, buttons)
          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { body, buttons })
        } else {
          const lines = buttons.map(b => `▸ ${b.title}`).join('\n')
          const combined = [body.trim(), lines].filter(Boolean).join('\n\n')
          await sendPlatformMessage(supabase, params, combined || lines)
          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { warning: 'botones_no_interactivos', body, buttons })
        }
        // Después de enviar botones, poner en espera
        await supabase
          .from('workflow_executions')
          .update({ status: 'waiting_reply', current_node_id: node.id, updated_at: new Date().toISOString() })
          .eq('id', executionId)
        break
      }

      case 'send_list': {
        const body = resolveVariables(config.body as string || '', context, params)
        const buttonText = config.button_text as string || 'Ver opciones'
        const sections = config.sections as Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
        await sendWhatsAppList(supabase, params, body, buttonText, sections)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { body })
        // Después de enviar lista, poner en espera
        await supabase
          .from('workflow_executions')
          .update({ status: 'waiting_reply', current_node_id: node.id, updated_at: new Date().toISOString() })
          .eq('id', executionId)
        break
      }

      case 'send_template': {
        const templateName = config.template_name as string
        const languageCode = config.language_code as string || 'es_AR'
        await sendWhatsAppTemplate(supabase, params, templateName, languageCode)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { templateName })

        // Si el siguiente nodo espera interacción del usuario (condition con
        // button_response o wait_reply), pausar en waiting_reply en vez de avanzar
        // inmediatamente — el template tiene botones y necesitamos la respuesta.
        const shouldWait = await nextNodeExpectsReply(supabase, workflowId, node.id)
        if (shouldWait) {
          await supabase
            .from('workflow_executions')
            .update({ status: 'waiting_reply', current_node_id: node.id, updated_at: new Date().toISOString() })
            .eq('id', executionId)
        } else {
          await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        }
        break
      }

      case 'add_tag': {
        const tagId = config.tag_id as string
        if (tagId) {
          await supabase
            .from('conversation_tag_assignments')
            .upsert(
              { conversation_id: params.conversationId, tag_id: tagId },
              { onConflict: 'conversation_id,tag_id' }
            )
        }
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { tagId })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'remove_tag': {
        const tagId = config.tag_id as string
        if (tagId) {
          await supabase
            .from('conversation_tag_assignments')
            .delete()
            .eq('conversation_id', params.conversationId)
            .eq('tag_id', tagId)
        }
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { tagId })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'condition': {
        // El nodo condition evalúa el contexto y deja que advanceFromNode resuelva el edge correcto
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { context })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'wait_reply': {
        // Poner en espera
        await supabase
          .from('workflow_executions')
          .update({ status: 'waiting_reply', current_node_id: node.id, updated_at: new Date().toISOString() })
          .eq('id', executionId)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', {})
        break
      }

      case 'crm_alert': {
        const alertType = (config.alert_type as string) || 'info'
        const title = resolveVariables(config.title as string || 'Alerta del workflow', context, params)
        const message = resolveVariables(config.message as string || '', context, params)

        // Obtener org_id del workflow
        const { data: wf } = await supabase
          .from('automation_workflows')
          .select('organization_id')
          .eq('id', workflowId)
          .single()

        if (wf) {
          await supabase.from('crm_alerts').insert({
            organization_id: wf.organization_id,
            conversation_id: params.conversationId,
            workflow_execution_id: executionId,
            alert_type: alertType,
            title,
            message,
            metadata: {
              workflow_id: workflowId,
              button_pressed: context.last_button_title,
              platform: params.platform,
            },
          })
        }
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { alertType, title })
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'delay': {
        const seconds = Math.max(0, (config.seconds as number) ?? 5)

        if (seconds <= 10) {
          // Delays cortos: ejecutar inline dentro del mismo request.
          // Funciona sin cron y es la UX esperada para pausas pequeñas entre mensajes.
          await new Promise(r => setTimeout(r, seconds * 1000))
          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { seconds, mode: 'inline' })
          await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
          break
        }

        // Delays largos: quedan en waiting_reply con delay_until. Se resuelven por
        // processExpiredDelays() — que se llama desde el cron si está configurado,
        // y oportunísticamente desde el webhook cuando llegan mensajes nuevos.
        const delayUntilDate = new Date(Date.now() + seconds * 1000).toISOString()
        await supabase
          .from('workflow_executions')
          .update({
            status: 'waiting_reply',
            current_node_id: node.id,
            context: { ...context, delay_until: delayUntilDate },
            updated_at: new Date().toISOString(),
          })
          .eq('id', executionId)
        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { seconds, mode: 'deferred', delay_until: delayUntilDate })
        break
      }

      case 'ai_response': {
        // Obtener config de IA de la organización
        const { data: wfForAi } = await supabase
          .from('automation_workflows')
          .select('organization_id')
          .eq('id', workflowId)
          .single()

        const { data: orgAiConfig } = await supabase
          .from('organization_ai_config')
          .select('*')
          .eq('organization_id', wfForAi?.organization_id ?? '')
          .eq('is_active', true)
          .maybeSingle()

        if (!orgAiConfig) {
          throw new Error('No hay configuración de IA para esta organización. Configurala en Mensajería → Config → IA.')
        }

        const model = (config.model as string) || orgAiConfig.default_model || 'gpt-4o-mini'
        const systemPrompt = resolveVariables(
          (config.system_prompt as string) || orgAiConfig.default_system_prompt || '',
          context, params
        )
        const temperature = (config.temperature as number) ?? orgAiConfig.default_temperature ?? 0.7
        const maxTokens = (config.max_tokens as number) ?? orgAiConfig.default_max_tokens ?? 500
        const userMessage = context.last_text_reply || context.last_button_title || ''

        const provider = getAiProvider(model)
        const apiKey = provider === 'anthropic'
          ? orgAiConfig.anthropic_api_key
          : provider === 'openrouter'
            ? orgAiConfig.openrouter_api_key
            : orgAiConfig.openai_api_key

        if (!apiKey) {
          const providerName = provider === 'anthropic' ? 'Anthropic' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'
          throw new Error(`No hay API key de ${providerName} configurada para el modelo "${model}". Configurala en Mensajería → Config → IA.`)
        }

        // Memoria de conversación: traer mensajes previos como contexto
        const memoryLimit = (config.memory_messages as number) ?? 10
        let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
        if (memoryLimit > 0) {
          conversationHistory = await fetchConversationHistory(supabase, params.conversationId, memoryLimit)
        }

        // Retry con backoff para errores transitorios (429, 5xx)
        let aiResponse = ''
        let lastAiError: Error | null = null
        const maxRetries = 2

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
            aiResponse = await callAiModel({ model, systemPrompt, userMessage, temperature, maxTokens, apiKey, conversationHistory })
            lastAiError = null
            break
          } catch (err) {
            lastAiError = err as Error
            const msg = lastAiError.message
            const isRetryable = msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503')
            if (!isRetryable) break // No reintentar errores de auth, modelo inválido, etc.
          }
        }

        if (lastAiError) {
          // Fallback: usar mensaje configurable en vez de matar el workflow
          aiResponse = (config.fallback_message as string)
            || 'Disculpá, no pude procesar tu consulta en este momento. Un agente te va a responder pronto.'
          await logExecution(supabase, executionId, node.id, node.node_type, 'error',
            { model, error: lastAiError.message, used_fallback: true }, lastAiError.message)
        }

        await sendPlatformMessage(supabase, params, aiResponse)

        context.variables = context.variables ?? {}
        context.variables.ai_response = aiResponse

        await supabase
          .from('workflow_executions')
          .update({ context, updated_at: new Date().toISOString() })
          .eq('id', executionId)

        if (!lastAiError) {
          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { model, response_preview: aiResponse.slice(0, 200) })
        }
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'handoff_human': {
        const clientMessage = resolveVariables(config.client_message as string || '', context, params)
        if (clientMessage) {
          await sendPlatformMessage(supabase, params, clientMessage)
        }

        if (config.create_alert !== false) {
          const { data: wf } = await supabase
            .from('automation_workflows')
            .select('organization_id')
            .eq('id', workflowId)
            .single()

          if (wf) {
            await supabase.from('crm_alerts').insert({
              organization_id: wf.organization_id,
              conversation_id: params.conversationId,
              workflow_execution_id: executionId,
              alert_type: (config.alert_type as string) || 'urgent',
              title: 'Transferencia a agente humano',
              message: `El workflow derivó esta conversación a un agente. Cliente: ${context.client_name || 'Desconocido'}`,
              metadata: {
                workflow_id: workflowId,
                assign_to: config.assign_to,
                platform: params.platform,
              },
            })
          }
        }

        // Marcar ejecución como completada — el humano toma el control
        await supabase
          .from('workflow_executions')
          .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', executionId)

        await logExecution(supabase, executionId, node.id, node.node_type, 'success', { assign_to: config.assign_to })
        // NO avanzar — el workflow se detiene aquí
        break
      }

      case 'http_request': {
        const url = resolveVariables(config.url as string || '', context, params)
        const method = (config.method as string) || 'POST'
        const headers = (config.headers as Record<string, string>) ?? {}
        const bodyTemplate = resolveVariables(config.body_template as string || '', context, params)
        const responseVar = (config.response_variable as string) || 'http_response'

        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10000)
          const resp = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: method !== 'GET' ? bodyTemplate : undefined,
            signal: controller.signal,
          })
          clearTimeout(timeout)
          const responseText = await resp.text()

          context.variables = context.variables ?? {}
          context.variables[responseVar] = responseText

          await supabase
            .from('workflow_executions')
            .update({ context, updated_at: new Date().toISOString() })
            .eq('id', executionId)

          await logExecution(supabase, executionId, node.id, node.node_type, 'success', { url, status: resp.status })
        } catch (err) {
          await logExecution(supabase, executionId, node.id, node.node_type, 'error', { url }, (err as Error).message)
        }
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'loop': {
        const maxIterations = (config.max_iterations as number) ?? 3
        const loopKey = `_loop_${node.id}_count`
        context.variables = context.variables ?? {}
        const currentCount = parseInt(context.variables[loopKey] ?? '0')

        if (currentCount < maxIterations) {
          context.variables[loopKey] = String(currentCount + 1)
          context.variables[`_loop_${node.id}_direction`] = 'continue'
          await logExecution(supabase, executionId, node.id, 'loop', 'success', {
            iteration: currentCount + 1, max: maxIterations,
          })
        } else {
          context.variables[loopKey] = '0'
          context.variables[`_loop_${node.id}_direction`] = 'done'
          await logExecution(supabase, executionId, node.id, 'loop', 'success', {
            iteration: 'done', max: maxIterations,
          })
        }

        await supabase
          .from('workflow_executions')
          .update({ context, updated_at: new Date().toISOString() })
          .eq('id', executionId)
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      case 'ai_auto_tag': {
        // Nodo de workflow que ejecuta auto-etiquetado con IA
        const { data: wfForTag } = await supabase
          .from('automation_workflows')
          .select('organization_id')
          .eq('id', workflowId)
          .single()

        if (!wfForTag) {
          throw new Error('No se pudo obtener la org del workflow')
        }

        const tagResult = await runAutoTagForOrg(supabase, wfForTag.organization_id, params.conversationId)
        await logExecution(supabase, executionId, node.id, node.node_type, tagResult.error ? 'error' : 'success',
          { applied: tagResult.applied }, tagResult.error || undefined)
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
        break
      }

      default:
        console.warn('[WorkflowEngine] Tipo de nodo no soportado:', node.node_type)
        await logExecution(supabase, executionId, node.id, node.node_type, 'skipped', {})
        await advanceFromNode(supabase, executionId, workflowId, node.id, context, params)
    }
  } catch (err) {
    console.error('[WorkflowEngine] Error ejecutando nodo:', node.id, err)
    await logExecution(supabase, executionId, node.id, node.node_type, 'error', {}, (err as Error).message)
    await supabase
      .from('workflow_executions')
      .update({ status: 'error', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', executionId)
  }
}

// ─── Funciones de envío por plataforma ───────────────────────────

async function sendPlatformMessage(
  supabase: SupabaseClient,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  text: string
): Promise<void> {
  if (params.platform === 'whatsapp' && params.waConfig) {
    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${params.waConfig.whatsapp_phone_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.platformUserId,
          type: 'text',
          text: { body: text },
        }),
      }
    )
    const data = await res.json()
    const platformMsgId = data.messages?.[0]?.id ?? null

    await supabase.from('messages').insert({
      conversation_id: params.conversationId,
      direction: 'outbound',
      content_type: 'text',
      content: text,
      platform_message_id: platformMsgId,
      status: platformMsgId ? 'sent' : 'failed',
      error_message: platformMsgId ? null : JSON.stringify(data).slice(0, 500),
    })

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', params.conversationId)
  } else if (params.platform === 'instagram' && params.igConfig) {
    const res = await fetch(
      `https://graph.instagram.com/${META_API_VERSION}/me/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.igConfig.instagram_page_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: params.platformUserId },
          message: { text },
        }),
      }
    )
    const data = await res.json()
    const platformMsgId = data.message_id ?? null

    await supabase.from('messages').insert({
      conversation_id: params.conversationId,
      direction: 'outbound',
      content_type: 'text',
      content: text,
      platform_message_id: platformMsgId,
      status: platformMsgId ? 'sent' : 'failed',
    })

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', params.conversationId)
  }
}

async function sendPlatformMedia(
  supabase: SupabaseClient,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  mediaUrl: string,
  mediaType: string,
  caption: string
): Promise<void> {
  if (params.platform === 'whatsapp' && params.waConfig) {
    const typeMap: Record<string, string> = { image: 'image', video: 'video', document: 'document', audio: 'audio' }
    const waType = typeMap[mediaType] || 'document'

    const mediaPayload: Record<string, unknown> = { link: mediaUrl }
    if (caption) mediaPayload.caption = caption

    const res = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${params.waConfig.whatsapp_phone_id}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.waConfig.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: params.platformUserId,
          type: waType,
          [waType]: mediaPayload,
        }),
      }
    )
    const data = await res.json()
    const platformMsgId = data.messages?.[0]?.id ?? null

    await supabase.from('messages').insert({
      conversation_id: params.conversationId,
      direction: 'outbound',
      content_type: mediaType,
      content: caption || null,
      media_url: mediaUrl,
      platform_message_id: platformMsgId,
      status: platformMsgId ? 'sent' : 'failed',
    })
  }
}

async function sendWhatsAppButtons(
  supabase: SupabaseClient,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  body: string,
  buttons: Array<{ id: string; title: string }>
): Promise<void> {
  if (!params.waConfig) return

  // WhatsApp: cuerpo obligatorio (máx. 1024), hasta 3 botones, título máx. 20
  const bodyText = (body.trim() || 'Elegí una opción:').slice(0, 1024)
  const waButtons = buttons.slice(0, 3).map(btn => ({
    type: 'reply' as const,
    reply: { id: String(btn.id).trim(), title: String(btn.title).trim().slice(0, 20) },
  }))

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${params.waConfig.whatsapp_phone_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.waConfig.whatsapp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.platformUserId,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: waButtons },
        },
      }),
    }
  )
  const data = await res.json()
  const platformMsgId = data.messages?.[0]?.id ?? null
  const errSnippet = platformMsgId
    ? null
    : (data.error?.message || JSON.stringify(data)).slice(0, 500)

  const uiButtons = waButtons.map(b => ({
    id: b.reply.id,
    title: b.reply.title,
  }))

  await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    direction: 'outbound',
    content_type: 'interactive',
    content: bodyText,
    template_params: { interactive_type: 'button', buttons: uiButtons },
    platform_message_id: platformMsgId,
    status: platformMsgId ? 'sent' : 'failed',
    error_message: errSnippet,
  })

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', params.conversationId)
}

async function sendWhatsAppList(
  supabase: SupabaseClient,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  body: string,
  buttonText: string,
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>
): Promise<void> {
  if (!params.waConfig) return

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${params.waConfig.whatsapp_phone_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.waConfig.whatsapp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.platformUserId,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonText,
            sections,
          },
        },
      }),
    }
  )
  const data = await res.json()
  const platformMsgId = data.messages?.[0]?.id ?? null

  await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    direction: 'outbound',
    content_type: 'template',
    content: body,
    platform_message_id: platformMsgId,
    status: platformMsgId ? 'sent' : 'failed',
  })
}

async function sendWhatsAppTemplate(
  supabase: SupabaseClient,
  params: Parameters<typeof evaluateIncomingMessage>[0],
  templateName: string,
  languageCode: string
): Promise<void> {
  if (!params.waConfig) return

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${params.waConfig.whatsapp_phone_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.waConfig.whatsapp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.platformUserId,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
        },
      }),
    }
  )
  const data = await res.json()
  const platformMsgId = data.messages?.[0]?.id ?? null

  await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    direction: 'outbound',
    content_type: 'template',
    content: `[Template: ${templateName}]`,
    template_name: templateName,
    platform_message_id: platformMsgId,
    status: platformMsgId ? 'sent' : 'failed',
  })
}

// ─── Variables en mensajes ───────────────────────────────────────

// ─── AI Model caller ────────────────────────────────────────────

function getAiProvider(model: string): 'anthropic' | 'openrouter' | 'openai' {
  if (model.startsWith('claude')) return 'anthropic'
  if (model.includes('/')) return 'openrouter' // e.g. meta-llama/llama-3.3-70b-instruct:free, openrouter/auto
  return 'openai'
}

async function callAiModel(opts: {
  model: string
  systemPrompt: string
  userMessage: string
  temperature: number
  maxTokens: number
  apiKey: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}): Promise<string> {
  const { model, systemPrompt, userMessage, temperature, maxTokens, apiKey, conversationHistory } = opts
  const provider = getAiProvider(model)

  // Construir historial: mensajes previos + mensaje actual
  const history = conversationHistory ?? []

  if (provider === 'anthropic') {
    const anthropicMessages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMessage },
    ]

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = await resp.json() as { content: Array<{ type: string; text: string }> }
    return data.content?.[0]?.text ?? ''
  } else {
    // OpenAI y OpenRouter usan el mismo formato (OpenAI-compatible)
    const baseUrl = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions'

    const messages: Array<{ role: string; content: string }> = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push(...history.map(m => ({ role: m.role, content: m.content })))
    messages.push({ role: 'user', content: userMessage })

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://monacosmartbarber.com'
      headers['X-Title'] = 'Monaco Smart Barber'
    }

    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} API error ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content ?? ''
  }
}

function resolveVariables(
  text: string,
  context: ExecutionContext,
  params: Parameters<typeof evaluateIncomingMessage>[0]
): string {
  const firstName = context.client_first_name ?? ''
  const fullName = context.client_name ?? ''
  const buttonTitle = context.last_button_title ?? ''
  const lastTextReply = context.last_text_reply ?? ''
  // {respuesta} debe funcionar tanto para texto libre como para botones:
  // si el cliente apretó un botón, usamos el título del botón.
  const lastReply = lastTextReply || buttonTitle
  let result = text
    .replace(/\{platform\}/g, params.platform)
    .replace(/\{user_id\}/g, params.platformUserId)
    .replace(/\{last_button\}/g, buttonTitle)
    .replace(/\{last_reply\}/g, lastReply)
    .replace(/\{respuesta\}/g, lastReply)
    .replace(/\{nombre\}/g, firstName)
    .replace(/\{nombre_completo\}/g, fullName)

  // Sustituir variables dinámicas del contexto (ai_response, http_response, etc.)
  if (context.variables) {
    for (const [key, val] of Object.entries(context.variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val ?? '')
    }
  }

  return result
}

// ─── Logging ─────────────────────────────────────────────────────

async function logExecution(
  supabase: SupabaseClient,
  executionId: string,
  nodeId: string,
  nodeType: string,
  status: 'success' | 'error' | 'skipped',
  outputData: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  await supabase.from('workflow_execution_log').insert({
    execution_id: executionId,
    node_id: nodeId,
    node_type: nodeType,
    status,
    output_data: outputData,
    error_message: errorMessage ?? null,
  })
}

// ─── Cron: procesar delays expirados ────────────────────────────

/**
 * Busca ejecuciones de workflow que están en waiting_reply en un nodo delay
 * cuyo delay_until ya pasó, y las avanza al siguiente nodo.
 * Debe llamarse desde un cron cada ~1 minuto.
 */
export async function processExpiredDelays(): Promise<{ processed: number; errors: string[] }> {
  const supabase = getSupabase()
  const errors: string[] = []
  let processed = 0

  // Buscar ejecuciones en waiting_reply en nodos delay con delay_until vencido
  const { data: executions } = await supabase
    .from('workflow_executions')
    .select('*, current_node:workflow_nodes(*), workflow:automation_workflows(organization_id)')
    .eq('status', 'waiting_reply')
    .limit(20)

  if (!executions || executions.length === 0) return { processed: 0, errors: [] }

  const now = new Date()

  for (const exec of executions) {
    const node = exec.current_node as WorkflowNode | null
    if (!node || node.node_type !== 'delay') continue

    const ctx = (exec.context as ExecutionContext) ?? {}
    const delayUntil = ctx.delay_until as string | undefined

    if (delayUntil) {
      // Ruta normal: delay_until explícito
      if (new Date(delayUntil) > now) continue // aún no expiró
    } else {
      // Fallback para ejecuciones stuck sin delay_until:
      // calcular expiración desde updated_at + config.seconds
      const configSeconds = ((node.config as Record<string, unknown>)?.seconds as number) ?? 5
      const updatedAt = new Date(exec.updated_at)
      const fallbackExpiry = new Date(updatedAt.getTime() + configSeconds * 1000 + 60000) // +60s gracia
      if (fallbackExpiry > now) continue // aún no expiró con el fallback
    }

    try {
      // Resolver datos de la conversación para poder enviar mensajes
      const { data: conv } = await supabase
        .from('conversations')
        .select('platform_user_id, channel:social_channels(platform, branch_id)')
        .eq('id', exec.conversation_id)
        .maybeSingle()

      if (!conv) {
        errors.push(`Conversación no encontrada: ${exec.conversation_id}`)
        continue
      }

      const channel = conv.channel as { platform?: string; branch_id?: string } | { platform?: string; branch_id?: string }[] | null
      const channelData = Array.isArray(channel) ? channel[0] : channel
      const platform = (channelData?.platform as 'whatsapp' | 'instagram') ?? 'whatsapp'
      const orgId = (exec.workflow as { organization_id?: string } | null)?.organization_id ?? ''

      // Obtener config de WhatsApp para enviar mensajes
      let waConfig: WaConfig | null = null
      let igConfig: IgConfig | null = null

      if (platform === 'whatsapp' && orgId) {
        const { data: waCfg } = await supabase
          .from('organization_whatsapp_config')
          .select('whatsapp_access_token, whatsapp_phone_id')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .maybeSingle()
        if (waCfg?.whatsapp_access_token && waCfg?.whatsapp_phone_id) {
          waConfig = { whatsapp_access_token: waCfg.whatsapp_access_token, whatsapp_phone_id: waCfg.whatsapp_phone_id }
        }
      } else if (platform === 'instagram' && orgId) {
        const { data: igCfg } = await supabase
          .from('organization_instagram_config')
          .select('instagram_page_access_token')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .maybeSingle()
        if (igCfg?.instagram_page_access_token) {
          igConfig = { instagram_page_access_token: igCfg.instagram_page_access_token }
        }
      }

      // Marcar como activo
      await supabase
        .from('workflow_executions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', exec.id)

      await logExecution(supabase, exec.id, node.id, 'delay', 'success', { resumed_by: 'cron', delay_until: delayUntil })

      // Construir params y avanzar
      const params: Parameters<typeof evaluateIncomingMessage>[0] = {
        orgId,
        conversationId: exec.conversation_id,
        text: '',
        platform,
        messageType: 'text',
        waConfig,
        igConfig,
        platformUserId: conv.platform_user_id ?? '',
      }

      await advanceFromNode(supabase, exec.id, exec.workflow_id, node.id, ctx, params)
      processed++
    } catch (err) {
      errors.push(`Error procesando ${exec.id}: ${(err as Error).message}`)
      console.error('[WorkflowEngine] Error procesando delay expirado:', exec.id, err)
    }
  }

  return { processed, errors }
}

// ─── Legacy auto-reply fallback ──────────────────────────────────

async function executeLegacyAutoReply(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string,
  text: string,
  platform: string,
  params: Parameters<typeof evaluateIncomingMessage>[0]
): Promise<void> {
  const { data: rules } = await supabase
    .from('auto_reply_rules')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .in('platform', ['all', platform])
    .order('priority', { ascending: false })

  if (!rules || rules.length === 0) return

  const lowerText = text.toLowerCase()
  for (const rule of rules) {
    const keywords: string[] = rule.keywords ?? []
    const matched = rule.match_mode === 'exact'
      ? keywords.some((kw: string) => lowerText === kw.toLowerCase())
      : keywords.some((kw: string) => lowerText.includes(kw.toLowerCase()))

    if (matched && rule.response_type === 'text' && rule.response_text) {
      await sendPlatformMessage(supabase, params, rule.response_text)

      // Tag assignment
      if (rule.tag_client_id) {
        await supabase
          .from('conversation_tag_assignments')
          .upsert(
            { conversation_id: conversationId, tag_id: rule.tag_client_id },
            { onConflict: 'conversation_id,tag_id' }
          )
      }
      break
    }
  }
}

// ─── Auto-tag global con IA ──────────────────────────────────────

/**
 * Si la org tiene auto_tag_enabled, ejecuta la clasificación de la conversación con IA.
 * Se llama en background desde evaluateIncomingMessage (no bloquea el webhook).
 */
async function runGlobalAutoTag(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string
): Promise<void> {
  // Chequear si auto-tag está habilitado
  const { data: aiConfig } = await supabase
    .from('organization_ai_config')
    .select('auto_tag_enabled, auto_tag_model, default_model, openai_api_key, anthropic_api_key, openrouter_api_key')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  if (!aiConfig?.auto_tag_enabled) return

  await runAutoTagForOrg(supabase, orgId, conversationId, aiConfig)
}

/**
 * Core del auto-etiquetado: lee mensajes + etiquetas IA → clasifica → asigna.
 * Usado tanto por runGlobalAutoTag como por el nodo ai_auto_tag del workflow.
 */
async function runAutoTagForOrg(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string,
  aiConfigOverride?: Record<string, unknown> | null
): Promise<{ applied: string[]; error?: string }> {
  // 1. Obtener etiquetas con auto-assign activado
  const { data: aiTags } = await supabase
    .from('conversation_tags')
    .select('id, name, description')
    .eq('organization_id', orgId)
    .eq('ai_auto_assign', true)

  if (!aiTags || aiTags.length === 0) {
    return { applied: [], error: 'No hay etiquetas con IA activada' }
  }

  // 2. Config IA
  let aiConfig = aiConfigOverride
  if (!aiConfig) {
    const { data } = await supabase
      .from('organization_ai_config')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    aiConfig = data
  }
  if (!aiConfig) return { applied: [], error: 'Sin config IA' }

  // 3. Últimos mensajes
  const { data: messages } = await supabase
    .from('messages')
    .select('direction, content, content_type')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive'])
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15)

  if (!messages || messages.length === 0) return { applied: [] }

  const conversation = messages
    .reverse()
    .filter(m => (m.content as string)?.trim())
    .map(m => `[${m.direction === 'inbound' ? 'Cliente' : 'Negocio'}]: ${m.content}`)
    .join('\n')

  // 4. Tags actuales
  const { data: currentAssignments } = await supabase
    .from('conversation_tag_assignments')
    .select('tag_id')
    .eq('conversation_id', conversationId)
  const currentTagIds = new Set((currentAssignments ?? []).map(t => t.tag_id))

  // 5. Prompt
  const tagList = aiTags
    .map(t => `- ID: "${t.id}" | Nombre: "${t.name}" | Descripción: ${t.description || 'Sin descripción'}`)
    .join('\n')

  const systemPrompt = `Sos un asistente de clasificación de conversaciones de un negocio.
Analizá la conversación y determiná qué etiquetas aplican.

ETIQUETAS DISPONIBLES:
${tagList}

REGLAS:
- Analizá el contenido y la intención de los mensajes del cliente
- Devolvé ÚNICAMENTE un JSON array con los IDs de las etiquetas que aplican
- Si ninguna aplica, devolvé: []
- No inventes IDs
- Sé conservador: solo asigná si hay evidencia clara

Respondé SOLO con el JSON array.`

  // 6. Llamar IA
  const model = (aiConfig.auto_tag_model as string) || (aiConfig.default_model as string) || 'gpt-4o-mini'
  const provider = getAiProvider(model)
  const apiKey = provider === 'anthropic'
    ? (aiConfig.anthropic_api_key as string)
    : provider === 'openrouter'
      ? (aiConfig.openrouter_api_key as string)
      : (aiConfig.openai_api_key as string)

  if (!apiKey) return { applied: [], error: 'Sin API key' }

  try {
    const response = await callAiModel({
      model,
      systemPrompt,
      userMessage: `CONVERSACIÓN:\n${conversation}`,
      temperature: 0.1,
      maxTokens: 300,
      apiKey,
    })

    let tagIds: string[] = []
    try {
      const cleaned = response.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim()
      tagIds = JSON.parse(cleaned)
      if (!Array.isArray(tagIds)) tagIds = []
    } catch {
      return { applied: [], error: 'Respuesta IA inválida' }
    }

    const validIds = new Set(aiTags.map(t => t.id))
    tagIds = tagIds.filter(id => typeof id === 'string' && validIds.has(id))

    const applied: string[] = []
    for (const tagId of tagIds) {
      if (currentTagIds.has(tagId)) continue
      const { error } = await supabase
        .from('conversation_tag_assignments')
        .upsert({ conversation_id: conversationId, tag_id: tagId }, { onConflict: 'conversation_id,tag_id' })
      if (!error) applied.push(tagId)
    }

    if (applied.length > 0) {
      console.log(`[AutoTag] Conv ${conversationId}: asignadas ${applied.length} etiqueta(s)`)
    }

    return { applied }
  } catch (err) {
    console.error('[AutoTag] Error:', err)
    return { applied: [], error: (err as Error).message }
  }
}
