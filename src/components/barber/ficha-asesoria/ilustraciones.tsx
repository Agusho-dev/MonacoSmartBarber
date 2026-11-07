'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import type { ClaveAltura, ClaveForma, ClaveZona } from '@/lib/asesoria/ficha'

/*
 * Dibujos de la ficha de asesoría: la cabeza de perfil (zonas craneales y altura
 * del fade) y las tres siluetas de la forma superior. SVG propio, a línea, con
 * los colores del panel (tinta grafito, piel marfil, fucsia = asesoría). Nada
 * de emojis (decisión del dueño).
 *
 * Mira a la DERECHA: la nariz adelante, la nuca atrás. Las coordenadas son de
 * un lienzo de 200 × 220.
 */

const SILUETA =
  'M70 214 C68 196 62 184 56 172 C42 156 34 132 36 108 C38 70 64 40 100 32 C130 26 152 40 158 64 C160 74 159 84 162 92 C163 96 161 100 163 104 C167 112 174 122 175 128 C176 132 170 134 165 134 C167 138 167 142 165 145 C167 149 166 153 162 155 C164 162 162 172 154 176 C142 182 128 182 120 184 C118 194 118 204 120 214 Z'

/** El pelo: todo lo que queda arriba y atrás de la línea de nacimiento (patilla, detrás de la oreja, nuca). */
const PELO =
  'M154 61 C146 66 140 76 136 86 C130 98 125 110 122 128 C114 132 104 137 95 143 C82 152 70 162 58 176 L0 180 L0 0 L200 0 L200 61 Z'

const OREJA = 'M100 104 C112 99 119 110 116 123 C114 133 106 139 99 134'

/** Dónde se dibuja cada particularidad craneal. Las dos del occipital comparten lugar. */
export const PUNTOS_CRANEO: Record<ClaveZona, { x: number; y: number }> = {
  entradas: { x: 150, y: 57 },
  cuspide_alta: { x: 90, y: 33 },
  pliegues_craneales: { x: 58, y: 62 },
  occipital_prominente: { x: 37, y: 110 },
  occipital_plano: { x: 37, y: 110 },
  mastoides: { x: 92, y: 146 },
  pliegues_nuca: { x: 60, y: 171 },
  orejas: { x: 108, y: 119 },
  nariz: { x: 172, y: 124 },
  menton_retraido: { x: 157, y: 171 },
}

/** Altura de la línea del fade (y del lienzo) para cada opción. */
const LINEA_FADE: Record<Exclude<ClaveAltura, 'tijera'>, number> = {
  high: 70,
  mid: 94,
  low: 118,
}

const CLASE_MOVIMIENTO_FADE =
  'motion-safe:transition-transform motion-safe:duration-[380ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]'

const TINTA = 'oklch(0.22 0.012 260)'
const PIEL = 'oklch(0.965 0.008 70)'
const FUCSIA = 'oklch(0.59 0.26 323)'

function OrejaYCara() {
  return (
    <>
      <path d={OREJA} fill={PIEL} stroke={TINTA} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M104 112 C109 112 110 120 106 124" fill="none" stroke={TINTA} strokeWidth={1.8} strokeLinecap="round" opacity={0.55} />
      <path d="M147 97 l7 0" stroke={TINTA} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M144 88 C148 85 154 85 158 87" fill="none" stroke={TINTA} strokeWidth={2.2} strokeLinecap="round" opacity={0.75} />
    </>
  )
}

/**
 * Cabeza de perfil con las particularidades craneales: cada zona es un punto que
 * se toca (área de 44 px o más) y se prende en fucsia. Lo mismo que los botones
 * de al lado, para el que piensa «acá, atrás» antes que en la palabra.
 */
export function CabezaZonas({
  elegidas,
  onTocar,
  deshabilitada = false,
  className,
}: {
  elegidas: readonly ClaveZona[]
  onTocar?: (zona: ClaveZona) => void
  deshabilitada?: boolean
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const prendida = new Set(elegidas)
  // Un punto por lugar: el del occipital representa a las dos opciones.
  const lugares: Array<{ zona: ClaveZona; x: number; y: number; activa: boolean; etiqueta: string }> = []
  for (const [zona, p] of Object.entries(PUNTOS_CRANEO) as Array<[ClaveZona, { x: number; y: number }]>) {
    if (zona === 'occipital_plano') continue
    const activa =
      zona === 'occipital_prominente'
        ? prendida.has('occipital_prominente') || prendida.has('occipital_plano')
        : prendida.has(zona)
    lugares.push({ zona, ...p, activa, etiqueta: zona })
  }
  const prominente = prendida.has('occipital_prominente')
  const plano = prendida.has('occipital_plano')

  return (
    <svg viewBox="0 0 200 220" className={cn('h-auto w-full select-none', className)} role="img" aria-label="Cabeza de perfil con las zonas marcadas">
      <defs>
        <clipPath id={`sil-${id}`}>
          <path d={SILUETA} />
        </clipPath>
      </defs>
      <path d={SILUETA} fill={PIEL} />
      <g clipPath={`url(#sil-${id})`}>
        <path d={PELO} fill={TINTA} opacity={0.13} />
      </g>
      <path d={SILUETA} fill="none" stroke={TINTA} strokeWidth={2.5} strokeLinejoin="round" />
      <OrejaYCara />

      {/* Occipital: la marca dice cuál de las dos. */}
      {prominente && (
        <path d="M33 86 C20 98 20 124 33 136" fill="none" stroke={FUCSIA} strokeWidth={3} strokeLinecap="round" strokeDasharray="5 4" className="ficha-trazo" />
      )}
      {plano && (
        <path d="M31 90 L31 132" fill="none" stroke={FUCSIA} strokeWidth={3} strokeLinecap="round" strokeDasharray="5 4" className="ficha-trazo" />
      )}

      {lugares.map((l) => (
        <g key={l.zona}>
          {l.activa && <circle cx={l.x} cy={l.y} r={13} fill={FUCSIA} opacity={0.2} className="ficha-zona-halo" />}
          <circle
            cx={l.x}
            cy={l.y}
            r={l.activa ? 6.5 : 4.5}
            fill={l.activa ? FUCSIA : PIEL}
            stroke={l.activa ? 'white' : FUCSIA}
            strokeWidth={l.activa ? 2 : 1.8}
            strokeDasharray={l.activa ? undefined : '2.2 2'}
            className="motion-safe:transition-[r] motion-safe:duration-200"
          />
          {onTocar && !deshabilitada && (
            // Área táctil grande e invisible (el punto mide pocos px en pantalla).
            <circle
              cx={l.x}
              cy={l.y}
              r={17}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => onTocar(l.zona)}
            />
          )}
        </g>
      ))}
    </svg>
  )
}

/**
 * Cabeza de perfil con la altura del fade: el pelo de arriba lleno y, desde la
 * línea, el degradé que baja hasta la piel. La línea sube y baja animada al
 * cambiar (transform: se anima con CSS). «Tijera» = sin degradé.
 */
export function CabezaFade({
  altura,
  onTocarAltura,
  className,
}: {
  altura: ClaveAltura | undefined
  onTocarAltura?: (altura: Exclude<ClaveAltura, 'tijera'>) => void
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const linea = altura && altura !== 'tijera' ? LINEA_FADE[altura] : null
  // Sin elegir: el pelo a medio tono y sin línea (todavía no se sabe).
  const opacidadPelo = altura ? 0.85 : 0.18

  return (
    <svg viewBox="0 0 200 220" className={cn('h-auto w-full select-none', className)} role="img" aria-label="Cabeza de perfil con la altura del fade">
      <defs>
        <clipPath id={`sil-${id}`}>
          <path d={SILUETA} />
        </clipPath>
        <clipPath id={`pelo-${id}`}>
          <path d={PELO} />
        </clipPath>
        {/* Del pelo (arriba) a la piel (abajo), en los primeros 46 px del rectángulo. */}
        <linearGradient id={`fade-${id}`} x1="0" y1="0" x2="0" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={PIEL} stopOpacity={0} />
          <stop offset="1" stopColor={PIEL} stopOpacity={1} />
        </linearGradient>
      </defs>
      <path d={SILUETA} fill={PIEL} />
      <g clipPath={`url(#sil-${id})`}>
        <path d={PELO} fill={TINTA} opacity={opacidadPelo} className="motion-safe:transition-opacity motion-safe:duration-300" />
        {/* La piel que sube desde abajo hasta la línea. Va sobre TODA la cabeza
            (la cara ya es piel): recortada sólo al pelo dejaba un filete oscuro
            en el borde del recorte. */}
        <g style={{ transform: `translateY(${linea ?? 240}px)` }} className={CLASE_MOVIMIENTO_FADE}>
          <rect x="0" y="0" width="200" height="240" fill={`url(#fade-${id})`} />
        </g>
        <g clipPath={`url(#pelo-${id})`}>
          <g style={{ transform: `translateY(${linea ?? 240}px)` }} className={CLASE_MOVIMIENTO_FADE}>
            <line x1="0" y1="0" x2="200" y2="0" stroke={FUCSIA} strokeWidth={2.6} strokeDasharray="6 5" opacity={linea === null ? 0 : 1} />
          </g>
        </g>
      </g>
      <path d={SILUETA} fill="none" stroke={TINTA} strokeWidth={2.5} strokeLinejoin="round" />
      <OrejaYCara />

      {onTocarAltura && (
        // Tocar la cabeza a una altura elige esa altura (arriba High, al medio Mid, abajo Low).
        <g clipPath={`url(#sil-${id})`}>
          <rect x="0" y="40" width="160" height="42" fill="transparent" className="cursor-pointer" onClick={() => onTocarAltura('high')} />
          <rect x="0" y="82" width="160" height="24" fill="transparent" className="cursor-pointer" onClick={() => onTocarAltura('mid')} />
          <rect x="0" y="106" width="160" height="60" fill="transparent" className="cursor-pointer" onClick={() => onTocarAltura('low')} />
        </g>
      )}
    </svg>
  )
}

/** Silueta de frente con la forma de arriba: cuadrada, redonda o triangular. */
export function SiluetaForma({ forma, className }: { forma: ClaveForma; className?: string }) {
  const pelo =
    forma === 'cuadrada'
      ? 'M18 46 L18 20 Q18 12 26 12 L54 12 Q62 12 62 20 L62 46 L57 46 L57 34 Q40 29 23 34 L23 46 Z'
      : forma === 'redonda'
        ? 'M18 46 C16 24 27 10 40 10 C53 10 64 24 62 46 L57 46 L57 35 Q40 28 23 35 L23 46 Z'
        : 'M18 46 C20 32 30 16 40 5 C50 16 60 32 62 46 L57 46 L57 35 Q40 29 23 35 L23 46 Z'
  return (
    <svg viewBox="0 0 80 88" className={cn('h-auto w-full', className)} aria-hidden>
      <path d={pelo} fill="currentColor" />
      <path d="M21 40 C20 62 30 78 40 80 C50 78 60 62 59 40" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
      <path d="M20 46 C14 44 13 56 20 58 M60 46 C66 44 67 56 60 58" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}
