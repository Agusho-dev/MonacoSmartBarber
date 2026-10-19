import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberGoals } from '@/lib/actions/barber-panel'
import { metasVisiblesEnSucursal } from '@/lib/metas-en-panel'
import { MetasClient } from './metas-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mis Metas | BarberOS',
}

export default async function MetasPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')
    // Apagada en esta sucursal (mig 226): ni por un enlace viejo ni escribiendo
    // la dirección. La barra ya no la ofrece.
    if (!(await metasVisiblesEnSucursal(session.branch_id))) redirect('/barbero/fila')

    const goals = await fetchBarberGoals(session.staff_id, session.branch_id)

    return <MetasClient session={session} goals={goals} />
}
