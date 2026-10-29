/**
 * Pantalla completa (Android y compu; el iPhone no la permite fuera de un video y
 * ahí estas funciones no hacen nada). Siempre desde un toque del usuario.
 */

export function soportaPantallaCompleta(): boolean {
  if (typeof document === 'undefined') return false
  return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false
}

export function enPantallaCompleta(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement
}

export async function pedirPantallaCompleta(): Promise<void> {
  if (!soportaPantallaCompleta() || enPantallaCompleta()) return
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    // El navegador la negó (sin gesto, política, iframe): se juega igual.
  }
}

export async function salirDePantallaCompleta(): Promise<void> {
  if (!enPantallaCompleta()) return
  try {
    await document.exitFullscreen()
  } catch {
    // Nada que hacer.
  }
}
