import 'server-only'

// =============================================================================
// src/lib/conciliacion-mp/servicio.ts
// La conciliación de un período, de punta a punta: leer (datos.ts) → cruzar
// (motor.ts, puro) → recortar al alcance → veredicto, tarjetas y narrativa. Lo
// usan las server actions de la pantalla, las herramientas de Tex y el "pulso
// del día". No verifica permisos: eso lo hace quien llama (acceso.ts / Tex).
//
// EL MOTOR CORRE SOBRE TODA LA ORG Y RECIÉN DESPUÉS SE RECORTA AL ALCANCE.
// barberia.monaco cobra para Caseros y para Paraná: si a un encargado de
// Caseros se le cruzaran sólo los cobros de Caseros contra los créditos de esa
// cuenta, los créditos de los cortes de Paraná le aparecerían como "sobran".
// Cruzando todo y filtrando los casos, los dos ven lo mismo sobre su parte.
//
// Nunca devuelve ceros ante un fallo (Known Risk #15): o el resultado
// completo, o `{ ok: false, error }`.
// =============================================================================

import type { CasoConciliacion, CuentaConciliacion, RespuestaConciliacion, RespuestaTira, ResultadoConciliacion, Veredicto } from './contrato'
import { CONCILIACION } from './contrato'
import { conciliar, resumir, resumirDias, type CuentaCobroMotor, type CuentaMpMotor } from './motor'
import { narrar } from './narrativa'
import { armarTarjetas } from './cuentas'
import {
  aliasPrincipal,
  cargarPeriodo,
  cuentasMpALeer,
  leerCuentasDeCobro,
  leerCuentasMp,
  leerLinksVigentes,
  leerSucursales,
  montoTransferido30Dias,
  type DatosPeriodo,
} from './datos'
import type { CuentaCobroFila, CuentaMpFila } from './filas'
import { describirPeriodo, diaAR, diasDelPeriodo, fechaLarga, periodoDeDias, sumarDias } from './fechas'
import { oauthDisponible as appConfigurada } from './oauth'

/** Máximo de días de un período (la pantalla y Tex lo validan antes). */
export const MAX_DIAS_PERIODO = 62

/** La app de OAuth de conciliación está configurada (env MP_CONCILIACION_*). */
export function oauthDisponible(): boolean {
  return appConfigurada()
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Para el usuario: el motivo si es nuestro ("No pudimos leer…"), si no uno genérico. */
function errorParaMostrar(e: unknown): string {
  const m = mensajeDe(e)
  return /^No pudimos /.test(m) ? m : 'No pudimos armar la conciliación. Probá de nuevo en un momento.'
}

function paraMotor(d: Pick<DatosPeriodo, 'cuentasMp' | 'cuentasCobro'>): { cuentasMp: CuentaMpMotor[]; cuentasCobro: CuentaCobroMotor[] } {
  const existentes = new Set(d.cuentasMp.map((c) => c.id))
  return {
    cuentasMp: d.cuentasMp.map((c) => ({
      id: c.id,
      alias: aliasPrincipal(c.id, d.cuentasCobro) ?? c.nickname,
      status: c.status,
      lastError: c.lastError,
      sincronizadaDesde: c.sincronizadaDesde,
      sincronizadaHasta: c.sincronizadaHasta,
    })),
    cuentasCobro: d.cuentasCobro.map((p) => ({
      id: p.id,
      alias: p.alias,
      sucursalId: p.sucursalId,
      cuentaMpId: p.cuentaMpId && existentes.has(p.cuentaMpId) ? p.cuentaMpId : null,
      banco: p.banco,
      activa: p.activa,
    })),
  }
}

/**
 * Los casos que ve alguien con ese alcance: los de sus sucursales y los
 * créditos sin cobro de cuentas vinculadas a alguna de sus sucursales.
 */
function recortarAlAlcance(casos: CasoConciliacion[], alcance: Set<string> | null, cuentasCobro: CuentaCobroFila[]): CasoConciliacion[] {
  if (!alcance) return casos
  const sucursalesDeMp = new Map<string, Set<string>>()
  for (const p of cuentasCobro) {
    if (!p.cuentaMpId) continue
    const s = sucursalesDeMp.get(p.cuentaMpId) ?? new Set<string>()
    s.add(p.sucursalId)
    sucursalesDeMp.set(p.cuentaMpId, s)
  }
  return casos.filter((c) =>
    c.esperados.length > 0
      ? c.esperados.some((x) => !!x.sucursalId && alcance.has(x.sucursalId))
      : !!c.movimiento && [...(sucursalesDeMp.get(c.movimiento.cuentaMpId) ?? [])].some((s) => alcance.has(s)),
  )
}

/**
 * Las cuentas de MP que tienen que estar leídas para decir "Cuadra" o "No hubo
 * transferencias" en ese alcance: las que se leen (vinculadas a una cuenta de
 * cobro que no es de banco) y que reciben plata de alguna sucursal del
 * alcance. Una desconectada la descarta el motor (el dueño la sacó).
 */
function cuentasMpDelAlcance(cuentasCobro: CuentaCobroFila[], cuentasMp: CuentaMpFila[], alcance: Set<string> | null): string[] {
  const aLeer = new Set(cuentasMpALeer(cuentasCobro, cuentasMp))
  return [
    ...new Set(
      cuentasCobro
        .filter((p) => !p.banco && !!p.cuentaMpId && aLeer.has(p.cuentaMpId) && (!alcance || alcance.has(p.sucursalId)))
        .map((p) => p.cuentaMpId as string),
    ),
  ].sort()
}

interface OpcionesPeriodo {
  desde: Date
  hasta: Date
  /** null o ausente = todas las sucursales de la org. */
  sucursalesIds?: string[] | null
  etiqueta?: string
}

async function armarResultado(
  orgId: string,
  d: DatosPeriodo,
  opts: OpcionesPeriodo,
  ahora: Date,
  conTarjetas: boolean,
): Promise<ResultadoConciliacion> {
  const { cuentasMp, cuentasCobro } = paraMotor(d)
  const r = conciliar({
    desde: opts.desde.toISOString(),
    hasta: opts.hasta.toISOString(),
    esperados: d.esperados,
    movimientos: d.movimientos,
    cuentasMp,
    cuentasCobro,
    resoluciones: d.resoluciones,
    // Lo que una persona descartó ("No es este"): el motor no lo vuelve a juntar.
    rechazos: d.rechazos,
    // Los cobros se leyeron recién: un crédito de los últimos minutos puede no
    // tener todavía su cobro registrado.
    corte: ahora.toISOString(),
  })
  const alcance = opts.sucursalesIds ? new Set(opts.sucursalesIds) : null
  const casos = recortarAlAlcance(r.casos, alcance, d.cuentasCobro)
  const periodo = describirPeriodo(opts.desde, opts.hasta, ahora)
  const res = resumir({
    casos,
    cobertura: r.cobertura,
    cuentasMp,
    periodo,
    ahora,
    cuentasDelAlcance: cuentasMpDelAlcance(d.cuentasCobro, d.cuentasMp, alcance),
    rango: { desde: opts.desde, hasta: opts.hasta },
  })

  let cuentas: CuentaConciliacion[] = []
  if (conTarjetas) {
    const [links, monto30d] = await Promise.all([
      leerLinksVigentes(orgId),
      montoTransferido30Dias(d.cuentasCobro.map((p) => p.id)),
    ])
    cuentas = armarTarjetas({
      sucursales: d.sucursales,
      cuentasCobro: d.cuentasCobro,
      cuentasMp: d.cuentasMp,
      links,
      monto30d,
      casos,
      alcance,
      ahora,
    })
  }

  return {
    ok: true,
    periodo: {
      desde: opts.desde.toISOString(),
      hasta: opts.hasta.toISOString(),
      etiqueta: opts.etiqueta?.trim() || periodo.etiqueta,
    },
    generadoEn: ahora.toISOString(),
    veredicto: res.veredicto,
    totales: res.totales,
    cobertura: {
      cuentasConectadas: cuentas.filter((t) => t.estado === 'al_dia' || t.estado === 'atrasada' || t.estado === 'error').length,
      cuentasConCobros: cuentas.filter((t) => t.periodo.cobros > 0).length,
      pctPlata: res.pctPlata,
      frescura: res.frescura,
    },
    cuentas,
    casos,
    narrativa: narrar({ veredicto: res.veredicto, casos, cobertura: r.cobertura, cuentasMp, periodo }),
    oauthDisponible: oauthDisponible(),
  }
}

function validarPeriodo(desde: Date, hasta: Date): string | null {
  if (!Number.isFinite(desde.getTime()) || !Number.isFinite(hasta.getTime())) return 'El período no es válido.'
  if (hasta.getTime() <= desde.getTime()) return 'El período no es válido: "hasta" tiene que ser posterior a "desde".'
  if (hasta.getTime() - desde.getTime() > MAX_DIAS_PERIODO * 24 * 60 * 60 * 1000 + 60 * 60 * 1000) {
    return `El período puede tener hasta ${MAX_DIAS_PERIODO} días.`
  }
  return null
}

/** Concilia un período para una organización (alcance de sucursales opcional). */
export async function conciliarPeriodo(
  orgId: string,
  opts: { desde: Date; hasta: Date; sucursalesIds?: string[] | null; etiqueta?: string },
): Promise<RespuestaConciliacion> {
  const invalido = validarPeriodo(opts.desde, opts.hasta)
  if (invalido) return { ok: false, error: invalido }
  if (opts.sucursalesIds && opts.sucursalesIds.length === 0) return { ok: false, error: 'No tenés sucursales asignadas.' }
  try {
    const ahora = new Date()
    const d = await cargarPeriodo(orgId, opts.desde, opts.hasta)
    return await armarResultado(orgId, d, opts, ahora, true)
  } catch (e) {
    console.error('[conciliacion] conciliarPeriodo:', mensajeDe(e))
    return { ok: false, error: errorParaMostrar(e) }
  }
}

/** ¿Hay al menos una cuenta de MP conectada (no desconectada) vinculada a una cuenta de cobro del alcance (que no sea de banco)? */
function hayCuentaConectada(cuentasCobro: CuentaCobroFila[], cuentasMp: CuentaMpFila[], alcance: Set<string> | null): boolean {
  const vivas = new Set(cuentasMp.filter((c) => c.status !== 'desconectada').map((c) => c.id))
  return cuentasCobro.some((p) => !p.banco && !!p.cuentaMpId && vivas.has(p.cuentaMpId) && (!alcance || alcance.has(p.sucursalId)))
}

/**
 * El veredicto de AYER (hora argentina) para el "pulso del día" de Tex. null si
 * no hay NINGUNA cuenta conectada en el alcance — y también si la lectura
 * falla: el pulso no muestra una tarjeta que no pudo calcular (nunca un cero).
 */
export async function veredictoParaPulso(
  orgId: string,
  sucursalesIds: string[],
): Promise<{ veredicto: Veredicto; periodo: string } | null> {
  if (!sucursalesIds.length) return null
  try {
    const alcance = new Set(sucursalesIds)
    const sucursales = await leerSucursales(orgId)
    const [cuentasCobro, cuentasMp] = await Promise.all([leerCuentasDeCobro(orgId, sucursales), leerCuentasMp(orgId)])
    if (!hayCuentaConectada(cuentasCobro, cuentasMp, alcance)) return null
    const ahora = new Date()
    const ayer = sumarDias(diaAR(ahora), -1)
    const { desde, hasta } = periodoDeDias(ayer, ayer)
    const d = await cargarPeriodo(orgId, desde, hasta)
    const r = await armarResultado(orgId, d, { desde, hasta, sucursalesIds, etiqueta: 'Ayer' }, ahora, false)
    return { veredicto: r.veredicto, periodo: `Ayer, ${fechaLarga(ayer)}` }
  } catch (e) {
    console.error('[conciliacion] veredictoParaPulso:', mensajeDe(e))
    return null
  }
}

/**
 * El veredicto de cada uno de los últimos `dias` días (hoy incluido). Una sola
 * lectura y una sola corrida del motor, cortada por día: los cobros de las
 * 23:59 que MP acreditó a las 00:01 quedan bien.
 */
export async function tiraDias(orgId: string, opts: { dias: number; sucursalesIds?: string[] | null }): Promise<RespuestaTira> {
  const dias = Math.max(1, Math.min(MAX_DIAS_PERIODO, Math.round(opts.dias)))
  if (opts.sucursalesIds && opts.sucursalesIds.length === 0) return { ok: false, error: 'No tenés sucursales asignadas.' }
  try {
    const ahora = new Date()
    const hoy = diaAR(ahora)
    const { desde, hasta } = periodoDeDias(sumarDias(hoy, -(dias - 1)), hoy)
    const d = await cargarPeriodo(orgId, desde, hasta)
    const { cuentasMp, cuentasCobro } = paraMotor(d)
    const r = conciliar({
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      esperados: d.esperados,
      movimientos: d.movimientos,
      cuentasMp,
      cuentasCobro,
      resoluciones: d.resoluciones,
      rechazos: d.rechazos,
      corte: ahora.toISOString(),
    })
    const alcance = opts.sucursalesIds ? new Set(opts.sucursalesIds) : null
    const casos = recortarAlAlcance(r.casos, alcance, d.cuentasCobro)
    return {
      ok: true,
      dias: resumirDias(casos, r.cobertura, cuentasMp, diasDelPeriodo(desde, hasta), ahora, {
        cuentasDelAlcance: cuentasMpDelAlcance(d.cuentasCobro, d.cuentasMp, alcance),
      }),
    }
  } catch (e) {
    console.error('[conciliacion] tiraDias:', mensajeDe(e))
    return { ok: false, error: errorParaMostrar(e) }
  }
}

/** Las tarjetas de cuentas sin período (para "¿cómo están las cuentas?" de Tex). */
export async function tarjetasDeCuentas(
  orgId: string,
  sucursalesIds: string[] | null,
): Promise<{ ok: true; cuentas: CuentaConciliacion[]; oauthDisponible: boolean } | { ok: false; error: string }> {
  try {
    const sucursales = await leerSucursales(orgId)
    const [cuentasCobro, cuentasMp, links] = await Promise.all([
      leerCuentasDeCobro(orgId, sucursales),
      leerCuentasMp(orgId),
      leerLinksVigentes(orgId),
    ])
    const monto30d = await montoTransferido30Dias(cuentasCobro.map((p) => p.id))
    const cuentas = armarTarjetas({
      sucursales,
      cuentasCobro,
      cuentasMp,
      links,
      monto30d,
      casos: [],
      alcance: sucursalesIds ? new Set(sucursalesIds) : null,
      ahora: new Date(),
    })
    return { ok: true, cuentas, oauthDisponible: oauthDisponible() }
  } catch (e) {
    console.error('[conciliacion] tarjetasDeCuentas:', mensajeDe(e))
    return { ok: false, error: errorParaMostrar(e) }
  }
}

export interface CuentaSincronizable {
  cuentaMpId: string
  alias: string | null
  ultimaSync: string | null
  /** La última lectura tiene más de 10 min (o nunca se leyó). */
  necesita: boolean
}

/** Las cuentas de MP del alcance que se pueden leer (conectadas o con error), las más atrasadas primero. TIRA si no puede leer. */
export async function cuentasSincronizables(orgId: string, sucursalesIds: string[] | null): Promise<CuentaSincronizable[]> {
  const sucursales = await leerSucursales(orgId)
  const [cuentasCobro, cuentasMp] = await Promise.all([leerCuentasDeCobro(orgId, sucursales), leerCuentasMp(orgId)])
  const alcance = sucursalesIds ? new Set(sucursalesIds) : null
  // Una cuenta de cobro marcada "banco" no se lee aunque haya quedado vinculada.
  const enAlcance = new Set(
    cuentasCobro.filter((p) => !p.banco && p.cuentaMpId && (!alcance || alcance.has(p.sucursalId))).map((p) => p.cuentaMpId as string),
  )
  const ahora = Date.now()
  return cuentasMp
    .filter((c) => enAlcance.has(c.id) && (c.status === 'conectada' || c.status === 'error'))
    .map((c) => ({
      cuentaMpId: c.id,
      alias: aliasPrincipal(c.id, cuentasCobro) ?? c.nickname,
      ultimaSync: c.lastSyncAt,
      necesita: !c.lastSyncAt || ahora - new Date(c.lastSyncAt).getTime() > CONCILIACION.autoSyncMin * 60_000,
    }))
    .sort((a, b) => Number(b.necesita) - Number(a.necesita) || (a.ultimaSync ?? '').localeCompare(b.ultimaSync ?? ''))
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación de ids que llegan del browser
// ─────────────────────────────────────────────────────────────────────────────

/** La cuenta de cobro, si es de la org y de una sucursal del alcance. TIRA si no puede leer. */
export async function cuentaCobroEnAlcance(orgId: string, paymentAccountId: string, alcance: string[]): Promise<CuentaCobroFila | null> {
  const cuentas = await leerCuentasDeCobro(orgId)
  const pa = cuentas.find((p) => p.id === paymentAccountId)
  return pa && alcance.includes(pa.sucursalId) ? pa : null
}

/**
 * La cuenta de MP, si es de la org y está vinculada a alguna cuenta de cobro
 * del alcance (o, si no está vinculada a ninguna, sólo para quien ve todas las
 * sucursales). TIRA si no puede leer.
 */
export async function cuentaMpEnAlcance(
  orgId: string,
  cuentaMpId: string,
  alcance: string[],
): Promise<{ cuenta: CuentaMpFila; alias: string | null } | null> {
  const sucursales = await leerSucursales(orgId)
  const [cuentasCobro, cuentasMp] = await Promise.all([leerCuentasDeCobro(orgId, sucursales), leerCuentasMp(orgId)])
  const cuenta = cuentasMp.find((c) => c.id === cuentaMpId)
  if (!cuenta) return null
  const vinculadas = cuentasCobro.filter((p) => p.cuentaMpId === cuentaMpId)
  const ve = vinculadas.length
    ? vinculadas.some((p) => alcance.includes(p.sucursalId))
    : sucursales.every((s) => alcance.includes(s.id))
  return ve ? { cuenta, alias: aliasPrincipal(cuentaMpId, cuentasCobro) ?? cuenta.nickname } : null
}
