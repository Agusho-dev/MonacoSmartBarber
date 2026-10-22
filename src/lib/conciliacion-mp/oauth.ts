import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/oauth.ts
// El OAuth de la CONCILIACIÓN: una aplicación de Mercado Pago aparte de la de
// señas (env MP_CONCILIACION_*). La de señas cobra en la cuenta de la sucursal;
// ésta sólo LEE los cobros de las cuentas personales de los barberos, y la
// autoriza el titular desde su celular con un link de un uso.
//
// PKCE (S256) además del `state`: el `code` vuelve por el browser del barbero
// —que no tiene sesión en el dashboard— y el `code_verifier` que se guardó al
// armar la URL es lo único que lo vuelve canjeable. Un `code` interceptado no
// sirve sin él.
//
// Ni el token ni el code ni el verifier se loguean ni viajan en una URL nuestra.
// =============================================================================

import { createHash, randomBytes } from 'crypto'

import { createAdminClient } from '@/lib/supabase/server'
import { pedirAMercadoPago, postSinToken } from '@/lib/mercadopago/http'
import { urlAppProduccion } from '@/lib/mercadopago/credenciales'
import type { IdentidadMP } from './contrato'

/** El dominio de autorización de Argentina (el mismo que usa la app de señas). */
const AUTORIZACION = 'https://auth.mercadopago.com.ar/authorization'
/** El `state` vive 10 minutos: lo que tarda alguien en entrar a MP y tocar Autorizar. */
export const MINUTOS_STATE = 10

export interface AppConciliacion {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/** El redirect es ESTÁTICO (MP lo compara letra por letra con el del panel): lo que varía viaja en `state`. */
export function redirectUriConciliacion(): string {
  const explicito = (process.env.MP_CONCILIACION_REDIRECT_URI ?? '').trim()
  return explicito || `${urlAppProduccion()}/api/mercadopago/conciliacion/callback`
}

/** Las credenciales de la app de conciliación, o null si no están: entonces sólo queda el token manual. */
export function appConciliacion(): AppConciliacion | null {
  const clientId = (process.env.MP_CONCILIACION_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.MP_CONCILIACION_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri: redirectUriConciliacion() }
}

export function oauthDisponible(): boolean {
  return appConciliacion() !== null
}

/** 'cmp_' + 32 bytes base64url. El prefijo lo separa de los `state` de señas en cualquier log. */
export function generarState(): string {
  return `cmp_${randomBytes(32).toString('base64url')}`
}

export function generarPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(32).toString('base64url') // 43 caracteres, dentro de 43–128
  const desafio = createHash('sha256').update(verificador).digest('base64url')
  return { verificador, desafio }
}

export function urlAutorizacion(p: { app: AppConciliacion; state: string; desafio: string }): string {
  const url = new URL(AUTORIZACION)
  url.searchParams.set('client_id', p.app.clientId)
  url.searchParams.set('response_type', 'code')
  // Sin platform_id=mp MP muestra el flujo de otra plataforma y la autorización
  // no queda asociada a la aplicación.
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', p.state)
  url.searchParams.set('redirect_uri', p.app.redirectUri)
  url.searchParams.set('code_challenge', p.desafio)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * Crea el `state` (un uso, 10 min) con su `code_verifier` y devuelve la URL de
 * Mercado Pago. Lo usan el link del titular (sin sesión: `linkId`) y el dueño
 * desde el dashboard (`creadoPor`).
 */
export async function prepararAutorizacion(p: {
  orgId: string
  paymentAccountId: string
  linkId: string | null
  creadoPor: string | null
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const app = appConciliacion()
  if (!app) {
    return { ok: false, error: 'Falta configurar la aplicación de Mercado Pago de la conciliación (una sola vez).' }
  }
  const state = generarState()
  const { verificador, desafio } = generarPkce()
  const supabase = createAdminClient()
  const { error } = await supabase.from('mp_conexion_oauth_states').insert({
    state,
    organization_id: p.orgId,
    payment_account_id: p.paymentAccountId,
    link_id: p.linkId,
    created_by: p.creadoPor,
    code_verifier: verificador,
    expires_at: new Date(Date.now() + MINUTOS_STATE * 60_000).toISOString(),
  })
  // Sin el state guardado el callback lo rechaza: mandar a alguien a Mercado
  // Pago igual sería hacerlo autorizar para nada.
  if (error) {
    console.error('[conciliacion-oauth] guardar state:', error.message)
    return { ok: false, error: 'No pudimos preparar la autorización. Probá de nuevo en un momento.' }
  }
  return { ok: true, url: urlAutorizacion({ app, state, desafio }) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canje y renovación
// ─────────────────────────────────────────────────────────────────────────────

interface RespuestaOauthMp {
  access_token?: string
  refresh_token?: string
  user_id?: number | string
  live_mode?: boolean
  expires_in?: number
}

export interface TokensConciliacion {
  accessToken: string
  /** Rotativo: el anterior queda quemado apenas se usa. */
  refreshToken: string | null
  userId: string
  liveMode: boolean
  /** Segundos (MP: 180 días). */
  expiresIn: number
}

function normalizar(r: RespuestaOauthMp, contexto: string): TokensConciliacion {
  if (!r?.access_token) throw new Error(`Mercado Pago no devolvió el permiso al ${contexto}.`)
  if (r.user_id === undefined || r.user_id === null || r.user_id === '') {
    throw new Error(`Mercado Pago no devolvió la cuenta al ${contexto}.`)
  }
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    userId: String(r.user_id),
    liveMode: r.live_mode !== false,
    expiresIn: typeof r.expires_in === 'number' && r.expires_in > 0 ? r.expires_in : 15_552_000,
  }
}

/** Canjea el `code` con el `code_verifier` del state. El redirect_uri tiene que ser IDÉNTICO al de la URL. */
export async function canjearCodigo(p: { app: AppConciliacion; code: string; verificador: string }): Promise<TokensConciliacion> {
  const r = await postSinToken<RespuestaOauthMp>('/oauth/token', {
    client_id: p.app.clientId,
    client_secret: p.app.clientSecret,
    code: p.code,
    grant_type: 'authorization_code',
    redirect_uri: p.app.redirectUri,
    code_verifier: p.verificador,
  })
  return normalizar(r, 'canjear la autorización')
}

/**
 * Renueva el permiso. El refresh_token que vuelve es NUEVO y el anterior queda
 * quemado: quien llama guarda los dos en el MISMO update.
 */
export async function renovarToken(p: { app: AppConciliacion; refreshToken: string }): Promise<TokensConciliacion> {
  const r = await postSinToken<RespuestaOauthMp>('/oauth/token', {
    client_id: p.app.clientId,
    client_secret: p.app.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
  })
  const t = normalizar(r, 'renovar el permiso')
  // Si MP no manda uno nuevo, el viejo sigue siendo el único que hay.
  return t.refreshToken ? t : { ...t, refreshToken: p.refreshToken }
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad de la cuenta (para que el dueño confirme que es la correcta)
// ─────────────────────────────────────────────────────────────────────────────

interface UsuarioMp {
  id?: number | string
  nickname?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

export interface IdentidadCruda {
  mpUserId: string
  nickname: string | null
  titular: string | null
  email: string | null
}

/** `GET /users/me`: confirma que el token sirve y dice de quién es la cuenta. */
export async function leerIdentidad(token: string): Promise<IdentidadCruda> {
  const u = await pedirAMercadoPago<UsuarioMp>({ metodo: 'GET', ruta: '/users/me', token, reintentos: 2, timeoutMs: 12_000 })
  if (u?.id === undefined || u?.id === null) throw new Error('Mercado Pago no devolvió el id de la cuenta.')
  const nombre = [u.first_name, u.last_name].map((x) => (x ?? '').trim()).filter(Boolean).join(' ')
  return {
    mpUserId: String(u.id),
    nickname: u.nickname?.trim() || null,
    titular: nombre || null,
    email: u.email?.trim() || null,
  }
}

/** "lu•••@gmail.com": alcanza para reconocer la cuenta sin guardar el email entero. */
export function enmascararEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null
  const [local, dominio] = email.split('@')
  if (!local || !dominio) return null
  return `${local.slice(0, Math.min(2, local.length))}•••@${dominio}`
}

export function identidadPublica(i: IdentidadCruda, liveMode: boolean): IdentidadMP {
  return {
    mpUserId: i.mpUserId,
    nickname: i.nickname,
    titular: i.titular,
    emailEnmascarado: enmascararEmail(i.email),
    liveMode,
  }
}
