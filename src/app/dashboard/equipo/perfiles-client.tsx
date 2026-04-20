'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Scissors,
  Banknote,
  TrendingUp,
  AlertTriangle,
  Coffee,
  CalendarDays,
  Download,
  Plus,
  X,
  Trash2,
  Search,
  Phone,
  Mail,
  Percent,
  ChevronRight,
  User,
  FileDown,
  Receipt,
  MessageSquare,
  Loader2,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
import { DateRangePicker } from '@/components/dashboard/date-range-picker'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { getPaymentBatchesGrouped, type GroupedBatchMonth, type SalaryReport, type SalaryPaymentBatch } from '@/lib/actions/salary'
import { prepareStaffContact } from '@/lib/actions/staff-contact'
import { exportPaymentReceiptPDF } from '@/lib/export'
import type {
  Staff,
  Role,
  DisciplinaryEventType,
  SalaryConfig,
  SalaryScheme,
  StaffSchedule,
  StaffScheduleException,
} from '@/lib/types/database'

// --- Tipos locales ---

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
  orgName?: string
}

// --- Constantes ---

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

type PeriodFilter = 'day' | 'week' | 'month' | '3months' | '6months' | '9months' | '12months' | 'custom'

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: '3months', label: '3 meses' },
  { value: '6months', label: '6 meses' },
  { value: '9months', label: '9 meses' },
  { value: '12months', label: '12 meses' },
  { value: 'custom', label: 'Personalizado' },
]

function getFilterDate(period: Exclude<PeriodFilter, 'custom'>): Date {
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

// --- Componente principal ---

export function PerfilesClient({
  barbers,
  roles,
  todayVisits,
  serviceHistory,
  disciplinaryEvents,
  breakOvertimeHistory,
  salaryConfigs,
  calendarBarbers,
  orgName = 'BarberOS',
}: PerfilesProps) {
  const { selectedBranchId } = useBranchStore()
  const [selectedBarber, setSelectedBarber] = useState<Staff | null>(null)
  const [period, setPeriod] = useState<PeriodFilter>('month')
  const [search, setSearch] = useState('')

  const filteredBarbers = useMemo(() => {
    const byBranch = selectedBranchId
      ? barbers.filter((b) => b.branch_id === selectedBranchId)
      : barbers
    if (!search.trim()) return byBranch
    const q = search.toLowerCase()
    return byBranch.filter((b) => b.full_name.toLowerCase().includes(q))
  }, [barbers, selectedBranchId, search])

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

  const salaryConfigMap = useMemo(() => {
    const map = new Map<string, SalaryConfig>()
    salaryConfigs.forEach((sc) => map.set(sc.staff_id, sc))
    return map
  }, [salaryConfigs])

  return (
    <div className="flex gap-4 h-auto lg:h-full">
      {/* Sidebar de barberos */}
      <div className={cn(
        'w-full lg:w-72 shrink-0 flex flex-col gap-3',
        selectedBarber ? 'hidden lg:flex' : 'flex'
      )}>
        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar barbero..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Lista de barberos */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filteredBarbers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <User className="size-8 opacity-30" />
              <p className="text-sm">Sin resultados</p>
            </div>
          )}
          {filteredBarbers.map((barber) => {
            const todayStats = todayStatsMap.get(barber.id)
            const monthly = monthlyStatsMap.get(barber.id)
            const roleName =
              barber.custom_role?.name ??
              (barber.role_id
                ? roles.find((r) => r.id === barber.role_id)?.name ?? roleLabels[barber.role]
                : roleLabels[barber.role])
            const isSelected = selectedBarber?.id === barber.id

            return (
              <button
                key={barber.id}
                onClick={() => setSelectedBarber(barber)}
                className={cn(
                  'w-full text-left rounded-lg border p-3 transition-all duration-150 group',
                  'hover:bg-muted/40 hover:border-border/80',
                  isSelected
                    ? 'bg-primary/5 border-primary/40 border-l-2 border-l-primary shadow-sm'
                    : 'border-border/50 bg-card'
                )}
              >
                <div className="flex items-center gap-2.5">
                  {/* Avatar con anillo de estado */}
                  <div className="relative shrink-0">
                    <Avatar className="size-10">
                      <AvatarImage src={barber.avatar_url ?? undefined} alt={barber.full_name} />
                      <AvatarFallback className="text-sm font-semibold">
                        {barber.full_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
                        barber.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                      )}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate leading-tight">{barber.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{roleName}</p>
                  </div>

                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-muted-foreground/40 transition-opacity',
                      isSelected ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100'
                    )}
                  />
                </div>

                {/* Stats del día */}
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border/40">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Scissors className="size-3" />
                    <span>{todayStats?.cuts ?? 0} hoy</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Banknote className="size-3" />
                    <span className="text-emerald-600 font-medium">
                      {monthly ? formatCurrency(monthly.commission) : '$0'}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Panel derecho */}
      <div className={cn(
        'flex-1 overflow-y-auto min-w-0',
        selectedBarber ? 'block' : 'hidden lg:block'
      )}>
        {selectedBarber && (
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden mb-3 -ml-1 text-muted-foreground"
            onClick={() => setSelectedBarber(null)}
          >
            <ChevronRight className="size-4 rotate-180 mr-1" />
            Volver a la lista
          </Button>
        )}
        {selectedBarber ? (
          <BarberDetailPanel
            barber={selectedBarber}
            roles={roles}
            todayStats={todayStatsMap.get(selectedBarber.id) ?? null}
            serviceHistory={serviceHistory}
            disciplinaryEvents={disciplinaryEvents}
            breakOvertimeHistory={breakOvertimeHistory}
            salaryConfig={salaryConfigMap.get(selectedBarber.id) ?? null}
            calendarBarber={calendarBarbers.find((cb) => cb.id === selectedBarber.id) ?? null}
            period={period}
            setPeriod={setPeriod}
            orgName={orgName}
          />
        ) : (
          <EmptyProfileState />
        )}
      </div>
    </div>
  )
}

// --- Estado vacío ---

function EmptyProfileState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <div className="rounded-full bg-muted/40 p-6">
        <User className="size-10 opacity-40" />
      </div>
      <div className="text-center">
        <p className="text-base font-medium">Seleccioná un barbero</p>
        <p className="text-sm mt-1 opacity-70">para ver su perfil completo y métricas</p>
      </div>
    </div>
  )
}

// --- Panel de detalle del barbero ---

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
  orgName,
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
  orgName: string
}) {
  const [exporting, setExporting] = useState(false)
  const [contactingStaff, setContactingStaff] = useState(false)
  const router = useRouter()

  const handleContactBarber = async () => {
    if (!barber.phone) {
      toast.error('Este miembro no tiene telefono cargado')
      return
    }
    setContactingStaff(true)
    try {
      const res = await prepareStaffContact(barber.id)
      if (res.error || !res.clientId) {
        toast.error(res.error ?? 'No se pudo preparar el contacto')
        return
      }
      const qs = new URLSearchParams({ clientId: res.clientId })
      if (res.tagId) qs.set('tag', res.tagId)
      router.push(`/dashboard/mensajeria?${qs.toString()}`)
    } catch (e) {
      console.error(e)
      toast.error('Error al abrir conversacion')
    } finally {
      setContactingStaff(false)
    }
  }

  const [boletinFrom, setBoletinFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [boletinTo, setBoletinTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false)
  const [salaryForm, setSalaryForm] = useState({
    scheme: salaryConfig?.scheme ?? 'commission',
    base_amount: String(salaryConfig?.base_amount ?? 0),
    commission_pct: String(salaryConfig?.commission_pct ?? barber.commission_pct),
  })
  const [, startSalaryTransition] = useTransition()

  // Historial de recibos de pago
  const [receiptHistory, setReceiptHistory] = useState<GroupedBatchMonth[]>([])
  const [loadingReceipts, setLoadingReceipts] = useState(false)

  useEffect(() => {
    if (!barber.id || !barber.branch_id) return
    setLoadingReceipts(true)
    getPaymentBatchesGrouped(barber.id, barber.branch_id)
      .then((res) => setReceiptHistory(res.data ?? []))
      .finally(() => setLoadingReceipts(false))
  }, [barber.id, barber.branch_id])

  async function handleProfileDownloadReceipt(batch: SalaryPaymentBatch, batchReports: SalaryReport[]) {
    try {
      await exportPaymentReceiptPDF({
        barberName: barber.full_name,
        batchDate: batch.paid_at,
        totalAmount: batch.total_amount,
        notes: batch.notes,
        reports: batchReports.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          report_date: r.report_date,
          notes: r.notes,
        })),
      })
    } catch {
      toast.error('Error al generar el recibo PDF')
    }
  }

  // Rango personalizado (cuando period === 'custom'). Default: hoy (día puntual).
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [customTo, setCustomTo] = useState(() => {
    const d = new Date()
    d.setHours(23, 59, 59, 999)
    return d
  })

  const { filterFrom, filterTo } = useMemo(() => {
    if (period === 'custom') {
      return { filterFrom: customFrom, filterTo: customTo }
    }
    const to = new Date()
    to.setHours(23, 59, 59, 999)
    return { filterFrom: getFilterDate(period), filterTo: to }
  }, [period, customFrom, customTo])

  // Alias para cálculos que solo miran el límite inferior
  const filterDate = filterFrom

  // Visitas filtradas por barbero + período
  const visits = useMemo(
    () =>
      serviceHistory.filter((v) => {
        if (v.barber?.id !== barber.id) return false
        const d = new Date(v.completed_at)
        return d >= filterFrom && d <= filterTo
      }),
    [serviceHistory, barber.id, filterFrom, filterTo]
  )

  // Visitas del mes actual (para KPIs siempre en contexto mensual)
  const monthVisits = useMemo(() => {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    return serviceHistory.filter(
      (v) => v.barber?.id === barber.id && new Date(v.completed_at) >= startOfMonth
    )
  }, [serviceHistory, barber.id])

  // Visitas del mes anterior (para tendencia)
  const prevMonthVisits = useMemo(() => {
    const now = new Date()
    const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endPrev = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    return serviceHistory.filter((v) => {
      if (!v.barber || v.barber.id !== barber.id) return false
      const d = new Date(v.completed_at)
      return d >= startPrev && d <= endPrev
    })
  }, [serviceHistory, barber.id])

  const events = useMemo(
    () =>
      disciplinaryEvents.filter((e) => {
        if (e.staff_id !== barber.id) return false
        const d = new Date(e.event_date)
        return d >= filterFrom && d <= filterTo
      }),
    [disciplinaryEvents, barber.id, filterFrom, filterTo]
  )

  const breakOvertimes = useMemo(
    () => breakOvertimeHistory.filter((b) => b.staff_id === barber.id),
    [breakOvertimeHistory, barber.id]
  )

  // Stats agregados del período seleccionado
  const totalCommission = visits.reduce((s, v) => s + v.commission_amount, 0)
  const absences = events.filter((e) => e.event_type === 'absence').length
  const lates = events.filter((e) => e.event_type === 'late').length
  const totalDeductions = events.reduce((s, e) => s + (e.deduction_amount ?? 0), 0)

  const isFixedSalary = salaryConfig?.scheme === 'fixed'
  const displayIncome = isFixedSalary ? salaryConfig.base_amount : totalCommission
  const incomeLabel = isFixedSalary ? 'Sueldo fijo' : 'Comisiones'

  // KPIs del mes
  const monthRevenue = monthVisits.reduce((s, v) => s + v.amount, 0)
  const monthCommission = monthVisits.reduce((s, v) => s + v.commission_amount, 0)
  const monthCuts = monthVisits.length
  const avgTicket = monthCuts > 0 ? monthRevenue / monthCuts : 0
  const prevMonthCuts = prevMonthVisits.length
  const prevMonthCommission = prevMonthVisits.reduce((s, v) => s + v.commission_amount, 0)

  // Datos para gráfico de ingresos por mes (últimos 6 meses)
  const monthlyRevenueData = useMemo(() => {
    const now = new Date()
    const buckets = new Map<string, { label: string; ingresos: number; cortes: number; date: Date }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('es-AR', { month: 'short' })
      buckets.set(key, { label, ingresos: 0, cortes: 0, date: d })
    }
    serviceHistory.forEach((v) => {
      if (!v.barber || v.barber.id !== barber.id) return
      const d = new Date(v.completed_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const existing = buckets.get(key)
      if (existing) {
        existing.ingresos += v.commission_amount
        existing.cortes += 1
      }
    })
    return Array.from(buckets.values()).map(({ label, ingresos, cortes }) => ({ label, ingresos, cortes }))
  }, [serviceHistory, barber.id])

  // Datos para gráfico por día de la semana
  const dayOfWeekData = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0] // Dom=0 ... Sáb=6
    const startDate = getFilterDate('3months')
    serviceHistory.forEach((v) => {
      if (!v.barber || v.barber.id !== barber.id) return
      const d = new Date(v.completed_at)
      if (d >= startDate) counts[d.getDay()]++
    })
    // Ordenar Lun→Dom
    const order = [1, 2, 3, 4, 5, 6, 0]
    const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    return order.map((dayIdx, i) => ({ label: labels[i], cortes: counts[dayIdx] }))
  }, [serviceHistory, barber.id])

  // Progreso de cortes según período seleccionado (para el gráfico de actividad)
  const progressData = useMemo(() => {
    const allBarberVisits = serviceHistory.filter((v) => {
      if (v.barber?.id !== barber.id) return false
      const d = new Date(v.completed_at)
      return d >= filterFrom && d <= filterTo
    })
    const buckets = new Map<string, number>()

    // Determinar granularidad efectiva
    const rangeMs = filterTo.getTime() - filterFrom.getTime()
    const rangeDays = rangeMs / 86400000
    let effective: 'hour' | 'dayOfWeek' | 'dayOfMonth' | 'month'
    if (period === 'day' || rangeDays <= 1.5) effective = 'hour'
    else if (period === 'week' || rangeDays <= 8) effective = 'dayOfWeek'
    else if (period === 'month' || rangeDays <= 62) effective = 'dayOfMonth'
    else effective = 'month'

    allBarberVisits.forEach((v) => {
      let key: string
      const d = new Date(v.completed_at)
      if (effective === 'hour') {
        const h = d.getHours()
        key = `${String(h).padStart(2, '0')}:00`
      } else if (effective === 'dayOfWeek') {
        key = DAYS[d.getDay()]
      } else if (effective === 'dayOfMonth') {
        key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      } else {
        key = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
      }
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    })

    if (effective === 'hour') {
      return Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, cortes]) => ({ label, cortes }))
    }
    if (effective === 'dayOfWeek') {
      const order = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
      return order.map((d) => ({ label: d, cortes: buckets.get(d) ?? 0 }))
    }
    if (effective === 'dayOfMonth') {
      return Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, cortes]) => ({ label, cortes }))
    }
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
  }, [serviceHistory, barber.id, filterFrom, filterTo, period])

  // Desglose diario
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

  const commissionPct = salaryConfig?.commission_pct ?? barber.commission_pct

  // --- Lógica de edición de comisión/salario ---
  function handleSalarySubmit(e: React.FormEvent) {
    e.preventDefault()
    startSalaryTransition(async () => {
      const { upsertSalaryConfig } = await import('@/lib/actions/salary')
      const r = await upsertSalaryConfig(
        barber.id,
        salaryForm.scheme as SalaryScheme,
        Number(salaryForm.base_amount),
        Number(salaryForm.commission_pct)
      )
      if (r?.error) toast.error(r.error)
      else {
        toast.success('Configuración salarial guardada')
        setSalaryDialogOpen(false)
      }
    })
  }

  // --- Export PDF ---
  async function exportPDF() {
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const fromDate = new Date(boletinFrom + 'T00:00:00')
      const toDate = new Date(boletinTo + 'T23:59:59')

      const bVisits = serviceHistory.filter(
        (v) =>
          v.barber?.id === barber.id &&
          new Date(v.completed_at) >= fromDate &&
          new Date(v.completed_at) <= toDate
      )
      const bEvents = disciplinaryEvents.filter(
        (e) =>
          e.staff_id === barber.id &&
          new Date(e.event_date) >= fromDate &&
          new Date(e.event_date) <= toDate
      )

      const bCommission = bVisits.reduce((s, v) => s + v.commission_amount, 0)
      const bDeductions = bEvents.reduce((s, e) => s + (e.deduction_amount ?? 0), 0)
      const bAbsences = bEvents.filter((e) => e.event_type === 'absence').length
      const bLates = bEvents.filter((e) => e.event_type === 'late').length
      const bBreakOvertimes = breakOvertimeHistory.filter(
        (b) =>
          b.staff_id === barber.id &&
          b.actual_completed_at &&
          new Date(b.actual_completed_at) >= fromDate &&
          new Date(b.actual_completed_at) <= toDate
      )

      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()

      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text(orgName, pageWidth / 2, 20, { align: 'center' })
      doc.setFontSize(14)
      doc.text('Boletín de Rendimiento', pageWidth / 2, 30, { align: 'center' })
      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      doc.text(barber.full_name, pageWidth / 2, 38, { align: 'center' })
      doc.setFontSize(9)
      doc.text(
        `${roleName} · ${barber.branch?.name ?? 'Sin sucursal'} · Período: ${formatDate(boletinFrom)} al ${formatDate(boletinTo)}`,
        pageWidth / 2,
        44,
        { align: 'center' }
      )
      doc.text(
        `Generado: ${formatDateTime(new Date().toISOString())}`,
        pageWidth / 2,
        50,
        { align: 'center' }
      )

      doc.setDrawColor(200)
      doc.line(14, 54, pageWidth - 14, 54)

      let y = 62
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text('Resumen', 14, y)
      y += 8

      const summaryData: string[][] = [['Total de cortes', String(bVisits.length)]]

      if (isFixedSalary) {
        summaryData.push(['Esquema', 'Sueldo fijo'])
        summaryData.push(['Sueldo', formatCurrency(salaryConfig!.base_amount)])
        summaryData.push(['Ingreso por comisión', '$0'])
      } else {
        summaryData.push([
          'Esquema',
          salaryConfig ? SCHEME_LABELS[salaryConfig.scheme] ?? salaryConfig.scheme : 'Comisión',
        ])
        summaryData.push(['Comisión %', `${commissionPct}%`])
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

      const bDaily = new Map<string, { cuts: number; commission: number }>()
      bVisits.forEach((v) => {
        const day = v.completed_at.slice(0, 10)
        const ex = bDaily.get(day) ?? { cuts: 0, commission: 0 }
        bDaily.set(day, { cuts: ex.cuts + 1, commission: ex.commission + v.commission_amount })
      })
      const bDailyArr = Array.from(bDaily.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, d]) => ({ date, ...d }))

      if (bDailyArr.length > 0) {
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text('Desglose por día', 14, y)
        y += 4

        const bodyRows = bDailyArr.map((d) => [
          formatDate(d.date),
          String(d.cuts),
          isFixedSalary ? '—' : formatCurrency(d.commission),
        ])
        bodyRows.push([
          'TOTAL',
          String(bVisits.length),
          isFixedSalary ? '—' : formatCurrency(bCommission),
        ])

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
        doc.text(
          `${orgName} · Página ${i} de ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        )
      }

      doc.save(
        `boletin-${barber.full_name.replace(/\s+/g, '-').toLowerCase()}-${boletinFrom}-${boletinTo}.pdf`
      )
    } catch (err) {
      console.error('Error al generar PDF:', err)
      alert('Error al generar el boletín PDF')
    } finally {
      setExporting(false)
    }
  }

  const disciplineStatus =
    absences >= 2 || lates >= 3 ? 'danger' : absences >= 1 || lates >= 1 ? 'warning' : 'clean'

  return (
    <div className="space-y-5 pb-6">
      {/* Header del perfil */}
      <div className="rounded-xl border bg-gradient-to-r from-primary/8 via-primary/3 to-transparent p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="relative shrink-0">
            <Avatar className="size-16">
              <AvatarImage src={barber.avatar_url ?? undefined} alt={barber.full_name} />
              <AvatarFallback className="text-2xl font-bold">
                {barber.full_name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background',
                barber.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              )}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-xl font-bold">{barber.full_name}</h2>
              <Badge
                variant={barber.is_active ? 'default' : 'secondary'}
                className="text-xs"
              >
                {barber.is_active ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {roleName} · {barber.branch?.name ?? 'Sin sucursal'}
            </p>
            <div className="flex flex-wrap gap-3 mt-2.5">
              {barber.phone && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Phone className="size-3" />
                  {barber.phone}
                </span>
              )}
              {barber.email && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="size-3" />
                  {barber.email}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3" />
                Desde {formatDate(barber.created_at)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {barber.phone && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1.5 border-green-500/40 bg-green-500/10 text-green-500 hover:bg-green-500/20 hover:text-green-400"
                onClick={handleContactBarber}
                disabled={contactingStaff}
              >
                {contactingStaff ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="size-3.5" />
                )}
                Contactar
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8"
              onClick={() => {
                setSalaryForm({
                  scheme: salaryConfig?.scheme ?? 'commission',
                  base_amount: String(salaryConfig?.base_amount ?? 0),
                  commission_pct: String(commissionPct),
                })
                setSalaryDialogOpen(true)
              }}
            >
              Editar comisión
            </Button>
          </div>
        </div>
      </div>

      {/* KPIs del mes */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Banknote}
          label="Ingresos del mes"
          value={formatCurrency(isFixedSalary ? salaryConfig!.base_amount : monthCommission)}
          subtext={
            !isFixedSalary && prevMonthCommission > 0
              ? `${monthCommission >= prevMonthCommission ? '+' : ''}${Math.round(((monthCommission - prevMonthCommission) / prevMonthCommission) * 100)}% vs mes ant.`
              : undefined
          }
          subtextPositive={monthCommission >= prevMonthCommission}
          colorClass="text-emerald-600"
        />
        <KpiCard
          icon={Scissors}
          label="Cortes del mes"
          value={String(monthCuts)}
          subtext={
            prevMonthCuts > 0
              ? `${monthCuts >= prevMonthCuts ? '+' : ''}${monthCuts - prevMonthCuts} vs mes ant.`
              : undefined
          }
          subtextPositive={monthCuts >= prevMonthCuts}
        />
        <KpiCard
          icon={TrendingUp}
          label="Ticket promedio"
          value={formatCurrency(avgTicket)}
          subtext={monthCuts > 0 ? `sobre ${monthCuts} cortes` : 'Sin cortes este mes'}
        />
        <KpiCard
          icon={Percent}
          label="Comisión"
          value={`${commissionPct}%`}
          subtext={salaryConfig ? SCHEME_LABELS[salaryConfig.scheme] : 'Comisión directa'}
        />
      </div>

      {/* Selector de período + gráfico de actividad */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4" />
              Actividad de cortes
            </CardTitle>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {period === 'custom' && (
            <div className="mt-3">
              <DateRangePicker
                from={customFrom}
                to={customTo}
                onChange={(f, t) => {
                  setCustomFrom(f)
                  setCustomTo(t)
                }}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Seleccioná un día puntual o un rango. Click simple para día único, doble click para rango.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {progressData.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Sin actividad en este período
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={progressData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                  content={({ active, payload, label }) => {
                    if (!active || !Array.isArray(payload) || payload.length === 0) return null
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-md">
                        <p className="text-sm font-medium">{String(label)}</p>
                        <p className="text-sm text-muted-foreground">
                          {String(payload[0].value)} cortes
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="cortes" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Fila: ingresos mensuales + distribución por día */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Ingresos últimos 6 meses */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Banknote className="size-4" />
              Ingresos por mes (últimos 6 meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={monthlyRevenueData}
                margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                  content={({ active, payload, label }) => {
                    if (!active || !Array.isArray(payload) || payload.length === 0) return null
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-md">
                        <p className="text-sm font-medium capitalize">{String(label)}</p>
                        <p className="text-sm text-emerald-600 font-semibold">
                          {formatCurrency(Number(payload[0]?.value ?? 0))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {String(payload[1]?.value ?? 0)} cortes
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="ingresos" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cortes" fill="transparent" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Distribución por día de semana */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarDays className="size-4" />
              Cortes por día (últimos 3 meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart
                data={dayOfWeekData}
                margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                  content={({ active, payload, label }) => {
                    if (!active || !Array.isArray(payload) || payload.length === 0) return null
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-md">
                        <p className="text-sm font-medium">{String(label)}</p>
                        <p className="text-sm text-muted-foreground">
                          {String(payload[0].value)} cortes
                        </p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="cortes" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Fila: Estadísticas del período + Disciplina */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Stats del período */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scissors className="size-4" />
              Estadísticas · {getPeriodLabel(period)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat
                label={isFixedSalary ? 'Sueldo fijo' : 'Comisiones'}
                value={formatCurrency(displayIncome)}
                valueClass="text-emerald-600"
              />
              <MiniStat label="Cortes" value={String(visits.length)} />
              <MiniStat
                label="Promedio/día"
                value={
                  dailyBreakdown.length > 0
                    ? (visits.length / dailyBreakdown.length).toFixed(1)
                    : '0'
                }
              />
              <MiniStat
                label="Mejor día"
                value={
                  dailyBreakdown.length > 0
                    ? `${Math.max(...dailyBreakdown.map((d) => d.cuts))} cortes`
                    : '—'
                }
              />
              {totalDeductions > 0 && (
                <MiniStat
                  label="Descuentos"
                  value={`-${formatCurrency(totalDeductions)}`}
                  valueClass="text-red-500"
                />
              )}
              <MiniStat
                label="Descansos exc."
                value={String(breakOvertimes.length)}
                valueClass={breakOvertimes.length > 0 ? 'text-orange-500' : undefined}
              />
            </div>
          </CardContent>
        </Card>

        {/* Disciplina */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="size-4" />
                Disciplina · {getPeriodLabel(period)}
              </CardTitle>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  disciplineStatus === 'clean' &&
                    'border-emerald-400 text-emerald-600',
                  disciplineStatus === 'warning' &&
                    'border-amber-400 text-amber-600',
                  disciplineStatus === 'danger' &&
                    'border-red-400 text-red-600'
                )}
              >
                {disciplineStatus === 'clean'
                  ? 'Limpio'
                  : disciplineStatus === 'warning'
                  ? 'Atención'
                  : 'Sancionado'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {events.length === 0 && breakOvertimes.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
                <span className="text-emerald-500">✓</span> Sin eventos en este período
              </div>
            ) : (
              <div className="space-y-2">
                {absences > 0 && (
                  <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40 px-3 py-2">
                    <span className="text-sm text-red-700 dark:text-red-400">
                      Faltas
                    </span>
                    <Badge variant="destructive" className="text-xs">
                      {absences}
                    </Badge>
                  </div>
                )}
                {lates > 0 && (
                  <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/40 px-3 py-2">
                    <span className="text-sm text-amber-700 dark:text-amber-400">
                      Tardanzas
                    </span>
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-400 text-amber-600"
                    >
                      {lates}
                    </Badge>
                  </div>
                )}
                {breakOvertimes.length > 0 && (
                  <div className="flex items-center justify-between rounded-md border border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 dark:border-orange-900/40 px-3 py-2">
                    <span className="text-sm text-orange-700 dark:text-orange-400">
                      Descansos excedidos
                    </span>
                    <Badge
                      variant="outline"
                      className="text-xs border-orange-400 text-orange-600"
                    >
                      {breakOvertimes.length}
                    </Badge>
                  </div>
                )}
                {/* Últimos eventos detallados */}
                {events.slice(0, 3).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start justify-between rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            event.event_type === 'absence'
                              ? 'text-red-600 border-red-300 text-xs'
                              : 'text-amber-600 border-amber-300 text-xs'
                          }
                        >
                          {EVENT_LABELS[event.event_type] ?? event.event_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          #{event.occurrence_number}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDate(event.event_date)}
                      </p>
                      {event.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5 italic">
                          {event.notes}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      {event.consequence_applied && (
                        <Badge variant="secondary" className="text-xs">
                          {CONSEQUENCE_LABELS[event.consequence_applied] ??
                            event.consequence_applied}
                        </Badge>
                      )}
                      {event.deduction_amount != null && event.deduction_amount > 0 && (
                        <p className="text-xs text-red-500 mt-1">
                          -{formatCurrency(event.deduction_amount)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desglose diario */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="size-4" />
            Desglose por día · {getPeriodLabel(period)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Sin actividad en este período
            </p>
          ) : (
            <div className="space-y-1">
              <div className="hidden sm:grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-3 pb-2">
                <span>Fecha</span>
                <span className="text-center">Cortes</span>
                <span className="text-right">
                  {isFixedSalary ? 'Ingresos' : 'Comisión'}
                </span>
              </div>
              {dailyBreakdown.map((d) => (
                <div
                  key={d.date}
                  className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm rounded-md px-3 py-2 hover:bg-muted/50"
                >
                  <span className="font-medium">{formatDate(d.date)}</span>
                  <span className="text-center">{d.cuts} cortes</span>
                  <span className="text-right text-emerald-600">
                    {isFixedSalary
                      ? formatCurrency(d.revenue)
                      : formatCurrency(d.commission)}
                  </span>
                </div>
              ))}
              <Separator className="my-1" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm font-bold px-3 py-2">
                <span>Total</span>
                <span className="text-center">{visits.length} cortes</span>
                <span className="text-right text-emerald-600">
                  {formatCurrency(
                    isFixedSalary
                      ? visits.reduce((s, v) => s + v.amount, 0)
                      : totalCommission
                  )}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendario laboral */}
      {calendarBarber && <BarberCalendarSection barber={calendarBarber} />}

      {/* Descansos excedidos */}
      {breakOvertimes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Coffee className="size-4" />
              Descansos excedidos (últimos 30 días)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {breakOvertimes.map((br) => (
                <div
                  key={br.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{br.break_config?.name ?? 'Descanso'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Permitido: {br.break_config?.duration_minutes ?? '?'} min
                    </p>
                    {br.actual_completed_at && (
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(br.actual_completed_at)}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-orange-600 border-orange-300 shrink-0 ml-3"
                  >
                    +{Math.round((br.overtime_seconds ?? 0) / 60)} min
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuración salarial */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Banknote className="size-4" />
              Configuración salarial
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 px-2"
              onClick={() => {
                setSalaryForm({
                  scheme: salaryConfig?.scheme ?? 'commission',
                  base_amount: String(salaryConfig?.base_amount ?? 0),
                  commission_pct: String(commissionPct),
                })
                setSalaryDialogOpen(true)
              }}
            >
              Editar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniStat
              label="Esquema"
              value={
                salaryConfig
                  ? SCHEME_LABELS[salaryConfig.scheme] ?? salaryConfig.scheme
                  : 'Comisión'
              }
            />
            <MiniStat
              label="Comisión %"
              value={`${commissionPct}%`}
              valueClass="text-primary"
            />
            {salaryConfig && (salaryConfig.scheme === 'fixed' || salaryConfig.scheme === 'hybrid') && (
              <MiniStat
                label="Base mensual"
                value={formatCurrency(salaryConfig.base_amount)}
                valueClass="text-emerald-600"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Exportar boletín PDF */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="size-4" />
            Exportar boletín PDF
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid gap-1.5 flex-1">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={boletinFrom}
                onChange={(e) => setBoletinFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5 flex-1">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={boletinTo}
                onChange={(e) => setBoletinTo(e.target.value)}
              />
            </div>
            <Button
              onClick={exportPDF}
              disabled={exporting || !boletinFrom || !boletinTo}
              className="shrink-0"
            >
              <Download className="size-4 mr-1.5" />
              {exporting ? 'Generando...' : 'Descargar boletín'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Historial de recibos de pago */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="size-4" />
            Historial de recibos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingReceipts ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          ) : receiptHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay recibos de pago registrados
            </p>
          ) : (
            <Accordion type="single" collapsible className="space-y-2">
              {receiptHistory.map((month) => (
                <AccordionItem
                  key={month.monthKey}
                  value={month.monthKey}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <AccordionTrigger className="hover:no-underline px-3 py-2.5">
                    <div className="flex items-center justify-between flex-1 mr-2">
                      <span className="text-sm font-medium">{month.monthLabel}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(month.totalAmount)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-0">
                    <Separator />
                    {month.weeks.map((week) => (
                      <div key={week.weekStart} className="border-b border-border last:border-b-0">
                        <div className="px-3 py-1.5 bg-muted/20">
                          <span className="text-xs font-medium text-muted-foreground">
                            {week.weekLabel}
                          </span>
                        </div>
                        <div className="divide-y divide-border">
                          {week.batches.map(({ batch, reports: batchReports }) => (
                            <div
                              key={batch.id}
                              className="flex items-center justify-between px-3 py-2"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">
                                  {new Date(batch.paid_at).toLocaleDateString('es-AR', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </p>
                                {batch.notes && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {batch.notes}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold tabular-nums">
                                  {formatCurrency(batch.total_amount)}
                                </span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-7 text-muted-foreground hover:text-primary"
                                  onClick={() => handleProfileDownloadReceipt(batch, batchReports)}
                                  title="Descargar recibo PDF"
                                >
                                  <FileDown className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Dialog de edición salarial */}
      <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar configuración salarial</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSalarySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Esquema salarial</Label>
              <Select
                value={salaryForm.scheme}
                onValueChange={(v) => setSalaryForm((f) => ({ ...f, scheme: v as SalaryScheme }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="commission">Comisión</SelectItem>
                  <SelectItem value="fixed">Sueldo fijo</SelectItem>
                  <SelectItem value="hybrid">Híbrido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(salaryForm.scheme === 'fixed' || salaryForm.scheme === 'hybrid') && (
              <div className="space-y-2">
                <Label>Monto base mensual</Label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  value={salaryForm.base_amount}
                  onChange={(e) =>
                    setSalaryForm((f) => ({ ...f, base_amount: e.target.value }))
                  }
                  placeholder="Ej: 150000"
                />
              </div>
            )}
            {(salaryForm.scheme === 'commission' || salaryForm.scheme === 'hybrid') && (
              <div className="space-y-2">
                <Label>Comisión %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={salaryForm.commission_pct}
                  onChange={(e) =>
                    setSalaryForm((f) => ({ ...f, commission_pct: e.target.value }))
                  }
                  placeholder="Ej: 40"
                />
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSalaryDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// --- Sección de calendario laboral ---

function BarberCalendarSection({ barber }: { barber: BarberWithSchedules }) {
  const [, startTransition] = useTransition()
  const [scheduleDialog, setScheduleDialog] = useState<{ dayOfWeek: number } | null>(null)
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])
  const [exceptionDialog, setExceptionDialog] = useState(false)
  const [exceptionForm, setExceptionForm] = useState({
    date: '',
    is_absent: true,
    reason: '',
  })

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
      if (block.start_time >= block.end_time) {
        toast.error(`Bloque ${i + 1}: entrada debe ser anterior a salida`)
        return
      }
      if (i > 0 && scheduleBlocks[i - 1].end_time > block.start_time) {
        toast.error(`Bloque ${i + 1}: se superpone`)
        return
      }
    }
    startTransition(async () => {
      const { saveScheduleBlocks } = await import('@/lib/actions/calendar')
      const r = await saveScheduleBlocks(
        barber.id,
        scheduleDialog.dayOfWeek,
        scheduleBlocks
      )
      if (r.error) toast.error(r.error)
      else {
        toast.success('Horario guardado')
        setScheduleDialog(null)
      }
    })
  }

  function handleAddException(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const { upsertException } = await import('@/lib/actions/calendar')
      const r = await upsertException(
        barber.id,
        exceptionForm.date,
        exceptionForm.is_absent,
        exceptionForm.reason || null
      )
      if (r.error) toast.error(r.error)
      else {
        toast.success('Excepción guardada')
        setExceptionDialog(false)
      }
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
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarDays className="size-4" />
          Calendario laboral
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Grilla semanal */}
        <div className="divide-y rounded-xl border bg-card">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const daySchedules = getSchedulesForDay(day)
            const isActive = daySchedules.length > 0
            return (
              <div key={day} className="flex items-center gap-4 px-4 py-3">
                <span className="w-8 text-sm font-medium">{DAYS[day]}</span>
                <Switch
                  checked={isActive}
                  onCheckedChange={() => handleDayToggle(day, isActive)}
                />
                {isActive ? (
                  <button
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 flex-wrap"
                    onClick={() => openEditDialog(day)}
                  >
                    <span>
                      {daySchedules
                        .map((s) => `${s.start_time} – ${s.end_time}`)
                        .join('  ·  ')}
                    </span>
                    {daySchedules.length > 1 && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0"
                      >
                        cortado
                      </Badge>
                    )}
                    <span className="text-xs text-primary">(editar)</span>
                  </button>
                ) : (
                  <span className="text-sm text-muted-foreground">No trabaja</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Excepciones */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Excepciones próximas
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setExceptionForm({ date: today, is_absent: true, reason: '' })
                setExceptionDialog(true)
              }}
            >
              <Plus className="size-4 mr-1.5" />
              Agregar
            </Button>
          </div>
          {barber.staff_schedule_exceptions.filter((e) => e.exception_date >= today)
            .length === 0 ? (
            <div className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">
              Sin excepciones futuras.
            </div>
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
                        {new Date(exc.exception_date + 'T12:00:00').toLocaleDateString(
                          'es-AR',
                          { weekday: 'long', day: 'numeric', month: 'long' }
                        )}
                      </p>
                      {exc.reason && (
                        <p className="text-xs text-muted-foreground">{exc.reason}</p>
                      )}
                    </div>
                    <Badge
                      variant={exc.is_absent ? 'destructive' : 'secondary'}
                      className="text-xs shrink-0"
                    >
                      {exc.is_absent ? 'Ausente' : 'Horario especial'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteException(exc.exception_date)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Dialog de bloques de horario */}
        <Dialog open={!!scheduleDialog} onOpenChange={(o) => !o && setScheduleDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                Horario del{' '}
                {scheduleDialog ? DAYS_FULL[scheduleDialog.dayOfWeek] : ''}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleScheduleSubmit} className="space-y-4">
              <div className="space-y-3">
                {scheduleBlocks.map((block, idx) => (
                  <div key={idx} className="space-y-2">
                    {scheduleBlocks.length > 1 && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">
                          Bloque {idx + 1}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setScheduleBlocks(scheduleBlocks.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Entrada</Label>
                        <Input
                          type="time"
                          className="mt-1"
                          value={block.start_time}
                          onChange={(e) =>
                            setScheduleBlocks(
                              scheduleBlocks.map((b, i) =>
                                i === idx ? { ...b, start_time: e.target.value } : b
                              )
                            )
                          }
                          required
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Salida</Label>
                        <Input
                          type="time"
                          className="mt-1"
                          value={block.end_time}
                          onChange={(e) =>
                            setScheduleBlocks(
                              scheduleBlocks.map((b, i) =>
                                i === idx ? { ...b, end_time: e.target.value } : b
                              )
                            )
                          }
                          required
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  const last = scheduleBlocks[scheduleBlocks.length - 1]
                  const [h, m] = last.end_time.split(':').map(Number)
                  setScheduleBlocks([
                    ...scheduleBlocks,
                    {
                      start_time: `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                      end_time: `${String(Math.min(h + 5, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
                    },
                  ])
                }}
              >
                <Plus className="size-4 mr-1.5" />
                Agregar bloque (horario cortado)
              </Button>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScheduleDialog(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit">Guardar horario</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Dialog de excepción */}
        <Dialog open={exceptionDialog} onOpenChange={setExceptionDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar excepción</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddException} className="space-y-4">
              <div>
                <Label>Fecha</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  min={today}
                  value={exceptionForm.date}
                  onChange={(e) =>
                    setExceptionForm((f) => ({ ...f, date: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={exceptionForm.is_absent}
                  onCheckedChange={(v) =>
                    setExceptionForm((f) => ({ ...f, is_absent: v }))
                  }
                />
                <Label>
                  {exceptionForm.is_absent
                    ? 'Ausente ese día'
                    : 'Trabaja (horario especial)'}
                </Label>
              </div>
              <div>
                <Label>
                  Motivo{' '}
                  <span className="text-muted-foreground">(opcional)</span>
                </Label>
                <Input
                  className="mt-1.5"
                  placeholder="Ej: Feriado, médico..."
                  value={exceptionForm.reason}
                  onChange={(e) =>
                    setExceptionForm((f) => ({ ...f, reason: e.target.value }))
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setExceptionDialog(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={!exceptionForm.date}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// --- Helpers de UI ---

function KpiCard({
  icon: Icon,
  label,
  value,
  subtext,
  subtextPositive,
  colorClass,
}: {
  icon: React.ElementType
  label: string
  value: string
  subtext?: string
  subtextPositive?: boolean
  colorClass?: string
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
          <Icon className="size-3.5 shrink-0" />
          <span className="text-xs truncate">{label}</span>
        </div>
        <p className={cn('text-2xl font-bold tracking-tight', colorClass)}>{value}</p>
        {subtext && (
          <p
            className={cn(
              'text-xs mt-1',
              subtextPositive !== undefined
                ? subtextPositive
                  ? 'text-emerald-600'
                  : 'text-red-500'
                : 'text-muted-foreground'
            )}
          >
            {subtext}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function MiniStat({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2.5">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-base font-semibold', valueClass)}>{value}</p>
    </div>
  )
}
