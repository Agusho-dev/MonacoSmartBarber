'use client'

import { useEffect, useReducer } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

interface DbDownErrorProps {
  /** Mensaje adicional opcional para contexto (ej: en qué superficie ocurrió). */
  context?: string
}

const INITIAL_RETRY_SECONDS = 15
const MAX_RETRY_SECONDS = 60

/**
 * Backoff exponencial con cap. Intento 0 → 15s, 1 → 30s, 2 → 60s, 3+ → 60s.
 */
function intervaloPara(intento: number): number {
  return Math.min(INITIAL_RETRY_SECONDS * Math.pow(2, intento), MAX_RETRY_SECONDS)
}

type State = {
  intento: number
  segundosRestantes: number
  intervaloActual: number
}

type Action = { type: 'tick' } | { type: 'reset' }

const initialState: State = {
  intento: 0,
  segundosRestantes: INITIAL_RETRY_SECONDS,
  intervaloActual: INITIAL_RETRY_SECONDS,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'tick': {
      if (state.segundosRestantes > 1) {
        return { ...state, segundosRestantes: state.segundosRestantes - 1 }
      }
      // Llegamos a 0: avanzamos al siguiente intento (el reload del browser
      // ocurre en paralelo desde el effect; este state es por si el reload
      // se bloquea — la UI sigue siendo coherente con el ciclo).
      const nuevoIntento = state.intento + 1
      const nuevoIntervalo = intervaloPara(nuevoIntento)
      return {
        intento: nuevoIntento,
        intervaloActual: nuevoIntervalo,
        segundosRestantes: nuevoIntervalo,
      }
    }
    case 'reset':
      return initialState
  }
}

/**
 * Pantalla de error de DB con auto-retry y backoff exponencial.
 *
 * Decisiones:
 * - `useReducer` para atomic state (intento + segundos + intervalo van
 *   siempre juntos; useState separado dejaba ventanas inconsistentes
 *   y un reset imperativo dentro de useEffect que dispara la regla
 *   `react-hooks/set-state-in-effect`).
 * - El `window.location.reload()` se dispara en el render que detecta
 *   `segundosRestantes === 0` (vía useEffect), no dentro del reducer
 *   — los reducers deben ser puros.
 * - La barra de progreso se calcula contra `intervaloActual`, no contra
 *   el inicial: en intentos avanzados (30s/60s) la barra empieza llena
 *   y baja proporcionalmente.
 */
export function DbDownError({ context }: DbDownErrorProps) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const { intento, segundosRestantes, intervaloActual } = state

  // Tick cada segundo. El interval se reinicia en cada cambio de intento
  // (técnicamente innecesario, pero el cleanup hace la ergonomía limpia).
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(id)
  }, [intento])

  // Cuando el contador toca 0, recargamos. Si el browser bloquea el reload
  // (raro: navegación bloqueada por usuario, sin red), el reducer ya avanzó
  // al siguiente intento y el ciclo continúa con el nuevo intervalo.
  useEffect(() => {
    if (segundosRestantes === 0) {
      window.location.reload()
    }
  }, [segundosRestantes])

  function handleReintentarManual() {
    window.location.reload()
  }

  const progresoPct = (segundosRestantes / intervaloActual) * 100

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
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
            <p className="text-xs text-muted-foreground/70 font-mono bg-muted rounded px-2 py-1 break-all">
              {context}
            </p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <div
              className="flex-1 h-1 bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={segundosRestantes}
              aria-valuemin={0}
              aria-valuemax={intervaloActual}
              aria-label="Tiempo hasta el próximo reintento"
            >
              <div
                className="h-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${progresoPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-right">
              {segundosRestantes}s
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Próximo reintento automático en{' '}
            <strong className="text-foreground">{segundosRestantes} segundos</strong>
            {intento > 0 && (
              <span className="ml-1 opacity-70">(intento {intento + 1})</span>
            )}
          </p>
        </CardContent>

        <CardFooter>
          <Button
            onClick={handleReintentarManual}
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
