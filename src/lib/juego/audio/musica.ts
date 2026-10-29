/**
 * Secuenciador de la música, con anticipación: un reloj de JS cada 25 ms agenda las notas de
 * los próximos 0,22 s contra `currentTime` del AudioContext. El tempo lo marca el reloj de
 * audio, no el timer: si el timer llega tarde (el render ocupó el hilo), las notas igual caen
 * en su lugar. Si quedó muy atrás (pestaña dormida), salta al presente sin amontonar notas.
 *
 * Un tema por vez; al cambiar, el que sale se apaga con fundido y el que entra sube con el suyo.
 */
import type { TemaMusica } from '../tipos'
import type { Mesa } from './mesa'
import { suavizar } from './mesa'
import type { DefTema } from './temas'
import { TEMAS } from './temas'

const ANTICIPO = 0.22
const INTERVALO_MS = 25

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

export class Musica {
  /** El tema pedido (sigue siendo ése aunque el jingle ya haya terminado). */
  tema: TemaMusica | null = null
  private readonly m: Mesa
  private actual: Reproduccion | null = null
  private readonly saliendo: Reproduccion[] = []
  private reloj: ReturnType<typeof setInterval> | null = null
  private nivel = 0
  private bajoElAgua = false

  constructor(m: Mesa) {
    this.m = m
  }

  /** Cambia de tema con fundido. El mismo tema otra vez no hace nada (no reinicia el jingle). */
  tocar(tema: TemaMusica | null): void {
    if (tema === this.tema) return
    this.tema = tema
    const ahora = this.m.ctx.currentTime
    const jingle = tema === 'victoria' || tema === 'derrota'
    if (this.actual) {
      this.soltar(this.actual, ahora, jingle ? 0.25 : 0.9)
      this.actual = null
    }
    if (tema !== 'pelea') this.nivel = 0
    this.superficie(0.15)
    if (tema !== null) this.actual = this.armar(tema, ahora + (jingle ? 0.03 : 0.1))
    this.asegurarReloj()
  }

  /** 0 normal, 1 round final, 2 TURBO. Rige desde el próximo paso que se agende. */
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

  /** Para el arnés y las pruebas. */
  estado(): { tema: TemaMusica | null; paso: number; adelanto: number; intensidad: number } {
    const r = this.actual
    return {
      tema: this.tema,
      paso: r ? r.paso : 0,
      adelanto: r && r.agendando ? r.tProximo - this.m.ctx.currentTime : 0,
      intensidad: this.nivel,
    }
  }

  destruir(): void {
    this.pararReloj()
    if (this.actual) this.desarmar(this.actual)
    for (const r of this.saliendo) this.desarmar(r)
    this.saliendo.length = 0
    this.actual = null
    this.tema = null
  }

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
