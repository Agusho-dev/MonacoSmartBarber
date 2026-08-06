'use client'

import { useState } from 'react'
import { Footprints, CalendarDays, Layers, Check, Settings2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OperationModeChangeDialog } from '@/components/dashboard/operation-mode-change-dialog'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import { cn } from '@/lib/utils'

interface Props {
  sucursal: { id: string; nombre: string }
  modo: BranchOperationMode
}

const MODOS: Array<{
  id: BranchOperationMode
  titulo: string
  bajada: string
  Icono: typeof Footprints
  consecuencias: string[]
}> = [
  {
    id: 'walk_in',
    titulo: 'Por orden de llegada',
    bajada: 'Como siempre: la gente cae y espera su turno en la fila.',
    Icono: Footprints,
    consecuencias: [
      'La tablet de la entrada anota a todos en la fila',
      'El link de reservas avisa que no hace falta turno',
      'El barbero ve su fila, sin agenda',
    ],
  },
  {
    id: 'appointments',
    titulo: 'Sólo con turno',
    bajada: 'Se atiende únicamente a quien reservó de antemano.',
    Icono: CalendarDays,
    consecuencias: [
      'La tablet busca el turno por teléfono',
      'El link de reservas muestra los horarios libres',
      'El barbero ve su agenda del día, sin fila',
    ],
  },
  {
    id: 'hybrid',
    titulo: 'Turnos y también sin turno',
    bajada: 'Se reservan turnos y en los huecos entra la gente que cae.',
    Icono: Layers,
    consecuencias: [
      'La tablet pregunta si la persona tiene turno',
      'El link de reservas muestra los horarios libres',
      'El barbero ve la agenda y la fila juntas',
    ],
  },
]

/**
 * Cómo trabaja la sucursal. Las tarjetas explican, pero el cambio real pasa por
 * `OperationModeChangeDialog` → `changeBranchOperationMode`, que es el único
 * lugar con los guardrails (turnos futuros, cola activa, confirmación escrita).
 */
export function ModoOperacion({ sucursal, modo }: Props) {
  const [dialogoAbierto, setDialogoAbierto] = useState(false)

  return (
    <>
      <Card id="seccion-modo" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="text-base">Cómo trabaja {sucursal.nombre}</CardTitle>
          <CardDescription>
            Esto cambia la tablet de la entrada, el panel del barbero y lo que ve un cliente en el link
            de reservas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {MODOS.map(opcion => {
              const esActual = opcion.id === modo
              const Icono = opcion.Icono
              return (
                <div
                  key={opcion.id}
                  className={cn(
                    'relative flex flex-col gap-3 rounded-xl border p-4 transition-colors',
                    esActual ? 'border-primary/50 bg-primary/5' : 'border-border bg-card/40'
                  )}
                >
                  {esActual && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                      <Check className="size-3" strokeWidth={3} />
                      Actual
                    </span>
                  )}

                  <div
                    className={cn(
                      'flex size-9 items-center justify-center rounded-lg',
                      esActual ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Icono className="size-4" />
                  </div>

                  <div>
                    <p className="text-sm font-semibold leading-tight">{opcion.titulo}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{opcion.bajada}</p>
                  </div>

                  <ul className="space-y-1">
                    {opcion.consecuencias.map(texto => (
                      <li key={texto} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        {texto}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              El cambio pide confirmación y no se aplica si hay turnos futuros o gente esperando en la fila.
            </p>
            <Button variant="outline" size="sm" onClick={() => setDialogoAbierto(true)} className="shrink-0">
              <Settings2 className="mr-1.5 size-3.5" />
              Cambiar cómo trabaja
            </Button>
          </div>
        </CardContent>
      </Card>

      <OperationModeChangeDialog
        open={dialogoAbierto}
        onOpenChange={setDialogoAbierto}
        branch={{ id: sucursal.id, name: sucursal.nombre, currentMode: modo }}
      />
    </>
  )
}
