'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

// Boundary global de errores del dashboard
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    // Patrón listo para Sentry: Sentry.captureException(error)
    console.error('[dashboard:error]', {
      message: error.message,
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-8 text-destructive" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Algo salió mal</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Ocurrió un error inesperado al cargar esta sección. Podés intentarlo de nuevo o volver
          más tarde.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">
            Código: {error.digest}
          </p>
        )}
      </div>

      <Button onClick={reset}>Reintentar</Button>
    </div>
  )
}
