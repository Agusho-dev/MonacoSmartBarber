'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { getScopedBranchIds } from './branch-access'
import { isValidUUID } from '@/lib/validation'
import { revalidatePath } from 'next/cache'

export type CrmCaseStatus = 'open' | 'contacted' | 'resolved' | 'dismissed'
const VALID_STATUSES: CrmCaseStatus[] = ['open', 'contacted', 'resolved', 'dismissed']

export interface CrmCaseRow {
  id: string
  status: CrmCaseStatus
  internal_notes: string | null
  resolved_at: string | null
  created_at: string
  branch_id: string
  client: { id: string; name: string | null; phone: string | null; instagram: string | null } | null
  review: { id: string; rating: number | null; comment: string | null; improvement_categories: string[] | null; created_at: string } | null
  branch: { id: string; name: string | null } | null
}

// Lista los casos de CRM (generados por reviews ≤2★) de la org, scopeados por sucursal.
// getScopedBranchIds() ya devuelve SOLO las sucursales de la org que el usuario
// puede ver (respeta role_branch_scope), y [] si no tiene ninguna.
export async function getCrmCases(): Promise<{ data: CrmCaseRow[]; error: string | null }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { data: [], error: 'No autorizado' }

  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()
  if (branchIds.length === 0) return { data: [], error: null }

  const { data, error } = await supabase
    .from('crm_cases')
    .select(`
      id, status, internal_notes, resolved_at, created_at, branch_id,
      client:clients(id, name, phone, instagram),
      review:client_reviews(id, rating, comment, improvement_categories, created_at),
      branch:branches(id, name)
    `)
    .in('branch_id', branchIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as unknown as CrmCaseRow[], error: null }
}

export async function getOpenCrmCaseCount(): Promise<{ count: number }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { count: 0 }
  const supabase = createAdminClient()
  const branchIds = await getScopedBranchIds()
  if (branchIds.length === 0) return { count: 0 }

  const { count } = await supabase
    .from('crm_cases')
    .select('id', { count: 'exact', head: true })
    .in('branch_id', branchIds)
    .in('status', ['open', 'contacted'])
  return { count: count ?? 0 }
}

// Verifica que el caso pertenece a una sucursal de la org del caller.
async function caseBelongsToOrg(caseId: string, orgId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('crm_cases')
    .select('id, branch:branches!inner(organization_id)')
    .eq('id', caseId)
    .maybeSingle()
  if (!data) return false
  const branch = (data as unknown as { branch: { organization_id: string } | { organization_id: string }[] }).branch
  const branchOrg = Array.isArray(branch) ? branch[0]?.organization_id : branch?.organization_id
  return branchOrg === orgId
}

export async function updateCrmCase(
  caseId: string,
  updates: { status?: CrmCaseStatus; internal_notes?: string },
): Promise<{ success?: boolean; error?: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'No autorizado' }
  if (!isValidUUID(caseId)) return { error: 'ID inválido' }
  if (updates.status && !VALID_STATUSES.includes(updates.status)) return { error: 'Estado inválido' }

  if (!(await caseBelongsToOrg(caseId, orgId))) return { error: 'Acceso denegado' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.status) {
    patch.status = updates.status
    // resolved_at se setea al cerrar (resolved/dismissed) y se limpia al reabrir.
    patch.resolved_at = ['resolved', 'dismissed'].includes(updates.status) ? new Date().toISOString() : null
  }
  if (updates.internal_notes !== undefined) patch.internal_notes = updates.internal_notes || null

  const supabase = createAdminClient()
  const { error } = await supabase.from('crm_cases').update(patch).eq('id', caseId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/mensajeria')
  return { success: true }
}
