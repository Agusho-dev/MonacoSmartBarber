'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Coins,
  HandCoins,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  Users,
  Building2,
  Sparkles,
  TrendingUp,
  FileDown,
  RefreshCw,
  ChevronDown,
  CheckCircle2,
  Clock,
  Wallet,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import { useBranchStore } from '@/stores/branch-store'
import {
  payAllPendingTipsForBarber,
  reconcileTipReports,
  type TipsOrgSummary,
  type TipsMonthlyPoint,
  type BarberTipBucket,
} from '@/lib/actions/tips'
import { exportPaymentReceiptPDF } from '@/lib/export'
import { getBarberTipsDetail } from '@/lib/actions/tips'
import type { Branch } from '@/lib/types/database'

interface PaymentAccountOption {
  id: string
  name: string
  branch_id: string
  is_salary_account: boolean | null
  alias_or_cbu: string | null
}

interface PropinasClientProps {
  initialSummary: TipsOrgSummary
  initialTrend: TipsMonthlyPoint[]
  initialRange: { first: string | null; last: string | null }
  branches: Branch[]
  paymentAccounts: PaymentAccountOption[]
  orgName: string
}

const MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

function formatMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`
}

function formatLongDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T12:00').toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function methodLabel(m: 'cash' | 'card' | 'transfer' | 'other' | string): string {
  return m === 'cash' ? 'Efectivo' : m === 'card' ? 'Tarjeta' : m === 'transfer' ? 'Transferencia' : 'Otro'
}

function MethodIcon({ method, className }: { method: string; className?: string }) {
  if (method === 'cash') return <Banknote className={className} />
  if (method === 'card') return <CreditCard className={className} />
  if (method === 'transfer') return <ArrowRightLeft className={className} />
  return <Wallet className={className} />
}

export function PropinasClient({
  initialSummary,
  initialTrend,
  initialRange,
  branches,
  paymentAccounts,
  orgName,
}: PropinasClientProps) {
  const router = useRouter()
  const { selectedBranchId, setSelectedBranchId } = useBranchStore()
  const [isPending, startTransition] = useTransition()

  // Inicializa sucursal en el store si no está seteada
  useEffect(() => {
    if (selectedBranchId === undefined && branches.length > 0) {
      // no-op: dejamos null = "todas las sucursales"
    }
  }, [selectedBranchId, branches])

  const [summary, setSummary] = useState<TipsOrgSummary>(initialSummary)
  const [trend] = useState<TipsMonthlyPoint[]>(initialTrend)

  // El filtro por sucursal es client-side (los datos completos llegan por SSR).
  const filteredSummary = useMemo<TipsOrgSummary>(() => {
    if (!selectedBranchId) return summary
    const filtered = summary.by_barber.filter((b) => b.branch_id === selectedBranchId)
    const pending_total = filtered.reduce((s, b) => s + b.pending_total, 0)
    const paid_total = filtered.reduce((s, b) => s + b.paid_total, 0)
    const pending_count = filtered.reduce((s, b) => s + b.pending_count, 0)
    const pending_cash = filtered.reduce((s, b) => s + b.pending_cash, 0)
    const pending_card = filtered.reduce((s, b) => s + b.pending_card, 0)
    const pending_transfer = filtered.reduce((s, b) => s + b.pending_transfer, 0)
    const dates = filtered.flatMap((b) => [b.first_pending_date, b.last_pending_date].filter(Boolean) as string[])
    return {
      ...summary,
      pending_total,
      paid_total,
      pending_count,
      pending_cash,
      pending_card,
      pending_transfer,
      barbers_with_pending: filtered.filter((b) => b.pending_total > 0).length,
      branches_with_pending: filtered.filter((b) => b.pending_total > 0).length > 0 ? 1 : 0,
      first_tip_date: dates.length ? dates.sort()[0] : null,
      last_tip_date: dates.length ? dates.sort().slice(-1)[0] : null,
      by_barber: filtered.sort((a, b) => b.pending_total - a.pending_total),
    }
  }, [selectedBranchId, summary])

  // ─── Pago "todo de un barbero" ──────────────────────────────────────────────
  const [payDialog, setPayDialog] = useState<{ open: boolean; bucket: BarberTipBucket | null }>({
    open: false, bucket: null,
  })
  const [payMethod, setPayMethod] = useState<'cash' | 'transfer' | 'card' | 'other'>('cash')
  const [payAccountId, setPayAccountId] = useState<string>('')
  const [payNotes, setPayNotes] = useState<string>('')

  function openPay(bucket: BarberTipBucket) {
    // Default inteligente: si la mayoría es transferencia, sugerir transferencia.
    const dominant = (() => {
      const max = Math.max(bucket.pending_cash, bucket.pending_transfer, bucket.pending_card)
      if (max === 0) return 'cash' as const
      if (max === bucket.pending_transfer) return 'transfer' as const
      if (max === bucket.pending_card) return 'card' as const
      return 'cash' as const
    })()
    setPayMethod(dominant)
    setPayAccountId('')
    setPayNotes('')
    setPayDialog({ open: true, bucket })
  }

  async function handlePay() {
    if (!payDialog.bucket) return
    const bucket = payDialog.bucket
    startTransition(async () => {
      const detail = await getBarberTipsDetail(bucket.staff_id, bucket.branch_id)
      const r = await payAllPendingTipsForBarber(
        bucket.staff_id,
        bucket.branch_id,
        payMethod,
        payMethod === 'transfer' ? payAccountId || null : null,
        payNotes || undefined,
      )
      if (r.error) {
        toast.error(r.error)
        return
      }

      // Actualizar UI local de inmediato
      setSummary((prev) => {
        const updated = prev.by_barber.map((b) =>
          b.staff_id === bucket.staff_id && b.branch_id === bucket.branch_id
            ? {
                ...b,
                pending_count: 0, pending_total: 0,
                pending_cash: 0, pending_card: 0, pending_transfer: 0,
                paid_total: b.paid_total + bucket.pending_total,
                first_pending_date: null, last_pending_date: null,
              }
            : b
        )
        return {
          ...prev,
          pending_total: prev.pending_total - bucket.pending_total,
          pending_count: prev.pending_count - bucket.pending_count,
          pending_cash: prev.pending_cash - bucket.pending_cash,
          pending_card: prev.pending_card - bucket.pending_card,
          pending_transfer: prev.pending_transfer - bucket.pending_transfer,
          paid_total: prev.paid_total + bucket.pending_total,
          paid_count: prev.paid_count + bucket.pending_count,
          barbers_with_pending: updated.filter((b) => b.pending_total > 0).length,
          by_barber: updated,
        }
      })

      toast.success(`Propinas pagadas: ${formatCurrency(r.data!.totalAmount)}`)
      setPayDialog({ open: false, bucket: null })

      // Generar recibo PDF si tenemos detalle
      if (!('error' in detail) && detail.data) {
        try {
          await exportPaymentReceiptPDF({
            barberName: bucket.staff_name,
            batchDate: new Date().toISOString(),
            totalAmount: r.data!.totalAmount,
            notes: payNotes || `Propinas — ${bucket.branch_name}`,
            orgName,
            reports: detail.data.map((d) => ({
              id: d.id,
              type: 'tip',
              amount: d.amount,
              report_date: d.report_date,
              notes: d.notes,
            })),
          })
        } catch (err) {
          console.error('PDF error', err)
        }
      }
      router.refresh()
    })
  }

  // ─── Reconciliación ──────────────────────────────────────────────────────────
  function handleReconcile() {
    startTransition(async () => {
      const r = await reconcileTipReports()
      if (r.error) {
        toast.error(r.error)
        return
      }
      const created = r.data?.created ?? 0
      if (created === 0) toast.info('Todo ya estaba sincronizado')
      else toast.success(`${created} propina${created === 1 ? '' : 's'} sincronizada${created === 1 ? '' : 's'}`)
      router.refresh()
    })
  }

  // ─── Histórico PDF org-wide ─────────────────────────────────────────────────
  async function handleExportHistorico() {
    if (filteredSummary.by_barber.length === 0) {
      toast.error('No hay propinas para exportar')
      return
    }
    startTransition(async () => {
      // Traer detalle de TODOS los barberos con pendientes/pagado y armar el PDF
      const allReports: { id: string; type: string; amount: number; report_date: string; notes: string | null }[] = []
      for (const b of filteredSummary.by_barber) {
        const detail = await getBarberTipsDetail(b.staff_id, b.branch_id)
        if ('data' in detail && detail.data) {
          for (const d of detail.data) {
            allReports.push({
              id: d.id,
              type: 'tip',
              amount: d.amount,
              report_date: d.report_date,
              notes: `${b.staff_name} (${b.branch_name}) — ${d.notes ?? ''}`,
            })
          }
        }
      }
      if (allReports.length === 0) {
        toast.error('No hay propinas para exportar')
        return
      }
      try {
        await exportPaymentReceiptPDF({
          barberName: selectedBranchId
            ? `Histórico de propinas — ${branches.find(b => b.id === selectedBranchId)?.name ?? ''}`
            : 'Histórico de propinas — Toda la organización',
          batchDate: new Date().toISOString(),
          totalAmount: allReports.reduce((s, r) => s + Number(r.amount), 0),
          notes: `Período: ${formatLongDate(initialRange.first)} → ${formatLongDate(initialRange.last)}`,
          orgName,
          reports: allReports,
        })
        toast.success('Histórico exportado')
      } catch (err) {
        console.error(err)
        toast.error('Error al generar el PDF')
      }
    })
  }

  // ─── Tendencia / sparkline simple sin recharts ──────────────────────────────
  const maxTrend = Math.max(1, ...trend.map((p) => p.total_amount))

  const hasAnyData = summary.by_barber.length > 0
  const totalEverPaid = summary.paid_total
  const totalEverPending = summary.pending_total
  const totalEver = totalEverPaid + totalEverPending

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-4 rounded-xl border border-dashed border-border bg-muted/20">
        <div className="size-16 rounded-full bg-amber-500/10 flex items-center justify-center">
          <Coins className="size-8 text-amber-500" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Todavía no hay propinas registradas</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Cuando un cliente le deje propina al barbero al cobrar el servicio,
            aparecerá acá lista para liquidar.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleReconcile} disabled={isPending}>
          <RefreshCw className={cn('size-3.5 mr-2', isPending && 'animate-spin')} />
          Sincronizar propinas
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Filtro de sucursal ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Mostrando propinas de:</span>
        </div>
        <Select
          value={selectedBranchId ?? '__all__'}
          onValueChange={(v) => setSelectedBranchId(v === '__all__' ? null : v)}
        >
          <SelectTrigger className="w-56 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas las sucursales</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Banner principal: estado + acciones ──────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent p-5 lg:p-6">
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -right-12 top-12 size-32 rounded-full bg-orange-500/10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-2xl bg-amber-500/20 ring-1 ring-amber-500/30 flex items-center justify-center shrink-0">
              <HandCoins className="size-6 text-amber-500" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-semibold">Propinas a liquidar</h2>
                <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px] gap-1">
                  <Sparkles className="size-2.5" />
                  100% del barbero
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground max-w-lg">
                Las propinas se abonan al barbero por separado del sueldo y la comisión.
                Período cubierto: <span className="text-foreground font-medium">{formatLongDate(initialRange.first)} → {formatLongDate(initialRange.last)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleReconcile}
              disabled={isPending}
              className="bg-background/50"
            >
              <RefreshCw className={cn('size-3.5 mr-2', isPending && 'animate-spin')} />
              Sincronizar
            </Button>
            <Button
              size="sm"
              onClick={handleExportHistorico}
              disabled={isPending || filteredSummary.by_barber.length === 0}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              <FileDown className="size-3.5 mr-2" />
              Exportar histórico
            </Button>
          </div>
        </div>
      </div>

      {/* ── Tarjetas de resumen ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <MetricCard
          icon={<Clock className="size-4 text-amber-500" />}
          label="Pendientes"
          value={formatCurrency(filteredSummary.pending_total)}
          sublabel={`${filteredSummary.pending_count} cobro${filteredSummary.pending_count === 1 ? '' : 's'}`}
          tone="amber"
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          label="Pagado histórico"
          value={formatCurrency(filteredSummary.paid_total)}
          sublabel={`${filteredSummary.paid_count} cobro${filteredSummary.paid_count === 1 ? '' : 's'}`}
          tone="emerald"
        />
        <MetricCard
          icon={<Users className="size-4 text-violet-500" />}
          label="Barberos esperando cobro"
          value={String(filteredSummary.barbers_with_pending)}
          sublabel={`de ${filteredSummary.by_barber.length} con propinas`}
          tone="violet"
        />
        <MetricCard
          icon={<Building2 className="size-4 text-cyan-500" />}
          label="Sucursales"
          value={String(filteredSummary.branches_with_pending)}
          sublabel="con propinas pendientes"
          tone="cyan"
        />
      </div>

      {/* ── Mix de método y tendencia mensual ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Mix por método de pago</CardTitle>
            <CardDescription className="text-xs">
              Cómo dejaron las propinas pendientes los clientes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <MethodBar
              icon={<Banknote className="size-3.5 text-emerald-500" />}
              label="Efectivo"
              amount={filteredSummary.pending_cash}
              total={filteredSummary.pending_total}
              barClass="bg-emerald-500"
            />
            <MethodBar
              icon={<ArrowRightLeft className="size-3.5 text-cyan-500" />}
              label="Transferencia"
              amount={filteredSummary.pending_transfer}
              total={filteredSummary.pending_total}
              barClass="bg-cyan-500"
            />
            <MethodBar
              icon={<CreditCard className="size-3.5 text-violet-500" />}
              label="Tarjeta"
              amount={filteredSummary.pending_card}
              total={filteredSummary.pending_total}
              barClass="bg-violet-500"
            />
            {filteredSummary.pending_total === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                Sin propinas pendientes
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              Tendencia mensual
            </CardTitle>
            <CardDescription className="text-xs">
              Total recaudado en propinas, mes a mes
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                Sin datos suficientes
              </p>
            ) : (
              <div className="flex items-end gap-1.5 h-32">
                {trend.map((p) => {
                  const heightPct = (p.total_amount / maxTrend) * 100
                  return (
                    <div
                      key={p.month}
                      className="flex-1 flex flex-col items-center gap-1.5 group"
                    >
                      <div className="w-full flex-1 flex items-end relative">
                        <div
                          className="w-full bg-gradient-to-t from-amber-500/80 to-orange-400/80 rounded-md transition-all hover:from-amber-500 hover:to-orange-400"
                          style={{ height: `${Math.max(4, heightPct)}%` }}
                        />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-popover border border-border rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 tabular-nums">
                          {formatCurrency(p.total_amount)} · {p.count}c
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {formatMonth(p.month)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ranking de barberos con drill-down ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-sm">Detalle por barbero</CardTitle>
            <CardDescription className="text-xs">
              Liquidá rápido las propinas pendientes de cada uno
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px]">
            Total a pagar:&nbsp;
            <span className="ml-1 font-semibold tabular-nums text-amber-500">
              {formatCurrency(filteredSummary.pending_total)}
            </span>
          </Badge>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="divide-y divide-border">
            {filteredSummary.by_barber.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Sin barberos con propinas en esta sucursal
              </p>
            ) : (
              filteredSummary.by_barber.map((bucket) => {
                const totalEverBarber = bucket.pending_total + bucket.paid_total
                const fillPct = totalEver > 0 ? (totalEverBarber / Math.max(...filteredSummary.by_barber.map(b => b.pending_total + b.paid_total))) * 100 : 0
                const dominantMethod =
                  bucket.pending_cash >= bucket.pending_transfer && bucket.pending_cash >= bucket.pending_card
                    ? 'cash'
                    : bucket.pending_transfer >= bucket.pending_card
                      ? 'transfer'
                      : 'card'
                return (
                  <BarberRow
                    key={`${bucket.staff_id}-${bucket.branch_id}`}
                    bucket={bucket}
                    fillPct={fillPct}
                    dominantMethod={dominantMethod}
                    onPay={() => openPay(bucket)}
                    disabled={isPending || bucket.pending_total === 0}
                  />
                )
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Dialog: pagar propinas de un barbero ─────────────────────────── */}
      <Dialog open={payDialog.open} onOpenChange={(o) => !o && setPayDialog({ open: false, bucket: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="size-4 text-amber-500" />
              Pagar propinas
            </DialogTitle>
            <DialogDescription>
              Vas a liquidar todas las propinas pendientes de {payDialog.bucket?.staff_name} en {payDialog.bucket?.branch_name}.
            </DialogDescription>
          </DialogHeader>

          {payDialog.bucket && (
            <div className="space-y-4">
              {/* Resumen del monto */}
              <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
                <p className="text-xs text-muted-foreground mb-1">Total a pagar</p>
                <p className="text-2xl font-bold tabular-nums text-amber-500">
                  {formatCurrency(payDialog.bucket.pending_total)}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                  <span>{payDialog.bucket.pending_count} cobro{payDialog.bucket.pending_count === 1 ? '' : 's'}</span>
                  {payDialog.bucket.first_pending_date && (
                    <>
                      <span>·</span>
                      <span>desde {formatLongDate(payDialog.bucket.first_pending_date)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Mix dentro del bucket */}
              {(payDialog.bucket.pending_cash + payDialog.bucket.pending_transfer + payDialog.bucket.pending_card) > 0 && (
                <div className="rounded-lg border border-border divide-y divide-border text-xs">
                  {payDialog.bucket.pending_cash > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Banknote className="size-3.5 text-emerald-500" />
                        Cobradas en efectivo
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(payDialog.bucket.pending_cash)}
                      </span>
                    </div>
                  )}
                  {payDialog.bucket.pending_transfer > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <ArrowRightLeft className="size-3.5 text-cyan-500" />
                        Cobradas por transferencia
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(payDialog.bucket.pending_transfer)}
                      </span>
                    </div>
                  )}
                  {payDialog.bucket.pending_card > 0 && (
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <CreditCard className="size-3.5 text-violet-500" />
                        Cobradas con tarjeta
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(payDialog.bucket.pending_card)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <Separator />

              <div>
                <Label>Cómo le vas a pagar al barbero</Label>
                <Select value={payMethod} onValueChange={(v) => {
                  setPayMethod(v as 'cash' | 'transfer' | 'card' | 'other')
                  if (v !== 'transfer') setPayAccountId('')
                }}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="card">Tarjeta / otro</SelectItem>
                    <SelectItem value="other">Otro</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  El método de pago al barbero puede ser distinto al método con que el cliente dejó la propina.
                </p>
              </div>

              {payMethod === 'transfer' && (() => {
                const branchAccounts = paymentAccounts.filter(a => a.branch_id === payDialog.bucket!.branch_id)
                const ordered = [
                  ...branchAccounts.filter(a => a.is_salary_account),
                  ...branchAccounts.filter(a => !a.is_salary_account),
                ]
                if (ordered.length === 0) {
                  return (
                    <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                      No hay cuentas activas en esta sucursal. Configurá una en Cuentas de cobro.
                    </p>
                  )
                }
                return (
                  <div>
                    <Label>Cuenta a debitar</Label>
                    <Select value={payAccountId} onValueChange={setPayAccountId}>
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="Seleccionar cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        {ordered.map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            {acc.name}
                            {acc.is_salary_account ? ' · Sueldos' : ''}
                            {acc.alias_or_cbu ? ` · ${acc.alias_or_cbu}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })()}

              <div>
                <Label htmlFor="tip-pay-notes">Notas (opcional)</Label>
                <Textarea
                  id="tip-pay-notes"
                  placeholder="Ej: pago de propinas acumuladas de abril"
                  className="mt-1.5 min-h-16 resize-none"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog({ open: false, bucket: null })}>
              Cancelar
            </Button>
            <Button
              onClick={handlePay}
              disabled={isPending || (payMethod === 'transfer' && !payAccountId)}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              <HandCoins className="size-3.5 mr-2" />
              Confirmar y descargar recibo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, sublabel, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sublabel: string
  tone: 'amber' | 'emerald' | 'violet' | 'cyan'
}) {
  const ringByTone: Record<string, string> = {
    amber: 'ring-amber-500/20',
    emerald: 'ring-emerald-500/20',
    violet: 'ring-violet-500/20',
    cyan: 'ring-cyan-500/20',
  }
  return (
    <Card className={cn('ring-1', ringByTone[tone])}>
      <CardContent className="p-4 lg:p-5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </span>
          {icon}
        </div>
        <p className="text-xl lg:text-2xl font-semibold tabular-nums leading-none">
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1.5">{sublabel}</p>
      </CardContent>
    </Card>
  )
}

function MethodBar({
  icon, label, amount, total, barClass,
}: {
  icon: React.ReactNode
  label: string
  amount: number
  total: number
  barClass: string
}) {
  const pct = total > 0 ? (amount / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="tabular-nums font-medium">
          {formatCurrency(amount)}
          <span className="text-muted-foreground ml-1.5 text-[10px]">
            {pct.toFixed(0)}%
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BarberRow({
  bucket, fillPct, dominantMethod, onPay, disabled,
}: {
  bucket: BarberTipBucket
  fillPct: number
  dominantMethod: 'cash' | 'card' | 'transfer'
  onPay: () => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const initials = bucket.staff_name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3.5 hover:bg-muted/30 transition-colors flex items-center gap-4"
      >
        {/* Avatar */}
        <div className="size-10 rounded-full bg-gradient-to-br from-muted to-muted/40 flex items-center justify-center text-xs font-semibold shrink-0 ring-1 ring-border">
          {initials || '?'}
        </div>

        {/* Nombre + sucursal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{bucket.staff_name}</p>
            {bucket.pending_total > 0 && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px]">
                A cobrar
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <Building2 className="size-3" />
            <span className="truncate">{bucket.branch_name}</span>
            {bucket.pending_total > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <MethodIcon method={dominantMethod} className="size-3" />
                  {methodLabel(dominantMethod)} mayoritario
                </span>
              </>
            )}
          </div>
          {/* Barra de "histórico total" */}
          <div className="mt-2 h-1 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500/60 to-orange-400/60 rounded-full transition-all"
              style={{ width: `${Math.max(2, fillPct)}%` }}
            />
          </div>
        </div>

        {/* Montos */}
        <div className="text-right shrink-0 hidden sm:block">
          {bucket.pending_total > 0 ? (
            <>
              <p className="text-base font-semibold tabular-nums text-amber-500">
                {formatCurrency(bucket.pending_total)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {bucket.pending_count} cobro{bucket.pending_count === 1 ? '' : 's'} pendiente{bucket.pending_count === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
              <CheckCircle2 className="size-2.5 mr-1" />
              Al día
            </Badge>
          )}
        </div>

        {/* Acción */}
        <div className="flex items-center gap-2 shrink-0">
          {bucket.pending_total > 0 && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onPay()
              }}
              disabled={disabled}
              className="bg-amber-500 hover:bg-amber-600 text-white h-8"
            >
              <HandCoins className="size-3.5 mr-1.5" />
              Pagar
            </Button>
          )}
          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <ExpandedBarberDetail bucket={bucket} />
      )}
    </div>
  )
}

interface ExpandedDetailItem {
  id: string
  amount: number
  report_date: string
  status: 'pending' | 'paid'
  tip_payment_method: 'cash' | 'card' | 'transfer' | null
  notes: string | null
  account_id: string | null
  account_name: string | null
  account_alias: string | null
  account_is_active: boolean | null
}

function ExpandedBarberDetail({ bucket }: { bucket: BarberTipBucket }) {
  const [state, setState] = useState<{ loading: boolean; items: ExpandedDetailItem[] }>({
    loading: true,
    items: [],
  })

  useEffect(() => {
    let mounted = true
    getBarberTipsDetail(bucket.staff_id, bucket.branch_id).then((r) => {
      if (!mounted) return
      const items = 'data' in r && r.data ? (r.data as ExpandedDetailItem[]) : []
      setState({ loading: false, items })
    })
    return () => { mounted = false }
  }, [bucket.staff_id, bucket.branch_id])

  const { loading, items } = state
  if (loading) {
    return (
      <div className="bg-muted/20 px-4 py-3 space-y-2 border-t border-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-muted/20 px-4 py-3 text-xs text-muted-foreground border-t border-border">
        Sin detalle disponible.
      </div>
    )
  }

  return (
    <div className="bg-muted/20 border-t border-border">
      <div className="grid grid-cols-12 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
        <span className="col-span-2">Fecha</span>
        <span className="col-span-2">Método</span>
        <span className="col-span-4">Cuenta donde entró</span>
        <span className="col-span-2">Estado</span>
        <span className="col-span-2 text-right">Monto</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'grid grid-cols-12 px-4 py-2 text-xs items-center hover:bg-muted/40 transition-colors',
              item.status === 'paid' && 'opacity-60'
            )}
          >
            <span className="col-span-2 text-muted-foreground">
              {formatLongDate(item.report_date)}
            </span>
            <span className="col-span-2 flex items-center gap-1.5">
              <MethodIcon method={item.tip_payment_method ?? 'other'} className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">{methodLabel(item.tip_payment_method ?? 'other')}</span>
            </span>
            <span className="col-span-4 min-w-0">
              {item.account_name ? (
                <span className="flex items-center gap-1.5 min-w-0">
                  <Wallet className={cn(
                    'size-3 shrink-0',
                    item.account_is_active ? 'text-cyan-500' : 'text-muted-foreground/50'
                  )} />
                  <span className="truncate">
                    <span className={cn(
                      item.account_is_active ? 'text-foreground' : 'text-muted-foreground line-through decoration-dotted'
                    )}>
                      {item.account_name}
                    </span>
                    {item.account_alias && (
                      <span className="text-muted-foreground/70 ml-1">· {item.account_alias}</span>
                    )}
                  </span>
                  {item.account_is_active === false && (
                    <Badge variant="outline" className="bg-muted/40 text-muted-foreground border-border text-[9px] px-1.5 py-0 h-4 shrink-0">
                      inactiva
                    </Badge>
                  )}
                </span>
              ) : item.tip_payment_method === 'cash' ? (
                <span className="text-muted-foreground/60 italic">Sin cuenta · efectivo</span>
              ) : (
                <span className="text-muted-foreground/40">—</span>
              )}
            </span>
            <span className="col-span-2">
              {item.status === 'pending' ? (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]">
                  Pendiente
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]">
                  Pagada
                </Badge>
              )}
            </span>
            <span className="col-span-2 text-right font-medium tabular-nums">
              {formatCurrency(item.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

