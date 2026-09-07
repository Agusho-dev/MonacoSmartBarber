/**
 * /api/cron/mp-conciliar — el respaldo del webhook de Mercado Pago.
 *
 * "NO ME AVISARON" NO ES "NO PAGÓ"
 * --------------------------------
 * El webhook es el camino normal y tiene sus propias defensas (reintentos cada
 * 15 minutos hasta el 200, idempotencia por `mp_payment_id`), pero puede fallar
 * de formas que ningún reintento arregla: la `notification_url` quedó apuntando
 * a un dominio viejo, el secreto del webhook se rotó, Vercel devolvió 5xx más
 * veces de las que MP insiste. En todos esos casos hay plata acreditada en la
 * cuenta de la sucursal y un cliente sin turno, y nadie se entera — que es
 * exactamente cómo cinco crons de este repo estuvieron muertos cuatro meses.
 *
 * Por eso esta ruta le pregunta a Mercado Pago por `external_reference` ANTES de
 * dar una seña por perdida. Es la misma lógica que `reconciliarEnDuda` en ARCA:
 * después de un timeout, "no me contestaron" no significa "no pasó".
 *
 * Hace dos cosas:
 *   1. Señas sin pago anotado cuyo link venció hace entre 5 minutos y 2 horas
 *      —`iniciada` o ya `expirada` por el cron SQL, que corre cada 2 minutos y
 *      llega siempre primero— → buscar el pago en MP y, si hay uno aprobado,
 *      pasarlo por `acreditarPago`: sobre una `iniciada` crea el turno como lo
 *      habría creado el webhook, y sobre una `expirada` devuelve la plata y la
 *      deja anotada (esas caen en el contador `acreditadas`, que en rigor
 *      cuenta "resueltas contra Mercado Pago").
 *   2. Proveedores OAuth a menos de 30 días del vencimiento del token → renovar.
 *
 * SIN `CRON_SECRET`: es la convención de este repo (los crons los dispara
 * pg_cron pegándole a `/api/cron/*`). Lo que la protege es ser IDEMPOTENTE —
 * `acreditarPago` está blindado por el UPDATE condicional y el índice único de
 * `mp_payment_id`, y renovar un token dos veces sólo consume un refresh de más—
 * y no devolver nada: la respuesta son contadores pelados, sin ids, sin nombres
 * de sucursal y sin organizaciones. Con auth ausente, cualquier dato en el
 * cuerpo sería un mapa de los tenants publicado a quien pase.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { buscarPagoPorReferencia } from '@/lib/mercadopago/checkout'
import { resolverProveedor, appMercadoPago } from '@/lib/mercadopago/credenciales'
import {
    acreditarPago,
    devolverSena,
    expirarSenasVencidas,
    horasHastaElTurno,
    resolverSenaDeTurnoCancelado,
} from '@/lib/senas/motor'
import { resumirErrorMp } from '@/lib/mercadopago/errores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cuánto se espera después del vencimiento antes de ir a preguntar.
 *
 * El webhook normal llega en segundos. Cinco minutos es el margen para que una
 * notificación demorada gane la carrera: si el cron acreditara antes, el trabajo
 * sería el mismo (es idempotente) pero se gastaría una llamada a MP por cada
 * seña que estaba por resolverse sola.
 */
const GRACIA_MS = 5 * 60 * 1000

/**
 * Hasta cuándo se sigue preguntando por una intención que ya se cerró.
 *
 * NO ALCANZA CON MIRAR `iniciada`. El cron SQL `expire-booking-deposits` corre
 * cada 2 minutos y cierra toda seña vencida hace más de 2, así que para cuando
 * pasan los 5 minutos de gracia ya NO QUEDA NINGUNA en ese estado: la versión
 * anterior de esta ruta buscaba sólo `iniciada` y por lo tanto no rescataba
 * absolutamente nada. Un webhook perdido terminaba en plata cobrada, sin turno,
 * sin devolución y con la pantalla del cliente diciéndole "no se cobró nada".
 * Por eso se revisan también las que quedaron `expirada`/`cancelada` con un
 * link que llegó a existir y ningún pago anotado.
 */
const VENTANA_RESCATE_MS = 6 * 60 * 60 * 1000

/** Cada cuánto se le vuelve a preguntar a MP por la MISMA fila (vía `updated_at`). */
const RECHEQUEO_MS = 15 * 60 * 1000

/** Hasta cuándo se reintenta crear el turno de una seña ya cobrada. */
const VENTANA_TURNO_MS = 48 * 60 * 60 * 1000

/** Tope por corrida. El cron vuelve en cinco minutos; no hay que vaciar la cola de una. */
const MAX_SENAS = 40
const MAX_PROVEEDORES = 20
const MAX_CAIDAS = 40

/** Cuánto antes de vencer se renueva un token de OAuth. Igual margen que la renovación perezosa. */
const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000

interface Contadores {
    revisadas: number
    acreditadas: number
    sin_pago: number
    fallidas: number
    vencidas: number
    turnos_reintentados: number
    senas_resueltas: number
    tokens_renovados: number
    tokens_fallidos: number
}

interface FilaPendiente {
    id: string
    branch_id: string
    environment: string
    status: string
    mp_payment_id: string | null
    expires_at: string
}

/**
 * Las señas que tienen —o pueden tener— plata en el aire.
 *
 * Van tres consultas chicas y no un `.or()` con `and()` anidados: cada caso
 * filtra por columnas distintas y una sola expresión sería ilegible, además de
 * dejar al planner sin poder usar los índices parciales por estado.
 */
async function senasEnElAire(): Promise<FilaPendiente[]> {
    const supabase = createAdminClient()
    const ahora = Date.now()
    const corte = new Date(ahora - GRACIA_MS).toISOString()
    const desde = new Date(ahora - VENTANA_RESCATE_MS).toISOString()
    const rechequeo = new Date(ahora - RECHEQUEO_MS).toISOString()
    const COLUMNAS = 'id, branch_id, environment, status, mp_payment_id, expires_at'

    // 1. La intención que sigue abierta y ya venció (sólo aparece si el cron SQL
    //    está caído; se deja porque es justamente cuando más falta hace).
    const abiertas = await supabase
        .from('booking_deposits')
        .select(COLUMNAS)
        .eq('status', 'iniciada')
        .lt('expires_at', corte)
        .order('expires_at', { ascending: true })
        .limit(MAX_SENAS)
        .returns<FilaPendiente[]>()

    if (abiertas.error) {
        // Se propaga: un cron que no puede leer y contesta "0 pendientes" es
        // indistinguible de uno que anda bien (Known Risk #13).
        throw new Error(`No pudimos leer las señas pendientes: ${abiertas.error.message}`)
    }

    // 2. La que el cron SQL ya cerró sin saber si se pagó. `updated_at` hace de
    //    freno: cada fila se le pregunta a MP una vez cada RECHEQUEO_MS, porque
    //    el "no pagó" se anota en la fila y eso mueve el `updated_at`.
    const cerradas = await supabase
        .from('booking_deposits')
        .select(COLUMNAS)
        .in('status', ['expirada', 'cancelada'])
        .is('mp_payment_id', null)
        .not('init_point', 'is', null)
        .gt('expires_at', desde)
        .lt('updated_at', rechequeo)
        .order('expires_at', { ascending: false })
        .limit(MAX_SENAS)
        .returns<FilaPendiente[]>()

    if (cerradas.error) {
        throw new Error(`No pudimos leer las señas cerradas: ${cerradas.error.message}`)
    }

    // 3. La que SÍ se cobró y se quedó sin turno (el turno falló por algo
    //    transitorio: rate-limit por teléfono, red, un hipo de la base). Se
    //    excluyen las que tienen `refund_reason`: ésas son los créditos a favor
    //    de una cancelación a tiempo, que están sin turno a propósito.
    const sinTurno = await supabase
        .from('booking_deposits')
        .select(COLUMNAS)
        .eq('status', 'pagada')
        .is('appointment_id', null)
        .is('refund_reason', null)
        .not('mp_payment_id', 'is', null)
        .gte('appointment_date', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .gt('paid_at', new Date(ahora - VENTANA_TURNO_MS).toISOString())
        .lt('updated_at', new Date(ahora - GRACIA_MS).toISOString())
        .order('paid_at', { ascending: true })
        .limit(MAX_SENAS)
        .returns<FilaPendiente[]>()

    if (sinTurno.error) {
        throw new Error(`No pudimos leer las señas sin turno: ${sinTurno.error.message}`)
    }

    const todas = [...(abiertas.data ?? []), ...(cerradas.data ?? []), ...(sinTurno.data ?? [])]
    return todas.slice(0, MAX_SENAS)
}

/**
 * Paso 1: las señas que quedaron colgadas.
 *
 * Para las que ya tienen `mp_payment_id` no hace falta buscar nada: se llama
 * directo a `acreditarPago`, que sabe retomar una seña cobrada a la que le
 * faltó el turno. Para el resto se le pregunta a Mercado Pago por
 * `external_reference` ANTES de darlas por perdidas.
 */
async function conciliarSenas(c: Contadores): Promise<void> {
    const filas = await senasEnElAire()

    // Una sucursal puede tener varias señas colgadas: se resuelve el proveedor
    // una sola vez por sucursal (descifra el token y puede renovarlo).
    const proveedores = new Map<string, Awaited<ReturnType<typeof resolverProveedor>>>()

    for (const fila of filas) {
        c.revisadas++
        const clave = `${fila.branch_id}:${fila.environment}`
        try {
            if (!proveedores.has(clave)) {
                proveedores.set(
                    clave,
                    await resolverProveedor(fila.branch_id, fila.environment === 'prueba' ? 'prueba' : 'produccion'),
                )
            }
            const proveedor = proveedores.get(clave) ?? null
            if (!proveedor) {
                // La sucursal se desconectó con señas abiertas. No se puede
                // preguntar nada; el cron SQL la va a vencer.
                c.sin_pago++
                continue
            }

            let paymentId = fila.mp_payment_id
            if (!paymentId) {
                const pago = await buscarPagoPorReferencia(proveedor.accessToken, fila.id)
                if (!pago || pago.status !== 'approved') {
                    c.sin_pago++
                    // Se anota que ya preguntamos. No es cosmético: mueve el
                    // `updated_at` y es lo que impide volver a preguntarle a
                    // Mercado Pago por la misma fila cada cinco minutos durante
                    // seis horas.
                    await marcarRevisada(fila.id, pago ? `Pago ${pago.status} en Mercado Pago` : null)
                    continue
                }
                paymentId = String(pago.id)
            } else {
                c.turnos_reintentados++
            }

            const resultado = await acreditarPago(paymentId, proveedor)
            if (resultado.resultado === 'confirmado' || resultado.resultado === 'ya_procesado') {
                c.acreditadas++
            } else {
                // `sin_cupo`, `rechazado` o `ignorado`: el trabajo se hizo y la
                // fila quedó con su motivo.
                c.fallidas++
            }
        } catch (e) {
            // Una seña que falla no puede frenar a las demás: cada una es de un
            // cliente distinto. El motivo queda en el log del servidor.
            c.fallidas++
            console.error(`[mp-conciliar] seña ${fila.id}:`, resumirErrorMp(e))
        }
    }
}

/** Deja constancia de que ya le preguntamos a MP por esta fila. Nunca tira. */
async function marcarRevisada(depositId: string, detalle: string | null): Promise<void> {
    try {
        const supabase = createAdminClient()
        const sello = `Sin pago en Mercado Pago (revisado ${new Date().toISOString()})`
        const { error } = await supabase
            .from('booking_deposits')
            .update({ failure_reason: detalle ? `${sello} · ${detalle}` : sello })
            .eq('id', depositId)
            .in('status', ['expirada', 'cancelada'])
        if (error) console.error('[mp-conciliar] no pudimos marcar la revisión:', error.message)
    } catch (e) {
        console.error('[mp-conciliar] no pudimos marcar la revisión:', e)
    }
}

/** `YYYY-MM-DD` de hace N días, para acotar los reintentos. */
function fechaHaceDias(dias: number): string {
    return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

interface FilaCaida {
    id: string
    appointment_id: string
    appointment: { status: string; cancelled_by: string | null } | { status: string; cancelled_by: string | null }[] | null
}

/**
 * Paso 2: las señas de turnos que se cayeron y nadie resolvió.
 *
 * `mark_no_show_overdue()` es un cron de SQL PURO que marca los ausentes cada 5
 * minutos, y como corre antes que cualquier persona, es el que marca CASI TODOS
 * los no-show reales: `markNoShow` y `markAppointmentNoShow` —los dos únicos
 * lugares que resolvían la seña— rechazan el turno una vez que ya está en
 * `no_show`. Sin este paso, la seña de un ausente se queda `pagada` colgada de
 * un turno muerto para siempre: ni se pierde, ni se devuelve, ni se consume, y
 * como tiene `appointment_id` tampoco aparece en la alarma de "señas sin turno".
 *
 * La política (devolver, dejar a favor o perder) NO se decide acá: la resuelve
 * `resolverSenaDeTurnoCancelado`, que es la misma que usan la agenda y el panel
 * del barbero. Un segundo lugar donde decidir qué pasa con la plata sería un
 * segundo lugar donde equivocarse.
 */
async function resolverSenasDeTurnosCaidos(c: Contadores): Promise<void> {
    const supabase = createAdminClient()

    const { data, error } = await supabase
        .from('booking_deposits')
        .select('id, appointment_id, appointment:appointment_id!inner(status, cancelled_by)')
        .eq('status', 'pagada')
        .not('appointment_id', 'is', null)
        .in('appointment.status', ['no_show', 'cancelled'])
        // Cota temporal: una devolución que falla (típicamente porque la cuenta
        // de la sucursal no tiene saldo) vuelve a intentarse en la próxima
        // corrida, y sin este filtro una fila irrecuperable —Mercado Pago no
        // admite devoluciones después de 180 días— quedaría reintentándose cada
        // cinco minutos para siempre.
        .gte('appointment_date', fechaHaceDias(60))
        .limit(MAX_CAIDAS)
        .returns<FilaCaida[]>()

    if (error) {
        throw new Error(`No pudimos leer las señas de turnos caídos: ${error.message}`)
    }

    for (const fila of data ?? []) {
        const rel = Array.isArray(fila.appointment) ? fila.appointment[0] : fila.appointment
        if (!rel) continue
        try {
            const esAusente = rel.status === 'no_show'
            // El ausente va como cancelación del CLIENTE con cero horas —que es
            // literalmente lo que pasó— igual que `markNoShow`. Para el turno
            // cancelado manda `cancelled_by`, que es quien lo dio de baja.
            const canceladoPor = esAusente
                ? 'client'
                : ((rel.cancelled_by === 'staff' || rel.cancelled_by === 'system' || rel.cancelled_by === 'client')
                    ? rel.cancelled_by
                    : 'staff')
            const horas = esAusente ? 0 : await horasHastaElTurno(fila.appointment_id)

            const r = await resolverSenaDeTurnoCancelado(fila.appointment_id, {
                canceladoPor,
                horasDeAnticipacion: horas,
            })
            if (r.accion !== 'nada' && r.accion !== 'sin_sena') c.senas_resueltas++
            else if (r.error) c.fallidas++
        } catch (e) {
            c.fallidas++
            console.error(`[mp-conciliar] seña del turno ${fila.appointment_id}:`, resumirErrorMp(e))
        }
    }
}

interface FilaSinDevolver {
    id: string
    status: string
}

/**
 * Paso 3: las devoluciones automáticas que Mercado Pago no aceptó.
 *
 * Cuando dos clientes pagan el mismo horario, al segundo se le devuelve la
 * plata sola y se le muestra —en la app, en el turnero y en `/pago/[id]`— "te
 * devolvimos la seña". Si esa devolución falla (la causa más común es que la
 * cuenta de la sucursal todavía no tiene saldo liberado), la fila quedaba
 * `sin_cupo` con `refunded_at` en NULL, sin ningún reintento en ningún lado y
 * con el cliente convencido de que su plata volvió. Acá se reintenta hasta que
 * salga.
 */
async function reintentarDevoluciones(c: Contadores): Promise<void> {
    const supabase = createAdminClient()

    const { data, error } = await supabase
        .from('booking_deposits')
        .select('id, status')
        .eq('status', 'sin_cupo')
        .is('refunded_at', null)
        .not('mp_payment_id', 'is', null)
        .gt('paid_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())
        .limit(MAX_CAIDAS)
        .returns<FilaSinDevolver[]>()

    if (error) {
        throw new Error(`No pudimos leer las devoluciones pendientes: ${error.message}`)
    }

    for (const fila of data ?? []) {
        try {
            const r = await devolverSena(fila.id, {
                motivo: 'Reintento de la devolución automática por falta de cupo',
                estadosPermitidos: ['sin_cupo'],
            })
            if (r.ok) c.senas_resueltas++
            else c.fallidas++
        } catch (e) {
            c.fallidas++
            console.error(`[mp-conciliar] devolución ${fila.id}:`, resumirErrorMp(e))
        }
    }
}

interface FilaProveedorVencible {
    branch_id: string
    environment: string
}

/**
 * Paso 2: los tokens que están por vencer.
 *
 * La renovación de verdad vive en `resolverProveedor` (perezosa: cualquier
 * cobro la dispara). Este paso existe para la sucursal que pasa medio año sin
 * cobrar online — 180 días de token contra una temporada floja es una carrera
 * que se puede perder, y perderla significa reconectar la cuenta a mano.
 *
 * No se llama a ninguna función de renovación: se llama a `resolverProveedor`,
 * que ES la única implementación. Un segundo camino de renovación sería un
 * segundo lugar donde olvidarse de persistir el refresh_token rotativo.
 */
async function renovarTokens(c: Contadores): Promise<void> {
    if (!appMercadoPago()) return   // sin credenciales de la app no hay nada que renovar

    const supabase = createAdminClient()
    const limite = new Date(Date.now() + MARGEN_RENOVACION_MS).toISOString()

    const { data, error } = await supabase
        .from('branch_payment_providers')
        .select('branch_id, environment')
        .eq('provider', 'mercadopago')
        .eq('connection_mode', 'oauth')
        .in('status', ['conectado', 'error'])
        .not('token_expires_at', 'is', null)
        .lt('token_expires_at', limite)
        .limit(MAX_PROVEEDORES)
        .returns<FilaProveedorVencible[]>()

    if (error) {
        throw new Error(`No pudimos leer las cuentas de Mercado Pago: ${error.message}`)
    }

    for (const fila of data ?? []) {
        try {
            const p = await resolverProveedor(
                fila.branch_id,
                fila.environment === 'prueba' ? 'prueba' : 'produccion',
            )
            if (p) c.tokens_renovados++
            else c.tokens_fallidos++
        } catch (e) {
            c.tokens_fallidos++
            console.error('[mp-conciliar] renovación:', resumirErrorMp(e))
        }
    }
}

async function correr(): Promise<NextResponse> {
    const c: Contadores = {
        revisadas: 0,
        acreditadas: 0,
        sin_pago: 0,
        fallidas: 0,
        vencidas: 0,
        turnos_reintentados: 0,
        senas_resueltas: 0,
        tokens_renovados: 0,
        tokens_fallidos: 0,
    }

    try {
        await conciliarSenas(c)
        await resolverSenasDeTurnosCaidos(c)
        await reintentarDevoluciones(c)
        await renovarTokens(c)
        // Al final, y no al principio: primero se rescata lo que se pueda
        // rescatar y recién después se cierra lo que de verdad no se pagó.
        c.vencidas = await expirarSenasVencidas()
    } catch (e) {
        console.error('[mp-conciliar]', e)
        // El detalle NO viaja al cuerpo: esta ruta no tiene auth.
        return NextResponse.json({ ok: false, ...c }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ...c })
}

export const GET = correr
export const POST = correr

// ─────────────────────────────────────────────────────────────────────────────
// Programación (YA APLICADA — migración 208, cada 5 minutos)
// ─────────────────────────────────────────────────────────────────────────────
//
// Queda transcripto acá porque es el objeto que hay que reponer si alguien
// borra el job, y porque el SQL vivo no está en ningún otro archivo del repo.
//
// El cron lo dispara pg_cron, no `vercel.json` (el plan Hobby sólo admite dos
// entradas con schedule diario). La URL sale de Vault y NO se escribe a mano:
// el día que cambie el dominio se toca UN secreto. Escribirla acá es cómo
// `process_appointments` quedó apuntando cuatro meses a un alias muerto.
//
//   create or replace function public.trigger_mp_conciliar()
//   returns void
//   language plpgsql
//   security definer
//   set search_path = public, pg_temp
//   as $$
//   declare
//       v_url text;
//   begin
//       select decrypted_secret into v_url
//         from vault.decrypted_secrets
//        where name = 'app_base_url';
//       if v_url is null then
//           raise warning 'trigger_mp_conciliar: falta el secreto app_base_url';
//           return;
//       end if;
//       perform net.http_post(
//           url     := v_url || '/api/cron/mp-conciliar',
//           headers := '{"Content-Type": "application/json"}'::jsonb,
//           body    := '{}'::jsonb
//       );
//   end $$;
//
//   revoke all on function public.trigger_mp_conciliar() from public, anon, authenticated;
//
//   select cron.schedule('mp-conciliar', '*/5 * * * *', $$select public.trigger_mp_conciliar()$$);
//
// Verificación (pg_cron miente: `cron.job_run_details` dice "succeeded" aunque
// el servidor haya contestado 404, porque pg_net es asincrónico):
//
//   select status_code, count(*) from net._http_response
//    where created > now() - interval '1 hour' group by 1;
