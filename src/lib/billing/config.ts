/**
 * Billing mode — switch único entre cobro manual y pasarela.
 *
 * En MODO MANUAL (default hoy):
 *   - `requestPlanChange` y `activateModule` crean rows en
 *     `subscription_requests`. El cliente queda en su plan actual hasta
 *     que un platform_admin registra el pago manualmente desde
 *     /platform/billing-requests o /platform/orgs/[id].
 *   - El cron `expire-trials` mueve trials vencidos a past_due con
 *     5 días de gracia y luego degrada a free.
 *   - No se llaman APIs externas (MercadoPago, Stripe, etc.).
 *
 * En MODO GATEWAY (futuro, cuando MERCADOPAGO esté integrado):
 *   - `requestPlanChange` llama `createPreapproval()` y devuelve
 *     `checkoutUrl` para redirigir al cliente.
 *   - Los webhooks de la pasarela escriben los mismos campos que hoy
 *     escribe `recordManualPayment()` — cero migración de datos.
 *   - Las suscripciones existentes en modo manual siguen funcionando;
 *     el switch puede ser gradual (per-org).
 *
 * Para activar la pasarela:
 *   1. Cambiar `BILLING_MODE` a 'mercadopago'.
 *   2. Setear MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_WEBHOOK_SECRET.
 *   3. Implementar el branch 'mercadopago' en `requestPlanChange`.
 *   4. Verificar que el webhook `/api/webhooks/mercadopago` está
 *      configurado en el panel de MP.
 */

export type BillingMode = 'manual' | 'mercadopago'

export const BILLING_MODE: BillingMode = 'manual'

export const isManualBilling = () => (BILLING_MODE as BillingMode) === 'manual'
export const isGatewayBilling = () => (BILLING_MODE as BillingMode) === 'mercadopago'

/**
 * Métodos de pago aceptados en modo manual.
 * Sincronizado con el ENUM `manual_payment_method` en la migración 115.
 */
export const MANUAL_PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia bancaria' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mp_link', label: 'Link de pago MP' },
  { value: 'usdt', label: 'USDT' },
  { value: 'otro', label: 'Otro' },
] as const

export type ManualPaymentMethod = typeof MANUAL_PAYMENT_METHODS[number]['value']

/**
 * Configuración por defecto del ciclo de vida de suscripciones manuales.
 * Cambiar acá afecta crons y nuevos trials.
 */
export const BILLING_DEFAULTS = {
  trialDays: 3,
  gracePeriodDays: 5,
  renewalReminderDays: 7,
  defaultPeriodMonths: 1,
} as const
