'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { obtenerEstadoTurnoJuego } from '@/lib/actions/juego'
import type { EstadoTurnoJuego } from '@/lib/juego/tipos'

/** Cada cuánto se pregunta por el turno (y siempre al volver a la pestaña). */
const CADA_MS = 20_000

export type AvisoTurno = 'proximo' | 'te_toca'

/**
 * Estado del turno del cliente que entró por el QR del kiosko. Si la action falla
 * (sin red, token vencido), se queda con lo último que sabía y reintenta: el juego
 * nunca se bloquea por esto. Avisa UNA vez por transición: al pasar a «sos el próximo»
 * y cuando lo empiezan a atender.
 */
export function useTurno(
  token: string | null,
  alAvisar: (aviso: AvisoTurno, estado: EstadoTurnoJuego) => void,
): EstadoTurnoJuego | null {
  const [estado, setEstado] = useState<EstadoTurnoJuego | null>(null)
  const anterior = useRef<EstadoTurnoJuego | null>(null)
  const avisar = useEffectEvent(alAvisar)

  useEffect(() => {
    if (!token) return
    let vivo = true
    let terminado = false
    let enCurso = false

    const recibir = (r: EstadoTurnoJuego) => {
      const previo = anterior.current
      anterior.current = r
      setEstado(r)
      if (r.estado === 'terminado') terminado = true
      const eraProximo = previo?.estado === 'esperando' && previo.adelante === 0
      if (r.estado === 'esperando' && r.adelante === 0 && !eraProximo) avisar('proximo', r)
      if (r.estado === 'atendiendo' && previo?.estado !== 'atendiendo') avisar('te_toca', r)
    }

    const consultar = () => {
      if (!vivo || terminado || enCurso || document.visibilityState === 'hidden') return
      enCurso = true
      obtenerEstadoTurnoJuego(token)
        .then((r) => {
          if (vivo && r) recibir(r)
        })
        .catch(() => {
          // Sin red o action caída: se reintenta en el próximo ciclo.
        })
        .finally(() => {
          enCurso = false
        })
    }

    consultar()
    const intervalo = window.setInterval(consultar, CADA_MS)
    const alVolver = () => {
      if (document.visibilityState === 'visible') consultar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [token])

  return token ? estado : null
}
