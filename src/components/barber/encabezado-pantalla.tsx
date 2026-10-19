import { cn } from '@/lib/utils'

/**
 * Encabezado de las pantallas del panel que no son la fila (Metas, Asistencia,
 * Historial, Caja). Se pega DEBAJO de la banda del reloj (`--alto-banda`): pegado
 * arriba de todo quedaba tapado por ella al scrollear.
 */
export function EncabezadoPantalla({
  titulo,
  detalle,
  antes,
  despues,
  className,
}: {
  titulo: string
  detalle?: React.ReactNode
  /** Algo a la izquierda del título (p. ej. "volver"). */
  antes?: React.ReactNode
  /** Algo a la derecha. */
  despues?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'sticky top-[var(--alto-banda)] z-30 border-b border-border/70 bg-background px-4 py-4 sm:px-6',
        className,
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {antes}
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] max-sm:text-[1.375rem]">{titulo}</h1>
          {detalle && <p className="mt-0.5 truncate text-[0.9375rem] text-muted-foreground">{detalle}</p>}
        </div>
        {despues}
      </div>
    </header>
  )
}
