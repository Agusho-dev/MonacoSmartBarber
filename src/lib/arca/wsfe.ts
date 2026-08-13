// =============================================================================
// src/lib/arca/wsfe.ts
// Cliente SOAP de WSFEv1 (Facturación Electrónica de ARCA).
//
// Se arma el sobre a mano y se parsea con fast-xml-parser en vez de usar una
// librería SOAP. Motivo: las librerías SOAP bajan y compilan el WSDL en runtime
// — 200 KB de XML por cold start, contra un servidor que ya de por sí es lento
// y se cae seguido. Son siete métodos con estructura fija; el WSDL no aporta
// nada que no esté acá escrito.
//
// Tampoco se usa ningún SDK de terceros: los más populares (afipsdk) mandan el
// certificado y la clave privada a un servidor propio. Para una clave privada
// fiscal de un cliente, eso no se hace.
// =============================================================================

import { XMLParser } from 'fast-xml-parser'
import {
    ENDPOINTS,
    NS_FEV1,
    TIMEOUT_WSFE_MS,
    REINTENTOS_RED,
    type AmbienteArca,
} from './config'
import type { TicketAcceso } from './wsaa'

export interface ContextoWsfe {
    ambiente: AmbienteArca
    /** CUIT del CONTRIBUYENTE que factura (en delegación, distinto al del certificado). */
    cuit: string
    ta: TicketAcceso
}

export class ErrorWsfe extends Error {
    constructor(
        message: string,
        readonly codigo: number | string | null = null,
        readonly crudo: string | null = null,
        /** true si reintentar el mismo request es seguro. */
        readonly transitorio = false,
    ) {
        super(message)
        this.name = 'ErrorWsfe'
    }
}

// -----------------------------------------------------------------------------
// Infraestructura SOAP
// -----------------------------------------------------------------------------

const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    // Todo como string: el CAE tiene 14 dígitos y los números de comprobante
    // se comparan como enteros. Dejar que el parser adivine tipos es cómo se
    // pierde un cero a la izquierda o se convierte "00012" en 12 donde no debe.
    parseTagValue: false,
    trimValues: true,
})

function esc(v: string | number): string {
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

/** `Auth` va en todos los métodos menos FEDummy. */
function bloqueAuth(ctx: ContextoWsfe): string {
    return (
        '<ar:Auth>' +
        `<ar:Token>${esc(ctx.ta.token)}</ar:Token>` +
        `<ar:Sign>${esc(ctx.ta.sign)}</ar:Sign>` +
        `<ar:Cuit>${esc(ctx.cuit)}</ar:Cuit>` +
        '</ar:Auth>'
    )
}

function sobre(metodo: string, cuerpo: string): string {
    return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS_FEV1}">` +
        '<soapenv:Header/><soapenv:Body>' +
        `<ar:${metodo}>${cuerpo}</ar:${metodo}>` +
        '</soapenv:Body></soapenv:Envelope>'
    )
}

/** Devuelve siempre un array, tenga el XML uno o muchos elementos. */
export function comoArray<T>(v: T | T[] | undefined | null): T[] {
    if (v === undefined || v === null) return []
    return Array.isArray(v) ? v : [v]
}

/**
 * Ejecuta un método de WSFEv1.
 *
 * `reintentable` es false por defecto para FECAESolicitar: si el request se
 * cortó por timeout, ARCA pudo haber otorgado el CAE igual. Reintentar a ciegas
 * duplica el comprobante. El camino correcto en ese caso es FECompConsultar.
 */
async function llamar(
    metodo: string,
    cuerpo: string,
    ambiente: AmbienteArca,
    reintentable = true,
): Promise<Record<string, unknown>> {
    const url = ENDPOINTS[ambiente].wsfe
    const body = sobre(metodo, cuerpo)
    const intentos = reintentable ? REINTENTOS_RED + 1 : 1
    let ultimo: ErrorWsfe | null = null

    for (let i = 0; i < intentos; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800 * i))

        let res: Response
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    SOAPAction: `${NS_FEV1}${metodo}`,
                },
                body,
                signal: AbortSignal.timeout(TIMEOUT_WSFE_MS),
                cache: 'no-store',
            })
        } catch (e) {
            const timeout = e instanceof Error && e.name === 'TimeoutError'
            ultimo = new ErrorWsfe(
                timeout
                    ? `ARCA no respondió a tiempo (${metodo}).`
                    : `No pudimos conectarnos con ARCA (${metodo}).`,
                timeout ? 'timeout' : 'red',
                e instanceof Error ? e.message : String(e),
                true,
            )
            continue
        }

        const xml = await res.text()

        const fault = xml.match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i)?.[1]
        if (fault) {
            throw new ErrorWsfe(fault.trim(), 'soap_fault', xml.slice(0, 2000))
        }
        if (!res.ok) {
            ultimo = new ErrorWsfe(
                `ARCA respondió HTTP ${res.status} (${metodo}).`,
                `http_${res.status}`,
                xml.slice(0, 2000),
                res.status >= 500,
            )
            if (res.status >= 500) continue
            throw ultimo
        }

        const parsed = parser.parse(xml) as Record<string, any>
        const resultado = parsed?.Envelope?.Body?.[`${metodo}Response`]?.[`${metodo}Result`]
        if (resultado === undefined) {
            throw new ErrorWsfe(
                `ARCA devolvió una respuesta inesperada en ${metodo}.`,
                'respuesta_inesperada',
                xml.slice(0, 2000),
            )
        }
        return resultado as Record<string, unknown>
    }

    throw ultimo ?? new ErrorWsfe(`No se pudo ejecutar ${metodo}.`, 'desconocido')
}

/**
 * Levanta el array `Errors` de una respuesta.
 *
 * Existe porque `Errors` vacío NO significa éxito — hay que mirar `Resultado`
 * también. Es exactamente el patrón del Known Risk #5 del CLAUDE.md: chequear
 * el error de cada operación en vez de asumir que salió bien.
 */
function errores(resultado: Record<string, any>): { code: number; msg: string }[] {
    return comoArray<any>(resultado?.Errors?.Err).map((e) => ({
        code: Number(e?.Code ?? 0),
        msg: String(e?.Msg ?? '').trim(),
    }))
}

function lanzarSiHayErrores(resultado: Record<string, any>, metodo: string): void {
    const errs = errores(resultado)
    if (errs.length === 0) return
    const principal = errs[0]
    // 500/501/502 son fallas internas de ARCA, no del comprobante.
    const transitorio = [500, 501, 502].includes(principal.code)
    throw new ErrorWsfe(
        errs.map((e) => `${e.code}: ${e.msg}`).join(' · '),
        principal.code,
        JSON.stringify(errs),
        transitorio,
    )
}

// -----------------------------------------------------------------------------
// Métodos
// -----------------------------------------------------------------------------

export interface EstadoServidores {
    appServer: string
    dbServer: string
    authServer: string
    todoOk: boolean
}

/**
 * Health-check. No lleva `Auth`, así que sirve para distinguir "ARCA está
 * caída" de "tu configuración está mal" ANTES de culpar al usuario.
 */
export async function feDummy(ambiente: AmbienteArca): Promise<EstadoServidores> {
    const r = await llamar('FEDummy', '', ambiente)
    const app = String((r as any).AppServer ?? '')
    const db = String((r as any).DbServer ?? '')
    const auth = String((r as any).AuthServer ?? '')
    return {
        appServer: app,
        dbServer: db,
        authServer: auth,
        todoOk: [app, db, auth].every((s) => s.toUpperCase() === 'OK'),
    }
}

export interface PuntoVentaArca {
    numero: number
    emisionTipo: string
    bloqueado: boolean
    fechaBaja: string | null
    /** Un PV bloqueado o dado de baja no sirve para facturar. */
    utilizable: boolean
}

/**
 * Lista los puntos de venta habilitados del contribuyente.
 *
 * Es la llamada más valiosa de todo el onboarding: valida de una sola vez que
 * el certificado sirve, que el servicio está autorizado y que existe un punto
 * de venta — y además evita que el usuario tipee el número a mano.
 * Array vacío = no creó el punto de venta (o lo creó del tipo equivocado).
 */
export async function feParamGetPtosVenta(ctx: ContextoWsfe): Promise<PuntoVentaArca[]> {
    const r = await llamar('FEParamGetPtosVenta', bloqueAuth(ctx), ctx.ambiente)
    lanzarSiHayErrores(r, 'FEParamGetPtosVenta')
    return comoArray<any>((r as any)?.ResultGet?.PtoVenta).map((p) => {
        const bloqueado = String(p?.Bloqueado ?? 'N').toUpperCase() === 'S'
        const fechaBaja = p?.FchBaja ? String(p.FchBaja) : null
        const dadoDeBaja = !!fechaBaja && fechaBaja !== 'NULL' && fechaBaja !== ''
        return {
            numero: Number(p?.Nro ?? 0),
            emisionTipo: String(p?.EmisionTipo ?? ''),
            bloqueado,
            fechaBaja: dadoDeBaja ? fechaBaja : null,
            utilizable: !bloqueado && !dadoDeBaja,
        }
    })
}

export interface TipoComprobanteArca {
    id: number
    descripcion: string
}

export async function feParamGetTiposCbte(ctx: ContextoWsfe): Promise<TipoComprobanteArca[]> {
    const r = await llamar('FEParamGetTiposCbte', bloqueAuth(ctx), ctx.ambiente)
    lanzarSiHayErrores(r, 'FEParamGetTiposCbte')
    return comoArray<any>((r as any)?.ResultGet?.CbteTipo).map((c) => ({
        id: Number(c?.Id ?? 0),
        descripcion: String(c?.Desc ?? '').trim(),
    }))
}

/** Tabla de condiciones frente al IVA del receptor (RG 5616). */
export async function feParamGetCondicionIvaReceptor(
    ctx: ContextoWsfe,
): Promise<{ id: number; descripcion: string }[]> {
    const r = await llamar('FEParamGetCondicionIvaReceptor', bloqueAuth(ctx), ctx.ambiente)
    lanzarSiHayErrores(r, 'FEParamGetCondicionIvaReceptor')
    return comoArray<any>((r as any)?.ResultGet?.CondicionIvaReceptor).map((c) => ({
        id: Number(c?.Id ?? 0),
        descripcion: String(c?.Desc ?? '').trim(),
    }))
}

/**
 * Último número autorizado para ese punto de venta y tipo.
 * El próximo comprobante tiene que ser EXACTAMENTE éste + 1 (validación 10016).
 */
export async function feCompUltimoAutorizado(
    ctx: ContextoWsfe,
    ptoVta: number,
    cbteTipo: number,
): Promise<number> {
    const cuerpo = bloqueAuth(ctx) + `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`
    const r = await llamar('FECompUltimoAutorizado', cuerpo, ctx.ambiente)
    lanzarSiHayErrores(r, 'FECompUltimoAutorizado')
    return Number((r as any)?.CbteNro ?? 0)
}

// -----------------------------------------------------------------------------
// Solicitud de CAE
// -----------------------------------------------------------------------------

export interface ItemIva {
    id: number
    baseImp: number
    importe: number
}

export interface CbteAsociado {
    tipo: number
    ptoVta: number
    nro: number
    cuit?: string
    fecha?: string
}

export interface DetalleComprobante {
    concepto: number
    docTipo: number
    docNro: number
    cbteDesde: number
    cbteHasta: number
    /** yyyymmdd */
    cbteFch: string
    impTotal: number
    impTotConc: number
    impNeto: number
    impOpEx: number
    impTrib: number
    impIVA: number
    /** Obligatorias si concepto es 2 o 3 (validación 10049). Formato yyyymmdd. */
    fchServDesde?: string
    fchServHasta?: string
    fchVtoPago?: string
    monId: string
    monCotiz: number
    condicionIVAReceptorId: number
    iva?: ItemIva[]
    cbtesAsoc?: CbteAsociado[]
}

export interface ResultadoCae {
    resultado: 'A' | 'P' | 'R'
    cae: string | null
    caeVto: string | null
    cbteDesde: number
    observaciones: { code: number; msg: string }[]
    errores: { code: number; msg: string }[]
    eventos: { code: number; msg: string }[]
    crudo: unknown
}

function num(n: number): string {
    // Dos decimales fijos. El margen de tolerancia de ARCA es 0,01 y la
    // notación científica de JS para números chicos rompe el parseo del lado de
    // ellos, así que nunca se manda el número "tal cual".
    return n.toFixed(2)
}

/**
 * Arma el `FECAEDetRequest`.
 *
 * EL ORDEN DE LOS TAGS IMPORTA: el XSD es un `xsd:sequence`, así que reordenar
 * campos "para que se lea mejor" hace que ARCA rechace el comprobante entero.
 */
function detalleXml(d: DetalleComprobante): string {
    const partes: string[] = [
        `<ar:Concepto>${d.concepto}</ar:Concepto>`,
        `<ar:DocTipo>${d.docTipo}</ar:DocTipo>`,
        `<ar:DocNro>${d.docNro}</ar:DocNro>`,
        `<ar:CbteDesde>${d.cbteDesde}</ar:CbteDesde>`,
        `<ar:CbteHasta>${d.cbteHasta}</ar:CbteHasta>`,
        `<ar:CbteFch>${esc(d.cbteFch)}</ar:CbteFch>`,
        `<ar:ImpTotal>${num(d.impTotal)}</ar:ImpTotal>`,
        `<ar:ImpTotConc>${num(d.impTotConc)}</ar:ImpTotConc>`,
        `<ar:ImpNeto>${num(d.impNeto)}</ar:ImpNeto>`,
        `<ar:ImpOpEx>${num(d.impOpEx)}</ar:ImpOpEx>`,
        `<ar:ImpTrib>${num(d.impTrib)}</ar:ImpTrib>`,
        `<ar:ImpIVA>${num(d.impIVA)}</ar:ImpIVA>`,
    ]

    if (d.fchServDesde) partes.push(`<ar:FchServDesde>${esc(d.fchServDesde)}</ar:FchServDesde>`)
    if (d.fchServHasta) partes.push(`<ar:FchServHasta>${esc(d.fchServHasta)}</ar:FchServHasta>`)
    if (d.fchVtoPago) partes.push(`<ar:FchVtoPago>${esc(d.fchVtoPago)}</ar:FchVtoPago>`)

    partes.push(`<ar:MonId>${esc(d.monId)}</ar:MonId>`)
    partes.push(`<ar:MonCotiz>${d.monCotiz}</ar:MonCotiz>`)
    partes.push(`<ar:CondicionIVAReceptorId>${d.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>`)

    if (d.cbtesAsoc?.length) {
        partes.push(
            '<ar:CbtesAsoc>' +
            d.cbtesAsoc
                .map(
                    (c) =>
                        '<ar:CbteAsoc>' +
                        `<ar:Tipo>${c.tipo}</ar:Tipo>` +
                        `<ar:PtoVta>${c.ptoVta}</ar:PtoVta>` +
                        `<ar:Nro>${c.nro}</ar:Nro>` +
                        (c.cuit ? `<ar:Cuit>${esc(c.cuit)}</ar:Cuit>` : '') +
                        (c.fecha ? `<ar:CbteFch>${esc(c.fecha)}</ar:CbteFch>` : '') +
                        '</ar:CbteAsoc>',
                )
                .join('') +
            '</ar:CbtesAsoc>',
        )
    }

    // En Factura C el array de IVA NO se manda (validación 10071). No es que
    // vaya en cero: no va.
    if (d.iva?.length) {
        partes.push(
            '<ar:Iva>' +
            d.iva
                .map(
                    (i) =>
                        '<ar:AlicIva>' +
                        `<ar:Id>${i.id}</ar:Id>` +
                        `<ar:BaseImp>${num(i.baseImp)}</ar:BaseImp>` +
                        `<ar:Importe>${num(i.importe)}</ar:Importe>` +
                        '</ar:AlicIva>',
                )
                .join('') +
            '</ar:Iva>',
        )
    }

    return `<ar:FECAEDetRequest>${partes.join('')}</ar:FECAEDetRequest>`
}

/**
 * Pide el CAE.
 *
 * NO reintenta ante error de red: si el request se cortó después de que ARCA
 * autorizó, un reintento emitiría el mismo número dos veces. Ante timeout, el
 * llamador tiene que reconciliar con `feCompConsultar`.
 */
export async function feCaeSolicitar(
    ctx: ContextoWsfe,
    ptoVta: number,
    cbteTipo: number,
    detalle: DetalleComprobante,
): Promise<ResultadoCae> {
    const cuerpo =
        bloqueAuth(ctx) +
        '<ar:FeCAEReq>' +
        '<ar:FeCabReq>' +
        '<ar:CantReg>1</ar:CantReg>' +
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
        '</ar:FeCabReq>' +
        `<ar:FeDetReq>${detalleXml(detalle)}</ar:FeDetReq>` +
        '</ar:FeCAEReq>'

    const r = await llamar('FECAESolicitar', cuerpo, ctx.ambiente, false)

    const errs = errores(r)
    const det: any =
        (r as any)?.FeDetResp?.FECAEDetResponse ??
        (r as any)?.FeDetResp?.FEDetResponse ??
        null
    const primero = Array.isArray(det) ? det[0] : det

    const resultadoCab = String((r as any)?.FeCabResp?.Resultado ?? '').toUpperCase()
    const resultadoDet = String(primero?.Resultado ?? '').toUpperCase()
    const resultado = (resultadoDet || resultadoCab || 'R') as 'A' | 'P' | 'R'

    return {
        resultado,
        // Un CAE en blanco con Resultado 'A' no existe, pero si llegara,
        // devolverlo como null es más honesto que devolver "".
        cae: primero?.CAE ? String(primero.CAE) : null,
        caeVto: primero?.CAEFchVto ? String(primero.CAEFchVto) : null,
        cbteDesde: Number(primero?.CbteDesde ?? detalle.cbteDesde),
        // El array se llama `Observaciones` (de tipo ArrayOfObs, cuyos items son
        // `Obs`), verificado contra el WSDL vivo. Leerlo de `Obs.Obs` deja las
        // observaciones SIEMPRE vacías — y ahí es donde WSFEv1 devuelve el
        // motivo del rechazo POR COMPROBANTE, con `Errors` vacío. Sin esto, el
        // diccionario de errores no se usa nunca y el reintento por 10016 es
        // código muerto. Se acepta también `Obs` por si alguna respuesta vieja
        // lo trae así.
        observaciones: comoArray<any>(primero?.Observaciones?.Obs ?? primero?.Obs?.Obs).map((o) => ({
            code: Number(o?.Code ?? 0),
            msg: String(o?.Msg ?? '').trim(),
        })),
        errores: errs,
        eventos: comoArray<any>((r as any)?.Events?.Evt).map((e) => ({
            code: Number(e?.Code ?? 0),
            msg: String(e?.Msg ?? '').trim(),
        })),
        crudo: r,
    }
}

export interface ComprobanteConsultado {
    existe: boolean
    cae: string | null
    caeVto: string | null
    resultado: string | null
    impTotal: number | null
    cbteFch: string | null
    crudo: unknown
}

/**
 * Consulta un comprobante ya emitido.
 *
 * Es la pieza de reconciliación: cuando `feCaeSolicitar` se corta por timeout no
 * se sabe si ARCA autorizó o no, y volver a pedir el CAE del mismo número puede
 * duplicarlo. Esto lo resuelve preguntando.
 *
 * Error 602 ("No existen datos en nuestros registros") NO es una falla: es la
 * respuesta que confirma que el comprobante nunca se emitió.
 */
export async function feCompConsultar(
    ctx: ContextoWsfe,
    ptoVta: number,
    cbteTipo: number,
    cbteNro: number,
): Promise<ComprobanteConsultado> {
    const cuerpo =
        bloqueAuth(ctx) +
        '<ar:FeCompConsReq>' +
        `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
        `<ar:CbteNro>${cbteNro}</ar:CbteNro>` +
        `<ar:PtoVta>${ptoVta}</ar:PtoVta>` +
        '</ar:FeCompConsReq>'

    const r = await llamar('FECompConsultar', cuerpo, ctx.ambiente)

    const errs = errores(r)
    if (errs.some((e) => e.code === 602)) {
        return { existe: false, cae: null, caeVto: null, resultado: null, impTotal: null, cbteFch: null, crudo: r }
    }
    lanzarSiHayErrores(r, 'FECompConsultar')

    const g: any = (r as any)?.ResultGet
    if (!g) {
        return { existe: false, cae: null, caeVto: null, resultado: null, impTotal: null, cbteFch: null, crudo: r }
    }

    return {
        existe: !!g?.CodAutorizacion,
        cae: g?.CodAutorizacion ? String(g.CodAutorizacion) : null,
        caeVto: g?.FchVto ? String(g.FchVto) : null,
        resultado: g?.Resultado ? String(g.Resultado) : null,
        impTotal: g?.ImpTotal !== undefined ? Number(g.ImpTotal) : null,
        cbteFch: g?.CbteFch ? String(g.CbteFch) : null,
        crudo: r,
    }
}
