// La matemática de la barra inferior del celular (mobile-bottom-nav.tsx): qué
// hace el dedo (¿levanta la lente, scrollea o elige?), en qué pestaña cae, hasta
// dónde llega la lente y cuánto se agranda cada pestaña por cercanía. Módulo
// PURO, sin React ni DOM: se prueba con node.
//
// Todo se mide sobre la PISTA: la cápsula menos su margen interior de 4 px,
// partida en `n` ranuras iguales, una por grupo. La píldora mide una ranura; la
// lente (la píldora levantada) es más grande y sale de la cápsula, pero se
// ubica por el mismo centro.

export interface Pista {
  /** Borde izquierdo de la pista en la pantalla (px, como `clientX`). */
  readonly izquierda: number
  /** Ancho de la pista (px). */
  readonly ancho: number
  /** Cuántas pestañas hay. */
  readonly n: number
}

/** Lo que tiene que correrse el dedo de costado para que se levante la lente. */
export const UMBRAL_ARRASTRE_PX = 7
/** Con el dedo quieto, la lente se levanta igual pasado este tiempo (como en iOS). */
export const ESPERA_LENTE_MS = 200
/**
 * El temblor del dedo: hasta esta distancia del lugar donde se apoyó sigue
 * "quieto" (la espera levanta la lente) y un desvío vertical no cuenta como
 * scroll.
 */
export const TOLERANCIA_QUIETO_PX = 10
/**
 * Con la lente levantada, soltar más arriba que esto del borde de arriba de la
 * cápsula no elige (como un control de iOS, que suelta el resaltado cuando el
 * dedo se aleja).
 */
export const MARGEN_SOLTAR_PX = 44
/** Cuánto se agranda la pestaña que queda justo debajo de la lente (1 + esto). */
export const AGRANDADO_MAXIMO = 0.22
/** El brillo (alfa del blanco) de una pestaña sin la lente cerca: el de las no marcadas. */
export const BRILLO_BASE = 0.65

function limitar(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function anchoDeRanura(pista: Pista): number {
  return pista.n > 0 ? pista.ancho / pista.n : pista.ancho
}

/**
 * El centro de la lente, medido desde el borde izquierdo de la pista, con el
 * dedo en `x`: centrada bajo el dedo y sin salirse de la pista (en los extremos
 * se queda sobre la primera o la última pestaña).
 */
export function centroDeLente(x: number, pista: Pista): number {
  const mitad = anchoDeRanura(pista) / 2
  return limitar(x - pista.izquierda, mitad, Math.max(mitad, pista.ancho - mitad))
}

/** La pestaña que queda debajo de un centro (medido desde el borde izquierdo de la pista). */
export function indiceEn(centro: number, pista: Pista): number {
  if (pista.n <= 1) return 0
  return limitar(Math.floor(centro / anchoDeRanura(pista)), 0, pista.n - 1)
}

/** El corrimiento (translate, px) de la píldora para que su centro quede en `centro`. */
export function corrimientoParaCentro(centro: number, pista: Pista): number {
  return centro - anchoDeRanura(pista) / 2
}

/** El corrimiento de la píldora asentada en la pestaña `i` (el mismo que el `i × 100%` del CSS). */
export function corrimientoDeRanura(i: number, pista: Pista): number {
  return limitar(i, 0, Math.max(0, pista.n - 1)) * anchoDeRanura(pista)
}

/** El centro de la ranura `i`, desde el borde izquierdo de la pista. */
export function centroDeRanura(i: number, pista: Pista): number {
  return corrimientoDeRanura(i, pista) + anchoDeRanura(pista) / 2
}

/**
 * Cuánto "siente" la pestaña `i` a la lente: 1 con la lente centrada encima, 0
 * a una ranura de distancia o más. La curva es un coseno: sin quiebres, así el
 * agrandado no da saltos al pasar de una pestaña a la otra.
 */
export function cercania(centro: number, i: number, pista: Pista): number {
  const ranura = anchoDeRanura(pista)
  if (!(ranura > 0)) return 0
  const d = Math.abs(centro - (i + 0.5) * ranura) / ranura
  return d >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * d))
}

/** La escala de una pestaña según su cercanía (de 1 a 1 + AGRANDADO_MAXIMO). */
export function escalaPorCercania(c: number): number {
  return 1 + AGRANDADO_MAXIMO * limitar(c, 0, 1)
}

/** El brillo de una pestaña según su cercanía (de BRILLO_BASE a 1). */
export function brilloPorCercania(c: number): number {
  return BRILLO_BASE + (1 - BRILLO_BASE) * limitar(c, 0, 1)
}

// ─── El gesto: qué quiso hacer el dedo ──────────────────────────────────────
// `dx` y `dy` se miden desde donde se apoyó el dedo. Hasta que se levanta la
// lente el gesto puede terminar de tres maneras: levanta la lente (arrastre o
// espera), se abandona (quiso scrollear: sin lente, sin navegar y sin clic) o
// es un toque (lo resuelve el clic del enlace, como siempre).

/**
 * ¿El dedo se corrió lo suficiente DE COSTADO como para levantar la lente? El
 * umbral, y más en horizontal que en vertical: un scroll con unos píxeles de
 * deriva lateral no la levanta.
 */
export function arrancaArrastre(dx: number, dy: number = 0): boolean {
  return Math.abs(dx) >= UMBRAL_ARRASTRE_PX && Math.abs(dx) > Math.abs(dy)
}

/** Pasada la espera, ¿el dedo sigue quieto? Entonces la lente se levanta sola. */
export function arrancaPorEspera(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= TOLERANCIA_QUIETO_PX
}

/**
 * Antes de que se levante la lente: ¿el dedo se fue más en vertical que en
 * horizontal (pasado el temblor)? Quiso scrollear, no elegir: el gesto se
 * abandona.
 */
export function abandonaGesto(dx: number, dy: number): boolean {
  return Math.abs(dy) > TOLERANCIA_QUIETO_PX && Math.abs(dy) > Math.abs(dx)
}

export type DecisionDelDedo = 'esperar' | 'levantar' | 'abandonar'

/** Lo que hace la barra con un movimiento del dedo mientras la lente sigue abajo. */
export function decidirMovimiento(dx: number, dy: number): DecisionDelDedo {
  if (abandonaGesto(dx, dy)) return 'abandonar'
  if (arrancaArrastre(dx, dy)) return 'levantar'
  return 'esperar'
}

/**
 * Con la lente levantada, ¿soltar en `y` elige? No si el dedo quedó lejos, más
 * de MARGEN_SOLTAR_PX por encima del borde de arriba de la cápsula
 * (`arribaDeLaCapsula`, como `clientY`): la píldora vuelve a su lugar sin
 * navegar. Abajo de la cápsula y a los costados sí elige (la de la punta).
 */
export function sueltaElige(y: number, arribaDeLaCapsula: number): boolean {
  return y >= arribaDeLaCapsula - MARGEN_SOLTAR_PX
}

/**
 * Un cuadro del seguimiento: la lente se acerca al dedo como un resorte
 * amortiguado (exponencial), igual a cualquier tasa de cuadros. `tauMs` es el
 * tiempo característico; con 0 va pegada al dedo. A menos de 0,1 px, llegó.
 */
export function seguir(actual: number, objetivo: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return objetivo
  if (!(dtMs > 0)) return actual
  const siguiente = actual + (objetivo - actual) * (1 - Math.exp(-dtMs / tauMs))
  return Math.abs(objetivo - siguiente) < 0.1 ? objetivo : siguiente
}

/**
 * El estiramiento horizontal de la píldora mientras viaja `saltos` pestañas
 * (al tocar otra): un poco más largo el viaje, un poco más se estira.
 */
export function estiramientoDeViaje(saltos: number): number {
  if (!(saltos > 0)) return 1
  return 1 + Math.min(0.16, 0.07 + 0.03 * (saltos - 1))
}
