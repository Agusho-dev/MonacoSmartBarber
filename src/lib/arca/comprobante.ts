// =============================================================================
// src/lib/arca/comprobante.ts
// La aritmética del comprobante. Sin red, sin base de datos: entra una venta,
// sale un FECAEDetRequest válido.
//
// TODO EL DINERO SE MANEJA EN CENTAVOS ENTEROS.
// ARCA valida que ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA
// con una tolerancia de UN centavo (validación 10048). Con floats, dividir por
// 1,21 y volver a sumar cae afuera de esa tolerancia cada tanto — y "cada tanto"
// en una barbería con 2.500 cortes por mes es todos los días.
// =============================================================================

import {
    ALICUOTA_IVA,
    CBTE,
    CONCEPTO,
    COND_IVA_RECEPTOR,
    DOC,
    margenDiasFecha,
    tipoFacturaPara,
    type CondicionIvaEmisor,
} from './config'
import type { DetalleComprobante, ItemIva } from './wsfe'

/** 21% expresado como fracción entera para no tocar floats en el camino crítico. */
const IVA_21_NUMERADOR = 121
const IVA_21_DENOMINADOR = 100

export interface VentaAFacturar {
    /** Importe final que pagó el cliente, en CENTAVOS. */
    totalCentavos: number
    /** Condición fiscal de quien emite. Define si sale Factura B o C. */
    condicionEmisor: CondicionIvaEmisor
    /** Fecha de EMISIÓN, de pared de la sucursal, `yyyy-mm-dd`. NUNCA derivada de toISOString(). */
    fechaLocal: string
    /**
     * Fecha en que se PRESTÓ el servicio, si no es la misma que la de emisión.
     *
     * Separarlas no es un lujo: cuando se factura un corte de hace tres días,
     * fechar el comprobante ese día podría violar la monotonía que exige ARCA
     * (`CbteFch` nunca menor a la del último autorizado, validación 10016) y
     * dejar el punto de venta trabado. El comprobante se emite HOY y el período
     * de servicio dice cuándo se prestó — que además es lo correcto.
     */
    fechaServicioLocal?: string
    /** Por defecto consumidor final sin identificar. */
    docTipo?: number
    docNro?: number
    condicionIvaReceptorId?: number
    /** 1 productos, 2 servicios, 3 ambos. Un corte de pelo es 2. */
    concepto?: number
}

export interface ComprobanteArmado {
    cbteTipo: number
    detalle: Omit<DetalleComprobante, 'cbteDesde' | 'cbteHasta'>
    /** Desglose en centavos, para guardar y auditar sin recalcular. */
    centavos: { total: number; neto: number; iva: number }
}

/** `yyyy-mm-dd` → `yyyymmdd`, que es el formato de ARCA. */
export function aFormatoArca(fechaLocal: string): string {
    return fechaLocal.replace(/-/g, '')
}

/** Centavos → número con 2 decimales, listo para el XML. */
export function aPesos(centavos: number): number {
    return Math.round(centavos) / 100
}

/**
 * Desglosa un total final en neto + IVA 21%, en centavos y sin pérdida.
 *
 * El IVA se calcula como RESTO (total − neto) en vez de calcularlo aparte.
 * Así la suma cierra exacta por construcción y no por suerte de redondeo.
 */
export function desglosarIva21(totalCentavos: number): { neto: number; iva: number } {
    const neto = Math.round((totalCentavos * IVA_21_DENOMINADOR) / IVA_21_NUMERADOR)
    return { neto, iva: totalCentavos - neto }
}

/**
 * Arma el comprobante para una venta.
 *
 * Las dos ramas no son "la misma cuenta con IVA en cero":
 *
 *  · Factura C (monotributo / exento): ImpNeto = el total, y el array de IVA
 *    NO SE MANDA. Mandarlo vacío o en cero hace que ARCA rechace con 10071.
 *    El monotributista no discrimina IVA porque el concepto no existe en un
 *    comprobante C.
 *
 *  · Factura B (responsable inscripto): el IVA va desagregado al web service
 *    aunque en el papel no se discrimine, y el array de IVA es OBLIGATORIO
 *    cuando el neto es mayor a cero (validación 10070).
 */
export function armarComprobante(venta: VentaAFacturar): ComprobanteArmado {
    const total = Math.round(venta.totalCentavos)
    if (!Number.isFinite(total) || total <= 0) {
        throw new Error('El importe a facturar tiene que ser mayor a cero.')
    }

    const concepto = venta.concepto ?? CONCEPTO.SERVICIOS
    const cbteTipo = tipoFacturaPara(venta.condicionEmisor)
    const fechaArca = aFormatoArca(venta.fechaLocal)

    let neto: number
    let iva: number
    let itemsIva: ItemIva[] | undefined

    if (cbteTipo === CBTE.FACTURA_B || cbteTipo === CBTE.FACTURA_A) {
        const d = desglosarIva21(total)
        neto = d.neto
        iva = d.iva
        itemsIva = [{ id: ALICUOTA_IVA.VEINTIUNO, baseImp: aPesos(neto), importe: aPesos(iva) }]
    } else {
        neto = total
        iva = 0
        itemsIva = undefined
    }

    const detalle: Omit<DetalleComprobante, 'cbteDesde' | 'cbteHasta'> = {
        concepto,
        docTipo: venta.docTipo ?? DOC.CONSUMIDOR_FINAL,
        docNro: venta.docNro ?? 0,
        cbteFch: fechaArca,
        impTotal: aPesos(total),
        impTotConc: 0,
        impNeto: aPesos(neto),
        impOpEx: 0,
        impTrib: 0,
        impIVA: aPesos(iva),
        monId: 'PES',
        // Con MonId = PES la cotización tiene que ser exactamente 1 (10039).
        monCotiz: 1,
        condicionIVAReceptorId: venta.condicionIvaReceptorId ?? COND_IVA_RECEPTOR.CONSUMIDOR_FINAL,
        iva: itemsIva,
    }

    // Concepto 2 o 3 exige las tres fechas de servicio (validación 10049).
    // Un corte se presta y se cobra el mismo día, así que las tres son la fecha
    // del comprobante.
    if (concepto === CONCEPTO.SERVICIOS || concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS) {
        const fechaServicio = aFormatoArca(venta.fechaServicioLocal ?? venta.fechaLocal)
        detalle.fchServDesde = fechaServicio
        detalle.fchServHasta = fechaServicio
        // El vencimiento de pago va con la fecha del comprobante: el corte ya
        // está cobrado. Y ARCA exige FchVtoPago >= CbteFch, así que no puede
        // ser la del servicio cuando el servicio fue antes.
        detalle.fchVtoPago = fechaArca
    }

    return { cbteTipo, detalle, centavos: { total, neto, iva } }
}

/**
 * Verifica la identidad que ARCA valida en la 10048, antes de mandar.
 * Es barato y convierte un rechazo remoto en un error local con contexto.
 */
export function sumasCierran(d: Pick<DetalleComprobante,
    'impTotal' | 'impTotConc' | 'impNeto' | 'impOpEx' | 'impTrib' | 'impIVA'>): boolean {
    const suma = d.impTotConc + d.impNeto + d.impOpEx + d.impTrib + d.impIVA
    return Math.abs(suma - d.impTotal) <= 0.01
}

/**
 * ¿La fecha del comprobante entra en la ventana que acepta ARCA?
 *
 * Validación 10016: ±5 días para productos, ±10 para servicios. Además el
 * comprobante no puede tener fecha anterior a la del último autorizado de ese
 * punto de venta y tipo — eso se chequea aparte, contra el último emitido.
 */
export function fechaDentroDeVentana(
    fechaLocal: string,
    hoyLocal: string,
    concepto: number = CONCEPTO.SERVICIOS,
): { ok: boolean; diferenciaDias: number; margen: number } {
    const margen = margenDiasFecha(concepto)
    // Comparación por día calendario puro: se construyen ambos en UTC para que
    // la resta no arrastre horario de verano ni el huso del proceso.
    const a = Date.UTC(...partes(fechaLocal))
    const b = Date.UTC(...partes(hoyLocal))
    const diferenciaDias = Math.round((a - b) / 86_400_000)
    return { ok: Math.abs(diferenciaDias) <= margen, diferenciaDias, margen }
}

function partes(fecha: string): [number, number, number] {
    const [y, m, d] = fecha.split('-').map(Number)
    return [y, (m ?? 1) - 1, d ?? 1]
}

/**
 * Fecha de pared de una sucursal, `yyyy-mm-dd`.
 *
 * Existe para no volver a caer en la trampa que ya está documentada para
 * turnos: en Vercel el proceso corre en UTC, así que después de las 21:00 de
 * Argentina `toISOString().split('T')[0]` devuelve MAÑANA. Un CbteFch adelantado
 * un día rompe la monotonía de la numeración y deja la caja sin poder facturar
 * con la fecha correcta.
 */
export function fechaLocalDeSucursal(
    tz: string = 'America/Argentina/Buenos_Aires',
    momento: Date = new Date(),
): string {
    // `en-CA` produce yyyy-mm-dd, que es justo el formato que necesitamos.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(momento)
}
