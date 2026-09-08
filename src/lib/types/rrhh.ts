// Tipos del módulo de Recursos Humanos (candidatos a barbero que llegan por el CRM).
// Espejan lo que devuelven las RPC de la migración 213: si cambia una, cambia el otro.

export type EstadoCandidato =
  | 'nuevo'
  | 'contactado'
  | 'entrevista'
  | 'prueba'
  | 'contratado'
  | 'descartado'

/** Por dónde se le puede escribir HOY a este candidato. Lo calcula la RPC. */
export type AlcanceCandidato =
  /** WhatsApp con teléfono: la plantilla llega dentro y fuera de la ventana de 24 h. */
  | 'whatsapp'
  /** Instagram con la ventana abierta: sólo texto libre (Meta no tiene plantillas en IG). */
  | 'instagram'
  /** Instagram fuera de ventana y sin teléfono cargado: no hay forma de escribirle desde acá. */
  | 'no'

export interface Candidato {
  conversation_id: string
  canal: 'whatsapp' | 'instagram'
  platform_user_id: string
  nombre: string
  handle: string | null
  avatar_url: string | null
  client_id: string | null
  telefono: string | null
  estado: EstadoCandidato
  puntaje: number | null
  notas: string | null
  motivo_descarte: string | null
  staff_id: string | null
  contactado_at: string | null
  /** El primer mensaje entrante con texto: en los hechos, su carta de presentación. */
  primer_mensaje: string | null
  primer_contacto_at: string | null
  ultimo_mensaje_at: string | null
  /** Espejo optimista de `conversations.can_reply_until`, no una promesa de Meta. */
  ventana_abierta: boolean
  n_fotos: number
  n_videos: number
  n_docs: number
  n_audios: number
  /**
   * Adjuntos de Instagram cuya URL del CDN de Meta ya caducó. NO se pueden
   * recuperar: la API de Instagram Login no devuelve `attachments` para ningún
   * mensaje (ver el comentario largo en src/lib/actions/rrhh.ts). El webhook ya
   * los persiste, así que este número sólo puede bajar.
   */
  n_media_rota: number
  /** El teléfono coincide con un miembro activo del equipo: casi seguro un falso positivo de la IA. */
  es_staff: boolean
  es_cliente_real: boolean
  alcance: AlcanceCandidato
  /**
   * Hasta 4 miniaturas del trabajo del candidato, resueltas en la misma consulta.
   * Sin esto la tarjeta tendría que pedir los medios de a uno (N+1 sobre 206 fichas).
   * Excluye lo vencido y los links de instagram.com, que no son archivos.
   */
  muestras: Array<{ url: string; tipo: string }>
  total_rows: number
}

export interface MetricasRrhh {
  total: number
  nuevo: number
  contactado: number
  entrevista: number
  prueba: number
  contratado: number
  descartado: number
  whatsapp: number
  instagram: number
  alcanzables_wa: number
  alcanzables_ig: number
  sin_alcance: number
  con_material: number
  del_equipo: number
  /** Archivos de Instagram perdidos. Sólo informativo: no hay forma de rescatarlos. */
  media_vencida: number
  nuevos_30d: number
}

export interface FiltrosCandidatos {
  estados?: EstadoCandidato[]
  canal?: 'whatsapp' | 'instagram'
  busqueda?: string
  soloConMaterial?: boolean
  soloAlcanzables?: boolean
  orden?: 'reciente' | 'antiguo' | 'material' | 'puntaje'
  limit?: number
  offset?: number
}

export interface MensajeCandidato {
  id: string
  direction: 'inbound' | 'outbound'
  content_type: string
  content: string | null
  media_url: string | null
  media_vencida: boolean
  status: string | null
  created_at: string
}

export interface PlantillaRrhh {
  name: string
  language: string
  category: string
  status: string
  /** Texto del BODY, para previsualizar sin volver a Meta. */
  cuerpo: string | null
  /** Cuántas variables {{n}} declara el BODY. Una de más o de menos = 132000. */
  variables: number
}

export type EstadoDifusion = 'borrador' | 'enviando' | 'enviada' | 'cancelada'

export interface DifusionRrhh {
  id: string
  nombre: string
  template_name: string
  template_language: string
  texto_instagram: string | null
  estado: EstadoDifusion
  total: number
  enviados: number
  fallidos: number
  omitidos: number
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface DestinatarioDifusion {
  id: string
  conversation_id: string
  canal: 'whatsapp' | 'instagram'
  nombre: string | null
  destino: string | null
  estado: 'pendiente' | 'enviando' | 'enviado' | 'fallido' | 'omitido'
  motivo: string | null
  sent_at: string | null
}

/** Lo que devuelve cada lote de envío, para la barra de progreso. */
export interface ResultadoLote {
  enviados: number
  fallidos: number
  /** Incluye los que están en vuelo (tomados por un lote que todavía no terminó). */
  pendientes: number
  /**
   * Los que nunca se van a mandar (del equipo, descartados, sin alcance).
   * Están en `total` pero no en el denominador del progreso: sin descontarlos,
   * una difusión completa mostraba la barra en 59 %.
   */
  omitidos: number
  total: number
  terminado: boolean
  /** Primeros errores del lote, para mostrarlos sin abrir el detalle. */
  errores: Array<{ nombre: string; motivo: string }>
}

export const ESTADOS_CANDIDATO: Array<{ id: EstadoCandidato; label: string; descripcion: string }> = [
  { id: 'nuevo', label: 'Sin revisar', descripcion: 'Escribió y todavía nadie lo miró' },
  { id: 'contactado', label: 'Contactado', descripcion: 'Ya le escribimos' },
  { id: 'entrevista', label: 'Entrevista', descripcion: 'Quedamos en vernos' },
  { id: 'prueba', label: 'En prueba', descripcion: 'Vino a hacer una prueba' },
  { id: 'contratado', label: 'Contratado', descripcion: 'Se sumó al equipo' },
  { id: 'descartado', label: 'Descartado', descripcion: 'No sigue en el proceso' },
]
