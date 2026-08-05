import { notFound } from 'next/navigation'
import { getAppointmentByToken, getAppointmentSettings } from '@/lib/actions/appointments'
import { buildTurneroTheme } from '../../[slug]/theme'
import { CancelForm } from './cancel-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Cancelar turno' }

/**
 * Ruta HUÉRFANA: nada del código ni de los mensajes de WhatsApp la enlaza —
 * todo apunta a `/turnos/gestionar/[token]`, que hace lo mismo y además muestra
 * el detalle. Se mantiene viva por si algún link viejo sigue circulando, pero
 * comparte el tema para no verse de otro sistema. Candidata a borrarse.
 */
export default async function CancelarTurnoPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  if (!token || token.length < 8) notFound()

  const appointment = await getAppointmentByToken(token)
  if (!appointment) notFound()

  const settings = await getAppointmentSettings(
    appointment.organization_id,
    appointment.branch_id
  )

  return (
    <CancelForm
      appointment={appointment}
      token={token}
      cancellationMinHours={settings?.cancellation_min_hours ?? 2}
      theme={buildTurneroTheme({
        bg: settings?.brand_bg_color,
        primary: settings?.brand_primary_color,
        text: settings?.brand_text_color,
      })}
    />
  )
}
