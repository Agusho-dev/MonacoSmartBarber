import { listSubscriptionRequests, getManualBillingMetrics } from '@/lib/actions/platform-billing'
import { listPlans } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'
import { KpiCard } from '@/components/platform/kpi-card'
import { Wallet, Inbox, RefreshCw, AlertTriangle } from 'lucide-react'
import { BillingRequestsClient } from './requests-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cobros pendientes · Platform' }

function formatArs(cents: number): string {
  return (cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

interface PageProps {
  searchParams: Promise<{ status?: string; kind?: string }>
}

export default async function BillingRequestsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const statusFilter = (sp.status as 'pending' | 'contacted' | 'paid' | 'cancelled' | 'all') ?? 'pending'
  const kindFilter = (sp.kind as 'plan_change' | 'renewal' | 'module_addon' | 'all') ?? 'all'

  const [requests, metrics, plans] = await Promise.all([
    listSubscriptionRequests({ status: statusFilter, kind: kindFilter }),
    getManualBillingMetrics(),
    listPlans(),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobros pendientes"
        description="Solicitudes de cambio/renovación que esperan coordinación de pago manual."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Pendientes"
          value={metrics.pending_requests_count.toString()}
          accent="amber"
          icon={Inbox}
          hint="Solicitudes sin contactar"
        />
        <KpiCard
          label="Ingresos del mes"
          value={`AR$ ${formatArs(metrics.revenue_this_month_ars_cents)}`}
          accent="emerald"
          icon={Wallet}
          hint={`vs AR$ ${formatArs(metrics.revenue_last_month_ars_cents)} mes pasado`}
        />
        <KpiCard
          label="Renovaciones próximas"
          value={metrics.upcoming_renewals.length.toString()}
          accent="indigo"
          icon={RefreshCw}
          hint="Vencen en 14 días"
        />
        <KpiCard
          label="Past due"
          value={metrics.past_due_list.length.toString()}
          accent="rose"
          icon={AlertTriangle}
          hint="En período de gracia"
        />
      </div>

      <BillingRequestsClient
        requests={requests}
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          price_ars_monthly: p.price_ars_monthly,
          price_ars_yearly: p.price_ars_yearly,
        }))}
        currentStatus={statusFilter}
        currentKind={kindFilter}
      />
    </div>
  )
}
