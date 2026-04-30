'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Footprints, Calendar, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'

type Mode = BranchOperationMode

const MODES: Array<{
  id: Mode
  title: string
  Icon: typeof Footprints
  tagline: string
  bullets: string[]
}> = [
  {
    id: 'walk_in',
    title: 'Sin cita',
    Icon: Footprints,
    tagline: 'Cola libre, sin agenda',
    bullets: [
      'Cliente entra y se encola',
      'Sin agenda ni reservas',
      'La opción más simple',
    ],
  },
  {
    id: 'appointments',
    title: 'Sólo turnos',
    Icon: Calendar,
    tagline: 'Agenda planificada',
    bullets: [
      'Reserva online y por dashboard',
      'Recordatorios automáticos',
      'Sin esperas imprevistas',
    ],
  },
  {
    id: 'hybrid',
    title: 'Mixto',
    Icon: Sparkles,
    tagline: 'Lo mejor de los dos',
    bullets: [
      'Turnos protegidos en agenda',
      'Walk-in en huecos libres',
      'Alertas de conflicto al barbero',
    ],
  },
]

interface OperationModeStepProps {
  initialMode?: Mode
  onBack: () => void
  onSubmit: (mode: Mode) => Promise<void>
  isPending: boolean
}

export function OperationModeStep({
  initialMode,
  onBack,
  onSubmit,
  isPending,
}: OperationModeStepProps) {
  const [selected, setSelected] = useState<Mode | null>(initialMode ?? null)

  const selectedMode = MODES.find((m) => m.id === selected)

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">¿Cómo trabajan?</h2>
        <p className="text-sm text-white/40">
          Definí cómo gestionás la demanda de clientes en esta sucursal. Podés cambiarlo después desde la configuración.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((mode) => {
          const isSelected = selected === mode.id
          const Icon = mode.Icon
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => setSelected(mode.id)}
              aria-pressed={isSelected}
              className={cn(
                'relative flex flex-col items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all duration-200',
                isSelected
                  ? 'border-[oklch(0.78_0.12_85)] bg-[oklch(0.78_0.12_85/0.06)] scale-[1.01]'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl border transition-all',
                    isSelected
                      ? 'border-[oklch(0.78_0.12_85/0.4)] bg-[oklch(0.78_0.12_85/0.15)]'
                      : 'border-white/10 bg-white/5'
                  )}
                >
                  <Icon
                    className="size-5"
                    style={{ color: isSelected ? 'oklch(0.78 0.12 85)' : 'oklch(1 0 0 / 0.45)' }}
                  />
                </div>
                <div
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border-2 transition-all',
                    isSelected
                      ? 'border-[oklch(0.78_0.12_85)] bg-[oklch(0.78_0.12_85)]'
                      : 'border-white/20'
                  )}
                >
                  {isSelected && <Check className="size-3 text-black" strokeWidth={3} />}
                </div>
              </div>

              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{mode.title}</p>
                <p className="text-xs text-white/40">{mode.tagline}</p>
              </div>

              <ul className="space-y-1 text-xs text-white/55">
                {mode.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 size-1 rounded-full bg-white/30 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>

      {selectedMode && (
        <div
          className="rounded-xl border px-4 py-3 animate-slide-up-fade"
          style={{
            borderColor: 'oklch(0.78 0.12 85 / 0.2)',
            background: 'oklch(0.78 0.12 85 / 0.05)',
          }}
        >
          <p className="text-xs text-white/55">
            <span className="font-semibold text-white/80">{selectedMode.title}.</span>{' '}
            {modeHint(selectedMode.id)}
          </p>
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isPending}
          className="gap-1 px-3 border-white/10 hover:border-white/20 rounded-xl h-11"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <button
          onClick={() => selected && onSubmit(selected)}
          disabled={isPending || !selected}
          className="btn-gold flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:pointer-events-none"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
          {isPending ? 'Guardando…' : 'Continuar'}
        </button>
      </div>
    </div>
  )
}

function modeHint(mode: Mode) {
  switch (mode) {
    case 'walk_in':
      return 'Tu sucursal no usa agenda. El check-in se hace en el momento.'
    case 'appointments':
      return 'Cada cliente reserva su horario. Tu agenda se llena de turnos planificados.'
    case 'hybrid':
      return 'Aceptás reservas y también clientes sin cita en los huecos libres.'
  }
}
