'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { recordTransfer } from '@/lib/actions/paymentAccounts'
import { validateBranchAccess, getCurrentOrgId } from './org'
import { getActiveTimezone } from '@/lib/i18n'
import { isValidUUID } from '@/lib/validation'

export async function checkinClient(formData: FormData) {
  const supabase = createAdminClient()
  const rawName = ((formData.get('name') as string | null) ?? '').trim()
  const rawPhone = ((formData.get('phone') as string | null) ?? '').trim()
  const branchId = formData.get('branch_id') as string
  const barberId = (formData.get('barber_id') as string | null) || null
  const serviceId = (formData.get('service_id') as string | null) || null
  const specialFlag = formData.get('special')
  const isSpecialRequested = specialFlag === '1' || specialFlag === 'true'

  // "Cliente especial": walk-in sin teléfono (un niño, un invitado, alguien que no
  // deja su número). El staff lo marca con el toggle del registro manual; por compat
  // histórica también lo inferimos si tipea un teléfono placeholder degenerado (todos
  // ceros / un solo dígito repetido, de cualquier largo). Un placeholder así no
  // identifica a nadie y, peor, choca contra el UNIQUE (organization_id, phone) en
  // cuanto entra el segundo del día → "Error al registrar cliente". Igual que el
  // kiosko, a cada uno le damos un teléfono virtual ÚNICO 00XXXXXXXX para que sea su
  // propio registro, y nos salteamos el dedup por teléfono.
  const phoneDigits = rawPhone.replace(/\D/g, '')
  const isDegeneratePhone = phoneDigits.length > 0 && /^(.)\1*$/.test(phoneDigits)
  const isSpecial = isSpecialRequested || isDegeneratePhone

  const name = isSpecial ? (rawName || 'Cliente especial') : rawName
  const phone = rawPhone

  if (!branchId) {
    return { error: 'Falta la sucursal' }
  }
  if (!isSpecial && (!name || !phone)) {
    return { error: 'Nombre y teléfono son obligatorios' }
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

  // Cliente especial: NO buscamos duplicado. Cada walk-in sin teléfono es una persona
  // distinta y merece su propio registro (con teléfono virtual único). El dedup por
  // teléfono no aplica acá (y find_client_id_by_phone ya descarta degenerados, mig 150).
  let existingClient: { id: string } | null = null
  if (!isSpecial) {
    // Buscar cliente existente por teléfono NORMALIZADO (últimos 10 dígitos), no por
    // string exacto: Prode y el check-in guardan el mismo número en formatos distintos
    // (con/sin prefijo país) y el match exacto creaba un cliente DUPLICADO por persona
    // → el cupón de bienvenida quedaba en una fila y las visitas en otra, rompiendo el
    // canje ("pertenece a otro cliente"). Ver mig 149 / find_client_id_by_phone.
    const { data: matchedClientId, error: matchErr } = await supabase.rpc('find_client_id_by_phone', {
      p_org: branchResult.organization_id,
      p_phone: phone,
    })
    if (matchErr) {
      // Fail-closed: ante un fallo transitorio de la RPC NO seguimos al insert, porque
      // crearía un cliente DUPLICADO (un reintento del cliente es barato; una identidad
      // partida no). Ver mig 149 y CLAUDE.md riesgo #5/#12.
      console.error('[checkinClient] find_client_id_by_phone:', matchErr.message)
      return { error: 'No se pudo verificar el cliente, intentá de nuevo' }
    }
    existingClient = matchedClientId ? { id: matchedClientId as string } : null
  }

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
  } else if (isSpecial) {
    // Teléfono virtual único 00XXXXXXXX (mismo formato que el kiosko). Reintentamos si
    // por casualidad astronómica choca con el UNIQUE (organization_id, phone).
    let inserted: { id: string } | null = null
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const virtualPhone = `00${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({ name, phone: virtualPhone, organization_id: branchResult.organization_id })
        .select('id')
        .single()
      if (newClient) {
        inserted = newClient
      } else if (error?.code !== '23505') {
        console.error('[checkinClient] insert cliente especial:', error?.message)
        return { error: 'Error al registrar cliente' }
      }
      // 23505 → colisión rarísima del teléfono virtual: reintenta con otro número.
    }
    if (!inserted) {
      return { error: 'No se pudo registrar el cliente, intentá de nuevo' }
    }
    clientId = inserted.id
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

  // Modelo pool (mig 134): si el cliente eligió "Menor espera", la entry
  // entra con barber_id = NULL y vive en el pool compartido — la reclama el
  // primer barbero libre vía claim_next_for_barber (FIFO por priority_order,
  // sin binding sticky). La pre-asignación visual la hace el cliente
  // (assignDynamicBarbers) y es solo un hint informativo, no vincula nada.
  const now = new Date().toISOString()
  const { data: queueEntry, error: queueError } = await supabase
    .from('queue_entries')
    .insert({
      branch_id: branchId,
      client_id: clientId,
      // null = dinámico de pool ("Menor espera"); seteado = barbero específico
      barber_id: barberId,
      service_id: serviceId,
      position: position ?? 1,
      status: 'waiting',
      // !barberId = eligió "Menor espera" → dinámico de pool
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
 * Usa el RPC `claim_next_for_barber` (mig 131, modelo pool desde mig 134):
 * un único round trip que decide entre ghost de descanso listo, cliente
 * específico mío o dinámico de pool (FIFO global por priority_order), y deja
 * el entry en `in_progress` con `started_at = NOW()`.
 *
 * Pool NO bloqueante: cualquier barbero libre puede reclamar cualquier
 * dinámico — sin binding sticky ni fairness gate. La atomicidad la garantiza
 * FOR UPDATE SKIP LOCKED en Postgres.
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

  const { data, error } = await supabase.rpc('claim_next_for_barber', {
    p_barber_id: barberId,
    p_branch_id: branchId,
    p_preferred_entry_id: preferredEntryId ?? null,
  })

  if (error) {
    return { error: 'Error al asignar próximo cliente: ' + error.message }
  }

  const claim = (data as Array<{ entry_id: string; is_break: boolean; was_dynamic: boolean }> | null)?.[0]

  revalidatePath('/barbero/fila')
  revalidatePath('/dashboard/fila')

  if (!claim) {
    return { success: true as const, entryId: null }
  }

  if (claim.is_break) {
    return { success: true as const, entryId: null, breakStarted: true }
  }

  return { success: true as const, entryId: claim.entry_id, wasDynamic: claim.was_dynamic }
}

/** Traduce los códigos de error de la RPC redeem_coupon_for_visit a texto en español. */
function mapCouponError(code: string | undefined): string {
  switch (code) {
    case 'wrong_client': return 'El cupón pertenece a otro cliente'
    case 'wrong_org': return 'El cupón es de otra organización'
    case 'already_redeemed': return 'El cupón ya fue canjeado'
    case 'expired': return 'El cupón está vencido'
    case 'not_found': return 'Cupón no encontrado'
    case 'not_available': return 'El cupón no está disponible'
    case 'no_discount': return 'El cupón no tiene descuento aplicable'
    case 'not_active_yet': return 'El cupón todavía no está activo (se activa un rato después de crear la cuenta)'
    case 'wrong_weekday': return 'Este cupón solo se puede canjear de lunes a miércoles'
    case 'visit_not_found': return 'No se encontró la visita'
    default: return 'No se pudo aplicar el cupón'
  }
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
  // Cupón de descuento (client_rewards.qr_code) escaneado en el cobro. Se valida
  // sin consumir al escanear; acá se consume atómicamente al confirmar la venta.
  couponQrCode: string | null = null,
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
  //    which creates a visit record with amount=0 as placeholder.
  //    `.select('id')` nos da el rowcount: si la UPDATE matchea 0 filas
  //    significa que el entry YA no estaba en 'in_progress' (doble-tap,
  //    reintento de red tras AbortError de 8s, dos pestañas/dispositivos). En
  //    ese caso el trigger NO disparó de nuevo (es idempotente vía
  //    OLD.status='in_progress'), pero el RESTO de este server action SÍ correría
  //    sus efectos colaterales (recordTransfer, processProductSales, redención
  //    de puntos, salary_reports, mensajes post-servicio) sobre la visita ya
  //    existente, duplicándolos. Cortamos acá ANTES de cualquier efecto.
  //    (Auditoría jun-2026: este doble-disparo infló caja en +272.000 ARS.)
  const { data: completedRows, error } = await supabase
    .from('queue_entries')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', queueEntryId)
    .eq('status', 'in_progress')
    .select('id')

  if (error) {
    console.error('completeService error:', error)
    return { error: 'Error al completar servicio: ' + error.message }
  }

  if (!completedRows || completedRows.length === 0) {
    // Ya fue completado por una llamada previa: retorno idempotente, sin efectos.
    console.warn(`[completeService] entry ${queueEntryId} ya no estaba in_progress; retorno idempotente`)
    return { success: true as const, alreadyCompleted: true as const }
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
    // Paralelizar: precios de servicios y overrides de comisión son independientes entre sí
    const [{ data: activeServices }, { data: barberOverrides }] = await Promise.all([
      supabase
        .from('services')
        .select('id, price, default_commission_pct')
        .in('id', allServiceIds),
      supabase
        .from('staff_service_commissions')
        .select('service_id, commission_pct')
        .eq('staff_id', visit.barber_id)
        .in('service_id', allServiceIds),
    ])

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

  // Subtotal de servicios (principal + extras). Es la base del descuento por cupón:
  // el 20% se aplica SOLO a servicios, no a productos ni a la propina.
  const serviceSubtotal = amount

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

  // 4. Update the visit with correct data (amount = bruto neto de prepagos; SIN cupón
  //    todavía — el descuento del cupón lo aplica la RPC abajo, atómico con el consumo).
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

  const { error: visitUpdateError } = await supabase
    .from('visits')
    .update(visitUpdate)
    .eq('id', visit.id)
  if (visitUpdateError) {
    console.error('[completeService] error al actualizar la visita:', visitUpdateError.message)
  }

  // 4.5 Canje de cupón de descuento (client_rewards) al confirmar el cobro.
  //     La RPC redeem_coupon_for_visit hace EN UNA SOLA TRANSACCIÓN: validar
  //     (dueño/org/vigencia), consumir (lock + guarda anti-doble-canje) y escribir el
  //     descuento sobre la visita (amount/discount_amount/client_reward_id). Así
  //     consumo y descuento NUNCA divergen. No usa auth.uid → sirve en el panel PIN.
  //     Va DESPUÉS del write base de la visita (la RPC necesita leer el amount bruto)
  //     y DESPUÉS del guard idempotente (un reintento sobre un entry ya completado
  //     retorna antes y nunca re-consume). El descuento aplica solo a servicios; la
  //     comisión queda sobre el bruto (el cupón no recorta la paga del barbero).
  //     FAIL-OPEN: si el cupón ya no es canjeable o si el write base falló, NO se
  //     consume y se cobra a precio lleno con un aviso para el barbero.
  let couponClientRewardId: string | null = null
  let couponDiscountAmount = 0
  let couponWarning: string | null = null
  if (couponQrCode && !isRewardClaim) {
    const cleanCoupon = couponQrCode.trim().toLowerCase()
    if (visitUpdateError) {
      couponWarning = 'No se pudo registrar el cobro; el cupón no se canjeó'
    } else if (!/^[0-9a-f-]{8,64}$/.test(cleanCoupon)) {
      couponWarning = 'El código del cupón no es válido; se cobró sin descuento'
    } else if (serviceSubtotal <= 0) {
      couponWarning = 'No hay servicio para aplicar el descuento; el cupón no se canjeó'
    } else {
      const { data: redeemData, error: redeemErr } = await supabase.rpc('redeem_coupon_for_visit', {
        p_qr_code: cleanCoupon,
        p_visit_id: visit.id,
        p_service_subtotal: serviceSubtotal,
      })
      const row = (redeemData ?? {}) as {
        success?: boolean
        error?: string
        discount_amount?: number | null
        net_amount?: number | null
        client_reward_id?: string
      }
      if (redeemErr || !row.success) {
        if (redeemErr) console.error('[completeService] redeem_coupon_for_visit error:', redeemErr.message)
        couponWarning = mapCouponError(row.error) + '; se cobró sin descuento'
      } else {
        couponClientRewardId = row.client_reward_id ?? null
        couponDiscountAmount = Number(row.discount_amount ?? 0)
        // La RPC ya escribió el amount neto en la visita; usamos ese neto para caja/transfer.
        amount = Number(row.net_amount ?? amount)
      }
    }
  }

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

    // Filtrar client_points por org para evitar canjes cruzados.
    // NO filtrar por branch_id: la fila es única por (client_id, organization_id)
    // (idx_client_points_unique_client_org) y branch_id puede ser NULL o de otra
    // sucursal de la misma org → filtrar por branch perdía la fila y abortaba el
    // canje (entregaba el premio sin descontar puntos). Auditoría jun-2026 #15.
    let cpQuery = supabase
      .from('client_points')
      .select('points_balance, total_redeemed')
      .eq('client_id', visit.client_id)
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

      // Descontar puntos escopado a org (fila única por client_id+organization_id).
      let updateQuery = supabase
        .from('client_points')
        .update({
          points_balance: clientPoints.points_balance - cost,
          total_redeemed: (clientPoints.total_redeemed || 0) + cost,
        })
        .eq('client_id', visit.client_id)
      if (orgId) updateQuery = (updateQuery as typeof updateQuery).eq('organization_id', orgId)
      await updateQuery
    }
  }

  // 6. Auto-start SOLO del ghost de descanso si está listo.
  //
  //    Rollback intencional del push-on-complete (estaba en mig 131): arrancar
  //    automáticamente el siguiente CLIENTE rompía el flujo natural de barbería
  //    — el cronómetro disparaba aunque el cliente no estuviera todavía en la
  //    silla, generando "cortes fantasma" que el supervisor tenía que cancelar
  //    (incidente Fabrizio/Santino vela, 2026-05-09 22:14).
  //
  //    El descanso SÍ debe arrancar automáticamente: el barbero ya lo solicitó
  //    y aprobó, no requiere presencia física del cliente. El siguiente cliente
  //    se inicia con tap manual de "Atender" cuando físicamente está sentado.
  //
  //    Política: el ghost arranca si NO hay clientes ASIGNADOS específicamente
  //    a este barbero antes de él (priority menor). Los dinámicos no bloquean.
  let breakAutoStarted = false

  const { data: nextGhosts } = await supabase
    .from('queue_entries')
    .select('id, priority_order')
    .eq('barber_id', visit.barber_id)
    .eq('branch_id', visit.branch_id)
    .eq('status', 'waiting')
    .eq('is_break', true)
    .order('priority_order', { ascending: true })
    .limit(1)

  if (nextGhosts && nextGhosts.length > 0) {
    const nextGhost = nextGhosts[0]

    const { data: realWaitingBeforeBreak } = await supabase
      .from('queue_entries')
      .select('id')
      .eq('barber_id', visit.barber_id)
      .eq('branch_id', visit.branch_id)
      .eq('status', 'waiting')
      .eq('is_break', false)
      .lt('priority_order', nextGhost.priority_order)
      .limit(1)

    if (!realWaitingBeforeBreak || realWaitingBeforeBreak.length === 0) {
      const { error: ghostStartError } = await supabase
        .from('queue_entries')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('id', nextGhost.id)
        .eq('status', 'waiting')

      if (!ghostStartError) {
        breakAutoStarted = true
      }
    }
  }

  // 7. Reglas post-servicio: buscar reglas con trigger_type='post_service' y programar mensajes
  if (visit.client_id) {
    try {
      const { data: branch, error: branchErr } = await supabase
        .from('branches')
        .select('organization_id')
        .eq('id', visit.branch_id)
        .single()
      if (branchErr) {
        console.error(`[PostService visit=${visit.id}] branch lookup error:`, branchErr.message)
      }

      const visitOrgId = branch?.organization_id
      if (!visitOrgId) {
        console.warn(`[PostService visit=${visit.id}] skip: sucursal sin organization_id (branch=${visit.branch_id})`)
      }
      if (visitOrgId) {
        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .select('name, phone')
          .eq('id', visit.client_id)
          .single()
        if (clientErr) {
          console.error(`[PostService visit=${visit.id}] client lookup error:`, clientErr.message)
        }

        if (!client?.phone) {
          console.warn(`[PostService visit=${visit.id}] skip: cliente sin teléfono (client=${visit.client_id})`)
        }
        if (client?.phone) {
          // Paralelizar: reglas post_service y app_settings son independientes entre sí
          const [{ data: postServiceRules }, { data: settings }] = await Promise.all([
            supabase
              .from('auto_reply_rules')
              .select('*')
              .eq('organization_id', visitOrgId)
              .eq('trigger_type', 'post_service')
              .eq('is_active', true)
              .order('priority', { ascending: false }),
            supabase
              .from('app_settings')
              .select('review_auto_send, review_delay_minutes, review_template_name')
              .eq('organization_id', visitOrgId)
              .maybeSingle(),
          ])

          // Ejecutar reglas post_service (auto_reply_rules legacy)
          if (postServiceRules && postServiceRules.length > 0) {
            for (const rule of postServiceRules) {
              const delayMinutes = (rule.trigger_config as { delay_minutes?: number } | null)?.delay_minutes ?? 10
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

          // Paralelizar: workflows y canales WA son independientes entre sí.
          // orgChannels se resuelve aquí para que, si hay workflows, el convId
          // ya esté disponible sin un RTT extra.
          const phoneSuffix = (client.phone ?? '').replace(/\D/g, '').slice(-10)
          const [
            { data: postServiceWorkflows, error: wfLookupErr },
            { data: orgChannels },
          ] = await Promise.all([
            supabase
              .from('automation_workflows')
              .select('id, name, trigger_config, branch_id, overlap_policy, category')
              .eq('organization_id', visitOrgId)
              .eq('trigger_type', 'post_service')
              .eq('is_active', true)
              .order('priority', { ascending: false }),
            phoneSuffix
              ? supabase
                  .from('social_channels')
                  .select('id')
                  .eq('platform', 'whatsapp')
                  .eq('is_active', true)
                  .eq('organization_id', visitOrgId)
              : Promise.resolve({ data: null, error: null }),
          ])

          if (wfLookupErr) {
            console.error('[PostService:Workflow] lookup error visit=' + visit.id + ':', wfLookupErr.message)
          }

          // Resolver convId: depende de orgChannels (ya disponible)
          let clientConvId: string | null = null
          if (phoneSuffix) {
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

          if (postServiceWorkflows && postServiceWorkflows.length > 0) {
            for (const wf of postServiceWorkflows) {
              const wfTag = `[PostService:Workflow wf=${wf.id} name="${wf.name}" visit=${visit.id}]`
              if (wf.branch_id && wf.branch_id !== visit.branch_id) {
                console.log(`${wfTag} skip: branch_id mismatch (wf=${wf.branch_id} visit=${visit.branch_id})`)
                continue
              }

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
                  console.log(`${wfTag} skip_if_active: ya hay pending para este cliente`)
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
                    console.log(`${wfTag} skip_if_active: ya hay execution activa conv=${clientConvId}`)
                    continue
                  }
                }
              }

              const delayMinutes = (wf.trigger_config as { delay_minutes?: number } | null)?.delay_minutes ?? 10
              const scheduledFor = new Date()
              scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes)

              const [entryRes, edgesRes] = await Promise.all([
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

              if (entryRes.error) {
                console.error(`${wfTag} entry node lookup error:`, entryRes.error.message)
                continue
              }
              if (edgesRes.error) {
                console.error(`${wfTag} edges lookup error:`, edgesRes.error.message)
                continue
              }
              const entryNode = entryRes.data
              const edges = edgesRes.data
              if (!entryNode) {
                console.warn(`${wfTag} skip: workflow sin entry_point (marcá un nodo como is_entry_point=true)`)
                continue
              }
              if (!edges || edges.length === 0) {
                console.warn(`${wfTag} skip: workflow sin edges (grafo vacío — ¿se guardó correctamente?)`)
                continue
              }

              const firstEdge = edges.find((e: { source_node_id: string; target_node_id: string }) => e.source_node_id === entryNode.id)
              if (!firstEdge) {
                console.warn(`${wfTag} skip: entry_point ${entryNode.id} sin edge saliente`)
                continue
              }
              const { data: firstActionNode, error: firstActionErr } = await supabase
                .from('workflow_nodes')
                .select('id, node_type, config')
                .eq('id', firstEdge.target_node_id)
                .maybeSingle()

              if (firstActionErr) {
                console.error(`${wfTag} first action lookup error:`, firstActionErr.message)
                continue
              }
              if (!firstActionNode) {
                console.warn(`${wfTag} skip: primer nodo de acción no encontrado (target=${firstEdge.target_node_id})`)
                continue
              }

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
                if (!insertData.template_name) {
                  console.error(`${wfTag} skip: send_template sin template_name configurado`)
                  continue
                }
              } else if (firstActionNode.node_type === 'send_message') {
                insertData.content = actionConfig.text as string
                if (!insertData.content) {
                  console.error(`${wfTag} skip: send_message sin texto configurado`)
                  continue
                }
              } else {
                console.warn(`${wfTag} primer nodo de acción de tipo no soportado: ${firstActionNode.node_type}`)
                continue
              }

              const { error: schedErr } = await supabase
                .from('scheduled_messages')
                .insert(insertData)

              if (schedErr) {
                console.error(`${wfTag} insert scheduled_message error:`, schedErr.message)
              } else {
                console.log(`${wfTag} programado (phone=${client.phone}, delay=${delayMinutes}min, action=${firstActionNode.node_type})`)
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
      // NO re-throw: el servicio ya se completó, un fallo acá no debe romper
      // la finalización de la visita. Pero logueamos con detalle para que
      // cualquier error silencioso sea detectable en logs de Vercel.
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      console.error(`[PostService visit=${visit.id}] excepción inesperada:`, msg)
    }
  } else {
    console.log(`[PostService visit=${visit.id}] skip: visita sin client_id`)
  }

  // 8. Generar/actualizar salary_reports separados: servicio y producto
  const serviceCommissionAmount = commissionAmount - productCommissionAmount
  try {
    const tz = await getActiveTimezone()
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

    // Paralelizar los lookups de los dos reportes: son independientes entre sí.
    // Los UPDATE/INSERT posteriores se ejecutan en serie porque dependen de cada resultado.
    const [
      existingServiceReport,
      existingProductReport,
    ] = await Promise.all([
      serviceCommissionAmount > 0
        ? supabase
            .from('salary_reports')
            .select('id, amount')
            .eq('staff_id', visit.barber_id)
            .eq('branch_id', visit.branch_id)
            .eq('type', 'commission')
            .eq('report_date', todayStr)
            .eq('status', 'pending')
            .maybeSingle()
            .then(r => r.data)
        : Promise.resolve(null),
      productCommissionAmount > 0
        ? supabase
            .from('salary_reports')
            .select('id, amount')
            .eq('staff_id', visit.barber_id)
            .eq('branch_id', visit.branch_id)
            .eq('type', 'product_commission')
            .eq('report_date', todayStr)
            .eq('status', 'pending')
            .maybeSingle()
            .then(r => r.data)
        : Promise.resolve(null),
    ])

    // 8a. Reporte de comisión por servicio
    if (serviceCommissionAmount > 0) {
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
  revalidatePath('/dashboard/fila')
  revalidatePath('/dashboard/finanzas')
  revalidatePath('/dashboard/estadisticas')
  return {
    success: true as const,
    visitId: visit.id,
    breakAutoStarted,
    couponApplied: couponClientRewardId != null,
    couponDiscountAmount,
    couponWarning,
  }
}

export async function cancelQueueEntry(
  queueEntryId: string,
  options?: { allowInProgress?: boolean },
) {
  if (!isValidUUID(queueEntryId)) return { error: 'ID inválido' }
  const supabase = createAdminClient()

  // Obtener la entrada para validar la sucursal y decidir qué estados son cancelables.
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, is_break, break_request_id')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  const orgAccess = await validateBranchAccess(entry.branch_id)
  if (!orgAccess) return { error: 'No autorizado para esta sucursal' }

  // Override de admin (solo dashboard): permitir cancelar un corte YA iniciado
  // (in_progress). Se exige sesión de Supabase Auth — el panel del barbero usa cookie
  // PIN (barber_session) y NO tiene auth user, así que NUNCA puede forzar esto y
  // conserva la protección de abajo. El cobro de ese corte se pierde a propósito:
  // es una decisión explícita del admin, confirmada en la UI del dashboard.
  let adminCanCancelInProgress = false
  if (options?.allowInProgress) {
    try {
      const authClient = await createClient()
      const { data: { user } } = await authClient.auth.getUser()
      adminCanCancelInProgress = !!user
    } catch {
      adminCanCancelInProgress = false
    }
  }

  // Guard de estado: para CLIENTES sólo se cancela 'waiting'. Sin esto, un tap en
  // la X ("No se presentó") sobre un cliente que OTRO barbero ya pasó a in_progress
  // (carrera de UI por lag de realtime) pisaba ese in_progress y dejaba el corte
  // sin poder cobrarse. Para DESCANSOS sí permitimos cancelar también el que ya
  // arrancó (in_progress): no hay corte que cobrar y el descanso pudo crearse por
  // error o el barbero quiere volver antes (createBreakEntry lo arranca solo si el
  // barbero no tenía corte activo, así que la X tiene que poder cancelarlo). El
  // admin del dashboard también puede cancelar in_progress vía override explícito.
  const cancelableStatuses =
    entry.is_break || adminCanCancelInProgress ? ['waiting', 'in_progress'] : ['waiting']

  const { data: cancelledRows, error } = await supabase
    .from('queue_entries')
    .update({ status: 'cancelled' })
    .eq('id', queueEntryId)
    .in('status', cancelableStatuses)
    .select('id')

  if (error) {
    return { error: 'Error al cancelar' }
  }

  if (!cancelledRows || cancelledRows.length === 0) {
    // El entry ya no estaba en un estado cancelable (lo empezaron a atender,
    // se completó, o el descanso ya había terminado).
    return {
      error: entry.is_break
        ? 'El descanso ya finalizó'
        : 'El cliente ya está siendo atendido o fue completado',
    }
  }

  // Si el descanso provenía de una solicitud formal (break_request), cerrarla para
  // no dejarla huérfana en estado 'approved' — BreakRequestStatus no tiene 'cancelled'.
  if (entry.is_break && entry.break_request_id) {
    await supabase
      .from('break_requests')
      .update({ status: 'completed', actual_completed_at: new Date().toISOString() })
      .eq('id', entry.break_request_id)
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

  // Modelo pool (mig 134): dinámico entra con barber_id = NULL. Ver checkinClient.
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
  newBarberId: string | null,
  clientId: string
) {
  if (!isValidUUID(queueEntryId)) return { error: 'Datos inválidos' }
  // newBarberId null = volver al pool dinámico ("Menor espera"). El UPDATE de abajo
  // ya setea is_dynamic: !newBarberId. Sólo validamos el UUID si se eligió un barbero
  // específico (antes esta guarda rechazaba null y rompía el CTA "Menor espera").
  if (newBarberId !== null && !isValidUUID(newBarberId)) return { error: 'Datos inválidos' }
  // Prueba de posesión: el cliente debe conocer el client_id de SU entry. Es el
  // único ownership factible sin sesión de cliente en el kiosk compartido.
  // Sin esto, cualquier anónimo con un queueEntryId (visible vía RLS pública)
  // podía reasignar el barbero de OTRO cliente (IDOR — auditoría jun-2026).
  if (!isValidUUID(clientId)) return { error: 'Datos inválidos' }
  const supabase = createAdminClient()

  // Operación pública del kiosko: traer también client_id y status para ownership.
  const { data: entry } = await supabase
    .from('queue_entries')
    .select('branch_id, client_id, status')
    .eq('id', queueEntryId)
    .maybeSingle()

  if (!entry) return { error: 'Entrada no encontrada' }

  // Ownership: el client_id provisto debe coincidir con el dueño del entry.
  // Mensaje genérico para no filtrar si el entry existe o no.
  if (entry.client_id !== clientId) return { error: 'Entrada no encontrada' }

  // Sólo se puede reasignar mientras se espera (no en in_progress/completed).
  if (entry.status !== 'waiting') return { error: 'El cliente ya está siendo atendido' }

  // Rate-limit por IP+branch contra fuerza bruta del IDOR.
  const { RateLimits } = await import('@/lib/rate-limit')
  const gate = await RateLimits.kioskReassign(entry.branch_id)
  if (!gate.allowed) {
    return { error: 'Demasiados cambios en poco tiempo. Esperá un momento.' }
  }

  // Verificar que la sucursal esté activa (validación mínima para operaciones públicas)
  const { data: branchCheck } = await supabase
    .from('branches')
    .select('id')
    .eq('id', entry.branch_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!branchCheck) return { error: 'Sucursal no encontrada o inactiva' }

  // Verificar que el nuevo barbero pertenece a la misma sucursal.
  // Si newBarberId es null (pool dinámico / "Menor espera") se omite el chequeo.
  if (newBarberId) {
    const { data: barberCheck } = await supabase
      .from('staff')
      .select('id')
      .eq('id', newBarberId)
      .eq('branch_id', entry.branch_id)
      .eq('is_active', true)
      .maybeSingle()

    if (!barberCheck) return { error: 'Barbero no disponible en esta sucursal' }
  }

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

  // Verificar que todas las entradas pertenecen al scope del usuario (org + sucursal permitida)
  const { getScopedBranchIds } = await import('./branch-access')
  const scopedBranchIds = await getScopedBranchIds()
  const foreignEntry = allEntries.find(e => !scopedBranchIds.includes(e.branch_id))
  if (foreignEntry) return { error: 'Acceso denegado: entradas fuera de tu alcance' }

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

export async function createBreakEntry(branchId: string, barberId: string, _breakConfigName: string) {
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
