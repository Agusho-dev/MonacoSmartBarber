'use client'

import { useState, useTransition } from 'react'
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
import { Separator } from '@/components/ui/separator'
import { updateAppointmentSettings, toggleAppointmentStaff } from '@/lib/actions/appointments'
import type { AppointmentSettings } from '@/lib/types/database'
import { toast } from 'sonner'

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

interface StaffRow {
  id: string
  full_name: string
  branch_id: string | null
  role: string
  is_active: boolean
  enabledForAppointments: boolean
}

interface Props {
  settings: AppointmentSettings | null
  allStaff: StaffRow[]
}

export function TurnosConfigClient({ settings, allStaff }: Props) {
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
  const [staffStates, setStaffStates] = useState<Record<string, boolean>>(
    Object.fromEntries(allStaff.map(s => [s.id, s.enabledForAppointments]))
  )

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
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Configuración de turnos guardada')
      }
    })
  }

  async function handleToggleStaff(staffId: string, enabled: boolean) {
    setStaffStates(prev => ({ ...prev, [staffId]: enabled }))
    const result = await toggleAppointmentStaff(staffId, enabled)
    if (result.error) {
      setStaffStates(prev => ({ ...prev, [staffId]: !enabled }))
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarClock className="h-6 w-6" />
            Configuración de Turnos
          </h1>
          <p className="text-sm text-muted-foreground">
            Configurá el sistema de reserva de turnos para tus clientes.
          </p>
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
              <CardDescription>Habilitá o deshabilitá el sistema de turnos</CardDescription>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horarios y Días</CardTitle>
          <CardDescription>Definí el subconjunto de horarios disponibles para turnos</CardDescription>
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
            <div className="flex gap-2">
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
          <CardDescription>Templates de WhatsApp para confirmación y recordatorio</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Template de confirmación (opcional)</Label>
            <Input
              value={confirmationTemplate}
              onChange={e => setConfirmationTemplate(e.target.value)}
              placeholder="Nombre del template en Meta"
            />
            <p className="text-xs text-muted-foreground">Si se deja vacío, se envía texto plano</p>
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
          <CardTitle>Staff Habilitado para Turnos</CardTitle>
          <CardDescription>Seleccioná qué miembros del equipo pueden recibir turnos</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {allStaff.map(staff => (
              <div key={staff.id} className="flex items-center justify-between rounded-lg border p-3">
                <span className="font-medium">{staff.full_name}</span>
                <Switch
                  checked={staffStates[staff.id] ?? false}
                  onCheckedChange={(checked) => handleToggleStaff(staff.id, checked)}
                />
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
