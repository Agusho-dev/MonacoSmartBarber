'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getServiceTags() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('service_tags')
    .select('*')
    .eq('is_active', true)
    .order('name')
  return data ?? []
}

export async function upsertServiceTag(name: string, id?: string) {
  const supabase = await createClient()

  if (id) {
    const { error } = await supabase
      .from('service_tags')
      .update({ name })
      .eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('service_tags').insert({ name })
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/servicios')
  return { success: true }
}

export async function deleteServiceTag(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('service_tags').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/dashboard/servicios')
  return { success: true }
}
