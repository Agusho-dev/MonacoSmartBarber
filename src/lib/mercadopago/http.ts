// =============================================================================
// src/lib/mercadopago/http.ts
// El transporte contra api.mercadopago.com.
//
// POR QUÉ ACÁ SÍ VA `fetch` Y EN ARCA NO
// --------------------------------------
// `src/lib/arca/http.ts` existe porque los servidores de ARCA negocian
// Diffie-Hellman con clave de 1024 bits y OpenSSL 3 aborta el handshake; para
// eso hay que bajar a `node:https` con un `Agent` propio. Mercado Pago negocia
// TLS moderno sin ayuda, así que copiar ese agente acá sería cargar con la
// complejidad de un problema que este endpoint no tiene.
//
// EL TIMEOUT DE SUPABASE NO NOS RECORTA
// -------------------------------------
// `src/lib/supabase/server.ts` define un fetch con AbortController de 8 s, pero
// NO pisa `globalThis.fetch`: lo pasa como `global.fetch` en las opciones del
// cliente de Supabase, o sea que sólo aplica a las requests que salen POR ese
// cliente. Verificado leyendo el archivo: `fetchWithTimeout` devuelve una
// función que envuelve al `fetch` del proceso y se entrega en la config, sin
// ninguna asignación a `global`/`globalThis`. Nuestro AbortController de 15-20 s
// manda, y una preferencia de MP que tarda 12 s no se corta a los 8.
//
// Si algún día alguien SÍ pisa el fetch global, este módulo sigue andando: usa
// la referencia capturada al importar (`fetchDelProceso`), no la busca en cada
// llamada.
//
// LO QUE NO SE LOGUEA
// -------------------
// El access_token, nunca. Ni entero, ni truncado, ni "para debuggear". Es la
// llave con la que se cobra en la cuenta de una persona.
// =============================================================================

const BASE = 'https://api.mercadopago.com'

/** Timeouts por tipo de operación. Leer es barato; crear un checkout no. */
export const TIMEOUT_LECTURA_MS = 15_000
export const TIMEOUT_ESCRITURA_MS = 20_000

// Referencia capturada al importar: si alguien pisa `globalThis.fetch` más
// tarde (Supabase no lo hace, pero un instrumentador podría), nuestras
// llamadas no heredan su timeout.
const fetchDelProceso: typeof fetch = globalThis.fetch.bind(globalThis)

/**
 * Todo lo que sale mal hablando con Mercado Pago.
 *
 * `cuerpo` es la parte que importa: MP contesta 400 con un JSON que dice
 * exactamente qué campo rechazó (`{"message":"invalid back_url","cause":[...]}`)
 * y sin guardarlo el error se vuelve un "400" pelado imposible de diagnosticar.
 * `causa` es el equivalente para los errores de red: un `TypeError: fetch
 * failed` no dice nada, el motivo real vive en `error.cause`.
 */
export class ErrorMercadoPago extends Error {
    readonly name = 'ErrorMercadoPago'

    constructor(
        message: string,
        readonly detalles: {
            /** HTTP status. 0 = ni siquiera hubo respuesta (red o timeout). */
            status: number
            /** El body crudo que devolvió MP. Acá vive el motivo real. */
            cuerpo: string | null
            /** El motivo que `fetch` esconde en `cause`. */
            causa: string | null
            /** ¿Tiene sentido repetir el mismo pedido? */
            reintentable: boolean
            /** Para logs y para `traducirErrorMp`. */
            codigo: 'http' | 'red' | 'timeout'
            /** Código de error propio de MP, cuando el body lo trae. */
            mpError?: string | null
        },
    ) {
        super(message)
    }

    get status(): number { return this.detalles.status }
    get cuerpo(): string | null { return this.detalles.cuerpo }
    get causa(): string | null { return this.detalles.causa }
    get reintentable(): boolean { return this.detalles.reintentable }
}

export function esErrorMercadoPago(e: unknown): e is ErrorMercadoPago {
    return e instanceof ErrorMercadoPago
}

export type MetodoMp = 'GET' | 'POST' | 'PUT'

export interface PeticionMp {
    metodo: MetodoMp
    /** Ruta con la barra inicial: '/checkout/preferences'. */
    ruta: string
    /** El access_token de ESA sucursal. Nunca uno global. */
    token: string
    body?: unknown
    query?: Record<string, string | number | undefined | null>
    /**
     * Obligatorio en los refunds (sin él MP devuelve 4292). Se acepta acá
     * porque es un header de transporte, no del negocio.
     */
    idempotencyKey?: string
    timeoutMs?: number
    /** Sólo se honra en GET. Ver `pedirAMercadoPago`. */
    reintentos?: number
}

/**
 * ¿Repetir este pedido puede dar otro resultado?
 *
 * 429 y 5xx son transitorios; 409 es una carrera. Todo el resto de los 4xx es
 * "lo que mandaste está mal" y reintentar sólo suma latencia y ruido.
 */
function esStatusReintentable(status: number): boolean {
    return status === 409 || status === 429 || status >= 500
}

/** Pesca el código de error propio de MP dentro del body, si lo trae. */
function codigoDeError(cuerpo: string | null): string | null {
    if (!cuerpo) return null
    try {
        const j = JSON.parse(cuerpo) as { error?: unknown; message?: unknown }
        if (typeof j.error === 'string' && j.error) return j.error
        if (typeof j.message === 'string' && j.message) return j.message
    } catch {
        // Body no-JSON (un HTML de error del balanceador, por ejemplo).
    }
    return null
}

function armarUrl(ruta: string, query?: PeticionMp['query']): string {
    const url = new URL(ruta.startsWith('/') ? ruta : `/${ruta}`, BASE)
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null || v === '') continue
            url.searchParams.set(k, String(v))
        }
    }
    return url.toString()
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Una llamada a la API de Mercado Pago.
 *
 * REINTENTOS SÓLO EN GET, a propósito. Un POST a `/checkout/preferences` que
 * dio timeout puede haber creado la preferencia igual: repetirlo deja dos links
 * de pago vivos para la misma reserva. Los POST que sí son seguros de repetir
 * —los refunds— lo son por el `X-Idempotency-Key`, y quien los repite es el
 * llamador, no este módulo.
 */
export async function pedirAMercadoPago<T>(p: PeticionMp): Promise<T> {
    const esLectura = p.metodo === 'GET'
    const timeoutMs = p.timeoutMs ?? (esLectura ? TIMEOUT_LECTURA_MS : TIMEOUT_ESCRITURA_MS)
    const intentosMax = esLectura ? Math.max(1, p.reintentos ?? 3) : 1

    const url = armarUrl(p.ruta, p.query)
    let ultimo: ErrorMercadoPago | null = null

    for (let intento = 1; intento <= intentosMax; intento++) {
        const control = new AbortController()
        const reloj = setTimeout(() => control.abort(), timeoutMs)

        try {
            const res = await fetchDelProceso(url, {
                method: p.metodo,
                headers: {
                    Authorization: `Bearer ${p.token}`,
                    Accept: 'application/json',
                    ...(p.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    ...(p.idempotencyKey ? { 'X-Idempotency-Key': p.idempotencyKey } : {}),
                },
                body: p.body !== undefined ? JSON.stringify(p.body) : undefined,
                signal: control.signal,
                cache: 'no-store',
            })

            const texto = await res.text()

            if (!res.ok) {
                const reintentable = esStatusReintentable(res.status)
                ultimo = new ErrorMercadoPago(
                    `Mercado Pago respondió ${res.status} en ${p.metodo} ${p.ruta}.`,
                    {
                        status: res.status,
                        cuerpo: texto || null,
                        causa: null,
                        reintentable,
                        codigo: 'http',
                        mpError: codigoDeError(texto || null),
                    },
                )
                if (reintentable && intento < intentosMax) {
                    await esperar(400 * intento)
                    continue
                }
                throw ultimo
            }

            if (!texto) return undefined as T
            try {
                return JSON.parse(texto) as T
            } catch {
                throw new ErrorMercadoPago(
                    `Mercado Pago devolvió una respuesta que no es JSON en ${p.metodo} ${p.ruta}.`,
                    { status: res.status, cuerpo: texto.slice(0, 500), causa: null, reintentable: false, codigo: 'http' },
                )
            }
        } catch (e) {
            if (esErrorMercadoPago(e)) {
                // Ya viene clasificado (o es el 4xx que decidimos no reintentar).
                if (e.reintentable && intento < intentosMax) {
                    ultimo = e
                    await esperar(400 * intento)
                    continue
                }
                throw e
            }

            const abortado = e instanceof Error && e.name === 'AbortError'
            // El motivo REAL de un `fetch failed` vive en `cause`. Perderlo es
            // lo que convierte un problema de DNS o de TLS en "error de red".
            const causa =
                e instanceof Error
                    ? ((e as Error & { cause?: unknown }).cause instanceof Error
                        ? ((e as Error & { cause: Error }).cause).message
                        : e.message)
                    : String(e)

            ultimo = new ErrorMercadoPago(
                abortado
                    ? `Mercado Pago no respondió en ${Math.round(timeoutMs / 1000)} s (${p.metodo} ${p.ruta}).`
                    : `No pudimos conectarnos con Mercado Pago (${p.metodo} ${p.ruta}).`,
                {
                    status: 0,
                    cuerpo: null,
                    causa,
                    reintentable: true,
                    codigo: abortado ? 'timeout' : 'red',
                },
            )

            if (intento < intentosMax) {
                await esperar(400 * intento)
                continue
            }
            throw ultimo
        } finally {
            clearTimeout(reloj)
        }
    }

    // Inalcanzable: el bucle sale por `return` o por `throw`. Está para que el
    // tipo de retorno no dependa de que TypeScript entienda el bucle.
    throw ultimo ?? new ErrorMercadoPago('Fallo desconocido hablando con Mercado Pago.', {
        status: 0, cuerpo: null, causa: null, reintentable: false, codigo: 'red',
    })
}

/**
 * El POST del OAuth (`/oauth/token`) NO lleva Authorization: se autentica con
 * el client_secret adentro del body. Por eso tiene su propio camino en vez de
 * pasarle un token vacío a `pedirAMercadoPago`, que lo mandaría como
 * `Bearer ` y haría que MP conteste un 401 confuso.
 */
export async function postSinToken<T>(ruta: string, body: unknown, timeoutMs = TIMEOUT_ESCRITURA_MS): Promise<T> {
    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), timeoutMs)
    try {
        const res = await fetchDelProceso(armarUrl(ruta), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
            signal: control.signal,
            cache: 'no-store',
        })
        const texto = await res.text()
        if (!res.ok) {
            throw new ErrorMercadoPago(`Mercado Pago respondió ${res.status} en POST ${ruta}.`, {
                status: res.status,
                cuerpo: texto || null,
                causa: null,
                reintentable: esStatusReintentable(res.status),
                codigo: 'http',
                mpError: codigoDeError(texto || null),
            })
        }
        return JSON.parse(texto) as T
    } catch (e) {
        if (esErrorMercadoPago(e)) throw e
        const abortado = e instanceof Error && e.name === 'AbortError'
        const causa =
            e instanceof Error
                ? ((e as Error & { cause?: unknown }).cause instanceof Error
                    ? ((e as Error & { cause: Error }).cause).message
                    : e.message)
                : String(e)
        throw new ErrorMercadoPago(
            abortado
                ? `Mercado Pago no respondió en ${Math.round(timeoutMs / 1000)} s (POST ${ruta}).`
                : `No pudimos conectarnos con Mercado Pago (POST ${ruta}).`,
            { status: 0, cuerpo: null, causa, reintentable: true, codigo: abortado ? 'timeout' : 'red' },
        )
    } finally {
        clearTimeout(reloj)
    }
}
