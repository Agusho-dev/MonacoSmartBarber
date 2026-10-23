'use client'

// El día de hoy según el navegador, para lo que dibuja horas relativas al día
// (la lista de chats: "14:32", "Ayer", "martes"; los separadores del chat:
// "Hoy", "Ayer"). Se lee con useSyncExternalStore y no con new Date() en el
// render, por dos razones:
// - El servidor corre en UTC y el teléfono en hora argentina: dibujada en el
//   servidor, la lista diría "17:32" donde el teléfono dice "14:32", y ese
//   desajuste rompe la hidratación. En el servidor y al hidratar devuelve null,
//   y quien lo usa no dibuja la hora todavía.
// - A la medianoche "14:32" pasa a ser "Ayer": la lista se vuelve a dibujar
//   sola, sin esperar a que llegue un mensaje.

import { useSyncExternalStore } from 'react'

/** La clave de un día de calendario en la hora del navegador: "2026-10-23" (sin ceros: "2026-1-5"). */
export function claveDeDia(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function claveDeHoy(): string {
  return claveDeDia(new Date())
}

const oyentes = new Set<() => void>()
let intervalo: number | null = null
let ultimaClave = ''

function revisar() {
  const hoy = claveDeHoy()
  if (hoy === ultimaClave) return
  ultimaClave = hoy
  for (const oyente of oyentes) oyente()
}

// En segundo plano el navegador frena los intervalos: al volver se revisa enseguida.
function alVolver() {
  if (document.visibilityState === 'visible') revisar()
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  if (intervalo === null) {
    ultimaClave = claveDeHoy()
    intervalo = window.setInterval(revisar, 60_000)
    document.addEventListener('visibilitychange', alVolver)
  }
  return () => {
    oyentes.delete(oyente)
    if (oyentes.size === 0 && intervalo !== null) {
      window.clearInterval(intervalo)
      intervalo = null
      document.removeEventListener('visibilitychange', alVolver)
    }
  }
}

/** La clave del día del navegador (claveDeDia de hoy); null en el servidor y mientras hidrata. */
export function useDiaLocal(): string | null {
  return useSyncExternalStore(suscribir, claveDeHoy, () => null)
}
