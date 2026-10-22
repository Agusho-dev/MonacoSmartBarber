import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/acceso.ts
// La puerta de cada server action de la conciliación: org de la sesión,
// permiso del rol (corta al staff dado de baja: Known Risk #19) y alcance de
// sucursales. Los permisos del dashboard sólo filtran el menú; la seguridad
// está acá y en la verificación de cada id que llega del browser.
//
// Las tablas mp_* son sólo de service_role: después de esta puerta, todo va con
// createAdminClient() y SIEMPRE con `.eq('organization_id', orgId)`.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getCachedAuthUser } from '@/lib/auth-cache'

export type PermisoConciliacion = 'conciliacion.view' | 'conciliacion.manage'

export type Acceso =
  | { ok: true; orgId: string; alcance: string[]; userId: string | null }
  | { ok: false; error: string }

export async function verificarAcceso(permiso: PermisoConciliacion): Promise<Acceso> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'Tu sesión venció. Volvé a entrar.' }
  if (!(await currentUserCan(permiso))) {
    return {
      ok: false,
      error: permiso === 'conciliacion.manage' ? 'No tenés permiso para hacer cambios en la conciliación.' : 'No tenés permiso para ver la conciliación.',
    }
  }
  const alcance = await getScopedBranchIds()
  if (!alcance.length) return { ok: false, error: 'No tenés sucursales asignadas.' }
  const user = await getCachedAuthUser()
  return { ok: true, orgId, alcance, userId: user?.id ?? null }
}

/** El nombre de quien resuelve (para `created_by_nombre`): staff de la org → metadata → email. */
export async function nombreDeUsuario(orgId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('staff')
    .select('full_name')
    .eq('auth_user_id', userId)
    .eq('organization_id', orgId)
    .limit(1)
    .maybeSingle<{ full_name: string | null }>()
  if (data?.full_name?.trim()) return data.full_name.trim().slice(0, 120)
  const user = await getCachedAuthUser()
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string }
  const nombre = (meta.full_name ?? meta.name ?? '').trim()
  if (nombre) return nombre.slice(0, 120)
  return user?.email ? user.email.split('@')[0].slice(0, 120) : null
}
