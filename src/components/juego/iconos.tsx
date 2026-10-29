import { Armchair, Scissors, SprayCan, Zap } from 'lucide-react'
import type { SVGProps } from 'react'
import type { IconoEspecial } from '@/lib/juego/tipos'

type PropsSvg = SVGProps<SVGSVGElement>

/** El ícono lucide de cada especial (rayo, tijera, sillón, spray). */
export function IconoDeEspecial({ icono, ...props }: { icono: IconoEspecial } & PropsSvg) {
  switch (icono) {
    case 'rayo':
      return <Zap aria-hidden="true" {...props} />
    case 'tijera':
      return <Scissors aria-hidden="true" {...props} />
    case 'sillon':
      return <Armchair aria-hidden="true" {...props} />
    case 'spray':
      return <SprayCan aria-hidden="true" {...props} />
  }
}

/** Máquina de cortar pelo, con el trazo de lucide (no existe en la librería). */
export function IconoMaquina(props: PropsSvg) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 8.2h9l-1.15 11.5a2 2 0 0 1-2 1.8h-2.7a2 2 0 0 1-2-1.8z" />
      <path d="M6.4 8.2V5.3h11.2v2.9" />
      <path d="M8.6 5.3V2.8M10.9 5.3V2.8M13.1 5.3V2.8M15.4 5.3V2.8" />
      <path d="M12 11.6v3.1" />
    </svg>
  )
}

/** El rayo del VS: un zigzag grueso, relleno. */
export function RayoVs(props: PropsSvg) {
  return (
    <svg viewBox="0 0 120 400" aria-hidden="true" {...props}>
      <path
        d="M78 0 L22 178 L58 182 L30 400 L100 150 L62 146 L96 0 Z"
        fill="currentColor"
        stroke="#fff"
        strokeWidth="6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
