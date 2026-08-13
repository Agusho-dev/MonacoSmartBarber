// =============================================================================
// src/lib/arca/qr.ts
// Código QR obligatorio en la factura electrónica (RG 4892/2020).
// =============================================================================

/**
 * Base del QR.
 *
 * La especificación vigente dice `arca.gob.ar` (el ejemplo dentro del mismo PDF
 * todavía muestra `afip.gob.ar` porque no lo actualizaron). Se usa el que manda
 * la norma; el viejo redirige igual.
 */
const BASE_QR = 'https://www.arca.gob.ar/fe/qr/'

export interface DatosQr {
    /** Fecha de emisión en `yyyy-mm-dd` (RFC 3339). NO es el `yyyymmdd` de WSFEv1. */
    fecha: string
    /** CUIT del EMISOR, 11 dígitos. */
    cuit: string
    ptoVta: number
    tipoCmp: number
    nroCmp: number
    importe: number
    moneda?: string
    ctz?: number
    tipoDocRec?: number | null
    nroDocRec?: number | null
    /** El CAE. */
    codAut: string
}

/**
 * Arma la URL del QR.
 *
 * Dos detalles que rompen la validación del lector de ARCA si se hacen de más
 * o de menos:
 *
 *  1. `cuit`, `nroDocRec` y `codAut` van como NÚMEROS JSON, sin comillas. El
 *     ejemplo oficial es explícito. Un CAE de 14 dígitos entra sin pérdida en
 *     el double de JS (< 2^53), así que `Number()` es seguro acá.
 *
 *  2. Con consumidor final sin identificar (DocTipo 99 / DocNro 0), los campos
 *     del receptor son "de corresponder" → se OMITEN del JSON. Mandarlos en
 *     cero no es lo mismo que no mandarlos.
 */
export function urlQrArca(d: DatosQr): string {
    const payload: Record<string, unknown> = {
        ver: 1,
        fecha: d.fecha,
        cuit: Number(d.cuit),
        ptoVta: d.ptoVta,
        tipoCmp: d.tipoCmp,
        nroCmp: d.nroCmp,
        importe: Number(d.importe.toFixed(2)),
        moneda: d.moneda ?? 'PES',
        ctz: d.ctz ?? 1,
    }

    const identificado =
        d.tipoDocRec !== null && d.tipoDocRec !== undefined && d.tipoDocRec !== 99 &&
        d.nroDocRec !== null && d.nroDocRec !== undefined && Number(d.nroDocRec) > 0

    if (identificado) {
        payload.tipoDocRec = Number(d.tipoDocRec)
        payload.nroDocRec = Number(d.nroDocRec)
    }

    payload.tipoCodAut = 'E' // 'E' = CAE. 'A' sería CAEA, que no usamos.
    payload.codAut = Number(d.codAut)

    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    return `${BASE_QR}?p=${b64}`
}

/** Numeración legible del comprobante: `00003-00000127`. */
export function numeroFormateado(ptoVta: number, nro: number): string {
    return `${String(ptoVta).padStart(5, '0')}-${String(nro).padStart(8, '0')}`
}

/** `yyyymmdd` de ARCA → `dd/mm/yyyy` para mostrar. */
export function fechaArcaLegible(yyyymmdd: string | null | undefined): string {
    if (!yyyymmdd || yyyymmdd.length !== 8) return '—'
    return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`
}

/** `yyyymmdd` → `yyyy-mm-dd` (el QR usa guiones, WSFEv1 no). */
export function aFechaConGuiones(yyyymmdd: string): string {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}
