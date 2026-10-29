'use client'

import { RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { LogoCorteFinal } from '@/components/juego/logo-corte-final'

export default function ErrorJuego({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[juego]', error)
  }, [error])

  return (
    <div className="cf-juego">
      <div className="cf-pantalla cf-arranque" role="alert">
        <LogoCorteFinal className="cf-arranque__logo" />
        <h1 className="cf-titulo cf-arranque__titulo">Se nos trabó la máquina</h1>
        <p className="cf-texto-suave">Pasó algo inesperado. Tocá para intentar de nuevo.</p>
        <button type="button" className="cf-btn cf-btn--grande" onClick={() => reset()}>
          <RotateCcw aria-hidden="true" />
          <span>Reintentar</span>
        </button>
      </div>
    </div>
  )
}
