'use server'

// =============================================================================
// Lo que necesita la pantalla de señas y no cubre `src/lib/actions/senas.ts`:
// los totales del período y la lista de señas que quedaron con plata cobrada y
// sin turno.
//
// El listado en sí, la devolución y la marca de "perdida" viven en
// `@/lib/actions/senas` (frente A2). Acá no se duplica nada de eso.
//
// Regla del archivo, la misma que la del listado: un fallo de lectura NUNCA se
// degrada a cero. Una pantalla de plata que dice "$0 cobrado" porque una query
// falló es peor que una que dice "no pudimos leer" — es exactamente lo que hizo
// que /dashboard/comprobantes informara "100% conciliado" durante cuatro días
// sobre $6,5M reales (Known Risk #15).
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getDayBounds } from '@/lib/time-utils'
import { excedenteDePago } from '@/lib/senas/repo'
import type { EstadoSena } from '@/lib/senas/contrato'
import type { SenaListada } from '@/lib/actions/senas'

export interface ResumenSenas {
    /** Señas acreditadas en el período: lo que efectivamente entró a las cuentas. */
    cobrado: number
    cobradoCantidad: number
    /** Comisión que se quedó Mercado Pago sobre esas señas. */
    comision: number
    devuelto: number
    devueltoCantidad: number
    /** Cancelaciones tardías y ausencias: ingreso del negocio. */
    perdido: number
    perdidoCantidad: number
    /** Links de pago abiertos: todavía no hay plata. */
    pendiente: number
    pendienteCantidad: number
    /** Señas con plata cobrada y sin turno: hay que resolverlas a mano. */
    sinTurnoCantidad: number
    error: string | null
    /** true si el período tenía más filas de las que se pudieron sumar. */
    truncado: boolean
}

const VACIO: ResumenSenas = {
    cobrado: 0, cobradoCantidad: 0, comision: 0,
    devuelto: 0, devueltoCantidad: 0,
    perdido: 0, perdidoCantidad: 0,
    pendiente: 0, pendienteCantidad: 0,
    sinTurnoCantidad: 0,
    error: null,
    truncado: false,
}

/**
 * Tope de filas que se suman en memoria.
 *
 * Los totales se agregan en TypeScript y no en SQL porque hoy las señas son
 * decenas por mes y una RPC nueva sería una segunda definición de "cobrado" que
 * mantener sincronizada con el listado. El tope existe para que ese atajo sea
 * explícito: si algún período lo pasa, la pantalla lo dice en vez de mostrar un
 * total corto en silencio (que es la trampa del `.limit(100)` de la pestaña
 * Egresos, a 14 filas de empezar a mentir).
 */
const TOPE_FILAS = 5000

export async function resumenSenas(filtros: {
    branchId?: string | null
    desde?: string | null
    hasta?: string | null
} = {}): Promise<ResumenSenas> {
    if (!(await currentUserCan('senas.view'))) {
        return { ...VACIO, error: 'No tenés permiso para ver las señas.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...VACIO, error: 'No autorizado.' }

    const permitidas = await getScopedBranchIds()
    if (!permitidas.length) return { ...VACIO }

    let sucursales = permitidas
    if (filtros.branchId) {
        if (!permitidas.includes(filtros.branchId)) return { ...VACIO, error: 'Sin acceso a esa sucursal.' }
        sucursales = [filtros.branchId]
    }

    const supabase = createAdminClient()
    let q = supabase
        .from('booking_deposits')
        .select('status, amount, refunded_amount, refunded_at, mp_refund_id, mp_fee, appointment_id')
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        .limit(TOPE_FILAS + 1)

    if (filtros.desde) q = q.gte('created_at', getDayBounds(filtros.desde).start)
    if (filtros.hasta) q = q.lt('created_at', getDayBounds(filtros.hasta).end)

    const { data, error } = await q
    if (error) {
        console.error('[resumenSenas]', error.message)
        return { ...VACIO, error: 'No pudimos calcular los totales de señas.' }
    }

    const filas = (data ?? []) as Array<{
        status: EstadoSena
        amount: number
        refunded_amount: number | null
        refunded_at: string | null
        mp_refund_id: string | null
        mp_fee: number | null
        appointment_id: string | null
    }>

    const r: ResumenSenas = { ...VACIO, truncado: filas.length > TOPE_FILAS }
    for (const f of filas.slice(0, TOPE_FILAS)) {
        const monto = Number(f.amount) || 0
        // "Devuelta" es un HECHO de Mercado Pago, no un estado que nos guste. La
        // devolución automática de `sin_cupo` puede fallar (la más común: la
        // cuenta de la sucursal no tiene saldo), y `acreditarPago` deja la fila
        // en `sin_cupo` sin `refunded_at` y lo loguea. Dando por devuelto todo
        // lo que está en `sin_cupo`, esa plata —que sigue en la cuenta y es del
        // cliente— aparecía en la línea de devoluciones: el tablero informaba
        // que se le había devuelto a alguien que nunca la vio volver.
        const devueltaDeVerdad = !!f.refunded_at || !!f.mp_refund_id
        switch (f.status) {
            case 'pagada':
            case 'consumida':
                // "Cobrado" es la plata que entró y se quedó: la que se devolvió
                // tiene su propia línea y no puede contarse en las dos.
                r.cobrado += monto
                r.cobradoCantidad += 1
                r.comision += Number(f.mp_fee) || 0
                if (f.status === 'pagada' && !f.appointment_id) r.sinTurnoCantidad += 1
                break
            case 'perdida':
                r.perdido += monto
                r.perdidoCantidad += 1
                r.comision += Number(f.mp_fee) || 0
                break
            case 'sin_cupo':
                if (!devueltaDeVerdad) {
                    // Plata cobrada, sin turno y sin devolver: es lo mismo que una
                    // `pagada` sin turno y va a la misma alarma, que es la única
                    // pantalla desde donde alguien la puede resolver.
                    r.cobrado += monto
                    r.cobradoCantidad += 1
                    r.comision += Number(f.mp_fee) || 0
                    r.sinTurnoCantidad += 1
                    break
                }
                r.devuelto += Number(f.refunded_amount ?? f.amount) || 0
                r.devueltoCantidad += 1
                break
            case 'devuelta':
                // El monto devuelto puede ser parcial: se usa el que se devolvió
                // de verdad, no el de la seña.
                r.devuelto += Number(f.refunded_amount ?? f.amount) || 0
                r.devueltoCantidad += 1
                break
            case 'iniciada':
                r.pendiente += monto
                r.pendienteCantidad += 1
                break
            default:
                // rechazada / expirada / cancelada: normalmente nunca hubo plata.
                // La excepción es el pago que llega tarde, cuando el cron ya
                // cerró el link: `acreditarPago` lo devuelve en el acto y anota
                // la devolución en la fila. Esa plata entró y salió, y tiene que
                // verse en la línea de devoluciones en vez de desaparecer.
                if (devueltaDeVerdad) {
                    r.devuelto += Number(f.refunded_amount ?? f.amount) || 0
                    r.devueltoCantidad += 1
                }
                break
        }
    }

    return r
}

export interface SenaSinTurno {
    id: string
    branchName: string | null
    clientName: string | null
    clientPhone: string | null
    serviceNames: string | null
    appointmentDate: string
    startTime: string
    amount: number
    paidAt: string | null
    failureReason: string | null
}

/**
 * Señas con plata cobrada y sin turno.
 *
 * Es la única lista que NO se filtra por período: son las que hay que resolver
 * hoy, sin importar cuándo entraron. Se cobró y el turno no llegó a existir —
 * error de red contra la base, rate-limit, o cualquier cosa que dejara la
 * acreditación a mitad de camino. La plata está en la cuenta de la sucursal y
 * el cliente cree que tiene turno.
 *
 * `sin_cupo` entra SÓLO si la devolución automática no llegó a salir: mientras
 * la fila no tenga `refunded_at` ni `mp_refund_id`, esa plata sigue en la
 * cuenta de la sucursal y es del cliente.
 *
 * Y TAMPOCO entra el CRÉDITO A FAVOR, que es el otro camino —y el frecuente—
 * que deja una seña `pagada` con `appointment_id` en NULL: cuando el cliente
 * cancela a tiempo y la sucursal está en `refund_on_early_cancel = 'credito'`
 * (el default de las cuatro), `resolverSenaDeTurnoCancelado` le suelta el turno
 * a propósito y le deja la plata a favor. Sin distinguirlo, cada cancelación
 * normal caía en el bloque rojo de "esto hay que resolverlo hoy" con la leyenda
 * "el cliente cree que reservó y no reservó" — y una alarma que grita por el
 * caso sano deja de servir para el caso enfermo, que es el que hay que ver.
 *
 * El discriminador es `refund_reason`: el crédito lo escribe siempre y la
 * acreditación fallida nunca (esa escribe `failure_reason`). Entre las señas
 * `pagada` no hay otro camino que lo complete.
 */
export async function senasSinTurno(): Promise<{ senas: SenaSinTurno[]; error: string | null }> {
    if (!(await currentUserCan('senas.view'))) {
        return { senas: [], error: 'No tenés permiso para ver las señas.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { senas: [], error: 'No autorizado.' }

    const sucursales = await getScopedBranchIds()
    if (!sucursales.length) return { senas: [], error: null }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select(
            'id, appointment_date, start_time, amount, paid_at, failure_reason, service_names, ' +
            'branch:branch_id(name), client:client_id(name, phone)',
        )
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        // Dos formas de la MISMA emergencia, y las dos son plata del cliente que
        // está en la cuenta de la sucursal:
        //   · `pagada` sin turno y sin motivo de crédito → la acreditación se
        //     cortó a mitad de camino y el cliente cree que reservó;
        //   · `sin_cupo` sin devolución efectiva → el horario se ocupó mientras
        //     pagaba y el refund automático NO salió (la causa más común es que
        //     la cuenta de Mercado Pago no tenga saldo). `acreditarPago` lo
        //     loguea y sigue, así que sin esta rama esa seña no aparecía en
        //     ninguna pantalla: acá quedaba afuera y en los totales se contaba
        //     como devuelta.
        .or(
            'and(status.eq.pagada,appointment_id.is.null,refund_reason.is.null),' +
            'and(status.eq.sin_cupo,refunded_at.is.null,mp_refund_id.is.null)'
        )
        .order('paid_at', { ascending: false })
        .limit(100)

    if (error) {
        console.error('[senasSinTurno]', error.message)
        return { senas: [], error: 'No pudimos leer las señas sin turno.' }
    }

    type Fila = {
        id: string
        appointment_date: string
        start_time: string
        amount: number
        paid_at: string | null
        failure_reason: string | null
        service_names: string | null
        branch: { name: string } | { name: string }[] | null
        client: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
    }

    const uno = <T,>(rel: T | T[] | null | undefined): T | null =>
        !rel ? null : Array.isArray(rel) ? (rel[0] ?? null) : rel

    const senas = ((data ?? []) as unknown as Fila[]).map(f => ({
        id: f.id,
        branchName: uno(f.branch)?.name ?? null,
        clientName: uno(f.client)?.name ?? null,
        clientPhone: uno(f.client)?.phone ?? null,
        serviceNames: f.service_names,
        appointmentDate: f.appointment_date,
        startTime: f.start_time,
        amount: Number(f.amount),
        paidAt: f.paid_at,
        failureReason: f.failure_reason,
    }))

    return { senas, error: null }
}

/**
 * Días de arrepentimiento por sucursal.
 *
 * La pantalla los necesita para poder decir, en la fila misma, que una seña
 * está dentro del plazo del art. 1110 CCyC. Ese derecho es irrenunciable y la
 * Disposición 377/2026 declara abusiva la cláusula que lo limite: si el dueño
 * va a apretar "no devolver", tiene que ver antes que en ese caso no puede
 * negarse. Un dato así no puede quedar escondido detrás de dos clics.
 */
export async function diasDeArrepentimientoPorSucursal(): Promise<Record<string, number>> {
    if (!(await currentUserCan('senas.view'))) return {}
    const orgId = await getCurrentOrgId()
    if (!orgId) return {}

    const sucursales = await getScopedBranchIds()
    if (!sucursales.length) return {}

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('branch_deposit_settings')
        .select('branch_id, arrepentimiento_days')
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)

    if (error) {
        console.error('[diasDeArrepentimientoPorSucursal]', error.message)
        return {}
    }

    const mapa: Record<string, number> = {}
    for (const f of (data ?? []) as Array<{ branch_id: string; arrepentimiento_days: number | null }>) {
        mapa[f.branch_id] = Number(f.arrepentimiento_days ?? 0)
    }
    return mapa
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoBusquedaSenas {
    senas: SenaListada[]
    error: string | null
    /**
     * La búsqueda matcheó más clientes de los que se pueden resolver de una vez
     * (`quick_search_clients` topea en 50). Se dice en pantalla: un resultado
     * corto que no avisa es la misma mentira que el filtro por página.
     */
    truncadoPorClientes: boolean
    /** Se llegó al tope de señas devueltas. También se avisa. */
    truncadoPorFilas: boolean
}

const VACIO_BUSQUEDA: ResultadoBusquedaSenas = {
    senas: [],
    error: null,
    truncadoPorClientes: false,
    truncadoPorFilas: false,
}

/** Cuántos clientes matcheados se miran. Es el techo duro de la RPC. */
const TOPE_CLIENTES = 50
/** Cuántas señas devuelve una búsqueda. */
const TOPE_BUSQUEDA = 200

/**
 * Buscar señas por cliente en TODA la base, no en la página cargada.
 *
 * El buscador anterior filtraba el array de 50 filas que estaba en pantalla:
 * escribir el nombre de un cliente que señó en junio no devolvía nada y no
 * había forma de llegar a esa seña desde la UI — el mismo agujero que tenía el
 * inbox antes de la mig 195, y con plata de por medio.
 *
 * La tolerancia la pone `quick_search_clients` (mig 167) y no un `ilike` a
 * mano: pliega acentos (el 17% de los nombres de la base tiene tilde) y
 * normaliza el teléfono por los últimos 10 dígitos, así "+54 9 351 212-5249" y
 * "2125249" encuentran a la misma persona. Escribir acá una tercera regla de
 * búsqueda sería garantizar que un día diga algo distinto que /dashboard/clientes.
 *
 * Se busca por CLIENTE y no por el texto libre de la fila: `service_names` es
 * un texto denormalizado y buscar ahí devolvería "todas las señas de Corte",
 * que no es lo que alguien quiere cuando escribe en este campo.
 */
export async function buscarSenas(
    texto: string,
    filtros: {
        branchId?: string | null
        estados?: EstadoSena[]
        desde?: string | null
        hasta?: string | null
    } = {},
): Promise<ResultadoBusquedaSenas> {
    if (!(await currentUserCan('senas.view'))) {
        return { ...VACIO_BUSQUEDA, error: 'No tenés permiso para ver las señas.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...VACIO_BUSQUEDA, error: 'No autorizado.' }

    // El scope se resuelve SIEMPRE server-side: el `branchId` que llega por
    // parámetro sólo puede recortar lo que el usuario ya podía ver.
    const permitidas = await getScopedBranchIds()
    if (!permitidas.length) return { ...VACIO_BUSQUEDA }

    let sucursales = permitidas
    if (filtros.branchId) {
        if (!permitidas.includes(filtros.branchId)) {
            return { ...VACIO_BUSQUEDA, error: 'Sin acceso a esa sucursal.' }
        }
        sucursales = [filtros.branchId]
    }

    const q = (texto ?? '').trim()
    // Menos de dos caracteres no es una búsqueda: la RPC misma no contesta.
    if (q.length < 2) return { ...VACIO_BUSQUEDA }

    const supabase = createAdminClient()

    const { data: clientes, error: errorClientes } = await supabase.rpc('quick_search_clients', {
        p_organization_id: orgId,
        p_query: q,
        p_limit: TOPE_CLIENTES,
    })

    if (errorClientes) {
        console.error('[buscarSenas/clientes]', errorClientes.message)
        return { ...VACIO_BUSQUEDA, error: 'No pudimos buscar. Reintentá en un momento.' }
    }

    const ids = ((clientes ?? []) as Array<{ id: string }>).map(c => c.id)
    if (!ids.length) return { ...VACIO_BUSQUEDA }

    let query = supabase
        .from('booking_deposits')
        .select(
            'id, branch_id, client_id, barber_id, service_names, appointment_date, start_time, ' +
            'amount, service_total, status, channel, mp_payment_id, mp_fee, appointment_id, ' +
            'paid_at, refunded_at, refunded_amount, failure_reason, refund_reason, raw, created_at, ' +
            'branch:branch_id(name), client:client_id(name, phone), barber:barber_id(full_name)',
        )
        .eq('organization_id', orgId)
        .in('branch_id', sucursales)
        .in('client_id', ids)
        .order('created_at', { ascending: false })
        .limit(TOPE_BUSQUEDA + 1)

    if (filtros.estados?.length) query = query.in('status', filtros.estados)
    if (filtros.desde) query = query.gte('created_at', getDayBounds(filtros.desde).start)
    if (filtros.hasta) query = query.lt('created_at', getDayBounds(filtros.hasta).end)

    const { data, error } = await query
    if (error) {
        console.error('[buscarSenas]', error.message)
        return { ...VACIO_BUSQUEDA, error: 'No pudimos buscar señas. Reintentá en un momento.' }
    }

    type Fila = {
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

    const uno = <T,>(rel: T | T[] | null | undefined): T | null =>
        !rel ? null : Array.isArray(rel) ? (rel[0] ?? null) : rel

    const filas = ((data ?? []) as unknown as Fila[])

    // El tipo de retorno es `SenaListada`, el mismo del listado: si mañana le
    // agregan un campo, este mapeo deja de compilar y hay que actualizarlo. Es
    // la única red contra que las dos vistas de la misma tabla se separen.
    const senas: SenaListada[] = filas.slice(0, TOPE_BUSQUEDA).map(f => ({
        id: f.id,
        branchId: f.branch_id,
        branchName: uno(f.branch)?.name ?? null,
        clientId: f.client_id,
        clientName: uno(f.client)?.name ?? null,
        clientPhone: uno(f.client)?.phone ?? null,
        barberName: uno(f.barber)?.full_name ?? null,
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
    }))

    return {
        senas,
        error: null,
        truncadoPorClientes: ids.length >= TOPE_CLIENTES,
        truncadoPorFilas: filas.length > TOPE_BUSQUEDA,
    }
}
