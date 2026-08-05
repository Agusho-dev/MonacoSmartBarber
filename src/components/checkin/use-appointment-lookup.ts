'use client'

import { useCallback, useState } from 'react'
import {
  lookupAppointmentByPhone,
  lookupAppointmentForClient,
  confirmAppointmentArrival,
} from '@/lib/actions/kiosk-turnos'
import type { AppointmentInfo } from '@/lib/actions/kiosk-turnos'

/**
 * Buscar el turno del día + confirmar la llegada.
 *
 * Estaba duplicado tal cual en el flujo de `appointments` y en el híbrido, y
 * cada copia trataba distinto los códigos de error del RPC. Acá vive una sola
 * versión y, sobre todo, un solo mapeo de `code` → salida de UI: `TOO_EARLY` y
 * `TOO_LATE` no son "errores" que se pintan en rojo, son bifurcaciones del
 * flujo con acciones propias (entrar a la fila, volver más tarde).
 */

export type LookupOutcome =
  | { kind: 'found'; appointment: AppointmentInfo }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }

export type ArrivalOutcome =
  | { kind: 'confirmed'; adoptedExistingEntry: boolean }
  | { kind: 'too_early'; startsAt: string | null }
  | { kind: 'too_late' }
  | { kind: 'error'; message: string }

export function useAppointmentLookup(branchId: string) {
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null)
  const [isLooking, setIsLooking] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const aplicarResultado = useCallback(
    (result: Awaited<ReturnType<typeof lookupAppointmentByPhone>>): LookupOutcome => {
      if ('error' in result) {
        setAppointment(null)
        return { kind: 'error', message: result.error }
      }
      if (result.data.found && result.data.appointment) {
        setAppointment(result.data.appointment)
        return { kind: 'found', appointment: result.data.appointment }
      }
      setAppointment(null)
      return { kind: 'not_found' }
    },
    []
  )

  const lookupByPhone = useCallback(
    async (phone: string): Promise<LookupOutcome> => {
      setIsLooking(true)
      const result = await lookupAppointmentByPhone(branchId, phone)
      setIsLooking(false)
      return aplicarResultado(result)
    },
    [branchId, aplicarResultado]
  )

  const lookupByClient = useCallback(
    async (clientId: string): Promise<LookupOutcome> => {
      setIsLooking(true)
      const result = await lookupAppointmentForClient(branchId, clientId)
      setIsLooking(false)
      return aplicarResultado(result)
    },
    [branchId, aplicarResultado]
  )

  const confirmArrival = useCallback(
    async (appointmentId: string): Promise<ArrivalOutcome> => {
      setIsConfirming(true)
      const result = await confirmAppointmentArrival(appointmentId)
      setIsConfirming(false)

      if ('ok' in result) {
        return { kind: 'confirmed', adoptedExistingEntry: result.adoptedExistingEntry }
      }
      if (result.code === 'TOO_EARLY') {
        return { kind: 'too_early', startsAt: result.startsAt ?? null }
      }
      if (result.code === 'TOO_LATE') {
        return { kind: 'too_late' }
      }
      return { kind: 'error', message: result.error }
    },
    []
  )

  const clear = useCallback(() => {
    setAppointment(null)
    setIsLooking(false)
    setIsConfirming(false)
  }, [])

  return { appointment, setAppointment, isLooking, isConfirming, lookupByPhone, lookupByClient, confirmArrival, clear }
}
