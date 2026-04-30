/**
 * Helper centralizado para emails transaccionales (Resend REST API).
 *
 * Llamamos directo al endpoint HTTP de Resend en vez de usar su SDK
 * (`npm install resend`) — así evitamos sumar una dependencia y el
 * helper queda 100% portable. La API es simple: POST /emails con
 * Bearer token.
 *
 * Tolerante a fallos: si RESEND_API_KEY no está configurada, loguea y
 * devuelve `null`. Nunca tira excepciones (los emails no deben romper
 * el flow principal).
 */

import type { ReactElement } from 'react'
import {
  WelcomeEmail,
  TrialEndingSoonEmail,
  TrialEndedEmail,
  SubscriptionRequestReceivedEmail,
  PaymentRecordedEmail,
  RenewalDueSoonEmail,
  PastDueWarningEmail,
  DowngradeNoticeEmail,
} from './templates'

const FROM_DEFAULT = 'BarberOS <barberos.system@gmail.com>'
const REPLY_TO_DEFAULT = 'barberos.system@gmail.com'
const RESEND_API = 'https://api.resend.com/emails'

interface SendOptions {
  to: string | string[]
  subject: string
  react: ReactElement
  from?: string
  replyTo?: string
  bcc?: string | string[]
}

async function send(opts: SendOptions): Promise<{ id: string } | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no configurada — emails desactivados.')
    return null
  }
  if (!opts.to || (Array.isArray(opts.to) && opts.to.length === 0)) {
    console.warn('[email] sin destinatario, salteando envío')
    return null
  }

  try {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = '<!doctype html>' + renderToStaticMarkup(opts.react)
    const body = {
      from: opts.from ?? FROM_DEFAULT,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html,
      reply_to: opts.replyTo ?? REPLY_TO_DEFAULT,
      bcc: opts.bcc ? (Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc]) : undefined,
    }
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[email] Resend error:', res.status, text)
      return null
    }
    const data = (await res.json()) as { id?: string }
    return data.id ? { id: data.id } : null
  } catch (err) {
    console.error('[email] send failed:', err)
    return null
  }
}

// ============================================================
// Senders por evento
// ============================================================

export interface OrgEmailContext {
  orgName: string
  ownerEmail: string
  ownerName?: string | null
}

export async function sendWelcomeEmail(ctx: OrgEmailContext & { trialDays: number; trialEndsAt: string }) {
  return send({
    to: ctx.ownerEmail,
    subject: `Bienvenido a BarberOS · empezó tu trial de ${ctx.trialDays} días`,
    react: WelcomeEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      trialDays: ctx.trialDays,
      trialEndsAt: ctx.trialEndsAt,
    }),
  })
}

export async function sendTrialEndingSoonEmail(ctx: OrgEmailContext & { trialEndsAt: string; daysLeft: number }) {
  return send({
    to: ctx.ownerEmail,
    subject: `Tu trial vence en ${ctx.daysLeft} día${ctx.daysLeft === 1 ? '' : 's'}`,
    react: TrialEndingSoonEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      daysLeft: ctx.daysLeft,
      trialEndsAt: ctx.trialEndsAt,
    }),
  })
}

export async function sendTrialEndedEmail(ctx: OrgEmailContext) {
  return send({
    to: ctx.ownerEmail,
    subject: 'Tu trial de BarberOS finalizó',
    react: TrialEndedEmail({ orgName: ctx.orgName, ownerName: ctx.ownerName ?? null }),
  })
}

export async function sendSubscriptionRequestReceivedEmail(ctx: OrgEmailContext & {
  planName: string
  cycle: 'monthly' | 'yearly'
  kind: 'plan_change' | 'renewal' | 'module_addon'
}) {
  return send({
    to: ctx.ownerEmail,
    bcc: 'barberos.system@gmail.com',
    subject: 'Recibimos tu solicitud · BarberOS',
    react: SubscriptionRequestReceivedEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      planName: ctx.planName,
      cycle: ctx.cycle,
      kind: ctx.kind,
    }),
  })
}

export async function sendPaymentRecordedEmail(ctx: OrgEmailContext & {
  planName: string
  amountArs: number
  periodStart: string
  periodEnd: string
  method: string
  reference: string | null
}) {
  return send({
    to: ctx.ownerEmail,
    subject: `Pago confirmado · plan activo hasta ${new Date(ctx.periodEnd).toLocaleDateString('es-AR')}`,
    react: PaymentRecordedEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      planName: ctx.planName,
      amountArs: ctx.amountArs,
      periodStart: ctx.periodStart,
      periodEnd: ctx.periodEnd,
      method: ctx.method,
      reference: ctx.reference,
    }),
  })
}

export async function sendRenewalDueSoonEmail(ctx: OrgEmailContext & {
  planName: string
  periodEnd: string
  daysLeft: number
}) {
  return send({
    to: ctx.ownerEmail,
    subject: `Tu plan ${ctx.planName} vence en ${ctx.daysLeft} días`,
    react: RenewalDueSoonEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      planName: ctx.planName,
      periodEnd: ctx.periodEnd,
      daysLeft: ctx.daysLeft,
    }),
  })
}

export async function sendPastDueWarningEmail(ctx: OrgEmailContext & {
  graceDays: number
  graceEndsAt: string
}) {
  return send({
    to: ctx.ownerEmail,
    subject: 'Acción requerida · tu plan tiene un pago pendiente',
    react: PastDueWarningEmail({
      orgName: ctx.orgName,
      ownerName: ctx.ownerName ?? null,
      graceDays: ctx.graceDays,
      graceEndsAt: ctx.graceEndsAt,
    }),
  })
}

export async function sendDowngradeNoticeEmail(ctx: OrgEmailContext) {
  return send({
    to: ctx.ownerEmail,
    subject: 'Tu plan pasó a Free — algunas funciones quedaron limitadas',
    react: DowngradeNoticeEmail({ orgName: ctx.orgName, ownerName: ctx.ownerName ?? null }),
  })
}
