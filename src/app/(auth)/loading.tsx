import { Skeleton } from '@/components/ui/skeleton'

// Auth/login: glassmorphism card centrada con form (email + password) + botón gold
export default function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(120,113,108,0.08),transparent_60%)] px-4">
      <div className="w-full max-w-sm space-y-5">
        {/* Encabezado */}
        <div className="space-y-2 text-center">
          <Skeleton className="mx-auto h-5 w-28 rounded-full" />
          <Skeleton className="mx-auto h-8 w-40 rounded-md" />
          <Skeleton className="mx-auto h-3 w-56 rounded" />
        </div>

        {/* Card glassmorphism */}
        <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-6 backdrop-blur-xl space-y-4">
          {/* Email */}
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
          {/* Password */}
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
          {/* Botón */}
          <Skeleton className="h-11 w-full rounded-md bg-amber-500/20" />
          {/* Link de recuperación */}
          <Skeleton className="mx-auto h-3 w-32 rounded" />
        </div>
      </div>
    </div>
  )
}
