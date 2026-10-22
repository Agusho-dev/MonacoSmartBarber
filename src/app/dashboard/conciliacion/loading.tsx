import { Skeleton } from '@/components/ui/skeleton'

/** Espeja la pantalla real (encabezado, período, veredicto + Tex, tira, cuentas, casos), sin cifras. */
export default function ConciliacionLoading() {
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 lg:space-y-5" aria-busy="true" aria-label="Cargando la conciliación">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-44 rounded-md" />
          <Skeleton className="h-4 w-80 max-w-full rounded" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-12 w-full rounded-lg sm:w-64" />
          <Skeleton className="h-11 w-full rounded-lg sm:w-96" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6 lg:col-span-8">
          <Skeleton className="h-10 w-3/4 rounded-lg lg:h-14" />
          <Skeleton className="h-4 w-2/3 rounded" />
          <div className="space-y-2.5 pt-2">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-11/12 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6 lg:col-span-4">
          <Skeleton className="hidden h-[120px] w-[150px] rounded-2xl lg:block" />
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-5/6 rounded" />
          <Skeleton className="h-10 w-full rounded-md lg:w-44" />
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <Skeleton className="mb-3 h-4 w-32 rounded" />
        <div className="flex gap-1 overflow-hidden">
          {Array.from({ length: 30 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-7 shrink-0 rounded-[5px] lg:h-8 lg:w-6" />
          ))}
        </div>
      </div>

      <Skeleton className="h-12 w-full rounded-xl lg:hidden" />
      <div className="hidden grid-cols-3 gap-3 lg:grid xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-xl" />
        ))}
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="space-y-3 border-b border-white/[0.06] p-4 sm:p-5">
          <Skeleton className="h-5 w-20 rounded" />
          <Skeleton className="h-11 w-full rounded-lg lg:w-[36rem]" />
          <Skeleton className="h-10 w-full rounded-md lg:w-72" />
        </div>
        <div className="divide-y divide-white/[0.05]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4 sm:px-5">
              <Skeleton className="h-10 w-1 rounded-full lg:hidden" />
              <Skeleton className="h-4 flex-1 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
