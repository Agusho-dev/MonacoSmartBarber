export function initials(name: string) {
  const t = name.trim()
  if (/^\d+$/.test(t)) return 'IG'
  // Número formateado como contacto WA sin nombre en perfil (ver displayName)
  if (esEtiquetaDeTelefono(t)) return 'WA'
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

/**
 * ¿El "nombre" es en realidad un teléfono? Un contacto de WhatsApp sin nombre se
 * muestra con su número ("+54 9 351 612-4478"), y su foto es la silueta gris.
 */
export function esEtiquetaDeTelefono(nombre: string): boolean {
  const t = nombre.trim()
  return /^\+?[\d\s().-]+$/.test(t) && t.replace(/\D/g, '').length >= 10
}

// Las características de 3 cifras de la Argentina. El 11 (AMBA) tiene 2 y las
// demás, 4: de eso depende dónde va el espacio ("351 612-4478", "11 2345-6789",
// "3543 41-2345"), como lo escribe WhatsApp.
const CARACTERISTICAS_DE_3 = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266', '280', '291', '294',
  '297', '298', '299', '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370',
  '376', '379', '380', '381', '383', '385', '387', '388',
])

/**
 * Un teléfono argentino como lo escribe WhatsApp: "+54 9 351 612-4478". Acepta
 * el wa_id (sin +, con el 9), los 10 dígitos locales con los que trabaja el
 * sistema (src/lib/phone.ts) y cualquier forma con espacios o guiones. Null si
 * no es un número argentino reconocible: quien llama decide qué mostrar.
 */
export function formatearTelefonoAr(crudo: string): string | null {
  const d = crudo.replace(/\D/g, '')
  let nacional: string
  let celular: boolean
  if (d.length === 13 && d.startsWith('549')) {
    nacional = d.slice(3)
    celular = true
  } else if (d.length === 12 && d.startsWith('54')) {
    nacional = d.slice(2)
    celular = false
  } else if (d.length === 10 && /^[1-9]/.test(d)) {
    // Los 10 dígitos locales: en Mensajería son números de WhatsApp, o sea celulares.
    nacional = d
    celular = true
  } else {
    return null
  }
  const largoArea = nacional.startsWith('11') ? 2 : CARACTERISTICAS_DE_3.has(nacional.slice(0, 3)) ? 3 : 4
  const area = nacional.slice(0, largoArea)
  const abonado = nacional.slice(largoArea)
  const corte = abonado.length - 4
  return `+54 ${celular ? '9 ' : ''}${area} ${abonado.slice(0, corte)}-${abonado.slice(corte)}`
}

/** Etiqueta legible para wa_id / teléfono solo dígitos (Cloud API envía `from` sin +). */
export function formatWhatsAppPhoneForUi(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (!d) return raw.trim() || 'Sin nombre'
  return formatearTelefonoAr(d) ?? `+${d}`
}

function isLikelyMetaPhoneHandle(name: string, platform?: string): boolean {
  const trimmed = name.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 10) return false
  // Sin letras: es wa_id o teléfono guardado como "nombre" temporal
  if (/[a-zA-Z\u00C0-\u024F]/.test(trimmed)) return false
  if (platform === 'whatsapp') {
    return /^\d{10,}$/.test(trimmed) || /^[\d+\s().-]+$/.test(trimmed)
  }
  return /^\d{10,}$/.test(trimmed)
}

export function displayName(name: string | undefined | null, platform?: string): string {
  if (!name) return platform === 'instagram' ? 'Usuario de Instagram' : 'Sin nombre'
  if (isLikelyMetaPhoneHandle(name, platform)) {
    const digits = name.replace(/\D/g, '')
    if (platform === 'instagram') return 'Usuario de Instagram'
    if (platform === 'whatsapp') return formatWhatsAppPhoneForUi(digits)
    return `ID: ${digits.slice(0, 8)}…`
  }
  return name
}

export const AVATAR_COLORS = [
  'bg-emerald-600', 'bg-sky-600', 'bg-violet-600',
  'bg-rose-600', 'bg-amber-600', 'bg-teal-600',
]

export function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

export const TAG_COLORS = [
  '#22C55E', '#EF4444', '#F97316', '#EAB308',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
]

// ── El marcador de plantilla ─────────────────────────────────────────────────
// Cuando una plantilla sale sin su texto renderizado, el envío guarda en
// `messages.content` (y en `scheduled_messages`) el marcador "[Template: nombre]"
// (whatsapp-meta.ts, workflow-engine.ts, rrhh.ts, process-scheduled-messages).
// Es un dato interno y nunca se muestra crudo: va el nombre de Meta legible
// ("recordatorio turno"). En la lista de chats y en Programados, con el ícono
// de plantilla al lado (el ícono ya dice qué es); en la burbuja del chat,
// "Plantilla · nombre".

const MARCADOR_PLANTILLA = /^\[Template:\s*([^\]]*?)\s*\]$/

/** El nombre de la plantilla si el contenido es el marcador "[Template: nombre]"; si no, null. */
export function plantillaDelMarcador(contenido: string | null | undefined): string | null {
  const m = (contenido ?? '').trim().match(MARCADOR_PLANTILLA)
  return m ? m[1] : null
}

/** "recordatorio_turno" → "recordatorio turno": el nombre de Meta, para leer. */
export function nombreLegibleDePlantilla(nombre: string): string {
  return nombre.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
}

export type LastMessageMediaKind =
  | 'image' | 'video' | 'audio' | 'document' | 'template' | 'sticker' | 'location'

/**
 * Tipo de media del último mensaje para renderizar un ícono lucide en la lista
 * de chats (estilo WhatsApp: ícono + etiqueta). Devuelve null para texto plano.
 * Un texto que es el marcador de plantilla cuenta como plantilla.
 */
export function lastMessageMediaKind(
  msg: { content_type: string; content?: string | null } | undefined | null,
): LastMessageMediaKind | null {
  if (!msg) return null
  if (plantillaDelMarcador(msg.content) !== null) return 'template'
  switch (msg.content_type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'template':
    case 'sticker':
    case 'location':
      return msg.content_type
    default:
      return null
  }
}

/**
 * Cómo se llama cada tipo de adjunto: el texto de la vista previa cuando no hay
 * otro (una foto sin epígrafe) y lo que lee el lector de pantalla en lugar del
 * ícono (fila-chat.tsx).
 */
export const NOMBRE_DEL_ADJUNTO: Record<LastMessageMediaKind, string> = {
  image: 'Foto',
  video: 'Video',
  audio: 'Mensaje de voz',
  document: 'Documento',
  template: 'Plantilla',
  sticker: 'Sticker',
  location: 'Ubicación',
}

/**
 * Devuelve siempre un preview del último mensaje, incluso cuando el content es null
 * (ej: imágenes sin caption, audios, templates). Nunca devuelve string vacío.
 * Sin emojis: el ícono lo pone la lista con lucide (ver lastMessageMediaKind).
 *
 * Como WhatsApp, el ícono y el texto, sin repetir el tipo (23/oct/2026): una
 * foto con epígrafe es el epígrafe, un documento es su nombre, una plantilla es
 * su texto o su nombre legible. Antes iba "Plantilla · resenia" o
 * "Documento · Comprobante.pdf" AL LADO del ícono, que ya decía lo mismo. Sin
 * otro texto va el nombre del tipo (NOMBRE_DEL_ADJUNTO: "Foto", "Documento").
 */
export function formatLastMessagePreview(
  msg: { content: string | null; direction: string; content_type: string } | undefined | null,
  fallback?: string | null,
): string {
  if (!msg) return fallback?.trim() || 'Sin mensajes aún'

  const content = (msg.content ?? '').trim()
  const plantilla = plantillaDelMarcador(content)
  if (plantilla !== null) return nombreLegibleDePlantilla(plantilla) || NOMBRE_DEL_ADJUNTO.template

  const tipo = lastMessageMediaKind(msg)
  // De la nota de voz, el sticker y la ubicación no hay texto que mostrar.
  if (tipo === 'audio' || tipo === 'sticker' || tipo === 'location') return NOMBRE_DEL_ADJUNTO[tipo]
  if (tipo) return content || NOMBRE_DEL_ADJUNTO[tipo]
  return content || '(mensaje sin contenido)'
}

/**
 * La hora de cada burbuja del chat, de 24 h como WhatsApp y como la lista
 * (formatRelativeDate). El hourCycle va explícito: con la tabla de idiomas de
 * los navegadores de hoy, es-AR sola sale "02:05 p. m.".
 */
export function formatTime(date: string) {
  return new Date(date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/**
 * Día y hora cortos, de 24 h: "24/10, 17:00" (Programados, Difusiones). Mismo
 * hourCycle explícito que formatTime: sin él, es-AR sale "05:00 p. m.".
 */
export function formatFechaHora(date: string) {
  return new Date(date).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}

/**
 * La hora de la lista de chats, como la dice WhatsApp: hoy "14:32", ayer
 * "Ayer", en la última semana el día ("martes") y antes la fecha corta
 * ("12/10/26"). Se cuenta por días de calendario, no por horas: un mensaje de
 * las 23:50 a las 00:10 ya es "Ayer".
 *
 * Depende del reloj y de la zona horaria del navegador: lo que se dibuja en el
 * servidor (UTC) tiene que esperar a hidratar para mostrarla (useDiaLocal).
 */
export function formatRelativeDate(date: string) {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const ahora = new Date()
  const dias = Math.round(
    (new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000,
  )
  // Hoy (o "en el futuro", si el reloj del dispositivo atrasa): la hora, de 24
  // h como WhatsApp. El hourCycle va explícito: con la tabla de idiomas de los
  // navegadores de hoy, es-AR sola sale "09:39 a. m.".
  if (dias <= 0) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (dias === 1) return 'Ayer'
  if (dias < 7) return d.toLocaleDateString('es-AR', { weekday: 'long' })
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function formatDateSeparator(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diffD = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffD === 0) return 'Hoy'
  if (diffD === 1) return 'Ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
}

// Extraer las variables ({{1}}, {{2}}, etc.) de los componentes de un template de Meta
interface MetaTemplateComponent {
  type?: string
  text?: string
}
export function extractTemplateVariables(components: MetaTemplateComponent[]): {
  header: string[]
  body: string[]
} {
  const result = { header: [] as string[], body: [] as string[] }
  if (!components) return result

  for (const comp of components) {
    if (!comp.text) continue
    const matches = comp.text.match(/\{\{(\d+)\}\}/g) ?? []
    const vars = matches.map((m: string) => m.replace(/[{}]/g, ''))
    if (comp.type === 'HEADER') result.header = vars
    if (comp.type === 'BODY') result.body = vars
  }

  return result
}
