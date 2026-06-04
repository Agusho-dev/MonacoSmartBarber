import { NextRequest, NextResponse } from 'next/server'
import { enqueueProdeReminders } from '@/lib/prode/reminders'

/**
 * Cron diario de recordatorios "jugá hoy" del Prode Mundial.
 *
 * Disparado por pg_cron (Supabase) vía HTTP a esta ruta (ver migración 087).
 * Convención del proyecto: las rutas nuevas de /api/cron/* NO usan CRON_SECRET
 * y deben ser idempotentes (safe de re-ejecutar / hit manual). La idempotencia
 * la garantiza enqueueProdeReminders() (skippea clientes ya encolados hoy).
 *
 * El cron `process-scheduled-messages` (cada minuto) luego envía los
 * scheduled_messages 'pending' a Meta y los registra en el inbox.
 */

// Org Monaco — único tenant con Prode Mundial por ahora.
const MONACO_ORG = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

async function handler(_req: NextRequest) {
  try {
    const res = await enqueueProdeReminders(MONACO_ORG)
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    console.error('[Cron] Error en prode-reminders:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handler(req)
}
export async function POST(req: NextRequest) {
  return handler(req)
}
