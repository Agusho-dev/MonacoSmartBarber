import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'

import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { WakeLock } from '@/components/ui/wake-lock'
import { OfflineBanner } from '@/components/barber/offline-banner'

import { BarberThemeClient } from '@/components/barber/barber-theme-client'

export default async function BarberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getBarberSession()

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
