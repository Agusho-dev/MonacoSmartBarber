'use client'

import { Instagram } from 'lucide-react'
import { useState } from 'react'
import { initials, avatarColor } from './helpers'
import { WhatsAppIcon } from './icons'

export function Avatar({ name, size = 10, avatarUrl }: { name: string; size?: number; platform?: string; avatarUrl?: string | null }) {
  const sz = `size-${size}`
  const text = size <= 8 ? 'text-xs' : 'text-sm'

  // Foto de perfil real (IG profile_pic). Si falla la carga (URL expirada,
  // hotlink bloqueado), caemos al avatar de iniciales/ícono. Guardamos la URL
  // que falló (no un bool) para resetear solo al cambiar de avatar, sin useEffect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <div className={`${sz} rounded-full overflow-hidden shrink-0 bg-muted`}>
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

  const isWaPhoneLabel = /^\+\d{10,}$/.test(name.replace(/\s/g, ''))
  const isIgFallback = name === 'Usuario de Instagram' || /^\d{10,}$/.test(name)
  const bgColor =
    isWaPhoneLabel ? 'bg-gradient-to-br from-emerald-600 to-green-700'
      : isIgFallback ? 'bg-gradient-to-br from-purple-500 to-pink-500'
        : avatarColor(name)
  return (
    <div className={`${sz} ${bgColor} rounded-full flex items-center justify-center text-white font-semibold ${text} shrink-0`}>
      {isIgFallback ? <Instagram className={size <= 8 ? 'size-3.5' : 'size-4'} />
        : isWaPhoneLabel ? <WhatsAppIcon className={size <= 8 ? 'size-3.5' : 'size-4'} />
          : initials(name)}
    </div>
  )
}
