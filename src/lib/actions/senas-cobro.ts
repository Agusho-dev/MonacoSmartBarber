'use server'

// =============================================================================
// La seña vista desde el MOSTRADOR: lo único que necesita saber quien está por
// cobrar un corte es cuánto ya pagó el cliente por adelantado.
//
// Vive aparte de `src/lib/actions/senas.ts` (que es el dashboard: permisos de
// organización, devoluciones, configuración) porque el consumidor es otro: el
// panel del barbero se autentica con PIN + cookie firmada, NO con Supabase
// Auth, así que `currentUserCan` ahí devuelve siempre false y cualquier gate de
// permisos del dashboard dejaría al barbero sin el dato justo cuando lo
// necesita. El scope se resuelve como en el resto del panel: por sucursal
// (`validateBranchAccess`, que ya entiende la cookie del barbero) y verificando
// que el turno sea de ESA sucursal.
//
// NO recalcula el monto: lo lee de la fila. El importe que se muestra tiene que
// ser exactamente el que `consumirSenaEnCobro` va a imputar en `visits`; dos
// cálculos distintos serían dos números distintos en la misma pantalla.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, validateBranchAccess } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { isValidUUID } from '@/lib/validation'

export interface SenaDelTurno {
    depositId: string
    /** Lo que el cliente ya pagó por Mercado Pago. */
    monto: number
    /** Precio total de los servicios cuando se cobró la seña, para contexto. */
    totalAlReservar: number
    pagadaEl: string | null
}

/**
 * Resultado de leer la seña de un turno.
 *
 * Son TRES estados, no dos: "tiene seña" (`sena` con valor), "no tiene seña"
 * (`sena: null, error: null`) y "no pudimos averiguarlo" (`error` con motivo).
 * Colapsar el tercero contra el segundo es lo que hacía esta función cuando
 * devolvía `SenaDelTurno | null`: un error de base se leía en la pantalla como
 * "este turno no tiene seña" y el barbero cobraba el total, o sea el 150% del
 * servicio para un cliente que ya había pagado la mitad. Es el Known Risk #13
 * en su versión de UI — un error que no se propaga es un bug invisible.
 */
export interface ResultadoSenaDelTurno {
    sena: SenaDelTurno | null
    /** Motivo del fallo de lectura (para el log del caller), o `null` si se pudo leer. */
    error: string | null
}

/**
 * La seña PAGADA de un turno, si la hay.
 *
 * Sólo devuelve `status = 'pagada'`: una seña ya `consumida` pertenece a un
 * cobro que ya se cerró, y mostrarla en un cobro nuevo haría que el barbero
 * descontara dos veces la misma plata.
 *
 * El cobro NO se bloquea con un error acá: el que decide de verdad es
 * `consumirSenaEnCobro` en el servidor, que falla cerrado y aborta el cobro si
 * no puede leer. Lo que sí cambia es que la pantalla se entera y lo dice, en
 * vez de mostrar un importe que puede estar de más sin que nadie lo sepa.
 */
export async function senaDelTurno(
    appointmentId: string,
    branchId: string,
): Promise<ResultadoSenaDelTurno> {
    if (!isValidUUID(appointmentId) || !isValidUUID(branchId)) {
        return { sena: null, error: 'identificadores inválidos' }
    }

    // Sin scope de sucursal no sabemos nada del turno; tampoco sabemos que no
    // tenga seña. Una cookie de barbero vencida cae por acá.
    const orgId = await validateBranchAccess(branchId)
    if (!orgId) return { sena: null, error: 'sin acceso a la sucursal' }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select('id, amount, service_total, paid_at')
        .eq('appointment_id', appointmentId)
        .eq('branch_id', branchId)
        .eq('organization_id', orgId)
        .eq('status', 'pagada')
        .maybeSingle<{ id: string; amount: number; service_total: number; paid_at: string | null }>()

    if (error) {
        console.error('[senaDelTurno]', error.message)
        return { sena: null, error: error.message }
    }
    if (!data) return { sena: null, error: null }

    return {
        sena: {
            depositId: data.id,
            monto: Number(data.amount),
            totalAlReservar: Number(data.service_total),
            pagadaEl: data.paid_at,
        },
        error: null,
    }
}

/**
 * Las señas pagadas de un conjunto de turnos, para pintar la agenda.
 *
 * Va en lote y no de a una: la agenda dibuja hasta ~60 turnos por día y una
 * consulta por tarjeta serían 60 idas y vueltas — exactamente lo que hacía el
 * panel de ARCA antes de la mig 184 (6 a 10 segundos de pantalla en blanco).
 */
export async function senasDeTurnos(appointmentIds: string[]): Promise<Record<string, number>> {
    // Este export es un endpoint HTTP con un action-id que viaja en el bundle, y
    // los UUID de turno también viajan al browser en la agenda. Sin permiso ni
    // scope de organización, cualquiera con un UUID ajeno podría averiguar
    // cuánta plata dejó señada un cliente de otra barbería. Es la misma razón
    // por la que las 11 RPC de turnos perdieron el EXECUTE de `anon` (mig 168).
    if (!(await currentUserCan('appointments.view'))) return {}
    const orgId = await getCurrentOrgId()
    if (!orgId) return {}

    const ids = [...new Set((appointmentIds ?? []).filter(isValidUUID))].slice(0, 500)
    if (!ids.length) return {}

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('booking_deposits')
        .select('appointment_id, amount')
        .eq('organization_id', orgId)
        .in('appointment_id', ids)
        .in('status', ['pagada', 'consumida'])

    if (error) {
        console.error('[senasDeTurnos]', error.message)
        return {}
    }

    const mapa: Record<string, number> = {}
    for (const f of (data ?? []) as Array<{ appointment_id: string | null; amount: number }>) {
        if (f.appointment_id) mapa[f.appointment_id] = Number(f.amount)
    }
    return mapa
}
