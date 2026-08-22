'use client'

// Vista previa "estilo iOS" de una notificación: cómo se va a ver en la pantalla
// bloqueada del cliente. Es ilustrativa (el sistema operativo decide el corte
// real del texto), pero alcanza para que el dueño vea si el título es largo o
// si el cuerpo se corta.

import { BellRing } from 'lucide-react'

interface Props {
  appName: string
  logoUrl: string | null
  title: string
  body: string
  imageUrl?: string | null
  /** Texto chiquito a la derecha del nombre (por defecto "ahora"). */
  cuando?: string
  compact?: boolean
}

export function NotificationPreview({ appName, logoUrl, title, body, imageUrl, cuando = 'ahora', compact }: Props) {
  const titulo = title.trim() || 'Título de la notificación'
  const cuerpo = body.trim() || 'Acá va el texto que ve el cliente. Corto y directo funciona mejor.'
  const vacio = !title.trim() && !body.trim()

  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(120%_80%_at_20%_0%,#2a2f3a_0%,#0b0d12_55%,#05060a_100%)] ${compact ? 'p-3' : 'p-4'} text-white shadow-xl`}>
      {/* Barra de estado + hora, como la pantalla bloqueada */}
      <div className="mb-3 flex items-center justify-between px-1 text-[10px] text-white/50">
        <span>{new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span>
        <span className="font-semibold tabular-nums text-white/70">9:41</span>
      </div>

      <div className={`flex gap-3 rounded-2xl bg-white/[0.92] ${compact ? 'p-2.5' : 'p-3'} text-black shadow-lg backdrop-blur`}>
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-black text-white">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <BellRing className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-black/55">{appName}</span>
            <span className="shrink-0 text-[10px] text-black/45">{cuando}</span>
          </div>
          <p className={`mt-0.5 truncate text-[13px] font-semibold leading-tight ${vacio ? 'text-black/40' : ''}`}>{titulo}</p>
          <p className={`mt-0.5 line-clamp-4 whitespace-pre-line text-[12.5px] leading-snug ${vacio ? 'text-black/40' : 'text-black/80'}`}>{cuerpo}</p>
        </div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="size-10 shrink-0 self-start rounded-lg object-cover" />
        )}
      </div>

      {imageUrl && !compact && (
        <div className="mt-2 overflow-hidden rounded-2xl bg-white/[0.92]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="max-h-40 w-full object-cover" />
        </div>
      )}
    </div>
  )
}
