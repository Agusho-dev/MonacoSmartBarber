/**
 * Audio de «Corte Final»: efectos y música sintetizados con WebAudio (sin archivos, sin React).
 *
 * Uso desde la UI:
 *   const audio = crearAudio()             // en un efecto: todavía no crea nada
 *   audio.musica('menu')                   // se puede pedir antes de desbloquear: arranca al desbloquear
 *   onPointerDown → audio.desbloquear()    // primer toque: crea/reanuda el AudioContext (iOS)
 *   en el loop:  audio.procesar(p.eventos.splice(0), p)   (los mismos eventos que van al render)
 *   botones:     audio.ui('tocar' | 'confirmar' | …)
 *   resultado:   audio.musica(gano ? 'victoria' : 'derrota')
 *   ajustes:     audio.volumen(0.8, 0.35) · audio.silenciar(true)
 *   al desmontar: audio.destruir()
 *
 * SSR: importar este módulo no toca `window` ni AudioContext; sin WebAudio todo es no-op.
 * La pestaña oculta funde a silencio y suspende el contexto (la batería); al volver, reanuda.
 */
import type { AudioJuego, EventoJuego, Partida, SonidoUi, TemaMusica } from '../tipos'
import { Mesa, limitar, suavizar } from './mesa'
import { Musica } from './musica'
import { crearEstadoEventos, procesarEventos } from './eventos'
import { sonidoUi } from './interfaz'

type ConstructorContexto = new (opciones?: AudioContextOptions) => AudioContext

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

export function crearAudio(): AudioJuego {
  const Constructor = obtenerConstructor()
  let ctx: AudioContext | null = null
  let mesa: Mesa | null = null
  let musica: Musica | null = null
  let destruido = false
  let silencio = false
  let oculto = false
  let volEfectos = VOLUMEN_EFECTOS_POR_DEFECTO
  let volMusica = VOLUMEN_MUSICA_POR_DEFECTO
  let temaPedido: TemaMusica | null = null
  /** Hasta cuándo se agenda aunque el contexto todavía diga «suspended» (el resume() en curso). */
  let gracia = 0
  let racha = 0
  let ultimoPuntos = Number.NEGATIVE_INFINITY
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

  function reanudar(): Promise<void> {
    if (!ctx || destruido || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve()
    try {
      return conTiempo(ctx.resume(), 1500)
    } catch {
      return Promise.resolve()
    }
  }

  function escuchar(c: AudioContext): void {
    c.onstatechange = () => {
      actualizarActiva()
      if (c.state === 'running') sincronizarMusica()
    }
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    oculto = document.visibilityState === 'hidden'
    const alCambiarVisibilidad = (): void => {
      oculto = document.visibilityState === 'hidden'
      actualizarActiva()
      fundirMezcla(oculto ? 0.03 : 0.12)
      if (oculto) {
        setTimeout(() => {
          if (oculto && ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined)
        }, 180)
      } else {
        void reanudar()
      }
    }
    // iOS suspende o «interrumpe» el contexto (una llamada, otra app con audio, el bloqueo):
    // se reanuda en el próximo toque, que es cuando Safari lo permite.
    const alTocar = (): void => {
      if (ctx && ctx.state !== 'running' && !oculto && !destruido) void reanudar()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pointerdown', alTocar, { capture: true, passive: true })
    window.addEventListener('touchend', alTocar, { capture: true, passive: true })
    window.addEventListener('keydown', alTocar, { capture: true })
    limpiezas.push(() => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pointerdown', alTocar, { capture: true })
      window.removeEventListener('touchend', alTocar, { capture: true })
      window.removeEventListener('keydown', alTocar, { capture: true })
    })
  }

  function crear(): Mesa | null {
    if (mesa) return mesa
    if (destruido || !Constructor) return null
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
    // iOS 17+: «ambient» respeta la tecla de silencio y no corta la música que el cliente
    // esté escuchando en otra app mientras espera.
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'ambient'
    } catch {
      // no hay audioSession
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
    escuchar(ctx)
    mesa.mezcla.gain.value = silencio || oculto ? 0 : 1
    musica = new Musica(mesa)
    return mesa
  }

  async function desbloquear(): Promise<void> {
    if (destruido) return
    const m = crear()
    if (!m || !ctx) return
    const c = ctx
    if (c.state !== 'running' && hayGesto()) gracia = ahoraMs() + 400
    // iOS: un buffer vacío reproducido DENTRO del gesto destraba la salida de audio.
    try {
      const s = c.createBufferSource()
      s.buffer = c.createBuffer(1, 1, c.sampleRate)
      s.connect(c.destination)
      s.onended = () => s.disconnect()
      s.start(0)
    } catch {
      // nada
    }
    const espera = reanudar()
    sincronizarMusica()
    await espera
    gracia = 0
    actualizarActiva()
    sincronizarMusica()
  }

  function procesar(eventos: readonly EventoJuego[], p: Partida): void {
    if (destruido || !mesa || !musica) return
    if (eventos.length === 0 && p.proyectiles.length === 0 && estadoEventos.bucles.size === 0 && !estadoEventos.tension) {
      return
    }
    // Aunque esté callada, la mesa procesa: la música tiene que saber del TURBO o del KO
    // para que al volver el sonido esté donde corresponde (las voces no se crean).
    actualizarActiva()
    procesarEventos(mesa, musica, eventos, p, estadoEventos)
  }

  function ui(sonido: SonidoUi): void {
    if (destruido) return
    // ui() casi siempre viene de un toque: si la UI todavía no desbloqueó, lo hacemos acá.
    if (!mesa) void desbloquear()
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
    if (!mesa || !ctx) return
    const a = ctx.currentTime
    suavizar(mesa.efectos.gain, volEfectos, a, 0.03)
    suavizar(mesa.musica.gain, volMusica, a, 0.05)
  }

  function silenciar(s: boolean): void {
    if (destruido) return
    silencio = s
    actualizarActiva()
    fundirMezcla(0.07)
  }

  function destruir(): void {
    if (destruido) return
    destruido = true
    for (const f of limpiezas.splice(0)) {
      try {
        f()
      } catch {
        // nada
      }
    }
    if (musica) musica.destruir()
    if (mesa) mesa.cerrar()
    if (ctx) {
      const c = ctx
      c.onstatechange = null
      if (typeof c.close === 'function') c.close().catch(() => undefined)
    }
    estadoEventos.bucles.clear()
    estadoEventos.tension = null
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
    return {
      estado: destruido ? 'destruido' : !Constructor ? 'sin-webaudio' : ctx ? ctx.state : 'sin-contexto',
      voces: mesa ? mesa.cuantasVoces() : 0,
      tema: em ? em.tema : temaPedido,
      pasoMusica: em ? em.paso : 0,
      intensidad: em ? em.intensidad : 0,
      silencio,
      latenciaMs: latencia === null ? null : Math.round(latencia * 1000),
    }
  })
  return api
}
