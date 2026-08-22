// =============================================================================
// Constantes compartidas del módulo de notificaciones push (dashboard).
//
// Viven acá y no en `src/lib/actions/push-notifications.ts` porque ese archivo
// es `'use server'` y sólo puede exportar funciones async: una constante
// exportada desde ahí rompe el build. Las usan el server action (para validar)
// y la pantalla `/dashboard/notificaciones` (para dibujar), así las dos cosas
// hablan del mismo catálogo de destinos y variables.
// =============================================================================

/** Límites que fija el CHECK de `push_campaigns` (migración 193). */
export const PUSH_TITLE_MAX = 65
export const PUSH_BODY_MAX = 240
export const PUSH_NAME_MAX = 80

/** Cuántas horas antes del turno puede dispararse un recordatorio, como máximo (una semana). */
export const PUSH_REMINDER_MAX_HOURS = 168
export const PUSH_REMINDER_MAX_ITEMS = 5

export interface PushDestino {
  /** Ruta interna de la app. `branch` es el caso especial: se completa con `/branch/<uuid>`. */
  value: string
  label: string
  descripcion: string
}

/**
 * Destinos posibles al tocar la notificación. Son rutas internas de la app
 * Flutter (contrato §6.3 / §6.7): `PushHandler` sólo navega a paths que
 * empiecen con `/`, así que acá no entran URLs externas.
 */
export const PUSH_DESTINOS: readonly PushDestino[] = [
  { value: '/home', label: 'Inicio', descripcion: 'La pantalla principal de la app' },
  { value: '/turnos', label: 'Mis turnos', descripcion: 'Sus turnos reservados y el botón para sacar uno' },
  { value: '/rewards', label: 'Premios', descripcion: 'Los premios que puede canjear' },
  { value: '/points', label: 'Puntos', descripcion: 'Su saldo y movimientos de puntos' },
  { value: '/catalog', label: 'Catálogo', descripcion: 'Servicios y precios' },
  { value: '/billboard', label: 'Cartelera', descripcion: 'Novedades y promociones' },
  { value: '/convenios', label: 'Convenios', descripcion: 'Beneficios con comercios aliados' },
  { value: 'branch', label: 'Una sucursal', descripcion: 'La ficha de una sucursal (ocupación y horarios)' },
]

const RUTAS_FIJAS = new Set(PUSH_DESTINOS.filter(d => d.value !== 'branch').map(d => d.value))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** `true` si el deep link es una de las rutas fijas o `/branch/<uuid>`. */
export function esDeepLinkValido(link: string): boolean {
  if (RUTAS_FIJAS.has(link)) return true
  const m = link.match(/^\/branch\/([0-9a-f-]{36})$/i)
  return !!m && UUID_RE.test(m[1])
}

/** Si el link es `/branch/<uuid>`, devuelve el uuid; si no, null. */
export function branchIdDeDeepLink(link: string | null | undefined): string | null {
  if (!link) return null
  const m = link.match(/^\/branch\/([0-9a-f-]{36})$/i)
  return m && UUID_RE.test(m[1]) ? m[1] : null
}

/** Etiqueta humana de un deep link, para la tabla de campañas. */
export function etiquetaDestino(link: string | null | undefined, nombreSucursal?: string | null): string {
  if (!link) return 'Sin destino'
  const fijo = PUSH_DESTINOS.find(d => d.value === link)
  if (fijo) return fijo.label
  if (branchIdDeDeepLink(link)) return nombreSucursal ? `Sucursal ${nombreSucursal}` : 'Sucursal'
  return link
}

export interface PushVariable {
  key: string
  label: string
  ejemplo: string
}

/**
 * Variables que aceptan los textos de las notificaciones automáticas. Las
 * reemplaza `enqueue_due_appointment_reminders()` (migración 193) al encolar;
 * acá sólo se usan para la ayuda y la vista previa.
 */
export const PUSH_VARIABLES: readonly PushVariable[] = [
  { key: '{{nombre}}', label: 'Nombre del cliente', ejemplo: 'Juan' },
  { key: '{{hora}}', label: 'Hora del turno', ejemplo: '15:00' },
  { key: '{{fecha}}', label: 'Fecha del turno', ejemplo: 'jueves 21/08' },
  { key: '{{sucursal}}', label: 'Sucursal', ejemplo: 'Rondeau' },
  { key: '{{barbero}}', label: 'Barbero', ejemplo: 'Fabrizio' },
]

/** Reemplaza `{{variable}}` por su valor de ejemplo (vista previa). */
export function renderPlantilla(texto: string, valores?: Record<string, string>): string {
  const vars = valores ?? Object.fromEntries(PUSH_VARIABLES.map(v => [v.key.slice(2, -2), v.ejemplo]))
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** Valores por defecto de `push_settings` (espejo de los DEFAULT de la migración 193). */
export const PUSH_SETTINGS_DEFAULTS = {
  reminders_enabled: true,
  reminder_hours: [24, 2] as number[],
  reminder_title: 'Recordatorio de turno',
  reminder_body_24h: 'Mañana a las {{hora}} te esperamos en {{sucursal}} con {{barbero}}.',
  reminder_body_2h: 'Tu turno es a las {{hora}} en {{sucursal}}. ¡Te esperamos!',
  appointment_cancelled_enabled: true,
  appointment_cancelled_body: 'Tu turno del {{fecha}} a las {{hora}} en {{sucursal}} fue cancelado. Podés reservar otro desde la app.',
  rewards_enabled: true,
  reward_body: '¡Tenés un premio nuevo! Entrá a la app para verlo.',
}

export type PushCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'

export const PUSH_STATUS_LABEL: Record<PushCampaignStatus, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  sending: 'Enviando',
  sent: 'Enviada',
  cancelled: 'Cancelada',
  failed: 'Con errores',
}
