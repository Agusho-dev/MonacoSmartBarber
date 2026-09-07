// =============================================================================
// src/lib/mercadopago/checkout.ts
// Checkout Pro: crear la preferencia de pago, leer el pago y devolverlo.
//
// Cada función recibe el `access_token` de LA SUCURSAL como primer argumento.
// No hay ningún token por default ni ninguna variable de entorno global: el
// cobro de un turno de Rondeau tiene que entrar a la cuenta de Rondeau, y la
// única forma de garantizarlo es que sea imposible llamar a estas funciones sin
// decir con qué cuenta.
//
// LA FUENTE DE VERDAD ES `GET /v1/payments/{id}`, NUNCA EL RETORNO DEL BROWSER
// ----------------------------------------------------------------------------
// Los query params que Mercado Pago agrega a la `back_url` viajan por el
// browser del cliente y son falsificables: alguien puede abrir
// `/pago/<id>?status=approved` a mano. El webhook tampoco alcanza por sí solo,
// porque sólo trae el id. Lo único que confirma un pago es preguntárselo a la
// API con el token de esa cuenta.
// =============================================================================

import { randomUUID } from 'crypto'
import { getTzOffsetISO } from '@/lib/time-utils'
import { pedirAMercadoPago, ErrorMercadoPago, TIMEOUT_ESCRITURA_MS } from './http'

const TZ_ARGENTINA = 'America/Argentina/Buenos_Aires'

// ─────────────────────────────────────────────────────────────────────────────
// Fechas para Mercado Pago
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ISO-8601 CON OFFSET, que es lo único que acepta `expiration_date_from/to`
 * ("2026-09-03T10:00:00.000-03:00").
 *
 * No sirve `toISOString()`: manda la Z de UTC y MP la interpreta literalmente,
 * así que un link que vence en 30 minutos vencería tres horas antes de haber
 * nacido. El offset se resuelve con `getTzOffsetISO` en vez de hornear "-03:00"
 * porque es el mismo helper que usa el resto del repo y no asume que la
 * sucursal esté en Argentina.
 */
export function isoConOffset(instante: Date, timeZone: string = TZ_ARGENTINA): string {
    const offset = getTzOffsetISO(instante, timeZone)
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(instante)

    const v = (t: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === t)?.value ?? '00'
    // `hourCycle` h23 puede devolver "24" para la medianoche en algunos ICU.
    const hora = v('hour') === '24' ? '00' : v('hour')
    const ms = String(instante.getMilliseconds()).padStart(3, '0')

    return `${v('year')}-${v('month')}-${v('day')}T${hora}:${v('minute')}:${v('second')}.${ms}${offset}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferencia
// ─────────────────────────────────────────────────────────────────────────────

export interface PagadorPreferencia {
    email?: string | null
    nombre?: string | null
    apellido?: string | null
    telefono?: string | null
}

export interface PreferenciaInput {
    titulo: string
    descripcion?: string | null
    /** En pesos, no en centavos: MP trabaja en unidades. */
    monto: number
    /** El id de la seña. MP sólo acepta [A-Za-z0-9_-] y 64 chars: un UUID entra, "a:b" no. */
    externalReference: string
    /** URL absoluta y de PRODUCCIÓN. La de la preferencia PISA a la del panel de MP. */
    notificationUrl: string
    /** Base https a la que vuelve el cliente. Se le agrega `?estado=`. */
    backUrlBase: string
    /** Cuándo deja de servir el link. */
    expiraEn: Date
    /** true = sólo usuarios logueados en Mercado Pago (`purpose: wallet_purchase`). */
    walletOnly?: boolean
    payer?: PagadorPreferencia
    /** Viaja de vuelta en el pago: sirve para reconciliar sin consultar la base. */
    metadata?: Record<string, string>
    /** Lo que el cliente ve en el resumen de la tarjeta. Máx. 22 caracteres. */
    statementDescriptor?: string
    /** TZ de la sucursal, para las fechas de vencimiento. */
    timezone?: string
}

export interface PreferenciaCreada {
    id: string
    initPoint: string
}

const REF_VALIDA = /^[A-Za-z0-9_-]{1,64}$/

function exigirHttps(url: string, campo: string): string {
    let u: URL
    try {
        u = new URL(url)
    } catch {
        throw new Error(`La ${campo} de Mercado Pago no es una URL válida: ${url}`)
    }
    // Mercado Pago DESCARTA EN SILENCIO una back_url que no sea https, y el
    // cliente termina en una pantalla en blanco sin que nada haya fallado.
    if (u.protocol !== 'https:') {
        throw new Error(
            `La ${campo} de Mercado Pago tiene que ser https (llegó "${u.protocol}//"). ` +
            'Mercado Pago descarta las que no lo son, sin avisar.',
        )
    }
    return u.toString()
}

function conEstado(base: string, estado: 'exito' | 'pendiente' | 'error'): string {
    const u = new URL(base)
    u.searchParams.set('estado', estado)
    return u.toString()
}

/** Teléfono para MP: sólo dígitos, sin el 54 del país (que MP no espera acá). */
function telefonoParaMp(raw: string | null | undefined): { number: string } | undefined {
    const d = (raw ?? '').replace(/\D/g, '')
    if (!d) return undefined
    const sinPais = d.startsWith('54') ? d.slice(2) : d
    return sinPais ? { number: sinPais } : undefined
}

/**
 * Crea el link de pago de la seña.
 *
 * Las cuatro decisiones del body que NO son cosméticas:
 *
 *   · `binary_mode: true` elimina `pending` e `in_process`. Una seña tiene que
 *     resolverse aprobada o rechazada: un pago "en proceso" deja al cliente sin
 *     turno y a la sucursal sin poder vender ese horario, sin saber por cuánto
 *     tiempo.
 *   · `excluded_payment_types: ticket` saca Rapipago y Pago Fácil, que se
 *     acreditan a los tres días — para entonces el turno ya pasó. `account_money`
 *     NO se puede excluir nunca (MP lo rechaza), y tampoco haría falta.
 *   · `installments: 1`: la seña es un anticipo, no una compra financiada.
 *   · `expires` + las dos fechas: el link muere solo. Sin eso, un link viejo
 *     abierto en otra pestaña puede pagar un horario que ya pasó.
 */
export async function crearPreferencia(
    token: string,
    input: PreferenciaInput,
): Promise<PreferenciaCreada> {
    if (!REF_VALIDA.test(input.externalReference)) {
        throw new Error(
            `external_reference inválida para Mercado Pago ("${input.externalReference}"): ` +
            'sólo admite letras, números, guion y guion bajo, hasta 64 caracteres.',
        )
    }
    if (!Number.isFinite(input.monto) || input.monto <= 0) {
        throw new Error(`El monto de la seña tiene que ser positivo (llegó ${input.monto}).`)
    }

    const notificationUrl = exigirHttps(input.notificationUrl, 'notification_url')
    const backBase = exigirHttps(input.backUrlBase, 'back_url')
    const tz = input.timezone || TZ_ARGENTINA

    const payerNombre = (input.payer?.nombre ?? '').trim()
    const payerApellido = (input.payer?.apellido ?? '').trim()
    const payerEmail = (input.payer?.email ?? '').trim()
    const telefono = telefonoParaMp(input.payer?.telefono)

    const body: Record<string, unknown> = {
        items: [
            {
                id: input.externalReference,
                title: input.titulo.slice(0, 250),
                description: (input.descripcion ?? input.titulo).slice(0, 250),
                quantity: 1,
                currency_id: 'ARS',
                unit_price: input.monto,
                category_id: 'services',
            },
        ],
        external_reference: input.externalReference,
        notification_url: notificationUrl,
        back_urls: {
            success: conEstado(backBase, 'exito'),
            pending: conEstado(backBase, 'pendiente'),
            failure: conEstado(backBase, 'error'),
        },
        // Devuelve al cliente automáticamente sólo si aprobó. Ojo: el retorno
        // puede tardar hasta 40 s y NO es fuente de verdad (ver encabezado).
        auto_return: 'approved',
        binary_mode: true,
        payment_methods: {
            excluded_payment_types: [{ id: 'ticket' }],
            installments: 1,
            default_installments: 1,
        },
        expires: true,
        expiration_date_from: isoConOffset(new Date(), tz),
        expiration_date_to: isoConOffset(input.expiraEn, tz),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.statementDescriptor
            ? { statement_descriptor: input.statementDescriptor.slice(0, 22) }
            : {}),
    }

    // `wallet_purchase` restringe el checkout a quien esté logueado en Mercado
    // Pago: es el camino de menos fricción para quien tiene la app, pero deja
    // afuera al invitado. Por eso es una palanca de la config de la sucursal y
    // no un default.
    if (input.walletOnly) body.purpose = 'wallet_purchase'

    if (payerEmail || payerNombre || payerApellido || telefono) {
        body.payer = {
            ...(payerEmail ? { email: payerEmail } : {}),
            ...(payerNombre ? { name: payerNombre } : {}),
            ...(payerApellido ? { surname: payerApellido } : {}),
            ...(telefono ? { phone: telefono } : {}),
        }
    }

    const r = await pedirAMercadoPago<{ id?: string | number; init_point?: string }>({
        metodo: 'POST',
        ruta: '/checkout/preferences',
        token,
        body,
        timeoutMs: TIMEOUT_ESCRITURA_MS,
    })

    if (!r.id || !r.init_point) {
        throw new ErrorMercadoPago('Mercado Pago creó la preferencia pero no devolvió el link de pago.', {
            status: 200,
            cuerpo: JSON.stringify(r).slice(0, 500),
            causa: null,
            reintentable: false,
            codigo: 'http',
        })
    }

    // `sandbox_init_point` está deprecado: para probar se usa `init_point` con
    // credenciales de prueba, que es lo que resuelve `credenciales.ts` según el
    // `environment` de la sucursal.
    return { id: String(r.id), initPoint: r.init_point }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pago
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoPagoMp =
    | 'approved' | 'authorized' | 'in_process' | 'in_mediation'
    | 'rejected' | 'cancelled' | 'refunded' | 'charged_back' | 'pending'

export interface PagoMp {
    id: string
    status: EstadoPagoMp
    statusDetail: string | null
    /** Lo que se cobró, en pesos. Hay que compararlo contra el monto de la seña. */
    transactionAmount: number
    currencyId: string | null
    externalReference: string | null
    paymentMethodId: string | null
    paymentTypeId: string | null
    /** La cuenta que cobró. Confirma que el pago entró a la sucursal correcta. */
    collectorId: string | null
    /** Comisión de MP (6,29% + IVA en AR con acreditación al instante). */
    fee: number | null
    /** Lo que efectivamente le queda a la sucursal. */
    netReceivedAmount: number | null
    /** Cuándo se libera la plata. Es lo que hace posible una devolución. */
    moneyReleaseDate: string | null
    dateApproved: string | null
    liveMode: boolean | null
    metadata: Record<string, unknown> | null
}

/** La forma cruda de `/v1/payments/{id}`, en lo que nos importa. */
interface PagoCrudoMp {
    id?: number | string
    status?: string
    status_detail?: string
    transaction_amount?: number
    currency_id?: string
    external_reference?: string | null
    payment_method_id?: string
    payment_type_id?: string
    collector_id?: number | string
    live_mode?: boolean
    date_approved?: string | null
    money_release_date?: string | null
    fee_details?: { amount?: number }[]
    transaction_details?: { net_received_amount?: number }
    metadata?: Record<string, unknown>
}

function normalizarPago(p: PagoCrudoMp): PagoMp {
    // La comisión es la SUMA de `fee_details`: MP puede desglosar más de un
    // concepto (comisión + financiación) y quedarse con el primero subestima el
    // costo real del cobro.
    const fee = Array.isArray(p.fee_details)
        ? p.fee_details.reduce((a, f) => a + (typeof f.amount === 'number' ? f.amount : 0), 0)
        : null

    return {
        id: String(p.id ?? ''),
        status: (p.status ?? 'pending') as EstadoPagoMp,
        statusDetail: p.status_detail ?? null,
        transactionAmount: typeof p.transaction_amount === 'number' ? p.transaction_amount : 0,
        currencyId: p.currency_id ?? null,
        externalReference: p.external_reference ?? null,
        paymentMethodId: p.payment_method_id ?? null,
        paymentTypeId: p.payment_type_id ?? null,
        collectorId: p.collector_id !== undefined && p.collector_id !== null ? String(p.collector_id) : null,
        fee: fee !== null && Number.isFinite(fee) ? fee : null,
        netReceivedAmount:
            typeof p.transaction_details?.net_received_amount === 'number'
                ? p.transaction_details.net_received_amount
                : null,
        moneyReleaseDate: p.money_release_date ?? null,
        dateApproved: p.date_approved ?? null,
        liveMode: typeof p.live_mode === 'boolean' ? p.live_mode : null,
        metadata: p.metadata ?? null,
    }
}

/**
 * El estado real del pago. Es LA fuente de verdad de toda la seña: el webhook
 * sólo avisa que algo pasó y trae el id.
 */
export async function obtenerPago(token: string, paymentId: string): Promise<PagoMp> {
    const crudo = await pedirAMercadoPago<PagoCrudoMp>({
        metodo: 'GET',
        ruta: `/v1/payments/${encodeURIComponent(paymentId)}`,
        token,
    })
    return normalizarPago(crudo)
}

/**
 * Busca el pago por la referencia externa (el id de la seña).
 *
 * Es el camino de reconciliación: sirve cuando el webhook nunca llegó —MP tiene
 * caídas, y la notificación se pierde— y es lo que hace posible el botón "ya
 * pagué" de la pantalla de espera. Sin esto, un pago acreditado sin webhook deja
 * al cliente con la plata debitada y sin turno, para siempre.
 *
 * Devuelve el APROBADO si hay alguno: un cliente que reintenta deja varios
 * intentos rechazados y uno bueno, y quedarse con el más reciente devolvería el
 * rechazo cuando el bueno fue el primero.
 */
export async function buscarPagoPorReferencia(
    token: string,
    externalReference: string,
): Promise<PagoMp | null> {
    const r = await pedirAMercadoPago<{ results?: PagoCrudoMp[] }>({
        metodo: 'GET',
        ruta: '/v1/payments/search',
        token,
        query: {
            external_reference: externalReference,
            sort: 'date_created',
            criteria: 'desc',
            limit: 20,
        },
    })

    const pagos = (r.results ?? []).map(normalizarPago).filter((p) => p.id)
    if (!pagos.length) return null
    return pagos.find((p) => p.status === 'approved') ?? pagos[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// Devolución
// ─────────────────────────────────────────────────────────────────────────────

export interface DevolucionMp {
    id: string
    status: string
    amount: number | null
}

/**
 * Devuelve la seña. Sin `monto` es total; con `monto`, parcial.
 *
 * `X-Idempotency-Key` es OBLIGATORIO: sin él MP contesta 4292. Y no es un
 * trámite — es lo que impide que un reintento devuelva la plata dos veces
 * cuando la primera llamada dio timeout después de haber ejecutado.
 *
 * `claveIdempotencia` la manda el llamador cuando puede DERIVARLA de lo que
 * identifica a la devolución (`claveDevolucion` en `@/lib/senas/motor`), y ese
 * es el caso normal: un `randomUUID()` distinto en cada invocación convierte la
 * clave en decoración, porque el reintento —que es exactamente contra lo que
 * protege— trae otra. Ojo con el precio: dos devoluciones parciales legítimas
 * que compartan clave se ven como un reintento y la segunda devuelve el
 * resultado de la primera sin mover un peso, así que la clave tiene que incluir
 * lo que las distingue (monto y motivo).
 *
 * Sin clave se mintea una al azar, que es lo correcto para una llamada suelta
 * que nadie va a reintentar automáticamente.
 *
 * Requiere saldo disponible en la cuenta: si la plata todavía no se liberó
 * (`money_release_date` futura) MP rechaza y hay que reintentar más tarde.
 */
export async function devolverPago(
    token: string,
    paymentId: string,
    monto?: number,
    claveIdempotencia?: string,
): Promise<DevolucionMp> {
    const r = await pedirAMercadoPago<{ id?: number | string; status?: string; amount?: number }>({
        metodo: 'POST',
        ruta: `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
        token,
        // Body vacío = devolución total. `{}` y no `undefined`: MP espera un
        // JSON, aunque no lleve campos.
        body: monto !== undefined && monto > 0 ? { amount: monto } : {},
        idempotencyKey: claveIdempotencia || randomUUID(),
    })

    return {
        id: String(r.id ?? ''),
        status: r.status ?? 'unknown',
        amount: typeof r.amount === 'number' ? r.amount : null,
    }
}
