'use client'

import { BookOpen, Check, ChevronLeft, Crown, MapPin, Swords } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { esJefe, ORDEN_JEFES, TOTAL_PISOS } from '@/lib/juego/historia/jefes'
import { TEXTOS_JEFES } from '@/lib/juego/historia/textos'
import { pisoActual, type Torre } from '@/lib/juego/historia/torre'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { EstadoTurnoJuego } from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { prefiereMenosMovimiento } from '@/lib/juego/ui/media'
import { NOMBRE_DIFICULTAD } from '@/lib/juego/ui/textos'
import { alTocar } from '@/lib/juego/ui/toque'
import { ImagenJuego } from '../imagen-juego'
import { ChipTurno } from '../turno'

/**
 * La torre del Torneo de Monaco, entre pelea y pelea: los 9 pisos (abajo los barberos, arriba los
 * 4 Bosses, Tony en la punta), los ganados con su K.O., el actual con la cara del jugador y, abajo
 * (al costado en horizontal), la ficha del rival que sigue con «¡A pelear!». Recién ganada una
 * pelea (`subio`), el jugador sube un piso con su sonido.
 */
export function PantallaTorre({
  torre,
  subio,
  turno,
  audio,
  onPelear,
  onSalir,
  onVerHistoria,
}: {
  torre: Torre
  subio: boolean
  turno: EstadoTurnoJuego | null
  audio: AudioSeguro
  onPelear: () => void
  onSalir: () => void
  onVerHistoria: () => void
}) {
  const piso = pisoActual(torre)
  const yo = PERSONAJES[torre.jugador]
  const rival = piso ? PERSONAJES[piso.rival] : null
  const listaRef = useRef<HTMLOListElement>(null)
  const actualRef = useRef<HTMLLIElement>(null)

  // El piso actual a la vista (en un celular chico la torre no entra entera).
  useLayoutEffect(() => {
    actualRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [])

  useEffect(() => {
    if (!subio || prefiereMenosMovimiento()) return
    const t = window.setTimeout(() => audio.ui('subir'), 380)
    return () => window.clearTimeout(t)
  }, [subio, audio])

  if (!piso || !rival) return null
  const fraseBarbero = rival.frases.length > 0 ? rival.frases[piso.indice % rival.frases.length] : null
  const textosJefe = esJefe(piso.rival) ? TEXTOS_JEFES[piso.rival] : null
  const arena = ARENAS[piso.arena]

  return (
    <section
      className="cf-pantalla cf-hist cf-hist-torre"
      aria-label={`El Torneo de Monaco: piso ${piso.indice + 1} de ${TOTAL_PISOS}`}
      data-jefe={piso.jefe ? '' : undefined}
      data-final={piso.final ? '' : undefined}
      style={{ '--cf-acento': rival.color, '--cf-acento-2': rival.colorSecundario } as CSSProperties}
    >
      <div className="cf-hist-torre__fondo" aria-hidden="true">
        <ImagenJuego src={arena.imagen} alt="" tipo="arena" />
      </div>
      <div className="cf-hist-torre__velo" aria-hidden="true" />

      <header className="cf-barra-sup">
        <button type="button" className="cf-volver" {...alTocar(onSalir)} aria-label="Salir del torneo (queda guardado)">
          <ChevronLeft />
        </button>
        <h1 className="cf-titulo cf-barra-sup__titulo">El Torneo</h1>
        <span className="cf-hist-chip" title="Dificultad del torneo">
          {NOMBRE_DIFICULTAD[torre.dificultad]}
        </span>
        <button type="button" className="cf-hist-chip cf-hist-chip--boton" {...alTocar(onVerHistoria)} aria-label="Ver la historia">
          <BookOpen aria-hidden="true" />
        </button>
        <ChipTurno turno={turno} compacto />
      </header>

      <div className="cf-hist-torre__cuerpo">
        <ol ref={listaRef} className="cf-hist-pisos" aria-label="Los pisos del torneo">
          {torre.rivales
            .map((id, i) => ({ id, i }))
            .reverse()
            .map(({ id, i }) => {
              const f = PERSONAJES[id]
              const estado = i < torre.piso ? 'ganado' : i === torre.piso ? 'actual' : 'pendiente'
              const numeroJefe = esJefe(id) ? ORDEN_JEFES.indexOf(id) + 1 : 0
              const final = i === TOTAL_PISOS - 1
              return (
                <li
                  key={i}
                  ref={estado === 'actual' ? actualRef : undefined}
                  className="cf-hist-piso"
                  data-estado={estado}
                  data-jefe={numeroJefe > 0 ? '' : undefined}
                  data-final={final ? '' : undefined}
                  data-subio={estado === 'actual' && subio ? '' : undefined}
                  aria-current={estado === 'actual' ? 'step' : undefined}
                  style={{ '--cf-acento': f.color } as CSSProperties}
                >
                  <span className="cf-hist-piso__numero" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="cf-hist-piso__cara">
                    <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} />
                  </span>
                  <span className="cf-hist-piso__texto">
                    <b>{f.nombre}</b>
                    <small>{numeroJefe > 0 ? (final ? 'Jefe final' : `Boss ${numeroJefe}`) : f.apodo}</small>
                  </span>
                  {numeroJefe > 0 && <Crown className="cf-hist-piso__corona" aria-hidden="true" />}
                  {estado === 'ganado' && (
                    <span className="cf-hist-piso__ko" aria-label="Ganado">
                      <Check aria-hidden="true" />
                    </span>
                  )}
                  {estado === 'actual' && (
                    <span className="cf-hist-piso__vos" style={{ '--cf-acento': yo.color } as CSSProperties} aria-label={`Vos: ${yo.nombre}`}>
                      <ImagenJuego src={yo.rutas.cara} alt="" tipo="cara" color={yo.color} />
                    </span>
                  )}
                </li>
              )
            })}
        </ol>

        <aside className="cf-hist-rival" aria-label="Tu próximo rival">
          <div className="cf-hist-rival__retrato" data-fijo={rival.retratoFijo ? '' : undefined}>
            <ImagenJuego src={rival.rutas.retrato} alt={rival.nombre} tipo="cuerpo" color={rival.color} prioridad />
          </div>
          <div className="cf-hist-rival__placa">
            <p className="cf-hist-rival__piso">
              {piso.jefe ? <Crown aria-hidden="true" /> : null}
              {piso.final ? 'Pelea final' : piso.jefe ? `Boss ${piso.numeroJefe} de ${ORDEN_JEFES.length}` : `Piso ${piso.indice + 1} de ${TOTAL_PISOS}`}
            </p>
            <h2 className="cf-hist-rival__nombre">{rival.nombre}</h2>
            <p className="cf-hist-rival__apodo">{textosJefe ? textosJefe.titulo : rival.apodo}</p>
            {fraseBarbero && !textosJefe && <p className="cf-hist-rival__frase">«{fraseBarbero}»</p>}
            <p className="cf-hist-rival__arena">
              <MapPin aria-hidden="true" />
              Arena {arena.nombre}
            </p>
            <button type="button" className="cf-btn cf-btn--grande cf-hist-rival__pelear" {...alTocar(onPelear)}>
              <Swords aria-hidden="true" />
              <span>¡A pelear!</span>
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
