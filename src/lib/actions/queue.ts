'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'
import { validateBranchAccess, getCurrentOrgId } from './org'
import { getActiveTimezone } from '@/lib/i18n'
import { isValidUUID } from '@/lib/validation'

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

  // Rate limit: 20 check-ins por IP+branch cada 60s (permisivo para uso real, restrictivo contra bots)
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskCheckin(branchId)
  if (!gate.allowed) {
    return { error: 'Demasiados check-ins en poco tiempo. Esperá un momento.' }
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

  const now = new Date().toISOString()
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
      priority_order: now,
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
  if (!isValidUUID(queueEntryId) || !isValidUUID(barberId)) {
    return { error: 'Datos inválidos' }
  }
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

/**
 * Asigna atómicamente el próximo cliente al barbero e inicia el servicio.
 * Usa FIFO global: el cliente con menor priority_order que esté
 * asignado a este barbero o sea dinámico (barber_id IS NULL).
 * SELECT ... FOR UPDATE SKIP LOCKED previene race conditions entre barberos.
 */
export async function attendNextClient(barberId: string, branchId: string, preferredEntryId?: string) {
  if (!isValidUUID(barberId) || !isValidUUID(branchId)) {
    return { error: 'Datos inválidos' }
  }
  if (preferredEntryId && !isValidUUID(preferredEntryId)) {
    preferredEntryId = undefined
  }
  const supabase = createAdminClient()

  const orgAccess = await validateBranchAccess(branchId)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // 1. Asignar atómicamente el próximo cliente (prefiere el entry visible en la UI del barbero)
  const { data: entryId, error: assignError } = await supabase.rpc('assign_next_client', {
    p_barber_id: barberId,
    p_branch_id: branchId,
    p_preferred_entry_id: preferredEntryId ?? null,
  })

  if (assignError) {
    return { error: 'Error al asignar próximo cliente: ' + assignError.message }
  }

  if (!entryId) {
    return { success: true, entryId: null }
  }

  // 2. Iniciar servicio
  const { error: startError } = await supabase
    .from('queue_entries')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('status', 'waiting')

  if (startError) {
    return { error: 'Error al iniciar servicio' }
  }

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')
  return { success: true, entryId }
}

export async function completeService(
  queueEntryId: string,
  paymentMethod: 'cash' | 'card' | 'transfer',
  serviceId?: string,
  isRewardClaim: boolean = false,
  paymentAccountId?: string | null,
  extraServiceIds?: string[],
  productsToSell?: { id: string; quantity: number }[],
  tipAmount: number = 0,
  tipPaymentMethod: 'cash' | 'card' | 'transfer' | null = null,
  barberNote: string | null = null,
) {
  if (!isValidUUID(queueEntryId)) return { error: 'queueEntryId inválido' }
  if (serviceId && !isValidUUID(serviceId)) return { error: 'serviceId inválido' }
  if (paymentAccountId && !isValidUUID(paymentAccountId)) return { error: 'paymentAccountId inválido' }
  if (!Number.isFinite(tipAmount) || tipAmount < 0) return { error: 'tipAmount inválido' }
  if (tipPaymentMethod && !['cash','card','transfer'].includes(tipPaymentMethod)) {
    return { error: 'tipPaymentMethod inválido' }
  }

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

  // 1b. Si la queue entry proviene de un turno, marcarlo como completado
  const { data: queueEntryData } = await supabase
    .from('queue_entries')
    .select('appointment_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (queueEntryData?.appointment_id) {
    await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', queueEntryData.appointment_id)
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

  // Obtener esquema y comisión global: salary_configs como fuente primaria,
  // visit.commission_pct (staff) como fallback. El `scheme` determina si se le
  // paga comisión por servicios: los barberos con sueldo 'fixed' sólo cobran
  // comisión sobre productos, nunca sobre servicios.
  const { data: barberSalaryConfig } = await supabase
    .from('salary_configs')
    .select('scheme, commission_pct')
    .eq('staff_id', visit.barber_id)
    .single()

  const barberScheme = barberSalaryConfig?.scheme ?? null
  const isFixedSalary = barberScheme === 'fixed'

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

        // Sueldo fijo → 0 comisión por servicio, independientemente de overrides
        // por-servicio o por-barbero. La única vía de comisión para este
        // esquema es la venta de productos (ver bloque 3.5).
        if (isFixedSalary) continue

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
  let productCommissionAmount = 0
  if (productsToSell && productsToSell.length > 0) {
    const { processProductSales } = await import('./sales')
    const productResult = await processProductSales(supabase, visit.id, visit.barber_id, visit.branch_id, productsToSell)
    if (!('error' in productResult)) {
      amount += productResult.totalAmount
      productCommissionAmount = productResult.totalCommission
      commissionAmount += productCommissionAmount
    }
  }

  // 3.6 Restar prepagos ya cobrados del turno asociado (migración 109).
  //     Si el turno ya tiene una visita de prepago (queue_entry_id IS NULL,
  //     mismo appointment_id), esa plata ya impactó en caja; esta visita
  //     sólo registra el remanente.
  if (queueEntryData?.appointment_id) {
    const { data: priorPrepayments } = await supabase
      .from('visits')
      .select('amount')
      .eq('appointment_id', queueEntryData.appointment_id)
      .is('queue_entry_id', null)

    const prepaidTotal = (priorPrepayments ?? []).reduce((sum, v) => sum + Number(v.amount ?? 0), 0)
    if (prepaidTotal > 0) {
      amount = Math.max(0, amount - prepaidTotal)
      // Las comisiones se calculan sobre el precio total del servicio (ya computadas
      // arriba); el prepago es sólo una partición del cobro, no afecta la comisión.
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
  if (tipAmount > 0) {
    visitUpdate.tip_amount = tipAmount
    visitUpdate.tip_payment_method = tipPaymentMethod ?? paymentMethod
  }
  if (barberNote && barberNote.trim().length > 0) {
    visitUpdate.barber_note = barberNote.trim().slice(0, 500)
  }

  await supabase
    .from('visits')
    .update(visitUpdate)
    .eq('id', visit.id)

  if (paymentMethod === 'transfer' && paymentAccountId) {
    await recordTransfer(visit.id, paymentAccountId, amount, visit.branch_id)
  }

  // 5. Handle reward redemption (deduct points)
  if (isRewardClaim && visit.client_id && visit.branch_id) {
    const orgId = await getCurrentOrgId()

    const { data: config } = await supabase
      .from('rewards_config')
      .select('redemption_threshold')
      .eq('branch_id', visit.branch_id)
      .eq('is_active', true)
      .single()

    const cost = config?.redemption_threshold || 10

    // Filtrar client_points por org para evitar canjes cruzados
    let cpQuery = supabase
      .from('client_points')
      .select('points_balance, total_redeemed')
      .eq('client_id', visit.client_id)
      .eq('branch_id', visit.branch_id)
    if (orgId) cpQuery = (cpQuery as typeof cpQuery).eq('organization_id', orgId)
    const { data: clientPoints } = await cpQuery.maybeSingle()

    if (clientPoints && clientPoints.points_balance >= cost) {
      // Insert redemption transaction
      await supabase.from('point_transactions').insert({
        client_id: visit.client_id,
        visit_id: visit.id,
        points: -cost,
        type: 'redeemed',
        description: 'Canje de beneficio',
      })

      // Descontar puntos escopado a org+branch
      let updateQuery = supabase
        .from('client_points')
        .update({
          points_balance: clientPoints.points_balance - cost,
          total_redeemed: (clientPoints.total_redeemed || 0) + cost,
        })
        .eq('client_id', visit.client_id)
        .eq('branch_id', visit.branch_id)
      if (orgId) updateQuery = (updateQuery as typeof updateQuery).eq('organization_id', orgId)
      await updateQuery
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

  // 7. Reglas post-servicio: buscar reglas con trigger_type='post_service' y programar mensajes
  if (visit.client_id) {
    try {
      const { data: branch } = await supabase
        .from('branches')
        .select('organization_id')
        .eq('id', visit.branch_id)
        .single()

      const visitOrgId = branch?.organization_id
      if (visitOrgId) {
        const { data: client } = await supabase
          .from('clients')
          .select('name, phone')
          .eq('id', visit.client_id)
          .single()

        if (client?.phone) {
          // Buscar reglas post_service activas para esta org
          const { data: postServiceRules } = await supabase
            .from('auto_reply_rules')
            .select('*')
            .eq('organization_id', visitOrgId)
            .eq('trigger_type', 'post_service')
            .eq('is_active', true)
            .order('priority', { ascending: false })

          // También verificar la config legacy de app_settings como fallback
          const { data: settings } = await supabase
            .from('app_settings')
            .select('review_auto_send, review_delay_minutes, review_template_name')
            .eq('organization_id', visitOrgId)
            .maybeSingle()

          // Ejecutar reglas post_service (auto_reply_rules legacy)
          if (postServiceRules && postServiceRules.length > 0) {
            for (const rule of postServiceRules) {
              const delayMinutes = (rule.trigger_config as any)?.delay_minutes ?? 10
              const scheduledFor = new Date()
              scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

              if (rule.response_type === 'template' && rule.response_template_name) {
                const { error: schedErr } = await supabase.from('scheduled_messages').insert({
                  client_id: visit.client_id,
                  template_name: rule.response_template_name,
                  template_language: rule.response_template_language || 'es_AR',
                  scheduled_for: scheduledFor.toISOString(),
                  phone: client.phone,
                  status: 'pending',
                })
                if (schedErr) {
                  console.error('[PostService] Error programando template:', schedErr.message)
                } else {
                  console.log('[PostService] Template programado para', client.phone, 'regla:', rule.name)
                }
              } else if (rule.response_text) {
                const { error: schedErr } = await supabase.from('scheduled_messages').insert({
                  client_id: visit.client_id,
                  content: rule.response_text,
                  scheduled_for: scheduledFor.toISOString(),
                  phone: client.phone,
                  status: 'pending',
                })
                if (schedErr) {
                  console.error('[PostService] Error programando texto:', schedErr.message)
                } else {
                  console.log('[PostService] Texto programado para', client.phone, 'regla:', rule.name)
                }
              }
            }
          }

          // Buscar automation_workflows con trigger post_service
          const { data: postServiceWorkflows } = await supabase
            .from('automation_workflows')
            .select('id, trigger_config, branch_id, overlap_policy, category')
            .eq('organization_id', visitOrgId)
            .eq('trigger_type', 'post_service')
            .eq('is_active', true)
            .order('priority', { ascending: false })

          if (postServiceWorkflows && postServiceWorkflows.length > 0) {
            // Resolver convId del cliente una sola vez para chequeos de overlap.
            // Coincide con la lógica de process-scheduled-messages: lookup por sufijo
            // de teléfono dentro de los canales WA activos de la org.
            const phoneSuffix = (client.phone ?? '').replace(/\D/g, '').slice(-10)
            let clientConvId: string | null = null
            if (phoneSuffix) {
              const { data: orgChannels } = await supabase
                .from('social_channels')
                .select('id')
                .eq('platform', 'whatsapp')
                .eq('is_active', true)
                .eq('organization_id', visitOrgId)
              const channelIds = orgChannels?.map((c: { id: string }) => c.id) ?? []
              if (channelIds.length > 0) {
                const { data: convRow } = await supabase
                  .from('conversations')
                  .select('id')
                  .in('channel_id', channelIds)
                  .ilike('platform_user_id', `%${phoneSuffix}`)
                  .order('last_message_at', { ascending: false, nullsFirst: false })
                  .limit(1)
                  .maybeSingle()
                clientConvId = convRow?.id ?? null
              }
            }

            for (const wf of postServiceWorkflows) {
              if (wf.branch_id && wf.branch_id !== visit.branch_id) continue

              // Respetar overlap_policy del workflow.
              // skip_if_active: si ya hay scheduled_message pending o workflow_execution
              // activa para este cliente+workflow, no re-encolar (evita el solape).
              if (wf.overlap_policy === 'skip_if_active') {
                const { count: pendingCount } = await supabase
                  .from('scheduled_messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('workflow_id', wf.id)
                  .eq('client_id', visit.client_id)
                  .eq('status', 'pending')
                if ((pendingCount ?? 0) > 0) {
                  console.log('[PostService:Workflow] skip_if_active: ya hay pending para wf', wf.id)
                  continue
                }
                if (clientConvId) {
                  const { count: activeCount } = await supabase
                    .from('workflow_executions')
                    .select('id', { count: 'exact', head: true })
                    .eq('workflow_id', wf.id)
                    .eq('conversation_id', clientConvId)
                    .in('status', ['active', 'waiting_reply'])
                  if ((activeCount ?? 0) > 0) {
                    console.log('[PostService:Workflow] skip_if_active: ya hay execution activa para wf', wf.id)
                    continue
                  }
                }
              }

              const delayMinutes = (wf.trigger_config as any)?.delay_minutes ?? 10
              const scheduledFor = new Date()
              scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

              const [{ data: entryNode }, { data: edges }] = await Promise.all([
                supabase
                  .from('workflow_nodes')
                  .select('id')
                  .eq('workflow_id', wf.id)
                  .eq('is_entry_point', true)
                  .limit(1)
                  .maybeSingle(),
                supabase
                  .from('workflow_edges')
                  .select('source_node_id, target_node_id')
                  .eq('workflow_id', wf.id)
                  .order('sort_order')
              ])

              if (!entryNode || !edges || edges.length === 0) continue

              const firstEdge = edges.find((e: any) => e.source_node_id === entryNode.id)
              if (!firstEdge) continue
              const { data: firstActionNode } = await supabase
                .from('workflow_nodes')
                .select('id, node_type, config')
                .eq('id', firstEdge.target_node_id)
                .single()

              if (!firstActionNode) continue

              // Buscar el nodo siguiente al primer action (para workflow_trigger_data)
              const { data: nextEdges } = await supabase
                .from('workflow_edges')
                .select('target_node_id')
                .eq('workflow_id', wf.id)
                .eq('source_node_id', firstActionNode.id)
                .order('sort_order')
                .limit(1)

              const nextNodeId = nextEdges?.[0]?.target_node_id ?? null

              const insertData: Record<string, unknown> = {
                client_id: visit.client_id,
                phone: client.phone,
                organization_id: visitOrgId,
                scheduled_for: scheduledFor.toISOString(),
                status: 'pending',
                workflow_id: wf.id,
                workflow_trigger_data: {
                  client_name: client.name,
                  branch_id: visit.branch_id,
                  visit_id: visit.id,
                  entry_node_id: entryNode.id,
                  first_action_node_id: firstActionNode.id,
                  next_node_id: nextNodeId,
                },
              }

              const actionConfig = firstActionNode.config as Record<string, unknown>
              if (firstActionNode.node_type === 'send_template') {
                insertData.template_name = actionConfig.template_name as string
                insertData.template_language = (actionConfig.language_code as string) || 'es_AR'
              } else if (firstActionNode.node_type === 'send_message') {
                insertData.content = actionConfig.text as string
              }

              const { error: schedErr } = await supabase
                .from('scheduled_messages')
                .insert(insertData)

              if (schedErr) {
                console.error('[PostService:Workflow] Error programando workflow:', schedErr.message)
              } else {
                console.log('[PostService:Workflow] Workflow', wf.id, 'programado para', client.phone)
              }
            }
          } else if (
            !(postServiceRules && postServiceRules.length > 0) &&
            settings?.review_auto_send && settings.review_template_name
          ) {
            // Fallback legacy: usar app_settings si no hay reglas ni workflows post_service
            const delayMinutes = settings.review_delay_minutes ?? 15
            const scheduledFor = new Date()
            scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

            const { error: schedErr } = await supabase.from('scheduled_messages').insert({
              client_id: visit.client_id,
              template_name: settings.review_template_name,
              template_language: 'es_AR',
              scheduled_for: scheduledFor.toISOString(),
              phone: client.phone,
              status: 'pending',
            })
            if (schedErr) {
              console.error('[AutoSend] Error creando scheduled_message:', schedErr.message)
            } else {
              console.log('[AutoSend] Legacy template programado para', client.phone)
            }
          }
        }
      }
    } catch (err) {
      console.error('[PostService] Error en reglas post-servicio:', err)
    }
  }

  // 8. Generar/actualizar salary_reports separados: servicio y producto
  const serviceCommissionAmount = commissionAmount - productCommissionAmount
  try {
    const tz = await getActiveTimezone()
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

    // 8a. Reporte de comisión por servicio
    if (serviceCommissionAmount > 0) {
      const { data: existingServiceReport } = await supabase
        .from('salary_reports')
        .select('id, amount')
        .eq('staff_id', visit.barber_id)
        .eq('branch_id', visit.branch_id)
        .eq('type', 'commission')
        .eq('report_date', todayStr)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingServiceReport) {
        await supabase
          .from('salary_reports')
          .update({ amount: Number(existingServiceReport.amount) + serviceCommissionAmount })
          .eq('id', existingServiceReport.id)
      } else {
        await supabase
          .from('salary_reports')
          .insert({
            staff_id: visit.barber_id,
            branch_id: visit.branch_id,
            type: 'commission',
            amount: serviceCommissionAmount,
            report_date: todayStr,
            status: 'pending',
          })
      }
    }

    // 8b. Reporte de comisión por producto (separado)
    if (productCommissionAmount > 0) {
      const { data: existingProductReport } = await supabase
        .from('salary_reports')
        .select('id, amount')
        .eq('staff_id', visit.barber_id)
        .eq('branch_id', visit.branch_id)
        .eq('type', 'product_commission')
        .eq('report_date', todayStr)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingProductReport) {
        await supabase
          .from('salary_reports')
          .update({ amount: Number(existingProductReport.amount) + productCommissionAmount })
          .eq('id', existingProductReport.id)
      } else {
        await supabase
          .from('salary_reports')
          .insert({
            staff_id: visit.barber_id,
            branch_id: visit.branch_id,
            type: 'product_commission',
            amount: productCommissionAmount,
            report_date: todayStr,
            status: 'pending',
          })
      }
    }
  } catch (err) {
    console.error('[SalaryReport] Error al generar reportes de comisión:', err)
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
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
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
  if (!isValidUUID(queueEntryId)) return { error: 'queueEntryId inválido' }
  if (newBarberId !== null && !isValidUUID(newBarberId)) return { error: 'barberId inválido' }
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
  if (!isValidUUID(clientId) || !isValidUUID(branchId)) return { error: 'Datos inválidos' }
  if (barberId !== null && !isValidUUID(barberId)) barberId = null
  if (serviceId !== null && !isValidUUID(serviceId)) serviceId = null
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

  const nowFace = new Date().toISOString()
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
      priority_order: nowFace,
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
  if (!isValidUUID(queueEntryId) || !isValidUUID(newBarberId)) return { error: 'Datos inválidos' }
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
  updates: { id: string; position: number; barber_id?: string | null; is_dynamic?: boolean; priority_order?: string }[]
) {
  if (updates.length === 0) return { success: true }
  // Validar que todos los IDs son UUIDs válidos antes de consultar DB
  if (updates.some(u => !isValidUUID(u.id))) return { error: 'IDs inválidos' }
  if (updates.some(u => u.barber_id != null && !isValidUUID(u.barber_id))) {
    return { error: 'barberId inválido' }
  }

  const supabase = createAdminClient()

  // Cargar branch_id de TODOS los IDs y validar que todos pertenecen a la misma org
  const allIds = updates.map(u => u.id)
  const { data: allEntries } = await supabase
    .from('queue_entries')
    .select('id, branch_id')
    .in('id', allIds)

  if (!allEntries || allEntries.length !== allIds.length) {
    return { error: 'Una o más entradas no encontradas' }
  }

  // Validar la primera sucursal (todas deben pertenecer a la misma org)
  const orgAccess = await validateBranchAccess(allEntries[0].branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Verificar que no hay entradas de otras sucursales fuera de la org
  const { getOrgBranchIds } = await import('./org')
  const orgBranchIds = await getOrgBranchIds()
  const foreignEntry = allEntries.find(e => !orgBranchIds.includes(e.branch_id))
  if (foreignEntry) return { error: 'Acceso denegado: entradas de otra organización' }

  // Usar RPC para hacer todas las actualizaciones en una sola transacción
  const payload = updates.map((u) => ({
    id: u.id,
    position: u.position,
    ...(u.barber_id !== undefined && { barber_id: u.barber_id ?? '' }),
    ...(u.is_dynamic !== undefined && { is_dynamic: u.is_dynamic }),
    ...(u.priority_order !== undefined && { priority_order: u.priority_order }),
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

/**
 * Pausa el corte activo: marca `paused_at = now()` si no está ya pausado.
 * La duración total de la pausa se acumula en `paused_duration_seconds` al reanudar.
 */
export async function pauseActiveService(queueEntryId: string) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, status, is_break, paused_at')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }
  if (entry.is_break) return { error: 'No se pueden pausar descansos' }
  if (entry.status !== 'in_progress') return { error: 'El corte no está activo' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  if (entry.paused_at) return { success: true, alreadyPaused: true }

  const { error } = await supabase
    .from('queue_entries')
    .update({ paused_at: new Date().toISOString() })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')
    .is('paused_at', null)

  if (error) return { error: 'Error al pausar: ' + error.message }

  revalidatePath('/barbero/fila')
  return { success: true }
}

/**
 * Reanuda el corte: acumula en `paused_duration_seconds` el tiempo que estuvo
 * pausado y setea `paused_at = null`.
 */
export async function resumeActiveService(queueEntryId: string) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, status, is_break, paused_at, paused_duration_seconds')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }
  if (entry.is_break) return { error: 'Operación inválida para descansos' }
  if (entry.status !== 'in_progress') return { error: 'El corte no está activo' }
  if (!entry.paused_at) return { success: true, alreadyRunning: true }

  const pausedMs = Date.now() - new Date(entry.paused_at).getTime()
  const additionalSec = Math.max(0, Math.floor(pausedMs / 1000))
  const newTotal = (entry.paused_duration_seconds ?? 0) + additionalSec

  const { error } = await supabase
    .from('queue_entries')
    .update({
      paused_at: null,
      paused_duration_seconds: newTotal,
    })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')

  if (error) return { error: 'Error al reanudar: ' + error.message }

  revalidatePath('/barbero/fila')
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

  const nowBreak = new Date().toISOString()
  const { data: queueEntry, error } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      barber_id: barberId,
      position: position ?? 1,
      status: shouldStartImmediately ? 'in_progress' : 'waiting',
      started_at: shouldStartImmediately ? nowBreak : null,
      is_break: true,
      is_dynamic: false,
      priority_order: nowBreak,
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
