// =============================================================================
// src/lib/mercadopago/oauth.ts
// El baile de OAuth con Mercado Pago: es lo que permite que CADA SUCURSAL cobre
// en su propia cuenta sin que nadie tenga que pegar un access_token en un
// formulario.
//
// EL REDIRECT_URI ES ESTÁTICO Y LA SUCURSAL VIAJA EN `state`
// ----------------------------------------------------------
// Mercado Pago exige que el redirect_uri coincida EXACTAMENTE con el que está
// cargado en el panel de la aplicación, así que no se le puede colgar
// `?branch=<uuid>`. La sucursal viaja en `state`, que además es el anti-CSRF:
// la fila de `payment_oauth_states` dice a qué sucursal corresponde el código
// que vuelve. Sin eso, cualquiera podría hacer que el dueño autorizara SU
// cuenta contra la sucursal de otro.
//
// EL REFRESH_TOKEN ES ROTATIVO — TRATALO COMO DE UN SOLO USO
// ----------------------------------------------------------
// `grant_type=refresh_token` devuelve un access_token nuevo Y UN REFRESH_TOKEN
// NUEVO. El anterior queda quemado. Si se guarda el access_token y se conserva
// el refresh viejo, la renovación siguiente falla y la sucursal deja de cobrar
// sin que nada lo avise. Por eso `credenciales.ts` persiste los dos en la MISMA
// operación, y por eso esta función devuelve los dos juntos: no hay forma de
// usarla y "olvidarse" del refresh.
//
// EL CÓDIGO DE AUTORIZACIÓN DURA 10 MINUTOS. Un usuario que deja la pestaña
// abierta y vuelve al rato recibe `invalid_grant`: hay que mandarlo a conectar
// de nuevo, no reintentar.
// =============================================================================

import { postSinToken } from './http'

/** El dominio de autorización es el de Argentina: MP separa por sitio. */
const AUTORIZACION = 'https://auth.mercadopago.com.ar/authorization'

export interface TokensMp {
    accessToken: string
    /** Rotativo: el anterior queda quemado apenas se usa. */
    refreshToken: string | null
    publicKey: string | null
    /** El collector_id de la cuenta. Es lo que mapea notificación → sucursal. */
    userId: string
    /** false = credenciales de prueba. Sirve para no cobrarle de verdad a nadie por error. */
    liveMode: boolean
    /** Segundos. MP devuelve 15552000 = 180 días. */
    expiresIn: number
}

/**
 * La URL a la que se manda al dueño para que autorice la cuenta de la sucursal.
 *
 * `platform_id=mp` es obligatorio y no está de adorno: sin él, MP muestra el
 * flujo de otra plataforma y la autorización no queda asociada a la aplicación.
 */
export function urlDeAutorizacion(p: {
    clientId: string
    redirectUri: string
    state: string
}): string {
    const url = new URL(AUTORIZACION)
    url.searchParams.set('client_id', p.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('platform_id', 'mp')
    url.searchParams.set('state', p.state)
    url.searchParams.set('redirect_uri', p.redirectUri)
    return url.toString()
}

/** La forma cruda de `/oauth/token`. */
interface RespuestaOauthMp {
    access_token?: string
    refresh_token?: string
    public_key?: string
    user_id?: number | string
    live_mode?: boolean
    expires_in?: number
    token_type?: string
    scope?: string
}

function normalizar(r: RespuestaOauthMp, contexto: string): TokensMp {
    if (!r.access_token) {
        throw new Error(`Mercado Pago no devolvió access_token al ${contexto}.`)
    }
    if (r.user_id === undefined || r.user_id === null || r.user_id === '') {
        // Sin user_id no se puede resolver de qué cuenta viene una notificación:
        // guardar la conexión igual dejaría los webhooks huérfanos.
        throw new Error(`Mercado Pago no devolvió user_id al ${contexto}.`)
    }
    return {
        accessToken: r.access_token,
        refreshToken: r.refresh_token ?? null,
        publicKey: r.public_key ?? null,
        userId: String(r.user_id),
        liveMode: r.live_mode !== false,
        // 180 días es lo que documenta MP; el default está por si algún día
        // dejan de mandarlo y no queremos calcular un vencimiento en el pasado.
        expiresIn: typeof r.expires_in === 'number' && r.expires_in > 0 ? r.expires_in : 15_552_000,
    }
}

/**
 * Canjea el `code` del redirect por los tokens de la cuenta.
 *
 * El `redirect_uri` tiene que ser IDÉNTICO al que se usó para armar la URL de
 * autorización (y al del panel de MP): si difiere aunque sea en la barra final,
 * MP contesta `invalid_grant` sin explicar cuál de los tres no coincide.
 */
export async function canjearCodigo(p: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
}): Promise<TokensMp> {
    const r = await postSinToken<RespuestaOauthMp>('/oauth/token', {
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code: p.code,
        grant_type: 'authorization_code',
        redirect_uri: p.redirectUri,
    })
    return normalizar(r, 'canjear el código de autorización')
}

/**
 * Renueva el access_token.
 *
 * ATENCIÓN: el `refreshToken` que devuelve es NUEVO y el que se pasó queda
 * quemado. Quien llame tiene que persistir los dos campos juntos; guardar sólo
 * el access_token deja a la sucursal sin poder renovar la próxima vez.
 */
export async function renovarToken(p: {
    clientId: string
    clientSecret: string
    refreshToken: string
}): Promise<TokensMp> {
    const r = await postSinToken<RespuestaOauthMp>('/oauth/token', {
        client_id: p.clientId,
        client_secret: p.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: p.refreshToken,
    })
    const tokens = normalizar(r, 'renovar el token')
    if (!tokens.refreshToken) {
        // Si MP no manda uno nuevo, el viejo sigue siendo el único que tenemos:
        // devolverlo evita que `credenciales.ts` guarde NULL y deje la cuenta
        // sin forma de renovar.
        return { ...tokens, refreshToken: p.refreshToken }
    }
    return tokens
}
