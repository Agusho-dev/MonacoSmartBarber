// =============================================================================
// src/lib/mercadopago/firma.ts
// Verificación de la firma HMAC de los webhooks de Mercado Pago.
//
// POR QUÉ ESTE ARCHIVO EXISTE APARTE
// ----------------------------------
// Ya hay una verificación de firma en `src/lib/billing/mercadopago.ts`, la del
// webhook de suscripciones. Esa hace `if (!secret) return true`: sin secreto
// configurado, acepta cualquier POST. Para una suscripción de SaaS es una
// decisión defendible —lo peor que pasa es que alguien fuerce un refresh de
// estado—. Acá NO: lo que llega es un pago. Aceptar un webhook sin firma
// significa que cualquiera que sepa (o adivine) un `deposit_id` puede
// anunciarnos "este cliente pagó" y llevarse un turno confirmado sin poner un
// peso. Por eso esta implementación FALLA CERRADA: sin secreto, `ok: false`.
//
// EL ALGORITMO, TAL COMO LO DOCUMENTA MERCADO PAGO
// ------------------------------------------------
// Llega el header `x-signature: ts=<milisegundos>,v1=<hex>` y el header
// `x-request-id`. El manifest que se firma es EXACTAMENTE:
//
//     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
//
// con el punto y coma final incluido. Dos trampas conocidas:
//
//   · si `data.id` es alfanumérico, va en MINÚSCULAS;
//   · si falta `data.id` o `x-request-id`, ese par se ELIMINA del manifest
//     entero (no queda `id:;`).
//
// Y una tercera, la que más caro sale: LA UNIDAD DEL `ts`.
//
// La documentación de Mercado Pago dice milisegundos y muestra un ejemplo de 13
// dígitos; el SDK de Node lo trata como segundos. Contra producción, el 7/9/2026,
// las notificaciones reales llegaron en SEGUNDOS: ocho webhooks de un pago
// verdadero se rechazaron con "29.783.600 min de desfasaje" —56 años, que es
// exactamente la distancia entre 1970 y hoy cuando se leen segundos como
// milisegundos— y el cliente pagó sin que se le creara el turno.
//
// Por eso acá no se elige una unidad: se DEDUCE de la magnitud. Un timestamp de
// esta época tiene ~10 dígitos en segundos (1,7e9) y ~13 en milisegundos
// (1,7e12); el umbral de 1e11 los separa con siete órdenes de margen y sigue
// siendo válido hasta el año 5138. Si MP cambia de unidad, esto no se entera.
//
// El manifest sigue usando el `ts` CRUDO, tal como vino: la firma se calcula
// sobre el string, no sobre el número. Convertir acá no la afecta.
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto'

/** Cuánto puede haberse demorado una notificación antes de sospechar de un replay. */
const TOLERANCIA_MS = 15 * 60 * 1000

/**
 * Por debajo de esto el `ts` está en segundos; por encima, en milisegundos.
 * 1e11 son segundos hasta el año 5138 y milisegundos desde marzo de 1973: no
 * hay timestamp real de esta era que caiga del lado equivocado.
 */
const UMBRAL_SEGUNDOS = 1e11

export interface EntradaFirma {
    /** El header `x-signature` crudo. */
    signature: string | null | undefined
    /** El header `x-request-id` crudo. */
    requestId: string | null | undefined
    /** El query param `data.id` (o `id`) de la notificación. */
    dataId: string | null | undefined
    /** El secreto de ESA cuenta, ya descifrado. */
    secret: string | null | undefined
}

export interface ResultadoFirma {
    ok: boolean
    /** Por qué no validó. Va a `payment_webhook_events`, no al cuerpo de la respuesta. */
    motivo?: string
}

/** Parsea `ts=1700000000000,v1=abc...`. Tolera espacios y orden invertido. */
function partirSignature(header: string): { ts: string | null; v1: string | null } {
    let ts: string | null = null
    let v1: string | null = null
    for (const parte of header.split(',')) {
        const i = parte.indexOf('=')
        if (i < 0) continue
        const clave = parte.slice(0, i).trim()
        const valor = parte.slice(i + 1).trim()
        if (clave === 'ts') ts = valor
        else if (clave === 'v1') v1 = valor
    }
    return { ts, v1 }
}

/**
 * Compara dos hex en tiempo constante.
 *
 * `timingSafeEqual` TIRA si los buffers tienen distinto largo, así que el
 * chequeo de longitud va primero — y no filtra nada: el largo de un HMAC-SHA256
 * es público (64 caracteres hex).
 */
function igualesEnTiempoConstante(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
}

/**
 * ¿Esta notificación viene realmente de Mercado Pago?
 *
 * Nunca tira: devuelve `{ ok, motivo }`. El route handler necesita poder
 * registrar el intento fallido y contestar 401 sin que una excepción lo mande
 * a un 500 (que MP interpretaría como "reintentá", cuando lo que hay que hacer
 * es no volver a intentar).
 */
export function verificarFirmaWebhook(e: EntradaFirma): ResultadoFirma {
    const secret = (e.secret ?? '').trim()
    if (!secret) {
        // Falla CERRADA. Ver el encabezado: acá se confirman pagos.
        return { ok: false, motivo: 'La sucursal no tiene configurado el secreto del webhook de Mercado Pago.' }
    }

    const header = (e.signature ?? '').trim()
    if (!header) return { ok: false, motivo: 'Falta el header x-signature.' }

    const { ts, v1 } = partirSignature(header)
    if (!ts || !v1) return { ok: false, motivo: 'El header x-signature no trae ts y v1.' }

    // La unidad del `ts` se deduce de la magnitud, no se asume. Ver el encabezado.
    const tsCrudo = Number(ts)
    if (!Number.isFinite(tsCrudo) || tsCrudo <= 0) {
        return { ok: false, motivo: 'El ts de x-signature no es un número.' }
    }
    const tsMs = tsCrudo < UMBRAL_SEGUNDOS ? tsCrudo * 1000 : tsCrudo
    const desfasaje = Math.abs(Date.now() - tsMs)
    if (desfasaje > TOLERANCIA_MS) {
        return {
            ok: false,
            motivo: `La notificación llegó con ${Math.round(desfasaje / 60000)} min de desfasaje (máximo ${TOLERANCIA_MS / 60000}).`,
        }
    }

    // El manifest se arma en este orden y con el punto y coma FINAL. Los
    // segmentos cuyo valor no existe se omiten enteros.
    const partes: string[] = []
    const dataId = (e.dataId ?? '').trim()
    if (dataId) {
        // Alfanumérico → minúsculas. Lo pide la doc y es lo que rompe la
        // validación de los ids de merchant_order, que vienen con mayúsculas.
        partes.push(`id:${dataId.toLowerCase()};`)
    }
    const requestId = (e.requestId ?? '').trim()
    if (requestId) partes.push(`request-id:${requestId};`)
    partes.push(`ts:${ts};`)

    const manifest = partes.join('')
    const esperado = createHmac('sha256', secret).update(manifest).digest('hex')

    if (!igualesEnTiempoConstante(esperado, v1.toLowerCase())) {
        return { ok: false, motivo: 'La firma no coincide con el secreto de la cuenta.' }
    }
    return { ok: true }
}
