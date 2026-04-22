'use client'

import Link from 'next/link'
import { Lock, Sparkles, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export type UpgradePromptProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Nombre human-readable de la feature (ej. "Turnos online") */
  featureName: string
  /** Plan mínimo que incluye esta feature */
  minPlan?: 'start' | 'pro' | 'enterprise'
  /** Plan actual (para contexto) */
  currentPlanName?: string
  /** Breve descripción de lo que se desbloquea */
  description?: string
}

const PLAN_LABEL: Record<string, string> = {
  start: 'Start',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export function UpgradePromptDialog({
  open,
  onOpenChange,
  featureName,
  minPlan = 'pro',
  currentPlanName,
  description,
}: UpgradePromptProps) {
  const targetPlanLabel = PLAN_LABEL[minPlan] ?? 'Pro'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="size-6 text-primary" />
          </div>
          <DialogTitle className="text-center">
            {featureName} está en el plan {targetPlanLabel}
          </DialogTitle>
          <DialogDescription className="text-center">
            {description ?? `Tu plan actual${currentPlanName ? ` (${currentPlanName})` : ''} no incluye esta funcionalidad. Actualizá para desbloquearla.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Al pasar a <Badge variant="secondary">{targetPlanLabel}</Badge> desbloqueás
              automáticamente todas las funcionalidades incluidas en ese plan.
            </span>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Ahora no
          </Button>
          <Button asChild>
            <Link href={`/dashboard/billing?target=${minPlan}`}>
              Ver planes
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
