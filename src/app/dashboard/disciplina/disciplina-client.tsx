'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { upsertDisciplinaryRule, deleteDisciplinaryRule, createDisciplinaryEvent, getDisciplinaDelMes, type DisciplinaDelMes } from '@/lib/actions/disciplinary'
import { nombreDelMes } from '@/lib/disciplina-mes'
import { formatCurrency } from '@/lib/format'
import type { DisciplinaryRule, DisciplinaryEvent, DisciplinaryEventType, ConsequenceType } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Trash2, Pencil, Clock, UserX, Coffee, LogIn, LogOut, ScanFace, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'
import { SelectorMes } from './selector-mes'

const TODO_EL_PERSONAL = 'todos'

interface BarberBasic {
  id: string
  full_name: string
  branch_id: string | null
  role?: string
}

interface AttendanceLog {
  id: string
  staff_id: string
  branch_id: string
  action_type: 'clock_in' | 'clock_out'
  recorded_at: string
  face_verified: boolean
}

interface EventWithStaff extends Omit<DisciplinaryEvent, 'staff'> {
  staff?: { id: string; full_name: string; branch_id: string | null } | null
}

interface ActiveBreakEntry {
  id: string
  barber_id: string | null
  branch_id: string | null
  started_at: string | null
  /** Mig 235: los minutos que le dieron a este descanso. NULL = no se sabe. */
  break_duration_minutes?: number | null
  barber?: { id: string; full_name: string; branch_id: string | null } | null
  break_request?: {
    id: string
    branch_id: string
    break_config?: { name: string; duration_minutes: number } | null
  } | null
}

interface BreakOvertimeRecord {
  id: string
  staff_id: string
  branch_id: string
  actual_started_at: string | null
  actual_completed_at: string | null
  overtime_seconds: number | null
  staff?: { id: string; full_name: string; branch_id: string | null } | null
  break_config?: { name: string; duration_minutes: number } | null
}

type OvertimeFilter = 'day' | 'week' | 'month'

interface Props {
  rules: DisciplinaryRule[]
  barbers: BarberBasic[]
  events: EventWithStaff[]
  /**
   * No se pudieron leer los eventos del mes en curso. Sin esto, una lectura fallida
   * se dibuja igual que "nadie llegó tarde": así estuvo esta pantalla desde marzo.
   */
  errorEventos?: boolean
  fromDate: string
  activeBreakEntries?: ActiveBreakEntry[]
  breakOvertimeHistory?: BreakOvertimeRecord[]
  attendanceLogs?: AttendanceLog[]
}

const EVENT_LABELS: Record<DisciplinaryEventType, string> = {
  absence: 'Falta',
  late: 'Tardanza',
}

const CONSEQUENCE_LABELS: Record<ConsequenceType, string> = {
  none: 'Sin consecuencia',
  presentismo_loss: 'Pérdida de presentismo',
  warning: 'Apercibimiento',
  incentive_loss: 'Pérdida de incentivo',
  salary_deduction: 'Descuento de sueldo',
}

export function DisciplinaClient({
  rules,
  barbers,
  events,
  errorEventos = false,
  fromDate,
  activeBreakEntries = [],
  breakOvertimeHistory = [],
  attendanceLogs = [],
}: Props) {
  const router = useRouter()
  const { selectedBranchId } = useBranchStore()
  const [overtimeFilter, setOvertimeFilter] = useState<OvertimeFilter>('week')
  const [now, setNow] = useState(() => Date.now())
  const [ruleDialog, setRuleDialog] = useState(false)
  const [ruleForm, setRuleForm] = useState({
    id: '', event_type: 'absence' as DisciplinaryEventType,
    occurrence_number: '1', consequence: 'none' as ConsequenceType,
    deduction_amount: '', description: '',
  })
  const [eventDialog, setEventDialog] = useState(false)
  const [eventForm, setEventForm] = useState({
    staff_id: '', event_type: 'absence' as DisciplinaryEventType,
    event_date: new Date().toISOString().slice(0, 10), notes: '',
  })
  const [, startTransition] = useTransition()

  // ── El mes que se está mirando ─────────────────────────────────────────────
  // `null` es el mes en curso, que llega por props y se refresca con la página.
  // Los anteriores se piden aparte: la página de Equipo carga todas sus pestañas y
  // recargarla por una flecha era traer de nuevo el historial de servicios entero.
  const mesEnCurso = fromDate.slice(0, 7)
  const [mesElegido, setMesElegido] = useState<string | null>(null)
  const [datosDelMes, setDatosDelMes] = useState<DisciplinaDelMes | null>(null)
  const [errorDelMes, setErrorDelMes] = useState<string | null>(null)
  const [personaElegida, setPersonaElegida] = useState(TODO_EL_PERSONAL)
  const ultimoPedido = useRef(0)
  const mes = mesElegido ?? mesEnCurso
  const cargandoMes = mesElegido !== null && !datosDelMes && !errorDelMes

  async function cargarMes(destino: string) {
    const pedido = ++ultimoPedido.current
    setErrorDelMes(null)
    const r = await getDisciplinaDelMes(destino).catch(() => ({
      error: 'No se pudo cargar ese mes. Revisá la conexión y probá de nuevo.',
    }))
    // Tocó otra flecha mientras esperaba: esta respuesta ya no es la que está mirando.
    if (pedido !== ultimoPedido.current) return
    if ('error' in r) {
      setDatosDelMes(null)
      setErrorDelMes(r.error)
      return
    }
    setDatosDelMes(r)
  }

  function irAMes(destino: string) {
    setDatosDelMes(null)
    setErrorDelMes(null)
    if (destino >= mesEnCurso) {
      ultimoPedido.current += 1
      setMesElegido(null)
      return
    }
    setMesElegido(destino)
    void cargarMes(destino)
  }

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Sin sucursal elegida ("Todas") se ve todo. Antes comparaba contra null y las
  // listas quedaban vacías, como si nadie hubiera fichado.
  const enLaSucursal = (branchId: string | null | undefined) =>
    !selectedBranchId || branchId === selectedBranchId

  const eventosDelMes: EventWithStaff[] = mesElegido ? (datosDelMes?.events ?? []) : events
  const fichadasDelMes: AttendanceLog[] = mesElegido ? (datosDelMes?.attendanceLogs ?? []) : attendanceLogs
  const personalDelMes: BarberBasic[] = datosDelMes?.personal ?? []

  const branchRules = rules.filter((r) => r.branch_id === selectedBranchId)
  const branchBarbers = barbers.filter((b) => enLaSucursal(b.branch_id))
  const branchEvents = eventosDelMes.filter((e) => {
    const staff = e.staff as { branch_id: string | null } | null
    return enLaSucursal(staff?.branch_id)
  })

  // Compute currently overdue breaks for the selected branch
  const overdueBreaks = activeBreakEntries
    .filter((entry) => {
      const entryBranchId = entry.branch_id ?? entry.break_request?.branch_id ?? entry.barber?.branch_id
      return entryBranchId === selectedBranchId && entry.started_at
    })
    .flatMap((entry) => {
      // Sin duración conocida no se puede afirmar que se excedió. Antes valía 0, y el
      // descanso arrastrado desde la fila (que no la guardaba) figuraba excedido desde
      // el primer segundo, con TODO lo transcurrido como exceso.
      const duracionMin =
        entry.break_duration_minutes ?? entry.break_request?.break_config?.duration_minutes ?? null
      if (!duracionMin) return []
      const elapsedMs = now - new Date(entry.started_at!).getTime()
      const overdueMs = elapsedMs - duracionMin * 60_000
      return overdueMs > 0 ? [{ entry, overdueMs, duracionMin }] : []
    })

  function formatOverdue(ms: number) {
    const totalSeconds = Math.floor(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${s}s`
  }

  function formatOvertimeSeconds(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  // Filter overtime history by branch and time period
  const overtimeCutoff = (() => {
    const d = new Date()
    if (overtimeFilter === 'day') { d.setHours(0, 0, 0, 0); return d }
    if (overtimeFilter === 'week') { d.setDate(d.getDate() - 7); return d }
    d.setDate(d.getDate() - 30)
    return d
  })()

  const filteredOvertimeHistory = breakOvertimeHistory.filter((r) => {
    const staffBranchId = (r.staff as { branch_id?: string | null } | null)?.branch_id ?? r.branch_id
    if (staffBranchId !== selectedBranchId) return false
    if (!r.actual_completed_at) return false
    return new Date(r.actual_completed_at) >= overtimeCutoff
  })

  // Per-barber summary for overtime
  const overtimeSummary = (() => {
    const map = new Map<string, { barber: BreakOvertimeRecord['staff']; count: number; totalSeconds: number }>()
    for (const r of filteredOvertimeHistory) {
      const key = r.staff_id
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        existing.totalSeconds += r.overtime_seconds ?? 0
      } else {
        map.set(key, { barber: r.staff, count: 1, totalSeconds: r.overtime_seconds ?? 0 })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds)
  })()

  // Attendance logs filtered by branch
  const branchAttendanceLogs = fichadasDelMes.filter((l) => enLaSucursal(l.branch_id))

  // Build staff name map for attendance display. Incluye a quien ese mes trabajó y
  // hoy ya no está activo: en un mes pasado es lo común.
  const staffNameMap = new Map([...personalDelMes, ...barbers].map((b) => [b.id, b]))

  // Quien aparece en este mes en esta sucursal, además del personal activo.
  const idsConDatos = new Set([
    ...branchEvents.map((e) => e.staff_id),
    ...branchAttendanceLogs.map((l) => l.staff_id),
  ])
  const personasDelMes = [
    ...branchBarbers,
    ...personalDelMes.filter((p) => idsConDatos.has(p.id) && !branchBarbers.some((b) => b.id === p.id)),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name, 'es'))

  // Si cambió de sucursal o de mes y esa persona ya no está en la lista, se vuelve a todos.
  const personaFiltro = personasDelMes.some((p) => p.id === personaElegida) ? personaElegida : TODO_EL_PERSONAL
  const personaSeleccionada = personasDelMes.find((p) => p.id === personaFiltro) ?? null

  // Una persona se mira entera: si ese mes trabajó en dos sucursales, su asistencia
  // es de las dos. Filtrarla por sucursal mostraba días de menos, como si no hubiera ido.
  const eventosVisibles = personaSeleccionada
    ? eventosDelMes.filter((e) => e.staff_id === personaSeleccionada.id)
    : branchEvents
  const fichadasVisibles = personaSeleccionada
    ? fichadasDelMes.filter((l) => l.staff_id === personaSeleccionada.id)
    : branchAttendanceLogs

  const resumenPersona = personaSeleccionada && {
    diasConEntrada: new Set(
      fichadasVisibles
        .filter((l) => l.action_type === 'clock_in')
        .map((l) => new Date(l.recorded_at).toLocaleDateString('es-AR')),
    ).size,
    faltas: eventosVisibles.filter((e) => e.event_type === 'absence').length,
    tardanzas: eventosVisibles.filter((e) => e.event_type === 'late').length,
    perdioPresentismo: eventosVisibles.some((e) => e.consequence_applied === 'presentismo_loss'),
  }

  const barberSummary = personasDelMes.map((b) => {
    const barberEvents = branchEvents.filter((e) => e.staff_id === b.id)
    return {
      ...b,
      absences: barberEvents.filter((e) => e.event_type === 'absence').length,
      lates: barberEvents.filter((e) => e.event_type === 'late').length,
    }
  })

  const ROLE_LABELS: Record<string, string> = {
    barber: 'Barbero',
    admin: 'Encargado',
    owner: 'Dueño',
  }

  function openCreateRule() {
    setRuleForm({ id: '', event_type: 'absence', occurrence_number: '1', consequence: 'none', deduction_amount: '', description: '' })
    setRuleDialog(true)
  }

  function openEditRule(rule: DisciplinaryRule) {
    setRuleForm({
      id: rule.id,
      event_type: rule.event_type,
      occurrence_number: String(rule.occurrence_number),
      consequence: rule.consequence,
      deduction_amount: String(rule.deduction_amount ?? ''),
      description: rule.description ?? '',
    })
    setRuleDialog(true)
  }

  function handleRuleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await upsertDisciplinaryRule(
        selectedBranchId || '',
        ruleForm.event_type,
        parseInt(ruleForm.occurrence_number),
        ruleForm.consequence,
        ruleForm.deduction_amount ? parseFloat(ruleForm.deduction_amount) : null,
        ruleForm.description || null
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Regla guardada'); setRuleDialog(false) }
    })
  }

  function handleDeleteRule(id: string) {
    startTransition(async () => {
      const r = await deleteDisciplinaryRule(id)
      if (r.error) toast.error(r.error)
      else toast.success('Regla eliminada')
    })
  }

  function handleEventSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const r = await createDisciplinaryEvent(
        eventForm.staff_id,
        // Con "Todas" elegido, la sucursal de la persona.
        selectedBranchId || barbers.find((b) => b.id === eventForm.staff_id)?.branch_id || '',
        eventForm.event_type,
        eventForm.event_date,
        eventForm.notes || null,
        null
      )
      if (r.error) toast.error(r.error)
      else {
        const msg = r.consequence && r.consequence !== 'none'
          ? `Registrado (ocurrencia ${r.occurrenceNumber}) — Consecuencia: ${CONSEQUENCE_LABELS[r.consequence as ConsequenceType]}`
          : `Registrado (ocurrencia ${r.occurrenceNumber})`
        toast.success(msg)
        setEventDialog(false)
        if (mesElegido) void cargarMes(mesElegido)
      }
    })
  }

  const absenceRules = branchRules.filter((r) => r.event_type === 'absence')
  const lateRules = branchRules.filter((r) => r.event_type === 'late')

  const nombreMes = nombreDelMes(mes)

  // Mes (y persona, en las pestañas que listan por persona) arriba de cada lista.
  const barraDelMes = (conPersona: boolean) => (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <SelectorMes mes={mes} mesMaximo={mesEnCurso} onCambiar={irAMes} />
      {conPersona && (
        <Select value={personaFiltro} onValueChange={setPersonaElegida}>
          <SelectTrigger className="h-8 w-[200px] text-sm" aria-label="Filtrar por persona">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODO_EL_PERSONAL}>Todo el personal</SelectItem>
            {personasDelMes.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )

  // "No se pudo leer" y "cargando" no pueden verse como "no hubo nada ese mes".
  const avisoDelMes = cargandoMes ? (
    <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Cargando {nombreMes}…
    </div>
  ) : errorDelMes ? (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center" role="alert">
      <p className="text-sm text-red-500">{errorDelMes}</p>
      <Button variant="outline" size="sm" onClick={() => mesElegido && void cargarMes(mesElegido)}>
        Reintentar
      </Button>
    </div>
  ) : null

  // Lo mismo para el mes en curso, que llega por props. Sólo tapa lo que depende de
  // los eventos: las fichadas se leen aparte y Asistencia se sigue pudiendo mirar.
  const avisoEventos = avisoDelMes ?? (mesElegido === null && errorEventos ? (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center" role="alert">
      <p className="text-sm text-red-500">No se pudieron leer los eventos de {nombreMes}. Probá de nuevo.</p>
      <Button variant="outline" size="sm" onClick={() => router.refresh()}>
        Reintentar
      </Button>
    </div>
  ) : null)

  const resumenDeLaPersona = personaSeleccionada && resumenPersona && !avisoEventos && (
    <div className="mb-3 rounded-xl border bg-card px-3 py-3 sm:px-5">
      <p className="font-medium">{personaSeleccionada.full_name}</p>
      <p className="text-sm text-muted-foreground">
        {resumenPersona.diasConEntrada} {resumenPersona.diasConEntrada === 1 ? 'día con entrada' : 'días con entrada'}
        {' · '}
        {resumenPersona.tardanzas} {resumenPersona.tardanzas === 1 ? 'tardanza' : 'tardanzas'}
        {' · '}
        {/* Las faltas se cargan a mano: nada las crea solo si alguien no ficha. Decir
            "0 faltas" a secas sería afirmar que vino todos los días. */}
        {resumenPersona.faltas} {resumenPersona.faltas === 1 ? 'falta cargada' : 'faltas cargadas'}
        {' · '}
        <span className={resumenPersona.perdioPresentismo ? 'font-medium text-red-500' : undefined}>
          {resumenPersona.perdioPresentismo ? 'Perdió el presentismo' : 'Sin pérdida de presentismo registrada'}
        </span>
      </p>
    </div>
  )

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Faltas y Tardanzas</h1>
          <p className="text-sm text-muted-foreground mt-1 hidden sm:block">
            Configurá las reglas disciplinarias y registrá eventos por personal.
          </p>
        </div>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => { setEventForm({ staff_id: '', event_type: 'absence', event_date: new Date().toISOString().slice(0, 10), notes: '' }); setEventDialog(true) }}>
          <Plus className="size-4 mr-2" />
          Registrar evento
        </Button>
      </div>

      {/* Overdue breaks section — only shown when there are active overruns */}
      {overdueBreaks.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Coffee className="size-5 text-red-500 shrink-0" />
            <h2 className="font-semibold text-red-500">Tiempos de descanso excedidos</h2>
            <Badge variant="outline" className="ml-auto border-red-500/30 text-red-500 text-xs">
              {overdueBreaks.length} {overdueBreaks.length === 1 ? 'barbero' : 'barberos'}
            </Badge>
          </div>
          <div className="divide-y divide-red-500/10 rounded-lg border border-red-500/20 bg-background">
            {overdueBreaks.map(({ entry, overdueMs, duracionMin }) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500 font-semibold text-sm">
                  {(entry.barber?.full_name ?? 'B').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{entry.barber?.full_name ?? 'Barbero'}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.break_request?.break_config?.name ?? 'Descanso'}
                    {` · ${duracionMin} min estipulados`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Clock className="size-4 text-red-500" />
                  <span className="text-sm font-bold tabular-nums text-red-500">
                    +{formatOverdue(overdueMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="eventos">
        <div className="overflow-x-auto -mx-3 px-3 lg:mx-0 lg:px-0">
          <TabsList className="min-w-max">
            <TabsTrigger value="eventos" className="text-xs sm:text-sm whitespace-nowrap">Eventos</TabsTrigger>
            <TabsTrigger value="resumen" className="text-xs sm:text-sm whitespace-nowrap">Resumen</TabsTrigger>
            <TabsTrigger value="descansos" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <Coffee className="size-3 sm:size-3.5" />
              Descansos
              {filteredOvertimeHistory.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 text-[10px] sm:text-xs bg-red-500/15 text-red-500">
                  {filteredOvertimeHistory.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reglas" className="text-xs sm:text-sm whitespace-nowrap">Reglas</TabsTrigger>
            <TabsTrigger value="asistencia" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <LogIn className="size-3 sm:size-3.5" />
              Asistencia
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Eventos del mes */}
        <TabsContent value="eventos" className="mt-4">
          {barraDelMes(true)}
          {resumenDeLaPersona}
          {avisoEventos ?? (eventosVisibles.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              No hay eventos registrados en {nombreMes}.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {eventosVisibles.map((evt) => (
                <div key={evt.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
                  {evt.event_type === 'absence'
                    ? <UserX className="size-5 text-red-500 shrink-0" />
                    : <Clock className="size-5 text-yellow-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{(evt.staff as { full_name: string } | null)?.full_name ?? 'Barbero'}</p>
                    <p className="text-sm text-muted-foreground">
                      {EVENT_LABELS[evt.event_type]} · Ocurrencia #{evt.occurrence_number} ·{' '}
                      {new Date(evt.event_date + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                    </p>
                    {evt.notes && <p className="text-xs text-muted-foreground">{evt.notes}</p>}
                  </div>
                  {evt.consequence_applied && evt.consequence_applied !== 'none' && (
                    <Badge
                      variant="outline"
                      className={evt.consequence_applied === 'salary_deduction'
                        ? 'text-xs border-red-500/30 text-red-500'
                        : 'text-xs border-yellow-500/30 text-yellow-500'}
                    >
                      {CONSEQUENCE_LABELS[evt.consequence_applied]}
                      {evt.deduction_amount ? ` (${formatCurrency(evt.deduction_amount)})` : ''}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ))}
        </TabsContent>

        {/* Resumen por barbero */}
        <TabsContent value="resumen" className="mt-4">
          {barraDelMes(false)}
          {avisoEventos ?? (barberSummary.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Sin personal.</div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {barberSummary.map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm">
                    {b.full_name.charAt(0)}
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <span className="font-medium">{b.full_name}</span>
                    {b.role && b.role !== 'barber' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {ROLE_LABELS[b.role] ?? b.role}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm">
                      <UserX className="size-3.5 sm:size-4 text-red-500" />
                      <span className={b.absences > 0 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}>
                        {b.absences}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm">
                      <Clock className="size-3.5 sm:size-4 text-yellow-500" />
                      <span className={b.lates > 0 ? 'text-yellow-500 font-semibold' : 'text-muted-foreground'}>
                        {b.lates}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </TabsContent>

        {/* Descansos excedidos */}
        <TabsContent value="descansos" className="mt-4 space-y-4">
          {/* Period filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Ver:</span>
            <div className="flex rounded-lg border bg-muted/50 p-0.5 gap-0.5">
              {(['day', 'week', 'month'] as OvertimeFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setOvertimeFilter(f)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${overtimeFilter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f === 'day' ? 'Hoy' : f === 'week' ? 'Última semana' : 'Último mes'}
                </button>
              ))}
            </div>
          </div>

          {filteredOvertimeHistory.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              <Coffee className="size-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin tiempos de descanso excedidos en este período.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Per-barber summary */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Resumen por barbero
                </p>
                <div className="divide-y rounded-xl border bg-card">
                  {overtimeSummary.map(({ barber, count, totalSeconds }) => (
                    <div key={(barber as { id?: string } | null)?.id ?? 'unknown'} className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500 font-semibold text-sm">
                        {((barber as { full_name?: string } | null)?.full_name ?? 'B').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{(barber as { full_name?: string } | null)?.full_name ?? 'Barbero'}</p>
                        <p className="text-xs text-muted-foreground">
                          {count} {count === 1 ? 'vez excedido' : 'veces excedido'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-sm font-bold text-red-500 shrink-0">
                        <Clock className="size-4" />
                        +{formatOvertimeSeconds(totalSeconds)} total
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed history */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Detalle de registros
                </p>
                <div className="divide-y rounded-xl border bg-card">
                  {filteredOvertimeHistory.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4">
                      <Coffee className="size-4 text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">
                          {(r.staff as { full_name?: string } | null)?.full_name ?? 'Barbero'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(r.break_config as { name?: string } | null)?.name ?? 'Descanso'}
                          {(r.break_config as { duration_minutes?: number } | null)?.duration_minutes
                            ? ` · ${(r.break_config as { duration_minutes: number }).duration_minutes} min estipulados`
                            : ''}
                          {r.actual_completed_at
                            ? ` · ${new Date(r.actual_completed_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${new Date(r.actual_completed_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
                            : ''}
                        </p>
                      </div>
                      <Badge variant="outline" className="border-red-500/30 text-red-500 font-bold tabular-nums shrink-0">
                        +{formatOvertimeSeconds(r.overtime_seconds ?? 0)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Asistencia */}
        <TabsContent value="asistencia" className="mt-4">
          {barraDelMes(true)}
          {resumenDeLaPersona}
          {avisoDelMes ?? (fichadasVisibles.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              <LogIn className="size-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Sin registros de asistencia en {nombreMes}.</p>
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {fichadasVisibles.map((log) => {
                const staffMember = staffNameMap.get(log.staff_id)
                const isClockIn = log.action_type === 'clock_in'
                return (
                  <div key={log.id} className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
                    <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${isClockIn ? 'bg-emerald-500/15 text-emerald-500' : 'bg-blue-500/15 text-blue-500'}`}>
                      {isClockIn ? <LogIn className="size-4" /> : <LogOut className="size-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{staffMember?.full_name ?? 'Personal'}</p>
                        {staffMember?.role && staffMember.role !== 'barber' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {ROLE_LABELS[staffMember.role] ?? staffMember.role}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {isClockIn ? 'Entrada' : 'Salida'}
                        {' · '}
                        {new Date(log.recorded_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                        {' '}
                        {new Date(log.recorded_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {log.face_verified && (
                        <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 border-emerald-500/30 text-emerald-600">
                          <ScanFace className="size-3" />
                          Face ID
                        </Badge>
                      )}
                      <Badge variant={isClockIn ? 'default' : 'secondary'} className={isClockIn ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15' : 'bg-blue-500/15 text-blue-600 hover:bg-blue-500/15'}>
                        {isClockIn ? 'Entrada' : 'Salida'}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </TabsContent>

        {/* Reglas */}
        <TabsContent value="reglas" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateRule} variant="outline">
              <Plus className="size-4 mr-2" />
              Nueva regla
            </Button>
          </div>

          {(['absence', 'late'] as DisciplinaryEventType[]).map((type) => {
            const typeRules = type === 'absence' ? absenceRules : lateRules
            return (
              <div key={type}>
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {type === 'absence' ? 'Faltas' : 'Tardanzas'}
                </p>
                {typeRules.length === 0 ? (
                  <div className="rounded-xl border bg-card p-5 text-center text-sm text-muted-foreground">
                    Sin reglas configuradas para {EVENT_LABELS[type].toLowerCase()}s.
                  </div>
                ) : (
                  <div className="divide-y rounded-xl border bg-card">
                    {typeRules.map((rule) => (
                      <div key={rule.id} className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">
                            Ocurrencia #{rule.occurrence_number}
                            {' → '}
                            <span className="font-medium">{CONSEQUENCE_LABELS[rule.consequence]}</span>
                            {rule.deduction_amount && ` (${formatCurrency(rule.deduction_amount)})`}
                          </p>
                          {rule.description && <p className="text-xs text-muted-foreground">{rule.description}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => openEditRule(rule)}>
                            <Pencil className="size-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>¿Eliminar regla?</AlertDialogTitle>
                                <AlertDialogDescription>Los eventos ya registrados no se verán afectados.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => handleDeleteRule(rule.id)}>Eliminar</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </TabsContent>
      </Tabs>

      {/* Rule dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ruleForm.id ? 'Editar regla' : 'Nueva regla disciplinaria'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRuleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label>Tipo de evento</Label>
                <Select value={ruleForm.event_type} onValueChange={(v) => setRuleForm((f) => ({ ...f, event_type: v as DisciplinaryEventType }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">Falta</SelectItem>
                    <SelectItem value="late">Tardanza</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Número de ocurrencia</Label>
                <Input type="number" min="1" className="mt-1.5" value={ruleForm.occurrence_number} onChange={(e) => setRuleForm((f) => ({ ...f, occurrence_number: e.target.value }))} required />
              </div>
            </div>
            <div>
              <Label>Consecuencia</Label>
              <Select value={ruleForm.consequence} onValueChange={(v) => setRuleForm((f) => ({ ...f, consequence: v as ConsequenceType }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONSEQUENCE_LABELS) as ConsequenceType[]).map((c) => (
                    <SelectItem key={c} value={c}>{CONSEQUENCE_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ruleForm.consequence === 'salary_deduction' && (
              <div>
                <Label>Monto a descontar</Label>
                <Input type="number" min="0" className="mt-1.5" value={ruleForm.deduction_amount} onChange={(e) => setRuleForm((f) => ({ ...f, deduction_amount: e.target.value }))} />
              </div>
            )}
            <div>
              <Label>Descripción <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={ruleForm.description} onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuleDialog(false)}>Cancelar</Button>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Event dialog */}
      <Dialog open={eventDialog} onOpenChange={setEventDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar evento disciplinario</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEventSubmit} className="space-y-4">
            <div>
              <Label>Personal</Label>
              <Select value={eventForm.staff_id} onValueChange={(v) => setEventForm((f) => ({ ...f, staff_id: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Seleccionar personal" /></SelectTrigger>
                <SelectContent>
                  {branchBarbers.map((b) => <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label>Tipo</Label>
                <Select value={eventForm.event_type} onValueChange={(v) => setEventForm((f) => ({ ...f, event_type: v as DisciplinaryEventType }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">Falta</SelectItem>
                    <SelectItem value="late">Tardanza</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fecha</Label>
                <Input type="date" className="mt-1.5" value={eventForm.event_date} onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))} required />
              </div>
            </div>
            <div>
              <Label>Notas <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={eventForm.notes} onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEventDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={!eventForm.staff_id || !eventForm.event_date}>Registrar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
