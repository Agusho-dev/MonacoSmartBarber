'use server'

// =============================================================================
// Los avisos push de «Por responder» en este dispositivo (6/nov/2026): la hoja
// «Avisos» de la bandeja los prende, los ajusta, los prueba y los apaga.
//
// Una suscripción = un navegador o la app instalada en un teléfono. Se guarda
// con la org y las sucursales que ve la persona en ese momento (una reseña de
// Caseros no le llega a quien sólo ve Rondeau). El browser nunca elige org ni
// sucursales: salen de la sesión.
//
// Como las de la bandeja: nunca tiran, devuelven { ok } o { ok: false, error }.
// =============================================================================

import { headers } from 'next/headers'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { getAllowedBranchIds } from './branch-access'
import { currentUserCan } from './permissions-gate'
import { clavePublicaVapid } from '@/lib/push/claves'
import { mandarAviso, suscripcionesPara } from '@/lib/push/avisar'
import { esEndpointDePush } from '@/lib/push/web-push'

type Falla = { ok: false; error: string }

export interface PreferenciasDeAvisos {
  avisarResenas: boolean
  avisarConsultas: boolean
}

async function acceso(): Promise<{ ok: true; userId: string; orgId: string } | Falla> {
  const usuario = await getCachedAuthUser()
  if (!usuario) return { ok: false, error: 'Tu sesión venció. Volvé a iniciar sesión.' }
  if (!(await currentUserCan('clients.view'))) return { ok: false, error: 'No tenés permiso para ver Mensajería.' }
  const orgId = await getCurrentOrgId()
  if (!orgId) return { ok: false, error: 'No autorizado' }
  return { ok: true, userId: usuario.id, orgId }
}

function mensajeDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** El origen del dashboard (el `sub` de VAPID y la base de los enlaces). */
async function origen(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'monacobarber.vercel.app'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** La clave pública VAPID (la `applicationServerKey` del navegador). */
export async function clavePublicaDeAvisos(): Promise<{ ok: true; clave: string } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    return { ok: true, clave: await clavePublicaVapid(createAdminClient()) }
  } catch (err) {
    console.error('[avisos] clavePublicaDeAvisos:', mensajeDe(err))
    return { ok: false, error: 'No pudimos preparar los avisos. Probá de nuevo.' }
  }
}

/** Guarda (o actualiza) la suscripción de este dispositivo. */
export async function guardarSuscripcionDeAvisos(datos: {
  endpoint: string
  p256dh: string
  auth: string
  dispositivo?: string | null
} & Partial<PreferenciasDeAvisos>): Promise<{ ok: true; preferencias: PreferenciasDeAvisos } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    if (!esEndpointDePush(datos.endpoint ?? '')) return { ok: false, error: 'Este navegador no ofrece avisos compatibles.' }
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(datos.p256dh ?? '') || !/^[A-Za-z0-9_-]{16,40}$/.test(datos.auth ?? '')) {
      return { ok: false, error: 'La suscripción del navegador no es válida.' }
    }
    const supabase = createAdminClient()
    // null = todas las sucursales de la org (falla cerrado: sin rol legible no hay sucursales).
    const permitidas = await getAllowedBranchIds()
    const { data: existente } = await supabase
      .from('push_suscripciones')
      .select('avisar_resenas, avisar_consultas, auth_user_id')
      .eq('endpoint', datos.endpoint)
      .maybeSingle()
    const previa = existente as { avisar_resenas: boolean; avisar_consultas: boolean; auth_user_id: string } | null
    // Si el mismo navegador lo usa otra persona, empieza con lo de siempre.
    const base = previa && previa.auth_user_id === a.userId ? previa : null
    const preferencias: PreferenciasDeAvisos = {
      avisarResenas: datos.avisarResenas ?? base?.avisar_resenas ?? true,
      avisarConsultas: datos.avisarConsultas ?? base?.avisar_consultas ?? true,
    }
    const ahora = new Date().toISOString()
    const { error } = await supabase.from('push_suscripciones').upsert(
      {
        organization_id: a.orgId,
        auth_user_id: a.userId,
        endpoint: datos.endpoint,
        p256dh: datos.p256dh,
        auth: datos.auth,
        sucursales: permitidas === null ? null : permitidas,
        avisar_resenas: preferencias.avisarResenas,
        avisar_consultas: preferencias.avisarConsultas,
        dispositivo: (datos.dispositivo ?? '').slice(0, 80) || null,
        actualizada_at: ahora,
        fallas: 0,
        ultimo_error: null,
      },
      { onConflict: 'endpoint' },
    )
    if (error) throw new Error(error.message)
    return { ok: true, preferencias }
  } catch (err) {
    console.error('[avisos] guardarSuscripcionDeAvisos:', mensajeDe(err))
    return { ok: false, error: 'No pudimos activar los avisos. Probá de nuevo.' }
  }
}

/** ¿Este dispositivo está suscripto (para esta persona)? Y con qué preferencias. */
export async function estadoDeAvisos(endpoint: string): Promise<{ ok: true; activo: boolean; preferencias: PreferenciasDeAvisos } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('push_suscripciones')
      .select('avisar_resenas, avisar_consultas')
      .eq('endpoint', endpoint)
      .eq('auth_user_id', a.userId)
      .eq('organization_id', a.orgId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const fila = data as { avisar_resenas: boolean; avisar_consultas: boolean } | null
    return {
      ok: true,
      activo: !!fila,
      preferencias: { avisarResenas: fila?.avisar_resenas ?? true, avisarConsultas: fila?.avisar_consultas ?? true },
    }
  } catch (err) {
    console.error('[avisos] estadoDeAvisos:', mensajeDe(err))
    return { ok: false, error: 'No pudimos leer los avisos de este dispositivo.' }
  }
}

/** Cambia qué avisos recibe este dispositivo. */
export async function cambiarPreferenciasDeAvisos(endpoint: string, preferencias: PreferenciasDeAvisos): Promise<{ ok: true } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    const { error } = await createAdminClient()
      .from('push_suscripciones')
      .update({
        avisar_resenas: !!preferencias.avisarResenas,
        avisar_consultas: !!preferencias.avisarConsultas,
        actualizada_at: new Date().toISOString(),
      })
      .eq('endpoint', endpoint)
      .eq('auth_user_id', a.userId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    console.error('[avisos] cambiarPreferenciasDeAvisos:', mensajeDe(err))
    return { ok: false, error: 'No se pudo guardar. Probá de nuevo.' }
  }
}

/** Apaga los avisos de este dispositivo. */
export async function borrarSuscripcionDeAvisos(endpoint: string): Promise<{ ok: true } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    const { error } = await createAdminClient()
      .from('push_suscripciones')
      .delete()
      .eq('endpoint', endpoint)
      .eq('auth_user_id', a.userId)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    console.error('[avisos] borrarSuscripcionDeAvisos:', mensajeDe(err))
    return { ok: false, error: 'No se pudieron apagar. Probá de nuevo.' }
  }
}

/** Un aviso de prueba a este dispositivo. */
export async function probarAvisos(endpoint: string): Promise<{ ok: true } | Falla> {
  try {
    const a = await acceso()
    if (!a.ok) return a
    const supabase = createAdminClient()
    const subs = (await suscripcionesPara(supabase, a.orgId, { tipo: 'prueba', endpoint }))
      .filter((s) => s.auth_user_id === a.userId)
    if (subs.length === 0) return { ok: false, error: 'Este dispositivo no tiene los avisos activados.' }
    const r = await mandarAviso(
      supabase,
      subs,
      {
        titulo: 'Así te van a llegar los avisos',
        cuerpo: 'Cuando una reseña llegue baja o una consulta quede sin responder, te avisamos acá.',
        url: '/dashboard/mensajeria?responder=1',
        tag: 'prueba-avisos',
      },
      { contacto: await origen(), ttl: 600, urgencia: 'high' },
    )
    if (r.enviados === 0) return { ok: false, error: 'El servicio de avisos del navegador no lo aceptó. Volvé a activarlos.' }
    return { ok: true }
  } catch (err) {
    console.error('[avisos] probarAvisos:', mensajeDe(err))
    return { ok: false, error: 'No se pudo mandar la prueba. Probá de nuevo.' }
  }
}
