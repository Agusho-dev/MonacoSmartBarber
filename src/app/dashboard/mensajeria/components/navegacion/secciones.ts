// Las secciones de Mensajería y cómo se nombran en cada lugar: la columna de
// la compu (riel de íconos, o lista con etiquetas cuando las columnas miden
// 1600 px o más), el menú "…" del celular y la barra de iOS de cada pantalla.
//
// "Chats" y "Programados" son dos vistas de la sección inbox (la lista de
// chats y la de mensajes programados, `inboxTab` en el contexto); las demás
// son secciones propias. Configuración no es una sección: abre la hoja.

import {
  CalendarClock, GalleryVerticalEnd, Megaphone, MessageCircle, MessageSquare, Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CrmSection } from '../shared/types'

export type DestinoMensajeria = 'chats' | 'programados' | Exclude<CrmSection, 'inbox' | 'settings'>

export interface ItemSeccion {
  destino: DestinoMensajeria
  /** La de la columna con etiquetas de la compu y la del menú. */
  etiqueta: string
  /** La del riel de íconos (72 px de ancho). */
  corta: string
  /** La del título de la barra de iOS en el celular. */
  titulo: string
  icono: LucideIcon
}

export const ITEMS_SECCIONES: readonly ItemSeccion[] = [
  { destino: 'chats', etiqueta: 'Chats', corta: 'Chats', titulo: 'Chats', icono: MessageSquare },
  // «Por responder» (6/nov/2026) reemplazó a Alertas y Casos: Casos tenía un
  // solo caso en toda la historia (client_reviews está vacía) y Alertas juntaba
  // 307 sin leer desde junio. Lo que de verdad pedían (reseñas bajas y consultas
  // sin contestar) es ahora una pila de tarjetas para responder deslizando.
  { destino: 'responder', etiqueta: 'Por responder', corta: 'Responder', titulo: 'Por responder', icono: GalleryVerticalEnd },
  { destino: 'broadcasts', etiqueta: 'Difusiones', corta: 'Difusiones', titulo: 'Difusiones', icono: Megaphone },
  // «Automatizaciones» en todo lo que se ve (23/oct/2026): convivían
  // «Workflows», «Automatizaciones» y «Workflows de automatización». En el riel
  // de 68 px, la palabra entera no entra a 10 px.
  { destino: 'automations', etiqueta: 'Automatizaciones', corta: 'Automatiz.', titulo: 'Automatizaciones', icono: Zap },
  { destino: 'quick-replies', etiqueta: 'Respuestas rápidas', corta: 'Rápidas', titulo: 'Respuestas rápidas', icono: MessageCircle },
  { destino: 'programados', etiqueta: 'Programados', corta: 'Programados', titulo: 'Mensajes programados', icono: CalendarClock },
]

export function itemDe(destino: DestinoMensajeria): ItemSeccion {
  return ITEMS_SECCIONES.find((i) => i.destino === destino) ?? ITEMS_SECCIONES[0]
}

/** Lo que se está viendo, a partir de la sección y de la vista del inbox. */
export function destinoActivo(section: CrmSection, inboxTab: 'inbox' | 'scheduled'): DestinoMensajeria {
  if (section === 'inbox' || section === 'settings') return inboxTab === 'scheduled' ? 'programados' : 'chats'
  return section
}

/** Contadores que se muestran al lado de cada sección (0 = nada). */
export interface ContadoresSecciones {
  /** Chats con mensajes sin leer. */
  chats: number
  /** Lo que se puede contestar ya en «Por responder» (sin los cierres de charla). */
  responder: number
  /** Hay una reseña baja entre lo de «Por responder»: el globo va en rojo. */
  responderUrgente: boolean
  /** Mensajes programados pendientes de salir. */
  programados: number
}

export function contadorDe(destino: DestinoMensajeria, c: ContadoresSecciones): number {
  switch (destino) {
    case 'chats': return c.chats
    case 'responder': return c.responder
    case 'programados': return c.programados
    default: return 0
  }
}

/** Para un número dentro de un globo chico. */
export function numeroCorto(n: number): string {
  return n > 99 ? '99+' : String(n)
}
