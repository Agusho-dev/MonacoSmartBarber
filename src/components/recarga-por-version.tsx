'use client'

import { useEffect } from 'react'
import { iniciarRecargaPorVersion, type SuperficieRecarga } from '@/lib/recarga-version'

/**
 * Recarga la pantalla cuando hay un deploy nuevo y está ociosa (ver
 * src/lib/recarga-version.ts). Se monta UNA vez por pantalla que queda prendida
 * todo el día: el panel del barbero (GiroPanelRaiz), el kiosko (layout de
 * (tablet)) y la TV (TvClient). No dibuja nada.
 *
 * - panel: no recarga con un diálogo, un campo enfocado, fotos subiendo, un
 *   aviso con acción ni actividad en el último minuto.
 * - kiosko: lo mismo y, además, sólo en su pantalla inicial
 *   (`html[data-kiosko-en-reposo="true"]`, lo pone el kiosko).
 * - tv: siempre que haya red.
 */
export function RecargaPorVersion({ superficie }: { superficie: SuperficieRecarga }) {
  useEffect(() => iniciarRecargaPorVersion(superficie), [superficie])
  return null
}
