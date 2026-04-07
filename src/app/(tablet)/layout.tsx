import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'

export const dynamic = 'force-dynamic'

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

export default async function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('checkin_bg_color').maybeSingle()
  const bgColor = data?.checkin_bg_color ?? '#3f3f46'
  const textClass = isLightColor(bgColor) ? 'text-zinc-900' : 'text-zinc-100'

  return (
    <div className={`fixed inset-0 h-dvh w-screen overflow-hidden ${textClass}`} style={{ backgroundColor: bgColor }}>
      {children}

      <FullscreenButton />
    </div>
  )
}
