'use client'

import { Check, Swords, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { DESAFIO_MS } from '@/lib/juego/online/sala'
import type { AudioSeguro } from '@/lib/juego/ui/audio-seguro'
import { alTocar } from '@/lib/juego/ui/toque'
import { vibrar } from '@/lib/juego/ui/vibrar'
import { Capa } from '../capa'

/**
 * Alguien de la sala te desafía: ACEPTAR / AHORA NO con 15 s de reloj. En el medio de una
 * pelea contra la CPU es un cartel arriba (no la tapa): aceptar termina esa pelea. Los botones
 * van con alTocar (con el pulgar en el stick, Chrome no genera click para el segundo dedo) y el
 * modal con `Capa` (touch-action: none salvo que no entre).
 */
export function DesafioEntrante({
  nombre,
  banner,
  audio,
  onAceptar,
  onRechazar,
}: {
  nombre: string
  banner: boolean
  audio: AudioSeguro
  onAceptar: () => void
  onRechazar: () => void
}) {
  const [restante, setRestante] = useState(Math.round(DESAFIO_MS / 1000))

  useEffect(() => {
    vibrar([90, 60, 90, 60, 160], true)
    audio.ui('vs')
    const inicio = Date.now()
    const t = window.setInterval(() => {
      setRestante(Math.max(0, Math.ceil((DESAFIO_MS - (Date.now() - inicio)) / 1000)))
    }, 250)
    return () => window.clearInterval(t)
  }, [audio])

  const estiloReloj = { '--cf-desafio-ms': `${DESAFIO_MS}ms` } as CSSProperties

  if (banner) {
    return (
      <div className="cf-desafio-banner" role="alertdialog" aria-labelledby="cf-desafio-titulo" style={estiloReloj}>
        <span className="cf-desafio-banner__icono" aria-hidden="true">
          <Swords />
        </span>
        <p id="cf-desafio-titulo" className="cf-desafio-banner__texto">
          <b>{nombre}</b> te desafía
          <span className="cf-desafio-banner__nota">Si aceptás, se termina esta pelea</span>
        </p>
        <div className="cf-desafio-banner__botones">
          <button type="button" className="cf-desafio-banner__si" {...alTocar(onAceptar)}>
            <Check aria-hidden="true" />
            <span>Aceptar</span>
          </button>
          <button type="button" className="cf-desafio-banner__no" {...alTocar(onRechazar)} aria-label="Ahora no">
            <X aria-hidden="true" />
          </button>
        </div>
        <span className="cf-desafio-reloj" aria-hidden="true" />
      </div>
    )
  }

  return (
    <Capa className="cf-desafio-capa" rol="alertdialog" titulo="cf-desafio-titulo">
      <div className="cf-desafio" style={estiloReloj}>
        <span className="cf-desafio__rayos" aria-hidden="true" />
        <span className="cf-desafio__icono" aria-hidden="true">
          <Swords />
        </span>
        <p className="cf-desafio__rotulo">Desafío</p>
        <h2 id="cf-desafio-titulo" className="cf-desafio__nombre">
          {nombre}
        </h2>
        <p className="cf-desafio__bajada">te desafía a pelear</p>
        <div className="cf-desafio__tiempo" aria-live="off">
          <span className="cf-desafio-reloj" aria-hidden="true" />
          <span className="cf-desafio__segundos">{restante} s</span>
        </div>
        <div className="cf-desafio__botones">
          <button type="button" className="cf-btn cf-btn--grande cf-desafio__aceptar" {...alTocar(onAceptar)} autoFocus>
            <Swords aria-hidden="true" />
            <span>Aceptar</span>
          </button>
          <button type="button" className="cf-btn cf-btn--sec cf-desafio__rechazar" {...alTocar(onRechazar)}>
            <span>Ahora no</span>
          </button>
        </div>
      </div>
    </Capa>
  )
}
