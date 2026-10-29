'use client'

import { useId } from 'react'

/**
 * Logo «CORTE FINAL»: CORTE en cromo, FINAL en oro, con una navaja abierta cruzada
 * por detrás. SVG puro (escala sin perder nada); el texto usa la fuente display del
 * juego y `textLength` para que el ancho no dependa de si la fuente ya cargó.
 */
export function LogoCorteFinal({ className, brillo = false }: { className?: string; brillo?: boolean }) {
  const base = useId().replace(/:/g, '')
  const id = (n: string) => `cf-${base}-${n}`
  const url = (n: string) => `url(#${id(n)})`

  const texto = (fill: string, extra?: { stroke?: string; strokeWidth?: number; dx?: number; dy?: number }) => (
    <g transform={`translate(${extra?.dx ?? 0} ${extra?.dy ?? 0})`}>
      <text
        x="300"
        y="132"
        textAnchor="middle"
        fontSize="132"
        textLength="420"
        lengthAdjust="spacingAndGlyphs"
        fill={fill}
        stroke={extra?.stroke}
        strokeWidth={extra?.strokeWidth}
        strokeLinejoin="round"
        paintOrder="stroke"
        className="cf-logo__texto"
      >
        CORTE
      </text>
      <text
        x="300"
        y="296"
        textAnchor="middle"
        fontSize="172"
        textLength="520"
        lengthAdjust="spacingAndGlyphs"
        fill={fill}
        stroke={extra?.stroke}
        strokeWidth={extra?.strokeWidth}
        strokeLinejoin="round"
        paintOrder="stroke"
        className="cf-logo__texto"
      >
        FINAL
      </text>
    </g>
  )

  return (
    <svg viewBox="0 0 600 330" className={className} role="img" aria-label="Corte Final">
      <defs>
        <linearGradient id={id('cromo')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.44" stopColor="#e6e9ee" />
          <stop offset="0.5" stopColor="#8d939e" />
          <stop offset="0.56" stopColor="#3c414a" />
          <stop offset="0.8" stopColor="#c9ced6" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id={id('oro')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset="0.4" stopColor="#ffd34d" />
          <stop offset="0.5" stopColor="#f5a300" />
          <stop offset="0.57" stopColor="#8f4a00" />
          <stop offset="0.82" stopColor="#ffc93a" />
          <stop offset="1" stopColor="#fff3b0" />
        </linearGradient>
        <linearGradient id={id('hoja')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6f9" />
          <stop offset="0.5" stopColor="#aab1bc" />
          <stop offset="0.52" stopColor="#5f6672" />
          <stop offset="1" stopColor="#e9ecf0" />
        </linearGradient>
        <linearGradient id={id('mango')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3a44" />
          <stop offset="0.5" stopColor="#15151b" />
          <stop offset="1" stopColor="#060608" />
        </linearGradient>
        <linearGradient id={id('brillo')} gradientUnits="userSpaceOnUse" x1="-320" y1="0" x2="-120" y2="60">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          {brillo && (
            <>
              <animate attributeName="x1" values="-320;-320;760" keyTimes="0;0.55;1" dur="4.2s" repeatCount="indefinite" />
              <animate attributeName="x2" values="-120;-120;960" keyTimes="0;0.55;1" dur="4.2s" repeatCount="indefinite" />
            </>
          )}
        </linearGradient>
      </defs>

      {/* La navaja, cruzada por detrás de las letras. */}
      <g transform="translate(300 174) rotate(-23)">
        <rect x="-306" y="-15" width="252" height="30" rx="15" fill={url('mango')} stroke="#000" strokeWidth="6" />
        <circle cx="-286" cy="0" r="5" fill={url('oro')} />
        <circle cx="-76" cy="0" r="5" fill={url('oro')} />
        <path d="M-60 -11 L-34 -13 L-34 13 L-60 11 Z" fill="#9aa1ac" stroke="#000" strokeWidth="4" />
        <path
          d="M-36 -20 L250 -31 C284 -31 302 -14 297 7 L289 25 L-36 19 Z"
          fill={url('hoja')}
          stroke="#000"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <path d="M-30 14 L285 20" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
        <path d="M-30 -15 L246 -25" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        <path
          className="cf-logo__destello"
          d="M292 -6 l5 -16 l5 16 l16 5 l-16 5 l-5 16 l-5 -16 l-16 -5 z"
          fill="#ffffff"
        />
      </g>

      <g transform="translate(26 0) skewX(-9)">
        {/* Extrusión dorada oscura (profundidad) */}
        {texto('#3b1d00', { dx: 7, dy: 8, stroke: '#000', strokeWidth: 14 })}
        {texto('#6b3a00', { dx: 4, dy: 4 })}
        {/* Cara principal con contorno: CORTE en cromo y, encima, FINAL en oro. */}
        {texto(url('cromo'), { stroke: '#050507', strokeWidth: 10 })}
        <text
          x="300"
          y="296"
          textAnchor="middle"
          fontSize="172"
          textLength="520"
          lengthAdjust="spacingAndGlyphs"
          fill={url('oro')}
          className="cf-logo__texto"
        >
          FINAL
        </text>
        {brillo && texto(url('brillo'))}
      </g>
    </svg>
  )
}
