// =============================================================================
// src/lib/arca/wsaa.ts
// Autenticación contra WSAA: conseguir el Ticket de Acceso (Token + Sign).
//
// El TA dura 12 horas y ARCA NO deja pedir otro mientras haya uno vigente:
// contesta `coe.alreadyAuthenticated` y obliga a esperar (2 minutos en
// producción, 10 en homologación). O sea que cachear no es una optimización,
// es la única forma de que la segunda factura del día salga.
//
// En Vercel la memoria del proceso no sirve como cache: cada invocación puede
// caer en una instancia distinta. El TA vive en Supabase y el acceso se
// serializa con el lease de la migración 175.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { firmarTraCms } from './crypto'
import { postXml, ErrorHttpArca } from './http'
import {
    ENDPOINTS,
    SERVICIO_WSAA,
    TIMEOUT_WSAA_MS,
    type AmbienteArca,
} from './config'

export interface CredencialArca {
    /** `taxpayer:<uuid>` o `platform:<ambiente>`. Identifica al CERTIFICADO. */
    credentialKey: string
    ambiente: AmbienteArca
    certificatePem: string
    privateKeyPem: string
    /** Sólo para trazabilidad en la fila del token. */
    taxpayerId?: string | null
}

export interface TicketAcceso {
    token: string
    sign: string
    expira: Date
}

export class ErrorWsaa extends Error {
    constructor(
        message: string,
        readonly codigo: string | null = null,
        readonly crudo: string | null = null,
    ) {
        super(message)
        this.name = 'ErrorWsaa'
    }
}

// -----------------------------------------------------------------------------
// Ticket de Requerimiento de Acceso (TRA)
// -----------------------------------------------------------------------------

/**
 * Fecha ISO 8601 con offset explícito (`-03:00`), que es el formato del ejemplo
 * de la especificación. `toISOString()` produce `Z`, que también es válido en
 * xsd:dateTime, pero acá el costo de parecerse exactamente al ejemplo oficial
 * es cero y el de un rechazo por formato es una factura que no sale.
 */
function isoConOffset(d: Date, offsetMinutos = -180): string {
    const local = new Date(d.getTime() + offsetMinutos * 60_000)
    const p = (n: number) => String(n).padStart(2, '0')
    const signo = offsetMinutos >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMinutos)
    return (
        `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
        `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
        `${signo}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
    )
}

/**
 * Arma el TRA.
 *
 * `source` y `destination` son OPCIONALES y van deliberadamente omitidos: si se
 * mandan y no coinciden carácter por carácter con el DN del certificado, WSAA
 * responde `xml.source.invalid`. Omitidos, WSAA los deduce del certificado
 * firmante — que es siempre correcto por construcción.
 */
export function armarTra(servicio: string = SERVICIO_WSAA): string {
    const ahora = new Date()
    // `generationTime` 10 minutos atrás: absorbe un reloj corrido sin abrir una
    // ventana de reutilización grande.
    const desde = new Date(ahora.getTime() - 10 * 60_000)
    // `expirationTime` a 12 HORAS, y esto NO es un número al azar:
    //
    // WSAA **copia** este valor a la vigencia del Ticket de Acceso que emite.
    // Medido contra producción: con `expirationTime` = ahora + 10 min, el TA
    // devuelto vencía exactamente 10 minutos después. Y como el cache lo pide
    // con 10 minutos de margen, ese ticket no era reutilizable NUNCA: cada
    // emisión hubiera vuelto a WSAA, que rechaza el segundo pedido con
    // `coe.alreadyAuthenticated`. O sea, la primera factura salía y la segunda
    // no, hasta que venciera.
    //
    // 12 h es la duración documentada del TA y entra holgado en la tolerancia
    // de ±24 h que declara la especificación.
    const hasta = new Date(ahora.getTime() + 12 * 3600_000)
    const uniqueId = Math.floor(ahora.getTime() / 1000) % 4_294_967_295

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<loginTicketRequest version="1.0">',
        '<header>',
        `<uniqueId>${uniqueId}</uniqueId>`,
        `<generationTime>${isoConOffset(desde)}</generationTime>`,
        `<expirationTime>${isoConOffset(hasta)}</expirationTime>`,
        '</header>',
        `<service>${servicio}</service>`,
        '</loginTicketRequest>',
    ].join('')
}

// -----------------------------------------------------------------------------
// Llamada a loginCms
// -----------------------------------------------------------------------------

const NS_WSAA = 'http://wsaa.view.sua.dvadac.desein.afip.gov'

async function loginCms(cms: string, ambiente: AmbienteArca): Promise<{ token: string; sign: string; expira: Date }> {
    const sobre =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="${NS_WSAA}">` +
        '<soapenv:Header/><soapenv:Body>' +
        `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>` +
        '</soapenv:Body></soapenv:Envelope>'

    let res: { status: number; text: string }
    try {
        // Mismo motivo que en wsfe.ts: TLS. Ver src/lib/arca/http.ts.
        res = await postXml(ENDPOINTS[ambiente].wsaa, sobre, {
            soapAction: '',
            timeoutMs: TIMEOUT_WSAA_MS,
        })
    } catch (e) {
        const err = e instanceof ErrorHttpArca ? e : null
        const msg = err?.codigo === 'timeout'
            ? 'ARCA no respondió a tiempo al pedido de autenticación.'
            : 'No pudimos conectarnos con ARCA para autenticar.'
        throw new ErrorWsaa(msg, 'red', err?.causa ?? (e instanceof Error ? e.message : String(e)))
    }

    const xml = res.text

    // El SOAP Fault viaja con HTTP 500. Hay que leer el cuerpo igual, porque el
    // faultstring es el único lugar donde ARCA dice qué pasó de verdad.
    const fault = extraer(xml, 'faultstring')
    if (fault) {
        const codigo = (fault.match(/((?:coe|cms|xml|wsn|wsaa)\.[A-Za-z.]+)/)?.[1]) ?? null
        throw new ErrorWsaa(fault.trim(), codigo, xml.slice(0, 2000))
    }
    if (res.status < 200 || res.status >= 300) {
        throw new ErrorWsaa(`WSAA respondió HTTP ${res.status}.`, `http_${res.status}`, xml.slice(0, 2000))
    }

    const interno = extraer(xml, 'loginCmsReturn')
    if (!interno) {
        throw new ErrorWsaa('WSAA respondió sin el ticket de acceso.', 'respuesta_vacia', xml.slice(0, 2000))
    }

    const ticketXml = desescapar(interno)
    const token = extraer(ticketXml, 'token')
    const sign = extraer(ticketXml, 'sign')
    const expiration = extraer(ticketXml, 'expirationTime')

    if (!token || !sign) {
        throw new ErrorWsaa('El ticket de acceso vino incompleto.', 'ticket_incompleto', ticketXml.slice(0, 1000))
    }

    return {
        token,
        sign,
        // Si ARCA no mandara expirationTime, 12 h es la duración documentada.
        expira: expiration ? new Date(expiration) : new Date(Date.now() + 12 * 3600_000),
    }
}

/**
 * Extrae el contenido de un tag ignorando prefijos de namespace.
 * Se hace a mano y no con un parser XML porque el `loginCmsReturn` trae XML
 * escapado adentro: un parser genérico obliga a dos pasadas y a lidiar con
 * CDATA. Para cuatro tags conocidos, esto es más simple y más predecible.
 */
function extraer(xml: string, tag: string): string | null {
    const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i')
    return xml.match(re)?.[1] ?? null
}

function desescapar(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&')
        .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
        .trim()
}

// -----------------------------------------------------------------------------
// Obtención del TA con cache y lease
// -----------------------------------------------------------------------------

const ESPERA_ENTRE_INTENTOS_MS = 1_200
const MAX_INTENTOS = 6

function dormir(ms: number) {
    return new Promise((r) => setTimeout(r, ms))
}

/**
 * Devuelve un Ticket de Acceso vigente, pidiéndolo a WSAA sólo si hace falta.
 *
 * El protocolo con la base es:
 *   · `arca_ta_begin` devuelve un TA vigente, o dice si a este proceso le toca
 *     ir a buscarlo (lease).
 *   · Si le toca: habla con WSAA y guarda con `arca_ta_store`.
 *   · Si no le toca: espera y vuelve a preguntar — el que ganó el lease lo va a
 *     guardar en un segundo.
 *
 * `coe.alreadyAuthenticated` se trata como caso normal, no como error: quiere
 * decir que hay un TA vivo en algún lado y sólo hay que esperar a verlo.
 */
export async function obtenerTicketAcceso(
    cred: CredencialArca,
    servicio: string = SERVICIO_WSAA,
): Promise<TicketAcceso> {
    const supabase = createAdminClient()
    let ultimoError: ErrorWsaa | null = null

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        const { data, error } = await supabase.rpc('arca_ta_begin', {
            p_credential_key: cred.credentialKey,
            p_service: servicio,
            p_margin_seconds: 600,
            p_lease_seconds: 45,
            p_holder: `intento-${intento}`,
        })
        if (error) {
            throw new ErrorWsaa(`No pudimos leer el ticket de acceso guardado: ${error.message}`, 'db')
        }

        const fila = Array.isArray(data) ? data[0] : data
        if (fila?.token && fila?.sign) {
            return { token: fila.token, sign: fila.sign, expira: new Date(fila.expiration_time) }
        }

        if (!fila?.lease_acquired) {
            // Otro proceso está pidiéndolo. Esperar y volver a mirar.
            await dormir(ESPERA_ENTRE_INTENTOS_MS)
            continue
        }

        // Nos tocó ir a buscarlo.
        try {
            const tra = armarTra(servicio)
            const cms = firmarTraCms(tra, cred.certificatePem, cred.privateKeyPem)
            const ta = await loginCms(cms, cred.ambiente)

            const { error: errGuardar } = await supabase.rpc('arca_ta_store', {
                p_credential_key: cred.credentialKey,
                p_service: servicio,
                p_token: ta.token,
                p_sign: ta.sign,
                p_generation_time: new Date().toISOString(),
                p_expiration_time: ta.expira.toISOString(),
                p_taxpayer_id: cred.taxpayerId ?? null,
            })
            // Si falla el guardado el TA igual sirve para ESTA emisión, pero la
            // próxima va a chocar con alreadyAuthenticated. Se loguea fuerte.
            if (errGuardar) {
                console.error('[arca/wsaa] no se pudo cachear el TA:', errGuardar.message)
            }
            return ta
        } catch (e) {
            const err = e instanceof ErrorWsaa ? e : new ErrorWsaa(String(e))
            ultimoError = err
            await supabase.rpc('arca_ta_release', {
                p_credential_key: cred.credentialKey,
                p_service: servicio,
            })

            // Hay un TA vivo que no está en nuestra base (deploy nuevo, base
            // limpia, otro sistema usando el mismo certificado). No es un error
            // del usuario: hay que esperar a que venza y no reintentar en loop.
            if (err.codigo === 'coe.alreadyAuthenticated') {
                throw new ErrorWsaa(
                    'ARCA ya tiene una sesión abierta con este certificado y no permite abrir otra. ' +
                    'Suele resolverse solo en un par de minutos.',
                    err.codigo,
                    err.crudo,
                )
            }
            throw err
        }
    }

    throw ultimoError ?? new ErrorWsaa(
        'No pudimos obtener el ticket de acceso de ARCA (varios intentos simultáneos).',
        'lease_agotado',
    )
}
