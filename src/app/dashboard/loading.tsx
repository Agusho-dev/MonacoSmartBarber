import { Skeleton } from '@/components/ui/skeleton'

// Skeleton global del dashboard: imita sidebar + panel principal con cards
export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar simulado */}
      <div className="hidden w-64 shrink-0 border-r border-border bg-sidebar p-4 md:flex md:flex-col md:gap-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/6" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>

      {/* Panel principal */}
      <div className="flex-1 space-y-6 p-6">
        {/* Header de página */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-36" />
        </div>

        {/* Fila de cards de métricas */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>

        {/* Fila de cards secundarias */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 md:col-span-2">
            <Skeleton className="h-4 w-36" />
            <div className="grid grid-cols-3 gap-4 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-6 w-12" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabla / lista de actividad reciente */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <div className="space-y-1.5 text-right">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
