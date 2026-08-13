'use server'

// =============================================================================
// src/lib/actions/arca-emision.ts
// Capa de SERVER ACTIONS del facturador: permisos, aislamiento de organización
// y validación de entrada. El trabajo pesado vive en `@/lib/arca/motor`.
//
// La separación no es cosmética: en un archivo `'use server'` TODO export es un
// endpoint HTTP al que cualquiera puede pegarle con el action-id que viaja en
// el bundle del cliente. Por eso acá no entra ninguna función que reciba una
// bandera de confianza por parámetro, y cada export empieza chequeando permiso
// y organización.
//
// Otras reglas que sigue este módulo:
//  · El error que ve el usuario es castellano; el crudo va a console.error con
//    el nombre de la función entre corchetes.
//  · Un fallo técnico NUNCA se degrada a "no hay datos". Esto es plata y fisco:
//    si no pudimos leer, se dice que no pudimos leer (Known Risk #15).
// =============================================================================

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId, validateBranchAccess } from '@/lib/actions/org'
import { getScopedBranchIds } from '@/lib/actions/branch-access'
import { currentUserCan } from '@/lib/actions/permissions-gate'

import { LETRA_CBTE, NOMBRE_CBTE, notaCreditoPara } from '@/lib/arca/config'
import { feCaeSolicitar, feCompUltimoAutorizado, ErrorWsfe } from '@/lib/arca/wsfe'
import { armarComprobante, fechaLocalDeSucursal } from '@/lib/arca/comprobante'
import { urlQrArca, numeroFormateado, aFechaConGuiones } from '@/lib/arca/qr'
import { traducirErrorArca, type ErrorTraducido } from '@/lib/arca/errores'
import {
    planificarFacturacion,
    type CandidatoVenta,
    type EstadoCupo,
    type PoliticaCupo,
} from '@/lib/arca/cupo'
import { ambienteDeOrg, puntoVentaDe, staffIdActual } from '@/lib/arca/contexto'
import {
    aPoliticaCupo,
    correrPolitica,
    emitirUno,
    leerCandidatos,
    leerCupo,
    marcar,
    prepararEmision,
    resolverEnDuda,
    type ComprobanteEmitido,
    type FilaPolitica,
    type PoliticaVistaMinima,
    type ResultadoLote,
    type VistaPreviaCupo,
} from '@/lib/arca/motor'

// OJO: acá NO puede ir `export type { ... } from '@/lib/arca/motor'`.
// El compilador de server actions trata TODO re-export de un archivo
// 'use server' como export en runtime, incluso el de tipos, y el build falla
// con "Export VistaPreviaCupo doesn't exist in target module". Los tipos se
// importan directo desde `@/lib/arca/motor`. Una `export interface` declarada
// en este mismo archivo sí funciona: se borra en compilación.


/**
 * Vista previa: exactamente lo que emitiría el cron, sin emitir nada.
 *
 * Usa la MISMA función de planificación que la ejecución real. Si la vista
 * previa y la ejecución tuvieran cada una su propia lógica, tarde o temprano
 * mostrarían cosas distintas — y la confianza en un tablero de plata se pierde
 * una sola vez.
 */
export async function simularCupo(policyId: string): Promise<VistaPreviaCupo> {
    const vacio: VistaPreviaCupo = {
        plan: {
            seleccionados: [],
            descartados: [],
            totalSeleccionado: 0,
            motivoCorte: 'sin_candidatos',
            proyeccion: { cantidadFinal: 0, montoFinal: 0, restanteCantidad: 0, restanteMonto: 0 },
        },
        cupo: null,
        politica: null,
        error: null,
    }

    if (!(await currentUserCan('arca.view'))) return { ...vacio, error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...vacio, error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data: pol, error } = await supabase
        .from('arca_billing_policies')
        .select('*')
        .eq('id', policyId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[simularCupo]', error.message)
        return { ...vacio, error: 'No pudimos leer la política de facturación.' }
    }
    if (!pol) return { ...vacio, error: 'No encontramos esa política.' }

    const politica = pol as FilaPolitica
    const cupo = await leerCupo(policyId)
    if (!cupo) return { ...vacio, error: 'No pudimos calcular el cupo del período.' }

    const candidatos = await leerCandidatos(orgId, politica, 300, await ambienteDeOrg(orgId))
    if ('error' in candidatos) return { ...vacio, cupo, error: candidatos.error }

    return {
        plan: planificarFacturacion(candidatos, cupo, aPoliticaCupo(politica)),
        cupo,
        politica: {
            id: politica.id,
            branchId: politica.branch_id,
            modo: politica.mode,
            periodo: politica.period,
            estrategia: politica.selection,
            objetivoCantidad: politica.target_count,
            objetivoMonto: politica.target_amount !== null ? Number(politica.target_amount) : null,
            permitirExceso: politica.allow_overflow,
            emisionAutomatica: politica.auto_emit,
        },
        error: null,
    }
}

/** Ventas facturables sin aplicar el cupo — para elegir a mano. */
export async function getCandidatosManuales(params: {
    branchId?: string | null
    dias?: number
    limite?: number
}): Promise<{ candidatos: CandidatoVenta[]; error: string | null }> {
    if (!(await currentUserCan('arca.view'))) return { candidatos: [], error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { candidatos: [], error: 'No autorizado.' }

    const scoped = await getScopedBranchIds()
    const branchIds = params.branchId
        ? [params.branchId].filter((b) => scoped.includes(b))
        : scoped
    if (branchIds.length === 0) return { candidatos: [], error: null }

    const supabase = createAdminClient()
    const dias = Math.min(Math.max(params.dias ?? 30, 1), 90)
    const { data, error } = await supabase.rpc('arca_billing_candidates', {
        p_organization_id: orgId,
        p_branch_ids: branchIds,
        p_from: new Date(Date.now() - dias * 86_400_000).toISOString(),
        p_to: new Date().toISOString(),
        p_payment_methods: ['cash', 'card', 'transfer'],
        p_min_ticket: null,
        p_max_ticket: null,
        p_include_tips: false,
        p_selection: 'cronologico',
        p_seed: 'manual',
        p_limit: Math.min(params.limite ?? 200, 500),
        p_environment: await ambienteDeOrg(orgId),
    })

    if (error) {
        console.error('[getCandidatosManuales]', error.message)
        return { candidatos: [], error: 'No pudimos leer las ventas facturables.' }
    }

    return {
        candidatos: ((data ?? []) as any[]).map((c) => ({
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
        })),
        error: null,
    }
}

/**
 * Dispara el cupo de una política desde la pantalla.
 *
 * NO recibe ninguna bandera de modo: los chequeos van siempre puestos y el
 * alcance por sucursal se calcula acá, no se acepta del llamador. El camino del
 * cron usa `correrPolitica` directamente desde el módulo plano.
 */
export async function ejecutarPolitica(
    policyId: string,
): Promise<ResultadoLote | { error: string }> {
    if (!(await currentUserCan('arca.emit'))) {
        return { error: 'No tenés permiso para emitir comprobantes.' }
    }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    return correrPolitica(policyId, {
        desdeCron: false,
        orgIdEsperado: orgId,
        branchIdsPermitidos: await getScopedBranchIds(),
        staffId: await staffIdActual(),
    })
}


/** Emite el comprobante de una venta puntual. */
export async function emitirComprobanteDeVenta(
    visitId: string,
): Promise<{ ok: true; data: ComprobanteEmitido } | { error: string; traducido?: ErrorTraducido }> {
    if (!(await currentUserCan('arca.emit'))) return { error: 'No tenés permiso para emitir comprobantes.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data: visita, error } = await supabase
        .from('visits')
        .select('id, branch_id, client_id, amount, tip_amount, completed_at, organization_id, branches(timezone)')
        .eq('id', visitId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[emitirComprobanteDeVenta]', error.message)
        return { error: 'No pudimos leer la venta.' }
    }
    if (!visita) return { error: 'No encontramos esa venta.' }

    const acceso = await validateBranchAccess(visita.branch_id)
    if (!acceso) return { error: 'No tenés acceso a esa sucursal.' }

    const prep = await prepararEmision(orgId)
    if ('error' in prep) return prep

    const tz = (visita as any).branches?.timezone ?? 'America/Argentina/Buenos_Aires'
    const { data: cliente } = visita.client_id
        ? await supabase.from('clients').select('name').eq('id', visita.client_id).maybeSingle()
        : { data: null }

    const res = await emitirUno(prep.t, prep.ctx, {
        orgId,
        branchId: visita.branch_id,
        visitId: visita.id,
        clientId: visita.client_id,
        clienteNombre: cliente?.name ?? null,
        totalPesos: Number(visita.amount ?? 0),
        fechaServicio: visita.completed_at ? fechaLocalDeSucursal(tz, new Date(visita.completed_at)) : null,
        tz,
        policyId: null,
        via: 'manual',
        staffId: await staffIdActual(),
    })

    revalidatePath('/dashboard/facturacion')
    if ('ok' in res) return { ok: true, data: res.data }
    return { error: res.error, traducido: res.traducido }
}

/** Emite varias ventas elegidas a mano. */
export async function emitirLote(visitIds: string[]): Promise<ResultadoLote | { error: string }> {
    if (!(await currentUserCan('arca.emit'))) return { error: 'No tenés permiso para emitir comprobantes.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const ids = Array.from(new Set(visitIds)).slice(0, 100)
    if (ids.length === 0) return { emitidos: [], fallidos: [], total: 0 }

    const prep = await prepararEmision(orgId)
    if ('error' in prep) return { error: prep.error }

    const supabase = createAdminClient()
    const { data: visitas, error } = await supabase
        .from('visits')
        .select('id, branch_id, client_id, amount, completed_at, branches(timezone)')
        .in('id', ids)
        .eq('organization_id', orgId)
    if (error) {
        console.error('[emitirLote]', error.message)
        return { error: 'No pudimos leer las ventas.' }
    }

    const scoped = await getScopedBranchIds()
    const staffId = await staffIdActual()
    const emitidos: ComprobanteEmitido[] = []
    const fallidos: ResultadoLote['fallidos'] = []

    // Secuencial a propósito: la numeración se serializa igual del lado de la
    // base, y en paralelo lo único que se gana es pelearse por el mismo lock.
    for (const v of (visitas ?? []) as any[]) {
        if (!scoped.includes(v.branch_id)) {
            fallidos.push({ visitId: v.id, motivo: 'Sin acceso a esa sucursal', codigo: 'sin_acceso' })
            continue
        }
        const tz = v.branches?.timezone ?? 'America/Argentina/Buenos_Aires'
        const res = await emitirUno(prep.t, prep.ctx, {
            orgId,
            branchId: v.branch_id,
            visitId: v.id,
            clientId: v.client_id,
            clienteNombre: null,
            totalPesos: Number(v.amount ?? 0),
            fechaServicio: v.completed_at ? fechaLocalDeSucursal(tz, new Date(v.completed_at)) : null,
            tz,
            policyId: null,
            via: 'manual',
            staffId,
        })
        if ('ok' in res) emitidos.push(res.data)
        else fallidos.push({ visitId: v.id, motivo: res.error, codigo: res.codigo })
    }

    revalidatePath('/dashboard/facturacion')
    return { emitidos, fallidos, total: emitidos.reduce((a, e) => a + e.total, 0) }
}

/** Minutos que tiene que llevar un comprobante trabado antes de tocarlo. */
const MINUTOS_ANTES_DE_RECONCILIAR = 10

/**
 * Resuelve los comprobantes que quedaron trabados y le pregunta a ARCA qué pasó
 * con cada uno. Idempotente: se puede correr las veces que haga falta.
 *
 * Toma DOS estados, y los dos hacen falta:
 *
 *  · `en_duda`   — se cortó la comunicación después de pedir el CAE.
 *  · `reservado` — el proceso murió entre la reserva del número y la respuesta
 *                  de ARCA (timeout de la función serverless, deploy en el
 *                  medio). Sin esto, `reservado` sería un estado TERMINAL: la
 *                  venta quedaría inbillable para siempre y, peor, el número
 *                  reservado bloquearía la numeración del punto de venta —
 *                  ARCA esperaría el N y el sistema pediría siempre el N+1,
 *                  fallando con 10016 para siempre y sin ninguna pantalla desde
 *                  donde destrabarlo.
 *
 * Sólo se tocan los que llevan más de `MINUTOS_ANTES_DE_RECONCILIAR`: una
 * emisión en curso está justo en esos estados, y liberarle el número por abajo
 * sería crear el problema que esta función viene a resolver.
 */
export async function reconciliarEnDuda(): Promise<
    { ok: true; revisados: number; confirmados: number; liberados: number } | { error: string }
> {
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }
    if (!(await currentUserCan('arca.view'))) return { error: 'No tenés permiso.' }

    const supabase = createAdminClient()
    const corte = new Date(Date.now() - MINUTOS_ANTES_DE_RECONCILIAR * 60_000).toISOString()

    const { data: trabados, error } = await supabase
        .from('arca_invoices')
        .select('id, pto_vta, cbte_tipo, cbte_nro, fecha_cbte, status')
        .eq('organization_id', orgId)
        .in('status', ['en_duda', 'reservado'])
        .lt('created_at', corte)
        .order('created_at', { ascending: true })
        .limit(50)

    if (error) {
        console.error('[reconciliarEnDuda]', error.message)
        return { error: 'No pudimos leer los comprobantes trabados.' }
    }
    if (!trabados?.length) return { ok: true, revisados: 0, confirmados: 0, liberados: 0 }

    const prep = await prepararEmision(orgId)
    if ('error' in prep) return { error: prep.error }

    let confirmados = 0
    let liberados = 0
    for (const inv of trabados as any[]) {
        const resuelto = await resolverEnDuda(
            prep.ctx,
            inv.id,
            inv.pto_vta,
            inv.cbte_tipo,
            Number(inv.cbte_nro),
            prep.t.cuit,
            inv.fecha_cbte,
            // Acá sí se libera: pasaron más de 10 minutos, así que si ARCA no
            // lo tiene registrado es porque nunca lo autorizó.
            true,
        )
        if (resuelto && 'ok' in resuelto) confirmados++
        else liberados++
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, revisados: trabados.length, confirmados, liberados }
}

// -----------------------------------------------------------------------------
// Nota de crédito
// -----------------------------------------------------------------------------

/**
 * Anula una factura con una nota de crédito.
 *
 * En Argentina una factura electrónica no se borra: se compensa con una nota de
 * crédito por el mismo importe. La NC lleva su PROPIA numeración correlativa
 * (`FECompUltimoAutorizado` del tipo 13 es una secuencia distinta de la del 11).
 */
export async function emitirNotaCredito(
    invoiceId: string,
): Promise<{ ok: true; data: ComprobanteEmitido } | { error: string; traducido?: ErrorTraducido }> {
    if (!(await currentUserCan('arca.emit'))) return { error: 'No tenés permiso para emitir comprobantes.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data: orig, error } = await supabase
        .from('arca_invoices')
        .select('*')
        .eq('id', invoiceId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[emitirNotaCredito]', error.message)
        return { error: 'No pudimos leer el comprobante.' }
    }
    if (!orig) return { error: 'No encontramos ese comprobante.' }
    if (orig.status !== 'emitida') return { error: 'Sólo se puede anular un comprobante emitido.' }

    // Se miran también las que quedaron EN VUELO. Una NC que se cortó por
    // timeout pero que ARCA sí autorizó queda en 'en_duda' y la factura original
    // sigue 'emitida': mirando sólo las 'emitida', el usuario apretaba de nuevo
    // y salía una SEGUNDA nota de crédito por el mismo importe — la venta
    // acreditada dos veces ante ARCA.
    const { data: yaTiene, error: errNc } = await supabase
        .from('arca_invoices')
        .select('id, status')
        .eq('parent_invoice_id', invoiceId)
        .in('status', ['pendiente', 'reservado', 'emitida', 'en_duda'])
        .limit(1)
    if (errNc) {
        console.error('[emitirNotaCredito] chequeo previo', errNc.message)
        return { error: 'No pudimos verificar si ya tiene nota de crédito.' }
    }
    if (yaTiene?.length) {
        return {
            error:
                yaTiene[0].status === 'emitida'
                    ? 'Ese comprobante ya tiene una nota de crédito.'
                    : 'Ya hay una nota de crédito en curso para ese comprobante. ' +
                      'Verificá su estado contra ARCA antes de emitir otra.',
        }
    }

    const prep = await prepararEmision(orgId)
    if ('error' in prep) return prep

    const tipoNC = notaCreditoPara(orig.cbte_tipo)
    const { data: sucursal } = orig.branch_id
        ? await supabase.from('branches').select('timezone').eq('id', orig.branch_id).maybeSingle()
        : { data: null }
    const tz = sucursal?.timezone ?? 'America/Argentina/Buenos_Aires'
    const hoyLocal = fechaLocalDeSucursal(tz)

    const pv = await puntoVentaDe(prep.t.id, orig.branch_id)
    if (!pv) return { error: 'Esta sucursal no tiene punto de venta asignado.' }

    const armado = armarComprobante({
        totalCentavos: Math.round(Number(orig.imp_total) * 100),
        condicionEmisor: prep.t.condicion_iva,
        fechaLocal: hoyLocal,
    })

    let ultimoAutorizado: number
    try {
        ultimoAutorizado = await feCompUltimoAutorizado(prep.ctx, pv.numero, tipoNC)
    } catch (e) {
        const err = e instanceof ErrorWsfe ? e : null
        const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))
        return { error: traducido.titulo, traducido }
    }

    const cbtesAsoc = [
        {
            tipo: orig.cbte_tipo,
            ptoVta: orig.pto_vta,
            nro: Number(orig.cbte_nro),
            cuit: prep.t.cuit,
            fecha: String(orig.fecha_cbte).replace(/-/g, ''),
        },
    ]

    const { data: reserva, error: errReserva } = await supabase.rpc('arca_reserve_invoice', {
        p_taxpayer_id: prep.t.id,
        p_organization_id: orgId,
        p_branch_id: orig.branch_id,
        p_sales_point_id: pv.id,
        p_pto_vta: pv.numero,
        p_cbte_tipo: tipoNC,
        p_arca_last: ultimoAutorizado,
        p_concepto: armado.detalle.concepto,
        p_doc_tipo: orig.doc_tipo,
        p_doc_nro: orig.doc_nro,
        p_condicion_iva_receptor_id: orig.condicion_iva_receptor_id,
        p_fecha_cbte: hoyLocal,
        p_imp_total: armado.detalle.impTotal,
        p_imp_neto: armado.detalle.impNeto,
        p_imp_iva: armado.detalle.impIVA,
        p_iva_items: armado.detalle.iva ?? null,
        p_visit_id: null, // la visita ya la ocupa la factura original
        p_client_id: orig.client_id,
        p_policy_id: null,
        p_emitted_via: 'nota_credito',
        p_emitted_by_staff_id: await staffIdActual(),
        p_fch_serv_desde: armado.detalle.fchServDesde ? aFechaConGuiones(armado.detalle.fchServDesde) : null,
        p_fch_serv_hasta: armado.detalle.fchServHasta ? aFechaConGuiones(armado.detalle.fchServHasta) : null,
        p_fch_vto_pago: armado.detalle.fchVtoPago ? aFechaConGuiones(armado.detalle.fchVtoPago) : null,
        p_receptor_nombre: orig.receptor_nombre,
        p_parent_invoice_id: invoiceId,
        p_cbtes_asoc: cbtesAsoc as any,
    })

    if (errReserva) {
        console.error('[emitirNotaCredito] reserva', errReserva.message)
        return { error: 'No pudimos reservar el número de la nota de crédito.' }
    }

    const fila = Array.isArray(reserva) ? reserva[0] : reserva
    const numero = Number(fila.numero)

    try {
        const res = await feCaeSolicitar(prep.ctx, pv.numero, tipoNC, {
            ...armado.detalle,
            cbteDesde: numero,
            cbteHasta: numero,
            cbtesAsoc,
        })

        if ((res.resultado === 'A' || res.resultado === 'P') && res.cae) {
            const qrUrl = urlQrArca({
                fecha: hoyLocal,
                cuit: prep.t.cuit,
                ptoVta: pv.numero,
                tipoCmp: tipoNC,
                nroCmp: numero,
                importe: armado.detalle.impTotal,
                codAut: res.cae,
            })
            await marcar(fila.invoice_id, 'emitida', {
                cae: res.cae,
                cae_vto: res.caeVto ? aFechaConGuiones(res.caeVto) : null,
                resultado: res.resultado,
                response_payload: res.crudo as any,
                emitted_at: new Date().toISOString(),
            })
            // La factura original queda anulada, no borrada.
            await marcar(invoiceId, 'anulada')

            revalidatePath('/dashboard/facturacion')
            return {
                ok: true,
                data: {
                    invoiceId: fila.invoice_id,
                    numero: numeroFormateado(pv.numero, numero),
                    cae: res.cae,
                    caeVto: res.caeVto ? aFechaConGuiones(res.caeVto) : null,
                    total: armado.detalle.impTotal,
                    tipo: tipoNC,
                    nombreTipo: NOMBRE_CBTE[tipoNC] ?? 'Nota de Crédito',
                    letra: LETRA_CBTE[tipoNC] ?? 'C',
                    qrUrl,
                    observaciones: res.observaciones,
                },
            }
        }

        const principal = res.errores[0] ?? null
        const traducido = traducirErrorArca(principal?.code ?? null, principal?.msg ?? null)
        await marcar(fila.invoice_id, 'rechazada', {
            errores: res.errores.length ? res.errores : null,
            last_error: principal ? `${principal.code}: ${principal.msg}` : 'Rechazada por ARCA',
        })
        return { error: traducido.titulo, traducido }
    } catch (e) {
        const err = e instanceof ErrorWsfe ? e : null
        await marcar(fila.invoice_id, 'en_duda', { last_error: err?.message ?? String(e) })
        const traducido = traducirErrorArca(err?.codigo ?? null, err?.message ?? String(e))
        return { error: traducido.titulo, traducido }
    }
}

// -----------------------------------------------------------------------------
// Política de facturación (el cupo)
// -----------------------------------------------------------------------------

const PoliticaSchema = z.object({
    branchId: z.string().uuid().nullable(),
    habilitada: z.boolean(),
    modo: z.enum(['manual', 'cantidad', 'monto']),
    periodo: z.enum(['dia', 'semana', 'mes']),
    objetivoCantidad: z.number().int().min(0).max(100_000).nullable(),
    objetivoMonto: z.number().min(0).max(1_000_000_000).nullable(),
    estrategia: z.enum(['cronologico', 'mas_baratos', 'mas_caros', 'distribuido', 'aleatorio']),
    metodosPago: z.array(z.enum(['cash', 'card', 'transfer'])).min(1, 'Elegí al menos un medio de cobro'),
    ticketMinimo: z.number().min(0).nullable(),
    ticketMaximo: z.number().min(0).nullable(),
    incluyePropinas: z.boolean(),
    permitirExceso: z.boolean(),
    diasHaciaAtras: z.number().int().min(1).max(60),
    emisionAutomatica: z.boolean(),
    horaEmision: z.number().int().min(0).max(23),
})

export async function guardarPolitica(input: {
    branchId: string | null
    habilitada: boolean
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    objetivoCantidad: number | null
    objetivoMonto: number | null
    estrategia: PoliticaCupo['estrategia']
    metodosPago: string[]
    ticketMinimo: number | null
    ticketMaximo: number | null
    incluyePropinas: boolean
    permitirExceso: boolean
    diasHaciaAtras: number
    emisionAutomatica: boolean
    horaEmision: number
}): Promise<{ ok: true; policyId: string } | { error: string }> {
    if (!(await currentUserCan('arca.manage'))) return { error: 'No tenés permiso para configurar el facturador.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const parsed = PoliticaSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }
    const p = parsed.data

    if (p.modo === 'cantidad' && (p.objetivoCantidad === null || p.objetivoCantidad <= 0)) {
        return { error: 'Poné cuántos comprobantes querés emitir por período.' }
    }
    if (p.modo === 'monto' && (p.objetivoMonto === null || p.objetivoMonto <= 0)) {
        return { error: 'Poné hasta qué monto querés facturar por período.' }
    }
    if (p.ticketMinimo !== null && p.ticketMaximo !== null && p.ticketMaximo < p.ticketMinimo) {
        return { error: 'El ticket máximo no puede ser menor que el mínimo.' }
    }
    if (p.branchId) {
        const acceso = await validateBranchAccess(p.branchId)
        if (!acceso) return { error: 'Esa sucursal no es de tu organización.' }
    }

    const supabase = createAdminClient()
    const fila = {
        organization_id: orgId,
        branch_id: p.branchId,
        is_enabled: p.habilitada,
        mode: p.modo,
        period: p.periodo,
        // Se guarda sólo el objetivo del modo elegido: dejar el otro con valor
        // hace que al cambiar de modo aparezca un número viejo como si fuera
        // el vigente.
        target_count: p.modo === 'cantidad' ? p.objetivoCantidad : null,
        target_amount: p.modo === 'monto' ? p.objetivoMonto : null,
        selection: p.estrategia,
        payment_methods: p.metodosPago,
        min_ticket: p.ticketMinimo,
        max_ticket: p.ticketMaximo,
        include_tips: p.incluyePropinas,
        allow_overflow: p.permitirExceso,
        lookback_days: p.diasHaciaAtras,
        auto_emit: p.emisionAutomatica,
        auto_emit_hour: p.horaEmision,
    }

    const consulta = supabase.from('arca_billing_policies').select('id').eq('organization_id', orgId)
    const { data: existente } = p.branchId
        ? await consulta.eq('branch_id', p.branchId).maybeSingle()
        : await consulta.is('branch_id', null).maybeSingle()

    const res = existente
        ? await supabase.from('arca_billing_policies').update(fila).eq('id', existente.id).select('id').single()
        : await supabase.from('arca_billing_policies').insert(fila).select('id').single()

    if (res.error) {
        console.error('[guardarPolitica]', res.error.message)
        return { error: 'No se pudo guardar la configuración de facturación.' }
    }

    revalidatePath('/dashboard/facturacion')
    return { ok: true, policyId: res.data.id }
}

/**
 * Vista previa de una configuración que TODAVÍA NO se guardó.
 *
 * Es lo que hace que el editor de cupo se pueda mover en vivo: el dueño cambia
 * "50 por mes" a "80 por mes" y ve al instante qué cortes entrarían, sin
 * comprometerse. Usa la misma función de planificación y el mismo cálculo de
 * período que la ejecución real (`arca_quota_state_params`), justamente para
 * que la vista previa no pueda mentir.
 */
export async function simularConfiguracion(input: {
    branchId: string | null
    modo: 'manual' | 'cantidad' | 'monto'
    periodo: 'dia' | 'semana' | 'mes'
    objetivoCantidad: number | null
    objetivoMonto: number | null
    estrategia: PoliticaCupo['estrategia']
    metodosPago: string[]
    ticketMinimo: number | null
    ticketMaximo: number | null
    incluyePropinas: boolean
    permitirExceso: boolean
    diasHaciaAtras: number
}): Promise<VistaPreviaCupo> {
    const vacio: VistaPreviaCupo = {
        plan: {
            seleccionados: [],
            descartados: [],
            totalSeleccionado: 0,
            motivoCorte: 'sin_candidatos',
            proyeccion: { cantidadFinal: 0, montoFinal: 0, restanteCantidad: 0, restanteMonto: 0 },
        },
        cupo: null,
        politica: null,
        error: null,
    }

    if (!(await currentUserCan('arca.view'))) return { ...vacio, error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { ...vacio, error: 'No autorizado.' }

    if (input.branchId) {
        const acceso = await validateBranchAccess(input.branchId)
        if (!acceso) return { ...vacio, error: 'Esa sucursal no es de tu organización.' }
    }

    const supabase = createAdminClient()

    const { data: cupoData, error: errCupo } = await supabase.rpc('arca_quota_state_params', {
        p_organization_id: orgId,
        p_branch_id: input.branchId,
        p_period: input.periodo,
        p_target_count: input.modo === 'cantidad' ? input.objetivoCantidad : null,
        p_target_amount: input.modo === 'monto' ? input.objetivoMonto : null,
    })
    if (errCupo) {
        console.error('[simularConfiguracion/cupo]', errCupo.message)
        return { ...vacio, error: 'No pudimos calcular el cupo del período.' }
    }
    const f = Array.isArray(cupoData) ? cupoData[0] : cupoData
    if (!f) return { ...vacio, error: 'No pudimos calcular el cupo del período.' }

    const cupo: EstadoCupo = {
        periodoDesde: f.period_start,
        periodoHasta: f.period_end,
        emitidos: Number(f.emitted_count ?? 0),
        montoEmitido: Number(f.emitted_amount ?? 0),
        objetivoCantidad: f.target_count,
        objetivoMonto: f.target_amount !== null ? Number(f.target_amount) : null,
        restanteCantidad: Number(f.remaining_count ?? 0),
        restanteMonto: Number(f.remaining_amount ?? 0),
    }

    const dias = Math.min(Math.max(input.diasHaciaAtras, 1), 60)
    const { data: cands, error: errCand } = await supabase.rpc('arca_billing_candidates', {
        p_organization_id: orgId,
        p_branch_ids: input.branchId ? [input.branchId] : null,
        p_from: new Date(Date.now() - dias * 86_400_000).toISOString(),
        p_to: new Date().toISOString(),
        p_payment_methods: input.metodosPago.length ? input.metodosPago : ['cash', 'card', 'transfer'],
        p_min_ticket: input.ticketMinimo,
        p_max_ticket: input.ticketMaximo,
        p_include_tips: input.incluyePropinas,
        p_selection: input.estrategia,
        p_seed: `preview:${input.branchId ?? 'org'}`,
        p_limit: 300,
        p_environment: await ambienteDeOrg(orgId),
    })
    if (errCand) {
        console.error('[simularConfiguracion/candidatos]', errCand.message)
        return { ...vacio, cupo, error: 'No pudimos leer las ventas facturables.' }
    }

    const candidatos: CandidatoVenta[] = ((cands ?? []) as any[]).map((c) => ({
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

    return {
        plan: planificarFacturacion(candidatos, cupo, {
            id: 'preview',
            modo: input.modo,
            periodo: input.periodo,
            estrategia: input.estrategia,
            permitirExceso: input.permitirExceso,
            objetivoCantidad: input.objetivoCantidad,
            objetivoMonto: input.objetivoMonto,
        }),
        cupo,
        politica: null,
        error: null,
    }
}

// -----------------------------------------------------------------------------
// Listado de comprobantes
// -----------------------------------------------------------------------------

export interface ListadoComprobantes {
    filas: {
        id: string
        numero: string
        tipo: number
        nombreTipo: string
        letra: string
        fecha: string
        total: number
        estado: string
        cae: string | null
        caeVto: string | null
        branchName: string | null
        receptor: string | null
        emitidoVia: string
        error: string | null
    }[]
    total: number
    error: string | null
}

export async function getComprobantes(params?: {
    branchId?: string | null
    estado?: string | null
    desde?: string | null
    hasta?: string | null
    limite?: number
}): Promise<ListadoComprobantes> {
    if (!(await currentUserCan('arca.view'))) return { filas: [], total: 0, error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { filas: [], total: 0, error: 'No autorizado.' }

    const supabase = createAdminClient()
    let q = supabase
        .from('arca_invoices')
        .select(
            'id, cbte_tipo, pto_vta, cbte_nro, fecha_cbte, imp_total, status, cae, cae_vto, ' +
            'receptor_nombre, emitted_via, last_error, branch_id',
            { count: 'exact' },
        )
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(Math.min(params?.limite ?? 100, 500))

    if (params?.branchId) q = q.eq('branch_id', params.branchId)
    if (params?.estado) q = q.eq('status', params.estado)
    if (params?.desde) q = q.gte('fecha_cbte', params.desde)
    if (params?.hasta) q = q.lte('fecha_cbte', params.hasta)

    const { data, error, count } = await q
    if (error) {
        console.error('[getComprobantes]', error.message)
        // Nunca degradar a lista vacía: un tablero de plata que muestra cero
        // cuando en realidad no pudo leer es peor que uno que muestra el error.
        return { filas: [], total: 0, error: 'No pudimos leer los comprobantes emitidos.' }
    }

    const branchIds = Array.from(new Set(((data ?? []) as any[]).map((f) => f.branch_id).filter(Boolean)))
    const { data: sucursales } = branchIds.length
        ? await supabase.from('branches').select('id, name').in('id', branchIds)
        : { data: [] }
    const nombre = new Map(((sucursales ?? []) as any[]).map((s) => [s.id, s.name]))

    return {
        filas: ((data ?? []) as any[]).map((f) => ({
            id: f.id,
            numero: numeroFormateado(f.pto_vta, Number(f.cbte_nro)),
            tipo: f.cbte_tipo,
            nombreTipo: NOMBRE_CBTE[f.cbte_tipo] ?? 'Comprobante',
            letra: LETRA_CBTE[f.cbte_tipo] ?? '',
            fecha: f.fecha_cbte,
            total: Number(f.imp_total ?? 0),
            estado: f.status,
            cae: f.cae,
            caeVto: f.cae_vto,
            branchName: f.branch_id ? nombre.get(f.branch_id) ?? null : null,
            receptor: f.receptor_nombre,
            emitidoVia: f.emitted_via,
            error: f.last_error,
        })),
        total: count ?? 0,
        error: null,
    }
}

/** Datos completos de un comprobante, para imprimir o compartir. */
export async function getComprobanteImprimible(invoiceId: string): Promise<
    | {
          ok: true
          data: {
              numero: string
              nombreTipo: string
              letra: string
              codigoTipo: number
              fecha: string
              total: number
              neto: number
              iva: number
              cae: string | null
              caeVto: string | null
              qrUrl: string | null
              emisor: {
                  razonSocial: string
                  cuit: string
                  domicilio: string | null
                  condicionIva: string
                  ingresosBrutos: string | null
                  inicioActividades: string | null
              }
              receptor: { nombre: string | null; docTipo: number; docNro: number; condicionIva: string }
              periodoServicio: { desde: string | null; hasta: string | null }
              ambiente: string
          }
      }
    | { error: string }
> {
    if (!(await currentUserCan('arca.view'))) return { error: 'No tenés permiso.' }
    const orgId = await getCurrentOrgId()
    if (!orgId) return { error: 'No autorizado.' }

    const supabase = createAdminClient()
    const { data: inv, error } = await supabase
        .from('arca_invoices')
        .select('*, taxpayer:arca_taxpayers(*)')
        .eq('id', invoiceId)
        .eq('organization_id', orgId)
        .maybeSingle()

    if (error) {
        console.error('[getComprobanteImprimible]', error.message)
        return { error: 'No pudimos leer el comprobante.' }
    }
    if (!inv) return { error: 'No encontramos ese comprobante.' }

    const t = (inv as any).taxpayer
    const qrUrl = inv.cae
        ? urlQrArca({
              fecha: inv.fecha_cbte,
              cuit: t?.cuit ?? '',
              ptoVta: inv.pto_vta,
              tipoCmp: inv.cbte_tipo,
              nroCmp: Number(inv.cbte_nro),
              importe: Number(inv.imp_total),
              tipoDocRec: inv.doc_tipo,
              nroDocRec: Number(inv.doc_nro),
              codAut: inv.cae,
          })
        : null

    const etiquetaCondicion =
        t?.condicion_iva === 'monotributo'
            ? 'Responsable Monotributo'
            : t?.condicion_iva === 'exento'
                ? 'IVA Sujeto Exento'
                : 'IVA Responsable Inscripto'

    return {
        ok: true,
        data: {
            numero: numeroFormateado(inv.pto_vta, Number(inv.cbte_nro)),
            nombreTipo: NOMBRE_CBTE[inv.cbte_tipo] ?? 'Comprobante',
            letra: LETRA_CBTE[inv.cbte_tipo] ?? 'C',
            codigoTipo: inv.cbte_tipo,
            fecha: inv.fecha_cbte,
            total: Number(inv.imp_total ?? 0),
            neto: Number(inv.imp_neto ?? 0),
            iva: Number(inv.imp_iva ?? 0),
            cae: inv.cae,
            caeVto: inv.cae_vto,
            qrUrl,
            emisor: {
                razonSocial: t?.razon_social ?? '',
                cuit: t?.cuit ?? '',
                domicilio: t?.domicilio_comercial ?? null,
                condicionIva: etiquetaCondicion,
                ingresosBrutos: t?.ingresos_brutos ?? null,
                inicioActividades: t?.inicio_actividades ?? null,
            },
            receptor: {
                nombre: inv.receptor_nombre,
                docTipo: inv.doc_tipo,
                docNro: Number(inv.doc_nro),
                condicionIva: inv.condicion_iva_receptor_id === 5 ? 'Consumidor Final' : '—',
            },
            periodoServicio: { desde: inv.fch_serv_desde, hasta: inv.fch_serv_hasta },
            ambiente: t?.environment ?? 'homologacion',
        },
    }
}

