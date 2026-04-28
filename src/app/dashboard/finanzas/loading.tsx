import { Skeleton } from '@/components/ui/skeleton'

// Finanzas: tabs (Resumen | Cuentas | Sueldos | Egresos | Gastos fijos)
// + KPIs + gráfico tendencia + gráfico secundario + tabla
export default function FinanzasLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky con tabs */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-6 w-28 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-28 shrink-0 rounded-md" />
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-2.5 w-24 rounded" />
                    <Skeleton className="h-7 w-28 rounded" />
                    <Skeleton className="h-2.5 w-16 rounded" />
                  </div>
                  <Skeleton className="size-8 rounded-xl" />
                </div>
              </div>
            ))}
          </div>

          {/* Gráfico principal */}
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
            <div className="relative">
              <Skeleton className="h-56 w-full rounded-lg" />
              {/* Eje */}
              <div className="mt-2 flex justify-between">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-2 w-8 rounded" />
                ))}
              </div>
            </div>
          </div>

          {/* Gráficos secundarios */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-4">
              <Skeleton className="h-4 w-36 rounded" />
              <Skeleton className="h-48 w-full rounded-lg" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-2 rounded-full" />
                      <Skeleton className="h-3 w-24 rounded" />
                    </div>
                    <Skeleton className="h-3 w-16 rounded" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
              <Skeleton className="h-4 w-40 rounded" />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-3 w-28 rounded" />
                      <Skeleton className="h-3 w-16 rounded" />
                    </div>
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla últimos egresos */}
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
            <div className="border-b border-white/[0.05] px-4 py-3">
              <Skeleton className="h-4 w-32 rounded" />
            </div>
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-8 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-32 rounded" />
                    <Skeleton className="h-2.5 w-24 rounded" />
                  </div>
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
