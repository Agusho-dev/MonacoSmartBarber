// =============================================================================
// src/lib/arca/motor.ts
// El motor de emisión: todo lo que habla con ARCA y escribe comprobantes.
//
// Módulo PLANO (sin 'use server') a propósito. Los helpers de acá no son
// endpoints y algunos reciben banderas de confianza (`desdeCron`) que jamás
// pueden venir del cliente. `src/lib/actions/arca-emision.ts` es la capa fina
// de server actions que envuelve esto agregando permisos y aislamiento de
// organización.
//
// La secuencia de una emisión, y por qué está en este orden:
//   1. FECompUltimoAutorizado  → cuál es el próximo número según ARCA
//   2. arca_reserve_invoice    → se RESERVA la fila con ese número, bajo lock
//   3. FECAESolicitar          → recién ahora se pide el CAE
//   4. update de la fila       → CAE, o rechazo, o "en duda"
// =============================================================================

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'

import { LETRA_CBTE, NOMBRE_CBTE } from '@/lib/arca/config'
import {
    feCaeSolicitar,
    feCompConsultar,
    feCompUltimoAutorizado,
    ErrorWsfe,
    type ContextoWsfe,
} from '@/lib/arca/wsfe'
import {
    armarComprobante,
    fechaDentroDeVentana,
    fechaLocalDeSucursal,
    sumasCierran,
} from '@/lib/arca/comprobante'
import { urlQrArca, numeroFormateado, aFechaConGuiones } from '@/lib/arca/qr'
import {
    errorCortaElLote,
    errorPuntoVentaContingencia,
    traducirErrorArca,
    type ErrorTraducido,
} from '@/lib/arca/errores'
import {
    planificarFacturacion,
    type CandidatoVenta,
    type EstadoCupo,
    type PlanFacturacion,
    type PoliticaCupo,
} from '@/lib/arca/cupo'
import {
    ambienteDeOrg,
    cargarContribuyente,
    contextoWsfe,
    puntoVentaDe,
    type FilaContribuyente,
} from '@/lib/arca/contexto'

// -----------------------------------------------------------------------------
// Tipos de vista
// -----------------------------------------------------------------------------

export interface ComprobanteEmitido {
    invoiceId: string
    numero: string
    cae: string
    caeVto: string | null
    total: number
    tipo: number
    nombreTipo: string
    letra: string
    qrUrl: string
    observaciones: { code: number; msg: string }[]
}

export interface ResultadoLote {
    emitidos: ComprobanteEmitido[]
    /**
     * `traducido` viaja con cada falla A PROPÓSITO. Sin él, la pantalla sólo
     * podía decir "2 fallaron, revisá el detalle en Comprobantes" y el motivo
     * real —"el punto de venta es de contingencia, hay que dar de alta otro en
     * ARCA"— quedaba enterrado en `arca_invoices.last_error`. Un error que el
     * dueño no puede leer donde lo produjo es un error que nadie arregla.
     */
    fallidos: { visitId: string; motivo: string; codigo: string | null; traducido?: ErrorTraducido }[]
    total: number
    /** Cuántas quedaron sin emitir por el tope de la corrida. 0 = se hizo todo. */
    restantes?: number
    /**
     * true si el lote se abandonó porque el error no era de esa venta sino de la
     * configuración o del servicio, y repetirlo 34 veces habría dado 34 errores
     * idénticos. Lo usa la UI para no decir "faltan N" como si fuera cuestión de
     * volver a apretar el botón.
     */
    cortado?: boolean
}

/**
 * Cuántos comprobantes se emiten como máximo en UNA corrida.
 *
 * Cada emisión son dos viajes SOAP a ARCA (último autorizado + pedido de CAE)
 * más la reserva en la base: entre 2 y 3 segundos, y los servidores de ARCA no
 * son rápidos. Medido con un objetivo de $1.500.000 para un barbero, el plan
 * daba 89 comprobantes → unos 250 segundos, contra un `maxDuration` de 300.
 * Demasiado al filo: si se corta a la mitad, la mitad de los comprobantes
 * quedan en estado dudoso y hay que reconciliarlos uno por uno.
 *
 * Con tope, la corrida termina siempre bien y lo que falta se emite en la
 * siguiente (el cron corre cada hora, y el botón se puede volver a apretar).
 * Cortar a tiempo es preferible a terminar en un estado que hay que auditar.
 */
const MAX_POR_CORRIDA = 35

export interface VistaPreviaCupo {
    plan: PlanFacturacion
    cupo: EstadoCupo | null
    politica: PoliticaVistaMinima | null
    error: string | null
}

export interface PoliticaVistaMinima {
    id: string
    branchId: string | null
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    estrategia: PoliticaCupo['estrategia']
    objetivoCantidad: number | null
    objetivoMonto: number | null
    permitirExceso: boolean
    emisionAutomatica: boolean
}

// -----------------------------------------------------------------------------
// Candidatos y simulación
// -----------------------------------------------------------------------------

export type FilaPolitica = {
    id: string
    organization_id: string
    /** Dueño del cupo. En el modelo por barbero, siempre viene. */
    taxpayer_id: string | null
    branch_id: string | null
    is_enabled: boolean
    mode: 'manual' | 'cantidad' | 'monto'
    period: 'dia' | 'semana' | 'mes'
    target_count: number | null
    target_amount: string | number | null
    selection: PoliticaCupo['estrategia']
    payment_methods: string[]
    min_ticket: string | number | null
    max_ticket: string | number | null
    include_tips: boolean
    allow_overflow: boolean
    lookback_days: number
    auto_emit: boolean
    auto_emit_hour: number
    /** De dónde salen las ventas: propios | sucursal | organizacion. */
    origen: 'propios' | 'sucursal' | 'organizacion'
    prioridad: number
}

export async function leerCupo(policyId: string): Promise<EstadoCupo | null> {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('arca_quota_state', { p_policy_id: policyId })
    if (error) {
        console.error('[leerCupo]', error.message)
        return null
    }
    const f = Array.isArray(data) ? data[0] : data
    if (!f) return null
    return {
        periodoDesde: f.period_start,
        periodoHasta: f.period_end,
        emitidos: Number(f.emitted_count ?? 0),
        montoEmitido: Number(f.emitted_amount ?? 0),
        objetivoCantidad: f.target_count,
        objetivoMonto: f.target_amount !== null ? Number(f.target_amount) : null,
        restanteCantidad: Number(f.remaining_count ?? 0),
        restanteMonto: Number(f.remaining_amount ?? 0),
    }
}

export async function leerCandidatos(
    orgId: string,
    pol: FilaPolitica,
    limite = 300,
    ambiente: 'homologacion' | 'produccion' = 'produccion',
    staffId: string | null = null,
    branchIds: string[] | null = null,
): Promise<CandidatoVenta[] | { error: string }> {
    const supabase = createAdminClient()
    const desde = new Date(Date.now() - pol.lookback_days * 86_400_000).toISOString()
    const hasta = new Date().toISOString()

    const { data, error } = await supabase.rpc('arca_billing_candidates', {
        p_organization_id: orgId,
        p_branch_ids: branchIds ?? (pol.branch_id ? [pol.branch_id] : null),
        p_from: desde,
        p_to: hasta,
        p_payment_methods: pol.payment_methods ?? ['cash', 'card', 'transfer'],
        p_min_ticket: pol.min_ticket !== null ? Number(pol.min_ticket) : null,
        p_max_ticket: pol.max_ticket !== null ? Number(pol.max_ticket) : null,
        p_include_tips: pol.include_tips,
        p_selection: pol.selection,
        // Semilla estable por política y período: el orden "al azar" no puede
        // cambiar cada vez que se abre la pantalla, o la vista previa mentiría.
        p_seed: `${pol.id}:${new Date().toISOString().slice(0, 7)}`,
        p_limit: limite,
        p_environment: ambiente,
        p_staff_id: staffId,
    })

    if (error) {
        console.error('[leerCandidatos]', error.message)
        return { error: 'No pudimos leer las ventas facturables.' }
    }

    return ((data ?? []) as any[]).map((c) => ({
        visitId: c.visit_id,
        branchId: c.branch_id,
        branchName: c.branch_name,
        completedAt: c.completed_at,
        baseAmount: Number(c.base_amount ?? 0),
        amount: Number(c.amount ?? 0),
        tipAmount: Number(c.tip_amount ?? 0),
        paymentMethod: c.payment_method,
        clientId: c.client_id,
        clientName: c.client_name,
        clientPhone: c.client_phone,
        barberName: c.barber_name,
        serviceName: c.service_name,
    }))
}

export function aPoliticaCupo(p: FilaPolitica): PoliticaCupo {
    return {
        id: p.id,
        modo: p.mode,
        periodo: p.period,
        estrategia: p.selection,
        permitirExceso: p.allow_overflow,
        objetivoCantidad: p.target_count,
        objetivoMonto: p.target_amount !== null ? Number(p.target_amount) : null,
    }
}

// -----------------------------------------------------------------------------
// Emisión — el corazón
// -----------------------------------------------------------------------------

interface DatosEmision {
    orgId: string
    branchId: string | null
    visitId: string | null
    clientId: string | null
    clienteNombre: string | null
    totalPesos: number
    /** Fecha en que se prestó el servicio (`yyyy-mm-dd` de pared de la sucursal). */
    fechaServicio: string | null
    tz: string
    policyId: string | null
    via: 'manual' | 'automatico' | 'prueba'
    staffId: string | null
}

type ResultadoEmision =
    | { ok: true; data: ComprobanteEmitido }
    | { error: string; codigo: string | null; traducido?: ErrorTraducido }

/**
 * Emite un comprobante. Todo el riesgo del módulo está acá adentro.
 */
export async function emitirUno(
    t: FilaContribuyente,
    ctx: ContextoWsfe,
    d: DatosEmision,
): Promise<ResultadoEmision> {
    const supabase = createAdminClient()

    // El punto de venta es del CUIT. Si el que tiene no sirve para pedir CAE,
    // ARCA va a rechazar el comprobante con 10005 SIEMPRE: mejor no gastar el
    // viaje y devolver el motivo real, con las instrucciones de ARCA adentro.
    const resPv = await puntoVentaDe(t.id, d.branchId)
    if (!resPv.ok) {
        if (resPv.motivo === 'contingencia') {
            const traducido = errorPuntoVentaContingencia(
                resPv.puntos.map((p) => p.numero),
                resPv.puntos[0]?.emisionTipo,
            )
            return { error: traducido.titulo, codigo: 'punto_venta_contingencia', traducido }
        }
        return {
            error:
                `${t.razon_social ?? 'Este CUIT'} no tiene punto de venta cargado. ` +
                'Probá la conexión con ARCA en la configuración del facturador para traerlos.',
            codigo: 'sin_punto_venta',
        }
    }
    const pv = resPv.pv

    const centavos = Math.round(d.totalPesos * 100)
    if (centavos <= 0) return { error: 'El importe tiene que ser mayor a cero.', codigo: 'importe_invalido' }

    const hoyLocal = fechaLocalDeSucursal(d.tz)

    let armado: ReturnType<typeof armarComprobante>
    try {
        armado = armarComprobante({
            totalCentavos: centavos,
            condicionEmisor: t.condicion_iva,
            fechaLocal: hoyLocal,
            fechaServicioLocal: d.fechaServicio ?? hoyLocal,
        })
    } catch (e) {
        return { error: e instanceof Error ? e.message : 'No se pudo armar el comprobante.', codigo: 'armado' }
    }

    // Chequeos locales: convierten un rechazo remoto y opaco en un error claro.
    if (!sumasCierran(armado.detalle)) {
        console.error('[emitirUno] sumas no cierran', armado.detalle)
        return { error: 'Los importes del comprobante no cierran. No se emitió nada.', codigo: 'sumas' }
    }
    const ventana = fechaDentroDeVentana(hoyLocal, hoyLocal, armado.detalle.concepto)
    if (!ventana.ok) {
        return { error: 'La fecha del comprobante quedó fuera de la ventana que acepta ARCA.', codigo: 'fecha' }
    }

    // Hasta dos vueltas: si ARCA rechaza con 10016 (numeración desincronizada)
    // se vuelve a leer el último autorizado y se reintenta UNA vez. Más que eso
    // sería insistir contra un problema que no se arregla solo.
    let ultimoError: ResultadoEmision | null = null

    for (let vuelta = 0; vuelta < 2; vuelta++) {
        let ultimoAutorizado: number
        try {
            ultimoAutorizado = await feCompUltimoAutorizado(ctx, pv.numero, armado.cbteTipo)
        } catch (e) {
            const err = e instanceof ErrorWsfe ? e : null
            const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))
            return { error: traducido.titulo, codigo: String(err?.codigo ?? 'ultimo_autorizado'), traducido }
        }

        // --- Reserva atómica del número ---
        const { data: reserva, error: errReserva } = await supabase.rpc('arca_reserve_invoice', {
            p_taxpayer_id: t.id,
            p_organization_id: d.orgId,
            p_branch_id: d.branchId,
            p_sales_point_id: pv.id,
            p_pto_vta: pv.numero,
            p_cbte_tipo: armado.cbteTipo,
            p_arca_last: ultimoAutorizado,
            p_concepto: armado.detalle.concepto,
            p_doc_tipo: armado.detalle.docTipo,
            p_doc_nro: armado.detalle.docNro,
            p_condicion_iva_receptor_id: armado.detalle.condicionIVAReceptorId,
            p_fecha_cbte: hoyLocal,
            p_imp_total: armado.detalle.impTotal,
            p_imp_neto: armado.detalle.impNeto,
            p_imp_iva: armado.detalle.impIVA,
            p_iva_items: armado.detalle.iva ?? null,
            p_visit_id: d.visitId,
            p_client_id: d.clientId,
            p_policy_id: d.policyId,
            p_emitted_via: d.via,
            p_emitted_by_staff_id: d.staffId,
            p_fch_serv_desde: armado.detalle.fchServDesde
                ? aFechaConGuiones(armado.detalle.fchServDesde)
                : null,
            p_fch_serv_hasta: armado.detalle.fchServHasta
                ? aFechaConGuiones(armado.detalle.fchServHasta)
                : null,
            p_fch_vto_pago: armado.detalle.fchVtoPago ? aFechaConGuiones(armado.detalle.fchVtoPago) : null,
            p_receptor_nombre: d.clienteNombre,
            p_parent_invoice_id: null,
            p_cbtes_asoc: null,
        })

        if (errReserva) {
            // 23505 sobre el índice de visita = ya se facturó. No es una falla:
            // es la red de seguridad haciendo su trabajo.
            if (errReserva.code === '23505' && /una_por_visita/.test(errReserva.message ?? '')) {
                return { error: 'Esa venta ya tiene comprobante.', codigo: 'ya_facturada' }
            }
            console.error('[emitirUno] reserva', errReserva.message)
            return { error: 'No pudimos reservar el número de comprobante.', codigo: 'reserva' }
        }

        const fila = Array.isArray(reserva) ? reserva[0] : reserva
        const invoiceId: string = fila.invoice_id
        const numero: number = Number(fila.numero)

        // --- Pedido del CAE ---
        try {
            const res = await feCaeSolicitar(ctx, pv.numero, armado.cbteTipo, {
                ...armado.detalle,
                cbteDesde: numero,
                cbteHasta: numero,
            })

            if (res.resultado === 'A' || res.resultado === 'P') {
                if (!res.cae) {
                    await marcar(invoiceId, 'en_duda', { last_error: 'ARCA aprobó sin devolver CAE.' })
                    return { error: 'ARCA aprobó el comprobante pero no devolvió el CAE.', codigo: 'sin_cae' }
                }

                const qrUrl = urlQrArca({
                    fecha: hoyLocal,
                    cuit: t.cuit,
                    ptoVta: pv.numero,
                    tipoCmp: armado.cbteTipo,
                    nroCmp: numero,
                    importe: armado.detalle.impTotal,
                    tipoDocRec: armado.detalle.docTipo,
                    nroDocRec: armado.detalle.docNro,
                    codAut: res.cae,
                })

                const { error: errUpdate } = await supabase
                    .from('arca_invoices')
                    .update({
                        status: 'emitida',
                        cae: res.cae,
                        cae_vto: res.caeVto ? aFechaConGuiones(res.caeVto) : null,
                        resultado: res.resultado,
                        observaciones: res.observaciones.length ? res.observaciones : null,
                        response_payload: res.crudo as any,
                        emitted_at: new Date().toISOString(),
                        attempt_count: vuelta + 1,
                        last_error: null,
                    })
                    .eq('id', invoiceId)
                if (errUpdate) {
                    // El CAE existe en ARCA. Que falle el guardado local es grave
                    // y hay que gritarlo, pero el comprobante ES válido.
                    console.error('[emitirUno] no se pudo guardar el CAE', invoiceId, errUpdate.message)
                }

                return {
                    ok: true,
                    data: {
                        invoiceId,
                        numero: numeroFormateado(pv.numero, numero),
                        cae: res.cae,
                        caeVto: res.caeVto ? aFechaConGuiones(res.caeVto) : null,
                        total: armado.detalle.impTotal,
                        tipo: armado.cbteTipo,
                        nombreTipo: NOMBRE_CBTE[armado.cbteTipo] ?? 'Comprobante',
                        letra: LETRA_CBTE[armado.cbteTipo] ?? 'C',
                        qrUrl,
                        observaciones: res.observaciones,
                    },
                }
            }

            // Rechazado.
            const principal = res.errores[0] ?? res.observaciones[0] ?? null
            const traducido = traducirErrorArca(principal?.code ?? null, principal?.msg ?? null)
            const marcado = await marcar(invoiceId, 'rechazada', {
                resultado: 'R',
                errores: res.errores.length ? res.errores : null,
                observaciones: res.observaciones.length ? res.observaciones : null,
                response_payload: res.crudo as any,
                last_error: principal ? `${principal.code}: ${principal.msg}` : 'Rechazado por ARCA',
                attempt_count: vuelta + 1,
            })
            // Si el rechazo NO se pudo guardar, la fila sigue en `reservado` con
            // un número que ARCA no autorizó, y eso traba la numeración del punto
            // de venta entero. Se corta el lote y se dice, en vez de seguir
            // pidiendo números sobre una base inconsistente.
            if (!marcado) {
                return {
                    error:
                        'ARCA rechazó el comprobante y además no pudimos registrar el rechazo. ' +
                        'No emitas más hasta revisarlo: el número quedó reservado y puede trabar la numeración.',
                    codigo: 'reserva',
                    traducido,
                }
            }

            // 10016 = numeración desincronizada. Vale una segunda vuelta: la
            // fila quedó en 'rechazada', o sea que el número volvió a estar libre.
            if (principal?.code === 10016 && vuelta === 0) {
                ultimoError = { error: traducido.titulo, codigo: '10016', traducido }
                continue
            }

            return { error: traducido.titulo, codigo: String(principal?.code ?? 'rechazado'), traducido }
        } catch (e) {
            const err = e instanceof ErrorWsfe ? e : null
            const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))

            // NO se reintenta: ARCA pudo haber autorizado antes de cortarse.
            // Se marca en duda y se intenta resolver preguntando.
            await marcar(invoiceId, 'en_duda', {
                last_error: err?.message ?? String(e),
                attempt_count: vuelta + 1,
            })

            // `false`: si ARCA todavía no lo reconoce, la fila SE QUEDA en duda.
            // Liberar el número acá es lo que produciría una doble facturación.
            const resuelto = await resolverEnDuda(
                ctx, invoiceId, pv.numero, armado.cbteTipo, numero, t.cuit, hoyLocal, false,
                armado.detalle.impTotal,
            )
            if (resuelto) return resuelto

            return {
                error:
                    `${traducido.titulo}. El comprobante quedó marcado como "en duda": ` +
                    'lo vamos a verificar contra ARCA antes de reintentar.',
                codigo: String(err?.codigo ?? 'timeout'),
                traducido,
            }
        }
    }

    return ultimoError ?? { error: 'No se pudo emitir el comprobante.', codigo: 'desconocido' }
}

/**
 * Cambia el estado de un comprobante.
 *
 * Devuelve si el update entró, y el que llama TIENE que mirarlo cuando el estado
 * nuevo libera el número (`rechazada`, `anulada`). Si esa transición no se
 * guarda, la fila se queda en `reservado` con un número que ARCA nunca autorizó:
 * el sistema va a pedir el N+1 para siempre, ARCA va a esperar el N, y todo el
 * punto de venta queda rechazando con 10016 sin ninguna pantalla desde donde
 * destrabarlo. Antes esto era un `console.error` y nada más — el patrón del
 * Known Risk #13, bugs invisibles de años.
 */
export async function marcar(
    invoiceId: string,
    status: string,
    extra: Record<string, unknown> = {},
): Promise<boolean> {
    const supabase = createAdminClient()
    const { error } = await supabase
        .from('arca_invoices')
        .update({ status, ...extra })
        .eq('id', invoiceId)
    if (error) {
        console.error('[marcar]', invoiceId, status, error.message)
        return false
    }
    return true
}

/**
 * Pregunta a ARCA si el comprobante en duda existe. Si existe, se completa
 * el CAE.
 *
 * `liberarSiNoExiste` es la parte delicada, y por eso NO tiene default:
 *
 * Justo después de un timeout, "ARCA dice que no existe" NO significa que no
 * exista. ARCA pudo estar todavía commiteando la autorización cuando se cortó
 * la conexión, y responder 602 unos segundos después. Si en ese momento se
 * marcara el comprobante como rechazado, el número se liberaría, la venta
 * volvería a la lista de candidatas — y se emitiría un SEGUNDO comprobante por
 * el mismo corte, con los dos vivos en ARCA y el cupo contando uno.
 *
 * Por eso el chequeo inmediato consulta pero NO libera: si ARCA no lo reconoce
 * todavía, la fila se queda en `en_duda` y la resuelve la reconciliación, que
 * corre cuando ya pasó tiempo suficiente.
 */
export async function resolverEnDuda(
    ctx: ContextoWsfe,
    invoiceId: string,
    ptoVta: number,
    cbteTipo: number,
    cbteNro: number,
    cuit: string,
    fechaLocal: string,
    liberarSiNoExiste: boolean,
    /**
     * Importe que la fila local dice tener, en pesos. Si viene y no coincide con
     * el que devuelve ARCA, no se estampa nada.
     *
     * Es la última red contra pegarle a esta fila el CAE de OTRO comprobante:
     * dos CUIT distintos numeran ambos desde 1 y emiten el mismo tipo, así que
     * "punto de venta 2, Factura C, número 7" existe en los dos. Un CAE ajeno
     * pegado acá deja la venta contada como facturada y un QR que el validador
     * de ARCA rechaza — y eso no se descubre hasta que alguien escanea el papel.
     */
    impTotalEsperado?: number | null,
): Promise<ResultadoEmision | null> {
    try {
        const c = await feCompConsultar(ctx, ptoVta, cbteTipo, cbteNro)
        if (!c.existe || !c.cae) {
            if (liberarSiNoExiste) {
                const liberado = await marcar(invoiceId, 'rechazada', {
                    last_error: 'ARCA no registró el comprobante; número liberado.',
                })
                if (!liberado) console.error('[resolverEnDuda] no se pudo liberar', invoiceId)
            }
            return null
        }

        const total = c.impTotal ?? 0

        if (
            impTotalEsperado !== null &&
            impTotalEsperado !== undefined &&
            Math.round(total * 100) !== Math.round(impTotalEsperado * 100)
        ) {
            console.error(
                '[resolverEnDuda] el comprobante de ARCA no es el nuestro',
                invoiceId,
                'ARCA:', total,
                'local:', impTotalEsperado,
            )
            await marcar(invoiceId, 'en_duda', {
                last_error:
                    `ARCA tiene el ${ptoVta}-${cbteNro} por $${total} y el nuestro es por ` +
                    `$${impTotalEsperado}. No lo tocamos: hay que revisarlo a mano.`,
            })
            return null
        }
        const qrUrl = urlQrArca({
            fecha: c.cbteFch ? aFechaConGuiones(c.cbteFch) : fechaLocal,
            cuit,
            ptoVta,
            tipoCmp: cbteTipo,
            nroCmp: cbteNro,
            importe: total,
            codAut: c.cae,
        })

        await marcar(invoiceId, 'emitida', {
            cae: c.cae,
            cae_vto: c.caeVto ? aFechaConGuiones(c.caeVto) : null,
            resultado: c.resultado ?? 'A',
            response_payload: c.crudo as any,
            emitted_at: new Date().toISOString(),
            last_error: null,
        })

        return {
            ok: true,
            data: {
                invoiceId,
                numero: numeroFormateado(ptoVta, cbteNro),
                cae: c.cae,
                caeVto: c.caeVto ? aFechaConGuiones(c.caeVto) : null,
                total,
                tipo: cbteTipo,
                nombreTipo: NOMBRE_CBTE[cbteTipo] ?? 'Comprobante',
                letra: LETRA_CBTE[cbteTipo] ?? 'C',
                qrUrl,
                observaciones: [],
            },
        }
    } catch (e) {
        console.error('[resolverEnDuda]', invoiceId, e)
        return null
    }
}

// -----------------------------------------------------------------------------
// Preparación del contexto de emisión
// -----------------------------------------------------------------------------

/**
 * Contexto de emisión para UN contribuyente puntual.
 *
 * En el modelo por barbero cada CUIT tiene su propio certificado y por lo tanto
 * su propio Ticket de Acceso: no se puede emitir el corte de Lucas con el
 * contexto de Nico. Por eso la preparación se hace por contribuyente y no por
 * organización.
 */
export async function prepararEmisionDe(
    t: FilaContribuyente,
): Promise<{ t: FilaContribuyente; ctx: ContextoWsfe } | { error: string; traducido?: ErrorTraducido }> {
    const ctx = await contextoWsfe(t)
    if ('error' in ctx) return { error: ctx.error, traducido: ctx.traducido }
    return { t, ctx }
}

export async function prepararEmision(orgId: string): Promise<
    { t: FilaContribuyente; ctx: ContextoWsfe } | { error: string; traducido?: ErrorTraducido }
> {
    const t = await cargarContribuyente(orgId)
    if (!t) return { error: 'Todavía no configuraste el facturador.' }
    const ctx = await contextoWsfe(t)
    if ('error' in ctx) return { error: ctx.error, traducido: ctx.traducido }
    return { t, ctx }
}

async function sellarCorrida(supabase: ReturnType<typeof createAdminClient>, policyId: string) {
    const { error } = await supabase
        .from('arca_billing_policies')
        .update({ last_auto_run_at: new Date().toISOString() })
        .eq('id', policyId)
    if (error) console.error('[sellarCorrida]', policyId, error.message)
}

/**
 * Ejecuta el cupo de una política: planifica y emite.
 *
 * VIVE FUERA DE `src/lib/actions/` A PROPÓSITO. Acá `desdeCron` decide si se
 * saltean los chequeos de permiso y de organización, y en un archivo
 * `'use server'` todo export es un endpoint HTTP: un cliente podría mandar
 * `["<policyId>", {"desdeCron": true}]` y emitir comprobantes fiscales reales
 * a nombre de cualquier CUIT. Una bandera de confianza NUNCA puede viajar como
 * argumento de una server action.
 */
export async function correrPolitica(
    policyId: string,
    opciones: {
        desdeCron: boolean
        orgIdEsperado: string | null
        branchIdsPermitidos?: string[] | null
        staffId?: string | null
    },
): Promise<ResultadoLote | { error: string }> {
    const desdeCron = opciones.desdeCron

    const supabase = createAdminClient()
    // El filtro de organización va en la QUERY, no en una comparación posterior:
    // si el llamador no puede probar de qué org es, la política simplemente no
    // existe para él.
    let consulta = supabase.from('arca_billing_policies').select('*').eq('id', policyId)
    if (opciones.orgIdEsperado) consulta = consulta.eq('organization_id', opciones.orgIdEsperado)
    const { data: pol, error } = await consulta.maybeSingle()
    if (error) {
        console.error('[correrPolitica]', error.message)
        return { error: 'No pudimos leer la política.' }
    }
    if (!pol) return { error: 'No encontramos esa política.' }

    const politica = pol as FilaPolitica
    const orgId = politica.organization_id

    if (!politica.is_enabled) return { error: 'La política está desactivada.' }

    const cupo = await leerCupo(policyId)
    if (!cupo) return { error: 'No pudimos calcular el cupo del período.' }

    // El contribuyente lo define la política: es el monotributo de ESE barbero.
    let contribuyente: FilaContribuyente | null = null
    if (politica.taxpayer_id) {
        const { data, error: errTp } = await supabase
            .from('arca_taxpayers')
            .select('*')
            .eq('id', politica.taxpayer_id)
            .maybeSingle()
        if (errTp) {
            console.error('[correrPolitica] contribuyente', errTp.message)
            return { error: 'No pudimos leer el monotributo de esa política.' }
        }
        contribuyente = data as FilaContribuyente | null
    } else {
        contribuyente = await cargarContribuyente(orgId)
    }
    if (!contribuyente) return { error: 'Esa política no tiene un monotributo asociado.' }

    // De dónde salen las ventas de este cupo.
    //
    //   propios      → sólo las de su barbero (el caso normal)
    //   sucursal     → cualquiera de su sucursal
    //   organizacion → cualquiera del local
    //
    // Los dos últimos existen para los dueños: Tony factura con su monotributo
    // aunque no corte, porque si dependiera de sus propios cortes su CUIT
    // quedaría sin usar mientras el local factura millones.
    const origen = politica.origen ?? 'propios'
    let staffFiltro: string | null = null
    let branchFiltro: string[] | null = null

    if (origen === 'propios') {
        // Sin `staff_id` no hay "propios" que filtrar, y `leerCandidatos` con
        // `p_staff_id = null` NO filtra nada: le facturaría a este CUIT los
        // cortes de TODA la organización, que es exactamente lo contrario de lo
        // que pidió el dueño al elegir "sólo los suyos". Se corta acá.
        if (!contribuyente.staff_id) {
            return {
                error:
                    `El monotributo de ${contribuyente.razon_social ?? 'este CUIT'} no está vinculado a ningún ` +
                    'barbero, así que no podemos saber cuáles son "sus" cortes. Vinculalo, o cambiá el origen ' +
                    'del cupo a "los de su sucursal" o "los de todo el negocio".',
            }
        }
        staffFiltro = contribuyente.staff_id
    } else if (origen === 'sucursal') {
        // La sucursal es la del barbero titular, no la de la política: el cupo
        // es de una persona y esa persona trabaja en un lugar.
        const { data: st } = await supabase
            .from('staff')
            .select('branch_id')
            .eq('id', contribuyente.staff_id ?? '')
            .maybeSingle()
        // Y si no se pudo resolver, se corta por el mismo motivo que arriba:
        // `branchFiltro = null` significa "todas las sucursales", así que
        // degradar en silencio convertiría un cupo de sucursal en uno org-wide.
        if (!st?.branch_id) {
            return {
                error:
                    `No pudimos determinar la sucursal de ${contribuyente.razon_social ?? 'este CUIT'}. ` +
                    'Asignale una sucursal al barbero, o cambiá el origen del cupo a "los de todo el negocio".',
            }
        }
        branchFiltro = [st.branch_id]
    }

    // El alcance del usuario entra en la PLANIFICACIÓN, no después.
    //
    // Un usuario con alcance limitado no puede disparar la emisión de las
    // sucursales que no ve, ni siquiera a través de una política org-wide. Pero
    // recortar el plan YA ARMADO deja el cupo corto sin decirlo: se planifican
    // 52 comprobantes sobre toda la organización, se filtran los de las otras
    // sucursales y salen 9, con el cupo de la semana igual de vacío y ningún
    // aviso. Filtrando antes, el plan se llena con lo que sí se puede emitir.
    let alcance = branchFiltro
    if (opciones.branchIdsPermitidos) {
        alcance = alcance
            ? alcance.filter((b) => opciones.branchIdsPermitidos!.includes(b))
            : opciones.branchIdsPermitidos
    }

    const candidatos = await leerCandidatos(
        orgId, politica, 300, contribuyente.environment, staffFiltro, alcance,
    )
    if ('error' in candidatos) return { error: candidatos.error }

    const plan = planificarFacturacion(candidatos, cupo, aPoliticaCupo(politica))

    // Red de contención: que el filtro de arriba no exista es un bug, no una
    // opción. Si alguna vez se cae, esto evita emitir fuera de alcance.
    if (opciones.branchIdsPermitidos) {
        const permitidas = new Set(opciones.branchIdsPermitidos)
        plan.seleccionados = plan.seleccionados.filter((c) => permitidas.has(c.branchId))
    }
    if (plan.seleccionados.length === 0) {
        if (desdeCron) await sellarCorrida(supabase, policyId)
        return { emitidos: [], fallidos: [], total: 0 }
    }

    const prep = await prepararEmisionDe(contribuyente)
    if ('error' in prep) return { error: prep.error }

    const { data: sucursales } = await supabase
        .from('branches')
        .select('id, timezone')
        .eq('organization_id', orgId)
    const tzPorSucursal = new Map(
        ((sucursales ?? []) as any[]).map((s) => [s.id, s.timezone ?? 'America/Argentina/Buenos_Aires']),
    )

    const staffId = opciones.staffId ?? null
    const emitidos: ComprobanteEmitido[] = []
    const fallidos: ResultadoLote['fallidos'] = []
    let cortado = false

    const aEmitir = plan.seleccionados.slice(0, MAX_POR_CORRIDA)
    const restantes = plan.seleccionados.length - aEmitir.length

    for (const c of aEmitir) {
        const tz = tzPorSucursal.get(c.branchId) ?? 'America/Argentina/Buenos_Aires'
        const res = await emitirUno(prep.t, prep.ctx, {
            orgId,
            branchId: c.branchId,
            visitId: c.visitId,
            clientId: c.clientId,
            clienteNombre: c.clientName,
            totalPesos: c.baseAmount,
            fechaServicio: fechaLocalDeSucursal(tz, new Date(c.completedAt)),
            tz,
            policyId,
            via: desdeCron ? 'automatico' : 'manual',
            staffId,
        })
        if ('ok' in res) {
            emitidos.push(res.data)
        } else {
            fallidos.push({
                visitId: c.visitId,
                motivo: res.error,
                codigo: res.codigo,
                traducido: res.traducido,
            })
            // Si el error es de la configuración o del servicio y no de esta
            // venta, seguir con las otras 34 sólo genera 34 errores idénticos,
            // 34 filas de basura en el historial y 68 llamadas al pedo a un
            // servidor que ya dijo que no. La lista de códigos vivía acá y no
            // incluía 10005: un punto de venta de contingencia hacía que el
            // motor martillara ARCA hasta agotar el lote.
            if (errorCortaElLote(res.codigo)) {
                cortado = true
                break
            }
        }
    }

    // `last_auto_run_at` marca "el cron ya corrió hoy". Sólo lo escribe el
    // cron, y sólo si NO se cortó a la mitad: si se estampara igual, un lote
    // interrumpido por una caída de ARCA dejaría el cupo del día sin llenar
    // hasta el día siguiente. Y si lo escribiera una corrida manual, apretar
    // "Facturar ahora" a la mañana cancelaría la corrida automática de la noche.
    // Si quedaron comprobantes afuera por el tope, la corrida NO se sella: así
    // el cron vuelve dentro de la hora y termina el trabajo en vez de esperar
    // al día siguiente.
    if (desdeCron && !cortado && restantes === 0) await sellarCorrida(supabase, policyId)

    revalidatePath('/dashboard/facturacion')
    return {
        emitidos,
        fallidos,
        total: emitidos.reduce((a, e) => a + e.total, 0),
        // Si el lote se abandonó, lo que "queda" no se arregla apretando otra
        // vez: hay que resolver el motivo primero.
        restantes: cortado ? 0 : restantes,
        cortado,
    }
}
