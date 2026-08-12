'use client'

import Image from 'next/image'
import { User } from 'lucide-react'

/**
 * Foto del barbero, o su silueta.
 *
 * Vive en su propio archivo porque lo usan cuatro pantallas del turnero
 * —horarios, hoja de barberos, resumen del pie y confirmación—. Tenerlo en
 * `slot-step` obligaba a que la hoja importara del paso y el paso de la hoja:
 * un ciclo de imports.
 */
export function Avatar({
  url,
  name,
  size,
}: {
  url: string | null
  name: string
  size: number
}) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border"
      style={{
        width: size,
        height: size,
        backgroundColor: 'var(--t-surface-alt)',
        borderColor: 'var(--t-border)',
      }}
    >
      <User
        className="text-[var(--t-text-muted)]"
        style={{ width: size * 0.5, height: size * 0.5 }}
      />
    </span>
  )
}
