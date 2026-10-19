import { Coffee, RotateCw, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * La ranura del reloj fichador: la boca grafito de la que cuelga la ficha que
 * está en la silla (el cliente que se atiende, el que sigue, el descanso). Es la
 * única pieza oscura de la pantalla además del visor de la hora: las dos son
 * "la máquina"; todo lo demás es cartulina.
 *
 * Lo que entra a la ranura baja desde la boca; la ranura recorta sólo hacia
 * arriba (`clip-path`), así la ficha nace de adentro y las sombras de los
 * costados y de abajo no se cortan. Ver `.ranura` en globals.css.
 *
 * La animación de entrada va en un ENVOLTORIO (`.ranura-ficha`) que se vuelve a
 * montar cuando cambia `clave` (lo que está en la silla), nunca en la ficha:
 * dos reglas que ponen `animation` sobre el mismo elemento se pisan, y el rojo
 * del semáforo y el anillo de asesoría dejaban de latir.
 */
export function Ranura({
  clave,
  children,
  className,
}: {
  /** Qué está en la silla (id de la entrada o un estado): al cambiar, entra de nuevo. */
  clave: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('ranura', className)}>
      <div aria-hidden className="ranura-boca" />
      <div key={clave} className="ranura-ficha silla-entra">
        {children}
      </div>
    </div>
  )
}

/** Silla libre y nadie en tu fila. */
export function SillaVacia({ esperandoEnElLocal }: { esperandoEnElLocal: number }) {
  return (
    <div
      role="status"
      className="rounded-[1.75rem] border-2 border-dashed border-foreground/15 bg-card/55 px-6 py-12 text-center sm:py-14"
    >
      {esperandoEnElLocal > 0 ? (
        <>
          <p className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] max-sm:text-2xl">Tu fila está vacía</p>
          <p className="mx-auto mt-2 max-w-sm text-base text-muted-foreground">
            {esperandoEnElLocal === 1 ? 'Hay 1 persona esperando' : `Hay ${esperandoEnElLocal} personas esperando`} en el
            local: está{esperandoEnElLocal === 1 ? '' : 'n'} más abajo.
          </p>
        </>
      ) : (
        <>
          <p className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] max-sm:text-2xl">Silla libre</p>
          <p className="mx-auto mt-2 max-w-sm text-base text-muted-foreground">
            Cuando llegue alguien a tu fila, aparece acá.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Lo primero de tu fila es tu descanso: lo arranca el panel solo apenas nada lo
 * tapa (`startPendingBreakIfReady`), así que este estado dura un instante.
 */
export function SillaDescansoProximo() {
  return (
    <div
      role="status"
      className="flex items-center gap-4 rounded-[1.75rem] border-2 border-dashed border-amber-500/45 bg-amber-400/10 px-6 py-9"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400/25 text-amber-800">
        <Coffee className="size-6" aria-hidden />
      </span>
      <div>
        <p className="text-2xl font-bold leading-tight tracking-[-0.02em] text-amber-900">Lo próximo es tu descanso</p>
        <p className="mt-1 text-base text-amber-900/75">Arranca solo en un momento.</p>
      </div>
    </div>
  )
}

/**
 * La primera lectura de la fila falló. NO es "silla libre": sin datos no se sabe
 * si hay alguien esperando, y decir que no lo hay es la falla silenciosa que el
 * panel no se permite (Known Risk #13). Realtime y el refresco de 30 s vuelven a
 * intentar solos; el botón es para no esperar.
 */
export function SillaSinLeer({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-[1.75rem] border-2 border-dashed border-red-500/40 bg-red-50 px-6 py-10 text-center"
    >
      <WifiOff className="mx-auto size-8 text-red-700" aria-hidden />
      <p className="mt-3 text-2xl font-bold leading-tight tracking-[-0.02em] text-red-900">No pudimos leer la fila</p>
      <p className="mx-auto mt-1.5 max-w-sm text-base text-red-900/80">
        Revisá la conexión. Se vuelve a intentar sola en unos segundos.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={onReintentar}
        className="mt-5 h-12 rounded-xl border-red-500/40 bg-card px-5 text-base font-semibold"
      >
        <RotateCw className="size-4" aria-hidden />
        Reintentar ahora
      </Button>
    </div>
  )
}

/** Primera lectura de la fila. Sólo la primera: después se conserva lo último bueno. */
export function SillaCargando() {
  return <Skeleton className="h-64 rounded-[1.75rem] bg-card" />
}
