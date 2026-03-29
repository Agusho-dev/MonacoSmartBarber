import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberAttendance } from '@/lib/actions/barber-panel'
import { AsistenciaClient } from './asistencia-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mi Asistencia | Monaco Smart Barber',
}

export default async function AsistenciaPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    const attendance = await fetchBarberAttendance(session.staff_id, session.branch_id)

    return <AsistenciaClient session={session} attendance={attendance} />
}
