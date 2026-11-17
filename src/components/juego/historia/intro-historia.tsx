'use client'

import { ChevronRight, Crown } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { ORDEN_JEFES, TOTAL_PISOS, PISOS_BARBEROS } from '@/lib/juego/historia/jefes'
import { INTRO, type Vineta } from '@/lib/juego/historia/textos'
import { IDS_PARA_CLIENTES, PERSONAJES, espejarRetrato } from '@/lib/juego/personajes'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { alTocar } from '@/lib/juego/ui/toque'
import { ImagenJuego } from '../imagen-juego'
import { MaquinaDeOro } from './comun'

/**
 * La intro del modo historia: 4 viñetas de historieta («El Torneo de Monaco»). Se ve la primera vez
 * (después, desde la torre con «Ver la historia»). Toda la pantalla avanza; «Omitir» salta al final.
 * Con el teclado: Enter, espacio o → avanzan; Escape omite.
 */
export function IntroHistoria({ audio, onTerminar }: { audio: AudioSeguro; onTerminar: () => void }) {
  const [i, setI] = useState(0)
  const v = INTRO[i]
  const ultima = i === INTRO.length - 1

  const avanzar = () => {
    if (ultima) {
      audio.ui('confirmar')
      onTerminar()
      return
    }
    audio.ui('tocar')
    setI((n) => Math.min(INTRO.length - 1, n + 1))
  }
  const omitir = () => {
    audio.ui('atras')
    onTerminar()
  }
  const conTecla = useEffectEvent((codigo: string) => {
    if (codigo === 'Escape') omitir()
    else avanzar()
  })

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Escape') conTecla('Escape')
      else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'NumpadEnter') {
        e.preventDefault()
        conTecla(e.code)
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [])

  return (
    <section className="cf-pantalla cf-hist cf-hist-intro" data-escena={v.escena} aria-label="El Torneo de Monaco">
      <div className="cf-hist-intro__escena" key={`e${i}`} aria-hidden="true">
        <Escena vineta={v} />
      </div>
      {/* Toda la pantalla avanza (los botones de abajo van por encima). */}
      <button type="button" className="cf-hist-intro__tocar" aria-label={ultima ? 'Elegir barbero' : 'Siguiente'} {...alTocar(avanzar)} />

      <div className="cf-hist-intro__vineta" key={`t${i}`}>
        <p className="cf-hist-intro__numero" aria-hidden="true">
          {i + 1}/{INTRO.length}
        </p>
        <h1 className="cf-titulo cf-hist-intro__titulo">{v.titulo}</h1>
        <p className="cf-hist-intro__texto">{v.texto}</p>
      </div>

      <div className="cf-hist-intro__pie">
        <div className="cf-hist-puntos" aria-hidden="true">
          {INTRO.map((_, k) => (
            <span key={k} data-activo={k === i ? '' : undefined} data-visto={k < i ? '' : undefined} />
          ))}
        </div>
        <div className="cf-hist-intro__botones">
          {!ultima && (
            <button type="button" className="cf-btn cf-btn--sec" {...alTocar(omitir)}>
              Omitir
            </button>
          )}
          <button type="button" className="cf-btn" {...alTocar(avanzar)}>
            {ultima ? <Crown aria-hidden="true" /> : null}
            <span>{ultima ? 'Elegir barbero' : 'Seguir'}</span>
            {ultima ? null : <ChevronRight aria-hidden="true" />}
          </button>
        </div>
      </div>
    </section>
  )
}

function Escena({ vineta }: { vineta: Vineta }) {
  if (vineta.escena === 'plantel') {
    return (
      <div className="cf-hist-mosaico">
        {IDS_PARA_CLIENTES.map((id, k) => {
          const f = PERSONAJES[id]
          return (
            <span key={id} className="cf-hist-mosaico__cara" style={{ '--k': k, '--cf-acento': f.color } as CSSProperties}>
              <ImagenJuego src={f.rutas.cara} alt="" tipo="cara" color={f.color} />
            </span>
          )
        })}
      </div>
    )
  }
  if (vineta.escena === 'maquina') {
    return (
      <div className="cf-hist-premio">
        <span className="cf-hist-premio__rayos" />
        <MaquinaDeOro className="cf-hist-premio__maquina" />
      </div>
    )
  }
  if (vineta.escena === 'jefes') {
    return (
      <div className="cf-hist-cuatro">
        {ORDEN_JEFES.map((id, k) => {
          const f = PERSONAJES[id]
          return (
            <div key={id} className="cf-hist-cuatro__jefe" data-final={k === ORDEN_JEFES.length - 1 ? '' : undefined} style={{ '--k': k, '--cf-acento': f.color } as CSSProperties}>
              <div className="cf-hist-cuatro__retrato">
                <ImagenJuego src={f.rutas.retrato} alt="" tipo="cuerpo" color={f.color} espejar={espejarRetrato(f, k < 2)} />
              </div>
              <span className="cf-hist-cuatro__nombre">{f.nombre}</span>
            </div>
          )
        })}
      </div>
    )
  }
  // La torre: los pisos se apilan de abajo hacia arriba; los de los Bosses, dorados.
  return (
    <div className="cf-hist-maqueta">
      {Array.from({ length: TOTAL_PISOS }, (_, k) => TOTAL_PISOS - 1 - k).map((p) => (
        <span key={p} className="cf-hist-maqueta__piso" data-jefe={p >= PISOS_BARBEROS ? '' : undefined} style={{ '--k': p } as CSSProperties}>
          {p + 1}
        </span>
      ))}
    </div>
  )
}
