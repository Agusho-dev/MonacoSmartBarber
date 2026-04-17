import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'
import { resolveCheckinBackground } from '@/lib/checkin-bg'

export const dynamic = 'force-dynamic'

export default async function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('checkin_bg_color').maybeSingle()
  const raw = data?.checkin_bg_color ?? '#3f3f46'
  const { css, isLight } = resolveCheckinBackground(raw)
  const textClass = isLight ? 'text-zinc-900' : 'text-zinc-100'

  return (
    <div className={`fixed inset-0 h-dvh w-screen overflow-hidden ${textClass}`} style={{ backgroundColor: css }}>
      {children}

      <FullscreenButton />
    </div>
  )
}
