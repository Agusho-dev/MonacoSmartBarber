'use client'

import { ArrowUp, Clock, Crown, Flame, Target } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { esJefe, PISOS_BARBEROS, TOTAL_PISOS } from '@/lib/juego/historia/jefes'
import { TEXTOS_JEFES } from '@/lib/juego/historia/textos'
import { espejarRetrato, PERSONAJES } from '@/lib/juego/personajes'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { porcentaje } from '@/lib/juego/ui/textos'
import type { ResultadoPelea } from '@/lib/juego/ui/tipos-ui'
import { alTocar } from '@/lib/juego/ui/toque'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { ImagenJuego } from '../imagen-juego'

/**
 * Ganó una pelea del torneo (menos la final, que va al campeón): «¡Piso superado!» o, contra un Boss,
 * «¡Boss derrotado!» con lo que dice al caer. El rival queda tirado (como en el resultado de siempre)
 * y abajo, «Seguir subiendo» vuelve a la torre, que sube un piso.
 */
export function VictoriaPiso({
  resultado,
  piso,
  audio,
  onSeguir,
}: {
  resultado: ResultadoPelea
  /** El piso que acaba de ganar (0 = el de abajo). */
  piso: number
  audio: AudioSeguro
  onSeguir: () => void
}) {
  const yo = PERSONAJES[resultado.eleccion.jugador]
  const rival = PERSONAJES[resultado.eleccion.rival]
  const jefe = esJefe(rival.id)
  const siguiente = piso + 1
  const textoSeguir =
    siguiente === TOTAL_PISOS - 1 ? 'A la pelea final' : siguiente === PISOS_BARBEROS ? 'Subir a los Bosses' : 'Seguir subiendo'
  const e = resultado.estadisticas

  useEffect(() => {
    audio.ui('puntos')
    vibrar(jefe ? [40, 60, 160] : 40)
  }, [audio, jefe])

  return (
    <section
      className="cf-pantalla cf-hist cf-hist-victoria"
      data-jefe={jefe ? '' : undefined}
      aria-label={jefe ? 'Boss derrotado' : 'Piso superado'}
      style={{ '--cf-acento': yo.color, '--cf-acento-2': yo.colorSecundario, '--cf-rival': rival.color } as CSSProperties}
    >
      <div className="cf-hist-victoria__rayos" aria-hidden="true" />
      <p className="cf-hist-victoria__piso">
        {jefe ? <Crown aria-hidden="true" /> : null}
        Piso {piso + 1} de {TOTAL_PISOS}
      </p>
      <h1 className="cf-titulo cf-hist-victoria__titulo">{jefe ? '¡Boss derrotado!' : '¡Piso superado!'}</h1>

      <div className="cf-hist-victoria__duelo" aria-hidden="true">
        <div className="cf-hist-victoria__yo" data-fijo={yo.retratoFijo ? '' : undefined}>
          <ImagenJuego src={yo.rutas.retrato} alt="" tipo="cuerpo" color={yo.color} espejar={espejarRetrato(yo)} prioridad />
        </div>
        <div className="cf-hist-victoria__rival" data-fijo={rival.retratoFijo ? '' : undefined}>
          <ImagenJuego src={rival.rutas.retrato} alt="" tipo="cuerpo" color={rival.color} />
        </div>
        <span className="cf-hist-victoria__ko">K.O.</span>
      </div>

      {jefe && (
        <p className="cf-hist-dialogo cf-hist-dialogo--chico">
          <b>{rival.nombre}:</b> «{TEXTOS_JEFES[rival.id as keyof typeof TEXTOS_JEFES].derrota}»
        </p>
      )}

      <ul className="cf-hist-victoria__datos">
        <li>
          <Clock aria-hidden="true" />
          <span>{resultado.duracionSeg} s</span>
        </li>
        <li>
          <Flame aria-hidden="true" />
          <span>Combo {e.comboMax}</span>
        </li>
        <li>
          <Target aria-hidden="true" />
          <span>{porcentaje(e.golpesAcertados, e.golpesIntentados)} % de precisión</span>
        </li>
      </ul>

      <button type="button" className="cf-btn cf-btn--grande cf-hist-victoria__seguir" {...alTocar(onSeguir)} autoFocus>
        <ArrowUp aria-hidden="true" />
        <span>{textoSeguir}</span>
      </button>
    </section>
  )
}
