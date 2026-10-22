import 'server-only'

// =============================================================================
// src/lib/tex/equipo.ts
// Los barberos que Tex conoce, leídos de `staff` con la service role y SIEMPRE
// acotados a la organización y al alcance del rol (ctx.sucursalesIds).
//
// Dos usos:
//   - `leerEquipoTex`: los barberos ACTIVOS por sucursal para el system prompt,
//     así el modelo sabe que "Chipi" es del equipo y no lo busca como cliente.
//     NUNCA tira: si la lectura falla, el prompt sale sin esa sección y el turno
//     sigue (es un dato de contexto, no una cifra).
//   - `leerBarberosDelAlcance`: todos (también los dados de baja, que pueden
//     tener reseñas del período) para resolver el parámetro `barbero` de una
//     herramienta. TIRA si no pudo leer: la herramienta dice "no pude leer".
//
// Barbero = rol `barber` o `is_also_barber` (un admin que también corta).
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { agruparEquipo, nombreLimpio, type BarberoDelAlcance, type TexEquipoSucursal } from './barberos'
import { leerTodas } from './datos'
import type { TexContexto } from './herramientas/tipos'

interface FilaStaff {
  id: string
  full_name: string | null
  branch_id: string | null
  is_active: boolean | null
  role: string | null
  is_also_barber: boolean | null
}

const COLUMNAS = 'id, full_name, branch_id, is_active, role, is_also_barber'

function esBarbero(f: FilaStaff): boolean {
  return f.role === 'barber' || f.is_also_barber === true
}

function aBarbero(f: FilaStaff): BarberoDelAlcance {
  return { id: f.id, nombre: nombreLimpio(f.full_name), sucursalId: f.branch_id ?? null, activo: f.is_active === true }
}

/**
 * Los barberos de la org que se pueden nombrar desde este alcance: los de sus
 * sucursales (activos o no) y los que no tienen sucursal asignada. Las cifras
 * igual se acotan después al alcance (las RPC reciben las sucursales), así que
 * un barbero sin sucursal no abre nada fuera de él. Tira si no pudo leer.
 */
export async function leerBarberosDelAlcance(ctx: Pick<TexContexto, 'orgId' | 'sucursalesIds'>): Promise<BarberoDelAlcance[]> {
  if (ctx.sucursalesIds.length === 0) return []
  const supabase = createAdminClient()
  const filas = await leerTodas<FilaStaff>(
    (a, b) =>
      supabase
        .from('staff')
        .select(COLUMNAS)
        .eq('organization_id', ctx.orgId)
        .or('role.eq.barber,is_also_barber.eq.true')
        .order('id', { ascending: true })
        .range(a, b),
    { contexto: 'barberos', maxFilas: 5_000 },
  )
  const alcance = new Set(ctx.sucursalesIds)
  return filas
    .filter((f) => esBarbero(f) && (f.branch_id == null || alcance.has(f.branch_id)))
    .map(aBarbero)
    .filter((b) => b.nombre !== '')
}

/**
 * Los barberos activos de las sucursales del alcance, agrupados por sucursal
 * (en el orden del contexto). null si no se pudo leer o si no hay ninguno: el
 * system prompt sale sin la sección. Nunca tira.
 */
export async function leerEquipoTex(ctx: Pick<TexContexto, 'orgId' | 'sucursalesIds' | 'sucursales'>): Promise<TexEquipoSucursal[] | null> {
  if (ctx.sucursalesIds.length === 0) return null
  try {
    const supabase = createAdminClient()
    const filas = await leerTodas<FilaStaff>(
      (a, b) =>
        supabase
          .from('staff')
          .select(COLUMNAS)
          .eq('organization_id', ctx.orgId)
          .eq('is_active', true)
          .in('branch_id', ctx.sucursalesIds)
          .or('role.eq.barber,is_also_barber.eq.true')
          .order('id', { ascending: true })
          .range(a, b),
      { contexto: 'equipo', maxFilas: 5_000 },
    )
    const alcance = new Set(ctx.sucursalesIds)
    const barberos = filas.filter((f) => esBarbero(f) && f.is_active === true && f.branch_id != null && alcance.has(f.branch_id)).map(aBarbero)
    const equipo = agruparEquipo(ctx.sucursales, barberos)
    return equipo.length > 0 ? equipo : null
  } catch (err) {
    // Known Risk #13: se dice en el log; el turno sigue sin la sección del equipo.
    console.error('[tex] no pude leer el equipo para el system:', err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300))
    return null
  }
}
