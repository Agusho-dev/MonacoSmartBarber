'use client'

import { useState, useTransition, useMemo } from 'react'
import { Save, Loader2, CalendarClock, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  updateAppointmentSettings,
  toggleAppointmentStaff,
  updateAppointmentStaffWalkinMode,
} from '@/lib/actions/appointments'
import type { AppointmentSettings, AppointmentStaffWalkinMode } from '@/lib/types/database'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

interface StaffRow {
  id: string
  full_name: string
  branch_id: string | null
  role: string
  is_active: boolean
  avatar_url?: string | null
  enabledForAppointments: boolean
  walkinMode: AppointmentStaffWalkinMode
}

interface Branch { id: string; name: string }

interface Props {
  settings: AppointmentSettings | null
  allStaff: StaffRow[]
  branches: Branch[]
}

export function TurnosConfigClient({ settings, allStaff, branches }: Props) {
  const [isPending, startTransition] = useTransition()
  const [isEnabled, setIsEnabled] = useState(settings?.is_enabled ?? false)
  const [hoursOpen, setHoursOpen] = useState(settings?.appointment_hours_open ?? '09:00')
  const [hoursClose, setHoursClose] = useState(settings?.appointment_hours_close ?? '20:00')
  const [days, setDays] = useState<number[]>(settings?.appointment_days ?? [1, 2, 3, 4, 5, 6])
  const [slotInterval, setSlotInterval] = useState(String(settings?.slot_interval_minutes ?? 30))
  const [maxAdvanceDays, setMaxAdvanceDays] = useState(String(settings?.max_advance_days ?? 30))
  const [noShowTolerance, setNoShowTolerance] = useState(String(settings?.no_show_tolerance_minutes ?? 15))
  const [cancellationMinHours, setCancellationMinHours] = useState(String(settings?.cancellation_min_hours ?? 2))
  const [reminderHours, setReminderHours] = useState(String(settings?.reminder_hours_before ?? 24))
  const [confirmationTemplate, setConfirmationTemplate] = useState(settings?.confirmation_template_name ?? '')
  const [reminderTemplate, setReminderTemplate] = useState(settings?.reminder_template_name ?? '')
  const [paymentMode, setPaymentMode] = useState(settings?.payment_mode ?? 'postpago')
  const [bufferMinutes, setBufferMinutes] = useState(String(settings?.buffer_minutes ?? 10))
  const [leadTimeMinutes, setLeadTimeMinutes] = useState(String(settings?.lead_time_minutes ?? 30))
  const [staffStates, setStaffStates] = useState<Record<string, { enabled: boolean; walkinMode: AppointmentStaffWalkinMode }>>(
    Object.fromEntries(allStaff.map(s => [s.id, { enabled: s.enabledForAppointments, walkinMode: s.walkinMode }]))
  )

  // Detectar cambios no guardados
  const [savedSnapshot, setSavedSnapshot] = useState({
    isEnabled: settings?.is_enabled ?? false,
    hoursOpen: settings?.appointment_hours_open ?? '09:00',
    hoursClose: settings?.appointment_hours_close ?? '20:00',
    days: JSON.stringify(settings?.appointment_days ?? [1, 2, 3, 4, 5, 6]),
    slotInterval: String(settings?.slot_interval_minutes ?? 30),
    maxAdvanceDays: String(settings?.max_advance_days ?? 30),
    noShowTolerance: String(settings?.no_show_tolerance_minutes ?? 15),
    cancellationMinHours: String(settings?.cancellation_min_hours ?? 2),
    reminderHours: String(settings?.reminder_hours_before ?? 24),
    confirmationTemplate: settings?.confirmation_template_name ?? '',
    reminderTemplate: settings?.reminder_template_name ?? '',
    paymentMode: settings?.payment_mode ?? 'postpago',
    bufferMinutes: String(settings?.buffer_minutes ?? 10),
    leadTimeMinutes: String(settings?.lead_time_minutes ?? 30),
  })

  const isDirty =
    isEnabled !== savedSnapshot.isEnabled ||
    hoursOpen !== savedSnapshot.hoursOpen ||
    hoursClose !== savedSnapshot.hoursClose ||
    JSON.stringify(days) !== savedSnapshot.days ||
    slotInterval !== savedSnapshot.slotInterval ||
    maxAdvanceDays !== savedSnapshot.maxAdvanceDays ||
    noShowTolerance !== savedSnapshot.noShowTolerance ||
    cancellationMinHours !== savedSnapshot.cancellationMinHours ||
    reminderHours !== savedSnapshot.reminderHours ||
    confirmationTemplate !== savedSnapshot.confirmationTemplate ||
    reminderTemplate !== savedSnapshot.reminderTemplate ||
    paymentMode !== savedSnapshot.paymentMode ||
    bufferMinutes !== savedSnapshot.bufferMinutes ||
    leadTimeMinutes !== savedSnapshot.leadTimeMinutes

  const branchGroups = useMemo(() => {
    const map = new Map<string, StaffRow[]>()
    allStaff.forEach(s => {
      const key = s.branch_id ?? 'sin-sucursal'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    })
    return Array.from(map.entries())
  }, [allStaff])

  function toggleDay(day: number) {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort())
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateAppointmentSettings({
        is_enabled: isEnabled,
        appointment_hours_open: hoursOpen,
        appointment_hours_close: hoursClose,
        appointment_days: days,
        slot_interval_minutes: Number(slotInterval),
        max_advance_days: Number(maxAdvanceDays),
        no_show_tolerance_minutes: Number(noShowTolerance),
        cancellation_min_hours: Number(cancellationMinHours),
        reminder_hours_before: Number(reminderHours),
        confirmation_template_name: confirmationTemplate || null,
        reminder_template_name: reminderTemplate || null,
        payment_mode: paymentMode as 'prepago' | 'postpago',
        buffer_minutes: Number(bufferMinutes),
        lead_time_minutes: Number(leadTimeMinutes),
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Configuración de turnos guardada')
        setSavedSnapshot({
          isEnabled,
          hoursOpen,
          hoursClose,
          days: JSON.stringify(days),
          slotInterval,
          maxAdvanceDays,
          noShowTolerance,
          cancellationMinHours,
          reminderHours,
          confirmationTemplate,
          reminderTemplate,
          paymentMode,
          bufferMinutes,
          leadTimeMinutes,
        })
      }
    })
  }

  async function handleToggleStaff(staffId: string, enabled: boolean) {
    setStaffStates(prev => ({ ...prev, [staffId]: { ...prev[staffId], enabled } }))
    const result = await toggleAppointmentStaff(staffId, enabled)
    if (result.error) {
      setStaffStates(prev => ({ ...prev, [staffId]: { ...prev[staffId], enabled: !enabled } }))
      toast.error(result.error)
    }
  }

  async function handleWalkinModeChange(staffId: string, mode: AppointmentStaffWalkinMode) {
    const prev = staffStates[staffId]?.walkinMode
    setStaffStates(s => ({ ...s, [staffId]: { ...s[staffId], walkinMode: mode } }))
    const result = await updateAppointmentStaffWalkinMode(staffId, mode)
    if (result.error) {
      setStaffStates(s => ({ ...s, [staffId]: { ...s[staffId], walkinMode: prev ?? 'both' } }))
      toast.error(result.error)
    }
  }

  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? 'Sin sucursal'

  return (
    <div className="relative space-y-6 pb-24">
      {/* Banner principal del sistema */}
      <div className={cn(
        'rounded-xl border p-5 transition-colors',
        isEnabled
          ? 'border-border bg-card'
          : 'border-amber-500/30 bg-amber-500/5'
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              isEnabled ? 'bg-primary text-primary-foreground' : 'bg-amber-500/15 text-amber-500'
            )}>
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold leading-tight">Sistema de Turnos</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isEnabled
                  ? 'El turnero público está activo. Los clientes pueden reservar online.'
                  : 'El turnero está deshabilitado. Los clientes no pueden reservar hasta que lo actives.'}
              </p>
              {!isEnabled && (
                <p className="mt-2 text-xs font-medium text-amber-500">
                  Activa el sistema para que el link publico acepte reservas.
                </p>
              )}
            </div>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            className="shrink-0"
          />
        </div>
      </div>

      {/* Grid 2 columnas en desktop */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Scheduling: Horarios + Slots + Buffer/Lead agrupados */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Horarios y disponibilidad</CardTitle>
            <CardDescription>Definí cuándo y cómo se pueden reservar turnos online.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Subgrupo: Horarios y días */}
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Horarios y días</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hours-open">Hora de apertura</Label>
                  <Input id="hours-open" type="time" value={hoursOpen} onChange={e => setHoursOpen(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hours-close">Hora de cierre</Label>
                  <Input id="hours-close" type="time" value={hoursClose} onChange={e => setHoursClose(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Días habilitados</Label>
                <div className="flex flex-wrap gap-2">
                  {DAY_NAMES.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                        days.includes(i)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            {/* Subgrupo: Slots */}
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Slots y reservas</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Intervalo de slots</Label>
                  <Select value={slotInterval} onValueChange={setSlotInterval}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[15, 20, 30, 45, 60].map(v => (
                        <SelectItem key={v} value={String(v)}>{v} min</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-advance">Días de anticipación máxima</Label>
                  <Input id="max-advance" type="number" min={1} max={90} value={maxAdvanceDays} onChange={e => setMaxAdvanceDays(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="no-show">Tolerancia no-show (min)</Label>
                  <Input id="no-show" type="number" min={5} max={60} value={noShowTolerance} onChange={e => setNoShowTolerance(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cancel-hours">Horas mín. para cancelar</Label>
                  <Input id="cancel-hours" type="number" min={0} max={48} value={cancellationMinHours} onChange={e => setCancellationMinHours(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Modo de pago</Label>
                <Select value={paymentMode} onValueChange={v => setPaymentMode(v as 'prepago' | 'postpago')}>
                  <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postpago">Pago posterior al servicio</SelectItem>
                    <SelectItem value="prepago">Pago previo al servicio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Subgrupo: Buffer y lead time */}
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tiempos de protección</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="buffer">Buffer entre turnos (min)</Label>
                  <Input id="buffer" type="number" min={0} max={120} value={bufferMinutes} onChange={e => setBufferMinutes(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Margen antes y después de cada turno.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-time">Anticipación mínima online (min)</Label>
                  <Input id="lead-time" type="number" min={0} max={1440} value={leadTimeMinutes} onChange={e => setLeadTimeMinutes(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Tiempo mínimo para poder reservar un slot.</p>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Mensajería automática */}
        <Card>
          <CardHeader>
            <CardTitle>Mensajería automática</CardTitle>
            <CardDescription>Templates de WhatsApp para confirmación y recordatorio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
              <p className="mb-1.5 font-semibold text-foreground">Formato de variables requerido</p>
              <p className="text-muted-foreground mb-2">Los templates deben tener exactamente 4 variables en este orden:</p>
              <pre className="rounded bg-background px-3 py-2 font-mono text-[11px] text-foreground whitespace-pre-wrap">
{`{{1}} → nombre del cliente
{{2}} → servicio reservado
{{3}} → fecha del turno
{{4}} → hora del turno

Ejemplo: "Hola {{1}}, tu turno de {{2}}
el {{3}} a las {{4}} está confirmado."`}
              </pre>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conf-template">Template de confirmación (opcional)</Label>
              <Input
                id="conf-template"
                value={confirmationTemplate}
                onChange={e => setConfirmationTemplate(e.target.value)}
                placeholder="Nombre del template en Meta"
              />
              <p className="text-xs text-muted-foreground">Si se deja vacío, se envía texto plano.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rem-template">Template de recordatorio (opcional)</Label>
                <Input
                  id="rem-template"
                  value={reminderTemplate}
                  onChange={e => setReminderTemplate(e.target.value)}
                  placeholder="Nombre del template en Meta"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rem-hours">Horas antes del recordatorio</Label>
                <Input id="rem-hours" type="number" min={1} max={72} value={reminderHours} onChange={e => setReminderHours(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Staff habilitado */}
        <Card>
          <CardHeader>
            <CardTitle>Staff habilitado</CardTitle>
            <CardDescription>
              Activá quiénes reciben turnos. &quot;Solo turnos&quot; oculta al barbero en la fila de walk-ins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {branchGroups.map(([branchId, list]) => (
                <div key={branchId} className="space-y-1">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {branchName(branchId)}
                  </p>
                  <div className="space-y-1">
                    {list.map(staff => {
                      const state = staffStates[staff.id] ?? { enabled: false, walkinMode: 'both' as const }
                      return (
                        <div
                          key={staff.id}
                          className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                        >
                          {staff.avatar_url ? (
                            <img src={staff.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                          ) : (
                            <div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{staff.full_name}</span>
                          {state.enabled && (
                            <Select
                              value={state.walkinMode}
                              onValueChange={(v) => handleWalkinModeChange(staff.id, v as AppointmentStaffWalkinMode)}
                            >
                              <SelectTrigger className="h-7 w-[150px] shrink-0 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="both">Turnos + walk-in</SelectItem>
                                <SelectItem value="appointments_only">Solo turnos</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          <Switch
                            checked={state.enabled}
                            onCheckedChange={(checked) => handleToggleStaff(staff.id, checked)}
                            className="shrink-0"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {allStaff.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No hay barberos activos en la organización.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Botón guardar sticky cuando hay cambios */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              Hay cambios sin guardar
            </div>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar cambios
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
