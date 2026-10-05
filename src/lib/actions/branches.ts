'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import {
  requireLimit,
  translateSupabaseErrorToEntitlement,
} from '@/lib/actions/entitlements'
import { EntitlementError } from '@/lib/billing/types'
import type { EntitlementErrorResponse } from '@/lib/billing/types'

type BranchInput = {
  name: string
  address?: string | null
  phone?: string | null
  latitude?: number | null
  longitude?: number | null
  business_hours_open?: string
  business_hours_close?: string
  business_days?: number[]
}

export type CreateBranchResult =
  | { ok: true; branchId: string }
  | EntitlementErrorResponse
  | { error: string; message: string }

type ResultadoSimple = { ok: true } | { error: string; message: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/**
 * Normaliza y valida lo que llega del formulario. Un export de 'use server' es
 * un endpoint público: no se confía en la forma del objeto, sólo se copian los
 * campos conocidos (antes `updateBranch` hacía `...input` y cualquier clave del
 * body —organization_id incluido— llegaba al UPDATE).
 */
function normalizarSucursal(
  input: Partial<BranchInput>,
  { exigirNombre }: { exigirNombre: boolean },
): { ok: true; datos: Record<string, unknown> } | { ok: false; message: string } {
  const datos: Record<string, unknown> = {}

  if (input.name !== undefined || exigirNombre) {
    const nombre = typeof input.name === 'string' ? input.name.trim() : ''
    if (!nombre) return { ok: false, message: 'Poné un nombre para la sucursal.' }
    if (nombre.length > 80) return { ok: false, message: 'El nombre es demasiado largo (máximo 80 caracteres).' }
    datos.name = nombre
  }
  if (input.address !== undefined) {
    datos.address = typeof input.address === 'string' && input.address.trim() ? input.address.trim() : null
  }
  if (input.phone !== undefined) {
    datos.phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone.trim() : null
  }
  for (const campo of ['latitude', 'longitude'] as const) {
    if (input[campo] === undefined) continue
    const v = input[campo]
    if (v === null) {
      datos[campo] = null
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, message: 'La ubicación no es válida. Volvé a tocar «Ubicar».' }
    }
    if ((campo === 'latitude' && Math.abs(v) > 90) || (campo === 'longitude' && Math.abs(v) > 180)) {
      return { ok: false, message: 'La ubicación no es válida. Volvé a tocar «Ubicar».' }
    }
    datos[campo] = v
  }
  for (const campo of ['business_hours_open', 'business_hours_close'] as const) {
    if (input[campo] === undefined) continue
    const v = input[campo]
    if (typeof v !== 'string' || !HORA_RE.test(v)) {
      return { ok: false, message: 'Revisá el horario de apertura y de cierre.' }
    }
    datos[campo] = v
  }
  if (
    typeof datos.business_hours_open === 'string' &&
    typeof datos.business_hours_close === 'string' &&
    datos.business_hours_open.slice(0, 5) >= datos.business_hours_close.slice(0, 5)
  ) {
    return { ok: false, message: 'El cierre tiene que ser después de la apertura.' }
  }
  if (input.business_days !== undefined) {
    const dias = input.business_days
    if (
      !Array.isArray(dias) ||
      dias.length === 0 ||
      dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    ) {
      return { ok: false, message: 'Elegí al menos un día de atención.' }
    }
    datos.business_days = [...new Set(dias)].sort((a, b) => a - b)
  }

  return { ok: true, datos }
}

async function puedeGestionarSucursales(): Promise<boolean> {
  return currentUserCan('branches.manage')
}

/**
 * Crea una sucursal respetando el límite del plan. Devuelve errores estructurados
 * para que el cliente muestre el UpgradePrompt sin tener que re-lanzar.
 */
export async function createBranch(input: BranchInput): Promise<CreateBranchResult> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tu sesión venció. Volvé a entrar.' }
  if (!(await puedeGestionarSucursales())) {
    return { error: 'forbidden', message: 'No tenés permiso para crear sucursales.' }
  }

  const norm = normalizarSucursal(input ?? ({} as BranchInput), { exigirNombre: true })
  if (!norm.ok) return { error: 'invalid', message: norm.message }

  try {
    // Gate app-side: da UX inmediata + mensaje claro con el límite del plan.
    await requireLimit('branches', 1)
  } catch (e) {
    if (e instanceof EntitlementError) return e.toResponse()
    throw e
  }

  const supabase = createAdminClient()
  // Heredar timezone desde organizations para consistencia con onboarding.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', orgId)
    .maybeSingle()
  const tz = orgRow?.timezone ?? 'America/Argentina/Buenos_Aires'

  const payload = {
    business_hours_open: '09:00',
    business_hours_close: '21:00',
    business_days: [1, 2, 3, 4, 5, 6],
    address: null,
    phone: null,
    latitude: null,
    longitude: null,
    ...norm.datos,
    organization_id: orgId,
    is_active: true,
    timezone: tz,
  }

  const { data, error } = await supabase
    .from('branches')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    // El trigger SQL enforce_branch_limit lanza branch_limit_exceeded si
    // alguien bypasa el gate de app. Lo traducimos a EntitlementErrorResponse.
    const translated = await translateSupabaseErrorToEntitlement(error)
    if (translated) return translated
    console.error('[createBranch]', { orgId, code: error.code, message: error.message })
    if (error.message?.includes('max_branches_exceeded')) {
      return { error: 'limit_exceeded', message: 'Llegaste al máximo de sucursales activas de tu cuenta. Escribinos para ampliarlo.' }
    }
    return { error: 'db_error', message: 'No pudimos crear la sucursal. Probá de nuevo en un momento.' }
  }

  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard', 'layout')
  return { ok: true, branchId: data.id }
}

export async function updateBranch(
  branchId: string,
  input: Partial<BranchInput> & { is_active?: boolean },
): Promise<ResultadoSimple> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tu sesión venció. Volvé a entrar.' }
  if (!UUID_RE.test(String(branchId ?? ''))) return { error: 'invalid', message: 'Sucursal inválida.' }
  if (!(await puedeGestionarSucursales())) {
    return { error: 'forbidden', message: 'No tenés permiso para modificar sucursales.' }
  }

  const norm = normalizarSucursal(input ?? {}, { exigirNombre: false })
  if (!norm.ok) return { error: 'invalid', message: norm.message }
  const cambios: Record<string, unknown> = { ...norm.datos }
  if (input && typeof input.is_active === 'boolean') cambios.is_active = input.is_active
  if (Object.keys(cambios).length === 0) return { ok: true }

  const supabase = createAdminClient()

  // Reactivar cuenta como alta para el límite del plan.
  if (cambios.is_active === true) {
    const { data: actual } = await supabase
      .from('branches')
      .select('is_active')
      .eq('id', branchId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (actual && actual.is_active === false) {
      try {
        await requireLimit('branches', 1)
      } catch (e) {
        if (e instanceof EntitlementError) return { error: e.kind, message: e.message }
        throw e
      }
    }
  }

  const { data, error } = await supabase
    .from('branches')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .select('id')

  if (error) {
    console.error('[updateBranch]', { orgId, branchId, code: error.code, message: error.message })
    if (error.message?.includes('max_branches_exceeded')) {
      return { error: 'limit_exceeded', message: 'Llegaste al máximo de sucursales activas de tu cuenta.' }
    }
    return { error: 'db_error', message: 'No pudimos guardar los cambios. Probá de nuevo.' }
  }
  if (!data || data.length === 0) {
    return { error: 'not_found', message: 'No encontramos esa sucursal en tu organización.' }
  }

  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}

/**
 * Borra una sucursal SÓLO si no tiene historial. Borrar una sucursal arrastra
 * en cascada sus visitas, la fila, los turnos, las cuentas de cobro y los
 * reportes de sueldo (FK ON DELETE CASCADE): una sucursal con uso nunca se
 * borra, se desactiva. Antes lo hacía el browser directo contra la tabla.
 */
export async function deleteBranch(
  branchId: string,
): Promise<ResultadoSimple | { error: 'con_historial'; message: string }> {
  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'unauthorized', message: 'Tu sesión venció. Volvé a entrar.' }
  if (!UUID_RE.test(String(branchId ?? ''))) return { error: 'invalid', message: 'Sucursal inválida.' }
  if (!(await puedeGestionarSucursales())) {
    return { error: 'forbidden', message: 'No tenés permiso para eliminar sucursales.' }
  }

  const supabase = createAdminClient()
  const { data: sucursal } = await supabase
    .from('branches')
    .select('id, name')
    .eq('id', branchId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!sucursal) return { error: 'not_found', message: 'No encontramos esa sucursal en tu organización.' }

  // Cualquier rastro de uso la vuelve indeleble. Se mira cada tabla con un
  // HEAD + count (sin traer filas).
  const tablasConHistorial = [
    'visits',
    'queue_entries',
    'appointments',
    'transfer_logs',
    'product_sales',
    'expense_tickets',
    'attendance_logs',
    'salary_reports',
    'staff',
    'payment_receipts',
    'shift_closes',
  ] as const
  const conteos = await Promise.all(
    tablasConHistorial.map((tabla) =>
      supabase.from(tabla).select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
    ),
  )
  const fallo = conteos.find((r) => r.error)
  if (fallo?.error) {
    console.error('[deleteBranch] conteo', { branchId, message: fallo.error.message })
    return { error: 'db_error', message: 'No pudimos verificar el historial de la sucursal. Probá de nuevo.' }
  }
  if (conteos.some((r) => (r.count ?? 0) > 0)) {
    return {
      error: 'con_historial',
      message: `${sucursal.name} ya tiene movimientos o equipo asignado: no se puede borrar sin perder historial. Desactivala para que deje de aparecer.`,
    }
  }

  const { error } = await supabase.from('branches').delete().eq('id', branchId).eq('organization_id', orgId)
  if (error) {
    console.error('[deleteBranch]', { branchId, code: error.code, message: error.message })
    return {
      error: error.code === '23503' ? 'con_historial' : 'db_error',
      message:
        error.code === '23503'
          ? `${sucursal.name} tiene datos asociados y no se puede borrar. Desactivala.`
          : 'No pudimos eliminar la sucursal. Probá de nuevo.',
    }
  }

  revalidatePath('/dashboard/sucursales')
  revalidatePath('/dashboard', 'layout')
  return { ok: true }
}
