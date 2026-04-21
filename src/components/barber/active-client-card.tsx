'use client'

import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useTimerStage, useCrossesThreshold, type TimerStage } from '@/hooks/use-timer-stage'
import { LiveTimerText } from './live-timer-text'
import { vibrate } from '@/lib/barber-feedback'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Check,
  Pause,
  Play,
  User,
  Gift,
  Instagram,
  Coffee,
  ChevronDown,
} from 'lucide-react'
import type { QueueEntry } from '@/lib/types/database'
import { formatCurrency } from '@/lib/format'
import { ClientHistory } from './client-history'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Separator } from '@/components/ui/separator'

interface ActiveClientCardProps {
  entry: QueueEntry
  /** Handler de "Finalizar servicio" — abre el dialog de cobro. */
  onComplete: () => void
  /** Handler de "Pausar". Si no se pasa, no se muestra el botón. */
  onPause?: () => void | Promise<void>
  /** Handler de "Reanudar". */
  onResume?: () => void | Promise<void>
  /** Variante visual: desktop (panel lateral) o mobile (sticky footer). */
  variant?: 'desktop' | 'mobile'
  /** Disabled global del botón principal (loading state). */
  actionLoading?: boolean
}

/** Map de tokens CSS del semáforo por etapa (definidos en globals.css).
 *  Sólo los colores comunican el estado: nunca etiquetamos en palabras
 *  para que el cliente no perciba que el barbero está "apurado". */
const STAGE_STYLE: Record<TimerStage, { bg: string; fg: string; glow: string }> = {
  'ok':       { bg: 'var(--timer-ok-bg)',       fg: 'var(--timer-ok-fg)',       glow: 'var(--timer-ok-glow)' },
  'heads-up': { bg: 'var(--timer-heads-bg)',    fg: 'var(--timer-heads-fg)',    glow: 'var(--timer-heads-glow)' },
  'focus':    { bg: 'var(--timer-focus-bg)',    fg: 'var(--timer-focus-fg)',    glow: 'var(--timer-focus-glow)' },
  'warn':     { bg: 'var(--timer-warn-bg)',     fg: 'var(--timer-warn-fg)',     glow: 'var(--timer-warn-glow)' },
  'danger':   { bg: 'var(--timer-danger-bg)',   fg: 'var(--timer-danger-fg)',   glow: 'var(--timer-danger-glow)' },
}

/**
 * Recuadro del cliente activo. Su fondo cambia de color según el tiempo
 * transcurrido, permitiendo al barbero ver de una ojeada cómo viene:
 *   0-25min blanco · 25-30 celeste · 30-35 azul · 35-45 amarillo · 45+ rojo.
 * Las transiciones son smooth (CSS); los milestones disparan haptics + beep.
 */
export function ActiveClientCard({
  entry,
  onComplete,
  onPause,
  onResume,
  variant = 'desktop',
  actionLoading,
}: ActiveClientCardProps) {
  const [pausing, setPausing] = useState(false)

  const handleStageChange = useCallback((next: TimerStage, prev: TimerStage) => {
    // Sólo haptics silenciosos durante el corte: nada de sonido para no
    // interrumpir la experiencia del cliente.
    switch (next) {
      case 'heads-up':
        vibrate(15)
        break
      case 'focus':
        vibrate([15, 50, 15])
        break
      case 'warn':
        vibrate([30, 80, 30])
        break
      case 'danger':
        vibrate([220, 120, 220])
        break
    }
    void prev // silence unused
  }, [])

  const { stage, isPaused } = useTimerStage({
    startedAt: entry.started_at,
    pausedDurationSeconds: entry.paused_duration_seconds ?? 0,
    pausedAt: entry.paused_at,
    onStageChange: handleStageChange,
  })

  const style = STAGE_STYLE[stage]

  const serviceDurationMin = entry.service?.duration_minutes ?? null

  const cardStyle = useMemo<CSSProperties>(() => ({
    // El componente sólo pinta estas 3 variables; CSS se encarga del resto.
    ['--timer-bg' as string]: isPaused ? 'oklch(0.92 0 0)' : style.bg,
    ['--timer-fg' as string]: isPaused ? 'oklch(0.3 0 0)' : style.fg,
    ['--timer-glow' as string]: isPaused ? 'oklch(0 0 0 / 0.08)' : style.glow,
  }), [style, isPaused])

  const isReward = entry.reward_claimed
  const clientName = entry.client?.name ?? 'Cliente'
  const serviceName = entry.service?.name ?? 'Servicio'
  const servicePrice = entry.service?.price ?? 0

  const handlePause = async () => {
    if (!onPause) return
    setPausing(true)
    vibrate(10)
    try { await onPause() } finally { setPausing(false) }
  }
  const handleResume = async () => {
    if (!onResume) return
    setPausing(true)
    vibrate(10)
    try { await onResume() } finally { setPausing(false) }
  }

  if (variant === 'mobile') {
    return (
      <Card
        className={cn(
          'timer-card border-none gap-0 py-0 overflow-hidden rounded-2xl',
          stage === 'danger' && !isPaused && 'timer-card--danger',
        )}
        style={cardStyle}
        role="region"
        aria-label={`Servicio activo con ${clientName}`}
      >
        <CardContent className="p-0">
          <div className="flex items-start gap-3 p-4">
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-black/10 text-base font-bold"
              style={{ color: 'inherit' }}
              aria-hidden
            >
              #{entry.position}
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="truncate text-xl font-black leading-tight tracking-tight">
                  {clientName}
                </h3>
                {isReward && (
                  <Badge className="bg-white/20 hover:bg-white/25 border-0 text-current gap-1 text-[10px] uppercase tracking-wider">
                    <Gift className="size-3" /> Premio
                  </Badge>
                )}
                {isPaused && (
                  <Badge className="bg-white/25 hover:bg-white/30 border-0 text-current gap-1 text-[10px] uppercase tracking-wider">
                    <Pause className="size-3" /> Pausado
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] font-semibold opacity-85">
                {serviceName}
                {servicePrice > 0 && <span className="ml-1 opacity-70">· {formatCurrency(servicePrice)}</span>}
              </p>
            </div>
            <div className="text-right shrink-0">
              <LiveTimerText
                startedAt={entry.started_at}
                pausedDurationSeconds={entry.paused_duration_seconds ?? 0}
                pausedAt={entry.paused_at}
                className="block text-[44px] leading-none font-black tracking-tighter tabular-nums"
                ariaLabel="Tiempo transcurrido"
              />
              {serviceDurationMin !== null && serviceDurationMin > 0 && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest opacity-60">
                  ETA {serviceDurationMin} min
                </p>
              )}
            </div>
          </div>

          <div className="px-4 pb-3">
            <Accordion type="single" collapsible>
              <AccordionItem value="history" className="border-none">
                <AccordionTrigger
                  className={cn(
                    'group relative h-11 w-full rounded-xl bg-black/10 px-4 py-0 text-sm font-semibold',
                    'hover:bg-black/15 hover:no-underline',
                    'text-current flex items-center justify-center gap-2',
                    '[&>svg]:hidden',
                  )}
                >
                  <User className="size-4 opacity-70" aria-hidden />
                  <span>Historial y ficha</span>
                  <ChevronDown className="absolute right-4 size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 opacity-60" />
                </AccordionTrigger>
                <AccordionContent className="pt-3 pb-0">
                  <ClientInfo entry={entry} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-3 flex gap-2">
              {onPause && !isPaused && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={handlePause}
                  disabled={pausing}
                  className="h-14 px-4 bg-black/10 hover:bg-black/15 text-current border-0"
                  aria-label="Pausar corte"
                >
                  <Pause className="size-5" />
                </Button>
              )}
              {onResume && isPaused && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={handleResume}
                  disabled={pausing}
                  className="h-14 px-4 bg-black/10 hover:bg-black/15 text-current border-0"
                  aria-label="Reanudar corte"
                >
                  <Play className="size-5" />
                </Button>
              )}
              <Button
                size="lg"
                onClick={onComplete}
                disabled={actionLoading}
                className="h-14 flex-1 text-base font-black uppercase tracking-wide bg-black text-white hover:bg-black/90 border-0 shadow-lg"
                aria-label="Finalizar servicio"
              >
                <Check className="mr-2 size-5" />
                Finalizar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Desktop
  return (
    <Card
      className={cn(
        'timer-card border-none gap-0 py-0 overflow-hidden rounded-3xl',
        stage === 'danger' && !isPaused && 'timer-card--danger',
      )}
      style={cardStyle}
      role="region"
      aria-label={`Servicio activo con ${clientName}`}
    >
      <CardContent className="p-7 md:p-8">
        <div className="flex items-center gap-4">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-black/10 text-xl font-bold"
            aria-hidden
          >
            #{entry.position}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-3xl md:text-4xl font-black leading-none tracking-tight">
                {clientName}
              </h2>
              {isReward && (
                <Badge className="bg-white/20 hover:bg-white/25 border-0 text-current gap-1.5 px-2.5 py-1">
                  <Gift className="size-3.5" /> Premio reclamado
                </Badge>
              )}
              {isPaused && (
                <Badge className="bg-white/25 hover:bg-white/30 border-0 text-current gap-1.5 px-2.5 py-1 uppercase tracking-wider">
                  <Pause className="size-3.5" /> Pausado
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-lg font-semibold opacity-85">
              {serviceName}
              {servicePrice > 0 && <span className="ml-2 opacity-70">· {formatCurrency(servicePrice)}</span>}
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-end justify-between gap-4">
          <div>
            {serviceDurationMin !== null && serviceDurationMin > 0 && (
              <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">
                ETA {serviceDurationMin} min
              </p>
            )}
            {entry.client?.phone && (
              <p className="mt-2 text-sm opacity-60">{entry.client.phone}</p>
            )}
            {isPaused && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
                <Pause className="size-3" /> En pausa
              </span>
            )}
          </div>
          <LiveTimerText
            startedAt={entry.started_at}
            pausedDurationSeconds={entry.paused_duration_seconds ?? 0}
            pausedAt={entry.paused_at}
            className="text-[68px] md:text-[84px] leading-none font-black tracking-tighter tabular-nums"
            ariaLabel="Tiempo transcurrido"
          />
        </div>

        {(entry.client?.notes || entry.client?.instagram) && (
          <>
            <Separator className="my-6 bg-black/10" />
            <ClientInfo entry={entry} />
          </>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          {onPause && !isPaused && (
            <Button
              variant="ghost"
              size="lg"
              onClick={handlePause}
              disabled={pausing}
              className="h-16 min-w-[120px] bg-black/10 hover:bg-black/15 text-current border-0 text-base font-semibold"
            >
              <Pause className="mr-2 size-5" />
              Pausar
            </Button>
          )}
          {onResume && isPaused && (
            <Button
              variant="ghost"
              size="lg"
              onClick={handleResume}
              disabled={pausing}
              className="h-16 min-w-[120px] bg-black/10 hover:bg-black/15 text-current border-0 text-base font-semibold"
            >
              <Play className="mr-2 size-5" />
              Reanudar
            </Button>
          )}
          <Button
            size="lg"
            onClick={onComplete}
            disabled={actionLoading}
            className="h-16 flex-1 bg-black text-white hover:bg-black/90 border-0 text-xl font-black uppercase tracking-wide shadow-xl"
          >
            <Check className="mr-2 size-6" />
            Finalizar servicio
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ClientInfo({ entry }: { entry: QueueEntry }) {
  return (
    <div className="space-y-3">
      {entry.client?.instagram && (
        <div className="flex items-center gap-2 text-sm">
          <Instagram className="size-4 opacity-70" />
          <span className="font-medium">{entry.client.instagram}</span>
        </div>
      )}
      {entry.client?.notes && (
        <div className="rounded-xl bg-black/10 p-3 text-sm leading-snug">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider opacity-60">
            Observaciones
          </p>
          <p className="whitespace-pre-wrap">{entry.client.notes}</p>
        </div>
      )}
      {entry.client?.id && (
        <div className="pt-1">
          <ClientHistory clientId={entry.client.id} />
        </div>
      )}
    </div>
  )
}

/**
 * Active card específica para cuando el barbero está en descanso.
 * Mantiene coherencia visual con la del corte activo pero usa palette ámbar.
 */
export function ActiveBreakCard({
  startedAt,
  durationMinutes,
  onComplete,
  actionLoading,
}: {
  startedAt: string | null
  durationMinutes: number | null
  onComplete: () => void
  actionLoading?: boolean
}) {
  const isOverdue = useCrossesThreshold(startedAt, durationMinutes)

  return (
    <Card
      className={cn(
        'timer-card border-none gap-0 py-0 overflow-hidden rounded-2xl md:rounded-3xl',
        isOverdue && 'timer-card--danger',
      )}
      style={{
        ['--timer-bg' as string]: isOverdue ? 'var(--timer-danger-bg)' : 'oklch(0.94 0.09 85)',
        ['--timer-fg' as string]: isOverdue ? 'var(--timer-danger-fg)' : 'oklch(0.25 0.05 60)',
        ['--timer-glow' as string]: isOverdue ? 'var(--timer-danger-glow)' : 'oklch(0.78 0.12 85 / 0.35)',
      } as CSSProperties}
      role="region"
      aria-label="Descanso activo"
    >
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="flex size-12 md:size-16 shrink-0 items-center justify-center rounded-xl md:rounded-2xl bg-black/10">
            <Coffee className="size-6 md:size-8" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl md:text-3xl font-black leading-none tracking-tight">
              {isOverdue ? 'Tiempo de demora' : 'Descanso'}
            </h3>
            <p className="mt-1 text-sm md:text-base opacity-75">
              {isOverdue ? 'Superaste el tiempo asignado' : 'Disfrutá tu descanso'}
            </p>
          </div>
          <LiveTimerText
            startedAt={startedAt}
            className="text-4xl md:text-6xl font-black tabular-nums tracking-tighter"
            ariaLabel="Tiempo de descanso"
          />
        </div>
        <Button
          size="lg"
          onClick={onComplete}
          disabled={actionLoading}
          className="mt-5 h-14 md:h-16 w-full bg-black text-white hover:bg-black/90 border-0 text-base md:text-xl font-black uppercase tracking-wide shadow-lg"
        >
          <Check className="mr-2 size-5" />
          Finalizar descanso
        </Button>
      </CardContent>
    </Card>
  )
}
