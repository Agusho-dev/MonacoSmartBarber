'use client'

import { Instagram } from 'lucide-react'
import { initials, avatarColor } from './helpers'

export function Avatar({ name, size = 10, platform }: { name: string; size?: number; platform?: string }) {
  const sz = `size-${size}`
  const text = size <= 8 ? 'text-xs' : 'text-sm'
  const isIgFallback = name === 'Usuario de Instagram' || /^\d{10,}$/.test(name)
  const bgColor = isIgFallback ? 'bg-gradient-to-br from-purple-500 to-pink-500' : avatarColor(name)
  return (
    <div className={`${sz} ${bgColor} rounded-full flex items-center justify-center text-white font-semibold ${text} shrink-0`}>
      {isIgFallback ? <Instagram className={size <= 8 ? 'size-3.5' : 'size-4'} /> : initials(name)}
    </div>
  )
}
