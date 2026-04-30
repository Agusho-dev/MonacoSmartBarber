import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getBarberSession } from '@/lib/actions/auth'
import { fetchBarberHistory } from '@/lib/actions/barber-panel'
import { HistorialClient } from './historial-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Mi Historial | BarberOS',
}

interface RawVisit {
    id: string
    amount: number
    payment_method: string
    commission_amount: number
    started_at: string | null
    completed_at: string
    service: { name: string } | { name: string }[] | null
    client: { name: string } | { name: string }[] | null
}

function pickRelation<T>(rel: T | T[] | null | undefined): T | null {
    if (!rel) return null
    return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

export default async function HistorialPage() {
    const session = await getBarberSession()
    if (!session) redirect('/barbero/login')

    const history = await fetchBarberHistory(session.staff_id, session.branch_id)
    const rawVisits = (history.visits ?? []) as unknown as RawVisit[]
    const normalized = {
        visits: rawVisits.map((v) => ({
            id: v.id,
            amount: v.amount,
            payment_method: v.payment_method,
            commission_amount: v.commission_amount,
            started_at: v.started_at ?? '',
            completed_at: v.completed_at,
            service: pickRelation(v.service),
            client: pickRelation(v.client),
        })),
    }

    return <HistorialClient session={session} history={normalized} />
}
