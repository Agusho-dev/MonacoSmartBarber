'use client'

import { useState, useTransition } from 'react'
import { Footprints, Calendar, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { OperationModeChangeDialog } from './operation-mode-change-dialog'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'

interface Branch {
  id: string
  name: string
  operation_mode: BranchOperationMode | null
}

const MODE_LABELS: Record<BranchOperationMode, { label: string; description: string; Icon: typeof Footprints }> = {
  walk_in: {
    label: 'Sin cita (walk-in)',
    description: 'Tu sucursal trabaja por orden de llegada, sin agenda.',
    Icon: Footprints,
  },
  appointments: {
    label: 'Sólo turnos',
    description: 'Tu sucursal trabaja con agenda planificada y booking online.',
    Icon: Calendar,
  },
  hybrid: {
    label: 'Mixto',
    description: 'Tu sucursal acepta turnos reservados y también walk-in en los huecos libres.',
    Icon: Sparkles,
  },
}

interface OperationModeCardProps {
  branches: Branch[]
}

export function OperationModeCard({ branches }: OperationModeCardProps) {
  const [openBranchId, setOpenBranchId] = useState<string | null>(null)
  const [isPending] = useTransition()

  if (branches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Modo de operación</CardTitle>
          <CardDescription>Aún no tenés sucursales creadas.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const openBranch = branches.find((b) => b.id === openBranchId)

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Modo de operación por sucursal</CardTitle>
          <CardDescription>
            Definí cómo cada sucursal gestiona la demanda. El modo afecta la agenda,
            el panel del barbero, el kiosk de check-in y la app del cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {branches.map((branch) => {
            const mode = (branch.operation_mode ?? 'walk_in') as BranchOperationMode
            const meta = MODE_LABELS[mode]
            const Icon = meta.Icon
            return (
              <div
                key={branch.id}
                className="flex flex-col gap-3 rounded-lg border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                    <Icon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{branch.name}</p>
                      <Badge variant="outline" className="text-xs">
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenBranchId(branch.id)}
                  disabled={isPending}
                  className="shrink-0"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Cambiar modo'}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {openBranch && (
        <OperationModeChangeDialog
          open
          onOpenChange={(open) => !open && setOpenBranchId(null)}
          branch={{
            id: openBranch.id,
            name: openBranch.name,
            currentMode: (openBranch.operation_mode ?? 'walk_in') as BranchOperationMode,
          }}
        />
      )}
    </>
  )
}
