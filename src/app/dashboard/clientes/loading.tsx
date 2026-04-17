import { Skeleton } from '@/components/ui/skeleton'

// Skeleton para clientes: buscador + tabla paginada
export default function ClientesLoading() {
  return (
    <div className="space-y-5 p-6">
      {/* Header + buscador */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-64" />
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Cabecera de tabla */}
        <div className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-border">
          {['Nombre', 'Teléfono', 'Visitas', 'Última visita'].map((col) => (
            <Skeleton key={col} className="h-3 w-20" />
          ))}
        </div>
        {/* Filas */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-border last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-3 w-28 self-center" />
            <Skeleton className="h-3 w-10 self-center" />
            <Skeleton className="h-3 w-24 self-center" />
          </div>
        ))}
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded" />
          <Skeleton className="h-8 w-20 rounded" />
        </div>
      </div>
    </div>
  )
}
