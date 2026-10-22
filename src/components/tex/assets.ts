// Las imágenes de Tex (public/tex/). Se generaron desde los PNG originales del
// dibujo: recortadas a su caja alfa, los tres cuadros de la cara alineados al
// píxel sobre el mismo lienzo (842×597) y exportadas a WebP en tres anchos.
// El dibujo no está en una grilla limpia, así que se escala con suavizado
// (`image-rendering: auto`), nunca con `pixelated`.

export type TexPoseNombre = 'saludo' | 'analiza' | 'logro' | 'ayuda'
export type TexCuadro = 1 | 2 | 3

/** Ancho/alto del lienzo de la cara (los tres cuadros comparten encuadre). */
export const TEX_CARA_ASPECTO = 842 / 597

/** Ancho/alto de cada pose, medido sobre el recorte. */
export const TEX_POSE_ASPECTO: Record<TexPoseNombre, number> = {
  saludo: 1.2549,
  analiza: 1.2412,
  logro: 1.2763,
  ayuda: 1.1106,
}

const ANCHOS_CARA = [96, 192, 384] as const
const ANCHOS_POSE = [160, 320, 640] as const

export function srcCara(cuadro: TexCuadro, ancho: (typeof ANCHOS_CARA)[number] = 192): string {
  return `/tex/tex-habla-${cuadro}-${ancho}.webp`
}

export function srcSetCara(cuadro: TexCuadro): string {
  return ANCHOS_CARA.map((w) => `${srcCara(cuadro, w)} ${w}w`).join(', ')
}

export function srcPose(pose: TexPoseNombre, ancho: (typeof ANCHOS_POSE)[number] = 320): string {
  return `/tex/tex-${pose}-${ancho}.webp`
}

export function srcSetPose(pose: TexPoseNombre): string {
  return ANCHOS_POSE.map((w) => `${srcPose(pose, w)} ${w}w`).join(', ')
}

/** PNG para jsPDF (no dibuja WebP en todos los navegadores). */
export const TEX_CARA_PNG = '/tex/tex-cara-256.png'
