/**
 * Modo historia de «Corte Final» (16/nov/2026): cuánto le gana una persona a cada piso de la torre.
 *
 * La torre son 9 peleas contra la CPU (5 barberos y los 4 Bosses: Nacho, Nehuen, Nico M. y Tony) con
 * tres dificultades de torneo. La fuerza de cada piso vive en src/lib/juego/historia/jefes.ts
 * (CPU_BARBEROS y FUERZA_JEFES) y la pelea se arma igual que en el juego: `peleaDelPiso`, la persona
 * en el lado 0, la CPU en el lado 1, `jefes: [null, refuerzo]`, 2 rounds para ganar de 60 s.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs historia.mts [opciones]
 *     --dif=facil,normal  dificultades del torneo (def. las 3)
 *     --pisos=0,5,8       sólo esos pisos (0 = el de abajo; 5 a 8, los Bosses; def. los 9)
 *     --semillas=N        peleas por barbero del jugador y piso (def. 32). En los pisos de barberos el
 *                         rival rota entre los 16 que no son el del jugador (con un múltiplo de 16,
 *                         cada uno lo mismo). Todas las personas juegan las MISMAS peleas (rival y
 *                         semilla), y todos los pisos y dificultades también: las diferencias entre
 *                         pisos son de a pares
 *     --personas=a,b      qué personas juegan (def. simple,novato,casual). La meta es el promedio de
 *                         «simple» y «novato», los oficiales de la meta B de balance.mts (ven el ataque
 *                         14 ticks tarde: REACCION_HUMANA); las demás se informan
 *     --sal=K             semillas nuevas (un hash del contador y de K), para validar con semillas que
 *                         no usó el ajuste. Sin --sal, las de siempre
 *     --sales=base,1      varias tandas de semillas juntas en un solo informe («base» = las de siempre)
 *     --hilos=K           hilos (def. 8; tope 8: el resto de la máquina es de otros)
 *     --ajuste=x.json     prueba otros números sin tocar jefes.ts:
 *                           { "barberos": { "normal": [ { "dificultad": "facil", "pericia": 0.3 }, … ] },
 *                             "jefes": { "normal": { "tony": { "vida": 1.4, "danio": 1.3 } } } }
 *                         En "barberos" va la lista entera de un torneo o { "2": { "pericia": 0.1 } }
 *                         (sólo ese piso); en "jefes", sólo los campos que cambian
 *     --afinar=V          V vueltas que corren la `pericia` de cada piso hacia su meta (la dificultad
 *                         del motor, la vida, el daño y la armadura quedan como están): en logit, cada
 *                         punto medido da una estimación y se promedian (ver siguientePericia). Corre
 *                         sólo los oficiales; al final, una corrida con las personas pedidas
 *     --salida=x.json     (con --afinar) el ajuste final, para pasarlo con --ajuste y copiarlo a jefes.ts
 *     --metas=normal      las metas de normal también en fácil y difícil: para probar tres variantes de un
 *                         piso de normal a la vez (una en cada torneo del ajuste)
 *     --informe=x.md      escribe el informe en Markdown
 *     --json=x.json       escribe los números crudos y el resumen
 *
 * Metas (pedido del dueño: «Los bosses deben de ser más fuertes que los otros […] siendo Nico y Tony
 * los más fuertes del juego en el modo historia»), con el promedio de simple y novato sobre los 17
 * barberos del jugador:
 *  - Normal: barberos 72, 64, 56, 50, 46 %; Nacho 42, Nehuen 37, Nico M. 31, Tony 27 (± 3).
 *  - Fácil: 18 puntos más en cada piso (sin pasar de 88). Difícil: 15 menos (sin bajar de 12).
 *  - En cada dificultad la curva baja piso a piso (al menos 2 puntos): Nico y Tony, los dos más
 *    difíciles de la torre, y Tony el que más.
 *  - Un Boss: ≤ 25 % de rounds por tiempo y round medio ≤ 48 s (con mucha vida y poco daño los rounds
 *    se alargan). En normal, ningún barbero del jugador en 0 % contra un Boss.
 * Ruido: con n peleas, el error de un porcentaje es ≈ ±100/√n (al 95 %); el del promedio de los dos
 * oficiales en un piso sale con las dos muestras (columna ±). Una corrida chica (los 32 de siempre,
 * ≈ 1 min) da ± 3 por piso; para decidir, la del 16/nov: `--semillas=96 --sales=4,5,6,7` (528.768
 * peleas, ≈ 12 min con 8 hilos, ± 0,5–0,9 por piso), con semillas que el afinado no usó.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AtlasPersonaje, Dificultad, IdPersonaje, MetaAnimaciones } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA, TPS } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { duracionesDeRounds } from '../../../src/lib/juego/motor/partida.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PARA_CLIENTES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import type { CpuPiso, IdJefe } from '../../../src/lib/juego/historia/jefes.ts'
import { CPU_BARBEROS, ESCALA_JEFE, FUERZA_JEFES, ORDEN_JEFES, PISOS_BARBEROS, TOTAL_PISOS, peleaDelPiso } from '../../../src/lib/juego/historia/jefes.ts'
import { crearPersona, leerNombre, reaccionDe } from './personas.mts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const MAX_TICKS = 6 * 60 * TPS
const DIFS: Dificultad[] = ['facil', 'normal', 'dificil']
/** Los de la meta (los oficiales de la meta B de balance.mts). */
const OFICIALES = ['simple', 'novato']
const PERSONAS_DEF = ['simple', 'novato', 'casual']
const HILOS_TOPE = 8

/** La meta de normal por piso (el promedio de simple y novato) y las otras dos, derivadas. */
const META_NORMAL: readonly number[] = [72, 64, 56, 50, 46, 42, 37, 31, 27]
const META: Readonly<Record<Dificultad, readonly number[]>> = {
  facil: META_NORMAL.map((m) => Math.min(88, m + 18)),
  normal: META_NORMAL,
  dificil: META_NORMAL.map((m) => Math.max(12, m - 15)),
}
/** Las metas con que se mide (con --metas=normal, las de normal en los tres torneos: para probar variantes). */
let metasEnUso: Readonly<Record<Dificultad, readonly number[]>> = META
/** Con ± 3 alcanza (pedido): no se persigue el decimal. */
const TOLERANCIA = 3
/** Cada piso, al menos esto más difícil que el anterior. */
const ESCALON_MIN = 2
const TOPE_TIEMPO_JEFE = 25
const TOPE_ROUND_JEFE = 48

/**
 * El afinador: pendiente previa de logit(% que gana la persona) por unidad de pericia, y los topes.
 * Medido (16/nov) con la CPU normal: −0,4 → 98 %, −0,2 → 80, −0,1 → 59, 0 → 37, +0,1 → 26, +0,3 → 14,
 * +0,5 → 5: cerca de 0 la pendiente es de −8 a −10 por unidad (una décima de pericia mueve 15 a 20 puntos).
 */
const PENDIENTE_PREVIA = -8
const PENDIENTE_RANGO: readonly [number, number] = [-20, -2]
const PASO_MAX = 0.15
/** La pericia que se suma, acotada para que con la base de cada barbero quede dentro de −2..2. */
const PERICIA_RANGO: readonly [number, number] = [-1.6, 1.1]

// ─── Meta de animaciones (como balance.mts) ──────────────────────────────────

const TIPICA: Record<string, [number, number[]]> = {
  quieto: [5, []], caminar: [6, []], correr: [4, []], dash: [3, []], guardia: [4, []], agachado: [4, []],
  saltar: [4, []], caer: [6, []], golpe: [5, [4]], patada: [4, [2]], combo: [8, [2, 5, 7]], herramienta1: [4, [2]],
  herramienta2: [3, [1]], especial1: [5, [3]], especial2: [6, [2]], danio: [5, []], ko: [3, []], levantarse: [5, []],
  victoria: [6, []], burla: [8, []],
}
function metaDe(id: IdPersonaje): MetaAnimaciones {
  const ruta = join(REPO, 'public/juego/personajes', id, 'atlas.json')
  if (existsSync(ruta)) {
    try {
      return metaDesdeAtlas(JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje)
    } catch {
      /* cae a la típica */
    }
  }
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return m
}

// ─── El ajuste (probar números sin tocar jefes.ts) ───────────────────────────

/** Lo que se puede cambiar de un Boss (FuerzaJefe de jefes.ts, sin el tamaño, que no se toca). */
interface FuerzaJefeAjuste {
  dificultad?: Dificultad
  pericia?: number
  vida?: number
  danio?: number
  armadura?: boolean
}

export interface AjusteHistoria {
  /** Por torneo: la lista entera de los 5 pisos de barberos, o { "piso": { campos } }. */
  barberos?: Partial<Record<Dificultad, Partial<CpuPiso>[] | Record<string, Partial<CpuPiso>>>>
  /** Por torneo y Boss: los campos que cambian. */
  jefes?: Partial<Record<Dificultad, Partial<Record<IdJefe, FuerzaJefeAjuste>>>>
}

/** Pisa las tablas de jefes.ts en ESTE proceso (cada hilo lo aplica de nuevo). */
function aplicarAjuste(a: AjusteHistoria | null): void {
  if (!a) return
  for (const [dif, tabla] of Object.entries(a.barberos ?? {})) {
    const destino = CPU_BARBEROS[dif as Dificultad] as CpuPiso[]
    const cambios: [number, Partial<CpuPiso>][] = Array.isArray(tabla) ? tabla.map((c, i) => [i, c]) : Object.entries(tabla ?? {}).map(([i, c]) => [Number(i), c])
    for (const [i, c] of cambios) {
      if (!(i >= 0 && i < PISOS_BARBEROS)) throw new Error(`ajuste: piso de barbero ${i} fuera de 0–${PISOS_BARBEROS - 1}`)
      destino[i] = { ...destino[i], ...c }
    }
  }
  for (const [dif, jefes] of Object.entries(a.jefes ?? {})) {
    const destino = FUERZA_JEFES[dif as Dificultad] as Record<IdJefe, FuerzaJefeAjuste>
    for (const [id, f] of Object.entries(jefes ?? {})) {
      if (!(ORDEN_JEFES as readonly string[]).includes(id)) throw new Error(`ajuste: «${id}» no es un Boss`)
      destino[id as IdJefe] = { ...destino[id as IdJefe], ...f }
    }
  }
}

/** Las dos tablas tal como quedaron (después del ajuste), para el informe y la salida. */
function tablasActuales(): { barberos: Record<Dificultad, CpuPiso[]>; jefes: Record<Dificultad, Record<IdJefe, FuerzaJefeAjuste>> } {
  const barberos = {} as Record<Dificultad, CpuPiso[]>
  const jefes = {} as Record<Dificultad, Record<IdJefe, FuerzaJefeAjuste>>
  for (const d of DIFS) {
    barberos[d] = CPU_BARBEROS[d].map((c) => ({ ...c }))
    jefes[d] = {} as Record<IdJefe, FuerzaJefeAjuste>
    for (const id of ORDEN_JEFES) jefes[d][id] = { ...FUERZA_JEFES[d][id] }
  }
  return { barberos, jefes }
}

// ─── Una pelea ───────────────────────────────────────────────────────────────

interface Trabajo {
  dif: Dificultad
  piso: number
  yo: IdPersonaje
  rival: IdPersonaje
  semilla: number
}

interface ResultadoPelea {
  gano: boolean
  terminada: boolean
  /** Ticks de pelea de cada round. */
  rounds: number[]
  /** Rounds que terminaron por tiempo. */
  tiempos: number
  /** Rounds que ganó la persona. */
  roundsGanados: number
}

/** La pelea del piso como la arma el juego: la persona en el lado 0 y la CPU del piso en el 1. */
function pelear(t: Trabajo, persona: string, metas: Record<string, MetaAnimaciones>): ResultadoPelea {
  const piso = peleaDelPiso(t.dif, t.piso, t.rival)
  const p = crearPartida({
    personajes: [t.yo, t.rival],
    cpu: [false, true],
    dificultad: piso.dificultad,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [metas[t.yo], metas[t.rival]],
    semilla: t.semilla,
    jefes: [null, piso.refuerzo],
  })
  // El azar de la persona, como en balance.mts (semilla·7+3).
  const humano = crearPersona(persona, t.semilla * 7 + 3)
  let tiempos = 0
  let roundsGanados = 0
  // Hasta que se decide (lo de después, el remate y el festejo, no cambia nada de lo que se mide).
  while (p.ganadorPartida === null && p.tick < MAX_TICKS) {
    avanzar(p, [humano(p, 0), ENTRADA_VACIA])
    for (const ev of p.eventos.splice(0)) {
      if (ev.tipo === 'tiempo') {
        tiempos++
        if (ev.ganador === 0) roundsGanados++
      } else if (ev.tipo === 'ko' && ev.ganador === 0) roundsGanados++
    }
  }
  return { gano: p.ganadorPartida === 0, terminada: p.ganadorPartida !== null, rounds: [...duracionesDeRounds(p)], tiempos, roundsGanados }
}

// ─── Acumulados ──────────────────────────────────────────────────────────────

interface Acum {
  /** `${dif}|${piso}|${persona}|${yo}` → [peleas, ganadas por la persona]. */
  celdas: Record<string, [number, number]>
  /** `${dif}|${piso}|${persona}|${rival}` → [peleas, ganadas por la persona] (en los Bosses, el Boss). */
  rivales: Record<string, [number, number]>
  /** `${dif}|${piso}|${persona}` → [rounds, ticks de pelea, rounds por tiempo, rounds ganados por la persona]. */
  rounds: Record<string, [number, number, number, number]>
  noTerminan: number
}

function acumVacio(): Acum {
  return { celdas: {}, rivales: {}, rounds: {}, noTerminan: 0 }
}

function sumarEn<T extends number[]>(r: Record<string, T>, k: string, v: readonly number[], vacio: () => T): void {
  const x = (r[k] ??= vacio())
  for (let i = 0; i < v.length; i++) x[i] += v[i]
}

function fusionar(a: Acum, b: Acum): Acum {
  for (const [k, v] of Object.entries(b.celdas)) sumarEn(a.celdas, k, v, () => [0, 0])
  for (const [k, v] of Object.entries(b.rivales)) sumarEn(a.rivales, k, v, () => [0, 0])
  for (const [k, v] of Object.entries(b.rounds)) sumarEn(a.rounds, k, v, () => [0, 0, 0, 0])
  a.noTerminan += b.noTerminan
  return a
}

// ─── Hilo de trabajo ─────────────────────────────────────────────────────────

if (!isMainThread) {
  const { trabajos, personas, ajuste } = workerData as { trabajos: Trabajo[]; personas: string[]; ajuste: AjusteHistoria | null }
  aplicarAjuste(ajuste)
  const metas: Record<string, MetaAnimaciones> = {}
  for (const id of Object.keys(PERSONAJES) as IdPersonaje[]) metas[id] = metaDe(id)
  const ac = acumVacio()
  for (const t of trabajos) {
    for (const persona of personas) {
      const r = pelear(t, persona, metas)
      if (!r.terminada) ac.noTerminan++
      const g = r.gano ? 1 : 0
      sumarEn(ac.celdas, `${t.dif}|${t.piso}|${persona}|${t.yo}`, [1, g], () => [0, 0])
      sumarEn(ac.rivales, `${t.dif}|${t.piso}|${persona}|${t.rival}`, [1, g], () => [0, 0])
      sumarEn(ac.rounds, `${t.dif}|${t.piso}|${persona}`, [r.rounds.length, r.rounds.reduce((s, x) => s + x, 0), r.tiempos, r.roundsGanados], () => [0, 0, 0, 0])
    }
  }
  parentPort?.postMessage(ac)
}

// ─── Semillas ────────────────────────────────────────────────────────────────

function mezcla32(x: number): number {
  x = x >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** Semilla de la pelea número `b` (sin sal, la fórmula de siempre; con sal, un hash). */
function semillaDe(b: number, sal: number | null): number {
  if (sal === null) return (b * 15485863) % 2147483647
  return 1 + (mezcla32(mezcla32(b + 0x3c6ef372) ^ mezcla32(Math.imul(sal, 0x9e3779b1) + 0x5bd1e995)) % 2147483646)
}

/** El rival del piso: un Boss (en orden) o, en los de barberos, uno de los 16 que no es el del jugador. */
function rivalDe(piso: number, yo: IdPersonaje, iYo: number, s: number): IdPersonaje {
  if (piso >= PISOS_BARBEROS) return ORDEN_JEFES[piso - PISOS_BARBEROS]
  const otros = IDS_PARA_CLIENTES.filter((id) => id !== yo)
  return otros[(s + iYo) % otros.length]
}

function armarTrabajos(difs: Dificultad[], pisos: number[], semillas: number, sales: readonly (number | null)[]): Trabajo[] {
  const trabajos: Trabajo[] = []
  for (const sal of sales) {
    for (const dif of difs) {
      for (const piso of pisos) {
        IDS_PARA_CLIENTES.forEach((yo, iYo) => {
          for (let s = 0; s < semillas; s++) {
            // La misma semilla para el mismo barbero y vuelta en todos los pisos y dificultades.
            trabajos.push({ dif, piso, yo, rival: rivalDe(piso, yo, iYo, s), semilla: semillaDe(iYo * 100003 + s + 1, sal) })
          }
        })
      }
    }
  }
  return trabajos
}

async function correr(trabajos: Trabajo[], personas: string[], ajuste: AjusteHistoria | null, hilos: number): Promise<Acum> {
  // Repartido intercalado: los pisos lentos (Bosses con mucha vida) no caen todos en el mismo hilo.
  const lotes: Trabajo[][] = Array.from({ length: hilos }, () => [])
  trabajos.forEach((t, i) => lotes[i % hilos].push(t))
  const cargador = new URL('./cargador.mjs', import.meta.url).pathname
  const parciales = await Promise.all(
    lotes
      .filter((l) => l.length)
      .map(
        (lote) =>
          new Promise<Acum>((resolver, rechazar) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { trabajos: lote, personas, ajuste }, execArgv: ['--import', cargador] })
            w.once('message', (m) => resolver(m as Acum))
            w.once('error', rechazar)
          }),
      ),
  )
  return parciales.reduce(fusionar, acumVacio())
}

// ─── Resumen ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? (100 * n) / d : NaN
}
/** Medio intervalo del 95 % de un porcentaje con n peleas. */
function ic(v: number, n: number): number {
  return n > 0 && Number.isFinite(v) ? 196 * Math.sqrt(((v / 100) * (1 - v / 100)) / n) : NaN
}
function logit(p: number): number {
  const q = Math.min(0.995, Math.max(0.005, p / 100))
  return Math.log(q / (1 - q))
}
function f1(x: number): string {
  return Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '–'
}
function f2(x: number): string {
  return Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '–'
}
/** Una pericia con signo y hasta 3 decimales (−0,25 · −0,253 · +0,015): la tercera cifra mueve ≈ 0,3 puntos. */
function signo(x: number): string {
  const t = Math.abs(x).toFixed(3).replace(/0$/, '').replace('.', ',')
  return `${x >= 0 ? '+' : '−'}${t}`
}

interface ResumenPiso {
  dif: Dificultad
  piso: number
  /** El rival (un Boss) o «barberos» (rotan). */
  rival: string
  meta: number
  /** % que gana cada persona, con su n. */
  personas: Record<string, { pct: number; n: number }>
  /** Promedio de los oficiales y su ± del 95 %. */
  prom: number
  ic: number
  /** Round medio (s) y % de rounds por tiempo, con los oficiales. */
  roundMedio: number
  pctTiempo: number
  /** % de rounds que gana la persona (oficiales). */
  pctRounds: number
  /** El barbero del jugador al que peor le va (promedio de los oficiales) y el mejor. */
  peor: { id: IdPersonaje; prom: number; porPersona: Record<string, number>; n: number }
  mejor: { id: IdPersonaje; prom: number }
  /** Los barberos del jugador con los que alguno de los oficiales no ganó ninguna pelea. */
  ceros: string[]
  /** En los pisos de barberos: el rival más difícil y el más fácil (promedio de los oficiales). */
  rivalDuro: { id: IdPersonaje; prom: number } | null
  rivalFacil: { id: IdPersonaje; prom: number } | null
}

function resumir(ac: Acum, difs: Dificultad[], pisos: number[], personas: string[]): ResumenPiso[] {
  const oficiales = OFICIALES.filter((o) => personas.includes(o))
  const res: ResumenPiso[] = []
  for (const dif of difs) {
    for (const piso of pisos) {
      const porPersona: Record<string, { pct: number; n: number }> = {}
      for (const per of personas) {
        let n = 0
        let g = 0
        for (const yo of IDS_PARA_CLIENTES) {
          const c = ac.celdas[`${dif}|${piso}|${per}|${yo}`]
          if (c) {
            n += c[0]
            g += c[1]
          }
        }
        porPersona[per] = { pct: pct(g, n), n }
      }
      const ofs = oficiales.map((o) => porPersona[o])
      const prom = ofs.reduce((s, x) => s + x.pct, 0) / Math.max(1, ofs.length)
      // ± del promedio: las dos muestras (independientes a los fines del error).
      const varProm = ofs.reduce((s, x) => s + (x.n > 0 ? ((x.pct / 100) * (1 - x.pct / 100)) / x.n : 0), 0) / Math.max(1, ofs.length) ** 2
      const icProm = 196 * Math.sqrt(varProm)
      let rounds = 0
      let ticks = 0
      let tiempos = 0
      let ganados = 0
      for (const o of oficiales) {
        const r = ac.rounds[`${dif}|${piso}|${o}`]
        if (r) {
          rounds += r[0]
          ticks += r[1]
          tiempos += r[2]
          ganados += r[3]
        }
      }
      // El promedio de los oficiales en una tabla (`celdas`: por barbero del jugador; `rivales`: por rival).
      const promDe = (tabla: Record<string, [number, number]>, id: IdPersonaje) => {
        const xs = oficiales.map((o) => tabla[`${dif}|${piso}|${o}|${id}`]).filter(Boolean)
        return xs.length && xs.length === oficiales.length ? xs.reduce((s, c) => s + pct(c[1], c[0]), 0) / xs.length : NaN
      }
      const porBarbero = IDS_PARA_CLIENTES.map((id) => ({
        id,
        prom: promDe(ac.celdas, id),
        porPersona: Object.fromEntries(
          oficiales.map((o) => {
            const c = ac.celdas[`${dif}|${piso}|${o}|${id}`]
            return [o, c ? pct(c[1], c[0]) : NaN]
          }),
        ) as Record<string, number>,
        n: ac.celdas[`${dif}|${piso}|${oficiales[0]}|${id}`]?.[0] ?? 0,
      })).filter((x) => Number.isFinite(x.prom))
      porBarbero.sort((a, b) => a.prom - b.prom || Math.min(...Object.values(a.porPersona)) - Math.min(...Object.values(b.porPersona)))
      let rivalDuro: { id: IdPersonaje; prom: number } | null = null
      let rivalFacil: { id: IdPersonaje; prom: number } | null = null
      if (piso < PISOS_BARBEROS) {
        const porRival = IDS_PARA_CLIENTES.map((id) => ({ id, prom: promDe(ac.rivales, id) })).filter((x) => Number.isFinite(x.prom))
        porRival.sort((a, b) => a.prom - b.prom)
        rivalDuro = porRival[0] ?? null
        rivalFacil = porRival[porRival.length - 1] ?? null
      }
      res.push({
        dif,
        piso,
        rival: piso >= PISOS_BARBEROS ? ORDEN_JEFES[piso - PISOS_BARBEROS] : 'barberos',
        meta: metasEnUso[dif][piso],
        personas: porPersona,
        prom,
        ic: icProm,
        roundMedio: rounds ? ticks / rounds / TPS : NaN,
        pctTiempo: pct(tiempos, rounds),
        pctRounds: pct(ganados, rounds),
        peor: porBarbero[0],
        mejor: porBarbero[porBarbero.length - 1],
        ceros: porBarbero
          .filter((b) => Object.values(b.porPersona).some((v) => v <= 0))
          .map((b) => `${PERSONAJES[b.id].nombre} (${Object.entries(b.porPersona).map(([o, v]) => `${o} ${f1(v)}`).join(', ')})`),
        rivalDuro,
        rivalFacil,
      })
    }
  }
  return res
}

/**
 * Lo que no cumple las metas (vacío = todo en meta) y los avisos: un barbero con el que UNA de las dos
 * personas no le gana nunca a un Boss en normal (la regla es sobre el barbero, el promedio de las dos).
 */
function fallasDe(res: ResumenPiso[], difs: Dificultad[]): { fallas: string[]; avisos: string[] } {
  const fallas: string[] = []
  const avisos: string[] = []
  for (const dif of difs) {
    const filas = res.filter((r) => r.dif === dif).sort((a, b) => a.piso - b.piso)
    for (const r of filas) {
      const nombre = nombrePiso(r.piso)
      if (Math.abs(r.prom - r.meta) > TOLERANCIA) fallas.push(`${dif} · ${nombre}: ${f1(r.prom)} % contra la meta ${r.meta} (± ${TOLERANCIA})`)
      if (r.piso >= PISOS_BARBEROS) {
        if (r.pctTiempo > TOPE_TIEMPO_JEFE) fallas.push(`${dif} · ${nombre}: ${f1(r.pctTiempo)} % de los rounds por tiempo (tope ${TOPE_TIEMPO_JEFE})`)
        if (r.roundMedio > TOPE_ROUND_JEFE) fallas.push(`${dif} · ${nombre}: round medio de ${f1(r.roundMedio)} s (tope ${TOPE_ROUND_JEFE})`)
        if (dif === 'normal' && r.peor && r.peor.prom <= 0)
          fallas.push(`normal · ${nombre}: con ${PERSONAJES[r.peor.id].nombre} no se le gana nunca (${Object.entries(r.peor.porPersona).map(([o, v]) => `${o} ${f1(v)}`).join(', ')})`)
        if (dif === 'normal' && r.ceros.length) avisos.push(`normal · ${nombre}: una de las dos personas no le gana nunca con ${r.ceros.join(', ')}`)
      }
    }
    // La curva baja piso a piso (sólo entre pisos consecutivos medidos).
    for (let i = 1; i < filas.length; i++) {
      const a = filas[i - 1]
      const b = filas[i]
      if (b.piso === a.piso + 1 && b.prom > a.prom - ESCALON_MIN)
        fallas.push(`${dif}: ${nombrePiso(b.piso)} (${f1(b.prom)}) no queda ${ESCALON_MIN} puntos abajo de ${nombrePiso(a.piso)} (${f1(a.prom)})`)
    }
    // Nico y Tony, los dos más difíciles; Tony, el que más.
    const nico = filas.find((r) => r.piso === TOTAL_PISOS - 2)
    const tony = filas.find((r) => r.piso === TOTAL_PISOS - 1)
    const resto = filas.filter((r) => r.piso < TOTAL_PISOS - 2)
    if (nico && tony && resto.length) {
      const minResto = Math.min(...resto.map((r) => r.prom))
      if (!(tony.prom < nico.prom && nico.prom < minResto)) fallas.push(`${dif}: Nico M. (${f1(nico.prom)}) y Tony (${f1(tony.prom)}) no son los dos más difíciles (el resto, desde ${f1(minResto)})`)
    }
  }
  return { fallas, avisos }
}

function nombrePiso(piso: number): string {
  return piso >= PISOS_BARBEROS ? `piso ${piso + 1} (${PERSONAJES[ORDEN_JEFES[piso - PISOS_BARBEROS]].nombre})` : `piso ${piso + 1}`
}

const DIF_TXT: Record<Dificultad, string> = { facil: 'fácil', normal: 'normal', dificil: 'difícil' }

/** Cómo juega la CPU del piso, en una línea. */
function cpuTxt(dif: Dificultad, piso: number): string {
  if (piso < PISOS_BARBEROS) {
    const c = CPU_BARBEROS[dif][piso]
    return `${DIF_TXT[c.dificultad]} ${signo(c.pericia)}`
  }
  const id = ORDEN_JEFES[piso - PISOS_BARBEROS]
  const f = FUERZA_JEFES[dif][id]
  return `${DIF_TXT[f.dificultad]} ${signo(f.pericia)} · vida ×${f2(f.vida)} · daño ×${f2(f.danio)}${f.armadura ? ' · armadura' : ''} · ×${f2(ESCALA_JEFE[id])}`
}

/** La pericia que la CPU de cada rival suma contra una persona (la base de periciaCpu), para el informe. */
function rangoBase(dif: Dificultad, rivales: readonly IdPersonaje[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rivales) {
    const cpu = MOVIMIENTOS[r].cpu
    for (const yo of IDS_PARA_CLIENTES) {
      if (yo === r) continue
      const b = (cpu.periciaHumano?.[dif] ?? cpu.pericia?.[dif] ?? 0) - (MOVIMIENTOS[yo].cpu.asistencia?.[dif] ?? 0)
      lo = Math.min(lo, b)
      hi = Math.max(hi, b)
    }
  }
  return [lo, hi]
}

function informe(res: ResumenPiso[], o: { difs: Dificultad[]; pisos: number[]; personas: string[]; semillas: number; sales: readonly (number | null)[]; seg: number; peleas: number; hilos: number; noTerminan: number }): string {
  const lineas: string[] = []
  const L = (s = '') => lineas.push(s)
  const oficiales = OFICIALES.filter((x) => o.personas.includes(x))
  L(`# Modo historia de «Corte Final» — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  L()
  L(
    `${o.peleas} peleas en ${o.seg.toFixed(0)} s (${o.hilos} hilos). ${o.semillas} por barbero del jugador (17) y piso: ${17 * o.semillas} por persona y piso ` +
      `(± del 95 % de una persona en un piso ≈ ${f1(100 / Math.sqrt(17 * o.semillas))}; de un barbero ≈ ${f1(100 / Math.sqrt(o.semillas))}). ` +
      `Personas: ${o.personas.map((p) => `${p} (reacción ${reaccionDe(p)})`).join(', ')}; la meta es el promedio de ${oficiales.join(' y ')}. ` +
      `Semillas: ${o.sales.map((x) => (x === null ? 'las de siempre' : `sal ${x}`)).join(' + ')}.`,
  )
  L()
  for (const dif of o.difs) {
    const filas = res.filter((r) => r.dif === dif).sort((a, b) => a.piso - b.piso)
    if (!filas.length) continue
    L(`## Torneo ${DIF_TXT[dif]}`)
    L()
    L(`| Piso | Rival | CPU del piso | Meta | ${o.personas.join(' | ')} | Prom. | ± | Δ | Round medio (s) | % tiempo | Peor barbero | Mejor |`)
    L(`|---|---|---|---:|${o.personas.map(() => '---:').join('|')}|---:|---:|---:|---:|---:|---|---|`)
    for (const r of filas) {
      const rival = r.piso >= PISOS_BARBEROS ? PERSONAJES[r.rival as IdPersonaje].nombre : `barberos (${r.rivalDuro ? `${PERSONAJES[r.rivalDuro.id].nombre} ${f1(r.rivalDuro.prom)}` : '–'} a ${r.rivalFacil ? `${PERSONAJES[r.rivalFacil.id].nombre} ${f1(r.rivalFacil.prom)}` : '–'})`
      const d = r.prom - r.meta
      L(
        `| ${r.piso + 1} | ${rival} | ${cpuTxt(dif, r.piso)} | ${r.meta} | ${o.personas.map((p) => f1(r.personas[p]?.pct)).join(' | ')} | **${f1(r.prom)}** | ${f1(r.ic)} | ${d >= 0 ? '+' : '−'}${f1(Math.abs(d))} | ${f1(r.roundMedio)} | ${f1(r.pctTiempo)} | ${r.peor ? `${PERSONAJES[r.peor.id].nombre} ${f1(r.peor.prom)} (${oficiales.map((x) => f1(r.peor.porPersona[x])).join(' / ')})` : '–'} | ${r.mejor ? `${PERSONAJES[r.mejor.id].nombre} ${f1(r.mejor.prom)}` : '–'} |`,
      )
    }
    L()
  }
  // La base de pericia de las CPU contra una persona (lo que se le suma a la del piso).
  L('Base de la pericia de la CPU contra una persona (periciaHumano o pericia del rival, menos la asistencia del barbero del jugador), de la que parte cada piso:')
  L()
  const barberos = IDS_PARA_CLIENTES
  for (const dif of DIFS) {
    const [lb, hb] = rangoBase(dif, barberos)
    const jefes = ORDEN_JEFES.map((id) => {
      const [l, h] = rangoBase(dif, [id])
      return `${PERSONAJES[id].nombre} ${signo(l)} a ${signo(h)}`
    })
    L(`- ${DIF_TXT[dif]}: barberos ${signo(lb)} a ${signo(hb)}; ${jefes.join('; ')}.`)
  }
  L()
  const { fallas, avisos } = fallasDe(res, o.difs)
  if (o.noTerminan) fallas.push(`${o.noTerminan} peleas no terminaron en ${MAX_TICKS / TPS} s`)
  if (avisos.length) {
    L(`## Avisos (${avisos.length})`)
    L()
    for (const a of avisos) L(`- ${a}`)
    L()
  }
  L(fallas.length ? `## Falta cumplir (${fallas.length})\n\n${fallas.map((f) => `- ${f}`).join('\n')}` : '## Cumple todas las metas')
  return lineas.join('\n')
}

// ─── El afinador ─────────────────────────────────────────────────────────────

interface Punto {
  x: number
  y: number
  w: number
}

/**
 * La pericia siguiente de un piso. Cada punto medido da una estimación (su pericia más lo que le falta
 * para la meta, con la pendiente) y se promedian con su peso: una décima de pericia mueve 15 a 20
 * puntos y cada medición trae ± 2–3 de ruido (cambiar la pericia en 0,005 ya da otras peleas), así que
 * el último punto solo no alcanza. La pendiente sale de todos los puntos si están separados; si no, la
 * previa. Los puntos lejos de la meta pesan menos (la curva no es una recta).
 */
function siguientePericia(puntos: Punto[], objetivo: number): number {
  const ult = puntos[puntos.length - 1]
  let pend = PENDIENTE_PREVIA
  if (puntos.length >= 2) {
    const W = puntos.reduce((s, q) => s + q.w, 0)
    const mx = puntos.reduce((s, q) => s + q.w * q.x, 0) / W
    const my = puntos.reduce((s, q) => s + q.w * q.y, 0) / W
    const sxx = puntos.reduce((s, q) => s + q.w * (q.x - mx) ** 2, 0)
    const sxy = puntos.reduce((s, q) => s + q.w * (q.x - mx) * (q.y - my), 0)
    // Con los puntos casi encimados (menos de 0,02 de pericia entre ellos) la pendiente es puro ruido.
    if (sxx / W > 4e-4) pend = Math.min(PENDIENTE_RANGO[1], Math.max(PENDIENTE_RANGO[0], sxy / sxx))
  }
  let sw = 0
  let sx = 0
  for (const q of puntos) {
    const w = q.w * (Math.abs(q.y - objetivo) < 0.5 ? 1 : 0.2)
    sw += w
    sx += w * (q.x + (objetivo - q.y) / pend)
  }
  const dx = Math.max(-PASO_MAX, Math.min(PASO_MAX, sx / sw - ult.x))
  const x = Math.max(PERICIA_RANGO[0], Math.min(PERICIA_RANGO[1], ult.x + dx))
  return Math.round(x * 1000) / 1000
}

function periciaDe(dif: Dificultad, piso: number): number {
  return piso < PISOS_BARBEROS ? CPU_BARBEROS[dif][piso].pericia : FUERZA_JEFES[dif][ORDEN_JEFES[piso - PISOS_BARBEROS]].pericia
}

/** El ajuste con la pericia de cada piso (lo demás, lo que ya tenían las tablas). */
function ajusteCon(base: AjusteHistoria | null, pericias: Record<string, number>): AjusteHistoria {
  const a: AjusteHistoria = structuredClone(base ?? {})
  for (const [k, x] of Object.entries(pericias)) {
    const [dif, pisoTxt] = k.split('|') as [Dificultad, string]
    const piso = Number(pisoTxt)
    if (piso < PISOS_BARBEROS) {
      const b = ((a.barberos ??= {})[dif] ??= {}) as Record<string, Partial<CpuPiso>> | Partial<CpuPiso>[]
      if (Array.isArray(b)) b[piso] = { ...b[piso], pericia: x }
      else b[String(piso)] = { ...b[String(piso)], pericia: x }
    } else {
      const id = ORDEN_JEFES[piso - PISOS_BARBEROS]
      const j = ((a.jefes ??= {})[dif] ??= {}) as Partial<Record<IdJefe, FuerzaJefeAjuste>>
      j[id] = { ...j[id], pericia: x }
    }
  }
  return a
}

// ─── Principal ───────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const difs = (arg('dif')?.split(',') ?? DIFS) as Dificultad[]
  for (const d of difs) if (!DIFS.includes(d)) throw new Error(`--dif: facil, normal o dificil (no «${d}»)`)
  const pisos = arg('pisos') ? (arg('pisos') ?? '').split(',').map(Number) : Array.from({ length: TOTAL_PISOS }, (_, i) => i)
  for (const p of pisos) if (!(Number.isInteger(p) && p >= 0 && p < TOTAL_PISOS)) throw new Error(`--pisos: de 0 a ${TOTAL_PISOS - 1} (no «${p}»)`)
  const semillas = Math.max(1, Number(arg('semillas') ?? 32))
  const personas = arg('personas') !== undefined ? (arg('personas') ?? '').split(',').filter(Boolean) : PERSONAS_DEF
  for (const p of personas) leerNombre(p)
  const salArg = arg('sal')
  const salesArg = arg('sales')
  const sales: (number | null)[] = salesArg ? salesArg.split(',').map((s) => (s === 'base' ? null : Number(s))) : [salArg !== undefined ? Number(salArg) : null]
  const hilos = Math.max(1, Math.min(Number(arg('hilos') ?? HILOS_TOPE), HILOS_TOPE, availableParallelism()))
  const rutaAjuste = arg('ajuste')
  let ajuste: AjusteHistoria | null = rutaAjuste ? (JSON.parse(readFileSync(rutaAjuste, 'utf8')) as AjusteHistoria) : null
  const vueltas = Number(arg('afinar') ?? 0)
  if (arg('metas') === 'normal') metasEnUso = { facil: META_NORMAL, normal: META_NORMAL, dificil: META_NORMAL }
  else if (arg('metas') !== undefined) throw new Error('--metas: sólo «normal» (las metas de normal en los tres torneos)')

  if (vueltas > 0) {
    // Las vueltas del afinador: sólo los oficiales (la meta), con la pericia de cada piso corriéndose.
    const oficiales = OFICIALES
    const puntos: Record<string, Punto[]> = {}
    const pericias: Record<string, number> = {}
    aplicarAjuste(ajuste)
    for (const dif of difs) for (const piso of pisos) pericias[`${dif}|${piso}`] = periciaDe(dif, piso)
    for (let v = 1; v <= vueltas; v++) {
      const a = ajusteCon(ajuste, pericias)
      const t0 = performance.now()
      const trabajos = armarTrabajos(difs, pisos, semillas, sales)
      const ac = await correr(trabajos, oficiales, a, hilos)
      const res = resumir(ac, difs, pisos, oficiales)
      const seg = (performance.now() - t0) / 1000
      console.log(`\n— vuelta ${v}/${vueltas} (${trabajos.length * oficiales.length} peleas, ${seg.toFixed(0)} s)`)
      for (const r of res) {
        const k = `${r.dif}|${r.piso}`
        ;(puntos[k] ??= []).push({ x: pericias[k], y: logit(r.prom), w: semillas * sales.length })
        const sig = siguientePericia(puntos[k], logit(r.meta))
        console.log(
          `${DIF_TXT[r.dif].padEnd(7)} ${nombrePiso(r.piso).padEnd(22)} pericia ${signo(pericias[k]).padStart(6)} → ${f1(r.prom).padStart(5)} % (meta ${r.meta}, ± ${f1(r.ic)}; round ${f1(r.roundMedio)} s, tiempo ${f1(r.pctTiempo)} %)  ⇒ ${signo(sig)}`,
        )
        pericias[k] = sig
      }
    }
    // La corrida del informe (abajo) mide la pericia de la última vuelta: es la que queda en la salida.
    ajuste = ajusteCon(ajuste, pericias)
    const salida = arg('salida')
    if (salida) {
      writeFileSync(salida, JSON.stringify(ajuste, null, 2) + '\n')
      console.log(`\najuste final en ${salida}`)
    }
  }

  // La corrida que se informa (con el ajuste final si hubo vueltas).
  aplicarAjuste(ajuste)
  const t0 = performance.now()
  const trabajos = armarTrabajos(difs, pisos, semillas, sales)
  const ac = await correr(trabajos, personas, ajuste, hilos)
  const seg = (performance.now() - t0) / 1000
  const res = resumir(ac, difs, pisos, personas)
  const texto = informe(res, { difs, pisos, personas, semillas: semillas * sales.length, sales, seg, peleas: trabajos.length * personas.length, hilos, noTerminan: ac.noTerminan })
  console.log(texto)
  const rutaMd = arg('informe')
  if (rutaMd) writeFileSync(rutaMd, texto + '\n')
  const rutaJson = arg('json')
  if (rutaJson) writeFileSync(rutaJson, JSON.stringify({ tablas: tablasActuales(), ajuste, resumen: res, crudo: ac }, null, 2) + '\n')
  // Para copiar a jefes.ts (las dos tablas tal como quedaron).
  if (vueltas > 0 || ajuste) {
    const t = tablasActuales()
    console.log('\nCPU_BARBEROS =', JSON.stringify(t.barberos))
    console.log('FUERZA_JEFES =', JSON.stringify(t.jefes))
  }
}

// Sólo cuando se corre este archivo (importarlo no dispara una corrida).
if (isMainThread && process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  principal().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
