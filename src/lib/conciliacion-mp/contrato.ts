// =============================================================================
// src/lib/conciliacion-mp/contrato.ts
// El contrato entre el motor de conciliación con Mercado Pago (servidor) y su
// pantalla (/dashboard/conciliacion), el panel de Tex y la página pública del
// titular. Isomórfico: sólo tipos y constantes.
//
// LO QUE SE COMPARA
// -----------------
// Lado sistema ("esperado"): cada cobro por transferencia (transfer_logs:
// monto neto de seña + propina transferida, a la hora en que se confirmó el
// cobro), más las transferencias sin cuenta y las propinas transferidas sueltas.
// Lado Mercado Pago ("movimiento"): cada crédito aprobado de la cuenta.
//
// El monto NO es una clave: el 90 % de los cobros es de $18.000 y en ±2 h el
// 94 % tiene un gemelo en la misma cuenta (relevado el 21/10/2026). El motor
// empareja en ORDEN con una ventana angosta (MP acredita ~1 min antes de que se
// registre el cobro) y el veredicto ("cuadra / faltan / sobran") sale de una
// verificación agregada por cuenta, día y monto, que no depende de a qué visita
// se atribuyó cada transferencia.
//
// KNOWN RISK #15: una cuenta sin conectar, con error o sin leer hasta el final
// del período es "sin verificar" o "pendiente", y eso BLOQUEA el "Cuadra".
// Nunca se muestra en verde lo que no se pudo leer.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Casos
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCaso =
  | 'conciliado' // cuadra (exacto, cobro conjunto, o con demora)
  | 'otra_cuenta' // la plata entró, pero a otra cuenta de la organización
  | 'monto_mayor' // entró más de lo registrado (propina o producto sin cargar)
  | 'monto_menor' // entró menos de lo registrado
  | 'solo_sistema' // registrado por transferencia y no está en Mercado Pago
  | 'solo_mp' // entró en Mercado Pago y no está en el sistema
  | 'pendiente' // Mercado Pago todavía no se leyó hasta esa hora
  | 'sin_verificar' // cuenta sin conectar, con error o de banco
  | 'ajeno' // no parece un cobro (fuera de horario, rendimiento, monto raro)
  | 'revisado' // una persona lo revisó y dejó el motivo

/** Cuatro colores, siempre con ícono y palabra: verde, ámbar, gris, rojo. */
export type TonoCaso = 'ok' | 'revisar' | 'desconocido' | 'error'

export const TONO_DE_ESTADO: Record<EstadoCaso, TonoCaso> = {
  conciliado: 'ok',
  otra_cuenta: 'revisar',
  monto_mayor: 'revisar',
  monto_menor: 'revisar',
  solo_sistema: 'revisar',
  solo_mp: 'revisar',
  pendiente: 'desconocido',
  sin_verificar: 'desconocido',
  ajeno: 'desconocido',
  revisado: 'desconocido',
}

export const ETIQUETA_ESTADO: Record<EstadoCaso, string> = {
  conciliado: 'Cuadra',
  otra_cuenta: 'Entró en otra cuenta',
  monto_mayor: 'Entró de más',
  monto_menor: 'Entró de menos',
  solo_sistema: 'No está en Mercado Pago',
  solo_mp: 'No está en el sistema',
  pendiente: 'Esperando a Mercado Pago',
  sin_verificar: 'Sin verificar',
  ajeno: 'No parece un cobro',
  revisado: 'Revisado',
}

/** Estados que cuentan como "para revisar" (los ámbar). */
export const ESTADOS_PARA_REVISAR: readonly EstadoCaso[] = [
  'otra_cuenta',
  'monto_mayor',
  'monto_menor',
  'solo_sistema',
  'solo_mp',
]

export type Confianza = 'alta' | 'media' | 'baja'

/** Lo que respalda un emparejamiento. Se muestran como píldoras en el detalle. */
export type SenalCruce =
  | 'nro_operacion' // el número de operación del comprobante es el id del pago en MP
  | 'mismo_monto'
  | 'hora' // dentro de la ventana esperada (MP ~1 min antes del registro)
  | 'pagador' // el remitente del comprobante coincide con el pagador de MP
  | 'hora_comprobante' // la hora leída del comprobante coincide con la de MP
  | 'grupo' // un crédito cubre varios cobros (cobro conjunto)
  | 'manual' // lo vinculó una persona

export const ETIQUETA_SENAL: Record<SenalCruce, string> = {
  nro_operacion: 'Nº de operación igual',
  mismo_monto: 'Mismo monto',
  hora: 'Hora coherente',
  pagador: 'Mismo pagador',
  hora_comprobante: 'Hora del comprobante igual',
  grupo: 'Cobro conjunto',
  manual: 'Vinculado a mano',
}

/**
 * Un emparejamiento que el motor encontró con poca certeza: ventana amplia
 * (confianza 'baja') o un crédito que suma varios cobros sin marcar ('grupo'
 * que no vinculó una persona). Se muestra con su explicación, pero NO prueba
 * que la plata entró: el día no se pinta "Cuadra" hasta que alguien lo
 * confirma con un vínculo (que lo convierte en 'manual') o lo descarta con
 * "No es este" (un rechazo del par: cada lado sigue su camino). Motor y
 * pantalla usan esta misma definición.
 */
export function esEmparejamientoDudoso(c: Pick<CasoConciliacion, 'estado' | 'confianza' | 'senales'>): boolean {
  if (c.estado !== 'conciliado' || c.senales.includes('manual')) return false
  return c.confianza === 'baja' || c.senales.includes('grupo')
}

/** Un emparejamiento dudoso (`esEmparejamientoDudoso`): está conciliado, pero falta que alguien lo confirme. */
export const ETIQUETA_PARA_CONFIRMAR = 'Para confirmar'

/**
 * Un crédito 'pendiente' (sin cobros: `esperados` vacío) no espera a Mercado
 * Pago —ya entró—: espera que se registre su cobro, o que se lea el tramo de
 * su cobro.
 */
export const ETIQUETA_PENDIENTE_CREDITO = 'Esperando el cobro'

/**
 * La etiqueta de UN caso. Igual que `ETIQUETA_ESTADO[c.estado]`, salvo un
 * emparejamiento dudoso ("Para confirmar") y un crédito pendiente ("Esperando
 * el cobro"), que con la etiqueta del estado dirían algo falso ("Cuadra",
 * "Esperando a Mercado Pago").
 */
export function etiquetaDeCaso(c: Pick<CasoConciliacion, 'estado' | 'confianza' | 'senales' | 'esperados'>): string {
  if (esEmparejamientoDudoso(c)) return ETIQUETA_PARA_CONFIRMAR
  if (c.estado === 'pendiente' && c.esperados.length === 0) return ETIQUETA_PENDIENTE_CREDITO
  return ETIQUETA_ESTADO[c.estado]
}

export type TipoEsperado = 'cobro' | 'sin_cuenta' | 'propina_suelta'

export interface ComprobanteEvidencia {
  id: string
  operacion: string | null
  remitente: string | null
  monto: number | null
  /** Sólo hora y minuto leídos (la fecha que lee la IA no sirve). */
  hhmm: string | null
  estado: string | null
  tieneImagen: boolean
}

export interface EsperadoMP {
  /** 'tl:<transfer_log>' | 'sc:<visit>' | 'pr:<visit>' */
  clave: string
  tipo: TipoEsperado
  transferLogId: string | null
  visitId: string | null
  paymentAccountId: string | null
  /** La cuenta de MP a la que apunta la cuenta de cobro (null: sin conectar o sin cuenta). */
  cuentaMpId: string | null
  alias: string | null
  sucursalId: string | null
  sucursal: string | null
  /** Lo que tendría que haber entrado: monto neto de seña + propina transferida. */
  monto: number
  propina: number
  /** ISO. La hora en que se confirmó el cobro (no la de MP). */
  tSistema: string
  coveringReceiptId: string | null
  barbero: string | null
  cliente: string | null
  servicio: string | null
  /** Alta manual o venta directa: la hora la cargó una persona, redondeada al minuto. */
  esManual: boolean
  comprobante: ComprobanteEvidencia | null
}

export type TipoMovimiento =
  | 'transferencia'
  | 'qr'
  | 'link'
  | 'tarjeta'
  | 'point'
  | 'rendimiento'
  | 'devolucion'
  | 'otro'

export interface MovimientoMP {
  id: string
  cuentaMpId: string
  /** El id del pago en Mercado Pago. */
  mpId: string
  tipo: TipoMovimiento
  monto: number
  /** ISO. date_approved (o date_created). */
  fecha: string
  pagador: string | null
  /** Últimos 4 dígitos del documento del pagador, si MP lo dio. */
  pagadorDocUlt4: string | null
  descripcion: string | null
  /** Campos crudos de MP, para auditar la clasificación. */
  operationType: string | null
  paymentTypeId: string | null
  paymentMethodId: string | null
}

export interface CandidatoCruce {
  movimientoId: string
  monto: number
  fecha: string
  alias: string | null
  /** "Mismo monto, 14 min después" */
  motivo: string
  probabilidad: 'muy_probable' | 'probable' | 'posible'
  /**
   * Sólo en los candidatos de un caso 'solo_mp' (el candidato es un COBRO sin
   * pareja): sus transfer_logs, para `resolverCaso({ tipo: 'vinculo',
   * transferLogIds, movimientoId })`, y el id de su caso para abrirlo. En ese
   * caso `movimientoId` es el del propio caso.
   */
  transferLogIds?: string[]
  casoId?: string
}

export type MotivoRevision =
  | 'propina'
  | 'pago_personal'
  | 'sena'
  | 'error_carga'
  | 'dos_transferencias'
  | 'pago_en_efectivo'
  | 'otro'

export const MOTIVOS_REVISION: { id: MotivoRevision; etiqueta: string }[] = [
  { id: 'propina', etiqueta: 'Era la propina' },
  { id: 'dos_transferencias', etiqueta: 'Pagó en dos transferencias' },
  { id: 'pago_en_efectivo', etiqueta: 'Pagó la diferencia en efectivo' },
  { id: 'pago_personal', etiqueta: 'Plata personal del titular' },
  { id: 'sena', etiqueta: 'Era una seña' },
  { id: 'error_carga', etiqueta: 'Error de carga (ya corregido)' },
  { id: 'otro', etiqueta: 'Otro' },
]

export interface ResolucionVista {
  id: string
  tipo: 'vinculo' | 'revisado'
  motivo: MotivoRevision | null
  nota: string | null
  por: string | null
  /** ISO */
  en: string
  /**
   * Todas las filas de esta resolución que tocan el caso (un vínculo de un
   * cobro conjunto son N filas). `deshacerResolucion(ids)` las deshace juntas.
   */
  ids?: string[]
}

/**
 * Un emparejamiento que una persona descartó con "No es este" (mig 230): ese
 * cobro y ese crédito no se vuelven a juntar en ninguna pasada automática.
 * Visto desde UN caso: un crédito descartado para sus cobros ('credito') o un
 * cobro descartado para su crédito ('cobro'). Un vínculo a mano del mismo par
 * manda sobre el descarte (y entonces no aparece acá).
 */
export interface RechazoVista {
  /** Las filas de mp_conciliacion_rechazos: `deshacerRechazo(ids)` las deshace juntas. */
  ids: string[]
  /** Qué se descartó, visto desde este caso. */
  lado: 'credito' | 'cobro'
  movimientoId: string
  transferLogIds: string[]
  /** El monto, la hora (ISO) y la cuenta de lo descartado (el crédito o el cobro). */
  monto: number
  fecha: string
  alias: string | null
  /** Quién lo descartó y cuándo (ISO). */
  por: string | null
  en: string | null
}

export interface CasoConciliacion {
  /** Estable entre cargas: 'tl:<id>' | 'mov:<id>' | 'grupo:<mov>' | 'sc:<visit>' … */
  id: string
  estado: EstadoCaso
  tono: TonoCaso
  confianza: Confianza | null
  senales: SenalCruce[]
  /** Explicación determinística, corta: "Mismo monto, entró 1 min antes del cobro." */
  explicacion: string
  /** Mercado Pago − sistema. 0 si cuadra; > 0 entró de más; < 0 entró de menos. */
  diferencia: number
  montoSistema: number
  montoMp: number
  /** t_sistema − t_mp, en segundos (positivo: MP antes del registro, lo normal). */
  retrasoSeg: number | null
  /** ISO, para ordenar. */
  fecha: string
  /** YYYY-MM-DD en hora argentina. */
  dia: string
  cuentaMpId: string | null
  /** Alias de la cuenta del registro (o la del movimiento si no hay registro). */
  alias: string | null
  /** Si entró en otra cuenta: el alias donde entró. */
  aliasMp: string | null
  sucursalId: string | null
  esperados: EsperadoMP[]
  movimiento: MovimientoMP | null
  candidatos: CandidatoCruce[]
  resolucion: ResolucionVista | null
  /**
   * Lo que una persona descartó para este caso ("No es este"): los créditos
   * descartados para sus cobros y los cobros descartados para su crédito. Sólo
   * los que se pueden describir (el otro lado está en lo que se leyó). Ausente
   * si no hay ninguno.
   */
  rechazados?: RechazoVista[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuentas
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCuenta =
  | 'al_dia' // leída hasta hace poco
  | 'atrasada' // la última lectura completa es vieja
  | 'sin_conectar'
  | 'error' // MP no responde o el token falló
  | 'revocada' // el titular quitó el permiso
  | 'banco' // no es de Mercado Pago: no tiene API
  | 'sin_alias' // cuenta de cobro sin alias: no se puede mapear

export interface CuentaConciliacion {
  /** mp_cuenta_id, o 'pa:<payment_account_id>' si todavía no está conectada. */
  id: string
  cuentaMpId: string | null
  /** Alias principal (el de la cuenta de cobro). */
  alias: string | null
  aliases: string[]
  /** Titular cargado en el sistema (payment_accounts.name). */
  titular: string | null
  /** Lo que dice Mercado Pago (nombre o nickname), para confirmar la cuenta. */
  titularMp: string | null
  emailMp: string | null
  sucursales: { id: string; nombre: string }[]
  paymentAccountIds: string[]
  activa: boolean
  estado: EstadoCuenta
  /** "Leída hace 8 min" · "El titular quitó el permiso" · "Mercado Pago no responde desde las 9:12" */
  detalleEstado: string
  /** ISO: hasta dónde la lectura está completa. */
  sincronizadaHasta: string | null
  ultimaSync: string | null
  /** El dueño confirmó que la cuenta autorizada es la correcta. */
  confirmada: boolean
  modo: 'oauth' | 'manual' | null
  periodo: { cobros: number; montoSistema: number; montoMp: number; paraRevisar: number }
  /** % de lo transferido en los últimos 30 días que entró por esta cuenta (para priorizar). */
  pctPlata30d: number
  linkPendiente: { id: string; venceEn: string; abierto: boolean } | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado
// ─────────────────────────────────────────────────────────────────────────────

export type TipoVeredicto = 'cuadra' | 'no_cuadra' | 'no_se_sabe' | 'sin_movimientos' | 'error'

export interface Veredicto {
  tipo: TipoVeredicto
  /** "Cuadra." · "Faltan $26.000." · "Faltan $26.000 y sobran $18.000." · "Todavía no se puede saber." */
  titular: string
  /** La segunda línea: qué se contó, qué falta verificar. */
  detalle: string
  /** Lo que falta (no está en MP + entró de menos). Nunca se netea con lo que sobra. */
  faltante: number
  /** Lo que sobra (no está en el sistema + entró de más). */
  sobrante: number
  paraRevisar: number
}

export interface TotalesConciliacion {
  montoSistema: number
  montoMp: number
  cobros: number
  acreditaciones: number
  conciliados: number
  paraRevisar: number
  pendientes: number
  sinVerificar: number
  montoSinVerificar: number
  ajenos: number
  montoAjeno: number
  revisados: number
  /** Conciliados con poca certeza (`esEmparejamientoDudoso`): falta que alguien los confirme. */
  paraConfirmar?: number
  /** Su plata (no cuenta como verificada en `pctPlata`). */
  montoParaConfirmar?: number
}

export interface ResultadoConciliacion {
  ok: true
  periodo: { desde: string; hasta: string; etiqueta: string }
  generadoEn: string
  veredicto: Veredicto
  totales: TotalesConciliacion
  cobertura: {
    cuentasConectadas: number
    /** Cuentas con cobros esperados en el período. */
    cuentasConCobros: number
    /** % del monto esperado que tiene una cuenta de MP leída hasta el final del período. */
    pctPlata: number
    /** "Mercado Pago leído hace 6 min" (la lectura más vieja de las cuentas en juego). */
    frescura: string | null
  }
  cuentas: CuentaConciliacion[]
  /** Todos los casos menos los 'ajeno' (ésos van sólo contados, sin pagador). */
  casos: CasoConciliacion[]
  /** 1 a 3 frases por plantilla (sin IA): lo más urgente primero. */
  narrativa: string[]
  /** La app de OAuth de conciliación está configurada (env MP_CONCILIACION_*). */
  oauthDisponible: boolean
}

export type RespuestaConciliacion = ResultadoConciliacion | { ok: false; error: string }

export interface ResumenDia {
  /** YYYY-MM-DD */
  dia: string
  tipo: TipoVeredicto
  faltante: number
  sobrante: number
  paraRevisar: number
  cobros: number
  cobertura: 'total' | 'parcial' | 'nula'
}

export type RespuestaTira = { ok: true; dias: ResumenDia[] } | { ok: false; error: string }

// ─────────────────────────────────────────────────────────────────────────────
// Sincronización y conexión
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoSync {
  ok: boolean
  cuentaMpId: string
  alias: string | null
  leidos: number
  nuevos: number
  actualizados: number
  /** ISO: hasta dónde quedó completa la lectura. */
  sincronizadaHasta: string | null
  /** 'candado': otra corrida en curso · 'reciente': se leyó hace muy poco. */
  omitida?: 'candado' | 'reciente'
  error?: string
}

export interface IdentidadMP {
  mpUserId: string
  nickname: string | null
  titular: string | null
  emailEnmascarado: string | null
  liveMode: boolean
}

export type ResultadoVerificarToken =
  | { ok: true; identidad: IdentidadMP; yaConectadaComo: string[] }
  | { ok: false; error: string }

export interface LinkConexion {
  id: string
  url: string
  /** ISO */
  venceEn: string
  mensajeWhatsApp: string
  urlWhatsApp: string
}

export type EstadoLink = 'pendiente' | 'abierto' | 'conectada' | 'vencido' | 'anulado'

export type RespuestaEstadoLink =
  | { ok: true; estado: EstadoLink; cuentaMpId: string | null; titularMp: string | null }
  | { ok: false; error: string }

/** Tiempos del motor (exportados para la UI y los textos). */
export const CONCILIACION = {
  /** Ventana principal: MP entre 10 min antes y 2 min después del registro. */
  ventanaAntesSeg: 10 * 60,
  ventanaDespuesSeg: 2 * 60,
  /** Retraso típico medido: MP ~60 s antes del registro. */
  retrasoTipicoSeg: 60,
  /** Ventana amplia para candidatos únicos (altas manuales, cobros tardíos). */
  ventanaAmpliaAntesSeg: 90 * 60,
  ventanaAmpliaDespuesSeg: 15 * 60,
  /** Un cobro conjunto: hasta 4 cobros de la misma cuenta dentro de 25 min. */
  grupoMax: 4,
  grupoVentanaSeg: 25 * 60,
  /** Lo cobrado en los últimos 15 min antes de la última lectura completa queda "pendiente". */
  margenPendienteSeg: 15 * 60,
  /** Horario en el que un crédito sin registro "parece un cobro". */
  horarioDesde: '09:30',
  horarioHasta: '22:30',
  /** Link para que el titular autorice: un uso, 72 h. */
  linkHoras: 72,
  /** Primera lectura de una cuenta recién conectada. */
  backfillDias: 60,
  /** Lectura automática al abrir la pantalla si la última tiene más de esto. */
  autoSyncMin: 10,
} as const
