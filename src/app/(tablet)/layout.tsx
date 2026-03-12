import { FullscreenButton } from '@/components/ui/fullscreen-button'

export default function TabletLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 h-dvh w-screen bg-background text-foreground overflow-hidden">
      {children}
      <FullscreenButton />
    </div>
  )
}
