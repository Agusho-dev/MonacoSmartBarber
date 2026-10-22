'use client'

// El cuerpo de Tex: el momento. Va grande en las escenas (estado vacío, Tex
// trabajando, resultado, error, conectar una cuenta) y sólo se anima al entrar.
// Nunca se turna con la cara en el mismo lugar: la gorra aparecería y
// desaparecería.
//
//   saludo  → estado vacío, presentación, página del titular
//   analiza → herramientas corriendo, diferencias de plata (cara seria, anteojos)
//   logro   → lista cerrada: la plata cuadra con todas las cuentas al día, se
//             conectó la última cuenta. Nunca ante una mala noticia.
//   ayuda   → error, falta la clave, conectar cuentas, sin permiso

import { cn } from '@/lib/utils'
import { srcPose, srcSetPose, TEX_POSE_ASPECTO, type TexPoseNombre } from './assets'

interface Props {
  pose: TexPoseNombre
  /** Alto en px. El ancho sale del dibujo. */
  alto: number
  /** 'suave' entra con un fade corto; 'logro' con un pequeño salto. */
  entrada?: 'suave' | 'logro' | null
  /** Halo azul detrás (sobre fondo oscuro el contorno se pierde sin él). */
  halo?: boolean
  /** Carga inmediata (la pose del estado vacío). */
  prioridad?: boolean
  className?: string
}

export function TexPose({ pose, alto, entrada = 'suave', halo = false, prioridad = false, className }: Props) {
  const ancho = Math.round(alto * TEX_POSE_ASPECTO[pose])
  const base = ancho <= 160 ? 160 : ancho <= 320 ? 320 : 640
  return (
    <span
      // key por pose: al cambiar de pose la entrada vuelve a correr.
      key={pose}
      aria-hidden
      className={cn(
        'inline-block shrink-0',
        halo && 'tex-escenario',
        entrada === 'suave' && 'tex-entra',
        entrada === 'logro' && 'tex-logro',
        className,
      )}
      style={{ width: ancho, height: alto }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="tex-pose"
        src={srcPose(pose, base)}
        srcSet={srcSetPose(pose)}
        sizes={`${ancho}px`}
        width={ancho}
        height={alto}
        alt=""
        decoding="async"
        loading={prioridad ? 'eager' : 'lazy'}
        fetchPriority={prioridad ? 'high' : undefined}
        draggable={false}
        style={{ width: ancho, height: alto }}
      />
    </span>
  )
}
