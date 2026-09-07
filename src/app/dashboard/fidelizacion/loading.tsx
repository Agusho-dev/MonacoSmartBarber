import { Skeleton } from '@/components/ui/skeleton'

// Fidelización: header · sub-nav · interruptor · 4 tarjetas · KPIs · timeline
export default function FidelizacionLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-36 rounded-md" />
          <Skeleton className="hidden h-3.5 w-96 rounded sm:block" />
        </div>
      </div>

      <div className="-mx-3 border-b border-white/[0.06] px-3 py-1 lg:-mx-6 lg:px-6">
        <div className="flex gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <Skeleton className="size-12 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-52 rounded" />
              <Skeleton className="h-3.5 w-80 rounded" />
              <Skeleton className="h-3 w-64 rounded" />
            </div>
          </div>
          <Skeleton className="h-8 w-14 rounded-full" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5">
            <Skeleton className="aspect-[1.586/1] w-full rounded-[22px]" />
            <div className="space-y-1.5 px-1">
              <Skeleton className="h-6 w-16 rounded" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-3 w-28 rounded" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-zinc-900/40 px-3 py-3">
            <Skeleton className="h-2.5 w-20 rounded" />
            <Skeleton className="mt-2 h-6 w-12 rounded" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40">
          <div className="border-b border-white/[0.05] px-4 py-3"><Skeleton className="h-4 w-36 rounded" /></div>
          <div className="divide-y divide-white/[0.04]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-2 rounded-full" />
                <Skeleton className="h-3.5 flex-1 rounded" />
                <Skeleton className="h-3 w-14 rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </div>
    </div>
  )
}
