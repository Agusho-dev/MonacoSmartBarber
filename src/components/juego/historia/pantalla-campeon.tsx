'use client'

import { Crown, Home, RotateCcw } from 'lucide-react'
import { useEffect, type CSSProperties } from 'react'
import { TEXTOS_JEFES, finalDe } from '@/lib/juego/historia/textos'
import type { Campeon } from '@/lib/juego/historia/torre'
import { espejarRetrato, PERSONAJES } from '@/lib/juego/personajes'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { NOMBRE_DIFICULTAD } from '@/lib/juego/ui/textos'
import { alTocar } from '@/lib/juego/ui/toque'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { ImagenJuego } from '../imagen-juego'
import { MaquinaDeOro, duracionCorta } from './comun'

/** El papel picado: 28 tiras con lugar, color y demora fijos (nada al azar en el render). */
const CONFETI = Array.from({ length: 28 }, (_, i) => ({
  x: (i * 37) % 100,
  demora: ((i * 53) % 100) / 40,
  dur: 2.6 + ((i * 29) % 10) / 6,
  giro: (i * 47) % 360,
  color: ['#f5b301', '#fff3a8', '#ff6a00', '#ffffff', '#ffd45a'][i % 5],
}))

/**
 * Le ganó a Tony: el final del torneo. El barbero con la Máquina de Oro, lo que dice Tony al caer,
 * el final propio de ese barbero (textos.ts), cómo lo ganó y la galería de campeones del celular.
 */
export function PantallaCampeon({
  campeon,
  campeones,
  audio,
  onInicio,
  onOtro,
}: {
  campeon: Campeon
  campeones: readonly Campeon[]
  audio: AudioSeguro
  onInicio: () => void
  onOtro: () => void
}) {
  const ficha = PERSONAJES[campeon.id]
  const ids = [...new Set(campeones.map((c) => c.id))]

  useEffect(() => {
    audio.ui('vs')
    vibrar([80, 60, 80, 60, 240])
  }, [audio])

  return (
    <section
      className="cf-pantalla cf-hist cf-hist-campeon"
      aria-label={`¡Campeón del Torneo de Monaco: ${ficha.nombre}!`}
      style={{ '--cf-acento': ficha.color, '--cf-acento-2': ficha.colorSecundario } as CSSProperties}
    >
      <div className="cf-hist-campeon__rayos" aria-hidden="true" />
      <div className="cf-hist-confeti" aria-hidden="true">
        {CONFETI.map((c, i) => (
          <span
            key={i}
            style={{ '--x': `${c.x}%`, '--demora': `${c.demora}s`, '--dur': `${c.dur}s`, '--giro': `${c.giro}deg`, background: c.color } as CSSProperties}
          />
        ))}
      </div>

      <div className="cf-hist-campeon__desliza">
        <p className="cf-hist-campeon__sobre">
          <Crown aria-hidden="true" />
          El Torneo de Monaco
        </p>
        <h1 className="cf-titulo cf-hist-campeon__titulo">¡Campeón!</h1>

        <div className="cf-hist-campeon__escena" aria-hidden="true">
          <div className="cf-hist-campeon__retrato" data-fijo={ficha.retratoFijo ? '' : undefined}>
            <ImagenJuego src={ficha.rutas.retrato} alt="" tipo="cuerpo" color={ficha.color} espejar={espejarRetrato(ficha)} prioridad />
          </div>
          <MaquinaDeOro className="cf-hist-campeon__maquina" />
        </div>

        <p className="cf-hist-campeon__nombre">
          <b>{ficha.nombre}</b> «{ficha.apodo}» se lleva la Máquina de Oro
        </p>
        <p className="cf-hist-dialogo cf-hist-dialogo--chico">
          <b>Tony:</b> «{TEXTOS_JEFES.tony.derrota}»
        </p>
        <p className="cf-hist-campeon__final">{finalDe(ficha.id, ficha.nombre)}</p>

        <dl className="cf-hist-campeon__datos">
          <div>
            <dt>Dificultad</dt>
            <dd>{NOMBRE_DIFICULTAD[campeon.dificultad]}</dd>
          </div>
          <div>
            <dt>Reintentos</dt>
            <dd>{campeon.reintentos}</dd>
          </div>
          <div>
            <dt>Peleando</dt>
            <dd>{duracionCorta(campeon.segundos)}</dd>
          </div>
        </dl>

        {ids.length > 0 && (
          <div className="cf-hist-campeon__galeria">
            <p className="cf-rotulo">Tus campeones</p>
            <ul>
              {ids.map((id) => {
                const f = PERSONAJES[id]
                return (
                  <li key={id} style={{ '--cf-acento': f.color } as CSSProperties} data-nuevo={id === campeon.id ? '' : undefined}>
                    <ImagenJuego src={f.rutas.cara} alt={f.nombre} tipo="cara" color={f.color} />
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="cf-hist-campeon__botones">
          {/* Sin autoFocus: el foco desplazaba la pantalla hasta abajo y se perdía el principio. */}
          <button type="button" className="cf-btn cf-btn--grande" {...alTocar(onInicio)}>
            <Home aria-hidden="true" />
            <span>Volver al inicio</span>
          </button>
          <button type="button" className="cf-btn cf-btn--sec" {...alTocar(onOtro)}>
            <RotateCcw aria-hidden="true" />
            <span>Otro torneo</span>
          </button>
        </div>
      </div>
    </section>
  )
}
