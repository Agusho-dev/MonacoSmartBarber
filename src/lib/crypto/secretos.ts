// =============================================================================
// src/lib/crypto/secretos.ts
// Cifrado en reposo de secretos de terceros (AES-256-GCM) + de dónde sale la
// clave maestra.
//
// Nació adentro de `src/lib/arca/` porque el primer secreto que hubo que
// guardar fue la clave privada del certificado fiscal. Hoy lo comparten dos
// features —ARCA y los tokens de Mercado Pago de cada sucursal— así que vive
// acá, en un módulo neutral, y `arca/crypto.ts` + `arca/clave-maestra.ts`
// quedaron como re-exports para no tocar sus veintipico de call-sites.
//
// EL NOMBRE DEL SECRETO NO CAMBIA
// -------------------------------
// La clave sigue llamándose `arca_encryption_key` en Supabase Vault (migración
// 179). Renombrarla sería un rename cosmético con un costo real: todo lo que ya
// está cifrado en `arca_taxpayers` —claves privadas fiscales de cuatro
// monotributos— dejaría de descifrarse, y recuperar eso significa rehacer el
// trámite del certificado en ARCA. El nombre es histórico; el uso es general.
//
// DE DÓNDE SALE LA CLAVE, EN ORDEN
// --------------------------------
//   1. `ARCA_ENCRYPTION_KEY` del entorno — si está, manda. Sirve para correr
//      contra una base ajena, o para rotar sin tocar la base.
//   2. Supabase Vault (`arca_encryption_key`) — es el camino por defecto y el
//      que usa producción.
//
// Vault no guarda el secreto en claro: la clave raíz la administra la
// plataforma FUERA de la base, así que un dump o un backup filtrado no alcanzan
// para descifrar nada. Lo que sí alcanza es la service role key, que es la que
// abre la RPC — por eso esa clave es la que hay que cuidar, y rotarla es la
// respuesta si alguna vez se filtra.
//
// LA CLAVE TIENE QUE SER LA MISMA EN TODOS LADOS. Si desarrollo lee una y
// producción otra, un token cifrado en un entorno no se descifra en el otro.
// Por eso el `.env` local NO define `ARCA_ENCRYPTION_KEY`: los dos entornos
// leen el mismo secreto de Vault.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Cache en memoria del proceso.
 *
 * La clave no cambia, y sin cache cada emisión (o cada cobro) pagaría un viaje
 * a la base antes de poder cifrar. Vive en el mismo proceso que ya maneja los
 * secretos en claro para hablar con ARCA y con Mercado Pago, así que no agrega
 * superficie: si ese proceso está comprometido, los secretos ya lo están.
 */
let cache: Buffer | null = null

/** Acepta base64 (44 chars) o hex (64); en los dos casos tiene que dar 32 bytes. */
function aBuffer(raw: string, origen: string): Buffer {
    const limpia = raw.trim()
    const key = /^[0-9a-fA-F]{64}$/.test(limpia)
        ? Buffer.from(limpia, 'hex')
        : Buffer.from(limpia, 'base64')

    if (key.length !== 32) {
        throw new Error(
            `La clave de cifrado de ${origen} tiene ${key.length} bytes y necesita exactamente 32.`,
        )
    }
    return key
}

/**
 * Resuelve la clave maestra. Falla ruidosamente a propósito: una clave mal
 * configurada que "funciona igual" es cómo se termina con tokens de cobro
 * guardados en claro.
 */
export async function claveMaestra(): Promise<Buffer> {
    if (cache) return cache

    const deEntorno = process.env.ARCA_ENCRYPTION_KEY
    if (deEntorno && deEntorno.trim()) {
        cache = aBuffer(deEntorno, 'la variable de entorno')
        return cache
    }

    // Import dinámico: el cliente de Supabase arrastra dependencias de Next, y
    // el camino de la variable de entorno no tiene por qué pagarlas (ni los
    // tests, que corren este módulo fuera del framework).
    const { createAdminClient } = await import('@/lib/supabase/server')
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('arca_get_encryption_key')

    if (error) {
        throw new Error(
            'No pudimos leer la clave de cifrado desde Vault: ' + error.message,
        )
    }
    if (!data || typeof data !== 'string') {
        throw new Error(
            'Falta el secreto `arca_encryption_key` en Supabase Vault. ' +
            'Lo crea la migración 179; si ya corrió, verificá que el secreto exista.',
        )
    }

    cache = aBuffer(data, 'Vault')
    return cache
}

/** Para los checklists de configuración: ¿podemos cifrar? No tira, informa. */
export async function hayClaveDeCifrado(): Promise<boolean> {
    try {
        await claveMaestra()
        return true
    } catch {
        return false
    }
}

/** Sólo para tests: obliga a resolver de nuevo. */
export function olvidarClaveEnMemoria(): void {
    cache = null
}

// -----------------------------------------------------------------------------
// Cifrado en reposo
// -----------------------------------------------------------------------------

const FORMATO = 'v1'

/**
 * Cifra un secreto. Salida: `v1.<iv>.<tag>.<ciphertext>`, todo en base64.
 * GCM y no CBC porque además de cifrar autentica: si alguien toca la fila en
 * la base, el descifrado falla en vez de devolver basura.
 *
 * El formato es parte del contrato: hay filas cifradas con él desde la
 * migración 179 y cambiarlo las vuelve ilegibles.
 *
 * Es async porque la clave maestra puede venir de Supabase Vault, no sólo del
 * entorno.
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
