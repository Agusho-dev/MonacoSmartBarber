import { FullscreenButton } from '@/components/ui/fullscreen-button'

export default function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 h-dvh w-screen bg-zinc-700 text-zinc-100 overflow-hidden">
      {children}
      <FullscreenButton />
    </div>
  )
}
