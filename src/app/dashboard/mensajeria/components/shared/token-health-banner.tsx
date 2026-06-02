'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { checkMetaTokenHealth, type MetaTokenHealth } from '@/lib/actions/messaging-health'

// Banner que avisa cuando un token de Meta (IG/WA) venció o es inválido, para
// que el dueño reconecte ANTES de que sigan fallando envíos en silencio.
export function TokenHealthBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [health, setHealth] = useState<MetaTokenHealth | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // No bloquea el render del inbox: se chequea después de montar.
    checkMetaTokenHealth().then(h => { if (!cancelled) setHealth(h) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!health || dismissed) return null

  const broken: string[] = []
  if (health.instagram.configured && !health.instagram.valid) broken.push('Instagram')
  if (health.whatsapp.configured && !health.whatsapp.valid) broken.push('WhatsApp')
  if (broken.length === 0) return null

  const expired = (health.instagram.configured && health.instagram.expired) || (health.whatsapp.configured && health.whatsapp.expired)
  const platforms = broken.join(' y ')

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border-b border-red-500/30 text-red-300">
      <AlertTriangle className="size-4 shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <span className="font-semibold">
          {expired ? `La conexión con ${platforms} venció.` : `Hay un problema con la conexión de ${platforms}.`}
        </span>{' '}
        <span className="text-red-300/90">
          No se están enviando mensajes ni actualizando perfiles. Reconectá para reactivar.
        </span>
      </div>
      <button
        onClick={onOpenSettings}
        className="shrink-0 h-7 px-3 rounded-md bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
      >
        Reconectar
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 size-6 rounded-md flex items-center justify-center text-red-300/70 hover:bg-red-500/20 hover:text-red-200 transition-colors"
        title="Ocultar"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
