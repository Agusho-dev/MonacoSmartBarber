'use client'

import { useCallback, useMemo, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useTimerStage, useCrossesThreshold, type TimerStage } from '@/hooks/use-timer-stage'
import { vibrate } from '@/lib/barber-feedback'
import { Button } from '@/components/ui/button'
import { Check, Pause, Instagram, Coffee } from 'lucide-react'
import type { QueueEntry } from '@/lib/types/database'
import { formatCurrency } from '@/lib/format'
import { useUltimosCortes, type EstadoUltimosCortes } from '@/hooks/use-ultimos-cortes'
import { TiraUltimosCortes } from './tira-ultimos-cortes'
import { AsesoriaBadge } from './asesoria-badge'
import { ReglaMinutos } from './fila/regla-minutos'
import { MinutosEnVivo } from './fila/minutos-en-vivo'
import { Sello } from './fila/sello'

/**
 * Cortes que pide la tarjeta del cliente actual. Lo exporta para que el pop-up
 * de asesoría, que se abre a la vez, use la MISMA clave de caché de
 * `useUltimosCortes` (una server action para los dos, no dos).
 */
export const CORTES_EN_TARJETA_ACTIVA = 6

/**
 * Sello de asesoría sobre el fondo del cronómetro: sólido, porque ese fondo
 * pasa por blanco, celeste, azul, amarillo y rojo, y el tono translúcido del
 * sello se pierde en los oscuros.
 */
const SELLO_SOBRE_CRONOMETRO =
  'h-7 border-white/45 bg-fuchsia-600 text-white shadow-sm hover:bg-fuchsia-700 focus-visible:ring-white/70 focus-visible:ring-offset-0'


interface ActiveClientCardProps {
  entry: QueueEntry
  /** Handler de "Finalizar" — abre el diálogo de cobro. */
  onComplete: () => void
  /** Disabled del botón principal (loading state). */
  actionLoading?: boolean
  /**
   * El cliente pidió asesoría (mig 217): tocar el sello reabre el pop-up en
   * modo consulta. Sin handler el sello se muestra igual, pero no es botón.
   */
  onVerAsesoria?: () => void
}

/** Tokens CSS del semáforo por etapa (definidos en globals.css).
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
 * La ficha que está en la silla. Es una cartulina cuyo color ES el semáforo:
 *   0–25 min blanco · 25–30 celeste · 30–35 azul · 35–45 amarillo · 45+ rojo.
 * Los minutos son lo más grande de la pantalla (se leen desde la silla). Los
 * cambios de color son suaves (CSS) y los cruces de umbral vibran (sin sonido:
 * hay un cliente sentado).
 *
 * Nada que le haga sentir al cliente que el corte va contra reloj: ni la
 * duración del servicio ni una línea de progreso (la hubo y el dueño la sacó:
 * "el cliente puede sentir que el barbero se está apurando"). El color ya le
 * dice al barbero cómo viene. Y el texto va a color pleno: en el azul y el
 * rojo, el texto atenuado con opacidad quedaba por debajo de 3:1.
 */
export function ActiveClientCard({
  entry,
  onComplete,
  actionLoading,
  onVerAsesoria,
}: ActiveClientCardProps) {
  const handleStageChange = useCallback((next: TimerStage) => {
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
  }, [])

  const { stage, isPaused } = useTimerStage({
    startedAt: entry.started_at,
    pausedDurationSeconds: entry.paused_duration_seconds ?? 0,
    pausedAt: entry.paused_at,
    onStageChange: handleStageChange,
  })

  const style = STAGE_STYLE[stage]

  const cardStyle = useMemo<CSSProperties>(() => ({
    // El componente sólo pinta estas 3 variables; CSS se encarga del resto.
    ['--timer-bg' as string]: isPaused ? 'oklch(0.92 0 0)' : style.bg,
    ['--timer-fg' as string]: isPaused ? 'oklch(0.3 0 0)' : style.fg,
    ['--timer-glow' as string]: isPaused ? 'oklch(0 0 0 / 0.08)' : style.glow,
  }), [style, isPaused])

  const clientName = entry.client?.name ?? 'Cliente'
  // Mig 217: quien pidió asesoría eligió eso EN VEZ de un servicio (nace sin
  // service_id); el servicio se elige recién al cobrar.
  const pidioAsesoria = entry.pidio_asesoria === true
  const serviceName = entry.service?.name ?? (pidioAsesoria ? 'Asesoría' : 'Servicio')
  const servicePrice = entry.service?.price ?? 0

  // UNA server action por cliente: las observaciones, el Instagram y los
  // últimos cortes salen de la misma llamada (y de una caché compartida con el
  // pop-up de asesoría, que usa la misma clave). La fila no trae esas columnas
  // a propósito (KR#10/#34: el embed anónimo de clients no se ensancha).
  const clienteId = entry.client?.id ?? null
  const historial = useUltimosCortes(clienteId, { limite: CORTES_EN_TARJETA_ACTIVA })

  return (
    // Entra a la ranura una vez por cliente: la animación de entrada la pone la
    // ranura en su envoltorio (no acá: pisaría el latido del rojo).
    <section
      className={cn(
        'timer-card relative overflow-hidden rounded-[1.75rem]',
        stage === 'danger' && !isPaused && 'timer-card--danger',
      )}
      style={cardStyle}
      aria-label={`Servicio activo con ${clientName}`}
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="text-[2.25rem] font-bold leading-[1.08] tracking-[-0.02em] [overflow-wrap:anywhere] max-sm:text-[1.625rem]">
              {clientName}
            </h2>
            <p className="mt-1.5 text-xl font-bold max-sm:text-lg">
              {serviceName}
              {servicePrice > 0 && <span className="font-semibold"> · {formatCurrency(servicePrice)}</span>}
            </p>
            {(pidioAsesoria || isPaused) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pidioAsesoria && (
                  <AsesoriaBadge
                    tono="claro"
                    tamano="md"
                    onClick={onVerAsesoria}
                    ariaLabel={`Ver el pedido de asesoría de ${clientName}`}
                    className={SELLO_SOBRE_CRONOMETRO}
                  />
                )}
                {isPaused && (
                  <Sello tono="heredado" className="h-7">
                    <Pause aria-hidden /> En pausa
                  </Sello>
                )}
              </div>
            )}
          </div>
          <MinutosEnVivo
            inicio={entry.started_at}
            pausaSegundos={entry.paused_duration_seconds ?? 0}
            pausadoDesde={entry.paused_at}
            className="block shrink-0 whitespace-nowrap text-[5.5rem] leading-[0.9] tracking-[-0.05em] max-sm:text-[3.25rem]"
            claseUnidad="text-[0.3em] tracking-normal"
            ariaLabel="Tiempo de servicio"
          />
        </div>

        {/* Siempre que haya cliente: observaciones, Instagram y sus últimos
            cortes con fotos, para repetir lo que se hizo la vez pasada. */}
        {clienteId && (
          <div className="mt-5 border-t border-current/15 pt-5">
            <ClientInfo estado={historial.estado} onReintentar={historial.reintentar} sucursalId={entry.branch_id} />
          </div>
        )}

        <Button
          size="lg"
          onClick={onComplete}
          disabled={actionLoading}
          className="mt-6 h-16 w-full touch-manipulation rounded-2xl border-0 bg-black text-lg font-bold text-white shadow-[0_14px_30px_-14px_oklch(0_0_0/0.6)] hover:bg-black/90 motion-safe:active:scale-[0.99] [&_svg]:size-6"
          aria-label="Finalizar servicio"
        >
          <Check aria-hidden />
          Finalizar
        </Button>
      </div>
    </section>
  )
}

/**
 * Observaciones, Instagram y últimos cortes del cliente activo. Va sobre el
 * fondo de color del cronómetro: hereda el color del texto (tono "heredado").
 */
function ClientInfo({
  estado,
  onReintentar,
  sucursalId,
}: {
  estado: EstadoUltimosCortes
  onReintentar: () => void
  sucursalId: string
}) {
  const ficha = estado.tipo === 'listo' ? estado.datos.cliente : null
  return (
    <div className="space-y-3">
      {ficha?.instagram && (
        <div className="flex items-center gap-2 text-base font-semibold">
          <Instagram className="size-4" aria-hidden />
          <span>{ficha.instagram}</span>
        </div>
      )}
      {ficha?.notas && (
        <div className="rounded-2xl bg-black/10 p-3.5 text-base font-medium leading-snug">
          <p className="mb-1 text-sm font-bold">Observaciones</p>
          <p className="whitespace-pre-wrap">{ficha.notas}</p>
        </div>
      )}
      <TiraUltimosCortes
        estado={estado}
        onReintentar={onReintentar}
        variante="compacta"
        tono="heredado"
        sucursalActualId={sucursalId}
      />
    </div>
  )
}

/**
 * La silla en descanso: cartulina ámbar (ámbar = descansos en todo el panel),
 * anaranjada para no confundirse con el amarillo 35–45 min del semáforo. Los
 * minutos y una regla hasta el final del descanso: acá sí, porque el descanso
 * es del barbero y no hay nadie en la silla. Pasado el tiempo, roja.
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
    <section
      className={cn(
        'timer-card relative overflow-hidden rounded-[1.75rem]',
        isOverdue && 'timer-card--danger',
      )}
      style={{
        ['--timer-bg' as string]: isOverdue ? 'var(--timer-danger-bg)' : 'oklch(0.9 0.085 70)',
        ['--timer-fg' as string]: isOverdue ? 'var(--timer-danger-fg)' : 'oklch(0.25 0.05 50)',
        ['--timer-glow' as string]: isOverdue ? 'var(--timer-danger-glow)' : 'oklch(0.75 0.12 70 / 0.35)',
      } as CSSProperties}
      aria-label="Descanso activo"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-black/10 max-sm:size-12">
              <Coffee className="size-7 max-sm:size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[2.25rem] font-bold leading-[1.08] tracking-[-0.02em] max-sm:text-[1.625rem]">
                {isOverdue ? 'Se pasó el descanso' : 'Descanso'}
              </h2>
              <p className="mt-1 text-xl font-bold max-sm:text-lg">
                {isOverdue
                  ? 'Ya pasó el tiempo asignado'
                  : durationMinutes
                    ? `${durationMinutes} min · disfrutalo`
                    : 'Disfrutalo'}
              </p>
            </div>
          </div>
          <MinutosEnVivo
            inicio={startedAt}
            className="block shrink-0 whitespace-nowrap text-[5.5rem] leading-[0.9] tracking-[-0.05em] max-sm:text-[3.25rem]"
            claseUnidad="text-[0.3em] tracking-normal"
            ariaLabel="Tiempo de descanso"
          />
        </div>

        {durationMinutes != null && durationMinutes > 0 && (
          <ReglaMinutos className="mt-6" inicio={startedAt} maximo={durationMinutes} />
        )}

        <Button
          size="lg"
          onClick={onComplete}
          disabled={actionLoading}
          className="mt-6 h-16 w-full touch-manipulation rounded-2xl border-0 bg-black text-lg font-bold text-white shadow-[0_14px_30px_-14px_oklch(0_0_0/0.6)] hover:bg-black/90 motion-safe:active:scale-[0.99] [&_svg]:size-6"
        >
          <Check aria-hidden />
          Terminar descanso
        </Button>
      </div>
    </section>
  )
}
