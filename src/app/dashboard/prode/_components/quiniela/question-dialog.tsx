'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProdeQuestion } from '../../_lib/types'
import { ANSWER_TYPE_LABELS, QUESTION_KIND_LABELS, parseOptions } from '../../_lib/fmt'
import { createQuestion, updateQuestion } from '@/lib/actions/prode'

const KINDS = ['champion', 'runner_up', 'top_scorer', 'surprise_team', 'team_stage', 'bonus'] as const
const ANSWER_TYPES = ['team', 'choice', 'number', 'text'] as const

export function QuestionDialog({
  open,
  onOpenChange,
  question,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  question: ProdeQuestion | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-y-auto">
        {open && (
          <QuestionForm
            key={question?.id ?? 'new'}
            question={question}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function QuestionForm({
  question,
  onDone,
}: {
  question: ProdeQuestion | null
  onDone: () => void
}) {
  const isEdit = !!question
  const [label, setLabel] = useState(question?.label ?? '')
  const [helpText, setHelpText] = useState(question?.help_text ?? '')
  const [kind, setKind] = useState<string>(question?.kind ?? 'bonus')
  const [answerType, setAnswerType] = useState<string>(question?.answer_type ?? 'team')
  const [options, setOptions] = useState<string[]>(() =>
    question ? parseOptions(question.options) : []
  )
  const [points, setPoints] = useState<string>(question?.points?.toString() ?? '10')
  const [isPending, start] = useTransition()

  const addOption = () => setOptions((o) => [...o, ''])
  const setOption = (i: number, v: string) =>
    setOptions((o) => o.map((x, idx) => (idx === i ? v : x)))
  const removeOption = (i: number) => setOptions((o) => o.filter((_, idx) => idx !== i))

  const onSubmit = () => {
    const pts = Number(points)
    if (label.trim().length < 2) return toast.error('Escribí la pregunta')
    if (!Number.isInteger(pts) || pts < 1) return toast.error('Los puntos deben ser un entero ≥ 1')
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean)
    if (answerType === 'choice' && cleanOptions.length < 2)
      return toast.error('Una pregunta de opción múltiple necesita al menos 2 opciones')

    const payload = {
      label: label.trim(),
      helpText: helpText.trim() || null,
      kind: kind as (typeof KINDS)[number],
      answerType: answerType as (typeof ANSWER_TYPES)[number],
      options: answerType === 'choice' ? cleanOptions : undefined,
      points: pts,
    }

    start(async () => {
      const r = isEdit
        ? await updateQuestion({ id: question!.id, ...payload })
        : await createQuestion(payload)
      if ('error' in r) toast.error(r.error)
      else {
        toast.success(isEdit ? 'Pregunta actualizada' : 'Pregunta creada')
        onDone()
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar pregunta' : 'Nueva pregunta'}</DialogTitle>
        <DialogDescription>
          Las preguntas especiales se juegan una sola vez y suman los puntos al resolverlas.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="q-label">Pregunta</Label>
          <Input
            id="q-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="¿Quién sale campeón del Mundial?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="q-help">Ayuda (opcional)</Label>
          <Textarea
            id="q-help"
            value={helpText}
            onChange={(e) => setHelpText(e.target.value)}
            placeholder="Texto chico que aclara la pregunta al jugador"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {QUESTION_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de respuesta</Label>
            <Select value={answerType} onValueChange={setAnswerType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANSWER_TYPES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ANSWER_TYPE_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {answerType === 'choice' && (
          <div className="space-y-2">
            <Label>Opciones</Label>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={o}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Opción ${i + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeOption(i)}
                  aria-label="Quitar opción"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addOption}>
              <Plus className="mr-1.5 size-4" /> Agregar opción
            </Button>
          </div>
        )}

        {answerType === 'team' && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            El jugador elegirá una de las 48 selecciones del torneo.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="q-points">Puntos</Label>
          <Input
            id="q-points"
            type="number"
            min={1}
            max={200}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-28"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
        <Button onClick={onSubmit} disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {isEdit ? 'Guardar cambios' : 'Crear pregunta'}
        </Button>
      </DialogFooter>
    </>
  )
}
