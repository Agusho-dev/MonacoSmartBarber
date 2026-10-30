/**
 * Gancho de LECTURA para probar el juego desde afuera (Chrome por CDP contra el servidor de
 * desarrollo). Lo que se publica acá queda en `window.__corteFinal`: la partida en curso
 * (`partida`), el joystick (`joystick()`, una foto de su estado), el audio (`audio()`) y, online,
 * la sala y el duelo. Nada del juego lo lee.
 *
 * SÓLO en desarrollo. En producción no hace nada (ni crea el objeto): los objetos publicados son
 * los vivos, no copias, y desde la consola se podía tocar la partida (30/oct/2026; antes también
 * se prendía con `?debug=1`).
 */

let habilitada: boolean | null = null

export function depuracionHabilitada(): boolean {
  if (habilitada !== null) return habilitada
  if (typeof window === 'undefined') return false
  habilitada = process.env.NODE_ENV !== 'production'
  return habilitada
}

export function publicarDepuracion(clave: string, valor: unknown): void {
  if (!depuracionHabilitada()) return
  try {
    const w = window as unknown as { __corteFinal?: Record<string, unknown> }
    const gancho = w.__corteFinal ?? (w.__corteFinal = {})
    gancho[clave] = valor
  } catch {
    // Nunca rompe el juego.
  }
}
