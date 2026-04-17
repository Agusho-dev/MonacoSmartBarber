import { notFound } from 'next/navigation'
import { getAppointmentByToken } from '@/lib/actions/appointments'
import { GestionarClient } from './gestionar-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Gestionar turno' }

export default async function GestionarTurnoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const appointment = await getAppointmentByToken(token)

  if (!appointment) notFound()

  return <GestionarClient appointment={appointment} token={token} />
}
