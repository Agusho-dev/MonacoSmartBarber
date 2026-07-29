'use server'

import { createClient } from '@/lib/supabase/server'
import { getEffectivePermissions } from '@/lib/permissions'

/**
 * Permisos efectivos del usuario logueado en el dashboard.
 *
 * Extrae el bloque que estaba copiado a mano en cada página con guard
 * (`/dashboard/caja`, `/dashboard/finanzas`, …). Owner y admin reciben todos
 * los permisos; el resto, los de su rol.
 *
 * Devuelve `{}` si no hay sesión: el layout ya redirige al login, así que acá
 * lo correcto es no conceder nada.
 */
export async function getCurrentUserPermissions(): Promise<Record<string, boolean>> {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return {}

    const { data: currentStaff } = await authClient
      .from('staff')
      .select('role, role_id')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    let isOwnerOrAdmin = ['owner', 'admin'].includes(currentStaff?.role ?? '')

    // Un owner/admin puede no tener fila en `staff` y existir sólo en
    // `organization_members` (en prod hay al menos dos así). Sin este fallback
    // `getEffectivePermissions` le devuelve {} y cualquier página con guard lo
    // rebota al dashboard. `getAllowedBranchIds` ya contempla este caso.
    if (!currentStaff) {
      const { createAdminClient } = await import('@/lib/supabase/server')
      const { getCurrentOrgId } = await import('./org')
      const orgId = await getCurrentOrgId()
      if (orgId) {
        const { data: member, error: memberErr } = await createAdminClient()
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
    }

    let rolePerms: Record<string, boolean> | null = null
    if (currentStaff?.role_id) {
      const { data: role } = await authClient
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
