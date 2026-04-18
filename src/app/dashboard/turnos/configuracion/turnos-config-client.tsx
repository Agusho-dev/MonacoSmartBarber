'use client'

import { useState, useTransition, useMemo } from 'react'
import { Save, Loader2, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
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

      if (result.error) toast.error(result.error)
      else toast.success('Configuración de turnos guardada')
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="h-5 w-5" />
            Configuración del sistema
          </h3>
          <p className="text-sm text-muted-foreground">Horarios, slots, staff y mensajería automática.</p>
        </div>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Sistema de Turnos</CardTitle>
              <CardDescription>Habilitá o deshabilitá el turnero público. Al desactivar, el link deja de aceptar reservas.</CardDescription>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horarios y Días</CardTitle>
          <CardDescription>Definí el subconjunto de horarios disponibles para turnos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Hora de apertura</Label>
              <Input type="time" value={hoursOpen} onChange={e => setHoursOpen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hora de cierre</Label>
              <Input type="time" value={hoursClose} onChange={e => setHoursClose(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Días habilitados</Label>
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                    days.includes(i)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slots y Reservas</CardTitle>
          <CardDescription>Controlan cuándo y cuánto se puede reservar online.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Intervalo de slots (minutos)</Label>
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
              <Label>Máximo días de anticipación</Label>
              <Input type="number" min={1} max={90} value={maxAdvanceDays} onChange={e => setMaxAdvanceDays(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Buffer entre turnos (minutos)</Label>
              <Input type="number" min={0} max={120} value={bufferMinutes} onChange={e => setBufferMinutes(e.target.value)} />
              <p className="text-xs text-muted-foreground">Margen protegido antes y después de cada turno.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Anticipación mínima online (minutos)</Label>
              <Input type="number" min={0} max={1440} value={leadTimeMinutes} onChange={e => setLeadTimeMinutes(e.target.value)} />
              <p className="text-xs text-muted-foreground">Tiempo mínimo antes de la hora del turno para poder reservarlo.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tolerancia no-show (minutos)</Label>
              <Input type="number" min={5} max={60} value={noShowTolerance} onChange={e => setNoShowTolerance(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Horas mínimas para cancelar</Label>
              <Input type="number" min={0} max={48} value={cancellationMinHours} onChange={e => setCancellationMinHours(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Modo de pago</Label>
            <Select value={paymentMode} onValueChange={v => setPaymentMode(v as 'prepago' | 'postpago')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="postpago">Pago posterior al servicio</SelectItem>
                <SelectItem value="prepago">Pago previo al servicio</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mensajería Automática</CardTitle>
          <CardDescription>Templates de WhatsApp para confirmación y recordatorio.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Template de confirmación (opcional)</Label>
            <Input
              value={confirmationTemplate}
              onChange={e => setConfirmationTemplate(e.target.value)}
              placeholder="Nombre del template en Meta"
            />
            <p className="text-xs text-muted-foreground">Si se deja vacío, se envía texto plano.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Template de recordatorio (opcional)</Label>
              <Input
                value={reminderTemplate}
                onChange={e => setReminderTemplate(e.target.value)}
                placeholder="Nombre del template en Meta"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Horas antes del recordatorio</Label>
              <Input type="number" min={1} max={72} value={reminderHours} onChange={e => setReminderHours(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff habilitado</CardTitle>
          <CardDescription>
            Activá quiénes reciben turnos. Los barberos en modo &quot;Solo turnos&quot; no aparecen para walk-ins desde la fila.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {branchGroups.map(([branchId, list]) => (
              <div key={branchId} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{branchName(branchId)}</p>
                {list.map(staff => {
                  const state = staffStates[staff.id] ?? { enabled: false, walkinMode: 'both' as const }
                  return (
                    <div key={staff.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        {staff.avatar_url ? (
                          <img src={staff.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-muted" />
                        )}
                        <span className="font-medium">{staff.full_name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {state.enabled && (
                          <Select
                            value={state.walkinMode}
                            onValueChange={(v) => handleWalkinModeChange(staff.id, v as AppointmentStaffWalkinMode)}
                          >
                            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Turnos + walk-in</SelectItem>
                              <SelectItem value="appointments_only">Solo turnos</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        <Switch
                          checked={state.enabled}
                          onCheckedChange={(checked) => handleToggleStaff(staff.id, checked)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {allStaff.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                No hay barberos activos en la organización.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
