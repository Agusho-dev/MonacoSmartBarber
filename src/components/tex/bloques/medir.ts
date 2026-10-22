'use client'

// Medir texto con la fuente real de la página (Geist) para decidir cuánto
// ancho dar a los ejes y dónde cortar una etiqueta. Un canvas fuera de
// pantalla, creado una sola vez. Sin DOM (o sin canvas) se estima por largo.

let contexto: CanvasRenderingContext2D | null | undefined
let familia = 'sans-serif'

function ctx(): CanvasRenderingContext2D | null {
  if (contexto === undefined) {
    if (typeof document === 'undefined') return null
    contexto = document.createElement('canvas').getContext('2d')
    familia = getComputedStyle(document.body).fontFamily || 'sans-serif'
  }
  return contexto
}

export function medirTexto(texto: string, tamano = 11, peso = 400): number {
  const c = ctx()
  if (!c) return texto.length * tamano * 0.56
  c.font = `${peso} ${tamano}px ${familia}`
  return c.measureText(texto).width
}

/** El texto cortado con "…" para que entre en `ancho` px. */
export function recortarTexto(texto: string, ancho: number, tamano = 11, peso = 400): string {
  if (medirTexto(texto, tamano, peso) <= ancho) return texto
  let lo = 0
  let hi = texto.length
  while (lo < hi) {
    const mitad = Math.ceil((lo + hi) / 2)
    if (medirTexto(texto.slice(0, mitad).trimEnd() + '…', tamano, peso) <= ancho) lo = mitad
    else hi = mitad - 1
  }
  return lo > 0 ? texto.slice(0, lo).trimEnd() + '…' : ''
}
