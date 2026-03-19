'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { startOfMonth, endOfDay, format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { fetchStats, type StatsData } from '@/lib/actions/stats'
import { exportCSV, exportPDF } from '@/lib/export'
import { formatCurrency } from '@/lib/format'
import { DateRangePicker } from '@/components/dashboard/date-range-picker'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
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
  Scissors,
  TrendingUp,
  Users,
  FileDown,
  UserPlus,
  UserCheck,
  AlertTriangle,
  UserX,
  Trophy,
} from 'lucide-react'

const COLORS = {
  primary: 'var(--chart-2)',
  secondary: 'var(--chart-3)',
  tertiary: 'var(--chart-4)',
  grid: '#262626',
  axis: '#737373',
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
}

const METHOD_COLORS = ['var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

interface Props {
  initialData: StatsData
  branches: { id: string; name: string }[]
}

export function EstadisticasClient({ initialData, branches }: Props) {
  const { selectedBranchId } = useBranchStore()
  const [data, setData] = useState(initialData)
  const [from, setFrom] = useState(() => startOfMonth(new Date()))
  const [to, setTo] = useState(() => endOfDay(new Date()))
  const [isPending, startTransition] = useTransition()

  const refresh = useCallback(
    (newFrom?: Date, newTo?: Date) => {
      const f = newFrom ?? from
      const t = newTo ?? to
      startTransition(async () => {
        const result = await fetchStats(
          f.toISOString(),
          t.toISOString(),
          selectedBranchId
        )
        setData(result)
      })
    },
    [from, to, selectedBranchId]
  )

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  const handleDateChange = (newFrom: Date, newTo: Date) => {
    setFrom(newFrom)
    setTo(newTo)
    refresh(newFrom, newTo)
  }

  const handleExportCSV = () => {
    exportCSV(
      ['Barbero', 'Cortes', 'Ingresos', 'Clientes', 'Comisión'],
      data.ranking.map((r) => [
        r.name,
        r.cuts,
        r.revenue,
        r.clients,
        r.commission,
      ]),
      'ranking-barberos'
    )
  }

  const handleExportPDF = async () => {
    await exportPDF(
      'Reporte de Estadísticas – Monaco Smart Barber',
      ['Barbero', 'Cortes', 'Ingresos', 'Clientes', 'Comisión'],
      data.ranking.map((r) => [
        r.name,
        r.cuts,
        formatCurrency(r.revenue),
        r.clients,
        formatCurrency(r.commission),
      ]),
      'reporte-estadisticas'
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Estadísticas</h2>
        <div className="flex items-center gap-2">
          <BranchSelector branches={branches} />
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <FileDown className="mr-2 size-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <FileDown className="mr-2 size-4" /> PDF
          </Button>
        </div>
      </div>

      <DateRangePicker from={from} to={to} onChange={handleDateChange} />

      {isPending && (
        <div className="flex items-center justify-center py-8">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      <div className={isPending ? 'pointer-events-none opacity-50' : ''}>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title="Ingresos"
            value={formatCurrency(data.totals.revenue)}
            icon={DollarSign}
          />
          <SummaryCard
            title="Cortes"
            value={String(data.totals.cuts)}
            icon={Scissors}
          />
          <SummaryCard
            title="Ticket promedio"
            value={formatCurrency(data.totals.avgTicket)}
            icon={TrendingUp}
          />
          <SummaryCard
            title="Clientes únicos"
            value={String(data.totals.clients)}
            icon={Users}
          />
        </div>

        <Tabs defaultValue="tendencias" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tendencias">Tendencias</TabsTrigger>
            <TabsTrigger value="ocupacion">Ocupación</TabsTrigger>
            <TabsTrigger value="barberos">Barberos</TabsTrigger>
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
          </TabsList>

          <TabsContent value="tendencias">
            <TrendsTab data={data} />
          </TabsContent>
          <TabsContent value="ocupacion">
            <HeatmapTab data={data} />
          </TabsContent>
          <TabsContent value="barberos">
            <RankingTab data={data} />
          </TabsContent>
          <TabsContent value="clientes">
            <SegmentationTab data={data} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/* ─── Summary Card ─── */

function SummaryCard({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <div className="absolute right-6 top-6">
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}

/* ─── Chart Tooltip ─── */

function ChartTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null
  const item = payload[0].payload as Record<string, unknown>
  return (
    <div className="rounded-lg border bg-card p-3 shadow-md">
      <p className="mb-1 text-sm font-medium text-foreground">{String(label)}</p>
      {payload.map((p: Record<string, unknown>, i: number) => (
        <p key={i} className="text-sm text-muted-foreground">
          {String(p.name)}:{' '}
          {String(p.name).includes('Ingreso')
            ? formatCurrency(Number(p.value))
            : String(p.value)}
        </p>
      ))}
      {item.cuts !== undefined && typeof item.amount !== 'undefined' && (
        <p className="text-sm text-muted-foreground mt-0.5">
          Cortes: {String(item.cuts)}
        </p>
      )}
    </div>
  )
}

/* ─── Trends Tab ─── */

function TrendsTab({ data }: { data: StatsData }) {
  const chartData = data.trends.map((t) => ({
    ...t,
    label: format(new Date(t.date + 'T12:00:00'), 'dd MMM', { locale: es }),
  }))

  const methodData = data.revenueByMethod.map((m) => ({
    name: METHOD_LABELS[m.method] ?? m.method,
    amount: m.amount,
    cuts: m.cuts,
  }))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Ingresos diarios</CardTitle>
          <CardDescription>Evolución durante el período</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
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
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Ingresos"
                  stroke={COLORS.primary}
                  fill={COLORS.primary}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  animationDuration={800}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cortes diarios</CardTitle>
          <CardDescription>Cantidad de servicios completados</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
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
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar
                  dataKey="cuts"
                  name="Cortes"
                  fill={COLORS.secondary}
                  radius={[4, 4, 0, 0]}
                  animationDuration={800}
                  activeBar={{ stroke: 'var(--foreground)', strokeWidth: 1, fillOpacity: 0.8 }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Ingresos por método de pago</CardTitle>
        </CardHeader>
        <CardContent>
          {methodData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={methodData} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={COLORS.grid}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fill: COLORS.axis, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatCurrency(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: COLORS.axis, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar
                  dataKey="amount"
                  name="Ingresos"
                  radius={[0, 4, 4, 0]}
                  animationDuration={800}
                  activeBar={{ stroke: 'var(--foreground)', strokeWidth: 1, fillOpacity: 0.8 }}
                >
                  {methodData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={METHOD_COLORS[i % METHOD_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ─── Heatmap Tab ─── */

function HeatmapTab({ data }: { data: StatsData }) {
  const hours = Array.from({ length: 14 }, (_, i) => i + 8)
  const maxCount = Math.max(...data.heatmap.map((d) => d.count), 1)

  const getCount = (day: number, hour: number) =>
    data.heatmap.find((d) => d.day === day && d.hour === hour)?.count || 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapa de calor de ocupación</CardTitle>
        <CardDescription>
          Intensidad de visitas por día y hora
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="mb-2 flex">
              <div className="w-12 shrink-0" />
              {hours.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-xs text-muted-foreground"
                >
                  {h}h
                </div>
              ))}
            </div>
            {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => (
              <div key={dayIdx} className="mb-1 flex items-center">
                <div className="w-12 shrink-0 text-xs text-muted-foreground">
                  {DAY_LABELS[dayIdx]}
                </div>
                {hours.map((hour) => {
                  const count = getCount(dayIdx, hour)
                  const intensity = count / maxCount
                  return (
                    <div key={hour} className="flex-1 px-0.5">
                      <div
                        className="aspect-square rounded-sm border border-border transition-colors"
                        style={{
                          backgroundColor:
                            count === 0
                              ? 'transparent'
                              : `rgba(229, 229, 229, ${0.15 + intensity * 0.85})`,
                        }}
                        title={`${DAY_LABELS[dayIdx]} ${hour}:00 – ${count} visitas`}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>Menos</span>
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <div
                  key={v}
                  className="size-4 rounded-sm border border-border"
                  style={{
                    backgroundColor:
                      v === 0
                        ? 'transparent'
                        : `rgba(229, 229, 229, ${0.15 + v * 0.85})`,
                  }}
                />
              ))}
              <span>Más</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ─── Ranking Tab ─── */

function RankingTab({ data }: { data: StatsData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ranking de barberos</CardTitle>
        <CardDescription>Rendimiento en el período seleccionado</CardDescription>
      </CardHeader>
      <CardContent>
        {data.ranking.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin datos para el período
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Barbero</TableHead>
                <TableHead className="text-right">Cortes</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Clientes</TableHead>
                <TableHead className="text-right">Comisión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ranking.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {i < 3 ? (
                      <Trophy
                        className={`size-4 ${
                          i === 0
                            ? 'text-yellow-400'
                            : i === 1
                              ? 'text-gray-400'
                              : 'text-amber-600'
                        }`}
                      />
                    ) : (
                      <span className="text-muted-foreground">{i + 1}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.cuts}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(r.revenue)}
                  </TableCell>
                  <TableCell className="text-right">{r.clients}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(r.commission)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ─── Segmentation Tab ─── */

function SegmentationTab({ data }: { data: StatsData }) {
  const { segmentation: s } = data

  const segments = [
    {
      label: 'Clientes nuevos',
      value: s.new_count,
      icon: UserPlus,
      color: 'text-green-400',
      description: 'Registrados en el período',
    },
    {
      label: 'Recurrentes',
      value: s.recurring,
      icon: UserCheck,
      color: 'text-blue-400',
      description: '2+ visitas recientes',
    },
    {
      label: 'En riesgo',
      value: s.at_risk,
      icon: AlertTriangle,
      color: 'text-yellow-400',
      description: 'Sin visita en 25-39 días',
    },
    {
      label: 'Perdidos',
      value: s.lost,
      icon: UserX,
      color: 'text-red-400',
      description: 'Sin visita en 40+ días',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {segments.map((seg) => (
          <Card key={seg.label}>
            <CardHeader>
              <CardDescription>{seg.label}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className={`rounded-lg bg-muted p-2 ${seg.color}`}>
                  <seg.icon className="size-5" />
                </div>
                <div>
                  <p className="text-3xl font-bold">{seg.value}</p>
                  <p className="text-xs text-muted-foreground">
                    {seg.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Resumen general</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total de clientes registrados</span>
              <Badge variant="secondary">{s.total}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tasa de retención</span>
              <Badge variant="secondary">
                {s.total > 0
                  ? `${Math.round((s.recurring / s.total) * 100)}%`
                  : '–'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tasa de churn</span>
              <Badge variant="secondary">
                {s.total > 0
                  ? `${Math.round((s.lost / s.total) * 100)}%`
                  : '–'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ─── Empty State ─── */

function EmptyChart() {
  return (
    <div className="flex h-[250px] items-center justify-center">
      <p className="text-sm text-muted-foreground">Sin datos para el período</p>
    </div>
  )
}
