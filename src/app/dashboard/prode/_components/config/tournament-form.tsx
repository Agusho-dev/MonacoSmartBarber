'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TournamentLite } from '../../_lib/types'
import { updateTournament } from '@/lib/actions/prode'

/** ISO → "YYYY-MM-DDTHH:mm" en hora de ARG, para inputs datetime-local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

const STATUS = ['upcoming', 'active', 'finished'] as const
const STATUS_LABELS: Record<string, string> = {
  upcoming: 'Próximamente',
  active: 'Activo',
  finished: 'Finalizado',
}

export function TournamentForm({ tournament }: { tournament: TournamentLite }) {
  const [startsAt, setStartsAt] = useState(toLocalInput(tournament.starts_at))
  const [endsAt, setEndsAt] = useState(toLocalInput(tournament.ends_at))
  const [lockAt, setLockAt] = useState(toLocalInput(tournament.predictions_lock_at))
  const [status, setStatus] = useState<string>(tournament.status)
  const [isPending, start] = useTransition()

  const onSave = () => {
    if (!startsAt || !endsAt) return toast.error('Completá inicio y fin')
    start(async () => {
      const r = await updateTournament({
        startsAt,
        endsAt,
        predictionsLockAt: lockAt || null,
        status: status as (typeof STATUS)[number],
      })
      if ('error' in r) toast.error(r.error)
      else toast.success('Torneo actualizado')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5" /> Torneo: fechas y estado
        </CardTitle>
        <CardDescription>
          Horarios en hora de Argentina. El cierre de predicciones es el momento desde el cual no se
          aceptan más jugadas para los partidos próximos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-start">Inicio del torneo</Label>
            <Input id="t-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-end">Fin del torneo</Label>
            <Input id="t-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-lock">Cierre de predicciones (opcional)</Label>
            <Input id="t-lock" type="datetime-local" value={lockAt} onChange={(e) => setLockAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {status === 'finished' && tournament.status !== 'finished' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Marcar el torneo como finalizado lo cierra para los jugadores. Asegurate de haber premiado al
            campeón antes.
          </div>
        )}

        <Button onClick={onSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Guardar torneo
        </Button>
      </CardContent>
    </Card>
  )
}
