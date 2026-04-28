import { Skeleton } from '@/components/ui/skeleton'

// Skeleton del root del dashboard. Esta ruta hace redirect server-side, pero
// puede aparecer un instante mientras se resuelve. Mantenemos un placeholder
// minimalista coherente con el shell del dashboard.
export default function DashboardRootLoading() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-5rem)] flex-col">
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Skeleton className="h-6 w-40 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-full border border-white/[0.06] bg-zinc-900/40 px-4 py-2 text-xs text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
          </span>
          Cargando dashboard...
        </div>
      </div>
    </div>
  )
}
