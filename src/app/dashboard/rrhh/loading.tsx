import { Skeleton } from '@/components/ui/skeleton'

/** Espeja el layout real (header sticky + tiles + grilla), no un rectángulo genérico. */
export default function RrhhLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden lg:h-[calc(100dvh-5rem)]">
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[100rem] space-y-3 px-4 pt-3 pb-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48 rounded" />
              <Skeleton className="h-3 w-64 rounded" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[100rem] gap-4 px-4 py-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40">
              <Skeleton className="aspect-[16/10] rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-full rounded" />
                <Skeleton className="h-3 w-3/4 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
