import 'server-only'

// =============================================================================
// src/lib/tex/contexto.ts
// Quién le pregunta a Tex y qué puede ver, resuelto SIEMPRE desde la sesión:
// nada de esto viaja desde el browser.
//
// - Permisos: `getCurrentUserPermissions` (permissions-gate), que corta al
//   staff dado de baja aunque siga en organization_members (Known Risk #19).
//   NO se copia `resolveUserAccess` de src/lib/asistente/context.ts, que no
//   hace ese corte: un ex-empleado con sesión viva entraba como admin al chat.
// - Dueño/admin: se mira el rol (staff de la org, o organization_members si
//   no tiene staff), no "tiene todos los permisos": un rol a medida con todo
//   prendido NO habilita el Modo Pro.
// - Sucursales: el alcance del rol, con el resolvedor ESTRICTO de
//   `src/lib/alcance-sucursales.ts` (el mismo de `getAllowedBranchIds`). Si no
//   puede leer el rol o su scope, TIRA: un alcance a medio leer terminaba en
//   "toda la organización" y un encargado de una sucursal veía la plata de las
//   otras (motor-tex-2).
// - Configuración: columnas EXPLÍCITAS de organization_ai_config. Esa fila
//   tiene claves de API: un `select('*')` acá terminaría, tarde o temprano,
//   viajando a algún lado que no debe.
//
// Si una lectura falla, TIRA. Con permisos o configuración a medio leer no se
// puede decidir nada con seguridad (¿el dueño apagó Sueldos? ¿es admin?): la
// ruta contesta un error y la página muestra su pantalla de error.
// =============================================================================

import { cache } from 'react'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getCurrentUserPermissions } from '@/lib/actions/permissions-gate'
import { resolverAlcanceDelUsuario } from '@/lib/alcance-sucursales'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getLocalDateStr } from '@/lib/time-utils'
import type { TexEsfuerzo } from './contrato'
import { nombreDePila } from './formato'
import type { TexContexto, TexSucursal } from './herramientas/tipos'

/** Lo que la org configuró para Tex (además de lo que ya está en el contexto). */
export interface TexConfigOrg {
  esfuerzo: TexEsfuerzo
  persona: string | null
  instrucciones: string | null
  /** Tal como está guardado. Ausente = encendido (igual en la UI y en el servidor). */
  accesoDatos: Record<string, boolean>
  /** El interruptor guardado; el efectivo (con el corte de dueño/admin) es `ctx.modoPro`. */
  modoProGuardado: boolean
  /** Hay fila en organization_ai_config. */
  existe: boolean
}

const ESFUERZOS: readonly TexEsfuerzo[] = ['low', 'medium', 'high']

/** Columnas de Tex en organization_ai_config: NUNCA `select('*')` (hay claves en esa fila). */
export const COLUMNAS_CONFIG_TEX = 'assistant_effort, assistant_persona, assistant_system_prompt, assistant_data_access, assistant_pro_mode'

interface FilaConfig {
  assistant_effort: string | null
  assistant_persona: string | null
  assistant_system_prompt: string | null
  assistant_data_access: unknown
  assistant_pro_mode: boolean | null
}

export function leerFilaConfig(fila: FilaConfig | null): TexConfigOrg {
  const acceso: Record<string, boolean> = {}
  const crudo = fila?.assistant_data_access
  if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) {
    for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) if (typeof v === 'boolean') acceso[k] = v
  }
  const esfuerzo = ESFUERZOS.find((e) => e === fila?.assistant_effort) ?? 'medium'
  return {
    esfuerzo,
    persona: fila?.assistant_persona?.trim() || null,
    instrucciones: fila?.assistant_system_prompt?.trim() || null,
    accesoDatos: acceso,
    modoProGuardado: fila?.assistant_pro_mode === true,
    existe: fila != null,
  }
}

/**
 * El contexto de Tex y la configuración de la org. null = sin sesión de
 * dashboard u organización (el panel del barbero, con PIN, no tiene usuario
 * de Supabase Auth y no usa Tex). Tira si alguna lectura falla.
 */
export const obtenerContextoTexConConfig = cache(async function obtenerContextoTexConConfig(): Promise<{
  ctx: TexContexto
  config: TexConfigOrg
} | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null
  const user = await getCachedAuthUser()
  if (!user) return null

  const supabase = createAdminClient()
  const [permisos, alcance, sucursalesRes, staffRes, miembroRes, orgRes, cfgRes] = await Promise.all([
    getCurrentUserPermissions(),
    // null = todas las sucursales de la org. Tira si no pudo leer el rol o su scope.
    resolverAlcanceDelUsuario({ userId: user.id, orgId, estricto: true }),
    // Todas las de la org (también las inactivas, como `getOrgBranchIds`): el alcance se
    // recorta acá abajo. Leídas acá y con su error, no con `getOrgBranchIds`, que ante una
    // falla devuelve [] y Tex creería que la org no tiene sucursales.
    supabase.from('branches').select('id, name, slug, address, operation_mode').eq('organization_id', orgId).order('name', { ascending: true }),
    supabase.from('staff').select('role, is_active, full_name').eq('auth_user_id', user.id).eq('organization_id', orgId).maybeSingle(),
    supabase.from('organization_members').select('role').eq('user_id', user.id).eq('organization_id', orgId).maybeSingle(),
    supabase.from('organizations').select('name, currency').eq('id', orgId).maybeSingle(),
    supabase.from('organization_ai_config').select(COLUMNAS_CONFIG_TEX).eq('organization_id', orgId).maybeSingle(),
  ])
  if (sucursalesRes.error) throw new Error(`[tex] branches: ${sucursalesRes.error.message}`)
  if (staffRes.error) throw new Error(`[tex] staff: ${staffRes.error.message}`)
  if (miembroRes.error) throw new Error(`[tex] organization_members: ${miembroRes.error.message}`)
  if (orgRes.error) throw new Error(`[tex] organizations: ${orgRes.error.message}`)
  if (cfgRes.error) throw new Error(`[tex] organization_ai_config: ${cfgRes.error.message}`)

  const staff = staffRes.data as { role: string | null; is_active: boolean | null; full_name: string | null } | null
  const miembro = miembroRes.data as { role: string | null } | null
  // Con fila de staff manda esa fila (y si está dada de baja, no es dueño de nada);
  // sin staff, el rol de organization_members (hay owners que sólo viven ahí).
  const esDuenoOAdmin = staff
    ? staff.is_active === true && (staff.role === 'owner' || staff.role === 'admin')
    : miembro?.role === 'owner' || miembro?.role === 'admin'

  const deLaOrg = ((sucursalesRes.data ?? []) as { id: string; name: string; slug: string | null; address: string | null; operation_mode: string | null }[]).map(
    (b): TexSucursal => ({ id: b.id, nombre: b.name, slug: b.slug ?? null, direccion: b.address ?? null, modo: b.operation_mode ?? null }),
  )
  // El alcance del rol, recortado a las sucursales que existen en la org (como `getScopedBranchIds`).
  const permitidas = alcance === null ? null : new Set(alcance)
  const sucursales = permitidas === null ? deLaOrg : deLaOrg.filter((b) => permitidas.has(b.id))

  const config = leerFilaConfig(cfgRes.data as FilaConfig | null)
  const org = orgRes.data as { name: string | null; currency: string | null } | null
  const metadata = (user.user_metadata ?? {}) as { full_name?: unknown; name?: unknown }
  const nombreMeta = typeof metadata.full_name === 'string' ? metadata.full_name : typeof metadata.name === 'string' ? metadata.name : null

  const ctx: TexContexto = {
    orgId,
    orgNombre: org?.name?.trim() || 'tu barbería',
    moneda: org?.currency || 'ARS',
    userId: user.id,
    nombreUsuario: nombreDePila(staff?.full_name ?? nombreMeta),
    esDuenoOAdmin,
    permisos,
    sucursalesIds: sucursales.map((s) => s.id),
    sucursales,
    todasLasSucursales: deLaOrg.length > 0 && sucursales.length === deLaOrg.length,
    accesoDatos: config.accesoDatos,
    // Gate doble: el interruptor de la org Y ser dueño/admin.
    modoPro: config.modoProGuardado && esDuenoOAdmin,
    // Fecha de pared en Argentina: con UTC, de 21 a 24 h Tex creería que ya es mañana.
    hoy: getLocalDateStr(),
  }
  return { ctx, config }
})

/**
 * Quién pregunta y qué puede ver, resuelto desde la sesión. null = sin sesión
 * u organización. Los permisos salen de getCurrentUserPermissions (con el corte
 * del staff inactivo, Known Risk #19).
 */
export async function obtenerContextoTex(): Promise<TexContexto | null> {
  const r = await obtenerContextoTexConConfig()
  return r?.ctx ?? null
}

/** ¿Este contexto puede usar Tex? (stats.view o settings.view, owner/admin siempre). */
export function puedeUsarTex(ctx: Pick<TexContexto, 'esDuenoOAdmin' | 'permisos'>): boolean {
  return ctx.esDuenoOAdmin || ctx.permisos['stats.view'] === true || ctx.permisos['settings.view'] === true
}

/** ¿Puede configurar Tex? (owner/admin o settings.manage). */
export function puedeConfigurarTex(ctx: Pick<TexContexto, 'esDuenoOAdmin' | 'permisos'>): boolean {
  return ctx.esDuenoOAdmin || ctx.permisos['settings.manage'] === true
}
