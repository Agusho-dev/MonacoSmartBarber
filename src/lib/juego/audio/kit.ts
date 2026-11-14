/**
 * Lo que el audio lee del KIT de cada luchador (motor/movimientos.ts): en qué tick crece y se achica el
 * Gigante, cuándo reaparece Nehuen, cuándo sale el papel del Despido y de qué velocidad a qué velocidad
 * acelera el monopatín. Los números no se copian a mano: el balance los mueve y el sonido los sigue.
 * (El render tiene su propio lector, render/kit.ts: el audio no depende del render.)
 */
import { MOVIMIENTOS, type DefEspecial } from '../motor/movimientos'
import type { IdPersonaje, LuchadorEstado } from '../tipos'

/** El especial del kit con ese id (o null). */
export function especialDe(id: IdPersonaje, movimiento: string | null): DefEspecial | null {
  if (!movimiento) return null
  const kit = MOVIMIENTOS[id]
  if (!kit) return null
  const [a, b] = kit.especiales
  if (a.id === movimiento) return a
  if (b.id === movimiento) return b
  return null
}

/** El especial que está haciendo ahora (en el remate del final, ninguno). */
export function especialEnCurso(l: LuchadorEstado): DefEspecial | null {
  const e = especialDe(l.id, l.movimiento)
  return e && l.anim === e.anim ? e : null
}

/** Velocidad de salida y tope del monopatín de Tony (el zumbido del motor va de una a la otra). */
export function rangoMonopatin(): { desde: number; hasta: number } {
  for (const e of MOVIMIENTOS.tony?.especiales ?? []) {
    const p = e.proyectil
    if (p?.tipo === 'monopatin') {
      const desde = Math.abs(p.vx)
      return { desde, hasta: Math.max(desde + 1, p.aceleracion?.max ?? 17) }
    }
  }
  return { desde: 4, hasta: 17 }
}

/**
 * Los ticks del especial en curso en los que suena algo que no trae evento: el Gigante (crece, el paso,
 * el aplastón y se achica), Desaparecer (reaparece) y el Despido (sale el papel). `que` dice cuál.
 */
export type MarcaQuinta = 'crece' | 'paso' | 'aplaston' | 'achica' | 'reaparece' | 'papel'

export function marcasDe(e: DefEspecial): readonly (readonly [number, MarcaQuinta])[] {
  const marcas: [number, MarcaQuinta][] = []
  if (e.cuerpo) {
    marcas.push([e.cuerpo.desde, 'crece'], [e.cuerpo.hasta, 'achica'])
    if (e.avance) marcas.push([e.avance.desde, 'paso'])
    if (e.ventanas[0]) marcas.push([e.ventanas[0].desde, 'aplaston'])
  }
  const emb = e.embestida
  if (emb?.hastaRival !== undefined && emb.invulnerableHasta !== undefined) marcas.push([emb.invulnerableHasta, 'reaparece'])
  if (e.siPega) {
    const papel = e.ventanas[e.siPega.ventana]
    if (papel) marcas.push([papel.desde, 'papel'])
  }
  return marcas
}
