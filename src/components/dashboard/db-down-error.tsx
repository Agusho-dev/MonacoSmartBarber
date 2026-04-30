'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface DbDownErrorProps {
  /** Mensaje adicional opcional para contexto (e.g. en qué superficie ocurrió) */
  context?: string
}

const INITIAL_RETRY_SECONDS = 15
const MAX_RETRY_SECONDS = 60

export function DbDownError({ context }: DbDownErrorProps) {
  const [segundosRestantes, setSegundosRestantes] = useState(INITIAL_RETRY_SECONDS)
  const [intentos, setIntentos] = useState(0)

  useEffect(() => {
    if (segundosRestantes <= 0) {
      window.location.reload()
      return
    }

    const timer = setInterval(() => {
      setSegundosRestantes((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [segundosRestantes])

  // Backoff: cada intento duplica el intervalo hasta el máximo
  function calcularProximoIntervalo(intento: number): number {
    return Math.min(INITIAL_RETRY_SECONDS * Math.pow(2, intento), MAX_RETRY_SECONDS)
  }

  function handleReintentar() {
    window.location.reload()
  }

  // Cuando el contador llega a 0 y recarga, resetear el estado para el próximo ciclo
  // (en la práctica el reload reemplaza la página, pero por si el usuario cancela)
  useEffect(() => {
    if (segundosRestantes <= 0) {
      const nextIntento = intentos + 1
      setIntentos(nextIntento)
      setSegundosRestantes(calcularProximoIntervalo(nextIntento))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segundosRestantes])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            {/* Indicador visual sin emoji: círculo pulsante */}
            <span
              className="inline-block w-3 h-3 rounded-full bg-amber-500 animate-pulse"
              aria-hidden="true"
            />
            <CardTitle className="text-lg">Problema de conexión</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Estamos teniendo problemas para conectarnos a la base de datos.
            Tu sesión sigue activa — no perdiste ningún trabajo.
          </p>

          {context && (
            <p className="text-xs text-muted-foreground/70 font-mono bg-muted rounded px-2 py-1">
              {context}
            </p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <div
              className="flex-1 h-1 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={segundosRestantes}
              aria-valuemin={0}
              aria-valuemax={INITIAL_RETRY_SECONDS}
              aria-label="Tiempo hasta el próximo reintento"
            >
              <div
                className="h-full bg-primary transition-all duration-1000 ease-linear"
                style={{
                  width: `${(segundosRestantes / INITIAL_RETRY_SECONDS) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-right">
              {segundosRestantes}s
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Próximo reintento automático en{' '}
            <strong className="text-foreground">{segundosRestantes} segundos</strong>
          </p>
        </CardContent>

        <CardFooter>
          <Button
            onClick={handleReintentar}
            className="w-full"
            variant="default"
          >
            Reintentar ahora
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
