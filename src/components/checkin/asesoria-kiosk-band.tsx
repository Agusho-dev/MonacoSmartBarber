import type { ReactNode } from 'react'
import { ChevronRight, Loader2, MessageCircleQuestionMark } from 'lucide-react'
import { GlassRing } from '@/components/checkin/terminal-theme'
import { cn } from '@/lib/utils'

/**
 * Asesoría sin costo en la tablet de entrada (migración 217): las piezas
 * visuales del kiosko, todas en un mismo lugar para que hablen el mismo idioma.
 *
 * - `AsesoriaKioskBand`: «¿No sabés qué hacerte?», la banda que va debajo de la
 *   grilla de «¿Qué te vas a hacer?». La usa también la vista previa de
 *   /dashboard/configuracion («Así la ve el cliente»), deshabilitada.
 * - `AsesoriaKioskChip`: la pastilla «Asesoría sin costo» / «Pediste asesoría».
 * - `AsesoriaKioskPedirBoton`: «Pedir asesoría» desde «Mi turno».
 * - `AsesoriaKioskMensaje`: la línea de resultado (quedó / avisale al barbero).
 *
 * El fucsia y `MessageCircleQuestionMark` son el código exclusivo de la
 * asesoría en todo el sistema (violeta = turnos, ámbar = descansos y demoras,
 * verde = en curso y primer corte, azul/amarillo = Menor espera): acá también.
 *
 * El tema se elige con la prop (`clara` / `oscura`) y no con `dark:`: el kiosko
 * decide claro u oscuro por el color de fondo de la sucursal, no por el sistema.
 * La variante oscura usa `checkin-glass-surface` y `GlassRing`, que viven en
 * `TerminalGlobalStyles`: quien la dibuje fuera del kiosko tiene que montar esos
 * estilos (la vista previa del dashboard lo hace).
 *
 * Sin 'use client' a propósito, igual que `AsesoriaBadge`: no tiene estado ni
 * efectos, y los callbacks sólo los pasan componentes de cliente.
 */

export type VarianteAsesoriaKiosko = 'clara' | 'oscura'

/** Mismo radio que los CTA del paso de barbero («Menor espera», «Elegir barbero»). */
const RADIO_BANDA = 'rounded-2xl md:rounded-[1.25rem]'

interface AsesoriaKioskBandProps {
  /** `clara` sobre fondos claros (`resolveCheckinBackground().isLight`); `oscura` sobre el resto. */
  variante: VarianteAsesoriaKiosko
  /** Tocar la banda: el kiosko elige asesoría EN VEZ de un servicio. */
  onElegir?: () => void
  /**
   * Sin interacción (vista previa del dashboard): se dibuja idéntica pero como
   * bloque, no como botón — no se enfoca, no se toca y no se anuncia como un
   * botón deshabilitado.
   */
  deshabilitada?: boolean
  /**
   * Entrada con fade + subida corta. Corre una sola vez por montaje: en el
   * kiosko la banda vive dentro del contenedor del paso (`key` con `animKey`),
   * así que anima una vez por paso y nunca en las recargas de la fila.
   */
  animarEntrada?: boolean
  className?: string
}

export function AsesoriaKioskBand({
  variante,
  onElegir,
  deshabilitada = false,
  animarEntrada = false,
  className,
}: AsesoriaKioskBandProps) {
  const oscura = variante === 'oscura'
  const interactiva = !!onElegir && !deshabilitada

  const superficie = cn(
    'relative flex w-full items-center gap-4 overflow-hidden border p-4 text-left md:gap-5 md:p-5',
    // Alto reservado: la banda no cambia de tamaño mientras vive en pantalla,
    // así la grilla de servicios (flex-1, auto-rows-fr) no se reacomoda.
    'min-h-[5.25rem] md:min-h-[6.5rem]',
    RADIO_BANDA,
    oscura ? 'border-fuchsia-200/25 checkin-glass-surface' : 'border-fuchsia-200 bg-white shadow-sm',
  )

  const interaccion = cn(
    'group cursor-pointer touch-manipulation select-none',
    'focus-visible:outline-none focus-visible:ring-2',
    'motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-300',
    'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]',
    oscura
      ? 'hover:border-fuchsia-200/45 focus-visible:ring-fuchsia-200/60'
      : 'hover:border-fuchsia-300 hover:shadow-md focus-visible:ring-fuchsia-500/40',
  )

  const contenido = (
    <>
      {/* Velo fucsia → violeta: separa la banda de los servicios sin gritar. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[inherit]',
          oscura
            ? 'bg-[radial-gradient(circle_at_10%_50%,rgba(217,70,239,0.22),transparent_55%),linear-gradient(90deg,rgba(217,70,239,0.12),rgba(139,92,246,0.06)_55%,transparent)]'
            : 'bg-gradient-to-r from-fuchsia-50 via-violet-50/50 to-transparent',
        )}
      />

      <span
        aria-hidden="true"
        className={cn(
          'relative flex size-12 shrink-0 items-center justify-center rounded-xl border md:size-16',
          'motion-safe:transition-transform motion-safe:duration-300',
          interactiva && 'motion-safe:group-hover:scale-105',
          oscura
            ? 'border-fuchsia-300/40 bg-gradient-to-br from-fuchsia-400/30 to-violet-500/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_0_18px_rgba(217,70,239,0.3)]'
            : 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-100 to-violet-100',
        )}
      >
        <MessageCircleQuestionMark
          className={cn(
            'size-6 md:size-8',
            oscura ? 'text-fuchsia-100 drop-shadow-[0_0_10px_rgba(232,121,249,0.7)]' : 'text-fuchsia-600',
          )}
          strokeWidth={1.75}
        />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'text-lg font-bold leading-tight md:text-2xl',
              oscura ? 'text-white' : 'text-zinc-900',
            )}
          >
            ¿No sabés qué hacerte?
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider md:text-xs',
              oscura
                ? 'border-fuchsia-300/40 bg-fuchsia-400/15 text-fuchsia-100'
                : 'border-fuchsia-300 bg-fuchsia-100/70 text-fuchsia-700',
            )}
          >
            Sin costo
          </span>
        </span>
        <span
          className={cn(
            'mt-1 block text-sm leading-snug md:text-base',
            oscura ? 'text-white/70' : 'text-zinc-600',
          )}
        >
          Pedí asesoría y tu barbero te recomienda qué hacerte antes de empezar
        </span>
      </span>

      <ChevronRight
        aria-hidden="true"
        className={cn(
          'relative size-6 shrink-0 md:size-7',
          'motion-safe:transition-transform motion-safe:duration-300',
          interactiva && 'motion-safe:group-hover:translate-x-0.5',
          oscura ? 'text-fuchsia-100/70' : 'text-fuchsia-400',
        )}
      />
    </>
  )

  return (
    <GlassRing
      radius={RADIO_BANDA}
      halo={false}
      className={cn(
        'w-full shrink-0',
        // La animación va en el envoltorio y no en el botón: `delay-*` también
        // fija transition-delay, y en el botón demoraría el hover y el toque.
        animarEntrada &&
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 motion-safe:delay-150 motion-safe:fill-mode-backwards',
        className,
      )}
    >
      {interactiva ? (
        <button type="button" onClick={onElegir} className={cn(superficie, interaccion)}>
          {contenido}
        </button>
      ) : (
        <div className={superficie}>{contenido}</div>
      )}
    </GlassRing>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

/** Pastilla fucsia del kiosko: «Asesoría sin costo» (paso de barbero) y «Pediste asesoría» («Mi turno»). */
export function AsesoriaKioskChip({
  variante,
  children,
  className,
}: {
  variante: VarianteAsesoriaKiosko
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold md:text-sm',
        variante === 'oscura'
          ? 'border-fuchsia-300/35 bg-fuchsia-500/12 text-fuchsia-100'
          : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
        className,
      )}
    >
      <MessageCircleQuestionMark aria-hidden="true" className="size-3.5 shrink-0 md:size-4" />
      {children}
    </span>
  )
}

/**
 * «Pedir asesoría» en «Mi turno»: misma forma que la oferta «Registrar tu cara»
 * de la pantalla de éxito (ícono + título + bajada), en fucsia. Mientras se
 * manda el pedido muestra el spinner y no admite otro toque.
 */
export function AsesoriaKioskPedirBoton({
  variante,
  onPedir,
  enviando = false,
  className,
}: {
  variante: VarianteAsesoriaKiosko
  onPedir: () => void
  enviando?: boolean
  className?: string
}) {
  const oscura = variante === 'oscura'
  return (
    <button
      type="button"
      onClick={onPedir}
      disabled={enviando}
      aria-busy={enviando || undefined}
      className={cn(
        'group flex min-h-14 w-full max-w-xs items-center gap-3 rounded-xl border p-3 text-left touch-manipulation select-none',
        'focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait',
        'motion-safe:transition-[transform,background-color,border-color,box-shadow] motion-safe:duration-200 motion-safe:active:scale-[0.98]',
        oscura
          ? 'border-fuchsia-400/30 bg-fuchsia-950/30 hover:border-fuchsia-300/45 hover:bg-fuchsia-950/45 hover:shadow-[0_0_24px_rgba(217,70,239,0.14)] focus-visible:ring-fuchsia-300/60'
          : 'border-fuchsia-200 bg-white hover:border-fuchsia-300 hover:bg-fuchsia-50/60 hover:shadow-sm focus-visible:ring-fuchsia-500/40',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border',
          oscura
            ? 'border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-400/25 to-violet-500/20 text-fuchsia-100'
            : 'border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-violet-50 text-fuchsia-600',
        )}
      >
        {enviando ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MessageCircleQuestionMark className="size-4" strokeWidth={2} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-semibold md:text-base', oscura ? 'text-fuchsia-100' : 'text-zinc-900')}>
          Pedir asesoría
        </span>
        <span className={cn('mt-0.5 block text-xs leading-snug md:text-sm', oscura ? 'text-fuchsia-200/70' : 'text-zinc-500')}>
          Sin costo: tu barbero te recomienda qué hacerte
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-0.5',
          oscura ? 'text-fuchsia-200/60' : 'text-fuchsia-400',
          enviando && 'invisible',
        )}
      />
    </button>
  )
}

/**
 * Resultado de un pedido de asesoría, como una línea centrada.
 *
 * - `confirmada`: el pedido quedó en la fila (fucsia). El texto dice A QUIÉN le
 *   avisamos, nunca que el barbero «ya lo sabe» (hallazgo asesoria-03).
 * - `avisale`: no quedó —ya lo están atendiendo, es un turno, hubo demasiados
 *   pedidos seguidos, la sucursal la apagó o falló— y lo útil es una indicación
 *   concreta (texto neutro, ícono fucsia: es una indicación, no un error).
 */
export function AsesoriaKioskMensaje({
  variante,
  tono,
  conIcono = true,
  children,
  className,
}: {
  variante: VarianteAsesoriaKiosko
  tono: 'confirmada' | 'avisale'
  conIcono?: boolean
  children: ReactNode
  className?: string
}) {
  const oscura = variante === 'oscura'
  return (
    <p
      role="status"
      className={cn(
        'text-center text-base font-medium leading-snug text-balance md:text-lg',
        tono === 'confirmada'
          ? oscura
            ? 'text-fuchsia-200'
            : 'text-fuchsia-700'
          : oscura
            ? 'text-white/75'
            : 'text-zinc-600',
        className,
      )}
    >
      {conIcono && (
        <MessageCircleQuestionMark
          aria-hidden="true"
          className={cn(
            'mr-1.5 inline-block size-[1.1em] align-[-0.2em]',
            oscura ? 'text-fuchsia-300' : 'text-fuchsia-600',
          )}
        />
      )}
      {children}
    </p>
  )
}
