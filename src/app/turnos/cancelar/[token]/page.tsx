import { notFound } from 'next/navigation'
import { getAppointmentByToken, getAppointmentSettings } from '@/lib/actions/appointments'
import { CancelForm } from './cancel-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Cancelar turno' }

export default async function CancelarTurnoPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  if (!token || token.length < 8) notFound()

  const appointment = await getAppointmentByToken(token)
  if (!appointment) notFound()

  // Cargar settings para obtener cancellation_min_hours
  const settings = await getAppointmentSettings(
    appointment.organization_id,
    appointment.branch_id
  )

  const cancellationMinHours = settings?.cancellation_min_hours ?? 2

  return (
    <CancelForm
      appointment={appointment}
      token={token}
      cancellationMinHours={cancellationMinHours}
    />
  )
}
