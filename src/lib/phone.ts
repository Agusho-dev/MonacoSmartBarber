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
/**
 * Últimos 10 dígitos: la forma "local" con la que trabaja todo el sistema (el
 * teclado del kiosko pide 10 y las migraciones 149/150 matchean clientes por
 * ese sufijo).
 *
 * Hace falta porque en `clients.phone` conviven formatos: en prod hay ~50
 * clientes guardados con prefijo internacional ("5493512554674", 13 dígitos).
 * Pasar ese valor crudo a un formulario que espera 10 lo deja inválido o —peor—
 * lo trunca por la izquierda y reserva a nombre de un número que no existe.
 *
 * Devuelve '' si no llega a 10 dígitos: preferimos no prellenar antes que
 * prellenar mal.
 */
export function toLocalPhone(input: string | null | undefined): string {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}

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
