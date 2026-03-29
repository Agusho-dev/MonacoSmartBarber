import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberPerformance } from '@/lib/actions/barber-panel'
import { RendimientoClient } from './rendimiento-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mi Rendimiento | Monaco Smart Barber',
}

export default async function RendimientoPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    const dayStats = await fetchBarberPerformance(session.staff_id, session.branch_id, 'day')
    const weekStats = await fetchBarberPerformance(session.staff_id, session.branch_id, 'week')
    const monthStats = await fetchBarberPerformance(session.staff_id, session.branch_id, 'month')

    return (
        <RendimientoClient
            session={session}
            dayStats={dayStats}
            weekStats={weekStats}
            monthStats={monthStats}
        />
    )
}
