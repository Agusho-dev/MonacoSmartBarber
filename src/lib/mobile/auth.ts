/**
 * Autenticación de la API mobile (`/api/mobile/**`).
 *
 * Principio 2 de CONTRACTS.md: la identidad sale SIEMPRE del JWT. El teléfono y
 * el `client_id` se leen de `clients.auth_user_id = auth.uid()`; nunca del body.
 *
 * El JWT se valida contra GoTrue con la service role (`auth.getUser(token)`),
 * así que un token vencido, revocado o de un usuario borrado se rechaza acá y
 * no llega a ningún handler.
 */
import 'server-only'
import type { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { jsonError } from './http'

export interface MobileClientCtx {
  /** `auth.uid()` del JWT. Es la clave de los rate-limits por usuario. */
  userId: string
  client: {
    id: string
    organizationId: string
    name: string
    phone: string
  }
}

function bearerFrom(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/**
 * Resuelve el cliente autenticado o devuelve la respuesta de error lista para
 * retornar (401 `UNAUTHENTICATED`, 403 `NO_CLIENT`, 500 `INTERNAL`).
 *
 * Uso:
 *   const auth = await requireMobileClient(req)
 *   if (isMobileAuthError(auth)) return auth
 */
export async function requireMobileClient(
  req: Request
): Promise<MobileClientCtx | NextResponse> {
  const token = bearerFrom(req)
  if (!token) return jsonError(401, 'UNAUTHENTICATED', 'Iniciá sesión de nuevo.')

  const supabase = createAdminClient()

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    return jsonError(401, 'UNAUTHENTICATED', 'Iniciá sesión de nuevo.')
  }

  // Un auth user podría quedar vinculado a más de una fila (orgs distintas en
  // el futuro): se toma la más vieja de forma determinística.
  const { data: rows, error: clientError } = await supabase
    .from('clients')
    .select('id, organization_id, name, phone')
    .eq('auth_user_id', data.user.id)
    .order('created_at', { ascending: true })
    .limit(1)

  if (clientError) {
    console.error('[api/mobile] requireMobileClient clients:', clientError.message)
    return jsonError(500, 'INTERNAL', 'Algo salió mal. Probá de nuevo.')
  }

  const row = rows?.[0]
  if (!row) return jsonError(403, 'NO_CLIENT', 'Tu cuenta no está vinculada a un cliente.')

  return {
    userId: data.user.id,
    client: {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name ?? '',
      phone: row.phone ?? '',
    },
  }
}

/** Type guard: `requireMobileClient` devolvió una respuesta de error. */
export function isMobileAuthError(
  result: MobileClientCtx | NextResponse
): result is NextResponse {
  return result instanceof Response
}
