/**
 * Transporte del canal de una pelea online sobre Supabase Realtime (broadcast público,
 * `self: false`): `juego-pelea:<id>`, un solo evento («p») con el mensaje adentro.
 *
 * Sólo manda con el canal unido: el `send` de realtime-js, sin unir, cae a un POST por REST
 * (y avisa por consola); acá eso no conviene nunca, y el duelo reintenta solo.
 *
 * Si el SERVIDOR cierra el canal (un límite suyo: realtime-js lo saca de su lista y no reintenta),
 * se abre uno nuevo con el mismo tópico, con espera creciente. Los errores de conexión
 * (CHANNEL_ERROR, TIMED_OUT) los reintenta realtime-js solo, con una espera que crece hasta 10 s
 * para el socket y otro tanto para volver a unirse al canal: con el canal caído, el duelo llama a
 * `reintentar` cada segundo y se reconecta apenas hay red (antes, con el wifi de vuelta, la pelea
 * anulada tardaba 12–22 s más en llegar).
 *
 * `sondear()`: ¿este celular tiene red? Cuando el 4G se traba sin cerrar la conexión, el canal
 * sigue «unido»: realtime-js recién se entera con su latido (cada 25 s), entre 25 y 50 s después.
 * El sondeo hace una ida y vuelta REAL por el socket con ese mismo latido (el «heartbeat» de
 * Phoenix: no es un mensaje de Realtime, no gasta del presupuesto de la sala) y espera la
 * respuesta del servidor. Usa piezas de realtime-js 2.98 que son públicas pero no una API pensada
 * para esto (revisadas el 30/oct/2026): `onHeartbeat`, `heartbeatCallback`, `sendHeartbeat`,
 * `pendingHeartbeatRef`, `heartbeatTimer` y `heartbeatIntervalMs`. Por eso se miran al arrancar y
 * en cada sondeo (`latidoConocido`): si falta alguna o el latido se comporta distinto (en un
 * worker, sin dejar su pendiente al salir), el sondeo dice «no sé» (null) y el duelo decide como
 * antes del sondeo. Así una actualización de @supabase/supabase-js nunca trae un «Sin conexión»
 * falso ni un abandono falso; a lo sumo vuelve lo de antes del 31/oct (`duelo-corte.mts`,
 * escenarios «api-*»).
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
/**
 * Entre dos intentos de abrir el socket: empieza en 1 s y crece (×1,5) hasta 3 s mientras la red no
 * vuelve (con la red caída del todo, a lo sumo 20 intentos por minuto: sin red fallan en el celular,
 * no llegan al servidor); vuelve a 1 s al unirse o cuando el navegador avisa que volvió la red
 * (`online`). realtime-js solo espera 1, 2, 5 y después 10 s.
 */
const REINTENTO_MS = 1000
const REINTENTO_MAX_MS = 3000
/** Después de abrir el socket, se mira de nuevo a este rato: si ya abrió, el canal se une sin esperar al latido. */
const MIRAR_SOCKET_MS = 500
/**
 * Entre dos veces que se vuelve a unir el canal con el socket abierto: la primera, enseguida; si el
 * servidor la rechaza, el doble cada vez hasta 8 s (que un rechazo no se convierta en un join por segundo).
 */
const REUNION_MS = 1000
const REUNION_MAX_MS = 8000

type ClienteRealtime = SupabaseClient['realtime']
type AlLatido = ClienteRealtime['heartbeatCallback']
type EstadoLatido = Parameters<AlLatido>[0]

interface Latidos {
  /** El callback instalado acá (si alguien lo reemplaza, se vuelve a instalar encadenando el suyo). */
  propio: AlLatido
  oyentes: Set<(e: EstadoLatido) => void>
}

const latidosPorCliente = new WeakMap<ClienteRealtime, Latidos>()
/** Clientes cuyo latido no se comporta como el de realtime-js 2.98: su sondeo dice «no sé». */
const latidoDesconocido = new WeakSet<ClienteRealtime>()
let avisoDesconocido = false

function marcarDesconocido(rt: ClienteRealtime, motivo: string): void {
  latidoDesconocido.add(rt)
  if (avisoDesconocido) return
  avisoDesconocido = true
  console.warn(`[juego] el sondeo de red no reconoce esta versión de realtime-js (${motivo}): el abandono se decide por el canal, como antes del 31/oct`)
}

/**
 * ¿El latido de este cliente es el que se conoce? Están todas las piezas y no late en un worker
 * (con el latido en un worker no hay reloj que reiniciar: su próximo latido podría encontrar el del
 * sondeo pendiente y cortar un socket sano).
 */
function latidoConocido(rt: ClienteRealtime): boolean {
  if (latidoDesconocido.has(rt)) return false
  const x = rt as unknown as Record<string, unknown>
  let falta: string | null = null
  if (typeof x.onHeartbeat !== 'function') falta = 'onHeartbeat'
  else if (typeof x.sendHeartbeat !== 'function') falta = 'sendHeartbeat'
  else if (typeof x.isConnected !== 'function') falta = 'isConnected'
  else if (typeof x.heartbeatCallback !== 'function') falta = 'heartbeatCallback'
  else if (!('pendingHeartbeatRef' in x)) falta = 'pendingHeartbeatRef'
  else if (!('heartbeatTimer' in x)) falta = 'heartbeatTimer'
  else if (typeof x.heartbeatIntervalMs !== 'number' || !(x.heartbeatIntervalMs > 0)) falta = 'heartbeatIntervalMs'
  else if (x.worker) falta = 'latido en un worker'
  if (falta === null) return true
  marcarDesconocido(rt, falta)
  return false
}

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
  if (rt.heartbeatTimer === undefined) return
  clearInterval(rt.heartbeatTimer)
  rt.heartbeatTimer = setInterval(() => {
    void rt.sendHeartbeat().catch(() => {})
  }, rt.heartbeatIntervalMs)
}

/** Una ida y vuelta por el socket: true = llegó la respuesta del servidor a tiempo; null = no sé. */
function sondearSocket(rt: ClienteRealtime): Promise<boolean | null> {
  if (!latidoConocido(rt)) return Promise.resolve(null)
  if (!rt.isConnected()) return Promise.resolve(false)
  // Con el socket abierto, realtime-js late con un setInterval propio: sin él, cambió cómo late.
  if (rt.heartbeatTimer === undefined) {
    marcarDesconocido(rt, 'sin reloj de latidos con el socket abierto')
    return Promise.resolve(null)
  }
  return new Promise<boolean | null>((resolver) => {
    let listo = false
    let salio = false
    let dejar: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | null = null
    const terminar = (ok: boolean | null) => {
      if (listo) return
      listo = true
      if (timer !== null) clearTimeout(timer)
      dejar()
      resolver(ok)
    }
    dejar = escucharLatidos(rt, (estado) => {
      // 'sent' es el aviso de que salió; 'error', 'timeout' o 'disconnected': sin red.
      if (estado === 'sent') salio = true
      else terminar(estado === 'ok')
    })
    timer = setTimeout(() => terminar(false), SONDEO_MS)
    // Siempre un latido propio, soltando antes el que hubiera pendiente: con uno pendiente,
    // sendHeartbeat lo da por vencido y corta el socket. Y no se puede esperar al pendiente:
    // realtime-js no lo limpia al reconectar, así que puede ser de un socket que ya murió y su
    // respuesta no llega nunca (medido en duelo-corte.mts, «caida-corta»: el sondeo fallaba para
    // siempre y el que tenía red perdía). Si la respuesta del viejo llega, realtime-js la ignora.
    rt.pendingHeartbeatRef = null
    void rt.sendHeartbeat().catch(() => {})
    // En 2.98, sendHeartbeat deja su latido pendiente y avisa 'sent' antes de volver. Si no pasó,
    // cambió cómo late realtime-js: reiniciar su reloj o soltar su pendiente ya no es seguro.
    if (!listo && (!salio || typeof rt.pendingHeartbeatRef !== 'string')) {
      marcarDesconocido(rt, 'el latido no quedó pendiente al mandarlo')
      terminar(null)
      return
    }
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
  let canal: RealtimeChannel | null = null
  let espera = REINTENTO_MS
  let proximoReintento = -Infinity
  let esperaReunion = 0
  let proximaReunion = -Infinity
  // Se mira al arrancar: con un latido que no es el conocido, el duelo no recibe `sondear` y
  // decide el abandono como antes del sondeo (el canal unido alcanza).
  const conSondeo = latidoConocido(cliente.realtime)

  const reiniciarEsperas = () => {
    espera = REINTENTO_MS
    proximoReintento = -Infinity
    esperaReunion = 0
    proximaReunion = -Infinity
  }

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
        reiniciarEsperas()
      } else if (estado === 'CLOSED' && reintentos < REUNIR_MAX) {
        reintentos++
        setTimeout(() => {
          if (!cerrado && canal === c) unir()
        }, REUNIR_MS * reintentos)
      }
    })
  }
  unir()

  /** El canal viejo que se soltó para volver a unirse (hasta que sale de la lista del cliente). */
  let saliendo: RealtimeChannel | null = null

  /**
   * El canal nuevo, recién cuando el viejo salió de la lista del cliente: si no, `channel()`
   * devolvería el mismo. En realtime-js 2.98 sale en el acto; si otra versión tarda, lo hace el
   * próximo `reintentar`.
   */
  const unirSiSalio = () => {
    if (saliendo && cliente.getChannels().includes(saliendo)) return
    saliendo = null
    unir()
  }

  /**
   * El socket ya está abierto y el canal sigue caído (realtime-js lo vuelve a unir con su propia
   * espera, hasta 10 s): uno nuevo ya. El viejo se suelta antes y su CLOSED (lo dispara este
   * `unsubscribe`) no se toma como un cierre del servidor.
   */
  const volverAUnir = () => {
    const viejo = canal
    canal = null
    unido = false
    if (viejo) {
      saliendo = viejo
      void viejo.unsubscribe().catch(() => {})
    }
    unirSiSalio()
  }

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

  /** Con el canal caído: el socket cerrado se abre ya; abierto, el canal se vuelve a unir ya. */
  const reintentar = () => {
    if (cerrado || unido) return
    const t = Date.now()
    try {
      if (canal === null) {
        unirSiSalio()
        return
      }
      const rt = cliente.realtime
      if (rt.isConnected()) {
        if (!canal || String(canal.state) !== 'errored' || t < proximaReunion) return
        proximaReunion = t + esperaReunion
        esperaReunion = esperaReunion === 0 ? REUNION_MS : Math.min(REUNION_MAX_MS, esperaReunion * 2)
        volverAUnir()
        return
      }
      if (t < proximoReintento) return
      proximoReintento = t + espera
      espera = Math.min(REINTENTO_MAX_MS, Math.round(espera * 1.5))
      // Sólo con el socket CERRADO: uno que todavía se está cerrando (un latido vencido con la red
      // trabada) dispararía su cierre tarde, encima del socket nuevo.
      if (String(rt.connectionState()) !== 'closed') return
      rt.connect()
      setTimeout(reintentar, MIRAR_SOCKET_MS)
    } catch {
      // Si algo de esto no está (otra versión de realtime-js), queda su propio reintento.
    }
  }

  // El navegador avisa que volvió la red (el celular recuperó el wifi o los datos): sin esperar.
  const alVolverLaRed = () => {
    reiniciarEsperas()
    reintentar()
  }
  const hayVentana = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (hayVentana) window.addEventListener('online', alVolverLaRed)

  return {
    unido: () => unido,
    // Lo lee el duelo: sin canal unido no se reclama un abandono (el que se fue es éste).
    conectado: () => unido && !cerrado && socketAbierto(),
    sondear: conSondeo
      ? () => {
          if (!unido || cerrado) return Promise.resolve(false)
          try {
            return sondearSocket(cliente.realtime)
          } catch {
            return Promise.resolve(false)
          }
        }
      : undefined,
    reintentar,
    enviar(m: MensajePelea) {
      if (!unido || cerrado || !canal || !socketAbierto()) return false
      void canal.send({ type: 'broadcast', event: 'p', payload: m }).catch(() => {})
      return true
    },
    cerrar() {
      if (cerrado) return
      cerrado = true
      unido = false
      if (hayVentana) window.removeEventListener('online', alVolverLaRed)
      if (canal) void cliente.removeChannel(canal).catch(() => {})
    },
  }
}
