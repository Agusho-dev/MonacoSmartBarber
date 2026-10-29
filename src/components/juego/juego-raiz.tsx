'use client'

import { useEffect, useRef, useState } from 'react'
import { obtenerEstadisticasPersonajes } from '@/lib/actions/juego'
import { ARENAS, IDS_ARENAS } from '@/lib/juego/arenas'
import { IDS_PERSONAJES, PERSONAJES, rivalPorDefecto } from '@/lib/juego/personajes'
import type {
  DatosEntradaJuego,
  Dificultad,
  EstadisticaPersonaje,
  EstadoTurnoJuego,
  IdArena,
  IdPersonaje,
  RecursosJuego,
  TemaMusica,
} from '@/lib/juego/tipos'
import { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { esPantallaTactil, prefiereMenosMovimiento, useConsultaMedia, usePestanaVisible } from '@/lib/juego/ui/media'
import { pedirPantallaCompleta } from '@/lib/juego/ui/pantalla-completa'
import { estadoPrecarga, precargar, usePrecarga } from '@/lib/juego/ui/precarga'
import { guardarPreferencias, registrarPelea, usePreferencias } from '@/lib/juego/ui/preferencias'
import type { Eleccion, FuentesJuego, Pantalla, ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { LogoCorteFinal } from './logo-corte-final'
import { PantallaCarga } from './pantalla-carga'
import { PantallaInicio } from './pantalla-inicio'
import { PantallaPelea } from './pantalla-pelea'
import { PantallaRanking } from './pantalla-ranking'
import { PantallaResultado } from './pantalla-resultado'
import { PantallaSeleccion } from './pantalla-seleccion'
import { PantallaVs } from './pantalla-vs'
import { AvisoProximo, PantallaTeToca } from './turno'
import { Tutorial } from './tutorial'
import { useTurno, type AvisoTurno } from './use-turno'

/** Cortina diagonal entre pantallas: cierra, se cambia la pantalla tapada, abre. */
const CIERRE_MS = 300
const APERTURA_MS = 420
/** El «¡Sos el próximo!» se va solo después de esto. */
const AVISO_PROXIMO_MS = 7000

function personajeDelBarbero(staffId: string | null): IdPersonaje | null {
  if (!staffId) return null
  return IDS_PERSONAJES.find((id) => PERSONAJES[id].staffId === staffId) ?? null
}

function sinTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** La cara del «¡te toca!» sólo si el barbero que lo llama es el personaje de su barbero asignado. */
function fichaDelQueLlama(barbero: IdPersonaje | null, nombre: string | null) {
  if (!barbero) return null
  const ficha = PERSONAJES[barbero]
  if (nombre && sinTildes(nombre) !== sinTildes(ficha.nombre)) return null
  return ficha
}

function arenaJugable(id: IdArena): IdArena {
  if (ARENAS[id]?.imagen) return id
  return IDS_ARENAS.find((a) => ARENAS[a].imagen !== null) ?? id
}

/**
 * Raíz del juego: la máquina de pantallas (Inicio → Elegí tu barbero → VS → Pelea →
 * Resultado → Ranking), el audio, la precarga, el turno y las preferencias.
 */
export function JuegoRaiz({ datos, fuentes }: { datos: DatosEntradaJuego; fuentes: FuentesJuego }) {
  const prefs = usePreferencias()
  const visible = usePestanaVisible()
  const tactil = useConsultaMedia('(any-pointer: coarse)')
  const [audio] = useState(() => new AudioSeguro())

  const [pantalla, setPantalla] = useState<Pantalla>('inicio')
  const [cortina, setCortina] = useState<'cerrando' | 'abriendo' | null>(null)
  const [eleccionUsuario, setEleccionUsuario] = useState<{ jugador?: IdPersonaje; arena?: IdArena }>({})
  const [recursosPelea, setRecursosPelea] = useState<RecursosJuego | null>(null)
  const [idPelea, setIdPelea] = useState(0)
  const [resultado, setResultado] = useState<ResultadoPelea | null>(null)
  const [volverDelRanking, setVolverDelRanking] = useState<Pantalla>('inicio')
  const [verTutorial, setVerTutorial] = useState(false)
  const [avisoProximo, setAvisoProximo] = useState(false)
  const [teToca, setTeToca] = useState<EstadoTurnoJuego | null>(null)
  const [stats, setStats] = useState<EstadisticaPersonaje[] | null>(null)
  const [ultimoGuardado, setUltimoGuardado] = useState<{ apodo: string; puntaje: number } | null>(null)
  const [toast, setToast] = useState<{ texto: string; n: number } | null>(null)

  const raizRef = useRef<HTMLDivElement>(null)
  const faseCortina = useRef<'cerrando' | 'abriendo' | null>(null)
  const destino = useRef<{ pantalla: Pantalla; alCambiar?: () => void } | null>(null)
  const timers = useRef<number[]>([])

  // La elección se DERIVA: las preferencias llegan después de hidratar y el barbero del QR manda.
  const barbero = personajeDelBarbero(datos.barberoAsignado)
  const jugador =
    eleccionUsuario.jugador ?? (barbero ? rivalPorDefecto(barbero) : (prefs.ultimoPersonaje ?? IDS_PERSONAJES[0]))
  const rival = barbero && barbero !== jugador ? barbero : rivalPorDefecto(jugador)
  const arena = arenaJugable(eleccionUsuario.arena ?? datos.arenaInicial)
  const eleccion: Eleccion = { jugador, rival, arena, dificultad: prefs.dificultad }
  const rivalEsBarbero = barbero !== null && rival === barbero
  // Se precarga desde el inicio, en segundo plano: el VS casi nunca espera.
  const precarga = usePrecarga(jugador, rival, arena)

  const alAvisoTurno = (aviso: AvisoTurno, estado: EstadoTurnoJuego) => {
    if (aviso === 'proximo') {
      setAvisoProximo(true)
      vibrar([120, 80, 120], true)
      audio.ui('confirmar')
    } else {
      setAvisoProximo(false)
      setTeToca(estado)
      vibrar([300, 120, 300, 120, 300], true)
      audio.ui('vs')
    }
  }
  const turno = useTurno(datos.token, alAvisoTurno)

  // Mientras el juego está montado: sin rebote de scroll ni pull-to-refresh ni zoom con gesto.
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('cf-html')
    const sinGesto = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', sinGesto)
    // Un toque largo sobre un retrato no abre «guardar imagen» (salvo en el campo del apodo).
    const raiz = raizRef.current
    const sinMenu = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault()
    }
    raiz?.addEventListener('contextmenu', sinMenu)
    const lista = timers.current
    return () => {
      html.classList.remove('cf-html')
      document.removeEventListener('gesturestart', sinGesto)
      raiz?.removeEventListener('contextmenu', sinMenu)
      lista.forEach((t) => window.clearTimeout(t))
      lista.length = 0
    }
  }, [])

  useEffect(() => {
    obtenerEstadisticasPersonajes()
      .then((r) => {
        if (r.ok) setStats(r.datos)
      })
      .catch(() => {
        // Sin estadísticas la ficha dice «estrenalo»: no es grave.
      })
  }, [])

  useEffect(() => {
    audio.configurar(prefs.sonido, prefs.musica)
  }, [audio, prefs.sonido, prefs.musica])

  useEffect(() => () => audio.destruir(), [audio])

  // Música por pantalla (la pelea maneja la suya). Con la pestaña oculta o el «te toca», silencio.
  const temaPantalla: TemaMusica | null | undefined =
    pantalla === 'pelea'
      ? undefined
      : pantalla === 'vs' || pantalla === 'carga'
        ? null
        : pantalla === 'resultado'
          ? resultado?.gano
            ? 'victoria'
            : 'derrota'
          : 'menu'
  useEffect(() => {
    if (temaPantalla === undefined) return
    audio.musica(visible && !teToca ? temaPantalla : null)
  }, [audio, temaPantalla, visible, teToca])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!avisoProximo) return
    const t = window.setTimeout(() => setAvisoProximo(false), AVISO_PROXIMO_MS)
    return () => window.clearTimeout(t)
  }, [avisoProximo])

  // ─── Transiciones ────────────────────────────────────────────────────────
  const limpiarTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current.length = 0
  }

  const irA = (siguiente: Pantalla, alCambiar?: () => void) => {
    if (faseCortina.current === 'cerrando') {
      // Ya se está tapando: cambia el destino, sin arrancar otra cortina.
      destino.current = { pantalla: siguiente, alCambiar }
      return
    }
    limpiarTimers()
    if (prefiereMenosMovimiento()) {
      faseCortina.current = null
      setCortina(null)
      alCambiar?.()
      setPantalla(siguiente)
      return
    }
    destino.current = { pantalla: siguiente, alCambiar }
    faseCortina.current = 'cerrando'
    setCortina('cerrando')
    timers.current.push(
      window.setTimeout(() => {
        const d = destino.current ?? { pantalla: siguiente, alCambiar }
        destino.current = null
        d.alCambiar?.()
        setPantalla(d.pantalla)
        faseCortina.current = 'abriendo'
        setCortina('abriendo')
        timers.current.push(
          window.setTimeout(() => {
            faseCortina.current = null
            setCortina(null)
          }, APERTURA_MS),
        )
      }, CIERRE_MS),
    )
  }

  // ─── Acciones de las pantallas ───────────────────────────────────────────
  const jugar = () => {
    if (verTutorial || teToca) return
    audio.desbloquear()
    audio.ui('confirmar')
    if (prefs.pantallaCompleta && esPantallaTactil()) void pedirPantallaCompleta()
    irA('seleccion')
  }

  const elegirPersonaje = (id: IdPersonaje) => {
    if (id === jugador) return
    audio.ui('elegir')
    vibrar(10)
    setEleccionUsuario((e) => ({ ...e, jugador: id }))
    guardarPreferencias({ ultimoPersonaje: id })
  }

  const elegirArena = (id: IdArena) => {
    audio.ui('tocar')
    setEleccionUsuario((e) => ({ ...e, arena: id }))
  }

  const elegirDificultad = (d: Dificultad) => {
    audio.ui('tocar')
    guardarPreferencias({ dificultad: d })
  }

  const empezarPelea = (recursos: RecursosJuego) => {
    irA('pelea', () => {
      setRecursosPelea(recursos)
      setIdPelea((n) => n + 1)
    })
  }

  const pelear = () => {
    audio.desbloquear()
    audio.ui('confirmar')
    precargar(jugador, rival, arena)
    irA('vs')
  }

  const alTerminarVs = () => {
    const e = estadoPrecarga(jugador, rival, arena)
    if (e.estado === 'listo' && e.recursos) empezarPelea(e.recursos)
    else irA('carga')
  }

  const terminarPelea = (r: ResultadoPelea) => {
    const mejorAnterior = registrarPelea(r.eleccion.jugador, r.gano, r.desglose.total)
    irA('resultado', () => setResultado({ ...r, mejorAnterior }))
  }

  const revancha = () => {
    audio.ui('confirmar')
    if (!recursosPelea) {
      irA('vs')
      return
    }
    irA('pelea', () => setIdPelea((n) => n + 1))
  }

  const verRanking = () => {
    audio.ui('tocar')
    setVolverDelRanking(pantalla === 'ranking' ? 'inicio' : pantalla)
    irA('ranking')
  }

  const cerrarTutorialInicio = () => {
    guardarPreferencias({ tutorialVisto: true })
    audio.ui('confirmar')
    setVerTutorial(false)
  }

  return (
    <div ref={raizRef} className="cf-juego" data-pantalla={pantalla}>
      {pantalla === 'inicio' && (
        <PantallaInicio
          datos={datos}
          turno={turno}
          prefs={prefs}
          onJugar={jugar}
          onRanking={() => {
            audio.desbloquear()
            verRanking()
          }}
          onComoSeJuega={() => {
            audio.desbloquear()
            audio.ui('tocar')
            setVerTutorial(true)
          }}
          onSonido={() => {
            audio.desbloquear()
            guardarPreferencias({ sonido: !prefs.sonido })
          }}
        />
      )}

      {pantalla === 'seleccion' && (
        <PantallaSeleccion
          eleccion={eleccion}
          datos={datos}
          barbero={barbero}
          stats={stats}
          prefs={prefs}
          turno={turno}
          onElegirPersonaje={elegirPersonaje}
          onElegirArena={elegirArena}
          onElegirDificultad={elegirDificultad}
          onBloqueado={(nombre) => {
            audio.ui('error')
            vibrar([10, 30, 10])
            setToast((t) => ({ texto: `${nombre} todavía está entrenando. Muy pronto.`, n: (t?.n ?? 0) + 1 }))
          }}
          onVolver={() => {
            audio.ui('atras')
            irA('inicio')
          }}
          onPelear={pelear}
        />
      )}

      {pantalla === 'vs' && (
        <PantallaVs eleccion={eleccion} rivalEsBarbero={rivalEsBarbero} audio={audio} onListo={alTerminarVs} />
      )}

      {(pantalla === 'carga' || (pantalla === 'pelea' && !recursosPelea)) && (
        <PantallaCarga
          precarga={precarga}
          eleccion={eleccion}
          onListo={empezarPelea}
          onReintentar={() => {
            audio.ui('confirmar')
            precargar(jugador, rival, arena)
          }}
          onVolver={() => {
            audio.ui('atras')
            irA('seleccion')
          }}
        />
      )}

      {pantalla === 'pelea' && recursosPelea && (
        <PantallaPelea
          key={idPelea}
          eleccion={eleccion}
          recursos={recursosPelea}
          fuentes={fuentes}
          audio={audio}
          prefs={prefs}
          turno={turno}
          bloqueada={teToca !== null}
          onTerminar={terminarPelea}
          onReiniciar={() => irA('pelea', () => setIdPelea((n) => n + 1))}
          onSalir={() => irA('seleccion')}
        />
      )}

      {pantalla === 'resultado' && resultado && (
        <PantallaResultado
          key={resultado.id}
          resultado={resultado}
          datos={datos}
          prefs={prefs}
          audio={audio}
          turno={turno}
          onRevancha={revancha}
          onCambiarBarbero={() => {
            audio.ui('atras')
            irA('seleccion')
          }}
          onRanking={verRanking}
          onGuardado={(apodo, puntaje) => setUltimoGuardado({ apodo, puntaje })}
        />
      )}

      {pantalla === 'ranking' && (
        <PantallaRanking
          datos={datos}
          audio={audio}
          turno={turno}
          resaltado={ultimoGuardado}
          onVolver={() => {
            audio.ui('atras')
            irA(volverDelRanking)
          }}
        />
      )}

      {toast && (
        <div key={toast.n} className="cf-toast" role="status">
          {toast.texto}
        </div>
      )}

      {verTutorial && <Tutorial tactil={tactil} onCerrar={cerrarTutorialInicio} />}

      {avisoProximo && !teToca && <AvisoProximo onCerrar={() => setAvisoProximo(false)} />}

      {teToca && (
        <PantallaTeToca
          nombreCliente={datos.cliente?.nombre ?? null}
          nombreBarbero={teToca.barbero ?? (barbero ? PERSONAJES[barbero].nombre : null)}
          ficha={fichaDelQueLlama(barbero, teToca.barbero)}
          onCerrar={() => {
            audio.ui('confirmar')
            setTeToca(null)
          }}
        />
      )}

      {cortina && (
        <div className="cf-cortina" data-fase={cortina} aria-hidden="true">
          <span className="cf-cortina__filo" />
          <LogoCorteFinal className="cf-cortina__logo" />
        </div>
      )}
    </div>
  )
}
