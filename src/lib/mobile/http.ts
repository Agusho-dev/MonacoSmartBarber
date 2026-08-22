/**
 * Utilidades HTTP de la API mobile (`/api/mobile/**`).
 *
 * Contrato (CONTRACTS.md §1): toda respuesta es JSON con `Cache-Control:
 * no-store`; los errores tienen la forma `{ error: CODE, message: texto
 * humano }`; una excepción no controlada es 500 `INTERNAL`, nunca una página
 * HTML de Next que la app no puede parsear.
 */
import { NextResponse, type NextRequest } from 'next/server'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export function jsonOk(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export function jsonError(
  status: number,
  error: string,
  message: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error, message, ...(extra ?? {}) }, { status, headers: NO_STORE })
}

export function badRequest(message = 'Los datos enviados no son válidos.'): NextResponse {
  return jsonError(400, 'BAD_REQUEST', message)
}

export function rateLimited(message = 'Demasiadas solicitudes, esperá un momento.'): NextResponse {
  return jsonError(429, 'RATE_LIMITED', message)
}

export function internalError(): NextResponse {
  return jsonError(500, 'INTERNAL', 'Algo salió mal. Probá de nuevo.')
}

/**
 * Envuelve un route handler: cualquier excepción no controlada se loguea con
 * prefijo `[api/mobile]` y se responde 500 `INTERNAL` en JSON.
 *
 * Es genérico sobre los argumentos para que el tipo exportado (`GET`, `POST`)
 * conserve la firma exacta que valida Next (`request`, `{ params }`).
 */
export function withMobileHandler<Args extends unknown[]>(
  name: string,
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (e) {
      console.error(`[api/mobile] ${name}:`, e)
      return internalError()
    }
  }
}

/** Body JSON como objeto plano; `null` si no es JSON o no es un objeto. */
export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * `YYYY-MM-DD` y que además exista (30 de febrero no). `new Date('2026-02-30')`
 * no tira: desborda al mes siguiente y el motor terminaría evaluando otro día.
 */
export function isValidDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  )
}

/** String opcional del body: trim y tope de largo. `undefined` si no vino o no es string. */
export function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim().slice(0, maxLength)
}
