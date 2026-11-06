// =============================================================================
// Web Push sin dependencias (6/nov/2026): VAPID (RFC 8292) y el cifrado del
// mensaje (RFC 8291, aes128gcm de RFC 8188), con node:crypto.
//
// Por qué no el paquete `web-push`: la 4.0.0 salió publicada el mismo día que
// se escribió esto (y es ESM puro), y la 3.6.7 arrastra cinco dependencias
// para algo que son ~100 líneas de criptografía estándar. Así no se suma nada
// a la cadena de suministro y el formato queda a la vista.
//
// PURO del lado del servidor (sin base): lo usan src/lib/push/avisar.ts y las
// pruebas (scripts/push/probar-cifrado.ts descifra lo que esto cifra).
// =============================================================================

import 'server-only'
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto'

export interface ClavesVapid {
  /** La pública: el punto sin comprimir de P-256 (65 bytes), en base64url. Es la `applicationServerKey`. */
  publica: string
  /** La privada: el escalar d (32 bytes), en base64url. Secreta. */
  privada: string
}

export interface SuscripcionPush {
  endpoint: string
  /** La clave pública del navegador (65 bytes, base64url). */
  p256dh: string
  /** El secreto de autenticación del navegador (16 bytes, base64url). */
  auth: string
}

export interface OpcionesEnvio {
  /** Segundos que el servicio de push guarda el aviso si el teléfono está apagado. */
  ttl?: number
  urgencia?: 'very-low' | 'low' | 'normal' | 'high'
  /** Un aviso nuevo con el mismo topic reemplaza al viejo que todavía no se entregó (≤ 32 caracteres base64url). */
  topic?: string
  /** El contacto que ven Apple y Google (`sub` de VAPID): una URL https o un mailto:. */
  contacto: string
}

export type ResultadoEnvio =
  | { ok: true; status: number }
  | { ok: false; status: number; vencida: boolean; detalle: string }

const deB64 = (s: string): Buffer => Buffer.from(s, 'base64url')
const aB64 = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url')

/** Un escalar de P-256 con exactamente 32 bytes (Node puede devolver menos si empieza con ceros). */
function a32(b: Buffer): Buffer {
  if (b.length === 32) return b
  if (b.length > 32) return b.subarray(b.length - 32)
  return Buffer.concat([Buffer.alloc(32 - b.length), b])
}

/** Un par VAPID nuevo. Cambiarlo invalida todas las suscripciones: se genera una sola vez (claves.ts). */
export function crearClavesVapid(): ClavesVapid {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { publica: aB64(ecdh.getPublicKey()), privada: aB64(a32(ecdh.getPrivateKey())) }
}

/** El JWT de VAPID (ES256) para el origen del servicio de push. Vence en 1 hora. */
export function firmarVapid(endpoint: string, claves: ClavesVapid, contacto: string, ahoraSeg = Math.floor(Date.now() / 1000)): string {
  const aud = new URL(endpoint).origin
  const publica = deB64(claves.publica)
  if (publica.length !== 65 || publica[0] !== 0x04) throw new Error('La clave pública VAPID no es un punto P-256 sin comprimir.')
  const llave = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: aB64(publica.subarray(1, 33)),
      y: aB64(publica.subarray(33, 65)),
      d: aB64(a32(deB64(claves.privada))),
    },
    format: 'jwk',
  })
  const cabecera = aB64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const datos = aB64(Buffer.from(JSON.stringify({ aud, exp: ahoraSeg + 3600, sub: contacto })))
  const firma = sign('sha256', Buffer.from(`${cabecera}.${datos}`), { key: llave, dsaEncoding: 'ieee-p1363' })
  return `${cabecera}.${datos}.${aB64(firma)}`
}

const INFO_WEBPUSH = Buffer.from('WebPush: info\0', 'latin1')
const INFO_CEK = Buffer.from('Content-Encoding: aes128gcm\0', 'latin1')
const INFO_NONCE = Buffer.from('Content-Encoding: nonce\0', 'latin1')
const TAMANO_REGISTRO = 4096

/**
 * Cifra el contenido para un navegador (RFC 8291). Devuelve el cuerpo entero:
 * salt (16) · rs (4) · idlen (1) · la pública efímera (65) · el texto cifrado
 * con su tag. Un solo registro: los avisos miden bastante menos de 4 KB.
 * `efimera` y `salt` se pueden fijar sólo para las pruebas.
 */
export function cifrarParaNavegador(
  contenido: Buffer,
  sub: Pick<SuscripcionPush, 'p256dh' | 'auth'>,
  prueba?: { efimeraPrivada?: Buffer; salt?: Buffer },
): Buffer {
  const publicaNavegador = deB64(sub.p256dh)
  const secretoAuth = deB64(sub.auth)
  if (publicaNavegador.length !== 65) throw new Error('La clave p256dh de la suscripción no mide 65 bytes.')
  if (secretoAuth.length < 16) throw new Error('El secreto auth de la suscripción es demasiado corto.')
  if (contenido.length + 1 + 16 > TAMANO_REGISTRO) throw new Error('El aviso es demasiado largo para un solo registro.')

  const efimera = createECDH('prime256v1')
  if (prueba?.efimeraPrivada) efimera.setPrivateKey(prueba.efimeraPrivada)
  else efimera.generateKeys()
  const publicaEfimera = efimera.getPublicKey()
  const compartido = efimera.computeSecret(publicaNavegador)

  const ikm = Buffer.from(hkdfSync('sha256', compartido, secretoAuth, Buffer.concat([INFO_WEBPUSH, publicaNavegador, publicaEfimera]), 32))
  const salt = prueba?.salt ?? randomBytes(16)
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, INFO_CEK, 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, INFO_NONCE, 12))

  const cifrador = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02: el delimitador del último (y único) registro.
  const cifrado = Buffer.concat([cifrador.update(Buffer.concat([contenido, Buffer.from([2])])), cifrador.final(), cifrador.getAuthTag()])

  const cabecera = Buffer.alloc(21)
  salt.copy(cabecera, 0)
  cabecera.writeUInt32BE(TAMANO_REGISTRO, 16)
  cabecera.writeUInt8(publicaEfimera.length, 20)
  return Buffer.concat([cabecera, publicaEfimera, cifrado])
}

/**
 * Manda un aviso. 201 = el servicio de push lo aceptó. 404/410 = la
 * suscripción ya no existe (la persona desinstaló, revocó el permiso o el
 * navegador la renovó): quien llama la borra. Nunca tira por la respuesta.
 */
export async function enviarPush(
  sub: SuscripcionPush,
  datos: unknown,
  claves: ClavesVapid,
  opciones: OpcionesEnvio,
): Promise<ResultadoEnvio> {
  const cuerpo = cifrarParaNavegador(Buffer.from(JSON.stringify(datos), 'utf8'), sub)
  const jwt = firmarVapid(sub.endpoint, claves, opciones.contacto)
  const cabeceras: Record<string, string> = {
    TTL: String(Math.max(0, Math.floor(opciones.ttl ?? 6 * 3600))),
    Urgency: opciones.urgencia ?? 'normal',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: `vapid t=${jwt}, k=${claves.publica}`,
  }
  if (opciones.topic) cabeceras.Topic = opciones.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: cabeceras,
      body: new Uint8Array(cuerpo),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status }
    const detalle = (await res.text().catch(() => '')).slice(0, 300)
    return { ok: false, status: res.status, vencida: res.status === 404 || res.status === 410, detalle }
  } catch (err) {
    return { ok: false, status: 0, vencida: false, detalle: err instanceof Error ? err.message.slice(0, 300) : 'sin respuesta' }
  }
}

// Los servicios de push de los navegadores. Una suscripción con otro endpoint
// no se guarda: el servidor le pega a esa URL, y sin esta lista cualquiera con
// acceso al dashboard podría hacerlo pegarle a una dirección arbitraria.
const SERVICIOS_DE_PUSH = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^web\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
]

export function esEndpointDePush(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && SERVICIOS_DE_PUSH.some((r) => r.test(u.hostname))
  } catch {
    return false
  }
}
