'use client'

import { LoaderCircle, MapPin, Wifi } from 'lucide-react'
import { useEffect, useEffectEvent, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { IdPersonaje, Lado } from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { NOMBRE_DIFICULTAD } from '@/lib/juego/ui/textos'
import type { Eleccion } from '@/lib/juego/ui/tipos-ui'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { RayoVs } from './iconos'
import { ImagenJuego } from './imagen-juego'

/** Cuánto dura el VS (mientras tanto terminan de cargar los recursos). */
const DURACION_VS_MS = 2500

/** VS de una pelea online: a la izquierda el lado 0 (el que desafió), con los nombres de los dos. */
export interface VsOnline {
  personajes: [IdPersonaje, IdPersonaje]
  nombres: [string, string]
  lado: Lado
  /** El VS ya se vio y todavía falta el rival (carga o conexión). */
  esperando: boolean
}

export function PantallaVs({
  eleccion,
  rivalEsBarbero,
  audio,
  onListo,
  online,
}: {
  eleccion: Eleccion
  rivalEsBarbero: boolean
  audio: AudioSeguro
  onListo: () => void
  online?: VsOnline
}) {
  const jugador = PERSONAJES[online ? online.personajes[0] : eleccion.jugador]
  const rival = PERSONAJES[online ? online.personajes[1] : eleccion.rival]
  const arena = ARENAS[eleccion.arena]
  const etiquetas: [string, string] = online
    ? [online.nombres[0], online.nombres[1]]
    : ['Vos', rivalEsBarbero ? 'Tu barbero' : 'CPU']
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
          <span className="cf-vs__etiqueta" data-jugador={online ? '' : undefined}>
            {etiquetas[0]}
            {online?.lado === 0 && <span className="cf-vs__vos">Vos</span>}
          </span>
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
          <span className="cf-vs__etiqueta" data-jugador={online ? '' : undefined}>
            {etiquetas[1]}
            {online?.lado === 1 && <span className="cf-vs__vos">Vos</span>}
          </span>
          <span className="cf-vs__nombre">{rival.nombre}</span>
          <span className="cf-vs__apodo">{rival.apodo}</span>
        </div>
      </div>

      <div className="cf-vs__centro" aria-hidden="true">
        <RayoVs className="cf-vs__rayo" />
        <span className="cf-vs__letras">VS</span>
      </div>

      <p className="cf-vs__arena">
        {online ? <Wifi aria-hidden="true" /> : <MapPin aria-hidden="true" />}
        <span>
          Arena {arena.nombre} · {online ? 'Online' : NOMBRE_DIFICULTAD[eleccion.dificultad]}
        </span>
      </p>
      {online?.esperando && (
        <p className="cf-vs__esperando" role="status">
          <LoaderCircle className="cf-girando" aria-hidden="true" />
          <span>Esperando a {online.nombres[online.lado === 0 ? 1 : 0]}…</span>
        </p>
      )}
      <span className="cf-vs__destello" aria-hidden="true" />
    </section>
  )
}
