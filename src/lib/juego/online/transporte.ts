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
 *
 * `sondear()`: ¿este celular tiene red? Cuando el 4G se traba sin cerrar la conexión, el canal
 * sigue «unido»: realtime-js recién se entera con su latido (cada 25 s), entre 25 y 50 s después.
 * El sondeo hace una ida y vuelta REAL por el socket con ese mismo latido (el «heartbeat» de
 * Phoenix: no es un mensaje de Realtime, no gasta del presupuesto de la sala) y espera la
 * respuesta del servidor. API de realtime-js 2.98 (revisada el 30/oct/2026): `onHeartbeat`,
 * `sendHeartbeat`, `pendingHeartbeatRef`, `heartbeatTimer` y `heartbeatIntervalMs`, todos públicos.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { TransporteDuelo } from './duelo'
import { PREFIJO_PELEA, type MensajePelea } from './protocolo'

const REUNIR_MAX = 5
const REUNIR_MS = 600
/**
 * Sin la respuesta del latido en este tiempo, el sondeo da «sin red». La ida y vuelta al servidor
 * de Realtime es de ≈ 0,2 s (en 4G, hasta 0,6 s).
 */
export const SONDEO_MS = 2000

type ClienteRealtime = SupabaseClient['realtime']
type AlLatido = ClienteRealtime['heartbeatCallback']
type EstadoLatido = Parameters<AlLatido>[0]

interface Latidos {
  /** El callback instalado acá (si alguien lo reemplaza, se vuelve a instalar encadenando el suyo). */
  propio: AlLatido
  oyentes: Set<(e: EstadoLatido) => void>
}

const latidosPorCliente = new WeakMap<ClienteRealtime, Latidos>()

/**
 * realtime-js tiene UN callback de latidos por cliente (`onHeartbeat` reemplaza al anterior) y el
 * cliente del navegador es uno solo para toda la página: se instala uno que reparte a los sondeos
 * vivos y sigue llamando al que hubiera antes.
 */
function escucharLatidos(rt: ClienteRealtime, fn: (e: EstadoLatido) => void): () => void {
  let l = latidosPorCliente.get(rt)
  if (!l || rt.heartbeatCallback !== l.propio) {
    const anterior = rt.heartbeatCallback
    const oyentes = l?.oyentes ?? new Set<(e: EstadoLatido) => void>()
    const propio: AlLatido = (estado, latencia) => {
      try {
        anterior?.(estado, latencia)
      } catch {
        // El de antes no es nuestro: que no corte el reparto.
      }
      for (const f of [...oyentes]) f(estado)
    }
    rt.onHeartbeat(propio)
    l = { propio, oyentes }
    latidosPorCliente.set(rt, l)
  }
  const oyentes = l.oyentes
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/**
 * El sondeo es un latido más: el reloj de latidos de realtime-js vuelve a contar desde acá. Si no,
 * su próximo latido podía salir con el nuestro todavía en vuelo y, como encuentra uno pendiente,
 * lo daba por vencido y cortaba un socket sano («heartbeat timeout» y reconexión).
 */
function reiniciarRelojDeLatidos(rt: ClienteRealtime): void {
  // Con el latido en un worker (o sin conexión) no hay reloj acá.
  if (rt.heartbeatTimer === undefined) return
  clearInterval(rt.heartbeatTimer)
  rt.heartbeatTimer = setInterval(() => {
    void rt.sendHeartbeat().catch(() => {})
  }, rt.heartbeatIntervalMs)
}

/** Una ida y vuelta por el socket: true = llegó la respuesta del servidor a tiempo. */
function sondearSocket(rt: ClienteRealtime): Promise<boolean> {
  if (!rt.isConnected()) return Promise.resolve(false)
  return new Promise<boolean>((resolver) => {
    let listo = false
    let dejar: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | null = null
    const terminar = (ok: boolean) => {
      if (listo) return
      listo = true
      if (timer !== null) clearTimeout(timer)
      dejar()
      resolver(ok)
    }
    dejar = escucharLatidos(rt, (estado) => {
      if (estado === 'ok') terminar(true)
      // 'error', 'timeout' o 'disconnected': sin red. 'sent' es el aviso de que salió.
      else if (estado !== 'sent') terminar(false)
    })
    timer = setTimeout(() => terminar(false), SONDEO_MS)
    // Siempre un latido propio, soltando antes el que hubiera pendiente: con uno pendiente,
    // sendHeartbeat lo da por vencido y corta el socket. Y no se puede esperar al pendiente:
    // realtime-js no lo limpia al reconectar, así que puede ser de un socket que ya murió y su
    // respuesta no llega nunca (medido en duelo-corte.mts, «caida-corta»: el sondeo fallaba para
    // siempre y el que tenía red perdía). Si la respuesta del viejo llega, realtime-js la ignora.
    rt.pendingHeartbeatRef = null
    void rt.sendHeartbeat().catch(() => {})
    reiniciarRelojDeLatidos(rt)
  })
}

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

  /**
   * El socket abierto. Cuando realtime-js lo cierra (por ejemplo, un latido vencido con la red
   * trabada), el canal se entera recién cuando el cierre termina: en ese rato `unido` sigue en true
   * y `send` caería al POST por REST.
   */
  const socketAbierto = () => {
    try {
      return cliente.realtime.isConnected()
    } catch {
      return true
    }
  }

  return {
    unido: () => unido,
    // Lo lee el duelo: sin canal unido no se reclama un abandono (el que se fue es éste).
    conectado: () => unido && !cerrado && socketAbierto(),
    sondear() {
      if (!unido || cerrado) return Promise.resolve(false)
      try {
        return sondearSocket(cliente.realtime)
      } catch {
        return Promise.resolve(false)
      }
    },
    enviar(m: MensajePelea) {
      if (!unido || cerrado || !socketAbierto()) return false
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
