/**
 * Lockstep con retraso de entrada para las peleas online.
 *
 * Los dos celulares simulan la MISMA partida (el motor es determinista): cada tick n se simula
 * sólo con la entrada propia y la del rival PARA n. La propia se toma al simular n y se agenda
 * para n + D (la «demora»): así hay D ticks para que viaje. Si al llegar a n todavía falta la del
 * rival, no se avanza (el loop espera) y se reintenta en el cuadro siguiente.
 *
 *  - Las entradas viajan en lotes cada TICKS_POR_LOTE ticks, como bits (10 botones → un número),
 *    con los últimos REDUNDANCIA ticks en cada lote: si se pierde un mensaje, el siguiente lo cubre.
 *    Si igual queda un hueco (se perdieron varios seguidos), se pide reenvío desde el hueco; y si
 *    la espera se estira sin hueco a la vista (se perdió la COLA y el otro ya no manda: terminó la
 *    pelea), se pide igual desde lo último que se tiene. Un lockstep cerrado sigue contestando
 *    pedidos: lo que mandó ya está escrito y el otro puede necesitarlo para llegar al final.
 *  - Esperando, se reenvía lo último cada REENVIO_MS (por si lo que se perdió fue lo nuestro).
 *  - Cada CADA_HASH ticks, el hash del estado viaja en los lotes: si el del rival difiere del
 *    propio para el mismo tick, la pelea se desincronizó (no debería pasar nunca).
 *  - Ritmo, en dos partes:
 *      · relativa: cada lote lleva el «colchón» del que lo manda (cuántos ticks del otro ya
 *        tiene). Si el mío es más chico que el suyo, voy adelantado: freno apenas hasta emparejar.
 *      · absoluta: si la red no llega a traer cada entrada a tiempo (la latencia supera la
 *        demora), cada espera baja un poco la velocidad base, hasta la que la red sostiene sin
 *        trabarse; con colchón de sobra, vuelve sola a 1. Es mucho mejor un juego parejo al 90 %
 *        que uno a 60 que se congela dos cuadros de cada ocho.
 *
 * Sin React, sin red y sin `@/`: lo maneja la pantalla de pelea y se prueba con Node.
 */
import { ENTRADA_VACIA } from '../tipos'
import type { EntradaJugador, Lado } from '../tipos'
import { codificarEntrada, entradaDesdeBits, MAX_TICKS_LOTE } from './protocolo'

/**
 * Ticks por lote: 4 (15 lotes por segundo por jugador). Con 2 eran 30 por segundo y una pelea
 * gastaba ≈110 mensajes de Realtime por segundo (cada broadcast cuenta al salir y al llegar),
 * de un tope de 500/s para TODO el proyecto (plan Pro), el mismo que usan el panel de los
 * barberos, la TV y el kiosko: con 4 o 5 peleas a la vez Realtime corta las conexiones de todos
 * (`tenant_events`, Known Risk #9). Con 4 son ≈60/s. Medido en la simulación con el motor real
 * (30/oct/2026): el mismo ritmo y las mismas esperas que con 2 en las tres redes probadas
 * (110, 190 y 280 ms de ida de un celular al otro); cuesta 2 ticks más de demora (33 ms).
 */
export const TICKS_POR_LOTE = 4
export const REDUNDANCIA = 12
export const CADA_HASH = 60
/** Esperando la entrada del rival más que esto: «Conexión lenta…». */
export const LENTA_MS = 400
/** Sin entradas del rival durante esto, el que queda gana por abandono. */
export const ABANDONO_MS = 10_000
/**
 * Demora (ticks) mínima y máxima. El tope es 20: medido el 30/oct/2026, entre dos jugadores el
 * RTT por Realtime es ≈370–380 ms (el servidor queda a ≈92 ms por tramo) y la fórmula da 17.
 * Un tope más bajo no acorta el retraso que se siente, sólo hace más lento el juego (con 12 iba
 * al 78–84 % con ~7 esperas por segundo: 12 ticks a 46 ticks/s son 258 ms, casi lo mismo que
 * 16 a 60). Era 18 con lotes de 2 ticks; con lotes de 4 son 2 ticks más para cubrir lo mismo.
 */
export const DEMORA_MIN = 5
export const DEMORA_MAX = 20

const REENVIO_MS = 150
const PEDIDO_MS = 300
/**
 * Esperando sin un hueco a la vista: a esta altura, si el otro siguiera vivo y esperando, sus
 * reenvíos (cada REENVIO_MS) ya habrían llegado. Se le pide desde lo último que se tiene.
 */
const PEDIDO_CIEGO_MS = 700
/** Velocidad base mínima (con una red muy lenta, mejor lento y parejo que a los saltos). */
const BASE_MIN = 0.72
/** Cuánto baja la base cada espera y cuánto sube por segundo con colchón de sobra. */
const BAJA_POR_ESPERA = 0.012
const SUBE_POR_SEGUNDO = 0.02
const TICKS_INICIALES = 1 << 14
const VACIAS: readonly [EntradaJugador, EntradaJugador] = [ENTRADA_VACIA, ENTRADA_VACIA]

const MS_POR_TICK = 1000 / 60

/**
 * D = clamp(ceil((rtt/2 + lote + 20) / 16,67), DEMORA_MIN, DEMORA_MAX): media ida, lo que
 * espera una entrada a que salga su lote (TICKS_POR_LOTE ticks = 67 ms) y 20 ms de margen.
 */
export function demoraParaRtt(rttMs: number): number {
  const rtt = Number.isFinite(rttMs) && rttMs > 0 ? rttMs : 600
  const ticks = Math.ceil((rtt / 2 + TICKS_POR_LOTE * MS_POR_TICK + 20) / MS_POR_TICK)
  return Math.max(DEMORA_MIN, Math.min(DEMORA_MAX, ticks))
}

export interface LoteEntradas {
  /** Último tick que trae. */
  n: number
  /** Bits de los ticks n-b.length+1 … n. */
  b: number[]
  /** Colchón del que lo manda. */
  c: number
  /** Pares [tick, hash]. */
  h: number[] | null
}

export interface OpcionesLockstep {
  lado: Lado
  demora: number
  /** La entrada propia de este tick (la captura de controles). */
  tomarPropia: () => EntradaJugador
  /** Manda un lote. false = no se pudo (límite de mensajes): va en el siguiente. */
  enviarLote: (lote: LoteEntradas) => boolean
  /** Pide al rival que reenvíe desde ese tick (hubo un hueco). */
  pedir: (desde: number) => void
  ahora: () => number
}

export interface EstadisticasLockstep {
  lotesEnviados: number
  lotesRecibidos: number
  esperas: number
  msEsperando: number
  pedidos: number
}

export class Lockstep {
  readonly lado: Lado
  readonly demora: number
  /** Primer tick cuyos hashes no coincidieron (null = nunca). */
  desincronizadoEn: number | null = null
  /** Cuántos hashes se compararon (para las pruebas). */
  comparados = 0
  readonly stats: EstadisticasLockstep = { lotesEnviados: 0, lotesRecibidos: 0, esperas: 0, msEsperando: 0, pedidos: 0 }

  private readonly o: OpcionesLockstep
  private tomarPropia: () => EntradaJugador
  private propias: Int16Array
  private rivales: Int16Array
  /** Último tick del rival conocido SIN huecos (los primeros D son vacíos por definición). */
  private rivalHasta: number
  private rivalMax: number
  private muestreado: number
  private enviado: number
  private ultimoEnvio = -Infinity
  private ultimoPedido = -Infinity
  private esperandoDesde: number | null = null
  private colchonPropio: number
  private colchonRival: number
  private colchonSuave: number
  private ritmoSuave = 1
  private base = 1
  private esperasSinAplicar = 0
  private ultimoRitmo: number | null = null
  private readonly hashesPropios = new Map<number, number>()
  private readonly hashesRival = new Map<number, number>()
  private hashComparadoHasta = 0
  private hashesAEnviar: number[] = []
  private cerrado = false

  constructor(o: OpcionesLockstep) {
    this.o = o
    this.tomarPropia = o.tomarPropia
    this.lado = o.lado
    this.demora = Math.max(1, Math.floor(o.demora))
    this.propias = new Int16Array(TICKS_INICIALES).fill(-1)
    this.rivales = new Int16Array(TICKS_INICIALES).fill(-1)
    this.rivalHasta = this.demora
    this.rivalMax = this.demora
    this.muestreado = this.demora
    this.enviado = this.demora
    this.colchonPropio = this.demora
    this.colchonRival = this.demora
    this.colchonSuave = this.demora
  }

  private crecer(a: Int16Array, t: number): Int16Array {
    if (t < a.length) return a
    let n = a.length
    while (n <= t) n *= 2
    const b = new Int16Array(n).fill(-1)
    b.set(a)
    return b
  }

  /**
   * La captura de controles de la pantalla que está montada. Con StrictMode (desarrollo) la
   * pantalla de pelea se monta dos veces y la segunda reusa este lockstep: sin esto seguiría
   * leyendo la captura del primer montaje, ya desconectada, y las entradas propias irían vacías.
   */
  usarEntrada(tomarPropia: () => EntradaJugador): void {
    this.tomarPropia = tomarPropia
  }

  /** Antes de simular el tick n: agenda la entrada propia para n + D (una sola vez por tick). */
  preparar(n: number): void {
    if (this.cerrado) return
    const objetivo = n + this.demora
    if (this.muestreado >= objetivo) return
    while (this.muestreado < objetivo) {
      const t = ++this.muestreado
      this.propias = this.crecer(this.propias, t)
      this.propias[t] = codificarEntrada(this.tomarPropia())
    }
    // Cada TICKS_POR_LOTE ticks nuevos (si el límite de mensajes frenó uno, el próximo tick lo reintenta).
    if (this.muestreado - this.enviado >= TICKS_POR_LOTE) this.enviar()
  }

  /** Las entradas de los dos lados para el tick n, o null si todavía falta la del rival. */
  entradas(n: number): readonly [EntradaJugador, EntradaJugador] | null {
    this.colchonPropio = this.rivalHasta - (n - 1)
    this.colchonSuave += (this.colchonPropio - this.colchonSuave) * 0.05
    if (n > this.demora && n > this.rivalHasta) {
      if (!this.cerrado) this.faltante()
      return null
    }
    if (this.esperandoDesde !== null) {
      this.stats.msEsperando += this.o.ahora() - this.esperandoDesde
      this.esperandoDesde = null
    }
    if (n <= this.demora) return VACIAS
    const mia = entradaDesdeBits(Math.max(0, this.propias[n]))
    const suya = entradaDesdeBits(Math.max(0, this.rivales[n]))
    return this.lado === 0 ? [mia, suya] : [suya, mia]
  }

  private faltante(): void {
    const ahora = this.o.ahora()
    if (this.esperandoDesde === null) {
      this.esperandoDesde = ahora
      this.stats.esperas++
      this.esperasSinAplicar++
      // Lo que tenga sin mandar (el lote a medio llenar) sale ya: el otro puede necesitarlo.
      if (this.muestreado > this.enviado) this.enviar()
    } else if (ahora - this.ultimoEnvio >= REENVIO_MS) {
      this.enviar()
    }
    // Con un hueco a la vista se pide enseguida; sin hueco (se perdió la cola), después de un rato.
    const hayHueco = this.rivalMax > this.rivalHasta
    const ciego = ahora - this.esperandoDesde >= PEDIDO_CIEGO_MS
    if ((hayHueco || ciego) && ahora - this.ultimoPedido >= PEDIDO_MS) {
      this.ultimoPedido = ahora
      this.stats.pedidos++
      this.o.pedir(this.rivalHasta + 1)
    }
  }

  private enviar(): void {
    const hasta = this.muestreado
    if (hasta <= this.demora) return
    const desde = Math.max(this.demora + 1, hasta - REDUNDANCIA + 1)
    const b: number[] = []
    for (let t = desde; t <= hasta; t++) b.push(Math.max(0, this.propias[t]))
    const lote: LoteEntradas = {
      n: hasta,
      b,
      c: this.colchonPropio,
      h: this.hashesAEnviar.length > 0 ? this.hashesAEnviar.slice() : null,
    }
    if (!this.o.enviarLote(lote)) return
    this.enviado = hasta
    this.ultimoEnvio = this.o.ahora()
    this.stats.lotesEnviados++
  }

  /** Un lote del rival (ya validado por el protocolo). */
  recibirLote(l: LoteEntradas): void {
    if (this.cerrado) return
    // El rival no puede ir más adelante que lo que le mandé + su demora: lo demás es basura.
    if (l.n > this.muestreado + this.demora + 240) return
    this.stats.lotesRecibidos++
    if (l.n > this.rivalMax) {
      this.rivalMax = l.n
      this.rivales = this.crecer(this.rivales, l.n)
    }
    const primero = l.n - l.b.length + 1
    for (let i = 0; i < l.b.length; i++) {
      const t = primero + i
      if (t <= this.demora || this.rivales[t] >= 0) continue
      this.rivales[t] = l.b[i]
    }
    while (this.rivalHasta + 1 < this.rivales.length && this.rivales[this.rivalHasta + 1] >= 0) this.rivalHasta++
    this.colchonRival = l.c
    if (l.h) for (let i = 0; i + 1 < l.h.length; i += 2) this.hashDelRival(l.h[i], l.h[i + 1])
  }

  /**
   * El rival pidió reenvío desde un tick (se le perdieron varios lotes seguidos). Contesta
   * también CERRADO: si la cola se perdió justo al final, el otro la necesita para terminar la
   * misma pelea (si no, esperaría 10 s y se adjudicaría un abandono que no existió).
   */
  responderPedido(desde: number): void {
    const ini = Math.max(this.demora + 1, desde)
    const fin = Math.min(this.muestreado, ini + MAX_TICKS_LOTE - 1)
    if (fin < ini) return
    const b: number[] = []
    for (let t = ini; t <= fin; t++) b.push(Math.max(0, this.propias[t]))
    this.o.enviarLote({ n: fin, b, c: this.colchonPropio, h: null })
  }

  /** El hash propio del tick (después de simularlo): viaja en los lotes que siguen. */
  registrarHash(tick: number, h: number): void {
    if (tick <= this.hashComparadoHasta) return
    this.hashesAEnviar = [tick, h >>> 0, ...this.hashesAEnviar].slice(0, 4)
    this.hashesPropios.set(tick, h >>> 0)
    this.comparar(tick)
  }

  private hashDelRival(t: number, h: number): void {
    if (t <= this.hashComparadoHasta || this.hashesRival.has(t)) return
    this.hashesRival.set(t, h >>> 0)
    this.comparar(t)
  }

  private comparar(t: number): void {
    const a = this.hashesPropios.get(t)
    const b = this.hashesRival.get(t)
    if (a === undefined || b === undefined) return
    this.comparados++
    if (a !== b && this.desincronizadoEn === null) this.desincronizadoEn = t
    this.hashComparadoHasta = Math.max(this.hashComparadoHasta, t)
    for (const k of this.hashesPropios.keys()) if (k <= this.hashComparadoHasta) this.hashesPropios.delete(k)
    for (const k of this.hashesRival.keys()) if (k <= this.hashComparadoHasta) this.hashesRival.delete(k)
  }

  /**
   * Multiplicador del ritmo para este cuadro (≈1). Si voy adelantado respecto del rival (mi
   * colchón es más chico que el suyo), freno apenas; si voy atrasado, apuro apenas.
   */
  ritmo(): number {
    const t = this.o.ahora()
    const dt = this.ultimoRitmo === null ? 0 : Math.max(0, Math.min(100, t - this.ultimoRitmo))
    this.ultimoRitmo = t
    if (this.esperasSinAplicar > 0) {
      this.base = Math.max(BASE_MIN, this.base - BAJA_POR_ESPERA * this.esperasSinAplicar)
      this.esperasSinAplicar = 0
    } else if (this.colchonSuave > 2) {
      this.base = Math.min(1, this.base + (SUBE_POR_SEGUNDO * dt) / 1000)
    }
    const adelanto = (this.colchonRival - this.colchonPropio) / 2
    const relativa = Math.min(0.06, Math.max(-0.1, -0.025 * adelanto))
    const objetivo = Math.min(1.06, Math.max(BASE_MIN - 0.1, this.base + relativa))
    this.ritmoSuave += (objetivo - this.ritmoSuave) * 0.08
    return this.ritmoSuave
  }

  /** Velocidad base que sostiene la red (1 = la red alcanza para 60 ticks por segundo). */
  velocidadBase(): number {
    return this.base
  }

  /** Cuánto lleva esperando la entrada del rival (0 = no espera). */
  msEsperando(): number {
    return this.esperandoDesde === null ? 0 : Math.max(0, this.o.ahora() - this.esperandoDesde)
  }

  colchones(): { propio: number; rival: number } {
    return { propio: this.colchonPropio, rival: this.colchonRival }
  }

  /** Último tick del rival que tengo (sin huecos). */
  rivalConfirmadoHasta(): number {
    return this.rivalHasta
  }

  /** Terminó la pelea (o se cortó): manda lo que quede y deja de hacer nada. */
  cerrar(): void {
    if (this.cerrado) return
    if (this.muestreado > this.enviado) this.enviar()
    this.cerrado = true
  }
}
