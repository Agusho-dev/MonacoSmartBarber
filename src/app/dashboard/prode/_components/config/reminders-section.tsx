'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, MessageCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createReminderTemplate, sendReminders } from '@/lib/actions/prode'

export function RemindersSection({
  whatsappActive,
  reminderTemplateStatus,
}: {
  whatsappActive: boolean
  reminderTemplateStatus: string | null
}) {
  const [tplStatus, setTplStatus] = useState<string | null>(reminderTemplateStatus)
  const [isCreating, startCreate] = useTransition()
  const [isSending, startSend] = useTransition()

  const isApproved = tplStatus === 'approved'

  const onCreate = () => {
    startCreate(async () => {
      const r = await createReminderTemplate()
      if (r.error) toast.error(r.error)
      else {
        setTplStatus(r.status ?? 'pending')
        toast.success('Plantilla enviada a Meta. Esperá la aprobación para poder enviar.')
      }
    })
  }

  const onSend = () => {
    startSend(async () => {
      const r = await sendReminders()
      if (r.error) toast.error(r.error)
      else if ((r.enqueued ?? 0) > 0)
        toast.success(`${r.enqueued} recordatorio(s) encolado(s). Se envían en el próximo ciclo.`)
      else toast.info(r.reason ?? 'No se encoló ningún recordatorio')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5" /> Recordatorios por WhatsApp
        </CardTitle>
        <CardDescription>
          Avisales a los participantes que todavía no jugaron el próximo partido destacado (“jugá hoy”).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">WhatsApp Business:</span>
            {whatsappActive ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Activo
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 size-3" /> No configurado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Plantilla “prode_recordatorio”:</span>
            {tplStatus === null ? (
              <Badge variant="outline">No creada</Badge>
            ) : isApproved ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Aprobada
              </Badge>
            ) : (
              <Badge variant="secondary" className="capitalize">
                {tplStatus}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onCreate} disabled={isCreating || !whatsappActive}>
            {isCreating ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 size-4" />
            )}
            Crear plantilla de recordatorio
          </Button>
          <Button onClick={onSend} disabled={isSending || !isApproved}>
            {isSending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 size-4" />
            )}
            Enviar recordatorio ahora
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          El envío solo funciona una vez que Meta <strong>aprueba</strong> la plantilla (puede tardar unos
          minutos). Un cron diario también encola los recordatorios automáticamente para el próximo partido
          destacado. Es idempotente: no duplica avisos al mismo cliente en el día.
        </p>
      </CardContent>
    </Card>
  )
}
