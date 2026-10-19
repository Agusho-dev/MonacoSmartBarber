import { Skeleton } from '@/components/ui/skeleton'

// Fila: header con tabs (Fila | Turnos) + selector de sucursal,
// kanban horizontal con columnas por barbero + columna "Descansos"
export default function FilaLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col overflow-hidden">
      {/* Header sticky */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </div>
          {/* Tabs Fila | Turnos */}
          <div className="flex gap-1">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      {/* Kanban — overflow horizontal */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4">
          <div className="flex gap-3 overflow-x-auto pb-4">
            {Array.from({ length: 5 }).map((_, colIdx) => (
              <div
                key={colIdx}
                className="w-[280px] shrink-0 rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden"
              >
                {/* Header de columna (barbero) */}
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-3.5 w-24 rounded" />
                      <Skeleton className="h-2.5 w-16 rounded" />
                    </div>
                  </div>
                  <Skeleton className="size-6 rounded-full" />
                </div>

                {/* Cards de clientes */}
                <div className="space-y-2 p-2">
                  {Array.from({ length: 3 + (colIdx % 2) }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-3.5 w-28 rounded" />
                        <Skeleton className="h-4 w-12 rounded-full" />
                      </div>
                      <Skeleton className="h-2.5 w-32 rounded" />
                      <div className="flex gap-1.5 pt-1">
                        <Skeleton className="h-6 flex-1 rounded-md" />
                        <Skeleton className="size-6 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
