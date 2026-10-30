'use client'

import Image from 'next/image'
import { createContext, use, useState } from 'react'

/**
 * Las rutas que se sabe que NO existen (en desarrollo, los sprites que todavía no llegaron;
 * ver src/app/juego/recursos-faltantes.ts): se dibuja la silueta sin pedir nada.
 */
export const RecursosFaltantes = createContext<ReadonlySet<string>>(new Set())

/** Las que fallaron en esta visita: las demás copias (grilla, duelo, HUD) no las vuelven a pedir. */
const fallidas = new Set<string>()

type Tipo = 'cuerpo' | 'cara' | 'arena'

interface Props {
  src: string | null
  alt: string
  tipo: Tipo
  /** Acento del personaje para la silueta de reserva. */
  color?: string
  className?: string
  prioridad?: boolean
  /** Dar vuelta horizontal (el de la izquierda mira hacia el centro). */
  espejar?: boolean
  posicion?: string
  /** Otra imagen antes de la silueta (el retrato pelado que falta → el retrato de siempre). */
  alternativa?: string | null
}

/**
 * Imagen del juego (retrato, cara o arena) con reserva: si el archivo todavía no existe
 * o no carga, se dibuja una silueta con el color del personaje en vez de un ícono roto.
 * Sin optimizador de Next: el pixel art se ve tal cual.
 */
export function ImagenJuego({
  src: pedida,
  alt,
  tipo,
  color = '#8a8f99',
  className,
  prioridad,
  espejar,
  posicion,
  alternativa = null,
}: Props) {
  const [fallida, setFallida] = useState<string | null>(null)
  const faltantes = use(RecursosFaltantes)
  const sirve = (ruta: string | null): ruta is string =>
    !!ruta && fallida !== ruta && !faltantes.has(ruta) && !fallidas.has(ruta)
  const src = sirve(pedida) ? pedida : sirve(alternativa) ? alternativa : null
  if (!src) {
    return <Silueta tipo={tipo} color={color} className={className} espejar={espejar} />
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      draggable={false}
      loading={prioridad ? 'eager' : 'lazy'}
      className={className}
      sizes="100vw"
      style={{
        objectFit: tipo === 'arena' ? 'cover' : 'contain',
        objectPosition: posicion ?? (tipo === 'cuerpo' ? 'center bottom' : 'center'),
        transform: espejar ? 'scaleX(-1)' : undefined,
      }}
      onError={() => {
        fallidas.add(src)
        setFallida(src)
      }}
    />
  )
}

function Silueta({ tipo, color, className, espejar }: { tipo: Tipo; color: string; className?: string; espejar?: boolean }) {
  const estilo = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    transform: espejar ? 'scaleX(-1)' : undefined,
  } as const
  if (tipo === 'arena') {
    return (
      <svg className={className} style={estilo} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="160" height="90" fill="#141419" />
        <rect y="62" width="160" height="28" fill="#1e1d22" />
        <path d="M0 62 H160" stroke="#3a3842" strokeWidth="1" />
        <path d="M20 10 h120" stroke="#f5b301" strokeOpacity=".35" strokeWidth="2" />
        <path d="M74 26 l6 -8 6 8 6 -8 6 8" stroke="#ffffff" strokeOpacity=".35" strokeWidth="2" fill="none" />
      </svg>
    )
  }
  if (tipo === 'cara') {
    return (
      <svg className={className} style={estilo} viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="40" r="22" fill={color} fillOpacity=".55" />
        <path d="M12 100 C16 72 33 64 50 64 C67 64 84 72 88 100 Z" fill={color} fillOpacity=".4" />
      </svg>
    )
  }
  return (
    <svg
      className={className}
      style={estilo}
      viewBox="0 0 120 280"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
    >
      <circle cx="60" cy="30" r="22" fill={color} fillOpacity=".5" />
      <path
        d="M33 60 h54 l15 72 -12 5 -9 -40 v76 l7 102 h-20 l-8 -90 h-0 l-8 90 h-20 l7 -102 v-76 l-9 40 -12 -5 z"
        fill={color}
        fillOpacity=".38"
      />
    </svg>
  )
}
