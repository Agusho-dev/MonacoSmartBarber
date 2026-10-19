import { Skeleton } from '@/components/ui/skeleton'

// Fila: el renglón de vistas (Fila en vivo | Turnos del día) con la sucursal y
// «Anotar cliente», y debajo los dos paneles del tablero: la fila (lista) y las
// sillas. Mismas medidas que el tablero, para que nada salte al cargar.
export default function FilaLoading() {
  return (
    <div className="flex flex-col gap-4 md:h-[calc(100dvh-8.25rem)] lg:-mb-[4.5rem] lg:h-[calc(100dvh-6.5rem)]">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-11 w-full rounded-xl sm:w-[18rem]" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 flex-1 rounded-md sm:w-[12.5rem] sm:flex-none" />
          <Skeleton className="h-10 w-40 rounded-md" />
        </div>
      </div>

      <div className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:flex-row">
        <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-border bg-card md:min-h-0 md:flex-1">
          <div className="space-y-3 border-b border-border px-4 pb-3 pt-4">
            <Skeleton className="h-7 w-40 rounded-md" />
            <Skeleton className="h-4 w-64 rounded" />
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-full" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 p-2 lg:gap-2 lg:p-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-white/[0.08] px-3 py-3">
                <Skeleton className="h-4 w-5 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-3 w-28 rounded" />
                </div>
                <Skeleton className="hidden h-4 w-24 rounded sm:block" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 max-md:-order-1 md:w-[20rem] xl:w-[22rem]">
          <Skeleton className="h-6 w-24 rounded-md" />
          <div className="flex gap-3 overflow-hidden md:flex-col">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-[18rem] shrink-0 space-y-3 rounded-2xl border border-border bg-card px-3.5 py-3 md:w-auto">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-28 rounded" />
                    <Skeleton className="h-3 w-20 rounded" />
                  </div>
                </div>
                <Skeleton className="h-9 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
