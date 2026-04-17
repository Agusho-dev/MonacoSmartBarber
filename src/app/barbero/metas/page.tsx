import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberGoals } from '@/lib/actions/barber-panel'
import { MetasClient } from './metas-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mis Metas | BarberOS',
}

export default async function MetasPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    const goals = await fetchBarberGoals(session.staff_id, session.branch_id)

    return <MetasClient session={session} goals={goals} />
}
