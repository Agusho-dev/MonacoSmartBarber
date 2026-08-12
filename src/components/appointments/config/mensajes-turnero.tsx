'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageSquare, ChevronDown, Link as LinkIcon } from 'lucide-react'
import { seedDefaultTemplates, syncWhatsAppTemplates } from '@/lib/actions/whatsapp-meta'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TemplatePickerSelect, type TemplateOption } from '@/components/messaging/template-picker-select'
import { cn } from '@/lib/utils'

/** Templates que el sistema crea solo al conectar WhatsApp. */
const RECOMENDADAS = {
  // La recomendada es la que lleva el link para cancelar. `monaco_turno_
  // confirmacion` (sin link) sigue existiendo y funcionando: no se la edita
  // porque editar una plantilla aprobada la manda de vuelta a revisión en Meta
  // y, mientras dura, no se puede enviar ninguna confirmación.
  confirmacion: 'monaco_turno_confirmacion_link',
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
          <EstadoLinkCancelacion
            elegida={templates.find(t => t.id === valores.confirmacion) ?? null}
            recomendada={templates.find(t => t.name === RECOMENDADAS.confirmacion) ?? null}
            hayCanalWhatsApp={hayCanalWhatsApp}
            onUsar={id => onCambiar({ confirmacion: id })}
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
        <details className="group rounded-lg border border-border bg-muted/20 px-3 py-2" data-seccion="variables">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">
            Qué datos completa el sistema en cada mensaje
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
{`{{1}} → nombre del cliente
{{2}} → servicio reservado
{{3}} → fecha del turno
{{4}} → hora del turno
{{5}} → nombre de la sucursal
{{6}} → link para ver o cancelar el turno (opcional)`}
          </pre>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Las plantillas <span className="font-mono">monaco_turno_*</span> ya vienen armadas con este
            orden y se crean solas al conectar WhatsApp. El sistema manda tantas variables como
            declare cada plantilla: si la tuya tiene 5, se envían 5. Meta rechaza el mensaje entero
            si sobra o falta una.
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Si en vez de la variable {'{{6}}'} preferís un botón, sirve igual: un botón de tipo URL
            con la dirección terminada en <span className="font-mono">{'{{1}}'}</span> recibe el
            código del turno.
          </p>
        </details>
      </CardContent>
    </Card>
  )
}

// ─── Estado del link de cancelación ──────────────────────────────────

/**
 * Si el mensaje de confirmación lleva o no el link para cancelar.
 *
 * Existe porque el link no se puede meter a la fuerza: el texto de la
 * plantilla vive en Meta y una variable de más es un mensaje que no llega
 * (error 132000). Esta tarjeta traduce eso a algo accionable — qué falta y qué
 * botón tocar— en vez de dejar al dueño creyendo que el link se manda cuando no.
 */
function EstadoLinkCancelacion({
  elegida,
  recomendada,
  hayCanalWhatsApp,
  onUsar,
}: {
  elegida: TemplateOption | null
  recomendada: TemplateOption | null
  hayCanalWhatsApp: boolean
  onUsar: (templateId: string) => void
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  if (!hayCanalWhatsApp) return null

  if (elegida?.carriesLink) {
    return (
      <p className="flex items-center gap-1.5 pt-0.5 text-xs text-emerald-600 dark:text-emerald-400">
        <LinkIcon className="size-3.5 shrink-0" />
        Incluye el link para cancelar el turno.
      </p>
    )
  }

  const aprobada = recomendada?.status === 'approved'

  async function crear() {
    setOcupado(true)
    setAviso(null)
    const r = await seedDefaultTemplates()
    setOcupado(false)
    setAviso(
      r.errors.length
        ? r.errors[0].message
        : 'Plantilla enviada a Meta. La aprobación suele tardar minutos; volvé a tocar "Actualizar estado".'
    )
  }

  /**
   * Meta aprueba en su propio tiempo y `message_templates.status` sólo se
   * refresca cuando alguien sincroniza. Sin este botón, el dueño tenía que
   * adivinar cuándo volver.
   */
  async function actualizar() {
    setOcupado(true)
    setAviso(null)
    const r = await syncWhatsAppTemplates()
    setOcupado(false)
    if (r.error) {
      setAviso(r.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium">
        {elegida
          ? 'Este mensaje no incluye el link para cancelar'
          : 'Sin mensaje de confirmación elegido'}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {elegida
          ? 'La plantilla que elegiste tiene 5 datos y ninguno es el link, así que el cliente recibe la confirmación pero no puede cancelar desde ahí.'
          : 'Sin confirmación, el cliente no recibe comprobante ni link para cancelar.'}{' '}
        {!recomendada
          ? 'Podemos crear una plantilla con link en tu cuenta de Meta.'
          : aprobada
            ? 'Ya tenés lista la plantilla con link. Un toque y queda activa.'
            : 'La plantilla con link ya está creada y Meta la está revisando.'}
      </p>

      <div className="flex flex-wrap gap-2">
        {!recomendada && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={crear} disabled={ocupado}>
            {ocupado ? 'Creando…' : 'Crear plantilla con link'}
          </Button>
        )}
        {recomendada && aprobada && (
          <Button size="sm" className="h-7 text-xs" onClick={() => onUsar(recomendada.id)}>
            Usar esta plantilla
          </Button>
        )}
        {recomendada && !aprobada && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={actualizar} disabled={ocupado}>
            {ocupado ? 'Consultando…' : 'Actualizar estado'}
          </Button>
        )}
      </div>

      {aviso && <p className="text-[11px] text-muted-foreground">{aviso}</p>}
    </div>
  )
}
