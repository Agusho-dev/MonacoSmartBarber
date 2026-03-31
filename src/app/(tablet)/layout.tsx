import { createClient } from '@/lib/supabase/server'
import { FullscreenButton } from '@/components/ui/fullscreen-button'
import Image from 'next/image'

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
      
      {/* Floating QR for Music Selection */}
      <div className="fixed bottom-6 left-6 z-[100] flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-background/90 p-4 shadow-2xl backdrop-blur-xl transition-transform hover:scale-105">
        <div className="text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-foreground/90">
            Elegí tu
          </p>
          <p className="text-sm font-black uppercase tracking-wider text-primary">
            Música
          </p>
        </div>
        <div className="relative h-[110px] w-[110px] overflow-hidden rounded-xl bg-white shadow-inner">
          <Image 
            src="/url_qrcodecreator.com_19_15_18.png" 
            alt="Código QR para elegir música"
            fill
            className="object-contain p-1.5"
            priority
          />
        </div>
      </div>

      <FullscreenButton />
    </div>
  )
}
