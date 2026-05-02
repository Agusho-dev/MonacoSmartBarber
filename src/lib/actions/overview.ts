'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getActiveTimezone } from '@/lib/i18n'
import { getLocalDateStr, getDayBounds, getMonthBoundsStr } from '@/lib/time-utils'
import type { Visit, Branch, Organization } from '@/lib/types/database'

export interface SetupChecklist {
  whatsappConfigurado: boolean
  puntosConfigurado: boolean
  rolesPersonalizados: boolean
}

export interface DashboardOverviewData {
  /** Sucursales activas de la org */
  branches: Pick<Branch, 'id' | 'name'>[]
  /** Datos de la org — necesario para detectar onboarding_completed */
  organization: Pick<Organization, 'id' | 'name' | 'settings'> | null
  /** Visitas completadas hoy en todos los branches */
  todayVisits: Visit[]
  /** Ingresos totales del día en ARS */
  todayRevenue: number
  /** Clientes nuevos este mes */
  newClientsThisMonth: number
  /** Últimas 10 visitas completadas (con relaciones client/barber/service) */
  recentVisits: Visit[]
  /** Checklist de configuración pendiente */
  setupChecklist: SetupChecklist
}

/**
 * Obtiene todos los datos necesarios para el overview del dashboard.
 * Scoped por organization_id del usuario autenticado.
 * Usa createAdminClient() para bypassear RLS — solo llamar desde server components o server actions.
 */
export async function getDashboardOverview(): Promise<DashboardOverviewData | null> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return null

  const tz = await getActiveTimezone()
  const supabase = createAdminClient()
  const todayStr = getLocalDateStr(tz)
  const { start: todayFrom, end: todayTo } = getDayBounds(todayStr, tz)
  const { start: monthStart } = getMonthBoundsStr(1, tz)

  // Paso 1: resolver branches y org en paralelo (sin dependencias entre sí)
  const [{ data: branches }, { data: org }] = await Promise.all([
    supabase
      .from('branches')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),

    supabase
      .from('organizations')
      .select('id, name, settings')
      .eq('id', orgId)
      .maybeSingle(),
  ])

  const branchIds = branches?.map((b) => b.id) ?? []

  if (branchIds.length === 0) {
    // Sin sucursales: devolver estructura vacía para que page.tsx redirija a onboarding
    return {
      branches: [],
      organization: org ?? null,
      todayVisits: [],
      todayRevenue: 0,
      newClientsThisMonth: 0,
      recentVisits: [],
      setupChecklist: {
        whatsappConfigurado: false,
        puntosConfigurado: false,
        rolesPersonalizados: false,
      },
    }
  }

  // Visitas de hoy paginado — orgs grandes con muchas branches pueden superar
  // el cap default de PostgREST (1000 filas) en un solo día.
  const todayVisitsPromise = fetchAll<{ amount: number | null }>((from, to) => {
    return supabase
      .from('visits')
      .select(
        'id, branch_id, client_id, barber_id, service_id, payment_method, amount, commission_amount, commission_pct, extra_services, queue_entry_id, payment_account_id, notes, tags, started_at, completed_at, created_at'
      )
      .in('branch_id', branchIds)
      .gte('completed_at', todayFrom)
      .lte('completed_at', todayTo)
      .order('completed_at', { ascending: false })
      .range(from, to)
  })

  // Paso 2: queries paralelas que dependen de branchIds u orgId
  const [
    todayVisits,
    { data: recentVisits },
    { count: newClientsCount },
    { data: waConfig },
    { data: rewardsConfig },
    { count: customRolesCount },
  ] = await Promise.all([
    todayVisitsPromise,

    // Últimas 10 visitas — con relaciones para mostrar en la lista
    supabase
      .from('visits')
      .select(
        'id, branch_id, client_id, barber_id, service_id, payment_method, amount, commission_amount, commission_pct, extra_services, queue_entry_id, payment_account_id, notes, tags, started_at, completed_at, created_at, client:clients(id, name, phone), barber:staff(id, full_name), service:services(id, name)'
      )
      .in('branch_id', branchIds)
      .order('completed_at', { ascending: false })
      .limit(10),

    // Clientes nuevos este mes
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('created_at', monthStart),

    // WhatsApp configurado
    supabase
      .from('org_whatsapp_configs')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle(),

    // Puntos configurados
    supabase
      .from('rewards_config')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),

    // Roles personalizados
    supabase
      .from('roles')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_system', false),
  ])

  const todayRevenue = todayVisits.reduce((sum, v) => sum + (v.amount ?? 0), 0)

  return {
    branches: (branches ?? []) as Pick<Branch, 'id' | 'name'>[],
    organization: org ?? null,
    todayVisits: todayVisits as unknown as Visit[],
    todayRevenue,
    newClientsThisMonth: newClientsCount ?? 0,
    recentVisits: (recentVisits ?? []) as unknown as Visit[],
    setupChecklist: {
      whatsappConfigurado: !!waConfig,
      puntosConfigurado: !!rewardsConfig,
      rolesPersonalizados: (customRolesCount ?? 0) > 0,
    },
  }
}
