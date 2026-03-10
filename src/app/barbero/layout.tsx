import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'
import { BarberFaceCheck } from '@/components/barber/barber-face-check'
import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { WakeLock } from '@/components/ui/wake-lock'

import { BarberThemeClient } from '@/components/barber/barber-theme-client'

export default async function BarberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getBarberSession()
  let needsFaceId = false

  if (session) {
    const supabase = await createClient()
    const { count } = await supabase
      .from('staff_face_descriptors')
      .select('*', { count: 'exact', head: true })
      .eq('staff_id', session.staff_id)

    needsFaceId = count === 0
  }

  return (
    <div className="barber-theme min-h-dvh bg-background text-foreground pb-20">
      <BarberThemeClient />
      <WakeLock />
      {children}
      <BarberNav />
      {session && typeof needsFaceId === 'boolean' && (
        <BarberFaceCheck
          needsFaceId={needsFaceId}
          staffId={session.staff_id}
          staffName={session.full_name}
        />
      )}
      <FullscreenButton />
    </div>
  )
}
