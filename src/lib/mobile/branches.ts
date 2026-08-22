/**
 * Resolución de sucursal para la API mobile.
 *
 * La app es mono-org: el slug se resuelve SIEMPRE acotado a la organización del
 * cliente autenticado. Sin ese corte, un slug de otra org llevaría a
 * `createAppointment` a dar de alta al cliente —por teléfono— en la org ajena.
 */
import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { AppointmentSettings } from '@/lib/types/database'

export const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

export type OperationMode = 'walk_in' | 'appointments' | 'hybrid'

export interface MobileBranchRow {
  id: string
  name: string
  slug: string
  organization_id: string
  operation_mode: OperationMode
  address: string | null
  phone: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
}

/**
 * Sucursal activa por slug dentro de la org. `null` = no existe, está inactiva
 * o es de otra organización (para el cliente es lo mismo: 404). Un error de
 * lectura se propaga (el wrapper responde 500): devolver `null` ahí le diría
 * al cliente "no existe" por un glitch de red.
 */
export async function findMobileBranch(
  slug: string,
  organizationId: string
): Promise<MobileBranchRow | null> {
  const clean = slug.trim().toLowerCase()
  if (!clean || clean.length > 100) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, slug, organization_id, operation_mode, address, phone, timezone, latitude, longitude')
    .eq('slug', clean)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(`findMobileBranch: ${error.message}`)
  if (!data || data.organization_id !== organizationId) return null

  return data as MobileBranchRow
}

/**
 * Activar turnos son DOS cosas (CLAUDE.md, "Activar turnos son TRES cosas"):
 * `operation_mode != walk_in` Y `appointment_settings.is_enabled`. Mirar sólo
 * una hacía que el dueño leyera "Activo" mientras el cliente veía "sin turno".
 */
export function isBookable(
  branch: { operation_mode: string | null },
  settings: Pick<AppointmentSettings, 'is_enabled'> | null
): boolean {
  return branch.operation_mode !== 'walk_in' && !!settings?.is_enabled
}

/** Forma pública de la sucursal que viaja a la app. */
export function publicBranchShape(branch: MobileBranchRow) {
  return {
    id: branch.id,
    name: branch.name,
    slug: branch.slug,
    address: branch.address,
    phone: branch.phone,
    timezone: branch.timezone || DEFAULT_TZ,
    latitude: branch.latitude,
    longitude: branch.longitude,
    operation_mode: branch.operation_mode,
  }
}
