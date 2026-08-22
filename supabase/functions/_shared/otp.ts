/**
 * Códigos OTP: generación, hash y comparación.
 *
 * - El código es de 6 dígitos, sacado de `crypto.getRandomValues` con
 *   rechazo del sesgo de módulo (no `Math.random`).
 * - En la base se guarda SÓLO `sha256(code:pepper)` en hex. El pepper vive en
 *   el entorno de la función; sin él, el hash no se puede precalcular.
 * - La comparación es en tiempo constante: el tiempo de respuesta no puede
 *   decir "le pegaste a los primeros dígitos".
 */

export const OTP_LENGTH = 6

const OTP_SPACE = 10 ** OTP_LENGTH // 1.000.000
// Mayor múltiplo de OTP_SPACE que entra en 32 bits. Todo valor >= a esto se
// descarta para que `% OTP_SPACE` sea uniforme.
const UINT32_LIMIT = Math.floor(0x1_0000_0000 / OTP_SPACE) * OTP_SPACE

/** Genera un código numérico de 6 dígitos (con ceros a la izquierda). */
export function generarCodigoOtp(): string {
  const buf = new Uint32Array(1)
  let v: number
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= UINT32_LIMIT)
  return (v % OTP_SPACE).toString().padStart(OTP_LENGTH, '0')
}

/**
 * `sha256("<code>:<pepper>")` en hex minúscula. Es lo que se guarda en
 * `client_otp_challenges.code_hash`.
 */
export async function hashCodigoOtp(code: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${pepper}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return aHex(new Uint8Array(digest))
}

/**
 * Compara dos strings en tiempo constante respecto del contenido (el largo
 * se mezcla en el acumulador, no se cortocircuita).
 */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < len; i++) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  }
  return diff === 0
}

/**
 * Limpia lo que tipeó el usuario (espacios, guiones) y valida que sean
 * exactamente 6 dígitos. Devuelve `null` si no.
 */
export function limpiarCodigoOtp(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const d = input.replace(/\D/g, '')
  return d.length === OTP_LENGTH ? d : null
}

function aHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
