import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'

// La pantalla "Inicio" fue removida. Esta ruta sólo decide a dónde mandar al usuario:
//  - sin sesión → /login
//  - sin sucursales / onboarding incompleto → /onboarding
//  - en cualquier otro caso → /dashboard/fila (entrada por defecto)
export default async function DashboardIndexRedirect() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/onboarding')

  const admin = createAdminClient()
  const [{ data: org }, { count: branchCount }] = await Promise.all([
    admin.from('organizations').select('settings').eq('id', orgId).maybeSingle(),
    admin.from('branches').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
  ])

  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const onboardingCompleted = settings.onboarding_completed === true

  if (!onboardingCompleted || (branchCount ?? 0) === 0) {
    redirect('/onboarding')
  }

  redirect('/dashboard/fila')
}
