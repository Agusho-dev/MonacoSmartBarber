/**
 * Azar determinista (mulberry32). Nada de Math.random en el motor: con la misma semilla y las
 * mismas entradas, la partida es idéntica (sirve para reproducir bugs y para el simulador).
 *
 * El estado es un entero de 32 bits dentro de un objeto chico, así cada «canal» (combate, CPU
 * de cada lado) avanza por su cuenta y una decisión de la CPU no cambia los críticos.
 */

export interface Azar {
  s: number
}

/** Mezcla un número cualquiera (incluso enorme, negativo o con decimales) a 32 bits. */
function mezclar(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Crea un canal de azar. `canal` separa secuencias que comparten la semilla de la partida. */
export function crearAzar(semilla: number, canal = 0): Azar {
  const n = Number.isFinite(semilla) ? Math.floor(semilla) : 0
  const bajo = n | 0
  const alto = Math.floor(n / 4294967296) | 0
  const s = mezclar(bajo ^ mezclar(alto + 0x9e3779b9) ^ Math.imul(canal + 1, 0x632be5ab))
  return { s }
}

/** Número en [0, 1). */
export function azar(a: Azar): number {
  a.s = (a.s + 0x6d2b79f5) >>> 0
  let t = a.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function chance(a: Azar, p: number): boolean {
  return p > 0 && azar(a) < p
}

export function entre(a: Azar, min: number, max: number): number {
  return min + azar(a) * (max - min)
}

/** Entero en [min, max] (los dos incluidos). */
export function entero(a: Azar, min: number, max: number): number {
  return min + Math.floor(azar(a) * (max - min + 1))
}
