/**
 * La CPU: genera EntradaJugador como un humano (mismo camino: flancos, buffer, cadenas) a partir
 * de lo que VE del rival con un retraso de `reaccion` ticks. Se acerca, tantea, retrocede, salta
 * a veces, castiga ataques fallados y lo que bloquea, recibe al que se acerca, se adapta al que ataca
 * mucho, usa los especiales según la dificultad y nunca se queda trabada (2 s sin atacar ni ir para
 * adelante → avanza). En fácil y normal, si el humano va perdiendo feo, afloja un poco.
 *
 * Dificultades (tabla del diseño): reacción 26/15/8 ticks, bloquear 0,15/0,4/0,7, agresividad
 * 0,35/0,6/0,8, termina cadenas 0,3/0,6/0,9; especiales «torpe» (mal apuntados), «alcance» (en rango,
 * contra alguien que no se cubre) y «castiga» (castigos que llegan seguro, combos, romper guardias).
 * `Cerebro.motivo` dice por qué hizo lo último (sirve para una capa de depuración).
 *
 * Elenco de 13 (30/oct): cada especial se usa según su MECÁNICA (`usoDe`): embestidas para
 * castigar, el molino de revés, la chilena contra el que salta, rastreros contra el que está en el
 * piso, arcos y chorros a su distancia, el graffiti en su franja, la onda para sacárselo de encima,
 * el agarre pegado y contra el que se cubre, la cura de lejos y con poca vida. Alterna los dos
 * especiales (no gasta toda la carga en el barato). Y se defiende de cada uno: salta el bombo y el
 * sismo, pasa la onda con la esquiva, sale del graffiti y de la nube, no se cubre del agarre ni de lo
 * que rompe la guardia (salta o se va), y mareado no planea cubrirse.
 *
 * Revisión adversarial (30/oct, scripts/juego/simulador/adversario.mts): bots de una sola idea le
 * ganaban 3 de 4 a la CPU normal machacando la MÁQUINA y 7 de 10 a la difícil entrando con la
 * esquiva y machacando GOLPE. Ahora: castiga sólo si el castigo llega antes que lo próximo del rival
 * (`castigoLlega`), no le tira el golpe encima a uno que está pegando, no se cubre con la guardia a
 * uno o dos golpes de romperse (`guardiaBajaDe`), deja pasar la MÁQUINA con la esquiva y la castiga,
 * corta o bloquea al que entra con la esquiva, se cubre al ver el super flash de un especial que
 * tira algo y cierra con su especial los golpes que entran (0,4 en normal). Las dificultades
 * reales están en PARAMS_CPU (reacción 26/9/6).
 *
 * Integración (30/oct): en fácil y en difícil cada barbero tiene su `pericia` (EstiloCpu, en
 * movimientos.ts), que corre los parámetros de la dificultad un poco hacia arriba o hacia abajo
 * (`paramsConPericia`) para que todos los rivales de una misma dificultad cuesten lo mismo.
 */
import type { Dificultad, EntradaJugador, Lado, Partida, ProyectilEstado } from '../tipos'
import { PERSONAJES } from '../personajes'
import type { Azar } from './azar'
import { azar, chance, crearAzar, entero } from './azar'
import { ATERRIZAJE_TICKS, DASH, GRAVEDAD, X_MAX, X_MIN } from './constantes'
import { alcanceDe, finVentanas, primeraVentana, puedeActuar } from './cuerpo'
import type { EstadoInterno } from './interno'
import type { DefEspecial, KitPersonaje } from './movimientos'

export interface ParamsCpu {
  /** Ticks de retraso con los que ve al rival. */
  reaccion: number
  /** Probabilidad de cubrirse de un ataque que ve venir. */
  bloquear: number
  agresividad: number
  /** Probabilidad de terminar una cadena que entró. */
  terminaCadena: number
  /** Probabilidad de castigar un ataque fallado. */
  castigo: number
  antiaereo: number
  especiales: 'torpe' | 'alcance' | 'castiga'
  /** Probabilidad de equivocarse (atacar fuera de alcance, seguir una cadena que no entró). */
  errores: number
  /** Cada cuántos ticks vuelve a pensar el plan. */
  cadencia: readonly [number, number]
  /** Probabilidad de agacharse al cubrirse (agachado esquiva el puño). */
  agacharse: number
  /** Cuánto se adapta a un rival que ataca mucho (0 = nada): se cubre más y castiga. */
  adapta: number
  /** Probabilidad de recibir con la herramienta al que se acerca caminando (justo al alcance). */
  recibir: number
}

export const PARAMS_CPU: Readonly<Record<Dificultad, ParamsCpu>> = {
  facil: {
    reaccion: 26,
    bloquear: 0.15,
    agresividad: 0.35,
    // 0,5 (era 0,3): con cadenas casi nunca terminadas, el balance de fácil se decidía por otras
    // cosas que el de normal y difícil (los de cadena larga eran flojos sólo en fácil).
    terminaCadena: 0.5,
    castigo: 0.2,
    antiaereo: 0.1,
    especiales: 'torpe',
    errores: 0.3,
    cadencia: [14, 30],
    agacharse: 0.1,
    adapta: 0,
    recibir: 0.05,
  },
  // Normal y difícil, medidos con el simulador (30/oct): con reacción 15 el «humano simple» (sólo
  // machaca GOLPE de cerca) le ganaba 94 de 100 a la CPU normal (90 con Gabriel); con 9, agacharse
  // (el puño pasa por arriba) y recibir/castigar más, ≈ 1 de 3 con los luchadores más rápidos.
  normal: {
    reaccion: 9,
    bloquear: 0.55,
    agresividad: 0.6,
    terminaCadena: 0.7,
    castigo: 0.75,
    antiaereo: 0.4,
    especiales: 'alcance',
    errores: 0.1,
    cadencia: [10, 20],
    agacharse: 0.8,
    adapta: 0.6,
    recibir: 0.8,
  },
  dificil: {
    reaccion: 6,
    bloquear: 0.75,
    agresividad: 0.8,
    terminaCadena: 0.92,
    castigo: 0.9,
    antiaereo: 0.7,
    especiales: 'castiga',
    errores: 0.03,
    cadencia: [6, 13],
    agacharse: 0.85,
    adapta: 0.75,
    recibir: 0.85,
  },
}

type BotonCpu = 'golpe' | 'herramienta' | 'especial1' | 'especial2' | 'arriba' | 'dash'
const BOTONES_CPU: readonly BotonCpu[] = ['golpe', 'herramienta', 'especial1', 'especial2', 'arriba', 'dash']
type Ataque = 'golpe' | 'herramienta'
type Plan = 'neutral' | 'acercarse' | 'alejarse' | 'tantear' | 'esperar' | 'guardia' | 'presionar' | 'mantener'
type ModoEsquiva = 'saltar' | 'dash' | 'guardia' | 'salir'

interface Observacion {
  x: number
  y: number
  vx: number
  vy: number
  enSuelo: boolean
  libre: boolean
  atacando: boolean
  sello: number
  /** 0 nada, 1 arranque, 2 activo, 3 recuperación. */
  fase: 0 | 1 | 2 | 3
  fallo: boolean
  alcance: number
  restante: number
  lanza: boolean
  /** Fin de cadena, herramienta o especial: bloqueado, se puede castigar. */
  inseguro: boolean
  bloqueando: boolean
  vulnerable: boolean
  invulnerable: boolean
  saltando: boolean
  tirado: boolean
  /** Especial en curso (0 = ninguno) y si es un agarre o algo que rompe la guardia. */
  especial: 0 | 1 | 2
  agarre: boolean
  rompe: boolean
  /** No se puede cubrir (mareado). */
  mareado: boolean
  /** Golpe de la cadena de la MÁQUINA (lento, mucho daño a la guardia). */
  pesado: boolean
  /** Tick de la esquiva en curso (-1 = no está esquivando), su dirección y su sello. */
  dashT: number
  dashDir: -1 | 0 | 1
  dashAdelante: boolean
  selloDash: number
}

const LARGO_HISTORIAL = 40

export interface Cerebro {
  lado: Lado
  azar: Azar
  base: ParamsCpu
  efectivos: ParamsCpu
  historial: Observacion[]
  idx: number
  llenos: number
  btn: Record<BotonCpu, number>
  prevBtn: Record<BotonCpu, boolean>
  dir: -1 | 0 | 1
  guardia: boolean
  abajo: boolean
  plan: Plan
  planT: number
  pensar: number
  objetivo: number
  ataque: Ataque
  selloDefensa: number
  /** Última esquiva del rival a la que ya reaccionó. */
  selloDashVisto: number
  /** Último especial con proyectil del rival que ya vio venir (por el super flash). */
  selloFlash: number
  selloCastigo: number
  selloCadena: number
  proyVisto: number
  esquivar: { id: number; modo: ModoEsquiva } | null
  rivalEnAire: boolean
  pateaEnSalto: boolean
  /** Ticks sin atacar ni ir para adelante (a los 2 s, avanza). */
  sinAvanzar: number
  /** El rival estaba en zona de amenaza el tick anterior. */
  enAmenaza: boolean
  /** Estaba en blockstun el tick anterior (para castigar lo que bloqueó). */
  bloqueando: boolean
  /** Ataques que empezó el rival en los últimos ~2 s (promedio móvil). */
  presionRival: number
  selloVisto: number
  /** Por qué hizo lo último que hizo (depuración: «castigo», «amenaza», «cerca»…). */
  motivo: string
  /** Ya decidió si recibe al rival que se viene acercando. */
  recibio: boolean
  /** Ya decidió si aprovecha que el rival quedó a merced (una vez por vez) y qué decidió. */
  merced: boolean
  aprovecha: boolean
  tantearT: number
  final: { decidido: boolean; remata: boolean; en: number; boton: 'golpe' | 'herramienta' | 'especial1' | 'especial2' }
  /** El especial que quiere tirar después (alterna, así no gasta todo en el barato). */
  proximoEspecial: 1 | 2
  /** Ticks hasta poder tirar otro especial que no sea un castigo. */
  enfriaEspecial: number
  /** Ticks que lleva esperando para tirar el especial que le toca. */
  esperaProximo: number
}

function observacionVacia(): Observacion {
  return {
    x: 480,
    y: 0,
    vx: 0,
    vy: 0,
    enSuelo: true,
    libre: true,
    atacando: false,
    sello: 0,
    fase: 0,
    fallo: false,
    alcance: 0,
    restante: 0,
    lanza: false,
    inseguro: false,
    bloqueando: false,
    vulnerable: false,
    invulnerable: false,
    saltando: false,
    tirado: false,
    especial: 0,
    agarre: false,
    rompe: false,
    mareado: false,
    pesado: false,
    dashT: -1,
    dashDir: 0,
    dashAdelante: false,
    selloDash: 0,
  }
}

const ESCALERA: readonly Dificultad[] = ['facil', 'normal', 'dificil']
const PROBABILIDADES = [
  'bloquear',
  'agresividad',
  'terminaCadena',
  'castigo',
  'antiaereo',
  'errores',
  'agacharse',
  'adapta',
  'recibir',
] as const

/**
 * Los parámetros de `dificultad` corridos por la pericia del barbero (EstiloCpu.pericia, −1..1):
 * con + van hacia los de la dificultad de arriba (en difícil siguen de largo en esa dirección) y
 * con − hacia los de abajo (en fácil, más torpes todavía). Con 0 son los de la tabla, el mismo
 * objeto. Se calcula una vez por cerebro, con sumas y productos (igual en todos los motores de JS);
 * `especiales` no cambia (es el modo de la dificultad) y `adapta` en 0 queda en 0: ese cero apaga
 * conductas enteras (cubrirse del que se acerca, cuidar la guardia baja) y prenderlas con una
 * pericia mínima era un salto, no un ajuste fino (medido: +0,026 en fácil movía 16 puntos).
 */
export function paramsConPericia(dificultad: Dificultad, pericia: number): ParamsCpu {
  const base = PARAMS_CPU[dificultad] ?? PARAMS_CPU.normal
  const t = Math.max(-1, Math.min(1, Number(pericia) || 0))
  if (t === 0) return base
  const i = Math.max(0, ESCALERA.indexOf(dificultad))
  const arriba = PARAMS_CPU[ESCALERA[Math.min(ESCALERA.length - 1, i + 1)]]
  const abajo = PARAMS_CPU[ESCALERA[Math.max(0, i - 1)]]
  // hacia dónde se corre cada número: hacia el vecino, o lejos del otro vecino en las puntas
  const destino = t > 0 ? (arriba !== base ? arriba : null) : abajo !== base ? abajo : null
  const opuesto = t > 0 ? abajo : arriba
  const f = Math.abs(t)
  const correr = (v: number, k: (q: ParamsCpu) => number) => (destino ? v + (k(destino) - v) * f : v + (v - k(opuesto)) * f)
  const r: ParamsCpu = { ...base, cadencia: [base.cadencia[0], base.cadencia[1]] }
  for (const clave of PROBABILIDADES) {
    if (clave === 'adapta' && base.adapta === 0) continue
    r[clave] = Math.min(1, Math.max(0, correr(base[clave], (q) => q[clave])))
  }
  r.reaccion = Math.min(30, Math.max(2, Math.round(correr(base.reaccion, (q) => q.reaccion))))
  const c0 = Math.max(3, Math.round(correr(base.cadencia[0], (q) => q.cadencia[0])))
  const c1 = Math.max(c0, Math.round(correr(base.cadencia[1], (q) => q.cadencia[1])))
  r.cadencia = [c0, c1]
  return r
}

/** `pericia`: la de EstiloCpu.pericia del barbero en esta dificultad (0 = la tabla tal cual). */
export function crearCerebro(lado: Lado, dificultad: Dificultad, semilla: number, pericia = 0): Cerebro {
  const base = paramsConPericia(dificultad, pericia)
  const historial: Observacion[] = []
  for (let i = 0; i < LARGO_HISTORIAL; i++) historial.push(observacionVacia())
  return {
    lado,
    azar: crearAzar(semilla, 11 + lado),
    base,
    efectivos: { ...base },
    historial,
    idx: 0,
    llenos: 0,
    btn: { golpe: 0, herramienta: 0, especial1: 0, especial2: 0, arriba: 0, dash: 0 },
    prevBtn: { golpe: false, herramienta: false, especial1: false, especial2: false, arriba: false, dash: false },
    dir: 0,
    guardia: false,
    abajo: false,
    plan: 'neutral',
    planT: 0,
    pensar: 0,
    objetivo: 160,
    ataque: 'golpe',
    selloDefensa: 0,
    selloDashVisto: 0,
    selloFlash: 0,
    selloCastigo: 0,
    selloCadena: 0,
    proyVisto: 0,
    esquivar: null,
    rivalEnAire: false,
    pateaEnSalto: false,
    sinAvanzar: 0,
    enAmenaza: false,
    bloqueando: false,
    presionRival: 0,
    selloVisto: 0,
    motivo: '',
    recibio: false,
    merced: false,
    aprovecha: false,
    tantearT: 0,
    final: { decidido: false, remata: false, en: 60, boton: 'golpe' },
    proximoEspecial: 1,
    enfriaEspecial: 0,
    esperaProximo: 0,
  }
}

/** Al empezar cada round: sin planes viejos ni botones apretados. */
export function reiniciarCerebro(c: Cerebro): void {
  c.dir = 0
  c.guardia = false
  c.abajo = false
  c.plan = 'neutral'
  c.planT = 0
  c.pensar = entero(c.azar, 4, 20)
  c.esquivar = null
  c.rivalEnAire = false
  c.pateaEnSalto = false
  c.sinAvanzar = 0
  c.enAmenaza = false
  c.bloqueando = false
  c.llenos = 0
  c.enfriaEspecial = 0
  for (const b of BOTONES_CPU) c.btn[b] = 0
}

function observar(c: Cerebro, p: Partida, I: EstadoInterno, otro: Lado): void {
  const o = c.historial[c.idx]
  c.idx = (c.idx + 1) % LARGO_HISTORIAL
  if (c.llenos < LARGO_HISTORIAL) c.llenos++
  const l = p.luchadores[otro]
  const li = I.luchadores[otro]
  const a = li.accion
  o.x = l.x
  o.y = l.y
  o.vx = l.vx
  o.vy = l.vy
  o.enSuelo = l.enSuelo
  o.libre = puedeActuar(l, li)
  o.atacando = !!a && !a.remate
  o.sello = a ? a.sello : 0
  c.presionRival *= 1 - 1 / 120
  if (o.atacando && o.sello !== c.selloVisto) {
    c.selloVisto = o.sello
    c.presionRival += 1
  }
  if (a) {
    const ini = primeraVentana(a.mov)
    const fin = finVentanas(a.mov)
    o.fase = a.t < ini ? 1 : a.t < fin ? 2 : 3
    o.fallo = o.fase === 3 && !a.contacto
    o.alcance = alcanceDe(a.mov)
    o.restante = Math.max(0, a.total - a.t)
    const emb = (a.mov as DefEspecial).embestida
    if (!l.enSuelo && (a.mov.aereo || a.enAire)) {
      // En el aire el movimiento dura hasta caer: lo que le falta para tocar el piso más lo que
      // tarda en recuperarse al aterrizar (si no, una patada voladora al aire parecía terminada).
      const g = a.enAire && emb?.salto ? emb.salto.gravedad : GRAVEDAD
      const aterriza = a.mov.aereo ? (a.mov.aterrizaje ?? ATERRIZAJE_TICKS) : emb ? (a.acerto ? emb.recuperacionGolpe : emb.recuperacionBloqueo) : 0
      o.restante = ticksParaCaer(l.y, l.vy, g) + aterriza
    }
    o.lanza = !!(a.mov as DefEspecial).proyectil
    o.inseguro = a.especial !== 0 || !a.mov.siguiente || a.mov.boton === 'herramienta'
    o.especial = a.especial
    o.agarre = !!(a.mov as DefEspecial).agarre
    o.rompe = a.especial !== 0 && PERSONAJES[l.id].especiales[a.especial - 1].efecto === 'rompe_guardia'
    o.pesado = a.especial === 0 && a.mov.boton === 'herramienta'
  } else {
    o.pesado = false
    o.especial = 0
    o.agarre = false
    o.rompe = false
    o.fase = 0
    o.fallo = false
    o.alcance = 0
    o.restante = 0
    o.lanza = false
    o.inseguro = false
  }
  o.bloqueando = li.guardia || (li.stun > 0 && li.stunBloqueo)
  const d = li.dash
  o.dashT = d ? d.t : -1
  o.dashDir = d ? d.dir : 0
  o.dashAdelante = !!d && d.adelante
  o.selloDash = li.selloDash
  o.vulnerable =
    l.efectos.congelado > 12 || l.efectos.electrocutado > 12 || l.efectos.guardiaRota > 12 || l.efectos.aturdido > 12 || li.agarradoPor !== null
  o.mareado = l.efectos.mareado > 0
  o.invulnerable = l.invulnerable
  o.saltando = !l.enSuelo && li.caidaDerribo === 0 && li.pose === null
  o.tirado = li.derribo > 0 || li.levantar > 0 || li.caidaDerribo > 0
}

/** Ticks hasta tocar el piso (simulando la caída: nada de raíces en el motor). */
function ticksParaCaer(y: number, vy: number, g: number): number {
  let n = 0
  while (y > 0 && n < 120) {
    y += vy - g / 2
    vy -= g
    n++
  }
  return n
}

function retrasada(c: Cerebro, reaccion: number): Observacion {
  const atras = Math.min(Math.max(0, Math.floor(reaccion)), c.llenos - 1, LARGO_HISTORIAL - 1)
  const i = (c.idx - 1 - Math.max(0, atras) + LARGO_HISTORIAL * 2) % LARGO_HISTORIAL
  return c.historial[i]
}

function apretar(c: Cerebro, b: BotonCpu): boolean {
  if (c.btn[b] > 0 || c.prevBtn[b]) return false
  c.btn[b] = 2
  if (b !== 'arriba' && b !== 'dash') c.sinAvanzar = 0
  return true
}

function ponerPlan(c: Cerebro, plan: Plan, ticks: number): void {
  c.plan = plan
  c.planT = Math.max(1, Math.round(ticks))
  if (plan !== 'guardia') {
    c.guardia = false
    c.abajo = false
  }
}

/** Afloja si el humano va perdiendo feo (sólo fácil y normal, sólo contra humanos). */
function ajustar(c: Cerebro, p: Partida, lado: Lado): ParamsCpu {
  const b = c.base
  const e = c.efectivos
  e.reaccion = b.reaccion
  e.bloquear = b.bloquear
  e.agresividad = b.agresividad
  e.castigo = b.castigo
  e.terminaCadena = b.terminaCadena
  if (p.config.dificultad === 'dificil' || p.config.cpu[(1 - lado) as Lado]) return e
  const yo = p.luchadores[lado]
  const rv = p.luchadores[(1 - lado) as Lado]
  const ventaja =
    yo.vida / yo.vidaMax - rv.vida / rv.vidaMax + (p.rondasGanadas[lado] - p.rondasGanadas[(1 - lado) as Lado]) * 0.25
  if (p.config.dificultad === 'facil' && ventaja > 0.4) {
    e.reaccion = b.reaccion + 8
    e.bloquear = b.bloquear * 0.6
    e.agresividad = b.agresividad * 0.65
    e.castigo = b.castigo * 0.5
    e.terminaCadena = b.terminaCadena * 0.7
  } else if (ventaja > 0.6) {
    // En normal afloja poco y sólo si va ganando muy cómodo (si no, el que machaca botones remonta).
    e.reaccion = b.reaccion + 4
    e.bloquear = b.bloquear * 0.85
    e.agresividad = b.agresividad * 0.85
    e.castigo = b.castigo * 0.8
    e.terminaCadena = b.terminaCadena * 0.9
  }
  return e
}

function alcanceAtaque(k: KitPersonaje, ataque: Ataque): number {
  const mov = k.movimientos[ataque === 'golpe' ? k.inicio.golpe : k.inicio.herramienta]
  if (!mov) return 120
  const avance = mov.avance ? mov.avance.vel * (mov.avance.hasta - mov.avance.desde) : 0
  return alcanceDe(mov) + avance * 0.6 - 6
}

/** Ticks de arranque del primer golpe de `ataque`. */
function arranqueAtaque(k: KitPersonaje, ataque: Ataque): number {
  const mov = k.movimientos[ataque === 'golpe' ? k.inicio.golpe : k.inicio.herramienta]
  return mov?.ventanas[0]?.desde ?? 6
}

/**
 * ¿El castigo con `ataque` pega antes que lo próximo del rival? Lo que ve está atrasado `reaccion`
 * ticks, pero sabe cuánto dura lo que vio (como una persona que ya lo bloqueó una vez): al rival le
 * quedan ≈ `ob.restante - reaccion` de recuperación y, si después tira su golpe más rápido, pega
 * `arranque` ticks más tarde. Sin esta cuenta castigaba un puño al aire cuando el otro ya estaba
 * tirando el siguiente y se comía la cadena entera (contra el que entra con la esquiva y machaca
 * GOLPE perdía 9 de 10 en normal).
 */
function castigoLlega(k: KitPersonaje, ataque: Ataque, ob: Observacion, reaccion: number, rival: KitPersonaje): boolean {
  return ob.restante - reaccion + arranqueAtaque(rival, 'golpe') >= arranqueAtaque(k, ataque) + 1
}

/** A uno o dos golpes pesados de que le rompan la guardia. */
function guardiaBajaDe(guardia: number, rival: KitPersonaje, yo: KitPersonaje): boolean {
  return guardia <= Math.max(35, golpeGuardiaRival(rival, yo) * 1.3)
}

/** El golpe normal que más guardia le saca (con su pasiva de guardia). */
function golpeGuardiaRival(rival: KitPersonaje, yo: KitPersonaje): number {
  let max = 0
  for (const m of Object.values(rival.movimientos)) for (const v of m.ventanas) max = Math.max(max, v.danioGuardia)
  return max * (yo.pasiva?.multDanioGuardia ?? 1)
}

function elegirAtaque(c: Cerebro, k: KitPersonaje, ob: Observacion, rival?: KitPersonaje): Ataque {
  if (ob.vulnerable && chance(c.azar, 0.6)) return 'herramienta'
  // Contra uno con armadura a los golpes leves (Brian, Chipi con la máquina), el puño no lo frena:
  // la herramienta sí.
  const rivalArmado =
    !!rival?.pasiva?.armaduraAtaques?.includes('leve') || !!rival?.movimientos[rival.inicio.herramienta]?.armadura?.contra.includes('leve')
  if (rivalArmado && ob.atacando && chance(c.azar, 0.3 + c.efectivos.adapta * 0.6)) return 'herramienta'
  // Contra alguien que está atacando: si la herramienta aguanta golpes leves (Chipi), la herramienta;
  // si no, lo más rápido (la herramienta es lenta y la cortan).
  if ((ob.atacando || c.presionRival > 2) && !ob.bloqueando && chance(c.azar, 0.3 + c.efectivos.adapta * 0.7)) {
    const armada = k.movimientos[k.inicio.herramienta]?.armadura?.contra.includes('leve')
    return armada ? 'herramienta' : 'golpe'
  }
  if (ob.bloqueando && chance(c.azar, 0.55)) return 'herramienta'
  return chance(c.azar, k.cpu.herramienta) ? 'herramienta' : 'golpe'
}

/** El especial más barato que le alcanza la carga (0 = ninguno). */
function especialMasBarato(carga: number, especiales: readonly { costo: number }[]): 0 | 1 | 2 {
  let mejor: 0 | 1 | 2 = 0
  for (const n of [1, 2] as const) {
    const costo = especiales[n - 1].costo
    if (carga + 1e-9 >= costo && (mejor === 0 || costo < especiales[mejor - 1].costo)) mejor = n
  }
  return mejor
}

/** ¿La embestida llega antes de que el rival termine su movimiento (o mientras está a merced)? */
function embestidaLlega(k: KitPersonaje, n: 1 | 2, dist: number, ob: Observacion, reaccion: number): boolean {
  if (ob.vulnerable) return true
  const emb = k.especiales[n - 1].embestida
  if (!emb || !ob.atacando || ob.fase !== 3) return false
  const llega = emb.desde + Math.max(0, dist - 90) / (emb.distancia / emb.ticks)
  return ob.restante - reaccion > llega + 2
}

/** El especial con el que castiga de lejos (una embestida larga), o 0. */
function especialDeCastigo(k: KitPersonaje): 0 | 1 | 2 {
  for (const n of [1, 2] as const) {
    const e = k.especiales[n - 1].embestida
    if (e && e.distancia >= 200 && !e.invulnerableHasta) return n
  }
  return 0
}

/** Para qué sirve cada especial, según su mecánica. */
type Uso =
  | 'embestida'
  | 'reves'
  | 'antiaereo'
  | 'recto'
  | 'rastrero'
  | 'arco'
  | 'chorro'
  | 'diferido'
  | 'onda'
  | 'agarre'
  | 'cura'
  | 'cerca'
  | 'bumeran'

export function usoDe(esp: DefEspecial): Uso {
  if (esp.cura) return 'cura'
  if (esp.agarre) return 'agarre'
  const emb = esp.embestida
  if (emb?.salto && emb.distancia < 200) return 'antiaereo'
  if (emb?.invulnerableHasta) return 'reves'
  if (emb) return 'embestida'
  const pr = esp.proyectil
  if (!pr) return 'cerca'
  if (pr.diferido) return 'diferido'
  if (pr.onda) return 'onda'
  if (pr.chorro) return 'chorro'
  if (pr.rastrero) return 'rastrero'
  if (pr.bumeran) return 'bumeran'
  if (pr.gravedad > 0) return 'arco'
  if (Math.abs(pr.vx) * pr.vida < 420) return 'cerca'
  return 'recto'
}

/**
 * Cuánto conviene tirar ESE especial ahora (0..1), por su mecánica. `dentro` = en su rango de
 * distancia (EstiloCpu.rangoEspecial).
 */
function conveniencia(
  uso: Uso,
  esp: DefEspecial,
  k: KitPersonaje,
  n: 1 | 2,
  p: Partida,
  lado: Lado,
  dist: number,
  dentro: boolean,
  ob: Observacion,
  prm: ParamsCpu,
): number {
  const yo = p.luchadores[lado]
  const libre = ob.enSuelo && !ob.tirado && !ob.invulnerable
  const recupera = ob.atacando && ob.fase === 3
  switch (uso) {
    case 'cura': {
      const falta = yo.vidaMax - yo.vida
      if (falta < yo.vidaMax * 0.2) return 0
      const lejos = dist > 300 || ob.tirado || (ob.vulnerable && dist > 160)
      return lejos ? (yo.vida < yo.vidaMax * 0.5 ? 0.85 : 0.45) : 0
    }
    case 'agarre':
      if (!ob.enSuelo || ob.saltando || ob.invulnerable || ob.tirado || dist > (k.cpu.rangoEspecial[n - 1][1] || 118)) return 0
      return ob.bloqueando || ob.mareado ? 0.9 : recupera ? 0.8 : ob.atacando ? 0.15 : 0.35
    case 'antiaereo':
      if (ob.saltando && dist >= 50 && dist <= 260) return 0.85
      if (!dentro || !libre) return 0
      return ob.bloqueando ? 0.5 : recupera || ob.vulnerable ? 0.6 : 0.08
    case 'reves':
      if (ob.vulnerable && dentro) return 0.8
      if (ob.atacando && !ob.lanza && ob.fase <= 2 && dist < 200) return 0.55
      if (!dentro || !libre) return 0
      return recupera ? 0.6 : ob.bloqueando ? 0.04 : 0.14
    case 'embestida':
      if (embestidaLlega(k, n, dist, ob, prm.reaccion)) return 0.9
      if (!dentro || !libre || ob.atacando) return 0
      return ob.bloqueando ? 0.02 : ob.mareado ? 0.6 : 0.1
    case 'rastrero': {
      if (!dentro || !ob.enSuelo || ob.saltando || ob.tirado) return 0
      const imbloqueable = !!esp.proyectil?.imbloqueable
      if (ob.bloqueando) return imbloqueable ? 0.55 : 0.08
      return recupera ? 0.5 : 0.28
    }
    case 'recto':
    case 'bumeran':
      if (!dentro || !libre) return 0
      if (ob.bloqueando) return 0.06
      return recupera ? 0.5 : dist > 230 ? 0.3 : 0.1
    case 'arco':
      if (!dentro || ob.saltando || ob.tirado) return 0
      return ob.bloqueando ? 0.1 : recupera || ob.mareado ? 0.5 : 0.24
    case 'chorro':
      if (!dentro || !libre) return 0
      return ob.bloqueando ? 0.06 : recupera || ob.mareado ? 0.6 : ob.atacando ? 0.1 : 0.26
    case 'diferido':
      if (!dentro || !ob.enSuelo || ob.saltando || ob.tirado) return 0
      return ob.bloqueando || ob.vulnerable || ob.mareado ? 0.55 : recupera ? 0.5 : 0.2
    case 'onda':
      if (!ob.enSuelo || ob.tirado || ob.invulnerable) return 0
      if (ob.atacando && !ob.lanza && dist < 190) return 0.45
      if (!dentro) return 0
      return recupera ? 0.5 : ob.bloqueando ? 0.15 : 0.18
    case 'cerca':
    default: {
      if (!dentro || !libre) return 0
      const rompe = PERSONAJES[yo.id].especiales[n - 1].efecto === 'rompe_guardia'
      if (ob.bloqueando) return rompe ? 0.6 : 0.05
      return recupera || ob.vulnerable || ob.mareado ? 0.65 : 0.2
    }
  }
}

/** ¿Tira un especial ahora? 0 = no. */
function quiereEspecial(c: Cerebro, p: Partida, I: EstadoInterno, lado: Lado, prm: ParamsCpu, dist: number, ob: Observacion): 0 | 1 | 2 {
  const yo = p.luchadores[lado]
  const ficha = PERSONAJES[yo.id]
  const k = I.kits[lado]
  const lleno = yo.carga >= 9
  for (const n of [c.proximoEspecial, c.proximoEspecial === 1 ? 2 : 1] as const) {
    const esp = ficha.especiales[n - 1]
    if (yo.carga + 1e-9 < esp.costo) continue
    const [rmin, rmax] = k.cpu.rangoEspecial[n - 1]
    const dentro = dist >= rmin && dist <= rmax
    let pr = 0
    if (prm.especiales === 'torpe') {
      // Lento y mal apuntado: la misma lectura que las otras dificultades pero con pocas ganas,
      // y a veces lo tira desde más lejos de lo que llega (se queda corto).
      const def = k.especiales[n - 1]
      const s = conveniencia(usoDe(def), def, k, n, p, lado, dist, dentro, ob, prm)
      if (c.enfriaEspecial > 0) continue
      pr = dist > rmax + 40 ? 0.03 : s * 0.22
    } else {
      const def = k.especiales[n - 1]
      const s = conveniencia(usoDe(def), def, k, n, p, lado, dist, dentro, ob, prm)
      // Un castigo seguro sale siempre; lo demás espera el enfriamiento.
      if (s < 0.6 && c.enfriaEspecial > 0) continue
      // Junta carga para el que toca ahora: el otro sólo sale en una oportunidad clara, con la carga
      // llena o si hace mucho que espera (así usa los dos y no gasta todo en el barato).
      if (n !== c.proximoEspecial && s < 0.6 && !lleno && c.esperaProximo < esperaMaxima(ficha.especiales[c.proximoEspecial - 1].costo)) continue
      pr = (prm.especiales === 'castiga' ? s : s * 0.55) * k.cpu.preferencia[n - 1]
    }
    if (lleno && pr > 0) pr = Math.min(1, pr * 1.8 + 0.04)
    if (chance(c.azar, pr)) return n
  }
  return 0
}

/** Cuánto espera juntando carga para el especial que le toca antes de conformarse con el otro. */
function esperaMaxima(costo: number): number {
  return costo * 132 + 300
}

/** Lo que hace después de tirar un especial: alterna y espera un rato antes de otro. */
function tiroEspecial(c: Cerebro, n: 1 | 2, prm: ParamsCpu): void {
  c.proximoEspecial = n === 1 ? 2 : 1
  c.esperaProximo = 0
  c.enfriaEspecial = prm.especiales === 'castiga' ? 50 : prm.especiales === 'alcance' ? 110 : 200
}

/** El plan de fondo cuando no hay nada urgente (se vuelve a pensar cada `cadencia` ticks). */
function decidirPlan(c: Cerebro, p: Partida, I: EstadoInterno, lado: Lado, prm: ParamsCpu, dist: number, ob: Observacion): void {
  const yo = p.luchadores[lado]
  const li = I.luchadores[lado]
  const k = I.kits[lado]
  const r = azar(c.azar)
  const hacia: -1 | 1 = ob.x >= yo.x ? 1 : -1
  const alcMio = alcanceAtaque(k, 'golpe')
  const alcRival = alcanceAtaque(I.kits[(1 - lado) as Lado], 'golpe')
  c.pensar = entero(c.azar, prm.cadencia[0], prm.cadencia[1])
  c.objetivo = k.cpu.distancia + entero(c.azar, -25, 25)

  if (dist > 330) {
    // Lejos: se acerca (a veces con dash o saltando).
    if (r < 0.06 + 0.1 * prm.agresividad && li.dashEspera === 0) {
      c.dir = hacia
      apretar(c, 'dash')
      c.motivo = 'dash lejos'
      ponerPlan(c, 'mantener', 4)
    } else if (r < 0.2 && ob.enSuelo) {
      saltarHacia(c, prm, hacia)
    } else {
      ponerPlan(c, 'acercarse', entero(c.azar, 25, 60))
    }
    return
  }
  if (dist > Math.max(alcMio, alcRival) + 12) {
    // Media distancia: tantea, espera el error del otro y a veces entra.
    const presion = Math.min(1, c.presionRival / 4) * prm.adapta
    const pEntra = prm.agresividad * 0.22 * (1 - presion * 0.7)
    if (r < pEntra) {
      c.ataque = elegirAtaque(c, k, ob, I.kits[(1 - lado) as Lado])
      ponerPlan(c, 'presionar', 45)
    } else if (r < pEntra + 0.05 && ob.enSuelo) {
      saltarHacia(c, prm, hacia)
    } else if (r < pEntra + 0.05 + 0.06 * prm.agresividad && li.dashEspera === 0 && dist > 200 && presion < 0.3) {
      // Entrar con dash, sólo si el otro no está tirando golpes a lo loco (si no, termina el dash en su puño).
      c.dir = hacia
      apretar(c, 'dash')
      c.motivo = 'dash entra'
      c.ataque = elegirAtaque(c, k, ob, I.kits[(1 - lado) as Lado])
      ponerPlan(c, 'presionar', 40)
    } else if (chance(c.azar, prm.errores * 0.4)) {
      // Error humano: ataca de lejos y queda expuesto.
      apretar(c, elegirAtaque(c, k, ob, I.kits[(1 - lado) as Lado]))
      c.motivo = 'error'
      ponerPlan(c, 'esperar', 6)
    } else if (r < pEntra + 0.5) {
      ponerPlan(c, 'tantear', entero(c.azar, 20, 45))
    } else if (r < pEntra + 0.68) {
      ponerPlan(c, 'esperar', entero(c.azar, 10, 24))
    } else if (r < pEntra + 0.8) {
      ponerPlan(c, 'guardia', entero(c.azar, 14, 28))
      c.abajo = chance(c.azar, prm.agacharse)
    } else {
      ponerPlan(c, 'alejarse', entero(c.azar, 8, 18))
    }
    return
  }
  // Cerca: el que se equivoca primero, pierde. Contra un rival que ataca mucho, se cubre y castiga.
  const presion = Math.min(1, c.presionRival / 4) * prm.adapta
  const pAtaca = prm.agresividad * 0.3 * (1 - presion)
  const pGuardia = 0.12 + prm.bloquear * 0.45 + presion * 0.5
  if (r < pAtaca && dist <= alcMio + 20) {
    apretar(c, elegirAtaque(c, k, ob, I.kits[(1 - lado) as Lado]))
    c.motivo = 'cerca'
    ponerPlan(c, 'esperar', 4)
  } else if (r < pAtaca + pGuardia) {
    ponerPlan(c, 'guardia', entero(c.azar, 14, 32))
    c.abajo = chance(c.azar, prm.agacharse)
  } else if (r < pAtaca + pGuardia + 0.22) {
    if (prm.especiales === 'castiga' && li.dashEspera === 0 && chance(c.azar, 0.35)) {
      c.dir = (-hacia) as -1 | 1
      apretar(c, 'dash')
      c.motivo = 'dash atras cerca'
      ponerPlan(c, 'mantener', 4)
    } else ponerPlan(c, 'alejarse', entero(c.azar, 10, 22))
  } else if (prm.adapta > 0 && (presion > 0.2 || dist <= alcRival + 10)) {
    ponerPlan(c, 'guardia', entero(c.azar, 10, 20))
    c.abajo = chance(c.azar, prm.agacharse)
  } else {
    ponerPlan(c, 'esperar', entero(c.azar, 6, 14))
  }
}

/** Cómo se defiende de cada proyectil (null = no reacciona). */
function reaccionA(q: ProyectilEstado, prm: ParamsCpu, r: number): ModoEsquiva | null {
  const nivel = prm.especiales === 'torpe' ? 0 : prm.especiales === 'alcance' ? 1 : 2
  const esquiva = [0.2, 0.55, 0.88][nivel]
  // Lo grande y lento se ve venir: hasta la fácil se cubre (aunque igual la arrastre a la pared).
  const cubre = Math.max(prm.bloquear, 0.45)
  switch (q.tipo) {
    case 'sillon':
      if (nivel === 2) return r < 0.55 ? 'dash' : r < 0.85 ? 'saltar' : 'guardia'
      if (r < prm.bloquear * 0.7) return 'guardia'
      return r < prm.bloquear * 0.7 + 0.2 ? 'saltar' : null
    case 'tornado':
      if (r < prm.bloquear + 0.1) return 'guardia'
      return nivel === 2 && r < prm.bloquear + 0.3 ? 'dash' : null
    case 'bombo':
      // Rastrero: se salta (bloqueado gasta guardia). Ni la difícil lo salta siempre.
      return r < esquiva * 0.75 ? 'saltar' : r < esquiva * 0.75 + cubre * 0.6 ? 'guardia' : null
    case 'sismo':
      // Imbloqueable de pie: hay que saltarlo.
      return r < esquiva * (nivel === 2 ? 0.75 : 0.85) ? 'saltar' : null
    case 'onda':
      // Se pasa con la esquiva; si no, a cubrirse (igual lo arrastra).
      return r < esquiva * 0.9 ? 'dash' : r < esquiva * 0.9 + cubre ? 'guardia' : null
    case 'graffiti':
      return r < esquiva * 0.7 ? 'salir' : r < esquiva * 0.7 + prm.bloquear * 0.5 ? 'guardia' : null
    case 'guante':
      // Rompe la guardia: mejor saltarlo o esquivarlo para atrás.
      return r < esquiva * 0.8 ? (r < esquiva * 0.4 ? 'saltar' : 'dash') : r < esquiva * 0.8 + prm.bloquear * 0.3 ? 'guardia' : null
    case 'pelota':
      return r < esquiva * 0.45 ? 'saltar' : r < esquiva * 0.45 + prm.bloquear ? 'guardia' : null
    default:
      return r < prm.bloquear + (nivel === 2 ? 0.1 : 0) ? 'guardia' : null
  }
}

function saltarHacia(c: Cerebro, prm: ParamsCpu, hacia: -1 | 1): void {
  c.dir = hacia
  apretar(c, 'arriba')
  c.pateaEnSalto = chance(c.azar, 0.5 + 0.45 * prm.agresividad)
  ponerPlan(c, 'mantener', 3)
}

function pensarPelea(c: Cerebro, p: Partida, I: EstadoInterno, lado: Lado): void {
  const yo = p.luchadores[lado]
  const li = I.luchadores[lado]
  const k = I.kits[lado]
  const prm = ajustar(c, p, lado)
  const ob = retrasada(c, prm.reaccion)
  // Como un humano: ve con retraso pero anticipa hacia dónde se mueve el otro.
  const xPredicho = ob.enSuelo ? ob.x + ob.vx * Math.min(prm.reaccion, 12) : ob.x
  const dist = Math.abs(xPredicho - yo.x)
  const hacia: -1 | 1 = ob.x >= yo.x ? 1 : -1
  const ficha = PERSONAJES[yo.id]
  const alcMio = alcanceAtaque(k, 'golpe')
  const alcRival = alcanceAtaque(I.kits[(1 - lado) as Lado], 'golpe')
  if (c.planT > 0) c.planT--
  if (c.pensar > 0) c.pensar--
  if (c.enfriaEspecial > 0) c.enfriaEspecial--
  if (c.esperaProximo < 100000) c.esperaProximo++

  // Su propio movimiento: seguir la cadena o cancelar en especial (decide una vez por golpe).
  const a = li.accion
  if (a) {
    c.dir = 0
    c.guardia = false
    c.abajo = false
    c.sinAvanzar = 0
    if (!a.remate && a.especial === 0 && !a.mov.aereo && c.selloCadena !== a.sello && (a.contacto || a.t >= finVentanas(a.mov))) {
      c.selloCadena = a.sello
      const nc = k.cpu.especialDeCombo
      if (
        a.acerto &&
        nc !== 0 &&
        prm.especiales !== 'torpe' &&
        yo.carga + 1e-9 >= ficha.especiales[nc - 1].costo &&
        // Cerrar un golpe que entró con el especial es lo mejor que se puede hacer con la carga (la
        // persona que machaca GOLPE y el especial lo hace sin pensar): sin esperar el turno de ese
        // especial. Con 0,2 y alternando, la CPU normal jugaba peor a Gabriel que un bot.
        chance(c.azar, prm.especiales === 'castiga' ? 0.6 : 0.4)
      ) {
        apretar(c, nc === 1 ? 'especial1' : 'especial2')
        tiroEspecial(c, nc, prm)
        c.motivo = 'especial combo'
        return
      }
      if (a.mov.siguiente && a.mov.boton) {
        const primero = a.mov.id === k.inicio.golpe || a.mov.id === k.inicio.herramienta
        const pBase = primero ? Math.min(1, prm.terminaCadena + 0.25) : prm.terminaCadena
        const pr = a.acerto ? pBase : a.contacto ? pBase * 0.4 : prm.errores
        if (chance(c.azar, pr)) {
          apretar(c, a.mov.boton)
          c.motivo = 'cadena'
        }
      }
    }
    return
  }

  if (!yo.enSuelo) {
    c.guardia = false
    c.abajo = false
    if (c.pateaEnSalto && !li.pateoAereo && li.caidaDerribo === 0 && yo.vy < 5 && dist < 150) {
      apretar(c, 'golpe')
      c.motivo = 'patada aerea'
      c.pateaEnSalto = false
    }
    return
  }

  if (!puedeActuar(yo, li)) {
    // En blockstun sigue cubierto (y se acuerda para castigar); en cualquier otro aturdimiento, suelta.
    if (li.stun > 0 && li.stunBloqueo) c.bloqueando = true
    else c.guardia = false
    c.dir = 0
    return
  }
  const salioDeBloqueo = c.bloqueando
  c.bloqueando = false

  // ─── Reacciones (una vez por estímulo) ───

  // 1) Castigar lo que bloqueó (fin de cadena, herramienta, especial): de cerca con el golpe, de lejos
  //    con la embestida si tiene carga.
  if (salioDeBloqueo && ob.atacando && ob.inseguro && c.selloCastigo !== ob.sello) {
    c.selloCastigo = ob.sello
    const embestida = especialDeCastigo(k)
    if (dist <= alcMio + 6 && castigoLlega(k, 'golpe', ob, prm.reaccion, I.kits[(1 - lado) as Lado]) && chance(c.azar, prm.castigo)) {
      apretar(c, 'golpe')
      c.motivo = 'castigo bloqueo'
      ponerPlan(c, 'esperar', 4)
      return
    }
    if (
      embestida !== 0 &&
      prm.especiales !== 'torpe' &&
      yo.carga + 1e-9 >= ficha.especiales[embestida - 1].costo &&
      embestidaLlega(k, embestida, dist, ob, prm.reaccion) &&
      chance(c.azar, prm.castigo * 0.8)
    ) {
      apretar(c, embestida === 1 ? 'especial1' : 'especial2')
      tiroEspecial(c, embestida, prm)
      c.motivo = 'castigo bloqueo embestida'
      ponerPlan(c, 'esperar', 6)
      return
    }
  }
  // Con la guardia a uno o dos golpes pesados de romperse, cubrirse es regalarse: se va o lo
  // corta. Antes miraba sólo «menos de 35» y la CPU normal se cubría de la MÁQUINA hasta que se la
  // rompían (machacar la herramienta de cerca le ganaba 3 de 4).
  const guardiaBaja = prm.adapta > 0 && guardiaBajaDe(yo.guardia, I.kits[(1 - lado) as Lado], k)

  // 2) Un ataque cuerpo a cuerpo (o la embestida) que viene. Si ya se venía cubriendo, sigue.
  //    Contra un agarre o algo que rompe la guardia, cubrirse no sirve: salta o se va.
  if (ob.atacando && !ob.lanza && (ob.agarre || ob.rompe) && ob.fase <= 2 && c.selloDefensa !== ob.sello && dist <= ob.alcance + 40) {
    c.selloDefensa = ob.sello
    // Pocas veces: un agarre de 8 ticks no se ve venir (el super flash avisa, pero no tanto).
    const pEsquiva = prm.especiales === 'torpe' ? 0.1 : 0.33
    if (chance(c.azar, pEsquiva)) {
      if (ob.agarre || li.dashEspera > 0) {
        c.dir = (-hacia) as -1 | 1
        apretar(c, 'arriba')
        c.pateaEnSalto = false
        c.motivo = ob.agarre ? 'salta el agarre' : 'salta lo que rompe'
      } else {
        c.dir = (-hacia) as -1 | 1
        apretar(c, 'dash')
        c.motivo = 'esquiva lo que rompe'
      }
      ponerPlan(c, 'mantener', 4)
      return
    }
  }
  if (ob.atacando && !ob.lanza && (ob.fase === 1 || ob.fase === 2) && c.selloDefensa !== ob.sello && dist <= ob.alcance + 25) {
    c.selloDefensa = ob.sello
    const yaCubierto = c.plan === 'guardia' && c.planT > 0
    // Un golpe pesado se ve venir: dejarlo pasar con la esquiva para atrás y castigar la vuelta.
    if (ob.pesado && ob.fase === 1 && li.dashEspera === 0 && chance(c.azar, prm.adapta * 0.5)) {
      c.dir = (-hacia) as -1 | 1
      apretar(c, 'dash')
      c.motivo = 'esquiva el pesado'
      ponerPlan(c, 'mantener', 4)
      return
    }
    // Con la guardia por romperse: un especial de revés (aguanta los golpes normales al arrancar)
    // si tiene carga; si no, dash para atrás.
    const reves = guardiaBaja && prm.especiales !== 'torpe' ? especialMasBarato(yo.carga, ficha.especiales) : 0
    if (reves && chance(c.azar, prm.adapta)) {
      apretar(c, reves === 1 ? 'especial1' : 'especial2')
      tiroEspecial(c, reves, prm)
      c.motivo = 'reves guardia baja'
      ponerPlan(c, 'esperar', 6)
      return
    } else if (guardiaBaja && li.dashEspera === 0 && chance(c.azar, prm.adapta)) {
      c.dir = (-hacia) as -1 | 1
      apretar(c, 'dash')
      c.motivo = 'escapa guardia baja'
      ponerPlan(c, 'mantener', 4)
      return
    } else if (chance(c.azar, yaCubierto ? Math.max(prm.bloquear, 0.85) : prm.bloquear)) {
      const abajo = yaCubierto ? c.abajo : chance(c.azar, prm.agacharse)
      ponerPlan(c, 'guardia', ob.restante + entero(c.azar, 6, 14))
      c.abajo = abajo
    } else if (prm.especiales === 'castiga' && li.dashEspera === 0 && chance(c.azar, 0.2)) {
      c.dir = (-hacia) as -1 | 1
      apretar(c, 'dash')
      c.motivo = 'dash reaccion'
      ponerPlan(c, 'mantener', 4)
      return
    }
  }

  // 2b) El super flash avisa: un especial que tira algo se ve venir antes de que salga el proyectil
  //     (una persona ve «MAMADERA A PRESIÓN» con el mundo congelado y deja apretada la guardia).
  //     Antes la CPU esperaba a que el proyectil tuviera `reaccion` ticks: un chorro o una pelota
  //     ya le habían pegado. Sólo se cubre de lo que se puede bloquear de pie y no rompe la guardia
  //     (lo que va por el piso, la onda y el graffiti tienen su propia esquiva, más abajo).
  if (ob.especial !== 0 && ob.lanza && ob.fase === 1 && c.selloFlash !== ob.sello) {
    c.selloFlash = ob.sello
    const er = I.kits[(1 - lado) as Lado].especiales[ob.especial - 1]
    const pr = er.proyectil
    const efecto = PERSONAJES[p.luchadores[(1 - lado) as Lado].id].especiales[ob.especial - 1].efecto
    const cubrible = !!pr && !pr.rastrero && !pr.onda && !pr.diferido && !pr.imbloqueable && efecto !== 'rompe_guardia'
    const alcanza = !!pr && dist <= (pr.chorro ? (pr.anchoFinal ?? pr.ancho) + pr.salidaX + 60 : 700)
    if (cubrible && alcanza && !guardiaBaja && chance(c.azar, prm.bloquear)) {
      // El plan corre también durante el super flash: lo que queda del flash, el arranque y el vuelo.
      const falta = 24 - prm.reaccion + (er.lanzamiento?.desde ?? 10)
      ponerPlan(c, 'guardia', Math.max(10, falta) + (pr.chorro ? pr.vida : 24) + entero(c.azar, 4, 10))
      c.abajo = false
      c.motivo = 'lo vio venir'
    }
  }

  // 2c) Se le viene encima con la esquiva: un golpe que entre cuando se le termina lo invulnerable
  //     lo frena en seco; si no llega, se cubre (agachado, el puño pasa por arriba). Sin esto, el
  //     que entraba con la esquiva y machacaba GOLPE le ganaba 9 de cada 10 a la CPU normal.
  if (ob.dashT >= 0 && ob.dashAdelante && c.selloDashVisto !== ob.selloDash) {
    c.selloDashVisto = ob.selloDash
    const kr = I.kits[(1 - lado) as Lado]
    const total = kr.dash.ticks
    const invul = kr.dash.invulnerable ?? DASH.invulnerable
    const puno = k.movimientos[k.inicio.golpe]?.ventanas[0]
    const ahora = ob.dashT + prm.reaccion
    if (puno && ahora < total) {
      const t0 = ahora + puno.desde
      const t1 = t0 + puno.ticks - 1
      const curva = (s: number) => {
        const u = 1 - Math.min(s, total) / total
        return 1 - u * u
      }
      const xLlega = ob.x + ob.dashDir * kr.dash.adelante * (curva(t0) - curva(ob.dashT))
      const llega = Math.abs(xLlega - yo.x) <= alcMio + 4
      if (llega && t1 >= invul && chance(c.azar, 0.3 + prm.adapta * 0.55)) {
        apretar(c, 'golpe')
        c.motivo = 'corta la esquiva'
        ponerPlan(c, 'esperar', 4)
        return
      }
      if (!guardiaBaja && chance(c.azar, Math.max(prm.bloquear, 0.5))) {
        ponerPlan(c, 'guardia', total - ahora + entero(c.azar, 10, 18))
        c.abajo = chance(c.azar, prm.agacharse)
        c.motivo = 'se cubre de la esquiva'
      }
    }
  }

  // 3) El rival se mete en su alcance: se cubre o lo recibe con un golpe.
  const amenaza = dist <= alcRival + 30 && (ob.vx * hacia < -0.5 || ob.atacando)
  if (amenaza && !c.enAmenaza && c.plan !== 'guardia' && c.plan !== 'presionar') {
    if (guardiaBaja && chance(c.azar, prm.adapta)) {
      ponerPlan(c, 'alejarse', entero(c.azar, 14, 26))
      c.motivo = 'se aleja guardia baja'
    } else if (chance(c.azar, prm.bloquear * 0.8)) {
      ponerPlan(c, 'guardia', entero(c.azar, 18, 36))
      c.abajo = chance(c.azar, prm.agacharse)
    } else if (dist <= alcMio + 10 && chance(c.azar, prm.agresividad * 0.4)) {
      apretar(c, 'golpe')
      c.motivo = 'amenaza'
      ponerPlan(c, 'esperar', 4)
      c.enAmenaza = amenaza
      return
    }
  }
  c.enAmenaza = amenaza

  // 3b) Recibir al que se viene acercando caminando, justo cuando entra en el alcance: con la
  //     herramienta si aguanta golpes leves (Chipi); si no, con el puño, que es lo que sale antes.
  const acercandose = ob.enSuelo && !ob.atacando && ob.vx * hacia < -0.8
  if (acercandose && !c.recibio) {
    const herr = k.movimientos[k.inicio.herramienta]
    const armada = herr?.armadura?.contra.includes('leve') ?? false
    const atq: Ataque = armada ? 'herramienta' : 'golpe'
    const mov = k.movimientos[atq === 'golpe' ? k.inicio.golpe : k.inicio.herramienta]
    const arranque = mov?.ventanas[0]?.desde ?? 8
    const cierre = -ob.vx * hacia
    const enImpacto = dist - cierre * arranque
    const alc = alcanceAtaque(k, atq)
    const kitRival = I.kits[(1 - lado) as Lado]
    const punoRival = kitRival.movimientos[kitRival.inicio.golpe]?.ventanas[0]?.desde ?? 5
    // Tiene que pegar antes de que el otro llegue a su alcance y le meta el puño (salvo con armadura).
    const llegaAntes = armada || (dist - alcRival) / Math.max(0.5, cierre) + punoRival >= arranque
    if (enImpacto <= alc - 4 && enImpacto > alc - 50 && llegaAntes) {
      c.recibio = true
      if (chance(c.azar, prm.recibir)) {
        apretar(c, atq)
        c.motivo = 'recibe'
        ponerPlan(c, 'esperar', 6)
        return
      }
    }
  } else if (!acercandose) c.recibio = false

  // 4) Proyectiles del rival (los nota después de su tiempo de reacción), cada uno a su manera.
  for (const q of p.proyectiles) {
    if (q.duenio === lado || q.golpesRestantes <= 0 || q.id <= c.proyVisto || q.edad < prm.reaccion || q.tipo === 'nube') continue
    const dq = Math.abs(q.x - yo.x)
    const fijo = q.tipo === 'graffiti'
    const viene = fijo || (q.vx > 0 && q.x < yo.x) || (q.vx < 0 && q.x > yo.x) || dq < 90
    if (!viene || dq > 360) continue
    c.proyVisto = q.id
    const modo = reaccionA(q, prm, azar(c.azar))
    if (modo) c.esquivar = { id: q.id, modo }
  }
  if (c.esquivar) {
    const q = p.proyectiles.find((x) => x.id === c.esquivar?.id)
    if (!q || q.golpesRestantes <= 0) c.esquivar = null
    else {
      const dq = Math.abs(q.x - yo.x)
      const modo = c.esquivar.modo
      if (modo === 'guardia' && dq < 260) {
        ponerPlan(c, 'guardia', 30)
        c.abajo = false
        c.esquivar = null
      } else if (modo === 'dash' && dq < 125 && li.dashEspera === 0) {
        c.dir = q.x >= yo.x ? 1 : -1
        apretar(c, 'dash')
        c.motivo = 'esquiva dash'
        ponerPlan(c, 'mantener', 3)
        c.esquivar = null
        return
      } else if (modo === 'saltar' && dq < 210) {
        c.dir = (q.x >= yo.x ? -1 : 1) as -1 | 1
        apretar(c, 'arriba')
        c.pateaEnSalto = false
        ponerPlan(c, 'mantener', 3)
        c.esquivar = null
        return
      } else if (modo === 'salir') {
        // El graffiti: salir del área antes de que estalle (con la esquiva si la tiene).
        const fuera: -1 | 1 = yo.x >= q.x ? 1 : -1
        c.dir = fuera
        if (li.dashEspera === 0 && dq < q.ancho / 2 + 40) apretar(c, 'dash')
        c.motivo = 'sale del graffiti'
        ponerPlan(c, 'mantener', 16)
        c.esquivar = null
        return
      }
    }
  }
  // La nube del rival: no quedarse adentro (salvo en fácil, a veces).
  const nube = p.proyectiles.find((q) => q.tipo === 'nube' && q.duenio !== lado && Math.abs(q.x - yo.x) < q.ancho / 2 + 24)
  if (nube && c.plan !== 'mantener' && chance(c.azar, prm.especiales === 'torpe' ? 0.1 : 0.6)) {
    c.dir = yo.x >= nube.x ? 1 : -1
    c.motivo = 'sale de la nube'
    ponerPlan(c, 'mantener', 12)
    return
  }

  // 5) Castigar un ataque que falló (o la embestida bloqueada desde lejos).
  if (ob.atacando && ob.fase === 3 && ob.fallo && c.selloCastigo !== ob.sello) {
    c.selloCastigo = ob.sello
    if (chance(c.azar, prm.castigo)) {
      const embestida = especialDeCastigo(k)
      if (dist <= alcMio + 4 && castigoLlega(k, 'golpe', ob, prm.reaccion, I.kits[(1 - lado) as Lado])) {
        apretar(c, 'golpe')
        c.motivo = 'castigo fallo'
        ponerPlan(c, 'esperar', 4)
        return
      }
      if (
        embestida !== 0 &&
        prm.especiales !== 'torpe' &&
        yo.carga + 1e-9 >= ficha.especiales[embestida - 1].costo &&
        embestidaLlega(k, embestida, dist, ob, prm.reaccion)
      ) {
        apretar(c, embestida === 1 ? 'especial1' : 'especial2')
        tiroEspecial(c, embestida, prm)
        c.motivo = 'castigo fallo embestida'
        return
      }
      if (dist <= 260) {
        if (li.dashEspera === 0 && dist > 170 && c.presionRival * prm.adapta < 1.2) {
          c.dir = hacia
          apretar(c, 'dash')
          c.motivo = 'castigo dash'
        }
        c.ataque = 'golpe'
        ponerPlan(c, 'presionar', 30)
      }
    }
  }

  // 6) Antiaéreo.
  if (ob.saltando && !c.rivalEnAire) {
    c.rivalEnAire = true
    const haciaMi = ob.vx * hacia < 0 || dist < 130
    if (haciaMi && dist < 330 && chance(c.azar, prm.antiaereo)) {
      ponerPlan(c, 'guardia', 34)
      c.abajo = false
    }
  } else if (!ob.saltando) c.rivalEnAire = false

  // 7) El rival quedó a merced (congelado, electrocutado, guardia rota): a pegarle mientras dure.
  //    Si lo aprovecha se decide una vez por vez (en fácil la mitad de las veces lo deja pasar).
  if (ob.vulnerable && !ob.invulnerable) {
    if (!c.merced) {
      c.merced = true
      c.aprovecha = chance(c.azar, Math.min(1, prm.castigo + 0.3))
    }
    if (c.aprovecha && c.plan !== 'presionar') {
      c.ataque = chance(c.azar, 0.65) ? 'herramienta' : 'golpe'
      c.motivo = 'a merced'
      ponerPlan(c, 'presionar', 60)
    }
  } else if (!ob.vulnerable) c.merced = false

  // ─── Pensar (cada `cadencia` ticks) ───
  if (c.sinAvanzar > 120 && c.plan !== 'presionar' && c.plan !== 'acercarse') {
    // Nunca trabada: 2 s sin atacar ni ir para adelante → avanza.
    c.objetivo = alcMio - 10
    ponerPlan(c, 'acercarse', 50)
  }
  if (c.pensar <= 0) {
    const n = quiereEspecial(c, p, I, lado, prm, dist, ob)
    if (n) {
      apretar(c, n === 1 ? 'especial1' : 'especial2')
      tiroEspecial(c, n, prm)
      c.motivo = `especial ${usoDe(k.especiales[n - 1])}`
      c.pensar = entero(c.azar, prm.cadencia[0], prm.cadencia[1])
      ponerPlan(c, 'esperar', 6)
      return
    }
  }
  if (c.planT <= 0 || (c.pensar <= 0 && (c.plan === 'tantear' || c.plan === 'esperar' || c.plan === 'neutral'))) {
    decidirPlan(c, p, I, lado, prm, dist, ob)
  }

  // Mareado no se puede cubrir: en vez de esperar cubierto, se aleja.
  if (yo.efectos.mareado > 0 && c.plan === 'guardia') ponerPlan(c, 'alejarse', entero(c.azar, 10, 20))

  // ─── Ejecutar el plan ───
  const acorralado = (hacia === 1 && yo.x < X_MIN + 40) || (hacia === -1 && yo.x > X_MAX - 40)
  switch (c.plan) {
    case 'guardia':
      c.guardia = true
      c.dir = 0
      break
    case 'acercarse':
      c.guardia = false
      c.abajo = false
      c.dir = hacia
      if (dist < c.objetivo) c.planT = 0
      break
    case 'alejarse':
      c.guardia = false
      c.abajo = false
      c.dir = acorralado ? 0 : ((-hacia) as -1 | 1)
      if (acorralado) c.planT = 0
      break
    case 'tantear': {
      c.guardia = false
      c.abajo = false
      if (c.tantearT <= 0) {
        c.tantearT = entero(c.azar, 8, 18)
        const lejos = dist > c.objetivo + 20
        const cerca = dist < c.objetivo - 20
        const r = azar(c.azar)
        if (lejos) c.dir = r < 0.75 ? hacia : 0
        else if (cerca) c.dir = r < 0.6 && !acorralado ? ((-hacia) as -1 | 1) : 0
        else c.dir = r < 0.4 ? hacia : r < 0.7 && !acorralado ? ((-hacia) as -1 | 1) : 0
      }
      c.tantearT--
      break
    }
    case 'esperar':
      c.guardia = false
      c.abajo = false
      c.dir = 0
      break
    case 'presionar': {
      c.guardia = false
      c.abajo = false
      const encima = (ob.atacando && !ob.lanza && ob.fase <= 2 && dist <= ob.alcance + 20) || (c.presionRival > 2.5 && dist <= alcRival + 15)
      if (encima && !guardiaBaja && chance(c.azar, 0.3 + prm.adapta * 0.7)) {
        // Se le vino encima: mejor cubrirse y castigar después.
        ponerPlan(c, 'guardia', ob.restante + entero(c.azar, 4, 10))
        c.abajo = chance(c.azar, prm.agacharse)
        c.guardia = true
        c.dir = 0
        c.motivo = 'cubre presion'
      } else if (dist <= alcanceAtaque(k, c.ataque)) {
        // No le tira el golpe encima a uno que está pegando: sólo si el otro no ataca o si está en
        // una recuperación que alcanza para castigarlo (antes cambiaba golpes con el que machacaba
        // y perdía siempre); si no, se cubre un momento (agachado, el puño le pasa por arriba).
        const kRival = I.kits[(1 - lado) as Lado]
        const seguro = !ob.atacando || ob.lanza || (ob.fase === 3 && castigoLlega(k, c.ataque, ob, prm.reaccion, kRival))
        if (seguro || chance(c.azar, prm.errores)) {
          c.dir = 0
          apretar(c, c.ataque)
          c.motivo = 'presionar'
          ponerPlan(c, 'esperar', 4)
        } else if (guardiaBaja) {
          ponerPlan(c, 'alejarse', entero(c.azar, 8, 14))
          c.motivo = 'presion sin guardia'
        } else {
          ponerPlan(c, 'guardia', Math.max(6, ob.restante - prm.reaccion) + entero(c.azar, 2, 6))
          c.abajo = chance(c.azar, prm.agacharse)
          c.guardia = true
          c.dir = 0
          c.motivo = 'espera el hueco'
        }
      } else c.dir = hacia
      break
    }
    case 'mantener':
      break
    default:
      c.dir = 0
  }
  if (c.dir === hacia) c.sinAvanzar = 0
  else c.sinAvanzar++
}

function pensarFinal(c: Cerebro, p: Partida, I: EstadoInterno, lado: Lado): void {
  c.guardia = false
  c.abajo = false
  c.dir = 0
  const F = I.final
  if (!F || F.ganador !== lado || F.remate) return
  if (!c.final.decidido) {
    c.final.decidido = true
    c.final.remata = chance(c.azar, 0.5)
    c.final.en = entero(c.azar, 30, 100)
    const botones = ['golpe', 'herramienta', 'especial1', 'especial2'] as const
    c.final.boton = botones[entero(c.azar, 0, 3)]
  }
  if (!c.final.remata) return
  const yo = p.luchadores[lado]
  const rival = p.luchadores[F.perdedor]
  if (p.ticksFase >= c.final.en) apretar(c, c.final.boton)
  else if (Math.abs(rival.x - yo.x) > 150) c.dir = rival.x > yo.x ? 1 : -1
}

function salida(c: Cerebro): EntradaJugador {
  const e: EntradaJugador = {
    izquierda: c.dir < 0,
    derecha: c.dir > 0,
    arriba: false,
    abajo: c.abajo,
    golpe: false,
    herramienta: false,
    guardia: c.guardia,
    especial1: false,
    especial2: false,
    dash: false,
  }
  for (const b of BOTONES_CPU) {
    const on = c.btn[b] > 0
    if (on) c.btn[b]--
    c.prevBtn[b] = on
    e[b] = on
  }
  return e
}

/** La entrada de la CPU para este tick (corre también durante el hitstop: puede dejar cosas en el buffer). */
export function entradaCpu(p: Partida, I: EstadoInterno, lado: Lado): EntradaJugador {
  const c = I.cerebros[lado]
  if (!c) return salidaVacia()
  observar(c, p, I, (1 - lado) as Lado)
  if (p.fase === 'pelea') pensarPelea(c, p, I, lado)
  else if (p.fase === 'final') pensarFinal(c, p, I, lado)
  else {
    c.dir = 0
    c.guardia = false
    c.abajo = false
  }
  return salida(c)
}

function salidaVacia(): EntradaJugador {
  return {
    izquierda: false,
    derecha: false,
    arriba: false,
    abajo: false,
    golpe: false,
    herramienta: false,
    guardia: false,
    especial1: false,
    especial2: false,
    dash: false,
  }
}
