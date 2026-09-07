import type { Metadata } from 'next'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { TurnosSubnav } from '@/components/dashboard/turnos-subnav'

export const metadata: Metadata = {
  title: 'Turnos | Monaco Smart Barber',
}

export default async function TurnosLayout({ children }: { children: React.ReactNode }) {
  const verSenas = await currentUserCan('senas.view')

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl lg:text-2xl font-bold tracking-tight">Turnos</h2>
      </div>
      <TurnosSubnav verSenas={verSenas} />
      {children}
    </div>
  )
}
