'use client'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { WifiOff } from 'lucide-react'

/**
 * Aviso de "sin conexión" del panel. No bloquea la UI: avisa que las acciones
 * pueden fallar hasta que vuelva la red. Cuelga justo debajo de la banda del
 * reloj —arriba de todo taparía la hora, que es lo único que esa banda muestra—.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-[calc(var(--alto-banda)+0.5rem)] z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 shadow-[0_8px_24px_-10px_oklch(0.55_0.15_70/0.7)] animate-in slide-in-from-top-2 fade-in duration-200"
    >
      <WifiOff className="size-4" aria-hidden />
      Sin conexión
    </div>
  )
}
