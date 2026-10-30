/**
 * Mesa de mezcla del audio de «Corte Final» (WebAudio puro: sin archivos, sin React, sin `@/`).
 *
 * Cada sonido es una VOZ: un puñado de nodos que se arman en el momento, suenan y se
 * desconectan solos cuando termina la última fuente (`onended`). La mesa limita cuántas voces
 * de cada tipo suenan juntas (en un combo no se apilan veinte golpes) y, si hay que hacer
 * lugar, a la más vieja la corta con un fundido de 25 ms (sin clic).
 *
 *   voces ───────────────────► efectos (vol. efectos) ─┐
 *   voces fuertes ─► saturador ─► efectos              │
 *   envíos ─► reverb ─► efectos                         ├─► mezcla (silencio) ─► pasa altos ─► compresor ─► limitador ─► salida
 *   temas ─► entradaMusica ─► filtroMusica ─► agacheMusica ─► musica (vol. música) ─┘
 *
 * Este módulo no toca `window` ni crea contextos: recibe uno ya hecho (el real, o un
 * OfflineAudioContext en el arnés de pruebas).
 */

/** Cualquier contexto de WebAudio (el arnés mide los sonidos con OfflineAudioContext). */
export type Contexto = BaseAudioContext
export type FormaOnda = Exclude<OscillatorType, 'custom'> | PeriodicWave
export type ColorRuido = 'blanco' | 'rosa' | 'marron'

export interface OpcionesVoz {
  /** -1 (izquierda) .. 1 (derecha). Con valor (aunque sea 0) la voz lleva paneo y se puede mover. */
  pan?: number
  /** Envío a la reverb, 0..1. */
  reverb?: number
  /** Pasa por el saturador (golpes fuertes, críticos, el KO). */
  saturar?: boolean
  /** Ganancia de la voz entera. */
  volumen?: number
  /** Destino propio (la música manda a la salida de su tema). Por defecto, el bus de efectos. */
  destino?: AudioNode
  /** Segundos mínimos entre dos voces del mismo tipo: si llega antes, se descarta (anti-ráfaga). */
  separacion?: number
}

export interface Voz {
  readonly tipo: string
  readonly t0: number
  /** Hasta cuándo suena (la última parada agendada). */
  fin: number
  readonly salida: GainNode
  pan: StereoPannerNode | null
  readonly nodos: AudioNode[]
  readonly fuentes: AudioScheduledSourceNode[]
  pendientes: number
  liberada: boolean
}

/** Voces simultáneas por tipo. Lo que no está acá: 4 (efectos) o 6 (música). */
const TOPES: Readonly<Record<string, number>> = {
  golpe: 6,
  bloqueo: 4,
  swing: 4,
  maquina: 2,
  tijera: 3,
  peine: 2,
  electrico: 3,
  hielo: 2,
  vidrio: 2,
  sillon: 2,
  spray: 2,
  proyectil: 4,
  especial: 2,
  ko: 1,
  gong: 2,
  anuncio: 3,
  tension: 1,
  carga: 3,
  combo: 2,
  salto: 2,
  aterrizaje: 2,
  dash: 2,
  derribo: 2,
  ui: 4,
  puntos: 3,
  // elenco nuevo (30/oct)
  bombo: 2,
  navaja: 2,
  celular: 2,
  fuego: 3,
  moto: 1,
  disparo: 3,
  graffiti: 2,
  break: 2,
  liquido: 3,
  grito: 1,
  cuarteto: 1,
  pelota: 3,
  moscas: 1,
  mate: 3,
  sismo: 2,
  agarre: 1,
  cura: 2,
  estado: 3,
}
const TOPE_EFECTOS = 4
const TOPE_MUSICA = 6
/** Tope global de efectos sonando a la vez (los celulares medios aguantan bien ~40). */
const TOPE_TOTAL_EFECTOS = 36

// ─── Utilidades ──────────────────────────────────────────────────────────────

export function aleatorio(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

/** x ± pct (0,08 = ±8 %): cada golpe suena un poco distinto para que no canse. */
export function variar(x: number, pct: number): number {
  return x * (1 + (Math.random() * 2 - 1) * pct)
}

export function limitar(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x
}

export function midiHz(nota: number): number {
  return 440 * Math.pow(2, (nota - 69) / 12)
}

/** Envolvente de percusión: sube en `ataque` hasta `pico` y cae exponencial en `caida`. Devuelve el final. */
export function envPercusion(param: AudioParam, t: number, ataque: number, pico: number, caida: number): number {
  const a = Math.max(ataque, 0.0005)
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(pico, t + a)
  param.exponentialRampToValueAtTime(0.0001, t + a + Math.max(caida, 0.002))
  return t + a + Math.max(caida, 0.002)
}

/** Envolvente con sostenido: ataque, queda en `nivel` hasta `t + sostener` y suelta en `soltar`. Devuelve el final. */
export function envSostenida(
  param: AudioParam,
  t: number,
  ataque: number,
  nivel: number,
  sostener: number,
  soltar: number,
): number {
  const a = Math.max(ataque, 0.0005)
  const s = Math.max(sostener, a + 0.001)
  param.setValueAtTime(0, t)
  param.linearRampToValueAtTime(nivel, t + a)
  param.setValueAtTime(nivel, t + s)
  param.exponentialRampToValueAtTime(0.0001, t + s + Math.max(soltar, 0.005))
  return t + s + Math.max(soltar, 0.005)
}

/** Barrido exponencial de un parámetro (frecuencias): de `desde` a `hasta` en `dur`. */
export function barrido(param: AudioParam, t: number, desde: number, hasta: number, dur: number): void {
  param.setValueAtTime(Math.max(desde, 0.01), t)
  param.exponentialRampToValueAtTime(Math.max(hasta, 0.01), t + Math.max(dur, 0.001))
}

/**
 * Lleva un parámetro a `valor` con una curva suave (constante de tiempo `tc`), desde donde
 * esté. Sólo se usa con setTargetAtTime, así que nunca deja una rampa a medias que salte.
 */
export function suavizar(param: AudioParam, valor: number, ahora: number, tc: number): void {
  try {
    param.cancelScheduledValues(ahora)
    param.setTargetAtTime(valor, ahora, Math.max(tc, 0.001))
  } catch {
    param.value = valor
  }
}

function purgar(lista: Voz[], ahora: number): void {
  let j = 0
  for (let i = 0; i < lista.length; i++) {
    const v = lista[i]
    if (!v.liberada && v.fin > ahora) lista[j++] = v
  }
  lista.length = j
}

// ─── Materia prima (se genera una vez por contexto) ─────────────────────────

function crearRuidos(ctx: Contexto): { blanco: AudioBuffer; rosa: AudioBuffer; marron: AudioBuffer } {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * 2)
  const blanco = ctx.createBuffer(1, n, sr)
  const rosa = ctx.createBuffer(1, n, sr)
  const marron = ctx.createBuffer(1, n, sr)
  const b = blanco.getChannelData(0)
  const r = rosa.getChannelData(0)
  const m = marron.getChannelData(0)
  // Rosa: filtro de Paul Kellet. Marrón: integrador con pérdida.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ult = 0
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1
    b[i] = w
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    r[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
    ult = (ult + 0.02 * w) / 1.02
    m[i] = ult * 3.5
  }
  return { blanco, rosa, marron }
}

/** Onda de pulso con ciclo de trabajo `ciclo` (0,25 / 0,125 = el sonido «chiptune»). */
function crearPulso(ctx: Contexto, ciclo: number, armonicos = 40): PeriodicWave {
  const real = new Float32Array(armonicos + 1)
  const imag = new Float32Array(armonicos + 1)
  for (let n = 1; n <= armonicos; n++) {
    real[n] = Math.sin(2 * Math.PI * n * ciclo) / (Math.PI * n)
    imag[n] = (2 * Math.pow(Math.sin(Math.PI * n * ciclo), 2)) / (Math.PI * n)
  }
  return ctx.createPeriodicWave(real, imag)
}

/** Respuesta de una sala chica (el local): ruido estéreo que cae y se oscurece. */
function crearRespuestaReverb(ctx: Contexto, seg: number): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * seg)
  const pre = Math.floor(sr * 0.011)
  const buf = ctx.createBuffer(2, n, sr)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let lp = 0
    for (let i = pre; i < n; i++) {
      const x = (i - pre) / (n - pre)
      const k = 0.9 - 0.78 * x // los agudos se apagan antes que los graves
      lp += k * (Math.random() * 2 - 1 - lp)
      d[i] = lp * Math.exp(-x * 5.2)
    }
  }
  return buf
}

function curvaSaturacion(k: number, n = 2048): Float32Array<ArrayBuffer> {
  const curva = new Float32Array(n)
  const norma = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1
    curva[i] = Math.tanh(k * x) / norma
  }
  return curva
}

// ─── La mesa ─────────────────────────────────────────────────────────────────

export class Mesa {
  readonly ctx: Contexto
  /** Bus de efectos: su ganancia ES el volumen de efectos. */
  readonly efectos: GainNode
  /** Bus de música: su ganancia ES el volumen de música. */
  readonly musica: GainNode
  /** Silencio general (fundido). */
  readonly mezcla: GainNode
  /** Donde se conectan los temas. */
  readonly entradaMusica: GainNode
  /** Pasa bajos de la música (se cierra en el KO: suena «bajo el agua»). */
  readonly filtroMusica: BiquadFilterNode
  /** Agache de la música bajo los especiales y el KO. */
  readonly agacheMusica: GainNode
  readonly saturador: WaveShaperNode
  readonly reverb: GainNode
  readonly ruidoBlanco: AudioBuffer
  readonly ruidoRosa: AudioBuffer
  readonly ruidoMarron: AudioBuffer
  readonly pulso25: PeriodicWave
  readonly pulso12: PeriodicWave
  /** false = no se crean voces nuevas (silenciado, pestaña oculta, contexto parado). */
  activa = true
  private cerrada = false
  private readonly porTipo = new Map<string, Voz[]>()
  private readonly efectosVivos: Voz[] = []
  private readonly fijos: AudioNode[] = []

  constructor(ctx: Contexto, destino: AudioNode = ctx.destination) {
    this.ctx = ctx
    const fijo = <T extends AudioNode>(n: T): T => {
      this.fijos.push(n)
      return n
    }

    const salida = fijo(ctx.createGain())
    salida.gain.value = 0.9
    const limitador = fijo(ctx.createDynamicsCompressor())
    limitador.threshold.value = -3
    limitador.knee.value = 0
    limitador.ratio.value = 20
    limitador.attack.value = 0.002
    limitador.release.value = 0.1
    const compresor = fijo(ctx.createDynamicsCompressor())
    compresor.threshold.value = -16
    compresor.knee.value = 10
    compresor.ratio.value = 3
    compresor.attack.value = 0.005
    compresor.release.value = 0.2
    // Lo que está por debajo de 32 Hz no suena en un celular y le come margen al compresor.
    const pasaAltos = fijo(ctx.createBiquadFilter())
    pasaAltos.type = 'highpass'
    pasaAltos.frequency.value = 32
    pasaAltos.Q.value = 0.7
    this.mezcla = fijo(ctx.createGain())
    this.mezcla.connect(pasaAltos)
    pasaAltos.connect(compresor)
    compresor.connect(limitador)
    limitador.connect(salida)
    salida.connect(destino)

    this.efectos = fijo(ctx.createGain())
    this.efectos.gain.value = 0.8
    this.efectos.connect(this.mezcla)

    this.musica = fijo(ctx.createGain())
    this.musica.gain.value = 0.35
    this.musica.connect(this.mezcla)
    this.agacheMusica = fijo(ctx.createGain())
    this.agacheMusica.connect(this.musica)
    this.filtroMusica = fijo(ctx.createBiquadFilter())
    this.filtroMusica.type = 'lowpass'
    this.filtroMusica.frequency.value = 20000
    this.filtroMusica.Q.value = 0.6
    this.filtroMusica.connect(this.agacheMusica)
    this.entradaMusica = fijo(ctx.createGain())
    this.entradaMusica.connect(this.filtroMusica)

    this.saturador = fijo(ctx.createWaveShaper())
    this.saturador.curve = curvaSaturacion(2.4)
    this.saturador.oversample = '2x'
    const postSaturador = fijo(ctx.createGain())
    postSaturador.gain.value = 0.72
    this.saturador.connect(postSaturador)
    postSaturador.connect(this.efectos)

    const sala = fijo(ctx.createConvolver())
    sala.buffer = crearRespuestaReverb(ctx, 1.2)
    this.reverb = fijo(ctx.createGain())
    const retorno = fijo(ctx.createGain())
    retorno.gain.value = 0.85
    this.reverb.connect(sala)
    sala.connect(retorno)
    retorno.connect(this.efectos)

    const r = crearRuidos(ctx)
    this.ruidoBlanco = r.blanco
    this.ruidoRosa = r.rosa
    this.ruidoMarron = r.marron
    this.pulso25 = crearPulso(ctx, 0.25)
    this.pulso12 = crearPulso(ctx, 0.125)
  }

  /** «Ya», un pelito adelante para que las envolventes arranquen enteras. */
  ahora(): number {
    return this.ctx.currentTime + 0.005
  }

  /**
   * Abre una voz del tipo dado. Devuelve null si la mesa está callada o si el anti-ráfaga la
   * descarta: el que llama no arma nada.
   */
  voz(tipo: string, t0: number, op: OpcionesVoz = {}): Voz | null {
    if (!this.activa || this.cerrada) return null
    const ctx = this.ctx
    const ahora = ctx.currentTime
    const deMusica = op.destino !== undefined
    let lista = this.porTipo.get(tipo)
    if (lista === undefined) {
      lista = []
      this.porTipo.set(tipo, lista)
    }
    purgar(lista, ahora)
    const ultima = lista[lista.length - 1]
    if (op.separacion !== undefined && ultima !== undefined && t0 - ultima.t0 < op.separacion) return null
    const tope = TOPES[tipo] ?? (deMusica ? TOPE_MUSICA : TOPE_EFECTOS)
    while (lista.length >= tope) {
      const vieja = lista.shift()
      if (vieja) this.robar(vieja, ahora, 0.025)
    }
    if (!deMusica) {
      purgar(this.efectosVivos, ahora)
      while (this.efectosVivos.length >= TOPE_TOTAL_EFECTOS) {
        const vieja = this.efectosVivos.shift()
        if (vieja) this.robar(vieja, ahora, 0.025)
      }
    }

    const salida = ctx.createGain()
    salida.gain.value = op.volumen ?? 1
    const v: Voz = { tipo, t0, fin: t0, salida, pan: null, nodos: [salida], fuentes: [], pendientes: 0, liberada: false }
    let cola: AudioNode = salida
    if (op.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner()
      p.pan.value = limitar(op.pan, -1, 1)
      salida.connect(p)
      v.nodos.push(p)
      v.pan = p
      cola = p
    }
    cola.connect(op.destino ?? (op.saturar ? this.saturador : this.efectos))
    if (op.reverb !== undefined && op.reverb > 0) {
      const envio = ctx.createGain()
      envio.gain.value = op.reverb
      cola.connect(envio)
      envio.connect(this.reverb)
      v.nodos.push(envio)
    }
    lista.push(v)
    if (!deMusica) this.efectosVivos.push(v)
    return v
  }

  osc(v: Voz, forma: FormaOnda, frec: number, t0: number, t1: number, destino: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator()
    if (typeof forma === 'object') o.setPeriodicWave(forma)
    else o.type = forma
    o.frequency.setValueAtTime(frec, t0)
    o.connect(destino)
    this.programar(v, o, t0, t1)
    return o
  }

  /** Oscilador de modulación: `profundidad` × onda, sumado al parámetro. */
  lfo(v: Voz, forma: FormaOnda, frec: number, profundidad: number, t0: number, t1: number, param: AudioParam): OscillatorNode {
    return this.osc(v, forma, frec, t0, t1, this.modulador(v, profundidad, param))
  }

  /** Ganancia cuya salida se SUMA a un parámetro (índice de FM, trémolo, vibrato). */
  modulador(v: Voz, valor: number, param: AudioParam): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = valor
    g.connect(param)
    v.nodos.push(g)
    return g
  }

  /** Ruido en bucle desde un punto al azar del buffer (cada golpe tiene otra textura). */
  ruido(v: Voz, t0: number, t1: number, destino: AudioNode, color: ColorRuido = 'blanco', velocidad = 1): AudioBufferSourceNode {
    const b = this.ctx.createBufferSource()
    const buf = color === 'blanco' ? this.ruidoBlanco : color === 'rosa' ? this.ruidoRosa : this.ruidoMarron
    b.buffer = buf
    b.loop = true
    if (velocidad !== 1) b.playbackRate.value = velocidad
    b.connect(destino)
    this.programar(v, b, t0, t1, Math.random() * (buf.duration - 0.05))
    return b
  }

  ganancia(v: Voz, valor: number, destino: AudioNode): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = valor
    g.connect(destino)
    v.nodos.push(g)
    return g
  }

  filtro(v: Voz, tipo: BiquadFilterType, frec: number, q: number, destino: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter()
    f.type = tipo
    f.frequency.value = frec
    f.Q.value = q
    f.connect(destino)
    v.nodos.push(f)
    return f
  }

  /** Corta una voz con un fundido corto (bucles: tensión, proyectiles). */
  cortar(v: Voz, fundido = 0.08): void {
    this.robar(v, this.ctx.currentTime, fundido)
  }

  callarTodo(fundido = 0.05): void {
    const ahora = this.ctx.currentTime
    for (const lista of this.porTipo.values()) for (const v of lista) this.robar(v, ahora, fundido)
  }

  /** Voces sonando (de un tipo, o todas). Para el arnés y las pruebas. */
  cuantasVoces(tipo?: string): number {
    const ahora = this.ctx.currentTime
    let n = 0
    for (const [t, lista] of this.porTipo) {
      if (tipo !== undefined && t !== tipo) continue
      purgar(lista, ahora)
      n += lista.length
    }
    return n
  }

  /** Desarma todo (destruir). Después de esto la mesa no crea más voces. */
  cerrar(): void {
    this.callarTodo(0.02)
    this.cerrada = true
    this.activa = false
    for (const n of this.fijos) {
      try {
        n.disconnect()
      } catch {
        // ya estaba desconectado
      }
    }
  }

  private programar(v: Voz, f: AudioScheduledSourceNode, t0: number, t1: number, desfase?: number): void {
    v.nodos.push(f)
    v.fuentes.push(f)
    v.pendientes++
    f.onended = () => {
      v.pendientes--
      if (v.pendientes <= 0) this.liberar(v)
    }
    if (desfase !== undefined) (f as AudioBufferSourceNode).start(t0, desfase)
    else f.start(t0)
    const fin = Math.max(t1, t0 + 0.002)
    f.stop(fin)
    if (fin > v.fin) v.fin = fin
  }

  private robar(v: Voz, ahora: number, fundido: number): void {
    if (v.liberada || v.fin <= ahora) return
    v.fin = ahora
    const g = v.salida.gain
    try {
      g.cancelScheduledValues(ahora)
      g.setValueAtTime(g.value, ahora)
      g.linearRampToValueAtTime(0, ahora + fundido)
    } catch {
      g.value = 0
    }
    for (const f of v.fuentes) {
      try {
        f.stop(ahora + fundido + 0.01)
      } catch {
        // Safari viejo no deja re-agendar el stop: igual queda en silencio por el fundido.
      }
    }
  }

  private liberar(v: Voz): void {
    if (v.liberada) return
    v.liberada = true
    for (const n of v.nodos) {
      try {
        n.disconnect()
      } catch {
        // ya estaba desconectado
      }
    }
  }
}
