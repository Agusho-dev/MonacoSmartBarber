'use client'

import { Heart, Lock, MapPin, Scissors, Sparkles, Trophy } from 'lucide-react'
import type { CSSProperties, Ref } from 'react'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { Atributos, EstadisticaPersonaje, FichaPersonaje, FichaProximamente, IdPersonaje } from '@/lib/juego/tipos'
import type { SucursalPlantel } from '@/lib/juego/ui/plantel'
import { nombreSucursal } from '@/lib/juego/ui/plantel'
import type { RegistroPersonaje } from '@/lib/juego/ui/preferencias'
import { ETIQUETA_ATRIBUTO, ORDEN_ATRIBUTOS, porcentaje } from '@/lib/juego/ui/textos'
import { IconoDeEspecial } from './iconos'
import { ImagenJuego } from './imagen-juego'

/**
 * Piezas de la elección de luchador, compartidas por la selección contra la CPU y la elección
 * de la pelea online: la grilla de caras, el filtro por sucursal, los «próximamente», la ficha
 * grande del enfocado y su detalle (especiales, pasiva, estadísticas).
 */

/** A quién se le está eligiendo luchador con la grilla. */
export type ModoEleccion = 'jugador' | 'rival'

// ─── Filtro por sucursal ─────────────────────────────────────────────────────

export function FiltroSucursal({
  sucursales,
  filtro,
  total,
  propia,
  onFiltro,
}: {
  sucursales: SucursalPlantel[]
  /** null = todos. */
  filtro: string | null
  total: number
  /** La sucursal del cliente (se marca con un pin). */
  propia: string | null
  onFiltro: (slug: string | null) => void
}) {
  if (sucursales.length < 2) return null
  return (
    <div className="cf-filtro" role="radiogroup" aria-label="Barberos de la sucursal">
      <button type="button" role="radio" aria-checked={filtro === null} className="cf-filtro__chip" onClick={() => onFiltro(null)}>
        <span>Todos</span>
        <small>{total}</small>
      </button>
      {sucursales.map((s) => (
        <button
          key={s.slug}
          type="button"
          role="radio"
          aria-checked={filtro === s.slug}
          className="cf-filtro__chip"
          data-propia={propia === s.slug ? '' : undefined}
          onClick={() => onFiltro(s.slug)}
        >
          {propia === s.slug && <MapPin aria-hidden="true" />}
          <span>{s.nombre}</span>
          <small>{s.cuantos}</small>
        </button>
      ))}
    </div>
  )
}

// ─── Grilla de caras ─────────────────────────────────────────────────────────

export function GrillaPlantel({
  ids,
  jugador,
  rival = null,
  modo = 'jugador',
  barbero = null,
  bloqueada = false,
  etiquetaRival = 'CPU',
  onElegir,
  ref,
}: {
  ids: IdPersonaje[]
  jugador: IdPersonaje
  /** Sin rival (online): sólo se marca el propio. */
  rival?: IdPersonaje | null
  modo?: ModoEleccion
  /** El personaje del barbero que lo atiende: lleva la tijera dorada. */
  barbero?: IdPersonaje | null
  /** Online, ya confirmó: no se puede cambiar. */
  bloqueada?: boolean
  etiquetaRival?: string
  onElegir: (id: IdPersonaje) => void
  ref?: Ref<HTMLDivElement>
}) {
  const enfocado = modo === 'rival' && rival ? rival : jugador
  return (
    <div ref={ref} className="cf-plantel" role="group" aria-label={modo === 'rival' ? 'Elegí el rival' : 'Elegí tu barbero'}>
      {ids.map((id) => {
        const f = PERSONAJES[id]
        const esJugador = id === jugador
        const esRival = rival !== null && id === rival
        const esBarbero = barbero === id
        const elegido = id === enfocado
        return (
          <button
            key={id}
            type="button"
            className="cf-ficha"
            aria-pressed={elegido}
            aria-label={`${f.nombre}, ${f.apodo}${esBarbero ? ', tu barbero' : ''}`}
            data-elegido={elegido ? '' : undefined}
            data-otro={!elegido && (esJugador || esRival) ? '' : undefined}
            data-barbero={esBarbero ? '' : undefined}
            disabled={bloqueada && !elegido}
            style={{ '--cf-acento': f.color, '--cf-acento-2': f.colorSecundario } as CSSProperties}
            onClick={() => onElegir(id)}
          >
            <span className="cf-ficha__marco">
              <span className="cf-ficha__cara">
                <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} />
              </span>
              {(esJugador || esRival) && (
                <span className="cf-ficha__tags" aria-hidden="true">
                  {esJugador && (
                    <span className="cf-ficha__tag" data-tag="vos">
                      Vos
                    </span>
                  )}
                  {esRival && (
                    <span className="cf-ficha__tag" data-tag="rival">
                      {etiquetaRival}
                    </span>
                  )}
                </span>
              )}
              {esBarbero && (
                <span className="cf-ficha__barbero" aria-hidden="true">
                  <Scissors />
                </span>
              )}
            </span>
            <span className="cf-ficha__nombre" data-largo={f.nombre.length >= 9 ? '' : undefined}>
              {f.nombre}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Próximamente ────────────────────────────────────────────────────────────

export function ProximamentePlantel({
  lista,
  onBloqueado,
}: {
  lista: FichaProximamente[]
  onBloqueado: (nombre: string) => void
}) {
  if (lista.length === 0) return null
  return (
    <div className="cf-prontos">
      <span className="cf-prontos__rotulo">Próximamente</span>
      <div className="cf-prontos__lista">
        {lista.map((p) => (
          <button
            key={`${p.sucursal}-${p.nombre}`}
            type="button"
            className="cf-pronto"
            onClick={() => onBloqueado(p.nombre)}
            aria-label={`${p.nombre}, de ${nombreSucursal(p.sucursal)}: próximamente`}
          >
            <Lock aria-hidden="true" />
            <span>{p.nombre}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Ficha grande del enfocado ───────────────────────────────────────────────

export function HeroeLuchador({
  ficha,
  rol,
  esBarbero,
  espejar,
}: {
  ficha: FichaPersonaje
  /** «Vos», «Rival · CPU», «Tu barbero»… */
  rol: string | null
  esBarbero: boolean
  /** El propio mira hacia la derecha (al rival); el rival, hacia la izquierda. */
  espejar: boolean
}) {
  return (
    <div className="cf-heroe" key={ficha.id}>
      <div className="cf-heroe__retrato">
        <ImagenJuego src={ficha.rutas.retrato} alt={ficha.nombre} tipo="cuerpo" color={ficha.color} espejar={espejar} prioridad />
      </div>
      <div className="cf-heroe__placa" style={{ '--cf-letras': Math.max(4, ficha.nombre.length) } as CSSProperties}>
        {(rol || esBarbero) && (
          <p className="cf-heroe__roles">
            {rol && <span className="cf-heroe__rol">{rol}</span>}
            {esBarbero && (
              <span className="cf-heroe__rol" data-barbero="">
                <Scissors aria-hidden="true" />
                Tu barbero
              </span>
            )}
          </p>
        )}
        <p className="cf-heroe__apodo">{ficha.apodo}</p>
        <h2 className="cf-heroe__nombre">{ficha.nombre}</h2>
        <p className="cf-heroe__sucursal">
          <span>
            <MapPin aria-hidden="true" />
            {nombreSucursal(ficha.sucursal)}
          </span>
          <span>
            <Heart aria-hidden="true" />
            {ficha.vidaMax.toLocaleString('es-AR')} de vida
          </span>
        </p>
        <BarrasAtributos atributos={ficha.atributos} />
      </div>
    </div>
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

// ─── Especiales, pasiva y estadísticas ───────────────────────────────────────

export function EspecialesLuchador({ ficha }: { ficha: FichaPersonaje }) {
  return (
    <div className="cf-bloque" key={ficha.id}>
      <h3 className="cf-rotulo">Especiales de {ficha.nombre}</h3>
      <ul className="cf-especiales">
        {ficha.especiales.map((esp, i) => (
          <li key={esp.nombre} className="cf-especial" style={{ animationDelay: `${0.04 + i * 0.06}s` }}>
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
  )
}

export function VictoriasLuchador({
  ficha,
  stats,
  local,
}: {
  ficha: FichaPersonaje
  stats: EstadisticaPersonaje[] | null
  local: RegistroPersonaje | undefined
}) {
  const global = stats?.find((s) => s.personaje === ficha.id) ?? null
  return (
    <div className="cf-bloque cf-victorias">
      <Trophy aria-hidden="true" />
      {global && global.peleas > 0 ? (
        <span>
          {ficha.nombre} gana el <b>{porcentaje(global.victorias, global.peleas)} %</b> ·{' '}
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
  )
}
