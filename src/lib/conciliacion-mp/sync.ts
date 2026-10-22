import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/sync.ts
// Trae los créditos de una cuenta de Mercado Pago a `mp_movimientos`. Sólo LEE
// Mercado Pago y sólo escribe nuestras tablas.
//
// QUÉ SIGNIFICA "LEÍDA HASTA"
// ---------------------------
// Se pide `/v1/payments/search` ordenado por `date_last_updated`. Todo pago
// aprobado a la hora T tiene date_last_updated ≥ T, así que haber leído todo lo
// actualizado en [desde, hasta] garantiza haber visto todo lo aprobado en ese
// tramo (o verlo en la próxima lectura, si se actualizó después). Eso es lo que
// guardan `sincronizada_desde` / `sincronizada_hasta`, y el motor los usa para
// NO dar por faltante lo que todavía no se leyó (Known Risk #15).
//
// DOS FASES
// ---------
//  A. Hacia adelante desde el cursor (−10 min de solape). La primera vez, sólo
//     los últimos 8 días: así la verificación de la conexión ("encontramos 41
//     de los 43 cobros de la semana") sale en la primera lectura en vez de
//     esperar a que se traigan 60 días en orden. Lo leído en A se GUARDA antes
//     de empezar B: un problema en B (opcional) no tira lo que ya se leyó.
//  B. Hacia atrás hasta los 60 días, con lo que sobre de presupuesto, en orden
//     DESCENDENTE: así cada página extiende `sincronizada_desde` sin dejar
//     huecos, y si el presupuesto corta (o una página falla), lo leído igual
//     vale.
//
// Si una página falla a mitad de camino, lo leído hasta ahí también vale: se
// guarda la lectura parcial coherente (igual que cuando se acaba el tiempo) y
// el fallo.
//
// PAGINAR POR CURSOR, NO POR OFFSET
// ---------------------------------
// Un pago que se actualiza mientras paginamos salta al final del orden y, con
// offsets, corre a todos los demás un lugar: uno se saltea sin aviso. Por eso
// cada página arranca en la fecha de la última leída (−1 s; el upsert
// deduplica). Eso además esquiva el tope de offset 10.000 de la API.
//
// "REVOCADA" SÓLO CON PRUEBA
// --------------------------
// Una cuenta 'revocada' no se vuelve a leer sola (hay que pedirle al titular un
// link nuevo), así que sólo se marca ante un 401 que confirma `GET /users/me`
// con el mismo token. Un 403 (por ejemplo, la capa de políticas de MP) es
// 'error': se reintenta en la próxima lectura. El cron vuelve a probar una vez
// por día las OAuth revocadas.
//
// Una cuenta a la vez (candado en la base; la fila se vuelve a leer CON el
// candado tomado, para no renovar con un refresh que otra lectura ya usó), con
// presupuesto de tiempo, y cada corrida queda registrada en `mp_sync_corridas`
// con su error. Toda escritura a `mp_cuentas` es condicional: si alguien
// desconectó la cuenta mientras se leía, la lectura no la "revive".
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import { esErrorMercadoPago, pedirAMercadoPago } from '@/lib/mercadopago/http'
import type { ResultadoSync } from './contrato'
import { CONCILIACION } from './contrato'
import { esCreditoDe, filaDeMovimiento, type FilaMovimiento, type PagoCrudoMp } from './clasificar'
import { ErrorToken, leerCuentaMpConToken, tokenParaLeer, type FilaCuentaMpConToken } from './credenciales'
import { fechaParaMp } from './fechas'

export type OrigenSync = 'manual' | 'auto' | 'cron' | 'tex' | 'conexion'

export interface OpcionesSync {
  origen: OrigenSync
  presupuestoMs?: number
  signal?: AbortSignal
  /**
   * Sólo el cron: volver a probar una cuenta 'revocada' (una vez por día).
   * Si el permiso sigue vivo, la cuenta vuelve a 'conectada' sola.
   */
  reintentarRevocada?: boolean
}

const MIN = 60_000
const DIA = 24 * 60 * MIN
const LIMITE_PAGINA = 50
const MAX_OFFSET = 10_000
/** Se vuelve a pedir 10 min antes del cursor: MP indexa con demora y el upsert deduplica. */
const SOLAPE_MS = 10 * MIN
/** Al terminar, la lectura se da por completa hasta 2 min antes de "ahora" (margen de indexación). */
const MARGEN_INDEXADO_MS = 2 * MIN
const VENTANA_INICIAL_MS = 8 * DIA
const BACKFILL_MS = CONCILIACION.backfillDias * DIA
const CANDADO_SEG = 300
/** Si queda menos que esto, no se pide otra página (cada una puede tardar varios segundos). */
const MIN_PARA_PAGINA_MS = 6_000
const RECIENTE_MS = CONCILIACION.autoSyncMin * MIN
/** Tras un fallo, las lecturas automáticas esperan esto antes de volver a golpear a MP. */
const ESPERA_TRAS_ERROR_MS = 2 * MIN

interface PaginaMp {
  results?: PagoCrudoMp[]
}

interface Contadores {
  paginas: number
  leidos: number
  nuevos: number
  actualizados: number
  descartados: number
}

interface Tramo {
  /** Llegó al final del tramo. */
  completo: boolean
  /** El date_last_updated más extremo PROCESADO (el más nuevo en 'asc', el más viejo en 'desc'). */
  extremo: number | null
  /** Por qué se cortó, si fue por un fallo (lo leído hasta `extremo` igual vale). */
  error?: unknown
}

interface Fallo {
  /** Frase corta para `last_error` (sin nada del token). */
  mensaje: string
  nuevoEstado: 'revocada' | 'error' | null
  /** ¿Es un problema de la cuenta (o de MP), o nuestro (la base)? */
  deLaCuenta: boolean
  /** Antes de marcar 'revocada' hay que confirmarlo con `GET /users/me`. */
  confirmar: boolean
}

const iso = (ms: number) => new Date(ms).toISOString()

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** El alias con el que se nombra la cuenta en los resultados. */
async function aliasDeCuenta(cuentaMpId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('payment_accounts')
    .select('alias_or_cbu, is_active, sort_order')
    .eq('mp_cuenta_id', cuentaMpId)
    .order('is_active', { ascending: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .limit(5)
  if (error) return null
  return (data ?? []).find((p) => p.alias_or_cbu)?.alias_or_cbu ?? null
}

/**
 * El fallo traducido a una frase corta para `last_error` (sin nada del token) y
 * qué hacer con el estado de la cuenta:
 *   - 401, o refresh inválido → 'revocada', PERO sólo si `GET /users/me` con
 *     el mismo token también da 401 (`confirmar`).
 *   - 403 y los demás 4xx, token ilegible, falta la app → 'error' (se
 *     reintenta en la próxima lectura; no es "el titular quitó el permiso").
 *   - 429, 5xx, red, timeout → NO se cambia (es Mercado Pago, no la cuenta).
 */
function describirFallo(e: unknown, modo: string): Fallo {
  if (e instanceof ErrorToken) {
    if (e.motivo === 'revocado') return { mensaje: e.message, nuevoEstado: 'revocada', deLaCuenta: true, confirmar: true }
    // 'desconectada': el dueño la desconectó mientras se renovaba el permiso. No
    // hay estado que cambiar (y la escritura condicional no la toca).
    if (e.motivo === 'renovacion' || e.motivo === 'desconectada') return { mensaje: e.message, nuevoEstado: null, deLaCuenta: true, confirmar: false }
    return { mensaje: e.message, nuevoEstado: 'error', deLaCuenta: true, confirmar: false }
  }
  if (esErrorMercadoPago(e)) {
    if (e.status === 401) {
      return {
        mensaje: modo === 'oauth' ? 'El titular quitó el permiso' : 'El token dejó de servir',
        nuevoEstado: 'revocada',
        deLaCuenta: true,
        confirmar: true,
      }
    }
    if (e.status === 429) return { mensaje: 'Mercado Pago limitó las consultas', nuevoEstado: null, deLaCuenta: true, confirmar: false }
    if (e.status === 0 || e.status >= 500) return { mensaje: 'Mercado Pago no responde', nuevoEstado: null, deLaCuenta: true, confirmar: false }
    const codigo = e.detalles.mpError ? ` ${e.detalles.mpError.slice(0, 60)}` : ''
    return { mensaje: `Mercado Pago rechazó la consulta (${e.status}${codigo})`, nuevoEstado: 'error', deLaCuenta: true, confirmar: false }
  }
  // Un error nuestro (la base): no es un problema de la cuenta.
  return { mensaje: mensajeDe(e).slice(0, 200) || 'Error inesperado', nuevoEstado: null, deLaCuenta: false, confirmar: false }
}

/**
 * ¿El permiso está muerto de verdad? `GET /users/me` con el MISMO token: si
 * responde, el 401 fue de la consulta de pagos (o un hipo) y la cuenta sigue
 * siendo leíble — se marca 'error' y se reintenta. Sin un token en la mano (el
 * access venció y el refresh no sirvió) no hay nada que probar.
 */
async function confirmarRevocacion(f: Fallo, token: string | null): Promise<Fallo> {
  if (!f.confirmar || !token) return f
  try {
    await pedirAMercadoPago<unknown>({ metodo: 'GET', ruta: '/users/me', token, reintentos: 1, timeoutMs: 8_000 })
    return { ...f, nuevoEstado: 'error', mensaje: 'Mercado Pago rechazó la lectura de los pagos (401)', confirmar: false }
  } catch (e) {
    if (esErrorMercadoPago(e) && e.status === 401) return { ...f, confirmar: false }
    // No se pudo confirmar: nunca se revoca por las dudas.
    if (esErrorMercadoPago(e) && e.status !== 0 && e.status !== 429 && e.status < 500) {
      return { ...f, nuevoEstado: 'error', mensaje: `Mercado Pago rechazó la consulta (${e.status})`, confirmar: false }
    }
    return { ...f, nuevoEstado: null, mensaje: 'Mercado Pago no responde', confirmar: false }
  }
}

/** Por qué esta lectura no tiene que empezar (o null si puede). */
function noSeLee(fila: FilaCuentaMpConToken, opts: OpcionesSync): Pick<ResultadoSync, 'ok' | 'omitida' | 'error'> | null {
  if (fila.status === 'desconectada' || !fila.access_token_cifrado) return { ok: false, error: 'La cuenta no está conectada.' }
  if (fila.status === 'revocada' && !opts.reintentarRevocada) {
    return { ok: false, error: `${fila.last_error ?? 'El titular quitó el permiso'}: hay que volver a autorizarla.` }
  }
  const automatica = opts.origen !== 'manual' && opts.origen !== 'conexion'
  if (automatica) {
    if (fila.last_sync_at && Date.now() - new Date(fila.last_sync_at).getTime() < RECIENTE_MS) {
      return { ok: true, omitida: 'reciente' }
    }
    // Una lectura automática no insiste contra un MP que acaba de fallar.
    if (fila.last_error && fila.last_check_at && Date.now() - new Date(fila.last_check_at).getTime() < ESPERA_TRAS_ERROR_MS) {
      return { ok: false, error: fila.last_error }
    }
  }
  return null
}

/**
 * Lee y guarda los créditos de una cuenta. Nunca tira: el resultado dice si
 * salió bien y, si no, por qué (en castellano, sin datos del token).
 */
export async function sincronizarCuenta(cuentaMpId: string, opts: OpcionesSync): Promise<ResultadoSync> {
  const limite = Date.now() + (opts.presupuestoMs ?? 45_000)
  const base: ResultadoSync = {
    ok: false,
    cuentaMpId,
    alias: null,
    leidos: 0,
    nuevos: 0,
    actualizados: 0,
    sincronizadaHasta: null,
  }

  let fila: FilaCuentaMpConToken | null
  try {
    fila = await leerCuentaMpConToken(cuentaMpId)
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : 'No pudimos leer la cuenta.' }
  }
  if (!fila) return { ...base, error: 'La cuenta de Mercado Pago no existe.' }
  base.alias = await aliasDeCuenta(cuentaMpId)
  base.sincronizadaHasta = fila.sincronizada_hasta
  const antes = noSeLee(fila, opts)
  if (antes) return { ...base, ...antes }

  const supabase = createAdminClient()
  const { data: tomado, error: errCandado } = await supabase.rpc('mp_tomar_candado', {
    p_cuenta: cuentaMpId,
    p_segundos: CANDADO_SEG,
  })
  if (errCandado) {
    console.error('[conciliacion-sync] candado:', errCandado.message)
    return { ...base, error: 'No pudimos empezar la lectura. Probá de nuevo.' }
  }
  if (tomado !== true) return { ...base, ok: true, omitida: 'candado' }

  try {
    // Con el candado tomado, la fila se vuelve a leer: otra lectura pudo haber
    // terminado (y renovado el permiso, quemando el refresh viejo) entre la
    // primera lectura y el candado.
    let fresca: FilaCuentaMpConToken | null
    try {
      fresca = await leerCuentaMpConToken(cuentaMpId)
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : 'No pudimos leer la cuenta.' }
    }
    if (!fresca) return { ...base, error: 'La cuenta de Mercado Pago no existe.' }
    base.sincronizadaHasta = fresca.sincronizada_hasta
    const ahoraNo = noSeLee(fresca, opts)
    if (ahoraNo) return { ...base, ...ahoraNo }
    return await leerConCandado(fresca, opts, base, limite)
  } finally {
    const { error } = await supabase.rpc('mp_soltar_candado', { p_cuenta: cuentaMpId })
    // Si no se suelta, vence solo a los 5 minutos: se avisa en el log y se sigue.
    if (error) console.error('[conciliacion-sync] soltar candado:', error.message)
  }
}

async function leerConCandado(fila: FilaCuentaMpConToken, opts: OpcionesSync, base: ResultadoSync, limite: number): Promise<ResultadoSync> {
  const supabase = createAdminClient()
  const cuentaMpId = fila.id
  // Una lectura sólo escribe el estado de una cuenta que sigue conectada (o con
  // error; o revocada, si vino a reintentarla). Si alguien la desconectó
  // mientras se leía, no se la revive con status 'conectada' y sin tokens.
  const pisables = opts.reintentarRevocada ? ['conectada', 'error', 'revocada'] : ['conectada', 'error']
  const actualizarCuenta = async (cambios: Record<string, string | null>): Promise<boolean> => {
    const { data, error } = await supabase
      .from('mp_cuentas')
      .update(cambios)
      .eq('id', cuentaMpId)
      .not('access_token_cifrado', 'is', null)
      .in('status', pisables)
      .select('id')
    if (error) throw new Error(`No pudimos guardar hasta dónde se leyó: ${error.message}`)
    return (data ?? []).length > 0
  }

  const cont: Contadores = { paginas: 0, leidos: 0, nuevos: 0, actualizados: 0, descartados: 0 }
  const contadores = () => ({ leidos: cont.leidos, nuevos: cont.nuevos, actualizados: cont.actualizados })
  let corridaId: string | null = null
  /** El access token en la mano (para confirmar una revocación con /users/me). */
  let token: string | null = null
  /** Problemas del permiso que no cortan la lectura (van a last_error). */
  const avisos: string[] = []
  /** Lo leído coherente que todavía no se guardó: si la lectura falla, se guarda igual. */
  let avance: Record<string, string> | null = null

  try {
    const ahora = Date.now()
    const fin = ahora
    const cursorPrevio = fila.sync_cursor ? new Date(fila.sync_cursor).getTime() : null
    const inicioA = cursorPrevio !== null ? cursorPrevio - SOLAPE_MS : ahora - VENTANA_INICIAL_MS

    const { data: corrida, error: errCorrida } = await supabase
      .from('mp_sync_corridas')
      .insert({
        organization_id: fila.organization_id,
        mp_cuenta_id: cuentaMpId,
        origen: opts.origen,
        desde: iso(inicioA),
        hasta: iso(fin),
        estado: 'corriendo',
      })
      .select('id')
      .single<{ id: string }>()
    if (errCorrida || !corrida) throw new Error(`No pudimos registrar la lectura: ${errCorrida?.message ?? 'sin respuesta'}`)
    corridaId = corrida.id
    const idCorrida = corrida.id

    const primero = await tokenParaLeer(fila)
    token = primero.token
    // Después de renovar, la fila trae los tokens NUEVOS: una renovación
    // forzada más tarde tiene que usar el refresh nuevo, no el quemado.
    let cuenta = primero.fila
    if (primero.aviso) avisos.push(primero.aviso)
    let renovado = false
    const pedir = async (query: Record<string, string | number>): Promise<PaginaMp> => {
      const restante = limite - Date.now()
      const peticion = {
        metodo: 'GET' as const,
        ruta: '/v1/payments/search',
        query,
        timeoutMs: Math.max(3_000, Math.min(15_000, restante - 2_000)),
        reintentos: restante > 25_000 ? 2 : 1,
      }
      try {
        return await pedirAMercadoPago<PaginaMp>({ ...peticion, token: token! })
      } catch (e) {
        // Un 401 de un permiso OAuth puede ser un access vencido: UNA renovación y se reintenta.
        if (esErrorMercadoPago(e) && e.status === 401 && !renovado && cuenta.connection_mode === 'oauth') {
          renovado = true
          const r = await tokenParaLeer(cuenta, { forzarRenovacion: true })
          token = r.token
          cuenta = r.fila
          if (r.aviso) avisos.push(r.aviso)
          return await pedirAMercadoPago<PaginaMp>({ ...peticion, token: r.token })
        }
        throw e
      }
    }

    const guardar = async (pagos: PagoCrudoMp[]) => {
      const filas = new Map<string, FilaMovimiento>()
      for (const p of pagos) {
        if (!esCreditoDe(p, cuenta.mp_user_id)) continue // los débitos ni se guardan
        const f = filaDeMovimiento(p)
        if (!f) {
          cont.descartados++
          continue
        }
        filas.set(f.mp_id, f) // dentro de un mismo upsert no puede repetirse la clave
      }
      if (!filas.size) return
      const { data, error } = await supabase
        .from('mp_movimientos')
        .upsert(
          [...filas.values()].map((f) => ({ ...f, organization_id: cuenta.organization_id, mp_cuenta_id: cuentaMpId })),
          { onConflict: 'mp_cuenta_id,mp_id' },
        )
        .select('created_at, updated_at')
        .returns<{ created_at: string; updated_at: string }[]>()
      if (error) throw new Error(`No pudimos guardar los movimientos: ${error.message}`)
      // Insertada: created_at == updated_at (los dos defaults del mismo INSERT).
      // Actualizada: el trigger touch pisa updated_at y created_at queda el viejo.
      for (const r of data ?? []) {
        if (r.created_at === r.updated_at) cont.nuevos++
        else cont.actualizados++
      }
    }

    const leer = (desde: number, hasta: number, orden: 'asc' | 'desc') =>
      leerTramo({ mpUserId: cuenta.mp_user_id, desde, hasta, orden, pedir, guardar, limite, signal: opts.signal, cont })

    // ── Fase A: hacia adelante ───────────────────────────────────────────────
    let hasta = fila.sincronizada_hasta ? new Date(fila.sincronizada_hasta).getTime() : null
    let cursor = cursorPrevio
    let desde = fila.sincronizada_desde ? new Date(fila.sincronizada_desde).getTime() : null
    const a = await leer(inicioA, fin, 'asc')
    if (a.completo) {
      cursor = fin - MARGEN_INDEXADO_MS
      hasta = fin - MARGEN_INDEXADO_MS
    } else if (a.extremo !== null) {
      // Lectura parcial pero coherente: todo lo actualizado hasta ahí se leyó.
      const parcial = a.extremo - 1000
      cursor = Math.max(cursor ?? parcial, parcial)
      hasta = Math.max(hasta ?? parcial, parcial)
    }
    const avanzo = a.completo || a.extremo !== null
    if (desde === null && avanzo) desde = inicioA
    const lecturaA: Record<string, string> = {}
    if (cursor !== null) lecturaA.sync_cursor = iso(cursor)
    if (hasta !== null) lecturaA.sincronizada_hasta = iso(hasta)
    if (desde !== null) lecturaA.sincronizada_desde = iso(desde)

    if (a.error) {
      // Una página falló: lo leído antes del fallo vale igual (se guarda en el
      // catch junto con el error, sin tocar last_sync_at: hay que reintentar).
      if (avanzo) avance = lecturaA
      throw a.error
    }
    if (!avanzo) {
      // No alcanzó el tiempo ni para una página: no se toca la cuenta (ni su
      // "leída hace", ni un error anterior). Sigue la próxima lectura.
      await cerrarCorrida(idCorrida, 'ok', cont, 'Sin tiempo para leer')
      return { ...base, error: 'No alcanzó el tiempo para leer esta cuenta: se lee en la próxima pasada.' }
    }

    // Lo de la fase A se guarda YA: un problema en la B no lo puede tirar.
    const terminadaAt = new Date().toISOString()
    const sigueConectada = await actualizarCuenta({
      ...lecturaA,
      last_sync_at: terminadaAt,
      last_check_at: terminadaAt,
      status: 'conectada',
      last_error: avisos[0] ?? null,
    })
    if (!sigueConectada) {
      await cerrarCorrida(idCorrida, 'error', cont, 'La cuenta se desconectó mientras se leía')
      return { ...base, ...contadores(), error: 'La cuenta se desconectó mientras se leía.' }
    }

    // ── Fase B: hacia atrás hasta los 60 días (opcional) ─────────────────────
    // Sus fallos no son de la cuenta (la A acaba de leer bien): quedan en la
    // corrida y se reintenta en la próxima lectura.
    let errorB: string | null = null
    const objetivo = ahora - BACKFILL_MS
    if (a.completo && desde !== null && desde > objetivo + 60 * MIN && limite - Date.now() > MIN_PARA_PAGINA_MS) {
      const b = await leer(objetivo, desde + SOLAPE_MS, 'desc')
      let nuevoDesde = desde
      if (b.completo) nuevoDesde = objetivo
      else if (b.extremo !== null) nuevoDesde = Math.min(desde, b.extremo + 1000)
      if (b.error) errorB = `Días anteriores: ${describirFallo(b.error, cuenta.connection_mode).mensaje}`
      if (nuevoDesde !== desde) {
        try {
          await actualizarCuenta({ sincronizada_desde: iso(nuevoDesde) })
        } catch (e) {
          errorB = `Días anteriores: ${mensajeDe(e)}`
        }
      }
    }

    await cerrarCorrida(idCorrida, errorB ? 'error' : 'ok', cont, errorB)
    return { ...base, ok: true, ...contadores(), sincronizadaHasta: hasta === null ? null : iso(hasta) }
  } catch (e) {
    const f = await confirmarRevocacion(describirFallo(e, fila.connection_mode), token)
    const cambios: Record<string, string | null> = { ...(avance ?? {}) }
    if (f.deLaCuenta) {
      // Reintentando una revocada, un hipo de MP (429, 5xx, red) no cambia POR
      // QUÉ está revocada: el veredicto y Tex tienen que seguir diciendo "El
      // titular quitó el permiso", no "Mercado Pago no responde".
      const sigueRevocada = opts.reintentarRevocada && fila.status === 'revocada' && !f.nuevoEstado
      if (!sigueRevocada) cambios.last_error = f.mensaje
      cambios.last_check_at = new Date().toISOString()
      if (f.nuevoEstado) cambios.status = f.nuevoEstado
    } else {
      console.error('[conciliacion-sync]', f.mensaje)
    }
    if (Object.keys(cambios).length) {
      try {
        if (!(await actualizarCuenta(cambios))) console.error('[conciliacion-sync] la cuenta se desconectó mientras se leía')
      } catch (err) {
        console.error('[conciliacion-sync] registrar el error de la cuenta:', mensajeDe(err))
      }
    }
    if (corridaId) await cerrarCorrida(corridaId, 'error', cont, f.mensaje)
    return {
      ...base,
      ...contadores(),
      sincronizadaHasta: avance?.sincronizada_hasta ?? base.sincronizadaHasta,
      error: f.deLaCuenta ? f.mensaje : 'No pudimos guardar lo que leímos de Mercado Pago. Probá de nuevo.',
    }
  }
}

async function cerrarCorrida(id: string, estado: 'ok' | 'error', c: Contadores, error: string | null): Promise<void> {
  const supabase = createAdminClient()
  const { error: err } = await supabase
    .from('mp_sync_corridas')
    .update({
      estado,
      terminada_at: new Date().toISOString(),
      paginas: c.paginas,
      leidos: c.leidos,
      nuevos: c.nuevos,
      actualizados: c.actualizados,
      error: error ? (c.descartados ? `${error} · ${c.descartados} pagos sin datos mínimos` : error) : c.descartados ? `${c.descartados} pagos sin datos mínimos` : null,
    })
    .eq('id', id)
  if (err) console.error('[conciliacion-sync] cerrar corrida:', err.message)
}

/**
 * Lee un tramo de fechas (por date_last_updated) en un sentido. Devuelve si
 * llegó al final y el date_last_updated más extremo PROCESADO (el más nuevo en
 * 'asc', el más viejo en 'desc'), para guardar lecturas parciales coherentes.
 * NO tira: si una página falla, devuelve el fallo junto con lo leído hasta ahí.
 */
async function leerTramo(p: {
  mpUserId: string
  desde: number
  hasta: number
  orden: 'asc' | 'desc'
  pedir: (q: Record<string, string | number>) => Promise<PaginaMp>
  guardar: (pagos: PagoCrudoMp[]) => Promise<void>
  limite: number
  signal?: AbortSignal
  cont: Contadores
}): Promise<Tramo> {
  let borde = p.orden === 'asc' ? p.desde : p.hasta
  let offset = 0
  let extremo: number | null = null
  try {
    for (;;) {
      if (p.signal?.aborted || p.limite - Date.now() < MIN_PARA_PAGINA_MS) return { completo: false, extremo }
      const pagina = await p.pedir({
        'collector.id': p.mpUserId,
        range: 'date_last_updated',
        begin_date: fechaParaMp(p.orden === 'asc' ? borde : p.desde),
        end_date: fechaParaMp(p.orden === 'asc' ? p.hasta : borde),
        sort: 'date_last_updated',
        criteria: p.orden,
        limit: LIMITE_PAGINA,
        offset,
      })
      const pagos = pagina?.results ?? []
      p.cont.paginas++
      p.cont.leidos += pagos.length
      await p.guardar(pagos)

      const fechas = pagos.map((x) => new Date(x.date_last_updated ?? '').getTime()).filter((t) => Number.isFinite(t))
      if (fechas.length) {
        const masExtremo = p.orden === 'asc' ? Math.max(...fechas) : Math.min(...fechas)
        extremo = extremo === null ? masExtremo : p.orden === 'asc' ? Math.max(extremo, masExtremo) : Math.min(extremo, masExtremo)
      }
      if (pagos.length < LIMITE_PAGINA) return { completo: true, extremo }

      // Siguiente página: desde la fecha de la última leída (−1 s de solape).
      const ultima = fechas.length ? fechas[fechas.length - 1] : null
      const nuevoBorde = ultima === null ? null : p.orden === 'asc' ? ultima - 1000 : ultima + 1000
      const avanza = nuevoBorde !== null && (p.orden === 'asc' ? nuevoBorde > borde : nuevoBorde < borde)
      if (avanza) {
        borde = nuevoBorde
        offset = 0
      } else {
        // 50 pagos dentro del mismo segundo: se sigue por offset dentro de esa fecha.
        offset += LIMITE_PAGINA
        if (offset + LIMITE_PAGINA > MAX_OFFSET) throw new Error('Demasiados pagos con la misma fecha para leerlos en orden.')
      }
    }
  } catch (e) {
    return { completo: false, extremo, error: e }
  }
}
