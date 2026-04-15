export function initials(name: string) {
  const t = name.trim()
  if (/^\d+$/.test(t)) return 'IG'
  // Número formateado como contacto WA sin nombre en perfil (ver displayName)
  if (/^\+\d{10,}$/.test(t)) return 'WA'
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

/** Etiqueta legible para wa_id / teléfono solo dígitos (Cloud API envía `from` sin +). */
export function formatWhatsAppPhoneForUi(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (!d) return raw.trim() || 'Sin nombre'
  return `+${d}`
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

/**
 * Devuelve siempre un preview del último mensaje, incluso cuando el content es null
 * (ej: imágenes sin caption, audios, templates). Nunca devuelve string vacío.
 */
export function formatLastMessagePreview(
  msg: { content: string | null; direction: string; content_type: string } | undefined | null,
  fallback?: string | null,
): string {
  if (!msg) return fallback?.trim() || 'Sin mensajes aún'

  const prefix = msg.direction === 'outbound' ? 'Vos: ' : ''
  const content = (msg.content ?? '').trim()

  switch (msg.content_type) {
    case 'image':    return `${prefix}📷 Imagen${content ? ` · ${content}` : ''}`
    case 'video':    return `${prefix}🎬 Video${content ? ` · ${content}` : ''}`
    case 'audio':    return `${prefix}🎤 Audio`
    case 'document': return `${prefix}📎 Documento${content ? ` · ${content}` : ''}`
    case 'template': return `${prefix}📋 Template${content ? ` · ${content}` : ''}`
    case 'sticker':  return `${prefix}💠 Sticker`
    case 'location': return `${prefix}📍 Ubicación`
    default:         return content ? `${prefix}${content}` : `${prefix}(mensaje sin contenido)`
  }
}

export function formatTime(date: string) {
  return new Date(date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function formatRelativeDate(date: string) {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'ahora'
  if (diffMins < 60) return `${diffMins}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
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
export function extractTemplateVariables(components: any[]): {
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
