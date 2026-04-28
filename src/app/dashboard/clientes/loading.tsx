import { Skeleton } from '@/components/ui/skeleton'

// Clientes: header con búsqueda + filtros sticky · KPIs por segmento · tabla
export default function ClientesLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-6 w-28 rounded-md" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-full max-w-sm rounded-md" />
            <Skeleton className="h-9 w-[160px] rounded-md" />
            <Skeleton className="h-9 w-[150px] rounded-md" />
          </div>
        </div>
      </div>

      {/* KPIs por segmento */}
      <div className="mx-auto w-full max-w-7xl px-4 pt-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-zinc-900/40 px-3 py-3">
              <Skeleton className="h-2.5 w-16 rounded" />
              <Skeleton className="mt-2 h-6 w-12 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
            {/* Table head — desktop */}
            <div className="hidden border-b border-white/[0.05] bg-zinc-950/40 px-4 py-2.5 md:grid md:grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_auto] md:gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16 rounded" />
              ))}
            </div>
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 md:grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_auto] md:items-center">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-32 rounded" />
                      <Skeleton className="h-2.5 w-24 rounded md:hidden" />
                    </div>
                  </div>
                  <Skeleton className="hidden h-3 w-24 rounded md:block" />
                  <Skeleton className="hidden h-3 w-12 rounded md:block" />
                  <Skeleton className="hidden h-3 w-12 rounded md:block" />
                  <Skeleton className="hidden h-3 w-12 rounded md:block" />
                  <Skeleton className="hidden h-3 w-20 rounded md:block" />
                  <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
