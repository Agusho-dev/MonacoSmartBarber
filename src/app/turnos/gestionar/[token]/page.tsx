import { notFound } from 'next/navigation'
import { getAppointmentByToken, getAppointmentSettings } from '@/lib/actions/appointments'
import { buildTurneroTheme } from '../../[slug]/theme'
import { GestionarClient } from './gestionar-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Gestionar turno' }

export default async function GestionarTurnoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const appointment = await getAppointmentByToken(token)

  if (!appointment) notFound()

  // Misma marca que el turnero: el cliente llega acá desde el WhatsApp de la
  // barbería, no desde un sistema genérico.
  const settings = await getAppointmentSettings(
    appointment.organization_id,
    appointment.branch_id
  )

  const theme = buildTurneroTheme({
    bg: settings?.brand_bg_color,
    primary: settings?.brand_primary_color,
    text: settings?.brand_text_color,
  })

  return (
    <GestionarClient
      appointment={appointment}
      token={token}
      theme={theme}
      cancellationMinHours={settings?.cancellation_min_hours ?? 2}
    />
  )
}
