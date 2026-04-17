/**
 * Normaliza un número argentino al formato E.164 que espera Meta Cloud API
 * (sin el `+` y sin el `9` intermedio).
 *
 * Ejemplos:
 *   "3584402511"     → "543584402511"
 *   "93584402511"    → "543584402511"
 *   "5493584402511"  → "543584402511"
 *   "+54 9 358 440-2511" → "543584402511"
 */
export function normalizeArgentinePhoneForMeta(input: string): string {
  let phone = input.replace(/\D/g, '')
  if (!phone.startsWith('54')) {
    if (phone.startsWith('9') && phone.length === 11) {
      phone = '54' + phone.slice(1)
    } else {
      phone = '54' + phone
    }
  } else if (phone.startsWith('549') && phone.length === 13) {
    phone = '54' + phone.slice(3)
  }
  return phone
}
