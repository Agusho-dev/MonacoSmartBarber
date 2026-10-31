/**
 * Movimientos de cada barbero, como DATOS. Sumar un luchador = sumar su kit acá (y su ficha en
 * personajes.ts, de donde salen la vida, los costos y el efecto de cada especial).
 *
 * Convenciones:
 *  - Ticks relativos al primer tick del movimiento (0 = el tick en que se apretó). El super flash
 *    de un especial congela el mundo y NO cuenta: el tick 0 es el primero después del flash.
 *  - Cajas relativas al luchador mirando a la derecha: x hacia ADELANTE desde su centro;
 *    y desde el piso (en los aéreos, desde sus pies). El motor las espeja.
 *  - `empuje` es la velocidad inicial (px/tick) con la que sale despedido el rival; frena solo.
 *
 * Piezas reutilizables de los especiales (30/oct, elenco de 13). Cada una es un campo opcional:
 *  - Embestida (DefEmbestida): se tira hacia adelante `distancia` px en `ticks`. Por defecto los
 *    proyectiles la atraviesan (`atraviesa`) y frena al primer contacto; con `sigue` no frena
 *    (multigolpe: el molino), con `invulnerableHasta` no le entra nada al arrancar, y con `salto`
 *    va por el aire con su gravedad (la Patada del Dragón, la Chilena) y termina al aterrizar.
 *  - Ráfaga (DefEspecial.rafaga): `cantidad` proyectiles, uno cada `cada` ticks desde el
 *    lanzamiento; `tiros[i]` cambia vx/vy/salida/efecto de cada tiro (botellas, mates, balas).
 *  - Bumerán (DefProyectil.bumeran): frena `freno` px/tick² hasta dar la vuelta y vuelve hacia el
 *    dueño (`vuelta` = true); pega una vez por tramo y desaparece al llegar a él.
 *  - Rastrero (`rastrero`): va por el piso y sólo pega a los que están en el piso; con
 *    `imbloqueable` además no se puede bloquear (el sismo: hay que saltarlo).
 *  - Nube (`nube`): al tocar el piso o al pegar deja un área en el piso que dura `vida` ticks y cada
 *    `cada` ticks hace `danio` (sin hitstun ni bloqueo) y deja LENTO. Una nube por dueño: no se apila.
 *  - Chorro (`chorro`): nace en la mano y crece hasta `anchoFinal` en `crece` ticks; sigue al
 *    dueño y se corta si le pegan. Multigolpe corto, con empuje (`empujaCadaGolpe`) o quemadura.
 *  - Onda (`onda`): grande y lenta; no pega al que está en dash (se pasa con la esquiva); al que toca
 *    lo lleva delante hasta la pared y ahí le pega otra vez (`danioPared`) y lo aturde.
 *  - Área diferida (`diferido`): aparece fija a `distancia` delante, estalla en `espera` (ver
 *    TIEMPOS_PROYECTIL de tipos.ts) y pega `activo` ticks con el tamaño del estallido.
 *  - Agarre (DefEspecial.agarre): la ventana es la mano; si toca a alguien en el piso que se pueda
 *    golpear, no se bloquea: lo levanta ('agarrado'), lo aprieta y lo tira al piso. Si no agarra
 *    nada, el especial dura `total` (recuperación larga: queda regalado).
 *  - Cura (DefEspecial.cura): desde `desde`, cada `cada` ticks se cura un pedacito hasta `fraccion`
 *    de su vida; se corta si le pegan (salvo lo que aguante su `armadura`); nunca pasa de vidaMax.
 *  - Efectos con duración (`ticksEfecto`): aturde (no se mueve), marea (no se cubre, camina lento),
 *    quema (`quema`: daño cada `cada` ticks). El efecto 'critico' de la ficha = siempre crítico.
 *  - Pasivas (KitPersonaje.pasiva): perillas que el motor mira en cada lugar (ver PasivaKit).
 */
import type { ClaveAnimacion, Dificultad, EfectoEspecial, FuerzaGolpe, Herramienta, IdPersonaje, TipoProyectil } from '../tipos'
import { TIEMPOS_PROYECTIL } from '../tipos'

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
  /** En un especial: el efecto de ESTA ventana (si falta, el de la ficha; null = ninguno). */
  efecto?: EfectoEspecial | null
  /** Ticks del estado que deja el efecto (aturde, marea, quema). */
  ticksEfecto?: number
  /**
   * Ventana multigolpe: pega hasta `golpes` veces mientras está activa, una cada `cada` ticks
   * (los contactos llegan cuando el rival está a tiro, no en ticks fijos: el molino, la patada
   * del dragón). `ultimo` cambia el remate (daño, empuje, efecto).
   */
  golpes?: number
  cada?: number
  ultimo?: { danio: number; empuje: number; hitstun?: number; fuerza?: FuerzaGolpe; efecto?: EfectoEspecial | null }
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
  /** La animación corre pareja todo el movimiento (sin sincronizar con las ventanas): multigolpes largos. */
  animLineal?: boolean
}

/** Especial que se tira hacia adelante (Corte Relámpago, Moto, Break Dance, Paso de Cuarteto…). */
export interface DefEmbestida {
  desde: number
  ticks: number
  distancia: number
  /** Ticks de recuperación desde que choca, según cómo salió (en las aéreas: al aterrizar). */
  recuperacionGolpe: number
  recuperacionBloqueo: number
  /** Invulnerable a todo desde el tick 0 hasta este tick (el arranque del molino). */
  invulnerableHasta?: number
  /** Los proyectiles lo atraviesan mientras corre (por defecto sí, como el Corte Relámpago). */
  atraviesa?: boolean
  /** No frena al pegar: sigue con las otras ventanas (multigolpe). */
  sigue?: boolean
  /** Por el aire: en `desde` salta con esta vy y cae con esta gravedad; termina al aterrizar. */
  salto?: { vy: number; gravedad: number }
}

/** La nube que deja un proyectil (el pañal). */
export interface DefNube {
  vida: number
  /** Cada cuántos ticks hace daño (y renueva el LENTO). */
  cada: number
  danio: number
  /** Ticks de LENTO que deja cada vez. */
  lento: number
  ancho: number
  alto: number
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
  /** Multigolpe: cada contacto empuja (si no, sólo el último; el tornado arrastra). */
  empujaCadaGolpe?: boolean
  /** Velocidad mientras arrastra a alguien (tornado). */
  arrastre?: number
  /** Al tocar el piso se desliza y frena (sillón); si no, desaparece. */
  desliza?: boolean
  /** Efecto de cada contacto (si falta, el del especial en la ficha; 'multigolpe' = ninguno). */
  efecto?: EfectoEspecial | null
  /** Ticks del estado que deja el efecto (aturde, marea, quema). */
  ticksEfecto?: number
  /** Quemadura: cada `cada` ticks hace `danio` mientras dure (ticksEfecto). */
  quema?: { cada: number; danio: number }
  rastrero?: boolean
  imbloqueable?: boolean
  bumeran?: { freno: number }
  chorro?: { crece: number }
  onda?: { danioPared: number; ticksAturdePared: number }
  diferido?: { distancia: number; espera: number; activo: number; ancho: number; alto: number }
  nube?: DefNube
}

/** Lo que cambia un tiro de una ráfaga respecto del proyectil base. */
export interface TiroRafaga {
  vx?: number
  vy?: number
  salidaX?: number
  salidaY?: number
  efecto?: EfectoEspecial | null
  empuje?: number
}

/** Agarre: lo levanta, lo aprieta y lo tira al piso. */
export interface DefAgarre {
  /** Ticks que lo tiene levantado. */
  sostener: number
  /** Cada `cada` ticks lo aprieta con `danio` (sin bloqueo). */
  apretones: { cada: number; danio: number }
  /** El tirón al piso del final. */
  tiron: { danio: number; empuje: number }
  /** Dónde lo sostiene: `adelante` px delante de su centro y `alto` px sobre el piso. */
  adelante: number
  alto: number
  /** Ticks que tarda en recuperarse después de tirarlo. */
  recuperacion: number
}

export interface DefEspecial extends DefMovimiento {
  numero: 1 | 2
  embestida?: DefEmbestida
  /** Para los que tiran algo: cuándo sale (y cuánto dura la pose de lanzamiento en la animación). */
  lanzamiento?: { desde: number; ticks: number }
  proyectil?: DefProyectil
  rafaga?: { cantidad: number; cada: number; tiros?: readonly TiroRafaga[] }
  agarre?: DefAgarre
  cura?: { desde: number; ticks: number; cada: number; fraccion: number }
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
  /**
   * Gusto por cada especial (multiplica las ganas de tirarlo). Sólo pesa en normal y difícil (la
   * fácil los tira «torpe», sin mirar esto): sirve para emparejar un barbero entre dificultades.
   */
  preferencia: [number, number]
  /**
   * Pericia de la CPU con este barbero en cada dificultad (−1..1; si falta, 0): corre sus
   * parámetros (`paramsConPericia` en cpu.ts) hacia los de la dificultad de arriba (+) o hacia los
   * de abajo (−). Empareja lo que el daño no puede: la CPU fácil casi no se cubre ni castiga y la
   * difícil castiga casi todo, y con cada una rinden kits distintos. Sólo cambia cómo juega la CPU
   * con ese barbero, nunca el kit (el humano y el online no lo notan), y normal queda en 0: es la
   * dificultad que mide el balance de los kits (contra una persona, ver `periciaHumano` y
   * `asistencia`). Es una perilla MUY sensible: la reacción se
   * redondea a ticks (en fácil, 26, cambia un tick cada ≈ 0,03; en difícil, 6, pasa a 5 desde
   * +0,17 y a 7 desde −0,17) y un tick de reacción mueve 10 a 20 puntos de victorias. Afinada con
   * balance.mts (--ajuste con «pericia», 30/oct): sin ella, en fácil iban de 38 a 62 % y en difícil
   * de 36 a 57 %.
   */
  pericia?: Partial<Record<Dificultad, number>>
  /**
   * Contra una PERSONA (el otro lado es humano), la pericia de la CPU con este barbero reemplaza a
   * `pericia` en esa dificultad (si falta, vale `pericia`). CPU contra CPU y el online no la ven.
   * Existe porque la CPU de cada barbero no le cuesta lo mismo a una persona que a otra CPU: medido
   * con los dos humanos de balance.mts (el simple y el novato), en normal el mismo humano le ganaba
   * 10 % a la CPU de Lucas y 70 % a la de Nahuel, con la CPU contra CPU pareja (revisión del 30/oct).
   */
  periciaHumano?: Partial<Record<Dificultad, number>>
  /**
   * Asistencia a la persona que juega con ESTE barbero contra la CPU (−1..1): se le resta a la
   * pericia de la CPU rival en esa dificultad (positiva = la CPU juega peor). Empareja lo que cada
   * kit le cuesta a alguien que recién empieza (con Chipi, que camina y pega lento, el humano simple
   * ganaba 0,4 %; con Luciano, 64 %). Sólo cuando exactamente un lado es humano.
   */
  asistencia?: Partial<Record<Dificultad, number>>
}

/** Pasivas como perillas del kit (las que no son de daño o crítico). */
export interface PasivaKit {
  /** Con menos de `umbral` (fracción) de vida pega `mult` veces más. */
  furia?: { umbral: number; mult: number }
  /** Multiplica la recarga sola de la carga. */
  multCarga?: number
  /** Carga de más al empezar cada round. */
  cargaInicial?: number
  /** Multiplica el daño a la guardia que recibe. */
  multDanioGuardia?: number
  /** Carga por cada golpe que bloquea. */
  cargaPorBloqueo?: number
  /** Multiplica la duración de los estados que recibe (congelado, electrocutado, aturdido, mareado, quemado, lento). */
  multEstados?: number
  /** Carga que le devuelve cada especial que acierta. */
  cargaPorEspecial?: number
  /** Super armadura en todos sus ataques (arranque y activo) contra estas fuerzas. */
  armaduraAtaques?: readonly FuerzaGolpe[]
}

export interface KitPersonaje {
  caminar: number
  caminarAtras: number
  correr: number
  saltoVx: number
  /** Esquiva: distancias, duración y (opcionales) ticks invulnerable y enfriamiento. */
  dash: { adelante: number; atras: number; ticks: number; invulnerable?: number; espera?: number }
  criticoBase: number
  /** Carga que devuelve cada crítico (pasiva de Simón). */
  cargaPorCritico: number
  /** Fracción de daño que no le entra (pasiva de Chipi). */
  reduccionDanio: number
  pasiva?: PasivaKit
  movimientos: Record<string, DefMovimiento>
  /** Primer movimiento de cada cadena y el aéreo. */
  inicio: { golpe: string; herramienta: string; aereo: string }
  especiales: [DefEspecial, DefEspecial]
  cpu: EstiloCpu
}

// ─── Simón «El Relámpago»: rápido, críticos que le devuelven carga ─────────

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
    preferencia: [0.5, 0.5],
    pericia: { facil: 0.13, dificil: 0.02 },
    periciaHumano: { normal: 0.026 },
    asistencia: { normal: -0.061, dificil: -0.1 },
  },
}

// ─── Chipi «El Fijador»: pesado, aguanta, pega fuerte ───────────────────────

const CHIPI: KitPersonaje = {
  // 3,2 (era 2,85) y los golpes al ritmo de los demás (el puño era 6/21): con el GOLPE y la marcha
  // más lentos del elenco, el que sólo aprieta GOLPE (el «humano simple» de balance.mts) le ganaba
  // 0,4 % a la CPU normal con Chipi. Lo pesado sigue en la MÁQUINA con armadura, la vida y la pasiva
  // (revisión del 30/oct, segunda tanda).
  caminar: 3.2,
  caminarAtras: 2.6,
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
      total: 16,
      ventanas: [
        {
          desde: 5,
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
      total: 21,
      ventanas: [
        {
          desde: 7,
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
      total: 32,
      avance: { desde: 0, hasta: 12, vel: 1.5 },
      ventanas: [
        {
          desde: 6,
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
          desde: 12,
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
          // 72 (era 80) y el peine 59 (era 65): el daño que pasó al GOLPE más rápido.
          danio: 72,
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
          danio: 59,
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
        // 125 (era 190): es el especial que más acierta (≈ 89 % CPU contra CPU) y, tirado sin
        // apuntar apenas se enciende, era lo que más le daba a Chipi: el que aprieta los especiales le
        // ganaba 2 de 3 a la CPU normal y el que sólo aprieta GOLPE, 1 de 4 (revisión del 30/oct,
        // segunda tanda). Lo que pierde acá lo recupera en los golpes (DANIO_KIT).
        danio: 125,
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
    pericia: { facil: -0.075, dificil: -0.165 },
    periciaHumano: { normal: 0.095 },
    asistencia: { normal: -0.116, dificil: -0.16 },
  },
}

// ─── Piezas para armar los kits del elenco nuevo ─────────────────────────────

const TODO: readonly FuerzaGolpe[] = ['leve', 'medio', 'fuerte']

function ventana(
  desde: number,
  ticks: number,
  danio: number,
  danioGuardia: number,
  fuerza: FuerzaGolpe,
  [x0, x1, y0, y1]: readonly [number, number, number, number],
  empuje: number,
  empujeBloqueo: number,
  extra: Partial<VentanaGolpe> = {},
): VentanaGolpe {
  return { desde, ticks, danio, danioGuardia, fuerza, caja: { x0, x1, y0, y1 }, empuje, empujeBloqueo, ...extra }
}

/**
 * Los golpes normales (puño → patada → combo, y la patada voladora) a partir de los de Simón:
 * `ritmo` estira el arranque y la recuperación (1 = Simón, 1,1 = más lento), `danio` multiplica
 * los daños y `alcance` suma px a las cajas.
 */
function normales(o: { ritmo: number; danio: number; alcance: number }): Record<string, DefMovimiento> {
  const t = (n: number) => Math.max(1, Math.round(n * o.ritmo))
  const d = (n: number) => Math.round(n * o.danio)
  const a = o.alcance
  return {
    puno: {
      id: 'puno',
      anim: 'golpe',
      herramienta: 'puno',
      boton: 'golpe',
      siguiente: 'patada',
      critico: 0,
      total: t(15),
      ventanas: [ventana(t(5), 3, d(40), 10, 'leve', [18, 108 + a, 120, 178], 3.5, 4.5)],
    },
    patada: {
      id: 'patada',
      anim: 'patada',
      herramienta: 'patada',
      boton: 'golpe',
      siguiente: 'combo',
      critico: 0,
      total: t(20),
      ventanas: [ventana(t(7), 4, d(55), 14, 'medio', [22, 128 + a, 50, 150], 4.5, 5.5)],
    },
    combo: {
      id: 'combo',
      anim: 'combo',
      herramienta: 'patada',
      boton: 'golpe',
      critico: 0,
      total: t(31),
      avance: { desde: 0, hasta: t(12), vel: 1.6 },
      ventanas: [
        ventana(t(6), 2, d(35), 8, 'medio', [20, 112 + a, 70, 172], 1.2, 3, { hitstun: 20 }),
        ventana(t(12), 3, d(55), 10, 'fuerte', [20, 122 + a, 60, 175], 13, 8),
      ],
    },
    voladora: {
      id: 'voladora',
      anim: 'patada',
      herramienta: 'patada',
      aereo: true,
      critico: 0,
      total: t(14),
      aterrizaje: 6,
      ventanas: [ventana(t(6), 8, d(60), 15, 'medio', [5, 95 + a, -40, 70], 3.5, 4)],
    },
  }
}

/**
 * Un golpe de la cadena de HERRAMIENTA (lento, mucho daño a la guardia, +5 % de crítico).
 *
 * El primero (el que sale con el botón MÁQUINA) arranca a los 12 ticks en todos (Chipi, a los 13 con
 * armadura): lo que cambia entre barberos es el alcance y el daño. Revisión del 30/oct, segunda
 * tanda: iba de 10 (Gabriel) a 14 (Brian) y un tick decidía casi todo el cambio de golpes entre dos
 * personas que machacan GOLPE y MÁQUINA (el «novato» de balance.mts): novato contra novato, Gabriel
 * y Luciano ganaban 85 % y Brian 3 %; con Gabriel a 11, su CPU pasaba de 41 a 30 % contra las otras.
 */
function pesado(
  id: string,
  anim: 'herramienta1' | 'herramienta2',
  herramienta: Herramienta,
  o: {
    desde: number
    total: number
    danio: number
    guardia: number
    caja: readonly [number, number, number, number]
    empuje: number
    siguiente?: string
    avance?: { desde: number; hasta: number; vel: number }
    armadura?: { hasta: number; contra: readonly FuerzaGolpe[] }
  },
): DefMovimiento {
  return {
    id,
    anim,
    herramienta,
    boton: 'herramienta',
    siguiente: o.siguiente,
    critico: 0.05,
    total: o.total,
    avance: o.avance,
    armadura: o.armadura,
    ventanas: [ventana(o.desde, 4, o.danio, o.guardia, 'fuerte', o.caja, o.empuje, 6)],
  }
}

// ─── Nico U. «El Xeneize»: equilibrado y agresivo; el bombo aturde, la navaja siempre es crítica ──

const NICO_U: KitPersonaje = {
  caminar: 3.8,
  caminarAtras: 3.1,
  correr: 6.2,
  saltoVx: 4.2,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { furia: { umbral: 0.35, mult: 1.2 } },
  movimientos: {
    ...normales({ ritmo: 1, danio: 1, alcance: 2 }),
    maquina: pesado('maquina', 'herramienta1', 'maquina', {
      desde: 12,
      total: 30,
      danio: 80,
      guardia: 30,
      caja: [25, 120, 60, 182],
      empuje: 6.5,
      siguiente: 'tijeras',
      avance: { desde: 6, hasta: 14, vel: 1.8 },
    }),
    tijeras: pesado('tijeras', 'herramienta2', 'tijera', { desde: 10, total: 27, danio: 66, guardia: 25, caja: [28, 132, 70, 178], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'maquina', aereo: 'voladora' },
  especiales: [
    {
      id: 'bombo_aturdidor',
      numero: 1,
      anim: 'especial1',
      herramienta: 'bombo',
      armadura: { hasta: 14, contra: TODO },
      total: 40,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 6 },
      proyectil: {
        tipo: 'bombo',
        salidaX: 70,
        salidaY: 0,
        vx: 6.5,
        vy: 0,
        gravedad: 0,
        giro: 0.22,
        ancho: 72,
        alto: 72,
        vida: 160,
        golpes: 1,
        intervalo: 0,
        danio: 55,
        danioGuardia: 22,
        fuerza: 'especial',
        hitstun: 22,
        hitstop: 9,
        empuje: 3,
        rastrero: true,
        // Aturde 56 ticks (eran 70): con 1,2 s entraba una cadena entera atrás del bombo y, tirado
        // sin apuntar, era lo que hacía a Nico U. el más fuerte entre dos personas (revisión del
        // 30/oct, segunda tanda).
        ticksEfecto: 56,
      },
    },
    {
      id: 'navajazo',
      numero: 2,
      anim: 'especial2',
      herramienta: 'navaja',
      armadura: { hasta: 6, contra: TODO },
      total: 34,
      avance: { desde: 3, hasta: 11, vel: 7 },
      ventanas: [ventana(9, 4, 80, 26, 'especial', [10, 132, 60, 190], 7, 4, { hitstun: 28 })],
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 165,
    rangoEspecial: [
      [170, 820],
      [60, 200],
    ],
    especialDeCombo: 2,
    preferencia: [1, 0.6],
    pericia: { facil: -0.033, dificil: 0.083 },
    periciaHumano: { normal: 0.044 },
    asistencia: { normal: -0.123, dificil: -0.06 },
  },
}

// ─── Fabri «El Facha»: aguante; se cura y remata con el guante ─────────────

const FABRI: KitPersonaje = {
  caminar: 3.4,
  caminarAtras: 2.8,
  correr: 5.8,
  saltoVx: 4.0,
  dash: { adelante: 150, atras: 120, ticks: 16 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { multCarga: 1.15 },
  movimientos: {
    ...normales({ ritmo: 1.05, danio: 1, alcance: 0 }),
    celular: pesado('celular', 'herramienta1', 'celular', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 30,
      danio: 70,
      guardia: 28,
      caja: [30, 148, 70, 180],
      empuje: 7,
      siguiente: 'anteojos',
    }),
    anteojos: pesado('anteojos', 'herramienta2', 'anteojos', { desde: 12, total: 30, danio: 58, guardia: 24, caja: [40, 168, 90, 170], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'celular', aereo: 'voladora' },
  especiales: [
    {
      id: 'curacion',
      numero: 1,
      anim: 'especial1',
      herramienta: 'celular',
      // Los golpes leves y medios no la cortan (pegan igual): sólo un golpe fuerte o un especial.
      // Sin esto no había un momento seguro para curarse contra alguien que pega sin parar, y la CPU
      // casi no la usaba (revisión del 30/oct, segunda tanda).
      armadura: { hasta: 70, contra: ['leve', 'medio'] },
      total: 82,
      ventanas: [],
      cura: { desde: 10, ticks: 60, cada: 10, fraccion: 0.165 },
    },
    {
      id: 'modo_boxeador',
      numero: 2,
      anim: 'especial2',
      herramienta: 'guante',
      armadura: { hasta: 22, contra: TODO },
      total: 52,
      ventanas: [],
      lanzamiento: { desde: 22, ticks: 8 },
      proyectil: {
        tipo: 'guante',
        salidaX: 70,
        salidaY: 125,
        vx: 13,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 84,
        alto: 76,
        vida: 24,
        golpes: 1,
        intervalo: 0,
        danio: 150,
        danioGuardia: 0,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 12,
        empuje: 7,
      },
    },
  ],
  cpu: {
    herramienta: 0.4,
    distancia: 185,
    rangoEspecial: [
      [280, 2000],
      [110, 370],
    ],
    especialDeCombo: 0,
    preferencia: [1, 0.8],
    pericia: { facil: -0.02, dificil: 0.075 },
    periciaHumano: { normal: 0.361 },
    asistencia: { normal: 0.174 },
  },
}

// ─── Luciano «El Motoquero»: presión; la moto cruza la pantalla, la pistola tira ráfagas ───────

const LUCIANO: KitPersonaje = {
  caminar: 4.4,
  caminarAtras: 3.4,
  correr: 7.4,
  saltoVx: 4.6,
  dash: { adelante: 185, atras: 145, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  movimientos: {
    ...normales({ ritmo: 0.98, danio: 0.95, alcance: 0 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 29,
      danio: 75,
      guardia: 26,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 2 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 9, total: 26, danio: 60, guardia: 22, caja: [24, 138, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'moto',
      numero: 1,
      anim: 'especial1',
      herramienta: 'moto',
      armadura: { hasta: 10, contra: TODO },
      total: 52,
      ventanas: [ventana(10, 26, 125, 35, 'especial', [-10, 95, 0, 150], 7, 3, { hitstun: 30 })],
      embestida: { desde: 10, ticks: 26, distancia: 560, recuperacionGolpe: 16, recuperacionBloqueo: 30 },
    },
    {
      id: 'pistola',
      numero: 2,
      anim: 'especial2',
      herramienta: 'bala',
      armadura: { hasta: 12, contra: TODO },
      total: 50,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 24 },
      rafaga: { cantidad: 3, cada: 9, tiros: [{}, {}, { efecto: 'derriba', empuje: 6 }] },
      proyectil: {
        tipo: 'bala',
        salidaX: 85,
        salidaY: 108,
        vx: 17,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 28,
        alto: 18,
        vida: 60,
        golpes: 1,
        intervalo: 0,
        danio: 34,
        danioGuardia: 10,
        fuerza: 'medio',
        hitstun: 20,
        hitstop: 5,
        empuje: 4.5,
        efecto: null,
      },
    },
  ],
  cpu: {
    herramienta: 0.25,
    distancia: 150,
    rangoEspecial: [
      [140, 600],
      [200, 820],
    ],
    especialDeCombo: 1,
    preferencia: [1, 1],
    pericia: { facil: 0.05, dificil: 0.166 },
    periciaHumano: { normal: 0.061 },
    asistencia: { normal: -0.133 },
  },
}

// ─── Gabriel «El B-Boy»: escurridizo; molino invulnerable al arrancar y un graffiti que explota ──

const GABRIEL: KitPersonaje = {
  caminar: 4.3,
  caminarAtras: 3.6,
  correr: 6.6,
  saltoVx: 4.6,
  dash: { adelante: 150, atras: 125, ticks: 13, invulnerable: 13, espera: 16 },
  criticoBase: 0.1,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  movimientos: {
    ...normales({ ritmo: 0.96, danio: 0.92, alcance: 0 }),
    // La MÁQUINA más segura del elenco (+2 bloqueada) pasa a +1: machacarla le ganaba 7 de 10 a la
    // CPU normal. Ojo: Gabriel es muy sensible al ritmo de su MÁQUINA y de su molino (con arranque
    // 11/28 o un molino de 4 golpes, la CPU normal con Gabriel bajaba de 50 % a 30 %): simular.
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 29,
      danio: 70,
      guardia: 26,
      caja: [24, 122, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 11, vel: 2 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 8, total: 25, danio: 58, guardia: 22, caja: [24, 136, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'break_dance',
      numero: 1,
      anim: 'especial1',
      herramienta: 'break',
      total: 56,
      animLineal: true,
      ventanas: [
        // 5 golpes (con 4 el molino seguía bailando sin pegar y lo castigaban siempre), más livianos
        // y con poca guardia (era 24 y 8: tirado sin pensar desarmaba la guardia de la CPU).
        ventana(10, 40, 20, 4, 'medio', [-40, 100, 0, 135], 2.5, 2, {
          hitstun: 18,
          golpes: 5,
          cada: 8,
          ultimo: { danio: 36, empuje: 11, hitstun: 24, fuerza: 'fuerte' },
        }),
      ],
      embestida: {
        desde: 8,
        ticks: 40,
        distancia: 240,
        recuperacionGolpe: 14,
        recuperacionBloqueo: 20,
        // Invulnerable sólo el arranque (con 16 ticks le ganaba a todo lo que el rival tirara).
        invulnerableHasta: 12,
        sigue: true,
        atraviesa: false,
      },
    },
    {
      id: 'graffiti_slam',
      numero: 2,
      anim: 'especial2',
      herramienta: 'graffiti',
      armadura: { hasta: 16, contra: TODO },
      total: 40,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 8 },
      proyectil: {
        tipo: 'graffiti',
        salidaX: 0,
        salidaY: 0,
        vx: 0,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 130,
        alto: 150,
        vida: 40,
        // UN contacto por estallido (sigue activo los 8 ticks para el que entra tarde). Con 5 e
        // intervalo 0 volvía a pegar en cada tick al que se cubría: rompía la guardia al 2.º contacto
        // y el 3.º entraba limpio, y cubrirse costaba 310 contra 182 sin cubrirse (revisión del 30/oct).
        golpes: 1,
        intervalo: 0,
        danio: 140,
        danioGuardia: 45,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 12,
        empuje: 6,
        diferido: { distancia: 250, espera: TIEMPOS_PROYECTIL.graffitiEstalla, activo: 8, ancho: 240, alto: 230 },
      },
    },
  ],
  cpu: {
    herramienta: 0.25,
    distancia: 170,
    rangoEspecial: [
      [60, 280],
      [175, 330],
    ],
    especialDeCombo: 1,
    preferencia: [1, 1],
    pericia: { facil: -0.09, dificil: -0.075 },
    periciaHumano: { normal: 0.045 },
    asistencia: { normal: -0.27, dificil: -0.22 },
  },
}

// ─── Guillermo «El Bartender»: control; el trago marea, las botellas vuelan ─────

const GUILLERMO: KitPersonaje = {
  caminar: 3.5,
  caminarAtras: 2.9,
  correr: 5.8,
  saltoVx: 4.0,
  dash: { adelante: 150, atras: 120, ticks: 16 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { cargaInicial: 2 },
  movimientos: {
    ...normales({ ritmo: 1, danio: 1, alcance: 0 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 10, total: 27, danio: 62, guardia: 22, caja: [24, 138, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'trago_mareador',
      numero: 1,
      anim: 'especial1',
      herramienta: 'trago',
      armadura: { hasta: 14, contra: TODO },
      total: 38,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 6 },
      proyectil: {
        tipo: 'trago',
        salidaX: 55,
        salidaY: 135,
        vx: 7.5,
        vy: 5,
        gravedad: 0.42,
        giro: 0.3,
        ancho: 56,
        alto: 56,
        vida: 90,
        golpes: 1,
        intervalo: 0,
        danio: 35,
        danioGuardia: 14,
        fuerza: 'especial',
        hitstun: 20,
        hitstop: 8,
        empuje: 2,
        ticksEfecto: 120,
      },
    },
    {
      id: 'flair_bartender',
      numero: 2,
      anim: 'especial2',
      herramienta: 'botella',
      armadura: { hasta: 14, contra: TODO },
      total: 46,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 22 },
      rafaga: { cantidad: 3, cada: 8, tiros: [{ vx: 5 }, { vx: 7.5 }, { vx: 10, empuje: 7 }] },
      proyectil: {
        tipo: 'botella',
        salidaX: 50,
        salidaY: 140,
        vx: 7.5,
        vy: 9,
        gravedad: 0.5,
        giro: 0.5,
        ancho: 46,
        alto: 46,
        vida: 100,
        golpes: 1,
        intervalo: 0,
        danio: 48,
        danioGuardia: 16,
        fuerza: 'medio',
        hitstun: 22,
        hitstop: 6,
        empuje: 3.5,
      },
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 200,
    rangoEspecial: [
      [130, 320],
      [200, 520],
    ],
    especialDeCombo: 0,
    preferencia: [0.9, 0.9],
    pericia: { facil: -0.004, dificil: -0.137 },
    periciaHumano: { normal: 0.147 },
    asistencia: { normal: 0.035 },
  },
}

// ─── Rodrigo «El Cuartetero»: control de espacio; el paso empuja, el grito arrastra a la pared ──

const RODRIGO: KitPersonaje = {
  caminar: 3.2,
  caminarAtras: 2.6,
  correr: 5.4,
  saltoVx: 3.8,
  dash: { adelante: 145, atras: 115, ticks: 17 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { multDanioGuardia: 0.8 },
  movimientos: {
    ...normales({ ritmo: 1.08, danio: 1.05, alcance: 4 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 31,
      danio: 82,
      guardia: 30,
      caja: [24, 136, 60, 180],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.6 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 11, total: 29, danio: 66, guardia: 24, caja: [24, 150, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'paso_de_cuarteto',
      numero: 1,
      anim: 'especial1',
      herramienta: 'baile',
      armadura: { hasta: 8, contra: TODO },
      total: 58,
      // Pega desde la mitad del baile hasta el final (era sólo al final, 38–44): el que estaba en el
      // camino quedaba atrás del empujón y el Paso acertaba 12–14 % (revisión del 30/oct, segunda tanda).
      ventanas: [ventana(22, 22, 115, 32, 'especial', [10, 125, 40, 200], 18, 9, { hitstun: 32 })],
      embestida: { desde: 6, ticks: 32, distancia: 230, recuperacionGolpe: 18, recuperacionBloqueo: 22, atraviesa: true },
    },
    {
      id: 'grito',
      numero: 2,
      anim: 'especial2',
      herramienta: 'onda',
      armadura: { hasta: 18, contra: TODO },
      total: 44,
      ventanas: [],
      lanzamiento: { desde: 18, ticks: 14 },
      proyectil: {
        tipo: 'onda',
        salidaX: 80,
        salidaY: 115,
        vx: 4.6,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 110,
        alto: 230,
        vida: 230,
        golpes: 2,
        intervalo: 0,
        danio: 40,
        danioGuardia: 18,
        fuerza: 'especial',
        hitstun: 20,
        hitstop: 8,
        empuje: 0,
        efecto: null,
        onda: { danioPared: 55, ticksAturdePared: 40 },
      },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 190,
    rangoEspecial: [
      [100, 270],
      [70, 900],
    ],
    especialDeCombo: 0,
    preferencia: [1.4, 1.4],
    pericia: { facil: -0.107, dificil: -0.2 },
    periciaHumano: { normal: 0.087 },
    asistencia: { normal: 0.083 },
  },
}

// ─── Joaquín «Cham-poo»: técnico; el gorro vuelve y la patada del dragón cruza la pantalla ────

const JOAQUIN: KitPersonaje = {
  caminar: 3.9,
  caminarAtras: 3.2,
  correr: 6.2,
  saltoVx: 4.3,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.1,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { cargaPorBloqueo: 0.15 },
  movimientos: {
    ...normales({ ritmo: 0.98, danio: 1, alcance: 4 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 126, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 2 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 9, total: 26, danio: 64, guardia: 22, caja: [24, 142, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'gorro_lanzador',
      numero: 1,
      anim: 'especial1',
      herramienta: 'gorro',
      armadura: { hasta: 14, contra: TODO },
      total: 36,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 8 },
      proyectil: {
        tipo: 'gorro',
        salidaX: 60,
        salidaY: 110,
        vx: 11.5,
        vy: 0,
        gravedad: 0,
        giro: 0.55,
        ancho: 72,
        alto: 52,
        vida: 220,
        golpes: 2,
        intervalo: 0,
        danio: 48,
        danioGuardia: 16,
        fuerza: 'medio',
        hitstun: 22,
        hitstop: 7,
        empuje: 3.5,
        bumeran: { freno: 0.17 },
      },
    },
    {
      id: 'patada_del_dragon',
      numero: 2,
      anim: 'especial2',
      herramienta: 'dragon',
      armadura: { hasta: 10, contra: TODO },
      total: 44,
      animLineal: true,
      ventanas: [
        ventana(12, 28, 42, 12, 'medio', [-5, 106, -10, 150], 3, 3, {
          hitstun: 22,
          efecto: null,
          golpes: 3,
          cada: 8,
          ultimo: { danio: 62, empuje: 8, hitstun: 28, fuerza: 'fuerte', efecto: 'derriba' },
        }),
      ],
      embestida: {
        desde: 10,
        ticks: 30,
        distancia: 500,
        recuperacionGolpe: 14,
        recuperacionBloqueo: 24,
        sigue: true,
        salto: { vy: 7.5, gravedad: 0.5 },
      },
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 175,
    rangoEspecial: [
      [190, 520],
      [120, 540],
    ],
    especialDeCombo: 2,
    preferencia: [1, 1],
    pericia: { facil: 0.003, dificil: -0.13 },
    periciaHumano: { normal: 0.059 },
    asistencia: { normal: -0.07 },
  },
}

// ─── Nahuel «El 10»: rápido a distancia; pelotazo recto y una chilena que también pega arriba ────

const NAHUEL: KitPersonaje = {
  // 4,2 / 3,5 (eran 4,4 / 3,6; sigue siendo de los que más caminan): con lo más rápido del elenco,
  // el que sólo aprieta GOLPE ganaba con Nahuel el doble que el que usa todo (revisión del 30/oct,
  // segunda tanda).
  caminar: 4.2,
  caminarAtras: 3.5,
  correr: 6.8,
  saltoVx: 5.2,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  movimientos: {
    ...normales({ ritmo: 0.95, danio: 0.95, alcance: 2 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 29,
      danio: 72,
      guardia: 26,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 2 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 9, total: 26, danio: 60, guardia: 22, caja: [24, 146, 40, 150], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'pelotazo',
      numero: 1,
      anim: 'especial1',
      herramienta: 'pelota',
      armadura: { hasta: 12, contra: TODO },
      total: 32,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 6 },
      proyectil: {
        tipo: 'pelota',
        salidaX: 60,
        salidaY: 62,
        vx: 13.5,
        vy: 0,
        gravedad: 0,
        giro: 0.5,
        ancho: 44,
        alto: 44,
        vida: 75,
        golpes: 1,
        intervalo: 0,
        danio: 60,
        danioGuardia: 20,
        fuerza: 'especial',
        hitstun: 24,
        hitstop: 8,
        empuje: 13,
      },
    },
    {
      id: 'chilena',
      numero: 2,
      anim: 'especial2',
      herramienta: 'pelota',
      armadura: { hasta: 8, contra: TODO },
      total: 50,
      ventanas: [ventana(20, 9, 140, 0, 'especial', [-10, 120, -80, 110], 6, 4, { hitstun: 30 })],
      embestida: { desde: 6, ticks: 24, distancia: 130, recuperacionGolpe: 10, recuperacionBloqueo: 14, salto: { vy: 15, gravedad: 0.9 } },
    },
  ],
  cpu: {
    herramienta: 0.25,
    distancia: 200,
    rangoEspecial: [
      [180, 820],
      [70, 230],
    ],
    especialDeCombo: 0,
    preferencia: [0.9, 0.9],
    pericia: { facil: 0.043, dificil: 0.03 },
    periciaHumano: { normal: 0.545 },
    asistencia: { normal: 0.076, dificil: -0.06 },
  },
}

// ─── Lucas «El Papá»: trampas; chorro de leche que empuja y un pañal que deja la nube ──────

const LUCAS: KitPersonaje = {
  caminar: 3.2,
  caminarAtras: 2.7,
  correr: 5.4,
  saltoVx: 3.8,
  dash: { adelante: 145, atras: 115, ticks: 17 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // 0,7 (era 0,5: con la mitad, Lucas le ganaba 3 de 4 a Simón y a Nico U., que viven de electrocutar y aturdir).
  pasiva: { multEstados: 0.7 },
  movimientos: {
    ...normales({ ritmo: 1.05, danio: 1, alcance: 0 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 30,
      danio: 78,
      guardia: 28,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.6 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 10, total: 28, danio: 62, guardia: 22, caja: [24, 138, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'mamadera_a_presion',
      numero: 1,
      anim: 'especial1',
      herramienta: 'leche',
      armadura: { hasta: 12, contra: TODO },
      total: 56,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 34 },
      proyectil: {
        tipo: 'leche',
        salidaX: 50,
        salidaY: 120,
        vx: 0,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 30,
        alto: 40,
        anchoFinal: 250,
        altoFinal: 58,
        vida: 40,
        golpes: 5,
        intervalo: 5,
        danio: 15,
        danioGuardia: 6,
        fuerza: 'leve',
        fuerzaUltimo: 'medio',
        hitstun: 14,
        hitstunUltimo: 20,
        hitstop: 3,
        empuje: 4,
        empujaCadaGolpe: true,
        chorro: { crece: 14 },
      },
    },
    {
      id: 'panalazo',
      numero: 2,
      anim: 'especial2',
      herramienta: 'panal',
      armadura: { hasta: 14, contra: TODO },
      total: 40,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 6 },
      proyectil: {
        tipo: 'panal',
        salidaX: 50,
        salidaY: 130,
        vx: 7,
        vy: 7.5,
        gravedad: 0.42,
        giro: 0.35,
        ancho: 52,
        alto: 52,
        vida: 120,
        golpes: 1,
        intervalo: 0,
        danio: 35,
        danioGuardia: 12,
        fuerza: 'medio',
        hitstun: 18,
        hitstop: 6,
        empuje: 2,
        nube: { vida: 180, cada: 15, danio: 7, lento: 30, ancho: 170, alto: 70 },
      },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 185,
    rangoEspecial: [
      [80, 290],
      [170, 380],
    ],
    especialDeCombo: 0,
    preferencia: [0.55, 1],
    pericia: { facil: 0.105, dificil: -0.06 },
    periciaHumano: { normal: 0.098 },
    asistencia: { normal: 0.149 },
  },
}

// ─── Stefano «El Matero»: zoner; lluvia de mates y el termo que quema ───────

const STEFANO: KitPersonaje = {
  caminar: 3.5,
  caminarAtras: 3.0,
  correr: 5.8,
  saltoVx: 4.0,
  dash: { adelante: 150, atras: 125, ticks: 16 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { cargaPorEspecial: 1 },
  movimientos: {
    ...normales({ ritmo: 1.02, danio: 1, alcance: 0 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'matezo',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    matezo: pesado('matezo', 'herramienta2', 'mate', { desde: 11, total: 28, danio: 66, guardia: 24, caja: [28, 150, 80, 180], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'lluvia_de_mates',
      numero: 1,
      anim: 'especial1',
      herramienta: 'mate',
      armadura: { hasta: 16, contra: TODO },
      total: 52,
      ventanas: [],
      lanzamiento: { desde: 16, ticks: 24 },
      rafaga: { cantidad: 4, cada: 7, tiros: [{ vx: 4.5 }, { vx: 6.5 }, { vx: 8.5 }, { vx: 10.5 }] },
      proyectil: {
        tipo: 'mate',
        salidaX: 55,
        salidaY: 140,
        vx: 6.5,
        vy: 10,
        gravedad: 0.5,
        giro: 0.4,
        ancho: 42,
        alto: 42,
        vida: 110,
        golpes: 1,
        intervalo: 0,
        danio: 32,
        danioGuardia: 18,
        fuerza: 'medio',
        hitstun: 22,
        hitstop: 5,
        empuje: 3,
      },
    },
    {
      id: 'termo_de_agua_caliente',
      numero: 2,
      anim: 'especial2',
      herramienta: 'agua',
      armadura: { hasta: 12, contra: TODO },
      total: 46,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 26 },
      proyectil: {
        tipo: 'agua',
        salidaX: 55,
        salidaY: 125,
        vx: 0,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 30,
        alto: 36,
        anchoFinal: 290,
        altoFinal: 60,
        vida: 30,
        golpes: 1,
        intervalo: 0,
        danio: 38,
        danioGuardia: 26,
        fuerza: 'especial',
        hitstun: 20,
        hitstop: 8,
        empuje: 5,
        chorro: { crece: 12 },
        ticksEfecto: 180,
        quema: { cada: 20, danio: 8 },
      },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 220,
    rangoEspecial: [
      [200, 600],
      [80, 330],
    ],
    especialDeCombo: 2,
    preferencia: [1.6, 1.6],
    pericia: { facil: -0.111, dificil: 0.162 },
    periciaHumano: { normal: 0.329 },
    asistencia: { normal: 0.045 },
  },
}

// ─── Brian «El Tanque»: grappler; agarre imbloqueable y un sismo que hay que saltar ──────

const BRIAN: KitPersonaje = {
  // 3,3 / 2,4 (eran 3 / 2,2): el más lento del elenco quedaba a merced de cualquiera que lo
  // esperara o se le fuera (revisión del 30/oct, segunda tanda).
  caminar: 3.3,
  caminarAtras: 2.4,
  correr: 4.8,
  saltoVx: 3.3,
  dash: { adelante: 140, atras: 110, ticks: 19 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { armaduraAtaques: ['leve'] },
  movimientos: {
    ...normales({ ritmo: 1.03, danio: 1.08, alcance: -4 }),
    // Neutra bloqueada (era −2: la CPU difícil, que castiga 9 de 10, le ganaba el juego neutro).
    remate: pesado('remate', 'herramienta1', 'pesado', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()).
      desde: 12,
      total: 30,
      danio: 92,
      guardia: 34,
      caja: [24, 120, 60, 182],
      empuje: 10,
      siguiente: 'golpe_pesado',
      avance: { desde: 4, hasta: 13, vel: 1.6 },
    }),
    golpe_pesado: pesado('golpe_pesado', 'herramienta2', 'pesado', { desde: 13, total: 31, danio: 80, guardia: 30, caja: [24, 126, 70, 182], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      id: 'agarre_y_apreton',
      numero: 1,
      anim: 'especial1',
      herramienta: 'agarre',
      // Se estira para agarrar (24 px en los primeros 8 ticks) y, si falla, queda regalado 46 ticks
      // (eran 52 sin estirarse): apretado sin apuntar fallaba casi siempre y entre dos personas
      // Brian ganaba 3 % (revisión del 30/oct, segunda tanda).
      avance: { desde: 0, hasta: 8, vel: 3 },
      total: 46,
      ventanas: [ventana(8, 6, 0, 0, 'especial', [12, 92, 20, 190], 0, 0)],
      agarre: { sostener: 64, apretones: { cada: 16, danio: 22 }, tiron: { danio: 105, empuje: 7 }, adelante: 66, alto: 46, recuperacion: 20 },
    },
    {
      id: 'punio_sismico',
      numero: 2,
      anim: 'especial2',
      herramienta: 'sismo',
      armadura: { hasta: 20, contra: TODO },
      total: 48,
      ventanas: [],
      lanzamiento: { desde: 20, ticks: 10 },
      proyectil: {
        tipo: 'sismo',
        salidaX: 70,
        salidaY: 0,
        vx: 7.5,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 96,
        alto: 64,
        vida: 120,
        golpes: 1,
        intervalo: 0,
        danio: 115,
        danioGuardia: 0,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 11,
        empuje: 5,
        rastrero: true,
        imbloqueable: true,
      },
    },
  ],
  cpu: {
    herramienta: 0.4,
    distancia: 150,
    rangoEspecial: [
      [0, 118],
      [150, 700],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    pericia: { facil: 0.15, dificil: 0.31 },
    periciaHumano: { normal: 0.875 },
    asistencia: { normal: 0.138 },
  },
}

// ─── Balance ──────────────────────────────────────────────────────────────────

/**
 * Multiplica los daños de un kit: `fn` los golpes normales (puño, patada, combo, herramientas,
 * aérea), `fe` los especiales (golpes, proyectiles, nube, quemadura, agarre, onda), `fg` el daño a
 * la GUARDIA de los normales y `fge` el de los especiales (si falta, `fg`). Son las perillas gruesas
 * del balance: los números de arriba son los de diseño y los factores de cada barbero salen del
 * simulador (scripts/juego/simulador/afinar.mts y balance.mts) en DANIO_KIT. La de guardia existe
 * porque la CPU difícil se cubre mucho y la fácil casi nunca: un barbero que gana en fácil y pierde
 * en difícil necesita romper más guardias. Va separada en normales y especiales desde la revisión
 * del 30/oct: con 1,6–1,7 en los normales, dos golpes de MÁQUINA bloqueados rompían la guardia y
 * machacar ese botón le ganaba 3 de 4 a la CPU normal; los especiales cuestan carga y pueden más.
 */
export function conDanio(kit: KitPersonaje, fn: number, fe: number, fg = 1, fge = fg): KitPersonaje {
  if (fn === 1 && fe === 1 && fg === 1 && fge === 1) return kit
  const escalar = (f: number) => (n: number) => Math.max(1, Math.round(n * f))
  const guardia = (f: number) => (n: number) => (n > 0 ? Math.max(1, Math.round(n * f)) : 0)
  const ventanas = (vs: VentanaGolpe[], f: number, fGuardia: number) => {
    const r = escalar(f)
    const g = guardia(fGuardia)
    return vs.map((w) => ({
      ...w,
      danio: w.danio > 0 ? r(w.danio) : 0,
      danioGuardia: g(w.danioGuardia),
      ultimo: w.ultimo ? { ...w.ultimo, danio: r(w.ultimo.danio) } : undefined,
    }))
  }
  const mov = (m: DefMovimiento): DefMovimiento => ({ ...m, ventanas: ventanas(m.ventanas, fn, fg) })
  const r = escalar(fe)
  const ge = guardia(fge)
  const esp = (e: DefEspecial): DefEspecial => ({
    ...e,
    ventanas: ventanas(e.ventanas, fe, fge),
    proyectil: e.proyectil
      ? {
          ...e.proyectil,
          danio: r(e.proyectil.danio),
          danioGuardia: ge(e.proyectil.danioGuardia),
          quema: e.proyectil.quema ? { ...e.proyectil.quema, danio: r(e.proyectil.quema.danio) } : undefined,
          nube: e.proyectil.nube ? { ...e.proyectil.nube, danio: r(e.proyectil.nube.danio) } : undefined,
          onda: e.proyectil.onda ? { ...e.proyectil.onda, danioPared: r(e.proyectil.onda.danioPared) } : undefined,
        }
      : undefined,
    agarre: e.agarre
      ? {
          ...e.agarre,
          apretones: { ...e.agarre.apretones, danio: r(e.agarre.apretones.danio) },
          tiron: { ...e.agarre.tiron, danio: r(e.agarre.tiron.danio) },
        }
      : undefined,
  })
  const movimientos: Record<string, DefMovimiento> = {}
  for (const [id, m] of Object.entries(kit.movimientos)) movimientos[id] = mov(m)
  return { ...kit, movimientos, especiales: [esp(kit.especiales[0]), esp(kit.especiales[1])] }
}

/**
 * Factores [normales, especiales, guardia de los normales, guardia de los especiales] de cada barbero
 * (balance con el simulador, 30/oct/2026; la guardia de los normales va entre 0,8 y 1,3).
 *
 * Revisión del 30/oct, segunda tanda: el nivel lo pone normal (afinar.mts --peso=0,1,0 --dif=normal;
 * fácil y difícil los empareja la `pericia`) y la proporción especiales/normales es una decisión:
 * apretados sin apuntar, los especiales decidían las peleas entre dos personas (el «novato» de
 * balance.mts), así que bajó en Simón (0,9), Chipi (0,85), Nico U. (0,9), Luciano (1,3), Gabriel
 * (1,2) y Joaquín (1,25), y subió en Fabri (1,15), Nahuel (1,45) y Brian (1,1).
 */
export const DANIO_KIT: Readonly<Record<IdPersonaje, readonly [number, number, number, number]>> = {
  simon: [0.837, 0.753, 1.114, 1.114],
  chipi: [0.88, 0.749, 1.196, 1.196],
  nico_u: [0.952, 0.857, 0.8, 0.8],
  fabri: [0.787, 0.903, 1.3, 2],
  luciano: [0.985, 1.281, 1.3, 2],
  gabriel: [1.137, 1.363, 1.032, 1.587],
  guillermo: [1.146, 1.146, 1.3, 1.416],
  rodrigo: [1.041, 1.041, 0.8, 0.8],
  joaquin: [0.936, 1.17, 0.8, 0.8],
  nahuel: [0.827, 1.197, 0.818, 0.818],
  lucas: [0.918, 0.918, 1.062, 1.062],
  stefano: [1.04, 1.04, 0.864, 1.328],
  brian: [0.698, 0.768, 0.838, 1.29],
}

/** Los kits con los números de diseño, antes del factor de daño (los usa el simulador para afinar). */
export const KITS_DISENIO: Readonly<Record<IdPersonaje, KitPersonaje>> = {
  simon: SIMON,
  chipi: CHIPI,
  nico_u: NICO_U,
  fabri: FABRI,
  luciano: LUCIANO,
  gabriel: GABRIEL,
  guillermo: GUILLERMO,
  rodrigo: RODRIGO,
  joaquin: JOAQUIN,
  nahuel: NAHUEL,
  lucas: LUCAS,
  stefano: STEFANO,
  brian: BRIAN,
}

export const MOVIMIENTOS = Object.fromEntries(
  (Object.keys(KITS_DISENIO) as IdPersonaje[]).map((id) => {
    const [fn, fe, fg, fge] = DANIO_KIT[id]
    return [id, conDanio(KITS_DISENIO[id], fn, fe, fg, fge)]
  }),
) as Record<IdPersonaje, KitPersonaje>
