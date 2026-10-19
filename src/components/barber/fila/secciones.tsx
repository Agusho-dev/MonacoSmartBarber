import { Scissors } from 'lucide-react'
import type { LoyaltyTierLite } from '@/lib/loyalty-checkout'
import { cn } from '@/lib/utils'
import { AsesoriaBadge } from '../asesoria-badge'
import { LoyaltyTierChip } from '../loyalty-tier-chip'
import { CifraEspera } from './tarjeta-espera'

/**
 * Un tramo del tarjetero: título, cuántos hay y las fichas. Todo a la vista en
 * una sola columna —tu fila, el resto del local y quién está cortando—, sin
 * pestañas: la pestaña "General" era un cajón que nadie abría y un cliente sin
 * barbero sólo existía ahí.
 */
export function SeccionFila({
  id,
  titulo,
  cantidad,
  aviso,
  children,
  className,
}: {
  id: string
  titulo: string
  cantidad?: number
  /** Algo para mirar en este tramo (p. ej. "2 sin barbero"). */
  aviso?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 id={id} className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
          {titulo}
        </h3>
        {cantidad != null && (
          <span className="font-mono text-[0.9375rem] font-semibold tabular-nums text-muted-foreground">{cantidad}</span>
        )}
        {aviso}
      </div>
      {children}
    </section>
  )
}

/** Renglón chico de "nadie más" dentro de un tramo. */
export function TramoVacio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-foreground/12 px-4 py-3.5 text-[0.9375rem] text-muted-foreground">
      {children}
    </p>
  )
}

export interface CorteDeOtro {
  id: string
  barbero: string
  cliente: string
  /** Minutos que lleva el corte, o null si no arrancó con hora. */
  minutos: number | null
  tier: LoyaltyTierLite | null
  pidioAsesoria: boolean
}

/** Quién está cortando ahora en el local: chico y apagado, es contexto. */
export function CortandoAhora({ cortes }: { cortes: CorteDeOtro[] }) {
  if (cortes.length === 0) return null
  return (
    <SeccionFila id="fila-cortando" titulo="Cortando ahora" cantidad={cortes.length}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {cortes.map((c) => (
          <li
            key={c.id}
            className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-card/55 px-4 py-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Scissors className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold">{c.barbero}</p>
              <div className="flex min-w-0 items-center gap-1.5">
                {/* "atiende a", no "con": en "En el local" el "con X" es el barbero. */}
                <p className="truncate text-[0.8125rem] text-muted-foreground">atiende a {c.cliente}</p>
                {c.tier && <LoyaltyTierChip tier={c.tier} />}
                {c.pidioAsesoria && <AsesoriaBadge tono="claro" />}
              </div>
            </div>
            {c.minutos != null && (
              <span className="shrink-0 text-[0.9375rem] text-muted-foreground">
                <CifraEspera minutos={c.minutos} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </SeccionFila>
  )
}
