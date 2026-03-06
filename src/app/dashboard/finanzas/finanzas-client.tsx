'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
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
} from 'recharts'
import { useBranchStore } from '@/stores/branch-store'
import {
  fetchFinancialData,
  getFixedExpenses,
  upsertFixedExpense,
  deleteFixedExpense,
  type FinancialSummary,
} from '@/lib/actions/finances'
import { formatCurrency } from '@/lib/format'
import type { Branch, FixedExpense } from '@/lib/types/database'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Target,
  Plus,
  Pencil,
  Trash2,
  Scissors,
} from 'lucide-react'

const PERIOD_OPTIONS = [
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
]

const CATEGORY_OPTIONS = [
  'Alquiler',
  'Servicios',
  'Stock / Insumos',
  'Seguros',
  'Impuestos',
  'Personal',
  'Mantenimiento',
  'Otro',
]

const COLORS = {
  revenue: '#d4d4d4',
  fixed: '#737373',
  commissions: '#404040',
  netProfit: '#ffffff',
  grid: '#262626',
  axis: '#737373',
}

interface Props {
  initialData: FinancialSummary
  initialExpenses: (FixedExpense & { branch?: { name: string } | null })[]
  branches: Branch[]
}

export function FinanzasClient({
  initialData,
  initialExpenses,
  branches,
}: Props) {
  const { selectedBranchId } = useBranchStore()
  const [data, setData] = useState(initialData)
  const [expenses, setExpenses] = useState(initialExpenses)
  const [period, setPeriod] = useState('6')
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<
    (FixedExpense & { branch?: { name: string } | null }) | null
  >(null)

  const refresh = useCallback(
    (p?: string) => {
      const months = Number(p ?? period)
      startTransition(async () => {
        const [newData, newExpenses] = await Promise.all([
          fetchFinancialData(months, selectedBranchId),
          getFixedExpenses(selectedBranchId),
        ])
        setData(newData)
        setExpenses(newExpenses)
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

  const handleDeleteExpense = (id: string) => {
    startTransition(async () => {
      const result = await deleteFixedExpense(id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Gasto eliminado')
        refresh()
      }
    })
  }

  const openNew = () => {
    setEditingExpense(null)
    setDialogOpen(true)
  }

  const openEdit = (
    exp: FixedExpense & { branch?: { name: string } | null }
  ) => {
    setEditingExpense(exp)
    setDialogOpen(true)
  }

  const { totals, breakEven } = data
  const isPositive = totals.netProfit >= 0

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

        {/* Bottom section: Expenses List + Break-Even */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Fixed Expenses List */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Gastos fijos mensuales</CardTitle>
                    <CardDescription>
                      Total:{' '}
                      {formatCurrency(breakEven.monthlyFixedExpenses)}/mes
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={openNew}>
                    <Plus className="mr-2 size-4" /> Agregar
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {expenses.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No hay gastos fijos registrados
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Categoría</TableHead>
                        {!selectedBranchId && (
                          <TableHead>Sucursal</TableHead>
                        )}
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.map((exp) => (
                        <TableRow key={exp.id}>
                          <TableCell className="font-medium">
                            {exp.name}
                          </TableCell>
                          <TableCell>
                            {exp.category ? (
                              <Badge variant="secondary">
                                {exp.category}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </TableCell>
                          {!selectedBranchId && (
                            <TableCell className="text-muted-foreground">
                              {(
                                exp.branch as { name: string } | null
                              )?.name ?? '–'}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-medium">
                            {formatCurrency(exp.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                exp.is_active ? 'default' : 'secondary'
                              }
                            >
                              {exp.is_active ? 'Activo' : 'Inactivo'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(exp)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteExpense(exp.id)}
                              >
                                <Trash2 className="size-3.5 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

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

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editingExpense}
        branches={branches}
        selectedBranchId={selectedBranchId}
        onSaved={() => {
          setDialogOpen(false)
          refresh()
        }}
      />
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

/* ─── Chart Tooltip ─── */

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

/* ─── Expense Dialog ─── */

function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  branches,
  selectedBranchId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense: (FixedExpense & { branch?: { name: string } | null }) | null
  branches: Branch[]
  selectedBranchId: string | null
  onSaved: () => void
}) {
  const isEdit = !!expense
  const [name, setName] = useState(expense?.name ?? '')
  const [category, setCategory] = useState(expense?.category ?? '')
  const [amount, setAmount] = useState(expense?.amount ?? 0)
  const [branchId, setBranchId] = useState(
    expense?.branch_id ?? selectedBranchId ?? ''
  )
  const [active, setActive] = useState(expense?.is_active ?? true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (expense) {
      setName(expense.name)
      setCategory(expense.category ?? '')
      setAmount(expense.amount)
      setBranchId(expense.branch_id)
      setActive(expense.is_active)
    } else {
      setName('')
      setCategory('')
      setAmount(0)
      setBranchId(selectedBranchId ?? branches[0]?.id ?? '')
      setActive(true)
    }
  }, [expense, open, selectedBranchId, branches])

  const handleSave = () => {
    if (!name.trim() || !branchId) return
    startTransition(async () => {
      const result = await upsertFixedExpense({
        id: expense?.id,
        branch_id: branchId,
        name: name.trim(),
        category: category || null,
        amount,
        is_active: active,
      })
      if (result.error) toast.error(result.error)
      else {
        toast.success(isEdit ? 'Gasto actualizado' : 'Gasto creado')
        onSaved()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Sucursal</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar sucursal" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Alquiler, Luz, Internet..."
            />
          </div>

          <div className="space-y-2">
            <Label>Categoría</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar categoría" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Monto mensual ($)</Label>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              onClick={() => setActive(!active)}
            >
              {active ? 'Activo' : 'Inactivo'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Los inactivos no se computan en el cálculo
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || !name.trim() || !branchId}
          >
            {isPending ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
