/**
 * Movimientos de cada barbero, como DATOS. Sumar un luchador = sumar su kit acá (y su ficha en
 * personajes.ts, de donde salen la vida, los costos y el efecto de cada especial).
 *
 * Convenciones:
 *  - Ticks relativos al primer tick del movimiento (0 = el tick en que se apretó).
 *  - Cajas relativas al luchador mirando a la derecha: x hacia ADELANTE desde su centro;
 *    y desde el piso (en los aéreos, desde sus pies). El motor las espeja.
 *  - `empuje` es la velocidad inicial (px/tick) con la que sale despedido el rival; frena solo.
 */
import type { ClaveAnimacion, FuerzaGolpe, Herramienta, IdPersonaje, TipoProyectil } from '../tipos'

export interface Caja {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface VentanaGolpe {
  /** Tick en que se abre la ventana activa. */
  desde: number
  /** Ticks activos. */
  ticks: number
  danio: number
  danioGuardia: number
  fuerza: FuerzaGolpe
  caja: Caja
  empuje: number
  empujeBloqueo: number
  /** Si falta, sale de HITSTUN[fuerza]. */
  hitstun?: number
  /** Si falta, sale de HITSTOP[fuerza]. */
  hitstop?: number
}

export type BotonAtaque = 'golpe' | 'herramienta'

export interface DefMovimiento {
  id: string
  anim: ClaveAnimacion
  herramienta: Herramienta
  ventanas: VentanaGolpe[]
  /** Duración total (los aéreos siguen hasta aterrizar). */
  total: number
  aereo?: boolean
  /** Botón de la cadena a la que pertenece. */
  boton?: BotonAtaque
  /** Id del movimiento que sigue si se vuelve a tocar el mismo botón. */
  siguiente?: string
  /** Probabilidad de crítico que SUMA a la del personaje. Sin el campo, el golpe no puede ser crítico. */
  critico?: number
  /** Super armadura: hasta ese tick, los golpes de esas fuerzas pegan pero no lo frenan. */
  armadura?: { hasta: number; contra: readonly FuerzaGolpe[] }
  /** Avance propio (px/tick) entre esos ticks. */
  avance?: { desde: number; hasta: number; vel: number }
  /** Recuperación al aterrizar (aéreos). */
  aterrizaje?: number
}

/** Especial que se tira hacia adelante (Corte Relámpago). */
export interface DefEmbestida {
  desde: number
  ticks: number
  distancia: number
  /** Ticks de recuperación desde que choca, según cómo salió. */
  recuperacionGolpe: number
  recuperacionBloqueo: number
}

export interface DefProyectil {
  tipo: TipoProyectil
  /** Centro de salida relativo al luchador (x hacia adelante, y desde el piso). */
  salidaX: number
  salidaY: number
  vx: number
  vy: number
  gravedad: number
  /** Radianes por tick (el sillón gira). */
  giro: number
  /** Caja de golpe centrada en (x, y). Con `anchoFinal`/`altoFinal` crece con la edad (el spray). */
  ancho: number
  alto: number
  anchoFinal?: number
  altoFinal?: number
  /** Vida máxima en ticks. */
  vida: number
  golpes: number
  /** Ticks entre contactos (multigolpe). */
  intervalo: number
  danio: number
  danioGuardia: number
  fuerza: FuerzaGolpe
  fuerzaUltimo?: FuerzaGolpe
  hitstun: number
  hitstunUltimo?: number
  hitstop: number
  empuje: number
  /** Velocidad mientras arrastra a alguien (tornado). */
  arrastre?: number
  /** Al tocar el piso se desliza y frena (sillón); si no, desaparece. */
  desliza?: boolean
}

export interface DefEspecial extends DefMovimiento {
  numero: 1 | 2
  embestida?: DefEmbestida
  /** Para los que tiran algo: cuándo sale (y cuánto dura la pose de lanzamiento en la animación). */
  lanzamiento?: { desde: number; ticks: number }
  proyectil?: DefProyectil
}

/** Cómo juega la CPU con este barbero (preferencias, no reglas). */
export interface EstiloCpu {
  /** Probabilidad de elegir la herramienta en vez del golpe cuando ataca de cerca. */
  herramienta: number
  /** Distancia que le gusta para tantear. */
  distancia: number
  /** Distancia útil de cada especial [min, max] (centro a centro). */
  rangoEspecial: [[number, number], [number, number]]
  /** El especial con el que cierra un golpe confirmado (0 = ninguno). */
  especialDeCombo: 0 | 1 | 2
  /** Gusto por cada especial (multiplica las ganas de tirarlo). */
  preferencia: [number, number]
}

export interface KitPersonaje {
  caminar: number
  caminarAtras: number
  correr: number
  saltoVx: number
  dash: { adelante: number; atras: number; ticks: number }
  criticoBase: number
  /** Carga que devuelve cada crítico (pasiva de Simón). */
  cargaPorCritico: number
  /** Fracción de daño que no le entra (pasiva de Chipi). */
  reduccionDanio: number
  movimientos: Record<string, DefMovimiento>
  /** Primer movimiento de cada cadena y el aéreo. */
  inicio: { golpe: string; herramienta: string; aereo: string }
  especiales: [DefEspecial, DefEspecial]
  cpu: EstiloCpu
}

// ─── Simón «El Relámpago»: rápido, críticos, especiales baratos ─────────────

const SIMON: KitPersonaje = {
  caminar: 4.1,
  caminarAtras: 3.3,
  correr: 6.4,
  saltoVx: 4.4,
  dash: { adelante: 150, atras: 120, ticks: 14 },
  criticoBase: 0.15,
  cargaPorCritico: 0.5,
  reduccionDanio: 0,
  movimientos: {
    puno: {
      id: 'puno',
      anim: 'golpe',
      herramienta: 'puno',
      boton: 'golpe',
      siguiente: 'patada',
      critico: 0,
      total: 15,
      ventanas: [
        {
          desde: 5,
          ticks: 3,
          danio: 40,
          danioGuardia: 10,
          fuerza: 'leve',
          caja: { x0: 18, x1: 108, y0: 120, y1: 178 },
          empuje: 3.5,
          empujeBloqueo: 4.5,
        },
      ],
    },
    patada: {
      id: 'patada',
      anim: 'patada',
      herramienta: 'patada',
      boton: 'golpe',
      siguiente: 'combo',
      critico: 0,
      total: 20,
      ventanas: [
        {
          desde: 7,
          ticks: 4,
          danio: 55,
          danioGuardia: 14,
          fuerza: 'medio',
          caja: { x0: 22, x1: 128, y0: 50, y1: 150 },
          empuje: 4.5,
          empujeBloqueo: 5.5,
        },
      ],
    },
    combo: {
      id: 'combo',
      anim: 'combo',
      herramienta: 'patada',
      boton: 'golpe',
      critico: 0,
      total: 31,
      avance: { desde: 0, hasta: 12, vel: 1.6 },
      ventanas: [
        {
          desde: 6,
          ticks: 2,
          danio: 35,
          danioGuardia: 8,
          fuerza: 'medio',
          caja: { x0: 20, x1: 112, y0: 70, y1: 172 },
          empuje: 1.2,
          empujeBloqueo: 3,
          hitstun: 20,
        },
        {
          desde: 12,
          ticks: 3,
          danio: 55,
          danioGuardia: 10,
          fuerza: 'fuerte',
          caja: { x0: 20, x1: 122, y0: 60, y1: 175 },
          empuje: 13,
          empujeBloqueo: 8,
        },
      ],
    },
    maquina: {
      id: 'maquina',
      anim: 'herramienta1',
      herramienta: 'maquina',
      boton: 'herramienta',
      siguiente: 'tijera',
      critico: 0.05,
      total: 30,
      avance: { desde: 6, hasta: 14, vel: 1.8 },
      ventanas: [
        {
          desde: 12,
          ticks: 4,
          danio: 80,
          danioGuardia: 30,
          fuerza: 'fuerte',
          caja: { x0: 25, x1: 118, y0: 60, y1: 182 },
          empuje: 6.5,
          empujeBloqueo: 6,
        },
      ],
    },
    tijera: {
      id: 'tijera',
      anim: 'herramienta2',
      herramienta: 'tijera',
      boton: 'herramienta',
      critico: 0.05,
      total: 27,
      ventanas: [
        {
          desde: 10,
          ticks: 4,
          danio: 65,
          danioGuardia: 25,
          fuerza: 'fuerte',
          caja: { x0: 28, x1: 130, y0: 70, y1: 178 },
          empuje: 9,
          empujeBloqueo: 6,
        },
      ],
    },
    voladora: {
      id: 'voladora',
      anim: 'patada',
      herramienta: 'patada',
      aereo: true,
      critico: 0,
      total: 14,
      aterrizaje: 6,
      ventanas: [
        {
          desde: 6,
          ticks: 8,
          danio: 60,
          danioGuardia: 15,
          fuerza: 'medio',
          caja: { x0: 5, x1: 95, y0: -40, y1: 70 },
          empuje: 3.5,
          empujeBloqueo: 4,
        },
      ],
    },
  },
  inicio: { golpe: 'puno', herramienta: 'maquina', aereo: 'voladora' },
  especiales: [
    {
      id: 'corte_relampago',
      numero: 1,
      anim: 'especial1',
      herramienta: 'rayo',
      armadura: { hasta: 6, contra: ['leve', 'medio', 'fuerte'] },
      total: 42,
      ventanas: [
        {
          desde: 6,
          ticks: 18,
          danio: 150,
          danioGuardia: 40,
          fuerza: 'especial',
          caja: { x0: -10, x1: 72, y0: 10, y1: 190 },
          empuje: 6,
          empujeBloqueo: 2,
          hitstun: 30,
        },
      ],
      embestida: { desde: 6, ticks: 18, distancia: 320, recuperacionGolpe: 16, recuperacionBloqueo: 26 },
    },
    {
      id: 'tijera_tormenta',
      numero: 2,
      anim: 'especial2',
      herramienta: 'tornado',
      armadura: { hasta: 14, contra: ['leve', 'medio', 'fuerte'] },
      total: 38,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 4 },
      proyectil: {
        tipo: 'tornado',
        salidaX: 70,
        salidaY: 85,
        vx: 5.5,
        vy: 0,
        gravedad: 0,
        giro: 0.45,
        ancho: 90,
        alto: 170,
        vida: 170,
        golpes: 6,
        intervalo: 7,
        danio: 28,
        danioGuardia: 12,
        fuerza: 'leve',
        fuerzaUltimo: 'medio',
        hitstun: 12,
        hitstunUltimo: 20,
        hitstop: 3,
        empuje: 6,
        arrastre: 2.6,
      },
    },
  ],
  cpu: {
    herramienta: 0.25,
    distancia: 165,
    rangoEspecial: [
      [120, 340],
      [180, 820],
    ],
    especialDeCombo: 1,
    preferencia: [1, 1],
  },
}

// ─── Chipi «El Fijador»: pesado, aguanta, pega fuerte ───────────────────────

const CHIPI: KitPersonaje = {
  caminar: 2.85,
  caminarAtras: 2.3,
  correr: 5.2,
  saltoVx: 3.6,
  dash: { adelante: 150, atras: 120, ticks: 18 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0.12,
  movimientos: {
    puno: {
      id: 'puno',
      anim: 'golpe',
      herramienta: 'puno',
      boton: 'golpe',
      siguiente: 'patada',
      critico: 0,
      total: 21,
      ventanas: [
        {
          desde: 6,
          ticks: 3,
          danio: 40,
          danioGuardia: 10,
          fuerza: 'leve',
          caja: { x0: 18, x1: 112, y0: 118, y1: 172 },
          empuje: 3.5,
          empujeBloqueo: 4.5,
        },
      ],
    },
    patada: {
      id: 'patada',
      anim: 'patada',
      herramienta: 'patada',
      boton: 'golpe',
      siguiente: 'combo',
      critico: 0,
      total: 26,
      ventanas: [
        {
          desde: 8,
          ticks: 4,
          danio: 55,
          danioGuardia: 14,
          fuerza: 'medio',
          caja: { x0: 22, x1: 132, y0: 48, y1: 145 },
          empuje: 4.5,
          empujeBloqueo: 5.5,
        },
      ],
    },
    combo: {
      id: 'combo',
      anim: 'combo',
      herramienta: 'patada',
      boton: 'golpe',
      critico: 0,
      total: 37,
      avance: { desde: 0, hasta: 13, vel: 1.5 },
      ventanas: [
        {
          desde: 7,
          ticks: 2,
          danio: 35,
          danioGuardia: 8,
          fuerza: 'medio',
          caja: { x0: 20, x1: 116, y0: 70, y1: 168 },
          empuje: 1.2,
          empujeBloqueo: 3,
          hitstun: 20,
        },
        {
          desde: 13,
          ticks: 3,
          danio: 55,
          danioGuardia: 10,
          fuerza: 'fuerte',
          caja: { x0: 20, x1: 126, y0: 60, y1: 170 },
          empuje: 14,
          empujeBloqueo: 8,
        },
      ],
    },
    maquina: {
      id: 'maquina',
      anim: 'herramienta1',
      herramienta: 'maquina',
      boton: 'herramienta',
      siguiente: 'peine',
      critico: 0.05,
      total: 36,
      avance: { desde: 6, hasta: 15, vel: 1.6 },
      armadura: { hasta: 13, contra: ['leve'] },
      ventanas: [
        {
          desde: 13,
          ticks: 4,
          danio: 80,
          danioGuardia: 30,
          fuerza: 'fuerte',
          caja: { x0: 25, x1: 122, y0: 60, y1: 178 },
          empuje: 6.5,
          empujeBloqueo: 6,
        },
      ],
    },
    peine: {
      id: 'peine',
      anim: 'herramienta2',
      herramienta: 'peine',
      boton: 'herramienta',
      critico: 0.05,
      total: 33,
      ventanas: [
        {
          desde: 11,
          ticks: 4,
          danio: 65,
          danioGuardia: 25,
          fuerza: 'fuerte',
          caja: { x0: 28, x1: 130, y0: 70, y1: 175 },
          empuje: 9,
          empujeBloqueo: 6,
        },
      ],
    },
    voladora: {
      id: 'voladora',
      anim: 'patada',
      herramienta: 'patada',
      aereo: true,
      critico: 0,
      total: 15,
      aterrizaje: 6,
      ventanas: [
        {
          desde: 7,
          ticks: 8,
          danio: 60,
          danioGuardia: 15,
          fuerza: 'medio',
          caja: { x0: 5, x1: 100, y0: -40, y1: 70 },
          empuje: 3.5,
          empujeBloqueo: 4,
        },
      ],
    },
  },
  inicio: { golpe: 'puno', herramienta: 'maquina', aereo: 'voladora' },
  especiales: [
    {
      id: 'sillonazo_brutal',
      numero: 1,
      anim: 'especial1',
      herramienta: 'sillon',
      armadura: { hasta: 16, contra: ['leve', 'medio', 'fuerte'] },
      total: 42,
      ventanas: [],
      lanzamiento: { desde: 16, ticks: 4 },
      proyectil: {
        tipo: 'sillon',
        // En especial1[1] del atlas el sillón está a ≈ +102/+117: el render lo dibuja saliendo de
        // ahí y lo funde con esta trayectoria (sacarlo de acá corre el balance, simulado).
        salidaX: 60,
        salidaY: 130,
        vx: 8.5,
        vy: 8,
        gravedad: 0.4,
        giro: 0.32,
        ancho: 100,
        alto: 84,
        vida: 120,
        golpes: 1,
        intervalo: 0,
        danio: 190,
        danioGuardia: 0,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 11,
        empuje: 5,
        desliza: true,
      },
    },
    {
      id: 'fijacion_extrema',
      numero: 2,
      anim: 'especial2',
      herramienta: 'spray',
      armadura: { hasta: 12, contra: ['leve', 'medio', 'fuerte'] },
      total: 44,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 6 },
      proyectil: {
        tipo: 'spray',
        salidaX: 45,
        salidaY: 115,
        vx: 5.5,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 36,
        alto: 80,
        anchoFinal: 90,
        altoFinal: 140,
        vida: 24,
        golpes: 1,
        intervalo: 0,
        danio: 40,
        danioGuardia: 20,
        fuerza: 'especial',
        hitstun: 20,
        hitstop: 8,
        empuje: 2,
      },
    },
  ],
  cpu: {
    herramienta: 0.4,
    distancia: 175,
    rangoEspecial: [
      [200, 470],
      [0, 235],
    ],
    especialDeCombo: 0,
    preferencia: [1.2, 0.8],
  },
}

export const MOVIMIENTOS: Record<IdPersonaje, KitPersonaje> = {
  simon: SIMON,
  chipi: CHIPI,
}
