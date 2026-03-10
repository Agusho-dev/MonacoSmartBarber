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
