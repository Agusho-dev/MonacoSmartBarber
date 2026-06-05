'use client'

import { useMemo, useState, useTransition } from 'react'
import { CheckCircle2, ListChecks, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProdeQuestion, ProdeTeam, QuestionDistribution } from '../../_lib/types'
import { QUESTION_KIND_LABELS, parseOptions } from '../../_lib/fmt'
import { resolveQuestion } from '@/lib/actions/prode'
import { ConfirmDelete } from '../participantes/participantes-tab'
import { deleteQuestion } from '@/lib/actions/prode'
import { QuestionDialog } from './question-dialog'

export function QuinielaTab({
  questions,
  teams,
  distribution,
}: {
  questions: ProdeQuestion[]
  teams: ProdeTeam[]
  distribution: QuestionDistribution
}) {
  const teamsMap = useMemo(() => {
    const m = new Map<string, ProdeTeam>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProdeQuestion | null>(null)

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (q: ProdeQuestion) => {
    setEditing(q)
    setDialogOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-5" /> Quiniela y preguntas especiales
            </CardTitle>
            <CardDescription>
              Creá las preguntas, mirá qué eligió la gente y resolvé con la respuesta correcta para repartir los puntos.
            </CardDescription>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1.5 size-4" /> Nueva pregunta
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {questions.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No hay preguntas configuradas.</p>
            <Button onClick={openCreate} variant="outline" size="sm" className="mt-3">
              <Plus className="mr-1.5 size-4" /> Crear la primera
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                teamsMap={teamsMap}
                teams={teams}
                distribution={distribution[q.id] ?? {}}
                onEdit={() => openEdit(q)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <QuestionDialog open={dialogOpen} onOpenChange={setDialogOpen} question={editing} />
    </Card>
  )
}

function QuestionCard({
  question,
  teamsMap,
  teams,
  distribution,
  onEdit,
}: {
  question: ProdeQuestion
  teamsMap: Map<string, ProdeTeam>
  teams: ProdeTeam[]
  distribution: Record<string, number>
  onEdit: () => void
}) {
  const [answer, setAnswer] = useState<string>(question.correct_answer ?? '')
  const [resolved, setResolved] = useState(!!question.resolved_at)
  const [isPending, startTransition] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  const choiceOptions = useMemo(() => parseOptions(question.options), [question.options])

  const totalVotes = useMemo(
    () => Object.values(distribution).reduce((a, b) => a + b, 0),
    [distribution]
  )

  // Etiqueta legible para una respuesta cruda (mapea id de equipo → nombre).
  const labelFor = (raw: string) => teamsMap.get(raw)?.name ?? raw

  const ranked = useMemo(
    () =>
      Object.entries(distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    [distribution]
  )

  const onResolve = () => {
    if (!answer.trim()) {
      toast.error('Elegí la respuesta correcta')
      return
    }
    startTransition(async () => {
      const r = await resolveQuestion({ questionId: question.id, answer: answer.trim() })
      if ('error' in r) toast.error(r.error)
      else {
        setResolved(true)
        toast.success(`Pregunta resuelta. ${r.scored} jugada(s) puntuada(s).`)
      }
    })
  }

  const onDelete = () => {
    startDelete(async () => {
      const r = await deleteQuestion(question.id)
      if ('error' in r) toast.error(r.error)
      else toast.success('Pregunta eliminada')
    })
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{question.label}</span>
            <Badge variant="outline" className="text-[10px]">
              {QUESTION_KIND_LABELS[question.kind] ?? question.kind}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {question.points} pts
            </Badge>
            {resolved && (
              <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Resuelta
              </Badge>
            )}
          </div>
          {question.help_text && (
            <p className="mt-1 text-xs text-muted-foreground">{question.help_text}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
            <Pencil className="size-4" />
          </Button>
          <ConfirmDelete
            title="¿Eliminar pregunta?"
            description={
              totalVotes > 0
                ? `Esta pregunta tiene ${totalVotes} jugada(s). Se eliminarán junto con la pregunta. No se puede deshacer.`
                : 'Se eliminará la pregunta. No se puede deshacer.'
            }
            onConfirm={onDelete}
            disabled={isDeleting}
          />
        </div>
      </div>

      {/* Distribución de respuestas */}
      {totalVotes > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {totalVotes} jugada(s)
          </p>
          {ranked.map(([raw, count]) => {
            const pct = Math.round((count / totalVotes) * 100)
            const isCorrect = resolved && raw === question.correct_answer
            return (
              <div key={raw} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate" title={labelFor(raw)}>
                  {labelFor(raw)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', isCorrect ? 'bg-emerald-500' : 'bg-foreground/40')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Resolver */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">
          {resolved ? 'Respuesta correcta:' : 'Resolver con:'}
        </span>
        {question.answer_type === 'team' ? (
          <Select value={answer} onValueChange={setAnswer}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Equipo correcto" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : question.answer_type === 'choice' && choiceOptions.length > 0 ? (
          <Select value={answer} onValueChange={setAnswer}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Opción correcta" />
            </SelectTrigger>
            <SelectContent>
              {choiceOptions.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={question.answer_type === 'number' ? 'number' : 'text'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Respuesta correcta"
            className="w-56"
          />
        )}
        <Button onClick={onResolve} disabled={isPending} size="sm" variant={resolved ? 'outline' : 'default'}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : resolved ? (
            'Re-resolver'
          ) : (
            'Resolver'
          )}
        </Button>
      </div>
    </div>
  )
}
