import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Receipt, ExternalLink } from 'lucide-react'
import { getCurrentOrgId } from '@/lib/actions/org'
import { listManualPaymentsForOrg } from '@/lib/actions/platform-billing'
import { MANUAL_PAYMENT_METHODS } from '@/lib/billing/config'

export const dynamic = 'force-dynamic'

const METHOD_LABELS: Record<string, string> = Object.fromEntries(
  MANUAL_PAYMENT_METHODS.map((m) => [m.value, m.label]),
)

function formatArs(cents: number) {
  return (cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default async function HistorialPagosPage() {
  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/login')

  const payments = await listManualPaymentsForOrg(orgId)

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <Link href="/dashboard/billing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Volver a Facturación
        </Link>
        <h1 className="mt-2 text-2xl font-bold flex items-center gap-2">
          <Receipt className="size-5" />
          Historial de pagos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pagos registrados manualmente por el equipo BarberOS. Cada pago extiende el período de tu suscripción.
        </p>
      </div>

      {payments.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card px-4 py-12 text-center">
          <Receipt className="mx-auto size-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            Aún no hay pagos registrados. Cuando coordinemos un cobro, vas a verlo acá.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Fecha</th>
                  <th className="px-4 py-3 text-left font-medium">Plan</th>
                  <th className="px-4 py-3 text-left font-medium">Período</th>
                  <th className="px-4 py-3 text-left font-medium">Método</th>
                  <th className="px-4 py-3 text-right font-medium">Monto</th>
                  <th className="px-4 py-3 text-left font-medium">Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-3">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium capitalize">{p.plan_id}</div>
                      <div className="text-[10px] text-muted-foreground">{p.billing_cycle}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(p.period_start)} → {formatDate(p.period_end)}
                    </td>
                    <td className="px-4 py-3 text-xs">{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      AR$ {formatArs(p.amount_ars)}
                    </td>
                    <td className="px-4 py-3">
                      {p.receipt_url ? (
                        <a
                          href={p.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Ver <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        ¿Tenés dudas sobre un cobro? Escribinos a <strong>barberos.system@gmail.com</strong>.
      </p>
    </div>
  )
}
