'use server'

import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'

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
  if (!orgId) return []

  const supabase = createAdminClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', orgId)

  return branches?.map(b => b.id) ?? []
})

import { cookies } from 'next/headers'

/**
 * Selecciona una organización por su slug (acceso público).
 * Setea la cookie active_organization para que las páginas públicas
 * (checkin, barbero, TV) sepan qué org usar.
 */
export async function selectOrganizationBySlug(slug: string) {
  if (!slug?.trim()) return { error: 'El slug es requerido' }

  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, is_active')
    .eq('slug', slug.toLowerCase().trim())
    .eq('is_active', true)
    .maybeSingle()

  if (!org) return { error: 'Barbería no encontrada' }

  const cookieStore = await cookies()
  cookieStore.set('active_organization', org.id, { maxAge: 60 * 60 * 24 * 365, path: '/' })

  return { success: true, organization: org }
}

/**
 * Obtiene la organización activa desde la cookie (para páginas públicas).
 */
export async function getActiveOrganization() {
  const cookieStore = await cookies()
  const orgId = cookieStore.get('active_organization')?.value
  if (!orgId) return null

  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, is_active')
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
 */
export const getCurrentOrgId = cache(async function getCurrentOrgId(): Promise<string | null> {
  const cookieStore = await cookies()

  // 1. Intentar con Supabase Auth (usuarios del dashboard)
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const activeOrg = cookieStore.get('active_organization')?.value
    if (activeOrg) return activeOrg
    return getOrganizationId(user.id)
  }

  // 2. Fallback: barber PIN session (cookie barber_session)
  const barberSession = cookieStore.get('barber_session')
  if (barberSession) {
    try {
      const parsed = JSON.parse(barberSession.value)
      if (parsed.staff_id) {
        const adminClient = createAdminClient()
        const { data: staff } = await adminClient
          .from('staff')
          .select('organization_id')
          .eq('id', parsed.staff_id)
          .eq('is_active', true)
          .maybeSingle()
        return staff?.organization_id ?? null
      }
    } catch { /* cookie invalida */ }
  }

  return null
})
