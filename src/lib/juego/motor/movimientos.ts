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
 *
 * Piezas de la quinta tanda (14/nov, los 8 de Paraná, Pueyrredón y los dueños):
 *  - Contra (DefEspecial.contra, el All In de Chino): mientras arma el dominio, el primer golpe o tiro
 *    que le iba a pegar se anula (combate.ts, arriba de todo en aplicarImpacto; el agarre le gana) y
 *    la acción salta a la embestida con el `bono`. Si nadie le pega, la embestida sale igual, floja.
 *  - Hipnotiza (efecto 'hipnotiza', los Lentes de Fran): un estado de control que lo hace caminar hacia
 *    el que lo tiró (HIPNOSIS en constantes.ts); lo corta el primer golpe limpio.
 *  - Punta (VentanaGolpe.punta, el Corte de Precisión de Fran): con el rival a `desde` px o más de centro
 *    a centro, el contacto es crítico seguro (evento 'precision').
 *  - Cuerpo (DefMovimiento.cuerpo, el Gigante de Lautaro): mientras dura, la caja de daño es más ancha
 *    y más alta (el sprite crece en el atlas; la caja de empuje no cambia).
 *  - Agarre en el aire (DefAgarre.aire) y revoleo (`tiron.vy`): el Lanzamiento Aéreo de Lautaro.
 *  - Apunta (DefProyectil.apunta, las herramientas de Leo): al salir, cada tiro sube o baja hacia
 *    donde está el rival en ese tick (sólo + − × ÷, min y max); después no lo sigue.
 *  - Ciega (efecto 'ciega', el Spray de Leo): no pega, no tira especiales ni esquiva, pero tiene el
 *    control; lo corta el primer golpe limpio. No es encierro.
 *  - Roba (DefAgarre.roba, el Agarre y Ejecución de Nacho): el tirón le saca carga a la víctima.
 *  - Distancia por tiro (TiroRafaga.distancia): una ráfaga de áreas diferidas, cada una más lejos (el
 *    Terremoto de Código de Nacho).
 *  - Hasta el rival (DefEmbestida.hastaRival, Desaparecer de Nehuen): la embestida frena sola a esa
 *    distancia delante del rival y no lo atraviesa.
 *  - Devuelve (DefEspecial.devuelve, el Smash de Pádel de Nehuen): mientras la paleta está en el aire,
 *    lo que el rival le tira y toca su caja cambia de dueño y vuelve más rápido (proyectiles.ts).
 *  - Trampa (DefProyectil.trampa, las Espinas de Nico M.): lo que no pega se clava en el piso
 *    (ProyectilEstado.plantado) y tira al que lo pisa; una trampa por tirada.
 *  - Aceleración (DefProyectil.aceleracion, el monopatín de Tony): sale lento y acelera hasta un tope.
 *  - Si pega (DefEspecial.siPega, el Despido Final de Tony): el golpe que entra limpio estira la acción
 *    y aturde; recién entonces existe lo que sigue (la patada voladora).
 *  - Pasivas nuevas: cargaPorEspecialRival (Chino), criticoTrasBloqueo (Fran), multDerribo (Leo),
 *    velocidadConCarga (Nacho), multAereo (Nehuen), pincha (Nico M.) y presencia (Tony).
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
  /**
   * Punta (el Corte de Precisión de Fran): si al pegar el centro de la víctima está a `desde` px o más
   * del suyo, el contacto es crítico seguro y sale el evento 'precision'; más cerca pega el base.
   */
  punta?: { desde: number }
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
  /**
   * Cuerpo propio (el Gigante de Lautaro): entre `desde` y `hasta` la caja de DAÑO mide `ancho` y el alto
   * parado × `altoMult` (el atlas ya lo dibuja así de grande). Ser más grande es parte del costo: le
   * entran los tiros altos. La caja de empuje no cambia.
   */
  cuerpo?: { desde: number; hasta: number; ancho: number; altoMult: number }
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
  /**
   * Frena sola cuando le quedan `hastaRival` px hasta el rival (medidos hacia donde mira) y no corre
   * más (Accion.llego): Desaparecer de Nehuen cruza intocable y reaparece DELANTE del rival, no lo
   * atraviesa. Si el rival ya estaba más cerca (o detrás), no se mueve.
   */
  hastaRival?: number
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
  /**
   * Apunta al salir (las herramientas de Leo): la `vy` del tiro la pone el motor para ir al centro del
   * rival en ese tick, acotada a ±0,8·|vx|. No lo persigue después.
   */
  apunta?: boolean
  /**
   * Trampa (las Espinas de Nico M.): el tiro con gravedad que toca el piso sin haber pegado se clava
   * (ProyectilEstado.plantado: quieto, con esta caja) y queda `vida` ticks; si el rival lo pisa (en el
   * piso), le pega con `danio` y `efecto` (con `imbloqueable`, no se cubre) y se deshacen todas las
   * clavadas de esa tirada (una trampa por tirada). En el aire no hace nada.
   */
  trampa?: { vida: number; ancho: number; alto: number; danio: number; efecto: EfectoEspecial | null; imbloqueable: boolean }
  /** Acelera en vuelo (el monopatín de Tony): cada tick, |vx| + `por`, como mucho `max`. */
  aceleracion?: { por: number; max: number }
}

/** Lo que cambia un tiro de una ráfaga respecto del proyectil base. */
export interface TiroRafaga {
  vx?: number
  vy?: number
  salidaX?: number
  salidaY?: number
  efecto?: EfectoEspecial | null
  empuje?: number
  /** Área diferida: a cuánto delante aparece ESTE tiro (si falta, `diferido.distancia`). */
  distancia?: number
}

/** Agarre: lo levanta, lo aprieta y lo tira al piso. */
export interface DefAgarre {
  /** Ticks que lo tiene levantado. */
  sostener: number
  /** Cada `cada` ticks lo aprieta con `danio` (sin bloqueo). */
  apretones: { cada: number; danio: number }
  /** El tirón al piso del final; `vy` es con cuánto lo revolea para arriba (si falta, 5). */
  tiron: { danio: number; empuje: number; vy?: number }
  /** Dónde lo sostiene: `adelante` px delante de su centro y `alto` px sobre el piso. */
  adelante: number
  alto: number
  /** Ticks que tarda en recuperarse después de tirarlo. */
  recuperacion: number
  /** Agarra también al que está en el aire (el Lanzamiento Aéreo de Lautaro). Sin esto, sólo en el piso. */
  aire?: boolean
  /**
   * En el tirón le saca a la víctima hasta `carga` de carga y el que agarra se queda con hasta `gana`
   * (el Agarre y Ejecución de Nacho; evento 'carga_robada').
   */
  roba?: { carga: number; gana: number }
}

export interface DefEspecial extends DefMovimiento {
  numero: 1 | 2
  embestida?: DefEmbestida
  /** Para los que tiran algo: cuándo sale (y cuánto dura la pose de lanzamiento en la animación). */
  lanzamiento?: { desde: number; ticks: number }
  proyectil?: DefProyectil
  rafaga?: { cantidad: number; cada: number; tiros?: readonly TiroRafaga[] }
  agarre?: DefAgarre
  /**
   * `soloBajo`: sólo sale con la vida por debajo de esa fracción; con más, apretarlo no hace nada
   * ni gasta carga (ver intentarEspecial en acciones.ts).
   */
  cura?: { desde: number; ticks: number; cada: number; fraccion: number; soloBajo?: number }
  /**
   * Contra (el All In de Chino): entre `desde` y `hasta` el primer contacto que le iba a pegar (golpe,
   * herramienta, especial cuerpo a cuerpo o proyectil; no el agarre, que le gana, ni el daño de a poco)
   * se anula, sale el evento 'contra' y la acción salta a `salto` (la embestida) con el `bono`: más
   * daño, su efecto, su aturdimiento e intocable `intocable` ticks desde que saltó. El que pegó no
   * cuenta el contacto (no encadena ni cancela en especial).
   */
  contra?: { desde: number; hasta: number; salto: number; bono: { danio: number; efecto: EfectoEspecial | null; hitstun: number; intocable: number } }
  /**
   * Devuelve (el Smash de Pádel de Nehuen): entre `desde` y `hasta`, cada tiro del rival que vuela y toca
   * `caja` (relativa a él, como una ventana) cambia de dueño y vuelve con vx × `mult` (como mucho `max`
   * px por tick), con su daño y su efecto de siempre. No se devuelven los chorros, la onda, las áreas
   * diferidas, la nube, lo que va por el piso ni el bumerán.
   */
  devuelve?: { desde: number; hasta: number; caja: Caja; mult: number; max: number }
  /**
   * Si pega limpio (el Despido Final de Tony): cuando la ventana número `ventana` entra limpia (no
   * bloqueada, ni contra una armadura), la acción pasa a durar `total` y la víctima queda `aturde`
   * ticks aturdida (con el escalado del combo y el piso del que ya está inmune al control; evento
   * 'despido'). Lo que viene después en la acción (la patada) sólo existe si el total se estiró: si el
   * papel se cubre o sale al aire, la acción termina antes y queda regalado.
   */
  siPega?: { ventana: number; total: number; aturde: number }
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
   * Pericia de la CPU con este barbero en cada dificultad (−2..2; si falta, 0): corre sus
   * parámetros (`paramsConPericia` en cpu.ts) hacia los de la dificultad de arriba (+) o hacia los
   * de abajo (−); pasado 1, sigue desde la dificultad vecina. Empareja lo que el daño no puede: la CPU
   * fácil casi no se cubre ni castiga y la difícil castiga casi todo, y con cada una rinden kits
   * distintos. Sólo cambia cómo juega la CPU con ese barbero CONTRA OTRA CPU (meta C), nunca el kit:
   * contra una persona manda `periciaHumano` y el online no tiene CPU. Desde la tercera tanda (31/oct)
   * también hay pericia en normal: el kit se afina entre dos personas (meta E, la pelea online) y lo
   * que eso le hace a la CPU contra CPU se empareja acá. Es una perilla sensible: un tick de reacción
   * mueve 10 a 20 puntos, y la reacción con decimales se sortea por round (en normal, 9, cambia un
   * tick cada ≈ 0,06 para abajo y cada ≈ 0,33 para arriba; en difícil, 6, cada ≈ 0,33). Afinada con
   * balance.mts (--ajuste con «pericia»): sin ella, en fácil iban de 38 a 62 % y en difícil de 36 a
   * 57 % (30/oct); con el kit de la tercera tanda, la CPU de Fabri ganaba 94 % y la de Chipi 16 %.
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
  /** Carga que le da cada especial que tira el RIVAL (La casa siempre gana, Chino). */
  cargaPorEspecialRival?: number
  /**
   * Después de cubrir un golpe, el próximo golpe normal que arranque dentro del blockstun + estos ticks
   * es crítico seguro (Pulso fino, Fran; InternoLuchador.critListo).
   */
  criticoTrasBloqueo?: number
  /** Multiplica los ticks que queda tirado en el piso después de un derribo (Pibe de goma, Leo). */
  multDerribo?: number
  /** Con la carga en `desde` o más, camina y corre `mult` veces más rápido (Overclock, Nacho). El salto no. */
  velocidadConCarga?: { desde: number; mult: number }
  /** Multiplica el daño de sus golpes aéreos (Volea, Nehuen); no el aturdimiento ni el empuje. */
  multAereo?: number
  /**
   * El que le pega de cerca se pincha (Pelo de punta, Nico M.): con cada golpe cuerpo a cuerpo que
   * recibe, cubre o aguanta (y con un agarre), el que pegó pierde `danio` de vida, sin aturdimiento ni
   * bloqueo (como la quemadura; evento 'pinchazo'). No dispara la contra del All In.
   */
  pincha?: { danio: number }
  /** Cerca de él (a `distancia` px o menos), el RIVAL camina y corre `mult` veces (Presencia de jefe, Tony). */
  presencia?: { distancia: number; mult: number }
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
          danio: 38,
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
          danio: 52,
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
          danio: 33,
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
          danio: 52,
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
          danio: 57,
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
    pericia: { facil: 0.223, normal: 0.031, dificil: 0.416 },
    periciaHumano: { normal: 0.088 },
    asistencia: { normal: 0.01, dificil: -0.1 },
  },
}

// ─── Chipi «El Fijador»: pesado, aguanta, pega fuerte ───────────────────────

const CHIPI: KitPersonaje = {
  // 3,2 (era 2,85) y los golpes al ritmo de los demás (el puño era 6/21): con el GOLPE y la marcha
  // más lentos del elenco, el que sólo aprieta GOLPE (el «humano simple» de balance.mts) le ganaba
  // 0,4 % a la CPU normal con Chipi. Lo pesado sigue en la MÁQUINA con armadura, la vida y la pasiva
  // (revisión del 30/oct, segunda tanda).
  // 3,5 (era 3,2; tercera tanda): entre dos personas que pelean a distancia de golpe (sin la demora
  // del online), Chipi caminaba tan lento que siempre llegaba segundo y ganaba 1 de 4.
  caminar: 3.5,
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
          danio: 41,
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
          danio: 57,
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
          danio: 36,
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
          danio: 57,
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
          danio: 62,
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
        // Congela 1 s (eran 100 ticks, el de todos): la persona que la tira en su distancia le ganaba
        // 7 a 8 de cada 10 a otra persona (tercera tanda, 31/oct).
        ticksEfecto: 60,
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
    pericia: { facil: 0.205, normal: 0.625, dificil: 1.092 },
    periciaHumano: { normal: 0.325 },
    asistencia: { normal: 0.068, dificil: -0.16 },
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
    ...normales({ ritmo: 1, danio: 1.03, alcance: 2 }),
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
    pericia: { facil: 0.137, normal: 0.104, dificil: 0.389 },
    periciaHumano: { normal: 0.126 },
    asistencia: { normal: -0.022, dificil: -0.06 },
  },
}

// ─── Fabri «El Facha»: aguante; se cura y remata con el guante ─────────────

const FABRI: KitPersonaje = {
  // 3,7 (era 3,4; tercera tanda): ver el comentario de Chipi.
  caminar: 3.7,
  caminarAtras: 2.8,
  correr: 5.8,
  saltoVx: 4.0,
  dash: { adelante: 150, atras: 120, ticks: 16 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { multCarga: 1.15 },
  movimientos: {
    ...normales({ ritmo: 1.05, danio: 1.065, alcance: 0 }),
    celular: pesado('celular', 'herramienta1', 'celular', {
      // Arranca a los 12, como la MÁQUINA de los demás (ver pesado()). Llega a 132 (eran 148, la más
      // larga del elenco por 16 px): el que machacaba sólo la MÁQUINA con Fabri le ganaba 1 de 2 a la
      // CPU normal y 1 de 3 a la difícil (tercera tanda, 31/oct).
      desde: 12,
      total: 30,
      danio: 70,
      guardia: 28,
      caja: [30, 132, 70, 180],
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
      // Tercera tanda (31/oct): más rápida (el mismo 16,5 % en 0,6 s y 50 ticks en total; eran 1 s y
      // 82) y sólo con la vida bajo el 90 % (`soloBajo`). Apretada apenas se encendía, como hace el
      // que recién empieza, no curaba nada y dejaba a Fabri regalado: entre dos personas ganaba 7–15 %.
      armadura: { hasta: 42, contra: ['leve', 'medio'] },
      total: 50,
      ventanas: [],
      cura: { desde: 6, ticks: 36, cada: 6, fraccion: 0.165, soloBajo: 0.9 },
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
    pericia: { facil: -0.356, normal: -0.264, dificil: -1.089 },
    // Difícil contra una persona: la pericia de difícil (−1,1) es la que empareja a la CPU de Fabri con
    // las otras CPU; contra una persona dejaba ganar 55 % (tercera tanda, 31/oct). 0,1 → 0,02 en difícil
    // (balance fino de la quinta tanda): contra el simple casi no se curaba (la Curación, 18,6 % de sus
    // especiales; meta D ≥ 20).
    periciaHumano: { normal: 0.031, dificil: 0.02 },
    asistencia: { normal: -0.018 },
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
    ...normales({ ritmo: 0.98, danio: 0.855, alcance: 0 }),
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
    pericia: { facil: 0.163, normal: 0.144, dificil: 0.506 },
    periciaHumano: { normal: 0.143 },
    asistencia: { normal: -0.049 },
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
    ...normales({ ritmo: 0.96, danio: 0.828, alcance: 0 }),
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
        // Invulnerable sólo el arranque (con 16 ticks le ganaba a todo lo que el rival tirara). 10 (era 12;
        // tercera tanda): la persona que lo tiraba en su distancia le ganaba 8 de 10 a otra persona.
        invulnerableHasta: 10,
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
        // Pinta a 180 px (eran 250; tercera tanda, 31/oct): el estallido de 240 px tapa desde el cuerpo a
        // cuerpo hasta los 300. A 250, con el rival pegado (como pelean dos personas con la demora del
        // online), el graffiti estallaba detrás de él y Gabriel quedaba regalado.
        diferido: { distancia: 180, espera: TIEMPOS_PROYECTIL.graffitiEstalla, activo: 8, ancho: 240, alto: 230 },
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
    pericia: { facil: 0.046, normal: -0.058, dificil: 0.061 },
    periciaHumano: { normal: 0.068 },
    // −0,09 (tercera tanda): con el graffiti que ahora pega de cerca, el que aprieta los especiales
    // apenas se encienden le ganaba 64 % a la CPU normal con Gabriel (tope 65); quedaba en 59. −0,056
    // (balance fino de la quinta tanda): contra las 17 CPU el novato con Gabriel ganaba 23 % (meta 25); con
    // −0,056, 23,9. −0,03.
    asistencia: { normal: -0.03, dificil: -0.22 },
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
    ...normales({ ritmo: 1, danio: 0.939, alcance: 0 }),
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
      // 30 (era 38), 32 de daño (era 35) y mareado 1 s (eran 2; tercera tanda, 31/oct): pegado, con la
      // demora del online, el trago dejaba a Guillermo regalado (ganaba 1 de 5 a otra persona), y a
      // media distancia contra el que no se cubre lo decidía todo (8 de 10). El daño pasó al Flair.
      total: 30,
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
        danio: 32,
        danioGuardia: 14,
        fuerza: 'especial',
        hitstun: 20,
        hitstop: 8,
        empuje: 2,
        ticksEfecto: 60,
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
      // La primera botella sale baja y corta (vx 4, vy 4; tercera tanda): con las tres en arco largo,
      // pegado al rival el Flair pasaba por arriba.
      rafaga: { cantidad: 3, cada: 8, tiros: [{ vx: 4, vy: 4 }, { vx: 7.5 }, { vx: 10, empuje: 7 }] },
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
        danio: 62,
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
      [60, 520],
    ],
    especialDeCombo: 0,
    preferencia: [0.9, 0.9],
    pericia: { facil: -0.035, normal: -0.023, dificil: 0.195 },
    periciaHumano: { normal: 0.201 },
    asistencia: { normal: 0.1 },
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
    ...normales({ ritmo: 1.08, danio: 1.247, alcance: 4 }),
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
    pericia: { facil: -0.078, normal: -0.081, dificil: -0.293 },
    periciaHumano: { normal: 0.044 },
    // Sigue en 0,122 (balance fino de la quinta tanda): con 0,07 el bot que repite el Grito (e2 de
    // adversario.mts) bajaba de 68,8 %, pero el simple con Rodrigo caía de 33,6 a 19,9. Lo del Grito es
    // de las CPU que no lo esquivan (ver el informe de la quinta tanda).
    asistencia: { normal: 0.122 },
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
    ...normales({ ritmo: 0.98, danio: 0.775, alcance: 4 }),
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
    pericia: { facil: 0.11, normal: 0.07, dificil: 0.185 },
    periciaHumano: { normal: 0.086 },
    asistencia: { normal: 0.044 },
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
    ...normales({ ritmo: 0.95, danio: 0.809, alcance: 2 }),
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
    pericia: { facil: -0.153, normal: -0.198, dificil: -0.721 },
    periciaHumano: { normal: 0.238, dificil: 0.05 },
    asistencia: { normal: -0.059, dificil: -0.06 },
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
    // Ritmo 1 (era 1,05; tercera tanda, 31/oct): pegado, con la demora del online, Lucas perdía casi
    // todos los cambios de golpes (el que machaca GOLPE con él ganaba 1 de 4 a otra persona).
    ...normales({ ritmo: 1, danio: 1.129, alcance: 0 }),
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
      // 46 (era 56), el chorro 32 ticks (eran 40) y sólo el último golpecito empuja (tercera tanda,
      // 31/oct): empujando con cada uno, el rival quedaba fuera del alcance de lo que seguía y pegado
      // (con la demora del online) Lucas ganaba 1 de 4 a otra persona.
      total: 46,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 26 },
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
        vida: 32,
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
    pericia: { facil: -0.119, normal: -0.169, dificil: -0.587 },
    periciaHumano: { normal: 0.066, dificil: 0 },
    asistencia: { normal: 0.123 },
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
        // 22 (era 32; tercera tanda): el daño pasó al Termo. Tirada sin apuntar, la Lluvia le ganaba a la
        // persona que no se cubre y la que apunta nunca la usaba (está pegada al rival).
        danio: 22,
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
      // 32 (era 46), el chorro 18 ticks (eran 30) y 52 de daño (eran 38; tercera tanda, 31/oct): pega
      // una vez y el resto del chorro dejaba a Stefano quieto delante del rival; de cerca, la persona
      // que lo tiraba en su distancia ganaba 1 de 10.
      total: 32,
      ventanas: [],
      lanzamiento: { desde: 12, ticks: 16 },
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
        vida: 18,
        golpes: 1,
        intervalo: 0,
        danio: 52,
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
    // [1,8, 1,4] (era [1,6, 1,6]; tercera tanda): con el Termo más seguro, la Lluvia bajaba de
    // 20 % de los especiales de la CPU (meta D).
    preferencia: [1.8, 1.4],
    pericia: { facil: -0.211, normal: -0.133, dificil: -0.216 },
    periciaHumano: { normal: 0.09 },
    asistencia: { normal: 0.074 },
  },
}

// ─── Brian «El Tanque»: grappler; agarre imbloqueable y un sismo que hay que saltar ──────

const BRIAN: KitPersonaje = {
  // 3,3 / 2,4 (eran 3 / 2,2): el más lento del elenco quedaba a merced de cualquiera que lo
  // esperara o se le fuera (revisión del 30/oct, segunda tanda).
  // 3,8 (era 3,3; tercera tanda): entre dos personas que pelean a distancia de golpe, el más lento
  // siempre llegaba segundo (Brian ganaba 1 de 5 al que machaca GOLPE sin cubrirse).
  caminar: 3.8,
  caminarAtras: 2.4,
  correr: 4.8,
  saltoVx: 3.3,
  dash: { adelante: 140, atras: 110, ticks: 19 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  pasiva: { armaduraAtaques: ['leve'] },
  movimientos: {
    // Alcance 0 (era −4; tercera tanda, 31/oct): el puño llegaba a 136 px y dos personas que se paran
    // a 140 a machacar lo dejaban pegando al aire (Brian ganaba 8 %).
    ...normales({ ritmo: 1.03, danio: 1.275, alcance: 0 }),
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
      // Se estira para agarrar (36 px en los primeros 8 ticks) y, si falla, queda regalado 24 ticks:
      // apretado sin apuntar fallaba casi siempre y entre dos personas Brian ganaba 3 % (revisión del
      // 30/oct, segunda tanda: 24 px y 46 ticks; eran 52 sin estirarse); con 46 todavía ganaba 8–14 %
      // (tercera tanda, 31/oct).
      avance: { desde: 0, hasta: 8, vel: 4.5 },
      total: 24,
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
    pericia: { facil: 0.134, normal: -0.048, dificil: 0.215 },
    periciaHumano: { normal: 0.784 },
    asistencia: { normal: -0.051 },
  },
}

// ─── Quinta tanda (14/nov): Chino, Fran, Lautaro, Leo y los dueños ────────────
//
// Los números son los del diseño de la tanda (T5/salidas/diseno/diseno.json), sacados comparando con
// los 13 y con cuentas de ticks; los factores de DANIO_KIT, la pericia y la asistencia los afina el
// balance. Los dueños (Nacho, Nehuen) sólo los eligen los dueños: se miden entre ellos (meta E) y
// contra las CPU de los barberos, no en las tablas de los barberos.

/**
 * Los normales con otro empuje en el puño, la patada y el último golpe del combo (quinta tanda, segunda
 * parte: Lautaro). El empuje no se dibuja: corre al que recibe.
 */
function conEmpuje(m: Record<string, DefMovimiento>, e: { puno: number; patada: number; combo: number }): Record<string, DefMovimiento> {
  const una = (id: string, i: number, empuje: number) => {
    const mov = m[id]
    m[id] = { ...mov, ventanas: mov.ventanas.map((v, j) => (j === i ? { ...v, empuje } : v)) }
  }
  una('puno', 0, e.puno)
  una('patada', 0, e.patada)
  una('combo', 1, e.combo)
  return m
}

/** Los normales de siempre con otra herramienta en algún golpe (cómo suena y qué destello lleva). */
function normalesCon(o: { ritmo: number; danio: number; alcance: number }, herramientas: Partial<Record<'puno' | 'patada' | 'combo' | 'voladora', Herramienta>>): Record<string, DefMovimiento> {
  const m = normales(o)
  for (const [id, h] of Object.entries(herramientas)) if (h && m[id]) m[id] = { ...m[id], herramienta: h }
  return m
}

// ─── Chino «El Tahúr»: cartas a tres alturas y una contra (el All In) ──────────

const CHINO: KitPersonaje = {
  caminar: 3.9,
  caminarAtras: 3.2,
  correr: 6.2,
  saltoVx: 4.3,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // La casa siempre gana: cada especial del rival le suma media carga.
  pasiva: { cargaPorEspecialRival: 0.5 },
  movimientos: {
    ...normales({ ritmo: 1, danio: 1, alcance: 2 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 126, 60, 178],
      empuje: 9,
      siguiente: 'golpe_pesado',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    golpe_pesado: pesado('golpe_pesado', 'herramienta2', 'pesado', { desde: 12, total: 29, danio: 66, guardia: 24, caja: [24, 134, 70, 180], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // Tres naipes rectos, uno cada 3 ticks y cada uno a otra altura: la alta sube en diagonal (le
      // pega al que salta cerca), la del medio pasa por arriba del agachado y la rasante por debajo
      // del que salta. Ni saltar ni agacharse alcanza: hay que cubrirse (o esquivar).
      id: 'cartas_malditas',
      numero: 1,
      anim: 'especial1',
      herramienta: 'carta',
      armadura: { hasta: 14, contra: TODO },
      total: 40,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 10 },
      rafaga: { cantidad: 3, cada: 3, tiros: [{ salidaY: 165, vy: 2.4 }, { salidaY: 135, vy: 0 }, { salidaY: 16, vy: 0, empuje: 5 }] },
      proyectil: {
        tipo: 'carta',
        // A 40 (y no más adelante): a quemarropa no nace detrás del rival, la trampa de la Pistola.
        salidaX: 40,
        salidaY: 135,
        vx: 10,
        vy: 0,
        gravedad: 0,
        giro: 0.6,
        ancho: 34,
        alto: 26,
        vida: 48,
        golpes: 1,
        intervalo: 0,
        danio: 28,
        danioGuardia: 12,
        fuerza: 'medio',
        // 14 (era 18; balance fino de la quinta tanda): contra el que nunca se cubre (casual2) las tres
        // cartas dejaban entrar la cadena entera y Chino ganaba 71 % entre personas.
        hitstun: 14,
        hitstop: 5,
        empuje: 3,
      },
    },
    {
      // La única contra del elenco: hasta el tick 28 el que le pegue o le tire algo se come la
      // embestida con el bono (170, derriba, intocable 6 ticks). Si nadie le pega, a los 34 sale igual
      // la embestida floja (100, empuja): rasante, se salta o se cubre (bloqueada queda −11).
      id: 'all_in',
      numero: 2,
      anim: 'especial2',
      herramienta: 'dominio',
      total: 70,
      contra: { desde: 0, hasta: 28, salto: 34, bono: { danio: 170, efecto: 'derriba', hitstun: 30, intocable: 6 } },
      embestida: { desde: 34, ticks: 12, distancia: 240, recuperacionGolpe: 16, recuperacionBloqueo: 26, atraviesa: true },
      ventanas: [ventana(35, 11, 100, 24, 'especial', [-10, 90, 0, 120], 9, 4, { hitstun: 26, efecto: null })],
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 175,
    rangoEspecial: [
      [80, 480],
      [0, 260],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Balance fino de la quinta tanda (afinar-balanzas --balanza=cpu, dos sales): con las cartas más cortas
    // y los normales a 1,10 su CPU ganaba 55–56 % en las tres.
    pericia: { facil: -0.069, normal: -0.08, dificil: -0.15 },
    // Contra una persona (pasada gruesa, ruidosa: ±10 por columna): con −0,06 el novato le ganaba 61 % a la
    // CPU y con 0,05 el simple, 16 %.
    periciaHumano: { normal: -0.02 },
  },
}

// ─── Fran «El Hipnótico»: una mirada que te trae y una estocada que premia la distancia ──

const FRAN: KitPersonaje = {
  caminar: 3.8,
  caminarAtras: 3.2,
  correr: 6.0,
  saltoVx: 4.3,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Pulso fino: después de cubrir un golpe, el próximo que arranca enseguida es crítico. 12 ticks (eran 20;
  // balance fino de la quinta tanda): la CPU de Fran se cubre del que aprieta la MÁQUINA y los especiales
  // (el novato) y le devolvía un crítico casi siempre (le ganaba 78 %). Entre dos personas da lo mismo.
  pasiva: { criticoTrasBloqueo: 12 },
  movimientos: {
    ...normales({ ritmo: 0.98, danio: 0.97, alcance: 4 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 74,
      guardia: 27,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 10, total: 27, danio: 62, guardia: 22, caja: [24, 140, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // A la altura de los ojos (148–202): pasa por arriba del agachado; saltar no sirve. Si pega en
      // el piso, hipnotiza (HIPNOSIS, constantes.ts): camina hacia Fran hasta 95 px. Lo corta el primer
      // golpe limpio. De cerca no deja combo gratis; de lejos (≈ 200 px) entra una cadena.
      id: 'lentes_hipnoticos',
      numero: 1,
      anim: 'especial1',
      herramienta: 'hipnosis',
      armadura: { hasta: 14, contra: TODO },
      total: 36,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 10 },
      proyectil: {
        tipo: 'hipnosis',
        salidaX: 45,
        salidaY: 175,
        vx: 9,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 36,
        alto: 54,
        anchoFinal: 64,
        altoFinal: 54,
        vida: 52,
        golpes: 1,
        intervalo: 0,
        danio: 30,
        danioGuardia: 10,
        fuerza: 'especial',
        hitstun: 18,
        hitstop: 8,
        empuje: 0,
        efecto: 'hipnotiza',
        ticksEfecto: 45,
      },
    },
    {
      // Plantado (sin avance) y largo: llega a 212 de centro a centro y con la punta (150 px o más)
      // es crítico seguro. No repite el Navajazo (corto, con avance, siempre crítico).
      id: 'corte_de_precision',
      numero: 2,
      anim: 'especial2',
      herramienta: 'tijera',
      armadura: { hasta: 10, contra: TODO },
      total: 38,
      ventanas: [ventana(18, 4, 115, 30, 'especial', [30, 180, 70, 172], 7, 4, { hitstun: 28, punta: { desde: 150 } })],
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 185,
    rangoEspecial: [
      [170, 460],
      [150, 205],
    ],
    especialDeCombo: 2,
    preferencia: [1, 1],
    // Pasada gruesa: su CPU ganaba 74 % en normal y 65 en difícil (Pulso fino contra la CPU que se cubre).
    // Balance fino (con el daño nuevo): 54–56 % en las tres; ahora también en fácil.
    pericia: { facil: -0.034, normal: -0.139, dificil: -0.455 },
    // Contra una persona (pasada gruesa): con su pericia de normal, el humano simple le ganaba 91 % a la CPU
    // (con 0,45, 2 %: interpolado en logit). Balance fino: 0,08 → 0,041 con el Pulso fino nuevo (el novato
    // le ganaba 20 % y el simple 45; con 0,041, 23,7 y 56,6: lo que los separa no lo achica este número).
    periciaHumano: { normal: 0.05 },
    asistencia: { normal: -0.051 },
  },
}

// ─── Lautaro «El Gigante»: brazos largos, un aplastón blindado y un agarre que levanta al que salta ──

const LAUTARO: KitPersonaje = {
  caminar: 3.5,
  caminarAtras: 2.8,
  correr: 5.6,
  saltoVx: 3.9,
  dash: { adelante: 145, atras: 115, ticks: 17 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Brazos largos: no es perilla, es el kit (normales con 8 px más de alcance), como la Gambeta de Nahuel.
  // Con menos empuje (balance fino de la quinta tanda): puño 2,5, patada 3,5 y el final del combo 11
  // (eran los de todos: 3,5, 4,5 y 13). Con su alcance, el empuje de siempre dejaba al otro justo fuera
  // de SU alcance y dentro del de Lautaro: entre dos personas que machacan con la demora del online
  // (casual2, D 17) ganaba 72 % y sin demora perdía (el novato, 33 %). Con menos alcance en vez de esto,
  // es un borde: con 3 px menos seguía en 70 % y con 4 menos caía a 25 % (el combo lo deja a ≈ 144,5 px).
  movimientos: {
    ...conEmpuje(normales({ ritmo: 1.05, danio: 0.92, alcance: 8 }), { puno: 2.5, patada: 3.5, combo: 11 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 30,
      danio: 78,
      guardia: 28,
      caja: [24, 138, 60, 182],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.6 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 11, total: 28, danio: 64, guardia: 22, caja: [24, 158, 50, 160], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // Crece (la caja de daño sigue al sprite: 92 de ancho y 1,46 de alto), da un paso enorme (66 px) y
      // aplasta. La armadura aguanta los leves y los medios (no los fuertes, los especiales ni el agarre)
      // y, más grande, le entran los tiros altos. Bloqueado gasta mucha guardia y queda −14.
      id: 'gigante',
      numero: 1,
      anim: 'especial1',
      herramienta: 'gigante',
      armadura: { hasta: 36, contra: ['leve', 'medio'] },
      total: 66,
      cuerpo: { desde: 15, hasta: 52, ancho: 92, altoMult: 1.46 },
      avance: { desde: 24, hasta: 30, vel: 11 },
      ventanas: [ventana(34, 6, 160, 60, 'especial', [50, 245, 0, 230], 9, 6, { hitstun: 30 })],
    },
    {
      // El agarre que también agarra en el aire (antiaéreo) y no al agachado (la mano va del cuello para
      // arriba): sin apretones, lo revolea alto (vy 15) y cae a ≈ 200 px, derribado. Al aire queda
      // regalado 16 ticks.
      id: 'lanzamiento_aereo',
      numero: 2,
      anim: 'especial2',
      herramienta: 'lanzamiento',
      total: 34,
      avance: { desde: 0, hasta: 10, vel: 3 },
      ventanas: [ventana(12, 6, 0, 0, 'especial', [20, 106, 122, 240], 0, 0)],
      agarre: { sostener: 22, apretones: { cada: 99, danio: 0 }, tiron: { danio: 135, empuje: 6, vy: 15 }, adelante: 70, alto: 100, recuperacion: 22, aire: true },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 180,
    rangoEspecial: [
      [150, 330],
      [0, 150],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Pasada gruesa de la quinta tanda.
    pericia: { facil: -0.04, normal: -0.04 },
    // Contra una persona (pasada gruesa): el humano simple le ganaba 82 % a la CPU (con 0,35, 24 %).
    // Balance fino (afinar-balanzas --balanza=persona-cpu): 0,22 → 0,236.
    periciaHumano: { normal: 0.236 },
    // Con Lautaro, el novato ganaba 21 % contra la CPU (pasada gruesa). Balance fino: 0,06 → 0,045 (con el
    // empuje nuevo, el simple con Lautaro ganaba 55,5).
    asistencia: { normal: 0.045 },
  },
}

// ─── Leo «El Filoso»: herramientas que apuntan adonde estás y un spray que te deja sin pegar ──

const LEO: KitPersonaje = {
  caminar: 4.0,
  caminarAtras: 3.3,
  correr: 6.4,
  saltoVx: 4.5,
  dash: { adelante: 150, atras: 120, ticks: 14 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Pibe de goma: tirado queda ≈ 28 ticks en vez de 50.
  pasiva: { multDerribo: 0.55 },
  movimientos: {
    // Su GOLPE es con la tijera y su patada con la máquina (como los dibuja la hoja).
    ...normalesCon({ ritmo: 0.97, danio: 0.95, alcance: 4 }, { puno: 'tijera', patada: 'maquina' }),
    maquina: pesado('maquina', 'herramienta1', 'maquina', {
      desde: 12,
      total: 30,
      danio: 76,
      guardia: 30,
      caja: [24, 128, 60, 178],
      empuje: 7,
      siguiente: 'tijera',
      avance: { desde: 6, hasta: 14, vel: 1.8 },
    }),
    tijera: pesado('tijera', 'herramienta2', 'tijera', { desde: 10, total: 27, danio: 62, guardia: 24, caja: [28, 136, 70, 178], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'maquina', aereo: 'voladora' },
  especiales: [
    {
      // Tres tiros rectos que APUNTAN al salir (DefProyectil.apunta): le ganan al que salta para
      // acercarse. Se cubren enteros o se esquivan; saltar o agacharse no sirve.
      id: 'lanzamiento_de_herramientas',
      numero: 1,
      anim: 'especial1',
      herramienta: 'secador',
      armadura: { hasta: 14, contra: TODO },
      total: 46,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 20 },
      rafaga: { cantidad: 3, cada: 8, tiros: [{}, {}, { empuje: 7 }] },
      proyectil: {
        tipo: 'secador',
        salidaX: 40,
        salidaY: 120,
        vx: 11,
        vy: 0,
        gravedad: 0,
        giro: 0.35,
        ancho: 40,
        alto: 30,
        vida: 55,
        golpes: 1,
        intervalo: 0,
        danio: 30,
        danioGuardia: 12,
        fuerza: 'medio',
        hitstun: 20,
        hitstop: 5,
        empuje: 3.5,
        apunta: true,
      },
    },
    {
      // Un chorro ancho que nace en la lata y crece (≈ 287 px de centro a centro): si pega limpio, deja
      // cegado 75 ticks (sin pegar, con control). Cubierto no ciega; se corta si a Leo le pegan.
      id: 'spray_cegador',
      numero: 2,
      anim: 'especial2',
      herramienta: 'aerosol',
      armadura: { hasta: 16, contra: TODO },
      total: 40,
      ventanas: [],
      lanzamiento: { desde: 16, ticks: 14 },
      proyectil: {
        tipo: 'aerosol',
        salidaX: 45,
        salidaY: 125,
        vx: 0,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 40,
        alto: 70,
        anchoFinal: 210,
        altoFinal: 150,
        vida: 20,
        golpes: 1,
        intervalo: 0,
        danio: 36,
        danioGuardia: 14,
        fuerza: 'especial',
        hitstun: 18,
        hitstop: 8,
        empuje: 2,
        chorro: { crece: 10 },
        efecto: 'ciega',
        ticksEfecto: 75,
      },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 175,
    rangoEspecial: [
      [130, 560],
      [70, 250],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Pasada gruesa: su CPU ganaba ≈ 30 % en las tres dificultades. Balance fino (con los kits nuevos de
    // Chino, Fran y Lautaro): 53,9 en normal y 45,5 en difícil.
    pericia: { facil: 0.18, normal: 0.307, dificil: 0.44 },
    // Contra una persona (pasada gruesa): con la pericia de normal, el humano simple le ganaba 12 % a la CPU
    // (con 0, 64 %).
    periciaHumano: { normal: 0.12 },
  },
}

// ─── Nacho «El Admin» (dueño): un agarre de media distancia que roba carga y columnas de código ──

const NACHO: KitPersonaje = {
  caminar: 3.8,
  caminarAtras: 3.1,
  correr: 6.0,
  saltoVx: 4.2,
  dash: { adelante: 150, atras: 120, ticks: 15 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Overclock: con la carga en 8 o más, camina y corre 12 % más rápido.
  pasiva: { velocidadConCarga: { desde: 8, mult: 1.12 } },
  movimientos: {
    // El GOLPE BÁSICO 2 de la hoja es el Laptopazo: la patada de su cadena de GOLPE pega con la laptop.
    ...normalesCon({ ritmo: 1, danio: 1, alcance: 2 }, { patada: 'laptop' }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 126, 60, 178],
      empuje: 9,
      siguiente: 'laptopazo',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    laptopazo: pesado('laptopazo', 'herramienta2', 'laptop', { desde: 11, total: 28, danio: 66, guardia: 26, caja: [26, 140, 60, 176], empuje: 9 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // El tercer agarre del elenco: de MEDIA distancia (la mano agarra con el centro del rival entre
      // ≈ 93 y 247 px; pegado no alcanza), también al agachado y nunca en el aire. Dos apretones y el
      // tirón, que derriba y le roba hasta 2,5 de carga (se queda con 1). Armadura sólo contra leves.
      // La mano llega a 215 (235 en el diseño; pasada gruesa: entre personas que no saltan, de 235 ganaba
      // 8 de cada 10).
      id: 'agarre_y_ejecucion',
      numero: 1,
      anim: 'especial1',
      herramienta: 'ejecucion',
      armadura: { hasta: 12, contra: ['leve'] },
      total: 44,
      ventanas: [ventana(12, 6, 0, 0, 'especial', [125, 215, 20, 200], 0, 0)],
      agarre: { sostener: 40, apretones: { cada: 14, danio: 16 }, tiron: { danio: 90, empuje: 6 }, adelante: 72, alto: 40, recuperacion: 18, roba: { carga: 2.5, gana: 1 } },
    },
    {
      // Cuatro columnas de código, una cada 6 ticks y cada una 90 px más lejos: cada una avisa 12 ticks
      // y estalla 6. La que te agarra te tira (y tirado, las otras no te tocan). Altas: no se saltan;
      // se cubren, se cruzan con la esquiva hacia Nacho (queda arrodillado hasta el 52) o se esperan.
      id: 'terremoto_de_codigo',
      numero: 2,
      anim: 'especial2',
      herramienta: 'codigo',
      armadura: { hasta: 14, contra: TODO },
      total: 52,
      ventanas: [],
      lanzamiento: { desde: 14, ticks: 24 },
      rafaga: { cantidad: 4, cada: 6, tiros: [{ distancia: 105 }, { distancia: 195 }, { distancia: 285 }, { distancia: 375 }] },
      proyectil: {
        tipo: 'codigo',
        salidaX: 0,
        salidaY: 0,
        vx: 0,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 40,
        alto: 240,
        vida: 40,
        golpes: 1,
        intervalo: 0,
        danio: 95,
        danioGuardia: 24,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 10,
        empuje: 4,
        efecto: 'derriba',
        diferido: { distancia: 105, espera: TIEMPOS_PROYECTIL.codigoEstalla, activo: 6, ancho: 76, alto: 250 },
      },
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 180,
    rangoEspecial: [
      [105, 255],
      [120, 420],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Balance fino de la quinta tanda (CPU contra CPU entre los dueños, con el daño nuevo).
    pericia: { facil: -0.106, normal: -0.039, dificil: 0.073 },
    // Con el pase, contra las CPU de los barberos (balance fino de la quinta tanda, elenco «cruce»).
    asistencia: { normal: -0.083 },
    // Contra una persona (con el pase, contra la CPU de un dueño): sin esto usaba su pericia y el simple le
    // ganaba de 4 % (Tony) a 70 % (Nacho, Nico M.). Balance fino de la quinta tanda.
    periciaHumano: { normal: 0.097 },
  },
}

// ─── Nehuen «El Fantasma» (dueño): cruza intocable y devuelve lo que le tiran ──

const NEHUEN: KitPersonaje = {
  caminar: 4.2,
  caminarAtras: 3.5,
  correr: 6.8,
  saltoVx: 4.8,
  dash: { adelante: 150, atras: 125, ticks: 14 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Volea: sus golpes en el aire pegan 25 % más.
  pasiva: { multAereo: 1.25 },
  movimientos: {
    ...normales({ ritmo: 0.97, danio: 0.95, alcance: 0 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 74,
      guardia: 26,
      caja: [24, 124, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 2 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 9, total: 26, danio: 60, guardia: 22, caja: [24, 140, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // Intocable del 0 al 17 (golpes, tiros y agarres lo atraviesan): cruza a ≈ 33 px/tick hasta quedar
      // a 92 px del rival (DefEmbestida.hastaRival) y a los 22 pega UNA vez, parado, con la pelota.
      // No pega viajando. En el golpe queda +11; bloqueado −7.
      id: 'desaparecer',
      numero: 1,
      anim: 'especial1',
      herramienta: 'fantasma',
      total: 48,
      embestida: { desde: 4, ticks: 14, distancia: 460, recuperacionGolpe: 14, recuperacionBloqueo: 22, invulnerableHasta: 18, atraviesa: true, hastaRival: 92 },
      ventanas: [ventana(22, 5, 100, 22, 'especial', [10, 135, 50, 195], 9, 5, { hitstun: 26 })],
    },
    {
      // El paletazo de cerca (14), la pelota recta (18) y, mientras la paleta está en el aire (6 a 22),
      // devuelve lo que el rival le tira (DefEspecial.devuelve): cambia de dueño y vuelve ×1,25.
      id: 'smash_de_padel',
      numero: 2,
      anim: 'especial2',
      herramienta: 'paleta',
      armadura: { hasta: 10, contra: TODO },
      total: 44,
      ventanas: [ventana(14, 5, 55, 16, 'especial', [20, 140, 70, 230], 7, 4, { hitstun: 22, efecto: null })],
      lanzamiento: { desde: 18, ticks: 8 },
      proyectil: {
        tipo: 'pelotita',
        salidaX: 70,
        salidaY: 120,
        vx: 15,
        vy: 0,
        gravedad: 0,
        giro: 0.6,
        ancho: 32,
        alto: 32,
        vida: 48,
        golpes: 1,
        intervalo: 0,
        danio: 80,
        danioGuardia: 18,
        fuerza: 'especial',
        hitstun: 24,
        hitstop: 8,
        empuje: 10,
        efecto: null,
      },
      devuelve: { desde: 6, hasta: 22, caja: { x0: 0, x1: 160, y0: 40, y1: 240 }, mult: 1.25, max: 22 },
    },
  ],
  cpu: {
    herramienta: 0.25,
    distancia: 190,
    rangoEspecial: [
      [200, 540],
      [140, 600],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Balance fino de la quinta tanda (CPU contra CPU entre los dueños, con el daño nuevo).
    pericia: { facil: 0.035, normal: 0.318, dificil: 0.542 },
    // Con el pase, contra las CPU de los barberos (balance fino de la quinta tanda, elenco «cruce»).
    asistencia: { normal: -0.065 },
    // Contra una persona (con el pase, contra la CPU de un dueño): sin esto usaba su pericia y el simple le
    // ganaba de 4 % (Tony) a 70 % (Nacho, Nico M.). Balance fino de la quinta tanda.
    periciaHumano: { normal: 0.033 },
  },
}

// ─── Nico M. «El Dorado» (dueño): el zoner; anillos que cruzan la pantalla y púas que esperan en el piso ──

const NICO_M: KitPersonaje = {
  caminar: 3.6,
  caminarAtras: 3.0,
  correr: 5.8,
  saltoVx: 4.0,
  dash: { adelante: 150, atras: 120, ticks: 16 },
  criticoBase: 0.07,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Pelo de punta: el que le pega de cerca se pincha (7 de vida por golpe, sin aturdir; eran 5: balance fino
  // de la quinta tanda, entre los dueños perdía las peleas de cerca).
  pasiva: { pincha: { danio: 7 } },
  movimientos: {
    ...normales({ ritmo: 1.02, danio: 1, alcance: 2 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 29,
      danio: 76,
      guardia: 28,
      caja: [24, 126, 60, 178],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 10, total: 27, danio: 62, guardia: 22, caja: [24, 140, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // Sin piezas nuevas: tres ventanas escalonadas, cada una más larga (los anillos). Llegan a 272, 482 y
      // 692 de centro a centro: de cerca pegan las tres (140), de lejos una (60). De 80 a 200 de alto: no
      // se salta ni se pasa agachado; se cubre. No es un proyectil: no se devuelve. De cerca queda −8.
      id: 'orden_final',
      numero: 1,
      anim: 'especial1',
      herramienta: 'anillos',
      armadura: { hasta: 14, contra: TODO },
      total: 46,
      ventanas: [
        ventana(16, 3, 40, 10, 'especial', [40, 240, 80, 200], 2, 2, { hitstun: 18, hitstop: 5 }),
        ventana(19, 3, 40, 10, 'especial', [40, 450, 80, 200], 2, 2, { hitstun: 18, hitstop: 5 }),
        ventana(22, 4, 60, 14, 'especial', [40, 660, 80, 200], 9, 5, { hitstun: 26, hitstop: 9 }),
      ],
    },
    {
      // Tres púas en arco (≈ 42 ticks en caer, a ≈ 220, 325 y 430 px). La que pega es un golpe medio común;
      // las que no, se clavan (DefProyectil.trampa) 2,5 s y tiran al que las pisa (imbloqueable); una
      // trampa por tirada. Se saltan, se cruzan con la esquiva o se espera a que se apaguen.
      id: 'espinas',
      numero: 2,
      anim: 'especial2',
      herramienta: 'espinas',
      armadura: { hasta: 18, contra: TODO },
      total: 46,
      ventanas: [],
      lanzamiento: { desde: 18, ticks: 12 },
      rafaga: { cantidad: 3, cada: 4, tiros: [{ vx: 4.5 }, { vx: 7 }, { vx: 9.5 }] },
      proyectil: {
        tipo: 'espina',
        salidaX: 30,
        salidaY: 175,
        vx: 7,
        vy: 6,
        gravedad: 0.45,
        giro: 0,
        ancho: 28,
        alto: 34,
        vida: 70,
        golpes: 1,
        intervalo: 0,
        danio: 36,
        danioGuardia: 14,
        fuerza: 'medio',
        hitstun: 22,
        hitstop: 6,
        empuje: 4,
        efecto: null,
        trampa: { vida: 150, ancho: 46, alto: 40, danio: 50, efecto: 'derriba', imbloqueable: true },
      },
    },
  ],
  cpu: {
    herramienta: 0.3,
    distancia: 210,
    rangoEspecial: [
      [180, 660],
      [140, 420],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Pasada gruesa (CPU contra CPU entre los dueños): su CPU ganaba 73 % en normal y 86 en difícil. Balance
    // fino, con el daño nuevo: en fácil también.
    pericia: { facil: 0.039, normal: -0.078, dificil: -0.508 },
    // Contra una persona (con el pase, contra la CPU de un dueño): sin esto usaba su pericia y el simple le
    // ganaba de 4 % (Tony) a 70 % (Nacho, Nico M.). Balance fino de la quinta tanda.
    periciaHumano: { normal: -0.01 },
  },
}

// ─── Tony «El Jefe» (dueño): presión de cerca; un monopatín que acelera y el papel del despido ──

const TONY: KitPersonaje = {
  caminar: 3.9,
  caminarAtras: 2.9,
  correr: 6.2,
  saltoVx: 4.1,
  dash: { adelante: 145, atras: 115, ticks: 16 },
  criticoBase: 0.08,
  cargaPorCritico: 0,
  reduccionDanio: 0,
  // Presencia de jefe: cerca de él (170 px), el rival camina y corre 5 % más lento (era 12 %: balance fino de
  // la quinta tanda; entre dos personas que machacan con la demora del online lo dejaba siempre a tiro).
  pasiva: { presencia: { distancia: 170, mult: 0.95 } },
  movimientos: {
    // El último golpe del combo empuja 15 (13 en todos): con 13 y 14 el otro quedaba a ≈ 136 px, a tiro de
    // su puño (142), y entre dos personas que machacan con la demora del online (casual2, D 17–20) Tony lo
    // volvía a enganchar siempre: ganaba 71–76 % contra los barberos. Con 16 se da vuelta (31–35): es un borde.
    ...conEmpuje(normales({ ritmo: 1.02, danio: 1.06, alcance: 2 }), { puno: 3.5, patada: 4.5, combo: 15 }),
    remate: pesado('remate', 'herramienta1', 'pesado', {
      desde: 12,
      total: 30,
      danio: 82,
      guardia: 30,
      caja: [24, 128, 60, 180],
      empuje: 9,
      siguiente: 'patada_fuerte',
      avance: { desde: 4, hasta: 12, vel: 1.8 },
    }),
    patada_fuerte: pesado('patada_fuerte', 'herramienta2', 'patada', { desde: 10, total: 28, danio: 66, guardia: 24, caja: [24, 144, 50, 150], empuje: 8 }),
  },
  inicio: { golpe: 'puno', herramienta: 'remate', aereo: 'voladora' },
  especiales: [
    {
      // El revoleo de cerca (pega también un poco atrás) y el monopatín tirado, que sale a 4 px/tick y
      // acelera 0,6 por tick hasta 17 (DefProyectil.aceleracion): cerca es lento (se salta si cubriste el
      // revoleo), a media pantalla ya va rápido. De cerca entran los dos (45 + 110 y al piso).
      id: 'monopatin',
      numero: 1,
      anim: 'especial1',
      herramienta: 'monopatin',
      armadura: { hasta: 16, contra: TODO },
      total: 50,
      ventanas: [ventana(14, 6, 45, 14, 'medio', [-40, 150, 20, 210], 6, 4, { hitstun: 30, efecto: null })],
      lanzamiento: { desde: 24, ticks: 8 },
      proyectil: {
        tipo: 'monopatin',
        salidaX: 60,
        salidaY: 95,
        vx: 4,
        vy: 0,
        gravedad: 0,
        giro: 0,
        ancho: 112,
        alto: 60,
        vida: 64,
        golpes: 1,
        intervalo: 0,
        danio: 110,
        danioGuardia: 26,
        fuerza: 'especial',
        hitstun: 30,
        hitstop: 11,
        empuje: 8,
        efecto: 'derriba',
        aceleracion: { por: 0.6, max: 17 },
      },
    },
    {
      // El papel (22, cubrible, no empuja) y, sólo si entró limpio (DefEspecial.siPega), la acción se
      // estira a 92, la víctima queda arrodillada 44 ticks y a los 50 sale la patada voladora (derriba).
      // Cubierto o al aire, la acción termina en el 48: Tony queda regalado (−18).
      id: 'despido_final',
      numero: 2,
      anim: 'especial2',
      herramienta: 'despido',
      armadura: { hasta: 22, contra: ['leve', 'medio'] },
      total: 48,
      ventanas: [
        // El papel llega a 182 de centro a centro (165 en el diseño; pasada gruesa de la quinta tanda).
        ventana(22, 6, 12, 8, 'medio', [30, 150, 50, 220], 0, 2, { hitstun: 14, efecto: null }),
        ventana(52, 12, 150, 30, 'especial', [-10, 120, -20, 160], 9, 4, { hitstun: 30, efecto: 'derriba' }),
      ],
      siPega: { ventana: 0, total: 92, aturde: 44 },
      embestida: { desde: 50, ticks: 14, distancia: 110, recuperacionGolpe: 18, recuperacionBloqueo: 26, salto: { vy: 7, gravedad: 0.7 } },
    },
  ],
  cpu: {
    herramienta: 0.35,
    distancia: 170,
    rangoEspecial: [
      [0, 560],
      [60, 175],
    ],
    especialDeCombo: 0,
    preferencia: [1, 1],
    // Pasada gruesa (CPU contra CPU entre los dueños): su CPU ganaba ≈ 30 %. Balance fino con el kit nuevo.
    pericia: { facil: 0.203, normal: 0.278, dificil: 0.294 },
    // Con el pase, contra las CPU de los barberos (balance fino de la quinta tanda, elenco «cruce»).
    asistencia: { normal: -0.029 },
    // Contra una persona (con el pase, contra la CPU de un dueño): sin esto usaba su pericia y el simple le
    // ganaba de 4 % (Tony) a 70 % (Nacho, Nico M.). Balance fino de la quinta tanda.
    periciaHumano: { normal: -0.025 },
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
          trampa: e.proyectil.trampa ? { ...e.proyectil.trampa, danio: r(e.proyectil.trampa.danio) } : undefined,
        }
      : undefined,
    agarre: e.agarre
      ? {
          ...e.agarre,
          apretones: { ...e.agarre.apretones, danio: r(e.agarre.apretones.danio) },
          tiron: { ...e.agarre.tiron, danio: r(e.agarre.tiron.danio) },
        }
      : undefined,
    // El bono de la contra (el All In de Chino) es el golpe de la embestida cuando la contra saltó.
    contra: e.contra ? { ...e.contra, bono: { ...e.contra.bono, danio: r(e.contra.bono.danio) } } : undefined,
  })
  const movimientos: Record<string, DefMovimiento> = {}
  for (const [id, m] of Object.entries(kit.movimientos)) movimientos[id] = mov(m)
  return { ...kit, movimientos, especiales: [esp(kit.especiales[0]), esp(kit.especiales[1])] }
}

/**
 * Factores [normales, especiales, guardia de los normales, guardia de los especiales] de cada barbero
 * (balance con el simulador, 30/oct/2026; la guardia de los normales va entre 0,8 y 1,3).
 *
 * Tercera tanda (31/oct): los factores de daño de normales y especiales se afinaron ENTRE DOS PERSONAS
 * (meta E de balance.mts: cinco modelos de persona y la demora del online), que es lo único que el
 * online ve; la CPU se empareja después con su pericia, su periciaHumano y la asistencia. Con un
 * escalón de daño por barbero hacia el 50 % (el promedio en logit de todas las columnas, mitad el
 * promedio y mitad el punto medio entre la peor y la mejor) y los cambios de kit de cada uno.
 * Además, todos ×1,07 al final: los rounds entre CPUs habían pasado a 38–40 s.
 *
 * Revisión del 30/oct, segunda tanda: el nivel lo pone normal (afinar.mts --peso=0,1,0 --dif=normal;
 * fácil y difícil los empareja la `pericia`) y la proporción especiales/normales es una decisión:
 * apretados sin apuntar, los especiales decidían las peleas entre dos personas (el «novato» de
 * balance.mts), así que bajó en Simón (0,9), Chipi (0,85), Nico U. (0,9), Luciano (1,3), Gabriel
 * (1,2) y Joaquín (1,25), y subió en Fabri (1,15), Nahuel (1,45) y Brian (1,1).
 */
export const DANIO_KIT: Readonly<Record<IdPersonaje, readonly [number, number, number, number]>> = {
  simon: [0.865, 0.642, 1.114, 1.114],
  chipi: [0.701, 0.642, 1.196, 1.196],
  nico_u: [0.877, 0.645, 0.8, 0.8],
  fabri: [1.152, 0.991, 1.3, 2],
  luciano: [1.081, 0.921, 1.3, 2],
  gabriel: [1.133, 1.198, 1.032, 1.587],
  guillermo: [1.028, 1.255, 1.3, 1.416],
  rodrigo: [0.822, 1.458, 0.8, 0.8],
  joaquin: [1.138, 0.922, 0.8, 0.8],
  nahuel: [1.1, 1.484, 0.818, 0.818],
  lucas: [0.889, 1.32, 1.062, 1.062],
  stefano: [1.02, 1.193, 0.864, 1.328],
  brian: [0.649, 0.679, 0.838, 1.29],
  // Quinta tanda (14/nov): los de arranque del diseño y, con E (balance fino, segunda parte), Chino
  // 1,05 → 1,10 en los normales (con las cartas más cortas), Fran 1,05/1,1 → 1,08/1,2 (con «apunta» y la
  // demora del online perdía 72 %: el Corte de Precisión sale tarde) y Lautaro 1,08 → 1,04 (con el
  // empuje nuevo de sus normales).
  chino: [1.1, 1, 1, 1],
  fran: [1.08, 1.2, 1, 1],
  lautaro: [1.04, 1.04, 1, 1],
  leo: [1, 1, 1.1, 1.1],
  // Los dueños, con E entre ellos y contra los barberos (balance fino de la quinta tanda): contra los
  // barberos perdían todos (39–44 % entre personas); entre ellos, Tony ganaba 70 % con los que machacan.
  nacho: [1.15, 1.15, 1, 1],
  nehuen: [1.25, 1.25, 1, 1],
  nico_m: [1.05, 1.05, 1, 1],
  tony: [0.97, 0.935, 1, 1],
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
  chino: CHINO,
  fran: FRAN,
  lautaro: LAUTARO,
  leo: LEO,
  nacho: NACHO,
  nehuen: NEHUEN,
  nico_m: NICO_M,
  tony: TONY,
}

export const MOVIMIENTOS = Object.fromEntries(
  (Object.keys(KITS_DISENIO) as IdPersonaje[]).map((id) => {
    const [fn, fe, fg, fge] = DANIO_KIT[id]
    return [id, conDanio(KITS_DISENIO[id], fn, fe, fg, fge)]
  }),
) as Record<IdPersonaje, KitPersonaje>
