'use server'

import { cache } from 'react'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from './org'
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
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      console.error('[debug-branch][getAllowedBranchIds] sin user en sesion auth', { authErr: authErr?.message })
      return [] // sin sesión → sin acceso
    }

    // Resolver org activa para scopear el lookup de staff. Sin esto, un usuario
    // con staff_rows en multiples orgs causa que .maybeSingle() devuelva null
    // (PGRST116 multiple rows), gatillando el camino de "no staff" → null
    // (acceso total, OK), pero si una de las queries arroja error en una
    // estructura distinta, el catch externo lo silencia y devuelve [] (deny all),
    // que es el bug que rompe el filtro de sucursales para owners multi-org.
    const orgId = await getCurrentOrgId()

    const adminClient = createAdminClient()

    // Query scopeada por org cuando la conocemos; fallback a global si no.
    let staffQuery = adminClient
      .from('staff')
      .select('role, role_id, organization_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)

    if (isValidUUID(orgId)) {
      staffQuery = staffQuery.eq('organization_id', orgId!)
    }

    const { data: staffRows, error: staffErr } = await staffQuery.limit(1)
    if (staffErr) {
      console.error('[debug-branch][getAllowedBranchIds] error consultando staff', { msg: staffErr.message, userId: user.id, orgId })
    }
    const staffRow = staffRows?.[0] ?? null

    if (!staffRow) {
      // Sin staff row para esta org. Verificar organization_members antes de
      // asumir "acceso total". Un owner que solo está en organization_members
      // (no en staff) debe obtener null = full access. Otro usuario sin ningún
      // vínculo a la org debe obtener [] = sin acceso.
      if (isValidUUID(orgId)) {
        const { data: member, error: memberErr } = await adminClient
          .from('organization_members')
          .select('role')
          .eq('user_id', user.id)
          .eq('organization_id', orgId!)
          .maybeSingle()
        if (memberErr) {
          console.error('[debug-branch][getAllowedBranchIds] error consultando organization_members', { msg: memberErr.message, userId: user.id, orgId })
        }
        console.log('[debug-branch][getAllowedBranchIds] sin staffRow', { userId: user.id, orgId, member, decision: member ? 'null (full)' : '[] (deny)' })
        return member ? null : []
      }
      // Sin orgId resoluble: mantener compat con comportamiento previo (null = full).
      console.log('[debug-branch][getAllowedBranchIds] sin staffRow y sin orgId, fallback a null', { userId: user.id })
      return null
    }

    // Owners y admins tienen acceso total
    if (staffRow.role === 'owner' || staffRow.role === 'admin') {
      console.log('[debug-branch][getAllowedBranchIds] owner/admin → null (full)', { userId: user.id, orgId, role: staffRow.role })
      return null
    }

    // Staff con rol custom: resolver scope
    if (staffRow.role_id) {
      const { data: scopeRows, error: scopeErr } = await adminClient
        .from('role_branch_scope')
        .select('branch_id')
        .eq('role_id', staffRow.role_id)
      if (scopeErr) {
        console.error('[debug-branch][getAllowedBranchIds] error consultando role_branch_scope', { msg: scopeErr.message, roleId: staffRow.role_id })
      }

      if (scopeRows && scopeRows.length > 0) {
        const ids = scopeRows.map(r => r.branch_id)
        console.log('[debug-branch][getAllowedBranchIds] role con scope', { userId: user.id, ids })
        return ids
      }
      // Sin scope configurado en el rol: acceso total
      console.log('[debug-branch][getAllowedBranchIds] role sin scope → null (full)', { userId: user.id, roleId: staffRow.role_id })
      return null
    }

    // Staff sin role_id (raro): acceso total por defecto
    console.log('[debug-branch][getAllowedBranchIds] staff sin role_id → null (full)', { userId: user.id })
    return null
  } catch (err) {
    console.error('[debug-branch][getAllowedBranchIds] excepcion no esperada', { err: err instanceof Error ? err.message : String(err) })
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
 * Resuelve los branch_ids que el usuario puede ver dentro de su org actual.
 * Intersección entre getOrgBranchIds() (todas las de la org) y getAllowedBranchIds()
 * (las que el rol permite). Owner/admin obtiene todas.
 *
 * Usar en lugar de getOrgBranchIds() en server actions que fetchean datos que el
 * usuario "puede ver" — así un encargado scoped a una sucursal no obtiene agregados
 * de sucursales ajenas cuando no pasa branchId explícito.
 */
export const getScopedBranchIds = cache(async function getScopedBranchIds(): Promise<string[]> {
  const [orgBranchIds, allowed] = await Promise.all([
    getOrgBranchIds(),
    getAllowedBranchIds(),
  ])
  if (allowed === null) {
    console.log('[debug-branch][getScopedBranchIds] allowed=null (full access)', { orgBranchIdsCount: orgBranchIds.length })
    return orgBranchIds
  }
  const allowedSet = new Set(allowed)
  const scoped = orgBranchIds.filter(id => allowedSet.has(id))
  console.log('[debug-branch][getScopedBranchIds] interseccion', { orgBranchIdsCount: orgBranchIds.length, allowedCount: allowed.length, scopedCount: scoped.length })
  return scoped
})

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
