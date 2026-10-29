/**
 * Utilidades numéricas y de color del render de «Corte Final». Sin DOM: se pueden probar con Node.
 */

export const TAU = Math.PI * 2

/** Acota v a [min, max]. Si el intervalo viene invertido devuelve su punto medio. */
export function acotar(v: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return v < min ? min : v > max ? max : v
}

export function mezcla(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Acerca `actual` a `objetivo` igual a cualquier tasa de cuadros (`velocidad` en 1/s). */
export function suavizar(actual: number, objetivo: number, velocidad: number, dtS: number): number {
  return objetivo + (actual - objetivo) * Math.exp(-velocidad * dtS)
}

/** 0 en `borde0`, 1 en `borde1`, curva suave en el medio (sirve con bordes invertidos). */
export function pasoSuave(borde0: number, borde1: number, v: number): number {
  const t = acotar((v - borde0) / (borde1 - borde0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function salidaCubica(t: number): number {
  const u = 1 - acotar(t, 0, 1)
  return 1 - u * u * u
}

export function entradaCuadratica(t: number): number {
  const u = acotar(t, 0, 1)
  return u * u
}

/** Se pasa un poco y vuelve (rebote corto). */
export function salidaConRebote(t: number, s = 1.9): number {
  const u = acotar(t, 0, 1) - 1
  return 1 + (s + 1) * u * u * u + s * u * u
}

/** Rebote elástico: dos o tres oscilaciones que se apagan. */
export function salidaElastica(t: number): number {
  const u = acotar(t, 0, 1)
  if (u === 0 || u === 1) return u
  return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (TAU / 3)) + 1
}

export function azar(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Ruido 0..1 estable para un entero (titileos sin guardar estado). */
export function ruido(n: number): number {
  let x = Math.imul((n | 0) ^ 0x2c1b3c6d, 0x297a2d39)
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b)
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

export function hexARgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexARgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** Mezcla un color con blanco (t > 0) o con negro (t < 0). Devuelve #rrggbb. */
export function aclarar(hex: string, t: number): string {
  const [r, g, b] = hexARgb(hex)
  const destino = t >= 0 ? 255 : 0
  const k = Math.min(1, Math.abs(t))
  const canal = (c: number) => Math.round(c + (destino - c) * k).toString(16).padStart(2, '0')
  return `#${canal(r)}${canal(g)}${canal(b)}`
}
