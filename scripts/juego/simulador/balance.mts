/**
 * Balance del elenco de «Corte Final»: CPU contra CPU en TODOS los cruces (los dos lados, espejos
 * incluidos) y en las 3 dificultades, repartido en hilos (worker_threads); además, lo que vive un
 * cliente: dos «humanos» de bot (el simple y el novato) contra la CPU con cada barbero, de los dos
 * lados y contra cada rival, y novato contra novato (la pelea online entre dos personas).
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs balance.mts [opciones]
 *     --semillas=N        partidas por cruce ORDENADO y dificultad (def. 60)
 *     --semillasNormal=N  ídem sólo para normal (def. = semillas): la matriz 13×13 sale de normal
 *     --humano=N          partidas de CADA humano (simple y novato) por barbero del humano y
 *                         dificultad, repartidas entre los 13 rivales y los dos lados (def. 52).
 *                         Con un múltiplo de 26 cada celda de la matriz humano×CPU tiene lo mismo
 *     --humanoNormal=N    ídem sólo para normal (def. = humano): la matriz humano×CPU sale de normal
 *     --humanos=simple    qué humanos corren (def. simple,novato)
 *     --novatos=N         novato contra novato: partidas por cruce ordenado (def. 10; 0 = no corre)
 *     --sal=K             semillas NUEVAS (un hash del contador y de K): para validar con semillas
 *                         distintas de las que usó el ajuste. Sin --sal, las de siempre.
 *     --dif=facil,normal  dificultades (def. las 3)
 *     --solo=a,b          sólo esos luchadores (contra todos)
 *     --hilos=K           hilos (def. 6)
 *     --informe=ruta.md   escribe el informe en Markdown
 *     --json=ruta.json    escribe los números crudos
 *     --ajuste=ruta.json  prueba otros números sin tocar el código: { "danio": {id: [normales, especiales, guardia]},
 *                         "vida": {id: vidaMax}, "costo": {id: [c1, c2]},
 *                         "pericia": {id: {facil: n, dificil: n}}, "periciaHumano": {id: {normal: n}},
 *                         "asistencia": {id: {normal: n}}, "kit": {id: {"ruta.del.campo": valor}} }
 *                         (lo usa afinar.mts; la pericia de la CPU, EstiloCpu.pericia, empareja
 *                         fácil y difícil sin tocar el kit; periciaHumano y asistencia, contra una
 *                         persona; kit, cambios de diseño de un movimiento)
 *
 * Usa la meta real de los atlas si existen (public/juego/personajes/<id>/atlas.json); si no, la típica.
 * Metas (pedido del dueño: «todos los players deben estar equilibrados, todos deben de ser
 * competitivos»):
 *  - CPU contra CPU: cada luchador 45–55 % en cada dificultad; ningún cruce fuera de 35–65 % en
 *    normal; sesgo de lado < 3 %; espejos ≈ 50 %; casi ningún round por tiempo; todos los
 *    especiales se usan y aciertan.
 *  - Humanos contra la CPU NORMAL (la dificultad por defecto): con los dos humanos, el % que gana
 *    el humano queda entre 25 y 55 % para cada barbero, de los dos lados de la matriz (el que elige
 *    el humano y el que maneja la CPU). En fácil el simple gana ≥ 70 % con cada barbero y en
 *    difícil ningún humano pasa de 20 %.
 *  - La CPU usa los DOS especiales: contra el humano simple, cada especial es ≥ 20 % de los que
 *    tira con cada barbero, en cada dificultad.
 *  - Novato contra novato: cada barbero entre 35 y 65 % (el pedido de la revisión del 30/oct,
 *    segunda tanda: es un solo bot haciendo de las dos personas, la vara es gruesa a propósito).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AtlasPersonaje, Dificultad, EntradaJugador, IdPersonaje, Lado, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA, TPS } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { duracionesDeRounds } from '../../../src/lib/juego/motor/partida.ts'
import { DANIO_KIT, KITS_DISENIO, MOVIMIENTOS, conDanio } from '../../../src/lib/juego/motor/movimientos.ts'
import type { KitPersonaje } from '../../../src/lib/juego/motor/movimientos.ts'
import { CONTRA_PERSONA, PARAMS_CPU } from '../../../src/lib/juego/motor/cpu.ts'
import type { ParamsCpu } from '../../../src/lib/juego/motor/cpu.ts'
import { IDS_PERSONAJES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const MAX_TICKS = 6 * 60 * TPS
const DIFS: Dificultad[] = ['facil', 'normal', 'dificil']

/** Metas (ver el encabezado). */
const META_HUMANO_NORMAL: readonly [number, number] = [25, 55]
const TOPE_HUMANO_DIFICIL = 20
const MIN_SIMPLE_FACIL = 70
const MIN_ESPECIAL_CPU = 20
const META_NOVATOS: readonly [number, number] = [35, 65]

// ─── Meta de animaciones ─────────────────────────────────────────────────────

const TIPICA: Record<string, [number, number[]]> = {
  quieto: [5, []], caminar: [6, []], correr: [4, []], dash: [3, []], guardia: [4, []], agachado: [4, []],
  saltar: [4, []], caer: [6, []], golpe: [5, [4]], patada: [4, [2]], combo: [8, [2, 5, 7]], herramienta1: [4, [2]],
  herramienta2: [3, [1]], especial1: [5, [3]], especial2: [6, [2]], danio: [5, []], ko: [3, []], levantarse: [5, []],
  victoria: [6, []], burla: [8, []],
}
function metaDe(id: IdPersonaje): { meta: MetaAnimaciones; origen: string } {
  const ruta = join(REPO, 'public/juego/personajes', id, 'atlas.json')
  if (existsSync(ruta)) {
    try {
      return { meta: metaDesdeAtlas(JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje), origen: 'atlas' }
    } catch {
      /* cae a la típica */
    }
  }
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return { meta: m, origen: 'típica' }
}

// ─── Humanos de bot ──────────────────────────────────────────────────────────

function rng(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
interface Humano {
  r: () => number
  guardiaT: number
  golpeT: number
  movRival: string | null
  /** Lo que apretó el tick anterior (el motor lee flancos). */
  prev: Partial<EntradaJugador>
  /** Novato: ticks que tarda en apretar el especial que se encendió (−1 = no hay ninguno listo). */
  esperaEsp: number
}
type NombreHumano = 'simple' | 'novato'
const HUMANOS: readonly NombreHumano[] = ['simple', 'novato']

function humanoNuevo(semilla: number): Humano {
  return { r: rng(semilla), guardiaT: 0, golpeT: 0, movRival: null, prev: {}, esperaEsp: -1 }
}

/** «Humano simple» (el mismo de simular.mts): camina hacia el rival, machaca GOLPE de cerca y a veces se cubre. */
function entradaSimple(h: Humano, p: Partida, lado: Lado): EntradaJugador {
  const yo = p.luchadores[lado]
  const rv = p.luchadores[lado === 0 ? 1 : 0]
  const e: EntradaJugador = { ...ENTRADA_VACIA }
  const nuevoAtaque = rv.movimiento !== null && rv.movimiento !== h.movRival
  h.movRival = rv.movimiento
  if (p.fase !== 'pelea' && p.fase !== 'final') return e
  if (h.guardiaT > 0) {
    h.guardiaT--
    e.guardia = true
    return e
  }
  const d = Math.abs(rv.x - yo.x)
  if (nuevoAtaque && d < 260 && h.r() < 0.3) {
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

/**
 * «Novato» (el de la verificación del 30/oct, confirmar-servidor-datos/sim/humano.mts): como el
 * simple, pero alterna GOLPE y MÁQUINA y aprieta un especial cuando se le enciende (sin apuntar,
 * con 0,3–1,3 s de demora), que es lo que hace alguien que ve el botón prendido.
 */
function entradaNovato(h: Humano, p: Partida, lado: Lado): EntradaJugador {
  const yo = p.luchadores[lado]
  const rv = p.luchadores[lado === 0 ? 1 : 0]
  const e: EntradaJugador = { ...ENTRADA_VACIA }
  const nuevoAtaque = rv.movimiento !== null && rv.movimiento !== h.movRival
  h.movRival = rv.movimiento
  if (p.fase !== 'pelea' && p.fase !== 'final') return e
  if (h.guardiaT > 0) {
    h.guardiaT--
    e.guardia = true
    return e
  }
  const d = Math.abs(rv.x - yo.x)
  if (nuevoAtaque && d < 260 && h.r() < 0.3) {
    h.guardiaT = 20
    e.guardia = true
    return e
  }
  const f = PERSONAJES[yo.id]
  const listo2 = yo.carga + 1e-9 >= f.especiales[1].costo
  const listo1 = yo.carga + 1e-9 >= f.especiales[0].costo
  if (listo1 || listo2) {
    if (h.esperaEsp < 0) h.esperaEsp = 18 + Math.floor(h.r() * 60)
    if (h.esperaEsp === 0) {
      h.esperaEsp = -1
      const boton = listo2 && h.r() < 0.5 ? 'especial2' : 'especial1'
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

const ENTRADA_HUMANO: Record<NombreHumano, (h: Humano, p: Partida, lado: Lado) => EntradaJugador> = {
  simple: entradaSimple,
  novato: entradaNovato,
}

// ─── Una partida ─────────────────────────────────────────────────────────────

interface Trabajo {
  a: IdPersonaje
  b: IdPersonaje
  dif: Dificultad
  semilla: number
  /** Lado del humano contra la CPU (null = CPU contra CPU, o los dos humanos si `novatos`). */
  humano: Lado | null
  bot: NombreHumano | null
  /** Novato contra novato (los dos lados son personas: como online). */
  novatos: boolean
}

interface ResultadoPartida {
  ganador: Lado | null
  ticks: number
  terminada: boolean
  rounds: number[]
  tiempos: number
  /** Por lado: usos y aciertos de cada especial [e1, e2]. */
  usos: [[number, number], [number, number]]
  aciertos: [[number, number], [number, number]]
  danio: [number, number]
  curado: [number, number]
  violacion: string | null
}

function jugar(t: Trabajo, metas: Record<string, MetaAnimaciones>): ResultadoPartida {
  const p = crearPartida({
    personajes: [t.a, t.b],
    cpu: t.novatos ? [false, false] : [t.humano !== 0, t.humano !== 1],
    dificultad: t.dif,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [metas[t.a], metas[t.b]],
    semilla: t.semilla,
  })
  const I = internoDe(p)
  // El humano del lado `t.humano` (o los dos, novato contra novato), cada uno con su azar.
  const humanos: [Humano | null, Humano | null] = [null, null]
  if (t.novatos) {
    humanos[0] = humanoNuevo(t.semilla * 7 + 3)
    humanos[1] = humanoNuevo(t.semilla * 13 + 11)
  } else if (t.humano !== null) humanos[t.humano] = humanoNuevo(t.semilla * 7 + 3)
  const entrada = ENTRADA_HUMANO[t.bot ?? 'simple']
  const selloNumero = new Map<number, 1 | 2>()
  const ultimo: [number, number] = [0, 0]
  const usos: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ]
  const aciertos: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ]
  let tiempos = 0
  let violacion: string | null = null
  while (p.fase !== 'terminada' && p.tick < MAX_TICKS) {
    const ent: [EntradaJugador, EntradaJugador] = [ENTRADA_VACIA, ENTRADA_VACIA]
    for (const lado of [0, 1] as const) {
      const h = humanos[lado]
      if (!h) continue
      const e = entrada(h, p, lado)
      h.prev = e
      ent[lado] = e
    }
    avanzar(p, ent)
    for (const ev of p.eventos.splice(0)) {
      if (ev.tipo === 'especial') {
        usos[ev.quien][ev.numero - 1]++
        const a = I.luchadores[ev.quien].accion
        if (a) selloNumero.set(a.sello, ev.numero)
      } else if (ev.tipo === 'tiempo') tiempos++
    }
    for (const lado of [0, 1] as const) {
      const s = I.ultimoAcierto[lado]
      if (s !== ultimo[lado]) {
        ultimo[lado] = s
        const n = selloNumero.get(s)
        if (n) aciertos[lado][n - 1]++
      }
      const l = p.luchadores[lado]
      if (!violacion && (!Number.isFinite(l.x) || !Number.isFinite(l.vida) || l.x < 70 || l.x > 890 || l.y < 0 || l.vida > l.vidaMax)) {
        violacion = `${t.a}-${t.b} ${t.dif} s${t.semilla} t=${p.tick}: ${l.id} x=${l.x} y=${l.y} vida=${l.vida}`
      }
    }
  }
  return {
    ganador: p.ganadorPartida,
    ticks: p.tick,
    terminada: p.fase === 'terminada',
    rounds: [...duracionesDeRounds(p)],
    tiempos,
    usos,
    aciertos,
    danio: [p.estadisticas[0].danioHecho, p.estadisticas[1].danioHecho],
    curado: [p.estadisticas[0].curado, p.estadisticas[1].curado],
    violacion,
  }
}

// ─── Acumulados ──────────────────────────────────────────────────────────────

interface Acum {
  /** clave `${dif}|${a}|${b}` → [partidas, ganó lado 0, ganó lado 1] (CPU vs CPU). */
  cruces: Record<string, [number, number, number]>
  /** clave `${dif}|${id}|${n}` → [usos, aciertos, partidas jugadas por ese id] (CPU vs CPU). */
  especiales: Record<string, [number, number, number]>
  /** clave dif → duraciones de round (ticks, CPU vs CPU). */
  rounds: Record<string, number[]>
  tiempos: Record<string, number>
  totalRounds: Record<string, number>
  /** clave `${bot}|${dif}|${idHumano}|${idCpu}|${ladoHumano}` → [partidas, ganadas por el humano]. */
  humanos: Record<string, [number, number]>
  /** clave `${bot}|${dif}|${idCpu}` → [usos del especial 1, usos del especial 2, partidas] de la CPU contra ese humano. */
  especialesCpu: Record<string, [number, number, number]>
  /** clave `${a}|${b}` (a en el lado 0) → [partidas, ganó lado 0, ganó lado 1] de novato contra novato. */
  novatos: Record<string, [number, number, number]>
  noTerminan: number
  violaciones: string[]
  curado: Record<string, number>
}

function acumVacio(): Acum {
  return {
    cruces: {},
    especiales: {},
    rounds: {},
    tiempos: {},
    totalRounds: {},
    humanos: {},
    especialesCpu: {},
    novatos: {},
    noTerminan: 0,
    violaciones: [],
    curado: {},
  }
}

function sumarEn<T extends number[]>(r: Record<string, T>, k: string, v: readonly number[], vacio: () => T): void {
  const x = (r[k] ??= vacio())
  for (let i = 0; i < v.length; i++) x[i] += v[i]
}

function sumar(ac: Acum, t: Trabajo, r: ResultadoPartida): void {
  if (!r.terminada) ac.noTerminan++
  if (r.violacion && ac.violaciones.length < 10) ac.violaciones.push(r.violacion)
  if (t.novatos) {
    sumarEn(ac.novatos, `${t.a}|${t.b}`, [1, r.ganador === 0 ? 1 : 0, r.ganador === 1 ? 1 : 0], () => [0, 0, 0])
    return
  }
  if (t.humano !== null) {
    const bot = t.bot ?? 'simple'
    const id = t.humano === 0 ? t.a : t.b
    const cpu = (1 - t.humano) as Lado
    const idCpu = cpu === 0 ? t.a : t.b
    sumarEn(ac.humanos, `${bot}|${t.dif}|${id}|${idCpu}|${t.humano}`, [1, r.ganador === t.humano ? 1 : 0], () => [0, 0])
    sumarEn(ac.especialesCpu, `${bot}|${t.dif}|${idCpu}`, [r.usos[cpu][0], r.usos[cpu][1], 1], () => [0, 0, 0])
    return
  }
  const k = `${t.dif}|${t.a}|${t.b}`
  sumarEn(ac.cruces, k, [1, r.ganador === 0 ? 1 : 0, r.ganador === 1 ? 1 : 0], () => [0, 0, 0])
  ;(ac.rounds[t.dif] ??= []).push(...r.rounds)
  ac.tiempos[t.dif] = (ac.tiempos[t.dif] ?? 0) + r.tiempos
  ac.totalRounds[t.dif] = (ac.totalRounds[t.dif] ?? 0) + r.rounds.length
  for (const lado of [0, 1] as const) {
    const id = lado === 0 ? t.a : t.b
    for (const n of [1, 2] as const) sumarEn(ac.especiales, `${t.dif}|${id}|${n}`, [r.usos[lado][n - 1], r.aciertos[lado][n - 1], 1], () => [0, 0, 0])
    ac.curado[id] = (ac.curado[id] ?? 0) + r.curado[lado]
  }
}

function fusionar(a: Acum, b: Acum): Acum {
  for (const [k, v] of Object.entries(b.cruces)) sumarEn(a.cruces, k, v, () => [0, 0, 0])
  for (const [k, v] of Object.entries(b.especiales)) sumarEn(a.especiales, k, v, () => [0, 0, 0])
  for (const [k, v] of Object.entries(b.rounds)) (a.rounds[k] ??= []).push(...v)
  for (const [k, v] of Object.entries(b.tiempos)) a.tiempos[k] = (a.tiempos[k] ?? 0) + v
  for (const [k, v] of Object.entries(b.totalRounds)) a.totalRounds[k] = (a.totalRounds[k] ?? 0) + v
  for (const [k, v] of Object.entries(b.humanos)) sumarEn(a.humanos, k, v, () => [0, 0])
  for (const [k, v] of Object.entries(b.especialesCpu)) sumarEn(a.especialesCpu, k, v, () => [0, 0, 0])
  for (const [k, v] of Object.entries(b.novatos)) sumarEn(a.novatos, k, v, () => [0, 0, 0])
  for (const [k, v] of Object.entries(b.curado)) a.curado[k] = (a.curado[k] ?? 0) + v
  a.noTerminan += b.noTerminan
  a.violaciones.push(...b.violaciones.slice(0, Math.max(0, 10 - a.violaciones.length)))
  return a
}

// ─── Hilo de trabajo ─────────────────────────────────────────────────────────

export interface Ajuste {
  /**
   * Cambios de kit para probar sin tocar movimientos.ts: { id: { "ruta.del.campo": valor } } sobre
   * el kit de DISEÑO (antes del factor de daño), con índices numéricos para las listas, por ejemplo
   * { "chipi": { "caminar": 3.1, "movimientos.puno.total": 17, "especiales.0.embestida.distancia": 300 } }.
   */
  kit?: Partial<Record<IdPersonaje, Record<string, unknown>>>
  /** Escala el daño de diseño de la cadena de GOLPE (con la aérea) y la de la HERRAMIENTA de un barbero. */
  cadenas?: Partial<Record<IdPersonaje, { golpe?: number; herramienta?: number }>>
  /** Pisa parámetros de la CPU de una dificultad (PARAMS_CPU de cpu.ts), para probar. */
  params?: Partial<Record<Dificultad, Partial<ParamsCpu>>>
  /** Pisa lo que cambia contra una persona (CONTRA_PERSONA de cpu.ts). */
  persona?: Partial<Record<Dificultad, Partial<ParamsCpu>>>
  danio?: Partial<Record<IdPersonaje, [number, number, number?, number?]>>
  vida?: Partial<Record<IdPersonaje, number>>
  costo?: Partial<Record<IdPersonaje, [number, number]>>
  /** Pericia de la CPU por barbero y dificultad (EstiloCpu.pericia): reemplaza la del kit. */
  pericia?: Partial<Record<IdPersonaje, Partial<Record<Dificultad, number>>>>
  /** Pericia de la CPU contra una persona (EstiloCpu.periciaHumano): reemplaza la del kit. */
  periciaHumano?: Partial<Record<IdPersonaje, Partial<Record<Dificultad, number>>>>
  /** Asistencia a la persona que juega con ese barbero (EstiloCpu.asistencia): reemplaza la del kit. */
  asistencia?: Partial<Record<IdPersonaje, Partial<Record<Dificultad, number>>>>
}

/** Pone `valor` en `ruta` («a.b.0.c») dentro de `obj` (para los cambios de kit de un ajuste). */
export function parchar(obj: unknown, ruta: string, valor: unknown): void {
  const partes = ruta.split('.')
  let o = obj as Record<string, unknown>
  for (const parte of partes.slice(0, -1)) {
    if (o[parte] === undefined || o[parte] === null) o[parte] = {}
    o = o[parte] as Record<string, unknown>
  }
  o[partes[partes.length - 1]] = valor
}

/** Aplica un ajuste de prueba al catálogo y a los kits (sólo en el proceso del simulador). */
export function aplicarAjuste(a: Ajuste | null): void {
  if (!a) return
  for (const [d, q] of Object.entries(a.params ?? {})) Object.assign(PARAMS_CPU[d as Dificultad], q)
  for (const [d, q] of Object.entries(a.persona ?? {})) CONTRA_PERSONA[d as Dificultad] = { ...CONTRA_PERSONA[d as Dificultad], ...q }
  const ids = new Set([...Object.keys(a.kit ?? {}), ...Object.keys(a.cadenas ?? {})]) as Set<IdPersonaje>
  for (const id of ids) {
    const k = structuredClone(KITS_DISENIO[id])
    for (const [ruta, valor] of Object.entries(a.kit?.[id] ?? {})) parchar(k, ruta, valor)
    const esc = a.cadenas?.[id]
    for (const [boton, f] of [['golpe', esc?.golpe], ['herramienta', esc?.herramienta]] as const) {
      if (!f || f === 1) continue
      const movs: string[] = boton === 'golpe' ? [k.inicio.aereo] : []
      for (let m: string | undefined = boton === 'golpe' ? k.inicio.golpe : k.inicio.herramienta; m && movs.length < 8; m = k.movimientos[m]?.siguiente) movs.push(m)
      for (const m of movs) for (const v of k.movimientos[m]?.ventanas ?? []) v.danio = Math.max(1, Math.round(v.danio * f))
    }
    ;(KITS_DISENIO as Record<IdPersonaje, KitPersonaje>)[id] = k
    const [fn, fe, fg, fge] = DANIO_KIT[id]
    MOVIMIENTOS[id] = conDanio(k, fn, fe, fg, fge)
  }
  for (const [id, f] of Object.entries(a.danio ?? {})) {
    const [fn, fe, fg, fge] = f as [number, number, number?, number?]
    MOVIMIENTOS[id as IdPersonaje] = conDanio(KITS_DISENIO[id as IdPersonaje], fn, fe, fg ?? 1, fge ?? fg ?? 1)
  }
  for (const [id, v] of Object.entries(a.vida ?? {})) PERSONAJES[id as IdPersonaje].vidaMax = v as number
  for (const [id, c] of Object.entries(a.costo ?? {})) {
    PERSONAJES[id as IdPersonaje].especiales[0].costo = (c as [number, number])[0]
    PERSONAJES[id as IdPersonaje].especiales[1].costo = (c as [number, number])[1]
  }
  for (const campo of ['pericia', 'periciaHumano', 'asistencia'] as const) {
    for (const [id, pe] of Object.entries(a[campo] ?? {})) {
      const k = MOVIMIENTOS[id as IdPersonaje]
      MOVIMIENTOS[id as IdPersonaje] = { ...k, cpu: { ...k.cpu, [campo]: { ...pe } } }
    }
  }
}

if (!isMainThread) {
  const { trabajos, ids, ajuste } = workerData as { trabajos: Trabajo[]; ids: IdPersonaje[]; ajuste: Ajuste | null }
  aplicarAjuste(ajuste)
  const metas: Record<string, MetaAnimaciones> = {}
  for (const id of ids) metas[id] = metaDe(id).meta
  const ac = acumVacio()
  for (const t of trabajos) sumar(ac, t, jugar(t, metas))
  parentPort?.postMessage(ac)
}

// ─── Semillas ────────────────────────────────────────────────────────────────

function mezcla32(x: number): number {
  x = x >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * Semilla del trabajo número `b` de la clase `mult` (7919 CPU contra CPU, 104729 humanos, 1299709
 * novatos). Sin sal, la fórmula de siempre: las tablas publicadas se reproducen. Con sal, un hash
 * del contador, de la sal y de la clase: semillas que no tocó ningún ajuste.
 */
function semillaDe(b: number, mult: number, sal: number | null): number {
  if (sal === null) return (b * mult) % 2147483647
  return 1 + (mezcla32(mezcla32(b + 0x3c6ef372) ^ mezcla32(Math.imul(sal, 0x9e3779b1) + (mult % 1000))) % 2147483646)
}

// ─── Principal ───────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const semillas = Number(arg('semillas') ?? 60)
  const semillasNormal = Number(arg('semillasNormal') ?? semillas)
  const semillasHumano = Number(arg('humano') ?? 52)
  const semillasHumanoNormal = Number(arg('humanoNormal') ?? semillasHumano)
  const humanos = (arg('humanos')?.split(',') ?? HUMANOS) as NombreHumano[]
  for (const h of humanos) if (!ENTRADA_HUMANO[h]) throw new Error(`humano desconocido: ${h}`)
  const semillasNovatos = Number(arg('novatos') ?? 10)
  const salArg = arg('sal')
  const sal = salArg !== undefined ? Number(salArg) : null
  const difs = (arg('dif')?.split(',') ?? DIFS) as Dificultad[]
  const ids: IdPersonaje[] = [...IDS_PERSONAJES]
  const solo = arg('solo')?.split(',') as IdPersonaje[] | undefined
  const hilos = Math.max(1, Math.min(Number(arg('hilos') ?? 6), availableParallelism()))
  const rutaAjuste = arg('ajuste')
  const ajuste: Ajuste | null = rutaAjuste ? (JSON.parse(readFileSync(rutaAjuste, 'utf8')) as Ajuste) : null
  aplicarAjuste(ajuste)

  const trabajos: Trabajo[] = []
  let base = 1
  for (const dif of difs) {
    const n = dif === 'normal' ? semillasNormal : semillas
    for (const a of ids) {
      for (const b of ids) {
        if (solo && !solo.includes(a) && !solo.includes(b)) continue
        for (let s = 0; s < n; s++) trabajos.push({ a, b, dif, semilla: semillaDe(base++, 7919, sal), humano: null, bot: null, novatos: false })
      }
    }
    // Los humanos: cada barbero del humano contra los 13 rivales, alternando el lado de la pantalla.
    const nh = dif === 'normal' ? semillasHumanoNormal : semillasHumano
    for (const bot of humanos) {
      for (const yo of ids) {
        for (let s = 0; s < nh; s++) {
          const rival = ids[Math.floor(s / 2) % ids.length]
          if (solo && !solo.includes(yo) && !solo.includes(rival)) continue
          const lado = (s % 2) as Lado
          const [a, b] = lado === 0 ? [yo, rival] : [rival, yo]
          trabajos.push({ a, b, dif, semilla: semillaDe(base++, 104729, sal), humano: lado, bot, novatos: false })
        }
      }
    }
  }
  // Novato contra novato (no hay CPU: la dificultad no cambia nada; va como normal).
  for (const a of ids) {
    for (const b of ids) {
      if (solo && !solo.includes(a) && !solo.includes(b)) continue
      for (let s = 0; s < semillasNovatos; s++) {
        trabajos.push({ a, b, dif: 'normal', semilla: semillaDe(base++, 1299709, sal), humano: null, bot: 'novato', novatos: true })
      }
    }
  }
  // Repartir intercalado (los cruces pesados no caen todos en el mismo hilo).
  const lotes: Trabajo[][] = Array.from({ length: hilos }, () => [])
  trabajos.forEach((t, i) => lotes[i % hilos].push(t))
  const t0 = performance.now()
  const cargador = new URL('./cargador.mjs', import.meta.url).pathname
  const parciales = await Promise.all(
    lotes.map(
      (lote) =>
        new Promise<Acum>((resolver, rechazar) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { trabajos: lote, ids, ajuste }, execArgv: ['--import', cargador] })
          w.once('message', (m) => resolver(m as Acum))
          w.once('error', rechazar)
        }),
    ),
  )
  const ac = parciales.reduce(fusionar, acumVacio())
  const seg = (performance.now() - t0) / 1000
  const origenes = ids.map((id) => `${id}=${metaDe(id).origen}`).join(' ')
  informe(
    ac,
    { difs, ids, seg, partidas: trabajos.length, semillas, semillasNormal, semillasHumano, semillasHumanoNormal, humanos, semillasNovatos, sal, origenes, hilos },
    arg('informe'),
    arg('json'),
  )
}

// ─── Informe ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? (100 * n) / d : NaN
}
function f1(x: number): string {
  return Number.isFinite(x) ? x.toFixed(1) : '–'
}
/** Medio intervalo de confianza del 95 % de un porcentaje con n partidas. */
function ic(v: number, n: number): number {
  return n > 0 && Number.isFinite(v) ? 196 * Math.sqrt((v / 100) * (1 - v / 100) / n) : NaN
}

interface Opciones {
  difs: Dificultad[]
  ids: IdPersonaje[]
  seg: number
  partidas: number
  semillas: number
  semillasNormal: number
  semillasHumano: number
  semillasHumanoNormal: number
  humanos: NombreHumano[]
  semillasNovatos: number
  sal: number | null
  origenes: string
  hilos: number
}

function informe(ac: Acum, o: Opciones, rutaMd?: string, rutaJson?: string): void {
  const lineas: string[] = []
  const fallas: string[] = []
  const L = (s = '') => lineas.push(s)
  const nombre = (id: IdPersonaje) => PERSONAJES[id].nombre
  L(`# Balance de «Corte Final» — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  L()
  L(
    `${o.partidas} partidas en ${o.seg.toFixed(0)} s (${o.hilos} hilos). CPU contra CPU: ${o.semillas} por cruce ordenado (normal ${o.semillasNormal}); ` +
      `humanos (${o.humanos.join(', ') || 'ninguno'}): ${o.semillasHumano} por barbero y dificultad (normal ${o.semillasHumanoNormal}); ` +
      `novato contra novato: ${o.semillasNovatos} por cruce ordenado. Semillas: ${o.sal === null ? 'las de siempre' : `nuevas (sal ${o.sal})`}.`,
  )
  L(`Meta de animaciones: ${o.origenes}.`)
  L()

  // Victorias por luchador y dificultad (sin espejos).
  const porLuchador: Record<string, Record<string, [number, number]>> = {}
  const lado0: Record<string, [number, number]> = {}
  const espejo: Record<string, [number, number]> = {}
  for (const [k, [n, g0, g1]] of Object.entries(ac.cruces)) {
    const [dif, a, b] = k.split('|') as [Dificultad, IdPersonaje, IdPersonaje]
    if (a === b) {
      const e = (espejo[dif] ??= [0, 0])
      e[0] += g0 + g1
      e[1] += g0
      continue
    }
    const x = ((porLuchador[dif] ??= {})[a] ??= [0, 0])
    x[0] += n
    x[1] += g0
    const y = ((porLuchador[dif] ??= {})[b] ??= [0, 0])
    y[0] += n
    y[1] += g1
    const s = (lado0[dif] ??= [0, 0])
    s[0] += g0 + g1
    s[1] += g0
  }
  if (Object.keys(ac.cruces).length) {
    L('## Victorias por luchador (CPU contra CPU, sin espejos)')
    L()
    L(`| Luchador | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const x = porLuchador[d]?.[id]
        const v = x ? pct(x[1], x[0]) : NaN
        if (Number.isFinite(v) && (v < 45 || v > 55)) fallas.push(`${nombre(id)} gana ${f1(v)} % en ${d} (meta 45–55)`)
        return `${f1(v)} %${Number.isFinite(v) && (v < 45 || v > 55) ? ' (!)' : ''}`
      })
      L(`| ${nombre(id)} | ${celdas.join(' | ')} |`)
    }
    L()
    L('Sesgo de lado (gana el de la izquierda, sin espejos) y espejos:')
    for (const d of o.difs) {
      const s = lado0[d]
      const e = espejo[d]
      const v = s ? pct(s[1], s[0]) : NaN
      const ve = e ? pct(e[1], e[0]) : NaN
      if (Math.abs(v - 50) >= 3) fallas.push(`sesgo de lado en ${d}: ${f1(v)} %`)
      L(`- ${d}: izquierda ${f1(v)} % (${s?.[0] ?? 0} partidas); espejos: izquierda ${f1(ve)} % (${e?.[0] ?? 0})`)
    }
    L()

    // Matriz de normal (fila contra columna, los dos lados juntos).
    const dm: Dificultad = o.difs.includes('normal') ? 'normal' : o.difs[0]
    L(`## Cruces en ${dm} (gana la fila contra la columna, los dos lados juntos)`)
    L()
    L(`| | ${o.ids.map((id) => nombre(id)).join(' | ')} |`)
    L(`|---|${o.ids.map(() => '---:').join('|')}|`)
    let fuera = 0
    let peor = { v: 50, a: '', b: '', n: 0 }
    for (const a of o.ids) {
      const celdas = o.ids.map((b) => {
        if (a === b) return '·'
        const x = ac.cruces[`${dm}|${a}|${b}`]
        const y = ac.cruces[`${dm}|${b}|${a}`]
        const n = (x?.[0] ?? 0) + (y?.[0] ?? 0)
        const g = (x?.[1] ?? 0) + (y?.[2] ?? 0)
        const v = pct(g, n)
        if (Number.isFinite(v) && Math.abs(v - 50) > Math.abs(peor.v - 50)) peor = { v, a: nombre(a), b: nombre(b), n }
        const malo = Number.isFinite(v) && (v < 35 || v > 65)
        if (malo && a < b) fuera++
        return `${Number.isFinite(v) ? v.toFixed(0) : '–'}${malo ? '(!)' : ''}`
      })
      L(`| ${nombre(a)} | ${celdas.join(' | ')} |`)
    }
    L()
    L(`Cruces fuera de 35–65 %: ${fuera}. El más desparejo: ${peor.a} contra ${peor.b}, ${f1(peor.v)} % (${peor.n} partidas; error estándar ≈ ±${f1(100 * Math.sqrt(0.25 / Math.max(1, peor.n)))} %).`)
    if (fuera > 0 && dm === 'normal') fallas.push(`${fuera} cruces fuera de 35–65 % en normal`)
    L()

    // Rounds.
    L('## Rounds (CPU contra CPU)')
    L()
    for (const d of o.difs) {
      const rs = (ac.rounds[d] ?? []).map((x) => x / TPS).sort((a, b) => a - b)
      const media = rs.reduce((s, x) => s + x, 0) / Math.max(1, rs.length)
      const p = (q: number) => rs[Math.min(rs.length - 1, Math.floor(q * rs.length))] ?? 0
      const tiempo = pct(ac.tiempos[d] ?? 0, ac.totalRounds[d] ?? 0)
      if (tiempo > 3) fallas.push(`en ${d} el ${f1(tiempo)} % de los rounds termina por tiempo`)
      L(`- ${d}: media ${f1(media)} s (p10 ${f1(p(0.1))}, p50 ${f1(p(0.5))}, p90 ${f1(p(0.9))}); por tiempo ${f1(tiempo)} %`)
    }
    L()

    // Especiales.
    L('## Especiales (CPU contra CPU, todas las dificultades): usos por partida, % que acierta y parte de cada uno')
    L()
    L('| Luchador | Especial 1 | usos | acierta | Especial 2 | usos | acierta | e1 / e2 |')
    L('|---|---|---:|---:|---|---:|---:|---:|')
    for (const id of o.ids) {
      const fila: string[] = [nombre(id)]
      const usosN: number[] = []
      for (const n of [1, 2] as const) {
        let u = 0
        let h = 0
        let j = 0
        for (const d of o.difs) {
          const e = ac.especiales[`${d}|${id}|${n}`]
          if (!e) continue
          u += e[0]
          h += e[1]
          j += e[2]
        }
        usosN.push(u)
        const porPartida = u / Math.max(1, j)
        const acierta = pct(h, u)
        if (u === 0 || h === 0) fallas.push(`${nombre(id)}: ${PERSONAJES[id].especiales[n - 1].nombre} nunca ${u === 0 ? 'se usa' : 'acierta'}`)
        else if (porPartida < 0.4) fallas.push(`${nombre(id)}: ${PERSONAJES[id].especiales[n - 1].nombre} casi no se usa (${porPartida.toFixed(2)} por partida)`)
        fila.push(PERSONAJES[id].especiales[n - 1].nombre, porPartida.toFixed(2), `${f1(acierta)} %`)
      }
      fila.push(`${f1(pct(usosN[0], usosN[0] + usosN[1]))} / ${f1(pct(usosN[1], usosN[0] + usosN[1]))}`)
      L(`| ${fila.join(' | ')} |`)
    }
    L()
  }

  // ─── Humanos contra la CPU ───
  const hum = (bot: string, d: string, filtro: (yo: IdPersonaje, cpu: IdPersonaje, lado: Lado) => boolean): [number, number] => {
    let n = 0
    let g = 0
    for (const [k, v] of Object.entries(ac.humanos)) {
      const [b, dif, yo, cpu, lado] = k.split('|')
      if (b !== bot || dif !== d || !filtro(yo as IdPersonaje, cpu as IdPersonaje, Number(lado) as Lado)) continue
      n += v[0]
      g += v[1]
    }
    return [n, g]
  }
  for (const bot of o.humanos) {
    if (!Object.keys(ac.humanos).some((k) => k.startsWith(`${bot}|`))) continue
    L(`## Humano «${bot}» contra la CPU: % que gana el humano con cada barbero (los 13 rivales, los dos lados)`)
    L()
    L(`| Barbero del humano | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const [n, g] = hum(bot, d, (yo) => yo === id)
        const v = pct(g, n)
        if (d === 'dificil' && Number.isFinite(v) && v > TOPE_HUMANO_DIFICIL) fallas.push(`humano ${bot} con ${nombre(id)} gana ${f1(v)} % en difícil (tope ${TOPE_HUMANO_DIFICIL})`)
        if (d === 'facil' && bot === 'simple' && Number.isFinite(v) && v < MIN_SIMPLE_FACIL) fallas.push(`humano simple con ${nombre(id)} gana ${f1(v)} % en fácil (mínimo ${MIN_SIMPLE_FACIL})`)
        return `${f1(v)} %`
      })
      L(`| ${nombre(id)} | ${celdas.join(' | ')} |`)
    }
    const lados = o.difs.map((d) => {
      const [n0, g0] = hum(bot, d, (_y, _c, lado) => lado === 0)
      const [n1, g1] = hum(bot, d, (_y, _c, lado) => lado === 1)
      return `${d}: izquierda ${f1(pct(g0, n0))} % / derecha ${f1(pct(g1, n1))} %`
    })
    L()
    L(`Lado del humano — ${lados.join(' · ')}`)
    L()
    if (!o.difs.includes('normal')) continue
    // La matriz de normal con las dos marginales.
    const [lo, hi] = META_HUMANO_NORMAL
    L(`### Matriz humano «${bot}» × CPU en normal (fila: barbero del humano; columna: barbero de la CPU; % que gana el humano)`)
    L()
    L(`| | ${o.ids.map((id) => nombre(id)).join(' | ')} | por barbero del humano |`)
    L(`|---|${o.ids.map(() => '---:').join('|')}|---:|`)
    for (const yo of o.ids) {
      const celdas = o.ids.map((cpu) => {
        const [n, g] = hum(bot, 'normal', (y, c) => y === yo && c === cpu)
        return n ? pct(g, n).toFixed(0) : '–'
      })
      const [n, g] = hum(bot, 'normal', (y) => y === yo)
      const v = pct(g, n)
      const malo = Number.isFinite(v) && (v < lo || v > hi)
      if (malo) fallas.push(`humano ${bot} en normal con ${nombre(yo)} gana ${f1(v)} % (meta ${lo}–${hi})`)
      L(`| ${nombre(yo)} | ${celdas.join(' | ')} | ${f1(v)} ±${f1(ic(v, n))}${malo ? ' (!)' : ''} |`)
    }
    const porCpu = o.ids.map((cpu) => {
      const [n, g] = hum(bot, 'normal', (_y, c) => c === cpu)
      const v = pct(g, n)
      const malo = Number.isFinite(v) && (v < lo || v > hi)
      if (malo) fallas.push(`humano ${bot} en normal contra la CPU ${nombre(cpu)} gana ${f1(v)} % (meta ${lo}–${hi})`)
      return `${f1(v)}${malo ? ' (!)' : ''}`
    })
    const [nt, gt] = hum(bot, 'normal', () => true)
    L(`| por barbero de la CPU | ${porCpu.join(' | ')} | ${f1(pct(gt, nt))} |`)
    L()
  }

  // ─── Reparto de especiales de la CPU contra el humano simple ───
  if (Object.keys(ac.especialesCpu).some((k) => k.startsWith('simple|'))) {
    L('## Especiales de la CPU contra el humano simple: parte de cada especial (y usos por partida)')
    L()
    L(`| CPU | ${o.difs.map((d) => `${d}: e1 / e2 (usos)`).join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const x = ac.especialesCpu[`simple|${d}|${id}`]
        if (!x) return '–'
        const total = x[0] + x[1]
        const v1 = pct(x[0], total)
        const v2 = pct(x[1], total)
        const malo = total > 0 && Math.min(v1, v2) < MIN_ESPECIAL_CPU
        if (malo) {
          const flojo = v1 < v2 ? 0 : 1
          fallas.push(`la CPU ${nombre(id)} en ${d} usa ${PERSONAJES[id].especiales[flojo].nombre} ${f1(Math.min(v1, v2))} % de las veces contra el humano simple (meta ≥ ${MIN_ESPECIAL_CPU})`)
        }
        return `${f1(v1)} / ${f1(v2)} (${(total / Math.max(1, x[2])).toFixed(1)})${malo ? ' (!)' : ''}`
      })
      L(`| ${nombre(id)} | ${celdas.join(' | ')} |`)
    }
    L()
  }

  // ─── Novato contra novato ───
  if (Object.keys(ac.novatos).length) {
    const [lo, hi] = META_NOVATOS
    L('## Novato contra novato (dos personas, como online): % que gana cada barbero')
    L()
    L(`| | ${o.ids.map((id) => nombre(id)).join(' | ')} | total |`)
    L(`|---|${o.ids.map(() => '---:').join('|')}|---:|`)
    let n0 = 0
    let g0 = 0
    for (const a of o.ids) {
      let na = 0
      let ga = 0
      const celdas = o.ids.map((b) => {
        const x = ac.novatos[`${a}|${b}`]
        const y = ac.novatos[`${b}|${a}`]
        if (a === b) {
          if (x) {
            n0 += x[1] + x[2]
            g0 += x[1]
          }
          return '·'
        }
        const n = (x?.[0] ?? 0) + (y?.[0] ?? 0)
        const g = (x?.[1] ?? 0) + (y?.[2] ?? 0)
        na += n
        ga += g
        if (x) {
          n0 += x[1] + x[2]
          g0 += x[1]
        }
        return n ? pct(g, n).toFixed(0) : '–'
      })
      const v = pct(ga, na)
      const malo = Number.isFinite(v) && (v < lo || v > hi)
      if (malo) fallas.push(`novato contra novato: ${nombre(a)} gana ${f1(v)} % (meta ${lo}–${hi})`)
      L(`| ${nombre(a)} | ${celdas.join(' | ')} | ${f1(v)} ±${f1(ic(v, na))}${malo ? ' (!)' : ''} |`)
    }
    L()
    L(`Lado: gana el de la izquierda ${f1(pct(g0, n0))} % (${n0} partidas, espejos incluidos).`)
    L()
  }

  if (ac.noTerminan) fallas.push(`${ac.noTerminan} partidas no terminaron`)
  if (ac.violaciones.length) fallas.push(`violaciones: ${ac.violaciones.slice(0, 3).join(' | ')}`)
  L(fallas.length ? `## Falta cumplir (${fallas.length})\n\n${fallas.map((f) => `- ${f}`).join('\n')}` : '## Cumple todas las metas')
  const texto = lineas.join('\n')
  console.log(texto)
  if (rutaMd) writeFileSync(rutaMd, texto + '\n')
  if (rutaJson) writeFileSync(rutaJson, JSON.stringify(ac))
}

// Sólo cuando se corre este archivo (importarlo, como hace _perfil, no dispara una corrida).
if (isMainThread && process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  principal().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
