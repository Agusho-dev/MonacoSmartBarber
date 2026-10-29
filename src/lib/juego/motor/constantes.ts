/**
 * Números generales del motor de «Corte Final».
 *
 * Unidades: ticks (60 por segundo, TPS) y px lógicos de la vista de 960x540. Lo que depende
 * de cada barbero (daños, velocidades, cajas) vive en movimientos.ts; la vida y el costo de
 * los especiales, en personajes.ts. Acá queda lo que vale para todos.
 */
import type { FuerzaGolpe } from '../tipos'

// ─── Mundo ───────────────────────────────────────────────────────────────────

/** Bordes para el CENTRO de los luchadores (el escenario es la pantalla, sin scroll). */
export const X_MIN = 70
export const X_MAX = 890
/** Dónde arranca cada lado en cada round. */
export const X_INICIO: readonly [number, number] = [330, 630]

export const GRAVEDAD = 0.9
/** vy inicial del salto: ≈160 px de alto, ≈0,63 s en el aire. */
export const VEL_SALTO = 17
export const FRICCION_SUELO = 0.8
export const FRICCION_AIRE = 0.97

/** Distancia mínima entre los centros de dos cuerpos (empuje suave). */
export const DISTANCIA_CUERPOS = 62

/** Cajas de daño (hurtbox). Parado: CUERPO_ANCHO × (alturaMundo − 10). */
export const CUERPO_ANCHO = 64
export const CUERPO_AGACHADO = { ancho: 70, alto: 120 } as const
export const CUERPO_AIRE = { ancho: 60, alto: 150 } as const

/** Cajas de empuje: más bajas que las de daño para que se pueda saltar por encima del rival. */
export const EMPUJE_CAJA = {
  parado: 150,
  agachado: 110,
  aireDesde: 30,
  aireHasta: 140,
  tirado: 40,
} as const

// ─── Entrada ─────────────────────────────────────────────────────────────────

/** Apretar un poco antes de que termine un movimiento igual cuenta. */
export const TICKS_BUFFER = 8
/** Doble toque: el primer toque dura como mucho `maxApretado` y el segundo llega antes de `maxSuelto`. */
export const DOBLE_TOQUE = { maxApretado: 14, maxSuelto: 12 } as const

// ─── Movimiento ──────────────────────────────────────────────────────────────

export const DASH = { invulnerable: 8, espera: 30 } as const
/** Mantener adelante este tiempo arranca a correr (anim `correr`), si el rival está lejos. */
export const CORRER_DESDE = 24
export const CORRER_DISTANCIA_MIN = 130
/** Recuperación al aterrizar de un salto normal. */
export const ATERRIZAJE_TICKS = 4

// ─── Golpes ──────────────────────────────────────────────────────────────────

export const HITSTOP: Readonly<Record<FuerzaGolpe, number>> = { leve: 4, medio: 6, fuerte: 8, especial: 11 }
export const HITSTOP_CRITICO = 4
export const HITSTOP_KO = 22
/** Congelamiento del mundo al empezar un especial (el render hace el «super flash»). */
export const SUPER_FLASH = 24

export const HITSTUN: Readonly<Record<FuerzaGolpe, number>> = { leve: 14, medio: 18, fuerte: 24, especial: 30 }
export const FACTOR_BLOCKSTUN = 0.6

export const DESTELLO = 6
export const DESTELLO_CRITICO = 10

export const CRITICO = { mult: 1.6, aura: 30 } as const
/** Lo que pasa la guardia: 15 % de los golpes normales, 25 % de los especiales. */
export const CHIP = { normal: 0.15, especial: 0.25 } as const

/** A partir del golpe `desde` de un combo, cada golpe hace `factor` veces el anterior (con piso). */
export const ESCALADO_COMBO = { desde: 4, factor: 0.88, minimo: 0.45 } as const

// ─── Guardia («romper escudos») ──────────────────────────────────────────────

export const GUARDIA = {
  max: 100,
  /** Recuperación por tick cuando pasa `espera` sin bloquear. */
  regen: 0.35,
  espera: 60,
  rotaTicks: 70,
  rotaMult: 1.2,
  /** A cuánto vuelve la barra cuando termina la guardia rota. */
  vuelve: 50,
} as const

// ─── Carga de la máquina (el «elixir») ───────────────────────────────────────

export const CARGA = {
  inicio: 2,
  /** 1 unidad cada 2,2 s. */
  ticksPorUnidad: 132,
  porGolpe: 0.2,
  porRecibir: 0.3,
  turboSegundos: 20,
  turboMult: 2,
} as const

// ─── Efectos de los especiales ───────────────────────────────────────────────

export const EFECTO = {
  electrocutado: 40,
  congelado: 100,
  congeladoBloqueo: 35,
  /** Pegarle a un congelado lo rompe con este multiplicador. */
  rompeCongelado: 1.3,
  derribo: 50,
  /** Tirado en el piso después de un golpe en el aire. */
  derriboAereo: 30,
  levantarse: 26,
} as const

// ─── Fases (ticks simulados) ─────────────────────────────────────────────────

export const FASE = {
  presentacion: 90,
  anuncio: 96,
  /** KO: primero el hitstop del golpe (a escala 1), después `koLento` ticks a ESCALA_KO, después normal. */
  koLento: 25,
  koRampa: 10,
  ko: 82,
  tiempo: 90,
  entreRounds: 120,
  final: 180,
  /** En la fase final, el remate no se acepta antes de esto (que se lea «¡DEJALO AL CERO!»). */
  remateGracia: 20,
  /** Burla de la presentación (cada lado). */
  burla: 48,
} as const

export const ESCALA_KO = 0.35

/** Tope de eventos acumulados si el loop no los drena (pestaña oculta, pausa). */
export const MAX_EVENTOS = 1024
