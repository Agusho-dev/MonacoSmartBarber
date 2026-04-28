import { Skeleton } from '@/components/ui/skeleton'

// Sueldos: header con selector sucursal · accordion por barbero · tabla de reportes · pagos
export default function SueldosLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-6 w-24 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-36 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-5">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
                <Skeleton className="h-2.5 w-24 rounded" />
                <Skeleton className="mt-2 h-7 w-32 rounded" />
              </div>
            ))}
          </div>

          {/* Accordion por barbero */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
            <div className="border-b border-white/[0.05] px-4 py-3">
              <Skeleton className="h-4 w-44 rounded" />
            </div>
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-32 rounded" />
                      <Skeleton className="h-2.5 w-24 rounded" />
                    </div>
                    <div className="hidden text-right md:block">
                      <Skeleton className="ml-auto h-3 w-16 rounded" />
                      <Skeleton className="ml-auto mt-1 h-4 w-24 rounded" />
                    </div>
                    <Skeleton className="size-8 shrink-0 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla de reportes generados */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
            <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
            <div className="hidden border-b border-white/[0.05] bg-zinc-950/40 px-4 py-2.5 md:grid md:grid-cols-[1.5fr_1fr_1fr_0.8fr_auto] md:gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16 rounded" />
              ))}
            </div>
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 md:grid-cols-[1.5fr_1fr_1fr_0.8fr_auto] md:items-center">
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-32 rounded" />
                    <Skeleton className="h-2.5 w-24 rounded md:hidden" />
                  </div>
                  <Skeleton className="hidden h-3 w-20 rounded md:block" />
                  <Skeleton className="hidden h-3 w-20 rounded md:block" />
                  <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
                  <Skeleton className="ml-auto h-8 w-8 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
