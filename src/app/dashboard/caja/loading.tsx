import { Skeleton } from '@/components/ui/skeleton'

// Skeleton coherente con el rediseño de Caja:
// header sticky · hero panel · metric strip (carrusel mobile / grid sm+) · timeline tickets · sidebar (podio + cierres)
export default function CajaLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-6 w-32 rounded-md" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-[160px] rounded-md" />
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-[180px] rounded-md" />
            <Skeleton className="h-8 w-[190px] rounded-md" />
            <div className="ml-auto">
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </div>
      </div>

      {/* Body scroll */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-5">
          {/* Hero panel */}
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-900/60 p-5 md:p-8">
            <div className="space-y-3">
              <Skeleton className="h-3 w-40 rounded" />
              <Skeleton className="h-12 w-56 rounded-md md:h-16 md:w-72" />
              <div className="flex gap-3">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-3 w-28 rounded" />
              </div>
              <div className="pt-4 space-y-2">
                <Skeleton className="h-2.5 w-full rounded-full" />
                <div className="flex gap-4">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
              </div>
            </div>
          </div>

          {/* Metric strip — mobile carrusel / sm+ grid */}
          <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-[78%] shrink-0 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-2.5 w-20 rounded" />
                    <Skeleton className="h-7 w-28 rounded" />
                  </div>
                  <Skeleton className="size-8 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden gap-3 sm:grid sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-2.5 w-24 rounded" />
                    <Skeleton className="h-7 w-32 rounded" />
                  </div>
                  <Skeleton className="size-8 rounded-xl" />
                </div>
              </div>
            ))}
          </div>

          {/* Layout 2-col */}
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Timeline tickets */}
            <div className="space-y-3 lg:col-span-2">
              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
                <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
                  <Skeleton className="h-4 w-24 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {Array.from({ length: 3 }).map((_, hourIdx) => (
                    <div key={hourIdx} className="px-3 py-2">
                      <div className="flex items-center gap-3 px-1 pb-2 pt-1">
                        <Skeleton className="h-3 w-12 rounded" />
                        <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                        <Skeleton className="h-3 w-24 rounded" />
                      </div>
                      <div className="space-y-1">
                        {Array.from({ length: 3 }).map((_, ticketIdx) => (
                          <div key={ticketIdx} className="relative overflow-hidden rounded-xl border border-white/[0.04] bg-zinc-950/30 px-3 py-2.5 pl-4">
                            <span className="absolute left-0 top-0 h-full w-0.5 bg-zinc-700" />
                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-1.5">
                                <Skeleton className="h-3.5 w-32 rounded" />
                                <Skeleton className="h-2.5 w-40 rounded" />
                              </div>
                              <div className="space-y-1 text-right">
                                <Skeleton className="ml-auto h-4 w-20 rounded" />
                                <Skeleton className="ml-auto h-3 w-16 rounded-full sm:hidden" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-5">
              {/* Podio */}
              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-3 w-16 rounded" />
                </div>
                <div className="space-y-1.5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-zinc-950/40 px-3 py-2">
                      <Skeleton className="size-7 shrink-0 rounded-full" />
                      <Skeleton className="size-7 shrink-0 rounded-full" />
                      <Skeleton className="h-3.5 flex-1 rounded" />
                      <Skeleton className="h-4 w-20 rounded" />
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-24 rounded" />
                    <Skeleton className="h-4 w-24 rounded" />
                  </div>
                </div>
              </div>

              {/* Cierres */}
              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
                <div className="border-b border-white/[0.05] px-4 py-3 space-y-2">
                  <Skeleton className="h-4 w-40 rounded" />
                  <Skeleton className="h-6 w-48 rounded-full" />
                </div>
                <div className="space-y-2 p-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-white/[0.06] bg-zinc-950/40 px-3 py-2.5 pl-4">
                      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
                        <Skeleton className="size-8 shrink-0 rounded-full" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-3.5 w-28 rounded" />
                          <Skeleton className="h-2.5 w-36 rounded" />
                        </div>
                        <Skeleton className="size-4 rounded" />
                        <div className="col-span-2 col-start-2 flex justify-end min-[420px]:col-span-3 min-[420px]:col-start-1">
                          <Skeleton className="h-5 w-20 rounded-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
