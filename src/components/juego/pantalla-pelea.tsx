'use client'

import { LogOut, RotateCcw, Smartphone } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { avanzar, calcularPuntaje, crearPartida, metaDesdeAtlas } from '@/lib/juego/motor'
import { PERSONAJES } from '@/lib/juego/personajes'
import { crearRenderizador } from '@/lib/juego/render'
import { TPS } from '@/lib/juego/tipos'
import type {
  DesglosePuntaje,
  EstadoTurnoJuego,
  IdPersonaje,
  MetaAnimaciones,
  OpcionesRender,
  Partida,
  RecursosJuego,
  Renderizador,
} from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { conectarControlesTactiles, type ControlesTactiles } from '@/lib/juego/ui/controles-tactiles'
import { aplicarDisposicion, calcularDisposicion, type Insets } from '@/lib/juego/ui/disposicion'
import { conectarTeclado, crearCapturaEntrada, type CapturaEntrada } from '@/lib/juego/ui/entrada'
import { crearHud } from '@/lib/juego/ui/hud'
import { crearLoop, type ControlLoop } from '@/lib/juego/ui/loop'
import { useConsultaMedia } from '@/lib/juego/ui/media'
import { metaPorDefecto } from '@/lib/juego/ui/meta-por-defecto'
import { guardarPreferencias, type PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import type { Eleccion, FuentesJuego, ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
import { ControlesPelea } from './controles-pelea'
import { HudPelea } from './hud-pelea'
import { MenuPausa } from './menu-pausa'
import { Tutorial } from './tutorial'

const RONDAS_PARA_GANAR = 2
const SEGUNDOS_POR_ROUND = 60
/** El festejo que se ve después de `fin_partida`, antes del resultado. */
const ESPERA_RESULTADO_MS = 2500

type Calidad = OpcionesRender['calidad']
const MAS_BAJA: Record<Calidad, Calidad | null> = { alta: 'media', media: 'baja', baja: null }

function metaDe(recursos: RecursosJuego, id: IdPersonaje): MetaAnimaciones {
  const atlas = recursos.atlas[id]
  if (atlas) {
    try {
      return metaDesdeAtlas(atlas.datos)
    } catch (error) {
      console.error('[juego] atlas ilegible, sigo con los cuadros por defecto', id, error)
    }
  }
  return metaPorDefecto()
}

/** Una primera estimación; si igual no llega a ~40 fps, el loop avisa y se baja un escalón. */
function calidadInicial(): Calidad {
  if (typeof navigator === 'undefined') return 'alta'
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return 'alta'
  const nucleos = nav.hardwareConcurrency || 4
  const memoria = nav.deviceMemory ?? 4
  return nucleos <= 4 || memoria <= 2 ? 'media' : 'alta'
}

function leerInsets(sonda: HTMLElement | null): Insets {
  if (!sonda) return { arriba: 0, derecha: 0, abajo: 0, izquierda: 0 }
  const cs = getComputedStyle(sonda)
  const n = (v: string) => {
    const x = parseFloat(v)
    return Number.isFinite(x) ? x : 0
  }
  return { arriba: n(cs.paddingTop), derecha: n(cs.paddingRight), abajo: n(cs.paddingBottom), izquierda: n(cs.paddingLeft) }
}

function nuevoId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

interface Props {
  eleccion: Eleccion
  recursos: RecursosJuego
  fuentes: FuentesJuego
  audio: AudioSeguro
  prefs: PreferenciasJuego
  turno: EstadoTurnoJuego | null
  /** Hay algo encima (el «¡te toca!»): la pelea se congela. */
  bloqueada: boolean
  onTerminar: (r: ResultadoPelea) => void
  onReiniciar: () => void
  onSalir: () => void
}

export function PantallaPelea({
  eleccion,
  recursos,
  fuentes,
  audio,
  prefs,
  turno,
  bloqueada,
  onTerminar,
  onReiniciar,
  onSalir,
}: Props) {
  const { jugador, rival, arena, dificultad } = eleccion
  const { titulo: fuenteTitulo, numeros: fuenteNumeros } = fuentes
  const raizRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sondaRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<ControlLoop | null>(null)
  const entradaRef = useRef<CapturaEntrada | null>(null)
  const tactilesRef = useRef<ControlesTactiles | null>(null)
  /** Lo leen los controles en cada toque: ¿los toques llegan al motor? */
  const detenidaRef = useRef(true)
  /** Ya salió `fin_partida`: la música no vuelve y la pausa no tiene sentido. */
  const terminadaRef = useRef(false)

  // Si la pelea arranca con el «¡te toca!» encima (llegó durante el VS), arranca en pausa.
  const [pausa, setPausa] = useState(() => bloqueada)
  const [tutorial, setTutorial] = useState(() => !prefs.tutorialVisto)
  const [error, setError] = useState(false)
  const tactil = useConsultaMedia('(any-pointer: coarse)')

  // Un «¡te toca!» encima deja la pelea en PAUSA: al cerrarlo no arranca sola a espaldas
  // del jugador (patrón de React para ajustar estado cuando cambia una prop).
  const [bloqueadaAntes, setBloqueadaAntes] = useState(bloqueada)
  if (bloqueada !== bloqueadaAntes) {
    setBloqueadaAntes(bloqueada)
    if (bloqueada) setPausa(true)
  }

  const detenida = pausa || tutorial || bloqueada || error
  const fichaJugador = PERSONAJES[jugador]
  const fichaRival = PERSONAJES[rival]

  const terminar = useEffectEvent((p: Partida) => {
    let desglose: DesglosePuntaje
    try {
      desglose = calcularPuntaje(p, 0)
    } catch (e) {
      console.error('[juego] no se pudo calcular el puntaje', e)
      desglose = { total: 0, partes: [], rango: 'D' }
    }
    onTerminar({
      id: nuevoId(),
      eleccion: { jugador, rival, arena, dificultad },
      gano: p.ganadorPartida === 0,
      desglose,
      estadisticas: { ...p.estadisticas[0] },
      estadisticasRival: { ...p.estadisticas[1] },
      rondas: [p.rondasGanadas[0], p.rondasGanadas[1]],
      duracionSeg: Math.round(p.tick / TPS),
      mejorAnterior: 0,
    })
  })

  const fallar = useEffectEvent((e: unknown) => {
    console.error('[juego] la pelea se cortó', e)
    setError(true)
  })

  const alternarPausa = useEffectEvent(() => {
    if (tutorial || bloqueada || error || terminadaRef.current) return
    audio.ui(pausa ? 'confirmar' : 'atras')
    setPausa(!pausa)
  })

  const pausarPorOcultar = useEffectEvent(() => {
    if (!detenidaRef.current && !terminadaRef.current) setPausa(true)
  })

  // Montaje: partida, render, HUD, entrada, loop y disposición. Una vez por pelea: la
  // raíz remonta este componente (otra `key`) para la revancha o el reinicio.
  useEffect(() => {
    const raiz = raizRef.current
    const canvas = canvasRef.current
    if (!raiz || !canvas) return

    let calidad = calidadInicial()
    const opcionesRender = (c: Calidad): Partial<OpcionesRender> => ({
      calidad: c,
      fuentes: { titulo: fuenteTitulo, numeros: fuenteNumeros },
      numerosDeDanio: true,
    })

    let partida: Partida
    let render: Renderizador
    try {
      partida = crearPartida({
        personajes: [jugador, rival],
        cpu: [false, true],
        dificultad,
        arena,
        rondasParaGanar: RONDAS_PARA_GANAR,
        segundosPorRound: SEGUNDOS_POR_ROUND,
        animaciones: [metaDe(recursos, jugador), metaDe(recursos, rival)],
        semilla: Math.floor(Math.random() * 0x7fffffff),
      })
      render = crearRenderizador(canvas, recursos, opcionesRender(calidad))
    } catch (e) {
      fallar(e)
      return
    }

    const entrada = crearCapturaEntrada()
    entradaRef.current = entrada
    const ficha = PERSONAJES[jugador]
    const hud = crearHud(raiz, { entrada, costos: [ficha.especiales[0].costo, ficha.especiales[1].costo] })

    const medir = () => {
      const ancho = raiz.clientWidth
      const alto = raiz.clientHeight
      if (ancho <= 0 || alto <= 0) return
      const d = calcularDisposicion(ancho, alto, leerInsets(sondaRef.current))
      aplicarDisposicion(raiz, d)
      try {
        render.redimensionar(d.lienzo.w, d.lienzo.h, window.devicePixelRatio || 1)
      } catch (e) {
        console.error('[juego] redimensionar', e)
      }
      loopRef.current?.redibujar()
    }

    const loop = crearLoop({
      partida,
      renderizador: render,
      avanzar,
      tomarEntrada: () => entrada.tomar(),
      alCuadro: (p, eventos, dt) => {
        hud.actualizar(p, eventos, dt)
        audio.procesar(eventos, p)
        if (!terminadaRef.current && eventos.some((e) => e.tipo === 'fin_partida')) {
          terminadaRef.current = true
          audio.musica(null)
        }
      },
      alFinPartida: (p) => terminar(p),
      esperaFinMs: ESPERA_RESULTADO_MS,
      alRendimientoBajo: () => {
        const nueva = MAS_BAJA[calidad]
        if (!nueva) return
        try {
          render.destruir()
          render = crearRenderizador(canvas, recursos, opcionesRender(nueva))
          calidad = nueva
          loop.cambiarRenderizador(render)
          medir()
        } catch (e) {
          fallar(e)
        }
      },
      alError: (e) => fallar(e),
    })
    loopRef.current = loop

    medir()
    const observador = new ResizeObserver(() => medir())
    observador.observe(raiz)
    // iOS a veces informa el tamaño viejo justo al girar: se vuelve a medir un toque después.
    let timerGiro = 0
    const medirDespues = () => {
      window.clearTimeout(timerGiro)
      timerGiro = window.setTimeout(medir, 300)
    }
    window.addEventListener('orientationchange', medirDespues)
    window.visualViewport?.addEventListener('resize', medirDespues)

    const desconectarTeclado = conectarTeclado(entrada, {
      activo: () => !detenidaRef.current,
      alPausa: () => alternarPausa(),
    })
    const tactiles = conectarControlesTactiles(raiz, {
      entrada,
      activo: () => !detenidaRef.current,
    })
    tactilesRef.current = tactiles

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        entrada.soltarTodo()
        pausarPorOcultar()
      }
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    return () => {
      loop.detener()
      loopRef.current = null
      observador.disconnect()
      window.clearTimeout(timerGiro)
      window.removeEventListener('orientationchange', medirDespues)
      window.visualViewport?.removeEventListener('resize', medirDespues)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      desconectarTeclado()
      tactiles.destruir()
      tactilesRef.current = null
      entradaRef.current = null
      try {
        render.destruir()
      } catch {
        // Ya no importa: la pantalla se va.
      }
    }
  }, [jugador, rival, arena, dificultad, recursos, fuenteTitulo, fuenteNumeros, audio])

  // Pausa, tutorial, avisos y errores congelan la pelea (y sueltan lo que estaba apretado).
  useEffect(() => {
    detenidaRef.current = detenida
    const loop = loopRef.current
    if (!loop) return
    if (detenida) {
      loop.pausar()
      entradaRef.current?.soltarTodo()
      tactilesRef.current?.reiniciar()
      audio.musica(null)
    } else {
      loop.reanudar()
      if (!terminadaRef.current) audio.musica('pelea')
    }
  }, [detenida, audio])

  const pedirPausa = () => {
    if (detenida || terminadaRef.current) return
    audio.ui('atras')
    setPausa(true)
  }

  const cerrarTutorial = () => {
    guardarPreferencias({ tutorialVisto: true })
    audio.ui('confirmar')
    setTutorial(false)
  }

  return (
    <div
      ref={raizRef}
      className="cf-pelea"
      data-tactil={tactil ? '' : undefined}
      style={{ '--cf-acento': fichaJugador.color, '--cf-acento-2': fichaJugador.colorSecundario } as CSSProperties}
    >
      <div ref={sondaRef} className="cf-sonda" aria-hidden="true" />
      <div className="cf-pelea__lienzo">
        <canvas
          ref={canvasRef}
          className="cf-pelea__canvas"
          role="img"
          aria-label={`Pelea: ${fichaJugador.nombre} contra ${fichaRival.nombre}`}
        />
        <div className="cf-pelea__marco" aria-hidden="true" />
      </div>
      <p className="cf-girar" aria-hidden="true">
        <Smartphone />
        Girá el celular: se ve más grande
      </p>

      <HudPelea
        fichas={[fichaJugador, fichaRival]}
        rondasParaGanar={RONDAS_PARA_GANAR}
        segundos={SEGUNDOS_POR_ROUND}
        onPausa={pedirPausa}
      />
      <ControlesPelea ficha={fichaJugador} />

      {pausa && !tutorial && !error && (
        <MenuPausa
          prefs={prefs}
          turno={turno}
          tactil={tactil}
          onContinuar={() => {
            audio.ui('confirmar')
            setPausa(false)
          }}
          onReiniciar={() => {
            audio.ui('confirmar')
            onReiniciar()
          }}
          onComoSeJuega={() => {
            audio.ui('tocar')
            setTutorial(true)
          }}
          onSalir={() => {
            audio.ui('atras')
            onSalir()
          }}
        />
      )}
      {tutorial && !error && <Tutorial tactil={tactil} onCerrar={cerrarTutorial} />}
      {error && <ErrorPelea onReintentar={onReiniciar} onSalir={onSalir} />}
    </div>
  )
}

function ErrorPelea({ onReintentar, onSalir }: { onReintentar: () => void; onSalir: () => void }) {
  return (
    <div className="cf-capa" role="alertdialog" aria-modal="true" aria-labelledby="cf-error-titulo">
      <div className="cf-pausa">
        <h2 id="cf-error-titulo" className="cf-titulo cf-pausa__titulo">
          Se cortó la pelea
        </h2>
        <p className="cf-texto-suave">
          Algo falló al arrancar o en el medio. Probá de nuevo; si sigue pasando, elegí otro barbero o arena.
        </p>
        <button type="button" className="cf-btn cf-btn--grande" onClick={onReintentar} autoFocus>
          <RotateCcw aria-hidden="true" />
          <span>Reintentar</span>
        </button>
        <button type="button" className="cf-btn cf-btn--sec" onClick={onSalir}>
          <LogOut aria-hidden="true" />
          <span>Volver</span>
        </button>
      </div>
    </div>
  )
}
