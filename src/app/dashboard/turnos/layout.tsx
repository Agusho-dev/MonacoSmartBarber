import type { Metadata } from 'next'
import { TurnosSubnav } from '@/components/dashboard/turnos-subnav'

export const metadata: Metadata = {
  title: 'Turnos | Monaco Smart Barber',
}

export default function TurnosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl lg:text-2xl font-bold tracking-tight">Turnos</h2>
      </div>
      <TurnosSubnav />
      {children}
    </div>
  )
}
