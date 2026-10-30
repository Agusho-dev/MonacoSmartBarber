'use client'

import {
  ChevronLeft,
  Lock,
  MapPin,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { ARENAS, IDS_ARENAS } from '@/lib/juego/arenas'
import { IDS_PERSONAJES, PERSONAJES, PROXIMAMENTE } from '@/lib/juego/personajes'
import type {
  Atributos,
  DatosEntradaJuego,
  Dificultad,
  EstadisticaPersonaje,
  EstadoTurnoJuego,
  IdArena,
  IdPersonaje,
} from '@/lib/juego/tipos'
import type { PreferenciasJuego } from '@/lib/juego/ui/preferencias'
import {
  DETALLE_DIFICULTAD,
  ETIQUETA_ATRIBUTO,
  NOMBRE_DIFICULTAD,
  ORDEN_ATRIBUTOS,
  ORDEN_DIFICULTAD,
  porcentaje,
} from '@/lib/juego/ui/textos'
import type { Eleccion } from '@/lib/juego/ui/tipos-ui'
import { IconoDeEspecial } from './iconos'
import { ImagenJuego } from './imagen-juego'
import { ChipTurno } from './turno'

function IconoDificultad({ dificultad }: { dificultad: Dificultad }) {
  if (dificultad === 'facil') return <SignalLow aria-hidden="true" />
  if (dificultad === 'normal') return <SignalMedium aria-hidden="true" />
  return <SignalHigh aria-hidden="true" />
}

function nombreSucursal(slug: string): string {
  const arena = IDS_ARENAS.find((id) => ARENAS[id].sucursalSlug === slug)
  return arena ? ARENAS[arena].nombre : slug.charAt(0).toUpperCase() + slug.slice(1)
}

interface Props {
  eleccion: Eleccion
  datos: DatosEntradaJuego
  /** El personaje del barbero que lo atiende (si vino por QR y es personaje). */
  barbero: IdPersonaje | null
  stats: EstadisticaPersonaje[] | null
  prefs: PreferenciasJuego
  turno: EstadoTurnoJuego | null
  onElegirPersonaje: (id: IdPersonaje) => void
  onElegirArena: (id: IdArena) => void
  onElegirDificultad: (d: Dificultad) => void
  onBloqueado: (nombre: string) => void
  onVolver: () => void
  onPelear: () => void
  /** El chip de la sala de la sucursal (si hay alguien más con el juego abierto). */
  sala?: ReactNode
}

export function PantallaSeleccion({
  eleccion,
  datos,
  barbero,
  stats,
  prefs,
  turno,
  onElegirPersonaje,
  onElegirArena,
  onElegirDificultad,
  onBloqueado,
  onVolver,
  onPelear,
  sala,
}: Props) {
  const ficha = PERSONAJES[eleccion.jugador]
  const rival = PERSONAJES[eleccion.rival]
  const rivalEsBarbero = barbero !== null && eleccion.rival === barbero
  const eligioAlBarbero = barbero !== null && eleccion.jugador === barbero
  const global = stats?.find((s) => s.personaje === ficha.id) ?? null
  const local = prefs.porPersonaje[ficha.id]

  return (
    <section
      className="cf-pantalla cf-seleccion"
      aria-label="Elegí tu barbero"
      style={{ '--cf-acento': ficha.color, '--cf-acento-2': ficha.colorSecundario } as CSSProperties}
    >
      <div className="cf-seleccion__fondo" aria-hidden="true">
        <span className="cf-seleccion__franja" />
        <span className="cf-seleccion__trama" />
      </div>

      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" onClick={onVolver} aria-label="Volver al inicio">
          <ChevronLeft />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo">Elegí tu barbero</h1>
        <ChipTurno turno={turno} compacto />
        {sala}
      </header>

      <div className="cf-seleccion__cuerpo">
        <div className="cf-heroe" key={ficha.id}>
          <div className="cf-heroe__retrato">
            <ImagenJuego src={ficha.rutas.retrato} alt={ficha.nombre} tipo="cuerpo" color={ficha.color} espejar prioridad />
          </div>
          <div className="cf-heroe__placa">
            <p className="cf-heroe__apodo">{ficha.apodo}</p>
            <h2 className="cf-heroe__nombre">{ficha.nombre}</h2>
            <p className="cf-heroe__sucursal">
              <MapPin aria-hidden="true" />
              Barbero de {nombreSucursal(ficha.sucursal)}
            </p>
            <BarrasAtributos atributos={ficha.atributos} />
          </div>
        </div>

        <div className="cf-seleccion__panel">
          <div className="cf-plantel" role="group" aria-label="Barberos">
            {IDS_PERSONAJES.map((id) => {
              const f = PERSONAJES[id]
              const elegido = id === ficha.id
              return (
                <button
                  key={id}
                  type="button"
                  className="cf-ficha"
                  aria-pressed={elegido}
                  data-elegido={elegido ? '' : undefined}
                  style={{ '--cf-acento': f.color } as CSSProperties}
                  onClick={() => onElegirPersonaje(id)}
                >
                  <span className="cf-ficha__cara">
                    <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} prioridad />
                  </span>
                  <span className="cf-ficha__nombre">{f.nombre}</span>
                  {barbero === id && <span className="cf-ficha__marca">Tu barbero</span>}
                </button>
              )
            })}
            {PROXIMAMENTE.map((p) => (
              <button
                key={p.nombre}
                type="button"
                className="cf-ficha cf-ficha--bloqueada"
                onClick={() => onBloqueado(p.nombre)}
                aria-label={`${p.nombre}: próximamente`}
              >
                <span className="cf-ficha__cara">
                  <Lock aria-hidden="true" />
                </span>
                <span className="cf-ficha__nombre">{p.nombre}</span>
                <span className="cf-ficha__pronto">Pronto</span>
              </button>
            ))}
          </div>

          {barbero && (
            <p className="cf-aviso-barbero" style={{ '--cf-acento': PERSONAJES[barbero].color } as CSSProperties}>
              <Swords aria-hidden="true" />
              {rivalEsBarbero ? (
                <span>
                  <b>Peleá contra tu barbero.</b> Hoy te atiende {PERSONAJES[barbero].nombre}: demostrale quién manda.
                </span>
              ) : eligioAlBarbero ? (
                <span>
                  <b>Elegiste a tu barbero.</b> {PERSONAJES[barbero].nombre} pelea de tu lado hoy.
                </span>
              ) : null}
            </p>
          )}

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Especiales</h3>
            <ul className="cf-especiales">
              {ficha.especiales.map((esp) => (
                <li key={esp.nombre} className="cf-especial">
                  <span className="cf-especial__icono">
                    <IconoDeEspecial icono={esp.icono} />
                  </span>
                  <span className="cf-especial__texto">
                    <b>{esp.nombre}</b>
                    <span>{esp.descripcion}</span>
                  </span>
                  <span className="cf-rombo" aria-label={`Cuesta ${esp.costo} de carga`}>
                    <span>{esp.costo}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="cf-pasiva">
              <Sparkles aria-hidden="true" />
              <span>
                <b>{ficha.pasiva.nombre}.</b> {ficha.pasiva.descripcion}
              </span>
            </p>
          </div>

          <div className="cf-bloque cf-victorias">
            <Trophy aria-hidden="true" />
            {global && global.peleas > 0 ? (
              <span>
                Gana el <b>{porcentaje(global.victorias, global.peleas)} %</b> de sus peleas ·{' '}
                {global.peleas.toLocaleString('es-AR')} {global.peleas === 1 ? 'pelea' : 'peleas'}
              </span>
            ) : (
              <span>Todavía nadie peleó con {ficha.nombre}. Estrenalo.</span>
            )}
            {local && local.partidas > 0 && (
              <span className="cf-victorias__propias">
                Vos: {local.victorias} de {local.partidas}
              </span>
            )}
          </div>

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Dificultad</h3>
            <div className="cf-segmentos" role="radiogroup" aria-label="Dificultad">
              {ORDEN_DIFICULTAD.map((d) => {
                return (
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
                )
              })}
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
        <div className="cf-rival" style={{ '--cf-acento': rival.color } as CSSProperties}>
          <span className="cf-rival__vs">VS</span>
          <span className="cf-rival__cara">
            <ImagenJuego src={rival.rutas.cara} alt="" tipo="cara" color={rival.color} espejar />
          </span>
          <span className="cf-rival__texto">
            <b>{rival.nombre}</b>
            <span>{rivalEsBarbero ? 'Tu barbero' : `CPU · ${NOMBRE_DIFICULTAD[eleccion.dificultad]}`}</span>
          </span>
        </div>
        <button type="button" className="cf-btn cf-btn--grande cf-seleccion__pelear" onClick={onPelear}>
          <Swords aria-hidden="true" />
          <span>¡A pelear!</span>
        </button>
      </footer>
    </section>
  )
}

export function BarrasAtributos({ atributos }: { atributos: Atributos }) {
  return (
    <dl className="cf-atributos">
      {ORDEN_ATRIBUTOS.map((clave) => {
        const valor = Math.max(0, Math.min(10, Math.round(atributos[clave])))
        return (
          <div key={clave} className="cf-atributo">
            <dt>{ETIQUETA_ATRIBUTO[clave]}</dt>
            <dd>
              <span className="cf-atributo__barra" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} data-lleno={i < valor ? '' : undefined} style={{ animationDelay: `${0.1 + i * 0.03}s` }} />
                ))}
              </span>
              <span className="cf-atributo__valor">{valor}</span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
