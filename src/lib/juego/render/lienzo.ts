/**
 * Lienzos auxiliares (cachés de tintes, textos y sprites dibujados). Todo se crea recién cuando
 * se llama desde el navegador: el módulo no toca `document` al importarse (la página hace SSR).
 */

export const FUENTE_RESPALDO = 'Impact, "Arial Black", sans-serif'

export function crearLienzo(ancho: number, alto: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(ancho))
  c.height = Math.max(1, Math.ceil(alto))
  return c
}

export function contexto(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d')
  if (!g) throw new Error('Corte Final: el navegador no dio un contexto 2D')
  return g
}

/** Achica un lienzo a 0×0: Safari de iOS recién ahí libera su memoria. */
export function liberarLienzo(c: HTMLCanvasElement | null | undefined): void {
  if (c) {
    c.width = 0
    c.height = 0
  }
}

/**
 * Arma la pila de fuentes del canvas. Acepta el `style.fontFamily` de next/font o una variable
 * CSS (`var(--fuente-titulo)`), que se resuelve contra el elemento (el canvas hereda la variable).
 */
export function pilaDeFuentes(valor: string | undefined, elemento?: Element): string {
  let v = (valor ?? '').trim()
  const m = /^var\(\s*(--[\w-]+)/.exec(v)
  if (m) {
    v = ''
    try {
      const el = elemento ?? (typeof document !== 'undefined' ? document.documentElement : null)
      if (el) v = getComputedStyle(el).getPropertyValue(m[1]).trim()
    } catch {
      v = ''
    }
  }
  return v ? `${v}, ${FUENTE_RESPALDO}` : FUENTE_RESPALDO
}

/** Ancho y alto de cualquier CanvasImageSource (para preparar cachés, no en el cuadro). */
export function medidas(img: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }
  }
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) {
    return { w: img.videoWidth, h: img.videoHeight }
  }
  if (typeof SVGImageElement !== 'undefined' && img instanceof SVGImageElement) {
    return { w: img.width.baseVal.value, h: img.height.baseVal.value }
  }
  if (typeof VideoFrame !== 'undefined' && img instanceof VideoFrame) {
    return { w: img.displayWidth, h: img.displayHeight }
  }
  const o = img as { width?: unknown; height?: unknown }
  return {
    w: typeof o.width === 'number' ? o.width : 0,
    h: typeof o.height === 'number' ? o.height : 0,
  }
}
