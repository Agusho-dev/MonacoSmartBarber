'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

// Boundary global de errores del dashboard
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  const router = useRouter()
  const [reintentando, startTransition] = useTransition()

  // reset() solo no vuelve a pedirle nada al servidor: ante un error de una
  // consulta (la base lenta) mostraba lo mismo. refresh() trae la página de
  // nuevo. En la app instalada no hay botón de recargar.
  function reintentar() {
    // Sin red, refresh() termina en una navegación completa y queda la página
    // de error del navegador, que en la app instalada no tiene salida.
    if (navigator.onLine === false) {
      reset()
      toast.error('Sin conexión. Probá de nuevo cuando vuelva la red.')
      return
    }
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

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

      <Button onClick={reintentar} disabled={reintentando}>
        Reintentar
      </Button>
    </div>
  )
}
