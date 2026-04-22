import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import {
  getPayment,
  getPreapproval,
  verifyMercadoPagoSignature,
} from '@/lib/billing/mercadopago'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Webhook endpoint de MercadoPago.
 *
 * Flujo:
 *   1. Leer raw body (no parsear antes para poder verificar HMAC).
 *   2. Verificar firma HMAC con MERCADOPAGO_WEBHOOK_SECRET.
 *   3. Upsert idempotente en billing_events por (provider, provider_event_id).
 *   4. Si ya existe y processed_at != null → 200 OK silencioso (reintento MP).
 *   5. Según topic: resolver recurso via API de MP y actualizar
 *      organization_subscriptions.
 *   6. Marcar processed_at; en error, guardar processing_error y devolver 500
 *      para que MP reintente.
 *
 * MP siempre reintenta hasta 200 OK, así que el cliente debe ser idempotente.
 */

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signatureHeader = req.headers.get('x-signature')
  const requestIdHeader = req.headers.get('x-request-id')

  const validSig = await verifyMercadoPagoSignature(rawBody, signatureHeader, requestIdHeader)
  if (!validSig) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: { type?: string; action?: string; data?: { id?: string | number } }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const eventId = String(payload.data?.id ?? '')
  const eventType = payload.type ?? payload.action ?? 'unknown'
  if (!eventId) {
    return NextResponse.json({ error: 'missing_event_id' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // 1. Guardar el evento idempotentemente.
  const { data: inserted, error: insertErr } = await supabase
    .from('billing_events')
    .upsert(
      {
        provider: 'mercadopago',
        provider_event_id: `${eventType}:${eventId}`,
        event_type: eventType,
        raw_payload: payload,
      },
      { onConflict: 'provider,provider_event_id' },
    )
    .select('id, processed_at')
    .single()

  if (insertErr) {
    console.error('[mp-webhook] insert failed', insertErr)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  if (inserted?.processed_at) {
    // Reintento de MP sobre un evento ya procesado — OK silencioso.
    return NextResponse.json({ ok: true, idempotent: true })
  }

  // 2. Procesar según topic
  try {
    await processEvent(eventType, eventId, supabase)

    await supabase
      .from('billing_events')
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq('id', inserted.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[mp-webhook] processing failed', eventType, eventId, message)
    await supabase
      .from('billing_events')
      .update({ processing_error: message })
      .eq('id', inserted.id)
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}

type SupabaseClient = ReturnType<typeof createAdminClient>

async function processEvent(
  eventType: string,
  eventId: string,
  supabase: SupabaseClient,
) {
  // Topics relevantes:
  //   - preapproval  (suscripciones: created/authorized/updated/cancelled)
  //   - payment      (cobros recurrentes — update next_period_end)
  //   - subscription_preapproval

  if (eventType.startsWith('preapproval') || eventType === 'subscription_preapproval') {
    const pre = await getPreapproval(eventId)
    await syncSubscriptionFromPreapproval(pre, supabase)
    return
  }

  if (eventType.startsWith('payment') || eventType === 'subscription_authorized_payment') {
    const payment = await getPayment(eventId)
    await handlePayment(payment, supabase)
    return
  }

  // Otros topics: ignorar silenciosamente (el evento ya quedó guardado).
}

async function syncSubscriptionFromPreapproval(
  pre: Awaited<ReturnType<typeof getPreapproval>>,
  supabase: SupabaseClient,
) {
  // external_reference = "{orgId}:{planId}:{ts}"
  const ref = pre.external_reference ?? ''
  const [orgId, planId] = ref.split(':')
  if (!orgId || !planId) {
    console.warn('[mp-webhook] preapproval sin external_reference válido', ref)
    return
  }

  const statusMap: Record<string, string> = {
    pending: 'incomplete',
    authorized: 'active',
    paused: 'paused',
    cancelled: 'cancelled',
  }
  const status = statusMap[pre.status] ?? 'incomplete'

  const updates: Record<string, unknown> = {
    plan_id: planId,
    status,
    provider: 'mercadopago',
    provider_subscription_id: pre.id,
    provider_customer_id: pre.payer_email,
  }

  if (pre.next_payment_date) {
    updates.current_period_end = pre.next_payment_date
  }
  if (pre.status === 'authorized') {
    updates.current_period_start = new Date().toISOString()
  }

  const { error } = await supabase
    .from('organization_subscriptions')
    .update(updates)
    .eq('organization_id', orgId)

  if (error) throw new Error(`update subscription failed: ${error.message}`)
}

async function handlePayment(
  payment: Awaited<ReturnType<typeof getPayment>>,
  supabase: SupabaseClient,
) {
  if (!payment.preapproval_id) return
  const pre = await getPreapproval(payment.preapproval_id)
  const ref = pre.external_reference ?? ''
  const [orgId] = ref.split(':')
  if (!orgId) return

  if (payment.status === 'approved') {
    // Avanzar el ciclo
    await supabase
      .from('organization_subscriptions')
      .update({
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: pre.next_payment_date ?? null,
      })
      .eq('organization_id', orgId)
  } else if (payment.status === 'rejected') {
    await supabase
      .from('organization_subscriptions')
      .update({ status: 'past_due' })
      .eq('organization_id', orgId)
  }
}
