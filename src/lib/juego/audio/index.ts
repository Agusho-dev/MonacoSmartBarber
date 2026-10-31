/**
 * Audio de «Corte Final»: efectos sintetizados con WebAudio y la música de fondo (la canción
 * «Neon Dash» desde un MP3, ver pista.ts y musica.ts; los jingles siguen sintetizados). Sin React.
 *
 * Uso desde la UI:
 *   const audio = crearAudio()             // en un efecto: todavía no crea el contexto
 *   audio.musica('menu')                   // se puede pedir antes de desbloquear: arranca al desbloquear
 *   en un toque → audio.desbloquear()      // crea/reanuda el AudioContext (además se escuchan solos los gestos)
 *   en el loop:  audio.procesar(p.eventos.splice(0), p)   (los mismos eventos que van al render)
 *   botones:     audio.ui('tocar' | 'confirmar' | …)
 *   resultado:   audio.musica(gano ? 'victoria' : 'derrota')
 *   ajustes:     audio.volumen(0.8, 0.35) · audio.silenciar(true)
 *   al desmontar: audio.destruir()
 *
 * Por qué en algunos celulares no se escuchaba, y qué hace este módulo:
 *  - iOS 17+ tiene `navigator.audioSession.type`. Estaba en 'ambient', que obedece la tecla de
 *    silencio del iPhone… y casi todos los iPhone viven en silencio: no sonaba NADA. Con el
 *    sonido del juego prendido va 'playback' (suena como un video, aun en silencio); si el jugador
 *    silencia el juego, vuelve a 'ambient' (y la música de otra app que esté escuchando sigue).
 *  - iOS < 17 no tiene audioSession y WebAudio sale siempre como «ambient». Ahí, DENTRO de un
 *    toque, se reproduce un <audio> silencioso en bucle (un WAV de 50 ms en data URI), que pasa la
 *    sesión de la página a reproducción. Se pausa con el juego silenciado o la pestaña oculta.
 *  - En iOS el gesto que habilita el audio es touchend / click / pointerup (pointerdown no): se
 *    escuchan todos y en cada uno se reintenta resume() hasta que el contexto diga 'running'.
 *  - 'interrupted' (una llamada, Siri, una alarma) y volver de segundo plano: se reanuda apenas
 *    se puede (unos reintentos cortos, al volver a la pestaña y en el próximo toque).
 *  - Android: el contexto se crea dentro del primer toque y arranca 'running'.
 * Todo es idempotente y nada espera para siempre: si algo falla, el juego sigue, mudo.
 *
 * SSR: importar este módulo no toca `window` ni AudioContext; sin WebAudio todo es no-op.
 * La pestaña oculta funde a silencio y suspende el contexto (la batería); al volver, reanuda.
 */
import type { AudioJuego, EventoJuego, Partida, SonidoUi, TemaMusica } from '../tipos'
import { Mesa, limitar, suavizar } from './mesa'
import { Musica } from './musica'
import { crearEstadoEventos, procesarEventos } from './eventos'
import { sonidoUi } from './interfaz'
import { bajarPista, estadoPista } from './pista'

type ConstructorContexto = new (opciones?: AudioContextOptions) => AudioContext
type TipoSesion = 'playback' | 'ambient' | 'auto'

export const VOLUMEN_EFECTOS_POR_DEFECTO = 0.8
export const VOLUMEN_MUSICA_POR_DEFECTO = 0.35

export interface DiagnosticoAudio {
  estado: string
  voces: number
  tema: TemaMusica | null
  pasoMusica: number
  intensidad: number
  silencio: boolean
  latenciaMs: number | null
  /** La canción: 'sin-pedir' | 'bajando' | 'decodificando' | 'lista' | 'fallo'. */
  pista: string
  sonandoPista: boolean
  posicionPista: number
  /** Fuentes de la canción vivas (la que suena y las que se despiden): nunca más de 2. */
  fuentesVivas: number
  /** navigator.audioSession.type (iOS 17+) o 'sin-api'. */
  sesion: string
  /** El <audio> silencioso de iOS < 17: 'sonando' | 'pausado' | 'no-hace-falta'. */
  etiqueta: string
  /** Nivel de lo que sale (RMS de los últimos ~43 ms, dBFS) o null sin contexto. */
  nivelDb: number | null
}

/** Para el arnés: lo de adentro de cada instancia, sin ensuciar el contrato AudioJuego. */
const DIAGNOSTICOS = new WeakMap<AudioJuego, () => DiagnosticoAudio>()

export function diagnosticarAudio(a: AudioJuego): DiagnosticoAudio | null {
  const f = DIAGNOSTICOS.get(a)
  return f ? f() : null
}

function obtenerConstructor(): ConstructorContexto | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: ConstructorContexto; webkitAudioContext?: ConstructorContexto }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function ahoraMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** ¿Venimos de un gesto del usuario? (sin la API, se asume que sí). */
function hayGesto(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = (navigator as unknown as { userActivation?: { isActive: boolean; hasBeenActive: boolean } })
    .userActivation
  return ua ? ua.isActive || ua.hasBeenActive : true
}

/** Una promesa que no puede colgar al que espera (iOS a veces no resuelve resume()). */
function conTiempo(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((listo) => {
    const id = setTimeout(listo, ms)
    p.then(
      () => {
        clearTimeout(id)
        listo()
      },
      () => {
        clearTimeout(id)
        listo()
      },
    )
  })
}

/** navigator.audioSession (Safari 17+), o null. */
function sesionAudio(): { type: string } | null {
  if (typeof navigator === 'undefined') return null
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession
    return s && typeof s === 'object' ? s : null
  } catch {
    return null
  }
}

function esIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPadOS se presenta como Mac: se lo reconoce por la pantalla táctil.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
}

/** WAV de silencio (PCM 8 bits, mono, 50 ms) como data URI, a la frecuencia del contexto. */
function wavSilencioso(frecuencia: number): string {
  const hz = Math.max(8000, Math.min(96000, Math.round(frecuencia) || 48000))
  const muestras = Math.round(hz / 20)
  const bytes = new Uint8Array(44 + muestras)
  const v = new DataView(bytes.buffer)
  const texto = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i)
  }
  texto(0, 'RIFF')
  v.setUint32(4, 36 + muestras, true)
  texto(8, 'WAVE')
  texto(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, hz, true)
  v.setUint32(28, hz, true) // bytes por segundo
  v.setUint16(32, 1, true) // bytes por muestra
  v.setUint16(34, 8, true) // bits
  texto(36, 'data')
  v.setUint32(40, muestras, true)
  bytes.fill(128, 44) // el cero de 8 bits
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

/**
 * Gestos que habilitan el audio (los «activation triggering» del estándar): touchend, pointerup
 * de un dedo, click, keydown, mousedown y pointerdown SÓLO del mouse. Un pointerdown de un dedo no
 * habilita nada: crear el contexto ahí lo deja suspendido (y Chrome avisa en la consola).
 */
const GESTOS = ['touchend', 'pointerup', 'click', 'keydown', 'mousedown', 'pointerdown'] as const

export function crearAudio(): AudioJuego {
  const Constructor = obtenerConstructor()
  let ctx: AudioContext | null = null
  let mesa: Mesa | null = null
  let musica: Musica | null = null
  let destruido = false
  let silencio = false
  let oculto = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  let volEfectos = VOLUMEN_EFECTOS_POR_DEFECTO
  let volMusica = VOLUMEN_MUSICA_POR_DEFECTO
  let temaPedido: TemaMusica | null = null
  /** Hasta cuándo se agenda aunque el contexto todavía diga «suspended» (el resume() en curso). */
  let gracia = 0
  let racha = 0
  let ultimoPuntos = Number.NEGATIVE_INFINITY
  /** iOS sin audioSession: el <audio> silencioso que pasa la sesión a reproducción. */
  const usaEtiqueta = Constructor !== null && esIOS() && sesionAudio() === null
  let etiqueta: HTMLAudioElement | null = null
  let analizador: AnalyserNode | null = null
  const reintentos: ReturnType<typeof setTimeout>[] = []
  const estadoEventos = crearEstadoEventos()
  const limpiezas: Array<() => void> = []

  function corriendo(): boolean {
    if (!ctx) return false
    return ctx.state === 'running' || ahoraMs() < gracia
  }

  /** La mesa crea voces sólo si se van a oír (ni silenciado, ni oculto, ni con el contexto parado). */
  function actualizarActiva(): boolean {
    if (!mesa) return false
    mesa.activa = !destruido && !silencio && !oculto && corriendo()
    return mesa.activa
  }

  function fundirMezcla(tc: number): void {
    if (!mesa || !ctx) return
    suavizar(mesa.mezcla.gain, silencio || oculto ? 0 : 1, ctx.currentTime, tc)
  }

  /** Si el contexto corre, la música es la pedida. */
  function sincronizarMusica(): void {
    if (!musica || !corriendo()) return
    actualizarActiva()
    musica.tocar(temaPedido)
  }

  // ─── Sesión de audio (iOS) ────────────────────────────────────────────────

  /**
   * iOS 17+: 'playback' con el sonido prendido (suena aunque el iPhone esté en silencio). Recién
   * con el contexto creado (o a punto de crearse, en el gesto): abrir la página sola no le corta
   * la música que el cliente esté escuchando en otra app.
   */
  function fijarSesion(tipo: TipoSesion = silencio ? 'ambient' : 'playback', antesDeCrear = false): void {
    if (!ctx && !antesDeCrear) return
    const s = sesionAudio()
    if (!s) return
    try {
      if (s.type !== tipo) s.type = tipo
    } catch {
      // Un navegador que no deja cambiarla: queda la que tenga.
    }
  }

  function crearEtiqueta(): HTMLAudioElement | null {
    if (etiqueta || !usaEtiqueta || typeof document === 'undefined') return etiqueta
    try {
      const a = document.createElement('audio')
      a.setAttribute('x-webkit-airplay', 'deny')
      a.setAttribute('playsinline', '')
      a.preload = 'auto'
      a.loop = true
      a.src = wavSilencioso(ctx?.sampleRate ?? 48000)
      ;(a as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = true
      etiqueta = a
    } catch {
      etiqueta = null
    }
    return etiqueta
  }

  /** iOS < 17: el <audio> silencioso suena mientras el juego tenga sonido y esté a la vista. */
  function sincronizarEtiqueta(): void {
    if (!usaEtiqueta) return
    const quiere = !destruido && !silencio && !oculto
    // Se crea con el contexto ya hecho: el WAV va a la misma frecuencia (iOS no cambia de modo).
    const a = quiere ? (ctx ? crearEtiqueta() : null) : etiqueta
    if (!a) return
    try {
      if (quiere && a.paused) {
        const p = a.play()
        if (p && typeof p.catch === 'function') p.catch(() => undefined)
      } else if (!quiere && !a.paused) a.pause()
    } catch {
      // Sin gesto todavía: el próximo toque lo vuelve a intentar.
    }
  }

  // ─── Contexto ─────────────────────────────────────────────────────────────

  function reanudar(): Promise<void> {
    if (!ctx || destruido || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve()
    try {
      return conTiempo(ctx.resume(), 1500)
    } catch {
      return Promise.resolve()
    }
  }

  /** Unos reintentos cortos de resume() (después de una interrupción de iOS o al volver a la pestaña). */
  function reintentarReanudar(): void {
    for (const t of reintentos.splice(0)) clearTimeout(t)
    for (const ms of [0, 400, 1500, 3500]) {
      reintentos.push(
        setTimeout(() => {
          if (destruido || oculto || !ctx || ctx.state === 'running' || ctx.state === 'closed') return
          void reanudar().then(() => {
            actualizarActiva()
            sincronizarMusica()
          })
        }, ms),
      )
    }
  }

  function escucharContexto(c: AudioContext): void {
    c.onstatechange = () => {
      actualizarActiva()
      if (c.state === 'running') sincronizarMusica()
      // 'interrupted' (iOS) o 'suspended' con la pestaña a la vista: volver apenas se pueda.
      else if (c.state !== 'closed' && !oculto && !destruido) reintentarReanudar()
    }
  }

  function crear(): Mesa | null {
    if (mesa) return mesa
    if (destruido || !Constructor) return null
    // La sesión va antes de crear el contexto: así arranca ya en 'playback'.
    fijarSesion(silencio ? 'ambient' : 'playback', true)
    try {
      ctx = new Constructor({ latencyHint: 'interactive' })
    } catch {
      try {
        ctx = new Constructor()
      } catch {
        ctx = null
        return null
      }
    }
    try {
      mesa = new Mesa(ctx)
    } catch {
      void ctx.close().catch(() => undefined)
      ctx = null
      return null
    }
    mesa.efectos.gain.value = volEfectos
    mesa.musica.gain.value = volMusica
    escucharContexto(ctx)
    mesa.mezcla.gain.value = silencio || oculto ? 0 : 1
    musica = new Musica(mesa)
    return mesa
  }

  /**
   * La canción se pide sólo si va a sonar (sonido y música prendidos) y después de un gesto (el
   * contexto ya existe o se está creando). Silenciado o con la música apagada no se baja: se pide
   * cuando se prenden (volumen).
   */
  function pedirPista(): void {
    if (destruido || silencio || volMusica <= 0) return
    bajarPista()
    musica?.quererPista()
  }

  async function desbloquear(): Promise<void> {
    if (destruido) return
    pedirPista()
    fijarSesion()
    const m = crear()
    if (!m || !ctx) return
    const c = ctx
    if (c.state !== 'running' && hayGesto()) gracia = ahoraMs() + 400
    // iOS: un buffer vacío reproducido DENTRO del gesto destraba la salida de audio.
    if (c.state !== 'running') {
      try {
        const s = c.createBufferSource()
        s.buffer = c.createBuffer(1, 1, c.sampleRate)
        s.connect(c.destination)
        s.onended = () => s.disconnect()
        s.start(0)
      } catch {
        // nada
      }
    }
    sincronizarEtiqueta()
    const espera = reanudar()
    sincronizarMusica()
    await espera
    gracia = 0
    actualizarActiva()
    sincronizarMusica()
  }

  /** ¿Este gesto tiene algo que destrabar? (barato: se llama en cada toque). */
  function faltaDesbloquear(): boolean {
    if (destruido || !Constructor) return false
    if (!ctx) return true
    if (ctx.state !== 'running' && ctx.state !== 'closed') return true
    if (usaEtiqueta && !silencio && !oculto && (!etiqueta || etiqueta.paused)) return true
    const s = sesionAudio()
    return s !== null && s.type !== (silencio ? 'ambient' : 'playback')
  }

  // Los gestos se escuchan desde ya (no recién al crear el contexto): cualquier toque sirve.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const alGesto = (e: Event): void => {
      if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse') return
      // Un control que maneja el audio por su cuenta (el botón «Sonido» del inicio) destraba en su
      // propio click, ya con la preferencia nueva puesta. Si lo hiciera este oyente (en captura,
      // antes del click), con el primer toque en «Sonido» para SILENCIAR, en iOS 17+ la sesión
      // pasaba ≈ 100 ms por 'playback' (y cortaba la música de otra app) antes de 'ambient'.
      const objetivo = e.target as Element | null
      if (typeof objetivo?.closest === 'function' && objetivo.closest('[data-audio-propio]')) return
      if (faltaDesbloquear()) void desbloquear()
    }
    for (const g of GESTOS) window.addEventListener(g, alGesto, { capture: true, passive: true })
    const alVolver = (): void => {
      oculto = document.visibilityState === 'hidden'
      actualizarActiva()
      fundirMezcla(oculto ? 0.03 : 0.12)
      sincronizarEtiqueta()
      if (oculto) {
        setTimeout(() => {
          if (oculto && ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined)
        }, 180)
      } else {
        reintentarReanudar()
      }
    }
    const alMostrar = (): void => {
      if (document.visibilityState !== 'hidden') reintentarReanudar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('pageshow', alMostrar)
    window.addEventListener('focus', alMostrar)
    limpiezas.push(() => {
      for (const g of GESTOS) window.removeEventListener(g, alGesto, { capture: true })
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('pageshow', alMostrar)
      window.removeEventListener('focus', alMostrar)
    })
    // La canción NO se baja al abrir la página (antes, a los 1,5 s: 1 MB para alguien que abría
    // el link y se iba, y en 3G le peleaba la red a los atlas). Se pide con el primer gesto
    // (desbloquear) y le cede la red a la carga de una pelea (pista.ts, retenerPista).
  }

  function procesar(eventos: readonly EventoJuego[], p: Partida): void {
    if (destruido || !mesa || !musica) return
    if (
      eventos.length === 0 &&
      p.proyectiles.length === 0 &&
      estadoEventos.bucles.size === 0 &&
      estadoEventos.seguidos.size === 0 &&
      !estadoEventos.tension
    ) {
      return
    }
    // Aunque esté callada, la mesa procesa: la música tiene que saber del TURBO o del KO
    // para que al volver el sonido esté donde corresponde (las voces no se crean).
    actualizarActiva()
    procesarEventos(mesa, musica, eventos, p, estadoEventos)
  }

  function ui(sonido: SonidoUi): void {
    if (destruido) return
    // ui() casi siempre viene de un toque: si la UI todavía no desbloqueó, lo hacemos acá. Pero no
    // sin ningún gesto todavía (un desafío de la sala o el aviso del turno que llegan solos): ese
    // contexto nacería suspendido, Chrome avisa en la consola y en iOS 17 la sesión pasaría a
    // 'playback' sin que nadie haya tocado. El primer toque lo crea igual (los gestos se escuchan).
    if (!mesa && hayGesto()) void desbloquear()
    if (!mesa || !actualizarActiva()) return
    if (sonido === 'puntos') {
      const a = ahoraMs()
      racha = a - ultimoPuntos < 350 ? racha + 1 : 0
      ultimoPuntos = a
    }
    try {
      sonidoUi(mesa, mesa.ahora(), sonido, racha)
    } catch {
      // un sonido de interfaz nunca rompe la interfaz
    }
  }

  function musicaFn(tema: TemaMusica | null): void {
    if (destruido) return
    temaPedido = tema
    sincronizarMusica()
  }

  function volumen(efectos: number, musicaVol: number): void {
    volEfectos = limitar(Number.isFinite(efectos) ? efectos : VOLUMEN_EFECTOS_POR_DEFECTO, 0, 1)
    volMusica = limitar(Number.isFinite(musicaVol) ? musicaVol : VOLUMEN_MUSICA_POR_DEFECTO, 0, 1)
    if (ctx) pedirPista()
    if (!mesa || !ctx) return
    const a = ctx.currentTime
    suavizar(mesa.efectos.gain, volEfectos, a, 0.03)
    suavizar(mesa.musica.gain, volMusica, a, 0.05)
  }

  function silenciar(s: boolean): void {
    if (destruido) return
    silencio = s
    fijarSesion()
    sincronizarEtiqueta()
    actualizarActiva()
    fundirMezcla(0.07)
  }

  function nivelDb(): number | null {
    if (!ctx || !mesa) return null
    try {
      if (!analizador) {
        analizador = ctx.createAnalyser()
        analizador.fftSize = 2048
        mesa.mezcla.connect(analizador)
      }
      const datos = new Float32Array(analizador.fftSize)
      analizador.getFloatTimeDomainData(datos)
      let s = 0
      for (let i = 0; i < datos.length; i++) s += datos[i] * datos[i]
      const rms = Math.sqrt(s / datos.length)
      return rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120
    } catch {
      return null
    }
  }

  function destruir(): void {
    if (destruido) return
    destruido = true
    for (const t of reintentos.splice(0)) clearTimeout(t)
    for (const f of limpiezas.splice(0)) {
      try {
        f()
      } catch {
        // nada
      }
    }
    if (etiqueta) {
      try {
        etiqueta.pause()
        etiqueta.removeAttribute('src')
        etiqueta.load()
      } catch {
        // nada
      }
      etiqueta = null
    }
    if (musica) musica.destruir()
    if (mesa) mesa.cerrar()
    if (ctx) {
      const c = ctx
      c.onstatechange = null
      if (typeof c.close === 'function') c.close().catch(() => undefined)
    }
    const s = sesionAudio()
    if (s && ctx) {
      try {
        s.type = 'auto'
      } catch {
        // nada
      }
    }
    estadoEventos.bucles.clear()
    estadoEventos.seguidos.clear()
    estadoEventos.tension = null
    analizador = null
    ctx = null
    mesa = null
    musica = null
  }

  const api: AudioJuego = {
    desbloquear,
    procesar,
    ui,
    musica: musicaFn,
    volumen,
    silenciar,
    destruir,
  }
  DIAGNOSTICOS.set(api, () => {
    const em = musica ? musica.estado() : null
    const latencia = ctx ? (ctx.baseLatency ?? 0) + ((ctx as { outputLatency?: number }).outputLatency ?? 0) : null
    const sesion = sesionAudio()
    return {
      estado: destruido ? 'destruido' : !Constructor ? 'sin-webaudio' : ctx ? ctx.state : 'sin-contexto',
      voces: mesa ? mesa.cuantasVoces() : 0,
      tema: em ? em.tema : temaPedido,
      pasoMusica: em ? em.paso : 0,
      intensidad: em ? em.intensidad : 0,
      silencio,
      latenciaMs: latencia === null ? null : Math.round(latencia * 1000),
      pista: em ? em.pista : estadoPista(),
      sonandoPista: em ? em.sonandoPista : false,
      posicionPista: em ? em.posicionPista : 0,
      fuentesVivas: em ? em.fuentesVivas : 0,
      sesion: sesion ? sesion.type : 'sin-api',
      etiqueta: !usaEtiqueta ? 'no-hace-falta' : etiqueta && !etiqueta.paused ? 'sonando' : 'pausado',
      nivelDb: nivelDb(),
    }
  })
  return api
}
