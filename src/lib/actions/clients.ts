'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateClientNotes(
  clientId: string,
  notes: string | null,
  instagram: string | null
) {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('clients')
    .update({
      notes: notes || null,
      instagram: instagram || null
    })
    .eq('id', clientId)

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

  // Buscar por nombre o teléfono
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, phone')
    .or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`)
    .order('name')
    .limit(10)

  if (error) {
    console.error('searchClients error:', error)
    return { error: 'Error al buscar clientes' }
  }

  return { data: data ?? [] }
}
