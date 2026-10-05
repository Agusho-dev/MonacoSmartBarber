import { MessageCircleQuestionMark } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Sello de «este cliente pidió asesoría» (mig 217), compartido por el panel del
 * barbero, el cobro y el dashboard para que las tres superficies hablen el mismo
 * idioma visual. La TV NO lo usa: es pública.
 *
 * Sigue la forma de `TurnoBadge` —misma pastilla, mismo peso, ícono a la
 * izquierda— porque pueden aparecer juntos sobre la misma tarjeta. El fucsia es
 * exclusivo de la asesoría: violeta son los turnos, ámbar los descansos y
 * demoras, verde el corte en curso y el primer corte, azul/amarillo Menor espera.
 *
 * El tono se elige con la prop y no con `dark:`: el panel, el cobro y el
 * dashboard no comparten tema, y cada pantalla sabe sobre qué fondo lo dibuja.
 *
 * Con `onClick` es un botón (reabrir el pop-up en modo consulta): el área
 * táctil se agranda con un pseudo-elemento a 44 px o más de alto, sin mover el
 * layout ni cambiar cómo se ve el sello.
 */

export type TonoAsesoriaBadge = 'claro' | 'oscuro'
export type TamanoAsesoriaBadge = 'sm' | 'md'

interface AsesoriaBadgeProps {
  /** `claro` sobre fondos blancos/grises claros; `oscuro` sobre zinc/negro. */
  tono: TonoAsesoriaBadge
  /** `sm` (por defecto) = la escala de `TurnoBadge`; `md` = tarjeta del cliente actual / pop-up. */
  tamano?: TamanoAsesoriaBadge
  /** Si viene, el sello es un botón con área táctil de 44 px o más. */
  onClick?: () => void
  /** Nombre accesible del botón (sólo con `onClick`). */
  ariaLabel?: string
  className?: string
}

const TONOS: Record<TonoAsesoriaBadge, string> = {
  claro: 'border-fuchsia-500/35 bg-fuchsia-500/12 text-fuchsia-700',
  oscuro: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
}

const TAMANOS: Record<TamanoAsesoriaBadge, { caja: string; icono: string }> = {
  sm: { caja: 'gap-1 px-1.5 py-px text-[10px]', icono: 'size-3' },
  md: { caja: 'gap-1.5 px-2 py-0.5 text-xs', icono: 'size-3.5' },
}

export function AsesoriaBadge({ tono, tamano = 'sm', onClick, ariaLabel, className }: AsesoriaBadgeProps) {
  const escala = TAMANOS[tamano]
  const base = cn(
    'inline-flex shrink-0 items-center rounded-md border font-bold uppercase tracking-wider',
    escala.caja,
    TONOS[tono],
  )
  const contenido = (
    <>
      <MessageCircleQuestionMark aria-hidden="true" className={cn('shrink-0', escala.icono)} />
      <span>Asesoría</span>
    </>
  )

  if (!onClick) {
    return <span className={cn(base, className)}>{contenido}</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? 'Ver el pedido de asesoría'}
      className={cn(
        base,
        // Área táctil: el pseudo-elemento suma 14 px arriba y abajo (el sello
        // `sm` mide ~18 px → ~46 px) y 8 px a los costados, sin afectar el layout.
        "relative cursor-pointer touch-manipulation select-none before:absolute before:-inset-x-2 before:-inset-y-3.5 before:content-['']",
        'hover:bg-fuchsia-500/20',
        'outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 focus-visible:ring-offset-1',
        tono === 'claro' ? 'focus-visible:ring-offset-white' : 'focus-visible:ring-offset-zinc-900',
        'motion-safe:transition motion-safe:active:scale-95',
        className,
      )}
    >
      {contenido}
    </button>
  )
}
