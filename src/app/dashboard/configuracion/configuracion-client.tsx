'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateAppSettings } from '@/lib/actions/settings'
import type { AppSettings } from '@/lib/types/database'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Clock, UserX, Save, Timer, AlertTriangle, Zap, Monitor } from 'lucide-react'

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface Props {
  appSettings: AppSettings | null
}

export function ConfiguracionClient({ appSettings }: Props) {
  return (
    <div className="space-y-4 lg:space-y-6">
      <h2 className="text-xl lg:text-2xl font-bold tracking-tight">Configuración</h2>

      <div className="grid gap-4 lg:gap-6 lg:grid-cols-2">
        <BusinessHoursCard settings={appSettings} />
        <ThresholdsCard settings={appSettings} />
        <ShiftEndMarginCard settings={appSettings} />
        <NextClientAlertCard settings={appSettings} />
        <DynamicCooldownCard settings={appSettings} />
        <CheckinBgColorCard settings={appSettings} />
      </div>
    </div>
  )
}

/* ─── Business Hours ─── */

function BusinessHoursCard({ settings }: { settings: AppSettings | null }) {
  const [open, setOpen] = useState(settings?.business_hours_open ?? '09:00')
  const [close, setClose] = useState(settings?.business_hours_close ?? '21:00')
  const [days, setDays] = useState<number[]>(
    settings?.business_days ?? [1, 2, 3, 4, 5, 6]
  )
  const [isPending, startTransition] = useTransition()

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  const handleSave = () => {
    const fd = new FormData()
    fd.set('business_hours_open', open)
    fd.set('business_hours_close', close)
    fd.set('business_days', days.join(','))
    fd.set('lost_client_days', String(settings?.lost_client_days ?? 40))
    fd.set('at_risk_client_days', String(settings?.at_risk_client_days ?? 25))

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Horarios actualizados')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-muted-foreground" />
          <CardTitle>Horarios de atención</CardTitle>
        </div>
        <CardDescription>Aplica a todas las sucursales</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="hours-open">Apertura</Label>
            <Input
              id="hours-open"
              type="time"
              value={open}
              onChange={(e) => setOpen(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hours-close">Cierre</Label>
            <Input
              id="hours-close"
              type="time"
              value={close}
              onChange={(e) => setClose(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Días de atención</Label>
          <div className="flex flex-wrap gap-2">
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d.value}
                type="button"
                size="sm"
                variant={days.includes(d.value) ? 'default' : 'outline'}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar horarios'}
        </Button>
      </CardFooter>
    </Card>
  )
}

/* ─── Thresholds ─── */

function ThresholdsCard({ settings }: { settings: AppSettings | null }) {
  const [lostDays, setLostDays] = useState(settings?.lost_client_days ?? 40)
  const [riskDays, setRiskDays] = useState(settings?.at_risk_client_days ?? 25)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const fd = new FormData()
    fd.set('lost_client_days', String(lostDays))
    fd.set('at_risk_client_days', String(riskDays))
    fd.set('business_hours_open', settings?.business_hours_open ?? '09:00')
    fd.set('business_hours_close', settings?.business_hours_close ?? '21:00')
    fd.set(
      'business_days',
      (settings?.business_days ?? [1, 2, 3, 4, 5, 6]).join(',')
    )

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Umbrales actualizados')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserX className="size-5 text-muted-foreground" />
          <CardTitle>Umbrales de cliente</CardTitle>
        </div>
        <CardDescription>
          Define cuándo un cliente está en riesgo o se considera perdido
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="risk-days">Días para "en riesgo"</Label>
          <div className="flex items-center gap-3">
            <Input
              id="risk-days"
              type="number"
              min={1}
              value={riskDays}
              onChange={(e) => setRiskDays(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              días sin visita
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lost-days">Días para "perdido"</Label>
          <div className="flex items-center gap-3">
            <Input
              id="lost-days"
              type="number"
              min={1}
              value={lostDays}
              onChange={(e) => setLostDays(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              días sin visita
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            <strong>En riesgo:</strong> {riskDays}–{lostDays - 1} días sin
            visitar &middot; <strong>Perdido:</strong> {lostDays}+ días sin
            visitar
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar umbrales'}
        </Button>
      </CardFooter>
    </Card>
  )
}

/* ─── Shift End Margin ─── */

function ShiftEndMarginCard({ settings }: { settings: AppSettings | null }) {
  const [margin, setMargin] = useState(settings?.shift_end_margin_minutes ?? 35)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const fd = new FormData()
    fd.set('shift_end_margin_minutes', String(margin))
    fd.set('lost_client_days', String(settings?.lost_client_days ?? 40))
    fd.set('at_risk_client_days', String(settings?.at_risk_client_days ?? 25))
    fd.set('business_hours_open', settings?.business_hours_open ?? '09:00')
    fd.set('business_hours_close', settings?.business_hours_close ?? '21:00')
    fd.set(
      'business_days',
      (settings?.business_days ?? [1, 2, 3, 4, 5, 6]).join(',')
    )

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Margen de cierre actualizado')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Timer className="size-5 text-muted-foreground" />
          <CardTitle>Margen de cierre de turno</CardTitle>
        </div>
        <CardDescription>
          Minutos antes del fin de turno en que el barbero deja de recibir nuevos clientes en la tablet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="margin-minutes">Margen (minutos)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="margin-minutes"
              type="number"
              min={0}
              max={120}
              value={margin}
              onChange={(e) => setMargin(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              minutos antes de que termine el turno
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Si un barbero termina a las 21:00 y el margen es {margin} min, no recibirá
            clientes nuevos a partir de las{' '}
            {(() => {
              const d = new Date()
              d.setHours(21, 0, 0, 0)
              d.setMinutes(d.getMinutes() - margin)
              return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            })()}
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar margen'}
        </Button>
      </CardFooter>
    </Card>
  )
}

/* ─── Next Client Alert ─── */

function NextClientAlertCard({ settings }: { settings: AppSettings | null }) {
  const [minutes, setMinutes] = useState(settings?.next_client_alert_minutes ?? 5)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const fd = new FormData()
    fd.set('next_client_alert_minutes', String(minutes))
    fd.set('lost_client_days', String(settings?.lost_client_days ?? 40))
    fd.set('at_risk_client_days', String(settings?.at_risk_client_days ?? 25))
    fd.set('business_hours_open', settings?.business_hours_open ?? '09:00')
    fd.set('business_hours_close', settings?.business_hours_close ?? '21:00')
    fd.set(
      'business_days',
      (settings?.business_days ?? [1, 2, 3, 4, 5, 6]).join(',')
    )

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Alerta entre clientes actualizada')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-muted-foreground" />
          <CardTitle>Alerta entre clientes</CardTitle>
        </div>
        <CardDescription>
          Tiempo máximo que un barbero puede estar sin atender al siguiente cliente antes de recibir una alerta
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="alert-minutes">Tiempo de gracia (minutos)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="alert-minutes"
              type="number"
              min={1}
              max={30}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              minutos antes de la alerta
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Si el barbero termina un corte y tiene clientes esperando, se le dará{' '}
            <strong>{minutes} minuto{minutes !== 1 ? 's' : ''}</strong> antes de mostrar
            una alerta con sonido y vibración para que comience a atender.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar alerta'}
        </Button>
      </CardFooter>
    </Card>
  )
}

/* ─── Checkin BG Color (global default) ─── */

const BG_COLOR_OPTIONS = [
  { value: 'graphite', label: 'Grafito', bg: 'bg-zinc-700', text: 'text-white' },
  { value: 'black',    label: 'Negro',   bg: 'bg-zinc-950', text: 'text-white' },
  { value: 'white',    label: 'Blanco',  bg: 'bg-white',    text: 'text-zinc-900 border border-zinc-200' },
]

function CheckinBgColorCard({ settings }: { settings: AppSettings | null }) {
  const [color, setColor] = useState<'white' | 'black' | 'graphite'>(
    (settings?.checkin_bg_color ?? 'graphite') as 'white' | 'black' | 'graphite'
  )
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const fd = new FormData()
    fd.set('checkin_bg_color', color)
    fd.set('lost_client_days', String(settings?.lost_client_days ?? 40))
    fd.set('at_risk_client_days', String(settings?.at_risk_client_days ?? 25))
    fd.set('business_hours_open', settings?.business_hours_open ?? '09:00')
    fd.set('business_hours_close', settings?.business_hours_close ?? '21:00')
    fd.set('business_days', (settings?.business_days ?? [1, 2, 3, 4, 5, 6]).join(','))
    fd.set('shift_end_margin_minutes', String(settings?.shift_end_margin_minutes ?? 35))
    fd.set('next_client_alert_minutes', String(settings?.next_client_alert_minutes ?? 5))
    fd.set('dynamic_cooldown_seconds', String(settings?.dynamic_cooldown_seconds ?? 60))

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Color de terminal actualizado')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="size-5 text-muted-foreground" />
          <CardTitle>Color de la terminal</CardTitle>
        </div>
        <CardDescription>
          Color de fondo por defecto del kiosk de check-in. Se puede sobreescribir por sucursal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3">
          {BG_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setColor(opt.value as 'white' | 'black' | 'graphite')}
              className={`flex-1 rounded-xl h-16 flex items-center justify-center font-medium text-sm transition-all ${opt.bg} ${opt.text} ${
                color === opt.value ? 'ring-2 ring-primary ring-offset-2' : 'opacity-60 hover:opacity-80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar color'}
        </Button>
      </CardFooter>
    </Card>
  )
}

/* ─── Dynamic Cooldown ─── */

function DynamicCooldownCard({ settings }: { settings: AppSettings | null }) {
  const [seconds, setSeconds] = useState(settings?.dynamic_cooldown_seconds ?? 60)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const fd = new FormData()
    fd.set('dynamic_cooldown_seconds', String(seconds))
    fd.set('shift_end_margin_minutes', String(settings?.shift_end_margin_minutes ?? 35))
    fd.set('next_client_alert_minutes', String(settings?.next_client_alert_minutes ?? 5))
    fd.set('lost_client_days', String(settings?.lost_client_days ?? 40))
    fd.set('at_risk_client_days', String(settings?.at_risk_client_days ?? 25))
    fd.set('business_hours_open', settings?.business_hours_open ?? '09:00')
    fd.set('business_hours_close', settings?.business_hours_close ?? '21:00')
    fd.set(
      'business_days',
      (settings?.business_days ?? [1, 2, 3, 4, 5, 6]).join(',')
    )

    startTransition(async () => {
      const result = await updateAppSettings(fd)
      if (result.error) toast.error(result.error)
      else toast.success('Cooldown dinámico actualizado')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="size-5 text-muted-foreground" />
          <CardTitle>Cooldown de cliente dinámico</CardTitle>
        </div>
        <CardDescription>
          Segundos que un barbero queda "bloqueado" para recibir clientes dinámicos tras finalizar un servicio, evitando que se le asigne un cliente que aún está caminando hacia su silla
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cooldown-seconds">Cooldown (segundos)</Label>
          <div className="flex items-center gap-3">
            <Input
              id="cooldown-seconds"
              type="number"
              min={0}
              max={300}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              segundos de bloqueo post-servicio
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Con {seconds}s de cooldown, si un barbero termina un corte, el sistema
            esperará {seconds} segundo{seconds !== 1 ? 's' : ''} antes de asignarle
            un nuevo cliente dinámico. Poner en 0 desactiva el cooldown.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isPending}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar cooldown'}
        </Button>
      </CardFooter>
    </Card>
  )
}

