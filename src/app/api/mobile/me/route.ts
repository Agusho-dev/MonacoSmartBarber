/**
 * GET  /api/mobile/me            → quién soy (la app valida la sesión al arrancar)
 * POST /api/mobile/me  `{ name }` → actualiza `clients.name` (2..80 chars)
 *
 * Ver CONTRACTS.md §1.2.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { RateLimits } from '@/lib/rate-limit'
import { getLocalDateStr } from '@/lib/time-utils'
import { requireMobileClient, isMobileAuthError, type MobileClientCtx } from '@/lib/mobile/auth'
import { DEFAULT_TZ } from '@/lib/mobile/branches'
import {
  badRequest,
  jsonOk,
  jsonError,
  optionalString,
  rateLimited,
  readJsonObject,
  withMobileHandler,
} from '@/lib/mobile/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NAME_MIN = 2
const NAME_MAX = 80

/**
 * `server_today` en la TZ de la organización del cliente. Todas las sucursales
 * de una org comparten TZ hoy; se toma la de la primera activa y, si la org no
 * tiene ninguna, la default. Nunca `toISOString()` (principio 7).
 */
async function serverTodayFor(orgId: string): Promise<string> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('branches')
    .select('timezone')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name')
    .limit(1)
    .maybeSingle()
  return getLocalDateStr(data?.timezone || DEFAULT_TZ)
}

function clientShape(ctx: MobileClientCtx) {
  return {
    id: ctx.client.id,
    name: ctx.client.name,
    phone: ctx.client.phone,
    organization_id: ctx.client.organizationId,
  }
}

export const GET = withMobileHandler('me', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const gate = await RateLimits.mobileBootstrap(auth.userId)
  if (!gate.allowed) return rateLimited()

  return jsonOk({
    client: clientShape(auth),
    server_today: await serverTodayFor(auth.client.organizationId),
  })
})

export const POST = withMobileHandler('me', async (req: NextRequest) => {
  const auth = await requireMobileClient(req)
  if (isMobileAuthError(auth)) return auth

  const raw = await readJsonObject(req)
  if (!raw) return badRequest('El body tiene que ser un objeto JSON.')

  const name = optionalString(raw.name, NAME_MAX + 1)
  if (name === undefined || name.length < NAME_MIN || name.length > NAME_MAX) {
    return badRequest(`El nombre tiene que tener entre ${NAME_MIN} y ${NAME_MAX} caracteres.`)
  }

  const gate = await RateLimits.mobileBootstrap(auth.userId)
  if (!gate.allowed) return rateLimited()

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('clients')
    .update({ name })
    .eq('id', auth.client.id)

  if (error) {
    console.error('[api/mobile] me POST:', error.message)
    return jsonError(500, 'INTERNAL', 'No pudimos guardar el nombre. Probá de nuevo.')
  }

  return jsonOk({ ok: true, name })
})
