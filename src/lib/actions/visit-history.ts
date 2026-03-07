'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function saveVisitDetails(
  visitId: string,
  notes: string | null,
  tags: string[] | null,
  photoPaths: string[]
) {
  const supabase = await createClient()

  const { error: updateError } = await supabase
    .from('visits')
    .update({ notes, tags })
    .eq('id', visitId)

  if (updateError) return { error: updateError.message }

  if (photoPaths.length > 0) {
    const { error: photoError } = await supabase
      .from('visit_photos')
      .insert(
        photoPaths.map((path, i) => ({
          visit_id: visitId,
          storage_path: path,
          order_index: i,
        }))
      )
    if (photoError) return { error: photoError.message }
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard/clientes')
  return { success: true }
}

export interface ClientProfileVisit {
  id: string
  completed_at: string
  amount: number
  notes: string | null
  tags: string[] | null
  service_name: string | null
  barber_name: string
  barber_id: string
  photos: Array<{ id: string; storage_path: string; order_index: number }>
}

export interface ClientProfileData {
  visits: ClientProfileVisit[]
  frequentBarber: { name: string; count: number } | null
  totalVisits: number
}

export async function getClientProfile(
  clientId: string
): Promise<ClientProfileData> {
  const supabase = await createClient()

  const { data: visits } = await supabase
    .from('visits')
    .select(
      'id, completed_at, amount, notes, tags, barber_id, barber:staff(full_name), service:services(name)'
    )
    .eq('client_id', clientId)
    .order('completed_at', { ascending: false })
    .limit(20)

  const visitIds = (visits ?? []).map((v) => v.id)

  let photos: Array<{
    visit_id: string
    id: string
    storage_path: string
    order_index: number
  }> = []
  if (visitIds.length > 0) {
    const { data } = await supabase
      .from('visit_photos')
      .select('id, visit_id, storage_path, order_index')
      .in('visit_id', visitIds)
      .order('order_index')
    photos = data ?? []
  }

  const photoMap = new Map<string, typeof photos>()
  for (const p of photos) {
    const arr = photoMap.get(p.visit_id) || []
    arr.push(p)
    photoMap.set(p.visit_id, arr)
  }

  const barberCounts = new Map<string, { name: string; count: number }>()
  for (const v of visits ?? []) {
    const name =
      (v.barber as unknown as { full_name: string } | null)?.full_name ?? '?'
    const existing = barberCounts.get(v.barber_id) || { name, count: 0 }
    existing.count++
    barberCounts.set(v.barber_id, existing)
  }
  let frequentBarber: { name: string; count: number } | null = null
  for (const [, data] of barberCounts) {
    if (!frequentBarber || data.count > frequentBarber.count) {
      frequentBarber = data
    }
  }

  const { count } = await supabase
    .from('visits')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  return {
    visits: (visits ?? []).map((v) => ({
      id: v.id,
      completed_at: v.completed_at,
      amount: v.amount,
      notes: v.notes,
      tags: v.tags,
      service_name:
        (v.service as unknown as { name: string } | null)?.name ?? null,
      barber_name:
        (v.barber as unknown as { full_name: string } | null)?.full_name ??
        '?',
      barber_id: v.barber_id,
      photos: photoMap.get(v.id) ?? [],
    })),
    frequentBarber,
    totalVisits: count ?? 0,
  }
}
