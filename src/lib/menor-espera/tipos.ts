/**
 * Tipos de «Menor espera por WhatsApp» (migración 218).
 *
 * Viven acá y no en `src/lib/types/database.ts` porque los comparten un módulo
 * plano (webhook), un archivo 'use server' (que no puede re-exportar tipos) y
 * un componente de cliente.
 */

export type EstadoOferta = 'en_cola' | 'enviada' | 'fallida' | 'aceptada' | 'rechazada' | 'vencida'

/** Lo que devuelve `menor_espera_responder`. */
export type ResultadoRespuesta =
  | 'movida'
  | 'ya_estaba_en_menor_espera'
  | 'rechazada'
  | 'rechazada_en_menor_espera'
  | 'rechazada_otro_barbero'
  | 'ya_estaba_en_menor_espera_no'
  | 'ya_lo_atienden'
  | 'ya_atendido'
  | 'fuera_de_fila'
  | 'es_turno'
  | 'prueba'
  | 'no_encontrada'
  | 'telefono_no_coincide'
  | 'invalida'

export interface RespuestaRpc {
  resultado: ResultadoRespuesta
  cambio: boolean
  segundos_desde_respuesta_previa?: number | null
  oferta_id?: string
  es_prueba?: boolean
  respuesta?: 'si' | 'no'
  cliente?: string | null
  barbero?: string | null
  barbero_actual?: string | null
  sucursal?: string | null
}

/** Lo que devuelve `menor_espera_contexto` (uno por mensaje entrante). */
export interface ContextoRpc {
  botones: string[] | null
  boton: { id: string; es_prueba: boolean; estado: EstadoOferta; cliente?: string | null } | null
  texto: { id: string; es_prueba: boolean; estado: EstadoOferta; cliente?: string | null } | null
  contexto: { id: string; estado: EstadoOferta; cliente: string | null; aviso_recepcion: boolean } | null
  /**
   * Mig 222: la oferta más reciente que ese teléfono RECIBIÓ en los últimos 30
   * días, aunque ya no esté esperando. Sólo viene si el webhook avisó que el
   * texto es un pedido de baja (`p_es_baja`).
   */
  baja?: { id: string; cliente: string | null } | null
}

// ── Panel del dashboard ──────────────────────────────────────────────────────

export interface PlantillaPanel {
  existe: boolean
  nombre: string
  idioma?: string | null
  /**
   * Estado guardado por el sync, en minúsculas: approved | pending | rejected |
   * paused | disabled | in_appeal | pending_deletion (los cuatro últimos, desde
   * la mig 222).
   */
  estado?: string | null
  /** utility | marketing | authentication, como la categorizó Meta. */
  categoria?: string | null
  forma_ok?: boolean
  componentes?: unknown
  botones?: string[]
}

export interface LatidoPanel {
  ultimo_tick_at: string | null
  ultimo_error: string | null
  ultimo_error_at: string | null
  disyuntor_desde: string | null
  disyuntor_error: string | null
  disyuntor_alerta_id: string | null
  /** Mig 222: pausado porque salieron avisos y no entró ningún mensaje verificado de Meta. */
  sin_entrada_desde?: string | null
  sin_entrada_alerta_id?: string | null
}

/** Conteo de POST del webhook por resultado de la firma de Meta. */
export interface ConteoFirmas {
  validas: number
  invalidas: number
  sin_firma: number
  sin_secreto: number
}

/**
 * Mig 222: la firma de Meta (x-hub-signature-256) en el webhook de WhatsApp,
 * medida con tráfico real. El corte de Menor espera sólo mueve a alguien con
 * firma válida, y no se puede prender sin una válida en las últimas 24 h.
 */
export interface WebhookPanel {
  tiene_app_secret: boolean
  ultima_valida_at: string | null
  ultima_invalida_at: string | null
  ultima_sin_firma_at: string | null
  ultimo_post_at: string | null
  ultimo_mensaje_at: string | null
  hoy: ConteoFirmas
  /** Últimos 7 días, hoy incluido. */
  semana: ConteoFirmas
}

/** Un cliente que no recibe estos avisos (por WhatsApp o cargado a mano). */
export interface BajaPanel {
  client_id: string
  cliente: string | null
  /** Sólo los últimos 4 dígitos: alcanza para reconocerlo sin exponer el número. */
  telefono_final: string | null
  creada_at: string
  /** Lo que escribió, o la marca de la baja manual. */
  mensaje: string | null
}

export interface MetricasPanel {
  enviadas: number
  aceptaron: number
  prefirieron_esperar: number
  sin_respuesta: number
  no_salieron: number
  atendidos_por_otro: number
  /** Mediana de minutos entre el «Sí» y el inicio de la atención. */
  mediana_min_hasta_atencion: number | null
}

export interface SucursalPanel {
  id: string
  name: string
  is_active: boolean
  menor_espera_aviso: boolean
  business_hours_open: string | null
  business_hours_close: string | null
}

export interface OfertaPanel {
  id: string
  estado: EstadoOferta
  respuesta: 'si' | 'no' | null
  resultado: string | null
  error: string | null
  es_prueba: boolean
  minutos_espera: number
  barberos_libres: number
  creada_at: string
  enviada_at: string | null
  respondida_at: string | null
  atendido_at: string | null
  cliente: string | null
  barbero: string | null
  atendio: string | null
  sucursal: string | null
  /** Estado del envío en scheduled_messages (sent/failed/pending/…). */
  envio: string | null
}

export interface PanelMenorEspera {
  /** Hora del servidor: las fechas relativas se miden contra esto, no contra el reloj del browser. */
  ahora: string
  config: {
    minutos: number
    plantilla: string
    /** Mig 222: el dueño aceptó que salga como mensaje de MARKETING. */
    acepta_marketing: boolean
  }
  transporte: { baileys: boolean; whatsapp: boolean }
  plantilla: PlantillaPanel
  latido: LatidoPanel | null
  metricas: MetricasPanel
  /** Mig 222. `null` = la base no tiene la 222 (la card no deja prender). */
  webhook: WebhookPanel | null
  bajas: number
  /** Las más recientes (hasta 30). */
  bajas_lista: BajaPanel[]
  /** Pruebas de hoy que cuentan para el tope de 3: las que salieron o están por salir. */
  pruebas_hoy: number
  /** Todas las de hoy, fallidas incluidas (techo de 10). */
  pruebas_intentos_hoy: number
  sucursales: SucursalPanel[]
  ofertas: OfertaPanel[]
  /** settings.manage: si es false la card se muestra en sólo lectura. */
  puedeEditar: boolean
}
