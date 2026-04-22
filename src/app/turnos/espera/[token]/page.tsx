import { notFound } from 'next/navigation'
import { getWaitlistByToken } from '@/lib/actions/waitlist'
import { EsperaClient } from './espera-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Confirmar turno · Lista de espera' }

export default async function EsperaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const entry = await getWaitlistByToken(token)

  if (!entry) notFound()

  return <EsperaClient entry={entry} />
}
