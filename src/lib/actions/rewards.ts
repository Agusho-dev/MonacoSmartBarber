'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateBranchAccess } from './org'
import { getBarberSession } from './auth'
import { isValidUUID } from '@/lib/validation'
import {
  deliveryErrorMessage,
  isReferralQr,
  parseReferralQr,
  referralErrorMessage,
  weekdayPhrase,
  type CheckoutCouponInfo,
  type CheckoutReferralInfo,
  type RewardKind,
} from '@/lib/loyalty-checkout'

export async function updateRewardConfig(
  branchId: string,
  config: {
    points_per_visit: number
    redemption_threshold: number
    reward_description: string
    is_active: boolean
  }
) {
  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado' }

  // Admin client + validateBranchAccess (arriba): la RLS de rewards_config es owner/admin
  // vía la tabla `staff` y bloqueaba a admins cross-branch / owners de organization_members
  // (bug expense_tickets, 16/jul/2026). El scope de org lo da el branch_id ya validado.
  const supabase = createAdminClient()

  // Check if config exists
  const { data: existing } = await supabase
    .from('rewards_config')
    .select('id')
    .eq('branch_id', branchId)
    .single()

  let error
  if (existing) {
    const { error: updateError } = await supabase
      .from('rewards_config')
      .update(config)
      .eq('id', existing.id)
    error = updateError
  } else {
    const { error: insertError } = await supabase
      .from('rewards_config')
      .insert({
        branch_id: branchId,
        ...config,
      })
    error = insertError
  }

  if (error) {
    return { error: 'Error al actualizar la configuración' }
  }

  revalidatePath('/dashboard/fidelizacion')
  revalidatePath('/dashboard/app-movil')
  return { success: true }
}

/**
 * ¿Dos client_id son la MISMA persona? (misma org + mismos últimos 10 dígitos de
 * teléfono). Cubre el duplicado por normalización de teléfono inconsistente entre
 * Prode (guarda dígitos crudos) y el check-in del kiosko (formato libre), que deja
 * el cupón en una fila de clients y la visita en otra → sin esto, el canje del
 * cupón de bienvenida fallaba con "pertenece a otro cliente". Ver mig 149.
 */
async function sameClientPerson(
  supabase: ReturnType<typeof createAdminClient>,
  idA: string,
  idB: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, phone, organization_id')
    .in('id', [idA, idB])
  if (error) {
    console.error('[sameClientPerson]', error.message)
    return false
  }
  if (!data || data.length < 2) return false
  const [a, b] = data
  if (a.organization_id !== b.organization_id) return false
  const norm = (p: string | null) => (p ?? '').replace(/\D/g, '').slice(-10)
  const ka = norm(a.phone)
  // Misma persona sólo si la clave (últimos 10 díg.) coincide, tiene >= 8 dígitos y NO
  // es degenerada (un dígito repetido, ej '0000000000' = placeholder, no identifica).
  return ka.length >= 8 && ka === norm(b.phone) && !/^(.)\1*$/.test(ka)
}

/** Timezone de la sucursal (fallback Argentina) — para evaluar el día de canje. */
async function getBranchTimezone(
  supabase: ReturnType<typeof createAdminClient>,
  branchId: string,
): Promise<string> {
  const { data } = await supabase.from('branches').select('timezone').eq('id', branchId).maybeSingle()
  return data?.timezone || 'America/Argentina/Buenos_Aires'
}

/** Día de la semana ISO (1=lunes .. 7=domingo) en una timezone dada. */
function isoWeekdayInTz(tz: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date())
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[short] ?? 0
}

/**
 * Valida (SIN consumir) un cupón de descuento (client_rewards) para aplicarlo en
 * el cobro del panel de barberos. Se usa al escanear el QR: confirma que existe,
 * está disponible, no venció, pertenece a la org de la sucursal y —si se pasa el
 * cliente atendido— que el cupón es de ese cliente. El consumo real (atómico) lo
 * hace `redeem_coupon_for_visit` dentro de `completeService` al confirmar la venta,
 * para no "quemar" el cupón si la venta se cancela.
 *
 * Usa createAdminClient() porque el panel de barberos no tiene sesión de Supabase
 * Auth (PIN→cookie). La autorización se valida con validateBranchAccess (resuelve
 * la org desde la cookie barber_session).
 */
export async function validateCouponForCheckout(
  qrCode: string,
  branchId: string,
  clientId: string | null,
): Promise<{ success: true; coupon: CheckoutCouponInfo } | { error: string }> {
  const clean = (qrCode ?? '').trim().toLowerCase()
  if (!clean) return { error: 'Ingresá un código' }
  if (!/^[0-9a-f-]{8,64}$/.test(clean)) return { error: 'El código del cupón no es válido' }
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado para esta sucursal' }

  const supabase = createAdminClient()
  const { data: reward, error } = await supabase
    .from('client_rewards')
    // `service:service_id(...)`: embed POR COLUMNA (Known Risk #17). Trae nombre y precio
    // vigente del servicio acotado, que desde la mig 203 es la base del descuento.
    .select('id, status, expires_at, client_id, organization_id, created_at, reward:reward_catalog(name, discount_pct, is_free_service, activation_delay_minutes, redeemable_weekdays, kind, service_id, allow_stacking, service:service_id(name, price))')
    .eq('qr_code', clean)
    .maybeSingle()

  if (error) return { error: 'Error al validar el beneficio' }
  if (!reward) return { error: 'Beneficio no encontrado' }
  if (reward.organization_id !== orgId) return { error: 'Este cupón es de otra organización' }
  if (clientId && reward.client_id !== clientId) {
    // No es necesariamente ajeno: la misma persona puede tener 2 filas en clients por
    // teléfono normalizado distinto (Prode vs check-in) → cupón en una, visita en otra.
    // Si son la misma persona (misma org + últimos 10 dígitos), el cupón es válido.
    const same = await sameClientPerson(supabase, reward.client_id, clientId)
    if (!same) return { error: 'Este cupón pertenece a otro cliente' }
  }
  if (reward.status === 'redeemed') return { error: 'Este beneficio ya fue usado' }
  if (reward.status === 'expired') return { error: 'El beneficio está vencido' }
  // Estado nuevo de la mig 196: cancelado desde el dashboard (con o sin devolución de puntos).
  if (reward.status === 'cancelled') return { error: 'Este beneficio fue cancelado' }
  if (reward.status !== 'available') return { error: 'El beneficio no está disponible' }
  if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
    return { error: 'El beneficio está vencido' }
  }

  const cat = Array.isArray(reward.reward) ? reward.reward[0] : reward.reward
  if (!cat) return { error: 'Beneficio inválido' }
  // `kind` (mig 196): merch/especial son una ENTREGA, no un descuento — no tienen %
  // y la RPC de canje los marca usados sin tocar el importe. Sólo `descuento` exige %.
  const kind: RewardKind = cat.kind === 'merch' || cat.kind === 'especial' ? cat.kind : 'descuento'
  if (kind === 'descuento' && !cat.is_free_service && (cat.discount_pct ?? 0) <= 0) {
    return { error: 'Este beneficio no tiene descuento aplicable' }
  }

  // Reglas de tiempo (mismas que la RPC redeem_coupon_for_visit, mig 151): activación
  // diferida y días permitidos. Es un pre-check al escanear para mostrar el motivo;
  // la autoridad sigue siendo la RPC al confirmar el cobro.
  const delayMin = cat.activation_delay_minutes ?? 0
  // null = sin restricción de día; un array (aunque vacío) = restricción activa, para
  // espejar EXACTO la semántica `redeemable_weekdays IS NOT NULL` de la RPC de canje
  // (si no, un futuro `{}` "escanearía OK pero la RPC lo bloquearía" al cobrar).
  const weekdays = (cat.redeemable_weekdays as number[] | null) ?? null
  if (delayMin > 0 || weekdays !== null) {
    const tz = await getBranchTimezone(supabase, branchId)
    if (delayMin > 0 && reward.created_at) {
      const activatesAt = new Date(reward.created_at).getTime() + delayMin * 60_000
      if (Date.now() < activatesAt) {
        const cuando = new Date(activatesAt).toLocaleString('es-AR', {
          timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit',
        })
        return { error: `El cupón todavía no está activo. Se activa ${cuando} (un rato después de crear la cuenta).` }
      }
    }
    if (weekdays !== null && !weekdays.includes(isoWeekdayInTz(tz))) {
      return { error: `Este cupón solo se puede canjear ${weekdayPhrase(weekdays)}.` }
    }
  }

  const scopedService = Array.isArray(cat.service) ? cat.service[0] : cat.service
  const servicePriceRaw = scopedService?.price
  const servicePrice = servicePriceRaw != null && Number.isFinite(Number(servicePriceRaw)) ? Number(servicePriceRaw) : null

  return {
    success: true,
    coupon: {
      clientRewardId: reward.id,
      rewardName: cat.name ?? null,
      discountPct: cat.discount_pct ?? null,
      isFreeService: !!cat.is_free_service,
      kind,
      serviceId: (cat.service_id as string | null) ?? null,
      serviceName: scopedService?.name ?? null,
      servicePrice,
      allowStacking: !!cat.allow_stacking,
    },
  }
}

/**
 * Entrega de un premio merch/especial SIN cobro (el cliente pasa a retirar la gorra).
 * Llama a `deliver_reward_by_qr`, que marca el beneficio como usado y registra
 * quién lo entregó. Un premio de descuento NO se entrega por acá: se aplica en el
 * cobro (`needs_checkout`), igual que una invitación de un amigo.
 *
 * Mismo contexto de auth que el resto del archivo: panel PIN → admin client +
 * validateBranchAccess (resuelve la org desde la cookie barber_session) y
 * getBarberSession para el staff que entrega.
 */
export async function deliverRewardByQr(
  qrCode: string,
  branchId: string,
): Promise<{ success: true; rewardName: string; kind: RewardKind } | { error: string }> {
  const raw = (qrCode ?? '').trim()
  if (!raw) return { error: 'Ingresá un código' }
  if (isReferralQr(raw)) return { error: 'Una invitación se aplica al cobrar un servicio' }
  const clean = raw.toLowerCase()
  if (!/^[0-9a-f-]{8,64}$/.test(clean)) return { error: 'El código del beneficio no es válido' }
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado para esta sucursal' }

  // Quién entrega (auditoría en client_rewards.delivered_by). Sin sesión de barbero
  // (p. ej. cobro desde el dashboard) va null: la RPC lo admite.
  const session = await getBarberSession()

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('deliver_reward_by_qr', {
    p_qr_code: clean,
    p_staff_id: session?.staff_id ?? null,
    p_branch_id: branchId,
  })
  if (error) {
    console.error('[deliverRewardByQr] deliver_reward_by_qr:', error.message)
    return { error: 'No se pudo registrar la entrega' }
  }
  // La RPC contesta HTTP 200 con {success:false, error} cuando rechaza: hay que mirarlo.
  const row = (data ?? {}) as { success?: boolean; error?: string; reward_name?: string | null; kind?: string | null }
  if (!row.success) return { error: deliveryErrorMessage(row.error) }

  const kind: RewardKind = row.kind === 'merch' || row.kind === 'especial' ? row.kind : 'descuento'
  return { success: true, rewardName: row.reward_name ?? 'Beneficio', kind }
}

export type BenefitQrValidation =
  | { success: true; kind: 'coupon'; coupon: CheckoutCouponInfo }
  | { success: true; kind: 'referral'; referral: CheckoutReferralInfo }
  | { error: string }

/**
 * UN SOLO escáner para el cobro: recibe lo que leyó la cámara (o tipeó el
 * barbero) y decide qué es.
 *  - "MNC-REF:<código>" → invitación de un amigo (referidos, mig 196/197): valida
 *    SIN consumir vía `validate_referral_for_checkout`. La aplicación real la hace
 *    `apply_referral_for_visit` dentro de `completeService`, cuando ya existe la
 *    visita, igual que el cupón.
 *  - cualquier otra cosa → QR de beneficio (`client_rewards.qr_code`, 32 hex):
 *    delega en `validateCouponForCheckout`.
 *
 * Mismo contexto de auth que el cupón: panel PIN → admin client + validateBranchAccess.
 */
export async function validateBenefitQrForCheckout(
  raw: string,
  branchId: string,
  clientId: string | null,
): Promise<BenefitQrValidation> {
  const clean = (raw ?? '').trim()
  if (!clean) return { error: 'Ingresá un código' }

  if (!isReferralQr(clean)) {
    const r = await validateCouponForCheckout(clean, branchId, clientId)
    if ('error' in r) return r
    return { success: true, kind: 'coupon', coupon: r.coupon }
  }

  // ── Invitación de un amigo ──
  const code = parseReferralQr(clean)
  if (!code) return { error: referralErrorMessage('code_not_found') }
  if (!isValidUUID(branchId)) return { error: 'Sucursal inválida' }
  if (clientId && !isValidUUID(clientId)) return { error: 'Cliente inválido' }

  const orgId = await validateBranchAccess(branchId)
  if (!orgId) return { error: 'No autorizado para esta sucursal' }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('validate_referral_for_checkout', {
    p_org: orgId,
    p_code: code,
    p_client_id: clientId,
    p_branch_id: branchId,
    p_exclude_visit_id: null,
  })
  if (error) {
    console.error('[validateBenefitQrForCheckout] validate_referral_for_checkout:', error.message)
    return { error: 'No se pudo validar la invitación' }
  }
  const row = (data ?? {}) as {
    ok?: boolean
    error?: string
    referrer_first_name?: string | null
    discount_pct?: number | null
    referred_points?: number | null
    referrer_points?: number | null
  }
  if (!row.ok) return { error: referralErrorMessage(row.error) }

  return {
    success: true,
    kind: 'referral',
    referral: {
      code,
      referrerFirstName: row.referrer_first_name ?? null,
      discountPct: Number(row.discount_pct ?? 0),
      referredPoints: Number(row.referred_points ?? 0),
      referrerPoints: Number(row.referrer_points ?? 0),
    },
  }
}
