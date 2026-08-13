// =============================================================================
// src/lib/arca/http.ts
// El transporte HTTP contra ARCA. Existe por un solo motivo, y es TLS.
//
// EL PROBLEMA
// -----------
// `servicios1.afip.gov.ar` negocia Diffie-Hellman con una clave de 1024 bits.
// OpenSSL 3 —el que trae Node— exige 2048 como mínimo y aborta el handshake:
//
//     SSL routines:tls_process_ske_dhe: dh key too small
//
// El `fetch` global de Node no deja tocar opciones de TLS, y el error llega
// como un `TypeError: fetch failed` pelado: el motivo real está enterrado en
// `error.cause.message`. Por eso el síntoma era "No pudimos conectarnos con
// ARCA" y parecía un problema de red, cuando la red estaba perfecta (`curl` de
// macOS conecta sin chistar porque usa LibreSSL, que es más permisivo).
//
// LA SOLUCIÓN
// -----------
// `node:https` con una lista de cifrados que prioriza ECDHE y EXCLUYE DH/DHE.
// Medido contra los cuatro endpoints: los cuatro negocian
// `ECDHE-RSA-AES256-GCM-SHA384`.
//
// Ojo con la tentación de resolverlo con `DEFAULT@SECLEVEL=1`: también conecta,
// pero negocia el DHE de 1024 bits — o sea, baja la seguridad para usar
// justamente lo que está mal. Forzando ECDHE la conexión queda con forward
// secrecy y MÁS fuerte que el default, no más débil.
// =============================================================================

import https from 'node:https'

const CIFRADOS = [
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-SHA384',
    'ECDHE-RSA-AES128-SHA256',
    // Red de contención por si algún endpoint no ofreciera ECDHE. Nunca DH.
    'DEFAULT:!DH:!kDHE',
].join(':')

const agente = new https.Agent({
    keepAlive: true,
    minVersion: 'TLSv1.2',
    ciphers: CIFRADOS,
})

export class ErrorHttpArca extends Error {
    constructor(
        message: string,
        readonly codigo: 'timeout' | 'red',
        /** El motivo REAL, el que `fetch` escondía en `cause`. */
        readonly causa: string | null,
    ) {
        super(message)
        // El resto del módulo distingue el timeout por `name`.
        this.name = codigo === 'timeout' ? 'TimeoutError' : 'ErrorHttpArca'
    }
}

export interface RespuestaArca {
    status: number
    text: string
}

/**
 * POST de un XML a ARCA.
 *
 * Devuelve status y cuerpo aunque el status sea 500: los SOAP Fault de ARCA
 * viajan con 500 y el `faultstring` es el único lugar donde dice qué pasó.
 */
export function postXml(
    url: string,
    body: string,
    opts: { soapAction?: string; timeoutMs: number },
): Promise<RespuestaArca> {
    return new Promise((resolve, reject) => {
        let destino: URL
        try {
            destino = new URL(url)
        } catch {
            reject(new ErrorHttpArca(`URL inválida para ARCA: ${url}`, 'red', null))
            return
        }

        const payload = Buffer.from(body, 'utf8')
        const req = https.request(
            {
                protocol: destino.protocol,
                host: destino.hostname,
                port: destino.port || 443,
                path: destino.pathname + destino.search,
                method: 'POST',
                agent: agente,
                timeout: opts.timeoutMs,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'Content-Length': payload.byteLength,
                    ...(opts.soapAction !== undefined ? { SOAPAction: opts.soapAction } : {}),
                },
            },
            (res) => {
                const trozos: Buffer[] = []
                res.on('data', (c: Buffer) => trozos.push(c))
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        text: Buffer.concat(trozos).toString('utf8'),
                    }),
                )
                res.on('error', (e) =>
                    reject(new ErrorHttpArca('Se cortó la respuesta de ARCA.', 'red', e.message)),
                )
            },
        )

        req.on('timeout', () => {
            req.destroy()
            reject(new ErrorHttpArca(`ARCA no respondió en ${opts.timeoutMs / 1000} s.`, 'timeout', null))
        })

        // Acá se conserva el motivo real (el `dh key too small` vive en este
        // mensaje). Perderlo fue lo que hizo que un problema de TLS se
        // diagnosticara como un problema de red.
        req.on('error', (e) => {
            const causa = e instanceof Error ? e.message : String(e)
            reject(new ErrorHttpArca('No se pudo establecer la conexión con ARCA.', 'red', causa))
        })

        req.end(payload)
    })
}
