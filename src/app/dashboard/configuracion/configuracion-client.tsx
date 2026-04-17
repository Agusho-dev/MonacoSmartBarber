'use client'

import { useState, useTransition, useRef } from 'react'
import { toast } from 'sonner'
import { updateAppSettings, updateBranchCheckinColor } from '@/lib/actions/settings'
import { uploadOrgLogo, updateOrgName } from '@/lib/actions/onboarding'
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
import { Clock, UserX, Save, Timer, AlertTriangle, Zap, Monitor, ImagePlus, Building2, Loader2, X, CalendarClock, ChevronRight } from 'lucide-react'
import Link from 'next/link'

const DAY_OPTIONS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface BranchColor {
  id: string
  name: string
  checkin_bg_color: string | null
}

interface OrgInfo {
  name: string
  logo_url: string | null
}

interface Props {
  appSettings: AppSettings | null
  branches: BranchColor[]
  org: OrgInfo | null
}

export function ConfiguracionClient({ appSettings, branches, org }: Props) {
  return (
    <div className="space-y-4 lg:space-y-6">
      <h2 className="text-xl lg:text-2xl font-bold tracking-tight">Configuración</h2>

      <Link
        href="/dashboard/configuracion/turnos"
        className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
      >
        <div className="flex items-center gap-3">
          <CalendarClock className="size-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Configuración de Turnos</p>
            <p className="text-sm text-muted-foreground">
              Horarios, slots, staff habilitado y mensajería automática
            </p>
          </div>
        </div>
        <ChevronRight className="size-5 text-muted-foreground" />
      </Link>

      <div className="grid gap-4 lg:gap-6 lg:grid-cols-2">
        <OrgBrandingCard org={org} />
        <BusinessHoursCard settings={appSettings} />
        <ThresholdsCard settings={appSettings} />
        <ShiftEndMarginCard settings={appSettings} />
        <NextClientAlertCard settings={appSettings} />
        <DynamicCooldownCard settings={appSettings} />
        <CheckinBgColorCard settings={appSettings} branches={branches} />
      </div>
    </div>
  )
}

/* ─── Org Branding ─── */

function OrgBrandingCard({ org }: { org: OrgInfo | null }) {
  const [name, setName] = useState(org?.name ?? '')
  const [logoUrl, setLogoUrl] = useState(org?.logo_url ?? null)
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('El archivo no puede superar 5MB')
      return
    }

    setUploading(true)
    const fd = new FormData()
    fd.set('logo', file)

    startTransition(async () => {
      const result = await uploadOrgLogo(fd)
      setUploading(false)
      if (result.success && result.url) {
        setLogoUrl(`${result.url}?t=${Date.now()}`)
        toast.success('Logo actualizado')
      } else {
        toast.error(result.error ?? 'Error al subir el logo')
      }
    })

    // Limpiar el input para permitir subir el mismo archivo de nuevo
    e.target.value = ''
  }

  const handleSaveName = () => {
    startTransition(async () => {
      const result = await updateOrgName(name)
      if (result.success) toast.success('Nombre actualizado')
      else toast.error(result.error ?? 'Error al guardar')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-muted-foreground" />
          <CardTitle>Marca de la barbería</CardTitle>
        </div>
        <CardDescription>
          Logo y nombre que aparecen en la pantalla de inicio
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isPending}
              className="group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/50 transition-colors hover:border-primary/50 hover:bg-muted disabled:opacity-50"
            >
              {logoUrl ? (
                <>
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="size-full rounded-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <ImagePlus className="size-5 text-white" />
                  </div>
                </>
              ) : uploading ? (
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              ) : (
                <ImagePlus className="size-6 text-muted-foreground" />
              )}
            </button>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {logoUrl ? 'Hacé click para cambiar' : 'Hacé click para subir'}
              </p>
              <p className="text-xs text-muted-foreground/60">
                PNG, JPG, WebP o SVG. Máx 5MB.
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={handleLogoSelect}
          />
        </div>

        {/* Nombre */}
        <div className="space-y-2">
          <Label htmlFor="org-name">Nombre de la barbería</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mi Barbería"
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSaveName} disabled={isPending || !name.trim()}>
          <Save className="mr-2 size-4" />
          {isPending ? 'Guardando...' : 'Guardar nombre'}
        </Button>
      </CardFooter>
    </Card>
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

const PRESET_COLORS_CONFIG = [
  { value: '#3f3f46', label: 'Grafito' },
  { value: '#09090b', label: 'Negro' },
  { value: '#ffffff', label: 'Blanco' },
  { value: '#1e3a5f', label: 'Azul' },
  { value: '#4a1942', label: 'Morado' },
  { value: '#1a3c2a', label: 'Verde' },
]

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS_CONFIG.map((opt) => {
          const isLight = opt.value === '#ffffff'
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-lg h-8 w-8 transition-all ${
                isLight ? 'border border-zinc-200' : ''
              } ${
                value === opt.value ? 'ring-2 ring-primary ring-offset-1' : 'opacity-50 hover:opacity-80'
              }`}
              style={{ backgroundColor: opt.value }}
              title={opt.label}
            />
          )
        })}
      </div>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
      />
      <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
    </div>
  )
}

function CheckinBgColorCard({ settings, branches }: { settings: AppSettings | null; branches: BranchColor[] }) {
  const [globalColor, setGlobalColor] = useState(
    settings?.checkin_bg_color ?? '#3f3f46'
  )
  const [branchColors, setBranchColors] = useState<Record<string, string | null>>(
    Object.fromEntries(branches.map((b) => [b.id, b.checkin_bg_color]))
  )
  const [isPending, startTransition] = useTransition()
  const [savingBranch, setSavingBranch] = useState<string | null>(null)

  const handleSaveGlobal = () => {
    const fd = new FormData()
    fd.set('checkin_bg_color', globalColor)
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
      else toast.success('Color global actualizado')
    })
  }

  const handleSaveBranch = (branchId: string) => {
    const color = branchColors[branchId]
    setSavingBranch(branchId)
    startTransition(async () => {
      const result = await updateBranchCheckinColor(branchId, color)
      setSavingBranch(null)
      if (result.error) toast.error(result.error)
      else toast.success('Color de sucursal actualizado')
    })
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="size-5 text-muted-foreground" />
          <CardTitle>Color de la terminal</CardTitle>
        </div>
        <CardDescription>
          Color de fondo del kiosk de check-in. Configurá un color global y opcionalmente sobreescribilo por sucursal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Color global */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Color global (por defecto)</Label>
            <Button size="sm" onClick={handleSaveGlobal} disabled={isPending}>
              <Save className="mr-1.5 size-3.5" />
              Guardar
            </Button>
          </div>
          <ColorPicker value={globalColor} onChange={setGlobalColor} />
        </div>

        {/* Colores por sucursal */}
        {branches.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <Label className="text-sm font-semibold">Por sucursal</Label>
            <p className="text-xs text-muted-foreground">
              Dejá en &quot;Global&quot; para usar el color por defecto, o elegí un color específico para cada sucursal.
            </p>
            <div className="space-y-3">
              {branches.map((branch) => {
                const branchColor = branchColors[branch.id]
                const isCustom = branchColor !== null
                return (
                  <div key={branch.id} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="size-4 rounded-full border border-white/20"
                          style={{ backgroundColor: branchColor ?? globalColor }}
                        />
                        <span className="text-sm font-medium">{branch.name}</span>
                        {!isCustom && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Global</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isCustom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              setBranchColors({ ...branchColors, [branch.id]: null })
                            }}
                          >
                            Usar global
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleSaveBranch(branch.id)}
                          disabled={isPending || savingBranch === branch.id}
                        >
                          <Save className="mr-1 size-3" />
                          {savingBranch === branch.id ? 'Guardando...' : 'Guardar'}
                        </Button>
                      </div>
                    </div>
                    {isCustom && (
                      <ColorPicker
                        value={branchColor}
                        onChange={(v) => setBranchColors({ ...branchColors, [branch.id]: v })}
                      />
                    )}
                    {!isCustom && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit text-xs h-7"
                        onClick={() => setBranchColors({ ...branchColors, [branch.id]: globalColor })}
                      >
                        Personalizar color
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
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

