import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, AlertCircle, AlertTriangle, Clock, MailCheck } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getEntitlements } from '@/lib/actions/entitlements'
import { createAdminClient } from '@/lib/supabase/server'
import { isManualBilling } from '@/lib/billing/config'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UsageMeter } from '@/components/billing/usage-meter'
import { PlanCompareGrid } from './plan-compare-grid'
import { CancelReactivateButtons } from './cancel-reactivate-buttons'
import { RenewButton } from './renew-button'
import { CancelRequestButton } from './cancel-request-button'

export const dynamic = 'force-dynamic'

function formatArs(centavos: number): string {
  return `AR$ ${(centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function daysFromNow(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

export default async function BillingPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const ent = await getEntitlements(orgId)
  if (!ent) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="mt-4 text-muted-foreground">
          No encontramos una suscripción para tu cuenta. Contactanos si esto es un error.
        </p>
      </div>
    )
  }

  const supabase = createAdminClient()
  const [plansRes, pendingReqRes, subRes] = await Promise.all([
    supabase
      .from('plans')
      .select('id, name, tagline, price_ars_monthly, price_ars_yearly, features, limits, sort_order, is_public')
      .eq('is_public', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('subscription_requests')
      .select('id, requested_plan_id, requested_billing_cycle, status, request_kind, created_at, contacted_at, plans:requested_plan_id ( name )')
      .eq('organization_id', orgId)
      .in('status', ['pending', 'contacted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('organization_subscriptions')
      .select('grace_period_ends_at, billing_email, billing_whatsapp')
      .eq('organization_id', orgId)
      .maybeSingle(),
  ])

  const plans = plansRes.data ?? []
  const pendingRequest = pendingReqRes.data
  const sub = subRes.data
  const currentPlanPrice = ent.plan.price_ars_monthly

  const trialDaysLeft = ent.status === 'trialing' && ent.trialEndsAt
    ? Math.max(0, daysFromNow(typeof ent.trialEndsAt === 'string' ? ent.trialEndsAt : ent.trialEndsAt.toISOString()))
    : null
  const graceDaysLeft = ent.status === 'past_due' && sub?.grace_period_ends_at
    ? Math.max(0, daysFromNow(sub.grace_period_ends_at))
    : null

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-sm text-muted-foreground">
          Administrá tu plan y consultá el historial. Coordinamos los pagos por WhatsApp/email.
        </p>
      </div>

      {/* Banner: solicitud pendiente */}
      {pendingRequest && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-indigo-400" />
          <div className="flex-1">
            <h3 className="font-medium text-indigo-300">
              {pendingRequest.status === 'contacted' ? 'Estamos coordinando tu pago' : 'Solicitud registrada'}
            </h3>
            <p className="mt-1 text-sm text-zinc-300">
              {pendingRequest.request_kind === 'renewal' ? 'Renovación' : pendingRequest.request_kind === 'module_addon' ? 'Activación de add-on' : 'Cambio'} a{' '}
              <strong className="capitalize">{(pendingRequest.plans as { name?: string } | null)?.name ?? pendingRequest.requested_plan_id}</strong>
              {' '}({pendingRequest.requested_billing_cycle === 'yearly' ? 'anual' : 'mensual'}).
              {pendingRequest.status === 'contacted'
                ? ' Ya nos contactamos con vos por los detalles del pago.'
                : ' Te escribimos por WhatsApp/email en menos de 24hs para coordinar el pago.'}
            </p>
            <div className="mt-2">
              <CancelRequestButton />
            </div>
          </div>
        </div>
      )}

      {/* Banner: trial por vencer */}
      {ent.status === 'trialing' && trialDaysLeft !== null && trialDaysLeft <= 3 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <Clock className="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div className="flex-1">
            <h3 className="font-medium text-amber-300">
              {trialDaysLeft === 0 ? 'Tu trial vence hoy' : `Tu trial vence en ${trialDaysLeft} día${trialDaysLeft === 1 ? '' : 's'}`}
            </h3>
            <p className="mt-1 text-sm text-zinc-300">
              Elegí un plan abajo y te contactamos para coordinar el pago. Si no hacés nada, tu cuenta queda en plan Free al finalizar el trial.
            </p>
          </div>
        </div>
      )}

      {/* Banner: past_due */}
      {ent.status === 'past_due' && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-400" />
          <div className="flex-1">
            <h3 className="font-medium text-rose-300">
              Tu plan está pendiente de pago
            </h3>
            <p className="mt-1 text-sm text-zinc-300">
              {graceDaysLeft !== null
                ? `Tenés ${graceDaysLeft} día${graceDaysLeft === 1 ? '' : 's'} de gracia para coordinar el pago. Después la cuenta queda en plan Free.`
                : 'Coordiná el pago a la brevedad o tu cuenta pasará a plan Free.'}
            </p>
            <div className="mt-2">
              <RenewButton planId={ent.plan.id} label="Renovar mi plan" />
            </div>
          </div>
        </div>
      )}

      {/* Plan actual */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold">Plan {ent.plan.name}</h2>
              <Badge variant={ent.status === 'active' ? 'secondary' : ent.status === 'trialing' ? 'default' : 'destructive'}>
                {ent.status === 'trialing' ? 'Trial activo' :
                 ent.status === 'active' ? 'Activo' :
                 ent.status === 'past_due' ? 'Pago pendiente' :
                 ent.status === 'cancelled' ? 'Cancelado' : ent.status}
              </Badge>
              {ent.isGrandfathered && (
                <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                  Grandfathered
                </Badge>
              )}
            </div>
            {ent.plan.tagline && <p className="mt-1 text-sm text-muted-foreground">{ent.plan.tagline}</p>}
            {ent.status === 'trialing' && ent.trialEndsAt && (
              <p className="mt-2 text-sm">
                Tu trial termina el{' '}
                <strong>{new Date(ent.trialEndsAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>.
              </p>
            )}
            {ent.currentPeriodEnd && ent.status === 'active' && !ent.isGrandfathered && (
              <p className="mt-2 text-sm text-muted-foreground">
                Próxima renovación: {new Date(ent.currentPeriodEnd).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
          <div className="text-right">
            {currentPlanPrice > 0 && (
              <>
                <p className="text-2xl font-bold">{formatArs(currentPlanPrice)}</p>
                <p className="text-xs text-muted-foreground">por mes</p>
              </>
            )}
            {currentPlanPrice === 0 && <p className="text-lg font-medium text-muted-foreground">Gratis</p>}
          </div>
        </div>

        {ent.status === 'cancelled' && ent.cancelAtPeriodEnd && (
          <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mr-2 inline size-4" />
            Tu suscripción se cancela al finalizar el período. Podés reactivarla cuando quieras.
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UsageMeter label="Sucursales" current={ent.currentUsage.branches} limit={ent.limits.branches} />
          <UsageMeter label="Empleados" current={ent.currentUsage.staff} limit={ent.limits.staff} />
          <UsageMeter label="Clientes" current={ent.currentUsage.clients} limit={ent.limits.clients} />
          <UsageMeter label="Broadcasts (mes)" current={ent.currentUsage.broadcasts_this_month} limit={ent.limits.broadcasts_monthly} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/billing/modulos">
              Ver add-ons disponibles
              <ArrowUpRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/billing/historial">Historial de pagos</Link>
          </Button>
          {ent.status === 'active' && !ent.isGrandfathered && !pendingRequest && (
            <RenewButton planId={ent.plan.id} label="Solicitar renovación" />
          )}
          <CancelReactivateButtons
            status={ent.status}
            cancelAtPeriodEnd={ent.cancelAtPeriodEnd}
          />
        </div>
      </div>

      {/* Cambiar de plan */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Cambiar de plan</h2>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:underline">
            Ver comparativa completa →
          </Link>
        </div>
        <PlanCompareGrid plans={plans} currentPlanId={ent.plan.id} />
      </div>

      {/* Aviso de modo manual */}
      {isManualBilling() && !ent.isGrandfathered && (
        <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
          Los pagos se coordinan por WhatsApp/email (transferencia bancaria, link MP, efectivo).
          Aún no integramos pasarela de pagos automática.
          {sub?.billing_whatsapp ? ` Te contactamos al ${sub.billing_whatsapp}.` : ''}
        </p>
      )}
    </div>
  )
}
