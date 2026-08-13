// =============================================================================
// src/lib/arca/crypto.ts
//
// Todo lo criptográfico del facturador ARCA:
//   · cifrado en reposo de la clave privada    (AES-256-GCM)
//   · generación del par de claves + CSR       (para que el usuario NO toque openssl)
//   · lectura del certificado que devuelve ARCA
//   · verificación de que ese certificado es el de NUESTRA clave
//
// Por qué el CSR lo genera el sistema
// -----------------------------------
// El paso que hace abandonar a la gente es "abrí una terminal y corré
// `openssl req -new -key ...`". La mitad de los dueños de barbería no tiene
// terminal, y el que la tiene termina con una clave privada suelta en Descargas.
// Acá la clave nace en el servidor, se guarda cifrada y NUNCA se descarga: lo
// único que baja el usuario es el CSR, que es público y no sirve para nada sin
// su clave.
//
// De dónde sale la clave de cifrado
// ---------------------------------
// De `clave-maestra.ts`: la variable de entorno si existe, y si no el secreto
// `arca_encryption_key` de Supabase Vault (migración 179). Vault no guarda el
// secreto en claro —la clave raíz la administra la plataforma FUERA de la
// base—, así que un dump o un backup filtrado no alcanzan para descifrar una
// clave privada fiscal.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, generateKeyPairSync } from 'crypto'
import forge from 'node-forge'
import { claveMaestra } from './clave-maestra'

// Re-exportado para no obligar a los call-sites a conocer dos módulos.
export { hayClaveDeCifrado } from './clave-maestra'

// -----------------------------------------------------------------------------
// Cifrado en reposo
// -----------------------------------------------------------------------------

const FORMATO = 'v1'

/**
 * Cifra un secreto. Salida: `v1.<iv>.<tag>.<ciphertext>`, todo en base64.
 * GCM y no CBC porque además de cifrar autentica: si alguien toca la fila en
 * la base, el descifrado falla en vez de devolver basura.
 *
 * Es async porque la clave maestra puede venir de Supabase Vault (mig 179), no
 * sólo del entorno.
 */
export async function cifrarSecreto(plano: string): Promise<string> {
    const key = await claveMaestra()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [FORMATO, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.')
}

/** Descifra lo que produjo `cifrarSecreto`. */
export async function descifrarSecreto(payload: string): Promise<string> {
    const partes = payload.split('.')
    if (partes.length !== 4 || partes[0] !== FORMATO) {
        throw new Error('El secreto guardado no tiene el formato esperado (se esperaba v1.iv.tag.ct).')
    }
    const [, ivB64, tagB64, ctB64] = partes
    const key = await claveMaestra()
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
    ]).toString('utf8')
}

// -----------------------------------------------------------------------------
// Generación de clave privada + CSR
// -----------------------------------------------------------------------------

export interface CsrGenerado {
    privateKeyPem: string
    csrPem: string
    subject: string
    alias: string
}

/**
 * Genera un par RSA 2048 y el CSR (PKCS#10) que ARCA pide para emitir el
 * certificado.
 *
 * La keygen va por `crypto.generateKeyPairSync` (nativo, milisegundos) y no por
 * `forge.pki.rsa.generateKeyPair` (JS puro, segundos): en una server action
 * bloquear el event loop 3 segundos para generar una clave es innecesario.
 * Forge se usa sólo para armar y firmar el CSR, que es barato.
 *
 * El subject sigue lo que exige ARCA:
 *   C  = AR
 *   O  = razón social del contribuyente
 *   CN = alias del certificado
 *   serialNumber = "CUIT 20123456789"   ← sin esto, ARCA rechaza el CSR
 */
export function generarClaveYCsr(params: {
    cuit: string
    razonSocial: string
    alias?: string
}): CsrGenerado {
    const cuit = params.cuit.replace(/\D/g, '')
    if (!/^\d{11}$/.test(cuit)) {
        throw new Error('El CUIT tiene que tener 11 dígitos.')
    }

    const razonSocial = (params.razonSocial || '').trim() || `CUIT ${cuit}`
    // El alias identifica al certificado dentro del portal de ARCA. Se
    // normaliza porque el portal no acepta acentos ni símbolos.
    const alias = normalizarAlias(params.alias || razonSocial)

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const forgePrivate = forge.pki.privateKeyFromPem(privateKey)
    const forgePublic = forge.pki.publicKeyFromPem(publicKey)

    const csr = forge.pki.createCertificationRequest()
    csr.publicKey = forgePublic
    csr.setSubject([
        { shortName: 'C', value: 'AR' },
        { shortName: 'O', value: recortar(razonSocial, 64) },
        { shortName: 'CN', value: recortar(alias, 64) },
        // El OID va explícito: node-forge mapea 2.5.4.5 al nombre 'serialName'
        // (sí, con ese typo), así que pedirlo por nombre es jugar a la ruleta.
        { type: '2.5.4.5', value: `CUIT ${cuit}` },
    ])
    csr.sign(forgePrivate, forge.md.sha256.create())

    return {
        privateKeyPem: privateKey,
        csrPem: forge.pki.certificationRequestToPem(csr),
        subject: `C=AR, O=${razonSocial}, CN=${alias}, serialNumber=CUIT ${cuit}`,
        alias,
    }
}

/** Alias apto para el portal de ARCA: sin acentos, sin símbolos, minúsculas. */
export function normalizarAlias(entrada: string): string {
    const base = entrada
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
    return (base || 'barberos').slice(0, 40)
}

function recortar(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) : s
}

// -----------------------------------------------------------------------------
// Lectura y validación del certificado
// -----------------------------------------------------------------------------

export interface DatosCertificado {
    subject: string
    issuer: string
    serial: string
    notBefore: Date
    notAfter: Date
    cuit: string | null
    /** Días que faltan para el vencimiento (negativo = ya venció). */
    diasParaVencer: number
}

/** Extrae los datos legibles del .crt que devuelve ARCA. */
export function leerCertificado(pem: string): DatosCertificado {
    let cert: forge.pki.Certificate
    try {
        cert = forge.pki.certificateFromPem(pem)
    } catch {
        throw new Error(
            'No pudimos leer el certificado. Tiene que ser el archivo .crt (o .pem) que descargaste de ARCA, ' +
            'empezando con "-----BEGIN CERTIFICATE-----".'
        )
    }

    const subject = cert.subject.attributes
        .map((a) => `${a.shortName || a.type}=${a.value}`)
        .join(', ')
    const issuer = cert.issuer.attributes
        .map((a) => `${a.shortName || a.type}=${a.value}`)
        .join(', ')

    const serialAttr = cert.subject.attributes.find(
        (a) => a.type === '2.5.4.5' || a.shortName === 'serialNumber'
    )
    const cuitMatch = String(serialAttr?.value ?? '').match(/(\d{11})/)

    const notAfter = cert.validity.notAfter
    const diasParaVencer = Math.floor((notAfter.getTime() - Date.now()) / 86_400_000)

    return {
        subject,
        issuer,
        serial: cert.serialNumber,
        notBefore: cert.validity.notBefore,
        notAfter,
        cuit: cuitMatch ? cuitMatch[1] : null,
        diasParaVencer,
    }
}

/**
 * Verifica que el certificado subido corresponda a la clave privada que
 * generamos. Es EL chequeo que evita el error más común de todo el onboarding:
 * el usuario tiene tres .crt en Descargas y sube el que no es.
 *
 * Compara el módulo RSA de la pública del certificado contra el de nuestra
 * privada. Si no coinciden, ninguna factura va a salir nunca — y sin este
 * chequeo el usuario se entera recién cuando WSAA le tira un error opaco.
 */
export function certificadoCoincideConClave(certPem: string, privateKeyPem: string): boolean {
    try {
        const cert = forge.pki.certificateFromPem(certPem)
        const priv = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey
        const pub = cert.publicKey as forge.pki.rsa.PublicKey
        return pub.n.compareTo(priv.n) === 0 && pub.e.compareTo(priv.e) === 0
    } catch {
        return false
    }
}

// -----------------------------------------------------------------------------
// Firma CMS / PKCS#7 del Ticket de Requerimiento de Acceso (WSAA)
// -----------------------------------------------------------------------------

/**
 * Firma el TRA en CMS (PKCS#7 SignedData) y lo devuelve en base64, que es
 * exactamente lo que espera el `loginCms` de WSAA.
 *
 * Es el equivalente de:
 *   openssl smime -sign -signer cert.crt -inkey key.pem -outform DER -nodetach
 *
 * "nodetach" importa: el contenido va ADENTRO de la firma. Con firma
 * desprendida (detached) WSAA no tiene el TRA que validar y rechaza el login.
 */
export function firmarTraCms(traXml: string, certPem: string, privateKeyPem: string): string {
    const cert = forge.pki.certificateFromPem(certPem)
    const key = forge.pki.privateKeyFromPem(privateKeyPem)

    const p7 = forge.pkcs7.createSignedData()
    p7.content = forge.util.createBuffer(traXml, 'utf8')
    p7.addCertificate(cert)
    p7.addSigner({
        key: key as forge.pki.rsa.PrivateKey,
        certificate: cert,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
            { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
            { type: forge.pki.oids.messageDigest },
            // El cast es por un tipo mal declarado en @types/node-forge: dice
            // `string`, pero forge se lo pasa a `asn1.dateToUtcTime()`, que
            // espera un Date. Con un string ISO el UTCTIME sale mal formado.
            // Verificado con `openssl cms -verify`: con Date, la firma valida.
            { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
        ],
    })
    // Sin `{ detached: false }` explícito forge adjunta el contenido igual,
    // pero dejarlo escrito evita que un cambio de default rompa el login.
    p7.sign({ detached: false })

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
    return forge.util.encode64(der)
}
