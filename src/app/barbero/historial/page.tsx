import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberHistory } from '@/lib/actions/barber-panel'
import { HistorialClient } from './historial-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mi Historial | BarberOS',
}

export default async function HistorialPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    const history = await fetchBarberHistory(session.staff_id, session.branch_id)

    return <HistorialClient session={session} history={history as any} />
}
