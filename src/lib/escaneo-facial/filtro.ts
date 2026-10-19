/**
 * Suavizado de los puntos de la cara (filtro "One Euro", Casiez et al. 2012).
 *
 * Los 68 puntos de face-api tiemblan un par de píxeles de un cuadro a otro
 * aunque la persona esté quieta. Un promedio fijo los calma pero hace que la
 * malla llegue tarde cuando la cabeza se mueve. El One Euro ajusta el corte con
 * la velocidad: quieto, filtra fuerte (nada tiembla); en movimiento, casi no
 * filtra (nada se arrastra).
 *
 * Diferencia con el filtro clásico: la velocidad se mide sobre el CONJUNTO y el
 * mismo coeficiente se aplica a los 68 puntos. Con un filtro por coordenada,
 * cada punto se suaviza distinto y la cara se deforma al moverse.
 */

import type { Puntos } from './geometria'

function alfa(dt: number, corteHz: number): number {
  const tau = 1 / (2 * Math.PI * corteHz)
  return 1 / (1 + tau / dt)
}

export class FiltroCara {
  private x: Float32Array | null = null
  private velocidad = 0
  private tAnterior = 0

  /**
   * @param corteMin corte con la cara quieta (Hz). Más bajo, más suave.
   * @param beta cuánto sube el corte por cada distancia interocular por segundo.
   * @param corteVelocidad corte del filtro de la velocidad (Hz).
   */
  constructor(
    private readonly corteMin = 1.1,
    private readonly beta = 0.7,
    private readonly corteVelocidad = 1,
  ) {}

  reiniciar(): void {
    this.x = null
    this.velocidad = 0
  }

  /**
   * Filtra una medición nueva y devuelve los puntos suavizados (el mismo buffer
   * en cada llamada: copiarlo si hay que guardarlo).
   *
   * @param escala distancia interocular en px: hace que el filtro se comporte
   *   igual con la cara cerca o lejos de la cámara.
   */
  filtrar(p: Puntos, tSegundos: number, escala: number): Float32Array {
    if (!this.x || this.x.length !== p.length) {
      this.x = Float32Array.from(p)
      this.tAnterior = tSegundos
      this.velocidad = 0
      return this.x
    }
    const x = this.x
    const dt = Math.max(1e-3, tSegundos - this.tAnterior)
    this.tAnterior = tSegundos

    const n = p.length / 2
    let desplazamiento = 0
    for (let i = 0; i < n; i++) {
      desplazamiento += Math.hypot(p[2 * i] - x[2 * i], p[2 * i + 1] - x[2 * i + 1])
    }
    const v = desplazamiento / n / Math.max(1, escala) / dt
    this.velocidad += alfa(dt, this.corteVelocidad) * (v - this.velocidad)

    const a = alfa(dt, this.corteMin + this.beta * this.velocidad)
    for (let i = 0; i < p.length; i++) x[i] += a * (p[i] - x[i])
    return x
  }
}
