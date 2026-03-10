import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getBarberSession } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Banknote, CreditCard, ArrowRightLeft, Wallet } from 'lucide-react'
import type { PaymentMethod } from '@/lib/types/database'

export const metadata: Metadata = {
  title: 'Facturación del día | Monaco Smart Barber',
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

const PAYMENT_ICONS: Record<PaymentMethod, React.ElementType> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowRightLeft,
}

export default async function BarberBillingPage() {
  const session = await getBarberSession()
  if (!session) redirect('/barbero/login')

  const supabase = await createClient()

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

  const { data: visits } = await supabase
    .from('visits')
    .select('id, completed_at, amount, payment_method, payment_account_id, service:services(name), client:clients(name), payment_account:payment_accounts(name, alias_or_cbu)')
    .eq('barber_id', session.staff_id)
    .gte('completed_at', startOfDay)
    .lt('completed_at', endOfDay)
    .order('completed_at', { ascending: false })

  const totalAmount = (visits ?? []).reduce((sum, v) => sum + v.amount, 0)
  const totalCount = visits?.length ?? 0

  const byMethod: Record<string, { count: number; total: number }> = {}
  for (const v of visits ?? []) {
    const key = v.payment_method
    byMethod[key] = byMethod[key] ?? { count: 0, total: 0 }
    byMethod[key].count++
    byMethod[key].total += v.amount
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/barbero/cola">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div>
            <h1 className="font-semibold">Facturación del día</h1>
            <p className="text-xs text-muted-foreground">
              {today.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Summary */}
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total facturado</p>
          <p className="mt-1 text-4xl font-bold tabular-nums">{formatCurrency(totalAmount)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{totalCount} {totalCount === 1 ? 'servicio' : 'servicios'}</p>
        </div>

        {/* Breakdown by payment method */}
        {Object.keys(byMethod).length > 0 && (
          <div className="rounded-xl border bg-card divide-y">
            {Object.entries(byMethod).map(([method, data]) => {
              const Icon = PAYMENT_ICONS[method as PaymentMethod] ?? Banknote
              const label = PAYMENT_LABELS[method as PaymentMethod] ?? method
              return (
                <div key={method} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-muted">
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">{data.count} {data.count === 1 ? 'corte' : 'cortes'}</p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatCurrency(data.total)}</p>
                </div>
              )
            })}
          </div>
        )}

        {/* Detail */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Detalle de servicios
          </h2>
          {(visits ?? []).length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              <p>Todavía no hay servicios hoy.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(visits ?? []).map((v, i) => {
                const Icon = PAYMENT_ICONS[v.payment_method as PaymentMethod] ?? Banknote
                const account = v.payment_account as unknown as { name: string; alias_or_cbu: string | null } | null
                return (
                  <div key={v.id} className="rounded-xl border bg-card px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {(v.client as unknown as { name: string } | null)?.name ?? 'Cliente'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(v.service as unknown as { name: string } | null)?.name ?? 'Servicio'}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Icon className="size-3" />
                            {PAYMENT_LABELS[v.payment_method as PaymentMethod]}
                          </span>
                          {account && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Wallet className="size-3" />
                              {account.name}
                              {account.alias_or_cbu && ` (${account.alias_or_cbu})`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold tabular-nums">{formatCurrency(v.amount)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(v.completed_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-xs text-muted-foreground">#{totalCount - i}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
