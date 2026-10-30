/**
 * Vibración corta (Android; iOS Safari no la soporta y no pasa nada). Respeta la
 * preferencia del jugador.
 */
import { leerPreferencias } from './preferencias'

/**
 * Chrome no deja vibrar hasta que la persona tocó la página, y cada intento bloqueado queda como
 * error en la consola. Pasa con lo que llega solo: un desafío de la sala o el aviso del turno al
 * que espera con el celular en la mano sin haber tocado nada. Sin la API, se intenta igual.
 */
function huboInteraccion(): boolean {
  const activacion = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return activacion ? activacion.hasBeenActive : true
}

export function vibrar(patron: number | number[], ignorarPreferencia = false): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (!ignorarPreferencia && !leerPreferencias().vibracion) return
  if (!huboInteraccion()) return
  try {
    navigator.vibrate(patron)
  } catch {
    // Algunos navegadores tiran si no hubo interacción todavía: no importa.
  }
}
