'use client'

/**
 * WalkInFlow — Flujo walk-in (sin cita, por orden de llegada).
 *
 * Este componente es una extracción del flujo original de check-in que vivía
 * en `src/app/(tablet)/checkin/page.tsx`. No tiene cambios visuales respecto
 * al original: solo re-exporta CheckinWalkIn (que contiene toda la lógica
 * y UI del kiosk walk-in original).
 *
 * Al agregar nuevos modos (appointments, hybrid) el page.tsx delega a este
 * componente para mantener la regresión 0 en el flujo walk-in.
 */

// Re-exporta el componente interno que contiene toda la lógica walk-in.
// CheckinWalkIn es el componente original (ex-page.tsx) sin cambios visuales.
export { CheckinWalkIn as WalkInFlow } from '@/app/(tablet)/checkin/checkin-walk-in'

