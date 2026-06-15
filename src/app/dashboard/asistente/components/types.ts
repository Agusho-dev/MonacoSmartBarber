import {
  LayoutDashboard, DollarSign, BarChart3, TrendingUp, Receipt, Users,
  Star, CalendarClock, BookOpen, FileText, Terminal, Building2, type LucideIcon,
} from 'lucide-react'

export interface ToolMeta {
  label: string
  icon: LucideIcon
  /** Frase en gerundio para el chip "en curso". */
  running: string
}

export const TOOL_META: Record<string, ToolMeta> = {
  resumen_negocio: { label: 'Resumen', icon: LayoutDashboard, running: 'Armando el resumen…' },
  listar_sucursales: { label: 'Sucursales', icon: Building2, running: 'Buscando sucursales…' },
  finanzas_pyl: { label: 'Finanzas', icon: DollarSign, running: 'Consultando finanzas…' },
  estadisticas: { label: 'Estadísticas', icon: BarChart3, running: 'Analizando estadísticas…' },
  rendimiento_barberos: { label: 'Rendimiento', icon: TrendingUp, running: 'Midiendo rendimiento…' },
  sueldos_comisiones: { label: 'Sueldos', icon: Receipt, running: 'Revisando sueldos…' },
  buscar_cliente: { label: 'Clientes', icon: Users, running: 'Buscando clientes…' },
  fidelizacion: { label: 'Fidelización', icon: Star, running: 'Revisando puntos…' },
  turnos_resumen: { label: 'Turnos', icon: CalendarClock, running: 'Revisando turnos…' },
  reviews_crm: { label: 'Reseñas', icon: Star, running: 'Leyendo reseñas…' },
  buscar_conocimiento: { label: 'Conocimiento', icon: BookOpen, running: 'Buscando en el conocimiento…' },
  generar_reporte: { label: 'Informe', icon: FileText, running: 'Armando el informe…' },
  consulta_sql: { label: 'SQL Pro', icon: Terminal, running: 'Ejecutando consulta…' },
}

export function toolMetaFor(name: string): ToolMeta {
  return TOOL_META[name] ?? { label: name, icon: Terminal, running: 'Procesando…' }
}

export interface SuggestedGroup {
  theme: string
  icon: LucideIcon
  prompts: string[]
}

export const SUGGESTED_GROUPS: SuggestedGroup[] = [
  {
    theme: 'Finanzas',
    icon: DollarSign,
    prompts: ['¿Cómo viene el mes vs. el anterior?', '¿Cuál es mi punto de equilibrio?'],
  },
  {
    theme: 'Operación',
    icon: BarChart3,
    prompts: ['¿Qué barbero rindió más esta semana?', '¿Cuáles son mis horarios pico?'],
  },
  {
    theme: 'Clientes',
    icon: Users,
    prompts: ['¿Qué clientes están por dejar de venir?', 'Top 10 clientes por visitas'],
  },
  {
    theme: 'Reseñas',
    icon: Star,
    prompts: ['¿De qué se quejan los clientes?', 'Resumen de reseñas del último mes'],
  },
]

/** Helpers de formato ARS. */
export function formatARS(n: number): string {
  return `$${Math.round(n).toLocaleString('es-AR')}`
}
export function formatNum(n: number): string {
  return Math.round(n).toLocaleString('es-AR')
}
