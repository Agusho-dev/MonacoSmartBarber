import 'server-only'

// =============================================================================
// src/lib/alcance-sucursales.ts
// Qué sucursales puede ver un usuario del DASHBOARD (Supabase Auth). Una sola
// definición para `getAllowedBranchIds` (branch-access.ts, todo el dashboard) y
// para el contexto de Tex.
//
// Reglas (las de siempre):
//  - Owner o admin (fila de staff activa): todas las sucursales de la org → null.
//  - Staff con rol y `role_branch_scope`: esas sucursales.
//  - Staff con rol sin scope, o sin rol: todas → null.
//  - Sin fila de staff en la org: `organization_members` decide (miembro →
//    todas; nadie → ninguna). Sin org resoluble: todas (compatibilidad).
//
// FALLA CERRADO. Antes, si no se podía leer `staff` o `role_branch_scope` (la
// base saturada, el timeout de 8 s del Known Risk #12), el código seguía como
// si no hubiera fila o no hubiera scope y terminaba en "acceso total": un
// encargado de una sola sucursal veía la plata de todas, y Tex se la sumaba y
// le listaba las cuatro sucursales en el prompt. Ahora, ante cualquier lectura
// que falla:
//   - estricto (Tex): TIRA, y Tex dice que no pudo arrancar;
//   - no estricto (dashboard): devuelve [] (ninguna sucursal), nunca null.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'

export class ErrorAlcanceSucursales extends Error {
  constructor(contexto: string, detalle: string) {
    super(`[alcance] ${contexto}: ${detalle}`)
    this.name = 'ErrorAlcanceSucursales'
  }
}

/**
 * null = todas las sucursales de la org; [] = ninguna; si no, los ids permitidos.
 * `estricto`: ante una lectura que falla TIRA (`ErrorAlcanceSucursales`) en vez
 * de devolver [].
 */
export async function resolverAlcanceDelUsuario(p: {
  userId: string
  orgId: string | null
  estricto: boolean
}): Promise<string[] | null> {
  const { userId, orgId, estricto } = p
  const fallo = (contexto: string, detalle: string): string[] => {
    if (estricto) throw new ErrorAlcanceSucursales(contexto, detalle)
    console.error(`[debug-branch][alcance] ${contexto}: ${detalle} → [] (sin acceso: falla cerrado)`, { userId, orgId })
    return []
  }
  const adminClient = createAdminClient()

  // Query scopeada por org cuando la conocemos; fallback a global si no. Sin el filtro, un
  // usuario con filas de staff en varias orgs podía tomar la fila de otra org.
  let staffQuery = adminClient
    .from('staff')
    .select('role, role_id, organization_id')
    .eq('auth_user_id', userId)
    .eq('is_active', true)
  if (isValidUUID(orgId)) staffQuery = staffQuery.eq('organization_id', orgId!)

  const { data: staffRows, error: staffErr } = await staffQuery.limit(1)
  // Sin poder leer `staff` no se sabe si es dueño, encargado acotado o nadie: nunca "todas".
  if (staffErr) return fallo('consultando staff', staffErr.message)
  const staffRow = (staffRows?.[0] ?? null) as { role: string | null; role_id: string | null } | null

  if (!staffRow) {
    // Sin staff row para esta org. Un owner que sólo está en organization_members (no en
    // staff) obtiene todas; un usuario sin ningún vínculo a la org, ninguna.
    if (isValidUUID(orgId)) {
      const { data: member, error: memberErr } = await adminClient
        .from('organization_members')
        .select('role')
        .eq('user_id', userId)
        .eq('organization_id', orgId!)
        .maybeSingle()
      if (memberErr) return fallo('consultando organization_members', memberErr.message)
      return member ? null : []
    }
    // Sin orgId resoluble: se mantiene el comportamiento previo (todas).
    return null
  }

  // Owners y admins tienen acceso total
  if (staffRow.role === 'owner' || staffRow.role === 'admin') return null

  // Staff con rol custom: resolver scope
  if (staffRow.role_id) {
    const { data: scopeRows, error: scopeErr } = await adminClient
      .from('role_branch_scope')
      .select('branch_id')
      .eq('role_id', staffRow.role_id)
    // Sin poder leer el scope no se sabe si el rol está acotado: nunca "todas".
    if (scopeErr) return fallo('consultando role_branch_scope', scopeErr.message)
    if (scopeRows && scopeRows.length > 0) return (scopeRows as { branch_id: string }[]).map((r) => r.branch_id)
    // Sin scope configurado en el rol: acceso total
    return null
  }

  // Staff sin role_id (raro): acceso total por defecto
  return null
}
