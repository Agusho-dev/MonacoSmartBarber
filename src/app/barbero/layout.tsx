import { BarberNav } from '@/components/barber/barber-nav'

export default function BarberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-background pb-20">
      {children}
      <BarberNav />
    </div>
  )
}
