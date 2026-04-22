'use server'

import { cache } from 'react'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { isValidUUID } from '@/lib/validation'
import { cookies } from 'next/headers'

/**
 * Branch-access helpers para enforzar el scoping por sucursal server-side.
 *
 * Contexto: el dashboard resuelve `allowedBranchIds` en layout.tsx y lo pasa al
 * store de cliente, pero los server actions necesitan resolver esto por su cuenta
 * cada vez. Esto cierra el gap donde un manager con scope limitado a la sucursal
 * X podría manipular la URL para modificar datos de la sucursal Y.
 *
 * Reglas:
 *  - Owners y admins: acceso a todas las sucursales de su org.
 *  - Staff con role.role_branch_scope: restringido a esas sucursales.
 *  - Staff sin role o role sin scope: acceso a todas (default permisivo — hasta
 *    que se configure scope explícito no se restringe).
 *  - Panel barbero (cookie barber_session): acceso solo a su branch_id.
 */

/**
 * Resuelve los branch_ids permitidos para el usuario actual.
 * Retorna null cuando el usuario tiene acceso a todas las sucursales de su org.
 * Retorna array vacío si el usuario no tiene acceso a ninguna (caso patológico).
 */
export const getAllowedBranchIds = cache(async function getAllowedBranchIds(): Promise<string[] | null> {
  const cookieStore = await cookies()

  // 1) Panel barbero por PIN — acceso solo a su sucursal
  const barberSession = cookieStore.get('barber_session')
  if (barberSession) {
    try {
      const parsed = JSON.parse(barberSession.value)
      if (isValidUUID(parsed.branch_id)) {
        return [parsed.branch_id]
      }
      // Si la cookie no trae branch_id, resolver desde staff
      if (isValidUUID(parsed.staff_id)) {
        const adminClient = createAdminClient()
        const { data: staff } = await adminClient
          .from('staff')
          .select('branch_id')
          .eq('id', parsed.staff_id)
          .maybeSingle()
        if (staff?.branch_id) return [staff.branch_id]
      }
    } catch { /* ignore */ }
  }

  // 2) Dashboard (Supabase Auth)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return [] // sin sesión → sin acceso

    const adminClient = createAdminClient()
    const { data: staffRow } = await adminClient
      .from('staff')
      .select('role, role_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!staffRow) {
      // Podría ser un organization_member (partner-like), no tiene scope de sucursal aún
      return null
    }

    // Owners y admins tienen acceso total
    if (staffRow.role === 'owner' || staffRow.role === 'admin') {
      return null
    }

    // Staff con rol custom: resolver scope
    if (staffRow.role_id) {
      const { data: scopeRows } = await adminClient
        .from('role_branch_scope')
        .select('branch_id')
        .eq('role_id', staffRow.role_id)

      if (scopeRows && scopeRows.length > 0) {
        return scopeRows.map(r => r.branch_id)
      }
      // Sin scope configurado en el rol: acceso total
      return null
    }

    // Staff sin role_id (raro): acceso total por defecto
    return null
  } catch {
    return []
  }
})

/**
 * Verifica que el usuario tenga acceso a una sucursal específica.
 * Encadenar con getCurrentOrgId() para verificar también pertenencia a la org.
 */
export async function assertBranchAccess(branchId: string): Promise<{ ok: true; orgId: string } | { ok: false; reason: string }> {
  if (!isValidUUID(branchId)) return { ok: false, reason: 'invalid_branch_id' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, reason: 'no_session' }

  // 1) Verificar que la sucursal pertenezca a la org
  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .maybeSingle()

  if (!branch) return { ok: false, reason: 'branch_not_found' }
  if (branch.organization_id !== orgId) return { ok: false, reason: 'cross_org' }

  // 2) Verificar scope del usuario
  const allowed = await getAllowedBranchIds()
  if (allowed === null) {
    // Acceso total
    return { ok: true, orgId }
  }
  if (!allowed.includes(branchId)) {
    return { ok: false, reason: 'branch_out_of_scope' }
  }
  return { ok: true, orgId }
}

/**
 * Filtra un array de branch_ids a los que el usuario realmente puede ver/manipular.
 * Útil para listar turnos multi-branch consolidados.
 */
export async function filterBranchesByAccess(branchIds: string[]): Promise<string[]> {
  if (!branchIds.length) return []
  const orgId = await getCurrentOrgId()
  if (!orgId) return []

  const supabase = createAdminClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .in('id', branchIds)
    .eq('organization_id', orgId)

  const orgBranchIds = new Set((branches ?? []).map(b => b.id))
  const allowed = await getAllowedBranchIds()

  return branchIds.filter(id => {
    if (!orgBranchIds.has(id)) return false
    if (allowed === null) return true
    return allowed.includes(id)
  })
}
