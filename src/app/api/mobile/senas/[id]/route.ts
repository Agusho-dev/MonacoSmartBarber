/**
 * GET /api/mobile/senas/[id]
 *
 * El estado de una seña. Lo consulta la pantalla "confirmando tu pago…" que la
 * app muestra al volver de Mercado Pago, mientras espera que el webhook cree el
 * turno. Devuelve `EstadoSenaResponse` del contrato.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN
 * -----------------------------
 * 1. La pertenencia se verifica SIEMPRE contra el cliente del JWT, nunca por el
 *    id solo. Un `deposit_id` no es un secreto: viaja en la URL del checkout de
 *    Mercado Pago y en la back_url que el browser del cliente muestra en la
 *    barra de direcciones. Sin este chequeo, cualquiera con un id ajeno vería
 *    el nombre del barbero, la sucursal, la fecha y el importe de otra persona.
 *    Una seña de otro cliente se contesta 404, no 403: confirmar que existe ya
 *    es más de lo que hace falta decir.
 * 2. `seguir_esperando` es la única señal que corta el polling de la app. Es
 *    false en cuanto el estado deja de poder cambiar solo — incluido `pagada`,
 *    que no está en `ESTADOS_TERMINALES` (todavía le falta consumirse en el
 *    cobro) pero es exactamente el final que la pantalla estaba esperando.
 *
 * La app además escucha `booking_deposits` por Realtime (mig 207, policy por
 * `current_client_id()`); este endpoint es el que la destraba si el WebSocket
 * no prende y el que le da los datos del turno ya creado, que la fila no trae.
 */
import type { NextRequest } from 'next/server'
import { RateLimits } from '@/lib/rate-limit'
import { isValidUUID } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMobileClient, isMobileAuthError } from '@/lib/mobile/auth'
import { leerSena } from '@/lib/senas/repo'
import { motivoRechazo, type BookingDeposit, type EstadoSenaResponse } from '@/lib/senas/contrato'
import { jsonOk, jsonError, rateLimited, withMobileHandler } from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Qué mostrarle al cliente en cada estado.
 *
 * `null` en los dos casos que no necesitan explicación: mientras espera y
 * cuando salió bien. Los demás son plata que se movió o que no se movió, y
 * colapsarlos en "el pago falló" es lo que hace que alguien reintente cinco
 * veces con la misma tarjeta sin fondos.
 */
function mensajeDeEstado(sena: BookingDeposit): string | null {
  switch (sena.status) {
    case 'iniciada':
      return null
    case 'consumida':
      return null
    case 'pagada':
      // `pagada` no implica turno. El motor deja dos caminos abiertos a
      // propósito con `appointment_id` en NULL, y son cosas OPUESTAS para el
      // cliente: o la creación del turno falló y lo estamos resolviendo, o él
      // canceló a tiempo y la sucursal está en `refund_on_early_cancel =
      // 'credito'`, así que la plata le quedó a favor. (Desde la mig 208 el
      // default —y lo que tienen las cuatro sucursales— es `devolucion`, que
      // termina en `devuelta` y no pasa por acá; el crédito quedó como opción
      // elegible, no como camino normal.) Sin este mensaje,
      // la app tenía que adivinar y las dos terminaban leyéndose igual —y hasta
      // como "turno confirmado", que es lo peor de los tres.
      if (sena.appointment_id) return null
      return sena.refund_reason
        ? 'Este turno está cancelado. La seña que pagaste te queda a favor para tu próxima reserva: avisanos cuando quieras usarla.'
        : 'Nos falta terminar de armar tu turno. Te confirmamos por WhatsApp apenas esté; tu pago ya quedó registrado, no lo repitas. Si en un rato no tenés novedades, escribinos y lo resolvemos.'
    case 'rechazada':
      return motivoRechazo(sena.mp_status_detail)
    case 'sin_cupo':
      return 'Alguien tomó ese horario justo antes que vos. Te devolvimos la seña a Mercado Pago; puede tardar unos días en verse. Elegí otro horario.'
    case 'expirada':
      return 'El link de pago venció antes de que se acreditara. No se cobró nada: podés volver a reservar.'
    case 'cancelada':
      return 'Ese pago quedó cancelado. Podés volver a reservar.'
    case 'devuelta':
      return 'Te devolvimos la seña a Mercado Pago. Puede tardar unos días en verse según el medio de pago.'
    case 'perdida':
      return 'La seña quedó a favor del local por la cancelación fuera de término.'
    default:
      return null
  }
}

/** Datos del turno para la pantalla de confirmación. */
interface TurnoDeSena {
  id: string
  appointment_date: string
  start_time: string
  barber_name: string | null
  branch_name: string
  service_names: string | null
}

/**
 * `appointments` tiene CUATRO FKs a `staff` (Known Risk #17), así que el embed
 * del barbero va por COLUMNA (`barber:barber_id(...)`) y no por tabla. Por
 * tabla, PostgREST rechaza la query ENTERA con PGRST201 y la pantalla de
 * confirmación se quedaría en blanco justo después de cobrar.
 */
async function leerTurnoDeSena(appointmentId: string, servicios: string | null): Promise<TurnoDeSena | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('appointments')
    .select('id, appointment_date, start_time, barber:barber_id(full_name), branch:branch_id(name)')
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) {
    // No se degrada a null en silencio: sin esto, un fallo de lectura se vería
    // igual que "el turno todavía no existe" y la app seguiría esperando para
    // siempre un turno que ya está creado.
    throw new Error(`No pudimos leer el turno de la seña: ${error.message}`)
  }
  if (!data) return null

  const fila = data as unknown as {
    id: string
    appointment_date: string
    start_time: string
    barber: { full_name: string | null } | { full_name: string | null }[] | null
    branch: { name: string } | { name: string }[] | null
  }
  const barbero = Array.isArray(fila.barber) ? fila.barber[0] : fila.barber
  const sucursal = Array.isArray(fila.branch) ? fila.branch[0] : fila.branch

  return {
    id: fila.id,
    appointment_date: fila.appointment_date,
    start_time: fila.start_time,
    barber_name: barbero?.full_name ?? null,
    branch_name: sucursal?.name ?? '',
    service_names: servicios,
  }
}

export const GET = withMobileHandler(
  'senas/[id]',
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await requireMobileClient(req)
    if (isMobileAuthError(auth)) return auth

    const { id } = await ctx.params
    if (!isValidUUID(id)) {
      return jsonError(404, 'NOT_FOUND', 'No encontramos ese pago.')
    }

    const gate = await RateLimits.mobileSenaEstado(auth.userId)
    if (!gate.allowed) {
      return rateLimited('Demasiadas consultas seguidas. Esperá unos segundos.')
    }

    const sena = await leerSena(id)
    // Misma respuesta para "no existe" y "es de otro cliente": ver regla 1.
    if (!sena || sena.client_id !== auth.client.id) {
      return jsonError(404, 'NOT_FOUND', 'No encontramos ese pago.')
    }

    const turno =
      sena.appointment_id && (sena.status === 'pagada' || sena.status === 'consumida')
        ? await leerTurnoDeSena(sena.appointment_id, sena.service_names)
        : null

    const monto = Number(sena.amount)
    const total = Number(sena.service_total)

    const body: EstadoSenaResponse = {
      ok: true,
      deposit_id: sena.id,
      status: sena.status,
      amount: monto,
      resto: Math.max(0, total - monto),
      appointment: turno,
      mensaje: mensajeDeEstado(sena),
      // Dos estados pueden cambiar SOLOS y los dos tienen que sostener el
      // polling: la intención todavía viva, y la seña ya cobrada a la que le
      // falta el turno —que la conciliación reintenta cada cinco minutos—. El
      // crédito a favor (`refund_reason` escrito) no: ése ya está resuelto y
      // seguir preguntando no lo va a mover.
      seguir_esperando:
        (sena.status === 'iniciada' && new Date(sena.expires_at).getTime() > Date.now())
        || (sena.status === 'pagada' && !sena.appointment_id && !sena.refund_reason),
    }

    return jsonOk(body)
  }
)
