import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { getCurrentUserPermissions } from '@/lib/actions/permissions-gate'
import { getOrgLocaleContext } from '@/lib/i18n'
import {
  getPushOverview,
  listPushCampaigns,
  getPushSettings,
} from '@/lib/actions/push-notifications'
import { redirect } from 'next/navigation'
import { AppMovilClient } from './app-movil-client'

export const dynamic = 'force-dynamic'

interface AppMovilPageProps {
  searchParams: Promise<{ tab?: string }>
}

/**
 * /dashboard/app-movil — el único lugar desde donde se gestiona la app de
 * clientes: Puntos · Catálogo · Cartelera · Notificaciones (push).
 *
 * La pestaña Notificaciones se arma con los mismos loaders que tenía
 * `/dashboard/notificaciones` (que hoy redirige acá) y se gatea por permiso
 * aparte (`notifications.view`): el resto de la pantalla va por `rewards.view`.
 */
export default async function AppMovilPage({ searchParams }: AppMovilPageProps) {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')
  const { tab } = await searchParams
  const branchIds = await getScopedBranchIds()

  const supabase = createAdminClient()

  const [
    { data: branches },
    { data: configs },
    { data: catalog },
    { data: billboard },
    perms,
  ] = await Promise.all([
    branchIds.length > 0
      ? supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] }),
    branchIds.length > 0
      ? supabase.from('rewards_config').select('*').in('branch_id', branchIds)
      : Promise.resolve({ data: [] }),
    supabase.from('reward_catalog').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    branchIds.length > 0
      ? supabase.from('billboard_items').select('*, branch:branches(name)').in('branch_id', branchIds).order('sort_order')
      : Promise.resolve({ data: [] }),
    getCurrentUserPermissions(),
  ])

  const notificaciones = perms['notifications.view']
    ? await cargarNotificaciones(orgId, branchIds, perms['notifications.manage'] === true)
    : null

  return (
    <AppMovilClient
      branches={branches || []}
      initialConfigs={configs || []}
      initialCatalog={catalog || []}
      initialBillboard={(billboard as Parameters<typeof AppMovilClient>[0]['initialBillboard']) || []}
      initialTab={tab}
      notificaciones={notificaciones}
    />
  )
}

/** Mismos datos que cargaba `/dashboard/notificaciones/page.tsx`. */
async function cargarNotificaciones(orgId: string, branchIds: string[], canManage: boolean) {
  const supabase = createAdminClient()
  const [locale, org, branchesRes, tagsRes, overview, campaigns, settings] = await Promise.all([
    getOrgLocaleContext(),
    supabase.from('organizations').select('name, logo_url').eq('id', orgId).maybeSingle(),
    branchIds.length
      ? supabase.from('branches').select('id, name').eq('organization_id', orgId).in('id', branchIds).eq('is_active', true).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from('conversation_tags').select('id, name, color').eq('organization_id', orgId).order('name'),
    getPushOverview(),
    listPushCampaigns(),
    getPushSettings(),
  ])

  return {
    canManage,
    timezone: locale.timezone,
    org: { name: org.data?.name ?? 'Tu barbería', logoUrl: org.data?.logo_url ?? null },
    branches: (branchesRes.data ?? []) as { id: string; name: string }[],
    tags: (tagsRes.data ?? []) as { id: string; name: string; color: string }[],
    initialCampaigns: campaigns.data,
    campaignsError: campaigns.error,
    initialOverview: overview,
    initialSettings: settings.data,
    settingsError: settings.error,
  }
}
