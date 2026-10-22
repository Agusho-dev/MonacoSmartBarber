// Ícono lucide de cada dominio de Tex (pasos de la tarjeta de trabajo, el
// pulso del día). Sin emojis: el repo los prohíbe en la UI.

import { createElement } from 'react'
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
  type LucideProps,
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

/**
 * El ícono del dominio como elemento. Las referencias del mapa son estables
 * (módulo), pero el lint no lo puede saber y marca `const Icono = iconoDominio(…)`
 * usado como JSX en el cuerpo de un componente (react-hooks/static-components).
 */
export function IconoDominio({ icono, ...props }: LucideProps & { icono: TexIconoHerramienta | string | undefined }) {
  return createElement(iconoDominio(icono), props)
}
