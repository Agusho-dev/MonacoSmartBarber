/**
 * Render de «Corte Final»: canvas 2D, sin React y sin imports con `@/` (se prueba fuera de Next).
 * No toca window ni document al importarse: todo pasa adentro de estas dos funciones.
 *
 * Uso desde la UI:
 *   const recursos = await cargarRecursos([p1, p2], arena, setProgreso)
 *   const r = crearRenderizador(canvas, recursos, { calidad, fuentes, numerosDeDanio: true })
 *   r.redimensionar(anchoCss, altoCss, devicePixelRatio)   // y en cada resize / rotación
 *   loop: const ev = p.eventos.splice(0); r.dibujar(p, ev, dtMs)
 *   al salir: r.destruir()
 *
 * El canvas lo dimensiona la UI por CSS (el render sólo toca su resolución interna).
 */
import type { IdArena, IdPersonaje, OpcionesRender, RecursosJuego, Renderizador } from '../tipos'
import { cargarRecursosImpl } from './recursos'
import { crearRenderizadorImpl } from './renderizador'

/**
 * Baja y decodifica el atlas de cada personaje, su cara y la arena, informando un progreso real
 * 0..1. Sin atlas tira un error claro; sin cara sigue; sin imagen de arena dibuja una de respaldo.
 */
export async function cargarRecursos(
  personajes: IdPersonaje[],
  arena: IdArena,
  alProgresar?: (fraccion: number) => void,
): Promise<RecursosJuego> {
  return cargarRecursosImpl(personajes, arena, alProgresar)
}

export function crearRenderizador(
  canvas: HTMLCanvasElement,
  recursos: RecursosJuego,
  opciones?: Partial<OpcionesRender>,
): Renderizador {
  return crearRenderizadorImpl(canvas, recursos, opciones)
}
