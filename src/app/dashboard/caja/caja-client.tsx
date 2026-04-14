'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  DollarSign,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Receipt,
  Clock,
  User,
  Scissors,
  Package,
  Filter,
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
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency } from '@/lib/format'
import { exportCSV } from '@/lib/export'
import {
  fetchCajaTickets,
  fetchCajaSummary,
  fetchCajaCSVData,
  type CajaTicket,
  type CajaDailySummary,
} from '@/lib/actions/caja'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BranchRow { id: string; name: string }
interface BarberRow { id: string; full_name: string; branch_id: string | null }
interface AccountRow { id: string; name: string; branch_id: string }

interface CajaClientProps {
  initialTickets: CajaTicket[]
  initialSummary: CajaDailySummary
  initialDate: string
  branches: BranchRow[]
  barbers: BarberRow[]
  accounts: AccountRow[]
}

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

// ─── Componente principal ─────────────────────────────────────────────────────

export function CajaClient({
  initialTickets,
  initialSummary,
  initialDate,
  branches,
  barbers,
  accounts,
}: CajaClientProps) {
  // Estado principal
  const [tickets, setTickets] = useState<CajaTicket[]>(initialTickets)
  const [summary, setSummary] = useState<CajaDailySummary>(initialSummary)
  const [date, setDate] = useState(initialDate)
  const [loading, setLoading] = useState(false)

  // Filtros
  const [filterBarber, setFilterBarber] = useState<string>('all')
  const [filterPayment, setFilterPayment] = useState<string>('all')

  // Expandir tickets
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set())

  // Export panel
  const [showExport, setShowExport] = useState(false)
  const [exportStartDate, setExportStartDate] = useState(initialDate)
  const [exportEndDate, setExportEndDate] = useState(initialDate)
  const [exportBarberIds, setExportBarberIds] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  // Branch store — refrescar al cambiar sucursal
  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const prevBranchRef = useRef(selectedBranchId)
  useEffect(() => {
    if (prevBranchRef.current !== selectedBranchId) {
      prevBranchRef.current = selectedBranchId
      refresh()
    }
  }, [selectedBranchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtrar barberos y cuentas por sucursal
  const filteredBarbers = useMemo(() => {
    if (!selectedBranchId) return barbers
    return barbers.filter(b => b.branch_id === selectedBranchId)
  }, [barbers, selectedBranchId])

  const filteredAccounts = useMemo(() => {
    if (!selectedBranchId) return accounts
    return accounts.filter(a => a.branch_id === selectedBranchId)
  }, [accounts, selectedBranchId])

  // Refrescar datos
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

  // Tickets filtrados localmente
  const filteredTickets = useMemo(() => {
    let result = tickets
    if (filterBarber !== 'all') {
      result = result.filter(t => t.barberId === filterBarber)
    }
    if (filterPayment !== 'all') {
      if (filterPayment === 'cash' || filterPayment === 'card' || filterPayment === 'transfer') {
        result = result.filter(t => t.paymentMethod === filterPayment)
      } else {
        // Es un account ID
        result = result.filter(t => t.paymentAccountName && accounts.find(a => a.id === filterPayment)?.name === t.paymentAccountName)
      }
    }
    return result
  }, [tickets, filterBarber, filterPayment, accounts])

  // Toggle ticket expandido
  const toggleTicket = (id: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Toggle barbero para export
  const toggleExportBarber = (id: string) => {
    setExportBarberIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllBarbers = () => {
    setExportBarberIds(new Set(filteredBarbers.map(b => b.id)))
  }

  const clearAllBarbers = () => {
    setExportBarberIds(new Set())
  }

  // Exportar CSV
  const handleExport = async () => {
    setExporting(true)
    try {
      const { data, error } = await fetchCajaCSVData({
        branchId: selectedBranchId,
        startDate: exportStartDate,
        endDate: exportEndDate,
        barberIds: Array.from(exportBarberIds),
      })
      if (error) {
        toast.error(error)
        return
      }
      if (data.length === 0) {
        toast.info('No hay datos para exportar en el rango seleccionado')
        return
      }

      const headers = ['Fecha', 'Hora', 'Cliente', 'Telefono', 'Barbero', 'Monto', 'Metodo de Pago', 'Cuenta']
      const rows = data.map(r => [
        r.fecha,
        r.hora,
        r.cliente,
        r.telefono,
        r.barbero,
        r.monto,
        r.metodoPago,
        r.cuenta,
      ])

      const filename = `caja-${exportStartDate}-a-${exportEndDate}`
      exportCSV(headers, rows, filename)
      toast.success('CSV exportado correctamente')
    } catch {
      toast.error('Error al exportar')
    } finally {
      setExporting(false)
    }
  }

  // Totales filtrados para mostrar resumen coherente con filtros
  const filteredTotals = useMemo(() => {
    let cash = 0, card = 0, transfer = 0
    for (const t of filteredTickets) {
      switch (t.paymentMethod) {
        case 'cash': cash += t.amount; break
        case 'card': card += t.amount; break
        case 'transfer': transfer += t.amount; break
      }
    }
    return { cash, card, transfer, total: cash + card + transfer, count: filteredTickets.length }
  }, [filteredTickets])

  const hasActiveFilters = filterBarber !== 'all' || filterPayment !== 'all'

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg lg:text-xl font-bold tracking-tight">Caja del dia</h2>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Resumen de cobros, desglose por ticket y exportacion de reportes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-[160px] h-9 text-sm"
            />
            <BranchSelector branches={branches} />
          </div>
        </div>

        {/* ── Filtros ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="size-3.5" />
            Filtros:
          </div>
          <Select value={filterBarber} onValueChange={setFilterBarber}>
            <SelectTrigger className="w-[170px] h-8 text-xs">
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
            <SelectTrigger className="w-[170px] h-8 text-xs">
              <SelectValue placeholder="Todos los pagos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los pagos</SelectItem>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="card">Tarjeta</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
              {filteredAccounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setFilterBarber('all'); setFilterPayment('all') }}>
              Limpiar filtros
            </Button>
          )}
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setShowExport(!showExport)}
            >
              <Download className="size-3.5" />
              Exportar CSV
            </Button>
          </div>
        </div>
      </div>

      {/* ── Contenido scrolleable ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 lg:gap-3">
          <SummaryCard
            label="Efectivo en caja"
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
          {!hasActiveFilters && summary.accounts.map(acc => (
            <SummaryCard
              key={acc.accountId}
              label={acc.accountName}
              value={acc.total}
              icon={<ArrowRightLeft className="size-4 text-violet-400" />}
              color="violet"
            />
          ))}
          <SummaryCard
            label="Total del dia"
            value={hasActiveFilters ? filteredTotals.total : summary.totalRevenue}
            subtitle={`${hasActiveFilters ? filteredTotals.count : summary.ticketCount} tickets`}
            icon={<DollarSign className="size-4 text-amber-400" />}
            color="amber"
            highlight
          />
        </div>

        {/* ── Panel de exportacion ── */}
        {showExport && (
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Download className="size-4" />
              Exportar reporte CSV
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha desde</Label>
                <Input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha hasta</Label>
                <Input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Barberos</Label>
                  <div className="flex gap-2">
                    <button type="button" onClick={selectAllBarbers} className="text-[11px] text-blue-400 hover:underline">
                      Todos
                    </button>
                    <button type="button" onClick={clearAllBarbers} className="text-[11px] text-muted-foreground hover:underline">
                      Ninguno
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto rounded-lg border border-zinc-800 p-2">
                  {filteredBarbers.map(b => (
                    <label key={b.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={exportBarberIds.has(b.id)}
                        onCheckedChange={() => toggleExportBarber(b.id)}
                        className="size-3.5"
                      />
                      {b.full_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleExport}
                disabled={exporting}
              >
                <Download className="size-3.5" />
                {exporting ? 'Exportando...' : 'Descargar CSV'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Efectivo por barbero ── */}
        {!hasActiveFilters && <BarberCashBreakdown tickets={tickets} barbers={filteredBarbers} />}

        {/* ── Lista de tickets ── */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold flex items-center gap-2 px-1">
            <Receipt className="size-4" />
            Tickets del dia
            <span className="text-xs font-normal text-muted-foreground">
              ({filteredTickets.length})
            </span>
          </h3>

          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Cargando...
            </div>
          )}

          {!loading && filteredTickets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <Receipt className="size-8 opacity-30" />
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
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

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
      {/* Header del ticket */}
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
          {hasDetails ? (
            isExpanded ? <ChevronDown className="size-4 text-zinc-400" /> : <ChevronRight className="size-4 text-zinc-400" />
          ) : (
            <Receipt className="size-4 text-zinc-500" />
          )}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] items-center gap-x-3 gap-y-0.5">
          {/* Cliente + Barbero */}
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{ticket.clientName}</p>
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
              <Scissors className="size-3 inline shrink-0" />
              {ticket.barberName}
            </p>
          </div>

          {/* Pago + Hora */}
          <div className="hidden sm:flex flex-col items-start min-w-0">
            {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Clock className="size-3 inline" />
              {formatTime(ticket.completedAt)}
            </p>
          </div>

          {/* Monto */}
          <div className="text-right">
            <p className="text-sm font-bold text-zinc-100">{formatCurrency(ticket.amount)}</p>
            <div className="sm:hidden mt-0.5">
              {paymentBadge(ticket.paymentMethod, ticket.paymentAccountName)}
            </div>
          </div>
        </div>
      </button>

      {/* Detalle expandido */}
      {isExpanded && hasDetails && (
        <div className="border-t border-zinc-800/60 px-4 py-3 space-y-2 bg-zinc-950/40">
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
        </div>
      )}
    </div>
  )
}

// ─── Efectivo por barbero (mini tabla) ────────────────────────────────────────

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
    // Solo mostrar barberos con efectivo
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
