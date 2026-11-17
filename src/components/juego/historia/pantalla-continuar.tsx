'use client'

import { LogOut, RotateCcw } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { esJefe, TOTAL_PISOS } from '@/lib/juego/historia/jefes'
import { TEXTOS_JEFES } from '@/lib/juego/historia/textos'
import { PERSONAJES } from '@/lib/juego/personajes'
import type { IdPersonaje } from '@/lib/juego/tipos'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { alTocar } from '@/lib/juego/ui/toque'
import { ImagenJuego } from '../imagen-juego'

/** «¿Continuar?» cuenta de 9 a 0. */
const DESDE = 9

/**
 * Perdió una pelea del torneo: «¿Continuar?» con la cuenta regresiva, el rival que se burla (un Boss
 * con su línea; un barbero con una de sus frases) y dos salidas: repetir esa pelea o salir. Salir (o
 * dejar que la cuenta llegue a 0) NO pierde el torneo: queda guardado en ese piso. Los botones andan
 * con el pulgar que venía de la pelea todavía apoyado (alTocar) y la pantalla no panea (historia.css).
 */
export function PantallaContinuar({
  rival,
  piso,
  derrotas,
  audio,
  onSi,
  onSalir,
}: {
  rival: IdPersonaje
  /** 0 = el de abajo. */
  piso: number
  /** Cuántas veces perdió en este piso (para no repetir siempre la misma frase). */
  derrotas: number
  audio: AudioSeguro
  onSi: () => void
  onSalir: () => void
}) {
  const ficha = PERSONAJES[rival]
  const [n, setN] = useState(DESDE)
  const salir = useEffectEvent(onSalir)
  const sonar = useEffectEvent(() => audio.ui('cuenta'))
  const linea = esJefe(rival)
    ? TEXTOS_JEFES[rival].victoria
    : ficha.frases.length > 0
      ? ficha.frases[(piso + derrotas) % ficha.frases.length]
      : null

  useEffect(() => {
    if (n < 0) {
      salir()
      return
    }
    sonar()
    const t = window.setTimeout(() => setN((v) => v - 1), 1000)
    return () => window.clearTimeout(t)
  }, [n])

  return (
    <section
      className="cf-pantalla cf-hist cf-hist-continuar"
      aria-label="¿Continuar?"
      style={{ '--cf-acento': ficha.color, '--cf-acento-2': ficha.colorSecundario } as CSSProperties}
    >
      <div className="cf-hist-continuar__retrato" data-fijo={ficha.retratoFijo ? '' : undefined} aria-hidden="true">
        <ImagenJuego src={ficha.rutas.retrato} alt="" tipo="cuerpo" color={ficha.color} prioridad />
      </div>
      <div className="cf-hist-continuar__contenido">
        {linea && (
          <p className="cf-hist-continuar__frase">
            <b>{ficha.nombre}:</b> «{linea}»
          </p>
        )}
        <h1 className="cf-titulo cf-hist-continuar__titulo">¿Continuar?</h1>
        <p className="cf-hist-continuar__cuenta" key={n} aria-live="off" aria-hidden="true">
          {Math.max(0, n)}
        </p>
        <div className="cf-hist-continuar__botones">
          <button type="button" className="cf-btn cf-btn--grande" {...alTocar(onSi)} autoFocus>
            <RotateCcw aria-hidden="true" />
            <span>Sí, otra vez</span>
          </button>
          <button type="button" className="cf-btn cf-btn--sec" {...alTocar(onSalir)}>
            <LogOut aria-hidden="true" />
            <span>Salir</span>
          </button>
        </div>
        <p className="cf-hist-continuar__nota">
          Tu torneo queda guardado en este celular: piso {piso + 1} de {TOTAL_PISOS}.
        </p>
      </div>
    </section>
  )
}
