'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Mail, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { joinModuleWaitlist } from '@/lib/actions/billing'

export type ComingSoonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  moduleId: string
  name: string
  teaserCopy: string | null
  estimatedRelease: string | null
}

export function ComingSoonDialog({
  open, onOpenChange, moduleId, name, teaserCopy, estimatedRelease,
}: ComingSoonProps) {
  const [isPending, startTransition] = useTransition()
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = () => {
    setError(null)
    startTransition(async () => {
      const res = await joinModuleWaitlist(moduleId)
      if ('error' in res) {
        setError(res.message ?? 'No pudimos registrar tu interés. Intentá de nuevo.')
        return
      }
      setJoined(true)
    })
  }

  const releaseLabel = estimatedRelease
    ? new Date(estimatedRelease).toLocaleDateString('es-AR', { year: 'numeric', month: 'long' })
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10">
            <CalendarClock className="size-6 text-amber-500" />
          </div>
          <DialogTitle className="text-center">{name} — Próximamente</DialogTitle>
          <DialogDescription className="text-center">
            {teaserCopy ?? 'Estamos trabajando en esta funcionalidad. Dejanos tu interés y te avisamos cuando esté disponible.'}
            {releaseLabel && (
              <span className="mt-2 block text-xs font-medium text-amber-500">
                Estimado: {releaseLabel}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col sm:gap-2">
          {joined ? (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              <span>¡Listo! Te avisamos por email cuando se lance.</span>
            </div>
          ) : (
            <>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <Button onClick={handleJoin} disabled={isPending} className="w-full">
                <Mail className="mr-2 size-4" />
                {isPending ? 'Registrando...' : 'Avisame cuando esté disponible'}
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
