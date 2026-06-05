'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Loader2, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TournamentLite } from '../../_lib/types'
import { updateScoringSettings } from '@/lib/actions/prode'

export function ScoringForm({ tournament }: { tournament: TournamentLite }) {
  const s = tournament.settings
  const [outcome, setOutcome] = useState<string>((s.match_outcome_points ?? 3).toString())
  const [exact, setExact] = useState<string>((s.match_exact_bonus ?? 2).toString())
  const [mult, setMult] = useState<string>((s.featured_multiplier ?? 2).toString())
  const [isPending, start] = useTransition()

  const onSave = () => {
    const op = Number(outcome)
    const eb = Number(exact)
    const fm = Number(mult)
    if (!Number.isInteger(op) || op < 0) return toast.error('Puntos por resultado inválidos')
    if (!Number.isInteger(eb) || eb < 0) return toast.error('Bonus exacto inválido')
    if (!(fm >= 1)) return toast.error('El multiplicador debe ser ≥ 1')
    start(async () => {
      const r = await updateScoringSettings({ outcomePoints: op, exactBonus: eb, featuredMultiplier: fm })
      if ('error' in r) toast.error(r.error)
      else toast.success('Reglas de puntaje guardadas')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="size-5" /> Reglas de puntaje
        </CardTitle>
        <CardDescription>
          Cómo se reparten los puntos en cada partido. Acertar el ganador suma los puntos base; clavar el
          marcador exacto suma el bonus encima.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Puntos por acertar"
            help="Ganador / empate"
            value={outcome}
            onChange={setOutcome}
          />
          <Field label="Bonus marcador exacto" help="Se suma al acierto" value={exact} onChange={setExact} />
          <Field
            label="Multiplicador del día"
            help="Partido destacado (×)"
            value={mult}
            onChange={setMult}
            step="0.5"
          />
        </div>

        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Ejemplo:</span> con estos valores, clavar el
          marcador exacto del partido del día vale{' '}
          <span className="font-semibold text-foreground">
            {Math.round((Number(outcome || 0) + Number(exact || 0)) * Number(mult || 1))} pts
          </span>
          .
        </div>

        {tournament.status === 'active' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            El torneo está en curso. Cambiar las reglas afecta solo a los partidos que puntúes de ahora en
            más; los ya puntuados no se recalculan.
          </div>
        )}

        <Button onClick={onSave} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Guardar reglas
        </Button>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  help,
  value,
  onChange,
  step,
}: {
  label: string
  help: string
  value: string
  onChange: (v: string) => void
  step?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input type="number" min={0} step={step ?? '1'} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-[11px] text-muted-foreground">{help}</p>
    </div>
  )
}
