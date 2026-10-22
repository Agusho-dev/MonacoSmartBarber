// =============================================================================
// src/lib/conciliacion-mp/motor.ts
// El cruce entre lo cobrado por transferencia en el sistema y lo que entró DE
// VERDAD en las cuentas de Mercado Pago. Determinístico y PURO: recibe filas y
// devuelve casos; no lee la base, no llama a nadie, no usa la hora del reloj
// (la hora "actual" llega como dato: `corte`). Se recalcula en cada carga (nada
// del cruce se guarda: sólo lo que decide una persona, ver mig 228), así una
// edición del historial de visitas se refleja sola, sin snapshots viejos que
// mientan.
//
// POR QUÉ EN ORDEN Y CON VENTANA ANGOSTA
// --------------------------------------
// El monto no es una clave: el 90 % de los cobros es de $18.000 y en ±2 h el
// 94 % tiene un gemelo de mismo monto en la misma cuenta. Lo que sí es estable
// es el retraso: MP acredita ~1 min ANTES de que el barbero confirme el cobro
// (p25–p90 exactamente +1 min), contra una separación mediana de 16,6 min entre
// cobros iguales. Por eso el emparejamiento principal es un alineamiento
// monótono de costo mínimo (programación dinámica) dentro de [−10 min, +2 min],
// y lo que no entra ahí pasa por pasadas más estrictas (sólo candidatos únicos).
// Dos cobros iguales a menos de un minuto quedan "intercambiables": la plata
// cuadra igual, cambia a qué visita se atribuye (confianza media).
//
// KNOWN RISK #15: lo que no se pudo leer NUNCA es "Cuadra". Una cuenta sin
// conectar, de banco, con error o sin leer hasta esa hora deja sus cobros en
// "sin verificar" o "pendiente", y eso bloquea el veredicto verde.
//
// Reglas de la revisión adversarial (22/10/2026) que NO hay que "simplificar":
//   - Las pasadas por unicidad (P3a–P3e) sólo miran tramos LEÍDOS enteros: un
//     cobro de los últimos 15 min de la lectura sólo lo empareja una prueba
//     (vínculo, nº de operación o el alineamiento de P2). "El único crédito
//     libre" de una ventana que no se leyó no prueba nada.
//   - Tarjeta y Point no cuadran transferencias solos: quedan como "podría ser".
//   - Lo que una persona marcó "revisado" sale del cruce automático ANTES de
//     P2 (un crédito "plata personal" no puede cuadrar otro cobro). El par que
//     se marcó junto (mismo INSERT) se vuelve a armar como UN caso. Una
//     revisión cubre sólo lo que la persona vio: un caso con una parte que
//     nadie revisó queda para revisar, y si el crédito del par se devolvió la
//     revisión deja de tapar a su cobro.
//   - Un crédito sin cobro de hace menos de 15 min es 'pendiente' (el barbero
//     puede estar cerrando el cobro en la tablet), no "sobra".
//   - Un emparejamiento dudoso (`esEmparejamientoDudoso`) no es plata
//     verificada y no deja pintar "Cuadra" hasta que alguien lo confirme.
//   - Un par que una persona descartó con "No es este" (`rechazos`, mig 230)
//     es inviable en TODAS las pasadas que forman pares (P1 incluida: es la
//     palabra de una persona contra un número leído), en las reservas de P4 y
//     en los "podría ser". Cada lado sigue su camino: otro emparejamiento o
//     "falta"/"sobra" a la vista. Sólo un vínculo a mano (P0) manda sobre él.
//
// Sin alias `@/` ni `server-only`: se prueba con `node` (scratchpad/tests).
// =============================================================================

import type {
  CandidatoCruce,
  CasoConciliacion,
  ComprobanteEvidencia,
  Confianza,
  EsperadoMP,
  EstadoCaso,
  MotivoRevision,
  MovimientoMP,
  RechazoVista,
  ResolucionVista,
  ResumenDia,
  SenalCruce,
  TipoEsperado,
  TotalesConciliacion,
  Veredicto,
} from './contrato'
import {
  CONCILIACION,
  ESTADOS_PARA_REVISAR,
  ETIQUETA_ESTADO,
  MOTIVOS_REVISION,
  TONO_DE_ESTADO,
  esEmparejamientoDudoso,
} from './contrato'
import {
  describirPeriodo,
  diaAR,
  diaMes,
  haceCuanto,
  hhmmAR,
  minutosDelDiaAR,
  periodoDeDias,
  plata,
  type DescripcionPeriodo,
} from './fechas'

// ─────────────────────────────────────────────────────────────────────────────
// Entrada
// ─────────────────────────────────────────────────────────────────────────────

export interface CuentaMpMotor {
  id: string
  /** Alias principal (el de la cuenta de cobro vinculada). */
  alias: string | null
  /** conectada | error | revocada | desconectada */
  status: string
  lastError: string | null
  /** ISO: desde dónde la lectura está completa (antes: sin fuente). */
  sincronizadaDesde: string | null
  /** ISO: hasta dónde la lectura está completa (después: pendiente). */
  sincronizadaHasta: string | null
}

export interface CuentaCobroMotor {
  id: string
  alias: string | null
  sucursalId: string
  cuentaMpId: string | null
  /** fuente_conciliacion = 'banco': no tiene API. */
  banco: boolean
  activa: boolean
}

export interface MovimientoMotor extends MovimientoMP {
  status: string
}

export interface ResolucionMotor {
  id: string
  tipo: 'vinculo' | 'revisado'
  movimientoId: string | null
  transferLogId: string | null
  claveEsperado: string | null
  motivo: MotivoRevision | null
  nota: string | null
  por: string | null
  /** ISO */
  en: string
  /**
   * `created_by` (quién la cargó). Las filas de un mismo "Marcar revisado"
   * salen del MISMO insert: comparten `en` (now() es la hora de la
   * transacción) y autor. Ese lote es lo que se marcó junto.
   */
  autor?: string | null
}

/**
 * Un par (cobro, crédito) que una persona descartó con "No es este" (mig
 * 230): el motor no los vuelve a juntar. Los lectores traen sólo los activos;
 * uno con `deshechoAt` igual no tiene efecto.
 */
export interface RechazoMotor {
  id: string
  transferLogId: string
  movimientoId: string
  /** created_by_nombre */
  por?: string | null
  /** ISO: cuándo se descartó. */
  en?: string | null
  /** ISO: cuándo se deshizo. Un rechazo deshecho no existe para el motor. */
  deshechoAt?: string | null
}

export interface EntradaMotor {
  /** ISO, inicio del período (inclusive). */
  desde: string
  /** ISO, fin del período (exclusivo). */
  hasta: string
  esperados: EsperadoMP[]
  /** Del período ±2 h (más los vinculados a mano fuera de esa ventana). */
  movimientos: MovimientoMotor[]
  cuentasMp: CuentaMpMotor[]
  cuentasCobro: CuentaCobroMotor[]
  /** Activas (deshecho_at is null). */
  resoluciones: ResolucionMotor[]
  /** Los pares descartados a mano ("No es este"), activos. Sin esto, no hay ninguno. */
  rechazos?: RechazoMotor[]
  /**
   * ISO: cuándo se leyeron los cobros del sistema (la hora actual). Un
   * crédito sin cobro que entró después de `corte − 15 min` queda 'pendiente':
   * MP acredita ~1 min ANTES de que se registre el cobro, y el barbero puede
   * estar cerrándolo en la tablet. Sin corte, esa regla no se aplica.
   */
  corte?: string
}

/** Por qué un cobro no se puede verificar (o todavía no). */
export type MotivoNoVerificable =
  | 'sin_conectar'
  | 'desconectada'
  | 'banco'
  | 'sin_lectura'
  | 'fuera_de_lectura'
  | 'error_lectura'
  | 'sin_cuenta_sucursal'

export interface NotaCobertura {
  /**
   * 'pendiente': Mercado Pago todavía no se leyó hasta esa hora.
   * 'esperando_cobro': un crédito que acaba de entrar y todavía no tiene su
   * cobro registrado (sólo en casos sin `esperados`).
   */
  motivo: MotivoNoVerificable | 'pendiente' | 'esperando_cobro'
  cuentaMpId: string | null
}

export interface ResultadoMotor {
  /** Todos los casos, incluidos los 'ajeno' (con el pagador ya borrado). */
  casos: CasoConciliacion[]
  /** Por id de caso: por qué quedó sin verificar o pendiente. */
  cobertura: Record<string, NotaCobertura>
}

// ─────────────────────────────────────────────────────────────────────────────
// Parámetros (los tiempos salen del contrato; acá sólo los derivados)
// ─────────────────────────────────────────────────────────────────────────────

const SEG = 1000
const MIN = 60 * SEG

const V_ANTES = CONCILIACION.ventanaAntesSeg * SEG
const V_DESPUES = CONCILIACION.ventanaDespuesSeg * SEG
const RETRASO_SEG = CONCILIACION.retrasoTipicoSeg
const AMPLIA_ANTES = CONCILIACION.ventanaAmpliaAntesSeg * SEG
const AMPLIA_DESPUES = CONCILIACION.ventanaAmpliaDespuesSeg * SEG
const GRUPO_ANTES = 5 * MIN
const GRUPO_DESPUES = CONCILIACION.grupoVentanaSeg * SEG
const MARGEN_PENDIENTE = CONCILIACION.margenPendienteSeg * SEG
/** La lectura tiene que empezar al menos 10 min antes del cobro para poder buscarlo. */
const COBERTURA_ANTES = 10 * MIN
/** …y, si la cuenta está caída, haber llegado 2 min después. */
const COBERTURA_DESPUES = 2 * MIN
/** Penalidad (en segundos) por dejar un cobro o un movimiento sin pareja en el alineamiento. */
const PENALIDAD_SEG = 900
/** Bonificación (segundos) por cada señal de identidad. */
const BONO_SEG = 60
/** Sin elementos durante más de esto, el alineamiento se corta en tramos (ningún par factible lo cruza). */
const HUECO_TRAMO = 12 * MIN
/** Otro movimiento igual a menos de esto: intercambiables. */
const GEMELO = 3 * MIN
/** Candidatos de "podría ser" a ±2 h. */
const VENTANA_CANDIDATOS = 120 * MIN
const TOLERANCIA_MONTO = 1
const MAX_CANDIDATOS = 3
/** Combinatoria acotada del cobro conjunto: los 12 cobros más cercanos alcanzan. */
const GRUPO_MAX_CANDIDATAS = 12

const TIPOS_NUNCA_COBRO = new Set(['rendimiento', 'devolucion'])
const TIPOS_PARECEN_COBRO = new Set(['transferencia', 'qr', 'link', 'otro'])
const TIPOS_TARJETA = new Set(['tarjeta', 'point'])

/**
 * Cobros "de borde" de una cuenta vinculada: su hora cae en un tramo que la
 * cuenta no cubre del todo (se cayó, se desconectó, o la lectura empezó
 * después). Lo que SÍ se leyó alcanza para probar que la plata entró: entran
 * al alineamiento de P2 y, si su crédito aparece, cuadran. Si no aparece,
 * siguen sin verificar (nunca "falta"). A las pasadas por unicidad no entran.
 */
const MOTIVOS_DE_BORDE = new Set<MotivoNoVerificable>(['error_lectura', 'desconectada', 'fuera_de_lectura', 'sin_lectura'])

const ESTADOS_REVISAR = new Set<EstadoCaso>(ESTADOS_PARA_REVISAR)

// ─────────────────────────────────────────────────────────────────────────────
// Estructuras internas
// ─────────────────────────────────────────────────────────────────────────────

interface Unidad {
  key: string
  esperados: EsperadoMP[]
  monto: number
  t: number
  fechaIso: string
  tipo: TipoEsperado
  cuentaMpId: string | null
  paymentAccountId: string | null
  alias: string | null
  sucursalId: string | null
  comprobante: ComprobanteEvidencia | null
  tlIds: string[]
  libre: boolean
  noVerificable: MotivoNoVerificable | null
  /**
   * Los créditos (ids de movimiento) que una persona descartó para alguno de
   * sus cobros: con ésos la unidad no se empareja sola. null si no hay ninguno
   * (el caso de siempre: chequearlo cuesta una comparación).
   */
  rechazados: Set<string> | null
}

interface Mov {
  m: MovimientoMotor
  t: number
  montoKey: number
  libre: boolean
  /** Aprobado, con plata (neto > 0) y puede ser un cobro (no es rendimiento ni devolución). */
  elegible: boolean
  /** Elegible y NO es tarjeta ni Point: lo único que las pasadas automáticas emparejan con una transferencia. */
  emparejable: boolean
}

interface Indices {
  mp: Map<string, CuentaMpMotor>
  cobro: Map<string, CuentaCobroMotor>
  cobroPorSucursal: Map<string, CuentaCobroMotor[]>
  /** Sucursales de las cuentas de cobro vinculadas a cada cuenta de MP. */
  sucursalesDeMp: Map<string, Set<string>>
  /** Cuentas de MP cuyas cuentas de cobro vinculadas son TODAS de banco: no se leen (sus créditos no cuentan). */
  mpSoloBanco: Set<string>
}

/** Las filas 'revisado' de un mismo "Marcar revisado" (un insert). */
interface LoteRevision {
  filas: ResolucionMotor[]
  tls: Set<string>
  claves: Set<string>
  movs: Set<string>
  en: string
}

const ms = (iso: string): number => new Date(iso).getTime()

/**
 * ¿Es plata que entró y se quedó? Aprobado y con neto > 0: una devolución
 * parcial que se llevó todo (neto 0) es lo mismo que un 'refunded'.
 */
function esPlataRecibida(m: MovimientoMotor): boolean {
  return m.status === 'approved' && m.monto > 0
}

function agregar<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}

function montoKey(n: number): number {
  return Math.round(n)
}

function iguales(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA_MONTO
}

function aliasDe(idx: Indices, cuentaMpId: string | null | undefined): string | null {
  return cuentaMpId ? (idx.mp.get(cuentaMpId)?.alias ?? null) : null
}

function minutos(msAbs: number): number {
  return Math.max(1, Math.round(Math.abs(msAbs) / MIN))
}

function etiquetaMotivo(m: MotivoRevision | null): string {
  return MOTIVOS_REVISION.find((x) => x.id === m)?.etiqueta ?? 'Revisado'
}

function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const PALABRAS_VACIAS = new Set([
  'mercado', 'pago', 'pagos', 'transferencia', 'banco', 'cuenta', 'sociedad', 'anonima', 'responsabilidad',
  'limitada', 'srl', 'sas', 'saic', 'para', 'desde',
])

function tokensNombre(s: string | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!s) return out
  for (const t of normalizarTexto(s).split(/[^a-z]+/)) {
    if (t.length >= 4 && !PALABRAS_VACIAS.has(t)) out.add(t)
  }
  return out
}

/** ¿El remitente del comprobante y el pagador de MP comparten un nombre o apellido (≥ 4 letras)? */
export function pagadorCoincide(remitente: string | null | undefined, pagador: string | null | undefined): boolean {
  const a = tokensNombre(remitente)
  if (!a.size) return false
  for (const t of tokensNombre(pagador)) if (a.has(t)) return true
  return false
}

/** ¿La hora leída del comprobante coincide (±2 min) con la de MP? Tolera el corrimiento AM/PM de 12 h. */
export function horaComprobanteCoincide(hhmm: string | null | undefined, tMp: number): boolean {
  if (!hhmm) return false
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return false
  const comp = Number(m[1]) * 60 + Number(m[2])
  if (!Number.isFinite(comp)) return false
  const mp = minutosDelDiaAR(tMp)
  const bruto = Math.abs(comp - mp) % 1440
  const dist = Math.min(bruto, 1440 - bruto)
  return dist <= 2 || Math.abs(dist - 720) <= 2
}

/** Nº de operación del comprobante con forma de id de pago (10 a 14 dígitos), o null. */
export function operacionComoId(op: string | null | undefined): string | null {
  if (!op) return null
  const limpio = op.replace(/[\s.\-_/]/g, '')
  return /^\d{10,14}$/.test(limpio) ? limpio : null
}

function primerNombre(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim().split(/\s+/)[0]
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : null
}

// ─────────────────────────────────────────────────────────────────────────────
// El motor
// ─────────────────────────────────────────────────────────────────────────────

export function conciliar(entrada: EntradaMotor): ResultadoMotor {
  const desdeMs = ms(entrada.desde)
  const hastaMs = ms(entrada.hasta)
  const corteCrudo = entrada.corte ? ms(entrada.corte) : NaN
  const corte = Number.isFinite(corteCrudo) ? corteCrudo : null

  // ── Índices ────────────────────────────────────────────────────────────────
  const idx: Indices = {
    mp: new Map(entrada.cuentasMp.map((c) => [c.id, c])),
    cobro: new Map(entrada.cuentasCobro.map((c) => [c.id, c])),
    cobroPorSucursal: new Map(),
    sucursalesDeMp: new Map(),
    mpSoloBanco: new Set(),
  }
  const cobrosDeMp = new Map<string, CuentaCobroMotor[]>()
  for (const c of entrada.cuentasCobro) {
    agregar(idx.cobroPorSucursal, c.sucursalId, c)
    if (c.cuentaMpId) {
      const s = idx.sucursalesDeMp.get(c.cuentaMpId) ?? new Set<string>()
      s.add(c.sucursalId)
      idx.sucursalesDeMp.set(c.cuentaMpId, s)
      agregar(cobrosDeMp, c.cuentaMpId, c)
    }
  }
  // Una cuenta marcada "banco" no se lee: si quedó vinculada (dato viejo o una
  // carrera), sus créditos no cuentan como "sobran" (marcarCuentaBanco además
  // la desvincula).
  for (const [id, l] of cobrosDeMp) if (l.length && l.every((c) => c.banco)) idx.mpSoloBanco.add(id)

  const unidades = armarUnidades(entrada.esperados)
  const unidadPorTl = new Map<string, Unidad>()
  for (const u of unidades) for (const tl of u.tlIds) unidadPorTl.set(tl, u)

  // ── Rechazos: los pares que una persona descartó ("No es este") ──────────
  // Una unidad queda trabada con un crédito si ALGUNO de sus cobros se
  // descartó con él (un cobro conjunto con ese crédito incluiría ese cobro).
  const rechazos = (entrada.rechazos ?? []).filter((r) => !r.deshechoAt && !!r.transferLogId && !!r.movimientoId)
  /** Por crédito: los cobros (transfer_logs) descartados para él. */
  const tlsRechazadosDeMov = new Map<string, Set<string>>()
  for (const r of rechazos) {
    const s = tlsRechazadosDeMov.get(r.movimientoId) ?? new Set<string>()
    s.add(r.transferLogId)
    tlsRechazadosDeMov.set(r.movimientoId, s)
    const u = unidadPorTl.get(r.transferLogId)
    if (u) (u.rechazados ??= new Set<string>()).add(r.movimientoId)
  }
  /** ¿Una persona dijo que ese crédito no es de esa unidad? */
  const rechazado = (u: Unidad, v: Mov): boolean => u.rechazados !== null && u.rechazados.has(v.m.id)

  const movs: Mov[] = entrada.movimientos
    .map((m) => {
      const elegible = esPlataRecibida(m) && !TIPOS_NUNCA_COBRO.has(m.tipo) && !idx.mpSoloBanco.has(m.cuentaMpId)
      return {
        m,
        t: ms(m.fecha),
        montoKey: montoKey(m.monto),
        libre: true,
        elegible,
        emparejable: elegible && !TIPOS_TARJETA.has(m.tipo),
      }
    })
    .filter((v) => Number.isFinite(v.t))
    .sort((a, b) => a.t - b.t || (a.m.id < b.m.id ? -1 : 1))
  const movPorId = new Map(movs.map((v) => [v.m.id, v]))
  const movPorMpId = new Map<string, Mov>()
  for (const v of movs) if (v.elegible) movPorMpId.set(v.m.mpId, v)

  /** Movimientos EMPAREJABLES por (cuenta, monto), ordenados por tiempo (sin tarjetas: plata-3). */
  const porCuentaMonto = new Map<string, Mov[]>()
  const porCuenta = new Map<string, Mov[]>()
  const porMonto = new Map<number, Mov[]>()
  for (const v of movs) {
    if (!v.emparejable) continue
    agregar(porCuentaMonto, `${v.m.cuentaMpId}|${v.montoKey}`, v)
    agregar(porCuenta, v.m.cuentaMpId, v)
    agregar(porMonto, v.montoKey, v)
  }

  // Cuentas de MP leíbles de cada sucursal (candidatas de los cobros sin cuenta).
  const candidatasDeSucursal = (sucursalId: string | null): string[] => {
    if (!sucursalId) return []
    const ids = new Set<string>()
    for (const c of idx.cobroPorSucursal.get(sucursalId) ?? []) {
      if (!c.banco && c.cuentaMpId && idx.mp.has(c.cuentaMpId)) ids.add(c.cuentaMpId)
    }
    return [...ids].sort()
  }

  /** ¿La cuenta se leyó DE VERDAD entera en [t0, t1]? (Lo leído vale aunque después la cuenta se haya caído.) */
  const leida = (cuentaMpId: string | null, t0: number, t1: number): boolean => {
    const M = cuentaMpId ? idx.mp.get(cuentaMpId) : undefined
    if (!M || !M.sincronizadaDesde || !M.sincronizadaHasta) return false
    return ms(M.sincronizadaDesde) <= t0 && ms(M.sincronizadaHasta) >= t1
  }
  /** Misma frontera que P4: un cobro de los últimos 15 min de la lectura sólo lo empareja una prueba (P0, P1, P2). */
  const fueraDePendiente = (u: Unidad): boolean => leida(u.cuentaMpId, u.t - V_ANTES, u.t + MARGEN_PENDIENTE)

  // ── Cobertura previa (§3): lo que no tiene contra qué compararse no entra ──
  for (const u of unidades) {
    if (u.tipo === 'cobro') u.noVerificable = coberturaDeCobro(u, idx)
    else if (candidatasDeSucursal(u.sucursalId).length === 0) u.noVerificable = 'sin_cuenta_sucursal'
  }

  const casos: CasoConciliacion[] = []
  const cobertura: Record<string, NotaCobertura> = {}

  const armar = (p: {
    id: string
    estado: EstadoCaso
    confianza: Confianza | null
    senales: SenalCruce[]
    explicacion: string
    us: Unidad[]
    v: Mov | null
    aliasMp?: string | null
    candidatos?: CandidatoCruce[]
    resolucion?: ResolucionVista | null
  }): CasoConciliacion => {
    const montoSistema = p.us.reduce((s, u) => s + u.monto, 0)
    const montoMp = p.v ? p.v.m.monto : 0
    const tSis = p.us.length ? Math.min(...p.us.map((u) => u.t)) : null
    const fecha = p.us.length ? p.us.reduce((a, u) => (u.t < a.t ? u : a)).fechaIso : p.v!.m.fecha
    let diferencia = 0
    if (p.estado === 'conciliado' || p.estado === 'otra_cuenta' || p.estado === 'monto_mayor' || p.estado === 'monto_menor') {
      diferencia = montoMp - montoSistema
    } else if (p.estado === 'solo_sistema') diferencia = -montoSistema
    else if (p.estado === 'solo_mp') diferencia = montoMp
    const u0 = p.us[0]
    const cuentaMpId = u0 ? (u0.cuentaMpId ?? p.v?.m.cuentaMpId ?? null) : p.v!.m.cuentaMpId
    const alias = u0 ? (u0.alias ?? aliasDe(idx, p.v?.m.cuentaMpId)) : aliasDe(idx, p.v!.m.cuentaMpId)
    let sucursalId: string | null = u0?.sucursalId ?? null
    if (!u0 && p.v) {
      const s = idx.sucursalesDeMp.get(p.v.m.cuentaMpId)
      sucursalId = s && s.size === 1 ? [...s][0] : null
    }
    return {
      id: p.id,
      estado: p.estado,
      tono: TONO_DE_ESTADO[p.estado],
      confianza: p.confianza,
      senales: p.senales,
      explicacion: p.explicacion,
      diferencia,
      montoSistema,
      montoMp,
      retrasoSeg: p.v && tSis !== null ? Math.round((tSis - p.v.t) / SEG) : null,
      fecha,
      dia: diaAR(fecha),
      cuentaMpId,
      alias,
      aliasMp: p.aliasMp ?? null,
      sucursalId,
      esperados: p.us.flatMap((u) => u.esperados),
      movimiento: p.v ? movimientoPublico(p.v.m, p.estado === 'ajeno') : null,
      candidatos: p.candidatos ?? [],
      resolucion: p.resolucion ?? null,
    }
  }

  const consumir = (us: Unidad[], v: Mov | null) => {
    for (const u of us) u.libre = false
    if (v) v.libre = false
  }

  const explicarCercania = (u: Unidad, v: Mov): string => {
    const r = u.t - v.t
    return r >= 30 * SEG
      ? `Mismo monto, entró ${minutos(r)} min antes del cobro.`
      : r <= -30 * SEG
        ? `Mismo monto, entró ${minutos(r)} min después del cobro.`
        : 'Mismo monto, entró en el mismo minuto del cobro.'
  }

  /** ¿La plata de esta unidad entró en esa cuenta? (un cobro sin cuenta puede entrar en cualquier cuenta de su sucursal) */
  const esDeSuCuenta = (u: Unidad, cuentaMpId: string): boolean =>
    cuentaMpId === u.cuentaMpId || (u.tipo !== 'cobro' && candidatasDeSucursal(u.sucursalId).includes(cuentaMpId))

  // ── P0: vínculos manuales ──────────────────────────────────────────────────
  const vinculosPorMov = new Map<string, ResolucionMotor[]>()
  for (const r of entrada.resoluciones) {
    if (r.tipo !== 'vinculo' || !r.movimientoId || !r.transferLogId) continue
    const l = vinculosPorMov.get(r.movimientoId) ?? []
    l.push(r)
    vinculosPorMov.set(r.movimientoId, l)
  }
  for (const movId of [...vinculosPorMov.keys()].sort()) {
    const rs = vinculosPorMov.get(movId)!
    const v = movPorId.get(movId)
    // Un movimiento devuelto (entero, o en parciales hasta quedar en 0) no es
    // plata recibida: el vínculo deja de valer y su cobro vuelve al cruce
    // normal (y, si no aparece otra cosa, falta).
    if (!v || !esPlataRecibida(v.m) || !v.libre) continue
    const us: Unidad[] = []
    for (const r of rs) {
      const u = r.transferLogId ? unidadPorTl.get(r.transferLogId) : undefined
      if (u && u.libre && !us.includes(u)) us.push(u)
    }
    if (us.length === 0) {
      // El cobro vinculado es de otro período: el movimiento ya tiene dueño.
      v.libre = false
      continue
    }
    consumir(us, v)
    const suma = us.reduce((s, u) => s + u.monto, 0)
    const dif = v.m.monto - suma
    const estado: EstadoCaso = iguales(v.m.monto, suma) ? 'conciliado' : dif > 0 ? 'monto_mayor' : 'monto_menor'
    const otraCuenta = us[0].cuentaMpId !== v.m.cuentaMpId
    const por = rs[0].por
    const explicacion =
      estado === 'conciliado'
        ? `Vinculado a mano${por ? ` por ${por}` : ''}${otraCuenta && aliasDe(idx, v.m.cuentaMpId) ? `: entró en ${aliasDe(idx, v.m.cuentaMpId)}` : ''}.`
        : `Vinculado a mano: entraron ${plata(v.m.monto)} por ${plata(suma)} (${plata(Math.abs(dif))} de ${dif > 0 ? 'más' : 'menos'}).`
    casos.push(
      armar({
        id: us.length === 1 ? us[0].key : `grupo:${movId}`,
        estado,
        confianza: 'alta',
        senales: estado === 'conciliado' ? ['manual', 'mismo_monto'] : ['manual'],
        explicacion,
        us,
        v,
        aliasMp: otraCuenta ? aliasDe(idx, v.m.cuentaMpId) : null,
        resolucion: vistaResolucion(rs),
      }),
    )
  }

  // ── P1: número de operación del comprobante = id del pago ──────────────────
  // (No está verificado con datos reales que el nº del comprobante sea el id
  // del lado receptor; si no lo es, esta pasada simplemente no encuentra nada.)
  // Corre también para cobros de cuentas sin conectar: un id exacto en otra
  // cuenta de la org es prueba suficiente de dónde está la plata. Salvo que
  // una persona haya descartado ese par: el número lo leyó la IA de una foto,
  // y la persona miró los dos lados.
  for (const u of [...unidades].sort(porTiempo)) {
    if (!u.libre) continue
    const op = operacionComoId(u.comprobante?.operacion)
    if (!op) continue
    const v = movPorMpId.get(op)
    if (!v || !v.libre || rechazado(u, v)) continue
    consumir([u], v)
    const dif = v.m.monto - u.monto
    const mismaCuenta = esDeSuCuenta(u, v.m.cuentaMpId)
    const aliasMp = mismaCuenta ? null : aliasDe(idx, v.m.cuentaMpId)
    let estado: EstadoCaso
    let explicacion: string
    if (iguales(v.m.monto, u.monto)) {
      if (mismaCuenta || u.tipo !== 'cobro') {
        estado = 'conciliado'
        explicacion = mismaCuenta
          ? 'El número de operación del comprobante es el del pago en Mercado Pago.'
          : `El número de operación coincide: se registró sin cuenta y entró en ${aliasMp ?? 'otra cuenta'}.`
      } else {
        estado = 'otra_cuenta'
        explicacion = `El número de operación coincide, pero la plata entró en ${aliasMp ?? 'otra cuenta'}, no en ${u.alias ?? 'la cuenta registrada'}: el tope de cada cuenta queda mal.`
      }
    } else {
      estado = dif > 0 ? 'monto_mayor' : 'monto_menor'
      explicacion = `El número de operación coincide, pero entraron ${plata(v.m.monto)} por un cobro de ${plata(u.monto)}: ${plata(Math.abs(dif))} de ${dif > 0 ? 'más' : 'menos'}${aliasMp ? ` (y en ${aliasMp})` : ''}.`
    }
    casos.push(
      armar({
        id: u.key,
        estado,
        confianza: 'alta',
        senales: iguales(v.m.monto, u.monto) ? ['nro_operacion', 'mismo_monto'] : ['nro_operacion'],
        explicacion,
        us: [u],
        v,
        aliasMp,
      }),
    )
  }

  // ── Revisiones: lo que una persona marcó "revisado" sale del cruce ─────────
  // Sólo P0 (vínculo) y P1 (nº de operación) pueden usarlo: un crédito marcado
  // "plata personal" no cuadra otro cobro, y un cobro marcado "pagó en
  // efectivo" no le saca el crédito a otro. El par que se marcó junto (mismo
  // lote: un caso con su cobro y su crédito) se vuelve a armar como UN caso,
  // con el estado que dan hoy las cuentas; P5 lo pasa a 'revisado'.
  const reservadosU = new Set<Unidad>()
  const reservadosV = new Set<Mov>()
  /** Filas de revisiones que dejaron de valer (su par ya no existe): P5 no las aplica. */
  const anuladas = new Set<string>()
  for (const lote of lotesDeRevision(entrada.resoluciones)) {
    const us = unidades.filter((u) => u.libre && (u.tlIds.some((x) => lote.tls.has(x)) || u.esperados.some((e) => lote.claves.has(e.clave))))
    const movsDelLote = [...lote.movs].map((id) => movPorId.get(id))
    const vs = movsDelLote.filter((v): v is Mov => !!v && v.libre && esPlataRecibida(v.m))
    // El crédito del par se devolvió (ya no es plata recibida): lo que se
    // revisó —ese cobro CON ese crédito— no existe más. Sus cobros vuelven al
    // cruce sin esa revisión: un "Era la propina" no puede tapar que la plata
    // se fue (si no aparece otra cosa, falta).
    if (!vs.length && movsDelLote.some((v) => !!v && !esPlataRecibida(v.m))) {
      for (const r of lote.filas) anuladas.add(r.id)
      continue
    }
    // Un par revisado junto que después se descartó ("No es este") no se
    // rearma: cada parte queda reservada sola, con su revisión.
    if (us.length && vs.length === 1 && !us.some((u) => rechazado(u, vs[0]))) {
      const v = vs[0]
      consumir(us, v)
      const u0 = us[0]
      const suma = us.reduce((s, u) => s + u.monto, 0)
      const dif = v.m.monto - suma
      const mismaCuenta = esDeSuCuenta(u0, v.m.cuentaMpId)
      const aliasMp = mismaCuenta ? null : aliasDe(idx, v.m.cuentaMpId)
      const estado: EstadoCaso = !iguales(v.m.monto, suma)
        ? dif > 0
          ? 'monto_mayor'
          : 'monto_menor'
        : mismaCuenta
          ? 'conciliado'
          : 'otra_cuenta'
      const explicacion =
        estado === 'conciliado'
          ? 'Se revisó a mano junto con su cobro.'
          : estado === 'otra_cuenta'
            ? `La plata entró en ${aliasMp ?? 'otra cuenta'}, no en ${u0.alias ?? 'la cuenta registrada'}.`
            : `Entraron ${plata(v.m.monto)} por ${plata(suma)} (${plata(Math.abs(dif))} de ${dif > 0 ? 'más' : 'menos'}).`
      casos.push(
        armar({
          id: us.length === 1 ? u0.key : `grupo:${v.m.id}`,
          estado,
          confianza: 'alta',
          senales: estado === 'conciliado' ? ['manual', 'mismo_monto'] : ['manual'],
          explicacion,
          us,
          v,
          aliasMp,
          resolucion: vistaResolucion(lote.filas),
        }),
      )
      continue
    }
    for (const u of us) {
      u.libre = false
      reservadosU.add(u)
    }
    for (const v of vs) {
      v.libre = false
      reservadosV.add(v)
    }
  }

  // ── Índices de los cobros verificables (cuenta conectada y leída a esa hora) ─
  // Se arman después de P0/P1 y las revisiones; cada pasada vuelve a mirar `libre`.
  const verificables = unidades.filter((u) => u.libre && !u.noVerificable && u.tipo === 'cobro' && !!u.cuentaMpId)
  const uPorCuentaMonto = new Map<string, Unidad[]>()
  const uPorCuenta = new Map<string, Unidad[]>()
  const uPorMonto = new Map<number, Unidad[]>()
  for (const u of verificables) {
    agregar(uPorCuentaMonto, `${u.cuentaMpId}|${montoKey(u.monto)}`, u)
    agregar(uPorCuenta, u.cuentaMpId ?? '', u)
    agregar(uPorMonto, montoKey(u.monto), u)
  }
  /** Todos los cobros con cuenta de MP, también los de un tramo sin leer: los rivales del recíproco de P3a. */
  const uTodosPorCuentaMonto = new Map<string, Unidad[]>()
  for (const u of unidades) if (u.tipo === 'cobro' && u.cuentaMpId) agregar(uTodosPorCuentaMonto, `${u.cuentaMpId}|${montoKey(u.monto)}`, u)

  // ── P2: monto exacto + ventana angosta, en orden (alineamiento óptimo) ─────
  // Entran los verificables y los cobros "de borde" de una cuenta vinculada:
  // si su crédito se leyó, aparece y la plata está (prueba de presencia).
  const uP2 = new Map<string, Unidad[]>()
  for (const u of unidades) {
    if (!u.libre || u.tipo !== 'cobro' || !u.cuentaMpId || !idx.mp.has(u.cuentaMpId)) continue
    if (u.noVerificable && !MOTIVOS_DE_BORDE.has(u.noVerificable)) continue
    agregar(uP2, `${u.cuentaMpId}|${montoKey(u.monto)}`, u)
  }
  for (const k of [...uP2.keys()].sort()) {
    const U = (uP2.get(k) ?? []).filter((u) => u.libre)
    const todos = porCuentaMonto.get(k) ?? []
    const V = todos.filter((v) => v.libre)
    if (!U.length || !V.length) continue
    for (const [tu, tv] of tramos(U, V)) {
      const pares = alinear(tu, tv, costoPar)
      for (const [i, j] of pares) {
        const u = tu[i]
        const v = tv[j]
        consumir([u], v)
        const senales: SenalCruce[] = ['mismo_monto', 'hora']
        const porPagador = pagadorCoincide(u.comprobante?.remitente, v.m.pagador)
        const porHora = horaComprobanteCoincide(u.comprobante?.hhmm, v.t)
        if (porPagador) senales.push('pagador')
        if (porHora) senales.push('hora_comprobante')
        // Alta: el par es el único factible para los dos, o hay una señal de
        // identidad. Media: hay otro crédito igual a ≤ 3 min (intercambiables:
        // la plata cuadra igual, cambia a qué visita se atribuye).
        const unico = tv.filter((x) => factible(u, x)).length === 1 && tu.filter((x) => factible(x, v)).length === 1
        const gemelo = todos.some((x) => x !== v && Math.abs(x.t - v.t) <= GEMELO)
        const confianza: Confianza = !porPagador && !porHora && !unico && gemelo ? 'media' : 'alta'
        casos.push(
          armar({
            id: u.key,
            estado: 'conciliado',
            confianza,
            senales,
            explicacion: explicarCercania(u, v),
            us: [u],
            v,
          }),
        )
      }
    }
  }

  // ── P3a: ventana amplia, sólo candidatos únicos (alta manual, cobro tardío) ─
  // Toda la ventana tiene que estar leída: "el único crédito libre" de un
  // tramo sin leer no es único. Queda dudoso (confianza baja): no prueba nada
  // hasta que alguien lo confirme.
  for (const u of verificables) {
    if (!u.libre || !leida(u.cuentaMpId, u.t - AMPLIA_ANTES, u.t + AMPLIA_DESPUES)) continue
    const k = `${u.cuentaMpId}|${montoKey(u.monto)}`
    const vs = enVentana(porCuentaMonto.get(k) ?? [], u.t - AMPLIA_ANTES, u.t + AMPLIA_DESPUES).filter(
      (v) => v.libre && !rechazado(u, v),
    )
    if (vs.length !== 1) continue
    const v = vs[0]
    // Recíproco: ese crédito tiene que tener a este cobro como ÚNICO candidato
    // (x.t ∈ [v − 15 min, v + 90 min] ⟺ v cae en la ventana amplia de x),
    // contando también los cobros de un tramo sin leer. Un cobro para el que
    // se descartó ese crédito no es su rival: no puede ser el suyo.
    const rivales = enVentana(uTodosPorCuentaMonto.get(k) ?? [], v.t - AMPLIA_DESPUES, v.t + AMPLIA_ANTES).filter(
      (x) => x.libre && !rechazado(x, v),
    )
    if (rivales.length !== 1) continue
    consumir([u], v)
    casos.push(
      armar({
        id: u.key,
        estado: 'conciliado',
        confianza: 'baja',
        senales: ['mismo_monto'],
        explicacion: `Mismo monto, con ${minutos(u.t - v.t)} min de diferencia (alta manual o cobro tardío).`,
        us: [u],
        v,
      }),
    )
  }

  // ── P3b: cobro conjunto no marcado (1 crédito = 2 a 4 cobros) ──────────────
  // Dudoso por definición ('grupo'): la suma puede coincidir por casualidad.
  // Ninguna combinación junta un cobro con un crédito descartado para él.
  for (const v of movs) {
    if (!v.libre || !v.emparejable) continue
    const cands = enVentana(uPorCuenta.get(v.m.cuentaMpId) ?? [], v.t - GRUPO_ANTES, v.t + GRUPO_DESPUES)
      .filter((u) => u.libre && u.monto < v.m.monto && fueraDePendiente(u) && !rechazado(u, v))
      .sort((a, b) => Math.abs(a.t - v.t) - Math.abs(b.t - v.t) || porTiempo(a, b))
      .slice(0, GRUPO_MAX_CANDIDATAS)
    if (cands.length < 2) continue
    const grupo = mejorSubconjunto(cands, v.m.monto)
    if (!grupo) continue
    consumir(grupo, v)
    casos.push(
      armar({
        id: `grupo:${v.m.id}`,
        estado: 'conciliado',
        confianza: 'media',
        senales: ['grupo', 'hora'],
        explicacion: `Una transferencia de ${plata(v.m.monto)} cubre ${grupo.length} cobros (cobro conjunto sin marcar).`,
        us: grupo.sort(porTiempo),
        v,
      }),
    )
  }

  // ── P3c: monto distinto en la misma cuenta y ventana angosta ───────────────
  for (const u of verificables) {
    if (!u.libre || !fueraDePendiente(u)) continue
    const cerca = enVentana(porCuenta.get(u.cuentaMpId ?? '') ?? [], u.t - V_ANTES, u.t + V_DESPUES)
      .filter((v) => v.libre && !iguales(v.m.monto, u.monto) && !rechazado(u, v))
      .filter((v) => {
        const dif = v.m.monto - u.monto
        const razonable = Math.abs(dif) <= u.monto * 0.5 && Math.round(Math.abs(dif)) % 500 === 0
        // El comprobante dice cuánto se transfirió: si coincide con MP, la
        // diferencia es real aunque sea grande (el ancla de un cobro conjunto
        // cuyo segundo corte nunca se registró).
        const comprobanteLoDice = u.comprobante?.monto != null && iguales(u.comprobante.monto, v.m.monto)
        return razonable || comprobanteLoDice
      })
      .sort((a, b) => Math.abs(u.t - a.t - RETRASO_SEG * SEG) - Math.abs(u.t - b.t - RETRASO_SEG * SEG))
    const v = cerca[0]
    if (!v) continue
    consumir([u], v)
    const dif = v.m.monto - u.monto
    casos.push(
      armar({
        id: u.key,
        estado: dif > 0 ? 'monto_mayor' : 'monto_menor',
        confianza: 'media',
        senales: ['hora'],
        explicacion: `Entraron ${plata(v.m.monto)} por un cobro de ${plata(u.monto)}: ${plata(Math.abs(dif))} de ${dif > 0 ? 'más' : 'menos'}.`,
        us: [u],
        v,
      }),
    )
  }

  // ── P3d: la plata entró en OTRA cuenta de la organización ──────────────────
  // Sólo contra cuentas leídas enteras en la ventana: el crédito de una cuenta
  // caída puede ser el de su propio cobro (que no se pudo verificar).
  const elegiblesOtraCuenta = (u: Unidad): Mov[] => {
    const todas = enVentana(porMonto.get(montoKey(u.monto)) ?? [], u.t - V_ANTES, u.t + V_DESPUES).filter(
      (v) =>
        v.libre &&
        v.m.cuentaMpId !== u.cuentaMpId &&
        iguales(v.m.monto, u.monto) &&
        !rechazado(u, v) &&
        leida(v.m.cuentaMpId, u.t - V_ANTES, u.t + MARGEN_PENDIENTE),
    )
    const mismaSucursal = todas.filter(
      (v) => !!u.sucursalId && (idx.sucursalesDeMp.get(v.m.cuentaMpId)?.has(u.sucursalId) ?? false),
    )
    return mismaSucursal.length ? mismaSucursal : todas
  }
  for (const u of verificables) {
    if (!u.libre || !fueraDePendiente(u)) continue
    const vs = elegiblesOtraCuenta(u)
    if (vs.length !== 1) continue
    const v = vs[0]
    // Recíproco: si ese crédito también le sirve a otro cobro sin pareja, no se adivina.
    const rivales = enVentana(uPorMonto.get(v.montoKey) ?? [], v.t - V_DESPUES, v.t + V_ANTES).filter(
      (x) => x !== u && x.libre && x.cuentaMpId !== v.m.cuentaMpId && elegiblesOtraCuenta(x).includes(v),
    )
    if (rivales.length) continue
    consumir([u], v)
    const aliasMp = aliasDe(idx, v.m.cuentaMpId)
    casos.push(
      armar({
        id: u.key,
        estado: 'otra_cuenta',
        confianza: 'media',
        senales: ['mismo_monto', 'hora'],
        explicacion: `La plata entró en ${aliasMp ?? 'otra cuenta'}, no en ${u.alias ?? 'la cuenta registrada'}: el tope de cada cuenta queda mal.`,
        us: [u],
        v,
        aliasMp,
      }),
    )
  }

  // ── P3e: transferencias sin cuenta y propinas sueltas ──────────────────────
  // La unicidad se mira sobre TODAS las cuentas de la sucursal: si alguna no
  // se leyó entera en la ventana, no se empareja (P4 la deja pendiente o sin
  // verificar). Si la sucursal tiene cuentas que no se pueden leer (sin
  // conectar, de banco), el crédito único de las que sí se leen puede no ser
  // el suyo: queda sin verificar CON el crédito adjunto (no es un "sobra").
  for (const u of [...unidades].sort(porTiempo)) {
    if (!u.libre || u.tipo === 'cobro' || u.noVerificable) continue
    const ids = candidatasDeSucursal(u.sucursalId)
    if (!ids.every((id) => leida(id, u.t - V_ANTES, u.t + MARGEN_PENDIENTE))) continue
    const cuentas = new Set(ids)
    // (Hoy un "sin cuenta" no tiene transfer_log y no se puede descartar: el
    // filtro es por si mañana lo tiene.)
    const vs = enVentana(porMonto.get(montoKey(u.monto)) ?? [], u.t - V_ANTES, u.t + V_DESPUES).filter(
      (v) => v.libre && cuentas.has(v.m.cuentaMpId) && iguales(v.m.monto, u.monto) && !rechazado(u, v),
    )
    if (vs.length !== 1) continue
    const v = vs[0]
    consumir([u], v)
    const aliasMp = aliasDe(idx, v.m.cuentaMpId)
    if (cuentasIlegiblesDeSucursal(u.sucursalId, idx).length) {
      const caso = armar({
        id: u.key,
        estado: 'sin_verificar',
        confianza: null,
        senales: [],
        explicacion: `Se registró sin cuenta: podría ser el crédito de ${aliasMp ?? 'una cuenta de la sucursal'}, pero hay cuentas de la sucursal que no se pueden leer.`,
        us: [u],
        v,
      })
      cobertura[caso.id] = { motivo: 'sin_cuenta_sucursal', cuentaMpId: null }
      casos.push(caso)
      continue
    }
    casos.push(
      armar({
        id: u.key,
        estado: 'conciliado',
        confianza: 'media',
        senales: ['mismo_monto', 'hora'],
        explicacion: `Se registró sin cuenta: entró en ${aliasMp ?? 'una cuenta de la sucursal'}.`,
        us: [u],
        v,
      }),
    )
  }

  // Lo marcado "revisado" vuelve para P4: ahí se ve qué es hoy, y P5 lo marca.
  for (const u of reservadosU) u.libre = true
  for (const v of reservadosV) v.libre = true

  // ── P4: lo que quedó sin pareja ────────────────────────────────────────────
  // "Podría ser": los créditos sin pareja de cualquier cuenta, también los de
  // tarjeta (por si se cobró con tarjeta y se registró como transferencia).
  const movsSinPareja = movs.filter((v) => v.libre && v.elegible)
  /** Cobros que todavía no se pueden verificar: un crédito que podría ser el suyo no "sobra". */
  const esperandoLectura: Unidad[] = []
  const sinVerificarCon: { u: Unidad; nota: NotaCobertura }[] = []

  for (const u of [...unidades].sort(porTiempo)) {
    if (!u.libre) continue
    const candidatos = candidatosDeUnidad(u, movsSinPareja, idx)
    let estado: EstadoCaso
    let explicacion: string
    let nota: NotaCobertura | null = null

    if (u.noVerificable) {
      estado = 'sin_verificar'
      nota = { motivo: u.noVerificable, cuentaMpId: u.cuentaMpId }
      explicacion = explicarNoVerificable(u.noVerificable, u, idx)
    } else if (u.tipo !== 'cobro') {
      // Sin cuenta / propina suelta: se mira la cobertura de TODAS las cuentas de la sucursal.
      const ilegibles = cuentasIlegiblesDeSucursal(u.sucursalId, idx)
      const candidatas = candidatasDeSucursal(u.sucursalId).map((id) => idx.mp.get(id)!)
      // La primera cuenta de la sucursal que no cubre esa hora (para nombrarla).
      const caida = candidatas.find((M) => coberturaDeCuenta(M, u.t) !== null) ?? null
      const motivoCuenta = caida ? coberturaDeCuenta(caida, u.t) : null
      if (ilegibles.length) {
        estado = 'sin_verificar'
        nota = { motivo: 'sin_cuenta_sucursal', cuentaMpId: null }
        explicacion = 'Se registró sin cuenta y hay cuentas de la sucursal que no se pueden leer.'
      } else if (caida && motivoCuenta) {
        estado = 'sin_verificar'
        nota = { motivo: motivoCuenta, cuentaMpId: caida.id }
        explicacion = `Se registró sin cuenta. ${explicarNoVerificable(motivoCuenta, { ...u, cuentaMpId: caida.id }, idx)}`
      } else {
        const hastas = candidatas.map((M) => (M.sincronizadaHasta ? ms(M.sincronizadaHasta) : null))
        const minHasta = hastas.some((h) => h === null) ? null : Math.min(...(hastas as number[]))
        if (minHasta === null || u.t > minHasta - MARGEN_PENDIENTE) {
          estado = 'pendiente'
          nota = { motivo: 'pendiente', cuentaMpId: null }
          explicacion = 'Mercado Pago todavía no se leyó hasta esa hora.'
        } else {
          estado = 'solo_sistema'
          explicacion = `No encontré ${plata(u.monto)} en las cuentas de la sucursal entre las ${hhmmAR(u.t - V_ANTES)} y las ${hhmmAR(u.t + V_DESPUES)}.`
        }
      }
    } else {
      const M = u.cuentaMpId ? idx.mp.get(u.cuentaMpId) : undefined
      const hasta = M?.sincronizadaHasta ? ms(M.sincronizadaHasta) : null
      if (hasta === null || u.t > hasta - MARGEN_PENDIENTE) {
        estado = 'pendiente'
        nota = { motivo: 'pendiente', cuentaMpId: u.cuentaMpId }
        explicacion = 'Mercado Pago todavía no se leyó hasta esa hora.'
      } else {
        estado = 'solo_sistema'
        explicacion = `No encontré ${plata(u.monto)} en ${u.alias ?? 'la cuenta'} entre las ${hhmmAR(u.t - V_ANTES)} y las ${hhmmAR(u.t + V_DESPUES)}.`
      }
    }
    u.libre = false
    // Lo que una persona revisó ("pagó en efectivo") no reclama créditos.
    if (!reservadosU.has(u)) {
      if (estado === 'pendiente') esperandoLectura.push(u)
      else if (estado === 'sin_verificar' && nota) sinVerificarCon.push({ u, nota })
    }
    const caso = armar({ id: u.key, estado, confianza: null, senales: [], explicacion, us: [u], v: null, candidatos })
    if (nota) cobertura[caso.id] = nota
    casos.push(caso)
  }

  // Unidades sin pareja (con transfer_log) para sugerir del lado de los movimientos.
  const unidadesSinPareja = casos
    .filter((c) => c.movimiento === null && c.esperados.length > 0)
    .map((c) => ({ caso: c, tlIds: c.esperados.map((e) => e.transferLogId).filter((x): x is string => !!x) }))
    .filter((x) => x.tlIds.length > 0)
  const candidatosDeMovimiento = (v: Mov): CandidatoCruce[] => {
    // Los cobros que una persona ya descartó para este crédito no se vuelven a sugerir.
    const descartados = tlsRechazadosDeMov.get(v.m.id)
    return unidadesSinPareja
      .filter(
        (x) =>
          iguales(x.caso.montoSistema, v.m.monto) &&
          Math.abs(ms(x.caso.fecha) - v.t) <= VENTANA_CANDIDATOS &&
          !(descartados && x.tlIds.some((tl) => descartados.has(tl))),
      )
      .sort((a, b) => Math.abs(ms(a.caso.fecha) - v.t) - Math.abs(ms(b.caso.fecha) - v.t))
      .slice(0, MAX_CANDIDATOS)
      .map((x) => {
        const d = ms(x.caso.fecha) - v.t
        return {
          movimientoId: v.m.id,
          monto: x.caso.montoSistema,
          fecha: x.caso.fecha,
          alias: x.caso.alias,
          motivo: `Mismo monto, cobro registrado ${minutos(d)} min ${d >= 0 ? 'después' : 'antes'}${x.caso.alias ? ` en ${x.caso.alias}` : ''}`,
          probabilidad: probabilidad(d),
          transferLogIds: x.tlIds,
          casoId: x.caso.id,
        }
      })
  }

  // Los créditos sin cobro del período.
  const sinDueno: Mov[] = []
  for (const v of movs) {
    // Lo devuelto no es plata recibida: no se muestra (igual que un 'refunded').
    if (!v.libre || !esPlataRecibida(v.m)) continue
    // Fuera del período y sin pareja: es de un período vecino.
    if (v.t < desdeMs || v.t >= hastaMs) continue
    v.libre = false
    // Cuenta marcada como banco: no se lee, así que lo que haya quedado no cuenta.
    if (idx.mpSoloBanco.has(v.m.cuentaMpId)) continue
    const ajeno = motivoAjeno(v)
    if (ajeno) {
      casos.push(armar({ id: `mov:${v.m.id}`, estado: 'ajeno', confianza: null, senales: [], explicacion: ajeno, us: [], v }))
      continue
    }
    // Recién entrado: el barbero puede estar cerrando el cobro en la tablet.
    // (Uno que una persona ya revisó no espera nada.)
    if (corte !== null && !reservadosV.has(v) && v.t > corte - MARGEN_PENDIENTE) {
      const caso = armar({
        id: `mov:${v.m.id}`,
        estado: 'pendiente',
        confianza: null,
        senales: [],
        explicacion: `Entró hace ${minutos(corte - v.t)} min: esperando que se registre su cobro.`,
        us: [],
        v,
        candidatos: candidatosDeMovimiento(v),
      })
      cobertura[caso.id] = { motivo: 'esperando_cobro', cuentaMpId: v.m.cuentaMpId }
      casos.push(caso)
      continue
    }
    sinDueno.push(v)
  }

  // ¿Podría ser la plata de un cobro que todavía no se puede verificar? Entonces
  // tampoco se puede decir que "sobra": queda pendiente (se cruza en la
  // próxima lectura) o sin verificar. Uno a uno, el más cercano; después los
  // cobros conjuntos sin marcar de lo que quedó pendiente.
  const dueno = new Map<Mov, { estado: 'pendiente' | 'sin_verificar'; explicacion: string; nota: NotaCobertura }>()
  const reclamables = sinDueno.filter((v) => !reservadosV.has(v))
  const cuentasDeUnidad = (u: Unidad): string[] =>
    u.tipo === 'cobro' ? (u.cuentaMpId ? [u.cuentaMpId] : []) : candidatasDeSucursal(u.sucursalId)
  const usadas = new Set<Unidad>()
  const reclamar = (u: Unidad): Mov | null => {
    const cuentas = cuentasDeUnidad(u)
    if (!cuentas.length) return null
    let mejor: Mov | null = null
    for (const v of reclamables) {
      // Un crédito que una persona descartó para este cobro no puede ser "el suyo, cuando se lea".
      if (dueno.has(v) || !cuentas.includes(v.m.cuentaMpId) || !iguales(v.m.monto, u.monto) || rechazado(u, v)) continue
      if (v.t < u.t - AMPLIA_ANTES || v.t > u.t + AMPLIA_DESPUES) continue
      const d = Math.abs(u.t - v.t - RETRASO_SEG * SEG)
      if (!mejor || d < Math.abs(u.t - mejor.t - RETRASO_SEG * SEG)) mejor = v
    }
    return mejor
  }
  const delCobro = (u: Unidad) =>
    `${u.tipo === 'cobro' ? 'del cobro' : 'de la transferencia registrada sin cuenta'} de las ${hhmmAR(u.t)}`
  for (const u of esperandoLectura) {
    const v = reclamar(u)
    if (!v) continue
    usadas.add(u)
    dueno.set(v, {
      estado: 'pendiente',
      explicacion: `Podría ser ${delCobro(u)}: se cruza cuando Mercado Pago se lea hasta esa hora.`,
      nota: { motivo: 'pendiente', cuentaMpId: v.m.cuentaMpId },
    })
  }
  for (const { u, nota } of sinVerificarCon) {
    const v = reclamar(u)
    if (!v) continue
    usadas.add(u)
    dueno.set(v, {
      estado: 'sin_verificar',
      explicacion: `Podría ser ${delCobro(u)}${u.alias ? ` en ${u.alias}` : ''}, que no se puede verificar.`,
      nota: { motivo: nota.motivo, cuentaMpId: v.m.cuentaMpId },
    })
  }
  for (const v of reclamables) {
    if (dueno.has(v)) continue
    const cands = esperandoLectura
      .filter(
        (u) => !usadas.has(u) && u.tipo === 'cobro' && u.cuentaMpId === v.m.cuentaMpId && u.monto < v.m.monto && !rechazado(u, v),
      )
      .filter((u) => u.t >= v.t - GRUPO_ANTES && u.t <= v.t + GRUPO_DESPUES)
      .sort((a, b) => Math.abs(a.t - v.t) - Math.abs(b.t - v.t) || porTiempo(a, b))
      .slice(0, GRUPO_MAX_CANDIDATAS)
    if (cands.length < 2) continue
    const grupo = mejorSubconjunto(cands, v.m.monto)
    if (!grupo) continue
    for (const u of grupo) usadas.add(u)
    dueno.set(v, {
      estado: 'pendiente',
      explicacion: `Podría ser de ${grupo.length} cobros (cobro conjunto sin marcar): se cruza cuando Mercado Pago se lea hasta esa hora.`,
      nota: { motivo: 'pendiente', cuentaMpId: v.m.cuentaMpId },
    })
  }

  for (const v of sinDueno) {
    const d = dueno.get(v)
    const caso = armar({
      id: `mov:${v.m.id}`,
      estado: d?.estado ?? 'solo_mp',
      confianza: null,
      senales: [],
      explicacion: d?.explicacion ?? `Entró en ${aliasDe(idx, v.m.cuentaMpId) ?? 'Mercado Pago'} y no hay un cobro registrado.`,
      us: [],
      v,
      candidatos: candidatosDeMovimiento(v),
    })
    if (d) cobertura[caso.id] = d.nota
    casos.push(caso)
  }

  // ── P5: lo que una persona marcó como revisado ─────────────────────────────
  aplicarRevisiones(casos, anuladas.size ? entrada.resoluciones.filter((r) => !anuladas.has(r.id)) : entrada.resoluciones)

  // Lo que una persona descartó ("No es este"), a la vista en los dos lados,
  // para poder deshacerlo.
  if (rechazos.length) adjuntarRechazos(casos, rechazos, { unidadPorTl, movPorId, idx })

  casos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { casos, cobertura }
}

// ─────────────────────────────────────────────────────────────────────────────
// Piezas del motor
// ─────────────────────────────────────────────────────────────────────────────

function porTiempo(a: { t: number; key?: string }, b: { t: number; key?: string }): number {
  return a.t - b.t || ((a.key ?? '') < (b.key ?? '') ? -1 : (a.key ?? '') > (b.key ?? '') ? 1 : 0)
}

/**
 * Esperados → unidades. Los de un mismo cobro conjunto (covering_receipt_id)
 * son UNA unidad. Una unidad de $0 (la seña o un premio cubrió todo) no tiene
 * plata que verificar: no entra.
 */
function armarUnidades(esperados: EsperadoMP[]): Unidad[] {
  const grupos = new Map<string, EsperadoMP[]>()
  for (const e of esperados) {
    const k = e.coveringReceiptId ? `cc:${e.coveringReceiptId}` : e.clave
    const l = grupos.get(k) ?? []
    if (!l.some((x) => x.clave === e.clave)) l.push(e)
    grupos.set(k, l)
  }
  const out: Unidad[] = []
  for (const [k, l] of grupos) {
    l.sort((a, b) => ms(a.tSistema) - ms(b.tSistema) || (a.clave < b.clave ? -1 : 1))
    const ancla = l.find((e) => e.comprobante?.id && e.comprobante.id === e.coveringReceiptId) ?? l[0]
    const t = ms(l[0].tSistema)
    if (!Number.isFinite(t)) continue
    const monto = l.reduce((s, e) => s + e.monto, 0)
    if (!(monto > 0)) continue
    out.push({
      key: l.length === 1 ? l[0].clave : k,
      esperados: l,
      monto,
      t,
      fechaIso: l[0].tSistema,
      tipo: ancla.tipo,
      cuentaMpId: ancla.cuentaMpId,
      paymentAccountId: ancla.paymentAccountId,
      alias: ancla.alias,
      sucursalId: ancla.sucursalId,
      comprobante: ancla.comprobante ?? l.find((e) => e.comprobante)?.comprobante ?? null,
      tlIds: l.map((e) => e.transferLogId).filter((x): x is string => !!x),
      libre: true,
      noVerificable: null,
      rechazados: null,
    })
  }
  return out.sort(porTiempo)
}

/**
 * Las filas 'revisado' agrupadas por lote: las de un mismo insert comparten
 * `en` (created_at) y autor (created_by). El más reciente primero: si un
 * cobro quedó en dos revisiones, manda la última.
 */
function lotesDeRevision(resoluciones: ResolucionMotor[]): LoteRevision[] {
  const lotes = new Map<string, LoteRevision>()
  for (const r of resoluciones) {
    if (r.tipo !== 'revisado') continue
    const k = `${r.en}|${r.autor ?? ''}`
    const l = lotes.get(k) ?? { filas: [], tls: new Set<string>(), claves: new Set<string>(), movs: new Set<string>(), en: r.en }
    l.filas.push(r)
    if (r.transferLogId) l.tls.add(r.transferLogId)
    if (r.claveEsperado) l.claves.add(r.claveEsperado)
    if (r.movimientoId) l.movs.add(r.movimientoId)
    lotes.set(k, l)
  }
  return [...lotes.entries()]
    .sort(([ka, a], [kb, b]) => (a.en < b.en ? 1 : a.en > b.en ? -1 : ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, l]) => l)
}

/** Cuentas de cobro activas de la sucursal que no se pueden leer (de banco o sin conectar). */
function cuentasIlegiblesDeSucursal(sucursalId: string | null, idx: Indices): CuentaCobroMotor[] {
  return (idx.cobroPorSucursal.get(sucursalId ?? '') ?? []).filter(
    (c) => c.activa && (c.banco || !c.cuentaMpId || !idx.mp.has(c.cuentaMpId)),
  )
}

/** §3: ¿la cuenta del cobro cubre su hora? */
function coberturaDeCobro(u: Unidad, idx: Indices): MotivoNoVerificable | null {
  const pa = u.paymentAccountId ? idx.cobro.get(u.paymentAccountId) : undefined
  if (pa?.banco) return 'banco'
  if (!u.cuentaMpId) return 'sin_conectar'
  const M = idx.mp.get(u.cuentaMpId)
  if (!M) return 'sin_conectar'
  return coberturaDeCuenta(M, u.t)
}

function coberturaDeCuenta(M: CuentaMpMotor, t: number): MotivoNoVerificable | null {
  if (!M.sincronizadaDesde) return M.status === 'desconectada' ? 'desconectada' : 'sin_lectura'
  if (ms(M.sincronizadaDesde) > t - COBERTURA_ANTES) return 'fuera_de_lectura'
  const hasta = M.sincronizadaHasta ? ms(M.sincronizadaHasta) : null
  if ((M.status === 'error' || M.status === 'revocada' || M.status === 'desconectada') && (hasta === null || hasta < t + COBERTURA_DESPUES)) {
    return M.status === 'desconectada' ? 'desconectada' : 'error_lectura'
  }
  return null
}

function explicarNoVerificable(m: MotivoNoVerificable, u: Unidad, idx: Indices): string {
  switch (m) {
    case 'sin_conectar':
      return 'Cuenta sin conectar.'
    case 'desconectada':
      return 'La cuenta se desconectó: ya no se lee.'
    case 'banco':
      return 'Cuenta de banco: se controla sólo con el comprobante.'
    case 'sin_lectura':
      return 'La cuenta todavía no se leyó.'
    case 'fuera_de_lectura':
      return 'Mercado Pago no se leyó para esa fecha.'
    case 'sin_cuenta_sucursal':
      return 'Se registró sin cuenta y ninguna cuenta de la sucursal está conectada.'
    case 'error_lectura': {
      const M = u.cuentaMpId ? idx.mp.get(u.cuentaMpId) : undefined
      const h = M?.sincronizadaHasta
      if (!h) return 'No pudimos leer la cuenta.'
      return diaAR(h) === diaAR(u.t)
        ? `No pudimos leer la cuenta desde las ${hhmmAR(h)}.`
        : `No pudimos leer la cuenta desde el ${diaMes(diaAR(h))} a las ${hhmmAR(h)}.`
    }
  }
}

/** ¿Ese crédito puede ser el de esa unidad en la ventana angosta? Un par descartado a mano nunca. */
function factible(u: Unidad, v: Mov): boolean {
  return v.t >= u.t - V_ANTES && v.t <= u.t + V_DESPUES && (u.rechazados === null || !u.rechazados.has(v.m.id))
}

function costoPar(u: Unidad, v: Mov): number | null {
  if (!factible(u, v)) return null
  let c = Math.abs((u.t - v.t) / SEG - RETRASO_SEG)
  if (pagadorCoincide(u.comprobante?.remitente, v.m.pagador)) c -= BONO_SEG
  if (horaComprobanteCoincide(u.comprobante?.hhmm, v.t)) c -= BONO_SEG
  return c
}

/** Parte (U, V) en tramos separados por huecos > 12 min sin elementos: ningún par factible cruza un hueco así. */
function tramos(U: Unidad[], V: Mov[]): Array<[Unidad[], Mov[]]> {
  const out: Array<[Unidad[], Mov[]]> = []
  let tu: Unidad[] = []
  let tv: Mov[] = []
  let ultimo = -Infinity
  let i = 0
  let j = 0
  while (i < U.length || j < V.length) {
    const tomarU = j >= V.length || (i < U.length && U[i].t <= V[j].t)
    const t = tomarU ? U[i].t : V[j].t
    if (t - ultimo > HUECO_TRAMO && (tu.length || tv.length)) {
      if (tu.length && tv.length) out.push([tu, tv])
      tu = []
      tv = []
    }
    if (tomarU) tu.push(U[i++])
    else tv.push(V[j++])
    ultimo = t
  }
  if (tu.length && tv.length) out.push([tu, tv])
  return out
}

/**
 * Alineamiento monótono de costo mínimo (programación dinámica):
 * dp[i][j] = min(dp[i−1][j] + P, dp[i][j−1] + P, dp[i−1][j−1] + costo(i, j) si es factible).
 * Ante empate gana emparejar (determinístico).
 */
function alinear(U: Unidad[], V: Mov[], costo: (u: Unidad, v: Mov) => number | null): Array<[number, number]> {
  const n = U.length
  const m = V.length
  const W = m + 1
  const eleccion = new Uint8Array((n + 1) * W)
  let prev = new Float64Array(W)
  let cur = new Float64Array(W)
  for (let j = 0; j <= m; j++) {
    prev[j] = j * PENALIDAD_SEG
    eleccion[j] = 2
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i * PENALIDAD_SEG
    eleccion[i * W] = 1
    for (let j = 1; j <= m; j++) {
      let mejor = prev[j] + PENALIDAD_SEG
      let e = 1
      const izq = cur[j - 1] + PENALIDAD_SEG
      if (izq < mejor) {
        mejor = izq
        e = 2
      }
      const c = costo(U[i - 1], V[j - 1])
      if (c !== null) {
        const d = prev[j - 1] + c
        if (d <= mejor) {
          mejor = d
          e = 3
        }
      }
      cur[j] = mejor
      eleccion[i * W + j] = e
    }
    const aux = prev
    prev = cur
    cur = aux
  }
  const pares: Array<[number, number]> = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const e = i > 0 && j > 0 ? eleccion[i * W + j] : i > 0 ? 1 : 2
    if (e === 3) {
      pares.push([i - 1, j - 1])
      i--
      j--
    } else if (e === 1) i--
    else j--
  }
  return pares.reverse()
}

/** Subconjunto de 2 a 4 cobros cuya suma es el monto (±$1), con la menor dispersión de tiempo. */
function mejorSubconjunto(cands: Unidad[], monto: number): Unidad[] | null {
  let mejor: Unidad[] | null = null
  let mejorDisp = Infinity
  const n = cands.length
  const evaluar = (sel: Unidad[]) => {
    const suma = sel.reduce((s, u) => s + u.monto, 0)
    if (!iguales(suma, monto)) return
    const ts = sel.map((u) => u.t)
    const disp = Math.max(...ts) - Math.min(...ts)
    if (disp < mejorDisp) {
      mejorDisp = disp
      mejor = [...sel]
    }
  }
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      evaluar([cands[a], cands[b]])
      for (let c = b + 1; c < n; c++) {
        evaluar([cands[a], cands[b], cands[c]])
        if (CONCILIACION.grupoMax >= 4) for (let d = c + 1; d < n; d++) evaluar([cands[a], cands[b], cands[c], cands[d]])
      }
    }
  return mejor
}

/** Elementos de una lista ordenada por tiempo dentro de [t0, t1] (búsqueda binaria). */
function enVentana<T extends { t: number }>(lista: T[], t0: number, t1: number): T[] {
  let lo = 0
  let hi = lista.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lista[mid].t < t0) lo = mid + 1
    else hi = mid
  }
  const out: T[] = []
  for (let k = lo; k < lista.length && lista[k].t <= t1; k++) out.push(lista[k])
  return out
}

function probabilidad(dMs: number): CandidatoCruce['probabilidad'] {
  const a = Math.abs(dMs)
  return a <= 10 * MIN ? 'muy_probable' : a <= 30 * MIN ? 'probable' : 'posible'
}

/**
 * "Podría ser": movimientos sin pareja de cualquier cuenta, mismo monto, ±2 h.
 * Primero las transferencias; un cobro con tarjeta va al final y como
 * 'posible' (sólo es el suyo si se cobró con tarjeta y se registró como
 * transferencia, y eso lo decide una persona). Un crédito que una persona ya
 * descartó para este cobro no se vuelve a sugerir.
 */
function candidatosDeUnidad(u: Unidad, movsSinPareja: Mov[], idx: Indices): CandidatoCruce[] {
  return movsSinPareja
    .filter(
      (v) =>
        v.libre &&
        iguales(v.m.monto, u.monto) &&
        Math.abs(v.t - u.t) <= VENTANA_CANDIDATOS &&
        (u.rechazados === null || !u.rechazados.has(v.m.id)),
    )
    .sort(
      (a, b) =>
        Number(TIPOS_TARJETA.has(a.m.tipo)) - Number(TIPOS_TARJETA.has(b.m.tipo)) || Math.abs(a.t - u.t) - Math.abs(b.t - u.t),
    )
    .slice(0, MAX_CANDIDATOS)
    .map((v) => {
      const d = v.t - u.t
      const alias = aliasDe(idx, v.m.cuentaMpId)
      const donde = v.m.cuentaMpId === u.cuentaMpId ? 'en la misma cuenta' : alias ? `en ${alias}` : 'en otra cuenta'
      const cuando = `${minutos(d)} min ${d >= 0 ? 'después' : 'antes'}`
      if (TIPOS_TARJETA.has(v.m.tipo)) {
        return {
          movimientoId: v.m.id,
          monto: v.m.monto,
          fecha: v.m.fecha,
          alias,
          motivo: `Cobro con tarjeta del mismo monto, ${cuando}, ${donde}. Si se cobró con tarjeta y se registró como transferencia, vinculalo a mano`,
          probabilidad: 'posible' as const,
        }
      }
      return {
        movimientoId: v.m.id,
        monto: v.m.monto,
        fecha: v.m.fecha,
        alias,
        motivo: `Mismo monto, ${cuando}, ${donde}`,
        probabilidad: probabilidad(d),
      }
    })
}

/** ¿Por qué un crédito sin pareja NO parece un cobro? null = sí parece. */
function motivoAjeno(v: Mov): string | null {
  const tipo = v.m.tipo
  if (tipo === 'rendimiento') return 'Rendimiento de Mercado Pago.'
  if (tipo === 'devolucion') return 'Devolución.'
  if (TIPOS_TARJETA.has(tipo)) return 'Cobro con tarjeta: no es una transferencia.'
  if (!TIPOS_PARECEN_COBRO.has(tipo)) return 'No es una transferencia.'
  const minutosDia = minutosDelDiaAR(v.t)
  const [hd, md] = CONCILIACION.horarioDesde.split(':').map(Number)
  const [hh, mh] = CONCILIACION.horarioHasta.split(':').map(Number)
  if (minutosDia < hd * 60 + md || minutosDia > hh * 60 + mh) return `Entró fuera del horario del local (${hhmmAR(v.t)}).`
  const monto = v.m.monto
  if (monto < 2000 || monto > 200000 || Math.round(monto) % 500 !== 0) return 'Monto que no parece un cobro.'
  return null
}

/** Para la UI: el movimiento sin el estado crudo; los 'ajeno' van sin pagador (no son cobros). */
function movimientoPublico(m: MovimientoMotor, sinPagador: boolean): MovimientoMP {
  return {
    id: m.id,
    cuentaMpId: m.cuentaMpId,
    mpId: m.mpId,
    tipo: m.tipo,
    monto: m.monto,
    fecha: m.fecha,
    pagador: sinPagador ? null : m.pagador,
    pagadorDocUlt4: sinPagador ? null : m.pagadorDocUlt4,
    descripcion: sinPagador ? null : m.descripcion,
    operationType: m.operationType,
    paymentTypeId: m.paymentTypeId,
    paymentMethodId: m.paymentMethodId,
  }
}

function vistaResolucion(rs: ResolucionMotor[]): ResolucionVista {
  const ultima = [...rs].sort((a, b) => (a.en < b.en ? 1 : a.en > b.en ? -1 : 0))[0]
  return {
    id: ultima.id,
    tipo: ultima.tipo,
    motivo: ultima.motivo,
    nota: ultima.nota,
    por: ultima.por,
    en: ultima.en,
    ids: [...new Set(rs.map((r) => r.id))].sort(),
  }
}

/**
 * P5: un caso con una resolución 'revisado' activa (por cobro, movimiento o
 * clave) pasa a 'revisado'. Salvo:
 *   - lo que cuadra, cuadra: un vínculo, el nº de operación o un par que hoy
 *     cuadra no se tapa con una revisión vieja;
 *   - lo que no se pudo leer ('sin_verificar') o todavía no se leyó
 *     ('pendiente') no se tapa con una revisión: queda como está, con la
 *     resolución adjunta para poder verla y deshacerla. Si no, una revisión
 *     vieja pintaría "Cuadra" sobre plata sin leer;
 *   - una revisión cubre lo que la persona vio: si el caso junta algo revisado
 *     con algo que nadie revisó (el nº de operación emparejó un cobro nuevo
 *     con un crédito marcado "plata personal", con otro monto), el caso queda
 *     como está, para revisar, y sin la resolución adjunta (la pantalla tiene
 *     que ofrecer revisarlo).
 */
function aplicarRevisiones(casos: CasoConciliacion[], resoluciones: ResolucionMotor[]): void {
  const porTl = new Map<string, ResolucionMotor[]>()
  const porMov = new Map<string, ResolucionMotor[]>()
  const porClave = new Map<string, ResolucionMotor[]>()
  const meter = (m: Map<string, ResolucionMotor[]>, k: string | null, r: ResolucionMotor) => {
    if (!k) return
    const l = m.get(k) ?? []
    l.push(r)
    m.set(k, l)
  }
  for (const r of resoluciones) {
    if (r.tipo !== 'revisado') continue
    meter(porTl, r.transferLogId, r)
    meter(porMov, r.movimientoId, r)
    meter(porClave, r.claveEsperado, r)
  }
  if (!porTl.size && !porMov.size && !porClave.size) return

  for (let i = 0; i < casos.length; i++) {
    const c = casos[i]
    if (c.estado === 'conciliado') continue
    const rs: ResolucionMotor[] = []
    // Las partes del caso (cada cobro y su crédito) y cuántas tienen una revisión.
    let partes = 0
    let revisadas = 0
    const contar = (l: ResolucionMotor[]) => {
      partes++
      if (l.length) revisadas++
      rs.push(...l)
    }
    for (const e of c.esperados) contar([...(e.transferLogId ? (porTl.get(e.transferLogId) ?? []) : []), ...(porClave.get(e.clave) ?? [])])
    if (c.movimiento) contar(porMov.get(c.movimiento.id) ?? [])
    if (!rs.length) continue
    const vista = vistaResolucion(rs)
    if (c.estado === 'sin_verificar' || c.estado === 'pendiente') {
      if (!c.resolucion) casos[i] = { ...c, resolucion: vista }
      continue
    }
    if (revisadas < partes) continue
    casos[i] = {
      ...c,
      estado: 'revisado',
      tono: TONO_DE_ESTADO.revisado,
      explicacion: `${etiquetaMotivo(vista.motivo)} · antes: ${ETIQUETA_ESTADO[c.estado]}`,
      resolucion: vista,
    }
  }
}

/**
 * Pone en cada caso lo que una persona descartó para él: los créditos
 * descartados para sus cobros ('credito') y los cobros descartados para su
 * crédito ('cobro'). El par que forma el propio caso no va (sólo puede ser un
 * vínculo a mano, que manda), y lo que no se puede describir (el otro lado no
 * está en lo que se leyó) tampoco: no cambia nada en este período.
 */
function adjuntarRechazos(
  casos: CasoConciliacion[],
  rechazos: RechazoMotor[],
  ctx: { unidadPorTl: Map<string, Unidad>; movPorId: Map<string, Mov>; idx: Indices },
): void {
  const porTl = new Map<string, RechazoMotor[]>()
  const porMov = new Map<string, RechazoMotor[]>()
  for (const r of rechazos) {
    agregar(porTl, r.transferLogId, r)
    agregar(porMov, r.movimientoId, r)
  }
  const vista = (rs: RechazoMotor[], base: Omit<RechazoVista, 'ids' | 'transferLogIds' | 'por' | 'en'>): RechazoVista => {
    const ultimo = [...rs].sort((a, b) => ((a.en ?? '') < (b.en ?? '') ? 1 : (a.en ?? '') > (b.en ?? '') ? -1 : 0))[0]
    return {
      ...base,
      ids: [...new Set(rs.map((r) => r.id))].sort(),
      transferLogIds: [...new Set(rs.map((r) => r.transferLogId))].sort(),
      por: ultimo.por ?? null,
      en: ultimo.en ?? null,
    }
  }

  for (let i = 0; i < casos.length; i++) {
    const c = casos[i]
    const movPropio = c.movimiento?.id ?? null
    // Lo de siempre: ningún descarte toca este caso.
    if (!(movPropio !== null && porMov.has(movPropio)) && !c.esperados.some((e) => !!e.transferLogId && porTl.has(e.transferLogId))) continue
    const propios = new Set(c.esperados.map((e) => e.transferLogId).filter((x): x is string => !!x))
    const vistas: RechazoVista[] = []

    // Créditos descartados para los cobros de este caso.
    const porCredito = new Map<string, RechazoMotor[]>()
    for (const tl of propios) {
      for (const r of porTl.get(tl) ?? []) if (r.movimientoId !== movPropio) agregar(porCredito, r.movimientoId, r)
    }
    for (const [movId, rs] of porCredito) {
      const v = ctx.movPorId.get(movId)
      if (!v) continue
      vistas.push(
        vista(rs, { lado: 'credito', movimientoId: movId, monto: v.m.monto, fecha: v.m.fecha, alias: aliasDe(ctx.idx, v.m.cuentaMpId) }),
      )
    }

    // Cobros descartados para el crédito de este caso (agrupados por cobro: uno conjunto es uno).
    if (movPropio) {
      const porUnidad = new Map<Unidad, RechazoMotor[]>()
      for (const r of porMov.get(movPropio) ?? []) {
        if (propios.has(r.transferLogId)) continue
        const u = ctx.unidadPorTl.get(r.transferLogId)
        if (u) agregar(porUnidad, u, r)
      }
      for (const [u, rs] of porUnidad) {
        vistas.push(vista(rs, { lado: 'cobro', movimientoId: movPropio, monto: u.monto, fecha: u.fechaIso, alias: u.alias }))
      }
    }

    if (!vistas.length) continue
    vistas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.ids[0] < b.ids[0] ? -1 : a.ids[0] > b.ids[0] ? 1 : 0))
    casos[i] = { ...c, rechazados: vistas }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto y totales (§5)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaResumen {
  casos: CasoConciliacion[]
  cobertura: Record<string, NotaCobertura>
  cuentasMp: CuentaMpMotor[]
  periodo: DescripcionPeriodo
  ahora: Date
  /**
   * Las cuentas de MP que tienen que estar leídas para poder decir "Cuadra" o
   * "No hubo transferencias": las vinculadas a cuentas de cobro del alcance
   * (que no son de banco), tengan o no cobros en el período. La ausencia de
   * créditos no prueba nada si Mercado Pago no se leyó. Sin esto, sólo se
   * mira la cobertura de los casos.
   */
  cuentasDelAlcance?: string[]
  /** El período [desde, hasta) como instantes: hasta dónde tiene que estar leída cada cuenta. */
  rango?: { desde: Date; hasta: Date }
}

export interface Resumen {
  veredicto: Veredicto
  totales: TotalesConciliacion
  /** % del monto del sistema que se pudo verificar (ni 'sin verificar' ni "para confirmar"). Piso, nunca redondea para arriba. */
  pctPlata: number
  /** "Mercado Pago leído hace 6 min" con la lectura MÁS VIEJA de las cuentas en juego. */
  frescura: string | null
}

const MOTIVOS_SIN_CONECTAR = new Set<string>(['sin_conectar', 'desconectada'])

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '')
}

/** Identidad de la cuenta de un caso para contar "cuentas" (el alias normalizado agrupa la misma cuenta en dos sucursales). */
function claveCuenta(c: CasoConciliacion): string {
  if (c.cuentaMpId) return `mp:${c.cuentaMpId}`
  if (c.alias) return `al:${norm(c.alias)}`
  return `pa:${c.esperados[0]?.paymentAccountId ?? c.id}`
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios
}

/** "las 18:00" si es del último día del período; si no, "el 19/10 a las 18:00". */
function laHora(iso: string | number, periodo: DescripcionPeriodo): string {
  return diaAR(iso) === periodo.ultimoDia ? `las ${hhmmAR(iso)}` : `el ${diaMes(diaAR(iso))} a las ${hhmmAR(iso)}`
}

/** Un cobro sin verificar (o revisado desde ese estado) no cuenta como plata verificada. */
function noVerificado(c: CasoConciliacion, cobertura: Record<string, NotaCobertura>): boolean {
  const n = cobertura[c.id]
  return !!n && n.motivo !== 'pendiente' && n.motivo !== 'esperando_cobro' && (c.estado === 'sin_verificar' || c.estado === 'revisado')
}

interface CuentasSinLeer {
  /** Conectadas, pero no leídas en todo el período. */
  sinLeer: CuentaMpMotor[]
  /** Con error o sin permiso, y sin leer en todo el período. */
  conError: CuentaMpMotor[]
  /** Alguna no se leyó desde el principio del período. */
  sinFecha: boolean
}

/**
 * Las cuentas del alcance que NO se leyeron entre el principio del período y
 * su fin (o ahora) − 15 min. Una desconectada no cuenta: el dueño la sacó.
 */
function cuentasSinLeer(e: EntradaResumen, cuentaMp: Map<string, CuentaMpMotor>): CuentasSinLeer {
  const out: CuentasSinLeer = { sinLeer: [], conError: [], sinFecha: false }
  if (!e.cuentasDelAlcance?.length || !e.rango) return out
  const inicio = e.rango.desde.getTime()
  const fin = Math.min(e.rango.hasta.getTime(), e.ahora.getTime()) - MARGEN_PENDIENTE
  for (const id of [...new Set(e.cuentasDelAlcance)].sort()) {
    const M = cuentaMp.get(id)
    if (!M || M.status === 'desconectada') continue
    const desdeOk = !!M.sincronizadaDesde && ms(M.sincronizadaDesde) <= inicio
    const hastaOk = !!M.sincronizadaHasta && ms(M.sincronizadaHasta) >= fin
    if (desdeOk && hastaOk) continue
    if (M.status === 'error' || M.status === 'revocada') out.conError.push(M)
    else {
      out.sinLeer.push(M)
      if (!desdeOk && !!M.sincronizadaDesde) out.sinFecha = true
    }
  }
  return out
}

export function resumir(e: EntradaResumen): Resumen {
  const { casos, cobertura, periodo } = e
  const cuentaMp = new Map(e.cuentasMp.map((c) => [c.id, c]))
  const conCobros = casos.filter((c) => c.esperados.length > 0)
  const cuentaPlata = (c: CasoConciliacion) =>
    !!c.movimiento && c.estado !== 'ajeno' && !(c.estado === 'revisado' && c.esperados.length === 0)

  const sumar = (l: CasoConciliacion[], f: (c: CasoConciliacion) => number) => l.reduce((s, c) => s + f(c), 0)
  const deEstado = (est: EstadoCaso) => casos.filter((c) => c.estado === est)

  const soloSistema = deEstado('solo_sistema')
  const soloMp = deEstado('solo_mp')
  const menor = deEstado('monto_menor')
  const mayor = deEstado('monto_mayor')
  const otra = deEstado('otra_cuenta')
  const sinVerificar = deEstado('sin_verificar')
  const pendientes = deEstado('pendiente')
  const conciliados = deEstado('conciliado')
  const ajenos = deEstado('ajeno')
  const revisados = deEstado('revisado')
  // Emparejados con poca certeza: no prueban que la plata entró.
  const dudosos = conciliados.filter((c) => esEmparejamientoDudoso(c))
  const cobrosDudosos = sumar(dudosos, (c) => c.esperados.length)

  const totales: TotalesConciliacion = {
    montoSistema: sumar(conCobros, (c) => c.montoSistema),
    montoMp: sumar(casos.filter(cuentaPlata), (c) => c.montoMp),
    cobros: sumar(conCobros, (c) => c.esperados.length),
    acreditaciones: casos.filter(cuentaPlata).length,
    conciliados: sumar(conciliados, (c) => c.esperados.length),
    paraRevisar: casos.filter((c) => ESTADOS_REVISAR.has(c.estado)).length,
    pendientes: sumar(pendientes, (c) => c.esperados.length),
    sinVerificar: sumar(sinVerificar, (c) => c.esperados.length),
    montoSinVerificar: sumar(sinVerificar, (c) => c.montoSistema),
    ajenos: ajenos.length,
    montoAjeno: sumar(ajenos, (c) => c.montoMp),
    revisados: revisados.length,
    paraConfirmar: dudosos.length,
    montoParaConfirmar: sumar(dudosos, (c) => c.montoSistema),
  }

  // Nunca se netean: lo que falta y lo que sobra son dos problemas distintos.
  const faltante = sumar(soloSistema, (c) => c.montoSistema) + sumar(menor, (c) => Math.abs(c.diferencia))
  const sobrante = sumar(soloMp, (c) => c.montoMp) + sumar(mayor, (c) => c.diferencia)

  const totalPlata = totales.montoSistema
  const verificada = sumar(
    conCobros.filter((c) => !noVerificado(c, cobertura) && !esEmparejamientoDudoso(c)),
    (c) => c.montoSistema,
  )
  const pctPlata = totalPlata > 0 ? Math.floor((verificada * 100) / totalPlata) : 100

  // Las cuentas del alcance tienen que estar leídas en todo el período.
  const faltaLeer = cuentasSinLeer(e, cuentaMp)

  // Frescura: la lectura completa MÁS VIEJA de las cuentas conectadas en juego.
  let masVieja: number | null = null
  const considerar = (M: CuentaMpMotor | undefined) => {
    if (!M || !M.sincronizadaHasta || (M.status !== 'conectada' && M.status !== 'error')) return
    const h = ms(M.sincronizadaHasta)
    if (masVieja === null || h < masVieja) masVieja = h
  }
  for (const c of conCobros) considerar(c.cuentaMpId ? cuentaMp.get(c.cuentaMpId) : undefined)
  for (const id of e.cuentasDelAlcance ?? []) considerar(cuentaMp.get(id))
  const frescura = masVieja === null ? null : `Mercado Pago leído ${haceCuanto(masVieja, e.ahora)}`

  // Errores de lectura de cuentas conectadas (los que vuelven rojo el veredicto).
  // Sólo de cobros: un crédito que "podría ser" de un cobro sin verificar hereda
  // su motivo, pero su cuenta puede ser otra (la de un cobro sin cuenta).
  const svCobros = sinVerificar.filter((c) => c.esperados.length > 0)
  const casosError = svCobros.filter((c) => cobertura[c.id]?.motivo === 'error_lectura')
  const cuentasError = [
    ...new Set([
      // Un cobro sin cuenta no tiene cuenta propia: la nota dice cuál de la sucursal se cayó.
      ...casosError.map((c) => c.cuentaMpId ?? cobertura[c.id]?.cuentaMpId).filter((x): x is string => !!x),
      ...faltaLeer.conError.map((M) => M.id),
    ]),
  ]

  let tipo: Veredicto['tipo']
  const parecenCobros = conCobros.length > 0 || soloMp.length > 0 || pendientes.length > 0 || sinVerificar.length > 0
  const faltaCobertura =
    sinVerificar.length > 0 || pendientes.length > 0 || faltaLeer.sinLeer.length > 0 || faltaLeer.conError.length > 0
  let porConfirmar = false
  if (totales.paraRevisar > 0) tipo = 'no_cuadra'
  else if (faltaCobertura) tipo = casosError.length || faltaLeer.conError.length ? 'error' : 'no_se_sabe'
  else if (!parecenCobros) tipo = 'sin_movimientos'
  else if (dudosos.length) {
    // Daría "Cuadra", pero hay emparejamientos que nadie confirmó.
    tipo = 'no_se_sabe'
    porConfirmar = true
  } else tipo = 'cuadra'

  let titular: string
  let detalle: string
  const cuentasSinVerificar = new Set(sinVerificar.filter((c) => c.esperados.length > 0).map(claveCuenta)).size
  const coletillaSinVerificar =
    totales.sinVerificar > 0
      ? ` · ${plural(cuentasSinVerificar, 'Falta', 'Faltan')} verificar ${plata(totales.montoSinVerificar)} de ${cuentasSinVerificar} ${plural(cuentasSinVerificar, 'cuenta', 'cuentas')}.`
      : ''
  const n = dudosos.length
  const coletillaParaConfirmar = n ? ` · ${n} ${plural(n, 'emparejamiento', 'emparejamientos')} para confirmar.` : ''
  // Lo que está en MP y no se discute (conciliado seguro o revisado con su crédito).
  const conPlataSegura = casos.filter(
    (c) =>
      c.esperados.length > 0 &&
      !!c.movimiento &&
      ((c.estado === 'conciliado' && !esEmparejamientoDudoso(c)) || c.estado === 'revisado'),
  )

  switch (tipo) {
    case 'sin_movimientos':
      titular = `No hubo transferencias ${periodo.frase}.`
      detalle = ''
      break
    case 'cuadra': {
      const k = conPlataSegura.length
      const total = sumar(conPlataSegura, (c) => c.montoMp)
      // Cobros revisados a mano que no tienen crédito (pagó en efectivo, error de carga…).
      const revisadosSinPlata = revisados.filter((c) => c.esperados.length > 0 && !c.movimiento)
      const cobrosSinPlata = sumar(revisadosSinPlata, (c) => c.esperados.length)
      const otrosRevisados = revisados.length - revisadosSinPlata.length
      titular = 'Cuadra.'
      if (k === 0) {
        detalle = `No quedó nada para revisar: ${cobrosSinPlata} ${plural(cobrosSinPlata, 'cobro revisado', 'cobros revisados')} a mano.`
      } else {
        detalle =
          k === 1
            ? `La transferencia ${periodo.de} está en Mercado Pago: ${plata(total)}.`
            : `Las ${k} transferencias ${periodo.de} están en Mercado Pago: ${plata(total)}.`
        if (otrosRevisados) detalle += ` ${otrosRevisados} ${plural(otrosRevisados, 'revisada', 'revisadas')} a mano.`
        if (cobrosSinPlata) {
          detalle += ` ${cobrosSinPlata} ${plural(cobrosSinPlata, 'cobro revisado', 'cobros revisados')} a mano sin transferencia.`
        }
      }
      break
    }
    case 'no_cuadra': {
      if (faltante > 0 && sobrante > 0) titular = `Faltan ${plata(faltante)} y sobran ${plata(sobrante)}.`
      else if (faltante > 0) titular = `Faltan ${plata(faltante)}.`
      else if (sobrante > 0) titular = `Sobran ${plata(sobrante)}.`
      else if (otra.length) {
        const k = sumar(otra, (c) => c.esperados.length)
        titular =
          k === 1 ? 'La plata está, pero 1 cobro entró en otra cuenta.' : `La plata está, pero ${k} cobros entraron en otra cuenta.`
      } else {
        titular = `${totales.paraRevisar} ${plural(totales.paraRevisar, 'caso', 'casos')} para revisar.`
      }
      detalle =
        totales.cobros > 0
          ? `${totales.paraRevisar} para revisar · ${totales.conciliados - cobrosDudosos} de ${totales.cobros} cuadran`
          : `${totales.paraRevisar} para revisar · No hay cobros por transferencia registrados`
      if (n) detalle += ` · ${n} para confirmar`
      detalle += coletillaSinVerificar || ''
      break
    }
    case 'no_se_sabe': {
      if (porConfirmar) {
        titular = `Falta confirmar ${n} ${plural(n, 'emparejamiento', 'emparejamientos')}.`
        detalle =
          n === 1
            ? `Se encontró con poca certeza (${plata(totales.montoParaConfirmar ?? 0)}): hay que confirmarlo o descartarlo.`
            : `Se encontraron con poca certeza (${plata(totales.montoParaConfirmar ?? 0)}): hay que confirmarlos o descartarlos.`
        const k = conPlataSegura.length
        if (k === 1) detalle += ` La otra transferencia ${periodo.de} está en Mercado Pago.`
        else if (k > 1) detalle += ` Las otras ${k} transferencias ${periodo.de} están en Mercado Pago.`
      } else {
        titular = 'Todavía no se puede saber.'
        detalle = detalleNoSeSabe({ sinVerificar, pendientes, cobertura, cuentaMp, totales, faltaLeer, periodo }) + coletillaParaConfirmar
      }
      break
    }
    case 'error': {
      titular = 'No pudimos leer Mercado Pago.'
      const M = cuentaMp.get(cuentasError[0])
      const alias = M?.alias ?? casosError[0]?.alias ?? 'Una cuenta'
      const error = M?.lastError ?? 'Mercado Pago no responde'
      const desde = M?.sincronizadaHasta ? ` desde ${laHora(M.sincronizadaHasta, periodo)}` : ''
      detalle =
        cuentasError.length > 1
          ? `${alias} y ${cuentasError.length - 1} ${plural(cuentasError.length - 1, 'cuenta', 'cuentas')} más: ${error}${desde}.`
          : `${alias}: ${error}${desde}.`
      const otrasAlDia = svCobros.length === casosError.length && pendientes.length === 0 && faltaLeer.sinLeer.length === 0
      if (otrasAlDia) detalle += ' Lo de las otras cuentas está al día.'
      detalle += coletillaParaConfirmar
      break
    }
  }

  return {
    veredicto: { tipo, titular, detalle, faltante, sobrante, paraRevisar: totales.paraRevisar },
    totales,
    pctPlata,
    frescura,
  }
}

function detalleNoSeSabe(p: {
  sinVerificar: CasoConciliacion[]
  pendientes: CasoConciliacion[]
  cobertura: Record<string, NotaCobertura>
  cuentaMp: Map<string, CuentaMpMotor>
  totales: TotalesConciliacion
  faltaLeer: CuentasSinLeer
  periodo: DescripcionPeriodo
}): string {
  const { cobertura, cuentaMp, totales, faltaLeer, periodo } = p
  const partes: string[] = []
  const svCobros = p.sinVerificar.filter((c) => c.esperados.length > 0)
  const pendientesCobro = p.pendientes.filter((c) => c.esperados.length > 0)
  const creditos = p.pendientes.filter((c) => c.esperados.length === 0)
  const esperandoCobro = creditos.filter((c) => cobertura[c.id]?.motivo === 'esperando_cobro')
  const esperandoLectura = creditos.filter((c) => cobertura[c.id]?.motivo !== 'esperando_cobro')

  if (svCobros.length) {
    const n = totales.sinVerificar
    const z = plata(totales.montoSinVerificar)
    const cobros = `${n} ${plural(n, 'cobro', 'cobros')} por ${z}`
    const motivos = new Set(svCobros.map((c) => cobertura[c.id]?.motivo))
    if ([...motivos].every((m) => m && MOTIVOS_SIN_CONECTAR.has(m))) {
      const k = new Set(svCobros.map(claveCuenta)).size
      partes.push(`${plural(k, 'Falta', 'Faltan')} conectar ${k} ${plural(k, 'cuenta', 'cuentas')}: ${cobros} sin verificar.`)
    } else if ([...motivos].every((m) => m === 'banco')) {
      partes.push(
        n === 1 ? `${cobros} fue a una cuenta de banco: no se puede verificar.` : `${cobros} fueron a cuentas de banco: no se pueden verificar.`,
      )
    } else if ([...motivos].every((m) => m === 'fuera_de_lectura' || m === 'sin_lectura')) {
      partes.push(`Mercado Pago todavía no se leyó para esas fechas: ${cobros} sin verificar.`)
    } else if ([...motivos].every((m) => m === 'sin_cuenta_sucursal')) {
      partes.push(
        n === 1 ? `${cobros} se registró sin cuenta y no se puede verificar.` : `${cobros} se registraron sin cuenta y no se pueden verificar.`,
      )
    } else partes.push(`${cobros} sin verificar.`)
  } else if (p.sinVerificar.length) {
    // Sólo créditos que podrían ser de cobros de otra sucursal sin verificar.
    const k = p.sinVerificar.length
    partes.push(`${k} ${plural(k, 'transferencia podría ser', 'transferencias podrían ser')} de cobros que no se pueden verificar.`)
  } else if (pendientesCobro.length || esperandoLectura.length || faltaLeer.sinLeer.length) {
    // Hasta dónde se leyó la cuenta más atrasada de las que importan.
    let min: number | null = null
    let sinHora = false
    for (const c of [...pendientesCobro, ...esperandoLectura]) {
      if (!c.cuentaMpId) continue // registrado sin cuenta: depende de varias cuentas a la vez
      const M = cuentaMp.get(c.cuentaMpId)
      if (!M?.sincronizadaHasta) {
        sinHora = true
        continue
      }
      const h = ms(M.sincronizadaHasta)
      if (min === null || h < min) min = h
    }
    let nunca = false
    for (const M of faltaLeer.sinLeer) {
      if (!M.sincronizadaHasta) {
        nunca = true
        continue
      }
      const h = ms(M.sincronizadaHasta)
      if (min === null || h < min) min = h
    }
    if (faltaLeer.sinFecha) partes.push('Mercado Pago todavía no se leyó para esas fechas.')
    else if (sinHora || (min === null && pendientesCobro.length)) {
      partes.push('Mercado Pago todavía no se leyó hasta la hora de los últimos cobros.')
    } else if (min === null || nunca) partes.push('Mercado Pago todavía no se leyó.')
    else partes.push(`Mercado Pago todavía no se leyó hasta ${laHora(min, periodo)}.`)
  }
  if (esperandoCobro.length) {
    const k = esperandoCobro.length
    partes.push(
      k === 1
        ? '1 transferencia reciente espera que se registre su cobro.'
        : `${k} transferencias recientes esperan que se registre su cobro.`,
    )
  }
  return partes.join(' ')
}

/** La tira de días: el veredicto de cada día, cortando UNA corrida del motor (los cruces de medianoche quedan bien). */
export function resumirDias(
  casos: CasoConciliacion[],
  cobertura: Record<string, NotaCobertura>,
  cuentasMp: CuentaMpMotor[],
  dias: string[],
  ahora: Date,
  opciones: { cuentasDelAlcance?: string[] } = {},
): ResumenDia[] {
  const porDia = new Map<string, CasoConciliacion[]>()
  for (const c of casos) {
    const l = porDia.get(c.dia) ?? []
    l.push(c)
    porDia.set(c.dia, l)
  }
  return dias.map((dia) => {
    const delDia = porDia.get(dia) ?? []
    const { desde, hasta } = periodoDeDias(dia, dia)
    const r = resumir({
      casos: delDia,
      cobertura,
      cuentasMp,
      periodo: describirPeriodo(desde, hasta, ahora),
      ahora,
      cuentasDelAlcance: opciones.cuentasDelAlcance,
      rango: { desde, hasta },
    })
    const conCobros = delDia.filter((c) => c.esperados.length > 0)
    const sinCubrir = conCobros.filter((c) => c.estado === 'sin_verificar' || c.estado === 'pendiente' || noVerificado(c, cobertura))
    let cobertura_: ResumenDia['cobertura'] =
      conCobros.length === 0 || sinCubrir.length === 0 ? 'total' : sinCubrir.length === conCobros.length ? 'nula' : 'parcial'
    // Sin cobros, pero con cuentas que no se leyeron ese día: no se sabe si entró algo.
    if (conCobros.length === 0 && (r.veredicto.tipo === 'no_se_sabe' || r.veredicto.tipo === 'error')) cobertura_ = 'parcial'
    return {
      dia,
      tipo: r.veredicto.tipo,
      faltante: r.veredicto.faltante,
      sobrante: r.veredicto.sobrante,
      paraRevisar: r.veredicto.paraRevisar,
      cobros: r.totales.cobros,
      cobertura: cobertura_,
    }
  })
}

/** Nombre de pila (para Tex y la narrativa: lo mínimo para reconocer a alguien). */
export function nombreDePila(s: string | null | undefined): string | null {
  return primerNombre(s)
}
