export function initials(name: string) {
  if (/^\d+$/.test(name.trim())) return 'IG'
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

export function displayName(name: string | undefined | null, platform?: string): string {
  if (!name) return platform === 'instagram' ? 'Usuario de Instagram' : 'Sin nombre'
  if (/^\d{10,}$/.test(name.trim())) {
    return platform === 'instagram' ? 'Usuario de Instagram' : `ID: ${name.slice(0, 8)}…`
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
