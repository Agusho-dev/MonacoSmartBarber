'use client'

import { ChevronLeft, SignalHigh, SignalLow, SignalMedium, Swords } from 'lucide-react'
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ARENAS, IDS_ARENAS } from '@/lib/juego/arenas'
import { IDS_PERSONAJES, PERSONAJES } from '@/lib/juego/personajes'
import type {
  DatosEntradaJuego,
  Dificultad,
  EstadisticaPersonaje,
  EstadoTurnoJuego,
  IdArena,
  IdPersonaje,
} from '@/lib/juego/tipos'
import { plantelOrdenado, proximamenteOrdenado, sucursalesDelPlantel } from '@/lib/juego/ui/plantel'
import { prefiereMenosMovimiento } from '@/lib/juego/ui/media'
import type { PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import { DETALLE_DIFICULTAD, NOMBRE_DIFICULTAD, ORDEN_DIFICULTAD } from '@/lib/juego/ui/textos'
import type { Eleccion } from '@/lib/juego/ui/tipos-ui'
import { ImagenJuego } from './imagen-juego'
import {
  EspecialesLuchador,
  FiltroSucursal,
  GrillaPlantel,
  HeroeLuchador,
  ProximamentePlantel,
  VictoriasLuchador,
  type ModoEleccion,
} from './plantel'
import { ChipTurno } from './turno'

function IconoDificultad({ dificultad }: { dificultad: Dificultad }) {
  if (dificultad === 'facil') return <SignalLow aria-hidden="true" />
  if (dificultad === 'normal') return <SignalMedium aria-hidden="true" />
  return <SignalHigh aria-hidden="true" />
}

/** Las sucursales del filtro se calculan una vez: salen del catálogo. */
const SUCURSALES = sucursalesDelPlantel()

interface Props {
  eleccion: Eleccion
  datos: DatosEntradaJuego
  /** El personaje del barbero que lo atiende (si vino por QR y es personaje). */
  barbero: IdPersonaje | null
  stats: EstadisticaPersonaje[] | null
  prefs: PreferenciasJuego
  turno: EstadoTurnoJuego | null
  onElegirPersonaje: (id: IdPersonaje) => void
  onElegirRival: (id: IdPersonaje) => void
  onElegirArena: (id: IdArena) => void
  onElegirDificultad: (d: Dificultad) => void
  onBloqueado: (nombre: string) => void
  onVolver: () => void
  onPelear: () => void
  /** El chip de la sala de la sucursal (si hay alguien más con el juego abierto). */
  sala?: ReactNode
  /** Sonido de los toques que no eligen (cambiar a quién se elige, el filtro). */
  onTocar?: () => void
}

/**
 * «Elegí tu barbero»: la grilla con los luchadores (filtrable por sucursal), la ficha grande del
 * enfocado y, abajo, la barra del duelo: VOS contra el RIVAL. Tocando cada lado del duelo la
 * grilla pasa a elegir a ese (el rival arranca en el barbero que lo atiende, o en uno de su
 * sucursal), y «¡A pelear!» al lado.
 */
export function PantallaSeleccion({
  eleccion,
  datos,
  barbero,
  stats,
  prefs,
  turno,
  onElegirPersonaje,
  onElegirRival,
  onElegirArena,
  onElegirDificultad,
  onBloqueado,
  onVolver,
  onPelear,
  sala,
  onTocar,
}: Props) {
  const [modo, setModo] = useState<ModoEleccion>('jugador')
  const [filtro, setFiltro] = useState<string | null>(null)
  const grillaRef = useRef<HTMLDivElement>(null)

  const sucursalCliente = datos.sucursal?.slug ?? null
  const jugador = PERSONAJES[eleccion.jugador]
  const rival = PERSONAJES[eleccion.rival]
  const enfocado = modo === 'rival' ? rival : jugador
  const rivalEsBarbero = barbero !== null && eleccion.rival === barbero
  const eligioAlBarbero = barbero !== null && eleccion.jugador === barbero
  const ids = plantelOrdenado(sucursalCliente, filtro)
  const prontos = proximamenteOrdenado(sucursalCliente, filtro)
  const etiquetaRival = rivalEsBarbero ? 'Tu barbero' : 'Rival · CPU'

  const cambiarModo = (m: ModoEleccion) => {
    if (m === modo) return
    onTocar?.()
    setModo(m)
    // Si bajó a leer los especiales, la grilla vuelve a la vista: con ella se elige.
    grillaRef.current?.scrollIntoView({ block: 'nearest', behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' })
  }

  const cambiarFiltro = (f: string | null) => {
    if (f === filtro) return
    onTocar?.()
    setFiltro(f)
  }

  return (
    <section
      className="cf-pantalla cf-seleccion"
      aria-label={modo === 'rival' ? 'Elegí el rival' : 'Elegí tu barbero'}
      data-modo={modo}
      style={{ '--cf-acento': enfocado.color, '--cf-acento-2': enfocado.colorSecundario } as CSSProperties}
    >
      <div className="cf-seleccion__fondo" aria-hidden="true">
        <span className="cf-seleccion__franja" />
        <span className="cf-seleccion__trama" />
      </div>

      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" onClick={onVolver} aria-label="Volver al inicio">
          <ChevronLeft />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo" key={modo}>
          {modo === 'rival' ? 'Elegí el rival' : 'Elegí tu barbero'}
        </h1>
        <ChipTurno turno={turno} compacto />
        {sala}
      </header>

      <div className="cf-seleccion__cuerpo">
        <HeroeLuchador
          ficha={enfocado}
          rol={modo === 'rival' ? etiquetaRival : 'Vos'}
          esBarbero={barbero === enfocado.id && !(modo === 'rival' && rivalEsBarbero)}
          espejar={modo === 'jugador'}
        />

        <div className="cf-seleccion__panel">
          <FiltroSucursal
            sucursales={SUCURSALES}
            filtro={filtro}
            total={IDS_PERSONAJES.length}
            propia={sucursalCliente}
            onFiltro={cambiarFiltro}
          />
          <GrillaPlantel
            ref={grillaRef}
            ids={ids}
            jugador={eleccion.jugador}
            rival={eleccion.rival}
            modo={modo}
            barbero={barbero}
            onElegir={modo === 'rival' ? onElegirRival : onElegirPersonaje}
          />
          <ProximamentePlantel lista={prontos} onBloqueado={onBloqueado} />

          {barbero && (rivalEsBarbero || eligioAlBarbero) && (
            <p className="cf-aviso-barbero" style={{ '--cf-acento': PERSONAJES[barbero].color } as CSSProperties}>
              <Swords aria-hidden="true" />
              {rivalEsBarbero ? (
                <span>
                  <b>Peleá contra tu barbero.</b> Hoy te atiende {PERSONAJES[barbero].nombre}: demostrale quién manda.
                </span>
              ) : (
                <span>
                  <b>Elegiste a tu barbero.</b> {PERSONAJES[barbero].nombre} pelea de tu lado hoy.
                </span>
              )}
            </p>
          )}

          <EspecialesLuchador ficha={enfocado} />
          <VictoriasLuchador ficha={enfocado} stats={stats} local={prefs.porPersonaje[enfocado.id]} />

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Dificultad</h3>
            <div className="cf-segmentos" role="radiogroup" aria-label="Dificultad">
              {ORDEN_DIFICULTAD.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={eleccion.dificultad === d}
                  className="cf-segmento"
                  onClick={() => onElegirDificultad(d)}
                >
                  <IconoDificultad dificultad={d} />
                  <span className="cf-segmento__nombre">{NOMBRE_DIFICULTAD[d]}</span>
                  <span className="cf-segmento__detalle">{DETALLE_DIFICULTAD[d]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Arena</h3>
            <div className="cf-arenas" role="radiogroup" aria-label="Arena">
              {IDS_ARENAS.map((id) => {
                const a = ARENAS[id]
                const disponible = a.imagen !== null
                const propia = datos.sucursal?.slug === a.sucursalSlug
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={eleccion.arena === id}
                    className="cf-arena"
                    disabled={!disponible}
                    onClick={() => onElegirArena(id)}
                  >
                    <span className="cf-arena__imagen">
                      <ImagenJuego src={a.miniatura ?? a.imagen} alt="" tipo="arena" />
                    </span>
                    <span className="cf-arena__nombre">{a.nombre}</span>
                    {propia && <span className="cf-arena__marca">Tu sucursal</span>}
                    {!disponible && <span className="cf-arena__marca">Pronto</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <footer className="cf-seleccion__pie">
        <div className="cf-duelo" role="group" aria-label="La pelea: tocá un lado para cambiarlo">
          <button
            type="button"
            className="cf-duelo__lado"
            data-lado="vos"
            aria-pressed={modo === 'jugador'}
            aria-label={`Vos: ${jugador.nombre}. Tocá para cambiar tu barbero`}
            style={{ '--cf-acento': jugador.color, '--cf-acento-2': jugador.colorSecundario } as CSSProperties}
            onClick={() => cambiarModo('jugador')}
          >
            <span className="cf-duelo__cara">
              <ImagenJuego src={jugador.rutas.cara} alt="" tipo="cara" color={jugador.color} />
            </span>
            <span className="cf-duelo__texto">
              <small>Vos</small>
              <b>{jugador.nombre}</b>
            </span>
          </button>
          <span className="cf-duelo__vs" aria-hidden="true">
            VS
          </span>
          <button
            type="button"
            className="cf-duelo__lado"
            data-lado="rival"
            aria-pressed={modo === 'rival'}
            aria-label={`${etiquetaRival}: ${rival.nombre}. Tocá para cambiar el rival`}
            style={{ '--cf-acento': rival.color, '--cf-acento-2': rival.colorSecundario } as CSSProperties}
            onClick={() => cambiarModo('rival')}
          >
            <span className="cf-duelo__texto">
              <small>{rivalEsBarbero ? 'Tu barbero' : 'Rival'}</small>
              <b>{rival.nombre}</b>
            </span>
            <span className="cf-duelo__cara">
              <ImagenJuego src={rival.rutas.cara} alt="" tipo="cara" color={rival.color} espejar />
            </span>
          </button>
        </div>
        <div
          className="cf-seleccion__accion"
          style={{ '--cf-acento': jugador.color, '--cf-acento-2': jugador.colorSecundario } as CSSProperties}
        >
          <p className="cf-seleccion__resumen">
            <span>CPU · {NOMBRE_DIFICULTAD[eleccion.dificultad]}</span>
            <span>Arena {ARENAS[eleccion.arena].nombre}</span>
          </p>
          <button type="button" className="cf-btn cf-btn--grande cf-seleccion__pelear" onClick={onPelear}>
            <Swords aria-hidden="true" />
            <span>¡A pelear!</span>
          </button>
        </div>
      </footer>
    </section>
  )
}
