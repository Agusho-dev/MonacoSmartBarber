// La línea de etiquetas de cada chat es UNA sola, sin envolver, y lo que no
// entra se resume en "+N". Para saber cuántas entran hay que medir el texto:
// con CSS sólo se puede cortar, no contar lo que quedó afuera. Se mide con un
// canvas (sin tocar el layout) y cada nombre se mide una sola vez.
//
// Los números tienen que coincidir con las clases del chip en fila-chat.tsx:
// 11 px y medium de la letra de .wa-scope, px-1.5 (6 px por lado) y gap-1.

const FUENTE_CHIP =
  '500 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const RELLENO_CHIP = 12
const SEPARACION = 4
// Margen por diferencias de redondeo entre el canvas y el texto real.
const HOLGURA = 2

const anchos = new Map<string, number>()
let contexto: CanvasRenderingContext2D | null | undefined

function anchoDeTexto(texto: string): number {
  const guardado = anchos.get(texto)
  if (guardado !== undefined) return guardado
  if (contexto === undefined) {
    contexto = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (contexto) contexto.font = FUENTE_CHIP
  }
  // Sin canvas (no debería pasar en un navegador): un promedio generoso por letra.
  const ancho = contexto ? contexto.measureText(texto).width : texto.length * 6.4
  anchos.set(texto, ancho)
  return ancho
}

function anchoDeChip(texto: string): number {
  return RELLENO_CHIP + Math.ceil(anchoDeTexto(texto))
}

/**
 * Cuántas etiquetas entran enteras en `disponible` px, dejando lugar para el
 * "+N" de las que sobran. Puede dar 0: entonces la primera va cortada con "…".
 */
export function cuantasEtiquetasEntran(nombres: readonly string[], disponible: number): number {
  for (let k = nombres.length; k > 0; k--) {
    let total = HOLGURA
    for (let i = 0; i < k; i++) total += anchoDeChip(nombres[i]) + (i > 0 ? SEPARACION : 0)
    const sobran = nombres.length - k
    if (sobran > 0) total += SEPARACION + anchoDeChip(`+${sobran}`)
    if (total <= disponible) return k
  }
  return 0
}
