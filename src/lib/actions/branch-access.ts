'use server'

import { cache } from 'react'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId, getOrgBranchIds } from './org'
import { isValidUUID } from '@/lib/validation'
import { cookies } from 'next/headers'
import { leerBarberSession } from '@/lib/barber-cookie'
import { resolverAlcanceDelUsuario } from '@/lib/alcance-sucursales'

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
 *  - Si no se pudo LEER el rol o su scope: ninguna (falla cerrado). Antes caía en
 *    "acceso total" y un encargado acotado veía todas las sucursales mientras la
 *    base estaba saturada. La lógica del usuario del dashboard vive en
 *    `src/lib/alcance-sucursales.ts` (la comparte el contexto de Tex, en modo estricto).
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
    // Cookie firmada (HMAC, src/lib/barber-cookie.ts): un JSON armado a mano
    // no elige sucursal.
    const parsed = leerBarberSession(barberSession.value)
    if (parsed) {
      if (isValidUUID(parsed.branch_id)) {
        return [parsed.branch_id!]
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
    }
  }

  // 2) Dashboard (Supabase Auth)
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      console.error('[debug-branch][getAllowedBranchIds] sin user en sesion auth', { authErr: authErr?.message })
      return [] // sin sesión → sin acceso
    }

    // Resolver org activa para scopear el lookup de staff (un usuario con filas de staff
    // en varias orgs tiene que tomar la de ESTA org).
    const orgId = await getCurrentOrgId()
    // No estricto: si una lectura falla devuelve [] (ninguna sucursal), nunca null.
    const alcance = await resolverAlcanceDelUsuario({ userId: user.id, orgId, estricto: false })
    console.log('[debug-branch][getAllowedBranchIds] decisión', {
      userId: user.id,
      orgId,
      alcance: alcance === null ? 'null (full)' : alcance.length,
    })
    return alcance
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
