'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { revalidatePath } from 'next/cache'
import type { AutomationWorkflow, WorkflowNode, WorkflowEdge, WorkflowWithGraph, CrmAlert } from '@/lib/types/database'

async function requireOrgId(): Promise<{ orgId: string } | { error: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    return { error: 'Sesión expirada. Recargá la página e intentá de nuevo.' }
  }
  return { orgId }
}

// ─── Workflows CRUD ──────────────────────────────────────────────

export async function getWorkflows() {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('automation_workflows')
    .select('*')
    .eq('organization_id', result.orgId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as AutomationWorkflow[], error: null }
}

export async function getWorkflow(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { data: null, error: result.error }

  const supabase = createAdminClient()

  const { data: workflow, error: wfErr } = await supabase
    .from('automation_workflows')
    .select('*')
    .eq('id', id)
    .eq('organization_id', result.orgId)
    .single()

  if (wfErr || !workflow) return { data: null, error: wfErr?.message ?? 'No encontrado' }

  const [{ data: nodes }, { data: edges }] = await Promise.all([
    supabase.from('workflow_nodes').select('*').eq('workflow_id', id).order('created_at'),
    supabase.from('workflow_edges').select('*').eq('workflow_id', id).order('sort_order'),
  ])

  const workflowWithGraph: WorkflowWithGraph = {
    ...workflow as AutomationWorkflow,
    nodes: (nodes ?? []) as WorkflowNode[],
    edges: (edges ?? []) as WorkflowEdge[],
  }

  return { data: workflowWithGraph, error: null }
}

export async function createWorkflow(input: {
  name: string
  description?: string
  channels: string[]
  trigger_type: string
  trigger_config: Record<string, unknown>
  priority?: number
}) {
  const result = await requireOrgId()
  if ('error' in result) return { data: null, error: result.error }

  if (!input.name.trim()) return { data: null, error: 'El nombre es requerido' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('automation_workflows')
    .insert({
      organization_id: result.orgId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      channels: input.channels,
      trigger_type: input.trigger_type,
      trigger_config: input.trigger_config,
      priority: input.priority ?? 0,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }

  // Crear nodo trigger de entrada por defecto
  await supabase.from('workflow_nodes').insert({
    workflow_id: data.id,
    node_type: 'trigger',
    label: getTriggerLabel(input.trigger_type),
    config: input.trigger_config,
    position_x: 400,
    position_y: 80,
    is_entry_point: true,
  })

  revalidatePath('/dashboard/mensajeria')
  return { data: data as AutomationWorkflow, error: null }
}

function getTriggerLabel(type: string): string {
  switch (type) {
    case 'keyword': return 'Palabra clave'
    case 'template_reply': return 'Respuesta a template'
    case 'button_response': return 'Respuesta de botón'
    case 'post_service': return 'Post-servicio'
    case 'days_after_visit': return 'Seguimiento'
    default: return 'Trigger'
  }
}

export async function updateWorkflow(id: string, input: {
  name?: string
  description?: string
  channels?: string[]
  trigger_type?: string
  trigger_config?: Record<string, unknown>
  priority?: number
  is_active?: boolean
}) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const supabase = createAdminClient()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (input.name !== undefined) update.name = input.name.trim()
  if (input.description !== undefined) update.description = input.description?.trim() || null
  if (input.channels !== undefined) update.channels = input.channels
  if (input.trigger_type !== undefined) update.trigger_type = input.trigger_type
  if (input.trigger_config !== undefined) update.trigger_config = input.trigger_config
  if (input.priority !== undefined) update.priority = input.priority
  if (input.is_active !== undefined) update.is_active = input.is_active

  const { error } = await supabase
    .from('automation_workflows')
    .update(update)
    .eq('id', id)
    .eq('organization_id', result.orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function deleteWorkflow(id: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('automation_workflows')
    .delete()
    .eq('id', id)
    .eq('organization_id', result.orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

export async function toggleWorkflow(id: string, isActive: boolean) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('automation_workflows')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', result.orgId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

// ─── Workflow Graph (Nodes + Edges) ──────────────────────────────

export async function saveWorkflowGraph(
  workflowId: string,
  nodes: Omit<WorkflowNode, 'created_at'>[],
  edges: Omit<WorkflowEdge, 'id'>[]
) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  // Verificar que el workflow pertenece a la org
  const supabase = createAdminClient()
  const { data: wf } = await supabase
    .from('automation_workflows')
    .select('id')
    .eq('id', workflowId)
    .eq('organization_id', result.orgId)
    .single()

  if (!wf) return { error: 'Workflow no encontrado' }

  // Borrar nodos y edges existentes (cascade borra edges por FK)
  await supabase.from('workflow_edges').delete().eq('workflow_id', workflowId)
  await supabase.from('workflow_nodes').delete().eq('workflow_id', workflowId)

  // Insertar nuevos nodos
  if (nodes.length > 0) {
    const { error: nodesErr } = await supabase
      .from('workflow_nodes')
      .insert(nodes.map(n => ({
        id: n.id,
        workflow_id: workflowId,
        node_type: n.node_type,
        label: n.label,
        config: n.config,
        position_x: n.position_x,
        position_y: n.position_y,
        width: n.width ?? 200,
        height: n.height ?? 80,
        is_entry_point: n.is_entry_point,
      })))
    if (nodesErr) return { error: `Error guardando nodos: ${nodesErr.message}` }
  }

  // Insertar nuevos edges
  if (edges.length > 0) {
    const { error: edgesErr } = await supabase
      .from('workflow_edges')
      .insert(edges.map((e, i) => ({
        workflow_id: workflowId,
        source_node_id: e.source_node_id,
        target_node_id: e.target_node_id,
        source_handle: e.source_handle || 'default',
        label: e.label || null,
        condition_value: e.condition_value || null,
        sort_order: e.sort_order ?? i,
      })))
    if (edgesErr) return { error: `Error guardando edges: ${edgesErr.message}` }
  }

  // Actualizar timestamp del workflow
  await supabase
    .from('automation_workflows')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', workflowId)

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

// ─── CRM Alerts ──────────────────────────────────────────────────

export async function getCrmAlerts(onlyUnread = false) {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }

  const supabase = createAdminClient()
  let query = supabase
    .from('crm_alerts')
    .select('*, conversation:conversations(id, platform_user_name, client:clients(id, name, phone))')
    .eq('organization_id', result.orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (onlyUnread) {
    query = query.eq('is_read', false)
  }

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: data as (CrmAlert & { conversation?: { id: string; platform_user_name: string; client?: { id: string; name: string; phone: string } } })[], error: null }
}

export async function getUnreadAlertCount() {
  const result = await requireOrgId()
  if ('error' in result) return { count: 0 }

  const supabase = createAdminClient()
  const { count } = await supabase
    .from('crm_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', result.orgId)
    .eq('is_read', false)

  return { count: count ?? 0 }
}

export async function markAlertRead(alertId: string) {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('crm_alerts')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('organization_id', result.orgId)

  if (error) return { error: error.message }
  return { success: true }
}

export async function markAllAlertsRead() {
  const result = await requireOrgId()
  if ('error' in result) return { error: result.error }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('crm_alerts')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('organization_id', result.orgId)
    .eq('is_read', false)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}

// ─── Workflow Executions (monitoreo) ─────────────────────────────

export async function getWorkflowExecutions(workflowId?: string) {
  const result = await requireOrgId()
  if ('error' in result) return { data: [], error: result.error }

  const supabase = createAdminClient()
  let query = supabase
    .from('workflow_executions')
    .select(`
      *,
      workflow:automation_workflows(id, name),
      conversation:conversations(id, platform_user_name, client:clients(id, name))
    `)
    .order('started_at', { ascending: false })
    .limit(100)

  if (workflowId) {
    query = query.eq('workflow_id', workflowId)
  }

  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: data ?? [], error: null }
}
