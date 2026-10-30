'use client'

import { LogOut, RotateCcw, Smartphone } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { avanzar, calcularPuntaje, crearPartida, metaDesdeAtlas } from '@/lib/juego/motor'
import type { ArranqueDuelo, Duelo, FinPeleaLocal } from '@/lib/juego/online/duelo'
import { hashPartida } from '@/lib/juego/online/hash'
import { ABANDONO_MS, CADA_HASH, type Lockstep } from '@/lib/juego/online/lockstep'
import { eventosParaHud, vistaParaAudio, vistaParaHud } from '@/lib/juego/online/vistas'
import { PERSONAJES } from '@/lib/juego/personajes'
import { crearRenderizador } from '@/lib/juego/render'
import { ENTRADA_VACIA, TPS } from '@/lib/juego/tipos'
import type {
  DesglosePuntaje,
  EntradaJugador,
  EstadoTurnoJuego,
  IdPersonaje,
  Lado,
  MetaAnimaciones,
  OpcionesRender,
  Partida,
  RecursosJuego,
  Renderizador,
} from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { conectarControlesTactiles, type ControlesTactiles } from '@/lib/juego/ui/controles-tactiles'
import { depuracionHabilitada, publicarDepuracion } from '@/lib/juego/ui/depuracion'
import { aplicarDisposicion, calcularDisposicion, type Caja, type Insets } from '@/lib/juego/ui/disposicion'
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
import { CapasOnline, crearCapasOnline, HudOnline, MenuOnline } from './sala/hud-online'
import { Tutorial } from './tutorial'

const RONDAS_PARA_GANAR = 2
const SEGUNDOS_POR_ROUND = 60
/** El festejo que se ve después de `fin_partida`, antes del resultado. */
const ESPERA_RESULTADO_MS = 2500
const VACIAS: readonly [EntradaJugador, EntradaJugador] = [ENTRADA_VACIA, ENTRADA_VACIA]

type Calidad = OpcionesRender['calidad']
const MAS_BAJA: Record<Calidad, Calidad | null> = { alta: 'media', media: 'baja', baja: null }

/**
 * Una pelea online contra otro jugador de la sala (lockstep, ver src/lib/juego/online). El
 * objeto tiene que ser el MISMO durante toda la pelea: la raíz lo arma una vez por pelea.
 */
export interface PeleaOnline {
  duelo: Duelo
  lado: Lado
  arranque: ArranqueDuelo
  /** Nombres de los jugadores por lado del mundo (0 = izquierda, el que desafió). */
  nombres: [string, string]
}

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

/** Lo que el duelo online necesita del final de la partida (lados del mundo). */
function finDeLaPartida(p: Partida): FinPeleaLocal {
  return {
    ganadorLado: p.ganadorPartida,
    rondasPorLado: [p.rondasGanadas[0], p.rondasGanadas[1]],
    estadisticasPorLado: [{ ...p.estadisticas[0] }, { ...p.estadisticas[1] }],
    duracionSeg: Math.round(p.tick / TPS),
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
  /** Pelea online: sin CPU, sin pausa y sin tutorial (ver PeleaOnline). */
  online?: PeleaOnline
  /** Online: abandonó desde el menú o la pelea se rompió. */
  onAbandonarOnline?: () => void
  /**
   * Lo de la sala encima de la pelea contra la CPU (el chip chico y el cartel de un desafío):
   * va adentro para ubicarse con la disposición (debajo del HUD, sin tapar barras ni carga).
   */
  superpuesto?: ReactNode
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
  online,
  onAbandonarOnline,
  superpuesto,
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
  const [tutorial, setTutorial] = useState(() => !prefs.tutorialVisto && !online)
  const [error, setError] = useState(false)
  /** Online: el menú del botón de pausa (la pelea NO se detiene). */
  const [menuOnline, setMenuOnline] = useState(false)
  const tactil = useConsultaMedia('(any-pointer: coarse)')

  // Un «¡te toca!» encima deja la pelea en PAUSA: al cerrarlo no arranca sola a espaldas
  // del jugador (patrón de React para ajustar estado cuando cambia una prop).
  const [bloqueadaAntes, setBloqueadaAntes] = useState(bloqueada)
  if (bloqueada !== bloqueadaAntes) {
    setBloqueadaAntes(bloqueada)
    if (bloqueada) setPausa(true)
  }

  // Online no hay pausa: sólo un error frena el loop. El menú sólo deja sin controles.
  const detenida = online ? error : pausa || tutorial || bloqueada || error
  const sinControles = detenida || menuOnline
  const ladoPropio: Lado = online?.lado ?? 0
  const personajesPorLado: [IdPersonaje, IdPersonaje] = online ? online.arranque.personajes : [jugador, rival]
  const fichasPorLado = [PERSONAJES[personajesPorLado[0]], PERSONAJES[personajesPorLado[1]]] as const
  const fichaJugador = fichasPorLado[ladoPropio]
  const nombreRival = online ? online.nombres[ladoPropio === 0 ? 1 : 0] : ''

  const terminar = useEffectEvent((p: Partida) => {
    if (online) {
      online.duelo.terminarPelea(finDeLaPartida(p))
      return
    }
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
    if (online) {
      if (error || terminadaRef.current) return
      audio.ui(menuOnline ? 'confirmar' : 'atras')
      setMenuOnline(!menuOnline)
      return
    }
    if (tutorial || bloqueada || error || terminadaRef.current) return
    audio.ui(pausa ? 'confirmar' : 'atras')
    setPausa(!pausa)
  })

  const pausarPorOcultar = useEffectEvent(() => {
    // Online no se pausa (el otro sigue): si no vuelve en 10 s, pierde por abandono.
    if (online) return
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

    const enLinea = online ?? null
    const lado: Lado = enLinea?.lado ?? 0
    const personajes: [IdPersonaje, IdPersonaje] = enLinea ? enLinea.arranque.personajes : [jugador, rival]

    let partida: Partida
    let render: Renderizador
    try {
      partida = crearPartida({
        personajes,
        // Online los dos lados son personas: el motor no genera entradas para nadie.
        cpu: enLinea ? [false, false] : [false, true],
        dificultad: enLinea ? 'normal' : dificultad,
        arena,
        rondasParaGanar: RONDAS_PARA_GANAR,
        segundosPorRound: SEGUNDOS_POR_ROUND,
        animaciones: [metaDe(recursos, personajes[0]), metaDe(recursos, personajes[1])],
        semilla: enLinea ? enLinea.arranque.semilla : Math.floor(Math.random() * 0x7fffffff),
      })
      render = crearRenderizador(canvas, recursos, opcionesRender(calidad))
    } catch (e) {
      fallar(e)
      return
    }

    const entrada = crearCapturaEntrada()
    entradaRef.current = entrada
    const ficha = PERSONAJES[personajes[lado]]
    const hud = crearHud(raiz, { entrada, costos: [ficha.especiales[0].costo, ficha.especiales[1].costo] })

    // ─── Online: lockstep, vistas del lado propio y capas ──────────────────
    let lock: Lockstep | null = null
    if (enLinea) {
      lock = enLinea.duelo.crearLockstep(() => entrada.tomar())
      if (!lock) {
        render.destruir()
        fallar(new Error('el duelo ya no está en pelea'))
        return
      }
    }
    const vistaHud = enLinea ? vistaParaHud(partida, lado) : partida
    const vistaAudio = enLinea ? vistaParaAudio(partida, lado) : partida
    const capas = enLinea ? crearCapasOnline(raiz, { lado, personajes, arena }) : null
    let lienzo: Caja | null = null
    let lockCerrado = false
    let finOnline = false
    // Gancho de pruebas (sólo en desarrollo): el hash de CADA tick.
    const depuracion =
      enLinea && depuracionHabilitada()
        ? {
            lado,
            k: enLinea.arranque.k,
            demora: enLinea.arranque.demora,
            rtt: enLinea.arranque.rtt,
            semilla: enLinea.arranque.semilla,
            hashes: [] as number[],
            tickFin: 0,
            ganador: null as Lado | null,
            inicio: performance.now(),
            lock,
            duelo: enLinea.duelo,
          }
        : null
    if (depuracion) publicarDepuracion('online', depuracion)

    const pasoOnline = (p: Partida) => {
      if (!lock) return
      if (depuracion && !lockCerrado) depuracion.hashes[p.tick] = hashPartida(p)
      if (p.fase === 'terminada') {
        if (!lockCerrado) {
          lockCerrado = true
          lock.cerrar()
          // Desde acá manda el motor: un adiós o un «fin» durante el festejo no cambian el resultado.
          enLinea?.duelo.finDelMotor(finDeLaPartida(p))
          if (depuracion) {
            depuracion.tickFin = p.tick
            depuracion.ganador = p.ganadorPartida
          }
        }
        return
      }
      if (p.tick % CADA_HASH === 0) lock.registrarHash(p.tick, hashPartida(p))
    }

    const vigilarOnline = () => {
      if (!lock || !enLinea || finOnline || lockCerrado) return
      if (lock.desincronizadoEn !== null) {
        finOnline = true
        console.error('[juego] la pelea online se desincronizó en el tick', lock.desincronizadoEn)
        enLinea.duelo.desincronizada()
        return
      }
      // En cada cuadro mientras dure la espera: el duelo decide (sin red no reclama nada).
      if (lock.msEsperando() >= ABANDONO_MS) enLinea.duelo.abandonoDelRival()
    }

    const medir = () => {
      const ancho = raiz.clientWidth
      const alto = raiz.clientHeight
      if (ancho <= 0 || alto <= 0) return
      const d = calcularDisposicion(ancho, alto, leerInsets(sondaRef.current))
      aplicarDisposicion(raiz, d)
      lienzo = d.lienzo
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
      ...(lock
        ? {
            tomarEntradas: () => {
              // Después del final ya no hay nada en juego: el festejo corre sin esperar a nadie.
              if (partida.fase === 'terminada' || !lock) return VACIAS
              const n = partida.tick + 1
              lock.preparar(n)
              return lock.entradas(n)
            },
            ritmo: () => (lock ? lock.ritmo() : 1),
            alPaso: pasoOnline,
          }
        : {}),
      alCuadro: (p, eventos, dt) => {
        hud.actualizar(vistaHud, enLinea ? eventosParaHud(eventos, lado) : eventos, dt)
        audio.procesar(eventos, vistaAudio)
        if (!terminadaRef.current && eventos.some((e) => e.tipo === 'fin_partida')) {
          terminadaRef.current = true
          audio.musica(null)
        }
        if (capas && lock && enLinea) capas.actualizar(p, lock, lienzo, enLinea.duelo.estaConectado())
        vigilarOnline()
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

    // Online: con la página oculta ABANDONO_MS o más, el que se fue es este celular (el otro ya
    // reclamó, o va a reclamar, el abandono). Reloj de pared: el del sistema sigue con el
    // celular bloqueado, performance.now() en iOS puede no contar ese rato.
    let ocultaDesde: number | null = null
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        entrada.soltarTodo()
        pausarPorOcultar()
        if (enLinea && ocultaDesde === null) ocultaDesde = Date.now()
      } else if (enLinea && ocultaDesde !== null) {
        const fuera = Date.now() - ocultaDesde
        ocultaDesde = null
        if (fuera >= ABANDONO_MS) enLinea.duelo.rendirsePorAusencia()
      }
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)

    return () => {
      loop.detener()
      loopRef.current = null
      // El lockstep NO se cierra acá: lo cierra el duelo al cambiar de fase (y con StrictMode
      // el efecto se vuelve a montar enseguida y lo reusa).
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
  }, [jugador, rival, arena, dificultad, recursos, fuenteTitulo, fuenteNumeros, audio, online])

  // Pausa, tutorial, avisos y errores congelan la pelea (y sueltan lo que estaba apretado).
  useEffect(() => {
    const loop = loopRef.current
    if (!loop) return
    if (detenida) {
      loop.pausar()
      audio.musica(null)
    } else {
      loop.reanudar()
      if (!terminadaRef.current) audio.musica('pelea')
    }
  }, [detenida, audio])

  // Sin controles (pausa, avisos, el menú online): lo apretado se suelta y no llega nada más.
  useEffect(() => {
    detenidaRef.current = sinControles
    if (sinControles) {
      entradaRef.current?.soltarTodo()
      tactilesRef.current?.reiniciar()
    }
  }, [sinControles])

  const pedirPausa = () => {
    if (online) {
      if (error || terminadaRef.current) return
      audio.ui('atras')
      setMenuOnline(true)
      return
    }
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
      data-online={online ? '' : undefined}
      style={{ '--cf-acento': fichaJugador.color, '--cf-acento-2': fichaJugador.colorSecundario } as CSSProperties}
    >
      <div ref={sondaRef} className="cf-sonda" aria-hidden="true" />
      <div className="cf-pelea__lienzo">
        <canvas
          ref={canvasRef}
          className="cf-pelea__canvas"
          role="img"
          aria-label={`Pelea: ${fichasPorLado[0].nombre} contra ${fichasPorLado[1].nombre}`}
        />
        <div className="cf-pelea__marco" aria-hidden="true" />
      </div>
      <p className="cf-girar" aria-hidden="true">
        <Smartphone />
        Girá el celular: se ve más grande
      </p>

      {online ? (
        <HudOnline
          fichas={[fichasPorLado[0], fichasPorLado[1]]}
          nombres={online.nombres}
          lado={online.lado}
          rondasParaGanar={RONDAS_PARA_GANAR}
          segundos={SEGUNDOS_POR_ROUND}
          onMenu={pedirPausa}
        />
      ) : (
        <HudPelea
          fichas={[fichasPorLado[0], fichasPorLado[1]]}
          rondasParaGanar={RONDAS_PARA_GANAR}
          segundos={SEGUNDOS_POR_ROUND}
          onPausa={pedirPausa}
        />
      )}
      <ControlesPelea ficha={fichaJugador} />
      {online && <CapasOnline rival={nombreRival} />}

      {!online && pausa && !tutorial && !error && (
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
      {online && menuOnline && !error && (
        <MenuOnline
          rival={nombreRival}
          onSeguir={() => {
            audio.ui('confirmar')
            setMenuOnline(false)
          }}
          onAbandonar={() => {
            audio.ui('atras')
            setMenuOnline(false)
            onAbandonarOnline?.()
          }}
        />
      )}
      {tutorial && !error && <Tutorial tactil={tactil} onCerrar={cerrarTutorial} />}
      {superpuesto}
      {error &&
        (online ? (
          <ErrorPelea onSalir={() => onAbandonarOnline?.()} textoSalir="Volver a la sala" />
        ) : (
          <ErrorPelea onReintentar={onReiniciar} onSalir={onSalir} />
        ))}
    </div>
  )
}

function ErrorPelea({
  onReintentar,
  onSalir,
  textoSalir = 'Volver',
}: {
  onReintentar?: () => void
  onSalir: () => void
  textoSalir?: string
}) {
  return (
    <div className="cf-capa" role="alertdialog" aria-modal="true" aria-labelledby="cf-error-titulo">
      <div className="cf-pausa">
        <h2 id="cf-error-titulo" className="cf-titulo cf-pausa__titulo">
          Se cortó la pelea
        </h2>
        <p className="cf-texto-suave">
          {onReintentar
            ? 'Algo falló al arrancar o en el medio. Probá de nuevo; si sigue pasando, elegí otro barbero o arena.'
            : 'Algo falló en el medio de la pelea online. Volvé a la sala y desafiá de nuevo.'}
        </p>
        {onReintentar && (
          <button type="button" className="cf-btn cf-btn--grande" onClick={onReintentar} autoFocus>
            <RotateCcw aria-hidden="true" />
            <span>Reintentar</span>
          </button>
        )}
        <button type="button" className={onReintentar ? 'cf-btn cf-btn--sec' : 'cf-btn cf-btn--grande'} onClick={onSalir}>
          <LogOut aria-hidden="true" />
          <span>{textoSalir}</span>
        </button>
      </div>
    </div>
  )
}
