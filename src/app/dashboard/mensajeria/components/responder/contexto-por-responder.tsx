'use client'

// «Por responder» (6/nov/2026): lo que espera a una persona, compartido por
// todo lo que lo muestra: el riel de la compu y el menú «…» (el globo), la fila
// de arriba de la lista de chats, la bandeja de tarjetas y el número del ícono
// de la app instalada.
//
// Se lee con obtenerPorResponder (la RPC mensajeria_pendientes, mig 237):
//   - al montar, al volver a la pantalla y cada 60 s con la pantalla visible;
//   - cuando se mueve la lista de chats (el realtime del contexto de Mensajería
//     ya escucha los mensajes nuevos: un mensaje del cliente o una respuesta
//     cambian `conversations`), con 2,5 s de respiro para juntar ráfagas.
// No abre un canal de realtime propio: el que había para el globo de Alertas
// (`crm-alerts-badge`) escuchaba crm_alerts de TODAS las orgs (pendiente de
// mensajeria.md) y se fue con la sección.
//
// Lo que la persona acaba de atender (o deslizar) se esconde enseguida
// (`ocultar`): la próxima lectura del servidor lo confirma o, si la acción
// falló, `mostrar` lo devuelve.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { obtenerPorResponder } from '@/lib/actions/por-responder'
import {
  armarPilas, hayResenaUrgente, type Pendiente, type PilasPorResponder,
} from '@/lib/mensajeria/por-responder'
import { useMensajeria } from '../shared/mensajeria-context'

type EstadoCarga = 'cargando' | 'listo' | 'error'

interface ValorPorResponder {
  estado: EstadoCarga
  error: string | null
  /** Todo lo que vino del servidor, menos lo escondido. */
  pendientes: Pendiente[]
  pilas: PilasPorResponder
  /** El número del globo: lo que se puede contestar ya (sin los cierres). */
  cuenta: number
  /** Hay una reseña baja que se puede contestar: el globo va en rojo. */
  urgente: boolean
  /** La hora de referencia (se mueve cada 30 s: «hace 12 min», «quedan 3 h»). */
  ahora: number
  refrescar: () => void
  ocultar: (id: string) => void
  mostrar: (id: string) => void
}

const Contexto = createContext<ValorPorResponder | null>(null)

const CADA_MS = 60_000
const RESPIRO_MS = 2_500

export function ProveedorPorResponder({ children }: { children: ReactNode }) {
  const { conversations } = useMensajeria()
  const [crudos, setCrudos] = useState<Pendiente[]>([])
  const [estado, setEstado] = useState<EstadoCarga>('cargando')
  const [error, setError] = useState<string | null>(null)
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(() => new Set())
  const [ahora, setAhora] = useState(() => Date.now())
  // Sólo pinta la última lectura: una vieja que llega tarde no pisa a la nueva.
  const lectura = useRef(0)

  const refrescar = useCallback(() => {
    const n = ++lectura.current
    obtenerPorResponder()
      .then((r) => {
        if (n !== lectura.current) return
        if (r.ok) {
          setCrudos(r.pendientes)
          setEstado('listo')
          setError(null)
          setAhora(Date.now())
          // Lo escondido que el servidor ya no devuelve, se olvida.
          const vigentes = new Set(r.pendientes.map((p) => p.id))
          setOcultas((prev) => {
            const sigue = [...prev].filter((id) => vigentes.has(id))
            return sigue.length === prev.size ? prev : new Set(sigue)
          })
        } else {
          setError(r.error)
          setEstado((e) => (e === 'listo' ? 'listo' : 'error'))
        }
      })
      .catch(() => {
        if (n !== lectura.current) return
        setError('No pudimos leer lo que hay por responder. Revisá la conexión.')
        setEstado((e) => (e === 'listo' ? 'listo' : 'error'))
      })
  }, [])

  useEffect(() => {
    refrescar()
  }, [refrescar])

  // Cada 60 s con la pantalla visible, y al volver a ella.
  useEffect(() => {
    const tic = window.setInterval(() => {
      if (document.visibilityState === 'visible') refrescar()
    }, CADA_MS)
    const alVolver = () => {
      if (document.visibilityState === 'visible') refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.clearInterval(tic)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [refrescar])

  // El reloj de los textos («hace 12 min»).
  useEffect(() => {
    const tic = window.setInterval(() => setAhora(Date.now()), 30_000)
    return () => window.clearInterval(tic)
  }, [])

  // La lista de chats se movió (un mensaje entró o salió): releer con respiro.
  const firma = useMemo(
    () => conversations.slice(0, 40).map((c) => `${c.id}:${c.last_message_at ?? ''}:${c.unread_count}`).join('|'),
    [conversations],
  )
  const primeraFirma = useRef(true)
  useEffect(() => {
    if (primeraFirma.current) {
      primeraFirma.current = false
      return
    }
    const t = window.setTimeout(refrescar, RESPIRO_MS)
    return () => window.clearTimeout(t)
  }, [firma, refrescar])

  const ocultar = useCallback((id: string) => {
    setOcultas((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  const mostrar = useCallback((id: string) => {
    setOcultas((prev) => {
      if (!prev.has(id)) return prev
      const s = new Set(prev)
      s.delete(id)
      return s
    })
  }, [])

  const pendientes = useMemo(() => crudos.filter((p) => !ocultas.has(p.id)), [crudos, ocultas])
  const pilas = useMemo(() => armarPilas(pendientes, ahora), [pendientes, ahora])
  const cuenta = pilas.paraResponder.length
  const urgente = useMemo(() => hayResenaUrgente(pilas.paraResponder, ahora), [pilas, ahora])

  // El número del ícono de la app instalada (Badging API). En el iPhone sólo
  // anda con la app en la pantalla de inicio y el permiso de avisos.
  useEffect(() => {
    if (estado !== 'listo') return
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try {
      if (cuenta > 0) void nav.setAppBadge?.(cuenta)?.catch(() => {})
      else void nav.clearAppBadge?.()?.catch(() => {})
    } catch {
      // Sin la API: nada.
    }
  }, [cuenta, estado])

  const valor = useMemo<ValorPorResponder>(
    () => ({ estado, error, pendientes, pilas, cuenta, urgente, ahora, refrescar, ocultar, mostrar }),
    [estado, error, pendientes, pilas, cuenta, urgente, ahora, refrescar, ocultar, mostrar],
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function usePorResponder(): ValorPorResponder {
  const v = useContext(Contexto)
  if (!v) throw new Error('usePorResponder fuera de ProveedorPorResponder')
  return v
}
