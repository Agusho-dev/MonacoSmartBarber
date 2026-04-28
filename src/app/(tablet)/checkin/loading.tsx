import { Skeleton } from '@/components/ui/skeleton'

// Checkin (kiosk tablet): fullscreen con stepper top, contenido grande tipo home
// (branch info + 2 botones grandes Cliente / Staff)
export default function CheckinLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950">
      {/* Header con branch */}
      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40 rounded" />
            <Skeleton className="h-3 w-28 rounded" />
          </div>
        </div>
        <Skeleton className="size-10 rounded-md" />
      </div>

      {/* Body — botones grandes */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-10 w-72 rounded-md" />
          <Skeleton className="mx-auto h-4 w-56 rounded" />
        </div>

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="flex aspect-[4/3] flex-col items-center justify-center gap-4 rounded-3xl border border-white/[0.08] bg-zinc-900/60 p-8"
            >
              <Skeleton className="size-20 rounded-2xl" />
              <Skeleton className="h-6 w-32 rounded-md" />
              <Skeleton className="h-3 w-40 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 text-center">
        <Skeleton className="mx-auto h-3 w-48 rounded" />
      </div>
    </div>
  )
}
