import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Building2, Users, UserCheck, Eye } from 'lucide-react'
import { requirePlatformAdmin } from '@/lib/actions/platform'
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgBilling, listPlans, listModules, listManualPayments } from '@/lib/actions/platform-billing'
import { KpiCard } from '@/components/platform/kpi-card'
import { OrgPlatformDetailClient } from './detail-client'
import { SubscriptionManager } from './subscription-manager'
import { ManualPaymentsSection } from './manual-payments-section'

export const dynamic = 'force-dynamic'

export default async function PlatformOrgDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin()
  const { id } = await params
  const admin = createAdminClient()

  const { data: org } = await admin
    .from('organizations')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!org) return notFound()

  const [branchesRes, , , visitsRes, lastVisitRes, billing, plans, modules, payments] = await Promise.all([
    admin.from('branches').select('id, name, is_active, created_at').eq('organization_id', id).order('created_at'),
    admin.from('staff').select('id, full_name, role, is_active').eq('organization_id', id).eq('is_active', true),
    admin.from('clients').select('id', { count: 'exact', head: true }).eq('organization_id', id),
    admin.from('visits').select('id', { count: 'exact', head: true }).eq('organization_id', id),
    admin.from('visits').select('completed_at').eq('organization_id', id).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    getOrgBilling(id),
    listPlans(),
    listModules(),
    listManualPayments(id, 100),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/organizations" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="size-3.5" /> Volver
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <span className="text-zinc-500">/{org.slug}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Creada {new Date(org.created_at).toLocaleDateString('es-AR')}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Sucursales"
          value={`${billing.usage.branches}`}
          hint={`Límite del plan: ${billing.subscription?.plan_id ?? '—'}`}
          icon={Building2}
          accent="indigo"
        />
        <KpiCard
          label="Staff activo"
          value={billing.usage.staff}
          icon={UserCheck}
          accent="emerald"
        />
        <KpiCard
          label="Clientes"
          value={(billing.usage.clients ?? 0).toLocaleString('es-AR')}
          icon={Users}
        />
        <KpiCard
          label="Visitas totales"
          value={((visitsRes as unknown as { count?: number })?.count ?? 0).toLocaleString('es-AR')}
          icon={Eye}
          hint={lastVisitRes.data?.completed_at ? `Última: ${new Date(lastVisitRes.data.completed_at).toLocaleDateString('es-AR')}` : 'Sin visitas'}
        />
      </div>

      {/* Subscription management (nuevo) */}
      <SubscriptionManager
        orgId={id}
        orgName={org.name}
        billing={billing}
        plans={plans}
        modules={modules}
      />

      {/* Pagos manuales — historial + acciones (registrar, extender, past_due) */}
      <ManualPaymentsSection
        orgId={id}
        orgName={org.name}
        payments={payments}
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          price_ars_monthly: p.price_ars_monthly,
          price_ars_yearly: p.price_ars_yearly,
        }))}
        currentPlanId={billing.subscription?.plan_id ?? null}
        currentBillingCycle={(billing.subscription as { billing_cycle?: string } | null)?.billing_cycle ?? null}
        currentPeriodEnd={billing.subscription?.current_period_end ?? null}
      />

      {/* Legacy billing editor existente (fields viejos sobre organizations) */}
      <OrgPlatformDetailClient
        org={org}
        branches={branchesRes.data ?? []}
        lastVisitAt={lastVisitRes.data?.completed_at ?? null}
      />
    </div>
  )
}
