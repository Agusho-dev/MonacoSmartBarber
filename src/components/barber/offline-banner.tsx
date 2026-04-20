'use client'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { WifiOff } from 'lucide-react'

/**
 * Banner discreto arriba del panel cuando el tablet se queda sin conexión.
 * No bloquea la UI — sólo avisa para que el barbero sepa que sus acciones
 * pueden fallar hasta que vuelva.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/95 px-4 py-2 text-sm font-bold text-white shadow-lg backdrop-blur animate-in slide-in-from-top-4 duration-200"
    >
      <WifiOff className="size-4" />
      Sin conexión
    </div>
  )
}
