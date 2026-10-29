/**
 * Vibración corta (Android; iOS Safari no la soporta y no pasa nada). Respeta la
 * preferencia del jugador.
 */
import { leerPreferencias } from './preferencias'

export function vibrar(patron: number | number[], ignorarPreferencia = false): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (!ignorarPreferencia && !leerPreferencias().vibracion) return
  try {
    navigator.vibrate(patron)
  } catch {
    // Algunos navegadores tiran si no hubo interacción todavía: no importa.
  }
}
