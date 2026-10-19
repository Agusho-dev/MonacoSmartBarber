import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberAttendance } from '@/lib/actions/barber-panel'
import { createAdminClient } from '@/lib/supabase/server'
import { AsistenciaClient } from './asistencia-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mi Asistencia | BarberOS',
}

export default async function AsistenciaPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    // Zona de la sucursal: esta pantalla se pinta en el servidor (UTC en Vercel)
    // y en la tablet; con la zona de cada uno, una marca de las 22:00 caía en
    // días distintos y la hidratación no coincidía.
    const [attendance, { data: branch }] = await Promise.all([
        fetchBarberAttendance(session.staff_id, session.branch_id),
        createAdminClient().from('branches').select('timezone').eq('id', session.branch_id).maybeSingle(),
    ])

    return (
        <AsistenciaClient
            session={session}
            attendance={attendance}
            timeZone={branch?.timezone ?? 'America/Argentina/Buenos_Aires'}
        />
    )
}
