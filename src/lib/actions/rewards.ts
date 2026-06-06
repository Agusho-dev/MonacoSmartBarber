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
    .select('id, status, expires_at, client_id, organization_id, reward:reward_catalog(name, discount_pct, is_free_service)')
    .eq('qr_code', clean)
    .maybeSingle()

  if (error) return { error: 'Error al validar el cupón' }
  if (!reward) return { error: 'Cupón no encontrado' }
  if (reward.organization_id !== orgId) return { error: 'Este cupón es de otra organización' }
  if (clientId && reward.client_id !== clientId) {
    return { error: 'Este cupón pertenece a otro cliente' }
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
