// =============================================================================
// src/lib/arca/clave-maestra.ts
// De dónde sale la clave que cifra la clave privada del certificado fiscal.
//
// Dos orígenes, en este orden:
//
//   1. `ARCA_ENCRYPTION_KEY` del entorno — si está, manda. Sirve para correr
//      contra una base que no es la propia, o para rotar sin tocar la base.
//   2. Supabase Vault (secreto `arca_encryption_key`, migración 179) — es el
//      camino por defecto y el que usa producción.
//
// Vault no guarda el secreto en claro: la clave raíz la administra la
// plataforma FUERA de la base, así que un backup o un dump no alcanzan para
// descifrar los certificados. Lo que sí alcanza es la service role key, que es
// la que abre la RPC — por eso esa clave es lo que hay que cuidar, y rotarla es
// la respuesta si alguna vez se filtra.
//
// LA CLAVE TIENE QUE SER LA MISMA EN TODOS LADOS. Si desarrollo lee una y
// producción otra, un certificado generado en un entorno no se descifra en el
// otro y hay que rehacer el trámite en ARCA. Por eso el `.env` local NO define
// `ARCA_ENCRYPTION_KEY`: así los dos entornos leen el mismo secreto de Vault.
// =============================================================================

/**
 * Cache en memoria del proceso.
 *
 * La clave no cambia, y sin cache cada emisión pagaría un viaje a la base antes
 * de poder firmar. Vive en el mismo proceso que ya maneja la clave privada en
 * claro para hablar con ARCA, así que no agrega superficie: si ese proceso está
 * comprometido, el certificado ya lo está.
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
 * configurada que "funciona igual" es cómo se termina con certificados
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
            'No pudimos leer la clave de cifrado del facturador desde Vault: ' + error.message,
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

/** Para el checklist del wizard: ¿podemos cifrar? No tira, informa. */
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
