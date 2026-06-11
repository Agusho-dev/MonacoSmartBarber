'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateBranchAccess } from './org'
import { isValidUUID } from '@/lib/validation'

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

  const supabase = await createClient()

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

interface CheckoutCouponInfo {
  clientRewardId: string
  rewardName: string | null
  discountPct: number | null
  isFreeService: boolean
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

const DIAS_ES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
/** Frase legible de los días permitidos: [1,2,3] → "de lunes a miércoles". */
function weekdayPhrase(days: number[]): string {
  const s = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (s.length === 0) return 'ningún día'
  if (s.length === 1) return `los ${DIAS_ES[s[0]]}`
  const contiguo = s.every((d, i) => i === 0 || d === s[i - 1] + 1)
  if (contiguo) return `de ${DIAS_ES[s[0]]} a ${DIAS_ES[s[s.length - 1]]}`
  return s.slice(0, -1).map((d) => DIAS_ES[d]).join(', ') + ' y ' + DIAS_ES[s[s.length - 1]]
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
    .select('id, status, expires_at, client_id, organization_id, created_at, reward:reward_catalog(name, discount_pct, is_free_service, activation_delay_minutes, redeemable_weekdays)')
    .eq('qr_code', clean)
    .maybeSingle()

  if (error) return { error: 'Error al validar el cupón' }
  if (!reward) return { error: 'Cupón no encontrado' }
  if (reward.organization_id !== orgId) return { error: 'Este cupón es de otra organización' }
  if (clientId && reward.client_id !== clientId) {
    // No es necesariamente ajeno: la misma persona puede tener 2 filas en clients por
    // teléfono normalizado distinto (Prode vs check-in) → cupón en una, visita en otra.
    // Si son la misma persona (misma org + últimos 10 dígitos), el cupón es válido.
    const same = await sameClientPerson(supabase, reward.client_id, clientId)
    if (!same) return { error: 'Este cupón pertenece a otro cliente' }
  }
  if (reward.status === 'redeemed') return { error: 'Este cupón ya fue canjeado' }
  if (reward.status === 'expired') return { error: 'El cupón está vencido' }
  if (reward.status !== 'available') return { error: 'El cupón no está disponible' }
  if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
    return { error: 'El cupón está vencido' }
  }

  const cat = Array.isArray(reward.reward) ? reward.reward[0] : reward.reward
  if (!cat) return { error: 'Cupón inválido' }
  if (!cat.is_free_service && (cat.discount_pct ?? 0) <= 0) {
    return { error: 'Este cupón no tiene descuento aplicable' }
  }

  // Reglas de tiempo (mismas que la RPC redeem_coupon_for_visit, mig 151): activación
  // diferida y días permitidos. Es un pre-check al escanear para mostrar el motivo;
  // la autoridad sigue siendo la RPC al confirmar el cobro.
  const delayMin = cat.activation_delay_minutes ?? 0
  const weekdays = (cat.redeemable_weekdays as number[] | null) ?? null
  if (delayMin > 0 || (weekdays && weekdays.length)) {
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
    if (weekdays && weekdays.length && !weekdays.includes(isoWeekdayInTz(tz))) {
      return { error: `Este cupón solo se puede canjear ${weekdayPhrase(weekdays)}.` }
    }
  }

  return {
    success: true,
    coupon: {
      clientRewardId: reward.id,
      rewardName: cat.name ?? null,
      discountPct: cat.discount_pct ?? null,
      isFreeService: !!cat.is_free_service,
    },
  }
}
