/**
 * Mapa de ruta del dashboard → clave de feature del plan.
 * Usado por el sidebar y el guard de páginas para saber si un módulo
 * está incluido en el plan de la org.
 *
 * Las claves aquí deben coincidir con `plans.features` y con `modules.feature_key`.
 */

export type NavFeatureMeta = {
  featureKey: string | null         // null = core (sin gate)
  moduleId: string | null           // id del módulo (para waitlist coming_soon)
  minPlan?: 'start' | 'pro' | 'enterprise'
}

export const NAV_FEATURE_MAP: Record<string, NavFeatureMeta> = {
  '/dashboard/fila':           { featureKey: 'queue.enabled',          moduleId: 'queue' },
  '/dashboard/turnos':         { featureKey: 'appointments.enabled',   moduleId: 'appointments',        minPlan: 'pro' },
  '/dashboard/sucursales':     { featureKey: null,                     moduleId: null },
  '/dashboard/equipo':         { featureKey: null,                     moduleId: null },
  '/dashboard/servicios':      { featureKey: 'services.enabled',       moduleId: 'services' },
  '/dashboard/clientes':       { featureKey: 'clients.enabled',        moduleId: 'clients' },
  '/dashboard/mensajeria':     { featureKey: 'messaging.inbox',        moduleId: 'messaging_whatsapp',  minPlan: 'pro' },
  '/dashboard/app-movil':      { featureKey: 'mobile_app.enabled',     moduleId: 'mobile_app',          minPlan: 'pro' },
  '/dashboard/convenios':      { featureKey: 'agreements.enabled',     moduleId: 'agreements',          minPlan: 'enterprise' },
  '/dashboard/estadisticas':   { featureKey: 'reports.basic',          moduleId: 'reports_basic',       minPlan: 'start' },
  '/dashboard/caja':           { featureKey: 'caja.basic',             moduleId: 'caja_basic' },
  '/dashboard/finanzas':       { featureKey: 'finances.advanced',      moduleId: 'fixed_expenses',      minPlan: 'pro' },
  '/dashboard/configuracion':  { featureKey: null,                     moduleId: null },
  '/dashboard/billing':        { featureKey: null,                     moduleId: null },
}

export function getNavFeatureMeta(href: string): NavFeatureMeta {
  return NAV_FEATURE_MAP[href] ?? { featureKey: null, moduleId: null }
}

/** Devuelve el plan mínimo legible para mostrar en badges */
export function minPlanLabel(p: 'start' | 'pro' | 'enterprise'): string {
  return p === 'start' ? 'Start' : p === 'pro' ? 'Pro' : 'Enterprise'
}
