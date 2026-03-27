'use client'

import { useState, useMemo, useTransition } from 'react'
import {
  ArrowLeft,
  Scissors,
  Banknote,
  TrendingUp,
  AlertTriangle,
  Clock,
  Coffee,
  CalendarDays,
  Download,
  Plus,
  X,
  Trash2,
} from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useBranchStore } from '@/stores/branch-store'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Staff, Role, DisciplinaryEventType, SalaryConfig, StaffSchedule, StaffScheduleException } from '@/lib/types/database'

// --- Types ---

interface ServiceVisit {
  id: string
  amount: number
  payment_method: string
  commission_amount: number
  started_at: string | null
  completed_at: string
  branch_id: string
  service: { name: string } | null
  client: { name: string } | null
  barber: { id: string; full_name: string } | null
}

interface DisciplinaryEventRow {
  id: string
  staff_id: string
  branch_id: string
  event_type: DisciplinaryEventType
  event_date: string
  occurrence_number: number
  consequence_applied: string | null
  deduction_amount: number | null
  notes: string | null
  source: string
}

interface BreakOvertimeRow {
  id: string
  staff_id: string
  branch_id: string
  overtime_seconds: number | null
  actual_completed_at: string | null
  staff?: { id: string; full_name: string; branch_id: string | null } | null
  break_config?: { name: string; duration_minutes: number } | null
}

interface BarberVisitRow {
  barber_id: string
  amount: number
}

interface BarberWithSchedules {
  id: string
  full_name: string
  branch_id: string | null
  staff_schedules: StaffSchedule[]
  staff_schedule_exceptions: StaffScheduleException[]
}

interface ScheduleBlock {
  start_time: string
  end_time: string
}

export interface PerfilesProps {
  barbers: Staff[]
  roles: Role[]
  todayVisits: BarberVisitRow[]
  serviceHistory: ServiceVisit[]
  disciplinaryEvents: DisciplinaryEventRow[]
  breakOvertimeHistory: BreakOvertimeRow[]
  salaryConfigs: SalaryConfig[]
  calendarBarbers: BarberWithSchedules[]
}

// --- Constants ---

const roleLabels: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  receptionist: 'Recepcionista',
  barber: 'Barbero',
}

const EVENT_LABELS: Record<string, string> = {
  absence: 'Falta',
  late: 'Tardanza',
}

const CONSEQUENCE_LABELS: Record<string, string> = {
  warning: 'Advertencia',
  deduction: 'Descuento',
  suspension: 'Suspensión',
  none: 'Ninguna',
}

const SCHEME_LABELS: Record<string, string> = {
  fixed: 'Sueldo fijo',
  commission: 'Comisión',
  hybrid: 'Híbrido',
}

type PeriodFilter = 'day' | 'week' | 'month' | '3months' | '6months' | '9months' | '12months'

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: '3months', label: '3 meses' },
  { value: '6months', label: '6 meses' },
  { value: '9months', label: '9 meses' },
  { value: '12months', label: '12 meses' },
]

function getFilterDate(period: PeriodFilter): Date {
  const now = new Date()
  switch (period) {
    case 'day':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    case 'week': {
      const day = now.getDay()
      const diff = day === 0 ? 6 : day - 1
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
    }
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    case '3months':
      return new Date(now.getFullYear(), now.getMonth() - 2, 1)
    case '6months':
      return new Date(now.getFullYear(), now.getMonth() - 5, 1)
    case '9months':
      return new Date(now.getFullYear(), now.getMonth() - 8, 1)
    case '12months':
      return new Date(now.getFullYear() - 1, now.getMonth(), 1)
  }
}

function getPeriodLabel(period: PeriodFilter): string {
  return PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? period
}

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

// --- Main Component ---

export function PerfilesClient({
  barbers,
  roles,
  todayVisits,
  serviceHistory,
  disciplinaryEvents,
  breakOvertimeHistory,
  salaryConfigs,
  calendarBarbers,
}: PerfilesProps) {
  const { selectedBranchId } = useBranchStore()
  const [selectedBarber, setSelectedBarber] = useState<Staff | null>(null)
  const [period, setPeriod] = useState<PeriodFilter>('month')

  const filtered = selectedBranchId
    ? barbers.filter((b) => b.branch_id === selectedBranchId)
    : barbers

  const todayStatsMap = useMemo(() => {
    const map = new Map<string, { cuts: number; revenue: number }>()
    todayVisits.forEach((v) => {
      const existing = map.get(v.barber_id) ?? { cuts: 0, revenue: 0 }
      map.set(v.barber_id, { cuts: existing.cuts + 1, revenue: existing.revenue + v.amount })
    })
    return map
  }, [todayVisits])

  const monthlyStatsMap = useMemo(() => {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const map = new Map<string, { cuts: number; revenue: number; commission: number }>()
    serviceHistory.forEach((v) => {
      if (!v.barber || new Date(v.completed_at) < startOfMonth) return
      const existing = map.get(v.barber.id) ?? { cuts: 0, revenue: 0, commission: 0 }
      map.set(v.barber.id, {
        cuts: existing.cuts + 1,
        revenue: existing.revenue + v.amount,
        commission: existing.commission + v.commission_amount,
      })
    })
    return map
  }, [serviceHistory])

  const disciplineCountMap = useMemo(() => {
    const map = new Map<string, { absences: number; lates: number }>()
    disciplinaryEvents.forEach((e) => {
      const existing = map.get(e.staff_id) ?? { absences: 0, lates: 0 }
      if (e.event_type === 'absence') existing.absences++
      if (e.event_type === 'late') existing.lates++
      map.set(e.staff_id, existing)
    })
    return map
  }, [disciplinaryEvents])

  const breakOvertimeCountMap = useMemo(() => {
    const map = new Map<string, number>()
    breakOvertimeHistory.forEach((b) => {
      map.set(b.staff_id, (map.get(b.staff_id) ?? 0) + 1)
    })
    return map
  }, [breakOvertimeHistory])

  const salaryConfigMap = useMemo(() => {
    const map = new Map<string, SalaryConfig>()
    salaryConfigs.forEach((sc) => map.set(sc.staff_id, sc))
    return map
  }, [salaryConfigs])

  if (selectedBarber) {
    const calBarber = calendarBarbers.find((cb) => cb.id === selectedBarber.id) ?? null
    return (
      <BarberDetailPanel
        barber={selectedBarber}
        roles={roles}
        todayStats={todayStatsMap.get(selectedBarber.id) ?? null}
        serviceHistory={serviceHistory}
        disciplinaryEvents={disciplinaryEvents}
        breakOvertimeHistory={breakOvertimeHistory}
        salaryConfig={salaryConfigMap.get(selectedBarber.id) ?? null}
        calendarBarber={calBarber}
        period={period}
        setPeriod={setPeriod}
        onBack={() => setSelectedBarber(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Seleccioná un miembro del equipo para ver su perfil completo, rendimiento y boletín.
      </p>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
            No hay miembros del equipo en esta sucursal
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((barber) => {
          const monthly = monthlyStatsMap.get(barber.id)
          const discipline = disciplineCountMap.get(barber.id)
          const breakOvertimes = breakOvertimeCountMap.get(barber.id) ?? 0
          const todayStats = todayStatsMap.get(barber.id)
          const roleName =
            barber.custom_role?.name ??
            (barber.role_id
              ? roles.find((r) => r.id === barber.role_id)?.name ?? roleLabels[barber.role]
              : roleLabels[barber.role])

          return (
            <Card
              key={barber.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => setSelectedBarber(barber)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-12 shrink-0">
                    <AvatarImage src={barber.avatar_url ?? undefined} alt={barber.full_name} />
                    <AvatarFallback>{barber.full_name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base truncate">{barber.full_name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {roleName} · {barber.branch?.name ?? 'Sin sucursal'}
                    </p>
                  </div>
                  <Badge variant={barber.is_active ? 'default' : 'secondary'} className="shrink-0 text-xs">
                    {barber.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-lg font-bold">{todayStats?.cuts ?? 0}</p>
                    <p className="text-muted-foreground">Hoy</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-lg font-bold">{monthly?.cuts ?? 0}</p>
                    <p className="text-muted-foreground">Mes</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <p className="text-lg font-bold text-green-600">
                      {monthly ? formatCurrency(monthly.commission) : '$0'}
                    </p>
                    <p className="text-muted-foreground">Comisión</p>
                  </div>
                </div>
                {((discipline && (discipline.absences > 0 || discipline.lates > 0)) || breakOvertimes > 0) && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {discipline && discipline.absences > 0 && (
                      <Badge variant="outline" className="text-red-600 border-red-300 text-xs">
                        {discipline.absences} falta{discipline.absences !== 1 ? 's' : ''}
                      </Badge>
                    )}
                    {discipline && discipline.lates > 0 && (
                      <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                        {discipline.lates} tardanza{discipline.lates !== 1 ? 's' : ''}
                      </Badge>
                    )}
                    {breakOvertimes > 0 && (
                      <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                        {breakOvertimes} descanso{breakOvertimes !== 1 ? 's' : ''} excedido{breakOvertimes !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// --- Detail Panel ---

function BarberDetailPanel({
  barber,
  roles,
  todayStats,
  serviceHistory,
  disciplinaryEvents,
  breakOvertimeHistory,
  salaryConfig,
  calendarBarber,
  period,
  setPeriod,
  onBack,
}: {
  barber: Staff
  roles: Role[]
  todayStats: { cuts: number; revenue: number } | null
  serviceHistory: ServiceVisit[]
  disciplinaryEvents: DisciplinaryEventRow[]
  breakOvertimeHistory: BreakOvertimeRow[]
  salaryConfig: SalaryConfig | null
  calendarBarber: BarberWithSchedules | null
  period: PeriodFilter
  setPeriod: (p: PeriodFilter) => void
  onBack: () => void
}) {
  const [exporting, setExporting] = useState(false)
  const [boletinFrom, setBoletinFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [boletinTo, setBoletinTo] = useState(() => new Date().toISOString().slice(0, 10))

  const filterDate = useMemo(() => getFilterDate(period), [period])

  // Filter visits for this barber + period (stats view)
  const visits = useMemo(
    () => serviceHistory.filter((v) => v.barber?.id === barber.id && new Date(v.completed_at) >= filterDate),
    [serviceHistory, barber.id, filterDate]
  )

  const events = useMemo(
    () => disciplinaryEvents.filter((e) => e.staff_id === barber.id && new Date(e.event_date) >= filterDate),
    [disciplinaryEvents, barber.id, filterDate]
  )

  const breakOvertimes = useMemo(
    () => breakOvertimeHistory.filter((b) => b.staff_id === barber.id),
    [breakOvertimeHistory, barber.id]
  )

  // Aggregated stats
  const totalCommission = visits.reduce((s, v) => s + v.commission_amount, 0)
  const absences = events.filter((e) => e.event_type === 'absence').length
  const lates = events.filter((e) => e.event_type === 'late').length
  const totalDeductions = events.reduce((s, e) => s + (e.deduction_amount ?? 0), 0)

  const isFixedSalary = salaryConfig?.scheme === 'fixed'
  const displayIncome = isFixedSalary ? salaryConfig.base_amount : totalCommission
  const incomeLabel = isFixedSalary ? 'Sueldo fijo' : 'Comisiones'

  // Progress chart data: cuts grouped by period buckets
  const progressData = useMemo(() => {
    const allBarberVisits = serviceHistory.filter((v) => v.barber?.id === barber.id && new Date(v.completed_at) >= filterDate)
    const buckets = new Map<string, number>()

    allBarberVisits.forEach((v) => {
      let key: string
      const d = new Date(v.completed_at)
      if (period === 'day') {
        const h = d.getHours()
        key = `${String(h).padStart(2, '0')}:00`
      } else if (period === 'week') {
        key = DAYS[d.getDay()]
      } else if (period === 'month') {
        key = String(d.getDate())
      } else {
        // 3m, 6m, 9m, 12m -> group by month
        key = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
      }
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    })

    // Sort
    if (period === 'day') {
      return Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, cortes]) => ({ label, cortes }))
    }
    if (period === 'week') {
      const order = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
      return order.map((d) => ({ label: d, cortes: buckets.get(d) ?? 0 }))
    }
    if (period === 'month') {
      return Array.from(buckets.entries())
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([label, cortes]) => ({ label, cortes }))
    }
    // multi-month: sort chronologically
    return allBarberVisits
      .reduce<Map<string, { date: Date; count: number }>>((acc, v) => {
        const d = new Date(v.completed_at)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
        const existing = acc.get(key)
        if (existing) {
          existing.count++
        } else {
          acc.set(key, { date: d, count: 1 })
        }
        return acc
      }, new Map())
      .entries()
      .toArray()
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, { date, count }]) => ({
        label: date.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
        cortes: count,
      }))
  }, [serviceHistory, barber.id, filterDate, period])

  // Daily breakdown
  const dailyBreakdown = useMemo(() => {
    const map = new Map<string, { cuts: number; revenue: number; commission: number }>()
    visits.forEach((v) => {
      const day = v.completed_at.slice(0, 10)
      const existing = map.get(day) ?? { cuts: 0, revenue: 0, commission: 0 }
      map.set(day, {
        cuts: existing.cuts + 1,
        revenue: existing.revenue + v.amount,
        commission: existing.commission + v.commission_amount,
      })
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, data]) => ({ date, ...data }))
  }, [visits])

  const roleName =
    barber.custom_role?.name ??
    (barber.role_id
      ? roles.find((r) => r.id === barber.role_id)?.name ?? roleLabels[barber.role]
      : roleLabels[barber.role])

  const periodLabel = getPeriodLabel(period)

  // --- PDF Export with custom date range ---
  async function exportPDF() {
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const fromDate = new Date(boletinFrom + 'T00:00:00')
      const toDate = new Date(boletinTo + 'T23:59:59')

      // Filter data for boletín date range
      const bVisits = serviceHistory.filter(
        (v) => v.barber?.id === barber.id && new Date(v.completed_at) >= fromDate && new Date(v.completed_at) <= toDate
      )
      const bEvents = disciplinaryEvents.filter(
        (e) => e.staff_id === barber.id && new Date(e.event_date) >= fromDate && new Date(e.event_date) <= toDate
      )

      const bCommission = bVisits.reduce((s, v) => s + v.commission_amount, 0)
      const bDeductions = bEvents.reduce((s, e) => s + (e.deduction_amount ?? 0), 0)
      const bAbsences = bEvents.filter((e) => e.event_type === 'absence').length
      const bLates = bEvents.filter((e) => e.event_type === 'late').length
      const bBreakOvertimes = breakOvertimeHistory.filter(
        (b) => b.staff_id === barber.id && b.actual_completed_at && new Date(b.actual_completed_at) >= fromDate && new Date(b.actual_completed_at) <= toDate
      )

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()

      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('Monaco Smart Barber', pageWidth / 2, 20, { align: 'center' })
      doc.setFontSize(14)
      doc.text('Boletín de Rendimiento', pageWidth / 2, 30, { align: 'center' })
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(barber.full_name, pageWidth / 2, 38, { align: 'center' })
      doc.setFontSize(9)
      doc.text(
        `${roleName} · ${barber.branch?.name ?? 'Sin sucursal'} · Período: ${formatDate(boletinFrom)} al ${formatDate(boletinTo)}`,
        pageWidth / 2, 44, { align: 'center' }
      )
      doc.text(`Generado: ${formatDateTime(new Date().toISOString())}`, pageWidth / 2, 50, { align: 'center' })

      doc.setDrawColor(200)
      doc.line(14, 54, pageWidth - 14, 54)

      let y = 62
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('Resumen', 14, y)
      y += 8

      const summaryData: string[][] = [
        ['Total de cortes', String(bVisits.length)],
      ]

      if (isFixedSalary) {
        summaryData.push(['Esquema', 'Sueldo fijo'])
        summaryData.push(['Sueldo', formatCurrency(salaryConfig!.base_amount)])
        summaryData.push(['Ingreso por comisión', '$0'])
      } else {
        summaryData.push(['Esquema', salaryConfig ? SCHEME_LABELS[salaryConfig.scheme] ?? salaryConfig.scheme : 'Comisión'])
        summaryData.push(['Comisión %', `${salaryConfig?.commission_pct ?? barber.commission_pct}%`])
        summaryData.push(['Ingreso por comisión', formatCurrency(bCommission)])
      }

      autoTable(doc, {
        startY: y,
        head: [],
        body: summaryData,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 }, 1: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 10

      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('Disciplina', 14, y)
      y += 8

      autoTable(doc, {
        startY: y,
        head: [],
        body: [
          ['Faltas', String(bAbsences)],
          ['Tardanzas', String(bLates)],
          ['Descansos excedidos', String(bBreakOvertimes.length)],
          ['Descuentos aplicados', bDeductions > 0 ? `-${formatCurrency(bDeductions)}` : '$0'],
        ],
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 }, 1: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 10

      // Daily breakdown for boletín
      const bDaily = new Map<string, { cuts: number; commission: number }>()
      bVisits.forEach((v) => {
        const day = v.completed_at.slice(0, 10)
        const ex = bDaily.get(day) ?? { cuts: 0, commission: 0 }
        bDaily.set(day, { cuts: ex.cuts + 1, commission: ex.commission + v.commission_amount })
      })
      const bDailyArr = Array.from(bDaily.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, d]) => ({ date, ...d }))

      if (bDailyArr.length > 0) {
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('Desglose por día', 14, y)
        y += 4

        const bodyRows = bDailyArr.map((d) => [formatDate(d.date), String(d.cuts), isFixedSalary ? '—' : formatCurrency(d.commission)])
        bodyRows.push(['TOTAL', String(bVisits.length), isFixedSalary ? '—' : formatCurrency(bCommission)])

        autoTable(doc, {
          startY: y,
          head: [['Fecha', 'Cortes', isFixedSalary ? '—' : 'Comisión']],
          body: bodyRows,
          theme: 'striped',
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
          columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
          margin: { left: 14, right: 14 },
        })
      }

      if (bEvents.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 10
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('Detalle de eventos disciplinarios', 14, y)
        y += 4
        autoTable(doc, {
          startY: y,
          head: [['Fecha', 'Tipo', '#', 'Consecuencia', 'Descuento']],
          body: bEvents.map((e) => [
            formatDate(e.event_date),
            EVENT_LABELS[e.event_type] ?? e.event_type,
            String(e.occurrence_number),
            CONSEQUENCE_LABELS[e.consequence_applied ?? 'none'] ?? '—',
            e.deduction_amount ? `-${formatCurrency(e.deduction_amount)}` : '—',
          ]),
          theme: 'striped',
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        })
      }

      if (bBreakOvertimes.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = ((doc as any).lastAutoTable?.finalY ?? y) + 10
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('Descansos excedidos', 14, y)
        y += 4
        autoTable(doc, {
          startY: y,
          head: [['Fecha', 'Tipo', 'Permitido', 'Exceso']],
          body: bBreakOvertimes.map((b) => [
            b.actual_completed_at ? formatDateTime(b.actual_completed_at) : '—',
            b.break_config?.name ?? 'Descanso',
            `${b.break_config?.duration_minutes ?? '?'} min`,
            `+${Math.round((b.overtime_seconds ?? 0) / 60)} min`,
          ]),
          theme: 'striped',
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold' },
          margin: { left: 14, right: 14 },
        })
      }

      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(150)
        doc.text(`Monaco Smart Barber · Página ${i} de ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' })
      }

      doc.save(`boletin-${barber.full_name.replace(/\s+/g, '-').toLowerCase()}-${boletinFrom}-${boletinTo}.pdf`)
    } catch (err) {
      console.error('Error al generar PDF:', err)
      alert('Error al generar el boletín PDF')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
          <ArrowLeft className="size-4 mr-1.5" />
          Volver a perfiles
        </Button>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Header card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <Avatar className="size-20 shrink-0">
              <AvatarImage src={barber.avatar_url ?? undefined} alt={barber.full_name} />
              <AvatarFallback className="text-2xl">{barber.full_name.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="text-center sm:text-left flex-1 min-w-0">
              <h2 className="text-xl font-bold">{barber.full_name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {roleName} · {barber.branch?.name ?? 'Sin sucursal'}
              </p>
              <div className="flex items-center gap-2 mt-2 justify-center sm:justify-start flex-wrap">
                <Badge variant={barber.is_active ? 'default' : 'secondary'}>
                  {barber.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
                {salaryConfig && (
                  <Badge variant="outline">{SCHEME_LABELS[salaryConfig.scheme] ?? salaryConfig.scheme}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Comisión: {salaryConfig?.commission_pct ?? barber.commission_pct}% · Desde: {formatDate(barber.created_at)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Scissors} label={`Cortes · ${periodLabel}`} value={String(visits.length)} />
        <StatCard icon={Banknote} label={incomeLabel} value={formatCurrency(displayIncome)} valueClass="text-green-600" />
        <StatCard icon={AlertTriangle} label="Faltas" value={String(absences)} valueClass={absences > 0 ? 'text-red-500' : undefined} />
        <StatCard icon={Clock} label="Tardanzas" value={String(lates)} valueClass={lates > 0 ? 'text-amber-500' : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Coffee} label="Descansos excedidos" value={String(breakOvertimes.length)} valueClass={breakOvertimes.length > 0 ? 'text-orange-500' : undefined} />
        <StatCard icon={Banknote} label="Descuentos" value={totalDeductions > 0 ? `-${formatCurrency(totalDeductions)}` : '$0'} valueClass={totalDeductions > 0 ? 'text-red-500' : undefined} />
        <StatCard icon={TrendingUp} label="Promedio cortes/día" value={dailyBreakdown.length > 0 ? (visits.length / dailyBreakdown.length).toFixed(1) : '0'} />
        <StatCard icon={Scissors} label="Mejor día" value={dailyBreakdown.length > 0 ? `${Math.max(...dailyBreakdown.map((d) => d.cuts))} cortes` : '—'} />
      </div>

      {/* Progress chart */}
      {progressData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4" />
              Progreso de cortes · {periodLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={progressData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                  content={({ active, payload, label }) => {
                    if (!active || !Array.isArray(payload) || payload.length === 0) return null
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-md">
                        <p className="text-sm font-medium">{String(label)}</p>
                        <p className="text-sm text-muted-foreground">{String(payload[0].value)} cortes</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="cortes" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Daily breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="size-4" />
            Desglose por día
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin actividad en este período</p>
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2">
                <span>Fecha</span>
                <span className="text-center">Cortes</span>
                <span className="text-right">{isFixedSalary ? 'Ingresos' : 'Comisión'}</span>
              </div>
              {dailyBreakdown.map((d) => (
                <div key={d.date} className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm rounded-md px-3 py-2 hover:bg-muted/50">
                  <span className="font-medium">{formatDate(d.date)}</span>
                  <span className="text-center">{d.cuts} cortes</span>
                  <span className="text-right text-green-600">{isFixedSalary ? formatCurrency(d.revenue) : formatCurrency(d.commission)}</span>
                </div>
              ))}
              <Separator className="my-1" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm font-bold px-3 py-2">
                <span>Total</span>
                <span className="text-center">{visits.length} cortes</span>
                <span className="text-right text-green-600">{formatCurrency(isFixedSalary ? visits.reduce((s, v) => s + v.amount, 0) : totalCommission)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendario laboral */}
      {calendarBarber && (
        <BarberCalendarSection barber={calendarBarber} />
      )}

      {/* Discipline events */}
      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4" />
              Eventos disciplinarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex items-start justify-between rounded-md border p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={event.event_type === 'absence' ? 'text-red-600 border-red-300' : 'text-amber-600 border-amber-300'}>
                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">#{event.occurrence_number}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(event.event_date)}</p>
                    {event.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{event.notes}</p>}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    {event.consequence_applied && (
                      <Badge variant="secondary" className="text-xs">{CONSEQUENCE_LABELS[event.consequence_applied] ?? event.consequence_applied}</Badge>
                    )}
                    {event.deduction_amount != null && event.deduction_amount > 0 && (
                      <p className="text-xs text-red-500 mt-1">-{formatCurrency(event.deduction_amount)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Break overtime */}
      {breakOvertimes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coffee className="size-4" />
              Descansos excedidos (últimos 30 días)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {breakOvertimes.map((br) => (
                <div key={br.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{br.break_config?.name ?? 'Descanso'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Permitido: {br.break_config?.duration_minutes ?? '?'} min</p>
                    {br.actual_completed_at && <p className="text-xs text-muted-foreground">{formatDateTime(br.actual_completed_at)}</p>}
                  </div>
                  <Badge variant="outline" className="text-orange-600 border-orange-300 shrink-0 ml-3">
                    +{Math.round((br.overtime_seconds ?? 0) / 60)} min
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Boletín export */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="size-4" />
            Exportar boletín PDF
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="grid gap-2 flex-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={boletinFrom} onChange={(e) => setBoletinFrom(e.target.value)} />
            </div>
            <div className="grid gap-2 flex-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={boletinTo} onChange={(e) => setBoletinTo(e.target.value)} />
            </div>
            <Button onClick={exportPDF} disabled={exporting || !boletinFrom || !boletinTo} className="shrink-0">
              <Download className="size-4 mr-1.5" />
              {exporting ? 'Generando...' : 'Descargar boletín'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// --- Calendar Section embedded in profile ---

function BarberCalendarSection({ barber }: { barber: BarberWithSchedules }) {
  const [, startTransition] = useTransition()
  const [scheduleDialog, setScheduleDialog] = useState<{ dayOfWeek: number } | null>(null)
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])
  const [exceptionDialog, setExceptionDialog] = useState(false)
  const [exceptionForm, setExceptionForm] = useState({ date: '', is_absent: true, reason: '' })

  const today = new Date().toISOString().slice(0, 10)

  function getSchedulesForDay(dayOfWeek: number): StaffSchedule[] {
    return (barber.staff_schedules ?? [])
      .filter((s) => s.day_of_week === dayOfWeek && s.is_active)
      .sort((a, b) => (a.block_index ?? 0) - (b.block_index ?? 0))
  }

  function handleDayToggle(dayOfWeek: number, currentlyActive: boolean) {
    if (currentlyActive) {
      startTransition(async () => {
        const { deleteSchedule } = await import('@/lib/actions/calendar')
        const r = await deleteSchedule(barber.id, dayOfWeek)
        if (r.error) toast.error(r.error)
      })
    } else {
      setScheduleBlocks([{ start_time: '09:00', end_time: '18:00' }])
      setScheduleDialog({ dayOfWeek })
    }
  }

  function openEditDialog(dayOfWeek: number) {
    const existing = getSchedulesForDay(dayOfWeek)
    setScheduleBlocks(
      existing.length > 0
        ? existing.map((s) => ({ start_time: s.start_time, end_time: s.end_time }))
        : [{ start_time: '09:00', end_time: '18:00' }]
    )
    setScheduleDialog({ dayOfWeek })
  }

  function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!scheduleDialog) return
    for (let i = 0; i < scheduleBlocks.length; i++) {
      const block = scheduleBlocks[i]
      if (block.start_time >= block.end_time) { toast.error(`Bloque ${i + 1}: entrada debe ser anterior a salida`); return }
      if (i > 0 && scheduleBlocks[i - 1].end_time > block.start_time) { toast.error(`Bloque ${i + 1}: se superpone`); return }
    }
    startTransition(async () => {
      const { saveScheduleBlocks } = await import('@/lib/actions/calendar')
      const r = await saveScheduleBlocks(barber.id, scheduleDialog.dayOfWeek, scheduleBlocks)
      if (r.error) toast.error(r.error)
      else { toast.success('Horario guardado'); setScheduleDialog(null) }
    })
  }

  function handleAddException(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const { upsertException } = await import('@/lib/actions/calendar')
      const r = await upsertException(barber.id, exceptionForm.date, exceptionForm.is_absent, exceptionForm.reason || null)
      if (r.error) toast.error(r.error)
      else { toast.success('Excepción guardada'); setExceptionDialog(false) }
    })
  }

  function handleDeleteException(exceptionDate: string) {
    startTransition(async () => {
      const { deleteException } = await import('@/lib/actions/calendar')
      const r = await deleteException(barber.id, exceptionDate)
      if (r.error) toast.error(r.error)
      else toast.success('Excepción eliminada')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="size-4" />
          Calendario laboral
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Weekly grid */}
        <div className="divide-y rounded-xl border bg-card">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const daySchedules = getSchedulesForDay(day)
            const isActive = daySchedules.length > 0
            return (
              <div key={day} className="flex items-center gap-4 px-4 py-3">
                <span className="w-8 text-sm font-medium">{DAYS[day]}</span>
                <Switch checked={isActive} onCheckedChange={() => handleDayToggle(day, isActive)} />
                {isActive ? (
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 flex-wrap"
                    onClick={() => openEditDialog(day)}
                  >
                    <span>{daySchedules.map((s) => `${s.start_time} – ${s.end_time}`).join('  ·  ')}</span>
                    {daySchedules.length > 1 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">cortado</Badge>}
                    <span className="text-xs text-primary">(editar)</span>
                  </button>
                ) : (
                  <span className="text-sm text-muted-foreground">No trabaja</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Exceptions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Excepciones próximas</p>
            <Button size="sm" variant="outline" onClick={() => { setExceptionForm({ date: today, is_absent: true, reason: '' }); setExceptionDialog(true) }}>
              <Plus className="size-4 mr-1.5" />
              Agregar
            </Button>
          </div>
          {barber.staff_schedule_exceptions.filter((e) => e.exception_date >= today).length === 0 ? (
            <div className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">Sin excepciones futuras.</div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {barber.staff_schedule_exceptions
                .filter((e) => e.exception_date >= today)
                .sort((a, b) => a.exception_date.localeCompare(b.exception_date))
                .map((exc) => (
                  <div key={exc.id} className="flex items-center gap-3 px-4 py-3">
                    <AlertTriangle className="size-4 text-yellow-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {new Date(exc.exception_date + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                      {exc.reason && <p className="text-xs text-muted-foreground">{exc.reason}</p>}
                    </div>
                    <Badge variant={exc.is_absent ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                      {exc.is_absent ? 'Ausente' : 'Horario especial'}
                    </Badge>
                    <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteException(exc.exception_date)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Schedule blocks dialog */}
        <Dialog open={!!scheduleDialog} onOpenChange={(o) => !o && setScheduleDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Horario del {scheduleDialog ? DAYS_FULL[scheduleDialog.dayOfWeek] : ''}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleScheduleSubmit} className="space-y-4">
              <div className="space-y-3">
                {scheduleBlocks.map((block, idx) => (
                  <div key={idx} className="space-y-2">
                    {scheduleBlocks.length > 1 && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">Bloque {idx + 1}</p>
                        <Button type="button" variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={() => setScheduleBlocks(scheduleBlocks.filter((_, i) => i !== idx))}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Entrada</Label>
                        <Input type="time" className="mt-1" value={block.start_time} onChange={(e) => setScheduleBlocks(scheduleBlocks.map((b, i) => i === idx ? { ...b, start_time: e.target.value } : b))} required />
                      </div>
                      <div>
                        <Label className="text-xs">Salida</Label>
                        <Input type="time" className="mt-1" value={block.end_time} onChange={(e) => setScheduleBlocks(scheduleBlocks.map((b, i) => i === idx ? { ...b, end_time: e.target.value } : b))} required />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => {
                const last = scheduleBlocks[scheduleBlocks.length - 1]
                const [h, m] = last.end_time.split(':').map(Number)
                setScheduleBlocks([...scheduleBlocks, { start_time: `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`, end_time: `${String(Math.min(h + 5, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}` }])
              }}>
                <Plus className="size-4 mr-1.5" />
                Agregar bloque (horario cortado)
              </Button>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setScheduleDialog(null)}>Cancelar</Button>
                <Button type="submit">Guardar horario</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Exception dialog */}
        <Dialog open={exceptionDialog} onOpenChange={setExceptionDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Agregar excepción</DialogTitle></DialogHeader>
            <form onSubmit={handleAddException} className="space-y-4">
              <div>
                <Label>Fecha</Label>
                <Input type="date" className="mt-1.5" min={today} value={exceptionForm.date} onChange={(e) => setExceptionForm((f) => ({ ...f, date: e.target.value }))} required />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={exceptionForm.is_absent} onCheckedChange={(v) => setExceptionForm((f) => ({ ...f, is_absent: v }))} />
                <Label>{exceptionForm.is_absent ? 'Ausente ese día' : 'Trabaja (horario especial)'}</Label>
              </div>
              <div>
                <Label>Motivo <span className="text-muted-foreground">(opcional)</span></Label>
                <Input className="mt-1.5" placeholder="Ej: Feriado, médico..." value={exceptionForm.reason} onChange={(e) => setExceptionForm((f) => ({ ...f, reason: e.target.value }))} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setExceptionDialog(false)}>Cancelar</Button>
                <Button type="submit" disabled={!exceptionForm.date}>Guardar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// --- Helpers ---

function StatCard({ icon: Icon, label, value, valueClass }: { icon: React.ElementType; label: string; value: string; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="size-3.5" />
          <span className="text-xs">{label}</span>
        </div>
        <p className={`text-xl font-bold ${valueClass ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
