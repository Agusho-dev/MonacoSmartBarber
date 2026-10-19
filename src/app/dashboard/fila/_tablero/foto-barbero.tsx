import { cn } from '@/lib/utils'
import { iniciales, type BarberRow } from './derivados'

const TAMANOS = {
  xs: 'size-4 text-[0.5rem]',
  md: 'size-8 text-[0.6875rem]',
  lg: 'size-11 text-sm',
} as const

/**
 * La cara del barbero (o sus iniciales). En el tablero los barberos se
 * reconocen por la cara antes que por el nombre: va en las sillas y, chiquita,
 * en cada renglón de la fila ("con Fran").
 */
export function FotoBarbero({
  barbero,
  tamano = 'md',
  className,
}: {
  barbero?: Pick<BarberRow, 'full_name' | 'avatar_url'>
  tamano?: keyof typeof TAMANOS
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground',
        TAMANOS[tamano],
        className,
      )}
      aria-hidden
    >
      {barbero?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={barbero.avatar_url}
          alt=""
          className="size-full object-cover"
          style={{ objectPosition: 'center 15%' }}
          draggable={false}
        />
      ) : (
        iniciales(barbero?.full_name)
      )}
    </span>
  )
}
