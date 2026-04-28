import { Skeleton } from '@/components/ui/skeleton'

// Mensajería: nav lateral 7 iconos + lista conversaciones + chat + perfil cliente
// Mobile: fullscreen chat con bottom nav
export default function MensajeriaLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] overflow-hidden">
      {/* Nav lateral — solo desktop */}
      <div className="hidden w-14 shrink-0 flex-col items-center gap-2 border-r border-white/[0.06] bg-zinc-950/60 py-3 lg:flex">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="size-9 rounded-xl" />
        ))}
      </div>

      {/* Lista de conversaciones */}
      <div className="hidden w-[300px] shrink-0 flex-col border-r border-white/[0.06] bg-zinc-900/30 sm:flex">
        <div className="space-y-2 border-b border-white/[0.06] px-3 py-3">
          <Skeleton className="h-9 w-full rounded-md" />
          <div className="flex gap-1.5 overflow-x-auto">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 shrink-0 rounded-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-3.5 w-28 rounded" />
                    <Skeleton className="h-2.5 w-10 rounded" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded" />
                  <Skeleton className="h-2.5 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Chat principal */}
      <div className="flex flex-1 flex-col bg-zinc-950/40">
        {/* Header del chat */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] bg-zinc-900/40 px-4 py-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-2.5 w-20 rounded" />
          </div>
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
        </div>

        {/* Burbujas */}
        <div className="flex-1 space-y-4 overflow-hidden p-4">
          {Array.from({ length: 6 }).map((_, i) => {
            const isOwn = i % 2 === 0
            const widths = ['w-48', 'w-56', 'w-40', 'w-64', 'w-44', 'w-52']
            return (
              <div key={i} className={`flex ${isOwn ? 'justify-start' : 'justify-end'}`}>
                <div className="flex max-w-[70%] items-end gap-2">
                  {isOwn && <Skeleton className="size-7 shrink-0 rounded-full" />}
                  <div className="space-y-1">
                    <Skeleton className={`h-10 rounded-2xl ${widths[i]}`} />
                    <Skeleton className="ml-auto h-2 w-12 rounded" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] bg-zinc-900/40 p-3">
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <Skeleton className="h-10 flex-1 rounded-full" />
          <Skeleton className="size-9 shrink-0 rounded-full" />
        </div>
      </div>

      {/* Perfil cliente — solo xl+ */}
      <div className="hidden w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-zinc-900/30 xl:flex">
        <div className="flex flex-col items-center gap-2 border-b border-white/[0.06] px-4 py-5">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-20 rounded" />
              <Skeleton className="h-3.5 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
