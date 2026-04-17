'use client'

import { useState, useTransition, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
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
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Target,
  Scissors,
  ShoppingBag,
  Users,
  Download,
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
  const { selectedBranchId } = useBranchStore()
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

  // Enriquecer cada mes con el ingreso del mes anterior para mostrarlo en el tooltip
  const chartMonths = data.months.map((m, i) => ({
    ...m,
    prevRevenue: i > 0 ? data.months[i - 1].revenue : -1,
  }))

  const balancePieData = accountBalances.filter(a => a.balance > 0)
  const totalExpensesPie = expensesByCategory.reduce((s, e) => s + e.amount, 0)

  // Cálculo de progreso del mes actual hacia el break-even
  const progressPct = breakEven.cutsNeeded > 0
    ? Math.min(100, Math.round((data.currentMonthCuts / breakEven.cutsNeeded) * 100))
    : 0

  // Escapar campo CSV: envolver en comillas si contiene coma, comillas o salto de línea
  function csvField(val: string | number): string {
    const s = String(val)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  // Función para exportar los datos del resumen como CSV
  function exportToCSV() {
    const headers = ['Mes', 'Ingresos', 'Gastos Fijos', 'Gastos Variables', 'Comisiones', 'Resultado Neto', 'Cortes']
    const rows = data.months.map(m => [
      m.label,
      m.revenue,
      m.fixedExpenses,
      m.variableExpenses,
      m.commissions,
      m.netProfit,
      m.cuts,
    ])
    const csvContent = [headers, ...rows].map(row => row.map(csvField).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finanzas_${orgSlug}_${period}meses.csv`
    a.click()
    URL.revokeObjectURL(url)
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
          <Button variant="outline" size="sm" onClick={exportToCSV}>
            <Download className="mr-1.5 size-3.5" />
            Exportar CSV
          </Button>
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

        {/* Gráfico principal con toggles de series */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Evolución financiera mensual</CardTitle>
            <CardDescription>
              Ingresos, gastos y resultado neto
            </CardDescription>
          </CardHeader>
          {/* Botones de toggle para series del gráfico */}
          <div className="flex flex-wrap gap-2 px-6 pb-2">
            {[
              { key: 'revenue', label: 'Ingresos', color: COLORS.revenue },
              { key: 'fixedExpenses', label: 'G. Fijos', color: COLORS.fixed },
              { key: 'variableExpenses', label: 'G. Variables', color: COLORS.variable },
              { key: 'commissions', label: 'Comisiones', color: COLORS.commissions },
              { key: 'baseSalaryPaid', label: 'Sueldos fijos', color: COLORS.salaries },
              { key: 'netProfit', label: 'Resultado', color: COLORS.netProfit },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => toggleSeries(key as keyof typeof visibleSeries)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-all ${
                  visibleSeries[key as keyof typeof visibleSeries]
                    ? 'border-transparent text-background'
                    : 'border-border text-muted-foreground bg-transparent'
                }`}
                style={visibleSeries[key as keyof typeof visibleSeries] ? { backgroundColor: color } : {}}
              >
                {label}
              </button>
            ))}
          </div>
          <CardContent>
            {data.months.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center md:h-[350px]">
                <p className="text-sm text-muted-foreground">
                  Sin datos para el período
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280} className="md:!h-[350px]">
                <ComposedChart data={chartMonths} barGap={0}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={COLORS.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: COLORS.axis, fontSize: 12 }}
                    axisLine={{ stroke: COLORS.grid }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: COLORS.axis, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000000
                        ? `$${(v / 1000000).toFixed(1)}M`
                        : `$${(v / 1000).toFixed(0)}k`
                    }
                  />
                  <Tooltip content={<FinanceTooltip />} cursor={{ fill: 'transparent' }} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: COLORS.axis }}
                  />
                  {visibleSeries.revenue && (
                    <Bar
                      dataKey="revenue"
                      name="Ingresos"
                      fill={COLORS.revenue}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.fixedExpenses && (
                    <Bar
                      dataKey="fixedExpenses"
                      name="Gastos fijos"
                      fill={COLORS.fixed}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.variableExpenses && (
                    <Bar
                      dataKey="variableExpenses"
                      name="Gastos variables"
                      fill={COLORS.variable}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.commissions && (
                    <Bar
                      dataKey="commissions"
                      name="Comisiones"
                      fill={COLORS.commissions}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.baseSalaryPaid && (
                    <Bar
                      dataKey="baseSalaryPaid"
                      name="Sueldos fijos"
                      fill={COLORS.salaries}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                    />
                  )}
                  {visibleSeries.netProfit && (
                    <Line
                      type="monotone"
                      dataKey="netProfit"
                      name="Resultado neto"
                      stroke={COLORS.netProfit}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 4, fill: COLORS.netProfit }}
                      animationDuration={800}
                    />
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

/* ─── Tooltips de gráficos ─── */

function FinanceTooltip({
  active,
  payload,
  label,
}: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null
  // Buscar variación de ingresos vs mes anterior desde el payload del gráfico
  const revenueEntry = payload.find((p: Record<string, unknown>) => p.dataKey === 'revenue')
  const currentRevenue = revenueEntry ? Number((revenueEntry as Record<string, unknown>).value) : null
  const prevRevenue = revenueEntry
    ? Number(((revenueEntry as Record<string, unknown>).payload as Record<string, unknown>)?.prevRevenue ?? -1)
    : null
  const hasPrev = prevRevenue !== null && prevRevenue >= 0
  const pctChange = hasPrev && prevRevenue > 0 && currentRevenue !== null
    ? Math.round(((currentRevenue - prevRevenue) / prevRevenue) * 100)
    : null

  return (
    <div className="rounded-lg border bg-card p-3 shadow-md">
      <p className="mb-2 text-sm font-medium text-foreground">{String(label)}</p>
      {payload.map((p: Record<string, unknown>, i: number) => (
        <p key={i} className="text-sm text-muted-foreground">
          {String(p.name)}: {formatCurrency(Number(p.value))}
        </p>
      ))}
      {pctChange !== null && (
        <p className={`mt-1.5 text-xs font-medium border-t border-border pt-1.5 ${pctChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          Ingresos: {pctChange >= 0 ? '+' : ''}{pctChange}% vs mes anterior
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
