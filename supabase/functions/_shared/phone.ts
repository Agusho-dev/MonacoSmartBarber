/**
 * Normalización de teléfonos para el login de clientes (CONTRACTS.md §2.3).
 *
 * Argentina es el país por defecto (código `54`). El usuario tipea lo que
 * quiere —con o sin `+54`, con el `9` de móvil o sin él, con el `0` troncal,
 * con espacios y guiones— y de acá sale UNA sola forma canónica por número.
 *
 * Es una función PURA: no toca red ni base. La validez final la decide el
 * server; la app Flutter tiene una copia sólo para el enmascarado/formateo.
 */

/** Resultado de normalizar un teléfono. */
export interface TelefonoNormalizado {
  /** E.164 con `+`, p. ej. `+5493512125249`. Es la clave `phone_e164` de la tabla de desafíos. */
  e164: string
  /**
   * Los 10 dígitos nacionales argentinos (característica + número), p. ej.
   * `3512125249`. Es lo que se guarda en `clients.phone` y lo que se usa para
   * el alias de email. `null` para fijos sin característica (8–9 dígitos) y
   * para números de otro país.
   */
  national10: string | null
  /**
   * Destinatario para Meta Cloud API: dígitos sin `+`, con el `9` de móvil
   * para Argentina (`5493512125249`).
   */
  whatsapp: string
  /** Versión enmascarada para mostrar en pantalla: `+54 9 351 ••• 5249`. */
  masked: string
}

const MIN_DIGITOS = 8

/**
 * Normaliza un teléfono tipeado por el usuario.
 *
 * Reglas (en este orden):
 * 1. `d` = sólo dígitos. Un `+` inicial o un `00` inicial marcan "internacional".
 *    Sin esos prefijos, un `0` inicial es el troncal argentino y se descarta.
 * 2. Internacional y NO empieza con `54` → otro país: `e164 = '+' + d`,
 *    `national10 = null`, `whatsapp = d`.
 * 3. Argentina:
 *    - `549` + 10 dígitos (13 en total) → `national10 = d.slice(3)`.
 *    - `54` + 10 dígitos (12) → `national10 = d.slice(2)`.
 *    - `9` + 10 dígitos (11, sin país) → `national10 = d.slice(1)`.
 *    - 10 dígitos → `national10 = d`.
 *    - 8–9 dígitos (fijo sin característica) → `national10 = null`,
 *      `e164 = '+54' + d`, `whatsapp = '54' + d`.
 *    - cualquier otra forma → `null` (no se adivina: mejor "número inválido"
 *      que un OTP a un número que no existe).
 *    Con `national10`, `e164 = '+549' + national10` y `whatsapp = '549' + national10`.
 * 4. Menos de 8 dígitos → `null` (INVALID_PHONE).
 *
 * @param input lo que tipeó el usuario (cualquier formato).
 * @returns el teléfono normalizado o `null` si no es un número válido.
 *
 * @example
 * normalizarTelefonoAR('0351 212-5249')
 * // → { e164: '+5493512125249', national10: '3512125249', whatsapp: '5493512125249', masked: '+54 9 351 ••• 5249' }
 */
export function normalizarTelefonoAR(input: string): TelefonoNormalizado | null {
  const raw = (input ?? '').trim()
  if (!raw) return null

  let d = raw.replace(/\D/g, '')
  let internacional = raw.startsWith('+')

  if (d.startsWith('00')) {
    // Prefijo internacional "00" (equivale al "+").
    d = d.slice(2)
    internacional = true
  } else if (!internacional && d.startsWith('0')) {
    // "0" troncal argentino: 0351 → 351.
    d = d.slice(1)
  }

  if (d.length < MIN_DIGITOS) return null

  // ── Otro país (vino con + / 00 y no es 54) ─────────────────────────────
  if (internacional && !d.startsWith('54')) {
    return {
      e164: '+' + d,
      national10: null,
      whatsapp: d,
      masked: enmascarar('+', d),
    }
  }

  // ── Argentina ──────────────────────────────────────────────────────────
  // Si vino con +54 / 0054, el país ya está identificado: trabajamos con lo
  // que sigue. Si vino sin prefijo, aceptamos también que haya tipeado el 54.
  let local = d
  if (internacional) {
    local = d.slice(2) // sacamos el 54
  } else if (d.startsWith('549') && d.length === 13) {
    local = d.slice(2) // queda 9 + 10
  } else if (d.startsWith('54') && d.length === 12) {
    local = d.slice(2) // quedan 10
  }

  let national10: string | null = null
  if (local.length === 11 && local.startsWith('9')) {
    national10 = local.slice(1)
  } else if (local.length === 10) {
    national10 = local
  } else if (local.length >= MIN_DIGITOS && local.length <= 9) {
    // Fijo sin característica: no hay national10 y no lleva el 9 de móvil.
    return {
      e164: '+54' + local,
      national10: null,
      whatsapp: '54' + local,
      masked: enmascarar('+54', local),
    }
  } else {
    return null
  }

  return {
    e164: '+549' + national10,
    national10,
    whatsapp: '549' + national10,
    masked: enmascarar('+54 9', national10),
  }
}

/**
 * Últimos 10 dígitos del número de WhatsApp. Es la clave `phone_tail` de
 * `client_otp_challenges` y coincide con el criterio de `find_client_id_by_phone`
 * (migraciones 149/150).
 */
export function phoneTail(whatsapp: string): string {
  const d = whatsapp.replace(/\D/g, '')
  return d.slice(-10)
}

/**
 * `true` si el nombre guardado no es un nombre real: vacío, sólo dígitos o
 * puntuación (p. ej. el teléfono copiado como nombre), o el placeholder
 * "Sin nombre" que dejan algunas altas manuales.
 */
export function nombreEsPlaceholder(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  if (!n) return true
  if (/^[\d\s()+.\-]*$/.test(n)) return true
  return n.toLowerCase() === 'sin nombre'
}

/**
 * Primer token del nombre (para tratar al cliente por su nombre de pila), o
 * `null` si el nombre es un placeholder.
 */
export function primerNombre(name: string | null | undefined): string | null {
  if (nombreEsPlaceholder(name)) return null
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first || null
}

// ── interno ──────────────────────────────────────────────────────────────

/**
 * `prefijo + primeros dígitos + ••• + últimos 4`. Se ocultan siempre 3
 * dígitos antes de los últimos 4 (en un nacional de 10 → `351 ••• 5249`).
 */
function enmascarar(prefijo: string, digitos: string): string {
  const ultimos4 = digitos.slice(-4)
  const cabeza = digitos.slice(0, Math.max(0, digitos.length - 7))
  // Con un prefijo que es sólo "+" (otro país, no sabemos dónde corta el
  // código de país) la cabeza va pegada: "+1415 ••• 2671".
  const inicio = prefijo === '+' ? `+${cabeza}` : [prefijo, cabeza].filter(Boolean).join(' ')
  return `${inicio} ••• ${ultimos4}`
}
