'use server'

// =============================================================================
// src/lib/actions/conciliacion-mp.ts
// Las server actions de la conciliación con Mercado Pago (/dashboard/conciliacion).
//
// Cada una: permiso del rol (`conciliacion.view` para leer, `.manage` para
// escribir), org de la sesión, alcance de sucursales, y TODO id que llega del
// browser verificado contra la org y el alcance antes de usarlo. Las tablas
// mp_* son sólo de service_role (mig 228), así que después de esa puerta todo
// va con createAdminClient().
//
// Sincronizar sólo LEE Mercado Pago y escribe nuestra tabla: por eso la lectura
// automática al abrir la pantalla alcanza con `view`; el botón a mano pide
// `manage`.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { isValidUUID } from '@/lib/validation'
import { rateLimit } from '@/lib/rate-limit'
import { urlAppProduccion } from '@/lib/mercadopago/credenciales'
import { esErrorMercadoPago } from '@/lib/mercadopago/http'
import type {
  LinkConexion,
  MotivoRevision,
  RespuestaConciliacion,
  RespuestaEstadoLink,
  RespuestaTira,
  ResultadoSync,
  ResultadoVerificarToken,
} from '@/lib/conciliacion-mp/contrato'
import { MOTIVOS_REVISION } from '@/lib/conciliacion-mp/contrato'
import { nombreDeUsuario, verificarAcceso } from '@/lib/conciliacion-mp/acceso'
import {
  MAX_DIAS_PERIODO,
  conciliarPeriodo,
  cuentaCobroEnAlcance,
  cuentaMpEnAlcance,
  cuentasSincronizables,
  oauthDisponible,
  tiraDias,
} from '@/lib/conciliacion-mp/servicio'
import { sincronizarCuenta } from '@/lib/conciliacion-mp/sync'
import { enmascararEmail, identidadPublica, leerIdentidad, prepararAutorizacion } from '@/lib/conciliacion-mp/oauth'
import { borrarTokens, guardarConexion, vincularCuentasDeCobro } from '@/lib/conciliacion-mp/credenciales'
import { HORAS_LINK, estadoDeLink, generarTokenLink, hashToken, type FilaLink } from '@/lib/conciliacion-mp/links'
import { diaAR, fechaLarga, hhmmAR } from '@/lib/conciliacion-mp/fechas'
import { enLotes } from '@/lib/conciliacion-mp/paginar'
import { leerCuentasDeCobro } from '@/lib/conciliacion-mp/datos'
import { normalizarAlias } from '@/lib/conciliacion-mp/filas'

const NO_ENCONTRADA = 'No encontramos esa cuenta en tu organización.'
const ERROR_GENERICO = 'Algo falló. Probá de nuevo en un momento.'
const MAX_NOTA = 500

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function paraMostrar(e: unknown, siNo: string = ERROR_GENERICO): string {
  const m = mensaje(e)
  return /^(No pudimos|Conectamos|Renovamos|La cuenta)/.test(m) ? m : siNo
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

export async function obtenerConciliacion(input: {
  /** ISO */
  desde: string
  /** ISO (excluyente) */
  hasta: string
  sucursalId?: string | null
  etiqueta?: string
}): Promise<RespuestaConciliacion> {
  const acc = await verificarAcceso('conciliacion.view')
  if (!acc.ok) return acc
  const desde = new Date(input?.desde ?? '')
  const hasta = new Date(input?.hasta ?? '')
  if (!Number.isFinite(desde.getTime()) || !Number.isFinite(hasta.getTime()) || hasta <= desde) {
    return { ok: false, error: 'El período no es válido.' }
  }
  if (hasta.getTime() - desde.getTime() > MAX_DIAS_PERIODO * 24 * 3600_000 + 3600_000) {
    return { ok: false, error: `El período puede tener hasta ${MAX_DIAS_PERIODO} días.` }
  }
  let sucursales = acc.alcance
  if (input.sucursalId) {
    if (!acc.alcance.includes(input.sucursalId)) return { ok: false, error: 'No tenés acceso a esa sucursal.' }
    sucursales = [input.sucursalId]
  }
  return conciliarPeriodo(acc.orgId, {
    desde,
    hasta,
    sucursalesIds: sucursales,
    etiqueta: typeof input.etiqueta === 'string' ? input.etiqueta.slice(0, 60) : undefined,
  })
}

export async function obtenerTiraConciliacion(input?: { dias?: number; sucursalId?: string | null }): Promise<RespuestaTira> {
  const acc = await verificarAcceso('conciliacion.view')
  if (!acc.ok) return acc
  const dias = Number.isFinite(input?.dias) ? Math.max(1, Math.min(MAX_DIAS_PERIODO, Math.round(input!.dias!))) : 30
  let sucursales = acc.alcance
  if (input?.sucursalId) {
    if (!acc.alcance.includes(input.sucursalId)) return { ok: false, error: 'No tenés acceso a esa sucursal.' }
    sucursales = [input.sucursalId]
  }
  return tiraDias(acc.orgId, { dias, sucursalesIds: sucursales })
}

export async function cuentasParaSincronizar(): Promise<
  | { ok: true; cuentas: { cuentaMpId: string; alias: string | null; ultimaSync: string | null; necesita: boolean }[] }
  | { ok: false; error: string }
> {
  const acc = await verificarAcceso('conciliacion.view')
  if (!acc.ok) return acc
  try {
    return { ok: true, cuentas: await cuentasSincronizables(acc.orgId, acc.alcance) }
  } catch (e) {
    console.error('[conciliacion] cuentasParaSincronizar:', mensaje(e))
    return { ok: false, error: paraMostrar(e, 'No pudimos leer las cuentas de Mercado Pago.') }
  }
}

export async function sincronizarCuentaMP(cuentaMpId: string, opts?: { origen?: 'manual' | 'auto' }): Promise<ResultadoSync> {
  const origen = opts?.origen === 'manual' ? 'manual' : 'auto'
  const vacio: ResultadoSync = { ok: false, cuentaMpId, alias: null, leidos: 0, nuevos: 0, actualizados: 0, sincronizadaHasta: null }
  const acc = await verificarAcceso(origen === 'manual' ? 'conciliacion.manage' : 'conciliacion.view')
  if (!acc.ok) return { ...vacio, error: acc.error }
  if (!isValidUUID(cuentaMpId)) return { ...vacio, error: NO_ENCONTRADA }
  try {
    const v = await cuentaMpEnAlcance(acc.orgId, cuentaMpId, acc.alcance)
    if (!v) return { ...vacio, error: NO_ENCONTRADA }
    // Golpear [Sincronizar] a mano no puede martillar a Mercado Pago.
    const gate = await rateLimit('mp_sync_cuenta', `${acc.userId ?? acc.orgId}:${cuentaMpId}`, { limit: 6, window: 60 })
    if (!gate.allowed) return { ...vacio, alias: v.alias, error: 'Ya se está leyendo seguido. Esperá un minuto.' }
    return await sincronizarCuenta(cuentaMpId, { origen, presupuestoMs: 45_000 })
  } catch (e) {
    console.error('[conciliacion] sincronizarCuentaMP:', mensaje(e))
    return { ...vacio, error: paraMostrar(e, 'No pudimos leer la cuenta. Probá de nuevo.') }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexión con token manual
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_INVALIDO = 'Ese token no es válido o es de prueba. Necesitamos uno de producción (APP_USR-…).'

function limpiarToken(t: unknown): string | null {
  const s = typeof t === 'string' ? t.trim() : ''
  if (!s || s.length > 400 || /\s/.test(s)) return null
  // Los de prueba empiezan con TEST-: leerían una cuenta de mentira.
  if (!s.startsWith('APP_USR-')) return null
  return s
}

async function identidadDeToken(token: string) {
  try {
    return { ok: true as const, identidad: await leerIdentidad(token) }
  } catch (e) {
    if (esErrorMercadoPago(e) && (e.status === 400 || e.status === 401 || e.status === 403)) return { ok: false as const, error: TOKEN_INVALIDO }
    return { ok: false as const, error: 'No pudimos validar el token con Mercado Pago. Probá de nuevo en un momento.' }
  }
}

export async function verificarTokenManual(input: { paymentAccountId: string; accessToken: string }): Promise<ResultadoVerificarToken> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(input?.paymentAccountId)) return { ok: false, error: NO_ENCONTRADA }
  const token = limpiarToken(input?.accessToken)
  if (!token) return { ok: false, error: TOKEN_INVALIDO }
  try {
    if (!(await cuentaCobroEnAlcance(acc.orgId, input.paymentAccountId, acc.alcance))) return { ok: false, error: NO_ENCONTRADA }
    const gate = await rateLimit('mp_token_manual', acc.userId ?? acc.orgId, { limit: 10, window: 600 })
    if (!gate.allowed) return { ok: false, error: 'Hubo demasiados intentos. Esperá unos minutos.' }
    const r = await identidadDeToken(token)
    if (!r.ok) return r

    // ¿Esa cuenta de MP ya está conectada en esta org? (para avisar antes de guardar)
    const supabase = createAdminClient()
    const { data: existente, error } = await supabase
      .from('mp_cuentas')
      .select('id')
      .eq('organization_id', acc.orgId)
      .eq('mp_user_id', r.identidad.mpUserId)
      .maybeSingle<{ id: string }>()
    if (error) throw new Error(`No pudimos verificar la cuenta: ${error.message}`)
    let yaConectadaComo: string[] = []
    if (existente) {
      const { data: pas, error: errPas } = await supabase
        .from('payment_accounts')
        .select('alias_or_cbu')
        .eq('mp_cuenta_id', existente.id)
        .limit(50)
      if (errPas) throw new Error(`No pudimos verificar la cuenta: ${errPas.message}`)
      yaConectadaComo = [...new Set((pas ?? []).map((p) => (p.alias_or_cbu as string | null)?.trim()).filter((x): x is string => !!x))]
    }
    return { ok: true, identidad: identidadPublica(r.identidad, true), yaConectadaComo }
  } catch (e) {
    console.error('[conciliacion] verificarTokenManual:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

/** Guarda el token (cifrado) y vincula la cuenta. `vinculadas` = ids de las cuentas de cobro vinculadas. */
export async function conectarCuentaManual(input: {
  paymentAccountId: string
  accessToken: string
}): Promise<{ ok: true; cuentaMpId: string; vinculadas: string[] } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(input?.paymentAccountId)) return { ok: false, error: NO_ENCONTRADA }
  const token = limpiarToken(input?.accessToken)
  if (!token) return { ok: false, error: TOKEN_INVALIDO }
  try {
    const pa = await cuentaCobroEnAlcance(acc.orgId, input.paymentAccountId, acc.alcance)
    if (!pa) return { ok: false, error: NO_ENCONTRADA }
    // Se vuelve a validar: entre "Verificar" y "Sí, es esta" el token pudo cambiar.
    const r = await identidadDeToken(token)
    if (!r.ok) return r
    const cuentaMpId = await guardarConexion({
      orgId: acc.orgId,
      mpUserId: r.identidad.mpUserId,
      modo: 'manual',
      accessToken: token,
      refreshToken: null,
      expiresIn: null,
      liveMode: true,
      nickname: r.identidad.nickname,
      titular: r.identidad.titular,
      emailEnmascarado: enmascararEmail(r.identidad.email),
      via: 'dashboard',
      por: acc.userId,
      // El dueño ya vio la identidad en el paso de verificación.
      confirmada: true,
    })
    const vinculadas = await vincularCuentasDeCobro(acc.orgId, cuentaMpId, pa.id)
    return { ok: true, cuentaMpId, vinculadas: vinculadas.map((v) => v.id) }
  } catch (e) {
    console.error('[conciliacion] conectarCuentaManual:', mensaje(e))
    return { ok: false, error: paraMostrar(e, 'No pudimos guardar la conexión. Probá de nuevo.') }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexión por OAuth (link para el titular, o el dueño desde el dashboard)
// ─────────────────────────────────────────────────────────────────────────────

function nombreDePila(nombre: string | null | undefined): string | null {
  const t = (nombre ?? '').trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null
}

export async function crearLinkConexion(
  paymentAccountId: string,
): Promise<{ ok: true; link: LinkConexion } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(paymentAccountId)) return { ok: false, error: NO_ENCONTRADA }
  if (!oauthDisponible()) {
    return { ok: false, error: 'Para mandar links falta configurar la aplicación de Mercado Pago (una sola vez).' }
  }
  try {
    const pa = await cuentaCobroEnAlcance(acc.orgId, paymentAccountId, acc.alcance)
    if (!pa) return { ok: false, error: NO_ENCONTRADA }
    if (pa.banco) return { ok: false, error: 'Esta cuenta está marcada como de banco: no se conecta a Mercado Pago.' }
    const gate = await rateLimit('mp_crear_link', acc.userId ?? acc.orgId, { limit: 30, window: 600 })
    if (!gate.allowed) return { ok: false, error: 'Creaste muchos links seguidos. Esperá unos minutos.' }

    const supabase = createAdminClient()
    const ahora = new Date()
    // Un link vivo por cuenta de cobro: el nuevo anula los pendientes.
    const { error: errAnular } = await supabase
      .from('mp_conexion_links')
      .update({ revoked_at: ahora.toISOString() })
      .eq('organization_id', acc.orgId)
      .eq('payment_account_id', pa.id)
      .is('used_at', null)
      .is('revoked_at', null)
    if (errAnular) throw new Error(`No pudimos anular el link anterior: ${errAnular.message}`)

    const token = generarTokenLink()
    const vence = new Date(ahora.getTime() + HORAS_LINK * 3600_000)
    const { data, error } = await supabase
      .from('mp_conexion_links')
      .insert({
        organization_id: acc.orgId,
        payment_account_id: pa.id,
        token_hash: hashToken(token),
        created_by: acc.userId,
        expires_at: vence.toISOString(),
      })
      .select('id, expires_at')
      .single<{ id: string; expires_at: string }>()
    if (error || !data) throw new Error(`No pudimos crear el link: ${error?.message ?? 'sin respuesta'}`)

    const url = `${urlAppProduccion()}/conectar-mp/${token}`
    const nombre = nombreDePila(pa.nombre)
    const cuando = `${fechaLarga(diaAR(data.expires_at))} a las ${hhmmAR(data.expires_at)}`
    const mensajeWhatsApp =
      `Hola${nombre ? ` ${nombre}` : ''}, para que el sistema controle solo las transferencias de ${pa.alias ?? 'tu cuenta'} ` +
      `necesito que autorices tu cuenta de Mercado Pago. Es un minuto: ${url} (vence el ${cuando}).`
    return {
      ok: true,
      link: {
        id: data.id,
        url,
        venceEn: data.expires_at,
        mensajeWhatsApp,
        urlWhatsApp: `https://wa.me/?text=${encodeURIComponent(mensajeWhatsApp)}`,
      },
    }
  } catch (e) {
    console.error('[conciliacion] crearLinkConexion:', mensaje(e))
    return { ok: false, error: paraMostrar(e, 'No pudimos crear el link. Probá de nuevo.') }
  }
}

/** El link, si es de la org y de una cuenta de cobro del alcance. */
async function linkEnAlcance(orgId: string, linkId: string, alcance: string[]): Promise<FilaLink | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mp_conexion_links')
    .select('id, organization_id, payment_account_id, expires_at, abierto_at, used_at, revoked_at, mp_cuenta_id, resultado')
    .eq('id', linkId)
    .eq('organization_id', orgId)
    .maybeSingle<FilaLink>()
  if (error) throw new Error(`No pudimos leer el link: ${error.message}`)
  if (!data) return null
  return (await cuentaCobroEnAlcance(orgId, data.payment_account_id, alcance)) ? data : null
}

export async function estadoLinkConexion(linkId: string): Promise<RespuestaEstadoLink> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(linkId)) return { ok: false, error: 'No encontramos ese link.' }
  try {
    const link = await linkEnAlcance(acc.orgId, linkId, acc.alcance)
    if (!link) return { ok: false, error: 'No encontramos ese link.' }
    let titularMp: string | null = null
    if (link.mp_cuenta_id) {
      const { data, error } = await createAdminClient()
        .from('mp_cuentas')
        .select('titular, nickname')
        .eq('id', link.mp_cuenta_id)
        .eq('organization_id', acc.orgId)
        .maybeSingle<{ titular: string | null; nickname: string | null }>()
      if (error) throw new Error(`No pudimos leer la cuenta conectada: ${error.message}`)
      titularMp = data?.titular ?? data?.nickname ?? null
    }
    return { ok: true, estado: estadoDeLink(link), cuentaMpId: link.mp_cuenta_id, titularMp }
  } catch (e) {
    console.error('[conciliacion] estadoLinkConexion:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

export async function anularLinkConexion(linkId: string): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(linkId)) return { ok: false, error: 'No encontramos ese link.' }
  try {
    const link = await linkEnAlcance(acc.orgId, linkId, acc.alcance)
    if (!link) return { ok: false, error: 'No encontramos ese link.' }
    if (link.used_at) return { ok: false, error: 'Ese link ya se usó: la cuenta quedó conectada.' }
    if (link.revoked_at) return { ok: true }
    const { error } = await createAdminClient()
      .from('mp_conexion_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('organization_id', acc.orgId)
      .is('used_at', null)
      .is('revoked_at', null)
    if (error) throw new Error(`No pudimos anular el link: ${error.message}`)
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] anularLinkConexion:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

/** El dueño autoriza desde el dashboard una cuenta que es suya (OAuth directo, sin link). */
export async function iniciarConexionPropia(
  paymentAccountId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(paymentAccountId)) return { ok: false, error: NO_ENCONTRADA }
  try {
    const pa = await cuentaCobroEnAlcance(acc.orgId, paymentAccountId, acc.alcance)
    if (!pa) return { ok: false, error: NO_ENCONTRADA }
    if (pa.banco) return { ok: false, error: 'Esta cuenta está marcada como de banco: no se conecta a Mercado Pago.' }
    return await prepararAutorizacion({ orgId: acc.orgId, paymentAccountId: pa.id, linkId: null, creadoPor: acc.userId })
  } catch (e) {
    console.error('[conciliacion] iniciarConexionPropia:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

export async function confirmarCuentaMP(cuentaMpId: string): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(cuentaMpId)) return { ok: false, error: NO_ENCONTRADA }
  try {
    if (!(await cuentaMpEnAlcance(acc.orgId, cuentaMpId, acc.alcance))) return { ok: false, error: NO_ENCONTRADA }
    const { error } = await createAdminClient()
      .from('mp_cuentas')
      .update({ confirmada_at: new Date().toISOString(), confirmada_por: acc.userId })
      .eq('id', cuentaMpId)
      .eq('organization_id', acc.orgId)
    if (error) throw new Error(`No pudimos confirmar la cuenta: ${error.message}`)
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] confirmarCuentaMP:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

/**
 * Borra los tokens y deja la cuenta 'desconectada'; los movimientos ya traídos
 * quedan y siguen verificando lo que se leyó.
 *
 * Si la cuenta NUNCA se confirmó, desconectar es decir "esa no es la cuenta":
 * además se la desvincula de las cuentas de cobro, para que sus cobros vuelvan
 * a "sin conectar" en vez de compararse contra la cuenta de otra persona.
 */
export async function desconectarCuentaMP(cuentaMpId: string): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(cuentaMpId)) return { ok: false, error: NO_ENCONTRADA }
  try {
    const v = await cuentaMpEnAlcance(acc.orgId, cuentaMpId, acc.alcance)
    if (!v) return { ok: false, error: NO_ENCONTRADA }
    await borrarTokens(acc.orgId, cuentaMpId)
    if (!v.cuenta.confirmadaAt) {
      const { error } = await createAdminClient().from('payment_accounts').update({ mp_cuenta_id: null }).eq('mp_cuenta_id', cuentaMpId)
      if (error) throw new Error(`Desconectamos la cuenta, pero no pudimos desvincularla: ${error.message}`)
    }
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] desconectarCuentaMP:', mensaje(e))
    return { ok: false, error: paraMostrar(e, 'No pudimos desconectar la cuenta. Probá de nuevo.') }
  }
}

/**
 * "No es de Mercado Pago (banco)" / "Es de Mercado Pago". Se aplica a TODAS
 * las cuentas de cobro de la tarjeta, no sólo a la que llega: la tarjeta
 * agrupa por cuenta de MP o, sin conectar, por alias (la misma cuenta cargada
 * en Caseros y en Paraná). Marcar sólo una dejaba la tarjeta en "Sin conectar"
 * y los cobros de la otra sucursal pidiendo que se conecte.
 *
 * Marcar banco además la DESVINCULA de Mercado Pago en el mismo UPDATE: una
 * cuenta de banco no se lee, y vinculada sus créditos ya traídos aparecían
 * como "sobran" en todos los períodos. Desmarcar no la vuelve a vincular: hay
 * que conectarla.
 *
 * Salvo que la cuenta de MP la siga usando una cuenta de cobro (de Mercado
 * Pago) que quedó FUERA del grupo, p. ej. un encargado de Caseros marcando
 * barberia.monaco, que también cobra Paraná: ahí la cuenta de MP se sigue
 * leyendo por Paraná, y desvincular la de Caseros dejaría sus créditos sin
 * dueño ("sobran" en Paraná y para el dueño). Vinculada y de banco, el motor
 * sabe que esos créditos son de cobros que no se pueden verificar.
 */
export async function marcarCuentaBanco(paymentAccountId: string, esBanco: boolean): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!isValidUUID(paymentAccountId)) return { ok: false, error: NO_ENCONTRADA }
  try {
    const cuentas = await leerCuentasDeCobro(acc.orgId)
    const pa = cuentas.find((p) => p.id === paymentAccountId)
    if (!pa || !acc.alcance.includes(pa.sucursalId)) return { ok: false, error: NO_ENCONTRADA }
    const alias = normalizarAlias(pa.alias)
    const grupo = cuentas.filter(
      (p) =>
        acc.alcance.includes(p.sucursalId) &&
        (p.id === pa.id || (!!pa.cuentaMpId && p.cuentaMpId === pa.cuentaMpId) || (!!alias && normalizarAlias(p.alias) === alias)),
    )
    const ids = grupo.map((p) => p.id)
    const mpDelGrupo = new Set(grupo.map((p) => p.cuentaMpId).filter((x): x is string => !!x))
    const sigueEnUso = cuentas.some((p) => !ids.includes(p.id) && !p.banco && !!p.cuentaMpId && mpDelGrupo.has(p.cuentaMpId))
    const cambios =
      esBanco !== true
        ? { fuente_conciliacion: 'mercadopago' }
        : sigueEnUso
          ? { fuente_conciliacion: 'banco' }
          : { fuente_conciliacion: 'banco', mp_cuenta_id: null }
    const { data, error } = await createAdminClient()
      .from('payment_accounts')
      .update(cambios)
      .in('id', ids)
      .select('id')
    if (error) throw new Error(`No pudimos guardar el cambio: ${error.message}`)
    if (!data?.length) return { ok: false, error: NO_ENCONTRADA }
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] marcarCuentaBanco:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver un caso
// ─────────────────────────────────────────────────────────────────────────────

const RE_CLAVE = /^(sc|pr|tl):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

interface Objetivos {
  transferLogIds: string[]
  movimientoId: string | null
  /** Sólo 'sc:'/'pr:' (las 'tl:' se pasan a transferLogIds). */
  claves: string[]
}

/**
 * Verifica que cada cobro y clave sea de la org y del alcance, y el movimiento
 * de la org. Devuelve el error a mostrar o null.
 *
 * El movimiento tiene que ser además de una cuenta del alcance sólo cuando la
 * decisión es SOBRE el movimiento (revisar un crédito sin cobro). Para vincular,
 * lo que se resuelve es el cobro propio: los candidatos de "podría ser" salen de
 * cualquier cuenta de la org (la plata pudo entrar en la cuenta de otra sucursal).
 */
async function verificarObjetivos(
  orgId: string,
  alcance: string[],
  o: Objetivos,
  opts: { movimientoAprobado?: boolean; movimientoEnAlcance?: boolean } = {},
): Promise<string | null> {
  const supabase = createAdminClient()
  if (o.transferLogIds.length) {
    for (const lote of enLotes(o.transferLogIds, 100)) {
      const { data, error } = await supabase.from('transfer_logs').select('id, branch_id').in('id', lote).limit(lote.length)
      if (error) throw new Error(`No pudimos verificar los cobros: ${error.message}`)
      const filas = (data ?? []) as { id: string; branch_id: string }[]
      if (filas.length !== lote.length || filas.some((f) => !alcance.includes(f.branch_id))) return 'Alguno de esos cobros no es de tus sucursales.'
    }
  }
  if (o.claves.length) {
    const visitas = o.claves.map((c) => c.slice(3))
    for (const lote of enLotes(visitas, 100)) {
      const { data, error } = await supabase.from('visits').select('id, branch_id').in('id', lote).limit(lote.length)
      if (error) throw new Error(`No pudimos verificar los cobros: ${error.message}`)
      const filas = (data ?? []) as { id: string; branch_id: string }[]
      if (filas.length !== new Set(lote).size || filas.some((f) => !alcance.includes(f.branch_id))) return 'Alguno de esos cobros no es de tus sucursales.'
    }
  }
  if (o.movimientoId) {
    const { data, error } = await supabase
      .from('mp_movimientos')
      .select('id, mp_cuenta_id, status')
      .eq('id', o.movimientoId)
      .eq('organization_id', orgId)
      .maybeSingle<{ id: string; mp_cuenta_id: string; status: string }>()
    if (error) throw new Error(`No pudimos verificar el movimiento: ${error.message}`)
    if (!data) return 'No encontramos ese movimiento de Mercado Pago.'
    if (opts.movimientoAprobado && data.status !== 'approved') return 'Ese movimiento se devolvió en Mercado Pago: no se puede vincular.'
    if (opts.movimientoEnAlcance && !(await cuentaMpEnAlcance(orgId, data.mp_cuenta_id, alcance))) {
      return 'Ese movimiento es de una cuenta que no está en tus sucursales.'
    }
  }
  return null
}

export async function resolverCaso(
  input:
    | { tipo: 'vinculo'; transferLogIds: string[]; movimientoId: string; nota?: string }
    | {
        tipo: 'revisado'
        transferLogIds?: string[]
        movimientoId?: string | null
        clavesEsperado?: string[]
        motivo: MotivoRevision
        nota?: string
      },
): Promise<{ ok: true; resolucionIds: string[] } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  if (!input || (input.tipo !== 'vinculo' && input.tipo !== 'revisado')) return { ok: false, error: 'Pedido inválido.' }

  const nota = typeof input.nota === 'string' && input.nota.trim() ? input.nota.trim().slice(0, MAX_NOTA) : null
  const tls = [...new Set((input.transferLogIds ?? []).filter((x) => typeof x === 'string'))]
  if (tls.some((x) => !isValidUUID(x)) || tls.length > 20) return { ok: false, error: 'Pedido inválido.' }

  try {
    const supabase = createAdminClient()
    const por = await nombreDeUsuario(acc.orgId, acc.userId)

    if (input.tipo === 'vinculo') {
      if (!tls.length || !isValidUUID(input.movimientoId)) return { ok: false, error: 'Elegí el cobro y el movimiento a vincular.' }
      const problema = await verificarObjetivos(
        acc.orgId,
        acc.alcance,
        { transferLogIds: tls, movimientoId: input.movimientoId, claves: [] },
        { movimientoAprobado: true },
      )
      if (problema) return { ok: false, error: problema }
      // Un cobro queda vinculado a lo sumo a UN movimiento (índice único parcial, mig 228).
      const { data: previos, error: errPrevios } = await supabase
        .from('mp_conciliacion_resoluciones')
        .select('id')
        .eq('organization_id', acc.orgId)
        .eq('tipo', 'vinculo')
        .is('deshecho_at', null)
        .in('transfer_log_id', tls)
        .limit(1)
      if (errPrevios) throw new Error(`No pudimos verificar los vínculos: ${errPrevios.message}`)
      if (previos?.length) return { ok: false, error: 'Ese cobro ya está vinculado a otro movimiento. Deshacé ese vínculo primero.' }

      const { data, error } = await supabase
        .from('mp_conciliacion_resoluciones')
        .insert(
          tls.map((tl) => ({
            organization_id: acc.orgId,
            tipo: 'vinculo',
            movimiento_id: input.movimientoId,
            transfer_log_id: tl,
            nota,
            created_by: acc.userId,
            created_by_nombre: por,
          })),
        )
        .select('id')
      if (error) {
        if (error.code === '23505') return { ok: false, error: 'Ese cobro ya está vinculado a otro movimiento. Deshacé ese vínculo primero.' }
        throw new Error(`No pudimos guardar el vínculo: ${error.message}`)
      }
      return { ok: true, resolucionIds: (data ?? []).map((r) => r.id as string) }
    }

    // Revisado
    if (!MOTIVOS_REVISION.some((m) => m.id === input.motivo)) return { ok: false, error: 'Elegí el motivo.' }
    const movimientoId = input.movimientoId ?? null
    if (movimientoId !== null && !isValidUUID(movimientoId)) return { ok: false, error: 'Pedido inválido.' }
    const claves: string[] = []
    for (const c of input.clavesEsperado ?? []) {
      const m = typeof c === 'string' ? c.match(RE_CLAVE) : null
      if (!m) return { ok: false, error: 'Pedido inválido.' }
      if (m[1].toLowerCase() === 'tl') {
        if (!tls.includes(m[2])) tls.push(m[2])
      } else if (!claves.includes(c)) claves.push(c)
    }
    if (!tls.length && !movimientoId && !claves.length) return { ok: false, error: 'No hay nada para marcar como revisado.' }
    if (tls.length > 20 || claves.length > 20) return { ok: false, error: 'Pedido inválido.' }
    const problema = await verificarObjetivos(
      acc.orgId,
      acc.alcance,
      { transferLogIds: tls, movimientoId, claves },
      // Un crédito sin cobro se revisa sólo desde una sucursal de su cuenta.
      { movimientoEnAlcance: !tls.length && !claves.length },
    )
    if (problema) return { ok: false, error: problema }

    const comun = {
      organization_id: acc.orgId,
      tipo: 'revisado',
      motivo: input.motivo,
      nota,
      created_by: acc.userId,
      created_by_nombre: por,
    }
    const filas = [
      ...tls.map((tl) => ({ ...comun, transfer_log_id: tl, movimiento_id: null, clave_esperado: null })),
      ...(movimientoId ? [{ ...comun, transfer_log_id: null, movimiento_id: movimientoId, clave_esperado: null }] : []),
      ...claves.map((c) => ({ ...comun, transfer_log_id: null, movimiento_id: null, clave_esperado: c })),
    ]
    const { data, error } = await supabase.from('mp_conciliacion_resoluciones').insert(filas).select('id')
    if (error) throw new Error(`No pudimos guardar la revisión: ${error.message}`)
    return { ok: true, resolucionIds: (data ?? []).map((r) => r.id as string) }
  } catch (e) {
    console.error('[conciliacion] resolverCaso:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

export async function deshacerResolucion(resolucionIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  const ids = [...new Set(Array.isArray(resolucionIds) ? resolucionIds : [])]
  if (!ids.length || ids.length > 60 || ids.some((x) => !isValidUUID(x))) return { ok: false, error: 'Pedido inválido.' }
  try {
    const supabase = createAdminClient()
    const { data: filas, error: errLeer } = await supabase
      .from('mp_conciliacion_resoluciones')
      .select('id, transfer_log_id, movimiento_id, clave_esperado, deshecho_at')
      .eq('organization_id', acc.orgId)
      .in('id', ids)
      .limit(ids.length)
    if (errLeer) throw new Error(`No pudimos leer la resolución: ${errLeer.message}`)
    const leidas = (filas ?? []) as { id: string; transfer_log_id: string | null; movimiento_id: string | null; clave_esperado: string | null; deshecho_at: string | null }[]
    if (leidas.length !== ids.length) return { ok: false, error: 'No encontramos esa resolución.' }

    // Sólo se deshace lo que la persona puede ver.
    const problema = await verificarObjetivos(acc.orgId, acc.alcance, {
      transferLogIds: [...new Set(leidas.map((r) => r.transfer_log_id).filter((x): x is string => !!x))],
      movimientoId: null,
      claves: [...new Set(leidas.map((r) => r.clave_esperado).filter((x): x is string => !!x && /^(sc|pr):/.test(x)))],
    })
    if (problema) return { ok: false, error: problema }
    for (const movId of new Set(leidas.filter((r) => !r.transfer_log_id && r.movimiento_id).map((r) => r.movimiento_id!))) {
      const p = await verificarObjetivos(
        acc.orgId,
        acc.alcance,
        { transferLogIds: [], movimientoId: movId, claves: [] },
        { movimientoEnAlcance: true },
      )
      if (p) return { ok: false, error: p }
    }

    const pendientes = leidas.filter((r) => !r.deshecho_at).map((r) => r.id)
    if (!pendientes.length) return { ok: true }
    const { error } = await supabase
      .from('mp_conciliacion_resoluciones')
      .update({ deshecho_at: new Date().toISOString(), deshecho_por: acc.userId })
      .eq('organization_id', acc.orgId)
      .in('id', pendientes)
      .is('deshecho_at', null)
    if (error) throw new Error(`No pudimos deshacer: ${error.message}`)
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] deshacerResolucion:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// "No es este": descartar un emparejamiento (mig 230)
// ─────────────────────────────────────────────────────────────────────────────

/** Un crédito suma a lo sumo 4 cobros sin marcar; 20 deja aire, como en resolverCaso. */
const MAX_COBROS_POR_DESCARTE = 20

/** Los descartes ACTIVOS de esos cobros con ese crédito: transfer_log_id → id del descarte. */
async function descartesActivos(orgId: string, movimientoId: string, tls: string[]): Promise<Map<string, string>> {
  const { data, error } = await createAdminClient()
    .from('mp_conciliacion_rechazos')
    .select('id, transfer_log_id')
    .eq('organization_id', orgId)
    .eq('movimiento_id', movimientoId)
    .is('deshecho_at', null)
    .in('transfer_log_id', tls)
    .limit(tls.length)
  if (error) throw new Error(`No pudimos leer los descartes: ${error.message}`)
  return new Map(((data ?? []) as { id: string; transfer_log_id: string }[]).map((r) => [r.transfer_log_id, r.id]))
}

/**
 * "No es este": quien administra la conciliación mira un emparejamiento para
 * confirmar y dice que ese crédito NO es de ese cobro (o de esos cobros, si el
 * motor los juntó como un cobro conjunto sin marcar). Se guarda un rechazo por
 * cobro, en un solo INSERT, y el motor no vuelve a juntar ese par en ninguna
 * pasada automática: cada lado sigue su camino (otro emparejamiento, o
 * "falta"/"sobra" a la vista). Marcarlo "revisado" no servía: sacaba el
 * crédito de "sobran" para siempre, aunque fuera de OTRO cobro.
 *
 * Los cobros tienen que ser de la org y del alcance; el crédito, de la org
 * (como al vincular: la plata pudo entrar en la cuenta de otra sucursal).
 * Idempotente: un par que ya está descartado devuelve el id que tiene. Un par
 * vinculado a mano no se descarta: el vínculo manda, hay que deshacerlo.
 */
export async function rechazarEmparejamiento(input: {
  movimientoId: string
  transferLogIds: string[]
}): Promise<{ ok: true; rechazoIds: string[] } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  const movimientoId = input?.movimientoId
  const tls = [...new Set(Array.isArray(input?.transferLogIds) ? input.transferLogIds.filter((x) => typeof x === 'string') : [])]
  if (!isValidUUID(movimientoId) || !tls.length || tls.length > MAX_COBROS_POR_DESCARTE || tls.some((x) => !isValidUUID(x))) {
    return { ok: false, error: 'Pedido inválido.' }
  }
  try {
    const gate = await rateLimit('mp_rechazo', acc.userId ?? acc.orgId, { limit: 60, window: 60 })
    if (!gate.allowed) return { ok: false, error: 'Hubo muchos cambios seguidos. Esperá un minuto.' }
    const problema = await verificarObjetivos(acc.orgId, acc.alcance, { transferLogIds: tls, movimientoId, claves: [] })
    if (problema) return { ok: false, error: problema }

    const supabase = createAdminClient()
    const { data: vinculos, error: errVinculos } = await supabase
      .from('mp_conciliacion_resoluciones')
      .select('id')
      .eq('organization_id', acc.orgId)
      .eq('tipo', 'vinculo')
      .eq('movimiento_id', movimientoId)
      .is('deshecho_at', null)
      .in('transfer_log_id', tls)
      .limit(1)
    if (errVinculos) throw new Error(`No pudimos verificar los vínculos: ${errVinculos.message}`)
    if (vinculos?.length) return { ok: false, error: 'Ese cobro está vinculado a mano con este crédito. Si no es, deshacé el vínculo.' }

    const por = await nombreDeUsuario(acc.orgId, acc.userId)
    // Dos vueltas como máximo: si otra pestaña descarta el mismo par a la vez, el
    // índice único (uno activo por par) rechaza el INSERT entero y la segunda
    // vuelta toma lo que quedó guardado.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const activos = await descartesActivos(acc.orgId, movimientoId, tls)
      const faltan = tls.filter((tl) => !activos.has(tl))
      if (faltan.length) {
        const { data, error } = await supabase
          .from('mp_conciliacion_rechazos')
          .insert(
            faltan.map((tl) => ({
              organization_id: acc.orgId,
              transfer_log_id: tl,
              movimiento_id: movimientoId,
              created_by: acc.userId,
              created_by_nombre: por,
            })),
          )
          .select('id, transfer_log_id')
        if (error) {
          if (error.code === '23505') continue
          throw new Error(`No pudimos guardar el descarte: ${error.message}`)
        }
        const nuevos = (data ?? []) as { id: string; transfer_log_id: string }[]
        // Known Risk #13: sin todas las filas confirmadas, no se dice que quedó guardado.
        if (nuevos.length !== faltan.length) throw new Error('No pudimos guardar el descarte: la base no confirmó todas las filas.')
        for (const f of nuevos) activos.set(f.transfer_log_id, f.id)
      }
      return { ok: true, rechazoIds: tls.map((tl) => activos.get(tl) as string) }
    }
    throw new Error('No pudimos guardar el descarte: alguien lo estaba cambiando al mismo tiempo. Probá de nuevo.')
  } catch (e) {
    console.error('[conciliacion] rechazarEmparejamiento:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

/** Deshace un "No es este" (todas sus filas): el motor vuelve a poder juntar ese par. */
export async function deshacerRechazo(rechazoIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const acc = await verificarAcceso('conciliacion.manage')
  if (!acc.ok) return acc
  const ids = [...new Set(Array.isArray(rechazoIds) ? rechazoIds : [])]
  if (!ids.length || ids.length > 60 || ids.some((x) => !isValidUUID(x))) return { ok: false, error: 'Pedido inválido.' }
  try {
    const supabase = createAdminClient()
    const { data: filas, error: errLeer } = await supabase
      .from('mp_conciliacion_rechazos')
      .select('id, transfer_log_id, deshecho_at')
      .eq('organization_id', acc.orgId)
      .in('id', ids)
      .limit(ids.length)
    if (errLeer) throw new Error(`No pudimos leer el descarte: ${errLeer.message}`)
    const leidas = (filas ?? []) as { id: string; transfer_log_id: string; deshecho_at: string | null }[]
    if (leidas.length !== ids.length) return { ok: false, error: 'No encontramos ese descarte.' }

    // Sólo se deshace lo que la persona puede ver: los cobros, de su alcance.
    const problema = await verificarObjetivos(acc.orgId, acc.alcance, {
      transferLogIds: [...new Set(leidas.map((r) => r.transfer_log_id))],
      movimientoId: null,
      claves: [],
    })
    if (problema) return { ok: false, error: problema }

    const pendientes = leidas.filter((r) => !r.deshecho_at).map((r) => r.id)
    if (!pendientes.length) return { ok: true }
    const { error } = await supabase
      .from('mp_conciliacion_rechazos')
      .update({ deshecho_at: new Date().toISOString(), deshecho_por: acc.userId })
      .eq('organization_id', acc.orgId)
      .in('id', pendientes)
      .is('deshecho_at', null)
    if (error) throw new Error(`No pudimos deshacer el descarte: ${error.message}`)
    return { ok: true }
  } catch (e) {
    console.error('[conciliacion] deshacerRechazo:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprobante
// ─────────────────────────────────────────────────────────────────────────────

export async function urlComprobanteConciliacion(
  receiptId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const acc = await verificarAcceso('conciliacion.view')
  if (!acc.ok) return acc
  if (!isValidUUID(receiptId)) return { ok: false, error: 'No encontramos ese comprobante.' }
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('payment_receipts')
      .select('image_path, branch_id')
      .eq('id', receiptId)
      .eq('organization_id', acc.orgId)
      .maybeSingle<{ image_path: string | null; branch_id: string | null }>()
    if (error) throw new Error(`No pudimos leer el comprobante: ${error.message}`)
    if (!data || (data.branch_id && !acc.alcance.includes(data.branch_id))) return { ok: false, error: 'No encontramos ese comprobante.' }
    // Bucket privado: la ruta tiene que ser de la org (mismo criterio que getReceiptSignedUrl).
    if (!data.image_path || !data.image_path.startsWith(`${acc.orgId}/`)) return { ok: false, error: 'Ese comprobante no tiene imagen.' }
    const { data: firmada, error: errFirma } = await supabase.storage.from('transfer-receipts').createSignedUrl(data.image_path, 3600)
    if (errFirma || !firmada?.signedUrl) throw new Error(`No pudimos abrir la imagen del comprobante: ${errFirma?.message ?? 'sin url'}`)
    return { ok: true, url: firmada.signedUrl }
  } catch (e) {
    console.error('[conciliacion] urlComprobanteConciliacion:', mensaje(e))
    return { ok: false, error: paraMostrar(e) }
  }
}
