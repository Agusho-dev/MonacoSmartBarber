'use server'

// =============================================================================
// src/lib/actions/senas.ts
// Capa de SERVER ACTIONS de la seña: permisos, aislamiento de organización y
// validación de entrada. El trabajo pesado vive en `@/lib/senas/motor`.
//
// La separación no es cosmética: en un archivo `'use server'` TODO export es un
// endpoint HTTP al que cualquiera puede pegarle con el action-id que viaja en
// el bundle del cliente. Por eso acá NO entra ninguna función que reciba una
// bandera de confianza por parámetro —el proveedor de Mercado Pago ya resuelto,
// el id de un pago que dice venir del webhook— y cada export empieza chequeando
// permiso y organización. Es el mismo patrón que
// `arca-emision.ts` ↔ `arca/motor.ts`.
//
// OJO: acá NO puede ir `export type { X } from '@/lib/senas/motor'`. El
// compilador de server actions trata todo re-export como export en runtime,
// incluso el de tipos, y el build falla con "Export X doesn't exist in target
// module". Los tipos se importan directo del módulo plano o del contrato.
//
// Otras reglas que sigue este módulo:
//  · El error que ve el usuario va en castellano; el crudo va a console.error
//    con el nombre de la función entre corchetes.
//  · Un fallo técnico NUNCA se degrada a "no hay datos". Esto es plata: si no
//    pudimos leer, se dice que no pudimos leer (Known Risk #15).
// =============================================================================

import { revalidatePath } from 'next/cache'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getCurrentOrgId, validateBranchAccess } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { isValidUUID } from '@/lib/validation'
import { getDayBounds } from '@/lib/time-utils'

import { excedenteDePago, normalizarConfig } from '@/lib/senas/repo'
import { devolverSena, horasHastaElTurno } from '@/lib/senas/motor'
import type {
    BranchDepositSettings,
    BranchPaymentProvider,
    EstadoSena,
} from '@/lib/senas/contrato'

// ─────────────────────────────────────────────────────────────────────────────
// Listado
// ─────────────────────────────────────────────────────────────────────────────

export interface FiltrosSenas {
    branchId?: string | null
    estados?: EstadoSena[]
    /** YYYY-MM-DD, sobre `created_at` en hora local de la sucursal. */
    desde?: string | null
    hasta?: string | null
    pagina?: number
    porPagina?: number
}

export interface SenaListada {
    id: string
    branchId: string
    branchName: string | null
    clientId: string
    clientName: string | null
    clientPhone: string | null
    barberName: string | null
    serviceNames: string | null
    appointmentDate: string
    startTime: string
    amount: number
    serviceTotal: number
    status: EstadoSena
    channel: string
    mpPaymentId: string | null
    mpFee: number | null
    appointmentId: string | null
    paidAt: string | null
    refundedAt: string | null
    refundedAmount: number | null
    failureReason: string | null
    /**
     * Por qué salió (o quedó a favor) la plata. Es el ÚNICO campo que separa
     * las dos señas que quedan `pagada` sin turno: el crédito por cancelación a
     * tiempo lo escribe siempre (`refund_on_early_cancel = 'credito'`, que
     * desde la mig 208 ya no es el default pero sigue siendo elegible) y la
     * acreditación fallida nunca. Sin él, la pantalla pinta de rojo "cobrada
     * sin turno" cada cancelación normal.
     */
    refundReason: string | null
    /**
     * Cuánto pagó el cliente POR ENCIMA de la seña esperada, si pasó.
     *
     * Sale de `raw.pago` (lo escribe `parcheDeAcreditacion` con el importe que
     * devolvió Mercado Pago, no con el que esperábamos cobrar). Un pago de más
     * confirma el turno igual, así que sin este campo el excedente no quedaba
     * en ninguna pantalla: ni para devolverlo ni para explicarlo. No va en
     * `failure_reason` porque el listado lo pinta de rojo y esto no es una
     * falla. `null` = no hubo excedente.
     */
    excedente: number | null
    createdAt: string
}

export interface ResultadoListado {
    senas: SenaListada[]
    total: number
    error: string | null
}

/**
 * El listado del dashboard.
 *
 * `total` viaja aparte y vale -1 cuando no se pudo contar: una pantalla de
 * plata nunca puede decir "0 señas" porque una query falló (Known Risk #15,
 * los cuatro días en que /dashboard/comprobantes informó $0 y "100%
 * conciliado" sobre $6,5M reales).
 */
export async function listarSenas(filtros: FiltrosSenas = {}): Promise<ResultadoListado> {
    const vacio: ResultadoListado = { senas: [], total: -1, error: null }

    if (!(await currentUserCan('senas.view'))) {
        return { ...vacio, error: 'No tenés permiso para ver las señas.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...vacio, error: 'No autorizado.' }

    // El scope de sucursal se resuelve SIEMPRE server-side. El `branchId` que
    // llega por parámetro sólo puede recortar lo que el usuario ya podía ver.
    const permitidas = await getScopedBranchIds()
    if (!permitidas.length) return { senas: [], total: 0, error: null }

    let sucursales = permitidas
    if (filtros.branchId) {
        if (!permitidas.includes(filtros.branchId)) {
            return { ...vacio, error: 'Sin acceso a esa sucursal.' }
        }
        sucursales = [filtros.branchId]
    }

    const porPagina = Math.min(200, Math.max(1, filtros.porPagina ?? 50))
    const pagina = Math.max(1, filtros.pagina ?? 1)
    const desde = (pagina - 1) * porPagina

    const supabase = createAdminClient()
    let q = supabase
        .from('booking_deposits')
        .select(
            'id, branch_id, client_id, barber_id, service_names, appointment_date, start_time, ' +
            'amount, service_total, status, channel, mp_payment_id, mp_fee, appointment_id, ' +
            'paid_at, refunded_at, refunded_amount, failure_reason, refund_reason, raw, created_at, ' +
            'branch:branch_id(name), client:client_id(name, phone), barber:barber_id(full_name)',
            { count: 'exact' },
        )
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        .order('created_at', { ascending: false })
        .range(desde, desde + porPagina - 1)

    if (filtros.estados?.length) q = q.in('status', filtros.estados)
    // La ventana se arma con `getDayBounds`, que resuelve el offset REAL de la
    // zona en esa fecha. Un `-03:00` escrito a mano se rompe el día que haya
    // una org fuera de Argentina, y es la misma trampa que hizo que 9 de los 16
    // tickets de Paraná de junio quedaran fechados el 01/06.
    if (filtros.desde) q = q.gte('created_at', getDayBounds(filtros.desde).start)
    if (filtros.hasta) q = q.lt('created_at', getDayBounds(filtros.hasta).end)

    const { data, error, count } = await q

    if (error) {
        console.error('[listarSenas]', error.message)
        return { ...vacio, error: 'No pudimos leer las señas. Reintentá en un momento.' }
    }

    const senas = (data ?? []).map(fila => {
        const f = fila as unknown as FilaListado
        return {
            id: f.id,
            branchId: f.branch_id,
            branchName: unwrap(f.branch)?.name ?? null,
            clientId: f.client_id,
            clientName: unwrap(f.client)?.name ?? null,
            clientPhone: unwrap(f.client)?.phone ?? null,
            barberName: unwrap(f.barber)?.full_name ?? null,
            serviceNames: f.service_names,
            appointmentDate: f.appointment_date,
            startTime: f.start_time,
            amount: Number(f.amount),
            serviceTotal: Number(f.service_total),
            status: f.status,
            channel: f.channel,
            mpPaymentId: f.mp_payment_id,
            mpFee: f.mp_fee != null ? Number(f.mp_fee) : null,
            appointmentId: f.appointment_id,
            paidAt: f.paid_at,
            refundedAt: f.refunded_at,
            refundedAmount: f.refunded_amount != null ? Number(f.refunded_amount) : null,
            failureReason: f.failure_reason,
            refundReason: f.refund_reason,
            excedente: excedenteDePago(f.raw),
            createdAt: f.created_at,
        }
    })

    return { senas, total: count ?? -1, error: null }
}

interface FilaListado {
    id: string
    branch_id: string
    client_id: string
    barber_id: string | null
    service_names: string | null
    appointment_date: string
    start_time: string
    amount: number
    service_total: number
    status: EstadoSena
    channel: string
    mp_payment_id: string | null
    mp_fee: number | null
    appointment_id: string | null
    paid_at: string | null
    refunded_at: string | null
    refunded_amount: number | null
    failure_reason: string | null
    refund_reason: string | null
    raw: Record<string, unknown> | null
    created_at: string
    branch: { name: string } | { name: string }[] | null
    client: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
    barber: { full_name: string } | { full_name: string }[] | null
}

/** El embed de PostgREST puede venir como objeto o como array de un elemento. */
function unwrap<T>(rel: T | T[] | null | undefined): T | null {
    if (!rel) return null
    return Array.isArray(rel) ? (rel[0] ?? null) : rel
}

// ─────────────────────────────────────────────────────────────────────────────
// Devolución y pérdida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devolver una seña a mano desde el dashboard.
 *
 * Permiso propio (`senas.refund`) y no `senas.manage`: configurar cuánto se
 * señа y mover plata de vuelta a la tarjeta de un cliente no son la misma
 * decisión, y quien administra la agenda no necesariamente puede hacer la
 * segunda.
 */
export async function devolverSenaAction(
    depositId: string,
    motivo: string,
    montoParcial?: number,
): Promise<{ ok: boolean; error?: string }> {
    if (!(await currentUserCan('senas.refund'))) {
        return { ok: false, error: 'No tenés permiso para devolver señas.' }
    }
    const contexto = await senaDeMiOrg(depositId)
    if ('error' in contexto) return { ok: false, error: contexto.error }

    const texto = (motivo ?? '').trim()
    if (texto.length < 3) return { ok: false, error: 'Escribí el motivo de la devolución.' }
    if (montoParcial != null && !(montoParcial > 0)) {
        return { ok: false, error: 'El monto a devolver tiene que ser mayor a cero.' }
    }

    const r = await devolverSena(depositId, {
        motivo: texto,
        montoParcial,
        actorUserId: contexto.userId,
    })

    revalidatePath('/dashboard/turnos/senas')
    return r
}

/**
 * Marcar una seña como perdida (el cliente no vino, o canceló tarde).
 *
 * No mueve plata: la seña ya está en la cuenta de Mercado Pago de la sucursal.
 * Lo que hace es cerrarla para que deje de figurar como pendiente de resolver y
 * para que no se pueda imputar a un cobro futuro.
 *
 * MIRA EL TURNO, NO SÓLO LA SEÑA. El guard anterior sólo pedía que la seña
 * estuviera `pagada`, y una seña `pagada` es exactamente la de un turno que
 * sigue EN PIE: un encargado que la daba por perdida sobre un turno `confirmed`
 * dejaba al local quedándose la seña y, cuando el cliente aparecía, cobrándole
 * el precio completo en el mostrador (`consumirSenaEnCobro` ya no encuentra
 * plata imputable en una seña `perdida`). El cliente pagaba la mitad dos veces.
 * "Perdida" es una consecuencia de que el turno se haya caído, así que el turno
 * tiene que estar caído.
 */
export async function marcarSenaPerdida(
    depositId: string,
    motivo?: string,
): Promise<{ ok: boolean; error?: string }> {
    if (!(await currentUserCan('senas.manage'))) {
        return { ok: false, error: 'No tenés permiso para administrar las señas.' }
    }
    const contexto = await senaDeMiOrg(depositId)
    if ('error' in contexto) return { ok: false, error: contexto.error }

    if (contexto.status !== 'pagada' && contexto.status !== 'sin_cupo') {
        return { ok: false, error: `No se puede dar por perdida una seña en estado "${contexto.status}".` }
    }

    const supabase = createAdminClient()

    // Una seña sin turno (`sin_cupo`, o el crédito a favor de una cancelación a
    // tiempo, que suelta el `appointment_id`) no tiene nada que verificar.
    if (contexto.appointmentId) {
        const { data: turno, error: errTurno } = await supabase
            .from('appointments')
            .select('id, status')
            .eq('id', contexto.appointmentId)
            .maybeSingle<{ id: string; status: string }>()

        // Es plata: no saber en qué estado está el turno NO habilita a
        // quedarse con la seña (Known Risk #13 / #15).
        if (errTurno) {
            console.error('[marcarSenaPerdida] turno', errTurno.message)
            return { ok: false, error: 'No pudimos verificar el turno de esta seña. Probá de nuevo.' }
        }

        const CAIDOS = ['cancelled', 'no_show']
        if (turno && !CAIDOS.includes(turno.status)) {
            return {
                ok: false,
                error:
                    `El turno de esta seña sigue activo (${turno.status}). ` +
                    'Cancelalo o marcalo como ausente primero: si el cliente aparece, el barbero ' +
                    'le va a cobrar el precio completo y habría pagado la seña dos veces.',
            }
        }
    }
    const { error } = await supabase
        .from('booking_deposits')
        .update({
            status: 'perdida',
            failure_reason: (motivo ?? '').trim() || 'Marcada como perdida desde el dashboard',
        })
        .eq('id', depositId)
        .eq('status', contexto.status)

    if (error) {
        console.error('[marcarSenaPerdida]', error.message)
        return { ok: false, error: 'No pudimos actualizar la seña.' }
    }

    revalidatePath('/dashboard/turnos/senas')
    return { ok: true }
}

/**
 * Cuántas horas faltan para el turno de una seña. Lo necesita la pantalla para
 * decir si una cancelación cae dentro o fuera de la ventana ANTES de apretar
 * nada — el cálculo vive en el motor porque depende de la zona horaria de la
 * sucursal, no de la del navegador.
 */
export async function horasParaElTurnoDeLaSena(appointmentId: string): Promise<number | null> {
    if (!(await currentUserCan('senas.view'))) return null
    if (!isValidUUID(appointmentId)) return null

    const orgId = await getCurrentOrgId()
    if (!orgId) return null

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('appointments')
        .select('id')
        .eq('id', appointmentId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error || !data) return null
    return horasHastaElTurno(appointmentId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración por sucursal
// ─────────────────────────────────────────────────────────────────────────────

export async function obtenerConfigSena(
    branchId: string,
): Promise<{ config: BranchDepositSettings | null; error: string | null }> {
    if (!(await currentUserCan('senas.view'))) {
        return { config: null, error: 'No tenés permiso para ver la configuración de la seña.' }
    }
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return { config: null, error: 'Sin acceso a esa sucursal.' }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_deposit_settings')
        .select('*')
        .eq('branch_id', branchId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[obtenerConfigSena]', error.message)
        return { config: null, error: 'No pudimos leer la configuración de la seña.' }
    }
    if (!data) return { config: null, error: null }

    return { config: normalizarConfig(data as Record<string, unknown>), error: null }
}

export interface ParcheConfigSena {
    is_enabled?: boolean
    percentage?: number
    min_amount?: number
    round_to?: number
    hold_minutes?: number
    expires_minutes?: number
    wallet_only?: boolean
    channels?: BranchDepositSettings['channels']
    refund_on_early_cancel?: BranchDepositSettings['refund_on_early_cancel']
    forfeit_on_late_cancel?: boolean
    arrepentimiento_days?: number
    policy_text?: string | null
}

/**
 * Guarda la config de la seña de una sucursal.
 *
 * ES UN MERGE: `undefined` significa "no lo mandé, no lo toques". La pantalla
 * de la seña tiene varios bloques y ninguno manda la fila entera; escribiendo
 * todo con defaults, guardar el porcentaje apagaría el interruptor o le
 * cambiaría la política de cancelación en silencio. Es el mismo bug que tenía
 * `guardarCupoBarbero` de ARCA —guardar el cupo apagaba la emisión
 * automática— y el de `updateClientNotes` con el Instagram (Known Risk #21).
 */
export async function guardarConfigSena(
    branchId: string,
    parche: ParcheConfigSena,
): Promise<{ ok: boolean; error?: string }> {
    if (!(await currentUserCan('senas.manage'))) {
        return { ok: false, error: 'No tenés permiso para configurar la seña.' }
    }
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return { ok: false, error: 'Sin acceso a esa sucursal.' }

    const limpio: Record<string, unknown> = {}
    const validaciones: [boolean, string][] = []

    if (parche.is_enabled !== undefined) limpio.is_enabled = !!parche.is_enabled
    if (parche.percentage !== undefined) {
        const v = Math.round(Number(parche.percentage))
        validaciones.push([v >= 1 && v <= 100, 'El porcentaje de la seña tiene que estar entre 1 y 100.'])
        limpio.percentage = v
    }
    if (parche.min_amount !== undefined) {
        const v = Number(parche.min_amount)
        validaciones.push([Number.isFinite(v) && v >= 0, 'El monto mínimo no puede ser negativo.'])
        limpio.min_amount = v
    }
    if (parche.round_to !== undefined) {
        const v = Number(parche.round_to)
        validaciones.push([Number.isFinite(v) && v > 0, 'El redondeo tiene que ser mayor a cero.'])
        limpio.round_to = v
    }
    if (parche.hold_minutes !== undefined) {
        const v = Math.round(Number(parche.hold_minutes))
        validaciones.push([v >= 0 && v <= 120, 'La reserva del horario va entre 0 y 120 minutos.'])
        limpio.hold_minutes = v
    }
    if (parche.expires_minutes !== undefined) {
        const v = Math.round(Number(parche.expires_minutes))
        validaciones.push([v >= 5 && v <= 720, 'La vigencia del link va entre 5 y 720 minutos.'])
        limpio.expires_minutes = v
    }
    if (parche.wallet_only !== undefined) limpio.wallet_only = !!parche.wallet_only
    if (parche.channels !== undefined) {
        const canales = (parche.channels ?? []).filter(c => c === 'app' || c === 'web' || c === 'staff')
        validaciones.push([canales.length > 0, 'Elegí al menos un canal donde pedir la seña.'])
        limpio.channels = canales
    }
    if (parche.refund_on_early_cancel !== undefined) {
        const v = parche.refund_on_early_cancel
        validaciones.push([
            v === 'credito' || v === 'devolucion' || v === 'ninguno',
            'La política de cancelación anticipada es inválida.',
        ])
        limpio.refund_on_early_cancel = v
    }
    if (parche.forfeit_on_late_cancel !== undefined) {
        limpio.forfeit_on_late_cancel = !!parche.forfeit_on_late_cancel
    }
    if (parche.arrepentimiento_days !== undefined) {
        const v = Math.round(Number(parche.arrepentimiento_days))
        validaciones.push([v >= 0, 'Los días de arrepentimiento no pueden ser negativos.'])
        limpio.arrepentimiento_days = v
    }
    if (parche.policy_text !== undefined) {
        const t = (parche.policy_text ?? '').trim()
        limpio.policy_text = t.length ? t.slice(0, 2000) : null
    }

    const falla = validaciones.find(([ok]) => !ok)
    if (falla) return { ok: false, error: falla[1] }
    if (!Object.keys(limpio).length) return { ok: true }

    const supabase = createAdminClient()

    // La fila existe desde la mig 207 para las cuatro sucursales, pero una
    // sucursal creada después no la tiene: el upsert por `branch_id` (UNIQUE)
    // evita que "configurar la seña" falle en silencio en un local nuevo.
    const { error } = await supabase
        .from('branch_deposit_settings')
        .upsert(
            { organization_id: orgId, branch_id: branchId, ...limpio },
            { onConflict: 'branch_id' },
        )

    if (error) {
        console.error('[guardarConfigSena]', error.message)
        return { ok: false, error: 'No pudimos guardar la configuración de la seña.' }
    }

    revalidatePath('/dashboard/turnos/senas')
    return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de las cuentas de Mercado Pago
// ─────────────────────────────────────────────────────────────────────────────

export interface ProveedorListado extends BranchPaymentProvider {
    branch_name: string | null
    /** true si además la sucursal tiene la seña prendida. */
    sena_activa: boolean
}

/**
 * Qué sucursales pueden cobrar hoy.
 *
 * Devuelve UNA fila por sucursal accesible, tenga o no cuenta conectada: una
 * sucursal sin fila es exactamente la que hay que conectar, y omitirla la
 * volvería invisible en la pantalla que existe para conectarla.
 *
 * NUNCA devuelve tokens: `access_token_cifrado` y compañía no salen de la base
 * de datos hacia ningún lado. La pantalla sólo necesita saber si está
 * conectada, con qué cuenta y cuándo se chequeó.
 */
export async function estadoProveedores(): Promise<{ proveedores: ProveedorListado[]; error: string | null }> {
    if (!(await currentUserCan('senas.view'))) {
        return { proveedores: [], error: 'No tenés permiso para ver los cobros online.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { proveedores: [], error: 'No autorizado.' }

    const sucursales = await getScopedBranchIds()
    if (!sucursales.length) return { proveedores: [], error: null }

    const supabase = createAdminClient()

    const [branchesRes, provRes, cfgRes] = await Promise.all([
        supabase.from('branches').select('id, name').in('id', sucursales),
        supabase
            .from('branch_payment_providers')
            .select(
                'id, organization_id, branch_id, provider, environment, connection_mode, mp_user_id, ' +
                'public_key, token_expires_at, live_mode, status, last_check_at, last_error, connected_at',
            )
            .eq('organization_id', orgId)
            .in('branch_id', sucursales),
        supabase.from('branch_deposit_settings').select('branch_id, is_enabled').in('branch_id', sucursales),
    ])

    if (branchesRes.error || provRes.error || cfgRes.error) {
        console.error(
            '[estadoProveedores]',
            branchesRes.error?.message ?? provRes.error?.message ?? cfgRes.error?.message,
        )
        return { proveedores: [], error: 'No pudimos leer el estado de los cobros online.' }
    }

    // El `select` va concatenado por legibilidad y eso le impide a supabase-js
    // inferir la forma de la fila (queda `GenericStringError`): se tipa a mano.
    const filasProv = (provRes.data ?? []) as unknown as BranchPaymentProvider[]
    const filasCfg = (cfgRes.data ?? []) as unknown as { branch_id: string; is_enabled: boolean }[]

    const porBranch = new Map(filasProv.map(p => [p.branch_id, p]))
    const senaActiva = new Map(filasCfg.map(c => [c.branch_id, !!c.is_enabled]))

    const proveedores: ProveedorListado[] = (branchesRes.data ?? []).map(b => {
        const p = porBranch.get(b.id)
        if (p) {
            return {
                ...p,
                branch_name: b.name,
                sena_activa: senaActiva.get(b.id) ?? false,
            }
        }
        // Placeholder para la sucursal que todavía no conectó nada.
        return {
            id: '',
            organization_id: orgId,
            branch_id: b.id,
            provider: 'mercadopago',
            environment: 'produccion',
            connection_mode: 'oauth',
            mp_user_id: null,
            public_key: null,
            token_expires_at: null,
            live_mode: null,
            status: 'desconectado',
            last_check_at: null,
            last_error: null,
            connected_at: null,
            branch_name: b.name,
            sena_activa: senaActiva.get(b.id) ?? false,
        }
    })

    return { proveedores, error: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper interno
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica que la seña sea de la org del caller y de una sucursal a la que
 * tiene acceso. Devuelve además el user id, que es lo que queda registrado en
 * `refunded_by`: una devolución sin autor es una devolución que nadie puede
 * explicar tres meses después.
 */
async function senaDeMiOrg(
    depositId: string,
): Promise<
    | { orgId: string; branchId: string; status: EstadoSena; appointmentId: string | null; userId: string | null }
    | { error: string }
> {
    if (!isValidUUID(depositId)) return { error: 'Seña inválida.' }

    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select('id, organization_id, branch_id, status, appointment_id')
        .eq('id', depositId)
        .maybeSingle()

    if (error) {
        console.error('[senaDeMiOrg]', error.message)
        return { error: 'No pudimos leer la seña.' }
    }
    if (!data || data.organization_id !== orgId) return { error: 'No encontramos esa seña.' }

    const permitidas = await getScopedBranchIds()
    if (!permitidas.includes(data.branch_id)) return { error: 'Sin acceso a esa sucursal.' }

    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()

    return {
        orgId,
        branchId: data.branch_id,
        status: data.status as EstadoSena,
        appointmentId: data.appointment_id ?? null,
        userId: user?.id ?? null,
    }
}
