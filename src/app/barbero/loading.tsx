import { Skeleton } from '@/components/ui/skeleton'

// Loader para el panel barbero — dark theme (barber-theme class en el layout)
export default function BarberoLoading() {
  return (
    <div className="min-h-dvh bg-background pb-20 space-y-4 p-4">
      {/* Header del panel */}
      <div className="flex items-center justify-between py-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Tarjeta de turno activo */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      </div>

      {/* Lista de espera */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}
