'use client'

import { Award, ChevronLeft, Crown, Medal, RotateCcw, Trophy } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { obtenerRankingJuego } from '@/lib/actions/juego'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { DatosEntradaJuego, EstadoTurnoJuego, FilaRanking, IdPersonaje, PeriodoRanking } from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { fechaRelativa, formatearPuntos } from '@/lib/juego/ui/textos'
import { ImagenJuego } from './imagen-juego'
import { ChipTurno } from './turno'

const PERIODOS: { id: PeriodoRanking; nombre: string; vacio: string }[] = [
  { id: 'hoy', nombre: 'Hoy', vacio: 'Todavía nadie peleó hoy.' },
  { id: 'semana', nombre: 'Semana', vacio: 'Todavía no hay peleas esta semana.' },
  { id: 'siempre', nombre: 'Siempre', vacio: 'Todavía no hay peleas.' },
]

interface Lectura {
  clave: string
  filas: FilaRanking[] | null
  error: string | null
  ahora: number
}

function Medalla({ puesto }: { puesto: number }) {
  if (puesto === 1) return <Crown aria-hidden="true" />
  if (puesto === 2) return <Medal aria-hidden="true" />
  if (puesto === 3) return <Award aria-hidden="true" />
  return <span className="cf-ranking__numero">{puesto}</span>
}

export function PantallaRanking({
  datos,
  audio,
  turno,
  resaltado,
  onVolver,
}: {
  datos: DatosEntradaJuego
  audio: AudioSeguro
  turno: EstadoTurnoJuego | null
  /** La última partida que guardó este jugador: se marca en la lista. */
  resaltado: { apodo: string; puntaje: number } | null
  onVolver: () => void
}) {
  const [periodo, setPeriodo] = useState<PeriodoRanking>('hoy')
  const [soloSucursal, setSoloSucursal] = useState(datos.sucursal !== null)
  const [reintento, setReintento] = useState(0)
  const [lectura, setLectura] = useState<Lectura | null>(null)

  const slug = soloSucursal && datos.sucursal ? datos.sucursal.slug : null
  const clave = `${slug ?? '*'}|${periodo}|${reintento}`
  const cargando = lectura?.clave !== clave
  const actual = cargando ? null : lectura
  const infoPeriodo = PERIODOS.find((p) => p.id === periodo) ?? PERIODOS[0]

  useEffect(() => {
    let vivo = true
    obtenerRankingJuego(slug, periodo)
      .then((r) => {
        if (!vivo) return
        setLectura({ clave, filas: r.ok ? r.filas : null, error: r.ok ? null : r.error, ahora: Date.now() })
      })
      .catch(() => {
        if (vivo) setLectura({ clave, filas: null, error: 'Sin conexión', ahora: Date.now() })
      })
    return () => {
      vivo = false
    }
  }, [clave, slug, periodo])

  return (
    <section className="cf-pantalla cf-ranking" aria-label="Ranking">
      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" onClick={onVolver} aria-label="Volver">
          <ChevronLeft />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo">Ranking</h1>
        <ChipTurno turno={turno} compacto />
      </header>

      <div className="cf-ranking__cuerpo">
        <div className="cf-ranking__filtros">
          <div className="cf-pestanas" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={periodo === p.id}
                className="cf-pestana"
                onClick={() => {
                  audio.ui('tocar')
                  setPeriodo(p.id)
                }}
              >
                {p.nombre}
              </button>
            ))}
          </div>
          {datos.sucursal && (
            <div className="cf-pestanas cf-pestanas--chicas" role="tablist" aria-label="Sucursal">
              <button
                type="button"
                role="tab"
                aria-selected={soloSucursal}
                className="cf-pestana"
                onClick={() => {
                  audio.ui('tocar')
                  setSoloSucursal(true)
                }}
              >
                {datos.sucursal.nombre}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!soloSucursal}
                className="cf-pestana"
                onClick={() => {
                  audio.ui('tocar')
                  setSoloSucursal(false)
                }}
              >
                Todas
              </button>
            </div>
          )}
        </div>

        {cargando ? (
          <ol className="cf-ranking__lista" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="cf-ranking__fila cf-ranking__fila--fantasma" />
            ))}
          </ol>
        ) : actual?.error || !actual?.filas ? (
          <div className="cf-ranking__vacio" role="alert">
            <p>No pudimos traer el ranking.</p>
            <button type="button" className="cf-btn cf-btn--sec" onClick={() => setReintento((n) => n + 1)}>
              <RotateCcw aria-hidden="true" />
              <span>Reintentar</span>
            </button>
          </div>
        ) : actual.filas.length === 0 ? (
          <div className="cf-ranking__vacio">
            <Trophy aria-hidden="true" />
            <p>{infoPeriodo.vacio}</p>
            <p className="cf-texto-suave">El primer puesto está libre. Estrenalo vos.</p>
          </div>
        ) : (
          <FilasRanking filas={actual.filas} ahora={actual.ahora} resaltado={resaltado} />
        )}
      </div>
    </section>
  )
}

/** La lista del top 10 (separada para poder dibujarla sin pedir datos). */
export function FilasRanking({
  filas,
  ahora,
  resaltado,
}: {
  filas: FilaRanking[]
  ahora: number
  resaltado: { apodo: string; puntaje: number } | null
}) {
  return (
    <ol className="cf-ranking__lista">
      {filas.slice(0, 10).map((f, i) => {
        const ficha = PERSONAJES[f.personaje as IdPersonaje] ?? null
        const propio = resaltado !== null && f.apodo === resaltado.apodo && f.puntaje === resaltado.puntaje
        const cuando = fechaRelativa(f.fecha, ahora)
        return (
          <li
            key={`${f.puesto}-${f.apodo}-${f.fecha}`}
            className="cf-ranking__fila"
            data-puesto={f.puesto <= 3 ? f.puesto : undefined}
            data-propio={propio ? '' : undefined}
            style={{ '--cf-acento': ficha?.color ?? '#8a8f99', animationDelay: `${i * 0.04}s` } as CSSProperties}
          >
            <span className="cf-ranking__medalla">
              <Medalla puesto={f.puesto} />
            </span>
            <span className="cf-ranking__cara">
              <ImagenJuego src={ficha?.rutas.cara ?? null} alt="" tipo="cara" color={ficha?.color} />
            </span>
            <span className="cf-ranking__quien">
              <b>{f.apodo}</b>
              <span>{[ficha ? `con ${ficha.nombre}` : null, cuando || null].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="cf-ranking__puntos">{formatearPuntos(f.puntaje)}</span>
          </li>
        )
      })}
    </ol>
  )
}
