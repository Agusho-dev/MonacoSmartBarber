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
            .select('id, trigger_config, branch_id')
            .eq('organization_id', visitOrgId)
            .eq('trigger_type', 'post_service')
            .eq('is_active', true)
            .order('priority', { ascending: false })

          if (postServiceWorkflows && postServiceWorkflows.length > 0) {
            for (const wf of postServiceWorkflows) {
              if (wf.branch_id && wf.branch_id !== visit.branch_id) continue

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

  // 8. Generar/actualizar salary_report de comisión diario al hacer checkout
  if (commissionAmount > 0) {
    try {
      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
      }).format(new Date())

      const { data: existingReport } = await supabase
        .from('salary_reports')
        .select('id, amount')
        .eq('staff_id', visit.barber_id)
        .eq('branch_id', visit.branch_id)
        .eq('type', 'commission')
        .eq('report_date', todayStr)
        .eq('status', 'pending')
        .maybeSingle()

      if (existingReport) {
        // Sumar la comisión de este servicio al reporte existente del día
        await supabase
          .from('salary_reports')
          .update({ amount: Number(existingReport.amount) + commissionAmount })
          .eq('id', existingReport.id)
      } else {
        // Crear reporte nuevo para el día
        await supabase
          .from('salary_reports')
          .insert({
            staff_id: visit.barber_id,
            branch_id: visit.branch_id,
            type: 'commission',
            amount: commissionAmount,
            report_date: todayStr,
            status: 'pending',
          })
      }
    } catch (err) {
      console.error('[SalaryReport] Error al generar reporte de comisión:', err)
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
