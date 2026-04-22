// ============================================================
// Cliente MercadoPago (Subscriptions / Preapprovals v2)
// ============================================================
// Usa fetch directo a la REST API de MP para no sumar dependencias.
// Cubre lo que el flujo básico de SaaS necesita:
//   - Crear preapproval (checkout de suscripción)
//   - Obtener preapproval (estado + próximo pago)
//   - Actualizar preapproval (cambio de monto en upgrade/downgrade)
//   - Pausar / cancelar preapproval
//   - Leer payment (webhook follow-up)
//
// Docs de referencia:
//   https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
//
// Requiere variables de entorno:
//   MERCADOPAGO_ACCESS_TOKEN    (server-only)
//   MERCADOPAGO_WEBHOOK_SECRET  (para validar HMAC del webhook)
// ============================================================

const BASE = 'https://api.mercadopago.com'

function token(): string {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!t) throw new Error('MERCADOPAGO_ACCESS_TOKEN no configurado')
  return t
}

export type MpFrequencyType = 'months' | 'days'

export type MpPreapprovalInput = {
  reason: string                      // "MSB Pro mensual"
  payerEmail: string
  transactionAmount: number           // en unidades (no centavos)
  currencyId: 'ARS' | 'USD'
  frequency: number
  frequencyType: MpFrequencyType
  backUrl: string
  externalReference: string           // "{orgId}:{planId}:{ts}"
  startDate?: string                  // ISO
  endDate?: string
}

export type MpPreapproval = {
  id: string
  status: 'pending' | 'authorized' | 'paused' | 'cancelled'
  init_point: string
  payer_email: string
  auto_recurring: {
    transaction_amount: number
    currency_id: string
    frequency: number
    frequency_type: string
    start_date?: string
    end_date?: string
  }
  next_payment_date?: string
  last_modified?: string
  external_reference?: string
}

export async function createPreapproval(input: MpPreapprovalInput): Promise<MpPreapproval> {
  const res = await fetch(`${BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: input.reason,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      external_reference: input.externalReference,
      auto_recurring: {
        frequency: input.frequency,
        frequency_type: input.frequencyType,
        transaction_amount: input.transactionAmount,
        currency_id: input.currencyId,
        start_date: input.startDate,
        end_date: input.endDate,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`MP createPreapproval failed: ${res.status} ${body}`)
  }
  return res.json() as Promise<MpPreapproval>
}

export async function getPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  const res = await fetch(`${BASE}/preapproval/${preapprovalId}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`MP getPreapproval ${preapprovalId} failed: ${res.status}`)
  return res.json() as Promise<MpPreapproval>
}

export async function updatePreapprovalAmount(
  preapprovalId: string,
  newAmount: number,
): Promise<MpPreapproval> {
  const res = await fetch(`${BASE}/preapproval/${preapprovalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auto_recurring: { transaction_amount: newAmount },
    }),
  })
  if (!res.ok) throw new Error(`MP updatePreapproval failed: ${res.status}`)
  return res.json() as Promise<MpPreapproval>
}

export async function pausePreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return updatePreapprovalStatus(preapprovalId, 'paused')
}

export async function cancelPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return updatePreapprovalStatus(preapprovalId, 'cancelled')
}

async function updatePreapprovalStatus(
  preapprovalId: string,
  status: 'paused' | 'cancelled' | 'authorized',
): Promise<MpPreapproval> {
  const res = await fetch(`${BASE}/preapproval/${preapprovalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) throw new Error(`MP updatePreapprovalStatus ${status} failed: ${res.status}`)
  return res.json() as Promise<MpPreapproval>
}

export type MpPayment = {
  id: number
  status: 'approved' | 'authorized' | 'in_process' | 'rejected' | 'refunded' | 'cancelled' | 'pending'
  status_detail: string
  transaction_amount: number
  currency_id: string
  external_reference?: string
  preapproval_id?: string
  date_approved?: string
  date_created: string
}

export async function getPayment(paymentId: string | number): Promise<MpPayment> {
  const res = await fetch(`${BASE}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token()}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`MP getPayment ${paymentId} failed: ${res.status}`)
  return res.json() as Promise<MpPayment>
}

// ============================================================
// Validación HMAC del webhook
// ============================================================

export async function verifyMercadoPagoSignature(
  rawBody: string,
  signatureHeader: string | null,
  requestIdHeader: string | null,
): Promise<boolean> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[mercadopago] MERCADOPAGO_WEBHOOK_SECRET no configurado — se acepta sin validar')
    return true
  }
  if (!signatureHeader) return false

  // MP envía "ts=xxx,v1=xxx"
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.trim().split('=', 2) as [string, string]),
  )
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  // El payload firmado es: id:<resource_id>;request-id:<x-request-id>;ts:<ts>;
  let parsedId: string | number | undefined
  try {
    const body = JSON.parse(rawBody)
    parsedId = body?.data?.id ?? body?.id
  } catch { return false }

  const signedPayload = `id:${parsedId};request-id:${requestIdHeader ?? ''};ts:${ts};`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload))
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return sigHex === v1
}
