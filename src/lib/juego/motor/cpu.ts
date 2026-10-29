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
 */
import type { Dificultad, EntradaJugador, Lado, Partida } from '../tipos'
import { PERSONAJES } from '../personajes'
import type { Azar } from './azar'
import { azar, chance, crearAzar, entero } from './azar'
import { X_MAX, X_MIN } from './constantes'
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
    terminaCadena: 0.3,
    castigo: 0.2,
    antiaereo: 0.1,
    especiales: 'torpe',
    errores: 0.3,
    cadencia: [14, 30],
    agacharse: 0.1,
    adapta: 0,
    recibir: 0.05,
  },
  normal: {
    reaccion: 15,
    bloquear: 0.4,
    agresividad: 0.6,
    terminaCadena: 0.6,
    castigo: 0.5,
    antiaereo: 0.35,
    especiales: 'alcance',
    errores: 0.12,
    cadencia: [10, 22],
    agacharse: 0.45,
    adapta: 0.45,
    recibir: 0.45,
  },
  dificil: {
    reaccion: 8,
    bloquear: 0.7,
    agresividad: 0.8,
    terminaCadena: 0.9,
    castigo: 0.85,
    antiaereo: 0.65,
    especiales: 'castiga',
    errores: 0.04,
    cadencia: [6, 14],
    agacharse: 0.8,
    adapta: 0.7,
    recibir: 0.65,
  },
}

type BotonCpu = 'golpe' | 'herramienta' | 'especial1' | 'especial2' | 'arriba' | 'dash'
const BOTONES_CPU: readonly BotonCpu[] = ['golpe', 'herramienta', 'especial1', 'especial2', 'arriba', 'dash']
type Ataque = 'golpe' | 'herramienta'
type Plan = 'neutral' | 'acercarse' | 'alejarse' | 'tantear' | 'esperar' | 'guardia' | 'presionar' | 'mantener'

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
  selloCastigo: number
  selloCadena: number
  proyVisto: number
  esquivar: { id: number; modo: 'saltar' | 'dash' | 'guardia' } | null
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
  }
}

export function crearCerebro(lado: Lado, dificultad: Dificultad, semilla: number): Cerebro {
  const base = PARAMS_CPU[dificultad] ?? PARAMS_CPU.normal
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
    o.lanza = !!(a.mov as DefEspecial).proyectil
    o.inseguro = a.especial !== 0 || !a.mov.siguiente || a.mov.boton === 'herramienta'
  } else {
    o.fase = 0
    o.fallo = false
    o.alcance = 0
    o.restante = 0
    o.lanza = false
    o.inseguro = false
  }
  o.bloqueando = li.guardia || (li.stun > 0 && li.stunBloqueo)
  o.vulnerable = l.efectos.congelado > 12 || l.efectos.electrocutado > 12 || l.efectos.guardiaRota > 12
  o.invulnerable = l.invulnerable
  o.saltando = !l.enSuelo && li.caidaDerribo === 0 && li.pose === null
  o.tirado = li.derribo > 0 || li.levantar > 0 || li.caidaDerribo > 0
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
  if (ventaja > 0.4) {
    e.reaccion = b.reaccion + 8
    e.bloquear = b.bloquear * 0.6
    e.agresividad = b.agresividad * 0.65
    e.castigo = b.castigo * 0.5
    e.terminaCadena = b.terminaCadena * 0.7
  }
  return e
}

function alcanceAtaque(k: KitPersonaje, ataque: Ataque): number {
  const mov = k.movimientos[ataque === 'golpe' ? k.inicio.golpe : k.inicio.herramienta]
  if (!mov) return 120
  const avance = mov.avance ? mov.avance.vel * (mov.avance.hasta - mov.avance.desde) : 0
  return alcanceDe(mov) + avance * 0.6 - 6
}

function elegirAtaque(c: Cerebro, k: KitPersonaje, ob: Observacion): Ataque {
  if (ob.vulnerable && chance(c.azar, 0.6)) return 'herramienta'
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

/** ¿Tira un especial ahora? 0 = no. */
function quiereEspecial(c: Cerebro, p: Partida, I: EstadoInterno, lado: Lado, prm: ParamsCpu, dist: number, ob: Observacion): 0 | 1 | 2 {
  const yo = p.luchadores[lado]
  const ficha = PERSONAJES[yo.id]
  const k = I.kits[lado]
  const lleno = yo.carga >= 9
  const orden: (1 | 2)[] = chance(c.azar, 0.5) ? [1, 2] : [2, 1]
  for (const n of orden) {
    const esp = ficha.especiales[n - 1]
    if (yo.carga + 1e-9 < esp.costo) continue
    const [rmin, rmax] = k.cpu.rangoEspecial[n - 1]
    const enRango = dist >= rmin && dist <= rmax
    let pr = 0
    if (prm.especiales === 'torpe') {
      // Lento y mal apuntado: casi siempre desde más lejos de lo que llega (se queda corto).
      pr = dist > rmax + 40 ? 0.06 : enRango && ob.enSuelo ? 0.012 : 0
    } else if (prm.especiales === 'alcance') {
      // Con alcance: en rango y apuntando a alguien que no se está cubriendo. La embestida, además,
      // contra alguien quieto (si está atacando, se la comen los dos).
      const apunta = enRango && ob.enSuelo && !ob.tirado && !ob.invulnerable
      if (esp.efecto === 'electrocuta') pr = apunta && !ob.atacando && !ob.bloqueando ? 0.11 : apunta ? 0.02 : 0
      else pr = apunta ? (ob.bloqueando ? 0.05 : 0.2) : 0
    } else if (enRango && ob.enSuelo && !ob.tirado && !ob.invulnerable) {
      switch (esp.efecto) {
        case 'electrocuta':
          // Sólo cuando llega seguro: si no, se la bloquean y queda regalado.
          pr = embestidaLlega(k, n, dist, ob, prm.reaccion) ? 0.9 : 0.015
          break
        case 'rompe_guardia':
          pr = ob.bloqueando ? 0.7 : ob.fase === 3 ? 0.75 : 0.12
          break
        case 'congela':
          pr = ob.bloqueando ? 0.55 : ob.fase >= 1 ? 0.5 : 0.1
          break
        default:
          // Multigolpe (tornado): para sacarlo de lejos y obligarlo a cubrirse.
          pr = dist > 220 && !ob.atacando ? 0.3 : 0.05
      }
    }
    if (prm.especiales !== 'torpe') pr *= k.cpu.preferencia[n - 1]
    if (lleno && pr > 0) pr = Math.min(1, pr * 2 + 0.05)
    if (chance(c.azar, pr)) return n
  }
  return 0
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
      c.ataque = elegirAtaque(c, k, ob)
      ponerPlan(c, 'presionar', 45)
    } else if (r < pEntra + 0.05 && ob.enSuelo) {
      saltarHacia(c, prm, hacia)
    } else if (r < pEntra + 0.05 + 0.06 * prm.agresividad && li.dashEspera === 0 && dist > 200 && presion < 0.3) {
      // Entrar con dash, sólo si el otro no está tirando golpes a lo loco (si no, termina el dash en su puño).
      c.dir = hacia
      apretar(c, 'dash')
      c.motivo = 'dash entra'
      c.ataque = elegirAtaque(c, k, ob)
      ponerPlan(c, 'presionar', 40)
    } else if (chance(c.azar, prm.errores * 0.4)) {
      // Error humano: ataca de lejos y queda expuesto.
      apretar(c, elegirAtaque(c, k, ob))
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
    apretar(c, elegirAtaque(c, k, ob))
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
        chance(c.azar, prm.especiales === 'castiga' ? 0.6 : 0.2)
      ) {
        apretar(c, nc === 1 ? 'especial1' : 'especial2')
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
    const embestida = ficha.especiales.findIndex((e) => e.efecto === 'electrocuta')
    if (dist <= alcMio + 6 && chance(c.azar, prm.castigo)) {
      apretar(c, 'golpe')
      c.motivo = 'castigo bloqueo'
      ponerPlan(c, 'esperar', 4)
      return
    }
    if (
      embestida >= 0 &&
      prm.especiales !== 'torpe' &&
      yo.carga + 1e-9 >= ficha.especiales[embestida].costo &&
      embestidaLlega(k, embestida === 0 ? 1 : 2, dist, ob, prm.reaccion) &&
      chance(c.azar, prm.castigo * 0.8)
    ) {
      apretar(c, embestida === 0 ? 'especial1' : 'especial2')
      c.motivo = 'castigo bloqueo embestida'
      ponerPlan(c, 'esperar', 6)
      return
    }
  }
  const guardiaBaja = yo.guardia < 35 && prm.adapta > 0

  // 2) Un ataque cuerpo a cuerpo (o la embestida) que viene. Si ya se venía cubriendo, sigue.
  if (ob.atacando && !ob.lanza && (ob.fase === 1 || ob.fase === 2) && c.selloDefensa !== ob.sello && dist <= ob.alcance + 25) {
    c.selloDefensa = ob.sello
    const yaCubierto = c.plan === 'guardia' && c.planT > 0
    // Con la guardia por romperse: un especial de revés (aguanta los golpes normales al arrancar)
    // si tiene carga; si no, dash para atrás.
    const reves = guardiaBaja && prm.especiales !== 'torpe' ? especialMasBarato(yo.carga, ficha.especiales) : 0
    if (reves && chance(c.azar, prm.adapta)) {
      apretar(c, reves === 1 ? 'especial1' : 'especial2')
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

  // 4) Proyectiles del rival (los nota después de su tiempo de reacción).
  for (const q of p.proyectiles) {
    if (q.duenio === lado || q.golpesRestantes <= 0 || q.id <= c.proyVisto || q.edad < prm.reaccion) continue
    const dq = Math.abs(q.x - yo.x)
    const viene = (q.vx > 0 && q.x < yo.x) || (q.vx < 0 && q.x > yo.x) || dq < 90
    if (!viene || dq > 330) continue
    c.proyVisto = q.id
    const r = azar(c.azar)
    if (q.tipo === 'sillon') {
      if (prm.especiales === 'castiga') c.esquivar = { id: q.id, modo: r < 0.55 ? 'dash' : r < 0.85 ? 'saltar' : 'guardia' }
      else if (r < prm.bloquear * 0.7) c.esquivar = { id: q.id, modo: 'guardia' }
      else if (r < prm.bloquear * 0.7 + 0.2) c.esquivar = { id: q.id, modo: 'saltar' }
    } else if (q.tipo === 'tornado') {
      if (r < prm.bloquear + 0.1) c.esquivar = { id: q.id, modo: 'guardia' }
      else if (prm.especiales === 'castiga' && r < prm.bloquear + 0.3) c.esquivar = { id: q.id, modo: 'dash' }
    } else if (r < prm.bloquear) c.esquivar = { id: q.id, modo: 'guardia' }
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
      }
    }
  }

  // 5) Castigar un ataque que falló (o la embestida bloqueada desde lejos).
  if (ob.atacando && ob.fase === 3 && ob.fallo && c.selloCastigo !== ob.sello) {
    c.selloCastigo = ob.sello
    if (chance(c.azar, prm.castigo)) {
      const embestida = ficha.especiales.findIndex((e) => e.efecto === 'electrocuta')
      if (dist <= alcMio + 4) {
        apretar(c, 'golpe')
        c.motivo = 'castigo fallo'
        ponerPlan(c, 'esperar', 4)
        return
      }
      if (
        embestida >= 0 &&
        prm.especiales !== 'torpe' &&
        yo.carga + 1e-9 >= ficha.especiales[embestida].costo &&
        embestidaLlega(k, embestida === 0 ? 1 : 2, dist, ob, prm.reaccion)
      ) {
        apretar(c, embestida === 0 ? 'especial1' : 'especial2')
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
      c.motivo = `especial ${prm.especiales}`
      c.pensar = entero(c.azar, prm.cadencia[0], prm.cadencia[1])
      ponerPlan(c, 'esperar', 6)
      return
    }
  }
  if (c.planT <= 0 || (c.pensar <= 0 && (c.plan === 'tantear' || c.plan === 'esperar' || c.plan === 'neutral'))) {
    decidirPlan(c, p, I, lado, prm, dist, ob)
  }

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
      if (encima && chance(c.azar, 0.3 + prm.adapta * 0.7)) {
        // Se le vino encima: mejor cubrirse y castigar después.
        ponerPlan(c, 'guardia', ob.restante + entero(c.azar, 4, 10))
        c.abajo = chance(c.azar, prm.agacharse)
        c.guardia = true
        c.dir = 0
        c.motivo = 'cubre presion'
      } else if (dist <= alcanceAtaque(k, c.ataque)) {
        c.dir = 0
        apretar(c, c.ataque)
        c.motivo = 'presionar'
        ponerPlan(c, 'esperar', 4)
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
