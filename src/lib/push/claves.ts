// =============================================================================
// Las claves VAPID de los avisos push del dashboard (mig 237, `push_claves`).
//
// OJO: esto es el Web Push del DASHBOARD (avisos al equipo en el navegador o en
// la app instalada del iPhone). La app de clientes usa FCM y otra cadena
// (push_outbox → send-push, app-movil.md): no se mezclan.
//
// Se generan solas la primera vez que alguien activa los avisos, y la privada
// se guarda cifrada con la clave maestra de siempre (cifrarSecreto, la misma de
// ARCA y Mercado Pago). Así no hace falta cargar variables en Vercel. Cambiar
// el par invalida TODAS las suscripciones: no se rota.
// =============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cifrarSecreto, descifrarSecreto } from '@/lib/crypto/secretos'
import { crearClavesVapid, type ClavesVapid } from './web-push'

let enMemoria: ClavesVapid | null = null

export async function obtenerClavesVapid(supabase: SupabaseClient): Promise<ClavesVapid> {
  if (enMemoria) return enMemoria

  const leer = async () => {
    const { data, error } = await supabase.from('push_claves').select('publica, privada_cifrada').eq('id', true).maybeSingle()
    if (error) throw new Error(`[push] push_claves: ${error.message}`)
    return data as { publica: string; privada_cifrada: string } | null
  }

  let fila = await leer()
  if (!fila) {
    const nuevas = crearClavesVapid()
    const { error } = await supabase
      .from('push_claves')
      .insert({ id: true, publica: nuevas.publica, privada_cifrada: await cifrarSecreto(nuevas.privada) })
    // 23505: otro pedido la creó en el mismo instante. Vale la suya.
    if (error && error.code !== '23505') throw new Error(`[push] no se pudo guardar el par VAPID: ${error.message}`)
    fila = await leer()
    if (!fila) throw new Error('[push] el par VAPID no quedó guardado')
  }

  enMemoria = { publica: fila.publica, privada: await descifrarSecreto(fila.privada_cifrada) }
  return enMemoria
}

/** Sólo la pública (para el browser). No descifra nada si ya está creada. */
export async function clavePublicaVapid(supabase: SupabaseClient): Promise<string> {
  if (enMemoria) return enMemoria.publica
  const { data, error } = await supabase.from('push_claves').select('publica').eq('id', true).maybeSingle()
  if (error) throw new Error(`[push] push_claves: ${error.message}`)
  if (data) return (data as { publica: string }).publica
  return (await obtenerClavesVapid(supabase)).publica
}
