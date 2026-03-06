'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function checkinClient(formData: FormData) {
  const supabase = await createClient()
  const name = (formData.get('name') as string).trim()
  const phone = (formData.get('phone') as string).trim()
  const branchId = formData.get('branch_id') as string

  if (!name || !phone || !branchId) {
    return { error: 'Todos los campos son obligatorios' }
  }

  let clientId: string

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single()

  if (existingClient) {
    clientId = existingClient.id
    await supabase.from('clients').update({ name }).eq('id', clientId)
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({ name, phone })
      .select('id')
      .single()

    if (error || !newClient) {
      return { error: 'Error al registrar cliente' }
    }
    clientId = newClient.id
  }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  const { error: queueError } = await supabase.from('queue_entries').insert({
    branch_id: branchId,
    client_id: clientId,
    position: position ?? 1,
    status: 'waiting',
  })

  if (queueError) {
    return { error: 'Error al agregar a la cola' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/cola')
  return { success: true, position }
}

export async function startService(queueEntryId: string, barberId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('queue_entries')
    .update({
      barber_id: barberId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al iniciar servicio' }
  }

  revalidatePath('/barbero/cola')
  return { success: true }
}

export async function completeService(
  queueEntryId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  serviceId?: string
) {
  const supabase = await createClient()

  const updateData: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('queue_entries')
    .update(updateData)
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')

  if (error) {
    return { error: 'Error al completar servicio' }
  }

  // Update visit payment method if service was selected
  if (serviceId) {
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('id')
      .eq('id', queueEntryId)
      .single()

    if (entry) {
      await supabase
        .from('visits')
        .update({ payment_method: paymentMethod, service_id: serviceId })
        .eq('queue_entry_id', queueEntryId)
    }
  } else {
    await supabase
      .from('visits')
      .update({ payment_method: paymentMethod })
      .eq('queue_entry_id', queueEntryId)
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function cancelQueueEntry(queueEntryId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('id', queueEntryId)

  if (error) {
    return { error: 'Error al cancelar' }
  }

  revalidatePath('/barbero/cola')
  return { success: true }
}
