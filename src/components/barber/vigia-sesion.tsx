'use client'

import { useEffect } from 'react'
import { iniciarVigiaSesion } from '@/lib/vigia-sesion-panel'

/**
 * Lleva al PIN cuando la sesión del panel venció mientras la pantalla seguía
 * abierta (ver src/lib/vigia-sesion-panel.ts). Lo monta el layout de /barbero
 * sólo cuando hay sesión. No dibuja nada.
 */
export function VigiaSesion({ staffId }: { staffId: string }) {
  useEffect(() => iniciarVigiaSesion(staffId), [staffId])
  return null
}
