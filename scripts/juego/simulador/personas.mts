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
 */
import type { EntradaJugador, IdPersonaje, Lado, Partida } from '../../../src/lib/juego/tipos.ts'
import { ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { PERSONAJES } from '../../../src/lib/juego/personajes.ts'

/** Ticks con que una persona reconoce el ataque del otro (14 = 233 ms). */
export const REACCION_HUMANA = 14

export const MODELOS = ['simple', 'novato', 'apunta', 'botonero', 'casual', 'casual2'] as const
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

/** Reacción de cada modelo si el nombre no la dice. */
const REACCION_DE: Record<ModeloPersona, number> = {
  simple: REACCION_HUMANA,
  novato: REACCION_HUMANA,
  apunta: REACCION_HUMANA,
  botonero: REACCION_HUMANA,
  casual: 15,
  casual2: 15,
}

/** Crea una persona por su nombre («simple», «novato0», «apunta», …) con su azar. */
export function crearPersona(nombre: string, semilla: number): Persona {
  const { modelo, reaccion } = leerNombre(nombre)
  const r = rng(semilla)
  const reac = reaccion ?? REACCION_DE[modelo]
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
  }
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
