'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'
import { requireOrgAccessToEntity } from './guard'
import { isValidUUID } from '@/lib/validation'

/**
 * Actualiza observaciones internas y/o Instagram de un cliente.
 *
 * `instagram` es opcional a propósito: `undefined` significa "no lo toques".
 * El panel del barbero llamaba con `''` al cerrar cada servicio, lo que dejaba el
 * Instagram en NULL. Hoy no se nota (no hay ninguno cargado en toda la base), pero
 * la pantalla de clientes ahora invita a cargarlo y el próximo corte lo borraría.
 */
export async function updateClientNotes(
  clientId: string,
  notes: string | null,
  instagram?: string | null
) {
  // El gate visual (`canEdit` en la pantalla de clientes) no alcanza: el id del
  // server action viaja en el bundle del browser y se puede invocar directo.
  //
  // OJO: esta acción también la llama el panel del barbero al cerrar un servicio
  // (`complete-service-dialog.tsx`), que se autentica por PIN y NO tiene sesión de
  // Supabase Auth. Ahí `currentUserCan` devolvería false y le comería las
  // observaciones al barbero en silencio.
  // Se valida la SESIÓN, no la presencia de la cookie: `barber_session` es JSON sin
  // firmar, así que chequear que exista dejaría entrar a cualquiera que la mande a
  // mano. `getBarberSession()` verifica el staff contra la base (existe, activo y
  // con fichada abierta).
  const { getBarberSession } = await import('./auth')
  const barbero = await getBarberSession()
  if (!barbero) {
    const { currentUserCan } = await import('./permissions-gate')
    if (!(await currentUserCan('clients.edit'))) {
      return { error: 'No tenés permiso para editar clientes' }
    }
  }

  const supabase = createAdminClient()

  // Filtrar por organización para evitar modificar clientes de otra org
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Organización no encontrada' }

  const cambios: { notes: string | null; instagram?: string | null } = {
    notes: notes || null,
  }
  if (instagram !== undefined) cambios.instagram = instagram || null

  const { error } = await supabase
    .from('clients')
    .update(cambios)
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

  // `quick_search_clients` (mig 167) resuelve lo que el doble ILIKE no podía:
  // pliega acentos (el 17% de los nombres de la base tiene tilde: "agustin" no
  // encontraba a "Agustín"), acepta los tokens del nombre en cualquier orden y
  // normaliza el teléfono, así "+54 9 351 212-5249" y "2125249" dan lo mismo.
  const { data, error } = await supabase.rpc('quick_search_clients', {
    p_organization_id: orgId,
    p_query: trimmed,
    p_limit: 10,
  })

  if (error) {
    console.error('searchClients error:', error.message)
    return { error: 'Error al buscar clientes' }
  }

  return { data: (data ?? []) as { id: string; name: string; phone: string }[] }
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
