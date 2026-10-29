'use client'

import { ChevronLeft, Lightbulb, RotateCcw } from 'lucide-react'
import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react'
import { ARENAS } from '@/lib/juego/arenas'
import { CARGA_MAX } from '@/lib/juego/tipos'
import type { RecursosJuego } from '@/lib/juego/tipos'
import type { EstadoPrecarga } from '@/lib/juego/ui/precarga'
import { TIPS } from '@/lib/juego/ui/textos'
import type { Eleccion } from '@/lib/juego/ui/tipos-ui'
import { IconoMaquina } from './iconos'
import { LogoCorteFinal } from './logo-corte-final'

const CADA_TIP_MS = 4200

/** Para que cada carga arranque con un consejo distinto. */
let siguienteTip = 0

export function PantallaCarga({
  precarga,
  eleccion,
  onListo,
  onReintentar,
  onVolver,
}: {
  precarga: EstadoPrecarga
  eleccion: Eleccion
  onListo: (recursos: RecursosJuego) => void
  onReintentar: () => void
  onVolver: () => void
}) {
  const [tip, setTip] = useState(() => siguienteTip % TIPS.length)
  const listo = useEffectEvent(onListo)
  const recursos = precarga.estado === 'listo' ? precarga.recursos : null
  const fallo = precarga.estado === 'error'

  useEffect(() => {
    if (recursos) listo(recursos)
  }, [recursos])

  useEffect(() => {
    const t = window.setInterval(() => {
      siguienteTip += 1
      setTip((n) => (n + 1) % TIPS.length)
    }, CADA_TIP_MS)
    return () => window.clearInterval(t)
  }, [])

  const progreso = Math.round(precarga.progreso * 100)
  const llenos = precarga.progreso * CARGA_MAX
  const tono = ARENAS[eleccion.arena].tono

  return (
    <section className="cf-pantalla cf-carga-pantalla" aria-busy={!fallo} style={{ '--cf-tono': tono } as CSSProperties}>
      <LogoCorteFinal className="cf-carga-pantalla__logo" />
      {fallo ? (
        <div className="cf-carga-pantalla__error" role="alert">
          <h2 className="cf-titulo cf-carga-pantalla__titulo">No pudimos cargar la pelea</h2>
          <p className="cf-texto-suave">Revisá la conexión y probá de nuevo.</p>
          <div className="cf-fila-botones">
            <button type="button" className="cf-btn" onClick={onReintentar}>
              <RotateCcw aria-hidden="true" />
              <span>Reintentar</span>
            </button>
            <button type="button" className="cf-btn cf-btn--sec" onClick={onVolver}>
              <ChevronLeft aria-hidden="true" />
              <span>Volver</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="cf-titulo cf-carga-pantalla__titulo">Calentando la máquina</h2>
          <div
            className="cf-carga-pantalla__barra"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progreso}
            aria-label="Cargando la pelea"
          >
            <span className="cf-carga-pantalla__icono" aria-hidden="true">
              <IconoMaquina />
            </span>
            <span className="cf-carga-pantalla__segs" aria-hidden="true">
              {Array.from({ length: CARGA_MAX }, (_, i) => (
                <span key={i}>
                  <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, llenos - i))})` }} />
                </span>
              ))}
            </span>
            <span className="cf-carga-pantalla__num">{progreso} %</span>
          </div>
          <p className="cf-tip" key={tip} aria-live="polite">
            <Lightbulb aria-hidden="true" />
            <span>{TIPS[tip]}</span>
          </p>
        </>
      )}
    </section>
  )
}
