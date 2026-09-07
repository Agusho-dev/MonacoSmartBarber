// =============================================================================
// Firma y verificación de la cookie `barber_session` del panel del barbero.
//
// La cookie era JSON plano: cualquier request con
// `Cookie: barber_session={"organization_id":"<uuid>"}` obtenía la org (y con
// un staff_id conocido, la sucursal) sin PIN ni fichaje — getCurrentOrgId(),
// validateBranchAccess() y getAllowedBranchIds() la daban por buena. Ahora el
// valor es `base64url(json).hmac_sha256` y todo lector pasa por
// `leerBarberSession`, que verifica la firma en tiempo constante antes de
// parsear. Las sesiones del formato viejo (TTL 14 h) se invalidan una vez:
// el barbero vuelve a entrar con su PIN.
//
// Server-only y SIN 'use server' a propósito: exporta helpers sincrónicos que
// no deben ser endpoints.
// =============================================================================

import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'

export interface BarberSessionPayload {
  staff_id: string
  full_name?: string | null
  branch_id?: string | null
  organization_id?: string | null
  role?: string | null
  role_id?: string | null
  permissions?: Record<string, boolean>
}

/**
 * BARBER_SESSION_SECRET dedicado si existe; si no, la service role key, que ya
 * es secreta y está definida en todos los entornos (mismo criterio que
 * OTP_PEPPER en client-auth). Sin ninguno NO se firma ni se acepta nada:
 * falla cerrado.
 */
function secreto(): string | null {
  return process.env.BARBER_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

function firma(json: string, key: string): string {
  return createHmac('sha256', key).update(json).digest('base64url')
}

/** Serializa y firma el payload. Null si no hay secreto configurado. */
export function firmarBarberSession(payload: BarberSessionPayload): string | null {
  const key = secreto()
  if (!key) {
    console.error('[barber-cookie] Sin BARBER_SESSION_SECRET ni SUPABASE_SERVICE_ROLE_KEY: no se puede firmar la sesión')
    return null
  }
  const json = JSON.stringify(payload)
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${firma(json, key)}`
}

/** Verifica la firma y devuelve el payload, o null si no es válida. */
export function leerBarberSession(value: string): BarberSessionPayload | null {
  const key = secreto()
  if (!key || !value) return null
  const punto = value.lastIndexOf('.')
  if (punto <= 0) return null
  let json: string
  try {
    json = Buffer.from(value.slice(0, punto), 'base64url').toString('utf8')
  } catch {
    return null
  }
  const esperada = Buffer.from(firma(json, key))
  const recibida = Buffer.from(value.slice(punto + 1))
  if (esperada.length !== recibida.length) return null
  try {
    if (!timingSafeEqual(esperada, recibida)) return null
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(json) as BarberSessionPayload
    return parsed && typeof parsed.staff_id === 'string' ? parsed : null
  } catch {
    return null
  }
}
