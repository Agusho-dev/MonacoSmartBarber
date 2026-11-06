// =============================================================================
// Mandar un aviso push a los dispositivos de una organización (server-only).
//
// Lo usan el cron de «Por responder» (api/cron/avisos-mensajeria) y el botón
// «Probar» de la hoja de avisos (actions/avisos-push.ts).
//
// - Sólo a quien sigue en la org: una persona dada de baja (staff inactivo o
//   que ya no es miembro) no recibe nombres de clientes en su teléfono.
// - Una suscripción que el servicio de push da por muerta (404/410) se borra.
//   Las demás fallas suman `fallas`; a las 10 seguidas se borra.
// =============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { obtenerClavesVapid } from './claves'
import { enviarPush, type OpcionesEnvio } from './web-push'

/** Lo que lee el service worker (public/sw-avisos.js). */
export interface AvisoPush {
  titulo: string
  cuerpo: string
  /** Adónde lleva tocar el aviso (una ruta del dashboard). */
  url: string
  /** Un aviso nuevo con el mismo tag reemplaza al anterior en la pantalla. */
  tag: string
  /** El número del ícono de la app (Badging API). */
  pendientes?: number
}

export interface FilaSuscripcion {
  id: string
  organization_id: string
  auth_user_id: string
  endpoint: string
  p256dh: string
  auth: string
  sucursales: string[] | null
  avisar_resenas: boolean
  avisar_consultas: boolean
  fallas: number
}

export interface FiltroDeAviso {
  tipo: 'resena' | 'consulta' | 'prueba'
  /** La sucursal de la reseña: no le llega a quien sólo ve otras. */
  sucursalId?: string | null
  /** Sólo este dispositivo («Probar»). */
  endpoint?: string
}

const COLUMNAS = 'id, organization_id, auth_user_id, endpoint, p256dh, auth, sucursales, avisar_resenas, avisar_consultas, fallas'

/** Quiénes de esta lista siguen en la org (staff activo o miembro). */
async function siguenEnLaOrg(supabase: SupabaseClient, orgId: string, usuarios: string[]): Promise<Set<string>> {
  if (usuarios.length === 0) return new Set()
  const [staff, miembros, inactivos] = await Promise.all([
    supabase.from('staff').select('auth_user_id').eq('organization_id', orgId).eq('is_active', true).in('auth_user_id', usuarios),
    supabase.from('organization_members').select('user_id').eq('organization_id', orgId).in('user_id', usuarios),
    supabase.from('staff').select('auth_user_id').eq('organization_id', orgId).eq('is_active', false).in('auth_user_id', usuarios),
  ])
  if (staff.error) throw new Error(`[push] staff: ${staff.error.message}`)
  if (miembros.error) throw new Error(`[push] organization_members: ${miembros.error.message}`)
  if (inactivos.error) throw new Error(`[push] staff: ${inactivos.error.message}`)
  const dadosDeBaja = new Set(((inactivos.data ?? []) as { auth_user_id: string }[]).map((s) => s.auth_user_id))
  const ok = new Set<string>()
  for (const s of (staff.data ?? []) as { auth_user_id: string }[]) ok.add(s.auth_user_id)
  // Miembro de la org sin fila activa en staff (dueños), pero no un empleado dado de baja (Known Risk #19).
  for (const m of (miembros.data ?? []) as { user_id: string }[]) if (!dadosDeBaja.has(m.user_id)) ok.add(m.user_id)
  return ok
}

/** Las suscripciones de la org que quieren este tipo de aviso. */
export async function suscripcionesPara(
  supabase: SupabaseClient,
  orgId: string,
  filtro: FiltroDeAviso,
): Promise<FilaSuscripcion[]> {
  let q = supabase.from('push_suscripciones').select(COLUMNAS).eq('organization_id', orgId)
  if (filtro.endpoint) q = q.eq('endpoint', filtro.endpoint)
  if (filtro.tipo === 'resena') q = q.eq('avisar_resenas', true)
  if (filtro.tipo === 'consulta') q = q.eq('avisar_consultas', true)
  const { data, error } = await q.limit(200)
  if (error) throw new Error(`[push] push_suscripciones: ${error.message}`)
  const filas = (data ?? []) as FilaSuscripcion[]
  const vigentes = await siguenEnLaOrg(supabase, orgId, Array.from(new Set(filas.map((f) => f.auth_user_id))))
  return filas.filter((f) => {
    if (!vigentes.has(f.auth_user_id)) return false
    if (filtro.tipo === 'resena' && filtro.sucursalId && f.sucursales && !f.sucursales.includes(filtro.sucursalId)) return false
    return true
  })
}

/**
 * Manda el aviso a cada suscripción. Devuelve cuántos salieron. No tira por un
 * envío que falla: lo anota en la fila (y borra la suscripción si murió).
 */
export async function mandarAviso(
  supabase: SupabaseClient,
  suscripciones: FilaSuscripcion[],
  aviso: AvisoPush,
  opciones: Omit<OpcionesEnvio, 'contacto'> & { contacto: string },
): Promise<{ enviados: number; fallidos: number; borrados: number }> {
  if (suscripciones.length === 0) return { enviados: 0, fallidos: 0, borrados: 0 }
  const claves = await obtenerClavesVapid(supabase)
  let enviados = 0
  let fallidos = 0
  let borrados = 0
  await Promise.all(
    suscripciones.map(async (s) => {
      const r = await enviarPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, aviso, claves, opciones)
      const ahora = new Date().toISOString()
      if (r.ok) {
        enviados++
        const { error } = await supabase
          .from('push_suscripciones')
          .update({ ultimo_ok_at: ahora, fallas: 0, ultimo_error: null })
          .eq('id', s.id)
        if (error) console.error('[push] no se pudo anotar el envío:', error.message)
        return
      }
      fallidos++
      if (r.vencida || s.fallas + 1 >= 10) {
        borrados++
        const { error } = await supabase.from('push_suscripciones').delete().eq('id', s.id)
        if (error) console.error('[push] no se pudo borrar una suscripción vencida:', error.message)
        return
      }
      console.error('[push] el servicio de push rechazó un aviso:', r.status, r.detalle)
      const { error } = await supabase
        .from('push_suscripciones')
        .update({ fallas: s.fallas + 1, ultimo_error: `${r.status} ${r.detalle}`.slice(0, 300) })
        .eq('id', s.id)
      if (error) console.error('[push] no se pudo anotar la falla:', error.message)
    }),
  )
  return { enviados, fallidos, borrados }
}
