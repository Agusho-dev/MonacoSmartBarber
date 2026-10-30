/**
 * Transporte del canal de una pelea online sobre Supabase Realtime (broadcast público,
 * `self: false`): `juego-pelea:<id>`, un solo evento («p») con el mensaje adentro.
 *
 * Sólo manda con el canal unido: el `send` de realtime-js, sin unir, cae a un POST por REST
 * (y avisa por consola); acá eso no conviene nunca, y el duelo reintenta solo.
 *
 * Si el SERVIDOR cierra el canal (un límite suyo: realtime-js lo saca de su lista y no reintenta),
 * se abre uno nuevo con el mismo tópico, con espera creciente. Los errores de conexión
 * (CHANNEL_ERROR, TIMED_OUT) los reintenta realtime-js solo.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { TransporteDuelo } from './duelo'
import { PREFIJO_PELEA, type MensajePelea } from './protocolo'

const REUNIR_MAX = 5
const REUNIR_MS = 600

export interface TransporteRealtime extends TransporteDuelo {
  unido(): boolean
}

export function abrirTransportePelea(
  cliente: SupabaseClient,
  peleaId: string,
  alMensaje: (crudo: unknown) => void,
): TransporteRealtime {
  let unido = false
  let cerrado = false
  let reintentos = 0
  let canal: RealtimeChannel

  const unir = () => {
    const c = cliente.channel(PREFIJO_PELEA + peleaId, {
      config: { broadcast: { self: false, ack: false } },
    })
    canal = c
    c.on('broadcast', { event: 'p' }, (msg: { payload?: unknown }) => {
      if (!cerrado && canal === c) alMensaje(msg?.payload)
    })
    c.subscribe((estado) => {
      if (cerrado || canal !== c) return
      unido = estado === 'SUBSCRIBED'
      if (unido) {
        reintentos = 0
      } else if (estado === 'CLOSED' && reintentos < REUNIR_MAX) {
        reintentos++
        setTimeout(() => {
          if (!cerrado && canal === c) unir()
        }, REUNIR_MS * reintentos)
      }
    })
  }
  unir()

  return {
    unido: () => unido,
    // Lo lee el duelo: sin canal unido no se reclama un abandono (el que se fue es éste).
    conectado: () => unido && !cerrado,
    enviar(m: MensajePelea) {
      if (!unido || cerrado) return false
      void canal.send({ type: 'broadcast', event: 'p', payload: m }).catch(() => {})
      return true
    },
    cerrar() {
      if (cerrado) return
      cerrado = true
      unido = false
      void cliente.removeChannel(canal).catch(() => {})
    },
  }
}
