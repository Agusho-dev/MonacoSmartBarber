// =============================================================================
// src/lib/mercadopago/errores.ts
// Traducción de los errores de Mercado Pago a algo que un dueño de barbería
// pueda accionar.
//
// Mercado Pago contesta cosas como `401 {"message":"invalid access token"}` o
// `400 {"message":"invalid_users_involved"}`. Eso no le dice a nadie qué hacer.
// Cada entrada de acá tiene tres partes deliberadas: QUÉ pasó, POR QUÉ, y QUÉ
// hacer ahora — el mismo criterio que `src/lib/arca/errores.ts`.
//
// El motivo tiene que llegar a la pantalla donde se produjo. Un "no se pudo
// crear el link de pago" en un toast de cinco segundos, con el detalle real
// enterrado en un log de Vercel, es exactamente cómo el dueño se queda sin
// saber que su cuenta está desconectada.
// =============================================================================

import { esErrorMercadoPago, type ErrorMercadoPago } from './http'

export interface ErrorMpTraducido {
    titulo: string
    detalle: string
    accion: string
    /** Código crudo, para el detalle técnico plegable y para `last_error`. */
    codigo: string
    /** ¿Tiene sentido volver a intentar lo mismo más tarde? */
    reintentable: boolean
}

const GENERICO: Omit<ErrorMpTraducido, 'codigo'> = {
    titulo: 'Mercado Pago no pudo procesar el pedido',
    detalle: 'Mercado Pago devolvió un error que no reconocemos.',
    accion: 'Probá de nuevo en un momento. Si sigue, revisá la conexión de la cuenta en Turnos → Seña.',
    reintentable: true,
}

/**
 * Errores identificados por el texto que manda Mercado Pago.
 *
 * Se buscan como SUBCADENA y no por igualdad porque MP no es consistente:
 * el mismo problema llega como `invalid access token`, `invalid_token` o
 * `Invalid access token` según el endpoint.
 */
const POR_TEXTO: { patron: RegExp; e: Omit<ErrorMpTraducido, 'codigo'> }[] = [
    {
        patron: /invalid[_ ]?(access[_ ])?token|unauthorized|not[_ ]?authenticated/i,
        e: {
            titulo: 'Mercado Pago rechazó las credenciales',
            detalle:
                'El access token de esta sucursal no sirve: puede haberse revocado desde Mercado Pago, o ser de otra cuenta.',
            accion: 'Volvé a conectar la cuenta de Mercado Pago de esta sucursal desde Turnos → Seña.',
            reintentable: false,
        },
    },
    {
        patron: /invalid[_ ]?grant/i,
        e: {
            titulo: 'La autorización de Mercado Pago venció',
            detalle:
                'El código de autorización dura 10 minutos y el que usamos ya no vale (o la sucursal revocó el permiso).',
            accion: 'Empezá de nuevo desde "Conectar Mercado Pago". No sirve recargar esta pantalla.',
            reintentable: false,
        },
    },
    {
        patron: /invalid[_ ]?users[_ ]?involved/i,
        e: {
            titulo: 'La cuenta que paga y la que cobra son la misma',
            detalle:
                'Mercado Pago no permite que alguien se pague a sí mismo. Suele pasar probando con la cuenta del negocio ' +
                'logueada en el mismo navegador.',
            accion: 'Probá el pago desde otra cuenta de Mercado Pago, o en una ventana privada con un usuario de prueba.',
            reintentable: false,
        },
    },
    {
        patron: /back[_ ]?url/i,
        e: {
            titulo: 'Mercado Pago rechazó la URL de retorno',
            detalle:
                'Las back_urls tienen que ser https y absolutas. Una sin "s" se descarta en silencio y el cliente termina ' +
                'en una pantalla en blanco.',
            accion: 'Revisá NEXT_PUBLIC_APP_URL: tiene que ser el dominio de producción, con https.',
            reintentable: false,
        },
    },
    {
        patron: /idempotency/i,
        e: {
            titulo: 'Falta la clave de idempotencia',
            detalle: 'Mercado Pago exige el header X-Idempotency-Key en las devoluciones (error 4292).',
            accion: 'Es un problema nuestro, no de la cuenta. Reportalo con el detalle técnico.',
            reintentable: false,
        },
    },
    {
        patron: /(not enough|insufficient).*(money|funds|balance)|saldo/i,
        e: {
            titulo: 'No hay saldo para devolver',
            detalle:
                'La devolución necesita que la plata ya esté acreditada y disponible en la cuenta de la sucursal. ' +
                'Si el cobro es de hoy, puede no haberse liberado todavía.',
            accion: 'Reintentá la devolución más tarde, o dejá saldo disponible en la cuenta de Mercado Pago.',
            reintentable: true,
        },
    },
    {
        patron: /already[_ ]?refunded|refund.*exceed/i,
        e: {
            titulo: 'Ese pago ya fue devuelto',
            detalle: 'Mercado Pago informa que el pago ya tiene una devolución por el total.',
            accion: 'No hay nada que hacer: verificá el movimiento en Mercado Pago antes de devolver de nuevo.',
            reintentable: false,
        },
    },
    {
        patron: /payment[_ ]?not[_ ]?found|resource not found/i,
        e: {
            titulo: 'Mercado Pago no encuentra ese pago',
            detalle:
                'El pago no existe en la cuenta con la que preguntamos. Casi siempre significa que la notificación vino ' +
                'de otra cuenta y la estamos consultando con el token equivocado.',
            accion: 'Verificá que la sucursal tenga conectada la cuenta correcta (el collector_id tiene que coincidir).',
            reintentable: false,
        },
    },
]

/** Errores identificados por status HTTP, cuando el cuerpo no dice nada útil. */
const POR_STATUS: Record<number, Omit<ErrorMpTraducido, 'codigo'>> = {
    400: {
        titulo: 'Mercado Pago rechazó los datos del pago',
        detalle: 'Alguno de los campos que mandamos no le gustó a Mercado Pago.',
        accion: 'Es un problema nuestro. Reportalo con el detalle técnico de abajo.',
        reintentable: false,
    },
    401: {
        titulo: 'Mercado Pago rechazó las credenciales',
        detalle: 'El access token de esta sucursal no es válido o fue revocado.',
        accion: 'Volvé a conectar la cuenta de Mercado Pago de esta sucursal desde Turnos → Seña.',
        reintentable: false,
    },
    403: {
        titulo: 'La cuenta de Mercado Pago no tiene permiso',
        detalle:
            'La cuenta conectada existe pero no está habilitada para esta operación. Suele pasar cuando la autorización ' +
            'se otorgó con permisos recortados.',
        accion: 'Volvé a conectar la cuenta aceptando todos los permisos que pide la pantalla de Mercado Pago.',
        reintentable: false,
    },
    404: {
        titulo: 'Mercado Pago no encontró el recurso',
        detalle: 'El pago o la preferencia no existen en la cuenta con la que consultamos.',
        accion: 'Verificá que la sucursal tenga conectada la cuenta que efectivamente cobró.',
        reintentable: false,
    },
    409: {
        titulo: 'Mercado Pago está procesando otra operación igual',
        detalle: 'Dos pedidos idénticos llegaron casi al mismo tiempo.',
        accion: 'Esperá unos segundos y volvé a intentar.',
        reintentable: true,
    },
    429: {
        titulo: 'Demasiados pedidos a Mercado Pago',
        detalle: 'Mercado Pago limitó temporalmente la cantidad de llamadas desde esta cuenta.',
        accion: 'Esperá un minuto y probá de nuevo.',
        reintentable: true,
    },
}

/** El texto más específico que traiga el cuerpo de MP. */
function textoDelCuerpo(cuerpo: string | null): string | null {
    if (!cuerpo) return null
    try {
        const j = JSON.parse(cuerpo) as {
            message?: unknown
            error?: unknown
            cause?: { description?: unknown; code?: unknown }[]
        }
        // `cause[0].description` es lo más específico que manda MP; el `message`
        // de arriba suele ser genérico ("Invalid request").
        const causa = Array.isArray(j.cause) ? j.cause[0] : undefined
        if (causa && typeof causa.description === 'string' && causa.description.trim()) {
            return causa.description.trim()
        }
        if (typeof j.message === 'string' && j.message.trim()) return j.message.trim()
        if (typeof j.error === 'string' && j.error.trim()) return j.error.trim()
    } catch {
        // Cuerpo no-JSON: el texto crudo, recortado, sigue siendo mejor que nada.
    }
    return cuerpo.trim().slice(0, 300) || null
}

function traducirHttp(e: ErrorMercadoPago): ErrorMpTraducido {
    const texto = textoDelCuerpo(e.cuerpo) ?? e.message
    const codigo = e.detalles.mpError ? `${e.status} ${e.detalles.mpError}` : String(e.status)

    for (const { patron, e: entrada } of POR_TEXTO) {
        if (patron.test(texto)) return { ...entrada, codigo }
    }

    const porStatus = POR_STATUS[e.status]
    if (porStatus) {
        // El detalle específico de MP gana sobre el genérico del status: es lo
        // que le permite a quien lee el dashboard entender el caso puntual.
        return {
            ...porStatus,
            detalle: texto && texto !== e.message ? `${porStatus.detalle} Mercado Pago dijo: "${texto}".` : porStatus.detalle,
            codigo,
        }
    }

    if (e.status >= 500) {
        return {
            titulo: 'Mercado Pago está teniendo problemas',
            detalle: 'Los servidores de Mercado Pago devolvieron un error. No es tu configuración.',
            accion: 'Probá de nuevo en unos minutos. Los pagos ya hechos no se pierden: el webhook los reintenta.',
            codigo,
            reintentable: true,
        }
    }

    return { ...GENERICO, detalle: texto || GENERICO.detalle, codigo }
}

/**
 * Traduce cualquier cosa que salga mal hablando con Mercado Pago.
 *
 * Acepta `unknown` a propósito: el llamador está en un `catch` y no tiene por
 * qué averiguar de qué tipo es lo que atrapó antes de poder mostrarlo.
 */
export function traducirErrorMp(e: unknown): ErrorMpTraducido {
    if (esErrorMercadoPago(e)) {
        if (e.detalles.codigo === 'timeout') {
            return {
                titulo: 'Mercado Pago tardó demasiado en responder',
                detalle: 'Cortamos la espera para no dejar la pantalla colgada. El pedido puede haberse procesado igual.',
                accion:
                    'Antes de reintentar, verificá si la operación quedó hecha (el link de pago, o el pago en Mercado Pago). ' +
                    'Repetir a ciegas puede duplicarla.',
                codigo: 'timeout',
                reintentable: true,
            }
        }
        if (e.detalles.codigo === 'red') {
            return {
                titulo: 'No pudimos conectarnos con Mercado Pago',
                detalle: e.causa
                    // El motivo real: `fetch failed` pelado no es diagnosticable.
                    ? `La conexión falló: ${e.causa}.`
                    : 'La conexión con Mercado Pago falló.',
                accion: 'Probá de nuevo en un momento.',
                codigo: 'red',
                reintentable: true,
            }
        }
        return traducirHttp(e)
    }

    if (e instanceof Error) {
        return { ...GENERICO, detalle: e.message, codigo: e.name || 'error' }
    }
    return { ...GENERICO, codigo: 'desconocido' }
}

/**
 * Una línea para guardar en `branch_payment_providers.last_error` o en el log
 * del webhook. Nunca incluye el token: lo único que entra acá es lo que ya
 * decidimos mostrarle al dueño.
 */
export function resumirErrorMp(e: unknown): string {
    const t = traducirErrorMp(e)
    return `${t.titulo} (${t.codigo}): ${t.detalle}`
}
