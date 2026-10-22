// Lógica de la pantalla de conciliación que no dibuja nada: pestañas, filtros,
// búsqueda, orden, cuentas, cobertura, balanza, narrativa clicable, CSV y la
// verificación de una cuenta recién conectada.
//
// Los números NO se recalculan acá: el veredicto, los totales y los estados
// salen del motor (servidor). Esto sólo ordena, filtra y presenta lo que vino.
//
// Puro (sin React): se prueba con node.

import {
  ESTADOS_PARA_REVISAR,
  ETIQUETA_PARA_CONFIRMAR,
  ETIQUETA_SENAL,
  MOTIVOS_REVISION,
  TONO_DE_ESTADO,
  esEmparejamientoDudoso,
  etiquetaDeCaso,
  type CasoConciliacion,
  type CuentaConciliacion,
  type EstadoCaso,
  type EstadoCuenta,
  type MotivoRevision,
  type RechazoVista,
  type ResultadoConciliacion,
  type SenalCruce,
  type TonoCaso,
} from '@/lib/conciliacion-mp/contrato'
import type { Periodo } from './periodo'
import { diaMes, fechaCompletaAR, haceCuanto, horaAR, plata, textoRetraso, ymdAR } from './formato'

// ─────────────────────────────────────────────────────────────────────────────
// Pestañas
// ─────────────────────────────────────────────────────────────────────────────

export type PestanaCasos = 'revisar' | 'confirmar' | 'pendientes' | 'cuadran' | 'revisados' | 'sin_verificar' | 'ajenos'

export const PESTANAS: { id: PestanaCasos; etiqueta: string }[] = [
  { id: 'revisar', etiqueta: 'Para revisar' },
  { id: 'confirmar', etiqueta: ETIQUETA_PARA_CONFIRMAR },
  { id: 'pendientes', etiqueta: 'Pendientes' },
  { id: 'cuadran', etiqueta: 'Cuadran' },
  { id: 'revisados', etiqueta: 'Revisados' },
  { id: 'sin_verificar', etiqueta: 'Sin verificar' },
  { id: 'ajenos', etiqueta: 'No parecen cobros' },
]

export function esParaRevisar(e: EstadoCaso): boolean {
  return ESTADOS_PARA_REVISAR.includes(e)
}

export function pestanaDeEstado(e: EstadoCaso): PestanaCasos {
  if (esParaRevisar(e)) return 'revisar'
  switch (e) {
    case 'pendiente':
      return 'pendientes'
    case 'conciliado':
      return 'cuadran'
    case 'revisado':
      return 'revisados'
    case 'sin_verificar':
      return 'sin_verificar'
    default:
      return 'ajenos'
  }
}

/**
 * La pestaña de UN caso. Un emparejamiento dudoso (`esEmparejamientoDudoso`:
 * ventana amplia o un crédito que suma varios cobros sin marcar) sigue siendo
 * 'conciliado' para el motor, pero no prueba que la plata entró: va a "Para
 * confirmar" y no a "Cuadran", donde se leería como plata verificada.
 */
export function pestanaDeCaso(c: Pick<CasoConciliacion, 'estado' | 'confianza' | 'senales'>): PestanaCasos {
  return esEmparejamientoDudoso(c) ? 'confirmar' : pestanaDeEstado(c.estado)
}

/**
 * Un crédito que entró y todavía no se pudo cruzar con un cobro, sin que eso
 * quiera decir que "sobra": el motor lo deja 'pendiente' (entró hace minutos y
 * el barbero puede estar cerrando el cobro en la tablet, o podría ser de un
 * cobro cuyo tramo de Mercado Pago no se leyó) o 'sin_verificar' (podría ser
 * de un cobro que no se puede verificar). Es un caso con movimiento y SIN
 * esperados; el porqué lo dice su explicación.
 */
export function esCreditoSinCruzar(c: Pick<CasoConciliacion, 'estado' | 'esperados' | 'movimiento'>): boolean {
  return (c.estado === 'pendiente' || c.estado === 'sin_verificar') && c.esperados.length === 0 && c.movimiento != null
}

/**
 * La palabra del estado de un caso (la del contrato, la misma que usa Tex): lo
 * dudoso dice "Para confirmar" y nunca "Cuadra"; un crédito pendiente, "Esperando
 * el cobro" y no "Esperando a Mercado Pago".
 */
export { etiquetaDeCaso }

/** El color de un caso: lo dudoso va en gris (todavía no se sabe), nunca en verde. */
export function tonoDeCaso(c: CasoConciliacion): TonoCaso {
  return esEmparejamientoDudoso(c) ? 'desconocido' : TONO_DE_ESTADO[c.estado]
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtros y búsqueda
// ─────────────────────────────────────────────────────────────────────────────

export interface FiltrosCasos {
  sucursalId: string | null
  /** Alias de la cuenta (la del registro o la de donde entró la plata). */
  alias: string | null
  barbero: string | null
  /** Un estado puntual dentro de la pestaña (lo pone la narrativa de Tex). */
  estado: EstadoCaso | null
  texto: string
}

export const FILTROS_VACIOS: FiltrosCasos = { sucursalId: null, alias: null, barbero: null, estado: null, texto: '' }

export function hayFiltros(f: FiltrosCasos): boolean {
  return f.sucursalId != null || f.alias != null || f.barbero != null || f.estado != null || f.texto.trim() !== ''
}

/** Minúsculas y sin acentos: "Gómez" encuentra "gomez". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Un movimiento que "no parece un cobro" nunca se muestra ni se busca por su pagador. */
function pagadorVisible(c: CasoConciliacion): string | null {
  return c.estado === 'ajeno' ? null : (c.movimiento?.pagador ?? null)
}

function pajarDeBusqueda(c: CasoConciliacion): string {
  const partes: (string | number | null | undefined)[] = [
    c.alias,
    c.aliasMp,
    pagadorVisible(c),
    c.movimiento?.mpId,
    c.montoSistema || null,
    c.montoMp || null,
    c.diferencia ? Math.abs(c.diferencia) : null,
  ]
  for (const e of c.esperados) {
    partes.push(e.barbero, e.cliente, e.servicio, e.alias, e.sucursal, e.comprobante?.operacion, e.comprobante?.remitente)
  }
  return normalizar(partes.filter((x) => x != null && x !== '').join(' '))
}

/**
 * Busca por cliente, barbero, pagador, alias, monto o número de operación. Cada
 * palabra tiene que aparecer en algún lado ("lucas 18000"). Un monto se escribe
 * como quieras: "18000", "18.000" o "$18.000".
 */
export function coincideBusqueda(c: CasoConciliacion, consulta: string): boolean {
  const q = consulta.trim()
  if (!q) return true
  const pajar = pajarDeBusqueda(c)
  return normalizar(q)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^\$?[\d.,]+$/.test(t) ? t.replace(/\D/g, '') : t))
    .filter(Boolean)
    .every((t) => pajar.includes(t))
}

function aliasNorm(a: string | null | undefined): string {
  return (a ?? '').toLowerCase().replace(/\s+/g, '')
}

export function filtrarCasos(casos: CasoConciliacion[], f: FiltrosCasos): CasoConciliacion[] {
  const alias = f.alias ? aliasNorm(f.alias) : null
  return casos.filter((c) => {
    if (f.estado && c.estado !== f.estado) return false
    if (f.sucursalId && c.sucursalId !== f.sucursalId && !c.esperados.some((e) => e.sucursalId === f.sucursalId)) return false
    if (alias && aliasNorm(c.alias) !== alias && aliasNorm(c.aliasMp) !== alias && !c.esperados.some((e) => aliasNorm(e.alias) === alias)) {
      return false
    }
    if (f.barbero && !c.esperados.some((e) => e.barbero === f.barbero)) return false
    return coincideBusqueda(c, f.texto)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Orden
// ─────────────────────────────────────────────────────────────────────────────

/** La plata en juego de un caso: lo que falta o sobra, o el cobro entero. */
export function plataEnJuego(c: CasoConciliacion): number {
  if (c.estado === 'monto_mayor' || c.estado === 'monto_menor') return Math.abs(c.diferencia)
  return Math.max(c.montoSistema, c.montoMp)
}

/** "Para revisar" va por plata (lo más grande arriba); el resto, en orden de hora. */
export function ordenarCasos(casos: CasoConciliacion[], pestana: PestanaCasos): CasoConciliacion[] {
  const copia = [...casos]
  if (pestana === 'revisar') {
    copia.sort((a, b) => plataEnJuego(b) - plataEnJuego(a) || a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
  } else {
    copia.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))
  }
  return copia
}

export function contarPorPestana(casos: CasoConciliacion[]): Record<PestanaCasos, number> {
  const n: Record<PestanaCasos, number> = { revisar: 0, confirmar: 0, pendientes: 0, cuadran: 0, revisados: 0, sin_verificar: 0, ajenos: 0 }
  for (const c of casos) n[pestanaDeCaso(c)]++
  return n
}

// ─────────────────────────────────────────────────────────────────────────────
// Opciones de los filtros
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcionesFiltro {
  sucursales: { id: string; nombre: string }[]
  aliases: string[]
  barberos: string[]
}

export function opcionesDeFiltro(casos: CasoConciliacion[], cuentas: CuentaConciliacion[]): OpcionesFiltro {
  const sucursales = new Map<string, string>()
  const aliases = new Map<string, string>()
  const barberos = new Set<string>()
  for (const cu of cuentas) {
    for (const s of cu.sucursales) sucursales.set(s.id, s.nombre)
    if (cu.alias) aliases.set(aliasNorm(cu.alias), cu.alias)
  }
  for (const c of casos) {
    if (c.alias && !aliases.has(aliasNorm(c.alias))) aliases.set(aliasNorm(c.alias), c.alias)
    for (const e of c.esperados) {
      if (e.sucursalId && e.sucursal && !sucursales.has(e.sucursalId)) sucursales.set(e.sucursalId, e.sucursal)
      if (e.barbero) barberos.add(e.barbero)
    }
  }
  const porTexto = (a: string, b: string) => a.localeCompare(b, 'es')
  return {
    sucursales: [...sucursales.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => porTexto(a.nombre, b.nombre)),
    aliases: [...aliases.values()].sort(porTexto),
    barberos: [...barberos].sort(porTexto),
  }
}

/** id de sucursal → nombre, para mostrar y exportar. */
export function nombresDeSucursal(casos: CasoConciliacion[], cuentas: CuentaConciliacion[]): Map<string, string> {
  return new Map(opcionesDeFiltro(casos, cuentas).sucursales.map((s) => [s.id, s.nombre]))
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuentas
// ─────────────────────────────────────────────────────────────────────────────

export function estaConectada(c: CuentaConciliacion): boolean {
  return c.cuentaMpId != null && c.estado !== 'sin_conectar' && c.estado !== 'banco' && c.estado !== 'sin_alias'
}

export function tieneError(c: CuentaConciliacion): boolean {
  return c.estado === 'error' || c.estado === 'revocada'
}

export function faltaConfirmar(c: CuentaConciliacion): boolean {
  return estaConectada(c) && !c.confirmada
}

/** Una lectura de Mercado Pago que falló desde ESTA pantalla (la lectura automática o "Sincronizar"). */
export interface ErrorDeLectura {
  cuentaMpId: string
  alias: string | null
  error: string
  /** Cuándo falló (ms, reloj del navegador). */
  en: number
}

/** Lo que muestra la banda roja: una cuenta que no se pudo leer y por qué. */
export interface CuentaConError {
  id: string
  alias: string | null
  detalle: string
}

/**
 * Un error de lectura de esta pantalla deja de valer cuando el servidor ya
 * muestra una lectura completa POSTERIOR de esa cuenta (el cron o otra pestaña
 * la leyó bien). Si no, la banda roja quedaba fija toda la sesión: un 429 al
 * abrir y el cron que la lee bien cinco minutos después.
 *
 * Tampoco vale si el servidor ya la muestra desconectada (o de banco): no hay
 * lectura que reintentar. Pasa al desconectar una cuenta que estaba «en cola»
 * en la lectura en curso: su turno terminaba en «La cuenta no está conectada.»
 * y la banda roja la anunciaba como una cuenta que no se pudo leer.
 */
export function errorDeLecturaResuelto(e: Pick<ErrorDeLectura, 'cuentaMpId' | 'en'>, cuentas: CuentaConciliacion[]): boolean {
  const c = cuentas.find((x) => x.cuentaMpId === e.cuentaMpId)
  if (!c) return false
  if (!estaConectada(c) && !tieneError(c)) return true
  if (tieneError(c) || !c.ultimaSync) return false
  const t = Date.parse(c.ultimaSync)
  return Number.isFinite(t) && t > e.en
}

/**
 * Las cuentas que no se pudieron leer: las que el servidor da con error o sin
 * permiso, y las que fallaron desde esta pantalla y todavía no se volvieron a
 * leer bien. Sólo las cuentas que están en pantalla (las de la sucursal elegida).
 */
export function cuentasConError(cuentas: CuentaConciliacion[], errores: ErrorDeLectura[]): CuentaConError[] {
  const m = new Map<string, CuentaConError>()
  for (const c of cuentas) {
    if (tieneError(c)) m.set(c.cuentaMpId ?? c.id, { id: c.cuentaMpId ?? c.id, alias: c.alias, detalle: c.detalleEstado })
  }
  for (const e of errores) {
    const c = cuentas.find((x) => x.cuentaMpId === e.cuentaMpId)
    // Si el servidor ya la da con error, manda su detalle ("El titular quitó el permiso").
    if (!c || m.has(e.cuentaMpId) || errorDeLecturaResuelto(e, cuentas)) continue
    m.set(e.cuentaMpId, { id: e.cuentaMpId, alias: e.alias ?? c.alias, detalle: e.error })
  }
  return [...m.values()]
}

function rangoCuenta(c: CuentaConciliacion): number {
  if (tieneError(c)) return 0
  if (faltaConfirmar(c)) return 1
  if (c.estado === 'sin_conectar') return 2
  if (c.estado === 'atrasada') return 3
  if (c.estado === 'al_dia') return 4
  if (c.estado === 'banco') return 5
  return 6
}

/** Error, sin confirmar, sin conectar (por % de plata), atrasadas, al día; después banco y sin alias. */
export function ordenarCuentas(cuentas: CuentaConciliacion[]): CuentaConciliacion[] {
  return [...cuentas].sort(
    (a, b) =>
      rangoCuenta(a) - rangoCuenta(b) ||
      b.pctPlata30d - a.pctPlata30d ||
      b.periodo.montoSistema - a.periodo.montoSistema ||
      (a.alias ?? '').localeCompare(b.alias ?? '', 'es'),
  )
}

export interface ResumenCuentas {
  total: number
  conectables: number
  conectadas: number
  conError: number
  sinConfirmar: number
  sinConectar: number
  banco: number
  ningunaConectada: boolean
  /** Todas las que se pueden conectar están al día y confirmadas: la sección arranca plegada. */
  todasAlDia: boolean
}

export function resumenCuentas(cuentas: CuentaConciliacion[]): ResumenCuentas {
  const conectables = cuentas.filter((c) => c.estado !== 'banco' && c.estado !== 'sin_alias')
  const conectadas = cuentas.filter(estaConectada)
  return {
    total: cuentas.length,
    conectables: conectables.length,
    conectadas: conectadas.length,
    conError: cuentas.filter(tieneError).length,
    sinConfirmar: cuentas.filter(faltaConfirmar).length,
    sinConectar: cuentas.filter((c) => c.estado === 'sin_conectar').length,
    banco: cuentas.filter((c) => c.estado === 'banco').length,
    ningunaConectada: cuentas.length > 0 && conectadas.length === 0,
    todasAlDia: conectables.length > 0 && conectables.every((c) => c.estado === 'al_dia' && c.confirmada),
  }
}

/** Una cuenta conectada con la última lectura completa más vieja que esto está "Atrasada" (el mismo umbral que lib/conciliacion-mp/cuentas.ts). */
export const ATRASO_CUENTA_MS = 30 * 60_000

/** "Leída hace 8 min" / "Leída hace 2 h" / "Leída hace menos de 1 min" / "Leída recién" (el principio del detalle de una cuenta leída). */
const RE_LEIDA_HACE = /^Leída (?:recién|hace menos de 1 min|hace \d+ (?:min|h|días))/

/**
 * El estado de una tarjeta contado con la hora de AHORA. "Leída hace 8 min" lo
 * escribe el servidor cuando calcula: con la pantalla abierta una hora, la
 * tarjeta seguiría diciendo "Al día · Leída hace 8 min". Con `ahoraMs` (el reloj
 * de la pantalla) se recuenta; sin él (en el servidor y mientras hidrata) va lo
 * que mandó el servidor, tal cual.
 */
export function estadoVivoDeCuenta(
  c: Pick<CuentaConciliacion, 'estado' | 'detalleEstado' | 'sincronizadaHasta'>,
  ahoraMs: number | null,
): { estado: EstadoCuenta; detalle: string } {
  const servidor = { estado: c.estado, detalle: c.detalleEstado }
  if (ahoraMs == null || (c.estado !== 'al_dia' && c.estado !== 'atrasada') || !c.sincronizadaHasta) return servidor
  const t = Date.parse(c.sincronizadaHasta)
  // Sólo se recuenta el "Leída hace N min" del principio; lo que siga (un aviso: "· hay que volver a
  // autorizarla antes del 24/11") queda. Si el texto no empieza así, va el del servidor tal cual.
  const prefijo = RE_LEIDA_HACE.exec(c.detalleEstado)
  if (!Number.isFinite(t) || !prefijo) return servidor
  return {
    estado: ahoraMs - t > ATRASO_CUENTA_MS ? 'atrasada' : 'al_dia',
    detalle: `Leída ${haceCuanto(c.sincronizadaHasta, ahoraMs)}${c.detalleEstado.slice(prefijo[0].length)}`,
  }
}

/**
 * La lectura completa MÁS VIEJA de las cuentas conectadas (o con error) de la
 * pantalla, TENGAN O NO cobros en el período: la misma regla que la frescura
 * del motor, que mira todas las cuentas del alcance (`cuentasDelAlcance` en
 * `resumir`). Saltear las que no tienen cobros hacía que, al hidratar, "leído
 * hace 6 h" pasara a "leído hace 6 min": más fresco que lo que se leyó de
 * verdad. null si no hay ninguna.
 */
export function lecturaMasVieja(cuentas: CuentaConciliacion[]): string | null {
  let masVieja: { iso: string; t: number } | null = null
  for (const c of cuentas) {
    if (!c.cuentaMpId || !c.sincronizadaHasta) continue
    if (c.estado !== 'al_dia' && c.estado !== 'atrasada' && c.estado !== 'error') continue
    const t = Date.parse(c.sincronizadaHasta)
    if (Number.isFinite(t) && (masVieja === null || t < masVieja.t)) masVieja = { iso: c.sincronizadaHasta, t }
  }
  return masVieja?.iso ?? null
}

/**
 * "Mercado Pago leído hace 47 min", contado con el reloj de la pantalla. El
 * motor lo manda armado con SU hora (la de cuando calculó), y mostrado tal cual
 * quedaba diciendo "hace 6 min" para siempre. Sin reloj (servidor, hidratación)
 * va el texto del servidor.
 */
export function textoFrescura(r: Pick<ResultadoConciliacion, 'cuentas' | 'cobertura'>, ahoraMs: number | null): string | null {
  if (ahoraMs == null) return r.cobertura.frescura
  const iso = lecturaMasVieja(r.cuentas)
  return iso ? `Mercado Pago leído ${haceCuanto(iso, ahoraMs)}` : r.cobertura.frescura
}

/** "Cuentas: 14 de 16 conectadas · 1 con error" */
export function lineaCuentas(r: ResumenCuentas): string {
  const partes = [`Cuentas: ${r.conectadas} de ${r.conectables} conectadas`]
  if (r.conError) partes.push(`${r.conError} con error`)
  if (r.sinConfirmar) partes.push(`${r.sinConfirmar} sin confirmar`)
  return partes.join(' · ')
}

/**
 * El estado vacío ("nada conectado") arranca por las cuentas por donde entra más
 * plata: las primeras hasta juntar ~60 % de lo transferido en 30 días (máx. 5).
 */
export function cuentasPrioritarias(cuentas: CuentaConciliacion[]): {
  elegidas: CuentaConciliacion[]
  pct: number
  resto: CuentaConciliacion[]
} {
  const candidatas = cuentas
    .filter((c) => c.estado === 'sin_conectar')
    .sort((a, b) => b.pctPlata30d - a.pctPlata30d || (a.alias ?? '').localeCompare(b.alias ?? '', 'es'))
  const elegidas: CuentaConciliacion[] = []
  let acumulado = 0
  for (const c of candidatas) {
    elegidas.push(c)
    acumulado += c.pctPlata30d
    if (acumulado >= 60 || elegidas.length >= 5) break
  }
  if (acumulado <= 0) {
    const primeras = candidatas.slice(0, 4)
    return { elegidas: primeras, pct: 0, resto: candidatas.slice(primeras.length) }
  }
  return { elegidas, pct: Math.round(acumulado), resto: candidatas.slice(elegidas.length) }
}

export type TipoSegmento = 'conectada' | 'error' | 'sin_conectar'

export interface SegmentoCobertura {
  id: string
  alias: string
  peso: number
  tipo: TipoSegmento
}

/**
 * Un segmento por cuenta con cobros en el período, del ancho de su plata:
 * lleno = conectada, rojo = con error, rayado = sin conectar (o de banco).
 */
export function segmentosCobertura(cuentas: CuentaConciliacion[]): SegmentoCobertura[] {
  const orden: Record<TipoSegmento, number> = { conectada: 0, error: 1, sin_conectar: 2 }
  return cuentas
    .filter((c) => c.periodo.cobros > 0 || c.periodo.montoSistema > 0)
    .map((c): SegmentoCobertura => ({
      id: c.id,
      alias: c.alias ?? 'Sin alias',
      peso: Math.max(c.periodo.montoSistema, 1),
      tipo: tieneError(c) ? 'error' : estaConectada(c) ? 'conectada' : 'sin_conectar',
    }))
    .sort((a, b) => orden[a.tipo] - orden[b.tipo] || b.peso - a.peso)
}

// ─────────────────────────────────────────────────────────────────────────────
// Balanza
// ─────────────────────────────────────────────────────────────────────────────

export interface Balanza {
  sistema: number
  mp: number
  /** Los tramos de la barra de Mercado Pago, en % de la escala común. */
  tramos: { tipo: 'base' | 'confirmar' | 'sobra' | 'falta' | 'sin_verificar'; valor: number; pct: number }[]
  pctSistema: number
}

/**
 * Las dos barras con la misma escala. La de Mercado Pago muestra lo que entró
 * (lo que además SOBRA, en ámbar lleno) y, a continuación, lo que FALTA
 * (rayado ámbar) y lo que no se pudo verificar (rayado gris). Faltante y
 * sobrante van en tramos distintos: nunca se netean. De lo que entró, lo que
 * cuadra sólo por un emparejamiento dudoso va aparte ("Para confirmar"): está
 * en Mercado Pago, pero no prueba que sea la plata de esos cobros.
 */
export function balanza(r: Pick<ResultadoConciliacion, 'totales' | 'veredicto'>): Balanza {
  const S = Math.max(0, r.totales.montoSistema)
  const M = Math.max(0, r.totales.montoMp)
  const O = Math.max(0, r.veredicto.sobrante)
  const F = Math.max(0, r.veredicto.faltante)
  const U = Math.max(0, r.totales.montoSinVerificar)
  const entro = Math.max(0, M - O)
  const C = Math.min(Math.max(0, r.totales.montoParaConfirmar ?? 0), entro)
  const escala = Math.max(S, entro + O + F + U, 1)
  const tramos: Balanza['tramos'] = []
  const poner = (tipo: Balanza['tramos'][number]['tipo'], valor: number) => {
    if (valor > 0) tramos.push({ tipo, valor, pct: (valor / escala) * 100 })
  }
  poner('base', entro - C)
  poner('confirmar', C)
  poner('sobra', Math.min(O, M))
  poner('falta', F)
  poner('sin_verificar', U)
  return { sistema: S, mp: M, tramos, pctSistema: (S / escala) * 100 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrativa: cada cifra filtra la lista
// ─────────────────────────────────────────────────────────────────────────────

export interface FiltroDeNarrativa {
  pestana: PestanaCasos
  estado: EstadoCaso | null
  alias: string | null
}

export type TokenNarrativa = { tipo: 'texto'; texto: string } | { tipo: 'cifra'; texto: string }

function escaparRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Qué lista abre una frase de la narrativa del motor (`narrar()` en
 * lib/conciliacion-mp/narrativa.ts). El orden importa: va de lo más específico a
 * lo más general, porque varias plantillas comparten palabras ("Todavía no leí
 * … N cobros esperan" es sin verificar; "… esperan que se registre el cobro" es
 * pendiente; "Cuadra, salvo N para confirmar" no es "cuadran").
 */
export function filtroDeFrase(frase: string, aliases: string[]): FiltroDeNarrativa {
  const f = normalizar(frase)
  let pestana: PestanaCasos = 'revisar'
  let estado: EstadoCaso | null = null
  // Emparejamientos dudosos: van antes que "cuadra" (el titular puede empezar con "Cuadra, salvo…").
  if (['emparejamiento', 'hay que confirmar', 'falta confirmar', 'para confirmar'].some((x) => f.includes(x))) pestana = 'confirmar'
  // Una cuenta conectada que no se pudo leer: sus cobros quedan sin verificar.
  else if (f.includes('no pude leer') || f.includes('no pudimos leer')) pestana = 'sin_verificar'
  else if (f.includes('no estan en mercado pago') || f.includes('no esta en mercado pago')) estado = 'solo_sistema'
  // Un crédito de hace minutos sin cobro: espera que el barbero cierre el cobro (pendiente, no "sobra").
  else if (f.includes('que se registre') || f.includes('esperando el cobro') || f.includes('esperan el cobro')) pestana = 'pendientes'
  else if (f.includes('sin cobro registrado')) estado = 'solo_mp'
  else if (f.includes('otra cuenta')) estado = 'otra_cuenta'
  else if (f.includes('de mas')) estado = 'monto_mayor'
  // "entró con $2.000 menos que el cobro" y "entraron con menos plata": no dicen "de menos".
  else if (f.includes('menos')) estado = 'monto_menor'
  // "Todavía no leí Mercado Pago para esas fechas" / "…no se leyó para esas fechas": cobros sin verificar, no pendientes.
  else if (['cuenta de banco', 'cuentas de banco', 'todavia no lei', 'para esas fechas'].some((x) => f.includes(x))) pestana = 'sin_verificar'
  else if (f.includes('todavia no se leyo') || f.includes('esperando')) pestana = 'pendientes'
  else if (f.includes('revisados a mano') || f.includes('revisado a mano')) pestana = 'revisados'
  else if (f.includes('cuadro todo') || f.startsWith('cuadra')) pestana = 'cuadran'
  else if (f.includes('conectar') || f.includes('verificar')) pestana = 'sin_verificar'
  const encontrados = new Set<string>()
  for (const a of aliases) {
    if (a && new RegExp(`(^|[^\\w.])${escaparRegExp(a)}($|[^\\w.])`, 'i').test(frase)) encontrados.add(a)
  }
  // Una frase que nombra dos cuentas ("Faltan conectar A y B") no filtra por una.
  const alias = encontrados.size === 1 ? [...encontrados][0] : null
  return { pestana, estado, alias }
}

/**
 * Parte una frase en texto y "cifras" (montos, "3 cobros", alias) para que
 * cada cifra sea un botón que filtra la lista.
 */
export function tokensNarrativa(frase: string, aliases: string[]): TokenNarrativa[] {
  const conocidos = [...new Set(aliases.filter(Boolean))].sort((a, b) => b.length - a.length).map(escaparRegExp)
  const patrones = [
    String.raw`\$\s?\d{1,3}(?:\.\d{3})*`,
    String.raw`\b\d+\s+(?:cobros?|transferencias?|cuentas?|emparejamientos?)\b`,
    ...conocidos,
  ]
  const re = new RegExp(patrones.join('|'), 'gi')
  const tokens: TokenNarrativa[] = []
  let desde = 0
  for (const m of frase.matchAll(re)) {
    const i = m.index ?? 0
    if (i > desde) tokens.push({ tipo: 'texto', texto: frase.slice(desde, i) })
    tokens.push({ tipo: 'cifra', texto: m[0] })
    desde = i + m[0].length
  }
  if (desde < frase.length) tokens.push({ tipo: 'texto', texto: frase.slice(desde) })
  return tokens
}

/** Parte un titular ("Faltan $26.000 y sobran $18.000.") en texto y montos, para contarlos. */
export function partesConMontos(texto: string): ({ tipo: 'texto'; texto: string } | { tipo: 'monto'; valor: number })[] {
  const partes: ({ tipo: 'texto'; texto: string } | { tipo: 'monto'; valor: number })[] = []
  let desde = 0
  for (const m of texto.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})*)/g)) {
    const i = m.index ?? 0
    if (i > desde) partes.push({ tipo: 'texto', texto: texto.slice(desde, i) })
    partes.push({ tipo: 'monto', valor: Number(m[1].replace(/\./g, '')) })
    desde = i + m[0].length
  }
  if (desde < texto.length) partes.push({ tipo: 'texto', texto: texto.slice(desde) })
  return partes
}

// ─────────────────────────────────────────────────────────────────────────────
// Un caso
// ─────────────────────────────────────────────────────────────────────────────

export function transferLogIdsDe(c: CasoConciliacion): string[] {
  return c.esperados.map((e) => e.transferLogId).filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/** Esperados sin transfer_log (transferencia sin cuenta, propina suelta): se revisan por su clave. */
export function clavesSinTransferLog(c: CasoConciliacion): string[] {
  return c.esperados.filter((e) => !e.transferLogId).map((e) => e.clave)
}

/** El pedido de "Marcar revisado" para un caso. */
export function pedidoRevisado(c: CasoConciliacion, motivo: MotivoRevision, nota: string) {
  const transferLogIds = transferLogIdsDe(c)
  const clavesEsperado = clavesSinTransferLog(c)
  const notaLimpia = nota.trim()
  return {
    tipo: 'revisado' as const,
    ...(transferLogIds.length ? { transferLogIds } : {}),
    movimientoId: c.movimiento?.id ?? null,
    ...(clavesEsperado.length ? { clavesEsperado } : {}),
    motivo,
    ...(notaLimpia ? { nota: notaLimpia } : {}),
  }
}

/** Se puede marcar revisado lo que está para revisar (los ámbar). Lo pendiente se espera, lo sin verificar se conecta. */
export function sePuedeRevisar(c: CasoConciliacion): boolean {
  return esParaRevisar(c.estado)
}

/** El signo entre las dos columnas: "=", "≈" (emparejamiento dudoso, para confirmar), "≠" o "∅". */
export function conectorDe(c: CasoConciliacion): '=' | '≈' | '≠' | '∅' {
  if (esEmparejamientoDudoso(c)) return '≈'
  if (c.estado === 'conciliado') return '='
  if (!c.movimiento || c.esperados.length === 0) return '∅'
  if (c.estado === 'otra_cuenta' || c.diferencia !== 0) return '≠'
  return '='
}

/**
 * Se puede confirmar un emparejamiento dudoso con un vínculo manual (el mismo
 * pedido que "Vincular": su movimiento y TODOS sus transfer_logs). Si algún
 * cobro del caso no tiene transfer_log no se ofrece: el vínculo quedaría a
 * medias y el cobro conjunto daría otro monto.
 */
export function sePuedeConfirmar(c: CasoConciliacion): boolean {
  return (
    esEmparejamientoDudoso(c) &&
    !c.resolucion &&
    c.movimiento != null &&
    c.esperados.length > 0 &&
    c.esperados.every((e) => typeof e.transferLogId === 'string' && e.transferLogId.length > 0)
  )
}

/** El pedido de "Confirmar" para un emparejamiento dudoso: un vínculo con su movimiento y sus cobros. */
export function pedidoConfirmar(c: CasoConciliacion): { tipo: 'vinculo'; transferLogIds: string[]; movimientoId: string } | null {
  if (!sePuedeConfirmar(c) || !c.movimiento) return null
  return { tipo: 'vinculo', transferLogIds: transferLogIdsDe(c), movimientoId: c.movimiento.id }
}

/**
 * "No es este": se ofrece en los mismos casos que "Confirmar" (un
 * emparejamiento dudoso con su crédito y TODOS sus cobros con transfer_log).
 * Guarda un rechazo por cobro: el motor no vuelve a juntar ese crédito con
 * esos cobros, y cada lado sigue su camino.
 */
export function sePuedeDescartar(c: CasoConciliacion): boolean {
  return sePuedeConfirmar(c)
}

/** El pedido de "No es este": el crédito del caso y todos sus cobros (un cobro conjunto sin marcar, entero). */
export function pedidoDescartar(c: CasoConciliacion): { movimientoId: string; transferLogIds: string[] } | null {
  if (!sePuedeDescartar(c) || !c.movimiento) return null
  return { movimientoId: c.movimiento.id, transferLogIds: transferLogIdsDe(c) }
}

/** La línea que explica "No es este", al lado del botón. */
export function textoNoEsEste(c: Pick<CasoConciliacion, 'esperados'>): string {
  return c.esperados.length > 1
    ? 'Este crédito no es de estos cobros: no los vuelvo a juntar.'
    : 'Este crédito no es de este cobro: no los vuelvo a juntar.'
}

/**
 * "Descartado a mano: crédito de $18.000 de las 10:15 en monacoparana4" (o
 * "cobro de…", visto desde el crédito). Si lo descartado es de otro día que el
 * caso, lleva la fecha: "del 20/10 a las 23:58".
 */
export function textoRechazo(r: Pick<RechazoVista, 'lado' | 'monto' | 'fecha' | 'alias'>, diaDelCaso: string | null): string {
  const que = r.lado === 'credito' ? 'crédito' : 'cobro'
  const dia = ymdAR(r.fecha)
  const cuando = dia && diaDelCaso && dia !== diaDelCaso ? `del ${diaMes(dia)} a las ${horaAR(r.fecha)}` : `de las ${horaAR(r.fecha)}`
  return `Descartado a mano: ${que} de ${plata(r.monto)} ${cuando}${r.alias ? ` en ${r.alias}` : ''}`
}

/**
 * " (salvo el crédito que se descartó a mano)": para el "busqué y no encontré"
 * del detalle. Lo descartado con "No es este" que entraba en esa búsqueda —el
 * mismo `monto` (±$1) y a ±`ventanaMs` de `iso`— estaba ahí: sin la aclaración,
 * "nada" sería mentira. Lo descartado con OTRO monto no entraba (el crédito de
 * $36.000 de un cobro conjunto sin marcar, visto desde uno de sus cobros de
 * $18.000): nombrarlo diría que había uno de ese monto. '' si no hay ninguno.
 */
export function salvoDescartados(
  c: Pick<CasoConciliacion, 'rechazados'>,
  lado: 'credito' | 'cobro',
  iso: string,
  ventanaMs: number,
  monto: number,
): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const n = (c.rechazados ?? []).filter(
    (r) => r.lado === lado && Math.abs(r.monto - monto) <= 1 && Math.abs(Date.parse(r.fecha) - t) <= ventanaMs,
  ).length
  if (!n) return ''
  const que =
    lado === 'credito'
      ? n === 1
        ? 'el crédito que se descartó'
        : 'los créditos que se descartaron'
      : n === 1
        ? 'el cobro que se descartó'
        : 'los cobros que se descartaron'
  return ` (salvo ${que} a mano)`
}

/**
 * ¿Una persona descartó juntar ese cobro con ese crédito? Lo dicen los dos
 * casos (el cobro con su 'credito' descartado, el crédito con su 'cobro'):
 * alcanza con que lo diga uno.
 */
export function parDescartado(cobro: CasoConciliacion, credito: CasoConciliacion): boolean {
  const movimientoId = credito.movimiento?.id
  if (!movimientoId) return false
  const tls = transferLogIdsDe(cobro)
  return (
    (cobro.rechazados ?? []).some((r) => r.lado === 'credito' && r.movimientoId === movimientoId) ||
    (credito.rechazados ?? []).some((r) => r.lado === 'cobro' && r.transferLogIds.some((tl) => tls.includes(tl)))
  )
}

/** Por qué un emparejamiento dudoso no cuenta como plata verificada, en palabras del dueño. */
export function textoDudoso(c: CasoConciliacion): string {
  if (c.senales.includes('grupo')) {
    return `Una transferencia de ${plata(c.montoMp)} suma justo ${c.esperados.length} cobros que nadie marcó como cobro conjunto. Puede ser casualidad: hasta que alguien lo confirme no cuenta como plata verificada.`
  }
  return 'Coincide el monto, pero con mucha diferencia de hora y sin otra prueba. Con tantos cobros del mismo monto puede ser otra transferencia: hasta que alguien lo confirme no cuenta como plata verificada.'
}

/**
 * La línea de la confianza de un cruce, debajo de las señales. El motor pone
 * confianza 'media' por motivos distintos, y "la plata cuadra igual" sólo es
 * cierto en uno: dos créditos gemelos (mismo monto, a menos de 3 min) en la
 * misma cuenta (P2 del motor), donde cambia a qué visita se atribuye pero la
 * plata está. Con un monto distinto (P3c), otra cuenta (P3d) o un cobro sin
 * cuenta (P3e) esa frase sería falsa: ahí lo dice la explicación del caso y no
 * se agrega nada. Lo dudoso lo explica su propio recuadro.
 */
export function textoConfianza(c: CasoConciliacion): string | null {
  if (c.confianza !== 'media' || c.estado !== 'conciliado' || esEmparejamientoDudoso(c)) return null
  if (c.senales.includes('manual') || c.senales.includes('grupo') || !c.senales.includes('mismo_monto')) return null
  // P3e (transferencia sin cuenta, propina suelta) también da 'media' con mismo monto: no es un gemelo.
  if (c.esperados.length === 0 || c.esperados.some((e) => e.tipo !== 'cobro')) return null
  return 'Hay otro movimiento igual a menos de 3 min: la plata cuadra igual.'
}

/** El monto grande del detalle: la diferencia si es "de más/de menos"; si no, el cobro. */
export function montoDelCaso(c: CasoConciliacion): string {
  if (c.estado === 'monto_mayor' || c.estado === 'monto_menor') {
    const d = Math.round(c.diferencia)
    return `${d > 0 ? '+' : '−'}${plata(Math.abs(d))}`
  }
  return plata(Math.max(c.montoSistema, c.montoMp))
}

/**
 * Para un movimiento que "no está en el sistema": cobros del sistema sin
 * pareja, del mismo monto y a menos de 2 h, para vincularlo a mano. El motor
 * devuelve candidatos sólo del lado de Mercado Pago (movimientos); éstos los
 * arma la pantalla con lo que ya tiene cargado. Un cobro que una persona ya
 * descartó para este crédito ("No es este") no se vuelve a sugerir.
 */
export function candidatosDelSistema(
  caso: CasoConciliacion,
  casos: CasoConciliacion[],
): { caso: CasoConciliacion; motivo: string; minutos: number }[] {
  if (caso.estado !== 'solo_mp' || !caso.movimiento) return []
  const tMov = Date.parse(caso.movimiento.fecha)
  if (!Number.isFinite(tMov)) return []
  return casos
    .filter((c) => c.id !== caso.id && c.estado === 'solo_sistema' && transferLogIdsDe(c).length > 0)
    .filter((c) => Math.abs(c.montoSistema - caso.montoMp) <= 1)
    .filter((c) => !parDescartado(c, caso))
    .map((c) => {
      const t = Date.parse(c.esperados[0]?.tSistema ?? c.fecha)
      return { c, dt: (t - tMov) / 60_000 }
    })
    .filter(({ dt }) => Number.isFinite(dt) && Math.abs(dt) <= 120)
    .sort((a, b) => Math.abs(a.dt) - Math.abs(b.dt))
    .slice(0, 3)
    .map(({ c, dt }) => {
      const min = Math.round(Math.abs(dt))
      const cuando = min === 0 ? 'en el mismo minuto' : `${min} min ${dt > 0 ? 'después' : 'antes'}`
      return {
        caso: c,
        minutos: min,
        motivo: `Mismo monto, cobrado ${cuando}${c.alias ? ` en ${c.alias}` : ''}`,
      }
    })
}

const PRIORIDAD_SENAL: SenalCruce[] = ['nro_operacion', 'pagador', 'hora_comprobante', 'grupo', 'manual', 'mismo_monto', 'hora']

/**
 * Las señales que respaldan un cruce, la más fuerte primero ("Nº de operación
 * igual"), y la de la hora dicha en minutos ("1 min antes").
 */
export function senalesOrdenadas(c: CasoConciliacion): { id: SenalCruce; texto: string }[] {
  return [...new Set(c.senales)]
    .sort((a, b) => PRIORIDAD_SENAL.indexOf(a) - PRIORIDAD_SENAL.indexOf(b))
    .map((s) => ({ id: s, texto: s === 'hora' ? (textoRetraso(c.retrasoSeg) ?? ETIQUETA_SENAL.hora) : ETIQUETA_SENAL[s] }))
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una celda de texto que empieza con = + - @ la toma Excel como fórmula
 * ("inyección de CSV"): un nombre de cliente así ejecutaría algo al abrir el
 * archivo. Se le antepone un apóstrofo.
 */
export function celdaSegura(v: string | number | null | undefined): string | number {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : ''
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

const ETIQUETA_MOTIVO = new Map(MOTIVOS_REVISION.map((m) => [m.id, m.etiqueta]))

export function etiquetaMotivo(m: MotivoRevision | null | undefined): string {
  return m ? (ETIQUETA_MOTIVO.get(m) ?? m) : ''
}

/**
 * El CSV de la conciliación va con ";": con la configuración regional de
 * Argentina (decimal ",") Excel separa las columnas por ";" y un archivo con
 * comas se abre todo en la columna A. Los montos van enteros y sin separador de
 * miles, así que ";" no deja nada ambiguo. Sin la línea "sep=;": hace que Excel
 * ignore el BOM y rompe los acentos.
 */
export const SEPARADOR_CSV = ';'

/**
 * El nombre del archivo sale del período de lo que SE EXPORTA (los datos en
 * pantalla), no del control: mientras carga otro período, el control ya cambió
 * y las filas todavía son las del anterior.
 */
export function nombreArchivoCSV(p: Periodo, pestana: PestanaCasos | null): string {
  const rango = p.desde === p.hasta ? p.desde : `${p.desde}_al_${p.hasta}`
  return `conciliacion-mp_${rango}${pestana ? `_${pestana}` : ''}`
}

export const ENCABEZADOS_CSV = [
  'Fecha',
  'Hora',
  'Estado',
  'Cuenta',
  'Entró en',
  'Sucursal',
  'Barbero',
  'Cliente',
  'Servicio',
  'Monto en el sistema',
  'Monto en Mercado Pago',
  'Diferencia',
  'Pagador',
  'Nº de operación del comprobante',
  'Id del pago en Mercado Pago',
  'Explicación',
  'Revisión',
]

export function filasCSV(casos: CasoConciliacion[], sucursales: Map<string, string>): (string | number)[][] {
  return casos.map((c) => {
    const unir = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].join(' + ')
    const sucursal = c.sucursalId ? (sucursales.get(c.sucursalId) ?? '') : unir(c.esperados.map((e) => e.sucursal))
    const resolucion = c.resolucion
      ? [
          c.resolucion.tipo === 'vinculo' ? 'Vinculado a mano' : etiquetaMotivo(c.resolucion.motivo),
          c.resolucion.nota,
          c.resolucion.por ? `(${c.resolucion.por})` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
    // Lo descartado con "No es este" también es una decisión de una persona: va en la misma columna.
    const descartes = (c.rechazados ?? []).map((r) => `${textoRechazo(r, ymdAR(c.fecha))}${r.por ? ` (${r.por})` : ''}`)
    const revision = [resolucion, ...descartes].filter(Boolean).join(' · ')
    return [
      fechaCompletaAR(c.fecha),
      horaAR(c.fecha),
      etiquetaDeCaso(c),
      c.alias ?? '',
      c.aliasMp ?? '',
      sucursal,
      unir(c.esperados.map((e) => e.barbero)),
      unir(c.esperados.map((e) => e.cliente)),
      unir(c.esperados.map((e) => e.servicio)),
      c.esperados.length ? c.montoSistema : '',
      c.movimiento ? c.montoMp : '',
      c.esperados.length && c.movimiento ? c.diferencia : '',
      pagadorVisible(c) ?? '',
      unir(c.esperados.map((e) => e.comprobante?.operacion)),
      c.movimiento?.mpId ?? '',
      c.explicacion,
      revision,
    ].map(celdaSegura)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Verificación de una cuenta recién conectada
// ─────────────────────────────────────────────────────────────────────────────

export interface Verificacion {
  /** 'sin_leer': hubo cobros, pero Mercado Pago todavía no se pudo leer para ninguno. 'sin_datos': no hubo cobros. */
  tipo: 'coincide' | 'parcial' | 'ninguno' | 'sin_datos' | 'sin_leer'
  encontrados: number
  total: number
  /** Cobros de esa cuenta que todavía no se pudieron cruzar (esperando a Mercado Pago o sin verificar). */
  sinLeer: number
}

/**
 * "Encontramos 41 de los 43 cobros de los últimos 7 días": de los cobros que el
 * sistema registró en ESA cuenta, cuántos aparecen en ella (cuadran o entraron
 * con otro monto). Lo revisado no cuenta. Si no aparece ninguno, probablemente
 * se autorizó otra cuenta.
 *
 * Lo pendiente y lo sin verificar se cuentan APARTE (`sinLeer`): "no se pudo
 * leer" no es "no hubo cobros" (Known Risk #15). Si la primera lectura cortó
 * (el cron tenía el candado, un 429) los cobros de la semana quedan así, y decir
 * "No hubo cobros" sería mentir.
 */
export function verificarCuenta(r: Pick<ResultadoConciliacion, 'casos'>, cuentaMpId: string): Verificacion {
  let total = 0
  let encontrados = 0
  let sinLeer = 0
  for (const c of r.casos) {
    if (c.cuentaMpId !== cuentaMpId || c.esperados.length === 0) continue
    const n = c.esperados.length
    if (c.estado === 'pendiente' || c.estado === 'sin_verificar') {
      sinLeer += n
      continue
    }
    if (c.estado === 'revisado' || c.estado === 'ajeno') continue
    total += n
    if (c.estado === 'conciliado' || c.estado === 'monto_mayor' || c.estado === 'monto_menor') encontrados += n
  }
  if (total === 0) return { tipo: sinLeer > 0 ? 'sin_leer' : 'sin_datos', encontrados, total, sinLeer }
  if (encontrados === 0) return { tipo: 'ninguno', encontrados, total, sinLeer }
  return { tipo: encontrados / total >= 0.5 ? 'coincide' : 'parcial', encontrados, total, sinLeer }
}
