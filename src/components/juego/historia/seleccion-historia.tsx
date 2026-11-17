'use client'

import { ChevronLeft, Crown, SignalHigh, SignalLow, SignalMedium } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { TOTAL_PISOS } from '@/lib/juego/historia/jefes'
import type { Campeon } from '@/lib/juego/historia/torre'
import { IDS_PARA_CLIENTES, PERSONAJES } from '@/lib/juego/personajes'
import type { Dificultad, EstadoTurnoJuego, IdPersonaje } from '@/lib/juego/tipos'
import { plantelOrdenado, sucursalesDelPlantel } from '@/lib/juego/ui/plantel'
import { NOMBRE_DIFICULTAD, ORDEN_DIFICULTAD } from '@/lib/juego/ui/textos'
import { ImagenJuego } from '../imagen-juego'
import { EspecialesLuchador, FiltroSucursal, GrillaPlantel, HeroeLuchador } from '../plantel'
import { ChipTurno } from '../turno'

const SUCURSALES = sucursalesDelPlantel()

/** Lo que dice cada dificultad del torneo debajo de su nombre. */
const DETALLE_TORNEO: Record<Dificultad, string> = {
  facil: 'Para conocerlos',
  normal: 'Los Bosses pegan',
  dificil: 'Sólo para cracks',
}

function IconoDificultad({ dificultad }: { dificultad: Dificultad }) {
  if (dificultad === 'facil') return <SignalLow aria-hidden="true" />
  if (dificultad === 'normal') return <SignalMedium aria-hidden="true" />
  return <SignalHigh aria-hidden="true" />
}

/**
 * «¿Quién sube la torre?»: el jugador elige uno de los 17 barberos (los Bosses no: son los rivales
 * de arriba) y la dificultad del torneo. Las mismas piezas que «Elegí tu barbero» (ficha grande,
 * filtro por sucursal, grilla, especiales) sin rival ni arena: los pone la torre.
 */
export function SeleccionHistoria({
  jugador,
  dificultad,
  barbero,
  sucursal,
  campeones,
  turno,
  onElegir,
  onDificultad,
  onEntrar,
  onVolver,
  onTocar,
}: {
  jugador: IdPersonaje
  dificultad: Dificultad
  /** El personaje del barbero que lo atiende (si vino por QR), con su tijera dorada. */
  barbero: IdPersonaje | null
  sucursal: string | null
  campeones: readonly Campeon[]
  turno: EstadoTurnoJuego | null
  onElegir: (id: IdPersonaje) => void
  onDificultad: (d: Dificultad) => void
  onEntrar: () => void
  onVolver: () => void
  onTocar: () => void
}) {
  const [filtro, setFiltro] = useState<string | null>(null)
  const ficha = PERSONAJES[jugador]
  const ids = plantelOrdenado(sucursal, filtro)
  // Los barberos con los que ya ganó el torneo en este celular (una corona cada uno).
  const ganados = new Set(campeones.map((c) => c.id))
  const yaGano = ganados.has(jugador)

  return (
    <section
      className="cf-pantalla cf-seleccion cf-hist-seleccion"
      aria-label="Elegí tu barbero para el torneo"
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
        <h1 className="cf-titulo cf-barra-sup__titulo">¿Quién sube la torre?</h1>
        <ChipTurno turno={turno} compacto />
      </header>

      <div className="cf-seleccion__cuerpo">
        <HeroeLuchador ficha={ficha} rol={yaGano ? 'Ya fue campeón' : 'Vos'} esBarbero={barbero === jugador} espejar />

        <div className="cf-seleccion__panel">
          <FiltroSucursal
            sucursales={SUCURSALES}
            filtro={filtro}
            total={IDS_PARA_CLIENTES.length}
            propia={sucursal}
            onFiltro={(f) => {
              if (f === filtro) return
              onTocar()
              setFiltro(f)
            }}
          />
          <GrillaPlantel ids={ids} jugador={jugador} barbero={barbero} onElegir={onElegir} etiqueta="Elegí tu barbero para el torneo" />

          {campeones.length > 0 && (
            <div className="cf-bloque cf-hist-galeria-mini">
              <h3 className="cf-rotulo">
                <Crown aria-hidden="true" />
                Tus campeones
              </h3>
              <ul className="cf-hist-galeria-mini__lista">
                {[...ganados].map((id) => {
                  const f = PERSONAJES[id]
                  const veces = campeones.filter((c) => c.id === id).length
                  return (
                    <li key={id} style={{ '--cf-acento': f.color } as CSSProperties}>
                      <span className="cf-hist-galeria-mini__cara">
                        <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} />
                      </span>
                      <span className="cf-hist-galeria-mini__nombre">
                        {f.nombre}
                        {veces > 1 && <small>×{veces}</small>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <EspecialesLuchador ficha={ficha} />

          <div className="cf-bloque">
            <h3 className="cf-rotulo">Dificultad del torneo</h3>
            <div className="cf-segmentos" role="radiogroup" aria-label="Dificultad del torneo">
              {ORDEN_DIFICULTAD.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={dificultad === d}
                  className="cf-segmento"
                  onClick={() => onDificultad(d)}
                >
                  <IconoDificultad dificultad={d} />
                  <span className="cf-segmento__nombre">{NOMBRE_DIFICULTAD[d]}</span>
                  <span className="cf-segmento__detalle">{DETALLE_TORNEO[d]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="cf-seleccion__pie cf-hist-seleccion__pie">
        <div className="cf-seleccion__accion">
          <p className="cf-seleccion__resumen">
            <span>{NOMBRE_DIFICULTAD[dificultad]}</span>
            <span>{TOTAL_PISOS} peleas</span>
          </p>
          <button type="button" className="cf-btn cf-btn--grande cf-seleccion__pelear" onClick={onEntrar}>
            <Crown aria-hidden="true" />
            <span>Entrar al torneo</span>
          </button>
        </div>
      </footer>
    </section>
  )
}
