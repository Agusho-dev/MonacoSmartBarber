'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  CheckCircle2,
  PhoneCall,
  XCircle,
  ExternalLink,
  Clock,
  CreditCard,
  RefreshCw,
  Plus,
} from 'lucide-react'
import {
  markRequestContacted,
  cancelSubscriptionRequest,
  recordManualPayment,
  type SubscriptionRequestRow,
} from '@/lib/actions/platform-billing'
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from '@/lib/billing/config'
import { cn } from '@/lib/utils'

interface PlanLite {
  id: string
  name: string
  price_ars_monthly: number
  price_ars_yearly: number
}

interface Props {
  requests: SubscriptionRequestRow[]
  plans: PlanLite[]
  currentStatus: 'pending' | 'contacted' | 'paid' | 'cancelled' | 'all'
  currentKind: 'plan_change' | 'renewal' | 'module_addon' | 'all'
}

const STATUS_TABS: { value: Props['currentStatus']; label: string }[] = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'contacted', label: 'Contactadas' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
]

const KIND_FILTERS: { value: Props['currentKind']; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'plan_change', label: 'Cambio de plan' },
  { value: 'renewal', label: 'Renovación' },
  { value: 'module_addon', label: 'Add-on' },
]

function formatArs(cents: number) {
  return (cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

export function BillingRequestsClient({ requests, plans, currentStatus, currentKind }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [contactRequest, setContactRequest] = useState<SubscriptionRequestRow | null>(null)
  const [paymentRequest, setPaymentRequest] = useState<SubscriptionRequestRow | null>(null)
  const [cancelRequest, setCancelRequest] = useState<SubscriptionRequestRow | null>(null)

  const setFilter = (key: 'status' | 'kind', value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set(key, value)
    router.push(`/platform/billing-requests?${params.toString()}`)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilter('status', tab.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              currentStatus === tab.value
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Tipo:</span>
          <select
            value={currentKind}
            onChange={(e) => setFilter('kind', e.target.value)}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
          >
            {KIND_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Organización</th>
                <th className="px-4 py-3 text-left font-medium">Solicita</th>
                <th className="px-4 py-3 text-left font-medium">Tipo</th>
                <th className="px-4 py-3 text-left font-medium">Días</th>
                <th className="px-4 py-3 text-left font-medium">Contacto</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-500">
                    No hay solicitudes con estos filtros.
                  </td>
                </tr>
              )}
              {requests.map((req) => (
                <tr key={req.id} className="border-t border-zinc-800 transition-colors hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{req.org_name}</div>
                    <Link
                      href={`/platform/orgs/${req.organization_id}`}
                      className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                    >
                      Abrir org <ExternalLink className="size-3" />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium capitalize">
                      {req.plan_name}
                      {req.requested_billing_cycle === 'yearly' && (
                        <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-400">anual</span>
                      )}
                    </div>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      AR$ {formatArs(req.requested_billing_cycle === 'yearly' ? req.plan_price_ars_yearly : req.plan_price_ars_monthly)}
                      {' · '}
                      Plan actual: <span className="capitalize">{req.current_plan_id ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <KindBadge kind={req.request_kind} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <div className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
                      req.days_pending >= 3
                        ? 'bg-rose-500/15 text-rose-300'
                        : req.days_pending >= 1
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-zinc-800 text-zinc-300',
                    )}>
                      <Clock className="size-3" />
                      {req.days_pending}d
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-zinc-300">{req.billing_email ?? req.requested_by_email ?? '—'}</div>
                    {req.billing_whatsapp && (
                      <div className="text-zinc-500">WA: {req.billing_whatsapp}</div>
                    )}
                    {req.contacted_at && (
                      <div className="mt-1 text-[10px] text-emerald-400">Contactado {formatDate(req.contacted_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {req.status !== 'paid' && req.status !== 'cancelled' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setContactRequest(req)}
                            className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700"
                          >
                            <PhoneCall className="size-3" /> Contactar
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentRequest(req)}
                            className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                          >
                            <CreditCard className="size-3" /> Registrar pago
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelRequest(req)}
                            className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/15"
                          >
                            <XCircle className="size-3" />
                          </button>
                        </>
                      )}
                      {req.status === 'paid' && (
                        <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-300">
                          <CheckCircle2 className="size-3" /> Pagada
                        </span>
                      )}
                      {req.status === 'cancelled' && (
                        <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400">
                          <XCircle className="size-3" /> Cancelada
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {contactRequest && (
        <ContactModal
          request={contactRequest}
          onClose={() => setContactRequest(null)}
          onDone={() => { setContactRequest(null); router.refresh() }}
        />
      )}

      {paymentRequest && (
        <RecordPaymentModal
          request={paymentRequest}
          plans={plans}
          onClose={() => setPaymentRequest(null)}
          onDone={() => { setPaymentRequest(null); router.refresh() }}
        />
      )}

      {cancelRequest && (
        <CancelModal
          request={cancelRequest}
          onClose={() => setCancelRequest(null)}
          onDone={() => { setCancelRequest(null); router.refresh() }}
        />
      )}
    </>
  )
}

// ============================================================
// Modal: marcar contactado
// ============================================================
function ContactModal({
  request, onClose, onDone,
}: {
  request: SubscriptionRequestRow
  onClose: () => void
  onDone: () => void
}) {
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'llamada' | 'otro'>('whatsapp')
  const [note, setNote] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const res = await markRequestContacted(request.id, channel, note || '(sin nota)')
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Contacto registrado')
      onDone()
    })
  }

  return (
    <ModalShell title={`Marcar contactado · ${request.org_name}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-zinc-400">Canal</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'email' | 'llamada' | 'otro')}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="llamada">Llamada</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-400">Nota (qué se le dijo, qué quedó pendiente)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Ej: le pasé CBU, espera transferir hasta el viernes."
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar contacto'}
        </button>
      </div>
    </ModalShell>
  )
}

// ============================================================
// Modal: registrar pago
// ============================================================
function RecordPaymentModal({
  request, plans, onClose, onDone,
}: {
  request: SubscriptionRequestRow
  plans: PlanLite[]
  onClose: () => void
  onDone: () => void
}) {
  const [planId, setPlanId] = useState(request.requested_plan_id)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(request.requested_billing_cycle)
  const [periodMonths, setPeriodMonths] = useState(billingCycle === 'yearly' ? 12 : 1)
  const [method, setMethod] = useState<ManualPaymentMethod>('transferencia')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, startTransition] = useTransition()

  const plan = plans.find((p) => p.id === planId)
  const suggestedAmount = plan
    ? (billingCycle === 'yearly' ? plan.price_ars_yearly : plan.price_ars_monthly) * periodMonths / (billingCycle === 'yearly' ? 12 : 1)
    : 0
  const [amountArs, setAmountArs] = useState(Math.round(suggestedAmount / 100).toString())

  const submit = () => {
    const amount = Math.round(Number(amountArs) * 100)
    if (!amount || amount <= 0) {
      toast.error('Ingresá un monto válido')
      return
    }
    startTransition(async () => {
      const res = await recordManualPayment({
        organization_id: request.organization_id,
        request_id: request.id,
        plan_id: planId,
        billing_cycle: billingCycle,
        amount_ars: amount,
        payment_method: method,
        reference: reference || null,
        period_months: periodMonths,
        notes: notes || null,
      })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Pago registrado · período hasta ${new Date(res.period_end).toLocaleDateString('es-AR')}`)
      onDone()
    })
  }

  return (
    <ModalShell title={`Registrar pago · ${request.org_name}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="modal-input">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Ciclo">
          <select
            value={billingCycle}
            onChange={(e) => {
              const v = e.target.value as 'monthly' | 'yearly'
              setBillingCycle(v)
              setPeriodMonths(v === 'yearly' ? 12 : 1)
            }}
            className="modal-input"
          >
            <option value="monthly">Mensual</option>
            <option value="yearly">Anual</option>
          </select>
        </Field>
        <Field label="Cubre N meses">
          <input
            type="number"
            min={1}
            max={36}
            value={periodMonths}
            onChange={(e) => setPeriodMonths(Number(e.target.value) || 1)}
            className="modal-input"
          />
        </Field>
        <Field label="Método de pago">
          <select value={method} onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)} className="modal-input">
            {MANUAL_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Monto cobrado (AR$)">
          <input
            type="number"
            min={0}
            value={amountArs}
            onChange={(e) => setAmountArs(e.target.value)}
            className="modal-input tabular-nums"
          />
          <p className="mt-1 text-[10px] text-zinc-500">
            Sugerido: AR$ {(suggestedAmount / 100).toLocaleString('es-AR')}
          </p>
        </Field>
        <Field label="Referencia (nº transferencia, comprobante)">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="modal-input"
            placeholder="Opcional"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Notas internas">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="modal-input"
            placeholder="Opcional"
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? 'Registrando…' : 'Registrar pago'}
        </button>
      </div>
    </ModalShell>
  )
}

// ============================================================
// Modal: cancelar request
// ============================================================
function CancelModal({
  request, onClose, onDone,
}: {
  request: SubscriptionRequestRow
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (!reason.trim()) {
      toast.error('Indicá una razón')
      return
    }
    startTransition(async () => {
      const res = await cancelSubscriptionRequest(request.id, reason)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Solicitud cancelada')
      onDone()
    })
  }

  return (
    <ModalShell title={`Cancelar solicitud · ${request.org_name}`} onClose={onClose}>
      <div>
        <label className="text-xs font-medium text-zinc-400">Razón</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          placeholder="Ej: el cliente desistió por precio"
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">
          Volver
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
        >
          {pending ? 'Cancelando…' : 'Cancelar solicitud'}
        </button>
      </div>
    </ModalShell>
  )
}

// ============================================================
// Helpers UI
// ============================================================

function ModalShell({
  title, children, onClose, wide,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <XCircle className="size-4" />
          </button>
        </div>
        {children}
        <style jsx global>{`
          .modal-input {
            width: 100%;
            border-radius: 0.375rem;
            border: 1px solid rgb(39 39 42);
            background-color: rgb(24 24 27);
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
          }
          .modal-input:focus {
            outline: 2px solid rgb(99 102 241);
            outline-offset: -1px;
          }
        `}</style>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-zinc-400">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function KindBadge({ kind }: { kind: 'plan_change' | 'renewal' | 'module_addon' }) {
  const styles = {
    plan_change: { label: 'Cambio plan', cls: 'bg-indigo-500/15 text-indigo-300', icon: Plus },
    renewal: { label: 'Renovación', cls: 'bg-emerald-500/15 text-emerald-300', icon: RefreshCw },
    module_addon: { label: 'Add-on', cls: 'bg-amber-500/15 text-amber-300', icon: Plus },
  }[kind]
  const Icon = styles.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', styles.cls)}>
      <Icon className="size-3" /> {styles.label}
    </span>
  )
}
