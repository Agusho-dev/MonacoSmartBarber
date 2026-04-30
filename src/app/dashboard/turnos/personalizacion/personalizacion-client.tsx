'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Save, Loader2, Palette, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { updateAppointmentSettings } from '@/lib/actions/appointments'
import type { AppointmentSettings } from '@/lib/types/database'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface OrgInfo { name: string; slug: string; logo_url: string | null }

interface Props {
  settings: AppointmentSettings | null
  org: OrgInfo
}

function normalizeHex(value: string, fallback: string): string {
  const v = value.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return v
  return fallback
}

export function PersonalizacionClient({ settings, org }: Props) {
  const [isPending, startTransition] = useTransition()
  const [primary, setPrimary] = useState(settings?.brand_primary_color ?? '#0f172a')
  const [bg, setBg] = useState(settings?.brand_bg_color ?? '#ffffff')
  const [text, setText] = useState(settings?.brand_text_color ?? '#0f172a')
  const [welcome, setWelcome] = useState(settings?.welcome_message ?? '')

  const safePrimary = normalizeHex(primary, '#0f172a')
  const safeBg = normalizeHex(bg, '#ffffff')
  const safeText = normalizeHex(text, '#0f172a')

  const welcomeLength = welcome.length

  function handleSave() {
    startTransition(async () => {
      const result = await updateAppointmentSettings({
        brand_primary_color: safePrimary,
        brand_bg_color: safeBg,
        brand_text_color: safeText,
        welcome_message: welcome.trim() || null,
      })
      if (result.error) toast.error(result.error)
      else toast.success('Personalización guardada')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Palette className="h-5 w-5" />
            Personalización
          </h3>
          <p className="text-sm text-muted-foreground">Definí cómo se ve tu turnero público para los clientes.</p>
        </div>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Columna izquierda: controles */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Colores de marca</CardTitle>
              <CardDescription>Se aplican al turnero público.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ColorField label="Color principal (botones, acentos)" value={primary} onChange={setPrimary} />
              <ColorField label="Color de fondo" value={bg} onChange={setBg} />
              <ColorField label="Color de texto" value={text} onChange={setText} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mensaje de bienvenida</CardTitle>
              <CardDescription>Aparece bajo el nombre del negocio en el turnero.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="welcome-msg">Texto de bienvenida (opcional)</Label>
              <Textarea
                id="welcome-msg"
                value={welcome}
                onChange={(e) => setWelcome(e.target.value)}
                placeholder="Ej: ¡Bienvenido! Reservá tu turno en 30 segundos."
                rows={3}
                maxLength={240}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Máximo 240 caracteres.</p>
                <span className={cn(
                  'text-xs tabular-nums',
                  welcomeLength > 220 ? 'text-amber-500' : 'text-muted-foreground'
                )}>
                  {welcomeLength}/240
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Logo */}
          {!org.logo_url && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
              <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <p className="text-muted-foreground">
                No tenés logo configurado.{' '}
                <a
                  href="/dashboard/configuracion"
                  className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                >
                  Configurar en Branding
                  <ExternalLink className="ml-1 inline h-3 w-3" />
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Columna derecha: device preview sticky */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          {/* Preview del turnero público */}
          <div className="flex flex-col items-center gap-3">
            <p className="self-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Vista previa
            </p>

            {/* Device frame tipo telefono */}
            <div
              className="relative w-[320px] overflow-hidden rounded-[2rem] border-[3px] border-border shadow-2xl"
              style={{ backgroundColor: safeBg }}
            >
              {/* Status bar mockeada */}
              <div
                className="flex items-center justify-between px-5 py-2 text-[10px] font-medium"
                style={{ backgroundColor: safePrimary, color: safeBg }}
              >
                <span>9:41</span>
                <div className="flex items-center gap-1">
                  <span>●●●</span>
                  <span>WiFi</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Notch decorativo */}
              <div
                className="mx-auto -mt-px h-4 w-24 rounded-b-xl"
                style={{ backgroundColor: safePrimary }}
              />

              {/* Contenido del turnero */}
              <div className="px-6 pb-8 pt-6 text-center" style={{ color: safeText }}>
                {/* Logo */}
                {org.logo_url ? (
                  <Image
                    src={org.logo_url}
                    alt=""
                    width={64}
                    height={64}
                    className="mx-auto mb-4 h-16 w-16 rounded-full object-cover shadow-md"
                    unoptimized
                  />
                ) : (
                  <div
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-xs font-semibold"
                    style={{ backgroundColor: safePrimary, color: safeBg, opacity: 0.9 }}
                  >
                    Logo
                  </div>
                )}

                <p className="text-lg font-bold" style={{ color: safeText }}>
                  {org.name || 'Tu negocio'}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: safeText, opacity: 0.6 }}>
                  Reservá tu turno
                </p>

                {welcome.trim() && (
                  <p
                    className="mx-auto mt-3 text-xs leading-relaxed"
                    style={{ color: safeText, opacity: 0.8 }}
                  >
                    {welcome}
                  </p>
                )}

                {/* Botones de sucursales simulados */}
                <div className="mt-6 space-y-2">
                  <button
                    type="button"
                    className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm"
                    style={{ backgroundColor: safePrimary, color: safeBg }}
                  >
                    Sucursal Centro
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium"
                    style={{
                      borderColor: safePrimary,
                      color: safePrimary,
                      backgroundColor: 'transparent',
                    }}
                  >
                    Sucursal Norte
                  </button>
                </div>

                <p className="mt-5 text-[10px]" style={{ color: safeText, opacity: 0.35 }}>
                  Monaco Smart Barber
                </p>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Simulacion de <code className="font-mono">/turnos/{org.slug || 'tu-negocio'}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isValid = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        {/* Swatch visual grande */}
        <div className="relative h-10 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border shadow-sm">
          <div
            className="h-full w-full"
            style={{ backgroundColor: isValid ? value : '#000000' }}
          />
          <input
            type="color"
            value={isValid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={label}
          />
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
          maxLength={7}
          placeholder="#000000"
        />
      </div>
    </div>
  )
}
