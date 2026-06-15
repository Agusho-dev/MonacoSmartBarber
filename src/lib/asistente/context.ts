import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getEffectivePermissions } from '@/lib/permissions'
import { getOrgAiConfig, type OrgAiConfig } from '@/lib/actions/ai-config'

export type DataDomain =
  | 'finanzas'
  | 'salarios'
  | 'estadisticas'
  | 'clientes'
  | 'resenas'
  | 'turnos'
  | 'fidelizacion'

export const DEFAULT_DATA_ACCESS: Record<DataDomain, boolean> = {
  finanzas: true,
  salarios: true,
  estadisticas: true,
  clientes: true,
  resenas: true,
  turnos: true,
  fidelizacion: true,
}

export interface AssistantContext {
  orgId: string
  userId: string | null
  orgName: string
  currency: string
  isOwnerOrAdmin: boolean
  permissions: Record<string, boolean>
  scopedBranchIds: string[]
  dataAccess: Record<string, boolean>
  proMode: boolean
  config: OrgAiConfig | null
}

async function resolveUserAccess(orgId: string): Promise<{
  userId: string | null
  isOwnerOrAdmin: boolean
  permissions: Record<string, boolean>
}> {
  const user = await getCachedAuthUser().catch(() => null)
  if (!user) return { userId: null, isOwnerOrAdmin: false, permissions: {} }

  const supabase = createAdminClient()

  const { data: staff } = await supabase
    .from('staff')
    .select('role, role_id')
    .eq('auth_user_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  let role: string | undefined = staff?.role
  let roleId: string | null | undefined = staff?.role_id

  if (!staff) {
    // Fallback: owner que solo está en organization_members (no en staff)
    const { data: member } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle()
    role = member?.role
    roleId = null
  }

  const isOwnerOrAdmin = role === 'owner' || role === 'admin'

  let rolePerms: Record<string, boolean> | null = null
  if (!isOwnerOrAdmin && roleId) {
    const { data: roleRow } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', roleId)
      .maybeSingle()
    rolePerms = (roleRow?.permissions as Record<string, boolean> | null) ?? null
  }

  return {
    userId: user.id,
    isOwnerOrAdmin,
    permissions: getEffectivePermissions(rolePerms, isOwnerOrAdmin),
  }
}

async function getOrgMeta(orgId: string): Promise<{ name: string; currency: string } | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('organizations')
    .select('name, currency')
    .eq('id', orgId)
    .maybeSingle()
  if (!data) return null
  return { name: data.name ?? 'tu barbería', currency: (data.currency as string) ?? 'ARS' }
}

/**
 * Resuelve el contexto completo del Asistente IA desde la sesión actual.
 * Devuelve null si no hay organización resoluble (sin sesión válida).
 */
export async function getAssistantContext(): Promise<AssistantContext | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null

  const [access, scopedBranchIds, cfgRes, meta] = await Promise.all([
    resolveUserAccess(orgId),
    getScopedBranchIds(),
    getOrgAiConfig(),
    getOrgMeta(orgId),
  ])

  const config = cfgRes.data
  const dataAccess =
    (config?.assistant_data_access as Record<string, boolean> | null) ?? DEFAULT_DATA_ACCESS

  return {
    orgId,
    userId: access.userId,
    orgName: meta?.name ?? 'tu barbería',
    currency: meta?.currency ?? 'ARS',
    isOwnerOrAdmin: access.isOwnerOrAdmin,
    permissions: access.permissions,
    scopedBranchIds,
    dataAccess,
    // Modo Pro requiere flag de org + ser owner/admin (gate doble).
    proMode: Boolean(config?.assistant_pro_mode) && access.isOwnerOrAdmin,
    config,
  }
}

/** Auditoría fire-and-forget de cada uso de herramienta / SQL / RAG / denegación. */
export async function auditAssistant(
  ctx: Pick<AssistantContext, 'orgId' | 'userId'>,
  entry: { kind: string; toolName?: string; detail?: Record<string, unknown>; allowed?: boolean },
): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('assistant_audit_log').insert({
      organization_id: ctx.orgId,
      user_id: ctx.userId,
      kind: entry.kind,
      tool_name: entry.toolName ?? null,
      detail: entry.detail ?? null,
      allowed: entry.allowed ?? null,
    })
  } catch {
    /* no bloquear el chat por auditoría */
  }
}
