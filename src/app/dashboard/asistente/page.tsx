import { redirect } from 'next/navigation'
import { getAssistantContext } from '@/lib/asistente/context'
import { hasFeature } from '@/lib/actions/entitlements'
import { getAssistantThreads } from '@/lib/actions/asistente'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { providerForModel, DEFAULT_CHAT_MODEL } from '@/lib/asistente/models'
import { AsistenteClient } from './asistente-client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Asistente IA' }

export default async function AsistentePage() {
  const ctx = await getAssistantContext()
  if (!ctx) redirect('/login')
  if (!ctx.permissions['stats.view'] && !ctx.permissions['settings.view']) redirect('/dashboard')

  const [locked, threads, user] = await Promise.all([
    hasFeature('ai.enabled').then((f) => !f),
    getAssistantThreads(),
    getCachedAuthUser().catch(() => null),
  ])

  const modelId = ctx.config?.assistant_model || DEFAULT_CHAT_MODEL
  const provider = providerForModel(modelId)
  const hasKey =
    provider === 'anthropic'
      ? Boolean(ctx.config?.anthropic_api_key)
      : provider === 'openrouter'
        ? Boolean(ctx.config?.openrouter_api_key)
        : Boolean(ctx.config?.openai_api_key)

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? ''
  const firstName = fullName ? fullName.split(' ')[0] : null

  return (
    <AsistenteClient
      initialThreads={threads}
      hasKey={hasKey}
      locked={locked}
      orgName={ctx.orgName}
      firstName={firstName}
      proMode={ctx.proMode}
      modelId={modelId}
    />
  )
}
