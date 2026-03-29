import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'

export const dynamic = 'force-dynamic'

const BG_CLASSES = {
  white: 'barber-theme bg-background text-foreground',
  black: 'bg-zinc-950 text-zinc-100',
  graphite: 'bg-zinc-700 text-zinc-100',
}

export default async function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('checkin_bg_color').maybeSingle()
  const bgColor = (data?.checkin_bg_color ?? 'graphite') as 'white' | 'black' | 'graphite'

  return (
    <div className={`fixed inset-0 h-dvh w-screen overflow-hidden ${BG_CLASSES[bgColor]}`}>
      {children}
      <FullscreenButton />
    </div>
  )
}
