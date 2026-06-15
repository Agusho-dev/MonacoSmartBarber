import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAssistantConfigView } from '@/lib/actions/asistente'
import { AsistenteConfigClient } from './asistente-config-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Configurá tu copiloto | Monaco Smart Barber',
}

export default async function AsistenteConfigPage() {
  const config = await getAssistantConfigView()
  if (!config) redirect('/login')

  return <AsistenteConfigClient initial={config} />
}
