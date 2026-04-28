import { Skeleton } from '@/components/ui/skeleton'

// Onboarding wizard: stepper top con 6 pasos (Inicio, Branding, Sucursal,
// Servicios, Equipo, Listo) + form del paso actual + nav prev/next
export default function OnboardingLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,rgba(120,113,108,0.08),transparent_60%)]">
      {/* Header con stepper */}
      <div className="border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32 rounded-md" />
            <Skeleton className="h-3 w-24 rounded" />
          </div>
          {/* Stepper */}
          <div className="flex items-center gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-1 items-center gap-2">
                <Skeleton className={`size-7 shrink-0 rounded-full ${i === 0 ? 'bg-amber-500/30' : ''}`} />
                {i < 5 && <Skeleton className="h-px flex-1 rounded" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cuerpo del paso */}
      <div className="flex flex-1 items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-5">
          {/* Encabezado del paso */}
          <div className="space-y-2 text-center">
            <Skeleton className="mx-auto h-7 w-64 rounded-md" />
            <Skeleton className="mx-auto h-3 w-80 max-w-full rounded" />
          </div>

          {/* Card de form */}
          <div className="rounded-3xl border border-white/[0.08] bg-zinc-900/60 p-6 space-y-5 backdrop-blur-xl">
            {/* Logo upload */}
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="size-24 rounded-2xl" />
              <Skeleton className="h-3 w-40 rounded" />
            </div>

            {/* Inputs */}
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-11 w-full rounded-md" />
                </div>
              ))}
            </div>

            {/* Hint */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <div className="flex items-start gap-2">
                <Skeleton className="size-4 shrink-0 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-full rounded" />
                  <Skeleton className="h-2.5 w-2/3 rounded" />
                </div>
              </div>
            </div>
          </div>

          {/* Nav prev/next */}
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-11 w-28 rounded-md" />
            <Skeleton className="h-11 w-36 rounded-md bg-amber-500/20" />
          </div>
        </div>
      </div>
    </div>
  )
}
