import { Skeleton } from '@/components/ui/skeleton'

// Loader para el wizard de onboarding
export default function OnboardingLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Indicador de pasos */}
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-2 rounded-full ${i === 0 ? 'w-8' : 'w-2'}`} />
          ))}
        </div>

        {/* Card del paso actual */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>

          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>

          <div className="flex justify-between pt-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
      </div>
    </div>
  )
}
