'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getEffectivePermissions } from '@/lib/permissions'
import { getCurrentOrgId } from './org'

/**
 * Permisos efectivos del usuario logueado en el dashboard.
 *
 * Extrae el bloque que estaba copiado a mano en cada página con guard
 * (`/dashboard/caja`, `/dashboard/finanzas`, …). Owner y admin reciben todos
 * los permisos; el resto, los de su rol.
 *
 * Los permisos se calculan SIEMPRE para la MISMA org que devuelve
 * `getCurrentOrgId()` — la que las server actions usan para scopear sus
 * queries. Antes se tomaba la fila de `staff` propia sin filtrar por org (vía
 * RLS, o sea la org del JWT): un owner de OTRA org que apuntara la cookie
 * `active_organization` acá quedaba con `rewards.manage` y todos los demás
 * permisos sobre una org ajena.
 *
 * Devuelve `{}` si no hay sesión u org: el layout ya redirige al login, así
 * que acá lo correcto es no conceder nada.
 */
export async function getCurrentUserPermissions(): Promise<Record<string, boolean>> {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return {}

    const orgId = await getCurrentOrgId()
    if (!orgId) return {}

    // Admin client: la RLS de `staff` resuelve por la org del JWT y no sirve
    // para consultar la org activa cuando difieren (multi-org, impersonation).
    const admin = createAdminClient()
    const { data: currentStaff } = await admin
      .from('staff')
      .select('role, role_id, is_active')
      .eq('auth_user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle()

    // Un empleado DADO DE BAJA no cae al fallback de organization_members: sin
    // este corte, un ex-empleado que quedó como member recuperaría permisos
    // totales — en prod hay exactamente un caso así.
    if (currentStaff && !currentStaff.is_active) return {}

    let isOwnerOrAdmin = ['owner', 'admin'].includes(currentStaff?.role ?? '')

    // Un owner/admin puede no tener fila en `staff` de esta org y existir sólo
    // en `organization_members` (en prod hay al menos dos así). Sin este
    // fallback `getEffectivePermissions` le devuelve {} y cualquier página con
    // guard lo rebota al dashboard. `getAllowedBranchIds` ya contempla el caso.
    if (!currentStaff) {
      const { data: member, error: memberErr } = await admin
        .from('organization_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (memberErr) {
        console.error('[permissions-gate] organization_members:', memberErr.message)
      }
      if (['owner', 'admin'].includes(member?.role ?? '')) {
        isOwnerOrAdmin = true
      }
    }

    let rolePerms: Record<string, boolean> | null = null
    if (currentStaff?.role_id) {
      const { data: role } = await admin
        .from('roles')
        .select('permissions')
        .eq('id', currentStaff.role_id)
        .maybeSingle()
      rolePerms = (role?.permissions as Record<string, boolean> | null) ?? null
    }

    return getEffectivePermissions(rolePerms ?? undefined, isOwnerOrAdmin)
  } catch {
    // Error de red / DB saturada: no es un "no tenés permiso", pero tampoco
    // podemos conceder. El layout maneja la caída de la DB por separado.
    return {}
  }
}

/** Atajo booleano para gatear una página o server action. */
export async function currentUserCan(permission: string): Promise<boolean> {
  const permissions = await getCurrentUserPermissions()
  return permissions[permission] === true
}
