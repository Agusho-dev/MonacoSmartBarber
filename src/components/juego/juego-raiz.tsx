'use client'

import '@/app/juego/sala.css'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { guardarPartidaJuego, obtenerEstadisticasPersonajes } from '@/lib/actions/juego'
import { ARENAS, IDS_ARENAS } from '@/lib/juego/arenas'
import { Duelo, type EstadoDuelo } from '@/lib/juego/online/duelo'
import { sanearNombre, versionJuego, type EstadoJugador } from '@/lib/juego/online/protocolo'
import { marcadorCon, registrarResultadoOnline, useRegistroOnline } from '@/lib/juego/online/registro'
import type { Emparejamiento } from '@/lib/juego/online/sala'
import { textoCierre } from '@/lib/juego/online/textos'
import { abrirTransportePelea } from '@/lib/juego/online/transporte'
import { reintentarPendientes } from '@/lib/juego/pendientes'
import { PERSONAJES } from '@/lib/juego/personajes'
import { createClient } from '@/lib/supabase/client'
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
import { jugadorSugerido, personajeDelBarbero, rivalSugerido } from '@/lib/juego/ui/plantel'
import { estadoPrecarga, precargar, usePrecarga } from '@/lib/juego/ui/precarga'
import { guardarPreferencias, registrarPelea, usePreferencias } from '@/lib/juego/ui/preferencias'
import type { PeleaDePrueba } from '@/lib/juego/ui/prueba'
import type { Eleccion, FuentesJuego, Pantalla, ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { RecursosFaltantes } from './imagen-juego'
import { LogoCorteFinal } from './logo-corte-final'
import { PantallaCarga } from './pantalla-carga'
import { PantallaInicio } from './pantalla-inicio'
import { PantallaPelea, type PeleaOnline } from './pantalla-pelea'
import { PantallaRanking } from './pantalla-ranking'
import { PantallaResultado } from './pantalla-resultado'
import { PantallaSeleccion } from './pantalla-seleccion'
import { PantallaVs } from './pantalla-vs'
import { AvisoLlegada, ChipSala } from './sala/avisos-sala'
import { DesafioEntrante } from './sala/desafio-entrante'
import { EleccionOnline } from './sala/eleccion-online'
import { PantallaSala } from './sala/pantalla-sala'
import { ResultadoOnline } from './sala/resultado-online'
import { useDuelo, useSala } from './sala/use-online'
import { AvisoProximo, PantallaTeToca } from './turno'
import { Tutorial } from './tutorial'
import { useTurno, type AvisoTurno } from './use-turno'

/** Cortina diagonal entre pantallas: cierra, se cambia la pantalla tapada, abre. */
const CIERRE_MS = 300
const APERTURA_MS = 420
/** El «¡Sos el próximo!» se va solo después de esto. */
const AVISO_PROXIMO_MS = 7000
/** Un aviso corto de la sala («Juan canceló el desafío»). */
const AVISO_SALA_MS = 2800

/** Lo que el jugador tocó en la selección (lo que falta se deriva del QR y de la sucursal). */
interface EleccionUsuario {
  jugador?: IdPersonaje
  rival?: IdPersonaje
  arena?: IdArena
  /** Sólo la del atajo de pruebas: la que el jugador elige va a las preferencias. */
  dificultad?: Dificultad
}

/** Las pantallas de siempre más las de la sala y las peleas online. */
type PantallaRaiz = Pantalla | 'sala' | 'online-eleccion' | 'online-vs' | 'online-pelea' | 'online-resultado'

/** Con la pelea contra la CPU ya decidida: recién ahí se bajan los atlas de los dos. */
const PANTALLAS_CON_PELEA: readonly PantallaRaiz[] = ['vs', 'carga', 'pelea', 'resultado']

/** Dónde se avisa que llegó alguien a la sala (en la pelea contra la CPU, sólo el chip chico). */
const CON_AVISO_DE_SALA: readonly PantallaRaiz[] = ['inicio', 'seleccion', 'resultado']

function sinTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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
 * Lo que la sala muestra de cada uno según la fase del duelo. En el resultado (revancha o no)
 * sigue en el duelo y no recibe desafíos: figura peleando hasta que vuelve a la sala (antes
 * figuraba «Libre para pelear» y a quien lo desafiaba le contestaba «Está ocupado»). En la
 * revancha (k ≥ 2) no vuelve a «eligiendo»: cada cambio es una presencia, y el servidor cierra
 * la sala al que publica más de 5 en 30 s (ver sala.ts).
 */
function estadoEnSala(fase: EstadoDuelo['fase'] | undefined, k: number): EstadoJugador {
  if (fase === 'peleando' || fase === 'resultado') return 'peleando'
  if (fase === 'conectando' || fase === 'eligiendo' || fase === 'preparando') return k > 1 ? 'peleando' : 'eligiendo'
  return 'libre'
}

/** Aviso corto de la sala que se va solo. */
function AvisoCortoSala({ texto, onCerrar }: { texto: string; onCerrar: () => void }) {
  const cerrar = useEffectEvent(onCerrar)
  useEffect(() => {
    const t = window.setTimeout(() => cerrar(), AVISO_SALA_MS)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className="cf-toast cf-toast--sala" role="status">
      {texto}
    </div>
  )
}

/**
 * Raíz del juego: la máquina de pantallas (Inicio → Elegí tu barbero → VS → Pelea →
 * Resultado → Ranking), el audio, la precarga, el turno y las preferencias. Con sucursal,
 * además, la SALA: quién más tiene el juego abierto en el local, los desafíos y las peleas
 * online entre ellos (src/lib/juego/online).
 */
export function JuegoRaiz({
  datos,
  fuentes,
  prueba = null,
  faltantes,
}: {
  datos: DatosEntradaJuego
  fuentes: FuentesJuego
  /** SÓLO en desarrollo (`?prueba=a,b[,arena[,dificultad]]`): directo a una pelea contra la CPU. */
  prueba?: PeleaDePrueba | null
  /** SÓLO en desarrollo: retratos y caras que todavía no existen (ver recursos-faltantes.ts). */
  faltantes?: string[]
}) {
  const [recursosFaltantes] = useState<ReadonlySet<string>>(() => new Set(faltantes ?? []))
  const prefs = usePreferencias()
  const visible = usePestanaVisible()
  const tactil = useConsultaMedia('(any-pointer: coarse)')
  const registroOnline = useRegistroOnline()
  const [audio] = useState(() => new AudioSeguro())

  const [pantalla, setPantalla] = useState<PantallaRaiz>(() => (prueba ? 'carga' : 'inicio'))
  const [cortina, setCortina] = useState<'cerrando' | 'abriendo' | null>(null)
  const [eleccionUsuario, setEleccionUsuario] = useState<EleccionUsuario>(() =>
    prueba
      ? {
          jugador: prueba.jugador,
          rival: prueba.rival,
          arena: prueba.arena ?? undefined,
          dificultad: prueba.dificultad ?? undefined,
        }
      : {},
  )
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

  // ─── Sala y duelo online ─────────────────────────────────────────────────
  const { sala, estado: estadoSala } = useSala(datos.sucursal?.slug ?? null)
  const [duelo, setDuelo] = useState<Duelo | null>(null)
  const estadoDuelo = useDuelo(duelo)
  /** El MISMO objeto durante toda una pelea online (la pantalla de pelea depende de él). */
  const [peleaOnline, setPeleaOnline] = useState<PeleaOnline | null>(null)
  /**
   * El número de pelea (k) cuyo VS ya se vio. Por número y no un sí/no: en la revancha, la fase
   * nueva del duelo llega por useSyncExternalStore (render síncrono) y un «false» puesto en el
   * mismo evento llega en otro render, así que el efecto veía el «sí» de la pelea anterior y
   * marcaba «listo» sin mostrar el VS.
   */
  const [vsOnlineVisto, setVsOnlineVisto] = useState(0)
  const [volverDeSala, setVolverDeSala] = useState<PantallaRaiz>('inicio')

  const raizRef = useRef<HTMLDivElement>(null)
  /** Adónde ir cuando se cierra el duelo (el «¡te toca!» manda al inicio, no a la sala). */
  const destinoTrasDuelo = useRef<PantallaRaiz | null>(null)
  const faseCortina = useRef<'cerrando' | 'abriendo' | null>(null)
  const destino = useRef<{ pantalla: PantallaRaiz; alCambiar?: () => void } | null>(null)
  const timers = useRef<number[]>([])

  // La elección se DERIVA: las preferencias llegan después de hidratar y el barbero del QR manda.
  // Lo que el jugador tocó gana; lo que no tocó sale de su barbero y de su sucursal (plantel.ts).
  const barbero = personajeDelBarbero(datos.barberoAsignado)
  const contextoPlantel = { barbero, sucursal: datos.sucursal?.slug ?? null }
  const jugador = eleccionUsuario.jugador ?? jugadorSugerido(prefs.ultimoPersonaje, contextoPlantel)
  const rival = eleccionUsuario.rival ?? rivalSugerido(jugador, contextoPlantel)
  const arena = arenaJugable(eleccionUsuario.arena ?? datos.arenaInicial)
  const eleccion: Eleccion = { jugador, rival, arena, dificultad: eleccionUsuario.dificultad ?? prefs.dificultad }
  const rivalEsBarbero = barbero !== null && rival === barbero

  // Online la arena es la de la sucursal (la misma para los dos: están en la misma sala).
  const arenaOnline = arenaJugable(datos.arenaInicial)
  const nombreSucursal = datos.sucursal?.nombre ?? ''
  const miNombre =
    sanearNombre(datos.cliente?.nombre) ??
    sanearNombre(prefs.apodo) ??
    (registroOnline.numero > 0 ? `Jugador ${registroOnline.numero}` : 'Jugador')
  const personajesOnline = estadoDuelo?.personajes ?? null

  // Sólo se bajan los atlas de la pelea que va a empezar (ver precarga.ts): desde el VS (o la
  // carga, o la pelea misma) contra la CPU, y online cuando los dos ya eligieron. En el inicio
  // y la selección, nada: recorrer las 13 caras no gasta datos del celular.
  const peleaDecidida = personajesOnline !== null || PANTALLAS_CON_PELEA.includes(pantalla)
  const precarga = usePrecarga(
    personajesOnline ? personajesOnline[0] : jugador,
    personajesOnline ? personajesOnline[1] : rival,
    personajesOnline ? arenaOnline : arena,
    peleaDecidida,
  )

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
      // Una pelea online termina: el otro gana por abandono («Juan fue llamado a cortarse»).
      if (duelo) {
        destinoTrasDuelo.current = 'inicio'
        duelo.salir('turno')
      }
      // Un desafío que mandé y todavía espera: que el otro no lo acepte en el vacío.
      sala?.cancelarDesafio()
    }
  }
  const turno = useTurno(datos.token, alAvisoTurno)

  // Partidas que el servidor frenó por el tope (src/lib/juego/pendientes.ts): se reintentan al
  // volver al inicio y al abrir la página. Sin cola o con la espera vigente no hace nada (ni
  // llama al servidor), y nunca manda dos veces: si hay una vuelta en marcha, devuelve ésa.
  useEffect(() => {
    if (pantalla === 'inicio') void reintentarPendientes(guardarPartidaJuego)
  }, [pantalla])

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
    pantalla === 'pelea' || pantalla === 'online-pelea'
      ? undefined
      : pantalla === 'vs' || pantalla === 'carga' || pantalla === 'online-vs'
        ? null
        : pantalla === 'resultado'
          ? resultado?.gano
            ? 'victoria'
            : 'derrota'
          : pantalla === 'online-resultado'
            ? estadoDuelo?.resultado?.ganador === 'yo'
              ? 'victoria'
              : estadoDuelo?.resultado?.ganador === 'rival'
                ? 'derrota'
                : 'menu'
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

  // La sala sabe cómo me llamo, si puedo recibir desafíos y en qué ando.
  useEffect(() => {
    sala?.setNombre(miNombre)
  }, [sala, miNombre])
  useEffect(() => {
    sala?.setDisponible(duelo === null && teToca === null)
  }, [sala, duelo, teToca])
  // Con el «¡te toca!» encima ya no está esperando: sale de la sala (los demás lo ven irse) y,
  // si un duelo se armó justo en ese instante, termina («Juan fue llamado a cortarse»).
  // Al cerrar el aviso vuelve a entrar.
  useEffect(() => {
    if (!sala) return
    if (teToca) {
      sala.setDisponible(false)
      sala.cancelarDesafio()
      sala.desconectar()
    } else sala.conectar()
  }, [sala, teToca])
  useEffect(() => {
    if (!teToca || !duelo) return
    destinoTrasDuelo.current = 'inicio'
    duelo.salir('turno')
  }, [teToca, duelo])
  const faseDuelo = estadoDuelo?.fase
  const kDuelo = estadoDuelo?.k ?? 1
  useEffect(() => {
    sala?.setEstado(estadoEnSala(faseDuelo, kDuelo))
  }, [sala, faseDuelo, kDuelo])

  // Una llegada que se ve en la lista (o que llega en pleno duelo) ya no se anuncia después.
  const nLlegada = estadoSala?.llegada?.n ?? 0
  const llegadaVisible = pantalla === 'sala' || duelo !== null
  useEffect(() => {
    if (nLlegada > 0 && llegadaVisible) sala?.descartarLlegada()
  }, [sala, nLlegada, llegadaVisible])

  // Online: recursos cargados + VS de ESTA pelea visto → listo para arrancar.
  const precargaLista = precarga.estado === 'listo'
  const vsVisto = estadoDuelo !== null && vsOnlineVisto === estadoDuelo.k
  useEffect(() => {
    if (duelo && faseDuelo === 'preparando' && vsVisto && precargaLista) duelo.marcarListo()
  }, [duelo, faseDuelo, vsVisto, precargaLista])

  // ─── Transiciones ────────────────────────────────────────────────────────
  const limpiarTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current.length = 0
  }

  const irA = (siguiente: PantallaRaiz, alCambiar?: () => void) => {
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

  // ─── Duelo online ────────────────────────────────────────────────────────

  const mostrarToast = (texto: string) => setToast((t) => ({ texto, n: (t?.n ?? 0) + 1 }))

  const terminarDuelo = (d: Duelo, e: EstadoDuelo) => {
    const texto = textoCierre(e)
    d.destruir()
    setDuelo((actual) => (actual === d ? null : actual))
    setPeleaOnline(null)
    setVsOnlineVisto(0)
    const destinoFinal = destinoTrasDuelo.current ?? (teToca ? 'inicio' : 'sala')
    destinoTrasDuelo.current = null
    irA(destinoFinal)
    if (texto) mostrarToast(texto)
  }

  /** Cada cambio de fase del duelo lleva a su pantalla. */
  const alFaseDuelo = useEffectEvent((d: Duelo, e: EstadoDuelo) => {
    if (d !== duelo) return
    switch (e.fase) {
      case 'eligiendo':
        if (pantalla !== 'online-eleccion') irA('online-eleccion')
        break
      case 'preparando':
        setPeleaOnline(null)
        if (e.personajes) precargar(e.personajes[0], e.personajes[1], arenaOnline)
        irA('online-vs')
        break
      case 'peleando': {
        const a = e.arranque
        const recursos = a ? estadoPrecarga(a.personajes[0], a.personajes[1], arenaOnline).recursos : null
        if (!a || !recursos) {
          d.salir('abandono')
          return
        }
        const nombres: [string, string] = e.lado === 0 ? [e.yo.nombre, e.rival.nombre] : [e.rival.nombre, e.yo.nombre]
        const online: PeleaOnline = { duelo: d, lado: e.lado, arranque: a, nombres }
        irA('online-pelea', () => {
          setRecursosPelea(recursos)
          setPeleaOnline(online)
          setIdPelea((n) => n + 1)
        })
        break
      }
      case 'resultado':
        irA('online-resultado')
        break
      case 'cerrado':
        terminarDuelo(d, e)
        break
      default:
        break
    }
  })

  useEffect(() => {
    if (!duelo) return
    let fase = duelo.leer().fase
    return duelo.suscribir(() => {
      const e = duelo.leer()
      if (e.fase === fase) return
      fase = e.fase
      alFaseDuelo(duelo, e)
    })
  }, [duelo])

  // Cerrar o recargar la página en pleno duelo: el otro se entera ya (si no, a los 10 s).
  useEffect(() => {
    if (!duelo) return
    const alIrse = (e: PageTransitionEvent) => {
      if (!e.persisted) duelo.salir('cerro')
    }
    window.addEventListener('pagehide', alIrse)
    return () => window.removeEventListener('pagehide', alIrse)
  }, [duelo])

  // Si la raíz se desmonta con un duelo vivo (el error de /juego la reemplaza, otra ruta): que no
  // quede el canal abierto ni el latido mandando «estado» cada segundo a un rival que espera.
  // Al terminar un duelo normal es un no-op (ya está cerrado). El cierre se difiere un instante y
  // sólo ocurre si el efecto no volvió a montarse: el Fast Refresh de desarrollo vuelve a correr
  // los efectos sin desmontar nada, y sin esto cada edición de este archivo mataba el duelo.
  const dueloMontado = useRef<Duelo | null>(null)
  useEffect(() => {
    if (!duelo) return
    dueloMontado.current = duelo
    return () => {
      dueloMontado.current = null
      window.setTimeout(() => {
        if (dueloMontado.current === duelo) return
        duelo.salir('cerro')
        duelo.destruir()
      }, 0)
    }
  }, [duelo])

  const alEmparejar = useEffectEvent((e: Emparejamiento) => {
    if (duelo || !sala || teToca) return
    // Desde ya no se reciben más desafíos (el estado de React llega en el próximo render).
    sala.setDisponible(false)
    const yo = sala.leer().yo
    let d: Duelo | null = null
    const transporte = abrirTransportePelea(createClient(), e.peleaId, (crudo) => d?.recibir(crudo))
    const rivalId = e.rival.id
    d = new Duelo({
      peleaId: e.peleaId,
      lado: e.lado,
      yo: { id: yo.id, nombre: miNombre },
      rival: e.rival,
      arena: arenaOnline,
      personajeInicial: prefs.ultimoPersonaje ?? jugador,
      version: versionJuego(),
      transporte,
      marcador: marcadorCon(rivalId),
      alResultado: (ahora, antes) => registrarResultadoOnline(rivalId, ahora, antes),
    })
    setDuelo(d)
    audio.desbloquear()
    audio.ui('confirmar')
    vibrar(30)
    irA('online-eleccion')
  })

  const alCanceladoEmparejamiento = useEffectEvent((peleaId: string) => {
    if (!duelo || duelo.peleaId !== peleaId) return
    mostrarToast(`${duelo.leer().rival.nombre} canceló el desafío`)
    duelo.salir('salir')
  })

  useEffect(() => {
    if (!sala) return
    return sala.escuchar({
      emparejar: (e) => alEmparejar(e),
      cancelado: (p) => alCanceladoEmparejamiento(p),
    })
  }, [sala])

  const abrirSala = () => {
    audio.desbloquear()
    audio.ui('tocar')
    sala?.descartarLlegada()
    if (pantalla !== 'sala') setVolverDeSala(pantalla)
    irA('sala')
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

  const elegirRival = (id: IdPersonaje) => {
    if (id === rival) return
    audio.ui('elegir')
    vibrar(10)
    setEleccionUsuario((e) => ({ ...e, rival: id }))
  }

  const elegirArena = (id: IdArena) => {
    audio.ui('tocar')
    setEleccionUsuario((e) => ({ ...e, arena: id }))
  }

  const elegirDificultad = (d: Dificultad) => {
    audio.ui('tocar')
    setEleccionUsuario((e) => (e.dificultad ? { ...e, dificultad: undefined } : e))
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
    setVolverDelRanking(pantalla === 'ranking' ? 'inicio' : (pantalla as Pantalla))
    irA('ranking')
  }

  const cerrarTutorialInicio = () => {
    guardarPreferencias({ tutorialVisto: true })
    audio.ui('confirmar')
    setVerTutorial(false)
  }

  const alBloqueado = (nombre: string) => {
    audio.ui('error')
    vibrar([10, 30, 10])
    mostrarToast(`${nombre} todavía está entrenando. Muy pronto.`)
  }

  const salirDelDuelo = () => {
    audio.ui('atras')
    duelo?.salir('salir')
  }

  // ─── Sala: chip, aviso de llegada y desafío entrante ─────────────────────
  const chipSala =
    sala && estadoSala ? <ChipSala estado={estadoSala} sucursal={nombreSucursal} onAbrir={abrirSala} /> : null
  const hayLibres = !!estadoSala?.otros.some((j) => j.compatible && j.estado === 'libre')
  const llegada =
    estadoSala?.llegada && hayLibres && !duelo && !teToca && CON_AVISO_DE_SALA.includes(pantalla) ? estadoSala.llegada : null
  const entrante = estadoSala?.entrante && !duelo && !teToca ? estadoSala.entrante : null
  // En plena pelea contra la CPU, el desafío es un cartel adentro de la pelea (debajo del HUD).
  const enPeleaCpu = pantalla === 'pelea' && recursosPelea !== null
  const desafioEntrante = entrante ? (
    <DesafioEntrante
      key={entrante.d}
      nombre={entrante.de.nombre}
      banner={enPeleaCpu}
      audio={audio}
      onAceptar={() => {
        audio.desbloquear()
        sala?.aceptar()
      }}
      onRechazar={() => {
        audio.ui('atras')
        sala?.rechazar('no')
      }}
    />
  ) : null
  // Con un desafío encima, el «¡Hay alguien para pelear!» espera (no se pisan).
  const llegadaVisibleAhora = entrante ? null : llegada

  return (
    <RecursosFaltantes value={recursosFaltantes}>
      <div ref={raizRef} className="cf-juego" data-pantalla={pantalla}>
        {pantalla === 'inicio' && (
          <PantallaInicio
            datos={datos}
            luchadores={[jugador, rival]}
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
              // Primero la preferencia nueva y después destrabar: si este es el primer toque y es
              // para silenciar, el contexto nace ya con la sesión de iOS en 'ambient' (sin pasar por
              // 'playback', que cortaría la música de otra app). El botón lleva data-audio-propio.
              const sonido = !prefs.sonido
              audio.configurar(sonido, prefs.musica)
              guardarPreferencias({ sonido })
              audio.desbloquear()
            }}
          />
        )}
        {pantalla === 'inicio' && chipSala && !llegadaVisibleAhora && <div className="cf-sala-flotante">{chipSala}</div>}

        {pantalla === 'seleccion' && (
          <PantallaSeleccion
            eleccion={eleccion}
            datos={datos}
            barbero={barbero}
            stats={stats}
            prefs={prefs}
            turno={turno}
            onElegirPersonaje={elegirPersonaje}
            onElegirRival={elegirRival}
            onElegirArena={elegirArena}
            onElegirDificultad={elegirDificultad}
            onBloqueado={alBloqueado}
            onVolver={() => {
              audio.ui('atras')
              irA('inicio')
            }}
            onPelear={pelear}
            onTocar={() => audio.ui('tocar')}
            sala={chipSala}
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
            sinTutorial={prueba !== null}
            onTerminar={terminarPelea}
            onReiniciar={() => irA('pelea', () => setIdPelea((n) => n + 1))}
            onSalir={() => irA('seleccion')}
            superpuesto={
              <>
                {estadoSala && estadoSala.otros.length > 0 && (
                  <div className="cf-sala-flotante cf-sala-flotante--pelea">
                    <ChipSala estado={estadoSala} sucursal={nombreSucursal} chico />
                  </div>
                )}
                {desafioEntrante}
              </>
            }
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
            sala={chipSala}
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

        {pantalla === 'sala' && (
          <PantallaSala
            estado={estadoSala}
            sucursal={nombreSucursal}
            fondo={ARENAS[arenaOnline].imagen}
            onDesafiar={(id) => {
              audio.desbloquear()
              audio.ui('confirmar')
              vibrar(15)
              sala?.desafiar(id)
            }}
            onCancelar={() => {
              audio.ui('atras')
              sala?.cancelarDesafio()
            }}
            onVolver={() => {
              audio.ui('atras')
              irA(volverDeSala === 'sala' ? 'inicio' : volverDeSala)
            }}
            onJugarCpu={() => {
              audio.ui('confirmar')
              irA('seleccion')
            }}
          />
        )}

        {pantalla === 'online-eleccion' && duelo && estadoDuelo && (
          <EleccionOnline
            estado={estadoDuelo}
            sucursal={datos.sucursal?.slug ?? null}
            onTocar={() => audio.ui('tocar')}
            onElegir={(id) => {
              audio.ui('elegir')
              vibrar(10)
              duelo.elegir(id)
              guardarPreferencias({ ultimoPersonaje: id })
            }}
            onConfirmar={() => {
              audio.ui('confirmar')
              duelo.confirmar()
            }}
            onSalir={salirDelDuelo}
            onBloqueado={alBloqueado}
          />
        )}

        {pantalla === 'online-vs' && duelo && estadoDuelo?.personajes && precarga.estado !== 'error' && (
          <PantallaVs
            key={`vs-${estadoDuelo.k}`}
            eleccion={{
              jugador: estadoDuelo.personajes[estadoDuelo.lado],
              rival: estadoDuelo.personajes[estadoDuelo.lado === 0 ? 1 : 0],
              arena: arenaOnline,
              dificultad: prefs.dificultad,
            }}
            rivalEsBarbero={false}
            audio={audio}
            online={{
              personajes: estadoDuelo.personajes,
              nombres:
                estadoDuelo.lado === 0
                  ? [estadoDuelo.yo.nombre, estadoDuelo.rival.nombre]
                  : [estadoDuelo.rival.nombre, estadoDuelo.yo.nombre],
              lado: estadoDuelo.lado,
              esperando: vsVisto && !estadoDuelo.arranque,
            }}
            onListo={() => setVsOnlineVisto(estadoDuelo.k)}
          />
        )}
        {pantalla === 'online-vs' && duelo && estadoDuelo?.personajes && precarga.estado === 'error' && (
          <PantallaCarga
            precarga={precarga}
            eleccion={{
              jugador: estadoDuelo.personajes[0],
              rival: estadoDuelo.personajes[1],
              arena: arenaOnline,
              dificultad: prefs.dificultad,
            }}
            onListo={() => {}}
            onReintentar={() => {
              audio.ui('confirmar')
              if (estadoDuelo.personajes) precargar(estadoDuelo.personajes[0], estadoDuelo.personajes[1], arenaOnline)
            }}
            onVolver={salirDelDuelo}
          />
        )}

        {pantalla === 'online-pelea' && recursosPelea && peleaOnline && (
          <PantallaPelea
            key={idPelea}
            eleccion={{
              jugador: peleaOnline.arranque.personajes[peleaOnline.lado],
              rival: peleaOnline.arranque.personajes[peleaOnline.lado === 0 ? 1 : 0],
              arena: arenaOnline,
              dificultad: 'normal',
            }}
            recursos={recursosPelea}
            fuentes={fuentes}
            audio={audio}
            prefs={prefs}
            turno={turno}
            bloqueada={false}
            onTerminar={() => {}}
            onReiniciar={() => {}}
            onSalir={() => {}}
            online={peleaOnline}
            onAbandonarOnline={() => {
              const rivalNombre = peleaOnline.nombres[peleaOnline.lado === 0 ? 1 : 0]
              mostrarToast(`Abandonaste: la gana ${rivalNombre}`)
              peleaOnline.duelo.salir('abandono')
            }}
          />
        )}

        {pantalla === 'online-resultado' && duelo && estadoDuelo?.resultado && (
          <ResultadoOnline
            key={`res-${estadoDuelo.k}`}
            estado={estadoDuelo}
            onRevancha={() => {
              audio.ui('confirmar')
              duelo.pedirRevancha()
            }}
            onVolverSala={salirDelDuelo}
          />
        )}

        {toast && (
          <div key={toast.n} className="cf-toast" role="status">
            {toast.texto}
          </div>
        )}
        {estadoSala?.aviso && !toast && (
          <AvisoCortoSala key={estadoSala.aviso.n} texto={estadoSala.aviso.texto} onCerrar={() => sala?.descartarAviso()} />
        )}

        {llegadaVisibleAhora && (
          <AvisoLlegada
            key={llegadaVisibleAhora.n}
            nombre={llegadaVisibleAhora.nombre}
            cuantos={llegadaVisibleAhora.cuantos}
            sucursal={nombreSucursal}
            onVer={abrirSala}
            onCerrar={() => sala?.descartarLlegada()}
          />
        )}

        {!enPeleaCpu && desafioEntrante}

        {verTutorial && <Tutorial tactil={tactil} ficha={PERSONAJES[jugador]} onCerrar={cerrarTutorialInicio} />}

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
    </RecursosFaltantes>
  )
}
