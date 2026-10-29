'use client'

import { MapPin } from 'lucide-react'
import { useEffect, useEffectEvent, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { NOMBRE_DIFICULTAD } from '@/lib/juego/ui/textos'
import type { Eleccion } from '@/lib/juego/ui/tipos-ui'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { RayoVs } from './iconos'
import { ImagenJuego } from './imagen-juego'

/** Cuánto dura el VS (mientras tanto terminan de cargar los recursos). */
const DURACION_VS_MS = 2500

export function PantallaVs({
  eleccion,
  rivalEsBarbero,
  audio,
  onListo,
}: {
  eleccion: Eleccion
  rivalEsBarbero: boolean
  audio: AudioSeguro
  onListo: () => void
}) {
  const jugador = PERSONAJES[eleccion.jugador]
  const rival = PERSONAJES[eleccion.rival]
  const arena = ARENAS[eleccion.arena]
  const listo = useEffectEvent(onListo)

  useEffect(() => {
    audio.ui('vs')
    vibrar(40)
    const t = window.setTimeout(() => listo(), DURACION_VS_MS)
    return () => window.clearTimeout(t)
  }, [audio])

  return (
    <section
      className="cf-pantalla cf-vs"
      aria-label={`${jugador.nombre} contra ${rival.nombre}`}
      style={
        {
          '--cf-c1': jugador.color,
          '--cf-c1b': jugador.colorSecundario,
          '--cf-c2': rival.color,
          '--cf-c2b': rival.colorSecundario,
        } as CSSProperties
      }
    >
      <div className="cf-vs__lado cf-vs__lado--1">
        <span className="cf-vs__lineas" aria-hidden="true" />
        <div className="cf-vs__retrato">
          <ImagenJuego src={jugador.rutas.retrato} alt="" tipo="cuerpo" color={jugador.color} espejar prioridad />
        </div>
        <div className="cf-vs__placa">
          <span className="cf-vs__etiqueta">Vos</span>
          <span className="cf-vs__nombre">{jugador.nombre}</span>
          <span className="cf-vs__apodo">{jugador.apodo}</span>
        </div>
      </div>

      <div className="cf-vs__lado cf-vs__lado--2">
        <span className="cf-vs__lineas" aria-hidden="true" />
        <div className="cf-vs__retrato">
          <ImagenJuego src={rival.rutas.retrato} alt="" tipo="cuerpo" color={rival.color} prioridad />
        </div>
        <div className="cf-vs__placa">
          <span className="cf-vs__etiqueta">{rivalEsBarbero ? 'Tu barbero' : 'CPU'}</span>
          <span className="cf-vs__nombre">{rival.nombre}</span>
          <span className="cf-vs__apodo">{rival.apodo}</span>
        </div>
      </div>

      <div className="cf-vs__centro" aria-hidden="true">
        <RayoVs className="cf-vs__rayo" />
        <span className="cf-vs__letras">VS</span>
      </div>

      <p className="cf-vs__arena">
        <MapPin aria-hidden="true" />
        <span>
          Arena {arena.nombre} · {NOMBRE_DIFICULTAD[eleccion.dificultad]}
        </span>
      </p>
      <span className="cf-vs__destello" aria-hidden="true" />
    </section>
  )
}
