import {
  Activity,
  Armchair,
  BicepsFlexed,
  BottleWine,
  Disc3,
  Drum,
  Flame,
  Glasses,
  HandGrab,
  HeartPulse,
  Martini,
  MicVocal,
  Motorbike,
  Music2,
  Scissors,
  Slice,
  Smartphone,
  SprayCan,
  Zap,
} from 'lucide-react'
import type { ReactNode, SVGProps } from 'react'
import type { IconoEspecial } from '@/lib/juego/tipos'

type PropsSvg = SVGProps<SVGSVGElement>

/** Un ícono propio con el trazo de lucide (24×24, línea de 2, puntas redondas). */
function Trazo({ children, ...props }: PropsSvg & { children: ReactNode }) {
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
      {children}
    </svg>
  )
}

/**
 * El ícono de cada especial: lucide cuando hay uno que lo dice bien, y si no, uno propio con el
 * mismo trazo (guante de box, pistola, graffiti, gorro chino, pelota, chilena, mamadera, pañal,
 * mate y termo). Sin emojis. Se usa en la ficha de la selección, en las cartas de la pelea y en
 * el tutorial.
 */
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
    case 'bombo':
      return <Drum aria-hidden="true" {...props} />
    case 'navaja':
      return <Slice aria-hidden="true" {...props} />
    case 'cura':
      return <HeartPulse aria-hidden="true" {...props} />
    case 'guante':
      return <IconoGuante {...props} />
    case 'moto':
      return <Motorbike aria-hidden="true" {...props} />
    case 'pistola':
      return <IconoPistola {...props} />
    case 'break':
      return <Disc3 aria-hidden="true" {...props} />
    case 'graffiti':
      return <IconoGraffiti {...props} />
    case 'trago':
      return <Martini aria-hidden="true" {...props} />
    case 'botella':
      return <BottleWine aria-hidden="true" {...props} />
    case 'baile':
      return <Music2 aria-hidden="true" {...props} />
    case 'grito':
      return <MicVocal aria-hidden="true" {...props} />
    case 'gorro':
      return <IconoGorro {...props} />
    case 'dragon':
      return <Flame aria-hidden="true" {...props} />
    case 'pelota':
      return <IconoPelota {...props} />
    case 'chilena':
      return <IconoChilena {...props} />
    case 'mamadera':
      return <IconoMamadera {...props} />
    case 'panal':
      return <IconoPanal {...props} />
    case 'mate':
      return <IconoMate {...props} />
    case 'termo':
      return <IconoTermo {...props} />
    case 'agarre':
      return <HandGrab aria-hidden="true" {...props} />
    case 'sismo':
      return <Activity aria-hidden="true" {...props} />
    default:
      return <Zap aria-hidden="true" {...props} />
  }
}

/**
 * El ícono del botón de la herramienta según su etiqueta (`ficha.herramientas[0]`): la máquina,
 * el celular de Fabri o el puño del «Remate» de los barberos sin herramienta propia.
 */
export function IconoHerramienta({ nombre, ...props }: { nombre: string } & PropsSvg) {
  const clave = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
  if (clave.startsWith('celular')) return <Smartphone aria-hidden="true" {...props} />
  if (clave.startsWith('anteojo')) return <Glasses aria-hidden="true" {...props} />
  if (clave.startsWith('remate') || clave.startsWith('golpe')) return <BicepsFlexed aria-hidden="true" {...props} />
  if (clave.startsWith('tijera')) return <Scissors aria-hidden="true" {...props} />
  return <IconoMaquina {...props} />
}

/** Máquina de cortar pelo, con el trazo de lucide (no existe en la librería). */
export function IconoMaquina(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M7.5 8.2h9l-1.15 11.5a2 2 0 0 1-2 1.8h-2.7a2 2 0 0 1-2-1.8z" />
      <path d="M6.4 8.2V5.3h11.2v2.9" />
      <path d="M8.6 5.3V2.8M10.9 5.3V2.8M13.1 5.3V2.8M15.4 5.3V2.8" />
      <path d="M12 11.6v3.1" />
    </Trazo>
  )
}

/** Guante de box (Modo Boxeador de Fabri). */
function IconoGuante(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M8 9.5V8a5 5 0 0 1 10 0v5.5a4.5 4.5 0 0 1-4.5 4.5H11a5 5 0 0 1-5-5v-1a2.5 2.5 0 0 1 4.5-1.5" />
      <path d="M10.5 11.5c1 .4 1.8 1.2 2 2.5" />
      <path d="M8.5 18v3.5h8V18" />
    </Trazo>
  )
}

/** Pistola de juguete (la ráfaga de Luciano). */
function IconoPistola(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M3 7h17v4h-8.5l-1 3H8.4L7 20H3.5l1.6-9H3z" />
      <path d="M10.5 14c-.2 1.4-1 2-2.3 2" />
      <path d="M20 9h1.5" />
    </Trazo>
  )
}

/** Mancha de aerosol que estalla (Graffiti Slam de Gabriel). */
function IconoGraffiti(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="m12 3 1.7 4.4 4.1-2.1-1.2 4.5 4.6.8-3.8 2.6 2.9 3.6-4.6-.3.3 4.7-3.6-3-2.5 3.9-1.2-4.6-4.2 2 1.6-4.4L3.4 12l4.2-2.2L5 6l4.5.9z" />
      <circle cx="12" cy="12.4" r="1.6" />
    </Trazo>
  )
}

/** Gorro chino que va y vuelve (Gorro Lanzador de Joaquín). */
function IconoGorro(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M2.5 15 12 5.5 21.5 15" />
      <path d="M2.5 15c2.9 1.7 6.1 2.5 9.5 2.5s6.6-.8 9.5-2.5" />
      <path d="M8.5 9l7 0" />
      <path d="M17 20.5a7 7 0 0 1-10 0" />
    </Trazo>
  )
}

/** Pelota de fútbol con las rayas de un tiro recto (Pelotazo de Nahuel). */
function IconoPelota(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <circle cx="14.5" cy="12" r="7" />
      <path d="m14.5 8.6 3.2 2.3-1.2 3.8h-4l-1.2-3.8z" fill="currentColor" />
      <path d="M14.5 8.6V5M17.7 10.9l3.4-1.1M16.5 14.7l2 2.8M12.5 14.7l-2 2.8M11.3 10.9l-3.4-1.1" />
      <path d="M2 9h3M1.5 12h3.5M2 15h3" />
    </Trazo>
  )
}

/** Pelota que baja de chilena: rayas en diagonal desde arriba (Chilena de Nahuel). */
function IconoChilena(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <circle cx="15" cy="15" r="6.5" />
      <path d="m15 11.8 3 2.2-1.1 3.5h-3.8L12 14z" fill="currentColor" />
      <path d="M15 11.8V8.5M18 14l3.1-1M16.9 17.5l1.9 2.6M13.1 17.5l-1.9 2.6M12 14l-3.1-1" />
      <path d="M3 3l4.5 4.5M7 2.5l3 3M2.5 7l3 3" />
    </Trazo>
  )
}

/** Mamadera (Mamadera a Presión de Lucas). */
function IconoMamadera(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M10.5 5.5 11 2.5h2l.5 3" />
      <path d="M8.5 5.5h7v2.5h-7z" />
      <path d="M9 8v10.5a3 3 0 0 0 3 3 3 3 0 0 0 3-3V8" />
      <path d="M9 12h2.5M9 15h2.5" />
    </Trazo>
  )
}

/** Pañal (Pañalazo de Lucas). */
function IconoPanal(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M3 5.5h18v4.2c-2.6.6-4.5 2.6-5 5.3L15.5 19h-7L8 15c-.5-2.7-2.4-4.7-5-5.3z" />
      <path d="M3 9.7h3.5V5.5M21 9.7h-3.5V5.5" />
      <path d="M10.5 12.5h3" />
    </Trazo>
  )
}

/** Mate con bombilla (Lluvia de Mates de Stefano). */
function IconoMate(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <path d="M6.5 10h10a7 7 0 0 1 1.5 4.4c0 3.6-2.7 6.6-6 6.6s-6-3-6-6.6A7 7 0 0 1 6.5 10z" />
      <path d="M5.8 13.5h12.4" />
      <path d="M12.5 12 16 3.5l2.5 1" />
    </Trazo>
  )
}

/** Termo con su pico (Termo de Agua Caliente de Stefano). */
function IconoTermo(props: PropsSvg) {
  return (
    <Trazo {...props}>
      <rect x="7" y="7" width="9" height="14.5" rx="2" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="M14 4.5h2.5l1 1.5" />
      <path d="M7 11h9" />
      <path d="M19.5 10.5c.9.8.9 1.7 0 2.5s-.9 1.7 0 2.5" />
    </Trazo>
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
