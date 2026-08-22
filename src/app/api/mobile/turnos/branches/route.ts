/**
 * GET /api/mobile/turnos/branches
 *
 * Sucursales activas de la organización del cliente autenticado, con el estado
 * de apertura (`estadoHorario`, el mismo de la landing pública) y si se puede
 * reservar (`bookable`). Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RateLimits } from '@/lib/rate-limit'
import { getLocalDateStr } from '@/lib/time-utils'
import { estadoHorario } from '@/app/turnos/[slug]/horarios'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import { DEFAULT_TZ, isBookable, type OperationMode } from '@/lib/mobile/branches'
import { jsonOk, jsonError, rateLimited, withMobileHandler } from '@/lib/mobile/http'
import type { AppointmentSettings } from '@/lib/types/database'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface BranchRow {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
  operation_mode: OperationMode
  business_hours_open: string | null
  business_hours_close: string | null
  business_days: number[] | null
}

export const GET = withMobileHandler('turnos/branches', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const gate = await RateLimits.mobileBootstrap(auth.userId)
  if (!gate.allowed) return rateLimited()

  const supabase = createAdminClient()
  const orgId = auth.client.organizationId

  // Settings efectivos por sucursal: un solo query para toda la org en vez de
  // N llamadas a getAppointmentSettings (mismo patrón que la landing pública).
  const [branchesRes, settingsRes] = await Promise.all([
    supabase
      .from('branches')
      .select(
        'id, name, slug, address, phone, timezone, latitude, longitude, operation_mode, business_hours_open, business_hours_close, business_days'
      )
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('name'),
    supabase.from('appointment_settings').select('*').eq('organization_id', orgId),
  ])

  if (branchesRes.error || settingsRes.error) {
    console.error(
      '[api/mobile] turnos/branches:',
      branchesRes.error?.message ?? settingsRes.error?.message
    )
    return jsonError(500, 'INTERNAL', 'No pudimos leer las sucursales. Probá de nuevo.')
  }

  const list = (branchesRes.data ?? []) as BranchRow[]
  const settingsRows = (settingsRes.data ?? []) as AppointmentSettings[]
  const orgDefaults = settingsRows.find(s => !s.branch_id) ?? null
  const settingsFor = (branchId: string): AppointmentSettings | null =>
    settingsRows.find(s => s.branch_id === branchId) ?? orgDefaults

  const branches = list.map(b => {
    const estado = estadoHorario(
      b.business_hours_open,
      b.business_hours_close,
      b.business_days,
      b.timezone
    )
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      address: b.address,
      phone: b.phone,
      timezone: b.timezone || DEFAULT_TZ,
      latitude: b.latitude,
      longitude: b.longitude,
      operation_mode: b.operation_mode,
      bookable: isBookable(b, settingsFor(b.id)),
      open_now: estado.openNow,
      hours_label: estado.label,
      is_test: b.slug === 'test',
    }
  })

  // Todas las sucursales de una org comparten TZ hoy; si algún día difieren,
  // `server_today` de cada wizard sale del bootstrap de SU sucursal.
  const tz = list[0]?.timezone || DEFAULT_TZ

  return jsonOk({ server_today: getLocalDateStr(tz), branches })
})
