'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'
import { validateBranchAccess } from './org'

export async function checkinClient(formData: FormData) {
  const supabase = createAdminClient()
  const name = (formData.get('name') as string).trim()
  const phone = (formData.get('phone') as string).trim()
  const branchId = formData.get('branch_id') as string
  const barberId = (formData.get('barber_id') as string | null) || null
  const serviceId = (formData.get('service_id') as string | null) || null

  if (!name || !phone || !branchId) {
    return { error: 'Todos los campos son obligatorios' }
  }

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su organización
  const { data: branchResult } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .single()

  if (!branchResult?.organization_id) {
    return { error: 'Sucursal no encontrada o inactiva' }
  }

  let clientId: string

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('organization_id', branchResult.organization_id)
    .maybeSingle()

  if (existingClient) {
    clientId = existingClient.id
    await supabase.from('clients').update({ name }).eq('id', clientId).eq('organization_id', branchResult.organization_id)

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
      .insert({
        name,
        phone,
        organization_id: branchResult.organization_id
      })
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
      is_dynamic: !barberId,
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
    return { error: 'Error al agregar a la fila: ' + (queueError?.message || 'Error desconocido') }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  return { success: true, position, queueEntryId: queueEntry.id, clientId }
}

export async function startService(queueEntryId: string, barberId: string) {
  const supabase = createAdminClient()

  // Obtener la entrada para validar que la sucursal pertenece a la org activa
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { error } = await supabase
    .from('queue_entries')
    .update({
      barber_id: barberId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      is_dynamic: false,
    })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al iniciar servicio' }
  }

  revalidatePath('/barbero/fila')
  return { success: true }
}

export async function completeService(
  queueEntryId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  serviceId?: string,
  isRewardClaim: boolean = false,
  paymentAccountId?: string | null,
  extraServiceIds?: string[],
  productsToSell?: { id: string; quantity: number }[]
) {
  // Use admin client because barber pin authentications do not set a Supabase Auth session
  // This causes RLS on visits and client_points to fail when the queue trigger fires using SECURITY INVOKER
  const supabase = createAdminClient()

  // Obtener la entrada para validar que la sucursal pertenece a la org activa
  const { data: entryForValidation } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entryForValidation) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entryForValidation.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

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
    .select('id, client_id, branch_id, barber_id, commission_pct, service_id')
    .eq('queue_entry_id', queueEntryId)
    .single()

  if (!visit) {
    return { error: 'Error: visita no encontrada tras completar' }
  }

  // 3. Calculate proper amount and commission from the selected service(s)
  //    Commission priority: staff_service_commissions → services.default_commission_pct → salary_configs → staff.commission_pct
  let amount = 0
  let commissionAmount = 0
  const allServiceIds = [
    ...(serviceId ? [serviceId] : []),
    ...(extraServiceIds || [])
  ]

  // Obtener comisión global: salary_configs como fuente primaria, visit.commission_pct (staff) como fallback
  const { data: barberSalaryConfig } = await supabase
    .from('salary_configs')
    .select('commission_pct')
    .eq('staff_id', visit.barber_id)
    .single()

  const globalCommPct = barberSalaryConfig?.commission_pct != null
    ? Number(barberSalaryConfig.commission_pct)
    : Number(visit.commission_pct)

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

        // Resolve commission: barber override → service default → salary_configs → staff
        let commPct: number
        if (overrideMap.has(s.id)) {
          commPct = overrideMap.get(s.id)!
        } else if (Number(s.default_commission_pct) > 0) {
          commPct = Number(s.default_commission_pct)
        } else {
          commPct = globalCommPct
        }

        commissionAmount += price * (commPct / 100)
      }
    }
  }

  // 3.5 Calculate product prices and commissions using shared function
  if (productsToSell && productsToSell.length > 0) {
    const { processProductSales } = await import('./sales')
    const productResult = await processProductSales(supabase, visit.id, visit.barber_id, visit.branch_id, productsToSell)
    if (!('error' in productResult)) {
      amount += productResult.totalAmount
      commissionAmount += productResult.totalCommission
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

  // 7. Envío automático de mensaje de reseña por WhatsApp
  //    Lee la config, crea review_request y programa el mensaje para enviarse después del delay
  if (visit.client_id) {
    // Obtener org_id desde la branch de la visita para filtrar app_settings por organización
    const { data: branch } = await supabase
      .from('branches')
      .select('organization_id')
      .eq('id', visit.branch_id)
      .single()

    const { data: settings } = await supabase
      .from('app_settings')
      .select('review_auto_send, review_delay_minutes, review_message_template, wa_api_url')
      .eq('organization_id', branch?.organization_id)
      .maybeSingle()

    if (settings?.review_auto_send && settings?.wa_api_url) {
      const { data: client } = await supabase
        .from('clients')
        .select('name, phone')
        .eq('id', visit.client_id)
        .single()

      if (client?.phone) {
        // Crear review_request para generar el token de reseña
        const token = crypto.randomUUID()
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 7)

        const { data: reviewRequest } = await supabase
          .from('review_requests')
          .insert({
            client_id: visit.client_id,
            branch_id: visit.branch_id,
            visit_id: visit.id,
            barber_id: visit.barber_id,
            token,
            status: 'pending',
            expires_at: expiresAt.toISOString(),
          })
          .select('token')
          .single()

        if (reviewRequest) {
          const effectiveServiceId = serviceId || visit.service_id

          const [{ data: barber }, { data: service }] = await Promise.all([
            visit.barber_id
              ? supabase.from('staff').select('full_name').eq('id', visit.barber_id).single()
              : Promise.resolve({ data: null }),
            effectiveServiceId
              ? supabase.from('services').select('name').eq('id', effectiveServiceId).single()
              : Promise.resolve({ data: null }),
          ])

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://monaco.app'
          const reviewUrl = `${appUrl}/review/${reviewRequest.token}`

          const template = settings?.review_message_template ||
            '¡Hola {nombre}! Gracias por visitarnos 💈. Dejanos tu reseña: {link_resena}'

          // Formatear nombre: primera palabra, primera letra mayúscula y resto minúscula
          // Ej: "JUAN PEREZ" → "Juan", "jUan" → "Juan", "martin soba" → "Martin"
          const firstName = client.name.trim().split(/\s+/)[0]
          const formattedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()

          const message = template
            .replaceAll('{nombre}', formattedName)
            .replaceAll('{barbero}', barber?.full_name || 'tu barbero')
            .replaceAll('{servicio}', service?.name || 'el servicio')
            .replaceAll('{link_resena}', reviewUrl)

          const delayMinutes = settings?.review_delay_minutes ?? 15
          const scheduledFor = new Date()
          scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

          await supabase.from('scheduled_messages').insert({
            client_id: visit.client_id,
            content: message,
            scheduled_for: scheduledFor.toISOString(),
            phone: client.phone,
            status: 'pending',
          })
        }
      }
    }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/barbero/facturacion')
  revalidatePath('/barbero/rendimiento')
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  return { success: true, visitId: visit.id, breakAutoStarted }
}

export async function cancelQueueEntry(queueEntryId: string) {
  const supabase = createAdminClient()

  // Obtener la entrada para validar que la sucursal pertenece a la org activa
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { error } = await supabase
    .from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('id', queueEntryId)

  if (error) {
    return { error: 'Error al cancelar' }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function reassignBarber(
  queueEntryId: string,
  newBarberId: string | null
) {
  const supabase = createAdminClient()

  // Obtener branch_id de la entrada para validar acceso
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .eq('status', 'waiting')
    .single()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId, is_dynamic: !newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al reasignar barbero' }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function checkinClientByFace(
  clientId: string,
  branchId: string,
  barberId: string | null,
  serviceId: string | null = null
) {
  const supabase = createAdminClient()

  // Operación pública del kiosko: verificar que la sucursal exista y obtener su organización
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id, organization_id')
    .eq('id', branchId)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck?.organization_id) return { error: 'Sucursal no encontrada o inactiva' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .eq('organization_id', branchCheck.organization_id)
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
      is_dynamic: !barberId,
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
    return { error: 'Error al agregar a la fila' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  return { success: true, position, queueEntryId: queueEntry.id }
}

export async function reassignMyBarber(
  queueEntryId: string,
  newBarberId: string
) {
  const supabase = createAdminClient()

  // Operación pública del kiosko: verificar que la entrada y la sucursal existan
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  // Verificar que la sucursal esté activa (validación mínima para operaciones públicas)
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id')
    .eq('id', entry.branch_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck) return { error: 'Sucursal no encontrada o inactiva' }

  // Verificar que el nuevo barbero pertenece a la misma sucursal
  const { data: barberCheck } = await supabase
    .from('staff')
    .select('id')
    .eq('id', newBarberId)
    .eq('branch_id', entry.branch_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!barberCheck) return { error: 'Barbero no disponible en esta sucursal' }

  const { error } = await supabase
    .from('queue_entries')
    .update({ barber_id: newBarberId, is_dynamic: !newBarberId })
    .eq('id', queueEntryId)
    .eq('status', 'waiting')

  if (error) {
    return { error: 'Error al cambiar barbero' }
  }

  revalidatePath('/checkin')
  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true }
}

export async function updateQueueOrder(
  updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean }[]
) {
  if (updates.length === 0) return { success: true }

  const supabase = createAdminClient()

  // Validar que la primera entrada pertenece a una sucursal de la org activa
  const { data: firstEntry } = await supabase
    .from('queue_entries')
    .select('branch_id')
    .eq('id', updates[0].id)
    .maybeSingle()

  if (!firstEntry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(firstEntry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Usar RPC para hacer todas las actualizaciones en una sola transacción
  const payload = updates.map((u) => ({
    id: u.id,
    position: u.position,
    ...(u.barber_id !== undefined && { barber_id: u.barber_id ?? '' }),
    ...(u.is_dynamic !== undefined && { is_dynamic: u.is_dynamic }),
  }))

  const { error } = await supabase.rpc('batch_update_queue_entries', {
    p_updates: payload,
  })

  if (error) {
    return { error: 'Error al actualizar el orden de la fila' }
  }

  // No revalidatePath: la UI ya se actualizó optimísticamente
  // y Realtime sincroniza a los demás clientes
  return { success: true }
}

export async function createBreakEntry(branchId: string, barberId: string, breakConfigName: string) {
  const supabase = createAdminClient()

  // Validar que la sucursal pertenece a la org activa
  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  const { data: position } = await supabase.rpc('next_queue_position', {
    p_branch_id: branchId,
  })

  // Si el barbero no tiene un servicio activo, el descanso empieza de inmediato
  const { data: currentService } = await supabase
    .from('queue_entries')
    .select('id')
    .eq('barber_id', barberId)
    .eq('status', 'in_progress')
    .eq('is_break', false)
    .maybeSingle()

  const shouldStartImmediately = !currentService

  const { data: queueEntry, error } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      position: position ?? 1,
      status: shouldStartImmediately ? 'in_progress' : 'waiting',
      started_at: shouldStartImmediately ? new Date().toISOString() : null,
      is_break: true,
      is_dynamic: false,
    })
    .select('id')
    .single()

  if (error || !queueEntry) {
    return { error: 'Error al asignar descanso' }
  }

  revalidatePath('/dashboard/fila')
  revalidatePath('/barbero/fila')
  return { success: true, queueEntryId: queueEntry.id, position }
}
