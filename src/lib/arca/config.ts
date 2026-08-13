// =============================================================================
// src/lib/arca/config.ts
// Constantes del dominio de facturación electrónica ARCA.
// =============================================================================

export type AmbienteArca = 'homologacion' | 'produccion'
export type CondicionIvaEmisor = 'monotributo' | 'responsable_inscripto' | 'exento'
export type ModoAuth = 'certificado_propio' | 'delegacion'

// -----------------------------------------------------------------------------
// Endpoints
//
// OJO CON EL DOMINIO. Verificado el 12/8/2026 inspeccionando los certificados
// TLS: `wsaa.afip.gov.ar` incluye `wsaa.arca.gob.ar` entre sus SAN, pero
// `servicios1.arca.gob.ar` NO ESTÁ CUBIERTO por el certificado de producción y
// la conexión falla en la verificación TLS. O sea que "migrar todo a arca.gob.ar
// porque AFIP ahora se llama ARCA" rompe producción.
//
// Los cuatro van por `.afip.gov.ar` — y es `.gov.ar` (gov), no `.gob.ar`: el
// sitio web es .gob.ar, los web services son .gov.ar. No es un typo.
// -----------------------------------------------------------------------------
export const ENDPOINTS: Record<AmbienteArca, { wsaa: string; wsfe: string }> = {
    homologacion: {
        wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    },
    produccion: {
        wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    },
}

/** Namespace de WSFEv1. Case-sensitive: `FEV1` en mayúsculas. */
export const NS_FEV1 = 'http://ar.gov.afip.dif.FEV1/'

/** El TA se pide para el servicio `wsfe`, no `wsfev1`. Dura 12 h. */
export const SERVICIO_WSAA = 'wsfe'

// -----------------------------------------------------------------------------
// Tipos de comprobante
// -----------------------------------------------------------------------------
export const CBTE = {
    FACTURA_A: 1,
    FACTURA_B: 6,
    FACTURA_C: 11,
    NOTA_DEBITO_A: 2,
    NOTA_DEBITO_B: 7,
    NOTA_DEBITO_C: 12,
    NOTA_CREDITO_A: 3,
    NOTA_CREDITO_B: 8,
    NOTA_CREDITO_C: 13,
} as const

export const NOMBRE_CBTE: Record<number, string> = {
    1: 'Factura A',
    2: 'Nota de Débito A',
    3: 'Nota de Crédito A',
    6: 'Factura B',
    7: 'Nota de Débito B',
    8: 'Nota de Crédito B',
    11: 'Factura C',
    12: 'Nota de Débito C',
    13: 'Nota de Crédito C',
}

export const LETRA_CBTE: Record<number, string> = {
    1: 'A', 2: 'A', 3: 'A',
    6: 'B', 7: 'B', 8: 'B',
    11: 'C', 12: 'C', 13: 'C',
}

/**
 * Qué factura emite cada condición fiscal a consumidor final.
 *
 * El monotributista y el exento emiten Factura C: no discriminan IVA — no es
 * que el IVA les dé cero, es que el concepto no existe en un comprobante C.
 * El responsable inscripto emite B, con el IVA informado al web service pero
 * NO discriminado en el papel.
 */
export function tipoFacturaPara(condicion: CondicionIvaEmisor): number {
    return condicion === 'responsable_inscripto' ? CBTE.FACTURA_B : CBTE.FACTURA_C
}

/** La nota de crédito de la misma clase que la factura. */
export function notaCreditoPara(cbteTipo: number): number {
    switch (cbteTipo) {
        case CBTE.FACTURA_A: return CBTE.NOTA_CREDITO_A
        case CBTE.FACTURA_B: return CBTE.NOTA_CREDITO_B
        default: return CBTE.NOTA_CREDITO_C
    }
}

// -----------------------------------------------------------------------------
// Condición frente al IVA del RECEPTOR (RG 5616)
//
// Campo `CondicionIVAReceptorId`, agregado en marzo 2025. El manual todavía lo
// lista como opcional pero ARCA ya anunció el rechazo duro (código 10246) y la
// obligatoriedad plena arranca el 1/9/2026 — o sea la semana que viene. Se
// manda SIEMPRE.
// -----------------------------------------------------------------------------
export const COND_IVA_RECEPTOR = {
    RESPONSABLE_INSCRIPTO: 1,
    SUJETO_EXENTO: 4,
    CONSUMIDOR_FINAL: 5,
    MONOTRIBUTO: 6,
    NO_CATEGORIZADO: 7,
    PROVEEDOR_EXTERIOR: 8,
    CLIENTE_EXTERIOR: 9,
    LIBERADO_19640: 10,
    MONOTRIBUTISTA_SOCIAL: 13,
    NO_ALCANZADO: 15,
    MONOTRIBUTO_PROMOVIDO: 16,
} as const

export const NOMBRE_COND_IVA_RECEPTOR: Record<number, string> = {
    1: 'IVA Responsable Inscripto',
    4: 'IVA Sujeto Exento',
    5: 'Consumidor Final',
    6: 'Responsable Monotributo',
    7: 'Sujeto No Categorizado',
    8: 'Proveedor del Exterior',
    9: 'Cliente del Exterior',
    10: 'IVA Liberado – Ley 19.640',
    13: 'Monotributista Social',
    15: 'IVA No Alcanzado',
    16: 'Monotributo Trabajador Independiente Promovido',
}

// -----------------------------------------------------------------------------
// Tipos de documento del receptor
// -----------------------------------------------------------------------------
export const DOC = {
    CUIT: 80,
    CUIL: 86,
    CDI: 87,
    DNI: 96,
    /** "Consumidor Final" — va con DocNro 0. */
    CONSUMIDOR_FINAL: 99,
} as const

/**
 * Tope a partir del cual hay que identificar al comprador.
 *
 * Hoy son $10.000.000 (RG 5700/2025, ratificado por RG 5866/2026 desde el
 * 1/7/2026). NO está hardcodeado en la lógica de emisión a propósito: el manual
 * de ARCA nunca escribe el número —dice "el monto que resulte de la RG"—
 * justamente porque lo actualizan. Un corte de pelo no se acerca ni de casualidad,
 * pero si algún día se factura un paquete grande, esto es lo que hay que tocar.
 */
export const TOPE_IDENTIFICACION_CONSUMIDOR_FINAL = 10_000_000

// -----------------------------------------------------------------------------
// Alícuotas de IVA (FEParamGetTiposIva)
// -----------------------------------------------------------------------------
export const ALICUOTA_IVA = {
    CERO: 3,
    DIEZ_CINCO: 4,
    VEINTIUNO: 5,
    VEINTISIETE: 6,
    CINCO: 8,
    DOS_CINCO: 9,
} as const

export const PORCENTAJE_ALICUOTA: Record<number, number> = {
    3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5,
}

// -----------------------------------------------------------------------------
// Concepto
// -----------------------------------------------------------------------------
export const CONCEPTO = {
    PRODUCTOS: 1,
    SERVICIOS: 2,
    PRODUCTOS_Y_SERVICIOS: 3,
} as const

/**
 * Cuántos días puede desviarse `CbteFch` de hoy, según el concepto.
 * Validación 10016: ±5 para productos, ±10 para servicios.
 */
export function margenDiasFecha(concepto: number): number {
    return concepto === CONCEPTO.PRODUCTOS ? 5 : 10
}

// -----------------------------------------------------------------------------
// Timeouts
//
// Los servidores de ARCA son lentos y se caen seguido. 20 s es holgado para una
// emisión y corto para no comerse el límite de la función serverless.
// -----------------------------------------------------------------------------
export const TIMEOUT_WSAA_MS = 15_000
export const TIMEOUT_WSFE_MS = 20_000
export const REINTENTOS_RED = 2

/** URLs del portal de ARCA para guiar al usuario. */
export const PORTAL_ARCA = {
    login: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml',
    portal: 'https://portalcf.cloud.afip.gob.ar/portal/app/',
    wsassHomologacion: 'https://wsass-homo.afip.gob.ar/wsass/portal/main.aspx',
    docDelegacion: 'https://www.afip.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf',
    docCertificados: 'https://www.afip.gob.ar/ws/documentacion/certificados.asp',
} as const
