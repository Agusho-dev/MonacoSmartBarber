'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function checkinClient(formData: FormData) {
  const supabase = await createClient()
  const name = (formData.get('name') as string).trim()
  const phone = (formData.get('phone') as string).trim()
  const branchId = formData.get('branch_id') as string
  const barberId = (formData.get('barber_id') as string | null) || null

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

    const { data: activeEntry } = await supabase
      .from('queue_entries')
      .select('id, position, status, barber_id')
      .eq('client_id', clientId)
      .in('status', ['waiting', 'in_progress'])
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeEntry) {
      return { alreadyInQueue: true, position: activeEntry.position, queueEntryId: activeEntry.id }
    }
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

  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      client_id: clientId,
      barber_id: barberId,
      position: position ?? 1,
      status: 'waiting',
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    return { error: 'Error al agregar a la cola' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/cola')
  return { success: true, position, queueEntryId: queueEntry.id }
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
  serviceId?: string,
  isRewardClaim: boolean = false
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

  const visitUpdate: Record<string, unknown> = { payment_method: paymentMethod }
  if (serviceId) visitUpdate.service_id = serviceId

  await supabase
    .from('visits')
    .update(visitUpdate)
    .eq('queue_entry_id', queueEntryId)

  const { data: visit } = await supabase
    .from('visits')
    .select('id, client_id, branch_id')
    .eq('queue_entry_id', queueEntryId)
    .single()

  // Handle reward claim deduction explicitly if requested
  if (isRewardClaim && visit?.client_id && visit?.branch_id) {
    // 1. Get branch reward config to know the cost
    const { data: config } = await supabase
      .from('rewards_config')
      .select('redemption_threshold')
      .eq('branch_id', visit.branch_id)
      .eq('is_active', true)
      .single()

    const cost = config?.redemption_threshold || 10 // Default fallback

    // 2. Validate user has enough points
    const { data: clientPoints } = await supabase
      .from('client_points')
      .select('points_balance')
      .eq('client_id', visit.client_id)
      .eq('branch_id', visit.branch_id)
      .single()

    if (clientPoints && clientPoints.points_balance >= cost) {
      // 3. Insert point transaction (negative)
      await supabase.from('point_transactions').insert({
        client_id: visit.client_id,
        visit_id: visit.id,
        points: -cost,
        type: 'redeemed',
        description: 'Canje de beneficio',
      })

      // 4. Update balance
      await supabase.rpc('decrement_points', {
        p_client_id: visit.client_id,
        p_branch_id: visit.branch_id,
        p_amount: cost,
      })
      
      // Note: An alternative to RPC is just a direct update since we have the clientPoints record, 
      // but an RPC or a direct update works:
      // await supabase.from('client_points').update({ 
      //   points_balance: clientPoints.points_balance - cost,
      //   total_redeemed: (clientPoints.total_redeemed || 0) + cost 
      // }).eq('client_id', visit.client_id).eq('branch_id', visit.branch_id)
      
      // We will do the safe straightforward direct update for now:
      const { data: currentStats } = await supabase
        .from('client_points')
        .select('*')
        .eq('client_id', visit.client_id)
        .eq('branch_id', visit.branch_id)
        .single()
        
      if (currentStats) {
        await supabase
          .from('client_points')
          .update({
            points_balance: currentStats.points_balance - cost,
            total_redeemed: currentStats.total_redeemed + cost,
          })
          .eq('client_id', visit.client_id)
          .eq('branch_id', visit.branch_id)
      }
    }
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard')
  return { success: true, visitId: visit?.id ?? null }
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
  revalidatePath('/dashboard/cola')
  return { success: true }
}

export async function reassignBarber(
  queueEntryId: string,
  newBarberId: string | null
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al reasignar barbero' }
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard/cola')
  return { success: true }
}

export async function checkinClientByFace(
  clientId: string,
  branchId: string,
  barberId: string | null
) {
  const supabase = await createClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .single()

  if (!client) {
    return { error: 'Cliente no encontrado' }
  }

  const { data: activeEntry } = await supabase
    .from('queue_entries')
    .select('id, position, status, barber_id')
    .eq('client_id', clientId)
    .in('status', ['waiting', 'in_progress'])
    .order('checked_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeEntry) {
    return { alreadyInQueue: true, position: activeEntry.position, queueEntryId: activeEntry.id }
  }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      client_id: clientId,
      barber_id: barberId,
      position: position ?? 1,
      status: 'waiting',
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    return { error: 'Error al agregar a la cola' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/cola')
  return { success: true, position, queueEntryId: queueEntry.id }
}

export async function reassignMyBarber(
  queueEntryId: string,
  newBarberId: string
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al cambiar barbero' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/cola')
  revalidatePath('/dashboard/cola')
  return { success: true }
}
