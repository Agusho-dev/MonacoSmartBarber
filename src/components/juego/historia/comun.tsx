'use client'

import { useEffect, useEffectEvent, useId, useState } from 'react'
import { prefiereMenosMovimiento } from '@/lib/juego/ui/media'

/**
 * La Máquina de Oro, el premio del torneo: una máquina de cortar parada, dorada, con la cuchilla
 * plateada y la corona de Monaco. SVG propio (sin emojis ni imágenes que bajar). Los degradés llevan
 * un id único por instancia (useId): la intro y el campeón la dibujan a la vez en la cortina.
 */
export function MaquinaDeOro({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const cuerpo = `mo-cuerpo-${id}`
  const hoja = `mo-hoja-${id}`
  return (
    <svg className={className} viewBox="0 0 120 220" role="img" aria-label="La Máquina de Oro">
      <defs>
        <linearGradient id={cuerpo} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#6b3d00" />
          <stop offset="0.3" stopColor="#ffd45a" />
          <stop offset="0.48" stopColor="#fff6cf" />
          <stop offset="0.66" stopColor="#e3a400" />
          <stop offset="1" stopColor="#5c3300" />
        </linearGradient>
        <linearGradient id={hoja} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#c9ced6" />
          <stop offset="1" stopColor="#5f6570" />
        </linearGradient>
      </defs>
      {/* los dientes de la cuchilla */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={24 + i * 7.4} y={3} width={4.2} height={14} rx={1.2} fill={`url(#${hoja})`} stroke="#2a1a00" strokeWidth={1.5} />
      ))}
      <rect x={20} y={14} width={80} height={22} rx={4} fill={`url(#${hoja})`} stroke="#2a1a00" strokeWidth={3.5} />
      {/* el cuerpo */}
      <path d="M25 36 H95 L89 186 Q87 210 63 210 H57 Q33 210 31 186 Z" fill={`url(#${cuerpo})`} stroke="#2a1a00" strokeWidth={4} />
      <path d="M40 48 L36 182" stroke="rgba(255,255,255,0.7)" strokeWidth={5} strokeLinecap="round" />
      {/* el interruptor */}
      <rect x={50} y={66} width={20} height={36} rx={9} fill="#2a1a00" />
      <rect x={54} y={71} width={12} height={15} rx={5} fill="#ffe28a" />
      {/* la corona de Monaco */}
      <path d="M43 140 L50 151 L60 134 L70 151 L77 140 L74 164 H46 Z" fill="#2a1a00" opacity={0.78} />
      <rect x={46} y={168} width={28} height={5} rx={2} fill="#2a1a00" opacity={0.78} />
    </svg>
  )
}

/**
 * Un texto que aparece letra por letra (los diálogos de los Bosses). `completo` lo muestra entero
 * de una (el toque que apura). Con «reducir movimiento», entero desde el principio. Avisa una vez
 * cuando terminó de escribirse.
 */
export function TextoQueSeEscribe({
  texto,
  completo,
  alTerminar,
  msPorLetra = 24,
}: {
  texto: string
  completo: boolean
  alTerminar?: () => void
  msPorLetra?: number
}) {
  const [n, setN] = useState(0)
  const terminar = useEffectEvent(() => alTerminar?.())
  const total = texto.length
  const visibles = completo || prefiereMenosMovimiento() ? total : Math.min(n, total)

  useEffect(() => {
    if (completo || prefiereMenosMovimiento()) return
    const t = window.setInterval(() => setN((v) => (v >= total ? v : v + 1)), msPorLetra)
    return () => window.clearInterval(t)
  }, [completo, total, msPorLetra])

  const listo = visibles >= total
  useEffect(() => {
    if (listo) terminar()
  }, [listo])

  return (
    <span className="cf-hist-escribe">
      <span>{texto.slice(0, visibles)}</span>
      {/* El resto ocupa su lugar sin verse: el globo no cambia de alto mientras se escribe. */}
      <span aria-hidden="true" className="cf-hist-escribe__resto">
        {texto.slice(visibles)}
      </span>
    </span>
  )
}

/** «12 min», «45 s»: el tiempo de pelea del torneo. */
export function duracionCorta(segundos: number): string {
  if (segundos < 60) return `${Math.max(0, Math.round(segundos))} s`
  const m = Math.round(segundos / 60)
  return `${m} min`
}
