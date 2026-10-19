import { cn } from '@/lib/utils'

/**
 * Sello del panel del barbero: la marca chica que se le pone a una ficha
 * ("Primer corte", "Menor espera", "Pausado"…). Misma gramática que `TurnoBadge`
 * y `AsesoriaBadge` —borde y fondo del color, mayúsculas espaciadas— pero un
 * punto más grande: en el panel se lee desde la silla.
 *
 * Cada tono es una palabra del vocabulario de color del sistema y no se usa
 * para otra cosa: violeta turnos, fucsia asesoría, azul Menor espera, verde
 * primer corte, ámbar especial / descanso / demora. `tinta` (grafito lleno)
 * marca el estado de la silla ("Sigue"). `heredado` va sobre la cartulina de
 * color de la tarjeta del corte (toma el color de su texto).
 */
export type TonoSello = 'violeta' | 'fucsia' | 'azul' | 'verde' | 'ambar' | 'neutro' | 'tinta' | 'heredado'

const TONOS: Record<TonoSello, string> = {
  violeta: 'border-violet-500/45 bg-violet-500/10 text-violet-700',
  fucsia: 'border-fuchsia-500/45 bg-fuchsia-500/10 text-fuchsia-700',
  azul: 'border-blue-500/45 bg-blue-500/10 text-blue-700',
  verde: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-700',
  ambar: 'border-amber-500/55 bg-amber-400/15 text-amber-800',
  neutro: 'border-border bg-muted text-foreground/80',
  tinta: 'border-transparent bg-primary text-primary-foreground',
  heredado: 'border-current/30 bg-black/10 text-current',
}

export const CLASE_SELLO =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[0.6875rem] font-bold uppercase leading-none tracking-[0.07em] [&_svg]:size-3 [&_svg]:shrink-0'

export function Sello({
  tono,
  children,
  title,
  className,
}: {
  tono: TonoSello
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <span title={title} className={cn(CLASE_SELLO, TONOS[tono], className)}>
      {children}
    </span>
  )
}
