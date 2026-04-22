import Link from 'next/link'
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import { listBillingEvents } from '@/lib/actions/platform-billing'
import { PageHeader } from '@/components/platform/page-header'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Eventos de pago · Platform' }

type BillingEventRow = {
  id: string
  organization_id: string | null
  provider: string
  provider_event_id: string
  event_type: string
  processed_at: string | null
  processing_error: string | null
  created_at: string
  organizations: { name?: string; slug?: string } | null
}

export default async function BillingEventsPage() {
  const events = await listBillingEvents(150) as BillingEventRow[]

  const counts = {
    ok: events.filter(e => e.processed_at && !e.processing_error).length,
    pending: events.filter(e => !e.processed_at && !e.processing_error).length,
    error: events.filter(e => e.processing_error).length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Eventos de pago"
        description="Log idempotente de webhooks recibidos de los proveedores (MercadoPago / Stripe). Útil para diagnosticar sync de subscriptions."
      />

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Procesados OK" value={counts.ok} color="text-emerald-400" icon={CheckCircle2} />
        <Stat label="Pendientes" value={counts.pending} color="text-amber-400" icon={Clock} />
        <Stat label="Con error" value={counts.error} color="text-rose-400" icon={AlertCircle} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Evento</th>
              <th className="px-4 py-3 font-medium">Organización</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Event ID</th>
              <th className="px-4 py-3 font-medium">Recibido</th>
              <th className="px-4 py-3 font-medium">Procesado</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">Sin eventos todavía. Se poblará cuando lleguen webhooks.</td></tr>
            )}
            {events.map((e) => {
              const status = e.processing_error ? 'error' : (e.processed_at ? 'ok' : 'pending')
              return (
                <tr key={e.id} className="border-b border-zinc-800 last:border-0 hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    {status === 'ok' && <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300"><CheckCircle2 className="size-3" /> OK</span>}
                    {status === 'pending' && <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"><Clock className="size-3" /> Pendiente</span>}
                    {status === 'error' && <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-medium text-rose-300"><AlertCircle className="size-3" /> Error</span>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs text-zinc-300">{e.event_type}</code>
                    {e.processing_error && (
                      <div className="mt-1 line-clamp-1 text-[11px] text-rose-400" title={e.processing_error}>{e.processing_error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {e.organization_id ? (
                      <Link href={`/platform/orgs/${e.organization_id}`} className="text-indigo-400 hover:underline">
                        {e.organizations?.name ?? e.organization_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize">{e.provider}</td>
                  <td className="px-4 py-3"><code className="text-[11px] text-zinc-500">{e.provider_event_id.slice(0, 32)}</code></td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{new Date(e.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {e.processed_at ? new Date(e.processed_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-500">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
        </div>
        <Icon className={`size-5 ${color}`} />
      </div>
    </div>
  )
}
