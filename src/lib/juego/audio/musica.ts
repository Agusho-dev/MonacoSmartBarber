/**
 * La música del juego.
 *
 *  - Menú y pelea: «Neon Dash» (pista.ts), la canción de Monaco en versión pixel. Suena con UN
 *    AudioBufferSourceNode en bucle que entra por el bus de música de la mesa: el volumen, el
 *    silencio, el agache de los especiales, el «bajo el agua» del KO y los fundidos andan igual en
 *    iOS (que ignora el .volume de un <audio>). Nunca hay dos copias: cada fuente nueva despide a la
 *    anterior con un fundido corto.
 *      · Una pelea nueva (pelea pedida viniendo de otra cosa) arranca la canción desde el principio;
 *        la pausa, el tutorial o el «¡te toca!» la callan y al volver sigue donde estaba.
 *      · Se baja en segundo plano: si todavía no está, el pedido queda y arranca apenas está lista.
 *      · Si no se pudo bajar o decodificar, menú y pelea vuelven a los temas sintetizados (temas.ts).
 *  - Victoria y derrota: los jingles sintetizados de siempre. La canción baja mientras suenan y
 *    vuelve sola cuando terminan (agendado en el reloj de audio, sin timers).
 *
 * El secuenciador de los temas sintetizados es con anticipación: un reloj de JS cada 25 ms agenda
 * las notas de los próximos 0,22 s contra `currentTime`. Si el timer llega tarde, las notas igual
 * caen en su lugar; si quedó muy atrás (pestaña dormida), salta al presente sin amontonar notas.
 */
import type { TemaMusica } from '../tipos'
import type { Mesa } from './mesa'
import { suavizar } from './mesa'
import { BUCLE_FIN, BUCLE_INICIO, estadoPista, obtenerPista, pistaReintentable } from './pista'
import type { DefTema } from './temas'
import { TEMAS } from './temas'

const ANTICIPO = 0.22
const INTERVALO_MS = 25

type TemaPista = 'menu' | 'pelea'

/**
 * Ganancia de la canción en cada pantalla, con los volúmenes por defecto (bus de música 0,35). La
 * canción tiene sus picos de 50 ms en −13,4 dBFS y la mediana en −18,4: en la pelea los picos
 * salen ≈ −20,3 dB (2 dB por debajo del tema sintetizado de antes, a la par de un puño leve y
 * 8 dB por debajo de un golpe fuerte) y el cuerpo ≈ −25 dB; en el menú, 1,3 dB menos.
 */
const NIVEL_PISTA: Readonly<Record<TemaPista, number>> = { pelea: 1.45, menu: 1.25 }
/** Constantes de tiempo (s) de los fundidos de la canción. */
const ENTRADA_PISTA = 0.25
const SALIDA_PISTA = 0.22
/** Después de un jingle, la canción vuelve con esta constante de tiempo (s): sube despacio. */
const VUELTA_PISTA = 0.6
/**
 * Si la canción todavía no llegó (conexión lenta o trabada), a los 6 s del pedido suena el tema
 * sintetizado; cuando la canción llega, lo reemplaza con un fundido.
 */
const ESPERA_RESERVA_MS = 6000

interface Reproduccion {
  readonly id: TemaMusica
  readonly def: DefTema
  readonly d16: number
  readonly salida: GainNode
  readonly envioEco: GainNode
  readonly nodos: AudioNode[]
  /** Pasos absolutos desde que arrancó. */
  paso: number
  tProximo: number
  agendando: boolean
  /** Cuándo se desarma (después del fundido o de la cola del jingle). */
  desarmarEn: number
}

interface Fuente {
  readonly src: AudioBufferSourceNode
  readonly ganancia: GainNode
  /** currentTime en el que arrancó y desde qué segundo del archivo. */
  readonly inicio: number
  readonly desde: number
}

function esTemaPista(t: TemaMusica | null): t is TemaPista {
  return t === 'menu' || t === 'pelea'
}

/** Lleva un parámetro a `valor` desde donde esté, sin saltos (cancelAndHold cuando existe). */
function llevar(param: AudioParam, valor: number, desde: number, tc: number): void {
  try {
    const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }
    if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(desde)
    else {
      param.cancelScheduledValues(desde)
      param.setValueAtTime(param.value, desde)
    }
    param.setTargetAtTime(valor, desde, Math.max(tc, 0.001))
  } catch {
    param.value = valor
  }
}

export class Musica {
  /** El tema pedido (sigue siendo ése aunque el jingle ya haya terminado). */
  tema: TemaMusica | null = null
  private readonly m: Mesa
  private actual: Reproduccion | null = null
  private readonly saliendo: Reproduccion[] = []
  private reloj: ReturnType<typeof setInterval> | null = null
  private nivel = 0
  private bajoElAgua = false

  // ─── La canción ────────────────────────────────────────────────────────────
  private buffer: AudioBuffer | null = null
  private fuente: Fuente | null = null
  /** Dónde retomar la canción (segundo del archivo) cuando vuelva a sonar. */
  private posicion = 0
  /** El último tema no nulo: decide si una pelea arranca la canción de cero o la retoma. */
  private ultimoTema: TemaMusica | null = null
  /** Después de un jingle la canción vuelve sola: desde cuándo (currentTime) y a qué tema. */
  private vuelta: { en: number; tema: TemaPista } | null = null
  private destruida = false
  /** Fuentes de la canción que todavía no terminaron (la que suena más las que se están despidiendo). */
  private fuentesVivas = 0
  private reserva: ReturnType<typeof setTimeout> | null = null

  constructor(m: Mesa) {
    this.m = m
    this.cargarPista()
  }

  /** Cambia de tema con fundido. El mismo tema otra vez no hace nada (no reinicia el jingle). */
  tocar(tema: TemaMusica | null): void {
    if (tema === this.tema || this.destruida) return
    this.tema = tema
    const ahora = this.m.ctx.currentTime
    const jingle = tema === 'victoria' || tema === 'derrota'
    if (this.actual) {
      this.soltar(this.actual, ahora, jingle ? 0.25 : 0.9)
      this.actual = null
    }
    if (tema !== 'pelea') this.nivel = 0
    this.superficie(0.15)
    this.vuelta = null

    if (esTemaPista(tema)) {
      // Una pelea que empieza (no la misma pelea que vuelve de una pausa) arranca de cero.
      const deCero = tema === 'pelea' && this.ultimoTema !== 'pelea'
      this.ultimoTema = tema
      if (this.buffer) this.sonarPista(tema, deCero, ahora)
      else {
        if (deCero) this.posicion = 0
        if (estadoPista() === 'fallo') {
          // Sin la canción: el tema sintetizado de siempre (y, si fue la red, otro intento).
          this.actual = this.armar(tema, ahora + 0.1)
          if (pistaReintentable()) this.cargarPista()
        } else this.programarReserva()
        // Si todavía se está bajando, arranca sola en cargarPista().
      }
    } else if (jingle) {
      this.ultimoTema = tema
      const def = TEMAS[tema]
      const t0 = ahora + 0.03
      this.actual = this.armar(tema, t0)
      // La canción se aparta y vuelve cuando el jingle se apaga (con la cola sonando todavía).
      this.vuelta = { en: t0 + def.pasos * (60 / def.bpm / 4) + 0.25, tema: 'menu' }
      this.bajarPistaPorJingle(ahora)
    } else {
      this.callarPista(ahora)
    }
    this.asegurarReloj()
  }

  /** 0 normal, 1 round final, 2 TURBO. Rige desde el próximo paso que se agende (temas sintetizados). */
  intensidad(n: number): void {
    this.nivel = n
  }

  /** KO, tiempo, final: la música queda «bajo el agua» (filtro cerrado y más baja). */
  bajoAgua(): void {
    this.bajoElAgua = true
    const a = this.m.ctx.currentTime
    suavizar(this.m.filtroMusica.frequency, 520, a, 0.12)
    suavizar(this.m.agacheMusica.gain, 0.55, a, 0.12)
  }

  /** Vuelve a la superficie (round nuevo, tema nuevo). */
  superficie(tc = 0.35): void {
    this.bajoElAgua = false
    const a = this.m.ctx.currentTime
    suavizar(this.m.filtroMusica.frequency, 20000, a, tc)
    suavizar(this.m.agacheMusica.gain, 1, a, tc)
  }

  /** Agache corto bajo un especial o una guardia rota (no pisa el «bajo el agua»). */
  agachar(nivel: number, dur: number): void {
    if (this.bajoElAgua) return
    const a = this.m.ctx.currentTime
    const g = this.m.agacheMusica.gain
    suavizar(g, nivel, a, 0.03)
    g.setTargetAtTime(1, a + dur, 0.25)
  }

  /** Para el arnés, las pruebas y el gancho de depuración. */
  estado(): {
    tema: TemaMusica | null
    paso: number
    adelanto: number
    intensidad: number
    pista: string
    sonandoPista: boolean
    posicionPista: number
    fuentesVivas: number
  } {
    const r = this.actual
    return {
      tema: this.tema,
      paso: r ? r.paso : 0,
      adelanto: r && r.agendando ? r.tProximo - this.m.ctx.currentTime : 0,
      intensidad: this.nivel,
      pista: estadoPista(),
      sonandoPista: this.fuente !== null,
      posicionPista: Math.round(this.posicionEn(this.m.ctx.currentTime) * 100) / 100,
      fuentesVivas: this.fuentesVivas,
    }
  }

  destruir(): void {
    this.destruida = true
    if (this.reserva !== null) clearTimeout(this.reserva)
    this.reserva = null
    this.pararReloj()
    if (this.actual) this.desarmar(this.actual)
    for (const r of this.saliendo) this.desarmar(r)
    this.saliendo.length = 0
    this.actual = null
    this.tema = null
    if (this.fuente) this.despedir(this.fuente, this.m.ctx.currentTime, 0.02)
    this.fuente = null
  }

  // ─── La canción ────────────────────────────────────────────────────────────

  /** Red lenta: si la canción no llega a tiempo, mientras tanto suena el tema sintetizado. */
  private programarReserva(): void {
    if (this.reserva !== null) return
    this.reserva = setTimeout(() => {
      this.reserva = null
      if (this.destruida || this.buffer || this.actual || this.fuente || !esTemaPista(this.tema)) return
      this.actual = this.armar(this.tema, this.m.ctx.currentTime + 0.1)
      this.asegurarReloj()
    }, ESPERA_RESERVA_MS)
  }

  private cargarPista(): void {
    obtenerPista(this.m.ctx).then(
      (buffer) => {
        if (this.destruida) return
        const ahora = this.m.ctx.currentTime
        if (!buffer) {
          // No se pudo (red, formato): si ya se pidió menú o pelea, suena el tema sintetizado.
          if (esTemaPista(this.tema) && !this.actual && !this.fuente) {
            this.actual = this.armar(this.tema, ahora + 0.1)
            this.asegurarReloj()
          }
          return
        }
        this.buffer = buffer
        if (esTemaPista(this.tema)) {
          // Llegó mientras sonaba el tema sintetizado de reserva: lo reemplaza.
          if (this.actual) {
            this.soltar(this.actual, ahora, 0.9)
            this.actual = null
          }
          this.sonarPista(this.tema, false, ahora)
        } else if (this.vuelta) {
          this.bajarPistaPorJingle(ahora)
        }
      },
      () => undefined,
    )
  }

  /** Segundo del archivo que suena en `t` (o donde quedó, si está callada). */
  private posicionEn(t: number): number {
    const f = this.fuente
    if (!f) return this.posicion
    const p = f.desde + Math.max(0, t - f.inicio)
    if (p < BUCLE_FIN) return p
    return BUCLE_INICIO + ((p - BUCLE_INICIO) % (BUCLE_FIN - BUCLE_INICIO))
  }

  /** Arranca una fuente nueva en `desde` con la ganancia en `g0` (después se la lleva a donde haga falta). */
  private arrancar(desde: number, g0: number, t0: number): Fuente | null {
    const buffer = this.buffer
    if (!buffer) return null
    const ctx = this.m.ctx
    try {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      src.loopStart = BUCLE_INICIO
      src.loopEnd = BUCLE_FIN
      const ganancia = ctx.createGain()
      ganancia.gain.value = g0
      src.connect(ganancia)
      ganancia.connect(this.m.entradaMusica)
      const offset = desde >= 0 && desde < BUCLE_FIN ? desde : 0
      src.start(t0, offset)
      const f: Fuente = { src, ganancia, inicio: t0, desde: offset }
      this.fuentesVivas++
      src.onended = () => {
        this.fuentesVivas = Math.max(0, this.fuentesVivas - 1)
        try {
          src.disconnect()
          ganancia.disconnect()
        } catch {
          // ya estaba desconectada
        }
      }
      return f
    } catch {
      return null
    }
  }

  /** Despide una fuente con un fundido y la para cuando ya no se oye. */
  private despedir(f: Fuente, ahora: number, tc: number): void {
    llevar(f.ganancia.gain, 0, ahora, tc)
    try {
      f.src.stop(ahora + tc * 6 + 0.02)
    } catch {
      // ya estaba parada
    }
  }

  private sonarPista(tema: TemaPista, deCero: boolean, ahora: number): void {
    const nivel = NIVEL_PISTA[tema]
    if (deCero) {
      if (this.fuente) {
        this.despedir(this.fuente, ahora, 0.08)
        this.fuente = null
      }
      this.posicion = 0
    }
    if (this.fuente) {
      llevar(this.fuente.ganancia.gain, nivel, ahora, ENTRADA_PISTA)
      return
    }
    const t0 = ahora + 0.02
    const f = this.arrancar(this.posicion, 0, t0)
    if (!f) return
    this.fuente = f
    // Desde el principio entra enseguida (el tema arranca en el primer tiempo); retomada, con fundido.
    llevar(f.ganancia.gain, nivel, t0, this.posicion < 0.5 ? 0.02 : ENTRADA_PISTA)
  }

  /** null: la canción se apaga y queda marcado dónde iba para retomarla. */
  private callarPista(ahora: number): void {
    const f = this.fuente
    if (!f) return
    this.posicion = this.posicionEn(ahora + SALIDA_PISTA * 6)
    this.despedir(f, ahora, SALIDA_PISTA)
    this.fuente = null
  }

  /** Victoria o derrota: la canción se aparta enseguida y vuelve sola cuando termina el jingle. */
  private bajarPistaPorJingle(ahora: number): void {
    const vuelta = this.vuelta
    if (!vuelta || !this.buffer) return
    const nivel = NIVEL_PISTA[vuelta.tema]
    if (!this.fuente) {
      // Estaba callada (el fin de la pelea la apagó): arranca muda y sube a su hora.
      const f = this.arrancar(this.posicion, 0, ahora + 0.02)
      if (!f) return
      this.fuente = f
    } else {
      llevar(this.fuente.ganancia.gain, 0, ahora, 0.08)
    }
    this.fuente.ganancia.gain.setTargetAtTime(nivel, Math.max(vuelta.en, ahora + 0.1), VUELTA_PISTA)
  }

  // ─── Temas sintetizados (jingles y reserva) ───────────────────────────────

  private armar(id: TemaMusica, t0: number): Reproduccion {
    const ctx = this.m.ctx
    const def = TEMAS[id]
    const d16 = 60 / def.bpm / 4
    const salida = ctx.createGain()
    if (def.entrada > 0.02) {
      salida.gain.value = 0
      salida.gain.setTargetAtTime(def.nivel, t0, def.entrada / 3)
    } else {
      salida.gain.value = def.nivel
    }
    salida.connect(this.m.entradaMusica)
    // Eco propio del tema (corchea con puntillo): se apaga con el fundido del tema.
    const envioEco = ctx.createGain()
    const eco = ctx.createDelay(2)
    eco.delayTime.value = d16 * def.eco.pasos
    const filtroEco = ctx.createBiquadFilter()
    filtroEco.type = 'lowpass'
    filtroEco.frequency.value = def.eco.corte
    filtroEco.Q.value = 0.5
    const retro = ctx.createGain()
    retro.gain.value = def.eco.retro
    const nivelEco = ctx.createGain()
    nivelEco.gain.value = def.eco.nivel
    envioEco.connect(eco)
    eco.connect(filtroEco)
    filtroEco.connect(retro)
    retro.connect(eco)
    filtroEco.connect(nivelEco)
    nivelEco.connect(salida)
    return {
      id,
      def,
      d16,
      salida,
      envioEco,
      nodos: [salida, envioEco, eco, filtroEco, retro, nivelEco],
      paso: 0,
      tProximo: t0,
      agendando: true,
      desarmarEn: Number.POSITIVE_INFINITY,
    }
  }

  private soltar(r: Reproduccion, ahora: number, fundido: number): void {
    r.agendando = false
    suavizar(r.salida.gain, 0, ahora, fundido / 4)
    r.desarmarEn = Math.min(r.desarmarEn, ahora + fundido + 0.4)
    this.saliendo.push(r)
  }

  private desarmar(r: Reproduccion): void {
    for (const n of r.nodos) {
      try {
        n.disconnect()
      } catch {
        // ya estaba desconectado
      }
    }
  }

  private asegurarReloj(): void {
    if (this.reloj !== null) return
    if (this.actual === null && this.saliendo.length === 0) return
    this.reloj = setInterval(this.tic, INTERVALO_MS)
    this.tic()
  }

  private pararReloj(): void {
    if (this.reloj === null) return
    clearInterval(this.reloj)
    this.reloj = null
  }

  private readonly tic = (): void => {
    const ahora = this.m.ctx.currentTime
    const r = this.actual
    if (r) {
      if (r.agendando) this.agendar(r, ahora)
      else if (ahora > r.desarmarEn) {
        // El jingle terminó: se desarma, pero `tema` queda (pedirlo de nuevo no lo repite).
        this.desarmar(r)
        this.actual = null
      }
    }
    for (let i = this.saliendo.length - 1; i >= 0; i--) {
      const s = this.saliendo[i]
      if (ahora > s.desarmarEn) {
        this.desarmar(s)
        this.saliendo.splice(i, 1)
      }
    }
    if (this.actual === null && this.saliendo.length === 0) this.pararReloj()
  }

  private agendar(r: Reproduccion, ahora: number): void {
    if (r.tProximo < ahora - 0.05) {
      const saltear = Math.ceil((ahora - r.tProximo) / r.d16)
      r.paso += saltear
      r.tProximo += saltear * r.d16
    }
    const def = r.def
    const limite = ahora + ANTICIPO
    while (r.tProximo < limite) {
      if (!def.loop && r.paso >= def.pasos) {
        r.agendando = false
        r.desarmarEn = r.tProximo + def.cola
        return
      }
      const i = def.loop ? r.paso % def.pasos : r.paso
      const t = r.tProximo + (i % 2 === 1 ? def.swing * r.d16 : 0)
      try {
        def.paso({
          m: this.m,
          seco: r.salida,
          eco: r.envioEco,
          i,
          vuelta: Math.floor(r.paso / def.pasos),
          t,
          d16: r.d16,
          intensidad: this.nivel,
          prefijo: r.id,
        })
      } catch {
        // Una nota mal armada no frena la música.
      }
      r.paso++
      r.tProximo += r.d16
    }
  }
}
