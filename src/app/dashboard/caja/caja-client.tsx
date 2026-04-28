'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  DollarSign,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  ChevronDown,
  Download,
  Receipt,
  User,
  Scissors,
  Package,
  MessageSquare,
  X,
  FileSpreadsheet,
  Loader2,
  Calendar,
  Wallet,
  Pencil,
  Check as CheckIcon,
  AlertTriangle,
  Crown,
  Medal,
  Trophy,
  TrendingUp,
  Clock,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency } from '@/lib/format'
import { getLocalDateStr } from '@/lib/time-utils'
import {
  fetchCajaTickets,
  fetchCajaSummary,
  fetchCajaCSVData,
  type CajaTicket,
  type CajaDailySummary,
  type CajaCSVRow,
} from '@/lib/actions/caja'
import {
  fetchShiftClosesForCaja,
  setBranchOpeningCash,
  updateShiftCloseOpeningCash,
  type ShiftCloseRow,
} from '@/lib/actions/shift'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BranchRow { id: string; name: string; default_opening_cash?: number }
interface BarberRow { id: string; full_name: string; branch_id: string | null }
interface AccountRow { id: string; name: string; branch_id: string; is_salary_account?: boolean }

interface CajaClientProps {
  initialTickets: CajaTicket[]
  initialSummary: CajaDailySummary
  initialShiftCloses: ShiftCloseRow[]
  initialDate: string
  branches: BranchRow[]
  barbers: BarberRow[]
  accounts: AccountRow[]
}

// "all" | "cash" | "card" | "salary_accounts" | `acct:<accountId>`
type PaymentFilter = string

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function formatHour(dateStr: string) {
  const d = new Date(dateStr)
  return `${String(d.getHours()).padStart(2, '0')}:00`
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('')
}

function csvFromRows(headers: string[], rows: (string | number)[][]): string {
  return [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')
}

function safeFilePart(s: string) {
  return s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'archivo'
}

// Animated count-up para los números
function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    fromRef.current = value
    startRef.current = null
    let raf = 0
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const elapsed = t - startRef.current
      const k = Math.min(1, elapsed / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - k, 3)
      const v = fromRef.current + (target - fromRef.current) * eased
      setValue(v)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return value
}

// Color tokens por método de pago
const PAYMENT_TOKENS = {
  cash: {
    label: 'Efectivo',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500',
    bgSoft: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    ring: 'ring-emerald-400/20',
    bar: 'bg-emerald-500',
    glow: 'shadow-emerald-500/20',
  },
  card: {
    label: 'Tarjeta',
    text: 'text-sky-300',
    bg: 'bg-sky-500',
    bgSoft: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    ring: 'ring-sky-400/20',
    bar: 'bg-sky-500',
    glow: 'shadow-sky-500/20',
  },
  transfer: {
    label: 'Transferencia',
    text: 'text-violet-300',
    bg: 'bg-violet-500',
    bgSoft: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    ring: 'ring-violet-400/20',
    bar: 'bg-violet-500',
    glow: 'shadow-violet-500/20',
  },
} as const

function paymentBadge(method: string, accountName: string | null) {
  if (method === 'cash') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        <Banknote className="size-3" />Efectivo
      </span>
    )
  }
  if (method === 'card') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300">
        <CreditCard className="size-3" />Tarjeta
      </span>
    )
  }
  if (method === 'transfer') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
        <ArrowRightLeft className="size-3" />{accountName ?? 'Transferencia'}
      </span>
    )
  }
  return <Badge variant="outline">{method}</Badge>
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CajaClient({
  initialTickets,
  initialSummary,
  initialShiftCloses,
  initialDate,
  branches: initialBranches,
  barbers,
  accounts,
}: CajaClientProps) {
  const [branches, setBranches] = useState<BranchRow[]>(initialBranches)
  const [tickets, setTickets] = useState<CajaTicket[]>(initialTickets)
  const [summary, setSummary] = useState<CajaDailySummary>(initialSummary)
  const [shiftCloses, setShiftCloses] = useState<ShiftCloseRow[]>(initialShiftCloses)
  const [date, setDate] = useState(initialDate)
  const [loading, setLoading] = useState(false)

  const [filterBarber, setFilterBarber] = useState<string>('all')
  const [filterPayment, setFilterPayment] = useState<PaymentFilter>('all')

  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set())
  const [showExport, setShowExport] = useState(false)

  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const prevBranchRef = useRef(selectedBranchId)
  useEffect(() => {
    if (prevBranchRef.current !== selectedBranchId) {
      prevBranchRef.current = selectedBranchId
      refresh()
    }
  }, [selectedBranchId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredBarbers = useMemo(() => {
    if (!selectedBranchId) return barbers
    return barbers.filter(b => b.branch_id === selectedBranchId)
  }, [barbers, selectedBranchId])

  const filteredAccounts = useMemo(() => {
    if (!selectedBranchId) return accounts
    return accounts.filter(a => a.branch_id === selectedBranchId)
  }, [accounts, selectedBranchId])

  const refresh = useCallback(async (newDate?: string) => {
    const d = newDate ?? date
    setLoading(true)
    try {
      const [ticketRes, summaryRes, closesRes] = await Promise.all([
        fetchCajaTickets({ branchId: selectedBranchId, date: d }),
        fetchCajaSummary({ branchId: selectedBranchId, date: d }),
        fetchShiftClosesForCaja({ branchId: selectedBranchId, date: d }),
      ])
      if (ticketRes.data) setTickets(ticketRes.data)
      if (summaryRes.data) setSummary(summaryRes.data)
      if (closesRes.data) setShiftCloses(closesRes.data)
    } finally {
      setLoading(false)
    }
  }, [date, selectedBranchId])

  const handleDateChange = (newDate: string) => {
    setDate(newDate)
    refresh(newDate)
  }

  // ── Filtro de tickets ──
  const filteredTickets = useMemo(() => {
    let result = tickets
    if (filterBarber !== 'all') {
      result = result.filter(t => t.barberId === filterBarber)
    }
    if (filterPayment !== 'all') {
      if (filterPayment === 'cash') {
        result = result.filter(t => t.paymentMethod === 'cash')
      } else if (filterPayment === 'card') {
        result = result.filter(t => t.paymentMethod === 'card')
      } else if (filterPayment === 'salary_accounts') {
        const salaryIds = new Set(filteredAccounts.filter(a => a.is_salary_account).map(a => a.id))
        result = result.filter(t =>
          t.paymentMethod === 'transfer' && t.paymentAccountId != null && salaryIds.has(t.paymentAccountId)
        )
      } else if (filterPayment.startsWith('acct:')) {
        const accountId = filterPayment.slice(5)
        result = result.filter(t => t.paymentMethod === 'transfer' && t.paymentAccountId === accountId)
      }
    }
    return result
  }, [tickets, filterBarber, filterPayment, filteredAccounts])

  const toggleTicket = (id: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── Totales filtrados ──
  const filteredTotals = useMemo(() => {
    let cash = 0, card = 0
    const byAccount = new Map<string, { name: string; total: number }>()
    for (const t of filteredTickets) {
      if (t.paymentMethod === 'cash') cash += t.amount
      else if (t.paymentMethod === 'card') card += t.amount
      else if (t.paymentMethod === 'transfer' && t.paymentAccountId) {
        const existing = byAccount.get(t.paymentAccountId)
        if (existing) existing.total += t.amount
        else byAccount.set(t.paymentAccountId, { name: t.paymentAccountName ?? 'Cuenta', total: t.amount })
      }
    }
    const transferTotal = Array.from(byAccount.values()).reduce((s, a) => s + a.total, 0)
    return {
      cash,
      card,
      transferTotal,
      accounts: Array.from(byAccount.entries()).map(([id, v]) => ({ accountId: id, accountName: v.name, total: v.total })),
      total: cash + card + transferTotal,
      count: filteredTickets.length,
    }
  }, [filteredTickets])

  const hasActiveFilters = filterBarber !== 'all' || filterPayment !== 'all'

  // ── Etiquetas legibles para chips de filtros activos ──
  const paymentFilterLabel = useMemo(() => {
    if (filterPayment === 'all') return null
    if (filterPayment === 'cash') return 'Efectivo'
    if (filterPayment === 'card') return 'Tarjeta'
    if (filterPayment === 'salary_accounts') return 'Cuentas sueldos'
    if (filterPayment.startsWith('acct:')) {
      const id = filterPayment.slice(5)
      return accounts.find(a => a.id === id)?.name ?? 'Cuenta'
    }
    return null
  }, [filterPayment, accounts])

  const barberFilterLabel = useMemo(() => {
    if (filterBarber === 'all') return null
    return barbers.find(b => b.id === filterBarber)?.full_name ?? null
  }, [filterBarber, barbers])

  const isToday = date === getLocalDateStr()

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(120,113,108,0.08),transparent_60%)]">

      {/* ── Header sticky ── */}
      <CajaHeader
        date={date}
        isToday={isToday}
        onDateChange={handleDateChange}
        branches={branches}
        filterBarber={filterBarber}
        setFilterBarber={setFilterBarber}
        filterPayment={filterPayment}
        setFilterPayment={setFilterPayment}
        filteredBarbers={filteredBarbers}
        filteredAccounts={filteredAccounts}
        hasActiveFilters={hasActiveFilters}
        barberFilterLabel={barberFilterLabel}
        paymentFilterLabel={paymentFilterLabel}
        onExport={() => setShowExport(true)}
        loading={loading}
      />

      {/* ── Contenido scrolleable ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-5 space-y-5">

          {/* ── Hero panel ── */}
          <HeroRevenuePanel
            tickets={tickets}
            summary={summary}
            filteredTotals={filteredTotals}
            hasActiveFilters={hasActiveFilters}
            isToday={isToday}
          />

          {/* ── Strip de métricas ── */}
          <MetricsStrip
            hasActiveFilters={hasActiveFilters}
            summary={summary}
            filteredTotals={filteredTotals}
          />

          {/* ── Layout 2 columnas ── */}
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Timeline tickets */}
            <div className="lg:col-span-2 space-y-3">
              <TicketsTimeline
                tickets={filteredTickets}
                allTicketsCount={tickets.length}
                hasActiveFilters={hasActiveFilters}
                expandedTickets={expandedTickets}
                onToggle={toggleTicket}
                loading={loading}
              />
            </div>

            {/* Sidebar */}
            <div className="space-y-5">
              {!hasActiveFilters && (
                <BarberPodium tickets={tickets} barbers={filteredBarbers} />
              )}
              <ShiftClosesSection
                closes={shiftCloses}
                branches={branches}
                selectedBranchId={selectedBranchId}
                onBranchOpeningCashUpdated={(branchId, amount) => {
                  setBranches(prev => prev.map(b => b.id === branchId ? { ...b, default_opening_cash: amount } : b))
                }}
                onShiftOpeningCashUpdated={(closeId, amount) => {
                  setShiftCloses(prev => prev.map(c => {
                    if (c.id !== closeId) return c
                    const newExpected = amount + c.cashTotal + c.tipsCash
                    const newDiff = c.cashCounted === null ? null : c.cashCounted - newExpected
                    return { ...c, openingCash: amount, cashExpected: newExpected, cashDiff: newDiff }
                  }))
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Dialog de exportacion ── */}
      <ExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        currentDate={date}
        branchId={selectedBranchId}
        barbers={filteredBarbers}
        filterBarber={filterBarber}
        filterPayment={filterPayment}
        accounts={accounts}
      />
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function CajaHeader({
  date,
  isToday,
  onDateChange,
  branches,
  filterBarber,
  setFilterBarber,
  filterPayment,
  setFilterPayment,
  filteredBarbers,
  filteredAccounts,
  hasActiveFilters,
  barberFilterLabel,
  paymentFilterLabel,
  onExport,
  loading,
}: {
  date: string
  isToday: boolean
  onDateChange: (d: string) => void
  branches: BranchRow[]
  filterBarber: string
  setFilterBarber: (v: string) => void
  filterPayment: PaymentFilter
  setFilterPayment: (v: PaymentFilter) => void
  filteredBarbers: BarberRow[]
  filteredAccounts: AccountRow[]
  hasActiveFilters: boolean
  barberFilterLabel: string | null
  paymentFilterLabel: string | null
  onExport: () => void
  loading: boolean
}) {
  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 pt-3 pb-2.5 space-y-2.5">
        {/* Fila 1 — Título + fecha + sucursal */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg lg:text-xl font-bold tracking-tight bg-gradient-to-b from-zinc-50 to-zinc-300 bg-clip-text text-transparent">
              Caja del día
            </h2>
            {isToday && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400"></span>
                </span>
                En vivo
              </span>
            )}
            {loading && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground transition-colors group-hover:text-amber-400" />
              <Input
                type="date"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="w-[160px] h-9 text-sm pl-8 border-white/[0.06] bg-zinc-900/40 hover:border-amber-500/30 transition-colors"
              />
            </div>
            <BranchSelector branches={branches} />
          </div>
        </div>

        {/* Fila 2 — Filtros como command-pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterBarber} onValueChange={setFilterBarber}>
            <SelectTrigger className="w-[180px] h-8 text-xs border-white/[0.06] bg-zinc-900/40 hover:border-white/10 transition-colors">
              <User className="size-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Todos los barberos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los barberos</SelectItem>
              {filteredBarbers.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterPayment} onValueChange={setFilterPayment}>
            <SelectTrigger className="w-[190px] h-8 text-xs border-white/[0.06] bg-zinc-900/40 hover:border-white/10 transition-colors">
              <DollarSign className="size-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Todos los pagos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los pagos</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px]">Directos</SelectLabel>
                <SelectItem value="cash">Efectivo</SelectItem>
                <SelectItem value="card">Tarjeta</SelectItem>
              </SelectGroup>
              {filteredAccounts.some(a => a.is_salary_account) && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-[10px]">Grupos</SelectLabel>
                    <SelectItem value="salary_accounts">Cuentas sueldos</SelectItem>
                  </SelectGroup>
                </>
              )}
              {filteredAccounts.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-[10px]">Cuentas (transferencia)</SelectLabel>
                    {filteredAccounts.map(a => (
                      <SelectItem key={a.id} value={`acct:${a.id}`}>
                        {a.name}{a.is_salary_account ? ' · Sueldos' : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs px-2 gap-1 text-muted-foreground hover:text-zinc-200"
              onClick={() => { setFilterBarber('all'); setFilterPayment('all') }}
            >
              <X className="size-3" />
              Limpiar
            </Button>
          )}

          {/* Chips de filtros activos */}
          {barberFilterLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-200">
              <User className="size-3 text-muted-foreground" />{barberFilterLabel}
              <button type="button" onClick={() => setFilterBarber('all')} className="ml-0.5 rounded-full hover:bg-red-500/20 hover:text-red-300 transition-colors p-0.5"><X className="size-3" /></button>
            </span>
          )}
          {paymentFilterLabel && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-200">
              <DollarSign className="size-3 text-muted-foreground" />{paymentFilterLabel}
              <button type="button" onClick={() => setFilterPayment('all')} className="ml-0.5 rounded-full hover:bg-red-500/20 hover:text-red-300 transition-colors p-0.5"><X className="size-3" /></button>
            </span>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs border-white/10 bg-white/[0.03] hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-300 transition-colors"
              onClick={onExport}
            >
              <Download className="size-3.5" />
              Exportar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Hero panel ───────────────────────────────────────────────────────────────

function HeroRevenuePanel({
  tickets,
  summary,
  filteredTotals,
  hasActiveFilters,
  isToday,
}: {
  tickets: CajaTicket[]
  summary: CajaDailySummary
  filteredTotals: { cash: number; card: number; transferTotal: number; total: number; count: number }
  hasActiveFilters: boolean
  isToday: boolean
}) {
  const total = hasActiveFilters ? filteredTotals.total : summary.totalRevenue
  const count = hasActiveFilters ? filteredTotals.count : summary.ticketCount
  const cash = hasActiveFilters ? filteredTotals.cash : summary.totalCash
  const card = hasActiveFilters ? filteredTotals.card : summary.totalCard
  const transfer = hasActiveFilters
    ? filteredTotals.transferTotal
    : summary.accounts.reduce((s, a) => s + a.total, 0)

  const animatedTotal = useCountUp(total)
  const aov = count > 0 ? total / count : 0

  // Distribución horaria para sparkline
  const hourBuckets = useMemo(() => {
    const buckets = new Array(24).fill(0)
    for (const t of tickets) {
      const h = new Date(t.completedAt).getHours()
      buckets[h] += t.amount
    }
    return buckets
  }, [tickets])

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/90 via-zinc-900/60 to-zinc-950 shadow-2xl shadow-black/40">
      {/* Glow decorativo */}
      <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 size-72 rounded-full bg-emerald-500/5 blur-3xl" />

      {/* Sparkline de fondo */}
      <Sparkline buckets={hourBuckets} />

      <div className="relative grid gap-5 p-5 md:gap-6 md:grid-cols-[1fr_auto] md:p-8">
        {/* Lado izquierdo — Hero number */}
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-amber-400/70" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">
              {hasActiveFilters ? 'Total filtrado' : 'Recaudación del día'}
            </p>
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-4xl min-[420px]:text-5xl md:text-6xl font-bold tabular-nums leading-none tracking-tight bg-gradient-to-br from-amber-100 via-amber-300 to-orange-500 bg-clip-text text-transparent break-words">
              {formatCurrency(animatedTotal)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Receipt className="size-3.5" />
              {count} {count === 1 ? 'ticket' : 'tickets'}
            </span>
            <span className="size-1 rounded-full bg-zinc-700" />
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <TrendingUp className="size-3.5" />
              Promedio {formatCurrency(aov)}
            </span>
            {!hasActiveFilters && summary.cashExpenses > 0 && (
              <>
                <span className="size-1 rounded-full bg-zinc-700" />
                <span className="text-rose-400 whitespace-nowrap">
                  Egresos {formatCurrency(summary.cashExpenses)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Lado derecho — Mix bubble */}
        <div className="hidden md:flex md:items-center md:justify-end">
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-zinc-950/60 px-3 py-1.5 backdrop-blur">
            <Clock className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              {isToday ? 'Actualizado en tiempo real' : 'Día cerrado'}
            </span>
          </div>
        </div>

        {/* Cinta de composición de pagos */}
        <div className="md:col-span-2">
          <PaymentCompositionBar
            cash={cash}
            card={card}
            transfer={transfer}
            total={total}
          />
        </div>
      </div>
    </div>
  )
}

function Sparkline({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1)
  const points = buckets
    .map((v, i) => {
      const x = (i / 23) * 100
      const y = 100 - (v / max) * 80
      return `${x},${y}`
    })
    .join(' ')
  const areaPoints = `0,100 ${points} 100,100`
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full opacity-[0.18]"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#sparkGrad)" />
      <polyline
        points={points}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PaymentCompositionBar({
  cash, card, transfer, total,
}: {
  cash: number; card: number; transfer: number; total: number
}) {
  if (total <= 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-zinc-950/40 px-4 py-3 text-center text-[11px] text-muted-foreground">
        Sin movimientos en el día
      </div>
    )
  }
  const pCash = (cash / total) * 100
  const pCard = (card / total) * 100
  const pTransfer = (transfer / total) * 100

  const segments = [
    { key: 'cash', label: 'Efectivo', amount: cash, pct: pCash, token: PAYMENT_TOKENS.cash, icon: <Banknote className="size-3" /> },
    { key: 'card', label: 'Tarjeta', amount: card, pct: pCard, token: PAYMENT_TOKENS.card, icon: <CreditCard className="size-3" /> },
    { key: 'transfer', label: 'Transferencias', amount: transfer, pct: pTransfer, token: PAYMENT_TOKENS.transfer, icon: <ArrowRightLeft className="size-3" /> },
  ].filter(s => s.amount > 0)

  return (
    <div className="space-y-2.5">
      {/* Barra apilada */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-950/60 ring-1 ring-white/[0.06]">
        {segments.map(s => (
          <div
            key={s.key}
            className={`${s.token.bar} h-full transition-all`}
            style={{ width: `${s.pct}%` }}
            title={`${s.label}: ${formatCurrency(s.amount)} (${s.pct.toFixed(1)}%)`}
          />
        ))}
      </div>
      {/* Leyenda */}
      <div className="grid grid-cols-1 gap-y-1.5 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-x-5">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={`inline-flex size-1.5 shrink-0 rounded-full ${s.token.bar}`} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className={`font-semibold tabular-nums ${s.token.text}`}>{formatCurrency(s.amount)}</span>
            <span className="text-[10px] text-muted-foreground/70">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Métricas (3 mini cards) ──────────────────────────────────────────────────

function MetricsStrip({
  hasActiveFilters,
  summary,
  filteredTotals,
}: {
  hasActiveFilters: boolean
  summary: CajaDailySummary
  filteredTotals: { cash: number; card: number; transferTotal: number; accounts: { accountId: string; accountName: string; total: number }[] }
}) {
  const cash = hasActiveFilters ? filteredTotals.cash : (summary.totalCash - summary.cashExpenses)
  const card = hasActiveFilters ? filteredTotals.card : summary.totalCard
  const transfer = hasActiveFilters
    ? filteredTotals.transferTotal
    : summary.accounts.reduce((s, a) => s + a.total, 0)
  const accounts = hasActiveFilters ? filteredTotals.accounts : summary.accounts.map(a => ({ accountId: a.accountId, accountName: a.accountName, total: a.total }))

  const items = [
    {
      key: 'cash',
      token: PAYMENT_TOKENS.cash,
      icon: <Banknote className="size-4" />,
      label: 'Efectivo en caja',
      amount: cash,
      footnote: !hasActiveFilters && summary.cashExpenses > 0 ? `Egresos ${formatCurrency(summary.cashExpenses)}` : undefined,
      accounts: undefined as { accountId: string; accountName: string; total: number }[] | undefined,
    },
    {
      key: 'card',
      token: PAYMENT_TOKENS.card,
      icon: <CreditCard className="size-4" />,
      label: 'Tarjeta',
      amount: card,
      footnote: undefined,
      accounts: undefined,
    },
    {
      key: 'transfer',
      token: PAYMENT_TOKENS.transfer,
      icon: <ArrowRightLeft className="size-4" />,
      label: 'Transferencias',
      amount: transfer,
      footnote: undefined,
      accounts,
    },
  ]

  return (
    <>
      {/* Mobile — carrusel horizontal con snap */}
      <div className="-mx-4 sm:hidden">
        <div className="flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((it) => (
            <div
              key={it.key}
              className="snap-start shrink-0 w-[78%] min-[420px]:w-[58%] first:ml-0 last:mr-1 flex"
            >
              <MetricCard
                token={it.token}
                icon={it.icon}
                label={it.label}
                amount={it.amount}
                footnote={it.footnote}
                accounts={it.accounts}
              />
            </div>
          ))}
        </div>
        {/* Indicadores de paginación */}
        <div className="mt-1 flex items-center justify-center gap-1.5">
          {items.map((it) => (
            <span
              key={it.key}
              className={`h-1 rounded-full transition-all ${it.amount > 0 ? `${it.token.bar} w-5` : 'w-1.5 bg-zinc-700'}`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {/* Tablet/desktop — grid */}
      <div className="hidden gap-3 sm:grid sm:grid-cols-3">
        {items.map(it => (
          <MetricCard
            key={it.key}
            token={it.token}
            icon={it.icon}
            label={it.label}
            amount={it.amount}
            footnote={it.footnote}
            accounts={it.accounts}
          />
        ))}
      </div>
    </>
  )
}

function MetricCard({
  token,
  icon,
  label,
  amount,
  footnote,
  accounts,
}: {
  token: typeof PAYMENT_TOKENS[keyof typeof PAYMENT_TOKENS]
  icon: React.ReactNode
  label: string
  amount: number
  footnote?: string
  accounts?: { accountId: string; accountName: string; total: number }[]
}) {
  const animated = useCountUp(amount)
  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3.5 sm:p-4 transition-colors hover:border-white/10">
      {/* Soft accent on hover */}
      <div className={`pointer-events-none absolute -top-12 -right-12 size-32 rounded-full ${token.bgSoft} blur-2xl opacity-50 transition-opacity group-hover:opacity-80`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{label}</p>
          <p className={`text-2xl font-bold tabular-nums leading-tight ${token.text}`}>
            {formatCurrency(animated)}
          </p>
          {footnote && (
            <p className="text-[10px] text-rose-400/80 truncate">{footnote}</p>
          )}
        </div>
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${token.bgSoft} ${token.text} ring-1 ${token.ring}`}>
          {icon}
        </div>
      </div>
      {accounts && accounts.length > 0 && (
        <div className="relative mt-3 space-y-1 border-t border-white/[0.05] pt-2">
          {accounts.slice(0, 2).map(a => (
            <div key={a.accountId} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-muted-foreground">{a.accountName}</span>
              <span className="shrink-0 tabular-nums text-zinc-300">{formatCurrency(a.total)}</span>
            </div>
          ))}
          {accounts.length > 2 && (
            <p className="text-[10px] text-muted-foreground">+ {accounts.length - 2} más</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Timeline de tickets agrupados por hora ───────────────────────────────────

function TicketsTimeline({
  tickets,
  allTicketsCount,
  hasActiveFilters,
  expandedTickets,
  onToggle,
  loading,
}: {
  tickets: CajaTicket[]
  allTicketsCount: number
  hasActiveFilters: boolean
  expandedTickets: Set<string>
  onToggle: (id: string) => void
  loading: boolean
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { hour: string; tickets: CajaTicket[]; total: number }>()
    for (const t of tickets) {
      const hour = formatHour(t.completedAt)
      const existing = map.get(hour)
      if (existing) {
        existing.tickets.push(t)
        existing.total += t.amount
      } else {
        map.set(hour, { hour, tickets: [t], total: t.amount })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.hour.localeCompare(a.hour))
  }, [tickets])

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-200">
          <Receipt className="size-4 text-amber-400" />
          Tickets
          <span className="text-xs font-normal text-muted-foreground">
            ({tickets.length})
          </span>
        </h3>
        {hasActiveFilters && (
          <span className="text-[10px] text-muted-foreground">
            {tickets.length} de {allTicketsCount} del día
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          Cargando...
        </div>
      )}

      {!loading && tickets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <Receipt className="size-10 opacity-20" />
          No hay tickets para los filtros seleccionados
        </div>
      )}

      {!loading && groups.length > 0 && (
        <div className="divide-y divide-white/[0.04]">
          {groups.map(group => (
            <div key={group.hour} className="px-3 py-2">
              {/* Separador de hora */}
              <div className="flex items-center gap-3 px-1 pb-2 pt-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tabular-nums text-zinc-300">
                  <span className="inline-flex size-1.5 rounded-full bg-amber-400/70" />
                  {group.hour}
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                <span className="text-[10px] text-muted-foreground">
                  {group.tickets.length} {group.tickets.length === 1 ? 'ticket' : 'tickets'} ·
                  <span className="ml-1 font-semibold text-zinc-300 tabular-nums">{formatCurrency(group.total)}</span>
                </span>
              </div>
              <div className="space-y-1">
                {group.tickets.map(ticket => (
                  <TicketRow
                    key={ticket.visitId}
                    ticket={ticket}
                    isExpanded={expandedTickets.has(ticket.visitId)}
                    onToggle={() => onToggle(ticket.visitId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TicketRow({
  ticket,
  isExpanded,
  onToggle,
}: {
  ticket: CajaTicket
  isExpanded: boolean
  onToggle: () => void
}) {
  const hasDetails = ticket.services.length > 0 || ticket.products.length > 0
  const token = PAYMENT_TOKENS[ticket.paymentMethod] ?? PAYMENT_TOKENS.cash
  return (
    <div className={`group relative rounded-xl border border-white/[0.04] bg-zinc-950/30 overflow-hidden transition-all hover:border-white/10 hover:bg-zinc-950/50 ${isExpanded ? 'ring-1 ring-white/[0.06]' : ''}`}>
      {/* Barra de método de pago */}
      <span className={`absolute left-0 top-0 h-full w-0.5 ${token.bar} opacity-70 group-hover:opacity-100 transition-opacity`} />

      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 pl-4 text-left"
      >
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] items-center gap-x-3 gap-y-0.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{ticket.clientName}</p>
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
              <Scissors className="size-3 inline shrink-0" />
              {ticket.barberName}
              <span className="mx-1 opacity-50">·</span>
              <Clock className="size-3 inline shrink-0" />
              {formatTime(ticket.completedAt)}
            </p>
          </div>

          <div className="hidden sm:flex items-center">
            {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
          </div>

          <div className="text-right flex items-center gap-2">
            <div>
              <p className="text-sm font-bold text-zinc-100 tabular-nums">{formatCurrency(ticket.amount)}</p>
              <div className="sm:hidden mt-0.5">
                {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
              </div>
            </div>
            <ChevronDown className={`size-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-white/[0.05] px-4 py-3 pl-5 space-y-3 bg-zinc-950/40">
          {/* Acciones rapidas */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/mensajeria?clientId=${ticket.clientId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-1 transition-colors"
            >
              <MessageSquare className="size-3.5" />
              Contactar cliente
            </Link>
            {ticket.clientPhone && (
              <span className="text-[11px] text-muted-foreground">{ticket.clientPhone}</span>
            )}
          </div>

          {hasDetails && (
            <>
              {ticket.services.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Servicios</p>
                  {ticket.services.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Scissors className="size-3 text-zinc-500" />
                        {s.name}
                      </span>
                      <span className="text-zinc-400 tabular-nums">{formatCurrency(s.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              {ticket.products.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Productos</p>
                  {ticket.products.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Package className="size-3 text-zinc-500" />
                        {p.name} {p.quantity > 1 && <span className="text-zinc-500">x{p.quantity}</span>}
                      </span>
                      <span className="text-zinc-400 tabular-nums">{formatCurrency(p.unitPrice * p.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="bg-white/[0.05]" />
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-zinc-400">Total</span>
                <span className="text-zinc-100 tabular-nums">{formatCurrency(ticket.amount)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Podio de barberos (efectivo a rendir) ────────────────────────────────────

function BarberPodium({
  tickets,
  barbers,
}: {
  tickets: CajaTicket[]
  barbers: BarberRow[]
}) {
  const ranked = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tickets) {
      if (t.paymentMethod === 'cash') {
        map.set(t.barberId, (map.get(t.barberId) ?? 0) + t.amount)
      }
    }
    return barbers
      .map(b => ({ id: b.id, name: b.full_name, cash: map.get(b.id) ?? 0 }))
      .filter(b => b.cash > 0)
      .sort((a, b) => b.cash - a.cash)
  }, [tickets, barbers])

  if (ranked.length === 0) return null

  const totalCash = ranked.reduce((s, b) => s + b.cash, 0)
  const top = ranked.slice(0, 3)
  const rest = ranked.slice(3)
  const max = top[0]?.cash ?? 1

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-amber-500/[0.04] via-zinc-900/40 to-zinc-900/40">
      <div className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-200">
            <Trophy className="size-4 text-amber-400" />
            Efectivo a rendir
          </h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {ranked.length} {ranked.length === 1 ? 'barbero' : 'barberos'}
          </span>
        </div>

        {/* Top 3 con podio */}
        <div className="space-y-1.5">
          {top.map((b, i) => (
            <PodiumRow key={b.id} rank={i + 1} name={b.name} cash={b.cash} max={max} />
          ))}
        </div>

        {/* Resto */}
        {rest.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-white/[0.04]">
            {rest.map((b, i) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-white/[0.02] transition-colors">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-zinc-800/80 text-[10px] font-bold text-zinc-400">
                    {i + 4}
                  </span>
                  {b.name}
                </span>
                <span className="font-semibold tabular-nums text-emerald-300">{formatCurrency(b.cash)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2 mt-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Total efectivo</span>
          <span className="font-bold tabular-nums text-emerald-300">{formatCurrency(totalCash)}</span>
        </div>
      </div>
    </div>
  )
}

function PodiumRow({
  rank, name, cash, max,
}: {
  rank: 1 | 2 | 3 | number
  name: string
  cash: number
  max: number
}) {
  const config = rank === 1
    ? { ring: 'ring-amber-400/50', bg: 'from-amber-400 to-amber-600', text: 'text-amber-950', icon: <Crown className="size-3" />, bar: 'from-amber-400/60 via-amber-500/40 to-amber-500/10' }
    : rank === 2
      ? { ring: 'ring-zinc-300/30', bg: 'from-zinc-200 to-zinc-400', text: 'text-zinc-950', icon: <Medal className="size-3" />, bar: 'from-zinc-300/40 via-zinc-400/30 to-zinc-400/5' }
      : { ring: 'ring-orange-700/40', bg: 'from-orange-500 to-orange-700', text: 'text-orange-50', icon: <Medal className="size-3" />, bar: 'from-orange-500/50 via-orange-600/30 to-orange-600/5' }

  const pct = Math.max(8, (cash / max) * 100)

  return (
    <div className="relative rounded-xl border border-white/[0.06] bg-zinc-950/40 overflow-hidden">
      {/* Progress bar background */}
      <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${config.bar}`} style={{ width: `${pct}%` }} />
      <div className="relative flex items-center gap-2 px-3 py-2 min-[420px]:gap-2.5">
        <div className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${config.bg} ${config.text} font-bold text-xs ring-2 ${config.ring} shadow-lg`}>
          {config.icon}
        </div>
        <div className="hidden min-[420px]:flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-800/80 text-[10px] font-bold text-zinc-300">
          {getInitials(name) || '?'}
        </div>
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-100">{name}</span>
        <span className="text-sm font-bold tabular-nums text-emerald-300 whitespace-nowrap">{formatCurrency(cash)}</span>
      </div>
    </div>
  )
}

// ─── Dialog de exportacion ────────────────────────────────────────────────────

function ExportDialog({
  open,
  onOpenChange,
  currentDate,
  branchId,
  barbers,
  filterBarber,
  filterPayment,
  accounts,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentDate: string
  branchId: string | null
  barbers: BarberRow[]
  filterBarber: string
  filterPayment: PaymentFilter
  accounts: AccountRow[]
}) {
  const [startDate, setStartDate] = useState(currentDate)
  const [endDate, setEndDate] = useState(currentDate)
  const [splitPerBarber, setSplitPerBarber] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (open) {
      setStartDate(currentDate)
      setEndDate(currentDate)
      const accountFilterActive = filterPayment.startsWith('acct:') || filterPayment === 'cash' || filterPayment === 'card'
      setSplitPerBarber(filterBarber === 'all' && accountFilterActive)
    }
  }, [open, currentDate, filterBarber, filterPayment])

  const paymentParams = useMemo(() => {
    if (filterPayment === 'all') return { paymentMethod: null, paymentAccountId: null }
    if (filterPayment === 'cash') return { paymentMethod: 'cash' as const, paymentAccountId: null }
    if (filterPayment === 'card') return { paymentMethod: 'card' as const, paymentAccountId: null }
    if (filterPayment === 'salary_accounts') return { paymentMethod: 'transfer' as const, paymentAccountId: 'salary_accounts' }
    if (filterPayment.startsWith('acct:')) {
      return { paymentMethod: 'transfer' as const, paymentAccountId: filterPayment.slice(5) }
    }
    return { paymentMethod: null, paymentAccountId: null }
  }, [filterPayment])

  const paymentLabel = useMemo(() => {
    if (filterPayment === 'all') return 'Todos los pagos'
    if (filterPayment === 'cash') return 'Efectivo'
    if (filterPayment === 'card') return 'Tarjeta'
    if (filterPayment === 'salary_accounts') return 'Cuentas sueldos'
    if (filterPayment.startsWith('acct:')) {
      const id = filterPayment.slice(5)
      return accounts.find(a => a.id === id)?.name ?? 'Cuenta'
    }
    return 'Todos los pagos'
  }, [filterPayment, accounts])

  const barberLabel = useMemo(() => {
    if (filterBarber === 'all') return 'Todos los barberos'
    return barbers.find(b => b.id === filterBarber)?.full_name ?? 'Barbero'
  }, [filterBarber, barbers])

  const handleExport = async () => {
    if (endDate < startDate) {
      toast.error('La fecha hasta debe ser posterior a la fecha desde')
      return
    }
    setExporting(true)
    try {
      const barberIds = filterBarber === 'all' ? [] : [filterBarber]
      const { data, error } = await fetchCajaCSVData({
        branchId,
        startDate,
        endDate,
        barberIds,
        paymentMethod: paymentParams.paymentMethod,
        paymentAccountId: paymentParams.paymentAccountId,
      })
      if (error) { toast.error(error); return }
      if (data.length === 0) { toast.info('No hay datos para exportar con los filtros seleccionados'); return }

      const headers = ['Fecha', 'Hora', 'Cliente', 'Telefono', 'Barbero', 'Monto', 'Metodo de Pago', 'Cuenta']
      const toRow = (r: CajaCSVRow) => [r.fecha, r.hora, r.cliente, r.telefono, r.barbero, r.monto, r.metodoPago, r.cuenta]
      const rangeLabel = startDate === endDate ? startDate : `${startDate}-a-${endDate}`
      const paymentSuffix = filterPayment === 'all' ? 'todos' : safeFilePart(paymentLabel)

      if (splitPerBarber && filterBarber === 'all') {
        const byBarber = new Map<string, { name: string; rows: CajaCSVRow[] }>()
        for (const r of data) {
          const existing = byBarber.get(r.barberoId)
          if (existing) existing.rows.push(r)
          else byBarber.set(r.barberoId, { name: r.barbero, rows: [r] })
        }

        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        for (const [, { name, rows }] of byBarber) {
          const csv = csvFromRows(headers, rows.map(toRow))
          zip.file(`caja-${safeFilePart(name)}-${rangeLabel}-${paymentSuffix}.csv`, '﻿' + csv)
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        triggerDownload(blob, `caja-por-barbero-${rangeLabel}-${paymentSuffix}.zip`)
        toast.success(`ZIP generado: ${byBarber.size} barbero(s)`)
      } else {
        const csv = csvFromRows(headers, data.map(toRow))
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
        const barberSuffix = filterBarber === 'all' ? 'todos' : safeFilePart(barberLabel)
        triggerDownload(blob, `caja-${barberSuffix}-${rangeLabel}-${paymentSuffix}.csv`)
        toast.success('CSV exportado correctamente')
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast.error('Error al exportar')
    } finally {
      setExporting(false)
    }
  }

  const canSplit = filterBarber === 'all'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-amber-400" />
            Exportar reporte CSV
          </DialogTitle>
          <DialogDescription>
            El reporte usa los filtros que tenes aplicados actualmente. Solo se puede cambiar el rango de fechas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Filtros aplicados</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><User className="size-3" />Barbero</span>
              <span className="text-zinc-200 font-medium">{barberLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><DollarSign className="size-3" />Pago</span>
              <span className="text-zinc-200 font-medium">{paymentLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          {canSplit && (
            <label className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3 cursor-pointer hover:border-amber-500/30 transition-colors">
              <Checkbox
                checked={splitPerBarber}
                onCheckedChange={(v) => setSplitPerBarber(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-zinc-200">Un archivo CSV por barbero (ZIP)</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Ideal cuando el filtro incluye todos los barberos: genera un CSV separado por cada barbero que haya cobrado en el rango, todos dentro de un ZIP.
                </p>
              </div>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={exporting}>Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting} className="gap-1.5">
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {exporting ? 'Exportando...' : splitPerBarber && canSplit ? 'Descargar ZIP' : 'Descargar CSV'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Cierres de barberos ──────────────────────────────────────────────────────

function ShiftClosesSection({
  closes,
  branches,
  selectedBranchId,
  onBranchOpeningCashUpdated,
  onShiftOpeningCashUpdated,
}: {
  closes: ShiftCloseRow[]
  branches: BranchRow[]
  selectedBranchId: string | null
  onBranchOpeningCashUpdated: (branchId: string, amount: number) => void
  onShiftOpeningCashUpdated: (shiftCloseId: string, amount: number) => void
}) {
  const branch = useMemo(() => {
    if (!selectedBranchId) return null
    return branches.find(b => b.id === selectedBranchId) ?? null
  }, [branches, selectedBranchId])

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
      <div className="border-b border-white/[0.05] px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-200">
            <Wallet className="size-4 text-amber-400" />
            Cierres de barberos
            <span className="text-xs font-normal text-muted-foreground">({closes.length})</span>
          </h3>
        </div>
        {branch && (
          <BranchOpeningCashEditor
            branch={branch}
            onSaved={(amount) => onBranchOpeningCashUpdated(branch.id, amount)}
          />
        )}
      </div>

      <div className="p-3">
        {closes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted-foreground gap-2">
            <Wallet className="size-8 opacity-20" />
            Ningún barbero cerró caja todavía.
          </div>
        ) : (
          <div className="space-y-2">
            {closes.map(c => (
              <ShiftCloseRowItem
                key={c.id}
                close={c}
                showBranch={!selectedBranchId}
                onOpeningCashSaved={(amount) => onShiftOpeningCashUpdated(c.id, amount)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BranchOpeningCashEditor({
  branch,
  onSaved,
}: {
  branch: BranchRow
  onSaved: (amount: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setValue(String(branch.default_opening_cash ?? 0))
    setEditing(true)
  }

  const handleSave = async () => {
    const n = Number(value.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Monto inválido')
      return
    }
    setSaving(true)
    const res = await setBranchOpeningCash(branch.id, n)
    setSaving(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    onSaved(n)
    setEditing(false)
    toast.success('Vuelto inicial actualizado')
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl border border-white/[0.06] bg-zinc-950/40 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-amber-500/30 hover:text-amber-300"
      >
        <span className="text-muted-foreground truncate">Vuelto inicial · {branch.name}:</span>
        <span className="font-semibold tabular-nums">{formatCurrency(branch.default_opening_cash ?? 0)}</span>
        <Pencil className="size-3 opacity-70" />
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Vuelto inicial:</span>
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        className="h-7 w-24 text-xs tabular-nums"
        autoFocus
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="size-3 animate-spin" /> : <CheckIcon className="size-3" />}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)} disabled={saving}>
        <X className="size-3" />
      </Button>
    </div>
  )
}

function ShiftCloseRowItem({
  close,
  showBranch,
  onOpeningCashSaved,
}: {
  close: ShiftCloseRow
  showBranch: boolean
  onOpeningCashSaved: (amount: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingOpening, setEditingOpening] = useState(false)
  const [openingValue, setOpeningValue] = useState('')
  const [saving, setSaving] = useState(false)

  const startEditOpening = () => {
    setOpeningValue(String(close.openingCash))
    setEditingOpening(true)
  }

  const handleSaveOpening = async () => {
    const n = Number(openingValue.replace(/[^0-9.-]/g, ''))
    if (!Number.isFinite(n) || n < 0) { toast.error('Monto inválido'); return }
    setSaving(true)
    const res = await updateShiftCloseOpeningCash(close.id, n)
    setSaving(false)
    if ('error' in res) { toast.error(res.error); return }
    onOpeningCashSaved(n)
    setEditingOpening(false)
    toast.success('Actualizado')
  }

  const counted = close.cashCounted
  const diff = close.cashDiff

  // Status pill: exacto / sobra / falta / sin contar
  const status: { label: string; cls: string; tearCls: string } = counted === null
    ? { label: 'Sin contar', cls: 'border-zinc-700/40 bg-zinc-800/40 text-zinc-400', tearCls: 'from-zinc-700/40' }
    : diff === 0
      ? { label: '✓ Exacto', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', tearCls: 'from-emerald-500/30' }
      : (diff ?? 0) > 0
        ? { label: `+${formatCurrency(diff!)}`, cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', tearCls: 'from-amber-500/30' }
        : { label: `−${formatCurrency(Math.abs(diff!))}`, cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300', tearCls: 'from-rose-500/30' }

  return (
    <div className="relative rounded-xl border border-white/[0.06] bg-zinc-950/40 overflow-hidden">
      {/* Tear-edge accent */}
      <span className={`absolute left-0 top-0 h-full w-[3px] bg-gradient-to-b ${status.tearCls} via-transparent to-transparent`} />

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 pl-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-800/80 text-[10px] font-bold text-zinc-300">
          {getInitials(close.staffName) || '?'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">{close.staffName}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {showBranch && <>{close.branchName} · </>}
            {close.totalCuts} corte{close.totalCuts === 1 ? '' : 's'}
            {' · '}
            {new Date(close.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right hidden min-[420px]:block">
            <p className="text-[10px] text-muted-foreground leading-none">Esperado</p>
            <p className="text-sm font-bold tabular-nums text-zinc-200">{formatCurrency(close.cashExpected)}</p>
          </div>
          <ChevronDown className={`size-4 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        {/* Status pill — segunda fila en mobile chico (con esperado inline), inline en >=420px */}
        <div className="col-span-2 col-start-2 flex items-center justify-between gap-2 min-[420px]:col-span-3 min-[420px]:col-start-1 min-[420px]:justify-end">
          <span className="text-[10px] text-muted-foreground min-[420px]:hidden">
            Esperado <span className="font-bold tabular-nums text-zinc-200">{formatCurrency(close.cashExpected)}</span>
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${status.cls}`}>
            {status.label}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.05] bg-zinc-950/60 px-4 py-3 pl-5 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Wallet className="size-3" />Vuelto inicial
              </span>
              {editingOpening ? (
                <span className="inline-flex items-center gap-1">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={openingValue}
                    onChange={(e) => setOpeningValue(e.target.value.replace(/[^0-9]/g, ''))}
                    className="h-6 w-20 text-xs tabular-nums"
                    autoFocus
                  />
                  <Button size="sm" className="h-6 px-1.5" onClick={handleSaveOpening} disabled={saving}>
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <CheckIcon className="size-3" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setEditingOpening(false)} disabled={saving}>
                    <X className="size-3" />
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={startEditOpening}
                  className="inline-flex items-center gap-1 font-medium tabular-nums hover:text-amber-300 transition-colors"
                >
                  {formatCurrency(close.openingCash)}
                  <Pencil className="size-2.5 opacity-50" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Banknote className="size-3" />Cobros efectivo
              </span>
              <span className="font-medium tabular-nums">{formatCurrency(close.cashTotal)}</span>
            </div>
            {close.tipsCash > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Propinas efectivo</span>
                <span className="font-medium tabular-nums">{formatCurrency(close.tipsCash)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Esperado</span>
              <span className="font-bold tabular-nums">{formatCurrency(close.cashExpected)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Contado</span>
              <span className="font-medium tabular-nums">
                {counted === null ? <span className="text-muted-foreground italic">no informado</span> : formatCurrency(counted)}
              </span>
            </div>
            {counted !== null && diff !== null && diff !== 0 && (
              <div className={`col-span-2 flex items-center gap-2 rounded-lg border px-2 py-1.5 ${diff > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  {diff > 0 ? `Sobra ${formatCurrency(diff)}` : `Falta ${formatCurrency(Math.abs(diff))}`}
                </span>
              </div>
            )}
          </div>
          {close.notes && (
            <div className="rounded-lg border border-white/[0.06] bg-zinc-900/60 p-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nota del barbero</p>
              <p className="mt-0.5 text-zinc-300">{close.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
