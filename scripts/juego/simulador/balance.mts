/**
 * Balance del elenco de «Corte Final»: CPU contra CPU en TODOS los cruces (los dos lados, espejos
 * incluidos) y en las 3 dificultades, repartido en hilos (worker_threads), más el «humano simple»
 * (sólo pega cerca y a veces se cubre) contra la CPU con cada luchador.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs balance.mts [opciones]
 *     --semillas=N        partidas por cruce ORDENADO y dificultad (def. 60)
 *     --semillasNormal=N  ídem sólo para normal (def. = semillas): la matriz 13×13 sale de normal
 *     --humano=N          partidas del humano simple por luchador y dificultad (def. 40)
 *     --dif=facil,normal  dificultades (def. las 3)
 *     --solo=a,b          sólo esos luchadores (contra todos)
 *     --hilos=K           hilos (def. 6)
 *     --informe=ruta.md   escribe el informe en Markdown
 *     --json=ruta.json    escribe los números crudos
 *     --ajuste=ruta.json  prueba otros números sin tocar el código: { "danio": {id: [normales, especiales, guardia]},
 *                         "vida": {id: vidaMax}, "costo": {id: [c1, c2]},
 *                         "pericia": {id: {facil: n, dificil: n}} } (lo usa afinar.mts; la pericia
 *                         de la CPU, EstiloCpu.pericia, empareja fácil y difícil sin tocar el kit)
 *
 * Usa la meta real de los atlas si existen (public/juego/personajes/<id>/atlas.json); si no, la típica.
 * Metas (pedido del dueño: «todos los players deben estar equilibrados»): cada luchador 45–55 % en
 * cada dificultad; ningún cruce fuera de 35–65 % en normal; sesgo de lado < 3 %; espejos ≈ 50 %;
 * casi ningún round por tiempo; todos los especiales se usan y aciertan.
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
import { KITS_DISENIO, MOVIMIENTOS, conDanio } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const MAX_TICKS = 6 * 60 * TPS
const DIFS: Dificultad[] = ['facil', 'normal', 'dificil']

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

// ─── Humano simple (el mismo de simular.mts) ────────────────────────────────

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
}
function entradaHumano(h: Humano, p: Partida, lado: Lado): EntradaJugador {
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

// ─── Una partida ─────────────────────────────────────────────────────────────

interface Trabajo {
  a: IdPersonaje
  b: IdPersonaje
  dif: Dificultad
  semilla: number
  /** Lado del humano simple (null = CPU contra CPU). */
  humano: Lado | null
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
    cpu: [t.humano !== 0, t.humano !== 1],
    dificultad: t.dif,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [metas[t.a], metas[t.b]],
    semilla: t.semilla,
  })
  const I = internoDe(p)
  const h: Humano = { r: rng(t.semilla * 7 + 3), guardiaT: 0, golpeT: 0, movRival: null }
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
    if (t.humano !== null) ent[t.humano] = entradaHumano(h, p, t.humano)
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
  /** clave `${dif}|${id}|${n}` → [usos, aciertos, partidas jugadas por ese id]. */
  especiales: Record<string, [number, number, number]>
  /** clave dif → duraciones de round (ticks). */
  rounds: Record<string, number[]>
  tiempos: Record<string, number>
  totalRounds: Record<string, number>
  /** clave `${dif}|${id}` → [partidas, ganadas por el humano] (humano simple con ese id). */
  humano: Record<string, [number, number]>
  noTerminan: number
  violaciones: string[]
  curado: Record<string, number>
}

function acumVacio(): Acum {
  return { cruces: {}, especiales: {}, rounds: {}, tiempos: {}, totalRounds: {}, humano: {}, noTerminan: 0, violaciones: [], curado: {} }
}

function sumar(ac: Acum, t: Trabajo, r: ResultadoPartida): void {
  if (!r.terminada) ac.noTerminan++
  if (r.violacion && ac.violaciones.length < 10) ac.violaciones.push(r.violacion)
  if (t.humano !== null) {
    const id = t.humano === 0 ? t.a : t.b
    const k = `${t.dif}|${id}`
    const x = (ac.humano[k] ??= [0, 0])
    x[0]++
    if (r.ganador === t.humano) x[1]++
    return
  }
  const k = `${t.dif}|${t.a}|${t.b}`
  const c = (ac.cruces[k] ??= [0, 0, 0])
  c[0]++
  if (r.ganador === 0) c[1]++
  else if (r.ganador === 1) c[2]++
  ;(ac.rounds[t.dif] ??= []).push(...r.rounds)
  ac.tiempos[t.dif] = (ac.tiempos[t.dif] ?? 0) + r.tiempos
  ac.totalRounds[t.dif] = (ac.totalRounds[t.dif] ?? 0) + r.rounds.length
  for (const lado of [0, 1] as const) {
    const id = lado === 0 ? t.a : t.b
    for (const n of [1, 2] as const) {
      const ke = `${t.dif}|${id}|${n}`
      const e = (ac.especiales[ke] ??= [0, 0, 0])
      e[0] += r.usos[lado][n - 1]
      e[1] += r.aciertos[lado][n - 1]
      e[2]++
    }
    ac.curado[id] = (ac.curado[id] ?? 0) + r.curado[lado]
  }
}

function fusionar(a: Acum, b: Acum): Acum {
  for (const [k, v] of Object.entries(b.cruces)) {
    const x = (a.cruces[k] ??= [0, 0, 0])
    x[0] += v[0]
    x[1] += v[1]
    x[2] += v[2]
  }
  for (const [k, v] of Object.entries(b.especiales)) {
    const x = (a.especiales[k] ??= [0, 0, 0])
    x[0] += v[0]
    x[1] += v[1]
    x[2] += v[2]
  }
  for (const [k, v] of Object.entries(b.rounds)) (a.rounds[k] ??= []).push(...v)
  for (const [k, v] of Object.entries(b.tiempos)) a.tiempos[k] = (a.tiempos[k] ?? 0) + v
  for (const [k, v] of Object.entries(b.totalRounds)) a.totalRounds[k] = (a.totalRounds[k] ?? 0) + v
  for (const [k, v] of Object.entries(b.humano)) {
    const x = (a.humano[k] ??= [0, 0])
    x[0] += v[0]
    x[1] += v[1]
  }
  for (const [k, v] of Object.entries(b.curado)) a.curado[k] = (a.curado[k] ?? 0) + v
  a.noTerminan += b.noTerminan
  a.violaciones.push(...b.violaciones.slice(0, Math.max(0, 10 - a.violaciones.length)))
  return a
}

// ─── Hilo de trabajo ─────────────────────────────────────────────────────────

export interface Ajuste {
  danio?: Partial<Record<IdPersonaje, [number, number, number?, number?]>>
  vida?: Partial<Record<IdPersonaje, number>>
  costo?: Partial<Record<IdPersonaje, [number, number]>>
  /** Pericia de la CPU por barbero y dificultad (EstiloCpu.pericia): reemplaza la del kit. */
  pericia?: Partial<Record<IdPersonaje, Partial<Record<Dificultad, number>>>>
}

/** Aplica un ajuste de prueba al catálogo y a los kits (sólo en el proceso del simulador). */
export function aplicarAjuste(a: Ajuste | null): void {
  if (!a) return
  for (const [id, f] of Object.entries(a.danio ?? {})) {
    const [fn, fe, fg, fge] = f as [number, number, number?, number?]
    MOVIMIENTOS[id as IdPersonaje] = conDanio(KITS_DISENIO[id as IdPersonaje], fn, fe, fg ?? 1, fge ?? fg ?? 1)
  }
  for (const [id, v] of Object.entries(a.vida ?? {})) PERSONAJES[id as IdPersonaje].vidaMax = v as number
  for (const [id, c] of Object.entries(a.costo ?? {})) {
    PERSONAJES[id as IdPersonaje].especiales[0].costo = (c as [number, number])[0]
    PERSONAJES[id as IdPersonaje].especiales[1].costo = (c as [number, number])[1]
  }
  for (const [id, pe] of Object.entries(a.pericia ?? {})) {
    const k = MOVIMIENTOS[id as IdPersonaje]
    MOVIMIENTOS[id as IdPersonaje] = { ...k, cpu: { ...k.cpu, pericia: { ...pe } } }
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

// ─── Principal ───────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const semillas = Number(arg('semillas') ?? 60)
  const semillasNormal = Number(arg('semillasNormal') ?? semillas)
  const semillasHumano = Number(arg('humano') ?? 40)
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
        for (let s = 0; s < n; s++) trabajos.push({ a, b, dif, semilla: (base++ * 7919) % 2147483647, humano: null })
      }
    }
    for (const a of ids) {
      if (solo && !solo.includes(a)) continue
      for (let s = 0; s < semillasHumano; s++) {
        const b = ids[s % ids.length]
        trabajos.push({ a, b, dif, semilla: (base++ * 104729) % 2147483647, humano: 0 })
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
  informe(ac, { difs, ids, seg, partidas: trabajos.length, semillas, semillasNormal, semillasHumano, origenes, hilos }, arg('informe'), arg('json'))
}

// ─── Informe ─────────────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? (100 * n) / d : NaN
}
function f1(x: number): string {
  return Number.isFinite(x) ? x.toFixed(1) : '–'
}

interface Opciones {
  difs: Dificultad[]
  ids: IdPersonaje[]
  seg: number
  partidas: number
  semillas: number
  semillasNormal: number
  semillasHumano: number
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
  L(`${o.partidas} partidas en ${o.seg.toFixed(0)} s (${o.hilos} hilos). Semillas por cruce ordenado: ${o.semillas} (normal ${o.semillasNormal}); humano simple: ${o.semillasHumano} por luchador y dificultad.`)
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
  L('## Rounds')
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
  L('## Especiales (CPU contra CPU, todas las dificultades): usos por partida y % que acierta')
  L()
  L('| Luchador | Especial 1 | usos | acierta | Especial 2 | usos | acierta |')
  L('|---|---|---:|---:|---|---:|---:|')
  for (const id of o.ids) {
    const fila: string[] = [nombre(id)]
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
      const porPartida = u / Math.max(1, j)
      const acierta = pct(h, u)
      if (u === 0 || h === 0) fallas.push(`${nombre(id)}: ${PERSONAJES[id].especiales[n - 1].nombre} nunca ${u === 0 ? 'se usa' : 'acierta'}`)
      else if (porPartida < 0.4) fallas.push(`${nombre(id)}: ${PERSONAJES[id].especiales[n - 1].nombre} casi no se usa (${porPartida.toFixed(2)} por partida)`)
      fila.push(PERSONAJES[id].especiales[n - 1].nombre, porPartida.toFixed(2), `${f1(acierta)} %`)
    }
    L(`| ${fila.join(' | ')} |`)
  }
  L()

  // Humano simple.
  if (Object.keys(ac.humano).length) {
    L('## «Humano simple» (sólo pega cerca y a veces se cubre) contra la CPU: % que gana el humano')
    L()
    L(`| Luchador del humano | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const x = ac.humano[`${d}|${id}`]
        const v = x ? pct(x[1], x[0]) : NaN
        const tope = d === 'facil' ? 101 : d === 'normal' ? 50 : 20
        if (Number.isFinite(v) && v > tope) fallas.push(`humano simple con ${nombre(id)} gana ${f1(v)} % en ${d} (tope ${tope})`)
        return `${f1(v)} %`
      })
      L(`| ${nombre(id)} | ${celdas.join(' | ')} |`)
    }
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
