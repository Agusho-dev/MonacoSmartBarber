'use client'

import { useState, useTransition, useEffect, useCallback, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'

// recharts (~180KB) cargado de forma lazy — solo se descarga cuando finanzas monta los gráficos
const ComposedChart = dynamic(() => import('recharts').then(m => m.ComposedChart), { ssr: false })
const Bar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false })
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false })
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false })
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false })
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false })
const PieChart = dynamic(() => import('recharts').then(m => m.PieChart), { ssr: false })
const Pie = dynamic(() => import('recharts').then(m => m.Pie), { ssr: false })
const Cell = dynamic(() => import('recharts').then(m => m.Cell), { ssr: false })
const LabelList = dynamic(() => import('recharts').then(m => m.LabelList), { ssr: false })
const ReferenceLine = dynamic(() => import('recharts').then(m => m.ReferenceLine), { ssr: false })
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import {
  fetchFinancialData,
  type FinancialSummary,
} from '@/lib/actions/finances'
import { getAllAccountBalanceTotals } from '@/lib/actions/paymentAccounts'
import { formatCurrency } from '@/lib/format'
import type { Branch, PaymentAccount, ExpenseTicket } from '@/lib/types/database'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Target,
  Scissors,
  ShoppingBag,
  Users,
  Download,
  FileText,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const PERIOD_OPTIONS = [
  { value: '1', label: '1 mes' },
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
  { value: '0', label: 'Desde el inicio' },
]

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Devuelve "YYYY-MM" desplazado `offset` meses desde hoy (0 = mes actual, 1 = mes pasado) */
function getMonthFromOffset(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`
}

const COLORS = {
  revenue: '#22d3ee',    // cyan — ingresos
  fixed: '#f87171',      // rojo — gastos fijos
  variable: '#fb923c',   // naranja — gastos variables
  commissions: '#a78bfa',// violeta — comisiones
  salaries: '#e879f9',   // fucsia — sueldos fijos
  netProfit: '#4ade80',  // verde — resultado neto
  grid: '#262626',
  axis: '#737373',
}

/** Formatea valores monetarios del eje Y con 1M / 10k para no saturar. */
function formatAxis(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`
  return `$${Math.round(v)}`
}

const PIE_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f87171', '#34d399', '#f472b6', '#818cf8', '#2dd4bf']

interface AccountWithBranch extends PaymentAccount {
  branch?: { name: string } | null
}

export interface CommissionSummaryData {
  totalPending: number
  totalPaid: number
  pendingCount: number
  paidCount: number
}

interface Props {
  initialData: FinancialSummary
  branches: Branch[]
  accounts: AccountWithBranch[]
  expenseTickets: ExpenseTicket[]
  commissionSummary: CommissionSummaryData
  orgSlug?: string
}

type AccountBalance = { id: string; name: string; balance: number; income: number; expenses: number }

export function FinanzasClient({
  initialData,
  branches,
  accounts,
  expenseTickets,
  commissionSummary,
  orgSlug = 'barberos',
}: Props) {
  const selectedBranchId = useBranchStore(s => s.selectedBranchId)
  const [data, setData] = useState(initialData)
  const [period, setPeriod] = useState('1')
  const [monthOffset, setMonthOffset] = useState(0) // 0 = mes actual, 1 = mes pasado, etc.
  const [isPending, startTransition] = useTransition()
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([])
  const [expenseAccountFilter, setExpenseAccountFilter] = useState<string>('__all__')

  // Estado de visibilidad de series del gráfico principal
  const [visibleSeries, setVisibleSeries] = useState({
    revenue: true,
    fixedExpenses: true,
    variableExpenses: true,
    commissions: true,
    baseSalaryPaid: true,
    netProfit: true,
  })

  const toggleSeries = (key: keyof typeof visibleSeries) => {
    setVisibleSeries(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const refresh = useCallback(
    (p?: string, offset?: number) => {
      const months = Number(p ?? period)
      const currentOffset = offset ?? monthOffset
      // Solo pasar endMonth cuando estamos en modo 1 mes y hay offset
      const endMonth = months === 1 ? getMonthFromOffset(currentOffset) : null
      startTransition(async () => {
        const [newData, newBalances] = await Promise.all([
          fetchFinancialData(months, selectedBranchId, endMonth),
          getAllAccountBalanceTotals(selectedBranchId),
        ])
        setData(newData)
        setAccountBalances(newBalances)
      })
    },
    [period, monthOffset, selectedBranchId]
  )

  // Evitar re-fetch duplicado en el primer render (los datos ya vienen del server)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  const handlePeriodChange = (v: string) => {
    setPeriod(v)
    if (v !== '1') setMonthOffset(0)
    refresh(v, v === '1' ? monthOffset : 0)
  }

  const handleMonthNav = (direction: 'prev' | 'next') => {
    const newOffset = direction === 'prev' ? monthOffset + 1 : monthOffset - 1
    if (newOffset < 0) return // No ir al futuro
    setMonthOffset(newOffset)
    refresh('1', newOffset)
  }

  const expensesByCategory = useMemo(() => {
    let filtered = expenseTickets
    if (expenseAccountFilter !== '__all__') {
      if (expenseAccountFilter === '__cash__') {
        filtered = filtered.filter(t => !t.payment_account_id)
      } else {
        filtered = filtered.filter(t => t.payment_account_id === expenseAccountFilter)
      }
    }

    const branchFiltered = selectedBranchId
      ? filtered.filter(t => t.branch_id === selectedBranchId)
      : filtered

    const map = new Map<string, number>()
    for (const t of branchFiltered) {
      map.set(t.category, (map.get(t.category) ?? 0) + Number(t.amount))
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [expenseTickets, expenseAccountFilter, selectedBranchId])

  const filteredAccounts = useMemo(() => {
    if (!selectedBranchId) return accounts
    return accounts.filter(a => a.branch_id === selectedBranchId)
  }, [accounts, selectedBranchId])

  const { totals, breakEven } = data
  const isPositive = totals.netProfit >= 0

  // Enriquecer cada mes con totales derivados: costos totales y margen neto %,
  // para que el dueño vea de un vistazo "cuánto entra vs cuánto se va" y la
  // rentabilidad, sin tener que hacer la cuenta de cabeza.
  const chartMonths = data.months.map((m, i) => {
    const totalCosts =
      m.fixedExpenses + m.variableExpenses + m.commissions + m.baseSalaryPaid
    const marginPct = m.revenue > 0 ? Math.round((m.netProfit / m.revenue) * 100) : 0
    return {
      ...m,
      prevRevenue: i > 0 ? data.months[i - 1].revenue : -1,
      totalCosts,
      marginPct,
    }
  })

  const balancePieData = accountBalances.filter(a => a.balance > 0)
  const totalExpensesPie = expensesByCategory.reduce((s, e) => s + e.amount, 0)

  // Cálculo de progreso del mes actual hacia el break-even
  const progressPct = breakEven.cutsNeeded > 0
    ? Math.min(100, Math.round((data.currentMonthCuts / breakEven.cutsNeeded) * 100))
    : 0

  // Escapar campo CSV: envolver en comillas si contiene coma, comillas o salto de línea
  function csvField(val: string | number): string {
    const s = String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  function formatAmountCSV(n: number): string {
    // Formato con separador de miles y dos decimales, usando coma como decimal
    return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Nombre del período actual para la cabecera del reporte
  const reportPeriodLabel = useMemo(() => {
    if (period === '1') return formatMonthLabel(getMonthFromOffset(monthOffset))
    const opt = PERIOD_OPTIONS.find(o => o.value === period)
    return opt?.label ?? `${period} meses`
  }, [period, monthOffset])

  const branchLabel = useMemo(() => {
    if (!selectedBranchId) return 'Todas las sucursales'
    return branches.find(b => b.id === selectedBranchId)?.name ?? 'Sucursal'
  }, [selectedBranchId, branches])

  // CSV multi-sección legible con BOM + metadata + totales
  function exportToCSV() {
    const sep = ';' // Excel ES reconoce ; como delimitador
    const eol = '\r\n'
    const lines: string[] = []

    const row = (...cells: (string | number)[]) => lines.push(cells.map(c => csvField(c)).join(sep))

    // Cabecera
    row('Reporte financiero BarberOS')
    row('Generado', new Date().toLocaleString('es-AR'))
    row('Período', reportPeriodLabel)
    row('Sucursal', branchLabel)
    lines.push('')

    // Resumen totales
    row('RESUMEN DEL PERÍODO')
    row('Métrica', 'Valor')
    row('Ingresos brutos', formatAmountCSV(totals.revenue))
    row('Gastos fijos', formatAmountCSV(totals.fixedExpenses))
    row('Gastos variables', formatAmountCSV(totals.variableExpenses))
    row('Comisiones', formatAmountCSV(totals.commissions))
    row('Sueldos fijos pagados', formatAmountCSV(totals.salaryPayments ?? 0))
    row('Resultado neto', formatAmountCSV(totals.netProfit))
    row('Cortes', totals.cuts)
    row('Ticket promedio', formatAmountCSV(breakEven.avgRevenuePerCut))
    row('Comisiones pendientes', formatAmountCSV(commissionSummary.totalPending))
    row('Comisiones pagadas', formatAmountCSV(commissionSummary.totalPaid))
    lines.push('')

    // Punto de equilibrio
    row('PUNTO DE EQUILIBRIO')
    row('Cortes necesarios por mes', breakEven.cutsNeeded)
    row('Cortes del mes en curso', data.currentMonthCuts)
    row('Ticket promedio', formatAmountCSV(breakEven.avgRevenuePerCut))
    row('Comisión promedio/corte', formatAmountCSV(breakEven.avgCommissionPerCut))
    row('Ganancia neta/corte', formatAmountCSV(breakEven.netPerCut))
    row('Gastos fijos mensuales', formatAmountCSV(breakEven.monthlyFixedExpenses))
    lines.push('')

    // Evolución mensual
    row('EVOLUCIÓN MENSUAL')
    row('Mes', 'Ingresos', 'Gastos fijos', 'Gastos variables', 'Comisiones', 'Sueldos fijos', 'Resultado neto', 'Cortes')
    for (const m of data.months) {
      row(
        m.label,
        formatAmountCSV(m.revenue),
        formatAmountCSV(m.fixedExpenses),
        formatAmountCSV(m.variableExpenses),
        formatAmountCSV(m.commissions),
        formatAmountCSV(m.baseSalaryPaid ?? 0),
        formatAmountCSV(m.netProfit),
        m.cuts,
      )
    }
    lines.push('')

    // Saldos por cuenta
    if (accountBalances.length > 0) {
      row('SALDOS POR CUENTA')
      row('Cuenta', 'Ingresos', 'Egresos', 'Saldo')
      for (const a of accountBalances) {
        row(a.name, formatAmountCSV(a.income), formatAmountCSV(a.expenses), formatAmountCSV(a.balance))
      }
      lines.push('')
    }

    // Egresos por categoría
    if (expensesByCategory.length > 0) {
      row('EGRESOS POR CATEGORÍA')
      row('Categoría', 'Monto')
      for (const e of expensesByCategory) row(e.category, formatAmountCSV(e.amount))
      row('Total', formatAmountCSV(expensesByCategory.reduce((s, e) => s + e.amount, 0)))
      lines.push('')
    }

    // Rendimiento por barbero
    if (data.barberPerformance.length > 0) {
      row('RENDIMIENTO POR BARBERO')
      row('Barbero', 'Cortes', 'Ticket promedio', 'Ingresos', 'Comisión', 'Margen neto', '% Margen')
      for (const b of data.barberPerformance) {
        row(
          b.name,
          b.cuts,
          formatAmountCSV(b.avgTicket),
          formatAmountCSV(b.revenue),
          formatAmountCSV(b.commissions),
          formatAmountCSV(b.netContribution),
          `${b.marginPct}%`,
        )
      }
      lines.push('')
    }

    // Ingresos por servicio
    if (data.serviceRevenue.length > 0) {
      row('INGRESOS POR SERVICIO')
      row('Servicio', 'Cortes', 'Ticket promedio', 'Ingresos')
      for (const s of data.serviceRevenue) {
        row(s.serviceName, s.cuts, formatAmountCSV(s.avgTicket), formatAmountCSV(s.revenue))
      }
    }

    const csvContent = '\ufeff' + lines.join(eol)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finanzas_${orgSlug}_${period}meses.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // PDF multi-sección usando jsPDF + autotable
  async function exportToPDF() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF()
    let y = 14

    doc.setFontSize(16)
    doc.text('Reporte Financiero BarberOS', 14, y)
    y += 7
    doc.setFontSize(9)
    doc.setTextColor(100)
    doc.text(`Período: ${reportPeriodLabel}`, 14, y)
    y += 5
    doc.text(`Sucursal: ${branchLabel}`, 14, y)
    y += 5
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, 14, y)
    y += 6
    doc.setTextColor(0)

    // Resumen
    autoTable(doc, {
      startY: y,
      head: [['Métrica', 'Valor']],
      body: [
        ['Ingresos brutos', formatCurrency(totals.revenue)],
        ['Gastos fijos', formatCurrency(totals.fixedExpenses)],
        ['Gastos variables', formatCurrency(totals.variableExpenses)],
        ['Comisiones', formatCurrency(totals.commissions)],
        ['Sueldos fijos pagados', formatCurrency(totals.salaryPayments ?? 0)],
        ['Resultado neto', formatCurrency(totals.netProfit)],
        ['Cortes', String(totals.cuts)],
        ['Ticket promedio', formatCurrency(breakEven.avgRevenuePerCut)],
        ['Comisiones pendientes', formatCurrency(commissionSummary.totalPending)],
        ['Comisiones pagadas', formatCurrency(commissionSummary.totalPaid)],
      ],
      theme: 'grid',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: 14, right: 14 },
    })
    // @ts-expect-error lastAutoTable
    y = (doc.lastAutoTable?.finalY ?? y) + 8

    // Evolución mensual
    if (data.months.length > 0) {
      doc.setFontSize(12)
      doc.text('Evolución mensual', 14, y)
      y += 2
      autoTable(doc, {
        startY: y + 2,
        head: [['Mes', 'Ingresos', 'G. fijos', 'G. var.', 'Comis.', 'Sueldos', 'Neto', 'Cortes']],
        body: data.months.map(m => [
          m.label,
          formatCurrency(m.revenue),
          formatCurrency(m.fixedExpenses),
          formatCurrency(m.variableExpenses),
          formatCurrency(m.commissions),
          formatCurrency(m.baseSalaryPaid ?? 0),
          formatCurrency(m.netProfit),
          String(m.cuts),
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 40, 40] },
        margin: { left: 14, right: 14 },
      })
      // @ts-expect-error lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 8
    }

    // Saldos por cuenta
    if (accountBalances.length > 0) {
      doc.setFontSize(12)
      doc.text('Saldos por cuenta', 14, y)
      autoTable(doc, {
        startY: y + 2,
        head: [['Cuenta', 'Ingresos', 'Egresos', 'Saldo']],
        body: accountBalances.map(a => [
          a.name,
          formatCurrency(a.income),
          formatCurrency(a.expenses),
          formatCurrency(a.balance),
        ]),
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [40, 40, 40] },
        margin: { left: 14, right: 14 },
      })
      // @ts-expect-error lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 8
    }

    // Egresos por categoría
    if (expensesByCategory.length > 0) {
      doc.setFontSize(12)
      doc.text('Egresos por categoría', 14, y)
      autoTable(doc, {
        startY: y + 2,
        head: [['Categoría', 'Monto']],
        body: expensesByCategory.map(e => [e.category, formatCurrency(e.amount)]),
        foot: [['Total', formatCurrency(expensesByCategory.reduce((s, e) => s + e.amount, 0))]],
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [40, 40, 40] },
        footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      })
      // @ts-expect-error lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 8
    }

    // Rendimiento por barbero
    if (data.barberPerformance.length > 0) {
      if (y > 230) { doc.addPage(); y = 14 }
      doc.setFontSize(12)
      doc.text('Rendimiento por barbero', 14, y)
      autoTable(doc, {
        startY: y + 2,
        head: [['Barbero', 'Cortes', 'Ticket', 'Ingresos', 'Comisión', 'Neto', '% Margen']],
        body: data.barberPerformance.map(b => [
          b.name,
          String(b.cuts),
          formatCurrency(b.avgTicket),
          formatCurrency(b.revenue),
          formatCurrency(b.commissions),
          formatCurrency(b.netContribution),
          `${b.marginPct}%`,
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 40, 40] },
        margin: { left: 14, right: 14 },
      })
      // @ts-expect-error lastAutoTable
      y = (doc.lastAutoTable?.finalY ?? y) + 8
    }

    // Ingresos por servicio
    if (data.serviceRevenue.length > 0) {
      if (y > 230) { doc.addPage(); y = 14 }
      doc.setFontSize(12)
      doc.text('Ingresos por servicio', 14, y)
      autoTable(doc, {
        startY: y + 2,
        head: [['Servicio', 'Cortes', 'Ticket promedio', 'Ingresos']],
        body: data.serviceRevenue.map(s => [
          s.serviceName,
          String(s.cuts),
          formatCurrency(s.avgTicket),
          formatCurrency(s.revenue),
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 40, 40] },
        margin: { left: 14, right: 14 },
      })
    }

    doc.save(`finanzas_${orgSlug}_${period}meses.pdf`)
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg lg:text-2xl font-bold tracking-tight">Resumen financiero</h2>
        <div className="flex flex-wrap items-center gap-2">
          <BranchSelector branches={branches} />
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {period === '1' && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" onClick={() => handleMonthNav('prev')}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[130px] text-center text-sm font-medium">
                {formatMonthLabel(getMonthFromOffset(monthOffset))}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => handleMonthNav('next')}
                disabled={monthOffset === 0}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-1.5 size-3.5" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportToPDF}>
                <FileText className="mr-2 size-4" />
                Reporte PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToCSV}>
                <FileSpreadsheet className="mr-2 size-4" />
                Reporte CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-4">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      <div className={isPending ? 'pointer-events-none opacity-50' : ''}>
        {/* Tarjetas de resumen */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SummaryCard
            title="Ingresos brutos"
            value={formatCurrency(totals.revenue)}
            icon={DollarSign}
            subtitle={`${totals.cuts} cortes`}
            momChange={data.momChange.revenue}
          />
          <SummaryCard
            title="Gastos fijos"
            value={formatCurrency(totals.fixedExpenses)}
            icon={Receipt}
            subtitle={`${formatCurrency(breakEven.monthlyFixedExpenses)}/mes`}
          />
          <SummaryCard
            title="Gastos variables"
            value={formatCurrency(totals.variableExpenses)}
            icon={ShoppingBag}
            subtitle="Egresos del período"
            momChange={data.momChange.variableExpenses}
          />
          <SummaryCard
            title="Comisiones"
            value={formatCurrency(totals.commissions)}
            icon={Scissors}
            subtitle={`${formatCurrency(breakEven.avgCommissionPerCut)} promedio/corte`}
          />
          <SummaryCard
            title="Comisiones por pagar"
            value={formatCurrency(commissionSummary.totalPending)}
            icon={Users}
            subtitle={`${commissionSummary.pendingCount} reportes pendientes · ${formatCurrency(commissionSummary.totalPaid)} pagadas`}
          />
          <SummaryCard
            title="Resultado neto"
            value={formatCurrency(totals.netProfit)}
            icon={isPositive ? TrendingUp : TrendingDown}
            subtitle={isPositive ? 'Ganancia' : 'Pérdida'}
            highlight={isPositive ? 'positive' : 'negative'}
            momChange={data.momChange.netProfit}
          />
        </div>

        {/* Gráfico principal — Ingresos vs. Costos stackeados + línea de Resultado.
            Pensado para que el dueño lea de un vistazo: cuánto entra, cuánto se
            va (y por qué), y cuánto queda en el bolsillo cada mes. */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Evolución financiera mensual</CardTitle>
            <CardDescription>
              Ingresos vs. costos operativos · resultado neto del mes
            </CardDescription>
          </CardHeader>
          {/* Toggles agrupados por categoría para que se entienda que los 4
              gastos suman dentro de la barra de "Costos" stackeada. */}
          <div className="flex flex-col gap-2 px-6 pb-3 md:flex-row md:flex-wrap md:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <SeriesToggle
                active={visibleSeries.revenue}
                color={COLORS.revenue}
                label="Ingresos"
                onClick={() => toggleSeries('revenue')}
              />
              <SeriesToggle
                active={visibleSeries.netProfit}
                color={COLORS.netProfit}
                label="Resultado neto"
                onClick={() => toggleSeries('netProfit')}
              />
            </div>
            <div className="hidden h-5 w-px bg-border md:block" />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Costos:
              </span>
              <SeriesToggle
                active={visibleSeries.fixedExpenses}
                color={COLORS.fixed}
                label="Fijos"
                onClick={() => toggleSeries('fixedExpenses')}
              />
              <SeriesToggle
                active={visibleSeries.variableExpenses}
                color={COLORS.variable}
                label="Variables"
                onClick={() => toggleSeries('variableExpenses')}
              />
              <SeriesToggle
                active={visibleSeries.commissions}
                color={COLORS.commissions}
                label="Comisiones"
                onClick={() => toggleSeries('commissions')}
              />
              <SeriesToggle
                active={visibleSeries.baseSalaryPaid}
                color={COLORS.salaries}
                label="Sueldos"
                onClick={() => toggleSeries('baseSalaryPaid')}
              />
            </div>
          </div>
          <CardContent>
            {data.months.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center md:h-[350px]">
                <p className="text-sm text-muted-foreground">
                  Sin datos para el período
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320} className="md:!h-[400px]">
                <ComposedChart
                  data={chartMonths}
                  barGap={8}
                  barCategoryGap="25%"
                  margin={{ top: 28, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={COLORS.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: COLORS.axis, fontSize: 12, fontWeight: 600 }}
                    axisLine={{ stroke: COLORS.grid }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: COLORS.axis, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatAxis(v)}
                    width={56}
                  />
                  <Tooltip
                    content={<FinanceTooltip />}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  {/* Línea de break-even visual. Si el Resultado está debajo
                      del 0, es mes en rojo; si está arriba, mes en verde. */}
                  <ReferenceLine
                    y={0}
                    stroke={COLORS.axis}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                  />

                  {/* Barra 1: Ingresos (sólida, una sola pieza). */}
                  {visibleSeries.revenue && (
                    <Bar
                      dataKey="revenue"
                      name="Ingresos"
                      fill={COLORS.revenue}
                      stackId="ingresos"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={72}
                      animationDuration={800}
                    />
                  )}

                  {/* Barra 2: Costos — los 4 componentes stackeados forman la
                      "torre de costos" del mes. El radio redondeado se aplica
                      sólo al último segmento visible (manejado por recharts
                      automáticamente al tener el mismo stackId). */}
                  {visibleSeries.commissions && (
                    <Bar
                      dataKey="commissions"
                      name="Comisiones"
                      fill={COLORS.commissions}
                      stackId="costos"
                      maxBarSize={72}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.variableExpenses && (
                    <Bar
                      dataKey="variableExpenses"
                      name="Gastos variables"
                      fill={COLORS.variable}
                      stackId="costos"
                      maxBarSize={72}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.baseSalaryPaid && (
                    <Bar
                      dataKey="baseSalaryPaid"
                      name="Sueldos fijos"
                      fill={COLORS.salaries}
                      stackId="costos"
                      maxBarSize={72}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.fixedExpenses && (
                    <Bar
                      dataKey="fixedExpenses"
                      name="Gastos fijos"
                      fill={COLORS.fixed}
                      stackId="costos"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={72}
                      animationDuration={800}
                    />
                  )}

                  {/* Línea de Resultado neto con el valor impreso arriba de
                      cada punto — así el dueño no depende del tooltip para ver
                      cuánto le quedó este mes. */}
                  {visibleSeries.netProfit && (
                    <Line
                      type="monotone"
                      dataKey="netProfit"
                      name="Resultado neto"
                      stroke={COLORS.netProfit}
                      strokeWidth={3}
                      dot={{ r: 5, strokeWidth: 2, stroke: '#0a0a0a', fill: COLORS.netProfit }}
                      activeDot={{ r: 7 }}
                      animationDuration={800}
                    >
                      <LabelList
                        dataKey="netProfit"
                        position="top"
                        offset={10}
                        formatter={(v) => (typeof v === 'number' ? formatAxis(v) : '')}
                        style={{
                          fill: COLORS.netProfit,
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      />
                    </Line>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Sección inferior: Pie Charts + Break-Even */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Pie Chart 1: Saldo por cuenta */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saldo por cuenta</CardTitle>
              <CardDescription>Dinero acumulado en cada cuenta</CardDescription>
            </CardHeader>
            <CardContent>
              {balancePieData.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center">
                    Sin saldo disponible
                  </p>
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={balancePieData}
                        dataKey="balance"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        paddingAngle={3}
                        animationDuration={800}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        label={(props: any) => {
                          const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props
                          if (percent < 0.05) return null
                          const RADIAN = Math.PI / 180
                          const radius = innerRadius + (outerRadius - innerRadius) * 0.6
                          const x = cx + radius * Math.cos(-midAngle * RADIAN)
                          const y = cy + radius * Math.sin(-midAngle * RADIAN)
                          return (
                            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="600">
                              {`${Math.round(percent * 100)}%`}
                            </text>
                          )
                        }}
                        labelLine={false}
                      >
                        {balancePieData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5">
                    {balancePieData.map((item, i) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="truncate">{item.name}</span>
                        </div>
                        <span className="font-medium shrink-0 ml-2">{formatCurrency(item.balance)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Pie Chart 2: Egresos por categoría */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Egresos por categoría</CardTitle>
                  <CardDescription>
                    {totalExpensesPie > 0 ? `Total: ${formatCurrency(totalExpensesPie)}` : 'Sin egresos'}
                  </CardDescription>
                </div>
              </div>
              <Select value={expenseAccountFilter} onValueChange={setExpenseAccountFilter}>
                <SelectTrigger className="mt-2 h-8 text-xs">
                  <SelectValue placeholder="Filtrar por cuenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas las cuentas</SelectItem>
                  <SelectItem value="__cash__">Efectivo</SelectItem>
                  {filteredAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {expensesByCategory.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center">
                    Sin egresos registrados
                  </p>
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={expensesByCategory}
                        dataKey="amount"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        paddingAngle={3}
                        animationDuration={800}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        label={(props: any) => {
                          const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props
                          if (percent < 0.05) return null
                          const RADIAN = Math.PI / 180
                          const radius = innerRadius + (outerRadius - innerRadius) * 0.6
                          const x = cx + radius * Math.cos(-midAngle * RADIAN)
                          const y = cy + radius * Math.sin(-midAngle * RADIAN)
                          return (
                            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="600">
                              {`${Math.round(percent * 100)}%`}
                            </text>
                          )
                        }}
                        labelLine={false}
                      >
                        {expensesByCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5">
                    {expensesByCategory.map((item, i) => (
                      <div key={item.category} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          <span className="truncate">{item.category}</span>
                        </div>
                        <span className="font-medium shrink-0 ml-2">{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Break-Even Card con barra de progreso */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="size-5 text-muted-foreground" />
                <CardTitle>Punto de equilibrio</CardTitle>
              </div>
              <CardDescription>
                Cortes necesarios para cubrir gastos fijos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Barra de progreso del mes actual */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progreso del mes</span>
                  <span className="font-medium">{data.currentMonthCuts} / {breakEven.cutsNeeded} cortes</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${progressPct >= 100 ? 'bg-green-500' : progressPct >= 70 ? 'bg-yellow-500' : 'bg-primary'}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">{progressPct}% del objetivo</p>
              </div>

              <div className="flex flex-col items-center gap-1 rounded-lg bg-muted/50 p-4">
                <span className="text-4xl font-bold">
                  {breakEven.cutsNeeded}
                </span>
                <span className="text-sm text-muted-foreground">
                  cortes/mes
                </span>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Ticket promedio
                  </span>
                  <span className="font-medium">
                    {formatCurrency(breakEven.avgRevenuePerCut)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Comisión promedio
                  </span>
                  <span className="font-medium">
                    {formatCurrency(breakEven.avgCommissionPerCut)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Ganancia neta/corte
                  </span>
                  <span className="font-medium">
                    {formatCurrency(breakEven.netPerCut)}
                  </span>
                </div>
                <hr className="border-border" />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Gastos fijos/mes
                  </span>
                  <span className="font-medium">
                    {formatCurrency(breakEven.monthlyFixedExpenses)}
                  </span>
                </div>
              </div>

              {breakEven.cutsNeeded === 0 &&
                breakEven.monthlyFixedExpenses > 0 && (
                  <p className="text-xs text-muted-foreground">
                    No hay suficientes datos de cortes para calcular el punto
                    de equilibrio.
                  </p>
                )}
            </CardContent>
          </Card>
        </div>

        {/* Tabla de rendimiento por barbero */}
        {data.barberPerformance.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-muted-foreground" />
                Rendimiento por barbero
              </CardTitle>
              <CardDescription>Período seleccionado · ingresos, comisiones y margen neto</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Barbero</th>
                      <th className="pb-2 text-right font-medium">Cortes</th>
                      <th className="pb-2 text-right font-medium">Ticket prom.</th>
                      <th className="pb-2 text-right font-medium">Ingresos</th>
                      <th className="pb-2 text-right font-medium">Comisión</th>
                      <th className="pb-2 text-right font-medium">Margen neto</th>
                      <th className="pb-2 text-right font-medium">% Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.barberPerformance.map((b) => (
                      <tr key={b.staffId} className="border-b last:border-0">
                        <td className="py-2.5 font-medium">{b.name}</td>
                        <td className="py-2.5 text-right text-muted-foreground">{b.cuts}</td>
                        <td className="py-2.5 text-right">{formatCurrency(b.avgTicket)}</td>
                        <td className="py-2.5 text-right">{formatCurrency(b.revenue)}</td>
                        <td className="py-2.5 text-right text-destructive">-{formatCurrency(b.commissions)}</td>
                        <td className="py-2.5 text-right font-medium">{formatCurrency(b.netContribution)}</td>
                        <td className="py-2.5 text-right">
                          <span className={`font-medium ${b.marginPct >= 50 ? 'text-green-400' : b.marginPct >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                            {b.marginPct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabla de ingresos por servicio */}
        {data.serviceRevenue.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="size-5 text-muted-foreground" />
                Ingresos por servicio
              </CardTitle>
              <CardDescription>Top servicios del período</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.serviceRevenue.slice(0, 8).map((s) => {
                  const maxRevenue = data.serviceRevenue[0]?.revenue ?? 1
                  const pct = Math.round((s.revenue / maxRevenue) * 100)
                  return (
                    <div key={s.serviceId ?? '__none__'} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate max-w-[60%]">{s.serviceName}</span>
                        <div className="flex items-center gap-3 text-right shrink-0">
                          <span className="text-muted-foreground text-xs">{s.cuts} cortes · {formatCurrency(s.avgTicket)} prom.</span>
                          <span className="font-semibold">{formatCurrency(s.revenue)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

/* ─── Summary Card ─── */

function SummaryCard({
  title,
  value,
  icon: Icon,
  subtitle,
  highlight,
  momChange,
}: {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  subtitle?: string
  highlight?: 'positive' | 'negative'
  momChange?: number | null
}) {
  return (
    <Card
      className={
        highlight === 'positive'
          ? 'border-green-500/30'
          : highlight === 'negative'
            ? 'border-red-500/30'
            : ''
      }
    >
      <CardHeader className="gap-1">
        <CardDescription>{title}</CardDescription>
        <div className="absolute right-6 top-6">
          <Icon
            className={`size-4 ${highlight === 'positive'
                ? 'text-green-400'
                : highlight === 'negative'
                  ? 'text-red-400'
                  : 'text-muted-foreground'
              }`}
          />
        </div>
      </CardHeader>
      <CardContent>
        <p
          className={`text-xl font-bold lg:text-2xl ${highlight === 'positive'
              ? 'text-green-400'
              : highlight === 'negative'
                ? 'text-red-400'
                : ''
            }`}
        >
          {value}
        </p>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
        {momChange !== undefined && momChange !== null && (
          <p className={`mt-0.5 text-xs font-medium flex items-center gap-1 ${momChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {momChange >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {momChange >= 0 ? '+' : ''}{momChange}% vs mes anterior
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Componentes auxiliares del gráfico ─── */

function SeriesToggle({
  active,
  color,
  label,
  onClick,
}: {
  active: boolean
  color: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all ${
        active
          ? 'border-transparent text-background'
          : 'border-border bg-transparent text-muted-foreground hover:text-foreground'
      }`}
      style={active ? { backgroundColor: color } : {}}
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{ backgroundColor: active ? 'rgba(0,0,0,0.4)' : color }}
      />
      {label}
    </button>
  )
}

/* ─── Tooltips de gráficos ─── */

/** Tooltip "P&L del mes": rearma el estado de resultados del mes en una mini
 *  tarjeta — ingresos arriba, costos desagregados en el medio, resultado y
 *  margen abajo. Le da al dueño el panorama completo sin leer varias barras. */
function FinanceTooltip({
  active,
  payload,
  label,
}: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null

  // El payload de recharts trae la misma fila de datos en todos los entries.
  const row = (payload[0] as Record<string, unknown>)?.payload as
    | Record<string, number>
    | undefined
  if (!row) return null

  const revenue = Number(row.revenue ?? 0)
  const fixedExpenses = Number(row.fixedExpenses ?? 0)
  const variableExpenses = Number(row.variableExpenses ?? 0)
  const commissions = Number(row.commissions ?? 0)
  const baseSalaryPaid = Number(row.baseSalaryPaid ?? 0)
  const totalCosts = Number(row.totalCosts ?? 0)
  const netProfit = Number(row.netProfit ?? 0)
  const marginPct = Number(row.marginPct ?? 0)
  const prevRevenue = Number(row.prevRevenue ?? -1)

  const hasPrev = prevRevenue >= 0
  const momPct = hasPrev && prevRevenue > 0
    ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100)
    : null

  const costRows: Array<{ label: string; value: number; color: string }> = [
    { label: 'Gastos fijos', value: fixedExpenses, color: COLORS.fixed },
    { label: 'Gastos variables', value: variableExpenses, color: COLORS.variable },
    { label: 'Sueldos fijos', value: baseSalaryPaid, color: COLORS.salaries },
    { label: 'Comisiones', value: commissions, color: COLORS.commissions },
  ].filter(r => r.value !== 0)

  return (
    <div className="min-w-[240px] rounded-lg border bg-card p-3 shadow-lg">
      <p className="mb-2 text-sm font-bold text-foreground">{String(label)}</p>

      {/* Ingresos */}
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: COLORS.revenue }} />
          Ingresos
        </span>
        <span className="font-semibold text-foreground tabular-nums">
          {formatCurrency(revenue)}
        </span>
      </div>

      {/* Desglose de costos */}
      {costRows.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {costRows.map(r => (
            <div key={r.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
                {r.label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                −{formatCurrency(r.value)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 text-xs font-semibold">
            <span className="text-foreground">Total costos</span>
            <span className="text-foreground tabular-nums">
              −{formatCurrency(totalCosts)}
            </span>
          </div>
        </div>
      )}

      {/* Resultado + margen */}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm font-bold text-foreground">Resultado neto</span>
        <span
          className={`text-sm font-bold tabular-nums ${
            netProfit >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {netProfit >= 0 ? '' : '−'}{formatCurrency(Math.abs(netProfit))}
        </span>
      </div>
      {revenue > 0 && (
        <div className="mt-0.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Margen</span>
          <span
            className={`font-semibold tabular-nums ${
              marginPct >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {marginPct >= 0 ? '+' : ''}{marginPct}%
          </span>
        </div>
      )}

      {/* MoM en ingresos */}
      {momPct !== null && (
        <p
          className={`mt-2 border-t border-border pt-2 text-[11px] font-medium ${
            momPct >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          Ingresos {momPct >= 0 ? '+' : ''}{momPct}% vs mes anterior
        </p>
      )}
    </div>
  )
}

function PieTooltip({
  active,
  payload,
}: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null
  const entry = payload[0] as Record<string, unknown>
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
      <p className="text-sm font-medium text-foreground">{String(entry.name)}</p>
      <p className="text-sm text-muted-foreground">
        {formatCurrency(Number(entry.value))}
      </p>
    </div>
  )
}
