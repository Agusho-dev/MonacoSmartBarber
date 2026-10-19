'use client'

import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { POOL, type BarberRow } from './derivados'
import { FotoBarbero } from './foto-barbero'
import { ANILLO, type EstadoSilla } from './silla'

export interface DestinoDock {
  /** El barbero o `POOL` (Menor espera). */
  columnId: string
  nombre: string
  barbero?: BarberRow
  estado?: EstadoSilla
  /** "libre", "cortando 12′", "ya está acá"… */
  nota: string
  acepta: boolean
}

/**
 * En el celular las sillas son un riel de caras arriba de todo, que con la fila
 * scrolleada queda fuera de la pantalla: mientras se arrastra a un cliente, los
 * barberos (y Menor espera) suben en este dock fijo abajo, al alcance del pulgar,
 * con un blanco grande por barbero. Soltar en el fondo del dock no hace nada
 * (ver `deteccionDelTablero`): sólo cuentan sus barberos.
 */
export function DockSoltar({
  nombreCliente,
  destinos,
  refZona,
}: {
  nombreCliente: string
  destinos: DestinoDock[]
  refZona: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={refZona}
      role="group"
      aria-label={`Pasar a ${nombreCliente} a un barbero`}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-background/95 px-3 pt-3 backdrop-blur md:hidden',
        'pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_40px_-14px_rgb(0_0_0/0.85)]',
        // Sólo opacidad: con un `transform` de entrada, dnd-kit mide los blancos
        // corridos mientras el dock sube y el dedo cae en el de al lado.
        'animate-in fade-in duration-150',
      )}
    >
      <p className="mb-2.5 truncate px-1 text-[0.8125rem] text-muted-foreground">
        Soltá a <span className="font-semibold text-foreground">{nombreCliente}</span> en un barbero
      </p>
      <div className="grid grid-cols-4 gap-2">
        {destinos.map((d) => (
          <DestinoDelDock key={d.columnId} destino={d} />
        ))}
      </div>
    </div>
  )
}

function DestinoDelDock({ destino }: { destino: DestinoDock }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `dock:${destino.columnId}`,
    data: { type: 'Column', columnId: destino.columnId, zona: 'dock' },
    disabled: !destino.acepta,
  })
  const esPool = destino.columnId === POOL
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-[5.5rem] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-center',
        'transition-[scale,background-color,border-color,opacity] duration-150',
        isOver
          ? 'border-foreground bg-foreground text-background motion-safe:scale-[1.06]'
          : destino.acepta
            ? esPool
              ? 'border-sky-400/40 bg-sky-500/10'
              : 'border-white/[0.12] bg-white/[0.04]'
            : 'border-transparent opacity-35',
      )}
    >
      {esPool ? (
        <span className={cn('flex size-10 items-center justify-center rounded-full', isOver ? 'bg-background/15' : 'bg-sky-500/15')}>
          <span className="size-3 rounded-full bg-sky-400" aria-hidden />
        </span>
      ) : (
        <FotoBarbero
          barbero={destino.barbero}
          tamano="lg"
          className={cn(
            'size-10 ring-2 ring-offset-2',
            isOver ? 'ring-background ring-offset-foreground' : cn('ring-offset-background', destino.estado ? ANILLO[destino.estado] : 'ring-white/15'),
          )}
        />
      )}
      {esPool ? (
        // "Menor espera" no entra en un renglón de ~85 px: va en dos, sin nota.
        <span className="max-w-full text-xs font-semibold leading-tight">{isOver ? 'Soltá acá' : destino.nombre}</span>
      ) : (
        <>
          <span className="max-w-full truncate text-xs font-semibold leading-tight">{destino.nombre}</span>
          <span className={cn('max-w-full truncate text-[0.6875rem] leading-none', isOver ? 'text-background/75' : 'text-muted-foreground')}>
            {isOver ? 'Soltá acá' : destino.nota}
          </span>
        </>
      )}
    </div>
  )
}
