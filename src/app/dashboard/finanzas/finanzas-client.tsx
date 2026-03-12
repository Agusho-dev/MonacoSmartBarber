'use client'

import { useState, useTransition, useEffect, useCallback, useMemo } from 'react'
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
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Target,
  Scissors,
} from 'lucide-react'

const PERIOD_OPTIONS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
]

const COLORS = {
  revenue: '#d4d4d4',
  fixed: '#737373',
  commissions: '#404040',
  netProfit: '#ffffff',
  grid: '#262626',
  axis: '#737373',
}

const PIE_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f87171', '#34d399', '#f472b6', '#818cf8', '#2dd4bf']

interface AccountWithBranch extends PaymentAccount {
  branch?: { name: string } | null
}

interface Props {
  initialData: FinancialSummary
  branches: Branch[]
  accounts: AccountWithBranch[]
  expenseTickets: ExpenseTicket[]
}

type AccountBalance = { id: string; name: string; balance: number; income: number; expenses: number }

export function FinanzasClient({
  initialData,
  branches,
  accounts,
  expenseTickets,
}: Props) {
  const { selectedBranchId } = useBranchStore()
  const [data, setData] = useState(initialData)
  const [period, setPeriod] = useState('6')
  const [isPending, startTransition] = useTransition()
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([])
  const [expenseAccountFilter, setExpenseAccountFilter] = useState<string>('__all__')

  const refresh = useCallback(
    (p?: string) => {
      const months = Number(p ?? period)
      startTransition(async () => {
        const [newData, newBalances] = await Promise.all([
          fetchFinancialData(months, selectedBranchId),
          getAllAccountBalanceTotals(selectedBranchId),
        ])
        setData(newData)
        setAccountBalances(newBalances)
      })
    },
    [period, selectedBranchId]
  )

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  const handlePeriodChange = (v: string) => {
    setPeriod(v)
    refresh(v)
  }

  const expensesByCategory = useMemo(() => {
    const filtered = expenseAccountFilter === '__all__'
      ? expenseTickets
      : expenseTickets.filter(t => t.payment_account_id === expenseAccountFilter)

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

  const balancePieData = accountBalances.filter(a => a.balance > 0)
  const totalExpensesPie = expensesByCategory.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Finanzas</h2>
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
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-4">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      <div className={isPending ? 'pointer-events-none opacity-50' : ''}>
        {/* Summary Cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Ingresos brutos"
            value={formatCurrency(totals.revenue)}
            icon={DollarSign}
            subtitle={`${totals.cuts} cortes`}
          />
          <SummaryCard
            title="Gastos fijos"
            value={formatCurrency(totals.fixedExpenses)}
            icon={Receipt}
            subtitle={`${formatCurrency(breakEven.monthlyFixedExpenses)}/mes`}
          />
          <SummaryCard
            title="Comisiones"
            value={formatCurrency(totals.commissions)}
            icon={Scissors}
            subtitle={`${formatCurrency(breakEven.avgCommissionPerCut)} promedio/corte`}
          />
          <SummaryCard
            title="Resultado neto"
            value={formatCurrency(totals.netProfit)}
            icon={isPositive ? TrendingUp : TrendingDown}
            subtitle={isPositive ? 'Ganancia' : 'Pérdida'}
            highlight={isPositive ? 'positive' : 'negative'}
          />
        </div>

        {/* Main Chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Evolución financiera mensual</CardTitle>
            <CardDescription>
              Ingresos, gastos y resultado neto
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.months.length === 0 ? (
              <div className="flex h-[350px] items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Sin datos para el período
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={data.months} barGap={0}>
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
                  <Tooltip content={<FinanceTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: COLORS.axis }}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Ingresos"
                    fill={COLORS.revenue}
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                  />
                  <Bar
                    dataKey="fixedExpenses"
                    name="Gastos fijos"
                    stackId="expenses"
                    fill={COLORS.fixed}
                    animationDuration={800}
                  />
                  <Bar
                    dataKey="commissions"
                    name="Comisiones"
                    stackId="expenses"
                    fill={COLORS.commissions}
                    radius={[4, 4, 0, 0]}
                    animationDuration={800}
                  />
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
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Bottom section: Pie Charts + Break-Even */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pie Chart 1: Account Balances */}
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

          {/* Pie Chart 2: Expenses by Category */}
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

          {/* Break-Even Card */}
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
}: {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  subtitle?: string
  highlight?: 'positive' | 'negative'
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
            className={`size-4 ${
              highlight === 'positive'
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
          className={`text-2xl font-bold ${
            highlight === 'positive'
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
      </CardContent>
    </Card>
  )
}

/* ─── Chart Tooltips ─── */

function FinanceTooltip({
  active,
  payload,
  label,
}: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-card p-3 shadow-md">
      <p className="mb-2 text-sm font-medium">{String(label)}</p>
      {payload.map((p: Record<string, unknown>, i: number) => (
        <p key={i} className="text-sm text-muted-foreground">
          {String(p.name)}: {formatCurrency(Number(p.value))}
        </p>
      ))}
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
      <p className="text-sm font-medium">{String(entry.name)}</p>
      <p className="text-sm text-muted-foreground">
        {formatCurrency(Number(entry.value))}
      </p>
    </div>
  )
}
