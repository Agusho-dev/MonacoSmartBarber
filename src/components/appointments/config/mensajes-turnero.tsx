'use client'

import Link from 'next/link'
import { MessageSquare, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TemplatePickerSelect, type TemplateOption } from '@/components/messaging/template-picker-select'
import { cn } from '@/lib/utils'

/** Templates que el sistema crea solo al conectar WhatsApp. */
const RECOMENDADAS = {
  confirmacion: 'monaco_turno_confirmacion',
  recordatorio: 'monaco_turno_recordatorio',
  reprogramacion: 'monaco_turno_reprogramado',
  cancelacion: 'monaco_turno_cancelado',
  esperaLiberada: 'monaco_turno_waitlist_disponible',
} as const

export interface ValoresMensajes {
  confirmacion: string | null
  recordatorio: string | null
  reprogramacion: string | null
  cancelacion: string | null
  esperaLiberada: string | null
  /** Horas antes del turno en que se manda cada recordatorio. */
  recordatorios: number[]
}

interface Props {
  valores: ValoresMensajes
  onCambiar: (cambio: Partial<ValoresMensajes>) => void
  templates: TemplateOption[]
  hayCanalWhatsApp: boolean
}

const OPCIONES_RECORDATORIO = [48, 24, 4, 2, 1]

export function MensajesTurnero({ valores, onCambiar, templates, hayCanalWhatsApp }: Props) {
  function alternarRecordatorio(horas: number) {
    onCambiar({
      recordatorios: valores.recordatorios.includes(horas)
        ? valores.recordatorios.filter(h => h !== horas)
        : [...valores.recordatorios, horas].sort((a, b) => b - a),
    })
  }

  const lista = [...new Set([...OPCIONES_RECORDATORIO, ...valores.recordatorios])].sort((a, b) => b - a)

  return (
    <Card id="seccion-mensajes" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-base">Mensajes de WhatsApp</CardTitle>
        <CardDescription>
          Qué se le manda al cliente en cada momento. Los turnos funcionan igual sin esto: si falta un
          mensaje, simplemente no se envía.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {!hayCanalWhatsApp && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">WhatsApp todavía no está conectado</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sin la conexión no se envían confirmaciones ni recordatorios. Los turnos se siguen
                reservando normalmente.
              </p>
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link href="/dashboard/mensajeria?settings=1">Conectar WhatsApp</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Apenas reserva</p>
          <p className="text-xs text-muted-foreground">
            Confirmación con día, hora y sucursal. Es el mensaje más importante: sin él, el cliente no
            tiene comprobante de su turno.
          </p>
          <TemplatePickerSelect
            templates={templates}
            value={valores.confirmacion}
            onChange={v => onCambiar({ confirmacion: v })}
            recommendedName={RECOMENDADAS.confirmacion}
            disabled={!hayCanalWhatsApp}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Antes del turno, para que no se olvide</p>
          <TemplatePickerSelect
            templates={templates}
            value={valores.recordatorio}
            onChange={v => onCambiar({ recordatorio: v })}
            recommendedName={RECOMENDADAS.recordatorio}
            disabled={!hayCanalWhatsApp}
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">Se manda:</span>
            {lista.map(horas => {
              const activo = valores.recordatorios.includes(horas)
              return (
                <button
                  key={horas}
                  type="button"
                  onClick={() => alternarRecordatorio(horas)}
                  className={cn(
                    'h-8 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                    activo
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                  )}
                >
                  {horas >= 24 ? `${horas / 24} ${horas === 24 ? 'día' : 'días'} antes` : `${horas} h antes`}
                </button>
              )
            })}
          </div>
          {valores.recordatorios.length === 0 && (
            <p className="text-[11px] text-amber-500">Sin recordatorios: el cliente sólo recibe la confirmación.</p>
          )}
        </div>

        <Separator />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Si le cambiás el horario</p>
            <TemplatePickerSelect
              templates={templates}
              value={valores.reprogramacion}
              onChange={v => onCambiar({ reprogramacion: v })}
              recommendedName={RECOMENDADAS.reprogramacion}
              disabled={!hayCanalWhatsApp}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Si se cancela el turno</p>
            <TemplatePickerSelect
              templates={templates}
              value={valores.cancelacion}
              onChange={v => onCambiar({ cancelacion: v })}
              recommendedName={RECOMENDADAS.cancelacion}
              disabled={!hayCanalWhatsApp}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Cuando se libera un lugar</p>
          <p className="text-xs text-muted-foreground">
            Le avisa al primero de la lista de espera que quedó un hueco.
          </p>
          <TemplatePickerSelect
            templates={templates}
            value={valores.esperaLiberada}
            onChange={v => onCambiar({ esperaLiberada: v })}
            recommendedName={RECOMENDADAS.esperaLiberada}
            disabled={!hayCanalWhatsApp}
          />
        </div>

        {/* Detalle técnico: sólo lo necesita quien arma una plantilla nueva en
            Meta, así que va cerrado por defecto. */}
        <details className="group rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">
            Qué datos completa el sistema en cada mensaje
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`{{1}} → nombre del cliente
{{2}} → servicio reservado
{{3}} → fecha del turno
{{4}} → hora del turno
{{5}} → nombre de la sucursal`}
          </pre>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Las plantillas <span className="font-mono">monaco_turno_*</span> ya vienen armadas con este
            orden y se crean solas al conectar WhatsApp.
          </p>
        </details>
      </CardContent>
    </Card>
  )
}
