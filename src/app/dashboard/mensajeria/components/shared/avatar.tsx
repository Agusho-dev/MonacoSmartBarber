'use client'

import { Instagram } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { initials, avatarColor, esEtiquetaDeTelefono } from './helpers'

// La foto de un contacto, como en WhatsApp: la de perfil si la hay (Instagram);
// si no, las iniciales sobre un color; y para un contacto sin nombre (WhatsApp
// lo muestra con su número), la silueta gris.
//
// `size` va en px. Tailwind v4 genera sólo las clases que aparecen escritas
// enteras en el código: un `size-${n}` armado en tiempo de ejecución no existe
// si nadie más escribió esa misma clase, y el círculo se queda sin tamaño (y un
// scale() lo agranda borroso). Por eso cada tamaño tiene sus clases literales
// acá. Para cambiarlo por breakpoint, `className` las pisa (`lg:size-12
// lg:text-[18px]`).
export type LadoAvatar = 32 | 36 | 40 | 44 | 48 | 52 | 56 | 96

const LADO: Record<LadoAvatar, { caja: string; texto: string; icono: string }> = {
  32: { caja: 'size-8', texto: 'text-xs', icono: 'size-3.5' },
  36: { caja: 'size-9', texto: 'text-sm', icono: 'size-4' },
  40: { caja: 'size-10', texto: 'text-sm', icono: 'size-4' },
  44: { caja: 'size-11', texto: 'text-[17px]', icono: 'size-5' },
  // De 44 para arriba las iniciales van al ~38 % del lado, como los monogramas de iOS.
  48: { caja: 'size-12', texto: 'text-[18px]', icono: 'size-6' },
  52: { caja: 'size-13', texto: 'text-[20px]', icono: 'size-6' },
  56: { caja: 'size-14', texto: 'text-[21px]', icono: 'size-7' },
  96: { caja: 'size-24', texto: 'text-[36px]', icono: 'size-12' },
}

/**
 * La silueta gris de WhatsApp: la foto de un contacto sin nombre ni foto. Llena
 * su caja; el círculo (y el recorte de los hombros) lo pone quien la contiene.
 */
export function SiluetaContacto({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn('size-full', className)}>
      <circle cx="50" cy="39" r="19" fill="currentColor" />
      <path d="M13 100c0-21.5 16.6-37 37-37s37 15.5 37 37z" fill="currentColor" />
    </svg>
  )
}

export function Avatar({
  name,
  size = 40,
  avatarUrl,
  silueta = false,
  className,
}: {
  name: string
  size?: LadoAvatar
  avatarUrl?: string | null
  /**
   * La silueta gris aunque haya nombre. Sin esto sale sola cuando el "nombre"
   * es un teléfono o no hay nombre ("Sin nombre").
   */
  silueta?: boolean
  /** Para cambiar el tamaño por breakpoint (`lg:size-12 lg:text-[18px]`). */
  className?: string
}) {
  const lado = LADO[size]

  // Foto de perfil real (IG profile_pic). Si falla la carga (URL expirada,
  // hotlink bloqueado), caemos al avatar de iniciales/ícono. Guardamos la URL
  // que falló (no un bool) para resetear solo al cambiar de avatar, sin useEffect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <div className={cn(lado.caja, 'shrink-0 overflow-hidden rounded-full bg-[var(--wa-raised-2)]', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(avatarUrl)}
        />
      </div>
    )
  }

  const isIgFallback = name === 'Usuario de Instagram' || /^\d{10,}$/.test(name)
  if (isIgFallback) {
    return (
      <div
        className={cn(
          lado.caja,
          'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white',
          className,
        )}
      >
        <Instagram aria-hidden className={lado.icono} />
      </div>
    )
  }

  if (silueta || !name.trim() || name === 'Sin nombre' || esEtiquetaDeTelefono(name)) {
    return (
      <div
        className={cn(
          lado.caja,
          'shrink-0 overflow-hidden rounded-full bg-[var(--wa-raised-2)] text-[var(--wa-text-3)]',
          className,
        )}
      >
        <SiluetaContacto />
      </div>
    )
  }

  return (
    <div
      className={cn(
        lado.caja,
        lado.texto,
        avatarColor(name),
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </div>
  )
}
