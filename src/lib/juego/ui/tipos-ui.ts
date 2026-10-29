/**
 * Tipos propios de la UI de «Corte Final» (no son contrato con motor/render/audio:
 * esos viven en ../tipos.ts).
 */
import type {
  DesglosePuntaje,
  Dificultad,
  EstadisticasLuchador,
  IdArena,
  IdPersonaje,
} from '../tipos'

/** Las pantallas de la máquina de estados del cliente. */
export type Pantalla = 'inicio' | 'seleccion' | 'vs' | 'carga' | 'pelea' | 'resultado' | 'ranking'

/** Lo que el jugador eligió antes de pelear. */
export interface Eleccion {
  jugador: IdPersonaje
  rival: IdPersonaje
  arena: IdArena
  dificultad: Dificultad
}

/** Lo que la pelea le pasa a la pantalla de resultado. */
export interface ResultadoPelea {
  /** Único por pelea: evita guardar dos veces la misma partida (StrictMode, revancha rápida). */
  id: string
  eleccion: Eleccion
  gano: boolean
  desglose: DesglosePuntaje
  estadisticas: EstadisticasLuchador
  estadisticasRival: EstadisticasLuchador
  rondas: [number, number]
  duracionSeg: number
  /** Mejor puntaje local ANTES de esta pelea (para el «nuevo récord»). */
  mejorAnterior: number
}

/** font-family listas para usar (next/font), también en el canvas. */
export interface FuentesJuego {
  titulo: string
  numeros: string
}
