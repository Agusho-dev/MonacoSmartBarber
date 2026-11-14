/**
 * Lo que el render lee del KIT de cada luchador (motor/movimientos.ts, `MOVIMIENTOS`): cuándo crece
 * el Gigante, en qué ticks salen los anillos de la Orden Final y hasta dónde llegan, la ventana en que
 * el Smash devuelve, cuándo reaparece Nehuen, la vida de una púa clavada, el tope del monopatín… Los
 * números NO se copian a mano: el balance los mueve y el dibujo los sigue solo.
 *
 * El tick de la acción: `LuchadorEstado.animTick` es el tick del movimiento que el motor acaba de
 * simular (los dos se reinician juntos al empezar y se quedan quietos juntos en el hitstop y en el super
 * flash). La única excepción es la contra del All In, que salta la acción a la embestida sin
 * reiniciar la animación: lo de después de la contra no se mide con el tick (ver especiales-quinta.ts).
 */
import { MOVIMIENTOS, type DefEspecial, type PasivaKit } from '../motor/movimientos'
import type { IdPersonaje, LuchadorEstado } from '../tipos'

/** El especial del kit con ese id (o null si el luchador no lo tiene). */
export function especialDe(id: IdPersonaje, movimiento: string | null): DefEspecial | null {
  if (!movimiento) return null
  const kit = MOVIMIENTOS[id]
  if (!kit) return null
  const [a, b] = kit.especiales
  if (a.id === movimiento) return a
  if (b.id === movimiento) return b
  return null
}

/** El especial que está haciendo AHORA (por `movimiento`; en el remate del final, ninguno). */
export function especialEnCurso(l: LuchadorEstado): DefEspecial | null {
  const e = especialDe(l.id, l.movimiento)
  return e && l.anim === e.anim ? e : null
}

/** El tick del especial en curso (−1 si no está haciendo ése). */
export function tickDe(l: LuchadorEstado, idEspecial: string): number {
  return l.movimiento === idEspecial ? l.animTick : -1
}

/** La pasiva del kit (las perillas de la quinta tanda: presencia, velocidad con carga…). */
export function pasivaDe(id: IdPersonaje): PasivaKit | null {
  return MOVIMIENTOS[id]?.pasiva ?? null
}

/** El primer especial del kit de `id` con ese id de movimiento, aunque no lo esté haciendo. */
export function defEspecial(id: IdPersonaje, movimiento: string): DefEspecial | null {
  return especialDe(id, movimiento)
}

/** El especial de un proyectil: el del dueño cuyo `proyectil.tipo` sea ése (la púa, el monopatín…). */
export function especialDelProyectil(id: IdPersonaje, tipo: string): DefEspecial | null {
  const kit = MOVIMIENTOS[id]
  if (!kit) return null
  for (const e of kit.especiales) if (e.proyectil?.tipo === tipo) return e
  return null
}

/**
 * Lo que necesitan los proyectiles de la quinta tanda, del kit de su dueño (con respaldo si el dueño
 * no es el que lo diseñó: un tiro devuelto por Nehuen sigue siendo el de su autor).
 */
export function vidaTrampa(id: IdPersonaje): number {
  for (const k of [id, 'nico_m'] as const) {
    const t = especialDelProyectil(k, 'espina')?.proyectil?.trampa
    if (t) return t.vida
  }
  return 150
}

/** Velocidad de salida y tope del monopatín (el zumbido y la estela van de una a la otra). */
export function rangoMonopatin(): { desde: number; hasta: number } {
  const p = especialDelProyectil('tony', 'monopatin')?.proyectil
  const desde = p ? Math.abs(p.vx) : 4
  const hasta = p?.aceleracion?.max ?? 17
  return { desde, hasta: Math.max(desde + 1, hasta) }
}
