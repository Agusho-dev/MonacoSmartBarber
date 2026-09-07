// =============================================================================
// src/lib/senas/repo.ts
// Acceso a datos de la seña. Módulo PLANO (sin 'use server'): nada de acá es un
// endpoint, y varias de estas funciones las llama el webhook de Mercado Pago,
// que no tiene sesión de dashboard ni cookie de nada.
//
// La regla que ordena este archivo: TODA lectura o escritura que falle TIRA.
// No hay ningún `console.error` seguido de un `return null`, porque acá se
// mueve plata y un error que no se propaga es un bug invisible de años (Known
// Risk #13: `increment_account_accumulated` falló el 100% de las veces durante
// meses y el tope de las cuentas de cobro nunca funcionó). El motor decide
// arriba qué hacer con cada error; este archivo se limita a no esconderlo.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import type {
    BookingDeposit,
    BranchDepositSettings,
    CanalSena,
    CodigoErrorSena,
    EstadoSena,
} from '@/lib/senas/contrato'

// ─────────────────────────────────────────────────────────────────────────────
// El error del dominio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error con un código del contrato adentro, para que el motor pueda traducirlo
 * a `CrearSenaError` sin tener que interpretar mensajes de Postgres.
 *
 * `causa` viaja SIEMPRE que haya una: un `fetch failed` o un `PGRST116` pelado
 * no se puede diagnosticar después (misma razón por la que `ErrorHttpArca`
 * arrastra su causa hasta `arca_taxpayers.last_check_error`).
 */
export class ErrorSena extends Error {
    readonly code: CodigoErrorSena
    readonly causa?: unknown

    constructor(code: CodigoErrorSena, message: string, causa?: unknown) {
        super(message)
        this.name = 'ErrorSena'
        this.code = code
        this.causa = causa
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sucursal, servicios, cliente
// ─────────────────────────────────────────────────────────────────────────────

export interface SucursalSena {
    id: string
    organizationId: string
    nombre: string
    timezone: string
}

export async function leerSucursal(branchId: string): Promise<SucursalSena> {
    if (!isValidUUID(branchId)) {
        throw new ErrorSena('NOT_BOOKABLE', 'Sucursal inválida')
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branches')
        .select('id, organization_id, name, timezone, is_active')
        .eq('id', branchId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer la sucursal.', error)
    if (!data || !data.is_active) {
        throw new ErrorSena('NOT_BOOKABLE', 'Esa sucursal no está disponible.')
    }

    return {
        id: data.id,
        organizationId: data.organization_id,
        nombre: data.name,
        timezone: data.timezone || 'America/Argentina/Buenos_Aires',
    }
}

export interface ServicioSena {
    id: string
    nombre: string
    precio: number
    duracion: number
}

/**
 * Los servicios elegidos, en el ORDEN en que los mandó el cliente.
 *
 * El orden importa dos veces: `service_ids[0]` termina siendo el `service_id`
 * de la fila de `appointments` (el principal), y el nombre concatenado es lo
 * que el cliente lee en la política ("Es el 50% de Corte + Barba").
 *
 * `services` no tiene `organization_id`: el scope sale de `branch_id`. Un
 * servicio de OTRA sucursal se rechaza en vez de cobrarse — Monaco tiene
 * servicios homónimos en las cuatro (migs 205/206) y aceptar el de al lado
 * cobraría un precio que no es el de este local.
 */
export async function leerServicios(
    serviceIds: string[],
    branchId: string,
): Promise<ServicioSena[]> {
    const ids = serviceIds.filter(id => isValidUUID(id))
    if (!ids.length) {
        throw new ErrorSena('PRECIO_INVALIDO', 'No elegiste ningún servicio.')
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('services')
        .select('id, name, price, duration_minutes, branch_id, is_active')
        .in('id', ids)

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer los servicios.', error)

    const porId = new Map((data ?? []).map(s => [s.id, s]))
    const salida: ServicioSena[] = []

    for (const id of ids) {
        const svc = porId.get(id)
        if (!svc || !svc.is_active) {
            throw new ErrorSena('PRECIO_INVALIDO', 'Alguno de los servicios elegidos ya no está disponible.')
        }
        if (svc.branch_id !== branchId) {
            throw new ErrorSena('PRECIO_INVALIDO', 'Alguno de los servicios elegidos no es de esta sucursal.')
        }
        salida.push({
            id: svc.id,
            nombre: svc.name,
            precio: Number(svc.price ?? 0),
            duracion: Number(svc.duration_minutes ?? 0),
        })
    }

    return salida
}

export interface ClienteSena {
    id: string
    nombre: string
    telefono: string
    organizationId: string | null
}

export async function leerCliente(clientId: string): Promise<ClienteSena> {
    if (!isValidUUID(clientId)) {
        throw new ErrorSena('INTERNAL', 'Cliente inválido')
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('clients')
        .select('id, name, phone, organization_id')
        .eq('id', clientId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer tus datos.', error)
    if (!data) throw new ErrorSena('INTERNAL', 'No encontramos tu ficha de cliente.')

    return {
        id: data.id,
        nombre: data.name ?? '',
        telefono: data.phone ?? '',
        organizationId: data.organization_id ?? null,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config de la seña
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La config de la sucursal. Devuelve `null` sólo si la fila no existe (una
 * sucursal creada después de la mig 207): eso significa "sin seña", que es el
 * default seguro. Un ERROR de lectura, en cambio, tira — degradarlo a "sin
 * seña" dejaría reservar gratis cada vez que la base tosa.
 */
export async function leerConfigSena(branchId: string): Promise<BranchDepositSettings | null> {
    if (!isValidUUID(branchId)) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_deposit_settings')
        .select('*')
        .eq('branch_id', branchId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer la configuración de la seña.', error)
    if (!data) return null

    return normalizarConfig(data as Record<string, unknown>)
}

export function normalizarConfig(fila: Record<string, unknown>): BranchDepositSettings {
    const canales = Array.isArray(fila.channels)
        ? (fila.channels as string[]).filter((c): c is CanalSena => c === 'app' || c === 'web' || c === 'staff')
        : (['app', 'web'] as CanalSena[])

    return {
        id: String(fila.id),
        organization_id: String(fila.organization_id),
        branch_id: String(fila.branch_id),
        is_enabled: Boolean(fila.is_enabled),
        percentage: Number(fila.percentage ?? 50),
        min_amount: Number(fila.min_amount ?? 0),
        round_to: Number(fila.round_to ?? 100),
        hold_minutes: Number(fila.hold_minutes ?? 0),
        expires_minutes: Number(fila.expires_minutes ?? 30),
        wallet_only: Boolean(fila.wallet_only),
        channels: canales,
        // El fallback espeja el DEFAULT DE LA COLUMNA, que la mig 208 pasó de
        // `credito` a `devolucion`. La columna es NOT NULL, así que esto sólo
        // corre con una fila rara; aun así tienen que decir lo mismo: un
        // default de código que contradice al de la base es la divergencia que
        // después nadie encuentra, y acá decide si la plata vuelve o se queda.
        refund_on_early_cancel:
            (fila.refund_on_early_cancel as BranchDepositSettings['refund_on_early_cancel']) ?? 'devolucion',
        forfeit_on_late_cancel: fila.forfeit_on_late_cancel !== false,
        arrepentimiento_days: Number(fila.arrepentimiento_days ?? 10),
        policy_text: (fila.policy_text as string | null) ?? null,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// La seña
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNAS_SENA =
    'id, organization_id, branch_id, client_id, barber_id, service_ids, service_names, ' +
    'appointment_date, start_time, duration_minutes, service_total, amount, currency, percentage, ' +
    'channel, status, provider, environment, mp_preference_id, mp_payment_id, mp_status, ' +
    'mp_status_detail, mp_payment_method_id, mp_payment_type_id, mp_collector_id, mp_fee, ' +
    'mp_net_amount, mp_money_release_date, init_point, expires_at, hold_until, paid_at, ' +
    'appointment_id, consumed_at, refunded_at, refunded_amount, refund_reason, refunded_by, ' +
    'mp_refund_id, failure_reason, created_at, updated_at'

export async function leerSena(depositId: string): Promise<BookingDeposit | null> {
    if (!isValidUUID(depositId)) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(COLUMNAS_SENA)
        .eq('id', depositId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer la seña.', error)
    return (data as unknown as BookingDeposit | null) ?? null
}

/**
 * TODAS las señas atadas a un turno, la más reciente primero y SIN filtrar por
 * estado.
 *
 * `leerSenaDeTurno` sólo devuelve las que tienen plata imputable
 * (`pagada`/`consumida`), y por eso no puede distinguir dos situaciones que en
 * el mostrador son OPUESTAS: "este turno nunca tuvo seña" y "la tenía y se
 * devolvió". Las dos se ven como `null`, y las dos terminan en un prepago de
 * $0 que nadie puede explicar después. El cobro necesita saber cuál de las dos
 * es (ver `consumirSenaEnCobro`).
 *
 * Devuelve una lista y no una fila porque el índice único de "una seña por
 * turno" es PARCIAL sobre `pagada`/`consumida`: una devuelta conserva su
 * `appointment_id` y puede convivir con otra.
 */
export async function leerSenasDelTurno(appointmentId: string): Promise<BookingDeposit[]> {
    if (!isValidUUID(appointmentId)) return []

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(COLUMNAS_SENA)
        .eq('appointment_id', appointmentId)
        .order('created_at', { ascending: false })

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer la seña del turno.', error)
    return (data ?? []) as unknown as BookingDeposit[]
}

/** La seña viva de un turno. El índice único garantiza que haya a lo sumo una. */
export async function leerSenaDeTurno(appointmentId: string): Promise<BookingDeposit | null> {
    if (!isValidUUID(appointmentId)) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(COLUMNAS_SENA)
        .eq('appointment_id', appointmentId)
        .in('status', ['pagada', 'consumida'])
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer la seña del turno.', error)
    return (data as unknown as BookingDeposit | null) ?? null
}

/** La intención abierta para ese cliente y ese hueco, si existe. */
export async function leerSenaIniciada(
    clientId: string,
    branchId: string,
    appointmentDate: string,
    startTime: string,
): Promise<BookingDeposit | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(COLUMNAS_SENA)
        .eq('client_id', clientId)
        .eq('branch_id', branchId)
        .eq('appointment_date', appointmentDate)
        .eq('start_time', startTime)
        .eq('status', 'iniciada')
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer tu intento de pago anterior.', error)
    return (data as unknown as BookingDeposit | null) ?? null
}

export interface NuevaSena {
    organization_id: string
    branch_id: string
    client_id: string
    barber_id: string | null
    service_ids: string[]
    service_names: string
    appointment_date: string
    start_time: string
    duration_minutes: number
    service_total: number
    amount: number
    percentage: number
    channel: CanalSena
    environment: string
    expires_at: string
    hold_until: string | null
}

/** Código de violación de índice único de Postgres. */
export const CONFLICTO_UNICO = '23505'

export async function insertarSena(payload: NuevaSena): Promise<BookingDeposit> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .insert(payload)
        .select(COLUMNAS_SENA)
        .single()

    if (error) {
        if (error.code === CONFLICTO_UNICO) {
            // El llamador sabe releer la fila que ganó la carrera. Se distingue
            // por el código, no por el mensaje: el texto de Postgres cambia.
            throw new ErrorSena('INTERNAL', CONFLICTO_UNICO, error)
        }
        throw new ErrorSena('INTERNAL', 'No pudimos registrar la seña.', error)
    }

    return data as unknown as BookingDeposit
}

export type ParcheSena = Partial<{
    status: EstadoSena
    mp_preference_id: string | null
    mp_payment_id: string | null
    mp_status: string | null
    mp_status_detail: string | null
    mp_payment_method_id: string | null
    mp_payment_type_id: string | null
    mp_collector_id: string | null
    mp_fee: number | null
    mp_net_amount: number | null
    mp_money_release_date: string | null
    init_point: string | null
    paid_at: string | null
    appointment_id: string | null
    consumed_at: string | null
    refunded_at: string | null
    refunded_amount: number | null
    refund_reason: string | null
    refunded_by: string | null
    mp_refund_id: string | null
    failure_reason: string | null
    hold_until: string | null
    /**
     * Notas técnicas de la fila (jsonb). NO es texto para el cliente: acá van
     * el detalle del pago tal como lo devolvió Mercado Pago y la intención de
     * devolución. `failure_reason` es lo que la pantalla pinta en rojo, así que
     * un excedente cobrado —que no es una falla— no puede ir ahí.
     */
    raw: Record<string, unknown> | null
}>

/**
 * UPDATE de una seña, opcionalmente CONDICIONAL al estado en que se la creía.
 *
 * `esperandoStatus` es el candado de concurrencia de todo el sistema: el
 * webhook de Mercado Pago se dispara varias veces por el mismo pago (MP
 * reintenta cada 15 minutos hasta recibir un 200) y la conciliación puede
 * correr en paralelo. Actualizar `.eq('status', 'iniciada')` y mirar cuántas
 * filas volvieron es lo que distingue "la acredité yo" de "otro proceso ya la
 * acreditó" — sin eso se crearían dos turnos para el mismo pago.
 *
 * Devuelve la fila actualizada, o `null` si la condición no se cumplió.
 */
export async function actualizarSena(
    depositId: string,
    parche: ParcheSena,
    esperandoStatus?: EstadoSena,
): Promise<BookingDeposit | null> {
    const supabase = createAdminClient()
    let q = supabase.from('booking_deposits').update(parche).eq('id', depositId)
    if (esperandoStatus) q = q.eq('status', esperandoStatus)

    const { data, error } = await q.select(COLUMNAS_SENA)

    if (error) {
        if (error.code === CONFLICTO_UNICO) {
            throw new ErrorSena('INTERNAL', CONFLICTO_UNICO, error)
        }
        throw new ErrorSena('INTERNAL', 'No pudimos actualizar la seña.', error)
    }

    const filas = (data ?? []) as unknown as BookingDeposit[]
    return filas[0] ?? null
}

/**
 * Agrega claves a `booking_deposits.raw` SIN pisar las que ya estaban.
 *
 * Hace un read-modify-write porque supabase-js no sabe expresar
 * `raw = coalesce(raw, '{}') || $1` y acá no se puede agregar una RPC. La
 * carrera existe (dos escrituras simultáneas: gana la última) y está asumida:
 * `raw` es metadato de diagnóstico, no plata. Todo lo que decide algo —estado,
 * montos, ids de Mercado Pago— viaja por `actualizarSena` con su UPDATE
 * condicional, que sí es el candado.
 *
 * `parche` viaja en el MISMO update para que marcar una intención (por ejemplo
 * `refund_reason` antes de pedirle la devolución a Mercado Pago) no cueste dos
 * viajes ni pueda quedar a medias.
 */
export async function anotarEnRaw(
    depositId: string,
    entradas: Record<string, unknown>,
    parche: ParcheSena = {},
): Promise<void> {
    const supabase = createAdminClient()

    const { data, error: errLectura } = await supabase
        .from('booking_deposits')
        .select('raw')
        .eq('id', depositId)
        .maybeSingle<{ raw: Record<string, unknown> | null }>()

    if (errLectura) {
        throw new ErrorSena('INTERNAL', 'No pudimos leer las notas de la seña.', errLectura)
    }

    const fusionado = { ...(data?.raw ?? {}), ...entradas }

    const { error } = await supabase
        .from('booking_deposits')
        .update({ ...parche, raw: fusionado })
        .eq('id', depositId)

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos anotar la seña.', error)
}

/**
 * Cuánto pagó el cliente POR ENCIMA de la seña esperada, leído de `raw.pago`
 * (lo escribe `parcheDeAcreditacion` con el importe REAL que devolvió Mercado
 * Pago, no con el que esperábamos cobrar).
 *
 * Vive acá y no en cada pantalla porque lo necesitan las dos vistas de la misma
 * tabla —el listado y el buscador— y dos implementaciones de la misma lectura
 * se separan solas. Devuelve `null` cuando no hay nada que mostrar: `raw` es
 * metadato libre y una fila vieja, o una seña que nunca se acreditó, no lo
 * tiene.
 */
export function excedenteDePago(raw: Record<string, unknown> | null | undefined): number | null {
    const pago = raw?.pago
    if (!pago || typeof pago !== 'object') return null
    const v = Number((pago as Record<string, unknown>).excedente ?? 0)
    return Number.isFinite(v) && v > 0 ? v : null
}

/** La seña que respalda un pago de Mercado Pago (dedupe por `mp_payment_id`). */
export async function leerSenaPorPago(mpPaymentId: string): Promise<BookingDeposit | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(COLUMNAS_SENA)
        .eq('mp_payment_id', mpPaymentId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos buscar la seña del pago.', error)
    return (data as unknown as BookingDeposit | null) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Turnos: el guard que hay que hacer ANTES de cobrar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿El cliente ya tiene un turno activo ese día en esta organización?
 *
 * Es exactamente el mismo chequeo que hace `createAppointment` — mismos
 * estados incluidos. Tiene que estar acá, antes del checkout: si sólo viviera
 * adentro de `createAppointment`, el cliente pagaría y recién después nos
 * enteraríamos de que el turno no se puede crear.
 *
 * Los estados activos son TRES. `pending_payment` NO está y no es un olvido:
 * ese valor NUNCA existió en `appointments_status_check` (la migración 109, que
 * lo agregaba, no se aplicó nunca en prod — verificado el 3/9/2026: el CHECK
 * admite scheduled | confirmed | checked_in | in_progress | completed |
 * cancelled | no_show). Filtrar por un valor imposible no rompe nada, pero
 * miente sobre cómo funciona la seña: la seña NO usa estados de turno. Su
 * ciclo de vida vive en `booking_deposits.status`
 * (`pendiente | pagada | consumida | devuelta | perdida`) y el turno se crea
 * recién cuando el pago está acreditado, ya en `confirmed`.
 */
export async function tieneTurnoActivoEseDia(
    orgId: string,
    clientId: string,
    appointmentDate: string,
): Promise<boolean> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('appointments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('appointment_date', appointmentDate)
        .in('status', ['confirmed', 'checked_in', 'in_progress'])
        .limit(1)

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos revisar tus turnos.', error)
    return (data ?? []).length > 0
}

/**
 * El turno que ya existe para EXACTAMENTE este hueco y este cliente.
 *
 * Es el guard del reintento. Si `createAppointment` llegó a crear el turno y lo
 * que falló fue el UPDATE que lo ata a la seña, volver a llamarlo no crea un
 * turno nuevo: choca contra "ya tenés un turno activo para esa fecha", que el
 * motor lee como falta de cupo, y termina DEVOLVIÉNDOLE la seña a alguien que
 * sí tiene turno (y que después paga el corte entero en el mostrador). Adoptar
 * el que ya está es la única salida que deja las dos tablas consistentes.
 *
 * `completed` entra en la lista a propósito: un reintento tardío tiene que
 * encontrar el turno aunque el corte ya se haya cobrado.
 */
export async function buscarTurnoDeLaSena(sena: BookingDeposit): Promise<string | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('appointments')
        .select('id')
        .eq('branch_id', sena.branch_id)
        .eq('client_id', sena.client_id)
        .eq('appointment_date', sena.appointment_date)
        .eq('start_time', sena.start_time)
        .in('status', ['confirmed', 'checked_in', 'in_progress', 'completed'])
        .limit(1)

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos revisar si el turno ya existe.', error)
    return (data ?? [])[0]?.id ?? null
}

export interface TurnoParaSena {
    id: string
    organizationId: string
    branchId: string
    appointmentDate: string
    startTime: string
    timezone: string
}

export async function leerTurno(appointmentId: string): Promise<TurnoParaSena | null> {
    if (!isValidUUID(appointmentId)) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('appointments')
        .select('id, organization_id, branch_id, appointment_date, start_time, branch:branch_id(timezone)')
        .eq('id', appointmentId)
        .maybeSingle()

    if (error) throw new ErrorSena('INTERNAL', 'No pudimos leer el turno.', error)
    if (!data) return null

    const rel = data.branch as { timezone?: string | null } | { timezone?: string | null }[] | null
    const branch = Array.isArray(rel) ? rel[0] : rel

    return {
        id: data.id,
        organizationId: data.organization_id,
        branchId: data.branch_id,
        appointmentDate: data.appointment_date,
        startTime: data.start_time,
        timezone: branch?.timezone || 'America/Argentina/Buenos_Aires',
    }
}
