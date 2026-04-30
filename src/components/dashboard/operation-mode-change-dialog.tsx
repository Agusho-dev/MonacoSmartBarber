'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Calendar, Footprints, Sparkles, Loader2, CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  changeBranchOperationMode,
  getBranchOperationStatus,
  type BranchOperationMode,
  type ChangeOperationModeError,
} from '@/lib/actions/turnos-mode'

interface OperationModeChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  branch: {
    id: string
    name: string
    currentMode: BranchOperationMode
  }
}

const MODE_OPTIONS: Array<{ id: BranchOperationMode; label: string; Icon: typeof Footprints }> = [
  { id: 'walk_in', label: 'Sin cita', Icon: Footprints },
  { id: 'appointments', label: 'Sólo turnos', Icon: Calendar },
  { id: 'hybrid', label: 'Mixto', Icon: Sparkles },
]

type Status = {
  futureAppointments: number
  activeQueueEntries: number
  servicesWithoutDuration: number
}

export function OperationModeChangeDialog({
  open,
  onOpenChange,
  branch,
}: OperationModeChangeDialogProps) {
  const router = useRouter()
  const [selectedMode, setSelectedMode] = useState<BranchOperationMode>(branch.currentMode)
  const [confirmText, setConfirmText] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [errorCode, setErrorCode] = useState<ChangeOperationModeError | null>(null)
  const [errorCount, setErrorCount] = useState<number | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Defer state resets a microtask para evitar setState síncrono en effect
    queueMicrotask(() => {
      if (cancelled) return
      setSelectedMode(branch.currentMode)
      setConfirmText('')
      setErrorCode(null)
      setErrorCount(null)
      setSuccess(false)
    })
    void getBranchOperationStatus(branch.id).then((res) => {
      if (cancelled) return
      if ('ok' in res) {
        setStatus({
          futureAppointments: res.status.futureAppointments,
          activeQueueEntries: res.status.activeQueueEntries,
          servicesWithoutDuration: res.status.servicesWithoutDuration,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, branch.id, branch.currentMode])

  const isSameMode = selectedMode === branch.currentMode
  const nameMatches = confirmText.trim().toLowerCase() === branch.name.trim().toLowerCase()

  // Pre-validación visual de blockers
  const blockedByFutureAppts =
    selectedMode === 'walk_in' && (status?.futureAppointments ?? 0) > 0
  const blockedByQueue =
    selectedMode === 'appointments' && (status?.activeQueueEntries ?? 0) > 0
  const warnsServicesNoDuration =
    selectedMode !== 'walk_in' && (status?.servicesWithoutDuration ?? 0) > 0
  const hasHardBlocker = blockedByFutureAppts || blockedByQueue

  function handleSubmit() {
    if (isSameMode || !nameMatches || hasHardBlocker) return
    setErrorCode(null)
    setErrorCount(null)

    startTransition(async () => {
      const res = await changeBranchOperationMode(branch.id, selectedMode)
      if ('ok' in res) {
        setSuccess(true)
        setTimeout(() => {
          onOpenChange(false)
          router.refresh()
        }, 1200)
      } else {
        setErrorCode(res.error)
        setErrorCount(res.count ?? null)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cambiar modo de operación</DialogTitle>
          <DialogDescription>
            Estás cambiando el modo de operación de <strong>{branch.name}</strong>.
            Esto afecta la agenda, el panel del barbero, el kiosk y la app del cliente.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-12 text-emerald-500" />
            <p className="text-sm font-semibold">Modo actualizado</p>
            <p className="text-xs text-muted-foreground">Refrescando la pantalla…</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {MODE_OPTIONS.map((opt) => {
                const isSelected = selectedMode === opt.id
                const Icon = opt.Icon
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedMode(opt.id)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition-all',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-foreground/20'
                    )}
                  >
                    <Icon className="size-5" />
                    <span>{opt.label}</span>
                    {opt.id === branch.currentMode && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Actual
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Hard blockers */}
            {blockedByFutureAppts && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">No podés cambiar a &ldquo;Sin cita&rdquo; ahora.</p>
                  <p>
                    Hay <strong>{status?.futureAppointments}</strong> turnos futuros activos. Cancelalos
                    o esperá a que se completen primero.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push('/dashboard/turnos/agenda')}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Ver agenda →
                  </button>
                </div>
              </div>
            )}

            {blockedByQueue && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">No podés cambiar a &ldquo;Sólo turnos&rdquo; ahora.</p>
                  <p>
                    Hay <strong>{status?.activeQueueEntries}</strong> clientes en la cola activa. Esperá
                    a que se atiendan o cancelá las entradas primero.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push('/dashboard/fila')}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Ver cola →
                  </button>
                </div>
              </div>
            )}

            {/* Soft warning */}
            {warnsServicesNoDuration && !hasHardBlocker && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Atención: servicios sin duración</p>
                  <p>
                    Tenés <strong>{status?.servicesWithoutDuration}</strong> servicios activos sin
                    duración configurada. No se podrán reservar online hasta que les pongas duración.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push('/dashboard/servicios')}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Ir a Servicios →
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation input (escribir nombre exacto) */}
            {!isSameMode && !hasHardBlocker && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="confirm-name" className="text-xs font-semibold">
                  Para confirmar, escribí el nombre de la sucursal:
                </Label>
                <p className="text-xs text-muted-foreground">
                  Esperado: <code className="rounded bg-background px-1 py-0.5 font-mono">{branch.name}</code>
                </p>
                <Input
                  id="confirm-name"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={branch.name}
                  autoComplete="off"
                />
              </div>
            )}

            {errorCode && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{mapErrorTitle(errorCode)}</p>
                  <p>{mapErrorMessage(errorCode, errorCount)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {!success && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || isSameMode || !nameMatches || hasHardBlocker}
            >
              {isPending && <Loader2 className="size-4 animate-spin mr-2" />}
              Confirmar cambio
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function mapErrorTitle(code: ChangeOperationModeError): string {
  switch (code) {
    case 'HAS_FUTURE_APPOINTMENTS':
      return 'Hay turnos futuros activos'
    case 'HAS_ACTIVE_QUEUE':
      return 'Hay clientes en la cola activa'
    case 'BRANCH_NOT_FOUND':
      return 'Sucursal no encontrada'
    case 'FORBIDDEN':
    case 'UNAUTHORIZED':
      return 'No tenés permisos'
    default:
      return 'Error al cambiar el modo'
  }
}

function mapErrorMessage(code: ChangeOperationModeError, count: number | null): string {
  switch (code) {
    case 'HAS_FUTURE_APPOINTMENTS':
      return `Cancelá los ${count ?? ''} turnos futuros antes de cambiar a "Sin cita".`
    case 'HAS_ACTIVE_QUEUE':
      return `Esperá a que se atiendan los ${count ?? ''} clientes en cola antes de cambiar a "Sólo turnos".`
    case 'FORBIDDEN':
    case 'UNAUTHORIZED':
      return 'Necesitás permisos de administrador para cambiar el modo de operación.'
    default:
      return 'Intentá nuevamente. Si persiste, contactá a soporte.'
  }
}
