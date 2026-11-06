// =============================================================================
// «Por responder» (6/nov/2026): lo que espera a una persona en Mensajería.
//
// Módulo PURO (sin servidor ni React): lo usan la bandeja de tarjetas
// (components/responder), la acción que la lee (actions/por-responder.ts) y
// el cron de los avisos push (api/cron/avisos-mensajeria). Las tres tienen que
// estar de acuerdo en qué cuenta, en qué orden y qué número va en el globo.
//
// La lista cruda sale de la RPC `mensajeria_pendientes` (mig 237): una fila por
// conversación que espera (reseña baja sin atender o el cliente escribió lo
// último y nadie le contestó). Acá se reparte en tres pilas:
//   - paraResponder: se puede contestar ya (la ventana de 24 h de Meta abierta).
//   - cierres: lo que espera es un «gracias», «listo», «dale»: no hace falta
//     contestar. Van al final, sin borrador de Tex y sin aviso.
//   - vencidas: pasaron las 24 h. En WhatsApp sólo sale una plantilla; en
//     Instagram ya no se puede por la API (sí desde la app de Instagram).
// =============================================================================

export type TipoPendiente = 'resena' | 'consulta'
export type PlataformaPendiente = 'whatsapp' | 'instagram'

/** Un mensaje del hilo corto que trae la RPC (los últimos 10). */
export interface MensajeDelHilo {
  id: string
  dir: 'inbound' | 'outbound'
  tipo: string | null
  texto: string | null
  plantilla: string | null
  media: string | null
  estado: string | null
  at: string
}

/** Una fila de `mensajeria_pendientes`, tal como llega de PostgREST. */
export interface FilaPendiente {
  conversation_id: string
  tipo: string
  plataforma: string | null
  client_id: string | null
  nombre: string | null
  telefono: string | null
  usuario_ig: string | null
  avatar_url: string | null
  calificacion: number | null
  calificacion_final: number | null
  alerta_ids: string[] | null
  pidio_humano: boolean | null
  esperando_desde: string | null
  ultimo_entrante_at: string | null
  can_reply_until: string | null
  visita_at: string | null
  barbero: string | null
  sucursal_id: string | null
  sucursal: string | null
  servicio: string | null
  visitas_totales: number | null
  hilo: unknown
}

export interface VisitaDelPendiente {
  at: string | null
  barbero: string | null
  sucursalId: string | null
  sucursal: string | null
  servicio: string | null
}

/** Lo que dibuja una tarjeta. */
export interface Pendiente {
  /** El id de la conversación (una tarjeta por conversación). */
  id: string
  tipo: TipoPendiente
  plataforma: PlataformaPendiente
  clientId: string | null
  /** El nombre para mostrar: nunca un «.» ni vacío (cae al teléfono o al usuario). */
  nombre: string
  /** «Benjamín»: para el saludo del borrador y los textos cortos. Null si el nombre no es un nombre. */
  nombrePila: string | null
  telefono: string | null
  usuarioIg: string | null
  avatarUrl: string | null
  /** La nota que tocó primero (1–5), en una reseña. */
  nota: number | null
  /** La que quedó: si al segundo tocó otro número, ese. */
  notaFinal: number | null
  alertaIds: string[]
  /** Pidió hablar con una persona (tocó «Sí» en Bienvenida, o una derivación). */
  pidioHumano: boolean
  /** Desde cuándo espera: la alerta de la reseña o el primer mensaje sin contestar. */
  esperandoDesde: string
  ultimoEntranteAt: string | null
  /** Hasta cuándo se le puede escribir texto libre (Meta: 24 h desde su último mensaje). */
  puedeResponderHasta: string | null
  visita: VisitaDelPendiente | null
  visitasTotales: number | null
  hilo: MensajeDelHilo[]
  /** Los mensajes del cliente que esperan, del más viejo al más nuevo (sin botones ni marcas). */
  loQueEspera: MensajeDelHilo[]
  /** Lo que espera es sólo un cierre de charla («gracias», «listo»). */
  esCierre: boolean
}

export interface PilasPorResponder {
  paraResponder: Pendiente[]
  cierres: Pendiente[]
  vencidas: Pendiente[]
}

// ── Lectura de la fila ───────────────────────────────────────────────────────

// Las marcas que guardan los webhooks en vez de un mensaje: no son algo que
// el cliente espere que le contesten (la RPC ya las saltea al decidir qué espera).
const MARCA_DE_RUIDO = /^\[(Reacción|Mención en Historia|Sticker|Adjunto|template)/

/** ¿El mensaje es un botón tocado (la nota, «Sí», «No»)? */
export function esBotonTocado(m: Pick<MensajeDelHilo, 'tipo'>): boolean {
  return m.tipo === 'interactive'
}

/** ¿El mensaje es una marca del webhook (reacción, mención en una historia, sticker)? */
export function esMarcaDeRuido(m: Pick<MensajeDelHilo, 'texto'>): boolean {
  return MARCA_DE_RUIDO.test((m.texto ?? '').trim())
}

function leerHilo(crudo: unknown): MensajeDelHilo[] {
  if (!Array.isArray(crudo)) return []
  const salida: MensajeDelHilo[] = []
  for (const x of crudo) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const at = typeof o.at === 'string' ? o.at : null
    const dir = o.dir === 'inbound' || o.dir === 'outbound' ? o.dir : null
    if (!id || !at || !dir) continue
    salida.push({
      id,
      dir,
      at,
      tipo: typeof o.tipo === 'string' ? o.tipo : null,
      texto: typeof o.texto === 'string' ? o.texto : null,
      plantilla: typeof o.plantilla === 'string' ? o.plantilla : null,
      media: typeof o.media === 'string' ? o.media : null,
      estado: typeof o.estado === 'string' ? o.estado : null,
    })
  }
  return salida.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** ¿Es un nombre de persona? «.», «-», un número o vacío no lo son. */
function pareceNombre(nombre: string | null | undefined): nombre is string {
  if (!nombre) return false
  const t = nombre.trim()
  if (!/\p{L}/u.test(t)) return false
  // Un teléfono guardado como nombre.
  return !(/^[\d\s+().-]+$/.test(t))
}

/** «benjamín DANIA» → «Benjamín». Null si no hay una palabra con letras. */
export function nombreDePila(nombre: string | null | undefined): string | null {
  if (!pareceNombre(nombre)) return null
  const palabra = nombre.trim().split(/\s+/).find((p) => /\p{L}/u.test(p))
  if (!palabra) return null
  const limpia = palabra.replace(/[^\p{L}'-]/gu, '')
  if (limpia.length < 2) return null
  return limpia.charAt(0).toLocaleUpperCase('es-AR') + limpia.slice(1).toLocaleLowerCase('es-AR')
}

export function normalizarPendiente(f: FilaPendiente): Pendiente {
  const hilo = leerHilo(f.hilo)
  const plataforma: PlataformaPendiente = f.plataforma === 'instagram' ? 'instagram' : 'whatsapp'
  const tipo: TipoPendiente = f.tipo === 'resena' ? 'resena' : 'consulta'
  const esperandoDesde = f.esperando_desde ?? f.ultimo_entrante_at ?? hilo.at(-1)?.at ?? new Date(0).toISOString()
  const desde = Date.parse(esperandoDesde)
  const loQueEspera = hilo.filter(
    (m) => m.dir === 'inbound' && !esBotonTocado(m) && !esMarcaDeRuido(m) && Date.parse(m.at) >= desde - 1000,
  )
  const nombreCrudo = f.nombre?.trim() ?? ''
  const nombre = pareceNombre(nombreCrudo)
    ? nombreCrudo
    : f.usuario_ig
      ? `@${f.usuario_ig.replace(/^@/, '')}`
      : f.telefono ?? (nombreCrudo || 'Sin nombre')
  const visita: VisitaDelPendiente | null =
    f.visita_at || f.barbero || f.sucursal
      ? {
          at: f.visita_at,
          barbero: f.barbero?.trim() || null,
          sucursalId: f.sucursal_id,
          sucursal: f.sucursal?.trim() || null,
          servicio: f.servicio?.trim() || null,
        }
      : null
  return {
    id: f.conversation_id,
    tipo,
    plataforma,
    clientId: f.client_id,
    nombre,
    nombrePila: nombreDePila(nombreCrudo),
    telefono: f.telefono,
    usuarioIg: f.usuario_ig ? f.usuario_ig.replace(/^@/, '') : null,
    avatarUrl: f.avatar_url,
    nota: f.calificacion,
    notaFinal: f.calificacion_final ?? f.calificacion,
    alertaIds: f.alerta_ids ?? [],
    pidioHumano: f.pidio_humano === true,
    esperandoDesde,
    ultimoEntranteAt: f.ultimo_entrante_at,
    puedeResponderHasta: f.can_reply_until,
    visita,
    visitasTotales: f.visitas_totales,
    hilo,
    loQueEspera,
    // Una reseña nunca es un cierre: la nota baja ya pide una respuesta.
    esCierre: tipo === 'consulta' && loQueEspera.length > 0 && loQueEspera.every((m) => esCierreDeCharla(m.texto)),
  }
}

// ── Cierres de charla ────────────────────────────────────────────────────────

/** Sin acentos, en minúscula, sin letras repetidas de más («listooo» → «listo»). */
function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(/(\p{L})\1(?=\s|$)/gu, '$1')
}

const PALABRAS_DE_CIERRE = new Set([
  'gracias', 'graxias', 'grax', 'gracia', 'muchas', 'mil', 'genio', 'genios', 'ok', 'oka', 'okey', 'okay', 'oki',
  'dale', 'joya', 'listo', 'lista', 'perfecto', 'perfect', 'genial', 'buenisimo', 'buenisima', 'barbaro', 'excelente',
  'de', 'una', 'igualmente', 'saludos', 'chau', 'abrazo', 'abrazos', 'nos', 'vemos', 'todo', 'bien', 'muy', 'buena',
  'buen', 'atencion', 'servicio', 'x', 'por', 'la', 'el', 'info', 'data', 'informacion', 'crack', 'cracks', 'capo',
  'capos', 'idolo', 'idolos', 'hermano', 'hermoso', 'amigo', 'bro', 'loco', 'fenomeno', 'jaja', 'jajaja', 'ja',
  'si', 'sii', 'obvio', 'claro', 'tranqui', 'tranquilo', 'entendido', 'anotado', 'recibido', 'va', 'vamos', 'q',
  'que', 'lo', 'mejor', 'tal', 'cual', 'gracia', 'thanks', 'thx', 'te', 'les', 'agradezco', 'un', 'y', 'ustedes',
  'vos', 'a', 'ti', 'tambien',
])
// Palabras que, si aparecen, hacen pensar en una pregunta o un pedido.
const PALABRAS_DE_PREGUNTA = /\b(cuanto|cuando|donde|como|precio|precios|sale|salen|turno|turnos|horario|horarios|abren|abierto|cierran|hacen|tienen|hay|puedo|puede|podes|quiero|queria|necesito|consulta|consultar|reservar|sabado|domingo|mañana|manana|hoy)\b/

/**
 * ¿El texto es sólo un cierre de charla? «gracias», «Listoo», «dale joya»,
 * «Perfecto gracias», «Muy buena atención», «👍». Una pregunta, algo largo o
 * algo con palabras de pedido («¿cuánto sale?», «y el sábado abren») no.
 * Un mensaje sin texto (una foto, un audio) no es un cierre: puede ser una consulta.
 */
export function esCierreDeCharla(texto: string | null | undefined): boolean {
  const crudo = (texto ?? '').trim()
  if (!crudo) return false
  if (crudo.includes('?') || crudo.includes('¿')) return false
  const plegado = plegar(crudo)
  // Sólo emojis o signos: «👍», «🙏🏼», «❤️❤️».
  if (!/[\p{L}\p{N}]/u.test(plegado)) return crudo.length <= 12
  if (PALABRAS_DE_PREGUNTA.test(plegado)) return false
  const palabras = plegado.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (palabras.length === 0 || palabras.length > 6) return false
  return palabras.every((p) => PALABRAS_DE_CIERRE.has(p))
}

// ── Ventana de 24 h y tiempos ────────────────────────────────────────────────

const MINUTO = 60_000
const HORA = 60 * MINUTO

export type EstadoVentana =
  | { tipo: 'abierta'; quedaMs: number; porCerrar: boolean }
  | { tipo: 'cerrada'; hace: number }

/** La ventana de Meta: abierta (con lo que queda; «por cerrar» con menos de 3 h) o cerrada. */
export function estadoVentana(p: Pick<Pendiente, 'puedeResponderHasta'>, ahora: number): EstadoVentana {
  const hasta = p.puedeResponderHasta ? Date.parse(p.puedeResponderHasta) : NaN
  if (!Number.isFinite(hasta) || hasta <= ahora) {
    return { tipo: 'cerrada', hace: Number.isFinite(hasta) ? ahora - hasta : Infinity }
  }
  const quedaMs = hasta - ahora
  return { tipo: 'abierta', quedaMs, porCerrar: quedaMs < 3 * HORA }
}

/** «recién», «hace 12 min», «hace 3 h», «ayer», «hace 4 días». */
export function haceCuanto(iso: string | null | undefined, ahora: number): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const ms = Math.max(0, ahora - t)
  if (ms < MINUTO) return 'recién'
  if (ms < HORA) return `hace ${Math.floor(ms / MINUTO)} min`
  if (ms < 24 * HORA) return `hace ${Math.floor(ms / HORA)} h`
  const dias = Math.floor(ms / (24 * HORA))
  return dias === 1 ? 'ayer' : `hace ${dias} días`
}

/** «Quedan 23 h», «Quedan 40 min», «Se cerró hace 2 h». */
export function textoVentana(v: EstadoVentana): string {
  if (v.tipo === 'cerrada') {
    if (!Number.isFinite(v.hace)) return 'Sin ventana para responder'
    if (v.hace < HORA) return `Se cerró hace ${Math.max(1, Math.floor(v.hace / MINUTO))} min`
    if (v.hace < 24 * HORA) return `Se cerró hace ${Math.floor(v.hace / HORA)} h`
    const dias = Math.floor(v.hace / (24 * HORA))
    return `Se cerró hace ${dias} ${dias === 1 ? 'día' : 'días'}`
  }
  if (v.quedaMs < HORA) return `Quedan ${Math.max(1, Math.floor(v.quedaMs / MINUTO))} min`
  return `Quedan ${Math.floor(v.quedaMs / HORA)} h`
}

/** Cuánto hace que espera, en minutos (para el color de la urgencia). */
export function minutosEsperando(p: Pick<Pendiente, 'esperandoDesde'>, ahora: number): number {
  const t = Date.parse(p.esperandoDesde)
  return Number.isFinite(t) ? Math.max(0, Math.floor((ahora - t) / MINUTO)) : 0
}

// ── Orden y pilas ────────────────────────────────────────────────────────────

/**
 * Reparte y ordena. Primero las reseñas (la nota más baja y la más fresca
 * arriba: el cliente todavía tiene el teléfono en la mano), después las
 * consultas por la ventana que se cierra antes (las que pidieron hablar con
 * alguien, adelante a igual ventana). Los cierres, al final. Las vencidas, de
 * la más nueva a la más vieja.
 */
export function armarPilas(lista: Pendiente[], ahora: number): PilasPorResponder {
  const paraResponder: Pendiente[] = []
  const cierres: Pendiente[] = []
  const vencidas: Pendiente[] = []
  for (const p of lista) {
    const v = estadoVentana(p, ahora)
    if (v.tipo === 'cerrada') vencidas.push(p)
    else if (p.esCierre) cierres.push(p)
    else paraResponder.push(p)
  }
  const ventana = (p: Pendiente) => (p.puedeResponderHasta ? Date.parse(p.puedeResponderHasta) : Infinity)
  paraResponder.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'resena' ? -1 : 1
    if (a.tipo === 'resena') {
      const na = a.notaFinal ?? a.nota ?? 5
      const nb = b.notaFinal ?? b.nota ?? 5
      if (na !== nb) return na - nb
      return Date.parse(b.esperandoDesde) - Date.parse(a.esperandoDesde)
    }
    const va = ventana(a)
    const vb = ventana(b)
    // Dentro de la misma media hora de ventana, primero quien pidió hablar con alguien.
    if (Math.abs(va - vb) > 30 * MINUTO) return va - vb
    if (a.pidioHumano !== b.pidioHumano) return a.pidioHumano ? -1 : 1
    return va - vb
  })
  cierres.sort((a, b) => ventana(a) - ventana(b))
  vencidas.sort((a, b) => Date.parse(b.esperandoDesde) - Date.parse(a.esperandoDesde))
  return { paraResponder, cierres, vencidas }
}

/** El número del globo: lo que se puede contestar ya y no es un cierre. */
export function cuantasParaResponder(lista: Pendiente[], ahora: number): number {
  return armarPilas(lista, ahora).paraResponder.length
}

/** ¿Hay una reseña baja que se puede contestar? (el globo va en rojo). */
export function hayResenaUrgente(lista: Pendiente[], ahora: number): boolean {
  return lista.some((p) => p.tipo === 'resena' && estadoVentana(p, ahora).tipo === 'abierta')
}

// ── Textos ───────────────────────────────────────────────────────────────────

/** «1 estrella», «3 estrellas». */
export function textoNota(n: number): string {
  return `${n} ${n === 1 ? 'estrella' : 'estrellas'}`
}

/** El resumen de una pila para la fila de la lista de chats: «1 reseña de 2 estrellas · 4 consultas». */
export function resumenDePila(lista: Pendiente[]): string {
  const resenas = lista.filter((p) => p.tipo === 'resena')
  const consultas = lista.length - resenas.length
  const partes: string[] = []
  if (resenas.length === 1) {
    // La nota que la trajo acá (si después tocó otra, la tarjeta lo cuenta).
    const n = resenas[0].nota ?? resenas[0].notaFinal
    partes.push(n ? `1 reseña de ${textoNota(n)}` : '1 reseña baja')
  } else if (resenas.length > 1) {
    partes.push(`${resenas.length} reseñas bajas`)
  }
  if (consultas === 1) partes.push('1 consulta')
  else if (consultas > 1) partes.push(`${consultas} consultas`)
  return partes.join(' · ')
}

/** Lo último que escribió el cliente, en una línea (para los avisos y la fila de la lista). */
export function ultimaFraseDelCliente(p: Pick<Pendiente, 'loQueEspera' | 'hilo'>): string | null {
  const conTexto = [...p.loQueEspera].reverse().find((m) => (m.texto ?? '').trim())
  const m = conTexto ?? [...p.hilo].reverse().find((x) => x.dir === 'inbound' && !esBotonTocado(x) && !esMarcaDeRuido(x) && (x.texto ?? '').trim())
  if (m?.texto?.trim()) return m.texto.trim().replace(/\s+/g, ' ')
  const conAdjunto = p.loQueEspera.at(-1)
  if (conAdjunto?.tipo === 'image') return 'Mandó una foto'
  if (conAdjunto?.tipo === 'video') return 'Mandó un video'
  if (conAdjunto?.tipo === 'audio') return 'Mandó un audio'
  if (conAdjunto?.tipo === 'document') return 'Mandó un archivo'
  return null
}

/** El largo máximo de un mensaje de texto de WhatsApp (Cloud API). */
export const MAX_CARACTERES_RESPUESTA = 4096
