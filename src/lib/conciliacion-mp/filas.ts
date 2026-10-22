// =============================================================================
// src/lib/conciliacion-mp/filas.ts
// La forma de lo que se lee de la base para conciliar, ya en camelCase. Sólo
// tipos: lo importan el lector (datos.ts, server-only) y el armado de las
// tarjetas de cuentas (cuentas.ts, puro).
//
// Ningún tipo de acá lleva tokens: las columnas cifradas se leen únicamente en
// credenciales.ts, y nunca salen de ese archivo.
// =============================================================================

export interface SucursalFila {
  id: string
  nombre: string
}

/** Una cuenta de cobro (`payment_accounts`). */
export interface CuentaCobroFila {
  id: string
  sucursalId: string
  /** payment_accounts.name: el titular cargado en el sistema. */
  nombre: string
  alias: string | null
  activa: boolean
  orden: number | null
  cuentaMpId: string | null
  /** fuente_conciliacion = 'banco' */
  banco: boolean
}

/** Una cuenta de Mercado Pago conectada (`mp_cuentas`), SIN los tokens. */
export interface CuentaMpFila {
  id: string
  mpUserId: string
  nickname: string | null
  titular: string | null
  emailEnmascarado: string | null
  modo: 'oauth' | 'manual'
  status: 'conectada' | 'error' | 'revocada' | 'desconectada'
  lastError: string | null
  lastCheckAt: string | null
  sincronizadaDesde: string | null
  sincronizadaHasta: string | null
  lastSyncAt: string | null
  confirmadaAt: string | null
  connectedVia: 'dashboard' | 'link'
  syncLockUntil: string | null
}

/** Un link de conexión vigente (sin usar, sin anular, sin vencer). */
export interface LinkVigente {
  id: string
  paymentAccountId: string
  /** ISO */
  venceEn: string
  abierto: boolean
  /** ISO */
  creadoEn: string
}

/** El alias normalizado: minúsculas y sin espacios (la misma cuenta cargada en dos sucursales). */
export function normalizarAlias(alias: string | null | undefined): string {
  return (alias ?? '').toLowerCase().replace(/\s+/g, '')
}
