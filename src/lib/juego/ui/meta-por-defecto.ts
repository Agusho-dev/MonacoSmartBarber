/**
 * MetaAnimaciones de reserva: si el atlas de un luchador no llegó (hoja todavía sin
 * procesar, red cortada), la pelea arranca igual con los cuadros que tienen las hojas
 * originales. El motor sincroniza los golpes con estos números.
 */
import { CLAVES_ANIMACION } from '../tipos'
import type { ClaveAnimacion, MetaAnimaciones } from '../tipos'

const CUADROS: Record<ClaveAnimacion, number> = {
  quieto: 5,
  caminar: 6,
  correr: 4,
  dash: 3,
  guardia: 4,
  agachado: 4,
  saltar: 4,
  caer: 6,
  golpe: 5,
  patada: 4,
  combo: 8,
  herramienta1: 4,
  herramienta2: 3,
  especial1: 4,
  especial2: 6,
  danio: 5,
  ko: 3,
  levantarse: 5,
  victoria: 6,
  burla: 8,
}

const IMPACTOS: Partial<Record<ClaveAnimacion, number[]>> = {
  golpe: [3],
  patada: [2],
  combo: [3, 6],
  herramienta1: [2],
  herramienta2: [1],
  especial1: [3],
  especial2: [3],
}

export function metaPorDefecto(): MetaAnimaciones {
  const meta = {} as MetaAnimaciones
  for (const clave of CLAVES_ANIMACION) {
    meta[clave] = { n: CUADROS[clave], impactos: [...(IMPACTOS[clave] ?? [])] }
  }
  return meta
}
