'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  CreditCard,
  Plus,
  Calendar,
  AlertOctagon,
  Receipt,
  ExternalLink,
} from 'lucide-react'
import {
  recordManualPayment,
  extendSubscriptionPeriod,
  setSubscriptionPastDue,
} from '@/lib/actions/platform-billing'
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from '@/lib/billing/config'
import { cn } from '@/lib/utils'

interface ManualPayment {
  id: string
  plan_id: string
  billing_cycle: string
  amount_ars: number
  currency: string
  payment_method: string
  reference: string | null
  receipt_url: string | null
  period_start: string
  period_end: string
  notes: string | null
  created_at: string
}

interface PlanLite {
  id: string
  name: string
  price_ars_monthly: number
  price_ars_yearly: number
}

interface Props {
  orgId: string
  orgName: string
  payments: ManualPayment[]
  plans: PlanLite[]
  currentPlanId: string | null
  currentBillingCycle: string | null
  currentPeriodEnd: string | null
}

function formatArs(cents: number) {
  return (cents / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const METHOD_LABELS: Record<string, string> = Object.fromEntries(
  MANUAL_PAYMENT_METHODS.map((m) => [m.value, m.label]),
)

export function ManualPaymentsSection({
  orgId, orgName, payments, plans, currentPlanId, currentBillingCycle, currentPeriodEnd,
}: Props) {
  const [showRecord, setShowRecord] = useState(false)
  const [showExtend, setShowExtend] = useState(false)
  const [showPastDue, setShowPastDue] = useState(false)

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="size-4 text-emerald-400" />
            Pagos manuales
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Registro de cobros offline. Cada nuevo pago extiende automáticamente el período de la suscripción.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRecord(true)}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <Plus className="size-3.5" /> Registrar pago
          </button>
          <button
            type="button"
            onClick={() => setShowExtend(true)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
          >
            <Calendar className="size-3.5" /> Extender período
          </button>
          <button
            type="button"
            onClick={() => setShowPastDue(true)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/15"
          >
            <AlertOctagon className="size-3.5" /> Past due manual
          </button>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
          Aún no hay pagos registrados para esta org.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-2 text-left font-medium">Fecha</th>
                <th className="py-2 text-left font-medium">Plan</th>
                <th className="py-2 text-left font-medium">Período</th>
                <th className="py-2 text-left font-medium">Método</th>
                <th className="py-2 text-right font-medium">Monto</th>
                <th className="py-2 text-left font-medium">Referencia</th>
                <th className="py-2 text-left font-medium">Recibo</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="py-2 text-xs">{formatDate(p.created_at)}</td>
                  <td className="py-2">
                    <div className="capitalize">{p.plan_id}</div>
                    <div className="text-[10px] text-zinc-500">{p.billing_cycle}</div>
                  </td>
                  <td className="py-2 text-xs">
                    {formatDate(p.period_start)} → {formatDate(p.period_end)}
                  </td>
                  <td className="py-2 text-xs">{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    AR$ {formatArs(p.amount_ars)}
                  </td>
                  <td className="py-2 text-xs text-zinc-400">{p.reference ?? '—'}</td>
                  <td className="py-2">
                    {p.receipt_url ? (
                      <a
                        href={p.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        Ver <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showRecord && (
        <RecordManualModal
          orgId={orgId}
          orgName={orgName}
          plans={plans}
          defaultPlanId={currentPlanId ?? plans[0]?.id ?? 'pro'}
          defaultBillingCycle={(currentBillingCycle as 'monthly' | 'yearly') ?? 'monthly'}
          onClose={() => setShowRecord(false)}
        />
      )}

      {showExtend && (
        <ExtendModal
          orgId={orgId}
          orgName={orgName}
          currentPeriodEnd={currentPeriodEnd}
          onClose={() => setShowExtend(false)}
        />
      )}

      {showPastDue && (
        <PastDueModal
          orgId={orgId}
          orgName={orgName}
          onClose={() => setShowPastDue(false)}
        />
      )}
    </section>
  )
}

function RecordManualModal({
  orgId, orgName, plans, defaultPlanId, defaultBillingCycle, onClose,
}: {
  orgId: string
  orgName: string
  plans: PlanLite[]
  defaultPlanId: string
  defaultBillingCycle: 'monthly' | 'yearly'
  onClose: () => void
}) {
  const [planId, setPlanId] = useState(defaultPlanId)
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>(defaultBillingCycle)
  const [periodMonths, setPeriodMonths] = useState(defaultBillingCycle === 'yearly' ? 12 : 1)
  const [method, setMethod] = useState<ManualPaymentMethod>('transferencia')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, startTransition] = useTransition()

  const plan = plans.find((p) => p.id === planId)
  const suggestedPerMonth = plan ? plan.price_ars_monthly : 0
  const suggestedTotal = billingCycle === 'yearly' && plan
    ? Math.round(plan.price_ars_yearly * (periodMonths / 12))
    : suggestedPerMonth * periodMonths

  const [amountArs, setAmountArs] = useState(Math.round(suggestedTotal / 100).toString())

  const submit = () => {
    const amount = Math.round(Number(amountArs) * 100)
    if (!amount || amount <= 0) {
      toast.error('Ingresá un monto válido')
      return
    }
    startTransition(async () => {
      const res = await recordManualPayment({
        organization_id: orgId,
        request_id: null,
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
      onClose()
    })
  }

  return (
    <ModalShell title={`Registrar pago manual · ${orgName}`} onClose={onClose} wide>
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
            className="modal-input tabular-nums"
          />
        </Field>
        <Field label="Método">
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
          <p className="mt-1 text-[10px] text-zinc-500">Sugerido: AR$ {(suggestedTotal / 100).toLocaleString('es-AR')}</p>
        </Field>
        <Field label="Referencia">
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} className="modal-input" />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Notas internas">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="modal-input" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          {pending ? 'Registrando…' : 'Registrar pago'}
        </button>
      </div>
    </ModalShell>
  )
}

function ExtendModal({
  orgId, orgName, currentPeriodEnd, onClose,
}: {
  orgId: string
  orgName: string
  currentPeriodEnd: string | null
  onClose: () => void
}) {
  const [days, setDays] = useState(7)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (!reason.trim()) {
      toast.error('Indicá una razón')
      return
    }
    startTransition(async () => {
      const res = await extendSubscriptionPeriod(orgId, days, reason)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success(`Período extendido ${days} días`)
      onClose()
    })
  }

  return (
    <ModalShell title={`Extender período · ${orgName}`} onClose={onClose}>
      <p className="mb-3 text-xs text-zinc-400">
        {currentPeriodEnd
          ? `Período actual termina: ${new Date(currentPeriodEnd).toLocaleDateString('es-AR')}`
          : 'Sin período actual'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Días a sumar">
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 1)}
            className="modal-input tabular-nums"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Razón (queda en audit log)">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="modal-input" placeholder="Ej: cortesía por inconveniente del fin de semana" />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {pending ? 'Extendiendo…' : 'Extender'}
        </button>
      </div>
    </ModalShell>
  )
}

function PastDueModal({
  orgId, orgName, onClose,
}: {
  orgId: string
  orgName: string
  onClose: () => void
}) {
  const [graceDays, setGraceDays] = useState(5)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const res = await setSubscriptionPastDue(orgId, graceDays)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      toast.success('Suscripción marcada past_due')
      onClose()
    })
  }

  return (
    <ModalShell title={`Marcar past_due · ${orgName}`} onClose={onClose}>
      <p className="mb-3 text-xs text-amber-300">
        La org pasa a status <code className="rounded bg-zinc-800 px-1">past_due</code> con N días de gracia.
        Tras vencer la gracia, el cron la baja a free automáticamente.
      </p>
      <Field label="Días de gracia">
        <input
          type="number"
          min={1}
          max={30}
          value={graceDays}
          onChange={(e) => setGraceDays(Number(e.target.value) || 5)}
          className="modal-input tabular-nums"
        />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50">
          {pending ? 'Aplicando…' : 'Marcar past_due'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({
  title, children, onClose, wide,
}: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CreditCard className="size-4 text-emerald-400" />
            {title}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">×</button>
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
          .modal-input:focus { outline: 2px solid rgb(99 102 241); outline-offset: -1px; }
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
