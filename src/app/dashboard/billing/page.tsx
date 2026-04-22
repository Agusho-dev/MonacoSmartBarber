import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, AlertCircle } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/actions/org'
import { getEntitlements } from '@/lib/actions/entitlements'
import { createAdminClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UsageMeter } from '@/components/billing/usage-meter'
import { PlanCompareGrid } from './plan-compare-grid'
import { CancelReactivateButtons } from './cancel-reactivate-buttons'

export const dynamic = 'force-dynamic'

function formatArs(centavos: number): string {
  return `AR$ ${(centavos / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
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
  const { data: allPlans } = await supabase
    .from('plans')
    .select('id, name, tagline, price_ars_monthly, price_ars_yearly, features, limits, sort_order, is_public')
    .eq('is_public', true)
    .order('sort_order', { ascending: true })

  const plans = allPlans ?? []
  const currentPlanPrice = ent.plan.price_ars_monthly

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-sm text-muted-foreground">
          Administrá tu plan, tu método de pago y consultá el historial.
        </p>
      </div>

      {/* Plan actual */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2">
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
            {ent.currentPeriodEnd && ent.status === 'active' && (
              <p className="mt-2 text-sm text-muted-foreground">
                Próximo cobro: {new Date(ent.currentPeriodEnd).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}
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
            <Link href="/dashboard/billing/facturas">Historial de facturas</Link>
          </Button>
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
    </div>
  )
}
