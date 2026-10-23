'use client'

import { useEffect } from 'react'
import { iniciarRecargaPorVersion, type SuperficieRecarga } from '@/lib/recarga-version'

/**
 * Recarga la pantalla cuando hay un deploy nuevo y está ociosa (ver
 * src/lib/recarga-version.ts). Se monta UNA vez por pantalla que queda prendida
 * todo el día: el panel del barbero (GiroPanelRaiz), el kiosko (layout de
 * (tablet)), la TV (TvClient) y el dashboard (dashboard-shell: en la Fila, y en
 * las demás pantallas cuando corre como app instalada, que no tiene botón de
 * recargar). No dibuja nada.
 *
 * - panel: no recarga con un diálogo, un campo enfocado, fotos subiendo, un
 *   aviso con acción ni actividad en el último minuto.
 * - kiosko: lo mismo y, además, sólo en su pantalla inicial
 *   (`html[data-kiosko-en-reposo="true"]`, lo pone el kiosko).
 * - tv: siempre que haya red.
 * - aviso: nunca sola. Muestra "Hay una versión nueva del sistema" con
 *   "Actualizar": hay pantallas con cambios sin guardar fuera de un diálogo.
 */
export function RecargaPorVersion({ superficie }: { superficie: SuperficieRecarga }) {
  useEffect(() => iniciarRecargaPorVersion(superficie), [superficie])
  return null
}
