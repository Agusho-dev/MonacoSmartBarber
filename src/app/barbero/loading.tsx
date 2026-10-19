import { Skeleton } from '@/components/ui/skeleton'

// Panel del barbero mientras carga una pantalla. La banda del reloj y la barra
// de abajo son del layout y siguen a la vista: acá sólo va el contenido, en el
// mismo tema claro (antes era oscuro y la pantalla parpadeaba en negro al
// cambiar de sección).
export default function BarberoLoading() {
  return (
    <div className="px-4 py-4 sm:px-6" aria-busy="true" aria-label="Cargando">
      {/* Cabecera: quién sos y las acciones */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full bg-card" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40 rounded bg-card" />
          <Skeleton className="h-3 w-28 rounded bg-card" />
        </div>
        <Skeleton className="h-12 w-28 rounded-xl bg-card max-sm:w-12" />
        <Skeleton className="size-12 rounded-xl bg-card" />
      </div>

      {/* La silla */}
      <div className="mt-5">
        <div className="h-3 rounded-full bg-[var(--visor-bg)] opacity-15" />
        <Skeleton className="mx-2.5 h-56 rounded-[1.75rem] rounded-t-[0.625rem] bg-card" />
      </div>

      {/* El tarjetero */}
      <div className="mt-7 space-y-3">
        <Skeleton className="h-4 w-24 rounded bg-card" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-[1.25rem] bg-card" />
        ))}
      </div>
    </div>
  )
}
