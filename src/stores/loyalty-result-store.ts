import { create } from 'zustand'
import type { LoyaltyFinalizeResult } from '@/lib/loyalty-checkout'

/**
 * Resultado del programa de fidelización pendiente de mostrar tras un cobro.
 *
 * Vive en un store global (y no en el estado de `CompleteServiceDialog`) porque
 * `/dashboard/fila`, la agenda, la lista de turnos y `barber-timeline` DESMONTAN
 * el diálogo apenas termina el cobro: cualquier overlay que viviera adentro moría
 * con él y la tarjeta sólo se veía en el panel del barbero (montaje fijo).
 * `LoyaltyResultHost`, montado en los layouts, es el único que la dibuja.
 */
export interface LoyaltyResultPending {
  result: LoyaltyFinalizeResult
  clientName: string | null
  /** Cambia en cada `show()`: remonta la tarjeta (y su temporizador) aunque llegue otra encima. */
  seq: number
}

interface LoyaltyResultStore {
  pending: LoyaltyResultPending | null
  show: (result: LoyaltyFinalizeResult, clientName: string | null) => void
  clear: () => void
}

export const useLoyaltyResultStore = create<LoyaltyResultStore>((set, get) => ({
  pending: null,
  show: (result, clientName) =>
    set({ pending: { result, clientName, seq: (get().pending?.seq ?? 0) + 1 } }),
  clear: () => set({ pending: null }),
}))
