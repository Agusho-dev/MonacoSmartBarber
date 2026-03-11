'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'

export async function checkinClient(formData: FormData) {
  const supabase = await createClient()
  const name = (formData.get('name') as string).trim()
  const phone = (formData.get('phone') as string).trim()
  const branchId = formData.get('branch_id') as string
  const barberId = (formData.get('barber_id') as string | null) || null
  const serviceId = (formData.get('service_id') as string | null) || null

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
      service_id: serviceId,
      position: position ?? 1,
      status: 'waiting',
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    // Unique constraint violation: client already in queue (race condition)
    if (queueError?.code === '23505') {
      const { data: existing } = await supabase
        .from('queue_entries')
        .select('id, position')
        .eq('client_id', clientId)
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .single()
      return { alreadyInQueue: true, position: existing?.position ?? 1, queueEntryId: existing?.id ?? '' }
    }
    console.error('Insert queue entry error:', queueError)
    return { error: 'Error al agregar a la cola: ' + (queueError?.message || 'Error desconocido') }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/cola')
  return { success: true, position, queueEntryId: queueEntry.id, clientId }
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
  isRewardClaim: boolean = false,
  paymentAccountId?: string | null,
  extraServiceIds?: string[]
) {
  // Use admin client because barber pin authentications do not set a Supabase Auth session
  // This causes RLS on visits and client_points to fail when the queue trigger fires using SECURITY INVOKER
  const supabase = createAdminClient()

  // 1. Complete the queue entry – this fires the on_queue_completed trigger
  //    which creates a visit record with amount=0 as placeholder
  const { error } = await supabase
    .from('queue_entries')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')

  if (error) {
    console.error('completeService error:', error)
    return { error: 'Error al completar servicio: ' + error.message }
  }

  // 2. Get the visit created by the trigger
  const { data: visit } = await supabase
    .from('visits')
    .select('id, client_id, branch_id, barber_id, commission_pct')
    .eq('queue_entry_id', queueEntryId)
    .single()

  if (!visit) {
    return { error: 'Error: visita no encontrada tras completar' }
  }

  // 3. Calculate proper amount and commission from the selected service(s)
  //    Commission priority: staff_service_commissions → services.default_commission_pct → staff.commission_pct
  let amount = 0
  let commissionAmount = 0
  const allServiceIds = [
    ...(serviceId ? [serviceId] : []),
    ...(extraServiceIds || [])
  ]

  if (allServiceIds.length > 0) {
    // Fetch service prices and default commissions
    const { data: activeServices } = await supabase
      .from('services')
      .select('id, price, default_commission_pct')
      .in('id', allServiceIds)

    // Fetch per-barber commission overrides for these services
    const { data: barberOverrides } = await supabase
      .from('staff_service_commissions')
      .select('service_id, commission_pct')
      .eq('staff_id', visit.barber_id)
      .in('service_id', allServiceIds)

    const overrideMap = new Map<string, number>()
    if (barberOverrides) {
      for (const o of barberOverrides) {
        overrideMap.set(o.service_id, Number(o.commission_pct))
      }
    }

    if (activeServices) {
      for (const s of activeServices) {
        const price = Number(s.price)
        amount += price

        // Resolve commission: barber override → service default → staff global
        let commPct: number
        if (overrideMap.has(s.id)) {
          commPct = overrideMap.get(s.id)!
        } else if (Number(s.default_commission_pct) > 0) {
          commPct = Number(s.default_commission_pct)
        } else {
          commPct = Number(visit.commission_pct)
        }

        commissionAmount += price * (commPct / 100)
      }
    }
  }

  // 4. Update the visit with correct data
  const visitUpdate: Record<string, unknown> = {
    payment_method: paymentMethod,
    amount,
    commission_amount: commissionAmount,
  }
  if (serviceId) visitUpdate.service_id = serviceId
  if (paymentAccountId) visitUpdate.payment_account_id = paymentAccountId
  if (extraServiceIds && extraServiceIds.length > 0) visitUpdate.extra_services = extraServiceIds

  await supabase
    .from('visits')
    .update(visitUpdate)
    .eq('id', visit.id)

  if (paymentMethod === 'transfer' && paymentAccountId) {
    await recordTransfer(visit.id, paymentAccountId, amount, visit.branch_id)
  }

  // 5. Handle reward redemption (deduct points)
  if (isRewardClaim && visit.client_id && visit.branch_id) {
    const { data: config } = await supabase
      .from('rewards_config')
      .select('redemption_threshold')
      .eq('branch_id', visit.branch_id)
      .eq('is_active', true)
      .single()

    const cost = config?.redemption_threshold || 10

    const { data: clientPoints } = await supabase
      .from('client_points')
      .select('points_balance, total_redeemed')
      .eq('client_id', visit.client_id)
      .eq('branch_id', visit.branch_id)
      .single()

    if (clientPoints && clientPoints.points_balance >= cost) {
      // Insert redemption transaction
      await supabase.from('point_transactions').insert({
        client_id: visit.client_id,
        visit_id: visit.id,
        points: -cost,
        type: 'redeemed',
        description: 'Canje de beneficio',
      })

      // Update balance directly
      await supabase
        .from('client_points')
        .update({
          points_balance: clientPoints.points_balance - cost,
          total_redeemed: (clientPoints.total_redeemed || 0) + cost,
        })
        .eq('client_id', visit.client_id)
        .eq('branch_id', visit.branch_id)
    }
  }

  // 6. Check if the barber's next waiting entry is a ghost break → auto-start it
  const { data: nextGhosts } = await supabase
    .from('queue_entries')
    .select('id, position')
    .eq('barber_id', visit.barber_id)
    .eq('branch_id', visit.branch_id)
    .eq('status', 'waiting')
    .eq('is_break', true)
    .order('position', { ascending: true })
    .limit(1)

  let breakAutoStarted = false
  if (nextGhosts && nextGhosts.length > 0) {
    const nextGhost = nextGhosts[0]

    // Check if there are any real waiting clients BEFORE the ghost
    const { data: realWaitingBeforeBreak } = await supabase
      .from('queue_entries')
      .select('id')
      .eq('barber_id', visit.barber_id)
      .eq('branch_id', visit.branch_id)
      .eq('status', 'waiting')
      .eq('is_break', false)
      .lt('position', nextGhost.position)
      .limit(1)

    // Also check unassigned waiting clients BEFORE the ghost
    const { data: unassignedWaitingBeforeBreak } = await supabase
      .from('queue_entries')
      .select('id')
      .eq('branch_id', visit.branch_id)
      .eq('status', 'waiting')
      .eq('is_break', false)
      .is('barber_id', null)
      .lt('position', nextGhost.position)
      .limit(1)

    // Auto-start only if there are no clients waiting BEFORE the break ghost
    const hasRealClientsBefore = (realWaitingBeforeBreak && realWaitingBeforeBreak.length > 0) || 
                                 (unassignedWaitingBeforeBreak && unassignedWaitingBeforeBreak.length > 0)

    if (!hasRealClientsBefore) {
      await supabase
        .from('queue_entries')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('id', nextGhost.id)
      breakAutoStarted = true
    }
  }

  revalidatePath('/barbero/cola')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  return { success: true, visitId: visit.id, breakAutoStarted }
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
  barberId: string | null,
  serviceId: string | null = null
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
      service_id: serviceId,
      position: position ?? 1,
      status: 'waiting',
    })
    .select('id')
    .single()

  if (queueError || !queueEntry) {
    if (queueError?.code === '23505') {
      const { data: existing } = await supabase
        .from('queue_entries')
        .select('id, position')
        .eq('client_id', clientId)
        .eq('branch_id', branchId)
        .in('status', ['waiting', 'in_progress'])
        .single()
      return { alreadyInQueue: true, position: existing?.position ?? 1, queueEntryId: existing?.id ?? '' }
    }
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
