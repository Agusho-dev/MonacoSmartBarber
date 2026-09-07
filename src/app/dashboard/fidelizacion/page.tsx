import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getOrgLocaleContext } from '@/lib/i18n'
import {
  getLoyaltyOverview, getLoyaltySettings, getLoyaltyTiers, listNotificationRules, listReferrals, listRewards, listServicesForLoyalty,
} from '@/lib/actions/loyalty'
import type { LoyaltySettings } from '@/lib/types/loyalty'
import { FidelizacionClient } from './fidelizacion-client'
import FidelizacionLoading from './loading'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

/**
 * /dashboard/fidelizacion — el programa de categorías, puntos, premios,
 * referidos y notificaciones (migraciones 196/197). Reemplaza al módulo legacy
 * sobre rewards_config/client_points, que nunca acreditó un punto.
 */
export default async function FidelizacionPage({ searchParams }: PageProps) {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  if (!(await currentUserCan('rewards.view'))) redirect('/dashboard')
  const { tab } = await searchParams

  // Settings va PRIMERO y solo: es el fetch que siembra la org (categorías,
  // reglas) si todavía no tiene fila. Corriéndolo en paralelo con el resto,
  // en la primera carga el overview se calculaba antes del seed (tiers: [],
  // distribution_preview: null) y tres lecturas competían por sembrar a la vez.
  const settings = await getLoyaltySettings()

  // Sin settings no hay nada que mostrar: es el único fetch que corta.
  if ('error' in settings) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/10 p-6">
        <h1 className="text-lg font-semibold">No pudimos abrir Fidelización</h1>
        <p className="mt-1 text-sm text-muted-foreground">{settings.error}</p>
      </div>
    )
  }

  const supabase = createAdminClient()
  const [overview, tiers, rewards, services, rules, referrals, canManage, locale, org] = await Promise.all([
    getLoyaltyOverview(),
    getLoyaltyTiers(),
    listRewards(),
    listServicesForLoyalty(),
    listNotificationRules(),
    listReferrals(50),
    currentUserCan('rewards.manage'),
    getOrgLocaleContext(),
    supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle(),
  ])

  const errores: string[] = []
  const tomar = <T,>(r: { data: T } | { error: string }, vacio: T): T => {
    if ('error' in r) { errores.push(r.error); return vacio }
    return r.data
  }

  const settingsData: LoyaltySettings = settings.data

  return (
    <Suspense fallback={<FidelizacionLoading />}>
      <FidelizacionClient
        initialTab={tab}
        overview={tomar(overview, {
          settings: settingsData, tiers: [], points: { issued_30d: 0, redeemed_30d: 0, expired_30d: 0, live_balance: 0, expiring_30d: 0, clients_with_points: 0 },
          rewards: { available: 0, used_30d: 0, expired_30d: 0 }, referrals: { completed_30d: 0, completed_total: 0, pending: 0 },
          events: [], in_grace: 0, distribution_preview: null, errors_7d: 0,
        })}
        settings={settingsData}
        tiers={tomar(tiers, [])}
        rewards={tomar(rewards, [])}
        services={tomar(services, [])}
        rules={tomar(rules, [])}
        referrals={tomar(referrals, [])}
        canManage={canManage}
        timezone={locale.timezone}
        org={{ name: org.data?.name ?? 'Monaco', logoUrl: org.data?.logo_url ?? null }}
        errores={errores}
      />
    </Suspense>
  )
}
