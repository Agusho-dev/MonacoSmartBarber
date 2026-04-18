'use client'

import { useState, useTransition } from 'react'
import { Save, Loader2, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { updateAppointmentSettings } from '@/lib/actions/appointments'
import type { AppointmentSettings } from '@/lib/types/database'
import { toast } from 'sonner'

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
          <h3 className="flex items-center gap-2 text-lg font-semibold"><Palette className="h-5 w-5" /> Personalización</h3>
          <p className="text-sm text-muted-foreground">Definí cómo se ve tu turnero público para los clientes.</p>
        </div>
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Estilos</CardTitle>
            <CardDescription>Colores que se aplican al turnero público.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ColorField label="Color principal (botones, acentos)" value={primary} onChange={setPrimary} />
            <ColorField label="Color de fondo" value={bg} onChange={setBg} />
            <ColorField label="Color de texto" value={text} onChange={setText} />
            <div className="space-y-1.5">
              <Label>Mensaje de bienvenida (opcional)</Label>
              <Textarea
                value={welcome}
                onChange={(e) => setWelcome(e.target.value)}
                placeholder="Ej: ¡Bienvenido! Reservá tu turno en 30 segundos."
                rows={3}
                maxLength={240}
              />
              <p className="text-xs text-muted-foreground">Aparece bajo el nombre del negocio en el turnero. Máx. 240 caracteres.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vista previa</CardTitle>
            <CardDescription>Así se verá en el turnero público.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-lg border p-6 text-center"
              style={{ backgroundColor: safeBg, color: safeText }}
            >
              {org.logo_url ? (
                <img src={org.logo_url} alt="" className="mx-auto mb-3 h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="mx-auto mb-3 h-12 w-12 rounded-full" style={{ backgroundColor: safePrimary, opacity: 0.15 }} />
              )}
              <p className="text-lg font-semibold" style={{ color: safeText }}>{org.name || 'Tu negocio'}</p>
              <p className="mt-1 text-sm" style={{ color: safeText, opacity: 0.7 }}>Reservá tu turno</p>
              {welcome.trim() && (
                <p className="mx-auto mt-3 max-w-xs text-sm" style={{ color: safeText, opacity: 0.85 }}>
                  {welcome}
                </p>
              )}
              <button
                className="mt-5 w-full rounded-md px-4 py-2 text-sm font-medium"
                style={{ backgroundColor: safePrimary, color: safeBg }}
                type="button"
              >
                Elegir sucursal
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded-md border"
          aria-label={label}
        />
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
