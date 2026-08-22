/**
 * GET /api/mobile/turnos/[slug]/slots?date=YYYY-MM-DD&service_ids=a,b&staff_id=<uuid opcional>
 *
 * Mapeo 1:1 de `getAvailableSlots` (el ÚNICO motor de disponibilidad). Si el
 * motor devuelve `error`, se responde 200 con `error` string: la app tiene que
 * distinguir "no pudimos leer" de "lleno" — colapsar a `[]` es un "Lleno"
 * falso o, peor, un doble booking. Ver CONTRACTS.md §1.2 y principio 3.
 */
import type { NextRequest } from 'next/server'
import { RateLimits } from '@/lib/rate-limit'
import { getLocalDateStr } from '@/lib/time-utils'
import { isValidUUID } from '@/lib/validation'
import { getAvailableSlots, getAppointmentSettings } from '@/lib/actions/appointments'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import { DEFAULT_TZ, findMobileBranch, isBookable } from '@/lib/mobile/branches'
import {
  badRequest,
  isValidDateStr,
  jsonOk,
  jsonError,
  rateLimited,
  withMobileHandler,
} from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withMobileHandler(
  'turnos/[slug]/slots',
  async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const auth = await requireMobileClient(req)
    if (isMobileAuthError(auth)) return auth

    const params = req.nextUrl.searchParams
    const date = (params.get('date') ?? '').trim()
    const serviceIds = (params.get('service_ids') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const staffIdRaw = (params.get('staff_id') ?? '').trim()

    if (!isValidDateStr(date)) return badRequest('La fecha tiene que ser YYYY-MM-DD.')
    if (!serviceIds.length || serviceIds.some(id => !isValidUUID(id))) {
      return badRequest('service_ids tiene que ser una lista de UUIDs separados por coma.')
    }
    if (staffIdRaw && !isValidUUID(staffIdRaw)) return badRequest('staff_id inválido.')

    const gate = await RateLimits.mobileSlots(auth.userId)
    if (!gate.allowed) return rateLimited()

    const { slug } = await ctx.params
    const branch = await findMobileBranch(slug, auth.client.organizationId)
    if (!branch) return jsonError(404, 'BRANCH_NOT_FOUND', 'No encontramos esa sucursal.')

    // El motor mira `is_enabled` pero no `operation_mode`: una sucursal walk_in
    // con settings org-wide prendidos devolvería horarios que no se pueden
    // reservar. Mismo gate que el turnero web.
    const settings = await getAppointmentSettings(branch.organization_id, branch.id)
    if (!isBookable(branch, settings)) {
      return jsonError(
        409,
        'NOT_BOOKABLE',
        'Esta sucursal atiende por orden de llegada, sin turno previo.'
      )
    }

    const result = await getAvailableSlots(
      branch.id,
      date,
      serviceIds,
      staffIdRaw || undefined,
      undefined,
      { rateLimitKey: auth.userId }
    )

    return jsonOk({
      server_today: getLocalDateStr(branch.timezone || DEFAULT_TZ),
      slots: result.slots.map(b => ({
        staff_id: b.barberId,
        staff_name: b.barberName,
        staff_avatar_url: b.barberAvatarUrl,
        slots: b.slots,
      })),
      ...(result.error ? { error: result.error } : {}),
    })
  }
)
