// Ícono lucide de cada dominio de Tex (pasos de la tarjeta de trabajo, el
// pulso del día). Sin emojis: el repo los prohíbe en la UI.

import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  ChartLine,
  DollarSign,
  FileText,
  Gift,
  Landmark,
  LayoutDashboard,
  Receipt,
  RefreshCw,
  Scale,
  Star,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { TexIconoHerramienta } from '@/lib/tex/contrato'

export const ICONO_DOMINIO: Record<TexIconoHerramienta, LucideIcon> = {
  resumen: LayoutDashboard,
  sucursales: Building2,
  finanzas: DollarSign,
  estadisticas: BarChart3,
  sueldos: Receipt,
  clientes: Users,
  fidelizacion: Gift,
  turnos: CalendarClock,
  resenas: Star,
  conocimiento: BookOpen,
  grafico: ChartLine,
  informe: FileText,
  sql: Terminal,
  conciliacion: Scale,
  cuentas: Landmark,
  sincronizar: RefreshCw,
}

export function iconoDominio(icono: TexIconoHerramienta | string | undefined): LucideIcon {
  return (icono && ICONO_DOMINIO[icono as TexIconoHerramienta]) || LayoutDashboard
}
