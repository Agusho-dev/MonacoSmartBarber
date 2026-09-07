// =============================================================================
// src/lib/senas/motor.ts
// El motor de la seña: crear la intención de pago, acreditarla, devolverla,
// resolverla cuando el turno se cancela y consumirla en el cobro.
//
// Módulo PLANO (sin 'use server') a propósito, igual que `@/lib/arca/motor`.
// Acá hay funciones que reciben banderas de confianza —el proveedor de Mercado
// Pago ya resuelto, el id de un pago que viene del webhook— y que jamás pueden
// ser un endpoint HTTP. En un archivo `'use server'` TODO export lo es, con un
// action-id que viaja en el bundle del browser. `src/lib/actions/senas.ts` es
// la capa fina que agrega permisos y scope de organización.
//
// LA DECISIÓN QUE ORDENA TODO: el turno se crea recién cuando el pago está
// acreditado, por el `createAppointment` de siempre y ya `confirmed`. Mientras
// el cliente paga NO se reserva nada (`hold_minutes = 0`, decisión del dueño).
// La carrera existe y está asumida: si dos personas pagan el mismo horario, la
// segunda queda `sin_cupo` y se le devuelve la plata sola. Eso se le avisa
// ANTES de pagar (ver `politica.ts`), que es lo que lo hace aceptable.
//
// La secuencia completa, y por qué está en este orden:
//   1. crearIntencionDeSena  → valida todo lo que se puede validar sin cobrar
//   2. (el cliente paga en Mercado Pago)
//   3. acreditarPago         → fuente de verdad = GET /v1/payments/{id}
//   4. createAppointment     → motor único de turnos, sin atajos
//   5. consumirSenaEnCobro   → `completeService` imputa la seña al precio
// =============================================================================

import { createHash } from 'crypto'

import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/server'
import { createAppointment, getAvailableSlots, getAppointmentSettings } from '@/lib/actions/appointments'
import { canalInterno } from '@/lib/appointments/canal-interno'
import { getTzOffsetISO } from '@/lib/time-utils'
import { isValidUUID } from '@/lib/validation'

import {
    hayCuentaCobrable,
    resolverProveedor,
    type ProveedorResuelto,
} from '@/lib/mercadopago/credenciales'
import {
    crearPreferencia,
    devolverPago,
    obtenerPago,
    type PagoMp,
} from '@/lib/mercadopago/checkout'

import {
    calcularSena,
    ESTADOS_CON_PLATA,
    motivoRechazo,
    type AmbienteMp,
    type BranchDepositSettings,
    type CanalSena,
    type BookingDeposit,
    type CrearSenaInput,
    type CrearSenaResult,
    type EstadoSena,
    type ResultadoAcreditacion,
    type TextoPolitica,
} from '@/lib/senas/contrato'
import { construirPolitica } from '@/lib/senas/politica'
import {
    actualizarSena,
    anotarEnRaw,
    buscarTurnoDeLaSena,
    CONFLICTO_UNICO,
    ErrorSena,
    insertarSena,
    leerCliente,
    leerConfigSena,
    leerSena,
    leerSenaDeTurno,
    leerSenaIniciada,
    leerSenasDelTurno,
    leerServicios,
    leerSucursal,
    leerTurno,
    tieneTurnoActivoEseDia,
    type ParcheSena,
} from '@/lib/senas/repo'

// ─────────────────────────────────────────────────────────────────────────────
// La URL base
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La URL que se hornea dentro de la preferencia de Mercado Pago.
 *
 * NO sale de `buildAppUrl()` / `absoluteUrl()`, que la derivan del header
 * `host` del request. Eso metería adentro de la preferencia el alias de Vercel
 * o el dominio de un preview deploy, y MP le reintentaría el webhook cada 15
 * minutos a un dominio que ya no existe, sin decir nada. Ya pasó: un alias
 * viejo dejó muertos cinco crons y los webhooks de Meta el 25/ago/2026, y
 * nadie se enteró durante meses (el diagnóstico no estaba en
 * `cron.job_run_details` sino en `net._http_response`).
 *
 * El día que cambie el dominio se toca UNA variable de entorno.
 */
export function urlBaseDePago(): string {
    const cruda = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://monacobarber.vercel.app'
    return cruda.replace(/\/+$/, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de tiempo
// ─────────────────────────────────────────────────────────────────────────────

/** 'HH:MM' — la forma en que el motor de disponibilidad rotula los slots. */
function aHoraCorta(hora: string): string {
    return hora.slice(0, 5)
}

/** 'HH:MM:SS' — la forma en que Postgres guarda y devuelve un `time`. */
function aHoraLarga(hora: string): string {
    return hora.length === 5 ? `${hora}:00` : hora.substring(0, 8)
}

/**
 * El instante real de un turno, en la zona de la SUCURSAL.
 *
 * `appointment_date` + `start_time` son hora de pared: `new Date('2026-09-10T15:00')`
 * los interpreta en la zona del proceso —UTC en Vercel—, así que un turno de
 * las 15:00 argentinas se leería como las 12:00 y la ventana de cancelación se
 * correría tres horas. Es la misma función que `appointmentInstant` en
 * `appointments.ts`, que es privada de ese módulo.
 */
function instanteDelTurno(fecha: string, hora: string, timezone?: string | null): Date {
    const tz = timezone || 'America/Argentina/Buenos_Aires'
    const offset = getTzOffsetISO(new Date(`${fecha}T12:00:00Z`), tz)
    return new Date(`${fecha}T${aHoraLarga(hora)}${offset}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. El guard: ¿esta reserva SE PUEDE crear gratis?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Reservar por este canal en esta sucursal EXIGE seña?
 *
 * Existe porque el cobro de la seña es una pantalla, y una pantalla no es un
 * control: `POST /api/mobile/turnos/<slug>/book` y `publicBookAppointment`
 * crean el turno `confirmed` sin mirar `branch_deposit_settings`. Un cliente
 * con su propio JWT (o cualquiera con el action-id que viaja en el bundle del
 * turnero) reserva gratis en una sucursal que cobra seña simplemente saltándose
 * el paso de pago. Por eso el guard vive del lado del servidor y en el motor,
 * que es donde también se decide cobrar: una sola definición de "acá se paga".
 *
 * Espeja exactamente lo que la UI usa para decidir si mostrar el paso de pago
 * (`senaCobrable` en `/turnos/[slug]/page.tsx`): config prendida + este canal
 * habilitado + una cuenta de Mercado Pago que de verdad pueda cobrar. La última
 * condición es deliberada: una sucursal con la seña prendida y la cuenta
 * desconectada no puede cobrar NADA, y bloquear ahí dejaría el turnero muerto
 * (ni con seña ni sin ella). Se pierde una seña, no un turno.
 *
 * TIRA si no puede averiguarlo. Es un control de plata: degradarlo a "no hace
 * falta seña" ante un error de base es exactamente cómo se regalan turnos sin
 * que nadie se entere, y es la misma regla que ya sigue `getAvailableSlots`
 * (nunca degradar a "todo libre").
 */
export async function senaObligatoria(
    branchId: string,
    canal: CanalSena,
    serviceIds: string[],
): Promise<boolean> {
    if (!isValidUUID(branchId)) return false

    const cfg = await leerConfigSena(branchId)
    if (!cfg?.is_enabled || !cfg.channels.includes(canal)) return false

    return await exigeSena(cfg, canal, branchId, serviceIds)
}

/**
 * La misma pregunta, sin canal: ¿esta reserva exige seña por ALGÚN canal de
 * cliente (app o web)?
 *
 * Es la forma que usa el guard de `createAppointment`, y no toma el canal a
 * propósito. El canal ahí se derivaría de `viaApp` / `viaKiosk`, que son
 * BANDERAS QUE MANDA QUIEN LLAMA: con el canal como parámetro, alguien que
 * pega directo contra el action-id elige el canal en el que la seña está
 * apagada y vuelve a reservar gratis. Si la sucursal cobra seña a sus clientes
 * por cualquier canal, el turno no se crea sin pago — punto.
 */
export async function senaObligatoriaParaClientes(
    branchId: string,
    serviceIds: string[],
): Promise<boolean> {
    if (!isValidUUID(branchId)) return false

    const cfg = await leerConfigSena(branchId)
    if (!cfg?.is_enabled) return false

    const canal = (['app', 'web'] as CanalSena[]).find(c => cfg.channels.includes(c))
    if (!canal) return false

    return await exigeSena(cfg, canal, branchId, serviceIds)
}

/**
 * ¿Una seña PAGADA respalda exactamente esta reserva?
 *
 * Es la única forma de saltearse el guard sin ser staff, y es una capability
 * verificada contra la base —no un booleano en el input, que cualquiera puede
 * mandar—. La usa `createAppointment` cuando la llama `acreditarPago` con el
 * pago ya acreditado.
 *
 * `appointment_id IS NULL` es lo que impide reusar la misma seña para un
 * segundo turno: apenas el motor la ata a un turno, deja de servir. (Una seña
 * que volvió a quedar suelta es el "crédito a favor" de una cancelación a
 * tiempo, o sea plata que el cliente ya puso y todavía no usó.)
 */
export async function senaRespaldaReserva(
    depositId: string,
    reserva: { branchId: string; appointmentDate: string; startTime: string },
): Promise<boolean> {
    const sena = await leerSena(depositId)
    if (!sena) return false
    return (
        sena.status === 'pagada'
        && !sena.appointment_id
        && sena.branch_id === reserva.branchId
        && sena.appointment_date === reserva.appointmentDate
        && aHoraCorta(sena.start_time) === aHoraCorta(reserva.startTime)
    )
}

/** El tronco común: precio real + `calcularSena` + cuenta que pueda cobrar. */
async function exigeSena(
    cfg: BranchDepositSettings,
    canal: CanalSena,
    branchId: string,
    serviceIds: string[],
): Promise<boolean> {

    // El monto se calcula con la MISMA función que cobra (`calcularSena` sobre
    // los mismos servicios), y no sólo con el interruptor: una reserva cuya
    // seña cae por debajo de `min_amount` —o un servicio sin precio— es una que
    // `crearIntencionDeSena` se niega a cobrar. Mirar sólo `is_enabled` acá
    // dejaría esos servicios IMPOSIBLES de reservar: ni gratis (bloqueados por
    // el guard) ni pagando (SENA_NO_APLICA).
    let total: number
    try {
        const servicios = await leerServicios(serviceIds, branchId)
        total = servicios.reduce((acc, s) => acc + s.precio, 0)
    } catch (e) {
        // Un servicio inválido, inactivo o de otra sucursal no se puede señar,
        // así que tampoco puede exigir seña: lo rechaza `createAppointment` con
        // su propio mensaje. Cualquier otro fallo (leer la base) SÍ se propaga.
        if (e instanceof ErrorSena && e.code === 'PRECIO_INVALIDO') return false
        throw e
    }

    if (!calcularSena(total, cfg, canal, cfg.channels).aplica) return false

    return await hayCuentaCobrable(branchId)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Crear la intención de seña
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arma el checkout de Mercado Pago para una reserva que todavía no existe.
 *
 * El orden de las validaciones NO es arbitrario: todo lo que puede rechazar la
 * reserva tiene que pasar ANTES de crear el link de pago. Un cliente que paga y
 * después se entera de que ya tenía un turno ese día no es un error de UX, es
 * una devolución que alguien tiene que ejecutar a mano.
 *
 * Lo único que deliberadamente NO se valida acá es la carrera por el horario:
 * el chequeo de disponibilidad del paso 5 es temprano y no reserva nada. La
 * carrera la resuelve `acreditarPago`.
 */
export async function crearIntencionDeSena(input: CrearSenaInput): Promise<CrearSenaResult> {
    try {
        return await intentarCrearIntencion(input)
    } catch (e) {
        if (e instanceof ErrorSena) {
            console.error('[crearIntencionDeSena]', e.code, e.message, e.causa ?? '')
            return { ok: false, code: e.code, message: e.message }
        }
        console.error('[crearIntencionDeSena] inesperado:', e)
        return { ok: false, code: 'INTERNAL', message: 'No pudimos preparar el pago. Probá de nuevo.' }
    }
}

async function intentarCrearIntencion(input: CrearSenaInput): Promise<CrearSenaResult> {
    const fecha = input.appointmentDate
    const horaCorta = aHoraCorta(input.startTime)
    const horaLarga = aHoraLarga(input.startTime)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(horaCorta)) {
        return { ok: false, code: 'INTERNAL', message: 'La fecha o la hora del turno son inválidas.' }
    }
    if (!isValidUUID(input.clientId)) {
        return { ok: false, code: 'INTERNAL', message: 'No pudimos identificarte.' }
    }

    // 1. La sucursal tiene que existir, estar activa y tomar turnos.
    const sucursal = await leerSucursal(input.branchId)
    const settings = await getAppointmentSettings(sucursal.organizationId, sucursal.id)
    if (!settings?.is_enabled) {
        return { ok: false, code: 'NOT_BOOKABLE', message: 'Esta sucursal no toma turnos online.' }
    }

    // 2. ¿Esta sucursal pide seña, y por este canal?
    const cfg = await leerConfigSena(sucursal.id)
    if (!cfg || !cfg.is_enabled || !cfg.channels.includes(input.canal)) {
        return { ok: false, code: 'SENA_NO_APLICA', message: 'Esta reserva no necesita seña.' }
    }

    // 3. El precio. La suma de TODOS los servicios, no la del primero: el
    //    prepago viejo (`calculatePrepaymentAmount`) tomaba `serviceId` solo y
    //    "corte + barba" señaba sobre el corte.
    const servicios = await leerServicios(input.serviceIds, sucursal.id)
    const total = servicios.reduce((acc, s) => acc + s.precio, 0)
    if (!(total > 0)) {
        return { ok: false, code: 'PRECIO_INVALIDO', message: 'Ese servicio no tiene precio cargado. Reservá por WhatsApp.' }
    }

    const calculo = calcularSena(total, cfg, input.canal, cfg.channels)
    if (!calculo.aplica) {
        return { ok: false, code: 'SENA_NO_APLICA', message: 'Esta reserva no necesita seña.' }
    }

    const cliente = await leerCliente(input.clientId)
    if (cliente.organizationId && cliente.organizationId !== sucursal.organizationId) {
        return { ok: false, code: 'INTERNAL', message: 'No pudimos identificarte en esta sucursal.' }
    }

    // 4. El guard de "ya tenés un turno ese día". Es el mismo que hace
    //    `createAppointment`; si sólo viviera allá, el cliente pagaría primero
    //    y descubriría después que su turno no se puede crear.
    if (await tieneTurnoActivoEseDia(sucursal.organizationId, cliente.id, fecha)) {
        return { ok: false, code: 'ALREADY_BOOKED_TODAY', message: 'Ya tenés un turno activo para ese día.' }
    }

    // 5. Disponibilidad. No reserva nada: es un chequeo temprano para no
    //    cobrarle a alguien un horario que ya no está. La clave de rate-limit
    //    va por CLIENTE y no por IP porque la app corre detrás del CGNAT de las
    //    telcos (misma razón que `RateLimits.mobile*`).
    const { slots, error: errorSlots } = await getAvailableSlots(
        sucursal.id,
        fecha,
        undefined,
        input.barberId ?? undefined,
        input.durationMinutes,
        { rateLimitKey: `sena:${cliente.id}` },
    )
    if (errorSlots) {
        return { ok: false, code: 'SLOT_TAKEN', message: errorSlots }
    }
    const hayCupo = slots.some(b =>
        (!input.barberId || b.barberId === input.barberId)
        && b.slots.some(s => s.time === horaCorta && s.available),
    )
    if (!hayCupo) {
        return { ok: false, code: 'SLOT_TAKEN', message: 'Ese horario ya no está disponible, elegí otro.' }
    }

    // 6. La cuenta de Mercado Pago de ESTA sucursal.
    const proveedor = await resolverProveedor(sucursal.id)
    if (!proveedor) {
        return {
            ok: false,
            code: 'MP_NO_CONECTADO',
            message: 'Esta sucursal todavía no tiene los pagos conectados. Reservá por WhatsApp.',
        }
    }

    const nombresServicios = servicios.map(s => s.nombre).join(' + ')
    const contextoPolitica = {
        servicios: nombresServicios,
        sucursal: sucursal.nombre,
        horasParaCancelar: Number(settings.cancellation_min_hours ?? 0),
    }
    const politica = construirPolitica(cfg, calculo, contextoPolitica)

    // 7. Reusar la intención abierta para este mismo hueco. El índice único
    //    `idx_booking_deposits_intento_unico` lo garantiza en la base; acá se
    //    resuelve antes de chocar contra él, para que un doble tap devuelva el
    //    MISMO link en vez de un error.
    const abierta = await leerSenaIniciada(cliente.id, sucursal.id, fecha, horaLarga)
    if (abierta) {
        const vencida = new Date(abierta.expires_at).getTime() <= Date.now()
        const mismaIntencion = mismosServicios(abierta.service_ids, input.serviceIds)
            && Number(abierta.amount) === calculo.sena
            && (abierta.barber_id ?? null) === (input.barberId ?? null)

        if (!vencida && mismaIntencion && abierta.init_point) {
            return respuestaOk(abierta, politica)
        }

        // O venció, o el cliente volvió atrás y cambió el servicio: la vieja
        // deja de servir y hay que liberarla, porque el índice único es parcial
        // sobre `status = 'iniciada'` y bloquearía el insert nuevo.
        await actualizarSena(
            abierta.id,
            {
                status: vencida ? 'expirada' : 'cancelada',
                failure_reason: vencida
                    ? 'Venció el link de pago sin acreditarse'
                    : 'Reemplazada por otra intención de reserva',
            },
            'iniciada',
        )
    }

    // 8. La fila. `expires_at` manda sobre la vigencia del link de MP y sobre
    //    el cron `expire-booking-deposits`.
    const ahora = Date.now()
    const venceEn = new Date(ahora + cfg.expires_minutes * 60_000)
    const nueva = {
        organization_id: sucursal.organizationId,
        branch_id: sucursal.id,
        client_id: cliente.id,
        barber_id: input.barberId ?? null,
        service_ids: servicios.map(s => s.id),
        service_names: nombresServicios,
        appointment_date: fecha,
        start_time: horaLarga,
        duration_minutes: input.durationMinutes,
        service_total: calculo.total,
        amount: calculo.sena,
        percentage: calculo.porcentaje,
        channel: input.canal,
        environment: proveedor.environment,
        expires_at: venceEn.toISOString(),
        // Con `hold_minutes = 0` queda NULL y nadie lo mira. La palanca existe
        // para el día que el dueño quiera reservar el hueco durante el checkout.
        hold_until: cfg.hold_minutes > 0
            ? new Date(ahora + cfg.hold_minutes * 60_000).toISOString()
            : null,
    }

    let sena: BookingDeposit
    try {
        sena = await insertarSena(nueva)
    } catch (e) {
        // Dos pedidos simultáneos del mismo cliente para el mismo hueco: ganó
        // el otro. Se relee su fila y se devuelve SU link, que es exactamente
        // lo que el cliente espera de un doble tap.
        if (e instanceof ErrorSena && e.message === CONFLICTO_UNICO) {
            const ganadora = await leerSenaIniciada(cliente.id, sucursal.id, fecha, horaLarga)
            if (ganadora?.init_point) return respuestaOk(ganadora, politica)
        }
        throw e
    }

    // 9. El checkout. `external_reference` es el id de la seña —un UUID entra
    //    en los 64 caracteres y en el alfabeto [A-Za-z0-9_-] que MP acepta— y
    //    es lo único que ata la notificación con esta fila.
    const base = urlBaseDePago()
    // `returnTo` viaja en la URL de retorno porque la página `/pago/[id]` es la
    // que decide si rebota al deep link de la app o se queda en el turnero web:
    // `back_urls` de MP tiene que ser https y no admite un esquema propio.
    const retorno = `${base}/pago/${sena.id}?volver=${input.returnTo === 'web' ? 'web' : 'app'}`
    try {
        const pref = await crearPreferencia(proveedor.accessToken, {
            titulo: `Seña ${nombresServicios}`,
            descripcion: `${sucursal.nombre} · ${fecha} ${horaCorta}`,
            monto: calculo.sena,
            externalReference: sena.id,
            // La notification_url de la PREFERENCIA pisa a la del panel de MP,
            // así que cada sucursal manda la suya con su `b=` adentro: es lo
            // que le permite al webhook resolver la cuenta sin depender de que
            // `collector_id` esté mapeado.
            notificationUrl: `${base}/api/webhooks/mercadopago/senas?b=${sucursal.id}`,
            // MP no acepta un esquema propio (`monaco://`) ni una URL sin
            // https, así que el retorno a la app rebota por esta página.
            backUrlBase: retorno,
            expiraEn: venceEn,
            walletOnly: cfg.wallet_only,
            timezone: sucursal.timezone,
            payer: {
                nombre: input.payerName ?? cliente.nombre ?? null,
                email: input.payerEmail ?? null,
                telefono: input.payerPhone ?? cliente.telefono ?? null,
            },
            // Viaja de vuelta dentro del pago: permite reconciliar a mano sin
            // tener que cruzar nada contra la base.
            metadata: {
                deposit_id: sena.id,
                branch_id: sucursal.id,
                organization_id: sucursal.organizationId,
                client_id: cliente.id,
                appointment_date: fecha,
                start_time: horaLarga,
                canal: input.canal,
            },
        })

        const conLink = await actualizarSena(sena.id, {
            mp_preference_id: pref.id,
            init_point: pref.initPoint,
        })

        return respuestaOk(conLink ?? { ...sena, init_point: pref.initPoint }, politica)
    } catch (e) {
        // El checkout no se pudo crear: la intención queda cerrada para que el
        // índice único no bloquee el próximo intento del cliente, y el motivo
        // queda escrito (no en un console.error que nadie va a leer).
        const motivo = e instanceof Error ? e.message : String(e)
        await actualizarSena(
            sena.id,
            { status: 'cancelada', failure_reason: `Mercado Pago rechazó el checkout: ${motivo}` },
            'iniciada',
        ).catch(err => console.error('[crearIntencionDeSena] no pudimos cerrar la intención:', err))

        console.error('[crearIntencionDeSena] crearPreferencia:', motivo, e)
        return {
            ok: false,
            code: 'MP_ERROR',
            message: 'No pudimos abrir el pago de Mercado Pago. Probá de nuevo en un momento.',
        }
    }
}

/**
 * La respuesta se arma con los montos de la FILA, no con los del cálculo en
 * memoria: cuando se reusa una intención abierta, la fila es la que manda —es
 * la que ya está atada a la preferencia de Mercado Pago que el cliente va a
 * pagar. Mostrarle el recálculo de ahora sería prometerle un número distinto
 * del que le va a cobrar el checkout.
 */
function respuestaOk(sena: BookingDeposit, politica: TextoPolitica): CrearSenaResult {
    return {
        ok: true,
        deposit_id: sena.id,
        init_point: sena.init_point ?? '',
        amount: Number(sena.amount),
        service_total: Number(sena.service_total),
        resto: Math.max(0, Number(sena.service_total) - Number(sena.amount)),
        expires_at: sena.expires_at,
        politica,
    }
}

/** Lo que Mercado Pago dice que se cobró, en pesos. */
function pagado(pago: { transactionAmount: number | null | undefined }): number {
    return Number(pago.transactionAmount ?? 0)
}

function mismosServicios(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
    const x = [...(a ?? [])].sort()
    const y = [...(b ?? [])].sort()
    return x.length === y.length && x.every((v, i) => v === y[i])
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Acreditar el pago — el corazón
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte un pago de Mercado Pago en un turno. La llaman el webhook y la
 * conciliación, así que es IDEMPOTENTE por diseño: MP reintenta la misma
 * notificación cada 15 minutos hasta recibir un 200, y las dos fuentes pueden
 * llegar a la vez.
 *
 * Los dos candados de concurrencia son de la BASE, no de este código:
 *   · el UPDATE condicional `.eq('status', 'iniciada')` — si afecta 0 filas,
 *     otro proceso ganó y acá no se crea ningún turno;
 *   · el índice único parcial sobre `mp_payment_id` — un pago respalda UNA
 *     sola seña, aunque dos procesos lleguen exactamente juntos.
 *
 * Un error de RED tira (no devuelve un resultado): el webhook tiene que
 * contestar distinto de 200 para que MP reintente. Un pago que no encontramos,
 * en cambio, es `ignorado` con 200 — reintentarlo no lo va a encontrar nunca.
 */
export async function acreditarPago(
    paymentId: string,
    proveedor: ProveedorResuelto,
): Promise<ResultadoAcreditacion> {
    // 1. La fuente de verdad es la API, jamás el body del webhook: los datos
    //    que llegan por la notificación son un aviso, no un comprobante.
    const pago = await obtenerPago(proveedor.accessToken, paymentId)

    const referencia = pago.externalReference ?? ''
    if (!isValidUUID(referencia)) {
        return { resultado: 'ignorado', motivo: 'El pago no referencia ninguna seña.' }
    }

    let sena = await leerSena(referencia)
    if (!sena) {
        return { resultado: 'ignorado', motivo: 'No encontramos la seña de ese pago.' }
    }

    // El pago tiene que haber entrado a la cuenta de ESTA sucursal y en ESTE
    // ambiente. Sin estos dos chequeos, un `external_reference` con el id de
    // una seña nuestra creado desde OTRA cuenta de Mercado Pago la marcaría
    // como pagada sin que hubiera entrado un peso — y `external_reference` no
    // es secreto: viaja en la URL del checkout que ve el cliente.
    if (proveedor.branchId !== sena.branch_id) {
        return { resultado: 'ignorado', motivo: 'El pago entró a una cuenta que no es la de esa sucursal.' }
    }
    if (proveedor.environment !== sena.environment) {
        return { resultado: 'ignorado', motivo: 'El pago es de otro ambiente de Mercado Pago.' }
    }
    if (proveedor.mpUserId && pago.collectorId && String(pago.collectorId) !== String(proveedor.mpUserId)) {
        return { resultado: 'ignorado', motivo: 'El pago lo cobró otra cuenta de Mercado Pago.' }
    }

    // 2. EL RESCATE DE LA INTENCIÓN QUE EL CRON DE VENCIMIENTO YA CERRÓ.
    //
    //    `expire_booking_deposits()` corre cada 2 minutos y no sabe nada de
    //    Mercado Pago: cierra toda seña `iniciada` cuyo link venció. Si la
    //    notificación se perdió o llegó tarde (dominio viejo, secreto rotado,
    //    5xx de Vercel, la cola de reintentos de MP), la fila queda `expirada`
    //    con la plata ADENTRO — y la pantalla del cliente le dice, textual, "no
    //    se cobró nada". Un pago aprobado mientras el link seguía vivo se
    //    retoma acá y sigue el camino normal; el que llegó tarde de verdad cae
    //    en `resolverPagoFueraDeTermino` y se devuelve solo.
    if (
        sena.status === 'expirada'
        && !sena.mp_payment_id
        && pago.status === 'approved'
        && aprobadoATiempo(pago, sena)
    ) {
        try {
            const reabierta = await actualizarSena(
                sena.id,
                { status: 'iniciada', failure_reason: null },
                'expirada',
            )
            if (reabierta) sena = reabierta
        } catch (e) {
            // `idx_booking_deposits_intento_unico` es parcial sobre
            // `status = 'iniciada'`: si el cliente ya abrió OTRA intención para
            // el mismo hueco, no se puede reabrir ésta. Es el desenlace
            // correcto —la nueva es la que él está por pagar— y el pago viejo
            // cae abajo y se devuelve. Sin este catch, el 23505 salía por
            // arriba y ponía a Mercado Pago a reintentar el mismo webhook cada
            // 15 minutos para siempre.
            if (!(e instanceof ErrorSena && e.message === CONFLICTO_UNICO)) throw e
        }
    }

    // 3. ¿Ya la procesamos? (o llegó un pago que no es el suyo)
    if (sena.status !== 'iniciada') {
        return await resolverPagoFueraDeTermino(sena, pago, proveedor)
    }

    const esperado = Number(sena.amount)
    const montoPagado = pagado(pago)

    // 4. El monto. Un peso de tolerancia por el redondeo de MP; menos que eso
    //    no confirma nada, y si la plata entró igual se devuelve sola. De más
    //    SÍ confirma —quitarle el turno a alguien que pagó de sobra sería
    //    absurdo— pero el excedente queda registrado en `raw` (ver
    //    `parcheDeAcreditacion`) para que el dueño lo vea y decida.
    if (montoPagado + TOLERANCIA_MONTO < esperado) {
        if (pago.status === 'approved') {
            const devolucion = await devolverPago(
                proveedor.accessToken,
                String(pago.id),
                undefined,
                // Devolución TOTAL de este pago: la clave se deriva del pago, así
                // que los reintentos del webhook (cada 15 minutos hasta el 200)
                // piden siempre la misma y Mercado Pago la ejecuta una sola vez.
                claveDevolucion(['pago', String(pago.id), 'total']),
            ).catch(err => {
                console.error('[acreditarPago] no pudimos devolver el pago corto', err)
                return null
            })
            await actualizarSena(sena.id, {
                status: 'rechazada',
                mp_payment_id: String(pago.id),
                mp_status: pago.status,
                mp_status_detail: pago.statusDetail ?? null,
                refunded_at: devolucion ? new Date().toISOString() : null,
                refunded_amount: devolucion ? montoPagado : null,
                refund_reason: 'Monto pagado menor al de la seña',
                mp_refund_id: devolucion ? String(devolucion.id) : null,
                failure_reason: `Se pagaron ${montoPagado} de ${esperado}`,
            }, 'iniciada')
        } else {
            await actualizarSena(sena.id, {
                status: 'rechazada',
                mp_status: pago.status,
                mp_status_detail: pago.statusDetail ?? null,
                failure_reason: `Se pagaron ${montoPagado} de ${esperado}`,
            }, 'iniciada')
        }
        return {
            resultado: 'rechazado',
            depositId: sena.id,
            motivo: 'El monto pagado no coincide con la seña. Si te lo cobraron, te lo devolvemos.',
        }
    }

    // 5. Rechazado por Mercado Pago.
    if (pago.status !== 'approved') {
        await actualizarSena(sena.id, {
            status: 'rechazada',
            mp_status: pago.status,
            mp_status_detail: pago.statusDetail ?? null,
            mp_payment_method_id: pago.paymentMethodId ?? null,
            mp_payment_type_id: pago.paymentTypeId ?? null,
            failure_reason: motivoRechazo(pago.statusDetail),
        }, 'iniciada')
        return { resultado: 'rechazado', depositId: sena.id, motivo: motivoRechazo(pago.statusDetail) }
    }

    // 6. Aprobado. El UPDATE condicional es el candado: si vuelve `null`, otro
    //    proceso tocó la fila entre la lectura y la escritura.
    if (montoPagado > esperado + TOLERANCIA_MONTO) {
        console.warn('[acreditarPago] pago POR ENCIMA de la seña esperada', {
            depositId: sena.id,
            paymentId: String(pago.id),
            montoPagado,
            esperado,
            excedente: montoPagado - esperado,
        })
    }

    const parche = parcheDeAcreditacion(pago, esperado)
    let pagada: BookingDeposit | null
    try {
        pagada = await actualizarSena(sena.id, parche, 'iniciada')

        if (!pagada) {
            // Perdimos una carrera, pero hay que averiguar CONTRA QUÉ. Si la
            // ganó otro proceso acreditando el mismo pago, no hay nada que
            // hacer. Si la ganó el cron de vencimiento —que corre cada 2
            // minutos y no mira Mercado Pago— la fila quedó cerrada con la
            // plata adentro: contestar "ya procesado" acá la dejaba así para
            // siempre, sin turno, sin devolución y sin rastro del pago.
            const releida = await leerSena(sena.id)
            if (!releida) return { resultado: 'ya_procesado', depositId: sena.id }

            if (releida.status === 'expirada' && !releida.mp_payment_id) {
                pagada = await actualizarSena(sena.id, parche, 'expirada')
            }
            if (!pagada) return await resolverPagoFueraDeTermino(releida, pago, proveedor)
        }
    } catch (e) {
        // El índice único de `mp_payment_id`: dos procesos exactamente juntos.
        if (e instanceof ErrorSena && e.message === CONFLICTO_UNICO) {
            return { resultado: 'ya_procesado', depositId: sena.id }
        }
        throw e
    }

    // 7. El turno.
    return await crearTurnoDeSena(pagada)
}

/**
 * Tolerancia de redondeo contra el monto esperado, en pesos.
 *
 * Por debajo de `esperado - 1` la seña no se confirma; por encima de
 * `esperado + 1` se confirma igual (el cliente pagó de más: quedarse con su
 * turno es lo único razonable) pero el excedente QUEDA REGISTRADO.
 */
const TOLERANCIA_MONTO = 1

/**
 * El parche que convierte una intención en una seña cobrada.
 *
 * `raw.pago` guarda lo que Mercado Pago dice que se cobró de verdad, no lo que
 * esperábamos cobrar. Son dos números distintos y hasta ahora sólo se
 * persistía el segundo (`amount`, escrito al crear la intención): un pago por
 * encima del esperado confirmaba el turno y el excedente no quedaba en ningún
 * lado — ni para devolverlo, ni para explicarlo cuando el cliente reclama.
 *
 * No va en `failure_reason`: ese campo lo pinta de ROJO el listado del
 * dashboard y un pago de más no es una falla. Va en `raw`, y `listarSenas` lo
 * expone como `excedente` para que la pantalla pueda mostrarlo.
 *
 * El excedente NO se devuelve solo, a propósito: una devolución parcial
 * automática sobre un caso raro que casi siempre es un cambio de precio entre
 * la intención y el pago mueve plata sin que nadie lo haya decidido. El dueño
 * lo ve y usa el botón de devolver.
 */
function parcheDeAcreditacion(pago: PagoMp, esperado: number): ParcheSena {
    const montoPagado = pagado(pago)
    const excedente = Math.max(0, montoPagado - esperado)

    return {
        status: 'pagada',
        raw: {
            pago: {
                monto_pagado: montoPagado,
                monto_esperado: esperado,
                // Sólo se anota cuando pasa la tolerancia de redondeo: un peso
                // de diferencia es ruido de Mercado Pago, no un excedente.
                excedente: excedente > TOLERANCIA_MONTO ? excedente : 0,
                moneda: pago.currencyId,
                registrado_el: new Date().toISOString(),
            },
        },
        mp_payment_id: String(pago.id),
        mp_status: pago.status,
        mp_status_detail: pago.statusDetail ?? null,
        mp_payment_method_id: pago.paymentMethodId ?? null,
        mp_payment_type_id: pago.paymentTypeId ?? null,
        mp_collector_id: pago.collectorId != null ? String(pago.collectorId) : null,
        mp_fee: pago.fee ?? null,
        mp_net_amount: pago.netReceivedAmount ?? null,
        mp_money_release_date: pago.moneyReleaseDate ?? null,
        paid_at: pago.dateApproved ?? new Date().toISOString(),
        failure_reason: null,
    }
}

/**
 * Margen entre el vencimiento del link y el `date_approved` del pago.
 *
 * La preferencia vence junto con la seña, así que un pago aprobado mucho
 * después llegó tarde de verdad. Los quince minutos absorben lo que tarda MP
 * en estampar la aprobación de un pago que el cliente confirmó sobre la hora.
 */
const MARGEN_APROBACION_MS = 15 * 60 * 1000

function aprobadoATiempo(pago: PagoMp, sena: BookingDeposit): boolean {
    if (!pago.dateApproved) return false
    const aprobado = new Date(pago.dateApproved).getTime()
    if (!Number.isFinite(aprobado)) return false
    return aprobado <= new Date(sena.expires_at).getTime() + MARGEN_APROBACION_MS
}

/**
 * Un pago que cae sobre una seña que ya no está `iniciada`.
 *
 * Tres desenlaces:
 *
 *  · ES NUESTRO PAGO Y LA SEÑA QUEDÓ A MEDIAS (`pagada` sin turno). El UPDATE
 *    que acredita salió y la creación del turno no. Se retoma. Sin esto, el
 *    reintento del webhook contestaba "ya procesado" y la seña se quedaba con
 *    plata y sin turno PARA SIEMPRE — mientras la app le decía al cliente
 *    "turno confirmado" y el barbero le cobraba el corte entero.
 *  · ES NUESTRO PAGO Y YA ESTÁ RESUELTA: no se toca nada.
 *  · ES OTRO PAGO: el cliente pagó dos veces (dos pestañas antes de que llegue
 *    el primer webhook) o pagó tarde. Se devuelve en el acto. La fila sólo se
 *    anota cuando NUNCA tuvo plata: pisarle el `mp_payment_id` a una seña que
 *    respalda un turno vivo borraría el rastro del pago bueno.
 */
async function resolverPagoFueraDeTermino(
    senaLeida: BookingDeposit,
    pago: PagoMp,
    proveedor: ProveedorResuelto,
): Promise<ResultadoAcreditacion> {
    let sena = senaLeida

    if (sena.mp_payment_id !== String(pago.id)) {
        // Antes de devolverle plata a nadie, se relee la fila. El webhook y la
        // conciliación pueden estar corriendo sobre el MISMO pago con segundos
        // de diferencia, y la fila que trae este llamado puede ser de antes de
        // que el otro la acreditara. Devolver un pago que ya respalda un turno
        // vivo es el peor error que puede cometer este archivo.
        const releida = await leerSena(sena.id)
        if (releida && releida.mp_payment_id === String(pago.id)) sena = releida
    }

    if (sena.mp_payment_id === String(pago.id)) {
        if (sena.status === 'pagada' && !sena.appointment_id) {
            return await crearTurnoDeSena(sena)
        }
        return { resultado: 'ya_procesado', depositId: sena.id }
    }

    // Una seña que volvió a estar `iniciada` NO se devuelve: está esperando un
    // pago, y el reintento del webhook la va a acreditar con éste. Devolver acá
    // sería cancelarle al cliente el pago que justamente estamos por acreditar.
    if (sena.status === 'iniciada') {
        return { resultado: 'ya_procesado', depositId: sena.id }
    }

    if (pago.status === 'approved') {
        const devolucion = await devolverPago(
            proveedor.accessToken,
            String(pago.id),
            undefined,
            // Devolución TOTAL de este pago: la clave se deriva del pago, así
            // que los reintentos del webhook (cada 15 minutos hasta el 200)
            // piden siempre la misma y Mercado Pago la ejecuta una sola vez.
            claveDevolucion(['pago', String(pago.id), 'total']),
        ).catch(err => {
            console.error('[acreditarPago] NO pudimos devolver el pago fuera de término', {
                depositId: sena.id, paymentId: pago.id, estado: sena.status, err,
            })
            return null
        })

        if (!ESTADOS_CON_PLATA.includes(sena.status)) {
            // Si el UPDATE choca (el índice único de `mp_payment_id`, o la fila
            // que cambió otra vez), la plata YA se devolvió: tirar acá pondría a
            // Mercado Pago a reintentar el mismo webhook cada 15 minutos y a
            // pedir la misma devolución. Queda en el log y se sigue.
            await actualizarSena(sena.id, {
                mp_payment_id: String(pago.id),
                mp_status: pago.status,
                mp_status_detail: pago.statusDetail ?? null,
                refunded_at: devolucion ? new Date().toISOString() : null,
                refunded_amount: devolucion ? pagado(pago) : null,
                refund_reason: `Pago recibido con la seña ya ${sena.status}`,
                mp_refund_id: devolucion ? String(devolucion.id) : null,
            }).catch(err => console.error('[acreditarPago] no pudimos anotar la devolución fuera de término:', err))
        }
    }

    return { resultado: 'ya_procesado', depositId: sena.id }
}

/**
 * De seña cobrada a turno. Por el motor único, sin atajos: `createAppointment`
 * es el que valida disponibilidad, arma el multi-servicio, genera el token de
 * cancelación y programa la confirmación y los recordatorios de WhatsApp.
 *
 * Es reentrante: la llaman la acreditación normal, el reintento del webhook y
 * la conciliación, y las tres pueden encontrarse con el turno ya creado.
 */
async function crearTurnoDeSena(sena: BookingDeposit): Promise<ResultadoAcreditacion> {
    // ¿El turno ya existe? Pasa cuando `createAppointment` salió bien y lo que
    // falló fue el UPDATE que lo ata a la seña. Volver a crearlo no duplica
    // nada —choca contra "ya tenés un turno activo para esa fecha"— pero este
    // motor lee eso como falta de cupo y le devolvería la seña a un cliente que
    // SÍ tiene turno.
    const yaExiste = await buscarTurnoDeLaSena(sena)
    if (yaExiste) return await vincularTurno(sena, yaExiste)

    const cliente = await leerCliente(sena.client_id)
    const creado = await createAppointment({
        branchId: sena.branch_id,
        clientPhone: cliente.telefono,
        clientName: cliente.nombre,
        barberId: sena.barber_id,
        serviceId: sena.service_ids[0],
        serviceIds: sena.service_ids,
        appointmentDate: sena.appointment_date,
        startTime: aHoraCorta(sena.start_time),
        durationMinutes: sena.duration_minutes,
        source: 'public',
        // LOS DOS RATE-LIMITS DEL TURNERO PÚBLICO NO PUEDEN APLICAR ACÁ. El
        // pago ya está acreditado: rechazar el turno es quedarse con la plata
        // del cliente sin darle nada.
        //
        //  · el gate por IP no protege nada (la IP es la de los servidores de
        //    Mercado Pago, compartida por TODOS los pagos que entran);
        //  · el gate por teléfono (3/h) rechazaba a un cliente que ya había
        //    creado tres turnos en la hora — pagó la seña y se quedaba sin
        //    turno.
        //
        // Las dos exenciones son verificables y ninguna es un booleano del
        // body: `canalInterno('sena_acreditada')` es un token aleatorio que
        // vive en la memoria de ESTE proceso (nunca viaja al browser), y
        // `depositId` lo revalida `senaRespaldaReserva` contra la fila (pagada,
        // sin turno, misma sucursal / fecha / hora) — que además es lo único
        // que autoriza a crear un turno en una sucursal que cobra seña.
        canalInterno: canalInterno('sena_acreditada'),
        depositId: sena.id,
    })

    if ('error' in creado && creado.error) {
        if (esFaltaDeCupo(creado.error)) {
            // La carrera que el diseño asume: alguien tomó el horario mientras
            // este cliente pagaba. Se le devuelve la plata sola.
            await actualizarSena(sena.id, { status: 'sin_cupo', failure_reason: creado.error }, 'pagada')
            const devuelta = await devolverSena(sena.id, {
                motivo: 'El horario se ocupó mientras se acreditaba el pago',
                estadosPermitidos: ['sin_cupo'],
            })
            if (!devuelta.ok) {
                console.error('[acreditarPago] sin cupo y SIN devolución automática', {
                    depositId: sena.id,
                    error: devuelta.error,
                })
            }
            return {
                resultado: 'sin_cupo',
                depositId: sena.id,
                motivo: creado.error,
                devuelta: devuelta.ok,
            }
        }

        // Cualquier otro fallo: la seña queda `pagada` SIN turno, con el motivo
        // escrito. Hay plata cobrada — no se la puede perder ni devolver a
        // ciegas por algo que puede ser transitorio (un error de red, el
        // rate-limit por teléfono). La conciliación la reintenta cada 5 minutos
        // y queda visible en el dashboard para resolverla a mano.
        await actualizarSena(sena.id, { failure_reason: creado.error })
        console.error('[acreditarPago] pago acreditado sin turno', { depositId: sena.id, error: creado.error })
        return { resultado: 'rechazado', depositId: sena.id, motivo: creado.error }
    }

    const turno = 'appointment' in creado ? creado.appointment : null
    if (!turno?.id) {
        await actualizarSena(sena.id, { failure_reason: 'El turno se creó sin id' })
        return { resultado: 'rechazado', depositId: sena.id, motivo: 'No pudimos confirmar el turno.' }
    }

    return await vincularTurno(sena, turno.id)
}

/** Ata la seña a su turno. Es el último paso y el que cierra el circuito. */
async function vincularTurno(sena: BookingDeposit, appointmentId: string): Promise<ResultadoAcreditacion> {
    try {
        await actualizarSena(sena.id, { appointment_id: appointmentId, failure_reason: null })
    } catch (e) {
        // `idx_booking_deposits_una_por_turno`: ese turno ya lo respalda otra
        // seña. No se puede vincular y reintentar no lo va a cambiar, así que
        // queda anotado en la fila en vez de tirar — un throw acá pone a
        // Mercado Pago a reintentar el mismo webhook cada 15 minutos para
        // siempre, y el desenlace sería idéntico.
        if (e instanceof ErrorSena && e.message === CONFLICTO_UNICO) {
            const motivo = `El turno ${appointmentId} ya está respaldado por otra seña`
            await actualizarSena(sena.id, { failure_reason: motivo })
                .catch(err => console.error('[vincularTurno] no pudimos anotar el conflicto:', err))
            return { resultado: 'rechazado', depositId: sena.id, motivo }
        }
        throw e
    }

    revalidatePath('/dashboard/turnos/agenda')
    revalidatePath('/dashboard/turnos/senas')

    return { resultado: 'confirmado', depositId: sena.id, appointmentId }
}

/**
 * ¿El turno no se pudo crear por una razón que NO se arregla reintentando?
 *
 * Se compara contra los mensajes que devuelve `createAppointment` porque esa
 * función no tiene códigos de error. Todos estos casos tienen el mismo
 * desenlace para el cliente —pagó y no hay turno—, así que todos disparan la
 * devolución automática. Incluye deliberadamente dos que no son "carrera":
 *  · "no tiene horario cargado" es un problema de configuración, pero
 *    retenerle la plata al cliente mientras alguien lo arregla es peor;
 *  · "ya tenés un turno activo" significa que reservó por otro lado entre la
 *    intención y el pago.
 */
function esFaltaDeCupo(mensaje: string): boolean {
    const m = mensaje.toLowerCase()
    return [
        'ya existe un turno en ese horario',
        'no está disponible',
        'no hay barberos disponibles',
        'no tiene horario cargado',
        'ya tenés un turno activo',
        'no termina dentro del horario',
    ].some(frase => m.includes(frase))
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Devolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La `X-Idempotency-Key` de una devolución, DERIVADA de lo que la identifica.
 *
 * `devolverPago` minteaba un `randomUUID()` en cada invocación, o sea que la
 * clave que existe justamente para que un reintento no devuelva dos veces
 * cambiaba en cada reintento. El agujero es concreto: `devolverSena` llama a
 * Mercado Pago y RECIÉN DESPUÉS escribe el estado; si el refund sale bien y el
 * UPDATE se cae (timeout de 8 s, la fila que cambió), el reintento pide otra
 * devolución con otra clave y Mercado Pago la ejecuta.
 *
 * Determinística sobre (seña, pago, monto, motivo): el mismo pedido produce la
 * misma clave y Mercado Pago devuelve el refund original sin mover un peso. El
 * precio es que dos devoluciones parciales legítimas del MISMO monto y con el
 * MISMO motivo se ven como un reintento y la segunda no se ejecuta — que es el
 * lado seguro del error, y se destraba escribiendo otro motivo.
 *
 * Se formatea como UUID porque es lo que Mercado Pago documenta y lo que sus
 * ejemplos usan; el hash entero (64 hex) también entraría, pero no hay razón
 * para averiguar si algún proxy lo trunca.
 */
function claveDevolucion(partes: (string | number | null | undefined)[]): string {
    const h = createHash('sha256').update(partes.map(p => String(p ?? '')).join('|')).digest('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export interface OpcionesDevolucion {
    motivo: string
    /** Devolución parcial. Sin esto se devuelve todo. */
    montoParcial?: number
    actorUserId?: string | null
    /**
     * Desde qué estados se acepta devolver. El default cubre los tres en los
     * que hubo plata y el turno ya no se va a cobrar.
     */
    estadosPermitidos?: EstadoSena[]
}

/**
 * Devuelve la seña por Mercado Pago.
 *
 * El error de MP se PROPAGA: la causa más común de una devolución fallida es
 * que la cuenta de la sucursal no tenga saldo, y eso hay que verlo en la
 * pantalla —no en un log— porque lo resuelve una persona moviendo plata.
 */
export async function devolverSena(
    depositId: string,
    opciones: OpcionesDevolucion,
): Promise<{ ok: boolean; error?: string }> {
    try {
        const permitidos = opciones.estadosPermitidos ?? (['pagada', 'sin_cupo', 'perdida'] as EstadoSena[])

        const sena = await leerSena(depositId)
        if (!sena) return { ok: false, error: 'No encontramos esa seña.' }
        if (sena.status === 'devuelta') return { ok: true }
        if (!permitidos.includes(sena.status)) {
            return { ok: false, error: `No se puede devolver una seña en estado "${sena.status}".` }
        }
        if (!sena.mp_payment_id) {
            return { ok: false, error: 'Esa seña no tiene un pago de Mercado Pago asociado.' }
        }

        const proveedor = await resolverProveedor(sena.branch_id, sena.environment as AmbienteMp)
        if (!proveedor) {
            return { ok: false, error: 'La cuenta de Mercado Pago de esa sucursal no está conectada.' }
        }

        const monto = opciones.montoParcial != null
            ? Math.min(Number(opciones.montoParcial), Number(sena.amount))
            : undefined

        const clave = claveDevolucion([
            'sena', sena.id, sena.mp_payment_id, monto ?? 'total', opciones.motivo,
        ])

        // LA INTENCIÓN SE ESCRIBE ANTES DE PEDIRLA. Entre este UPDATE y la
        // respuesta de Mercado Pago hay una ventana en la que la plata puede
        // haber salido y nosotros no saberlo (un timeout no dice que no se
        // ejecutó, dice que no nos enteramos — la misma regla que `en_duda` en
        // ARCA). Dejar el pedido anotado con su clave es lo que permite
        // reconstruir después qué se pidió, cuándo y con qué clave; el que
        // impide el doble refund es la clave determinística, esto es el rastro.
        //
        // `refund_reason` se escribe acá y no después para que la fila diga el
        // motivo aunque el proceso muera en el medio. El estado NO se toca: una
        // seña sigue siendo `pagada` hasta que Mercado Pago confirme.
        //
        // Falla CERRADO: si no podemos dejar constancia de que vamos a pedir la
        // devolución, no la pedimos. Una devolución sin rastro es la que después
        // nadie puede distinguir de un reintento.
        try {
            await anotarEnRaw(
                sena.id,
                {
                    devolucion_pedida: {
                        clave,
                        monto: monto ?? Number(sena.amount),
                        parcial: monto != null,
                        motivo: opciones.motivo,
                        estado_previo: sena.status,
                        pedida_el: new Date().toISOString(),
                    },
                },
                { refund_reason: opciones.motivo },
            )
        } catch (e) {
            console.error('[devolverSena] no pudimos registrar la intención de devolución:', depositId, e)
            return {
                ok: false,
                error: 'No pudimos registrar la devolución antes de pedirla. No se movió plata: reintentá.',
            }
        }

        const devolucion = await devolverPago(proveedor.accessToken, sena.mp_payment_id, monto, clave)

        const marcaDeDevolucion = {
            refunded_at: new Date().toISOString(),
            refunded_amount: monto ?? Number(sena.amount),
            refund_reason: opciones.motivo,
            refunded_by: opciones.actorUserId ?? null,
            mp_refund_id: String(devolucion.id),
        }

        // El UPDATE va CONDICIONADO al estado que se leyó arriba. Entre esa
        // lectura y la respuesta de Mercado Pago pasan segundos, y en esos
        // segundos el barbero puede haber cobrado el turno en el mostrador
        // (`consumirSenaEnCobro` mueve la fila a `consumida`). Pisando el estado
        // sin condición, la visita quedaba con `prepaid_amount` —o sea que el
        // barbero rindió de menos en la caja— y encima el cliente se llevaba la
        // plata de vuelta: el local perdía la seña dos veces.
        const marcada = await actualizarSena(
            sena.id,
            { status: 'devuelta', ...marcaDeDevolucion },
            sena.status,
        )

        if (!marcada) {
            // La plata YA salió de Mercado Pago: no se puede deshacer. Lo único
            // correcto es dejarla registrada sin tocar el estado nuevo y que
            // grite en el log, porque esa fila necesita una persona.
            await actualizarSena(sena.id, {
                ...marcaDeDevolucion,
                refund_reason: `${opciones.motivo} · devuelta cuando la seña ya no estaba "${sena.status}"`,
            }).catch(err => console.error('[devolverSena] no pudimos registrar la devolución cruzada:', err))
            console.error('[devolverSena] DEVOLUCIÓN SOBRE UNA SEÑA QUE CAMBIÓ DE ESTADO', {
                depositId: sena.id,
                estadoLeido: sena.status,
                refundId: String(devolucion.id),
            })
        }

        revalidatePath('/dashboard/turnos/senas')
        return { ok: true }
    } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e)
        console.error('[devolverSena]', depositId, motivo, e)
        return { ok: false, error: `No pudimos hacer la devolución en Mercado Pago: ${motivo}` }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Qué pasa con la seña cuando el turno se cancela
// ─────────────────────────────────────────────────────────────────────────────

export type AccionSobreSena = 'sin_sena' | 'devuelta' | 'credito' | 'perdida' | 'nada'

export interface ResultadoCancelacionSena {
    depositId: string | null
    accion: AccionSobreSena
    /**
     * El cliente sigue dentro de la ventana del art. 1110 CCyC.
     *
     * NO ejecuta nada: se devuelve como bandera para que la UI y el dashboard
     * la muestren. El derecho de revocación en contratos a distancia es
     * IRRENUNCIABLE y la Disp. 377/2026 declara abusiva la cláusula que
     * pretenda limitarlo, así que "la seña se pierde" nunca puede ser la última
     * palabra dentro de esos días: es un botón, no una discusión.
     */
    puedeArrepentirse: boolean
    /** Apto para mostrarle al cliente tal cual. */
    mensaje: string
    error?: string
}

export async function resolverSenaDeTurnoCancelado(
    appointmentId: string,
    contexto: {
        canceladoPor: 'client' | 'staff' | 'system'
        horasDeAnticipacion: number
        actorUserId?: string | null
    },
): Promise<ResultadoCancelacionSena> {
    const sinSena: ResultadoCancelacionSena = {
        depositId: null,
        accion: 'sin_sena',
        puedeArrepentirse: false,
        mensaje: '',
    }

    try {
        const sena = await leerSenaDeTurno(appointmentId)
        if (!sena) return sinSena

        // Una seña ya consumida es un servicio ya cobrado: cancelar el turno
        // después no le devuelve nada a nadie.
        if (sena.status !== 'pagada') {
            return { depositId: sena.id, accion: 'nada', puedeArrepentirse: false, mensaje: '' }
        }

        const cfg = await leerConfigSena(sena.branch_id)
        const arrepentimientoDias = cfg?.arrepentimiento_days ?? 0
        const puedeArrepentirse = arrepentimientoDias > 0
            && !!sena.paid_at
            && (Date.now() - new Date(sena.paid_at).getTime()) <= arrepentimientoDias * 24 * 60 * 60 * 1000

        // El local cancela → se devuelve, siempre. No es culpa del cliente y
        // ninguna configuración de la sucursal puede decir lo contrario.
        if (contexto.canceladoPor !== 'client') {
            const r = await devolverSena(sena.id, {
                motivo: 'El local canceló el turno',
                actorUserId: contexto.actorUserId ?? null,
            })
            return {
                depositId: sena.id,
                accion: r.ok ? 'devuelta' : 'nada',
                puedeArrepentirse,
                mensaje: r.ok
                    ? 'Te devolvimos la seña completa por Mercado Pago.'
                    : 'Cancelamos el turno. La devolución de la seña quedó pendiente, te escribimos para resolverla.',
                error: r.error,
            }
        }

        // El cliente cancela. La ventana es la MISMA que hace cumplir
        // `cancelAppointment` (`appointment_settings.cancellation_min_hours`),
        // así que un turno que el sistema deja cancelar nunca cae del lado
        // "tarde" de esta política.
        const settings = await getAppointmentSettings(sena.organization_id, sena.branch_id)
        const minimo = Number(settings?.cancellation_min_hours ?? 0)
        const aTiempo = contexto.horasDeAnticipacion >= minimo

        if (aTiempo) {
            // Sin configuración legible manda `devolucion`, que es el default
            // de la columna desde la mig 208. Antes caía en `credito`: la seña
            // quedaba `pagada` sin turno —un saldo a favor que ningún camino de
            // reserva sabe imputar— y el cliente terminaba con la plata retenida
            // por una fila de settings que no se pudo leer. Devolver es lo único
            // defendible cuando no sabemos qué prometió la sucursal.
            switch (cfg?.refund_on_early_cancel ?? 'devolucion') {
                case 'devolucion': {
                    const r = await devolverSena(sena.id, {
                        motivo: 'Cancelación del cliente dentro de la ventana',
                        actorUserId: contexto.actorUserId ?? null,
                    })
                    return {
                        depositId: sena.id,
                        accion: r.ok ? 'devuelta' : 'nada',
                        puedeArrepentirse,
                        mensaje: r.ok
                            ? 'Te devolvimos la seña por Mercado Pago.'
                            : 'Cancelamos el turno. La devolución quedó pendiente, te escribimos para resolverla.',
                        error: r.error,
                    }
                }
                case 'ninguno':
                    await actualizarSena(sena.id, {
                        status: 'perdida',
                        failure_reason: 'Cancelación del cliente: la sucursal no devuelve la seña',
                    }, 'pagada')
                    return {
                        depositId: sena.id,
                        accion: 'perdida',
                        puedeArrepentirse,
                        mensaje: 'Cancelamos el turno. Según la política de la sucursal, la seña no se devuelve.',
                    }
                case 'credito':
                default:
                    // La seña queda `pagada` y SIN turno: eso ES el saldo a
                    // favor. Imputarla a la próxima reserva es la billetera del
                    // cliente, que todavía no existe — el hook es este estado,
                    // no una tabla nueva.
                    //
                    // Soltar `appointment_id` no es sólo prolijidad: es lo que
                    // hace idempotente a esta función. Con el turno todavía
                    // colgado, una segunda cancelación (o un reintento) la
                    // volvería a encontrar `pagada` y la resolvería otra vez.
                    // El turno queda registrado en el motivo.
                    await actualizarSena(sena.id, {
                        appointment_id: null,
                        refund_reason: `Crédito a favor por la cancelación a tiempo del turno ${appointmentId}`,
                    }, 'pagada')
                    return {
                        depositId: sena.id,
                        accion: 'credito',
                        puedeArrepentirse,
                        mensaje: 'Cancelamos el turno. La seña te queda a favor para tu próximo turno.',
                    }
            }
        }

        // Cancelación tardía.
        if (cfg?.forfeit_on_late_cancel !== false) {
            await actualizarSena(sena.id, {
                status: 'perdida',
                failure_reason: `Cancelación con ${Math.max(0, Math.round(contexto.horasDeAnticipacion))} h de anticipación (mínimo ${minimo} h)`,
            }, 'pagada')
            return {
                depositId: sena.id,
                accion: 'perdida',
                puedeArrepentirse,
                mensaje: `Cancelaste con menos de ${minimo} horas: la seña queda para el local.`,
            }
        }

        const r = await devolverSena(sena.id, {
            motivo: 'Cancelación tardía, la sucursal devuelve igual',
            actorUserId: contexto.actorUserId ?? null,
        })
        return {
            depositId: sena.id,
            accion: r.ok ? 'devuelta' : 'nada',
            puedeArrepentirse,
            mensaje: r.ok ? 'Te devolvimos la seña por Mercado Pago.' : 'La devolución quedó pendiente.',
            error: r.error,
        }
    } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e)
        console.error('[resolverSenaDeTurnoCancelado]', appointmentId, motivo, e)
        // La cancelación del turno NO se cae por esto: el que llama ya canceló
        // o está por cancelar, y trabar eso sería peor que dejar una seña
        // pendiente de resolver (que además queda visible en el dashboard).
        return { ...sinSena, accion: 'nada', error: motivo }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Consumir la seña en el cobro
// ─────────────────────────────────────────────────────────────────────────────

export interface SenaConsumida {
    /** Lo que el cliente YA había pagado. Va a `visits.prepaid_amount`. */
    prepaidAmount: number
    depositId: string | null
    /**
     * Por qué el prepago es 0 aunque este turno SÍ haya tenido una seña.
     * `null` cuando no hay nada que explicar (no hubo seña, o se imputó bien).
     *
     * Existe porque "0" es la respuesta a dos preguntas distintas y quien cobra
     * no puede distinguirlas mirando el número.
     */
    advertencia: string | null
}

/**
 * La llama `completeService` al cobrar el turno.
 *
 * `visits.amount` sigue siendo el PRECIO COMPLETO: lo que la seña cambia es
 * cuánto entró por el mostrador, y eso lo dice `prepaid_amount`. Netear
 * `amount` —que es lo que hace hoy el prepago manual— subdeclara ARCA, parte
 * al medio el ticket promedio y le acredita al cliente la mitad de los puntos.
 *
 * ESTA FUNCIÓN TIRA SI NO PUEDE LEER. Es deliberado y es lo contrario de lo
 * que hace hoy el bloque 3.6 de `queue.ts`, que falla abierto: si no sabemos
 * cuánto había prepagado el cliente, es mejor que el cobro se caiga y el
 * barbero lo reintente a que le cobremos dos veces la misma mitad.
 *
 * LOS DOS CEROS, QUE NO SON EL MISMO CERO
 * ----------------------------------------------------------------------------
 * Devolver 0 significa "el cliente paga el precio completo en el mostrador", y
 * a eso se llega por dos caminos que hay que separar a mano:
 *
 *   · «devuelta» / «sin_cupo» → la plata VOLVIÓ a la tarjeta del cliente. El
 *     cero es correcto: descontarla del mostrador sería regalar media cabeza.
 *   · «consumida por ESTE mismo turno» → la plata está en la cuenta de la
 *     sucursal y ya se imputó. El cero sería un COBRO DOBLE: el cliente pagó la
 *     seña por Mercado Pago y volvería a pagarla en el local.
 *
 * Por eso la idempotencia es HACIA ADELANTE: la seña se mueve a `consumida`
 * antes del UPDATE de la fila (`completeService` paso 0b, y ese orden está
 * bien: resolverla después dejaría la visita en `amount = 0`), así que
 * cualquier cosa que falle DESPUÉS —el UPDATE de `queue_entries`, el
 * `AbortError` del timeout de 8 s de Supabase, la tablet perdiendo el wifi—
 * hace que el barbero reintente sobre una seña que ya está `consumida`. Ese
 * reintento tiene que recibir el MISMO monto, no cero.
 *
 * Que la visita ya se haya escrito no cambia nada ni duplica nada:
 * `completeService` escribe `prepaid_amount` y `deposit_id` con un UPDATE sobre
 * la MISMA visita (la que el trigger creó para ese `queue_entry_id`) y los
 * manda en cada corrida, también en 0, justamente para que un reintento no
 * arrastre el valor de la anterior. Acá sólo se devuelve el número correcto.
 */
export async function consumirSenaEnCobro(appointmentId: string): Promise<SenaConsumida> {
    const sinSena: SenaConsumida = { prepaidAmount: 0, depositId: null, advertencia: null }

    // Se leen TODAS las señas del turno, no sólo las que tienen plata
    // imputable: una `devuelta` conserva su `appointment_id` y con el filtro
    // angosto se veía igual que "este turno nunca tuvo seña".
    const senas = await leerSenasDelTurno(appointmentId)
    if (!senas.length) return sinSena

    const imputable = senas.find(s => s.status === 'pagada' || s.status === 'consumida')

    if (!imputable) {
        // Hubo seña y ya no hay plata que imputar. El cero es el correcto, pero
        // queda dicho: es la diferencia entre "no señó" y "señó y se le
        // devolvió", y sin esto nadie puede explicar el cobro tres meses
        // después.
        const otra = senas[0]
        const advertencia =
            `El turno tenía una seña de $${Number(otra.amount)} en estado "${otra.status}": ` +
            'no se descuenta del cobro.'
        console.warn('[consumirSenaEnCobro] seña sin plata imputable', {
            appointmentId,
            depositId: otra.id,
            estado: otra.status,
        })
        return { prepaidAmount: 0, depositId: null, advertencia }
    }

    // Ya consumida por este mismo turno: es el reintento del cobro. Se devuelve
    // el monto igual — es lo único que impide que el cliente pague la seña dos
    // veces.
    if (imputable.status === 'consumida') {
        return { prepaidAmount: Number(imputable.amount), depositId: imputable.id, advertencia: null }
    }

    const consumida = await actualizarSena(imputable.id, {
        status: 'consumida',
        consumed_at: new Date().toISOString(),
    }, 'pagada')

    if (consumida) {
        return { prepaidAmount: Number(consumida.amount), depositId: imputable.id, advertencia: null }
    }

    // No afectó ninguna fila: otro proceso la movió entre la lectura y el
    // update. Otra vez los dos ceros distintos — la versión más vieja devolvía
    // el monto en los dos casos y la anterior devolvía 0 en los dos.
    const releida = await leerSena(imputable.id)
    if (releida?.status === 'consumida') {
        return { prepaidAmount: Number(releida.amount), depositId: imputable.id, advertencia: null }
    }

    console.error('[consumirSenaEnCobro] la seña dejó de estar disponible durante el cobro', {
        appointmentId,
        depositId: imputable.id,
        estado: releida?.status ?? 'desconocido',
    })
    return {
        prepaidAmount: 0,
        depositId: null,
        advertencia:
            `La seña quedó en estado "${releida?.status ?? 'desconocido'}" mientras se cobraba: ` +
            'no se descontó del precio. Revisala en Turnos → Señas.',
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Vencimiento
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envoltorio de la RPC `expire_booking_deposits()` (SQL puro, la corre el cron
 * `expire-booking-deposits` cada 2 minutos). Existe para poder dispararla a
 * mano desde el dashboard o desde una ruta de cron sin duplicar la regla.
 *
 * Devuelve cuántas intenciones se vencieron.
 */
export async function expirarSenasVencidas(): Promise<number> {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('expire_booking_deposits')
    if (error) {
        throw new ErrorSena('INTERNAL', 'No pudimos vencer las señas pendientes.', error)
    }
    return Number(data ?? 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades que consume la capa de acciones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Cuánta anticipación tiene una cancelación? La calcula desde el turno para
 * que ni el dashboard ni la app tengan que mandar el número (y equivocarse de
 * zona horaria: `appointment_date` + `start_time` son hora de PARED).
 */
export async function horasHastaElTurno(appointmentId: string): Promise<number> {
    const turno = await leerTurno(appointmentId)
    if (!turno) return 0
    const instante = instanteDelTurno(turno.appointmentDate, turno.startTime, turno.timezone)
    return (instante.getTime() - Date.now()) / (1000 * 60 * 60)
}
