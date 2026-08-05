import { notFound } from 'next/navigation'
import { getWaitlistByToken } from '@/lib/actions/waitlist'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { buildTurneroTheme } from '../../[slug]/theme'
import { EsperaClient } from './espera-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Confirmar turno · Lista de espera' }

export default async function EsperaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const entry = await getWaitlistByToken(token)

  if (!entry) notFound()

  const settings = await getAppointmentSettings(entry.organization_id, entry.branch_id)

  return (
    <EsperaClient
      entry={entry}
      theme={buildTurneroTheme({
        bg: settings?.brand_bg_color,
        primary: settings?.brand_primary_color,
        text: settings?.brand_text_color,
      })}
    />
  )
}
