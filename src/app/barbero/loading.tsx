import { Skeleton } from '@/components/ui/skeleton'

// Panel barbero: header sticky · contenido scrolleable · bottom nav fijo
// Cubre fila / historial / rendimiento / metas / asistencia / facturación / cerrar-turno
export default function BarberoLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 pb-20">
      {/* Header sticky */}
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-zinc-950/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-2.5 w-20 rounded" />
            </div>
          </div>
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>

      {/* KPI / hero del panel */}
      <div className="px-4 pt-4">
        <div className="rounded-3xl border border-white/[0.08] bg-zinc-900/60 p-5 space-y-3">
          <Skeleton className="h-2.5 w-32 rounded" />
          <Skeleton className="h-12 w-40 rounded-md" />
          <div className="flex gap-3">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
        </div>
      </div>

      {/* Strip de stats */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-2.5 w-16 rounded" />
                  <Skeleton className="h-7 w-16 rounded" />
                </div>
                <Skeleton className="size-8 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lista — fila / historial / metas */}
      <div className="flex-1 space-y-2 px-4 py-4">
        <Skeleton className="h-4 w-32 rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32 rounded" />
                <Skeleton className="h-2.5 w-24 rounded" />
              </div>
              <div className="space-y-1 text-right">
                <Skeleton className="ml-auto h-3 w-12 rounded" />
                <Skeleton className="ml-auto h-3 w-16 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom nav fijo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.06] bg-zinc-950/90 backdrop-blur-xl">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1 px-2 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 py-1">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-2 w-10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
