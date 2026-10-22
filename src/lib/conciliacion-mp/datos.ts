import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/datos.ts
// Los lectores de la conciliación. Todo con service role (las tablas mp_* no
// tienen policies) y SIEMPRE scopeado por organización: quien llama ya
// verificó el permiso y la org (`acceso.ts`).
//
// Reglas de este archivo:
//   - Toda lista va paginada con `paginarTodo`, que TIRA ante un error: un
//     parcial silencioso en plata es Known Risk #15.
//   - `mp_movimientos` crece todos los días: nunca se lee sin ventana de fecha
//     (o sin lista de ids) y sin paginar.
//   - Los cobros del sistema salen de la RPC `conciliacion_mp_esperados` (mig
//     228), NO de embeds: visits ↔ payment_receipts tiene dos FKs.
//   - Los embeds que quedan (resoluciones → movimiento / transfer_log) van por
//     la COLUMNA de la FK, que no puede ser ambigua aunque mañana aparezca otra
//     FK entre esas tablas.
// =============================================================================

import { createAdminClient } from '@/lib/supabase/server'
import type { EsperadoMP, MotivoRevision, TipoEsperado, TipoMovimiento } from './contrato'
import type { MovimientoMotor, RechazoMotor, ResolucionMotor } from './motor'
import type { CuentaCobroFila, CuentaMpFila, LinkVigente, SucursalFila } from './filas'
import { conConcurrencia, enLotes, paginarTodo } from './paginar'

const DIA_MS = 24 * 60 * 60 * 1000
/** Los créditos se leen con 2 h de margen a cada lado del período (un cobro de las 00:05 pudo acreditarse a las 23:59). */
export const MARGEN_MOVIMIENTOS_MS = 2 * 60 * 60 * 1000
/** La RPC se pide por tramos de una semana: cada llamada calcula sólo su tramo (paginar con offset la recalcula entera). */
const TRAMO_ESPERADOS_MS = 7 * DIA_MS
const LOTE_IN = 150

const iso = (ms: number) => new Date(ms).toISOString()

function num(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? n : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Sucursales, cuentas de cobro y cuentas de MP
// ─────────────────────────────────────────────────────────────────────────────

export async function leerSucursales(orgId: string): Promise<SucursalFila[]> {
  const supabase = createAdminClient()
  const filas = await paginarTodo<{ id: string; name: string }>(
    (d, h) => supabase.from('branches').select('id, name').eq('organization_id', orgId).order('id').range(d, h),
    'las sucursales',
  )
  return filas.map((b) => ({ id: b.id, nombre: b.name }))
}

interface FilaCuentaCobro {
  id: string
  branch_id: string
  name: string
  alias_or_cbu: string | null
  is_active: boolean
  sort_order: number | null
  mp_cuenta_id: string | null
  fuente_conciliacion: string | null
}

/** Todas las cuentas de cobro de la org (activas e inactivas: los clientes guardan el alias viejo). */
export async function leerCuentasDeCobro(orgId: string, sucursales?: SucursalFila[]): Promise<CuentaCobroFila[]> {
  const suc = sucursales ?? (await leerSucursales(orgId))
  if (!suc.length) return []
  const supabase = createAdminClient()
  const filas = await paginarTodo<FilaCuentaCobro>(
    (d, h) =>
      supabase
        .from('payment_accounts')
        .select('id, branch_id, name, alias_or_cbu, is_active, sort_order, mp_cuenta_id, fuente_conciliacion')
        .in(
          'branch_id',
          suc.map((s) => s.id),
        )
        .order('id')
        .range(d, h),
    'las cuentas de cobro',
  )
  return filas.map((p) => ({
    id: p.id,
    sucursalId: p.branch_id,
    nombre: p.name,
    alias: p.alias_or_cbu && p.alias_or_cbu.trim() ? p.alias_or_cbu.trim() : null,
    activa: p.is_active,
    orden: p.sort_order,
    cuentaMpId: p.mp_cuenta_id,
    banco: p.fuente_conciliacion === 'banco',
  }))
}

interface FilaCuentaMp {
  id: string
  mp_user_id: string
  nickname: string | null
  titular: string | null
  email_enmascarado: string | null
  connection_mode: string
  status: string
  last_error: string | null
  last_check_at: string | null
  sincronizada_desde: string | null
  sincronizada_hasta: string | null
  last_sync_at: string | null
  confirmada_at: string | null
  connected_via: string
  sync_lock_until: string | null
}

/** Las cuentas de MP de la org, SIN las columnas de tokens (nunca se piden acá). */
export const COLUMNAS_CUENTA_MP =
  'id, mp_user_id, nickname, titular, email_enmascarado, connection_mode, status, last_error, last_check_at, ' +
  'sincronizada_desde, sincronizada_hasta, last_sync_at, confirmada_at, connected_via, sync_lock_until'

export function cuentaMpDesdeFila(c: FilaCuentaMp): CuentaMpFila {
  const status = (['conectada', 'error', 'revocada', 'desconectada'].includes(c.status) ? c.status : 'error') as CuentaMpFila['status']
  return {
    id: c.id,
    mpUserId: c.mp_user_id,
    nickname: c.nickname,
    titular: c.titular,
    emailEnmascarado: c.email_enmascarado,
    modo: c.connection_mode === 'manual' ? 'manual' : 'oauth',
    status,
    lastError: c.last_error,
    lastCheckAt: c.last_check_at,
    sincronizadaDesde: c.sincronizada_desde,
    sincronizadaHasta: c.sincronizada_hasta,
    lastSyncAt: c.last_sync_at,
    confirmadaAt: c.confirmada_at,
    connectedVia: c.connected_via === 'link' ? 'link' : 'dashboard',
    syncLockUntil: c.sync_lock_until,
  }
}

export async function leerCuentasMp(orgId: string): Promise<CuentaMpFila[]> {
  const supabase = createAdminClient()
  const filas = await paginarTodo<FilaCuentaMp>(
    (d, h) =>
      supabase.from('mp_cuentas').select(COLUMNAS_CUENTA_MP).eq('organization_id', orgId).order('id').range(d, h).returns<FilaCuentaMp[]>(),
    'las cuentas de Mercado Pago',
  )
  return filas.map(cuentaMpDesdeFila)
}

/** El alias que representa a una cuenta de MP: el de su cuenta de cobro activa de menor orden. */
export function aliasPrincipal(cuentaMpId: string, cuentasCobro: CuentaCobroFila[]): string | null {
  const vinculadas = cuentasCobro
    .filter((p) => p.cuentaMpId === cuentaMpId && p.alias)
    .sort((a, b) => Number(b.activa) - Number(a.activa) || (a.orden ?? 1e9) - (b.orden ?? 1e9) || a.id.localeCompare(b.id))
  return vinculadas[0]?.alias ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Lado sistema: los cobros esperados (RPC de la mig 228)
// ─────────────────────────────────────────────────────────────────────────────

interface FilaEsperada {
  clave: string
  tipo: string
  transfer_log_id: string | null
  visit_id: string | null
  payment_account_id: string | null
  branch_id: string | null
  monto: number | string | null
  propina: number | string | null
  t_sistema: string
  covering_receipt_id: string | null
  barbero: string | null
  cliente: string | null
  servicio: string | null
  es_manual: boolean | null
  receipt_id: string | null
  receipt_operacion: string | null
  receipt_remitente: string | null
  receipt_monto: number | string | null
  receipt_hhmm: string | null
  receipt_estado: string | null
  receipt_tiene_imagen: boolean | null
}

async function leerFilasEsperadas(orgId: string, desde: Date, hasta: Date): Promise<FilaEsperada[]> {
  const supabase = createAdminClient()
  const tramos: [number, number][] = []
  for (let a = desde.getTime(); a < hasta.getTime(); a += TRAMO_ESPERADOS_MS) {
    tramos.push([a, Math.min(a + TRAMO_ESPERADOS_MS, hasta.getTime())])
  }
  const partes = await conConcurrencia(tramos, 3, ([a, b]) =>
    paginarTodo<FilaEsperada>(
      (d, h) =>
        supabase
          .rpc('conciliacion_mp_esperados', { p_org: orgId, p_desde: iso(a), p_hasta: iso(b) })
          // Orden TOTAL para paginar sin repetir ni saltear (la clave es única).
          .order('t_sistema', { ascending: true })
          .order('clave', { ascending: true })
          .range(d, h),
      'los cobros por transferencia del sistema',
    ),
  )
  const vistas = new Set<string>()
  const filas: FilaEsperada[] = []
  for (const parte of partes) {
    for (const f of parte) {
      if (vistas.has(f.clave)) continue
      vistas.add(f.clave)
      filas.push(f)
    }
  }
  return filas
}

const TIPOS_ESPERADO = new Set<TipoEsperado>(['cobro', 'sin_cuenta', 'propina_suelta'])

export async function leerEsperados(
  orgId: string,
  desde: Date,
  hasta: Date,
  ctx: { cuentasCobro: CuentaCobroFila[]; sucursales: SucursalFila[] },
): Promise<EsperadoMP[]> {
  const filas = await leerFilasEsperadas(orgId, desde, hasta)
  const cuentaCobro = new Map(ctx.cuentasCobro.map((p) => [p.id, p]))
  const sucursal = new Map(ctx.sucursales.map((s) => [s.id, s.nombre]))
  return filas.map((f) => {
    const pa = f.payment_account_id ? cuentaCobro.get(f.payment_account_id) : undefined
    const propina = num(f.propina)
    return {
      clave: f.clave,
      tipo: TIPOS_ESPERADO.has(f.tipo as TipoEsperado) ? (f.tipo as TipoEsperado) : 'cobro',
      transferLogId: f.transfer_log_id,
      visitId: f.visit_id,
      paymentAccountId: f.payment_account_id,
      cuentaMpId: pa?.cuentaMpId ?? null,
      alias: pa?.alias ?? null,
      sucursalId: f.branch_id,
      sucursal: f.branch_id ? (sucursal.get(f.branch_id) ?? null) : null,
      // Lo que transfirió el cliente: monto neto de seña + propina transferida.
      monto: num(f.monto) + propina,
      propina,
      tSistema: f.t_sistema,
      coveringReceiptId: f.covering_receipt_id,
      barbero: f.barbero,
      cliente: f.cliente,
      servicio: f.servicio,
      esManual: !!f.es_manual,
      comprobante: f.receipt_id
        ? {
            id: f.receipt_id,
            operacion: f.receipt_operacion,
            remitente: f.receipt_remitente,
            monto: f.receipt_monto === null || f.receipt_monto === undefined ? null : num(f.receipt_monto),
            hhmm: f.receipt_hhmm,
            estado: f.receipt_estado,
            tieneImagen: !!f.receipt_tiene_imagen,
          }
        : null,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Lado Mercado Pago: los movimientos guardados
// ─────────────────────────────────────────────────────────────────────────────

interface FilaMovimientoDb {
  id: string
  mp_cuenta_id: string
  mp_id: string
  tipo: string
  operation_type: string | null
  payment_type_id: string | null
  payment_method_id: string | null
  status: string
  monto: number | string
  fecha: string
  pagador_nombre: string | null
  pagador_doc_ult4: string | null
  descripcion: string | null
}

const COLUMNAS_MOVIMIENTO =
  'id, mp_cuenta_id, mp_id, tipo, operation_type, payment_type_id, payment_method_id, status, monto, fecha, ' +
  'pagador_nombre, pagador_doc_ult4, descripcion'

function movimientoDesdeFila(m: FilaMovimientoDb): MovimientoMotor {
  return {
    id: m.id,
    cuentaMpId: m.mp_cuenta_id,
    mpId: m.mp_id,
    tipo: m.tipo as TipoMovimiento,
    monto: num(m.monto),
    fecha: m.fecha,
    pagador: m.pagador_nombre,
    pagadorDocUlt4: m.pagador_doc_ult4,
    descripcion: m.descripcion,
    operationType: m.operation_type,
    paymentTypeId: m.payment_type_id,
    paymentMethodId: m.payment_method_id,
    status: m.status,
  }
}

/** Créditos APROBADOS de esas cuentas en [desde, hasta). Lo devuelto/contracargado no es plata recibida. */
export async function leerMovimientos(orgId: string, cuentaIds: string[], desde: Date, hasta: Date): Promise<MovimientoMotor[]> {
  if (!cuentaIds.length) return []
  const supabase = createAdminClient()
  const partes = await conConcurrencia(enLotes(cuentaIds, LOTE_IN), 2, (lote) =>
    paginarTodo<FilaMovimientoDb>(
      (d, h) =>
        supabase
          .from('mp_movimientos')
          .select(COLUMNAS_MOVIMIENTO)
          .eq('organization_id', orgId)
          .in('mp_cuenta_id', lote)
          .eq('status', 'approved')
          .gte('fecha', desde.toISOString())
          .lt('fecha', hasta.toISOString())
          .order('fecha', { ascending: true })
          .order('id', { ascending: true })
          .range(d, h)
          .returns<FilaMovimientoDb[]>(),
      'los movimientos de Mercado Pago',
    ),
  )
  return partes.flat().map(movimientoDesdeFila)
}

/** Movimientos puntuales (los vinculados a mano que caen fuera de la ventana), con cualquier estado. */
export async function leerMovimientosPorId(orgId: string, ids: string[]): Promise<MovimientoMotor[]> {
  const unicos = [...new Set(ids)]
  if (!unicos.length) return []
  const supabase = createAdminClient()
  const partes = await conConcurrencia(enLotes(unicos, LOTE_IN), 2, async (lote) => {
    const { data, error } = await supabase
      .from('mp_movimientos')
      .select(COLUMNAS_MOVIMIENTO)
      .eq('organization_id', orgId)
      .in('id', lote)
      .limit(lote.length)
      .returns<FilaMovimientoDb[]>()
    if (error) throw new Error(`No pudimos leer los movimientos vinculados: ${error.message}`)
    return data ?? []
  })
  return partes.flat().map(movimientoDesdeFila)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que decidió una persona
// ─────────────────────────────────────────────────────────────────────────────

interface FilaResolucion {
  id: string
  tipo: string
  movimiento_id: string | null
  transfer_log_id: string | null
  clave_esperado: string | null
  motivo: string | null
  nota: string | null
  created_by: string | null
  created_by_nombre: string | null
  created_at: string
}

const COLUMNAS_RESOLUCION = 'id, tipo, movimiento_id, transfer_log_id, clave_esperado, motivo, nota, created_by, created_by_nombre, created_at'

function resolucionDesdeFila(r: FilaResolucion): ResolucionMotor {
  return {
    id: r.id,
    tipo: r.tipo === 'vinculo' ? 'vinculo' : 'revisado',
    movimientoId: r.movimiento_id,
    transferLogId: r.transfer_log_id,
    claveEsperado: r.clave_esperado,
    motivo: (r.motivo as MotivoRevision | null) ?? null,
    nota: r.nota,
    por: r.created_by_nombre,
    en: r.created_at,
    // Las filas de un mismo "Marcar revisado" salen del mismo insert: mismo
    // created_at y mismo autor. El motor las agrupa por eso (el par cobro +
    // crédito se vuelve a armar como un caso).
    autor: r.created_by,
  }
}

/**
 * Las resoluciones activas que tocan el período: por el movimiento (en la
 * ventana de créditos), por el cobro (en el período) y por la clave de los
 * esperados sin transfer_log. Tres consultas acotadas en vez de traer todas
 * las de la org, que crecen para siempre.
 */
export async function leerResoluciones(
  orgId: string,
  p: { desde: Date; hasta: Date; movDesde: Date; movHasta: Date; claves: string[] },
): Promise<ResolucionMotor[]> {
  const supabase = createAdminClient()
  const [porMov, porTl, porClave] = await Promise.all([
    paginarTodo<FilaResolucion>(
      (d, h) =>
        supabase
          .from('mp_conciliacion_resoluciones')
          .select(`${COLUMNAS_RESOLUCION}, mov:movimiento_id!inner(fecha)`)
          .eq('organization_id', orgId)
          .is('deshecho_at', null)
          .gte('mov.fecha', p.movDesde.toISOString())
          .lt('mov.fecha', p.movHasta.toISOString())
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(d, h)
          .returns<FilaResolucion[]>(),
      'las resoluciones de la conciliación',
    ),
    paginarTodo<FilaResolucion>(
      (d, h) =>
        supabase
          .from('mp_conciliacion_resoluciones')
          .select(`${COLUMNAS_RESOLUCION}, tl:transfer_log_id!inner(transferred_at)`)
          .eq('organization_id', orgId)
          .is('deshecho_at', null)
          .gte('tl.transferred_at', p.desde.toISOString())
          .lt('tl.transferred_at', p.hasta.toISOString())
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(d, h)
          .returns<FilaResolucion[]>(),
      'las resoluciones de la conciliación',
    ),
    conConcurrencia(enLotes([...new Set(p.claves)], LOTE_IN), 2, async (lote) => {
      const { data, error } = await supabase
        .from('mp_conciliacion_resoluciones')
        .select(COLUMNAS_RESOLUCION)
        .eq('organization_id', orgId)
        .is('deshecho_at', null)
        .in('clave_esperado', lote)
        .limit(1000)
        .returns<FilaResolucion[]>()
      if (error) throw new Error(`No pudimos leer las resoluciones de la conciliación: ${error.message}`)
      return data ?? []
    }),
  ])
  const vistas = new Map<string, ResolucionMotor>()
  for (const f of [...porMov, ...porTl, ...porClave.flat()]) {
    if (!vistas.has(f.id)) vistas.set(f.id, resolucionDesdeFila(f))
  }
  return [...vistas.values()]
}

interface FilaRechazo {
  id: string
  transfer_log_id: string
  movimiento_id: string
  created_by_nombre: string | null
  created_at: string
}

const COLUMNAS_RECHAZO = 'id, transfer_log_id, movimiento_id, created_by_nombre, created_at'

/**
 * Los pares que una persona descartó con "No es este" (mig 230), ACTIVOS, que
 * tocan esos cobros o esos créditos. Por lotes de `.in()` y con el paginador
 * que tira: un descarte que no se leyó volvería a juntar un par que una persona
 * dijo que no va (Known Risk #15). Sin embeds: la columna alcanza.
 */
export async function leerRechazos(
  orgId: string,
  columna: 'transfer_log_id' | 'movimiento_id',
  ids: string[],
): Promise<RechazoMotor[]> {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (!unicos.length) return []
  const supabase = createAdminClient()
  const partes = await conConcurrencia(enLotes(unicos, LOTE_IN), 3, (lote) =>
    paginarTodo<FilaRechazo>(
      (d, h) =>
        supabase
          .from('mp_conciliacion_rechazos')
          .select(COLUMNAS_RECHAZO)
          .eq('organization_id', orgId)
          .is('deshecho_at', null)
          .in(columna, lote)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(d, h)
          .returns<FilaRechazo[]>(),
      'los emparejamientos descartados de la conciliación',
    ),
  )
  return partes.flat().map((r) => ({
    id: r.id,
    transferLogId: r.transfer_log_id,
    movimientoId: r.movimiento_id,
    por: r.created_by_nombre,
    en: r.created_at,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Links y plata de los últimos 30 días (para las tarjetas)
// ─────────────────────────────────────────────────────────────────────────────

interface FilaLink {
  id: string
  payment_account_id: string
  expires_at: string
  abierto_at: string | null
  created_at: string
}

export async function leerLinksVigentes(orgId: string): Promise<LinkVigente[]> {
  const supabase = createAdminClient()
  const ahora = new Date().toISOString()
  const filas = await paginarTodo<FilaLink>(
    (d, h) =>
      supabase
        .from('mp_conexion_links')
        .select('id, payment_account_id, expires_at, abierto_at, created_at')
        .eq('organization_id', orgId)
        .is('used_at', null)
        .is('revoked_at', null)
        .gt('expires_at', ahora)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(d, h)
        .returns<FilaLink[]>(),
    'los links de conexión',
  )
  return filas.map((l) => ({
    id: l.id,
    paymentAccountId: l.payment_account_id,
    venceEn: l.expires_at,
    abierto: !!l.abierto_at,
    creadoEn: l.created_at,
  }))
}

/** Lo transferido en los últimos 30 días por cuenta de cobro (monto + propina), para priorizar qué conectar. */
export async function montoTransferido30Dias(paymentAccountIds: string[]): Promise<Map<string, number>> {
  const total = new Map<string, number>()
  if (!paymentAccountIds.length) return total
  const supabase = createAdminClient()
  const desde = new Date(Date.now() - 30 * DIA_MS).toISOString()
  const partes = await conConcurrencia(enLotes(paymentAccountIds, LOTE_IN), 2, (lote) =>
    paginarTodo<{ payment_account_id: string; amount: number | string; tip_amount: number | string | null }>(
      (d, h) =>
        supabase
          .from('transfer_logs')
          .select('payment_account_id, amount, tip_amount')
          .in('payment_account_id', lote)
          .gte('transferred_at', desde)
          .order('transferred_at', { ascending: true })
          .order('id', { ascending: true })
          .range(d, h),
      'lo transferido en los últimos 30 días',
    ),
  )
  for (const f of partes.flat()) {
    total.set(f.payment_account_id, (total.get(f.payment_account_id) ?? 0) + num(f.amount) + num(f.tip_amount))
  }
  return total
}

// ─────────────────────────────────────────────────────────────────────────────
// Todo lo que necesita el motor para un período
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las cuentas de MP cuyos créditos se leen: las vinculadas a alguna cuenta de
 * cobro que NO es de banco. Una cuenta que el dueño rechazó (desvinculada) no
 * tiene nada que conciliar, y una marcada "banco" no se lee: si quedó
 * vinculada, sus créditos no pueden aparecer como "sobran".
 */
export function cuentasMpALeer(cuentasCobro: CuentaCobroFila[], cuentasMp: CuentaMpFila[]): string[] {
  const existentes = new Set(cuentasMp.map((c) => c.id))
  return [
    ...new Set(
      cuentasCobro.filter((p) => !p.banco && !!p.cuentaMpId && existentes.has(p.cuentaMpId)).map((p) => p.cuentaMpId as string),
    ),
  ]
}

export interface DatosPeriodo {
  sucursales: SucursalFila[]
  cuentasCobro: CuentaCobroFila[]
  cuentasMp: CuentaMpFila[]
  esperados: EsperadoMP[]
  movimientos: MovimientoMotor[]
  resoluciones: ResolucionMotor[]
  /** Los pares descartados a mano ("No es este") activos que tocan el período. */
  rechazos: RechazoMotor[]
}

export async function cargarPeriodo(orgId: string, desde: Date, hasta: Date): Promise<DatosPeriodo> {
  const sucursales = await leerSucursales(orgId)
  const [cuentasCobro, cuentasMp] = await Promise.all([leerCuentasDeCobro(orgId, sucursales), leerCuentasMp(orgId)])
  const esperados = await leerEsperados(orgId, desde, hasta, { cuentasCobro, sucursales })

  const vinculadas = cuentasMpALeer(cuentasCobro, cuentasMp)
  const movDesde = new Date(desde.getTime() - MARGEN_MOVIMIENTOS_MS)
  const movHasta = new Date(hasta.getTime() + MARGEN_MOVIMIENTOS_MS)

  const [movimientos, resoluciones, rechazosDeCobros] = await Promise.all([
    leerMovimientos(orgId, vinculadas, movDesde, movHasta),
    leerResoluciones(orgId, {
      desde,
      hasta,
      movDesde,
      movHasta,
      claves: esperados.filter((e) => e.tipo !== 'cobro').map((e) => e.clave),
    }),
    // Los descartes de los cobros del período (sólo los cobros con transfer_log se descartan).
    leerRechazos(
      orgId,
      'transfer_log_id',
      esperados.map((e) => e.transferLogId).filter((x): x is string => !!x),
    ),
  ])

  // Un vínculo manual puede apuntar a un crédito fuera de la ventana: se trae aparte.
  // Los descartes alcanza con leerlos por los cobros del período: uno cuyo cobro
  // es de un período vecino no traba nada acá (ese cobro no entra al motor).
  const cargados = new Set(movimientos.map((m) => m.id))
  const faltantes = resoluciones.filter((r) => r.movimientoId && !cargados.has(r.movimientoId)).map((r) => r.movimientoId!)
  movimientos.push(...(await leerMovimientosPorId(orgId, faltantes)))

  return {
    sucursales,
    cuentasCobro,
    cuentasMp,
    esperados,
    movimientos,
    resoluciones,
    rechazos: rechazosDeCobros,
  }
}
