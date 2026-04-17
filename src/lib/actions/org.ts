'use server'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'

/**
 * Obtiene el organization_id del usuario autenticado.
 * Busca en staff (dashboard) y luego en organization_members.
 * Usado por server actions que necesitan filtrar por organizacion.
 */
export async function getOrganizationId(authUserId: string): Promise<string | null> {
  const supabase = createAdminClient()

  // Primero buscar en staff (caso mas comun: dashboard/barber panel)
  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (staff?.organization_id) return staff.organization_id

  // Fallback: buscar en organization_members
  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', authUserId)
    .limit(1)
    .maybeSingle()

  return member?.organization_id ?? null
}

/**
 * Valida que un branch_id pertenece a la organizacion del usuario actual.
 * Retorna el orgId si es valido, o null si no pertenece.
 * Util para server actions que reciben branchId como input y necesitan verificar ownership.
 */
export async function validateBranchAccess(branchId: string): Promise<string | null> {
  if (!isValidUUID(branchId)) return null
  const orgId = await getCurrentOrgId()
  if (!orgId) return null

  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()

  return branch ? orgId : null
}

/**
 * Obtiene los IDs de branches que pertenecen a la org del usuario.
 * Cacheado con React cache() para deduplicar dentro del mismo request.
 */
export const getOrgBranchIds = cache(async function getOrgBranchIds(): Promise<string[]> {
  const orgId = await getCurrentOrgId()
  if (!isValidUUID(orgId)) return []

  const supabase = createAdminClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId!)

  return branches?.map(b => b.id) ?? []
})

import { cookies } from 'next/headers'

/**
 * Retorna las sucursales activas filtradas por la organización activa.
 * Si hay cookie active_organization, filtra por esa org.
 * Si se pasa orgId explícito, usa ese.
 * Usado por páginas públicas (kiosk, login barbero, TV).
 */
export async function getPublicBranches(orgId?: string) {
  const cookieStore = await cookies()
  const activeOrgId = orgId || cookieStore.get('active_organization')?.value

  const supabase = createAdminClient()

  let query = supabase
    .from('branches')
    .select('*, organizations(name, logo_url)')
    .eq('is_active', true)
    .order('name')

  if (activeOrgId) {
    query = query.eq('organization_id', activeOrgId)
  }

  const { data } = await query
  return data ?? []
}

/** Color del kiosk (app_settings) para la org activa. Público vía service role. */
export async function getPublicAppCheckinBgColor(): Promise<string> {
  const supabase = createAdminClient()
  const cookieStore = await cookies()
  const orgId = cookieStore.get('active_organization')?.value

  if (!orgId) return '#3f3f46'

  const { data } = await supabase
    .from('app_settings')
    .select('checkin_bg_color')
    .eq('organization_id', orgId)
    .maybeSingle()

  const c = data?.checkin_bg_color
  if (typeof c === 'string' && c.trim()) return c.trim()
  return '#3f3f46'
}

/**
 * Setea la cookie active_organization a partir de un branch_id.
 * Útil cuando el kiosk/TV/barbero selecciona una sucursal.
 */
export async function setActiveOrgFromBranch(branchId: string) {
  const supabase = createAdminClient()
  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .maybeSingle()

  if (!branch?.organization_id) return

  const cookieStore = await cookies()
  cookieStore.set('active_organization', branch.organization_id, {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  })
}

/**
 * Selecciona una organización por su slug (acceso público desde kiosk/TV).
 * Usa cookie separada `public_organization` para NO pisar la sesión del dashboard
 * cuando un admin logueado entra a una ruta pública. Las páginas públicas leen
 * de `public_organization` primero, y caen a `active_organization` si no existe.
 */
export async function selectOrganizationBySlug(slug: string) {
  if (!slug?.trim()) return { error: 'El slug es requerido' }

  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, is_active, subscription_status')
    .eq('slug', slug.toLowerCase().trim())
    .eq('is_active', true)
    .maybeSingle()

  if (!org) return { error: 'Barbería no encontrada' }
  if (org.subscription_status === 'suspended' || org.subscription_status === 'cancelled') {
    return { error: 'Esta barbería no está disponible en este momento' }
  }

  const cookieStore = await cookies()
  // public_organization es exclusiva para rutas públicas (kiosk/TV/review)
  cookieStore.set('public_organization', org.id, { maxAge: 60 * 60 * 24 * 365, path: '/' })
  // Solo setear active_organization si NO hay una sesión dashboard autenticada
  // (evita pisar la org del admin cuando entra al kiosk físico)
  const hasAuthSession = cookieStore.getAll().some(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))
  if (!hasAuthSession) {
    cookieStore.set('active_organization', org.id, { maxAge: 60 * 60 * 24 * 365, path: '/' })
  }

  return { success: true, organization: org }
}

/**
 * Obtiene la organización activa desde la cookie (para páginas públicas).
 * Prioridad: public_organization (kiosk/TV) > active_organization (dashboard).
 */
export async function getActiveOrganization() {
  const cookieStore = await cookies()
  const orgId = cookieStore.get('public_organization')?.value
    ?? cookieStore.get('active_organization')?.value
  if (!orgId) return null

  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, is_active, timezone, currency, locale, primary_color')
    .eq('id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  return org
}

/**
 * Permite cambiar la organizacion activa de la sesion actual.
 * Modifica el app_metadata del usuario y establece una cookie.
 */
export async function switchOrganization(newOrgId: string) {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  // 1. Validar acceso a la organizacion (en staff o organization_members)
  const adminClient = createAdminClient()
  const { data: inStaff } = await adminClient
    .from('staff')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('organization_id', newOrgId)
    .maybeSingle()

  const { data: inMembers } = await adminClient
    .from('organization_members')
    .select('id')
    .eq('user_id', user.id)
    .eq('organization_id', newOrgId)
    .maybeSingle()

  if (!inStaff && !inMembers) {
    return { error: 'No tienes acceso a esta organización' }
  }

  // 2. Actualizar el app_metadata (necesario para el RLS de Postgres)
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, organization_id: newOrgId }
  })

  if (updateError) {
    return { error: 'Error al actualizar contexto: ' + updateError.message }
  }

  // 3. Setear cookie
  const cookieStore = await cookies()
  cookieStore.set('active_organization', newOrgId, { maxAge: 60 * 60 * 24 * 30, path: '/' })

  return { success: true }
}

/**
 * Obtiene el organization_id del usuario autenticado actual.
 * Soporta tanto Supabase Auth (dashboard) como barber PIN session (panel barbero).
 * Cacheado con React cache() para deduplicar llamadas dentro del mismo request.
 *
 * Prioridad: barber_session > Supabase Auth.
 * El panel barbero usa autenticación por PIN (sin Supabase Auth), pero las tablets
 * pueden tener cookies de Auth residuales de sesiones previas del dashboard.
 * Verificar barber_session primero evita que esas cookies interfieran.
 */
export const getCurrentOrgId = cache(async function getCurrentOrgId(): Promise<string | null> {
  const cookieStore = await cookies()

  // 1. Barber PIN session (panel barbero) — no requiere llamada a Supabase Auth
  const barberSession = cookieStore.get('barber_session')
  if (barberSession) {
    try {
      const parsed = JSON.parse(barberSession.value)
      // Preferir organization_id de la cookie si es UUID válido (evita DB roundtrip)
      if (isValidUUID(parsed.organization_id)) return parsed.organization_id
      if (isValidUUID(parsed.staff_id)) {
        const adminClient = createAdminClient()
        const { data: staff } = await adminClient
          .from('staff')
          .select('organization_id')
          .eq('id', parsed.staff_id)
          .eq('is_active', true)
          .maybeSingle()
        if (staff?.organization_id) return staff.organization_id
      }
    } catch { /* cookie invalida */ }
  }

  // 2. Supabase Auth (usuarios del dashboard)
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      const activeOrg = cookieStore.get('active_organization')?.value
      if (isValidUUID(activeOrg)) return activeOrg!
      return getOrganizationId(user.id)
    }
  } catch {
    console.error('[getCurrentOrgId] Error al verificar Supabase Auth')
  }

  return null
})
