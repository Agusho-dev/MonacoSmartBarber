// =============================================================================
// src/app/api/mercadopago/conciliacion/callback/route.ts
//
// El regreso del OAuth de la CONCILIACIÓN (app de MP aparte de la de señas; el
// callback de señas no se toca ni se reutiliza).
//
// Sin sesión: lo usa un barbero desde su celular, y lo que lo autoriza es el
// `state` (un uso, 10 min, creado desde un link vigente o por alguien del
// dashboard). Candados:
//   1. El `state` se QUEMA con un UPDATE condicional que es a la vez la lectura
//      y la validación (`.is('used_at', null).select(...)`): la fila que vuelve
//      prueba que este request —y no otro— lo consumió. Se quema ANTES de
//      canjear: el `code` de MP también es de un solo uso.
//   2. El `code` se canjea server-side con el client_secret y el
//      `code_verifier` (PKCE) guardado con el state: un code interceptado no
//      sirve sin él.
//   3. Si vino por link, el link tiene que seguir vigente (no anulado ni usado).
//
// La cuenta queda `confirmada` sólo si quien vuelve es la misma sesión del
// dashboard que pidió la conexión y tiene permiso: si vino por link (o la
// sesión no coincide), el dueño tiene que confirmar que se autorizó la cuenta
// correcta — el barbero pudo entrar con OTRA cuenta de Mercado Pago.
//
// Nunca pone un token ni un mensaje crudo de MP en la URL: sólo un motivo corto.
// =============================================================================

import { NextResponse, type NextRequest } from 'next/server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from '@/lib/actions/org'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { getCachedAuthUser } from '@/lib/auth-cache'
import { traducirErrorMp } from '@/lib/mercadopago/errores'
import { appConciliacion, canjearCodigo, enmascararEmail, leerIdentidad, redirectUriConciliacion } from '@/lib/conciliacion-mp/oauth'
import { guardarConexion, vincularCuentasDeCobro } from '@/lib/conciliacion-mp/credenciales'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Motivo = 'vencido' | 'cancelado' | 'fallo'

interface FilaState {
  organization_id: string
  payment_account_id: string
  link_id: string | null
  created_by: string | null
  code_verifier: string | null
  expires_at: string
}

/** Las redirecciones salen del dominio del redirect configurado, nunca del header del request. */
function origen(): string {
  return new URL(redirectUriConciliacion()).origin
}

function alTitular(r: 'ok' | Motivo): NextResponse {
  const url = new URL('/conectar-mp/listo', origen())
  url.searchParams.set('r', r)
  return NextResponse.redirect(url)
}

function alDashboard(params: Record<string, string>): NextResponse {
  const url = new URL('/dashboard/conciliacion', origen())
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/** Sin un state válido no se sabe de dónde vino: si hay sesión del dashboard, vuelve ahí. */
async function sinState(): Promise<NextResponse> {
  const user = await getCachedAuthUser()
  return user ? alDashboard({ mp: 'error', motivo: 'vencido' }) : alTitular('vencido')
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const state = params.get('state')
  const code = params.get('code')
  const errorMp = params.get('error')

  if (!state || !state.startsWith('cmp_') || state.length > 120) return sinState()

  const supabase = createAdminClient()
  const ahora = new Date()
  const { data: fila, error: errState } = await supabase
    .from('mp_conexion_oauth_states')
    .update({ used_at: ahora.toISOString() })
    .eq('state', state)
    .is('used_at', null)
    .select('organization_id, payment_account_id, link_id, created_by, code_verifier, expires_at')
    .maybeSingle<FilaState>()
  if (errState) {
    console.error('[conciliacion-callback] quemar state:', errState.message)
    return sinState()
  }
  if (!fila) return sinState()

  const viaLink = !!fila.link_id
  const fallo = (m: Motivo) => (viaLink ? alTitular(m) : alDashboard({ mp: 'error', motivo: m }))

  if (new Date(fila.expires_at).getTime() < ahora.getTime()) return fallo('vencido')
  // Canceló en Mercado Pago (o MP volvió sin code).
  if (errorMp || !code) return fallo('cancelado')

  if (viaLink) {
    const { data: link, error: errLink } = await supabase
      .from('mp_conexion_links')
      .select('id, used_at, revoked_at, expires_at')
      .eq('id', fila.link_id!)
      .eq('organization_id', fila.organization_id)
      .maybeSingle<{ id: string; used_at: string | null; revoked_at: string | null; expires_at: string }>()
    if (errLink) {
      console.error('[conciliacion-callback] leer link:', errLink.message)
      return fallo('fallo')
    }
    if (!link || link.used_at || link.revoked_at || new Date(link.expires_at).getTime() < ahora.getTime()) return fallo('vencido')
  }

  const app = appConciliacion()
  if (!app || !fila.code_verifier) return fallo('fallo')

  // ¿La sesión que vuelve es la del dueño que pidió la conexión? Entonces ya
  // vio lo que autorizaba y la cuenta queda confirmada.
  let confirmada = false
  if (!viaLink && fila.created_by) {
    const user = await getCachedAuthUser()
    if (
      user?.id === fila.created_by &&
      (await getCurrentOrgId()) === fila.organization_id &&
      (await currentUserCan('conciliacion.manage'))
    ) {
      confirmada = true
    }
  }

  let tokens
  try {
    tokens = await canjearCodigo({ app, code, verificador: fila.code_verifier })
  } catch (e) {
    const t = traducirErrorMp(e)
    console.error('[conciliacion-callback] canje:', t.titulo, t.codigo)
    // El code dura 10 minutos y es de un uso: un invalid_grant es "se venció".
    return fallo(/invalid[_ ]?grant/i.test(t.codigo) ? 'vencido' : 'fallo')
  }
  if (!tokens.liveMode) {
    console.error('[conciliacion-callback] se autorizó una cuenta de prueba')
    return fallo('fallo')
  }

  let identidad
  try {
    identidad = await leerIdentidad(tokens.accessToken)
  } catch (e) {
    const t = traducirErrorMp(e)
    console.error('[conciliacion-callback] identidad:', t.titulo, t.codigo)
    return fallo('fallo')
  }
  if (identidad.mpUserId !== tokens.userId) {
    console.error('[conciliacion-callback] la identidad no coincide con la autorización')
    return fallo('fallo')
  }

  let cuentaMpId: string
  try {
    cuentaMpId = await guardarConexion({
      orgId: fila.organization_id,
      mpUserId: tokens.userId,
      modo: 'oauth',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      liveMode: tokens.liveMode,
      nickname: identidad.nickname,
      titular: identidad.titular,
      emailEnmascarado: enmascararEmail(identidad.email),
      via: viaLink ? 'link' : 'dashboard',
      por: fila.created_by,
      confirmada,
    })
    await vincularCuentasDeCobro(fila.organization_id, cuentaMpId, fila.payment_account_id)
  } catch (e) {
    console.error('[conciliacion-callback] guardar:', e instanceof Error ? e.message : e)
    return fallo('fallo')
  }

  if (viaLink) {
    const { error: errUso } = await supabase
      .from('mp_conexion_links')
      .update({ used_at: new Date().toISOString(), mp_cuenta_id: cuentaMpId, resultado: 'conectada' })
      .eq('id', fila.link_id!)
      .is('used_at', null)
    // La cuenta YA quedó conectada: al titular se le dice que salió bien; el
    // dashboard la ve conectada en la tarjeta aunque el link no se haya marcado.
    if (errUso) console.error('[conciliacion-callback] marcar link usado:', errUso.message)
    return alTitular('ok')
  }
  return alDashboard({ conectada: cuentaMpId })
}
