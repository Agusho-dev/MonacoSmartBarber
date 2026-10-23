import { useSyncExternalStore } from 'react'

import { esAppInstalada, suscribirAModoApp } from '@/lib/app-instalable'

/**
 * true cuando el dashboard corre como app instalada (ver src/lib/app-instalable.ts).
 * El HTML del servidor sale con false y se corrige al hidratar, sin desajuste.
 */
export function useEsAppInstalada(): boolean {
  return useSyncExternalStore(suscribirAModoApp, esAppInstalada, () => false)
}
