import { cn } from '@/lib/utils'

/**
 * Piezas del cobro (`complete-service-dialog.tsx`) en el lenguaje del panel —el
 * "reloj fichador", ver DESIGN.md—. El cobro también se abre en el dashboard
 * (fila, agenda, turnos), que es oscuro: todo sale de los tokens del tema y el
 * visor tiene su par oscuro en `:root` (globals.css). Los avisos de color van
 * por `claseAviso` (cobro/tono.ts), nunca con `dark:`.
 */

/** Título de una parte del cobro: "Servicio", "Productos (opcional)"… */
export function TituloCobro({
  id,
  children,
  opcional,
  detalle,
  className,
}: {
  id?: string
  children: React.ReactNode
  opcional?: boolean
  /** Algo a la derecha del título (un conteo, un "Quitar"). */
  detalle?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <h3 id={id} className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
        {children}
        {opcional && <span className="ml-1.5 text-[0.9375rem] font-normal text-muted-foreground">(opcional)</span>}
      </h3>
      {detalle}
    </div>
  )
}

/**
 * En qué paso del cobro está: va DEBAJO del nombre del cliente (no es un rótulo
 * arriba del título). Dos tramos: qué se hizo y cómo paga. Acepta las props de
 * un div para poder ser la descripción del diálogo (`DialogDescription asChild`).
 */
export function PasoDelCobro({
  paso,
  className,
  ...props
}: { paso: 1 | 2 } & Omit<React.ComponentProps<'div'>, 'children'>) {
  return (
    <div {...props} className={cn('mt-2 flex items-center gap-3', className)}>
      <span aria-hidden className="flex gap-1">
        {[1, 2].map((n) => (
          <span
            key={n}
            className={cn(
              'h-1.5 w-7 rounded-full motion-safe:transition-colors motion-safe:duration-300',
              n <= paso ? 'bg-foreground' : 'bg-foreground/15',
            )}
          />
        ))}
      </span>
      <span className="text-[0.9375rem] font-medium text-muted-foreground">
        Paso {paso} de 2 · {paso === 1 ? 'Qué se hizo' : 'Cómo paga'}
      </span>
    </div>
  )
}

/**
 * El número a cobrar en el visor del reloj (la misma ventana de la hora y de
 * Caja): lo único oscuro del cobro, así no hay dónde perderlo. `etiqueta` es una
 * frase ("A cobrar"), no un rótulo de mayúsculas.
 *
 * `align-top`: `.visor-hora` es inline-flex (sin capa, le gana a `flex`), y
 * alineado a la base dejaba unos píxeles de renglón debajo del visor.
 */
export function VisorMonto({
  etiqueta,
  monto,
  children,
  className,
}: {
  etiqueta: string
  monto: string
  /** Debajo del número (tachado del descuento, desglose con seña o propina). */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={`${etiqueta}: ${monto}`}
      className={cn('visor-hora w-full flex-col rounded-[1.5rem] px-5 py-6 text-center align-top', className)}
    >
      <p className="font-sans text-base font-medium tracking-normal opacity-80">{etiqueta}</p>
      <p className="mt-2 break-all text-[clamp(2.75rem,10vw,4.5rem)] font-semibold leading-none tracking-[-0.04em]">
        {monto}
      </p>
      {children && <div className="mt-3 w-full font-sans tracking-normal">{children}</div>}
    </section>
  )
}

/**
 * Lo que se elige con un toque en el cobro (servicio, extra, método de pago,
 * propina): cartulina con filete; elegido, grafito lleno —como la sección
 * activa de la barra de abajo, que se lee desde la silla—. Sin agrandarse al
 * elegir: un botón que crece empuja a los de al lado.
 */
export const CLASE_OPCION =
  'border-2 outline-none motion-safe:transition-[background-color,border-color,color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50'

export function claseEstadoOpcion(elegida: boolean): string {
  return elegida
    ? 'border-primary bg-primary text-primary-foreground shadow-md'
    : 'border-border bg-card text-foreground hover:border-foreground/35'
}
