/**
 * Motor de «Corte Final»: simulación pura y determinista a 60 ticks por segundo. Sin DOM, sin
 * React y sin imports con `@/` (sólo relativos), para poder correrlo con Node en el simulador.
 *
 * Uso típico (ver las notas del integrador en el simulador):
 *   const p = crearPartida(config)
 *   // por cuadro de pantalla: acumulador += dt * p.escalaTiempo; hasta 5 veces: avanzar(p, entradas)
 *   // después: const eventos = p.eventos.splice(0) → render, audio y HUD.
 */
import type { AtlasPersonaje, ConfigPartida, DesglosePuntaje, EntradaJugador, Lado, MetaAnimaciones, Partida } from '../tipos'
import { metaDesdeAtlas as metaDeAtlas } from './animacion'
import { avanzar as avanzarPartida, crearPartida as crearPartidaNueva } from './partida'
import { calcularPuntaje as puntaje } from './puntaje'

/** Arma una partida nueva en la fase `presentacion` (con el evento `presentacion` ya en la cola). */
export function crearPartida(config: ConfigPartida): Partida {
  return crearPartidaNueva(config)
}

/** Avanza UN tick (1/60 s simulado). Para las entradas de un lado de la CPU se ignora lo que llegue. */
export function avanzar(p: Partida, entradas: readonly [EntradaJugador, EntradaJugador]): void {
  avanzarPartida(p, entradas)
}

/** Puntaje del ranking de un lado (las partes suman el total). */
export function calcularPuntaje(p: Partida, lado: Lado): DesglosePuntaje {
  return puntaje(p, lado)
}

/** Lo que el motor necesita del atlas: cuántos cuadros tiene cada animación y cuáles pegan. */
export function metaDesdeAtlas(atlas: AtlasPersonaje): MetaAnimaciones {
  return metaDeAtlas(atlas)
}
