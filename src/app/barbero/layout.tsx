import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'

import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { WakeLock } from '@/components/ui/wake-lock'
import { OfflineBanner } from '@/components/barber/offline-banner'
import { DbDownError } from '@/components/dashboard/db-down-error'

import { BarberThemeClient } from '@/components/barber/barber-theme-client'

export default async function BarberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getBarberSession() hace 3 queries a DB (staff, attendance_logs, roles).
  // Si la DB no responde, mostramos DbDownError en lugar de explotar la página.
  let session: Awaited<ReturnType<typeof getBarberSession>>
  try {
    session = await getBarberSession()
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const name = error.name.toLowerCase()
    const msg = error.message.toLowerCase()
    const esRedError =
      name === 'aborterror' ||
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('aborted') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset')

    if (esRedError) {
      console.error('[barbero/layout] Error de red en getBarberSession():', err)
      return (
        <div className="barber-theme min-h-dvh bg-background text-foreground">
          <BarberThemeClient />
          <DbDownError context="getBarberSession()" />
        </div>
      )
    }

    // Error no reconocido — dejamos que explote con el mensaje original
    console.error('[barbero/layout] Error inesperado en getBarberSession():', err)
    throw err
  }

  return (
    <div className="barber-theme min-h-dvh bg-background text-foreground pb-20">
      <BarberThemeClient />
      <WakeLock />
      <OfflineBanner />
      {children}
      {session && <BarberNav />}
      <FullscreenButton />
    </div>
  )
}
