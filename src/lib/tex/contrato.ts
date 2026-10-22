// =============================================================================
// src/lib/tex/contrato.ts
// El contrato entre el servidor de Tex (/api/tex/chat, src/lib/tex/*) y su UI
// (/dashboard/asistente, el panel lateral, los bloques). Isomórfico: sólo tipos,
// constantes y zod. Nada de 'server-only', React ni el SDK de Anthropic.
//
// CÓMO VIAJA UNA RESPUESTA
// ------------------------
// El servidor llama a Claude con el SDK oficial (@anthropic-ai/sdk) y le habla
// al browser con el protocolo de UI-message-stream del AI SDK v5, así el
// cliente sigue usando `useChat`. Cada herramienta devuelve DOS cosas: lo que
// lee el modelo (compacto, JSON) y lo que ve la persona (`TexSalidaUI`: bloques
// de KPIs, gráficos, tablas, informes). La parte de la herramienta en el
// mensaje es `type: 'tool-<nombre>'` con `output: TexSalidaUI`.
//
// El cliente manda SOLO el último mensaje + el id de la conversación. El
// historial lo tiene el servidor (assistant_messages.model_messages): así nadie
// puede inyectarle a Claude un "resultado de herramienta" inventado.
// =============================================================================

import { z } from 'zod'
import type { UIMessage } from 'ai'

// ─────────────────────────────────────────────────────────────────────────────
// Modelo
// ─────────────────────────────────────────────────────────────────────────────

export const TEX_MODELO = 'claude-haiku-5-5' as const
export const TEX_MODELO_ETIQUETA = 'Claude Haiku 5.5'

export type TexEsfuerzo = 'low' | 'medium' | 'high'

export const TEX_ESFUERZOS: { id: TexEsfuerzo; etiqueta: string; detalle: string }[] = [
  { id: 'low', etiqueta: 'Rápido', detalle: 'Responde en menos tiempo. Para preguntas simples.' },
  { id: 'medium', etiqueta: 'Equilibrado', detalle: 'Recomendado. Piensa lo justo para cruzar datos y armar informes.' },
  { id: 'high', etiqueta: 'Profundo', detalle: 'Analiza más antes de responder. Tarda más y cuesta un poco más.' },
]

/** Precio de Claude Haiku 5.5 (prompts ≤ 100K tokens), en USD por millón de tokens. */
export const TEX_PRECIO_USD_MTOK = {
  entrada: 0.1,
  salida: 0.5,
  cacheLeido: 0.01,
  cacheEscrito: 0.125,
} as const

export const TEX_MAX_CARACTERES = 2000

/** Topes de los textos de Configurar Tex ("Personalidad" e "Instrucciones del negocio"): los mismos en el campo y en el servidor. */
export const TEX_MAX_PERSONA = 2000
export const TEX_MAX_INSTRUCCIONES = 4000

// ─────────────────────────────────────────────────────────────────────────────
// Bloques visuales: lo que una herramienta le muestra a la persona
// ─────────────────────────────────────────────────────────────────────────────

export type TexTono = 'sube' | 'baja' | 'neutro'

export interface TexKpi {
  etiqueta: string
  /** Ya formateado: "$1.420.300", "32 %", "108,4". */
  valor: string
  /** "+12 %" */
  delta?: string
  tono?: TexTono
  /** Contra qué se compara: "vs. los mismos 21 días de septiembre". Sin base no hay delta. */
  base?: string
}

export type TexUnidad = 'pesos' | 'cantidad' | 'porcentaje' | 'minutos'

export interface TexSerie {
  nombre: string
  /** Un valor por etiqueta, en el mismo orden. */
  valores: number[]
}

export interface TexGrafico {
  /** La conclusión, no el tema: "Paraná explica el 41 % del crecimiento". */
  titulo: string
  tipo: 'barras' | 'barras_horizontales' | 'lineas' | 'area' | 'torta'
  unidad: TexUnidad
  /** Categorías del eje X (o porciones de la torta). */
  etiquetas: string[]
  /** 1 a 6 series. La torta usa sólo la primera. */
  series: TexSerie[]
  /** Índice de la etiqueta de la que habla el texto: se pinta con el color de Tex. */
  destacar?: number
  nota?: string
}

export interface TexTabla {
  titulo: string
  columnas: string[]
  filas: (string | number | null)[][]
  /** Alineación por columna; por defecto los números van a la derecha. */
  alinear?: ('izq' | 'der')[]
}

export interface TexInforme {
  titulo: string
  /** "1 al 31 de octubre de 2026" */
  periodo?: string
  /** "Todas las sucursales" | "Paraná" */
  alcance?: string
  kpis: TexKpi[]
  graficos: TexGrafico[]
  tablas: TexTabla[]
  /** Síntesis ejecutiva en markdown (2 a 4 párrafos). */
  sintesis?: string
}

/** El veredicto de la conciliación, en chico, para el chat. */
export interface TexVeredictoConciliacion {
  tipo: 'cuadra' | 'no_cuadra' | 'no_se_sabe' | 'sin_movimientos' | 'error'
  titular: string
  detalle: string
  periodo: string
  faltante: number
  sobrante: number
  paraRevisar: number
  cobertura: string
  /** Enlace a la pantalla con el mismo período. */
  enlace: string
}

export type TexBloque =
  | { tipo: 'kpis'; titulo?: string; items: TexKpi[] }
  | { tipo: 'grafico'; grafico: TexGrafico }
  | { tipo: 'tabla'; tabla: TexTabla }
  | { tipo: 'informe'; informe: TexInforme }
  | { tipo: 'conciliacion'; veredicto: TexVeredictoConciliacion }
  | { tipo: 'sucursales'; items: { nombre: string; direccion?: string | null }[] }
  | { tipo: 'aviso'; tono: 'info' | 'error' | 'ok'; texto: string }

/** La salida de una herramienta para la UI (el `output` de la parte `tool-<nombre>`). */
export interface TexSalidaUI {
  bloques: TexBloque[]
  /** De dónde salen los números: "Finanzas · 1–21 oct · Todas las sucursales". */
  fuente?: string
  /** "No pude leer". Se muestra como error, nunca como un cero (Known Risk #15). */
  error?: string
  /** Enlace a la pantalla del dashboard con los mismos filtros. */
  enlace?: { href: string; texto: string }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes
// ─────────────────────────────────────────────────────────────────────────────

export type TexFase = 'pensando' | 'consultando' | 'redactando'

export type TexCodigoAviso =
  | 'rechazo' // stop_reason refusal (Haiku 5.5 no tiene fallback del lado del servidor)
  | 'limite_respuesta' // max_tokens
  | 'pasos' // se agotaron los pasos de herramientas del turno
  | 'interrumpido' // la persona apretó Detener
  | 'error' // falló el modelo o la red a mitad de camino

// `type` y no `interface`: UIMessage exige que los data parts sean asignables a
// Record<string, unknown>, y una interface no lo es sin índice (que además
// abriría `data-${string}` y se perdería el tipado de cada parte).
export type TexDataParts = {
  /** TRANSIENT: mueve a Tex (pensando → consultando → redactando). No queda en el mensaje. */
  estado: { fase: TexFase; herramienta?: string }
  /** Persistente: un corte del turno que la persona tiene que ver. */
  aviso: { codigo: TexCodigoAviso; texto: string }
  /** Persistente, sólo en el primer turno: el título corto que Tex le pone a la conversación. */
  titulo: { titulo: string }
}

export interface TexUso {
  entrada: number
  salida: number
  cacheLeido: number
  cacheEscrito: number
  /**
   * Costo en USD, sumado pedido a pedido con la tarifa de CADA pedido: un pedido cuyo
   * prompt (entrada + caché) pasa los 100K tokens se cobra 5 veces más caro, y con los
   * tokens del turno sumados ya no se sabe cuál cruzó (src/lib/tex/costo.ts). Ausente en
   * los turnos guardados antes de este campo.
   */
  costoUsd?: number
}

/** Todo opcional: el cliente mezcla lo que llega en 'start', 'message-metadata' y 'finish'. */
export interface TexMetadata {
  conversacionId?: string
  creadoEn?: number
  uso?: TexUso
  /** El historial era largo y se mandaron sólo los últimos turnos: la UI sugiere empezar otra. */
  historialRecortado?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

export type TexCodigoError =
  | 'sin_sesion' // 401
  | 'sin_permiso' // 403: el rol no ve Tex
  | 'bloqueado' // 403: el plan no incluye IA (ai.enabled)
  | 'cuota' // 403: tope mensual de mensajes
  | 'sin_clave' // 422: no hay clave de Anthropic
  | 'clave_invalida' // la API rechazó la clave (401 de Anthropic)
  | 'limite' // 429: demasiadas consultas seguidas (nuestras o de Anthropic)
  | 'no_encontrada' // 404: la conversación no es de esta persona
  | 'invalido' // 400
  | 'error' // cualquier otra cosa

export interface TexErrorRespuesta {
  codigo: TexCodigoError
  mensaje: string
}

/**
 * Los errores de /api/tex/chat viajan como JSON {codigo, mensaje}: en el body
 * de una respuesta no-ok (antes de streamear) y en el `errorText` del chunk
 * 'error' (a mitad del stream). useChat los entrega como `Error.message`.
 */
export function leerErrorTex(error: unknown): TexErrorRespuesta {
  const texto = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  try {
    const o = JSON.parse(texto) as Partial<TexErrorRespuesta>
    if (o && typeof o.codigo === 'string' && typeof o.mensaje === 'string') {
      return { codigo: o.codigo as TexCodigoError, mensaje: o.mensaje }
    }
  } catch {
    /* no era JSON */
  }
  if (/failed to fetch|network|load failed/i.test(texto)) {
    return { codigo: 'error', mensaje: 'Se cortó la conexión mientras te respondía. Lo que ves puede estar incompleto.' }
  }
  return { codigo: 'error', mensaje: 'Tex no pudo terminar la respuesta. Probá de nuevo.' }
}

export type TexUIMessage = UIMessage<TexMetadata, TexDataParts>

/** El pedido que manda el cliente a /api/tex/chat. */
export const TexPedidoSchema = z.object({
  conversacionId: z.string().uuid(),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  /** Con regenerate o editar: el id del mensaje desde el que se corta el historial. */
  mensajeId: z.string().max(100).optional(),
  mensaje: z.object({
    id: z.string().min(1).max(100),
    role: z.literal('user'),
    parts: z
      .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
      .min(1)
      .max(20),
  }),
  /** Ruta del dashboard desde la que pregunta (panel lateral): contexto, nunca instrucciones. */
  pagina: z.string().max(160).optional(),
})

export type TexPedido = z.infer<typeof TexPedidoSchema>

/** Una conversación en el historial. */
export interface TexConversacion {
  id: string
  titulo: string
  actualizada: string
  fijada: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Herramientas: etiquetas para la UI (el servidor tiene las definiciones)
// ─────────────────────────────────────────────────────────────────────────────

export type TexIconoHerramienta =
  | 'resumen'
  | 'sucursales'
  | 'finanzas'
  | 'estadisticas'
  | 'sueldos'
  | 'clientes'
  | 'fidelizacion'
  | 'turnos'
  | 'resenas'
  | 'conocimiento'
  | 'grafico'
  | 'informe'
  | 'sql'
  | 'conciliacion'
  | 'cuentas'
  | 'sincronizar'

export interface TexHerramientaMeta {
  /** Sustantivo corto para el resumen plegado: "Consulté Finanzas y Estadísticas". */
  etiqueta: string
  /** Gerundio para el paso en curso: "Leyendo las finanzas". */
  haciendo: string
  icono: TexIconoHerramienta
}

export const TEX_HERRAMIENTAS: Record<string, TexHerramientaMeta> = {
  resumen_negocio: { etiqueta: 'Resumen del día', haciendo: 'Mirando cómo viene el día', icono: 'resumen' },
  listar_sucursales: { etiqueta: 'Sucursales', haciendo: 'Revisando las sucursales', icono: 'sucursales' },
  finanzas_pyl: { etiqueta: 'Finanzas', haciendo: 'Leyendo las finanzas', icono: 'finanzas' },
  estadisticas: { etiqueta: 'Estadísticas', haciendo: 'Contando cortes y clientes', icono: 'estadisticas' },
  sueldos_comisiones: { etiqueta: 'Sueldos', haciendo: 'Revisando sueldos y comisiones', icono: 'sueldos' },
  buscar_cliente: { etiqueta: 'Clientes', haciendo: 'Buscando el cliente', icono: 'clientes' },
  fidelizacion: { etiqueta: 'Fidelización', haciendo: 'Revisando los puntos', icono: 'fidelizacion' },
  turnos_resumen: { etiqueta: 'Turnos', haciendo: 'Revisando la agenda', icono: 'turnos' },
  reviews_crm: { etiqueta: 'Reseñas', haciendo: 'Leyendo las reseñas', icono: 'resenas' },
  buscar_conocimiento: { etiqueta: 'Conocimiento', haciendo: 'Buscando en lo que dicen los clientes', icono: 'conocimiento' },
  graficar: { etiqueta: 'Gráfico', haciendo: 'Dibujando el gráfico', icono: 'grafico' },
  generar_informe: { etiqueta: 'Informe', haciendo: 'Armando el informe', icono: 'informe' },
  consulta_sql: { etiqueta: 'Consulta avanzada', haciendo: 'Consultando la base', icono: 'sql' },
  conciliacion_mp: { etiqueta: 'Conciliación', haciendo: 'Cruzando Mercado Pago con el sistema', icono: 'conciliacion' },
  conciliacion_casos: { etiqueta: 'Diferencias', haciendo: 'Buscando las diferencias', icono: 'conciliacion' },
  cuentas_mp: { etiqueta: 'Cuentas de Mercado Pago', haciendo: 'Revisando las cuentas conectadas', icono: 'cuentas' },
  sincronizar_mp: { etiqueta: 'Sincronización', haciendo: 'Trayendo los movimientos de Mercado Pago', icono: 'sincronizar' },
  mostrar: { etiqueta: 'Respuesta', haciendo: 'Preparando la respuesta', icono: 'resumen' },
}

/**
 * Las ÚNICAS herramientas cuyos bloques se dibujan en la respuesta. Lo que
 * traen las demás (las de datos) es el trabajo de Tex, no la respuesta: queda
 * plegado en la tarjeta de trabajo (la línea "Consulté … ›", con "Ver datos"
 * en cada paso). Para mostrarle a
 * la persona una tabla o unas tarjetas que trajo una herramienta de datos,
 * Tex llama a `mostrar` con la referencia de ese resultado.
 */
export const TEX_HERRAMIENTAS_VISIBLES: readonly string[] = ['mostrar', 'graficar', 'generar_informe']

export function esHerramientaVisible(nombre: string): boolean {
  return TEX_HERRAMIENTAS_VISIBLES.includes(nombre)
}

export function metaHerramienta(nombre: string): TexHerramientaMeta {
  return TEX_HERRAMIENTAS[nombre] ?? { etiqueta: nombre, haciendo: 'Procesando', icono: 'resumen' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secciones del dashboard (contexto del panel lateral)
// ─────────────────────────────────────────────────────────────────────────────

/** Prefijo de ruta → nombre de la pantalla. El primero que matchee gana. */
export const TEX_SECCIONES: { prefijo: string; nombre: string; sugerencias: string[] }[] = [
  { prefijo: '/dashboard/conciliacion', nombre: 'Conciliación', sugerencias: ['¿Cuadró la plata de ayer?', 'Explicame la diferencia más grande'] },
  { prefijo: '/dashboard/comprobantes', nombre: 'Comprobantes', sugerencias: ['¿Cuántos comprobantes quedaron para revisar esta semana?'] },
  { prefijo: '/dashboard/finanzas', nombre: 'Finanzas', sugerencias: ['Explicame el resultado del mes', '¿Cómo viene el mes contra el anterior a la misma fecha?'] },
  { prefijo: '/dashboard/estadisticas', nombre: 'Estadísticas', sugerencias: ['¿Qué barbero rindió más esta semana?', '¿Cuál es el horario más cargado?'] },
  { prefijo: '/dashboard/caja', nombre: 'Caja', sugerencias: ['¿Cuánto se cobró hoy por medio de pago?'] },
  { prefijo: '/dashboard/sueldos', nombre: 'Sueldos', sugerencias: ['¿Cuánto hay pendiente de comisiones?'] },
  { prefijo: '/dashboard/clientes', nombre: 'Clientes', sugerencias: ['¿Qué clientes dejaron de venir?'] },
  { prefijo: '/dashboard/fila', nombre: 'Fila', sugerencias: ['¿Cuántos cortes llevamos hoy?'] },
  { prefijo: '/dashboard/turnos', nombre: 'Turnos', sugerencias: ['¿Cuántos turnos hay esta semana?'] },
  { prefijo: '/dashboard/cuentas', nombre: 'Cuentas de cobro', sugerencias: ['¿Qué cuenta está más cerca del tope?'] },
  { prefijo: '/dashboard/fidelizacion', nombre: 'Fidelización', sugerencias: ['¿Cuántos puntos hay activos?'] },
  { prefijo: '/dashboard/mensajeria', nombre: 'Mensajería', sugerencias: ['¿De qué se quejan los clientes?'] },
  { prefijo: '/dashboard', nombre: 'Inicio', sugerencias: ['¿Cómo viene el día?', 'Armame el informe de la semana'] },
]

export function seccionDeRuta(ruta: string | null | undefined): (typeof TEX_SECCIONES)[number] | null {
  if (!ruta) return null
  return TEX_SECCIONES.find((s) => ruta === s.prefijo || ruta.startsWith(s.prefijo + '/') || ruta.startsWith(s.prefijo + '?')) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración y estado vacío
// ─────────────────────────────────────────────────────────────────────────────

export type TexOrigenClave = 'org' | 'entorno' | 'legado'

export interface TexConfigVista {
  tieneClave: boolean
  origenClave: TexOrigenClave | null
  esfuerzo: TexEsfuerzo
  persona: string | null
  instrucciones: string | null
  accesoDatos: Record<string, boolean>
  modoPro: boolean
  /** Sólo owner/admin pueden prender el Modo Pro. */
  puedeModoPro: boolean
  /** Para la búsqueda semántica (embeddings de OpenAI). */
  tieneClaveOpenAI: boolean
  usoMes: { respuestas: number; entrada: number; salida: number; cacheLeido: number; cacheEscrito: number; costoUsd: number }
  /**
   * Presente si no se pudo leer el uso del mes: entonces `usoMes` viene en cero
   * y NO hay que mostrarlo como un cero (Known Risk #15), sino este texto.
   */
  usoMesError?: string
}

/** Dominios de datos que se pueden apagar desde la configuración. */
export const TEX_DOMINIOS: { id: string; etiqueta: string; detalle: string }[] = [
  { id: 'finanzas', etiqueta: 'Finanzas', detalle: 'Ingresos, gastos, resultado y punto de equilibrio' },
  { id: 'estadisticas', etiqueta: 'Estadísticas', detalle: 'Cortes, barberos, horarios y retorno de clientes' },
  { id: 'salarios', etiqueta: 'Sueldos y comisiones', detalle: 'Lo pagado y lo pendiente por barbero' },
  { id: 'clientes', etiqueta: 'Clientes', detalle: 'Búsqueda de clientes e historial de visitas' },
  { id: 'resenas', etiqueta: 'Reseñas', detalle: 'Calificaciones, quejas y casos abiertos' },
  { id: 'turnos', etiqueta: 'Turnos', detalle: 'La agenda de reservas' },
  { id: 'fidelizacion', etiqueta: 'Fidelización', detalle: 'Puntos, premios y clientes top' },
  { id: 'conciliacion', etiqueta: 'Conciliación Mercado Pago', detalle: 'Transferencias reales contra lo cobrado en el sistema' },
]

/** Una cifra del "pulso del día" del estado vacío. Calculada sin IA. */
export interface TexPulso {
  id: string
  etiqueta: string
  valor: string
  detalle?: string
  tono: 'neutro' | 'ok' | 'revisar' | 'error'
  /** Lo que se le pregunta a Tex al tocarla. */
  pregunta: string
  icono: TexIconoHerramienta
}
