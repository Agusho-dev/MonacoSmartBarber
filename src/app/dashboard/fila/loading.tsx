import { Skeleton } from '@/components/ui/skeleton'

// Skeleton para fila: vista kanban con columnas de estado
export default function FilaLoading() {
  return (
    <div className="space-y-4 p-6">
      {/* Header + selector de sucursal */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-9 w-44" />
      </div>

      {/* Columnas kanban */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {['En espera', 'En atención', 'Completado'].map((col) => (
          <div key={col} className="rounded-xl border border-border bg-card/50 p-3 space-y-3">
            {/* Encabezado de columna */}
            <div className="flex items-center justify-between px-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-7 rounded-full" />
            </div>
            {/* Tarjetas de clientes */}
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-3 w-36" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
