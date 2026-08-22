/**
 * POST /api/mobile/turnos/[slug]/book
 *
 * Reserva desde la app. Delega TODO en `createAppointment` (único motor): el
 * teléfono sale del JWT (`client.phone`), nunca del body; el nombre del body
 * sólo se usa si tiene al menos 2 caracteres, si no el guardado. Mismo mapeo
 * de errores a códigos públicos que `publicBookAppointment`. Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { RateLimits } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'
import { createAppointment, getAppointmentSettings } from '@/lib/actions/appointments'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import { findMobileBranch, isBookable } from '@/lib/mobile/branches'
import {
  TIME_RE,
  badRequest,
  isValidDateStr,
  jsonOk,
  jsonError,
  optionalString,
  rateLimited,
  readJsonObject,
  withMobileHandler,
} from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tope sano para una reserva: 8 horas. Evita que un body roto reserve el día entero. */
const MAX_DURATION_MINUTES = 480
const MAX_SERVICES = 10

interface BookBody {
  staff_id: string | null
  date: string
  start_time: string
  service_ids: string[]
  duration_minutes: number
  name?: string
}

function parseBody(raw: Record<string, unknown>): BookBody | string {
  const staffId = raw.staff_id
  if (staffId !== null && staffId !== undefined && (typeof staffId !== 'string' || !isValidUUID(staffId))) {
    return 'staff_id tiene que ser un UUID o null.'
  }

  const date = typeof raw.date === 'string' ? raw.date.trim() : ''
  if (!isValidDateStr(date)) return 'date tiene que ser YYYY-MM-DD.'

  const startTime = typeof raw.start_time === 'string' ? raw.start_time.trim() : ''
  if (!TIME_RE.test(startTime)) return 'start_time tiene que ser HH:MM.'

  const serviceIds = Array.isArray(raw.service_ids) ? raw.service_ids : null
  if (
    !serviceIds ||
    !serviceIds.length ||
    serviceIds.length > MAX_SERVICES ||
    serviceIds.some(id => typeof id !== 'string' || !isValidUUID(id))
  ) {
    return 'service_ids tiene que ser una lista de UUIDs (al menos uno).'
  }

  const duration = raw.duration_minutes
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > MAX_DURATION_MINUTES
  ) {
    return 'duration_minutes tiene que ser un entero positivo.'
  }

  return {
    staff_id: typeof staffId === 'string' ? staffId : null,
    date,
    start_time: startTime,
    service_ids: serviceIds as string[],
    duration_minutes: duration,
    name: optionalString(raw.name, 80),
  }
}

/**
 * Mismo mapeo que `publicBookAppointment` (public-booking.ts), comparando en
 * minúsculas. Lo que no matchea va como `BOOKING_FAILED` con el texto crudo.
 */
function mapBookingError(message: string): { status: number; code: string } {
  const low = message.toLowerCase()
  if (low.includes('demasiadas')) return { status: 429, code: 'RATE_LIMITED' }
  if (low.includes('teléfono') || low.includes('phone')) return { status: 409, code: 'INVALID_PHONE' }
  if (low.includes('varios turnos') || low.includes('quota') || low.includes('límite')) {
    return { status: 409, code: 'PHONE_QUOTA_EXCEEDED' }
  }
  if (
    low.includes('ya existe') ||
    low.includes('no hay barberos disponibles') ||
    // "Ese horario ya no está disponible, elegí otro" (barbero elegido): es el
    // mismo caso que SLOT_TAKEN aunque el texto sea otro.
    low.includes('ya no está disponible')
  ) {
    return { status: 409, code: 'SLOT_TAKEN' }
  }
  if (low.includes('ya tenés un turno activo')) return { status: 409, code: 'ALREADY_BOOKED_TODAY' }
  if (
    low.includes('no está dentro del horario') ||
    low.includes('no termina dentro') ||
    low.includes('cerrado')
  ) {
    return { status: 409, code: 'TOO_LATE' }
  }
  return { status: 409, code: 'BOOKING_FAILED' }
}

export const POST = withMobileHandler(
  'turnos/[slug]/book',
  async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const auth = await requireMobileClient(req)
    if (isMobileAuthError(auth)) return auth

    const raw = await readJsonObject(req)
    if (!raw) return badRequest('El body tiene que ser un objeto JSON.')
    const parsed = parseBody(raw)
    if (typeof parsed === 'string') return badRequest(parsed)

    const gate = await RateLimits.mobileBook(auth.userId)
    if (!gate.allowed) {
      return rateLimited('Hiciste demasiadas reservas seguidas. Esperá un minuto.')
    }

    const { slug } = await ctx.params
    const branch = await findMobileBranch(slug, auth.client.organizationId)
    if (!branch) return jsonError(404, 'BRANCH_NOT_FOUND', 'No encontramos esa sucursal.')

    const settings = await getAppointmentSettings(branch.organization_id, branch.id)
    if (!isBookable(branch, settings)) {
      return jsonError(
        409,
        'NOT_BOOKABLE',
        'Esta sucursal atiende por orden de llegada, sin turno previo.'
      )
    }

    const nombreBody = parsed.name ?? ''
    const clientName = nombreBody.length >= 2 ? nombreBody : auth.client.name

    const result = await createAppointment({
      branchId: branch.id,
      clientPhone: auth.client.phone,
      clientName,
      barberId: parsed.staff_id,
      serviceId: parsed.service_ids[0],
      serviceIds: parsed.service_ids,
      appointmentDate: parsed.date,
      startTime: parsed.start_time,
      durationMinutes: parsed.duration_minutes,
      source: 'public',
      // La app ya pasó por rate-limit por usuario y el teléfono viene del JWT:
      // el gate por IP (compartida detrás del CGNAT) no aplica.
      viaApp: true,
    })

    if ('error' in result && result.error) {
      const { status, code } = mapBookingError(result.error)
      return jsonError(status, code, result.error)
    }

    if (!result.success || !result.appointment) {
      return jsonError(409, 'BOOKING_FAILED', 'No pudimos crear el turno. Probá de nuevo.')
    }

    const appointment = result.appointment

    // `createAppointment` busca al cliente por teléfono (últimos 10 dígitos,
    // el más viejo). Si la cuenta del JWT es un duplicado más nuevo del mismo
    // teléfono, el turno queda colgado del otro y la app no lo va a ver en
    // "Mis turnos" ni lo va a poder cancelar. No se corrige acá (eso es un
    // merge de duplicados); se deja rastro para poder diagnosticarlo.
    if (appointment.client_id !== auth.client.id) {
      console.warn(
        `[api/mobile] turnos/[slug]/book: el turno ${appointment.id} quedó en el cliente ${appointment.client_id} y el JWT es ${auth.client.id} (duplicado por teléfono)`
      )
    }

    return jsonOk({
      ok: true,
      appointment,
      cancellation_token: appointment.cancellation_token,
      client_is_new: 'clientIsNew' in result ? !!result.clientIsNew : false,
      client_has_face: 'clientHasFace' in result ? !!result.clientHasFace : false,
    })
  }
)
