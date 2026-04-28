import { Skeleton } from '@/components/ui/skeleton'

// Equipo: header con tabs (Barberos | Calendario | Descansos | Incentivos | Disciplina | Roles | Perfiles)
// + tabla de staff con stats
export default function EquipoLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-6 w-24 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-md" />
            ))}
          </div>
        </div>
      </div>

      {/* KPIs strip */}
      <div className="mx-auto w-full max-w-7xl px-4 pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-2.5 w-20 rounded" />
                  <Skeleton className="h-7 w-16 rounded" />
                </div>
                <Skeleton className="size-8 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Body — tabla de barberos */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
            <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-3 w-16 rounded" />
            </div>
            {/* Header de tabla en desktop */}
            <div className="hidden border-b border-white/[0.05] bg-zinc-950/40 px-4 py-2.5 md:grid md:grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr_auto] md:gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-16 rounded" />
              ))}
            </div>
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 md:grid-cols-[1.5fr_1fr_0.8fr_0.8fr_0.8fr_auto] md:items-center">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-3.5 w-32 rounded" />
                      <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                  </div>
                  <Skeleton className="hidden h-3 w-20 rounded md:block" />
                  <Skeleton className="hidden h-3 w-12 rounded md:block" />
                  <Skeleton className="hidden h-3 w-16 rounded md:block" />
                  <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
                  <Skeleton className="ml-auto size-8 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
