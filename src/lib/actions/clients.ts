'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateClientNotes(
  clientId: string,
  notes: string | null
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('clients')
    .update({ notes })
    .eq('id', clientId)

  if (error) {
    return { error: 'Error al guardar notas' }
  }

  revalidatePath('/dashboard/clientes')
  return { success: true }
}
