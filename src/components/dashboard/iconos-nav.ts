// Los íconos del menú por grupos. El módulo de los grupos
// (src/lib/navegacion/grupos.ts) es puro y nombra cada ícono con una clave; el
// componente de lucide se elige acá, del lado de quien dibuja.

import {
  BarChart3,
  Building2,
  CalendarClock,
  DollarSign,
  FileCheck2,
  Gift,
  Handshake,
  IdCard,
  ListOrdered,
  MessageSquare,
  Receipt,
  Scale,
  ScanLine,
  Scissors,
  Settings,
  Smartphone,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ClaveIcono } from '@/lib/navegacion/grupos'

export const ICONOS_NAV: Readonly<Record<ClaveIcono, LucideIcon>> = {
  Store,
  Users,
  Scissors,
  DollarSign,
  Settings,
  ListOrdered,
  CalendarClock,
  BarChart3,
  MessageSquare,
  Smartphone,
  Gift,
  Handshake,
  IdCard,
  Receipt,
  ScanLine,
  Scale,
  FileCheck2,
  Building2,
  Sparkles,
}
