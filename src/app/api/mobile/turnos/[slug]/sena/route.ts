/**
 * POST /api/mobile/turnos/[slug]/sena
 *
 * Prepara el cobro de la seña de una reserva que TODAVÍA NO EXISTE. Devuelve el
 * `init_point` de Mercado Pago y la política que hay que mostrar pegada al
 * botón; el turno lo crea el webhook cuando el pago se acredita.
 *
 * Espeja punto por punto a `.../book`: identidad del JWT, sucursal acotada a la
 * org del cliente, gate de "esta sucursal toma turnos", rate-limit POR USUARIO
 * (la app vive detrás del CGNAT de las telcos) y el mismo trato del `name` del
 * body (ver `guardarNombreDelCliente`). Lo único propio es el bucket, más
 * apretado, porque cada llamada crea una preferencia real en Mercado Pago.
 *
 * LA RESPUESTA MÁS IMPORTANTE DE ESTE ENDPOINT ES `SENA_NO_APLICA`, y por eso
 * viaja con 200 y no con un status de error: significa "esta sucursal no pide
 * seña, seguí por /book". Devolverlo como 4xx haría que la app —que no puede
 * distinguir un error de configuración de uno de red— le mostrara una pantalla
 * roja a un cliente que simplemente tiene que reservar gratis, que es hoy el
 * caso de las cuatro sucursales (`branch_deposit_settings.is_enabled = false`).
 * Ver docs/api-mobile.md.
 */
import type { NextRequest } from 'next/server'
import { RateLimits } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabase/server'
import { getAppointmentSettings } from '@/lib/actions/appointments'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import { findMobileBranch, isBookable } from '@/lib/mobile/branches'
import { crearIntencionDeSena } from '@/lib/senas/motor'
import type { CodigoErrorSena } from '@/lib/senas/contrato'
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

/** Los mismos topes que `/book`: un body roto no puede señar el día entero. */
const MAX_DURATION_MINUTES = 480
const MAX_SERVICES = 10

interface SenaBody {
  staff_id: string | null
  date: string
  start_time: string
  service_ids: string[]
  duration_minutes: number
  name?: string
}

function parseBody(raw: Record<string, unknown>): SenaBody | string {
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
    // Mismo tope que `/book`: el nombre es un dato de presentación, no una
    // clave, y 80 caracteres alcanzan de sobra.
    name: optionalString(raw.name, 80),
  }
}

/**
 * El nombre del body tiene que sobrevivir hasta el turno, y el turno lo crea el
 * WEBHOOK varios minutos después.
 *
 * `/book` resuelve esto pasándole el nombre a `createAppointment`, que lo
 * escribe en `clients`. Acá no hay a quién pasárselo: `crearIntencionDeSena`
 * sólo lo usaría para prellenar el checkout de Mercado Pago, y cuando
 * `acreditarPago` llegue a crear el turno va a leer el nombre GUARDADO. Sin
 * este paso, un cliente que corrige su nombre al reservar con seña termina con
 * el turno —y el WhatsApp de confirmación— a nombre de la versión vieja, y la
 * misma app se comporta distinto según si la sucursal cobra seña o no.
 *
 * El criterio es EL MISMO que `/book` (ahí `createAppointment` pisa
 * `clients.name` con el nombre recibido): gana el del body si trae al menos 2
 * caracteres. No se intenta ser más listo —"sólo si el guardado parece un
 * placeholder"— porque esa regla no existe en el otro endpoint y dos criterios
 * distintos para el mismo dato es cómo se llega a que el nombre dependa del
 * canal por el que se reservó.
 *
 * El `clientId` sale del JWT, nunca del body: acá no hay forma de escribirle el
 * nombre a otra persona.
 *
 * Si el UPDATE falla NO se corta la reserva: es un dato de presentación y
 * frenar un cobro por un nombre sería peor que el nombre desactualizado. Se
 * loguea, que es lo que corresponde a lo que no mueve plata.
 */
async function guardarNombreDelCliente(clientId: string, nombre: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('clients').update({ name: nombre }).eq('id', clientId)
  if (error) {
    console.error('[api/mobile] turnos/[slug]/sena guardarNombreDelCliente:', error.message)
  }
}

/**
 * El status HTTP de cada código del contrato.
 *
 * `SENA_NO_APLICA` no está acá a propósito: se contesta 200 (ver el encabezado).
 * El resto son rechazos reales y la app tiene que poder distinguirlos, así que
 * conservan el código tal cual lo devolvió el motor — no se colapsan en un
 * "no pudimos preparar el pago" que dejaría al cliente sin saber si reintentar,
 * cambiar de horario o llamar por teléfono.
 */
const STATUS_POR_CODIGO: Record<CodigoErrorSena, number> = {
  SENA_NO_APLICA: 200,
  MP_NO_CONECTADO: 503,
  SLOT_TAKEN: 409,
  ALREADY_BOOKED_TODAY: 409,
  PRECIO_INVALIDO: 409,
  RATE_LIMITED: 429,
  MP_ERROR: 502,
  NOT_BOOKABLE: 409,
  INTERNAL: 500,
}

export const POST = withMobileHandler(
  'turnos/[slug]/sena',
  async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const auth = await requireMobileClient(req)
    if (isMobileAuthError(auth)) return auth

    const raw = await readJsonObject(req)
    if (!raw) return badRequest('El body tiene que ser un objeto JSON.')
    const parsed = parseBody(raw)
    if (typeof parsed === 'string') return badRequest(parsed)

    const gate = await RateLimits.mobileSena(auth.userId)
    if (!gate.allowed) {
      return rateLimited('Estás generando muchos pagos seguidos. Esperá un minuto.')
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

    // El nombre se persiste ANTES de crear la intención: el turno lo va a crear
    // el webhook leyendo `clients`, así que si no queda escrito acá no llega.
    const nombreBody = parsed.name ?? ''
    const nombreCliente = nombreBody.length >= 2 ? nombreBody : auth.client.name
    if (nombreCliente && nombreCliente !== auth.client.name) {
      await guardarNombreDelCliente(auth.client.id, nombreCliente)
    }

    const result = await crearIntencionDeSena({
      branchId: branch.id,
      clientId: auth.client.id,
      barberId: parsed.staff_id,
      serviceIds: parsed.service_ids,
      appointmentDate: parsed.date,
      startTime: parsed.start_time,
      durationMinutes: parsed.duration_minutes,
      canal: 'app',
      // Prellenar el checkout baja un paso, pero el email NO se manda: los
      // clientes de Monaco no tienen email real (el alias interno
      // `{phone}@monaco.internal` haría que MP intentara notificar a un dominio
      // que no existe y le mostrara al cliente una dirección que no es la suya).
      payerName: nombreCliente || null,
      payerPhone: auth.client.phone || null,
      returnTo: 'app',
    })

    if (!result.ok) {
      const status = STATUS_POR_CODIGO[result.code] ?? 409
      if (status === 200) {
        // `SENA_NO_APLICA`: la app sigue por `/book` sin mostrar nada.
        return jsonOk({ ok: false, code: result.code, message: result.message })
      }
      return jsonError(status, result.code, result.message)
    }

    return jsonOk(result)
  }
)
