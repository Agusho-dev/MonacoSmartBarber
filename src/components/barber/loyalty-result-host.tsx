'use client'

import { useLoyaltyResultStore } from '@/stores/loyalty-result-store'
import { LoyaltyResultCard } from './loyalty-result-card'

/**
 * Único punto de montaje de `LoyaltyResultCard`. Va al final del body de los
 * layouts del panel del barbero y del dashboard: así la tarjeta sobrevive al
 * desmontaje de `CompleteServiceDialog` en las superficies que lo descartan al
 * terminar (/dashboard/fila, agenda, barber-timeline). No toca la auth: sólo lee
 * el store y, si hay algo pendiente, lo dibuja.
 */
export function LoyaltyResultHost() {
  const pending = useLoyaltyResultStore((s) => s.pending)
  const clear = useLoyaltyResultStore((s) => s.clear)
  if (!pending) return null
  return (
    <LoyaltyResultCard
      key={pending.seq}
      result={pending.result}
      clientName={pending.clientName}
      onClose={clear}
    />
  )
}
