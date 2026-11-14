/**
 * Personas de bot: cómo juega un cliente, para medir el balance contra la CPU (meta B), entre dos
 * personas (meta E, la pelea online) y el salto entre dificultades (el «botonero»). Lo usa
 * balance.mts. Todas juegan por el camino de una persona (flancos, buffer), sin tocar el motor.
 *
 * Una persona ve al rival TARDE: reconocer que el otro arrancó un ataque le lleva ≈ 0,2–0,25 s
 * (`reaccion`, en ticks). Hasta el 31/oct el simple y el novato de balance.mts veían el ataque de la
 * CPU en el MISMO tick en que arrancaba (reacción 0) y la meta B sólo valía para ellos: viéndolo 14
 * ticks tarde, el simple bajaba de 35 a 16 % y el novato de 44 a 32 % (confirmación de la
 * verificación del 31/oct). Los oficiales para B ven el ataque con REACCION_HUMANA ticks de retraso
 * (la distancia, al instante: caminar hacia el rival es un control continuo); con reacción 0 son
 * idénticos a los de antes, que quedan de referencia («simple0», «novato0»).
 *
 * Modelos:
 *  - simple: camina hacia el rival, machaca GOLPE de cerca y a veces (30 %) se cubre al ver un ataque.
 *  - novato: como el simple, pero alterna GOLPE y MÁQUINA y aprieta un especial apenas se le enciende
 *    (0,3–1,3 s después, sin apuntar).
 *  - apunta (de la confirmación): camina hasta SU alcance, pega GOLPE o MÁQUINA a ritmo humano, se
 *    cubre a veces (35 %, 16–25 ticks) y tira cada especial sólo dentro de su rango útil
 *    (RANGO_PERSONA), 0,2–0,6 s después; la Curación con la vida bajo 75 % y el rival lejos
 *    o tirado. Ve TODO al rival 14 ticks tarde.
 *  - botonero (de la confirmación): cada 5–9 ticks aprieta casi al azar (golpe, máquina, el especial
 *    prendido, salto, guardia, retroceder), sin mirar rangos; camina hacia el rival si está lejos.
 *  - casual (de la verificación): elige un plan cada 5–14 ticks (avanza casi siempre, a veces salta,
 *    esquiva o retrocede sin motivo), machaca a ritmo humano, se cubre poco y tarde (25 %) y aprieta
 *    el especial prendido sin apuntar 0,4–2,5 s después. Ve al rival 15 ticks tarde.
 *  - casual2 (de la verificación): camina, machaca GOLPE de cerca, nunca se cubre ni salta, y tira
 *    el especial prendido sólo a menos de 350 px. Ve al rival 15 ticks tarde.
 *  - impaciente (quinta tanda, segunda parte; NO es de ninguna meta, se mide aparte): tira el especial
 *    apenas se le enciende y ataca sin esperar: camina hacia el rival, machaca GOLPE y MÁQUINA de cerca
 *    y nunca se cubre. Lo armó un verificador anterior (su código se perdió) y vio a Fabri en 15 % y a
 *    Chipi, Lucas, Stefano y Nahuel en 66–68 %; éste es una reconstrucción, no el mismo.
 *
 * Desde la quinta tanda (14/nov) todos, menos el botonero y el impaciente, leen además lo mínimo de
 * las piezas nuevas (no pegarle al anillo del All In, agacharse de los Lentes y del Lanzamiento Aéreo,
 * saltar la púa clavada, salir del agarre de media distancia de Nacho, cubrirse cegados por el Spray y,
 * «apunta» con Nehuen, el Smash cuando viene un tiro): ver `LECTURA`.
 */
import type { EntradaJugador, IdPersonaje, Lado, Partida } from '../../../src/lib/juego/tipos.ts'
import { ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { GRAVEDAD, VEL_SALTO } from '../../../src/lib/juego/motor/constantes.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { PERSONAJES } from '../../../src/lib/juego/personajes.ts'

/** Ticks con que una persona reconoce el ataque del otro (14 = 233 ms). */
export const REACCION_HUMANA = 14

export const MODELOS = ['simple', 'novato', 'apunta', 'botonero', 'casual', 'casual2', 'impaciente'] as const
export type ModeloPersona = (typeof MODELOS)[number]

/** Una persona de bot: decide la entrada de cada tick (se llama una vez por tick, antes de avanzar). */
export type Persona = (p: Partida, lado: Lado) => EntradaJugador

/**
 * Nombre de una persona como la piden balance.mts y los informes: el modelo y, si no es la de
 * siempre, la reacción después de una arroba («simple» = el simple con REACCION_HUMANA; «simple@0» =
 * el de antes, que ve el ataque en el mismo tick; «apunta@20» = apunta viendo todo 20 ticks tarde).
 */
export function leerNombre(nombre: string): { modelo: ModeloPersona; reaccion: number | null } {
  const [base, reac] = nombre.split('@')
  if (!(MODELOS as readonly string[]).includes(base) || (reac !== undefined && !/^\d+$/.test(reac))) throw new Error(`persona desconocida: ${nombre}`)
  return { modelo: base as ModeloPersona, reaccion: reac === undefined ? null : Number(reac) }
}

export function rng(semilla: number): () => number {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Lo que una persona alcanza a ver del rival, con su retraso. */
interface Visto {
  x: number
  mov: string | null
  tirado: boolean
}

/** Mete lo que se ve ahora y devuelve lo que se ve con `retraso` ticks de demora. */
function ver<T>(hist: T[], ahora: T, retraso: number): T {
  hist.push(ahora)
  if (hist.length > retraso + 1) hist.shift()
  return hist[0]
}

function vistoDe(p: Partida, lado: Lado): Visto {
  const otro = (1 - lado) as Lado
  const l = p.luchadores[otro]
  const li = internoDe(p).luchadores[otro]
  return { x: l.x, mov: l.movimiento, tirado: li.derribo > 0 || li.caidaDerribo > 0 || li.levantar > 0 }
}

/** El simple (el de balance.mts y simular.mts) con `reaccion` ticks para ver el ataque. */
function simple(r: () => number, reaccion: number): Persona {
  const h = { guardiaT: 0, golpeT: 0, movRival: null as string | null, hist: [] as (string | null)[] }
  return (p, lado) => {
    const yo = p.luchadores[lado]
    const rv = p.luchadores[lado === 0 ? 1 : 0]
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const mov = ver(h.hist, rv.movimiento, reaccion)
    const nuevoAtaque = mov !== null && mov !== h.movRival
    h.movRival = mov
    if (p.fase !== 'pelea' && p.fase !== 'final') return e
    if (h.guardiaT > 0) {
      h.guardiaT--
      e.guardia = true
      return e
    }
    const d = Math.abs(rv.x - yo.x)
    if (nuevoAtaque && d < 260 && r() < 0.3) {
      h.guardiaT = 20
      e.guardia = true
      return e
    }
    if (d < 135) {
      h.golpeT = (h.golpeT + 1) % 5
      e.golpe = h.golpeT < 2
    } else if (rv.x > yo.x) e.derecha = true
    else e.izquierda = true
    return e
  }
}

/** El novato (el de balance.mts) con `reaccion` ticks para ver el ataque. */
function novato(r: () => number, reaccion: number): Persona {
  const h = { guardiaT: 0, golpeT: 0, movRival: null as string | null, hist: [] as (string | null)[], esperaEsp: -1, prev: {} as Partial<EntradaJugador> }
  return (p, lado) => {
    const e = decidirNovato(h, r, reaccion, p, lado)
    h.prev = e
    return e
  }
}
function decidirNovato(
  h: { guardiaT: number; golpeT: number; movRival: string | null; hist: (string | null)[]; esperaEsp: number; prev: Partial<EntradaJugador> },
  r: () => number,
  reaccion: number,
  p: Partida,
  lado: Lado,
): EntradaJugador {
  const yo = p.luchadores[lado]
  const rv = p.luchadores[lado === 0 ? 1 : 0]
  const e: EntradaJugador = { ...ENTRADA_VACIA }
  const mov = ver(h.hist, rv.movimiento, reaccion)
  const nuevoAtaque = mov !== null && mov !== h.movRival
  h.movRival = mov
  if (p.fase !== 'pelea' && p.fase !== 'final') return e
  if (h.guardiaT > 0) {
    h.guardiaT--
    e.guardia = true
    return e
  }
  const d = Math.abs(rv.x - yo.x)
  if (nuevoAtaque && d < 260 && r() < 0.3) {
    h.guardiaT = 20
    e.guardia = true
    return e
  }
  const f = PERSONAJES[yo.id]
  const listo2 = yo.carga + 1e-9 >= f.especiales[1].costo
  const listo1 = yo.carga + 1e-9 >= f.especiales[0].costo
  if (listo1 || listo2) {
    if (h.esperaEsp < 0) h.esperaEsp = 18 + Math.floor(r() * 60)
    if (h.esperaEsp === 0) {
      h.esperaEsp = -1
      const boton = listo2 && r() < 0.5 ? 'especial2' : 'especial1'
      if (!h.prev[boton]) {
        e[boton] = true
        return e
      }
    } else h.esperaEsp--
  } else h.esperaEsp = -1
  if (d < 140) {
    h.golpeT = (h.golpeT + 1) % 10
    if (h.golpeT < 2) e.golpe = true
    else if (h.golpeT >= 5 && h.golpeT < 7) e.herramienta = true
  } else if (rv.x > yo.x) e.derecha = true
  else e.izquierda = true
  return e
}

/**
 * Dónde tira cada especial una persona que apunta (el modelo «apunta»): [mín, máx] de centro a
 * centro. Es una copia FIJA de los rangos de la CPU del 31/oct (EstiloCpu.rangoEspecial; el segundo
 * de Guillermo es [60, 520] desde que la primera botella del Flair sale baja). Va aparte a propósito:
 * el rango de la CPU es una perilla de la CPU (lo mueve el balance CPU contra CPU) y una persona no
 * cambia su manera de apuntar porque se retocó la CPU. Si cambia lo que alcanza un especial (el
 * kit), se cambia acá también.
 */
export const RANGO_PERSONA: Readonly<Record<IdPersonaje, readonly [readonly [number, number], readonly [number, number]]>> = {
  simon: [
    [120, 340],
    [180, 820],
  ],
  chipi: [
    [200, 470],
    [0, 235],
  ],
  nico_u: [
    [170, 820],
    [60, 200],
  ],
  fabri: [
    [280, 2000],
    [110, 370],
  ],
  luciano: [
    [140, 600],
    [200, 820],
  ],
  gabriel: [
    [60, 280],
    [175, 330],
  ],
  guillermo: [
    [130, 320],
    [60, 520],
  ],
  rodrigo: [
    [100, 270],
    [70, 900],
  ],
  joaquin: [
    [190, 520],
    [120, 540],
  ],
  nahuel: [
    [180, 820],
    [70, 230],
  ],
  lucas: [
    [80, 290],
    [170, 380],
  ],
  stefano: [
    [200, 600],
    [80, 330],
  ],
  brian: [
    [0, 118],
    [150, 700],
  ],
  // Quinta tanda (14/nov), del diseño de la tanda (dónde rinde cada especial para el que apunta).
  // El All In se aprieta cuando el rival arranca un golpe cerca: el modelo no reacciona así, va [0, 200].
  chino: [
    [80, 480],
    [0, 200],
  ],
  fran: [
    [180, 460],
    [150, 210],
  ],
  lautaro: [
    [150, 330],
    [0, 160],
  ],
  leo: [
    [130, 560],
    [80, 250],
  ],
  nacho: [
    [105, 255],
    [120, 400],
  ],
  nehuen: [
    [220, 520],
    [150, 600],
  ],
  // La Orden Final la tira de cerca, donde entran los tres anillos; el Monopatín, de cerca (los dos golpes).
  nico_m: [
    [80, 300],
    [160, 420],
  ],
  tony: [
    [0, 260],
    [60, 170],
  ],
}

function alcanceGolpe(id: IdPersonaje): number {
  const kit = MOVIMIENTOS[id]
  const mov = kit.movimientos[kit.inicio.golpe]
  let x = 0
  for (const v of mov?.ventanas ?? []) x = Math.max(x, v.caja.x1)
  return x + 28
}
function esCura(id: IdPersonaje, n: 1 | 2): boolean {
  const esp = MOVIMIENTOS[id].especiales.find((e) => e.numero === n)
  return !!(esp && esp.cura)
}

/** «apunta» (la confirmación de la verificación del 31/oct, mi-arnes.mts). */
function apunta(r: () => number, reaccion: number): Persona {
  const m = { hist: [] as Visto[], guardT: 0, esperaEsp: -1, espElegido: 0 as 0 | 1 | 2, toqueT: 0, movRival: null as string | null, prev: {} as Partial<EntradaJugador> }
  const PROB_GUARDIA = 0.35
  const decidir = (p: Partida, lado: Lado): EntradaJugador => {
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const rv = ver(m.hist, vistoDe(p, lado), reaccion)
    if (p.fase === 'final') {
      if (p.tick % 7 === 0) e.golpe = true
      return e
    }
    if (p.fase !== 'pelea') return e
    const yo = p.luchadores[lado]
    const d = Math.abs(rv.x - yo.x)
    const hacia = rv.x >= yo.x ? 1 : -1
    const nuevo = rv.mov !== null && rv.mov !== m.movRival
    m.movRival = rv.mov
    if (m.guardT > 0) {
      m.guardT--
      e.guardia = true
      return e
    }
    if (nuevo && d < 220 && r() < PROB_GUARDIA) {
      m.guardT = 16 + Math.floor(r() * 10)
      e.guardia = true
      return e
    }
    const f = PERSONAJES[yo.id]
    const sirve = (n: 1 | 2) => {
      if (yo.carga + 1e-9 < f.especiales[n - 1].costo) return false
      const [a, b] = RANGO_PERSONA[yo.id][n - 1]
      if (esCura(yo.id, n)) return yo.vida < yo.vidaMax * 0.75 && (d > 250 || rv.tirado)
      return d >= a && d <= b && !rv.tirado
    }
    if (m.esperaEsp < 0) {
      const s1 = sirve(1)
      const s2 = sirve(2)
      if (s1 || s2) {
        m.espElegido = s1 && s2 ? (r() < 0.5 ? 1 : 2) : s1 ? 1 : 2
        m.esperaEsp = 12 + Math.floor(r() * 24)
      }
    } else if (m.esperaEsp === 0) {
      m.esperaEsp = -1
      const n = m.espElegido
      if (n && sirve(n)) {
        const b = n === 1 ? 'especial1' : 'especial2'
        if (!m.prev[b]) {
          e[b] = true
          return e
        }
      }
    } else m.esperaEsp--
    if (d > alcanceGolpe(yo.id)) {
      if (hacia > 0) e.derecha = true
      else e.izquierda = true
      return e
    }
    if (m.toqueT <= 0) {
      m.toqueT = 6 + Math.floor(r() * 4)
      const x = r()
      if (x < 0.6) e.golpe = true
      else if (x < 0.9) e.herramienta = true
      else if (hacia > 0) e.izquierda = true
      else e.derecha = true
    } else m.toqueT--
    return e
  }
  return (p, lado) => {
    const e = decidir(p, lado)
    m.prev = e
    return e
  }
}

/** «botonero» (la confirmación de la verificación del 31/oct, mi-arnes.mts). */
function botonero(r: () => number, reaccion: number): Persona {
  const m = { hist: [] as Visto[], accion: '', accionT: 0, espElegido: 1 as 1 | 2, prev: {} as Partial<EntradaJugador> }
  const decidir = (p: Partida, lado: Lado): EntradaJugador => {
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const rv = ver(m.hist, vistoDe(p, lado), reaccion)
    if (p.fase === 'final') {
      if (p.tick % 7 === 0) e.golpe = true
      return e
    }
    if (p.fase !== 'pelea') return e
    const yo = p.luchadores[lado]
    const d = Math.abs(rv.x - yo.x)
    const hacia = rv.x >= yo.x ? 1 : -1
    const f = PERSONAJES[yo.id]
    if (m.accionT <= 0) {
      m.accionT = 5 + Math.floor(r() * 5)
      const x = r()
      const listos = ([1, 2] as const).filter((n) => yo.carga + 1e-9 >= f.especiales[n - 1].costo)
      if (d > 160) m.accion = x < 0.7 ? 'ir' : x < 0.8 ? 'saltoIr' : x < 0.85 ? 'dashIr' : x < 0.93 ? 'golpe' : listos.length ? 'esp' : 'ir'
      else m.accion = x < 0.35 ? 'golpe' : x < 0.6 ? 'maquina' : x < 0.7 ? 'guardia' : x < 0.75 ? 'salto' : x < 0.8 ? 'atras' : listos.length ? 'esp' : 'golpe'
      if (m.accion === 'guardia') m.accionT = 10 + Math.floor(r() * 11)
      if (m.accion === 'esp') m.espElegido = listos[Math.floor(r() * listos.length)] ?? 1
    }
    m.accionT--
    const ir = (dir: number) => {
      if (dir > 0) e.derecha = true
      else e.izquierda = true
    }
    switch (m.accion) {
      case 'ir':
        ir(hacia)
        break
      case 'saltoIr':
        ir(hacia)
        e.arriba = true
        break
      case 'dashIr':
        ir(hacia)
        if (!m.prev.dash) e.dash = true
        m.accion = 'ir'
        break
      case 'golpe':
        if (!m.prev.golpe) e.golpe = true
        break
      case 'maquina':
        if (!m.prev.herramienta) e.herramienta = true
        break
      case 'guardia':
        e.guardia = true
        break
      case 'salto':
        e.arriba = true
        break
      case 'atras':
        ir(-hacia)
        break
      case 'esp': {
        const b = m.espElegido === 2 ? 'especial2' : 'especial1'
        if (!m.prev[b]) e[b] = true
        m.accion = 'golpe'
        break
      }
    }
    return e
  }
  return (p, lado) => {
    const e = decidir(p, lado)
    m.prev = e
    return e
  }
}

/** «casual» (la verificación del 31/oct, motor-semillas/arnes). */
function casual(r: () => number, reaccion: number): Persona {
  const m = { hist: [] as Visto[], t: 0, plan: '', planT: 0, pulsoT: 0, guardiaT: 0, esperaEsp: -1, movRival: null as string | null, prev: {} as Partial<EntradaJugador> }
  const decidir = (p: Partida, lado: Lado): EntradaJugador => {
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const rv = ver(m.hist, vistoDe(p, lado), reaccion)
    if (p.fase === 'final') {
      m.t++
      if (m.t % 6 === 0) e.golpe = true
      return e
    }
    if (p.fase !== 'pelea') return e
    m.t++
    const yo = p.luchadores[lado]
    const d = Math.abs(rv.x - yo.x)
    const hacia = rv.x >= yo.x ? 1 : -1
    const ir = (dir: number) => {
      if (dir > 0) e.derecha = true
      else e.izquierda = true
    }
    const nuevoAtaque = rv.mov !== null && rv.mov !== m.movRival
    m.movRival = rv.mov
    if (m.guardiaT > 0) {
      m.guardiaT--
      e.guardia = true
      return e
    }
    if (nuevoAtaque && d < 240 && r() < 0.25) {
      m.guardiaT = 12 + Math.floor(r() * 19)
      e.guardia = true
      return e
    }
    const f = PERSONAJES[yo.id]
    const listo1 = yo.carga + 1e-9 >= f.especiales[0].costo
    const listo2 = yo.carga + 1e-9 >= f.especiales[1].costo
    if (listo1 || listo2) {
      if (m.esperaEsp < 0) m.esperaEsp = 24 + Math.floor(r() * 126)
      if (m.esperaEsp === 0) {
        m.esperaEsp = -1
        const boton = listo1 && listo2 ? (r() < 0.5 ? 'especial1' : 'especial2') : listo2 ? 'especial2' : 'especial1'
        if (!m.prev[boton]) {
          e[boton] = true
          return e
        }
      } else m.esperaEsp--
    } else m.esperaEsp = -1
    if (m.planT <= 0) {
      m.planT = 5 + Math.floor(r() * 10)
      const x = r()
      if (d > 150) m.plan = x < 0.7 ? 'avanzar' : x < 0.78 ? 'saltarAdelante' : x < 0.82 ? 'esquivaAdelante' : x < 0.9 ? 'quieto' : x < 0.95 ? 'atras' : 'golpe'
      else
        m.plan =
          x < 0.45 ? 'golpe' : x < 0.63 ? 'maquina' : x < 0.73 ? 'avanzarGolpe' : x < 0.81 ? 'guardia' : x < 0.87 ? 'saltar' : x < 0.93 ? 'atras' : x < 0.96 ? 'agachadoGolpe' : 'esquivaAtras'
      m.pulsoT = 0
    }
    m.planT--
    const toque = () => {
      if (m.pulsoT <= 0) {
        m.pulsoT = 5 + Math.floor(r() * 5)
        return true
      }
      m.pulsoT--
      return false
    }
    switch (m.plan) {
      case 'avanzar':
        ir(hacia)
        break
      case 'saltarAdelante':
        ir(hacia)
        e.arriba = true
        if (!yo.enSuelo && d < 170 && toque()) e.golpe = true
        break
      case 'esquivaAdelante':
        ir(hacia)
        if (!m.prev.dash) e.dash = true
        m.plan = 'avanzar'
        break
      case 'quieto':
        break
      case 'atras':
        ir(-hacia)
        break
      case 'golpe':
        if (toque()) e.golpe = true
        break
      case 'maquina':
        if (toque()) e.herramienta = true
        break
      case 'avanzarGolpe':
        ir(hacia)
        if (toque()) e.golpe = true
        break
      case 'guardia':
        e.guardia = true
        break
      case 'saltar':
        e.arriba = true
        if (!yo.enSuelo && toque()) e.golpe = true
        break
      case 'agachadoGolpe':
        e.abajo = true
        if (toque()) e.golpe = true
        break
      case 'esquivaAtras':
        ir(-hacia)
        if (!m.prev.dash) e.dash = true
        m.plan = 'atras'
        break
    }
    return e
  }
  return (p, lado) => {
    const e = decidir(p, lado)
    m.prev = e
    return e
  }
}

/** «casual2» (la verificación del 31/oct): golpe y especial, nunca se cubre. */
function casual2(r: () => number, reaccion: number): Persona {
  const m = { hist: [] as Visto[], t: 0, pulsoT: 0, esperaEsp: -1, prev: {} as Partial<EntradaJugador> }
  const decidir = (p: Partida, lado: Lado): EntradaJugador => {
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const rv = ver(m.hist, vistoDe(p, lado), reaccion)
    m.t++
    if (p.fase === 'final') {
      if (m.t % 6 === 0) e.golpe = true
      return e
    }
    if (p.fase !== 'pelea') return e
    const yo = p.luchadores[lado]
    const d = Math.abs(rv.x - yo.x)
    const hacia = rv.x >= yo.x ? 1 : -1
    const f = PERSONAJES[yo.id]
    const listo1 = yo.carga + 1e-9 >= f.especiales[0].costo
    const listo2 = yo.carga + 1e-9 >= f.especiales[1].costo
    if (listo1 || listo2) {
      if (m.esperaEsp < 0) m.esperaEsp = 24 + Math.floor(r() * 126)
      if (m.esperaEsp > 0) m.esperaEsp--
      if (m.esperaEsp === 0 && d < 350) {
        m.esperaEsp = -1
        const boton = listo1 && listo2 ? (r() < 0.5 ? 'especial1' : 'especial2') : listo2 ? 'especial2' : 'especial1'
        if (!m.prev[boton]) {
          e[boton] = true
          return e
        }
      }
    } else m.esperaEsp = -1
    if (d < 135) {
      if (m.pulsoT <= 0) {
        m.pulsoT = 5 + Math.floor(r() * 5)
        e.golpe = true
      } else m.pulsoT--
    } else if (hacia > 0) e.derecha = true
    else e.izquierda = true
    return e
  }
  return (p, lado) => {
    const e = decidir(p, lado)
    m.prev = e
    return e
  }
}

// ─── Lo que una persona aprendió de los especiales de la quinta tanda ─────────

/**
 * Lo que una persona aprende de las piezas de la quinta tanda (14/nov) después de comerse cada especial
 * un par de veces. Hasta la primera parte de la tanda los modelos no las leían: le pegaban al anillo del
 * All In, no se agachaban de los Lentes ni del Lanzamiento Aéreo, pisaban las púas clavadas, se quedaban
 * a tiro del agarre de media distancia de Nacho y nunca devolvían nada con el Smash, así que E
 * sobrevaloraba esos especiales y subvaloraba a Nehuen. No son expertos: cada lectura se decide UNA vez
 * por ocasión (un especial del rival, una púa, un tiro) con la probabilidad de su modelo —la misma
 * atención con la que ya se cubría de lo que ve venir—, mira al rival con la reacción de su modelo y no
 * compensa la demora del online (lo aprendió contra la CPU). El que aprieta todo sin mirar (el botonero)
 * no aprende nada y el que nunca se cubre ni salta (casual2) sólo deja de pegarle al anillo. Además de
 * las del informe de la primera parte, una más: cegado por el Spray de Leo, cubrirse (antes seguía
 * apretando golpes que no salían y se comía todo: con «apunta» sin demora Leo ganaba 74 %).
 */
export interface Lectura {
  /** No pegarle al anillo del All In (Chino): mientras lo ve, no aprieta golpes ni especiales. */
  dominio: number
  /** Agacharse de lo que va a la cara: los Lentes (Fran) y el Lanzamiento Aéreo (Lautaro). */
  agacharse: number
  /** Saltar la púa clavada (Nico M.) que le queda adelante, donde va a pisar. */
  pua: number
  /** Saltar o irse del agarre de media distancia (Nacho) al verlo arrancar a su alcance. */
  agarre: number
  /** Con el Smash de Pádel (Nehuen): tirarlo cuando ve venir un tiro que se puede devolver, más o menos a tiempo. */
  smash: number
  /** Cegado por el Spray (Leo): cubrirse mientras le dura, en vez de apretar golpes que no salen. */
  cegado: number
}

export const LECTURA: Readonly<Record<ModeloPersona, Lectura>> = {
  simple: { dominio: 0.3, agacharse: 0.3, pua: 0.3, agarre: 0.3, smash: 0, cegado: 0.3 },
  novato: { dominio: 0.3, agacharse: 0.3, pua: 0.3, agarre: 0.3, smash: 0, cegado: 0.3 },
  apunta: { dominio: 0.5, agacharse: 0.5, pua: 0.5, agarre: 0.5, smash: 0.5, cegado: 0.5 },
  botonero: { dominio: 0, agacharse: 0, pua: 0, agarre: 0, smash: 0, cegado: 0 },
  casual: { dominio: 0.25, agacharse: 0.25, pua: 0.25, agarre: 0.25, smash: 0, cegado: 0.25 },
  casual2: { dominio: 0.25, agacharse: 0, pua: 0, agarre: 0, smash: 0, cegado: 0 },
  impaciente: { dominio: 0, agacharse: 0, pua: 0, agarre: 0, smash: 0, cegado: 0 },
}

/** Un tiro del rival, como lo ve la persona (con su retraso). */
interface TiroVisto {
  id: number
  tipo: string
  x: number
  vx: number
  ancho: number
  /** El Smash lo puede devolver (la misma regla que `devolvible` de proyectiles.ts). */
  devolvible: boolean
}

interface VistoLectura {
  x: number
  mov: string | null
  dominio: boolean
  tiros: TiroVisto[]
  /** El propio cegado (también se nota con la reacción: aprieta y no sale nada). */
  cegado: boolean
}

function vistoLectura(p: Partida, lado: Lado): VistoLectura {
  const otro = (1 - lado) as Lado
  const l = p.luchadores[otro]
  const tiros: TiroVisto[] = []
  for (const pi of internoDe(p).proyectiles) {
    const q = pi.pub
    if (q.duenio !== otro || q.golpesRestantes <= 0 || q.plantado) continue
    const d = pi.def
    const devolvible = !!d && !pi.cosmetico && !pi.nube && !d.chorro && !d.onda && !d.diferido && !d.rastrero && !d.bumeran && !(d.desliza && pi.enSuelo)
    tiros.push({ id: q.id, tipo: q.tipo, x: q.x, vx: q.vx, ancho: q.ancho, devolvible })
  }
  return { x: l.x, mov: l.movimiento, dominio: l.efectos.dominio > 0, tiros, cegado: p.luchadores[lado].efectos.cegado > 0 }
}

/** Cuántos ticks se agacha como mucho de los Lentes (si no ve pasar la mirada) y del Lanzamiento Aéreo. */
const AGACHADO_LENTES = 90
const AGACHADO_LANZAMIENTO = 30
/**
 * La púa clavada (de centro a centro) se salta con la púa en el medio del salto: lo que avanza en el aire
 * (`saltoVx` por los ≈ 38 ticks de vuelo) partido en dos, y nunca a menos de PUA_CERCA (pisándola ya).
 * Sólo la pisa el que está en el piso: alcanza con despegar y aterrizar fuera de su caja.
 */
const VUELO_SALTO = (2 * VEL_SALTO) / GRAVEDAD
const PUA_CERCA = 58
/** El agarre de Nacho se lee a esta distancia (pegado no alcanza; de más lejos, tampoco). */
const AGARRE_MEDIO: readonly [number, number] = [85, 260]
/**
 * El Smash sale si lo que ve del tiro (con su retraso) llega a la paleta entre esto: con reacción 14 y
 * sin demora, el tiro llega entre el tick 7 y el 20 de la paleta (que devuelve del 6 al 22).
 */
const SMASH_VISTO: readonly [number, number] = [21, 34]

/**
 * Le suma a una persona `lec` (LECTURA de su modelo). Lleva su propia vista con retraso y su propio
 * azar: en una pelea sin esas piezas no tira ningún número y la persona juega idéntica a la de antes.
 */
function conLectura(base: Persona, lec: Lectura, reaccion: number, r: () => number): Persona {
  if (!lec.dominio && !lec.agacharse && !lec.pua && !lec.agarre && !lec.smash && !lec.cegado) return base
  const m = {
    hist: [] as VistoLectura[],
    movAntes: null as string | null,
    dominioVisto: false,
    respeta: false,
    lentes: false,
    agachadoT: 0,
    puas: new Set<number>(),
    tiros: new Set<number>(),
    escape: null as null | 'salto' | 'dash',
    smashAntes: false,
    cegadoVisto: false,
    seCubre: false,
  }
  return (p, lado) => {
    const e0 = base(p, lado)
    const rv = ver(m.hist, vistoLectura(p, lado), reaccion)
    const nuevo = rv.mov !== m.movAntes ? rv.mov : null
    m.movAntes = rv.mov
    if (p.fase !== 'pelea') {
      m.respeta = false
      m.lentes = false
      m.agachadoT = 0
      m.escape = null
      m.seCubre = false
      return e0
    }
    const yo = p.luchadores[lado]
    const hacia = rv.x >= yo.x ? 1 : -1
    const d = Math.abs(rv.x - yo.x)
    let e = e0

    // El anillo del All In: se decide una vez por dominio que ve.
    if (rv.dominio && !m.dominioVisto) {
      m.dominioVisto = true
      m.respeta = lec.dominio > 0 && r() < lec.dominio
    } else if (!rv.dominio) {
      m.dominioVisto = false
      m.respeta = false
    }

    // Lo que va a la cara: los Lentes (agachado hasta que ve pasar la mirada) y el Lanzamiento Aéreo.
    if (nuevo === 'lentes_hipnoticos' && lec.agacharse > 0 && r() < lec.agacharse) {
      m.lentes = true
      m.agachadoT = AGACHADO_LENTES
    } else if (nuevo === 'lanzamiento_aereo' && d < 230 && lec.agacharse > 0 && r() < lec.agacharse) {
      m.lentes = false
      m.agachadoT = AGACHADO_LANZAMIENTO
    }
    if (m.agachadoT > 0) {
      m.agachadoT--
      if (m.lentes) {
        // Se para cuando ya no ve el lente del rival por delante (ni al rival tirándolo).
        const viene = rv.tiros.some((q) => q.tipo === 'hipnosis' && (q.x - yo.x) * hacia > -30)
        if (!viene && rv.mov !== 'lentes_hipnoticos') m.agachadoT = 0
      }
      if (m.agachadoT > 0) e = { ...ENTRADA_VACIA, abajo: true }
    }

    // El agarre de media distancia de Nacho: lo salta o se va con la esquiva, a su alcance.
    if (nuevo === 'agarre_y_ejecucion' && d >= AGARRE_MEDIO[0] && d <= AGARRE_MEDIO[1] && lec.agarre > 0 && r() < lec.agarre) {
      m.escape = r() < 0.5 ? 'salto' : 'dash'
    }
    if (m.escape) {
      const huye = { ...ENTRADA_VACIA, [m.escape === 'salto' ? 'arriba' : 'dash']: true }
      if (hacia > 0) huye.izquierda = true
      else huye.derecha = true
      e = huye
      m.escape = null
      m.agachadoT = 0
    }

    // La púa clavada adelante, donde va a pisar (están quietas: se ven sin retraso).
    const dir = e.derecha && !e.izquierda ? 1 : e.izquierda && !e.derecha ? -1 : 0
    if (dir !== 0 && lec.pua > 0 && yo.enSuelo && !e.arriba) {
      for (const q of p.proyectiles) {
        if (!q.plantado || q.duenio === lado || q.golpesRestantes <= 0 || m.puas.has(q.id)) continue
        const adelante = (q.x - yo.x) * dir
        if (adelante < PUA_CERCA || adelante > (VUELO_SALTO * MOVIMIENTOS[yo.id].saltoVx) / 2 + 4) continue
        m.puas.add(q.id)
        if (r() < lec.pua) e = { ...e, arriba: true, guardia: false, golpe: false, herramienta: false }
        break
      }
    }

    // El Smash de Pádel cuando ve venir un tiro (una vez por tiro).
    if (lec.smash > 0) {
      const kit = MOVIMIENTOS[yo.id]
      const esp = kit.especiales.find((x) => x.devuelve)
      if (esp && esp.devuelve && yo.carga + 1e-9 >= PERSONAJES[yo.id].especiales[esp.numero - 1].costo) {
        for (const q of rv.tiros) {
          if (!q.devolvible || m.tiros.has(q.id) || (yo.x - q.x) * q.vx <= 0) continue
          const dq = Math.abs(q.x - yo.x)
          const llega = (dq - esp.devuelve.caja.x1 - q.ancho / 2) / Math.max(1, Math.abs(q.vx))
          if (llega > SMASH_VISTO[1] || llega < SMASH_VISTO[0]) continue
          m.tiros.add(q.id)
          if (r() < lec.smash) {
            const b = esp.numero === 1 ? 'especial1' : 'especial2'
            if (!m.smashAntes) e = { ...ENTRADA_VACIA, [b]: true }
          }
          break
        }
      }
      m.smashAntes = e.especial1 || e.especial2
    }

    // Cegado: se cubre mientras se ve cegado (se decide una vez por cegada).
    if (rv.cegado && !m.cegadoVisto) {
      m.cegadoVisto = true
      m.seCubre = lec.cegado > 0 && r() < lec.cegado
    } else if (!rv.cegado) {
      m.cegadoVisto = false
      m.seCubre = false
    }
    if (m.seCubre && !e.arriba && !e.abajo) e = { ...ENTRADA_VACIA, guardia: true }

    // Con el anillo a la vista, nada que le pegue.
    if (m.respeta && (e.golpe || e.herramienta || e.especial1 || e.especial2)) e = { ...e, golpe: false, herramienta: false, especial1: false, especial2: false }
    return e
  }
}

/** «impaciente»: el especial apenas se enciende (el que se prende primero; con los dos, al azar) y a pegar sin esperar. */
function impaciente(r: () => number, reaccion: number): Persona {
  const m = { hist: [] as Visto[], pulsoT: 0, prev: {} as Partial<EntradaJugador> }
  const decidir = (p: Partida, lado: Lado): EntradaJugador => {
    const e: EntradaJugador = { ...ENTRADA_VACIA }
    const rv = ver(m.hist, vistoDe(p, lado), reaccion)
    if (p.fase === 'final') {
      if (p.tick % 6 === 0) e.golpe = true
      return e
    }
    if (p.fase !== 'pelea') return e
    const yo = p.luchadores[lado]
    const d = Math.abs(rv.x - yo.x)
    const hacia = rv.x >= yo.x ? 1 : -1
    const f = PERSONAJES[yo.id]
    const listos = ([1, 2] as const).filter((n) => yo.carga + 1e-9 >= f.especiales[n - 1].costo)
    if (listos.length) {
      const n = listos.length === 2 ? (r() < 0.5 ? 1 : 2) : listos[0]
      const b = n === 1 ? 'especial1' : 'especial2'
      if (!m.prev[b]) {
        e[b] = true
        return e
      }
    }
    if (d < 140) {
      if (m.pulsoT <= 0) {
        m.pulsoT = 4 + Math.floor(r() * 4)
        if (r() < 0.7) e.golpe = true
        else e.herramienta = true
      } else m.pulsoT--
    } else if (hacia > 0) e.derecha = true
    else e.izquierda = true
    return e
  }
  return (p, lado) => {
    const e = decidir(p, lado)
    m.prev = e
    return e
  }
}

/** Reacción de cada modelo si el nombre no la dice. */
const REACCION_DE: Record<ModeloPersona, number> = {
  simple: REACCION_HUMANA,
  novato: REACCION_HUMANA,
  apunta: REACCION_HUMANA,
  botonero: REACCION_HUMANA,
  casual: 15,
  casual2: 15,
  impaciente: REACCION_HUMANA,
}

/** Crea una persona por su nombre («simple», «novato0», «apunta», …) con su azar. */
export function crearPersona(nombre: string, semilla: number): Persona {
  const { modelo, reaccion } = leerNombre(nombre)
  const r = rng(semilla)
  const reac = reaccion ?? REACCION_DE[modelo]
  const base = ((): Persona => {
    switch (modelo) {
      case 'simple':
        return simple(r, reac)
      case 'novato':
        return novato(r, reac)
      case 'apunta':
        return apunta(r, reac)
      case 'botonero':
        return botonero(r, reac)
      case 'casual':
        return casual(r, reac)
      case 'casual2':
        return casual2(r, reac)
      case 'impaciente':
        return impaciente(r, reac)
    }
  })()
  // Lo que aprendió de las piezas de la quinta tanda, con un azar aparte (ver conLectura).
  return conLectura(base, LECTURA[modelo], reac, rng(Math.imul(semilla, 0x2c1b3c6d) ^ 0x297a2d39))
}

/** Reacción efectiva de una persona por su nombre (para los informes). */
export function reaccionDe(nombre: string): number {
  const { modelo, reaccion } = leerNombre(nombre)
  return reaccion ?? REACCION_DE[modelo]
}

/**
 * La demora de entrada del online (lockstep.ts): lo que la persona aprieta al simular el tick n se
 * aplica en n + D (los primeros D ticks, nada). Se suma a la reacción de la persona.
 */
export function conDemora(persona: Persona, demora: number): Persona {
  if (demora <= 0) return persona
  const cola: EntradaJugador[] = []
  return (p, lado) => {
    cola.push(persona(p, lado))
    return cola.length > demora ? (cola.shift() as EntradaJugador) : ENTRADA_VACIA
  }
}
