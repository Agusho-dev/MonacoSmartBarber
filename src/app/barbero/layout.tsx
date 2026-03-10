import { BarberNav } from '@/components/barber/barber-nav'
import { getBarberSession } from '@/lib/actions/auth'
import { BarberFaceCheck } from '@/components/barber/barber-face-check'
import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'

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
    <div className="min-h-dvh bg-background pb-20">
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
