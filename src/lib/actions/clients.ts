'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentOrgId } from './org'

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

  // Buscar por nombre o teléfono dentro de la organización
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone')
    .eq('organization_id', orgId)
    .or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`)
    .order('name')
    .limit(10)

  if (error) {
    console.error('searchClients error:', error)
    return { error: 'Error al buscar clientes' }
  }

  return { data: data ?? [] }
}

export async function lookupClientByPhone(phone: string, branchId: string) {
  if (!phone || !branchId) return { data: null }

  const supabase = createAdminClient()

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

export async function enrollClientFace(
  clientId: string,
  descriptor: number[],
  source: 'checkin' | 'barber' = 'checkin',
  qualityScore = 0
): Promise<boolean> {
  const supabase = createAdminClient()

  const { error } = await supabase.from('client_face_descriptors').insert({
    client_id: clientId,
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
  publicUrl: string
): Promise<boolean> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('clients')
    .update({ face_photo_url: publicUrl })
    .eq('id', clientId)

  if (error) {
    console.error('saveClientFacePhotoUrl error:', error.message)
    return false
  }
  return true
}
