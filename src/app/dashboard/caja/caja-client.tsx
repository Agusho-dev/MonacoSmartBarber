'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  DollarSign,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
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
import {
  fetchCajaTickets,
  fetchCajaSummary,
  fetchCajaCSVData,
  type CajaTicket,
  type CajaDailySummary,
  type CajaCSVRow,
} from '@/lib/actions/caja'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BranchRow { id: string; name: string }
interface BarberRow { id: string; full_name: string; branch_id: string | null }
interface AccountRow { id: string; name: string; branch_id: string; is_salary_account?: boolean }

interface CajaClientProps {
  initialTickets: CajaTicket[]
  initialSummary: CajaDailySummary
  initialDate: string
  branches: BranchRow[]
  barbers: BarberRow[]
  accounts: AccountRow[]
}

// "all" | "cash" | "card" | `acct:<accountId>`
type PaymentFilter = string

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paymentBadge(method: string, accountName: string | null) {
  switch (method) {
    case 'cash':
      return <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Banknote className="size-3" />Efectivo</Badge>
    case 'card':
      return <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/10 text-blue-400"><CreditCard className="size-3" />Tarjeta</Badge>
    case 'transfer':
      return <Badge variant="outline" className="gap-1 border-violet-500/30 bg-violet-500/10 text-violet-400"><ArrowRightLeft className="size-3" />{accountName ?? 'Transferencia'}</Badge>
    default:
      return <Badge variant="outline">{method}</Badge>
  }
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
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

// ─── Componente principal ─────────────────────────────────────────────────────

export function CajaClient({
  initialTickets,
  initialSummary,
  initialDate,
  branches,
  barbers,
  accounts,
}: CajaClientProps) {
  const [tickets, setTickets] = useState<CajaTicket[]>(initialTickets)
  const [summary, setSummary] = useState<CajaDailySummary>(initialSummary)
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
      const [ticketRes, summaryRes] = await Promise.all([
        fetchCajaTickets({ branchId: selectedBranchId, date: d }),
        fetchCajaSummary({ branchId: selectedBranchId, date: d }),
      ])
      if (ticketRes.data) setTickets(ticketRes.data)
      if (summaryRes.data) setSummary(summaryRes.data)
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
    return {
      cash,
      card,
      accounts: Array.from(byAccount.entries()).map(([id, v]) => ({ accountId: id, accountName: v.name, total: v.total })),
      total: cash + card + Array.from(byAccount.values()).reduce((s, a) => s + a.total, 0),
      count: filteredTickets.length,
    }
  }, [filteredTickets])

  const hasActiveFilters = filterBarber !== 'all' || filterPayment !== 'all'

  // ── Etiqueta legible del filtro de pago ──
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

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-3 border-b border-zinc-800/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg lg:text-xl font-bold tracking-tight">Caja del dia</h2>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Tickets, cobros y reportes del dia seleccionado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-[160px] h-9 text-sm pl-8"
              />
            </div>
            <BranchSelector branches={branches} />
          </div>
        </div>

        {/* ── Filtros compactos ── */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterBarber} onValueChange={setFilterBarber}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
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
            <SelectTrigger className="w-[190px] h-8 text-xs">
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
              className="h-8 text-xs px-2 gap-1"
              onClick={() => { setFilterBarber('all'); setFilterPayment('all') }}
            >
              <X className="size-3" />
              Limpiar
            </Button>
          )}

          {/* Chips de filtros activos */}
          {barberFilterLabel && (
            <Badge variant="secondary" className="h-6 text-[11px] gap-1">
              <User className="size-3" />{barberFilterLabel}
              <button type="button" onClick={() => setFilterBarber('all')} className="ml-0.5 hover:text-red-400"><X className="size-3" /></button>
            </Badge>
          )}
          {paymentFilterLabel && (
            <Badge variant="secondary" className="h-6 text-[11px] gap-1">
              <DollarSign className="size-3" />{paymentFilterLabel}
              <button type="button" onClick={() => setFilterPayment('all')} className="ml-0.5 hover:text-red-400"><X className="size-3" /></button>
            </Badge>
          )}

          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setShowExport(true)}
            >
              <Download className="size-3.5" />
              Exportar
            </Button>
          </div>
        </div>
      </div>

      {/* ── Contenido scrolleable ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── Summary cards ── */}
        <SummaryCards
          hasActiveFilters={hasActiveFilters}
          filteredTotals={filteredTotals}
          summary={summary}
        />

        {/* ── Efectivo por barbero (solo sin filtros) ── */}
        {!hasActiveFilters && <BarberCashBreakdown tickets={tickets} barbers={filteredBarbers} />}

        {/* ── Lista de tickets ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Receipt className="size-4" />
              Tickets
              <span className="text-xs font-normal text-muted-foreground">
                ({filteredTickets.length})
              </span>
            </h3>
            {hasActiveFilters && (
              <span className="text-[11px] text-muted-foreground">
                Mostrando tickets filtrados de {tickets.length} del dia
              </span>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin" />
              Cargando...
            </div>
          )}

          {!loading && filteredTickets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-2">
              <Receipt className="size-10 opacity-20" />
              No hay tickets para los filtros seleccionados
            </div>
          )}

          {!loading && filteredTickets.map(ticket => (
            <TicketRow
              key={ticket.visitId}
              ticket={ticket}
              isExpanded={expandedTickets.has(ticket.visitId)}
              onToggle={() => toggleTicket(ticket.visitId)}
            />
          ))}
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

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  hasActiveFilters,
  filteredTotals,
  summary,
}: {
  hasActiveFilters: boolean
  filteredTotals: {
    cash: number
    card: number
    accounts: { accountId: string; accountName: string; total: number }[]
    total: number
    count: number
  }
  summary: CajaDailySummary
}) {
  // Cuando hay filtros, mostramos solo totales filtrados.
  // Sin filtros, mostramos el resumen global del dia (con egresos de caja).
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
      <SummaryCard
        label={hasActiveFilters ? 'Efectivo (filtro)' : 'Efectivo en caja'}
        value={hasActiveFilters ? filteredTotals.cash : summary.totalCash - summary.cashExpenses}
        subtitle={!hasActiveFilters && summary.cashExpenses > 0 ? `Egresos: ${formatCurrency(summary.cashExpenses)}` : undefined}
        icon={<Banknote className="size-4 text-emerald-400" />}
        color="emerald"
      />
      <SummaryCard
        label="Tarjeta"
        value={hasActiveFilters ? filteredTotals.card : summary.totalCard}
        icon={<CreditCard className="size-4 text-blue-400" />}
        color="blue"
      />
      {hasActiveFilters
        ? filteredTotals.accounts.map(acc => (
            <SummaryCard
              key={acc.accountId}
              label={acc.accountName}
              value={acc.total}
              icon={<ArrowRightLeft className="size-4 text-violet-400" />}
              color="violet"
            />
          ))
        : summary.accounts.map(acc => (
            <SummaryCard
              key={acc.accountId}
              label={acc.accountName}
              value={acc.total}
              icon={<ArrowRightLeft className="size-4 text-violet-400" />}
              color="violet"
            />
          ))}
      <SummaryCard
        label={hasActiveFilters ? 'Total filtrado' : 'Total del dia'}
        value={hasActiveFilters ? filteredTotals.total : summary.totalRevenue}
        subtitle={`${hasActiveFilters ? filteredTotals.count : summary.ticketCount} tickets`}
        icon={<DollarSign className="size-4 text-amber-400" />}
        color="amber"
        highlight
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  subtitle,
  icon,
  color,
  highlight,
}: {
  label: string
  value: number
  subtitle?: string
  icon: React.ReactNode
  color: string
  highlight?: boolean
}) {
  const borderClass = highlight ? 'border-amber-500/30' : 'border-zinc-800/80'
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${borderClass} bg-zinc-900/60 px-3 py-3`}>
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-${color}-500/15`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground leading-none truncate">{label}</p>
        <p className="text-lg font-bold leading-tight text-zinc-100">{formatCurrency(value)}</p>
        {subtitle && <p className="text-[11px] text-muted-foreground leading-none mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

// ─── Ticket Row ───────────────────────────────────────────────────────────────

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
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden transition-colors hover:border-zinc-700/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
          {isExpanded ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] items-center gap-x-3 gap-y-0.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{ticket.clientName}</p>
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
              <Scissors className="size-3 inline shrink-0" />
              {ticket.barberName}
              <span className="mx-1 opacity-50">·</span>
              {formatTime(ticket.completedAt)}
            </p>
          </div>

          <div className="hidden sm:flex items-center">
            {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
          </div>

          <div className="text-right">
            <p className="text-sm font-bold text-zinc-100">{formatCurrency(ticket.amount)}</p>
            <div className="sm:hidden mt-0.5">
              {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
            </div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-800/60 px-4 py-3 space-y-3 bg-zinc-950/40">
          {/* Acciones rapidas */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/mensajeria?clientId=${ticket.clientId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs px-2.5 py-1 transition-colors"
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
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Servicios</p>
                  {ticket.services.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Scissors className="size-3 text-zinc-500" />
                        {s.name}
                      </span>
                      <span className="text-zinc-400">{formatCurrency(s.price)}</span>
                    </div>
                  ))}
                </div>
              )}
              {ticket.products.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Productos</p>
                  {ticket.products.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-300">
                        <Package className="size-3 text-zinc-500" />
                        {p.name} {p.quantity > 1 && <span className="text-zinc-500">x{p.quantity}</span>}
                      </span>
                      <span className="text-zinc-400">{formatCurrency(p.unitPrice * p.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="bg-zinc-800/60" />
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-zinc-400">Total</span>
                <span className="text-zinc-100">{formatCurrency(ticket.amount)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Efectivo por barbero ─────────────────────────────────────────────────────

function BarberCashBreakdown({
  tickets,
  barbers,
}: {
  tickets: CajaTicket[]
  barbers: BarberRow[]
}) {
  const cashByBarber = useMemo(() => {
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

  if (cashByBarber.length === 0) return null

  const totalCash = cashByBarber.reduce((s, b) => s + b.cash, 0)

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3 space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Banknote className="size-4 text-emerald-400" />
        Efectivo a rendir por barbero
      </h3>
      <div className="space-y-1">
        {cashByBarber.map(b => (
          <div key={b.id} className="flex items-center justify-between text-xs py-1 px-1">
            <span className="flex items-center gap-1.5 text-zinc-300">
              <User className="size-3 text-zinc-500" />
              {b.name}
            </span>
            <span className="font-medium text-emerald-400">{formatCurrency(b.cash)}</span>
          </div>
        ))}
        <Separator className="bg-zinc-800/60" />
        <div className="flex items-center justify-between text-xs font-semibold px-1">
          <span className="text-zinc-400">Total efectivo</span>
          <span className="text-emerald-400">{formatCurrency(totalCash)}</span>
        </div>
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

  // Sincronizar fechas cuando se abre el dialog
  useEffect(() => {
    if (open) {
      setStartDate(currentDate)
      setEndDate(currentDate)
      // Autoactivar split cuando el filtro por barbero es "all" y hay un filtro de cuenta especifico
      const accountFilterActive = filterPayment.startsWith('acct:') || filterPayment === 'cash' || filterPayment === 'card'
      setSplitPerBarber(filterBarber === 'all' && accountFilterActive)
    }
  }, [open, currentDate, filterBarber, filterPayment])

  // Decodificar el filtro de pago actual en parametros para el servidor
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
        // Un CSV por barbero dentro de un ZIP
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
          zip.file(`caja-${safeFilePart(name)}-${rangeLabel}-${paymentSuffix}.csv`, '\ufeff' + csv)
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        triggerDownload(blob, `caja-por-barbero-${rangeLabel}-${paymentSuffix}.zip`)
        toast.success(`ZIP generado: ${byBarber.size} barbero(s)`)
      } else {
        const csv = csvFromRows(headers, data.map(toRow))
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
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
            <FileSpreadsheet className="size-5" />
            Exportar reporte CSV
          </DialogTitle>
          <DialogDescription>
            El reporte usa los filtros que tenes aplicados actualmente. Solo se puede cambiar el rango de fechas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Filtros activos */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Filtros aplicados</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><User className="size-3" />Barbero</span>
              <span className="text-zinc-200 font-medium">{barberLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5"><DollarSign className="size-3" />Pago</span>
              <span className="text-zinc-200 font-medium">{paymentLabel}</span>
            </div>
          </div>

          {/* Rango de fechas */}
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

          {/* Split per barber */}
          {canSplit && (
            <label className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 cursor-pointer hover:border-zinc-700 transition-colors">
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
