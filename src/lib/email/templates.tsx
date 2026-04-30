/* eslint-disable react/no-unknown-property */
/**
 * Templates de email — JSX puro renderizado server-side con react-dom/server.
 * Sin Tailwind ni hooks — sólo HTML/CSS inline para máxima compatibilidad.
 */

import * as React from 'react'

const COLORS = {
  bg: '#0a0a0a',
  card: '#1a1a1a',
  border: '#2a2a2a',
  text: '#e4e4e7',
  muted: '#a1a1aa',
  primary: '#6366f1',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
}

function Layout({ children, preview }: { children: React.ReactNode; preview?: string }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>BarberOS</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: COLORS.bg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: COLORS.text }}>
        {preview && (
          <div style={{ display: 'none', overflow: 'hidden', maxHeight: 0, fontSize: 1, lineHeight: 1, color: COLORS.bg }}>
            {preview}
          </div>
        )}
        <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ backgroundColor: COLORS.bg, padding: '40px 20px' }}>
          <tbody>
            <tr>
              <td align="center">
                <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="600" style={{ maxWidth: 600, width: '100%', backgroundColor: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '32px 32px 24px 32px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <div style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 6, background: 'linear-gradient(90deg,#6366f1,#a855f7)', color: '#fff', fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>
                          BARBEROS
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '24px 32px 32px 32px' }}>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '20px 32px', borderTop: `1px solid ${COLORS.border}`, fontSize: 12, color: COLORS.muted, textAlign: 'center' }}>
                        Recibís este email porque tenés una organización en BarberOS.<br />
                        ¿Necesitás ayuda? Escribinos a <a href="mailto:barberos.system@gmail.com" style={{ color: COLORS.primary }}>barberos.system@gmail.com</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h1 style={{ margin: '0 0 16px 0', fontSize: 22, fontWeight: 600, color: COLORS.text }}>{children}</h1>
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 14px 0', fontSize: 14, lineHeight: 1.6, color: COLORS.text }}>{children}</p>
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 14px 0', fontSize: 13, lineHeight: 1.5, color: COLORS.muted }}>{children}</p>
}

function CTA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: '20px 0' }}>
      <tbody>
        <tr>
          <td>
            <a href={href} style={{ display: 'inline-block', padding: '12px 22px', borderRadius: 8, backgroundColor: COLORS.primary, color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function InfoBox({ tone = 'default', children }: { tone?: 'default' | 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
  const colors = {
    default: { border: COLORS.border, bg: 'rgba(99,102,241,0.05)', text: COLORS.text },
    success: { border: 'rgba(16,185,129,0.3)', bg: 'rgba(16,185,129,0.08)', text: COLORS.emerald },
    warning: { border: 'rgba(245,158,11,0.3)', bg: 'rgba(245,158,11,0.08)', text: COLORS.amber },
    danger: { border: 'rgba(244,63,94,0.3)', bg: 'rgba(244,63,94,0.08)', text: COLORS.rose },
  }[tone]
  return (
    <div style={{ margin: '16px 0', padding: 16, border: `1px solid ${colors.border}`, backgroundColor: colors.bg, borderRadius: 8, fontSize: 13, color: colors.text }}>
      {children}
    </div>
  )
}

function Greeting({ name }: { name: string | null }) {
  return <P>{name ? `Hola ${name},` : 'Hola,'}</P>
}

function appUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.barberos.io'
  return `${base.replace(/\/$/, '')}${path}`
}

function formatArs(cents: number) {
  return (cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

// ============================================================
// 1) Welcome (al registrarse)
// ============================================================
export function WelcomeEmail({ orgName, ownerName, trialDays, trialEndsAt }: {
  orgName: string; ownerName: string | null; trialDays: number; trialEndsAt: string
}) {
  return (
    <Layout preview={`Tu trial de ${trialDays} días empieza ahora`}>
      <Heading>Bienvenido a BarberOS 👋</Heading>
      <Greeting name={ownerName} />
      <P>Activamos <strong>{orgName}</strong> con un trial de <strong>{trialDays} día{trialDays === 1 ? '' : 's'}</strong> con todas las funciones del plan Pro desbloqueadas.</P>
      <InfoBox tone="success">
        <strong>Tu trial vence el {formatDate(trialEndsAt)}.</strong><br />
        Antes de esa fecha, podés elegir un plan para que no se interrumpa el servicio.
      </InfoBox>
      <P>Mientras tanto, te recomendamos arrancar por:</P>
      <ul style={{ margin: '0 0 14px 20px', padding: 0, fontSize: 14, lineHeight: 1.8, color: COLORS.text }}>
        <li>Cargar tus servicios y precios</li>
        <li>Sumar a tu equipo (barberos, recepción)</li>
        <li>Conectar WhatsApp para mensajes con clientes</li>
      </ul>
      <CTA href={appUrl('/dashboard')}>Ir al dashboard</CTA>
      <Muted>Cualquier duda, respondé este email — leemos todo.</Muted>
    </Layout>
  )
}

// ============================================================
// 2) Trial vence pronto
// ============================================================
export function TrialEndingSoonEmail({ orgName, ownerName, daysLeft, trialEndsAt }: {
  orgName: string; ownerName: string | null; daysLeft: number; trialEndsAt: string
}) {
  return (
    <Layout preview={`Tu trial vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}>
      <Heading>Tu trial vence en {daysLeft} día{daysLeft === 1 ? '' : 's'} ⏰</Heading>
      <Greeting name={ownerName} />
      <P>El trial de <strong>{orgName}</strong> termina el <strong>{formatDate(trialEndsAt)}</strong>.</P>
      <P>Para no perder acceso a las funciones que ya estás usando, elegí un plan desde tu dashboard. Te contactamos por WhatsApp/email para coordinar el pago — sin pasarela automática, todo a tu ritmo.</P>
      <CTA href={appUrl('/dashboard/billing')}>Elegir plan</CTA>
      <Muted>Si no hacés nada, tu cuenta queda en plan Free al vencer el trial. No perdés tus datos, pero algunas funciones se limitan.</Muted>
    </Layout>
  )
}

// ============================================================
// 3) Trial finalizado
// ============================================================
export function TrialEndedEmail({ orgName, ownerName }: {
  orgName: string; ownerName: string | null
}) {
  return (
    <Layout preview="Tu trial finalizó">
      <Heading>Tu trial finalizó</Heading>
      <Greeting name={ownerName} />
      <P>El trial de <strong>{orgName}</strong> ya venció. Te dejamos 5 días de gracia para coordinar el pago manual con nosotros — durante ese tiempo seguís con todas las funciones.</P>
      <InfoBox tone="warning">
        Si en 5 días no coordinamos el pago, tu cuenta pasa a plan <strong>Free</strong> automáticamente: vas a poder seguir usando lo esencial, pero algunas funciones (mensajería, agenda online, comisiones, etc.) quedan bloqueadas.
      </InfoBox>
      <CTA href={appUrl('/dashboard/billing')}>Coordinar pago</CTA>
    </Layout>
  )
}

// ============================================================
// 4) Solicitud recibida (cliente confirma + interno BCC)
// ============================================================
export function SubscriptionRequestReceivedEmail({ orgName, ownerName, planName, cycle, kind }: {
  orgName: string; ownerName: string | null
  planName: string
  cycle: 'monthly' | 'yearly'
  kind: 'plan_change' | 'renewal' | 'module_addon'
}) {
  const action = kind === 'renewal' ? 'renovación' : kind === 'module_addon' ? 'activación de add-on' : 'cambio de plan'
  return (
    <Layout preview="Recibimos tu solicitud">
      <Heading>Recibimos tu solicitud ✅</Heading>
      <Greeting name={ownerName} />
      <P>Registramos tu solicitud de <strong>{action}</strong> para <strong>{orgName}</strong>:</P>
      <InfoBox>
        Plan: <strong>{planName}</strong><br />
        Ciclo: <strong>{cycle === 'yearly' ? 'Anual' : 'Mensual'}</strong>
      </InfoBox>
      <P>En menos de 24 horas te escribimos por WhatsApp o email para coordinar el pago. Aceptamos transferencia bancaria, link de Mercado Pago, efectivo y otros medios.</P>
      <Muted>Mientras tanto seguís con tu plan actual y el acceso intacto.</Muted>
    </Layout>
  )
}

// ============================================================
// 5) Pago registrado
// ============================================================
export function PaymentRecordedEmail({
  orgName, ownerName, planName, amountArs, periodStart, periodEnd, method, reference,
}: {
  orgName: string; ownerName: string | null
  planName: string
  amountArs: number       // en centavos
  periodStart: string
  periodEnd: string
  method: string
  reference: string | null
}) {
  return (
    <Layout preview="Pago confirmado">
      <Heading>Pago confirmado 🎉</Heading>
      <Greeting name={ownerName} />
      <P>Confirmamos el pago de <strong>{orgName}</strong>. Tu plan queda activo hasta el <strong>{formatDate(periodEnd)}</strong>.</P>
      <InfoBox tone="success">
        <table role="presentation" cellPadding={0} cellSpacing={0} border={0} width="100%" style={{ fontSize: 13 }}>
          <tbody>
            <tr><td style={{ paddingBottom: 4, color: COLORS.muted }}>Plan</td><td style={{ paddingBottom: 4, textAlign: 'right' }}><strong>{planName}</strong></td></tr>
            <tr><td style={{ paddingBottom: 4, color: COLORS.muted }}>Monto</td><td style={{ paddingBottom: 4, textAlign: 'right' }}><strong>AR$ {formatArs(amountArs)}</strong></td></tr>
            <tr><td style={{ paddingBottom: 4, color: COLORS.muted }}>Período</td><td style={{ paddingBottom: 4, textAlign: 'right' }}>{formatDate(periodStart)} → {formatDate(periodEnd)}</td></tr>
            <tr><td style={{ paddingBottom: 4, color: COLORS.muted }}>Método</td><td style={{ paddingBottom: 4, textAlign: 'right' }}>{method}</td></tr>
            {reference && <tr><td style={{ color: COLORS.muted }}>Referencia</td><td style={{ textAlign: 'right' }}>{reference}</td></tr>}
          </tbody>
        </table>
      </InfoBox>
      <CTA href={appUrl('/dashboard/billing/historial')}>Ver historial</CTA>
    </Layout>
  )
}

// ============================================================
// 6) Renovación próxima (7 días antes)
// ============================================================
export function RenewalDueSoonEmail({ orgName, ownerName, planName, periodEnd, daysLeft }: {
  orgName: string; ownerName: string | null
  planName: string; periodEnd: string; daysLeft: number
}) {
  return (
    <Layout preview={`Tu plan ${planName} vence en ${daysLeft} días`}>
      <Heading>Tu plan vence pronto</Heading>
      <Greeting name={ownerName} />
      <P>El plan <strong>{planName}</strong> de <strong>{orgName}</strong> vence el <strong>{formatDate(periodEnd)}</strong> (en {daysLeft} día{daysLeft === 1 ? '' : 's'}).</P>
      <P>Para evitar interrupción, podés solicitar la renovación desde tu dashboard. Te escribimos por WhatsApp/email para coordinar el pago.</P>
      <CTA href={appUrl('/dashboard/billing')}>Solicitar renovación</CTA>
    </Layout>
  )
}

// ============================================================
// 7) Past due
// ============================================================
export function PastDueWarningEmail({ orgName, ownerName, graceDays, graceEndsAt }: {
  orgName: string; ownerName: string | null; graceDays: number; graceEndsAt: string
}) {
  return (
    <Layout preview="Acción requerida — pago pendiente">
      <Heading>Acción requerida 🚨</Heading>
      <Greeting name={ownerName} />
      <P>Tu plan en <strong>{orgName}</strong> tiene un pago pendiente.</P>
      <InfoBox tone="danger">
        Tenés <strong>{graceDays} día{graceDays === 1 ? '' : 's'} de gracia</strong> hasta el <strong>{formatDate(graceEndsAt)}</strong> para coordinar el pago.<br />
        Después de esa fecha, tu cuenta pasa a plan <strong>Free</strong> automáticamente y algunas funciones se bloquean.
      </InfoBox>
      <CTA href={appUrl('/dashboard/billing')}>Renovar ahora</CTA>
      <Muted>Si ya hiciste el pago, ignorá este mensaje — registramos el cobro a la brevedad.</Muted>
    </Layout>
  )
}

// ============================================================
// 8) Downgrade a free
// ============================================================
export function DowngradeNoticeEmail({ orgName, ownerName }: {
  orgName: string; ownerName: string | null
}) {
  return (
    <Layout preview="Tu plan pasó a Free">
      <Heading>Tu plan pasó a Free</Heading>
      <Greeting name={ownerName} />
      <P>El período de gracia venció sin pago. <strong>{orgName}</strong> ahora está en plan <strong>Free</strong>.</P>
      <P>Tus datos siguen intactos, pero algunas funciones se limitan. Si querés volver a un plan paid, podés solicitarlo en cualquier momento desde tu dashboard.</P>
      <CTA href={appUrl('/dashboard/billing')}>Ver planes</CTA>
    </Layout>
  )
}
