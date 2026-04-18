'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { isValidUUID } from '@/lib/validation'

export async function updateClientNotes(
  clientId: string,
  notes: string | null,
  instagram: string | null
) {
  const supabase = createAdminClient()

  // Filtrar por organización para evitar modificar clientes de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const { error } = await supabase
    .from('clients')
    .update({
      notes: notes || null,
      instagram: instagram || null
    })
    .eq('id', clientId)
    .eq('organization_id', orgId)

  if (error) {
    return { error: 'Error al guardar notas' }
  }

  revalidatePath('/dashboard/clientes')
  return { success: true }
}

export async function searchClients(query: string) {
  if (!query || query.trim().length < 2) return { data: [] }

  const supabase = createAdminClient()
  const trimmed = query.trim()

  // Filtrar por organización antes de buscar
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  // Dos queries separadas para evitar interpolación de input en .or()
  const [byName, byPhone] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, phone')
      .eq('organization_id', orgId)
      .ilike('name', `%${trimmed}%`)
      .order('name')
      .limit(10),
    supabase
      .from('clients')
      .select('id, name, phone')
      .eq('organization_id', orgId)
      .ilike('phone', `%${trimmed}%`)
      .order('name')
      .limit(10),
  ])

  if (byName.error || byPhone.error) {
    console.error('searchClients error:', byName.error ?? byPhone.error)
    return { error: 'Error al buscar clientes' }
  }

  // Merge por id eliminando duplicados
  const seen = new Set<string>()
  const merged: { id: string; name: string; phone: string }[] = []
  for (const row of [...(byName.data ?? []), ...(byPhone.data ?? [])]) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      merged.push(row)
    }
  }

  return { data: merged.slice(0, 10) }
}

export async function lookupClientByPhone(phone: string, branchId: string) {
  if (!phone || !branchId) return { data: null }

  const supabase = createAdminClient()

  // Rate limit: 10 búsquedas por IP+branch cada 60s (anti-enum)
  const { rateLimit, getClientIP } = await import('@/lib/rate-limit')
  const ip = await getClientIP()
  const gate = await rateLimit('lookup_phone', `${ip}:${branchId}`, { limit: 10, window: 60 })
  if (!gate.allowed) {
    return { data: null, rateLimited: true }
  }

  // Find branch org
  const { data: branch } = await supabase
    .from('branches')
    .select('organization_id')
    .eq('id', branchId)
    .single()

  if (!branch?.organization_id) return { data: null }

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone, face_photo_url')
    .eq('phone', phone)
    .eq('organization_id', branch.organization_id)
    .single()

  if (error) {
    return { data: null }
  }

  return { data }
}

/**
 * Autoriza una operación de enrolment / actualización de cara para un cliente.
 *
 * Admite dos contextos:
 *   - Kiosk público: se pasa `branchId`. Se valida que la sucursal esté activa
 *     y pertenezca a la misma org que el cliente. Es la forma correcta de
 *     autorizar en rutas sin sesión de usuario.
 *   - Staff autenticado (dashboard / barber panel): sin `branchId`, se usa
 *     `requireOrgAccessToEntity` que lee la sesión (barber_session o Supabase Auth).
 *
 * Retorna el `organization_id` del cliente si la operación está autorizada, o null.
 */
async function authorizeClientFaceOp(
  clientId: string,
  branchId?: string | null,
): Promise<string | null> {
  if (!isValidUUID(clientId)) return null

  const supabase = createAdminClient()

  const { data: client } = await supabase
    .from('clients')
    .select('organization_id')
    .eq('id', clientId)
    .maybeSingle()

  if (!client?.organization_id) return null

  if (branchId && isValidUUID(branchId)) {
    const { data: branch } = await supabase
      .from('branches')
      .select('organization_id, is_active')
      .eq('id', branchId)
      .maybeSingle()
    if (branch?.is_active && branch.organization_id === client.organization_id) {
      return client.organization_id
    }
    return null
  }

  const guard = await requireOrgAccessToEntity('clients', clientId)
  return guard.ok ? client.organization_id : null
}

export async function enrollClientFace(
  clientId: string,
  descriptor: number[],
  source: 'checkin' | 'barber' = 'checkin',
  qualityScore = 0,
  branchId?: string | null,
): Promise<boolean> {
  if (!Array.isArray(descriptor) || descriptor.length !== 128) return false

  const orgId = await authorizeClientFaceOp(clientId, branchId)
  if (!orgId) return false

  // Rate limit anti-abuso: 20 descriptores por IP+cliente cada 60s
  // (un enrolment normal son 3-5 capturas, esto da margen a re-enrolments).
  const { rateLimit, getClientIP } = await import('@/lib/rate-limit')
  const ip = await getClientIP()
  const gate = await rateLimit('enroll_face', `${ip}:${clientId}`, { limit: 20, window: 60 })
  if (!gate.allowed) return false

  const supabase = createAdminClient()
  const { error } = await supabase.from('client_face_descriptors').insert({
    client_id: clientId,
    organization_id: orgId,
    descriptor: JSON.stringify(descriptor),
    quality_score: qualityScore,
    source,
  })

  if (error) {
    console.error('enrollClientFace error:', error.message)
    return false
  }
  return true
}

export async function saveClientFacePhotoUrl(
  clientId: string,
  publicUrl: string,
  branchId?: string | null,
): Promise<boolean> {
  // Solo aceptar URLs generadas por el bucket face-references de este proyecto
  // para evitar inyectar URLs externas arbitrarias en el registro del cliente.
  if (typeof publicUrl !== 'string' || !publicUrl.includes('/face-references/')) return false

  const orgId = await authorizeClientFaceOp(clientId, branchId)
  if (!orgId) return false

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('clients')
    .update({ face_photo_url: publicUrl })
    .eq('id', clientId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('saveClientFacePhotoUrl error:', error.message)
    return false
  }
  return true
}
