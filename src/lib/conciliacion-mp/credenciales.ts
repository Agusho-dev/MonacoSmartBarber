import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/credenciales.ts
// El ÚNICO archivo de la conciliación que lee o escribe las columnas cifradas
// de `mp_cuentas`. Los tokens viven cifrados (AES-256-GCM, misma clave maestra
// que señas y ARCA: src/lib/crypto/secretos.ts) y en claro sólo existen en
// memoria mientras se lee Mercado Pago. Nunca se loguean, ni enteros ni
// truncados, ni van en un mensaje de error.
//
// RENOVACIÓN PEREZOSA (mismo criterio que src/lib/mercadopago/credenciales.ts):
// el permiso OAuth dura 180 días; si al ir a leer faltan menos de 30, se renueva
// en ese momento y se guarda en la misma operación. Mientras el token viejo
// siga vivo, una renovación que falla no corta la lectura: se sigue leyendo y,
// si MP dijo que el refresh ya no vale, se avisa (`aviso` → last_error). El
// refresh_token es ROTATIVO: el nuevo y el access se guardan en el MISMO update
// (con un reintento), y si eso falla se TIRA — el viejo ya quedó quemado en
// Mercado Pago. Quien lee sigue con la fila que devuelve `tokenParaLeer`, que
// trae los tokens nuevos.
//
// No toca `branch_payment_providers` (señas) en ningún camino.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { cifrarSecreto, descifrarSecreto } from '@/lib/crypto/secretos'
import { esErrorMercadoPago } from '@/lib/mercadopago/http'
import { normalizarAlias } from './filas'
import { diaAR, diaMes } from './fechas'
import { leerCuentasDeCobro } from './datos'
import { appConciliacion, renovarToken } from './oauth'

const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000

export interface FilaCuentaMpConToken {
  id: string
  organization_id: string
  mp_user_id: string
  connection_mode: string
  access_token_cifrado: string | null
  refresh_token_cifrado: string | null
  token_expires_at: string | null
  status: string
  last_error: string | null
  last_check_at: string | null
  sync_cursor: string | null
  sincronizada_desde: string | null
  sincronizada_hasta: string | null
  last_sync_at: string | null
}

const COLUMNAS_CON_TOKEN =
  'id, organization_id, mp_user_id, connection_mode, access_token_cifrado, refresh_token_cifrado, token_expires_at, ' +
  'status, last_error, last_check_at, sync_cursor, sincronizada_desde, sincronizada_hasta, last_sync_at'

export async function leerCuentaMpConToken(id: string): Promise<FilaCuentaMpConToken | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mp_cuentas')
    .select(COLUMNAS_CON_TOKEN)
    .eq('id', id)
    .maybeSingle<FilaCuentaMpConToken>()
  if (error) throw new Error(`No pudimos leer la cuenta de Mercado Pago: ${error.message}`)
  return data
}

export type MotivoErrorToken = 'sin_token' | 'descifrado' | 'sin_app' | 'renovacion' | 'revocado' | 'guardado' | 'desconectada'

/** Un problema con el permiso guardado. El mensaje es apto para `last_error` (corto, sin datos del token). */
export class ErrorToken extends Error {
  readonly name = 'ErrorToken'
  constructor(
    message: string,
    readonly motivo: MotivoErrorToken,
  ) {
    super(message)
  }
}

export interface TokenParaLeer {
  /** El access token EN CLARO. Sólo vive en memoria mientras se lee. */
  token: string
  /**
   * La fila con los tokens que quedaron guardados. Después de una renovación
   * trae los NUEVOS: el refresh es rotativo y el viejo ya quedó quemado en
   * Mercado Pago, así que una renovación forzada más tarde en la misma lectura
   * tiene que usar ésta.
   */
  fila: FilaCuentaMpConToken
  /** Un problema con el permiso que todavía no corta la lectura (para `last_error`). */
  aviso: string | null
}

/**
 * El access token para leer Mercado Pago, renovado si hace falta (o si se pide
 * `forzarRenovacion`, después de un 401). Tira `ErrorToken`.
 *
 * Mientras el access token siga vivo, una renovación que falla NO corta la
 * lectura (ni siquiera con invalid_grant: ese refresh puede haberse quemado en
 * una renovación que no se pudo guardar): se sigue leyendo y se avisa que hay
 * que volver a autorizar antes de que venza.
 */
export async function tokenParaLeer(fila: FilaCuentaMpConToken, opts: { forzarRenovacion?: boolean } = {}): Promise<TokenParaLeer> {
  if (!fila.access_token_cifrado) throw new ErrorToken('La cuenta no tiene un permiso guardado', 'sin_token')
  let token: string
  try {
    token = await descifrarSecreto(fila.access_token_cifrado)
  } catch {
    throw new ErrorToken('No pudimos leer el permiso guardado', 'descifrado')
  }
  const tal = (aviso: string | null = null): TokenParaLeer => ({ token, fila, aviso })

  const esOauth = fila.connection_mode === 'oauth' && !!fila.refresh_token_cifrado
  if (!esOauth) {
    // Un token pegado a mano no se renueva: si dejó de servir, hay que pegar otro
    // (y uno de OAuth sin refresh_token, volver a autorizar).
    if (opts.forzarRenovacion) {
      throw new ErrorToken(fila.connection_mode === 'oauth' ? 'El titular quitó el permiso' : 'El token dejó de servir', 'revocado')
    }
    return tal()
  }

  const vence = fila.token_expires_at ? new Date(fila.token_expires_at).getTime() : null
  const sigueVivo = vence === null || vence > Date.now()
  const hayQueRenovar = opts.forzarRenovacion || (vence !== null && vence - Date.now() < MARGEN_RENOVACION_MS)
  if (!hayQueRenovar) return tal()
  const antesDel = vence !== null ? ` antes del ${diaMes(diaAR(vence))}` : ''

  const app = appConciliacion()
  if (!app) {
    if (!opts.forzarRenovacion && sigueVivo) return tal(`Falta configurar la aplicación de Mercado Pago para renovar el permiso${antesDel}`)
    throw new ErrorToken('Falta configurar la aplicación de Mercado Pago para renovar el permiso', 'sin_app')
  }

  let refresh: string
  try {
    refresh = await descifrarSecreto(fila.refresh_token_cifrado!)
  } catch {
    if (!opts.forzarRenovacion && sigueVivo) return tal(`No pudimos renovar el permiso: hay que volver a autorizar la cuenta${antesDel}`)
    throw new ErrorToken('No pudimos leer el permiso guardado', 'descifrado')
  }

  let nuevos
  try {
    nuevos = await renovarToken({ app, refreshToken: refresh })
  } catch (e) {
    // invalid_grant (400) o 401/403: el titular quitó el permiso o el refresh ya no vale.
    const revocado =
      esErrorMercadoPago(e) && (e.status === 401 || e.status === 403 || (e.status === 400 && /invalid_grant/i.test(e.detalles.mpError ?? '')))
    if (!opts.forzarRenovacion && sigueVivo) {
      // Un hipo de MP renovando: se reintenta la próxima vez. Un refresh que ya
      // no vale: se sigue leyendo con el access vivo y se avisa.
      return tal(revocado ? `Mercado Pago no renovó el permiso: hay que volver a autorizar la cuenta${antesDel}` : null)
    }
    throw new ErrorToken(revocado ? 'El titular quitó el permiso' : 'No pudimos renovar el permiso', revocado ? 'revocado' : 'renovacion')
  }

  const supabase = createAdminClient()
  const cambios = {
    access_token_cifrado: await cifrarSecreto(nuevos.accessToken),
    refresh_token_cifrado: await cifrarSecreto(nuevos.refreshToken ?? refresh),
    token_expires_at: new Date(Date.now() + nuevos.expiresIn * 1000).toISOString(),
    live_mode: nuevos.liveMode,
  }
  // Los DOS tokens en el MISMO update: el refresh es rotativo y el viejo ya no
  // sirve. Un segundo intento antes de rendirse (el timeout de 8 s de Supabase
  // alcanza para perderlo). Y sólo sobre una cuenta que sigue conectada: si el
  // dueño tocó "Desconectar" mientras se leía (borrarTokens), desconectar es
  // borrar los tokens, y una renovación en vuelo no los puede volver a guardar.
  const guardarTokens = () =>
    supabase
      .from('mp_cuentas')
      .update(cambios)
      .eq('id', fila.id)
      .not('access_token_cifrado', 'is', null)
      .neq('status', 'desconectada')
      .select('id')
  let { data: guardadas, error } = await guardarTokens()
  if (error) {
    console.error('[conciliacion-credenciales] guardar renovación (se reintenta):', error.message)
    ;({ data: guardadas, error } = await guardarTokens())
  }
  if (error) {
    console.error('[conciliacion-credenciales] guardar renovación:', error.message)
    throw new ErrorToken('Renovamos el permiso pero no pudimos guardarlo: hay que volver a autorizar la cuenta', 'guardado')
  }
  if (!guardadas?.length) throw new ErrorToken('La cuenta se desconectó mientras se leía', 'desconectada')
  return {
    token: nuevos.accessToken,
    fila: {
      ...fila,
      access_token_cifrado: cambios.access_token_cifrado,
      refresh_token_cifrado: cambios.refresh_token_cifrado,
      token_expires_at: cambios.token_expires_at,
    },
    aviso: null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardar una conexión y vincular las cuentas de cobro
// ─────────────────────────────────────────────────────────────────────────────

export interface NuevaConexion {
  orgId: string
  mpUserId: string
  modo: 'oauth' | 'manual'
  accessToken: string
  refreshToken: string | null
  /** Segundos; null = no vence (token manual). */
  expiresIn: number | null
  liveMode: boolean
  nickname: string | null
  titular: string | null
  emailEnmascarado: string | null
  via: 'dashboard' | 'link'
  /** auth.users.id de quien conectó (null si vino por el link del titular). */
  por: string | null
  /** El dueño ya vio la identidad (token manual o autorización propia desde el dashboard). */
  confirmada: boolean
}

/**
 * Crea o actualiza la cuenta de MP de la org (una por mp_user_id). La lectura
 * (`sync_cursor`, `sincronizada_*`) se conserva: lo ya traído sigue valiendo.
 */
export async function guardarConexion(c: NuevaConexion): Promise<string> {
  const ahora = new Date().toISOString()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mp_cuentas')
    .upsert(
      {
        organization_id: c.orgId,
        mp_user_id: c.mpUserId,
        nickname: c.nickname,
        titular: c.titular,
        email_enmascarado: c.emailEnmascarado,
        connection_mode: c.modo,
        access_token_cifrado: await cifrarSecreto(c.accessToken),
        refresh_token_cifrado: c.refreshToken ? await cifrarSecreto(c.refreshToken) : null,
        token_expires_at: c.expiresIn ? new Date(Date.now() + c.expiresIn * 1000).toISOString() : null,
        live_mode: c.liveMode,
        status: 'conectada',
        last_error: null,
        last_check_at: ahora,
        confirmada_at: c.confirmada ? ahora : null,
        confirmada_por: c.confirmada ? c.por : null,
        connected_at: ahora,
        connected_by: c.por,
        connected_via: c.via,
      },
      { onConflict: 'organization_id,mp_user_id' },
    )
    .select('id')
    .single<{ id: string }>()
  if (error || !data) {
    console.error('[conciliacion-credenciales] guardar conexión:', error?.message)
    throw new Error('No pudimos guardar la conexión con Mercado Pago.')
  }
  return data.id
}

/**
 * Vincula la cuenta de cobro elegida y TODAS las de la org con el mismo alias
 * normalizado (barberia.monaco cargada en Caseros y en Paraná es UNA cuenta de
 * MP). Devuelve las vinculadas.
 */
export async function vincularCuentasDeCobro(
  orgId: string,
  cuentaMpId: string,
  paymentAccountId: string,
): Promise<{ id: string; alias: string | null }[]> {
  const cuentas = await leerCuentasDeCobro(orgId)
  const elegida = cuentas.find((p) => p.id === paymentAccountId)
  if (!elegida) throw new Error('La cuenta de cobro no es de esta organización.')
  const alias = normalizarAlias(elegida.alias)
  const vincular = cuentas.filter((p) => p.id === paymentAccountId || (alias && normalizarAlias(p.alias) === alias))
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('payment_accounts')
    .update({ mp_cuenta_id: cuentaMpId, fuente_conciliacion: 'mercadopago' })
    .in(
      'id',
      vincular.map((p) => p.id),
    )
  if (error) {
    console.error('[conciliacion-credenciales] vincular cuentas de cobro:', error.message)
    throw new Error('Conectamos la cuenta, pero no pudimos vincularla a la cuenta de cobro.')
  }
  return vincular.map((p) => ({ id: p.id, alias: p.alias }))
}

/** Desconecta: borra los tokens. Los movimientos ya traídos quedan (siguen verificando lo leído). */
export async function borrarTokens(orgId: string, cuentaMpId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('mp_cuentas')
    .update({
      access_token_cifrado: null,
      refresh_token_cifrado: null,
      token_expires_at: null,
      status: 'desconectada',
      last_error: null,
      last_check_at: new Date().toISOString(),
    })
    .eq('id', cuentaMpId)
    .eq('organization_id', orgId)
  if (error) {
    console.error('[conciliacion-credenciales] desconectar:', error.message)
    throw new Error('No pudimos desconectar la cuenta.')
  }
}
