/**
 * Revisión adversarial del balance de «Corte Final»: «humanos» que juegan con UNA idea fija
 * (machacar un botón, cubrirse siempre, saltar siempre, tirar el especial más barato, escaparse
 * hasta el tiempo…) contra la CPU, con cada luchador y contra cada rival. Una estrategia así no
 * debería ganarle más de ≈ 65 % a la CPU normal ni dejar a un rival sin chance.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs adversario.mts [opciones]
 *     --semillas=N    partidas por luchador, bot y rival (def. 6)
 *     --dif=normal    dificultad de la CPU (def. normal)
 *     --bots=a,b      sólo esos bots (def. todos)
 *     --solo=a,b      sólo esos luchadores para el bot
 *     --hilos=K       hilos (def. 6)
 *     --tope=65       % a partir del cual una estrategia se marca como degenerada
 *     --json=ruta     números crudos
 *     --ajuste=ruta   prueba otros números sin tocar el código (mismo formato que balance.mts)
 *
 * Los bots ven al rival con REACCION ticks de retraso (como una persona) y a sí mismos al instante.
 * Juegan siempre por el camino de un humano (flancos, buffer, doble toque), sin tocar el motor.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AtlasPersonaje, Dificultad, EntradaJugador, IdPersonaje, Lado, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { duracionesDeRounds } from '../../../src/lib/juego/motor/partida.ts'
import { finVentanas, primeraVentana } from '../../../src/lib/juego/motor/cuerpo.ts'
import { KITS_DISENIO, MOVIMIENTOS, conDanio } from '../../../src/lib/juego/motor/movimientos.ts'
import type { KitPersonaje } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const MAX_TICKS = 6 * 60 * 60
const REACCION = 12

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
      /* la típica */
    }
  }
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return m
}

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

// ─── Lo que ve el bot del rival (con retraso) ────────────────────────────────

interface Obs {
  x: number
  enSuelo: boolean
  atacando: boolean
  /** 0 nada, 1 arranque, 2 activo, 3 recuperación. */
  fase: 0 | 1 | 2 | 3
  especial: 0 | 1 | 2
  bloqueando: boolean
}

interface Ctx {
  p: Partida
  lado: Lado
  kit: KitPersonaje
  r: () => number
  mem: Mem
  rv: Obs
  dist: number
  /** Hacia el rival. */
  hacia: -1 | 1
}

interface Mem {
  prev: Partial<Record<keyof EntradaJugador, boolean>>
  hist: Obs[]
  enBloqueo: boolean
  castigo: number
  cadena: number
  estado: string
  t: number
  dashT: number
}

type Bot = (c: Ctx) => Partial<EntradaJugador>

function observar(p: Partida, otro: Lado): Obs {
  const I = internoDe(p)
  const l = p.luchadores[otro]
  const li = I.luchadores[otro]
  const a = li.accion
  let fase: Obs['fase'] = 0
  if (a && !a.remate) {
    const ini = primeraVentana(a.mov)
    const fin = finVentanas(a.mov)
    fase = a.t < ini ? 1 : a.t < fin ? 2 : 3
  }
  return {
    x: l.x,
    enSuelo: l.enSuelo,
    atacando: !!a && !a.remate,
    fase,
    especial: a ? a.especial : 0,
    bloqueando: li.guardia || (li.stun > 0 && li.stunBloqueo),
  }
}

/** Aprieta sólo si no estaba apretado el tick anterior (el motor lee flancos). */
function pulso(c: Ctx, b: keyof EntradaJugador, quiero = true): Partial<EntradaJugador> {
  return quiero && !c.mem.prev[b] ? { [b]: true } : {}
}
function mover(dir: number): Partial<EntradaJugador> {
  return dir > 0 ? { derecha: true } : dir < 0 ? { izquierda: true } : {}
}
const yo = (c: Ctx) => c.p.luchadores[c.lado]
const yoI = (c: Ctx) => internoDe(c.p).luchadores[c.lado]
const costo = (c: Ctx, n: 1 | 2) => PERSONAJES[yo(c).id].especiales[n - 1].costo
const puede = (c: Ctx, n: 1 | 2) => yo(c).carga + 1e-9 >= costo(c, n)
const rango = (c: Ctx, n: 1 | 2) => c.kit.cpu.rangoEspecial[n - 1]
function alcance(c: Ctx, boton: 'golpe' | 'herramienta'): number {
  const mov = c.kit.movimientos[boton === 'golpe' ? c.kit.inicio.golpe : c.kit.inicio.herramienta]
  let x = 0
  for (const v of mov?.ventanas ?? []) x = Math.max(x, v.caja.x1)
  const av = mov?.avance ? mov.avance.vel * (mov.avance.hasta - mov.avance.desde) : 0
  return x + 32 + av * 0.6 - 8
}

/** Cubierto (agachado: el puño pasa por arriba) y castiga con `boton` lo que bloqueó o lo que falló cerca. */
function tortuga(c: Ctx, boton: 'golpe' | 'herramienta'): Partial<EntradaJugador> {
  const li = yoI(c)
  const m = c.mem
  const bloqueando = li.stun > 0 && li.stunBloqueo
  if (bloqueando) m.enBloqueo = true
  if (m.cadena > 0) {
    m.cadena--
    return pulso(c, boton)
  }
  const libre = li.accion === null && li.stun === 0
  if (libre && m.enBloqueo && !bloqueando) {
    m.enBloqueo = false
    if (c.dist < alcance(c, boton) && (c.rv.fase === 3 || !c.rv.atacando)) {
      m.cadena = 14
      return pulso(c, boton)
    }
  }
  if (libre && c.rv.atacando && c.rv.fase === 3 && c.dist < alcance(c, boton) - 6) {
    m.cadena = 14
    return pulso(c, boton)
  }
  return { guardia: true, abajo: true }
}

/** Tira el especial `n` en su rango cada vez que le alcanza la carga; mientras junta, tortuga. */
function spam(c: Ctx, n: 1 | 2): Partial<EntradaJugador> {
  if (!puede(c, n)) return tortuga(c, 'golpe')
  const [rmin, rmax] = rango(c, n)
  const lo = Math.max(rmin, 0)
  const hi = Math.min(rmax, 420)
  if (c.dist < lo) return mover(-c.hacia)
  if (c.dist > hi) return mover(c.hacia)
  return pulso(c, n === 1 ? 'especial1' : 'especial2')
}

function masBarato(c: Ctx): 1 | 2 {
  return costo(c, 1) <= costo(c, 2) ? 1 : 2
}

function acorralado(c: Ctx, dir: number): boolean {
  const x = yo(c).x
  return dir < 0 ? x < 110 : x > 850
}

const BOTS: Record<string, Bot> = {
  /** Machaca GOLPE de cerca, nunca se cubre. */
  mash: (c) => (c.dist > alcance(c, 'golpe') ? mover(c.hacia) : pulso(c, 'golpe')),
  /** Machaca la MÁQUINA de cerca. */
  maquina: (c) => (c.dist > alcance(c, 'herramienta') ? mover(c.hacia) : pulso(c, 'herramienta')),
  /** Siempre cubierto y castiga con el golpe. */
  tortuga: (c) => tortuga(c, 'golpe'),
  /** Siempre cubierto y castiga con la máquina. */
  tortugaMaq: (c) => tortuga(c, 'herramienta'),
  /** Salta siempre hacia el rival y patea en el aire. */
  saltarin: (c) => ({ arriba: true, ...mover(c.hacia), ...pulso(c, 'golpe', !yo(c).enSuelo && c.dist < 170) }),
  /** Salta para atrás todo el tiempo (si lo acorralan, por encima). */
  saltaHuye: (c) => ({ arriba: true, ...mover(acorralado(c, -c.hacia) ? c.hacia : -c.hacia) }),
  /** Se escapa caminando y con la esquiva, y tira el especial que pueda de lejos: busca ganar por tiempo. */
  huida: (c) => {
    const lejos = acorralado(c, -c.hacia) ? c.hacia : -c.hacia
    for (const n of [masBarato(c), masBarato(c) === 1 ? 2 : 1] as const) {
      if (puede(c, n) && c.dist > 230) return pulso(c, n === 1 ? 'especial1' : 'especial2')
    }
    if (c.dist < 170 && yoI(c).dashEspera === 0) return { ...mover(lejos), ...pulso(c, 'dash') }
    if (acorralado(c, -c.hacia) && c.dist < 200) return { arriba: true, ...mover(c.hacia) }
    return mover(lejos)
  },
  /** El especial más barato, en su rango, cada vez que puede. */
  barato: (c) => spam(c, masBarato(c)),
  e1: (c) => spam(c, 1),
  e2: (c) => spam(c, 2),
  /** Se acerca pegando y aprieta los dos especiales apenas tiene carga, sin apuntar. */
  especiales: (c) => {
    if (puede(c, 2) && c.r() < 0.5) return pulso(c, 'especial2')
    if (puede(c, 1)) return pulso(c, 'especial1')
    return c.dist > alcance(c, 'golpe') ? mover(c.hacia) : pulso(c, 'golpe')
  },
  /** Esquiva hacia adelante, cadena de golpes y esquiva para atrás. */
  dashGolpe: (c) => {
    const m = c.mem
    const li = yoI(c)
    if (m.cadena > 0) {
      m.cadena--
      return pulso(c, 'golpe')
    }
    if (c.dist > 175 && c.dist < 330 && li.dashEspera === 0 && li.accion === null) {
      m.dashT = 12
      return { ...mover(c.hacia), ...pulso(c, 'dash') }
    }
    if (m.dashT > 0) {
      m.dashT--
      if (m.dashT === 0 && c.dist < alcance(c, 'golpe') + 20) m.cadena = 16
      return {}
    }
    if (c.dist < 130 && li.dashEspera === 0 && li.accion === null && c.r() < 0.05) return { ...mover(-c.hacia), ...pulso(c, 'dash') }
    return c.dist > alcance(c, 'golpe') ? mover(c.hacia) : pulso(c, 'golpe')
  },
  /** Aprieta cualquier cosa (el bot del lockstep): un jugador que no entiende nada. */
  loco: (c) => {
    const m = c.mem
    if (m.t % 8 === 0) {
      const r = c.r
      const d = r()
      m.estado = JSON.stringify({
        izquierda: d < 0.3,
        derecha: d > 0.65,
        arriba: r() < 0.08,
        abajo: r() < 0.08,
        golpe: r() < 0.35,
        herramienta: r() < 0.12,
        guardia: r() < 0.12,
        especial1: r() < 0.05,
        especial2: r() < 0.04,
        dash: r() < 0.03,
      })
    }
    return m.estado ? (JSON.parse(m.estado) as Partial<EntradaJugador>) : {}
  },
}

// ─── Ajustes de prueba (el mismo formato que balance.mts --ajuste) ───────────

interface Ajuste {
  danio?: Partial<Record<IdPersonaje, [number, number, number?, number?]>>
  vida?: Partial<Record<IdPersonaje, number>>
  costo?: Partial<Record<IdPersonaje, [number, number]>>
}
function aplicarAjuste(a: Ajuste | null): void {
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
}

// ─── Una partida ─────────────────────────────────────────────────────────────

interface Trabajo {
  bot: string
  yo: IdPersonaje
  rival: IdPersonaje
  dif: Dificultad
  lado: Lado
  semilla: number
}
interface Res {
  gana: boolean
  rounds: number
  porTiempo: number
  ticksRound: number
  terminada: boolean
  danioBot: number
  danioCpu: number
}

function jugar(t: Trabajo, metas: Record<string, MetaAnimaciones>): Res {
  const pj: [IdPersonaje, IdPersonaje] = t.lado === 0 ? [t.yo, t.rival] : [t.rival, t.yo]
  const p = crearPartida({
    personajes: pj,
    cpu: [t.lado !== 0, t.lado !== 1],
    dificultad: t.dif,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [metas[pj[0]], metas[pj[1]]],
    semilla: t.semilla,
  })
  const bot = BOTS[t.bot]
  const otro = (1 - t.lado) as Lado
  const mem: Mem = { prev: {}, hist: [], enBloqueo: false, castigo: 0, cadena: 0, estado: '', t: 0, dashT: 0 }
  const r = rng(t.semilla * 31 + 5)
  let porTiempo = 0
  while (p.fase !== 'terminada' && p.tick < MAX_TICKS) {
    mem.hist.push(observar(p, otro))
    if (mem.hist.length > REACCION + 1) mem.hist.shift()
    let e: EntradaJugador = { ...ENTRADA_VACIA }
    if (p.fase === 'pelea' || p.fase === 'final') {
      const rv = mem.hist[0]
      const x = p.luchadores[t.lado].x
      const c: Ctx = { p, lado: t.lado, kit: MOVIMIENTOS[t.yo], r, mem, rv, dist: Math.abs(rv.x - x), hacia: rv.x >= x ? 1 : -1 }
      e = { ...ENTRADA_VACIA, ...bot(c) }
      if (p.fase === 'final') e = { ...ENTRADA_VACIA, golpe: p.tick % 2 === 0 }
    }
    mem.prev = { ...e }
    mem.t++
    const ent: [EntradaJugador, EntradaJugador] = [ENTRADA_VACIA, ENTRADA_VACIA]
    ent[t.lado] = e
    avanzar(p, ent)
    for (const ev of p.eventos.splice(0)) if (ev.tipo === 'tiempo') porTiempo++
  }
  const durs = duracionesDeRounds(p)
  return {
    gana: p.ganadorPartida === t.lado,
    rounds: durs.length,
    porTiempo,
    ticksRound: durs.reduce((s, x) => s + x, 0),
    terminada: p.fase === 'terminada',
    danioBot: p.estadisticas[t.lado].danioHecho,
    danioCpu: p.estadisticas[otro].danioHecho,
  }
}

interface Acum {
  /** `${bot}|${yo}|${rival}` → [partidas, ganadas, rounds, por tiempo, ticks de round] */
  c: Record<string, [number, number, number, number, number]>
  noTerminan: number
}

if (!isMainThread) {
  const { trabajos, ajuste } = workerData as { trabajos: Trabajo[]; ajuste: Ajuste | null }
  aplicarAjuste(ajuste)
  const metas: Record<string, MetaAnimaciones> = {}
  for (const id of IDS_PERSONAJES) metas[id] = metaDe(id)
  const ac: Acum = { c: {}, noTerminan: 0 }
  for (const t of trabajos) {
    const res = jugar(t, metas)
    const k = `${t.bot}|${t.yo}|${t.rival}`
    const x = (ac.c[k] ??= [0, 0, 0, 0, 0])
    x[0]++
    if (res.gana) x[1]++
    x[2] += res.rounds
    x[3] += res.porTiempo
    x[4] += res.ticksRound
    if (!res.terminada) ac.noTerminan++
  }
  parentPort?.postMessage(ac)
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const semillas = Number(arg('semillas') ?? 6)
  const dif = (arg('dif') ?? 'normal') as Dificultad
  const bots = arg('bots')?.split(',') ?? Object.keys(BOTS)
  const solo = (arg('solo')?.split(',') as IdPersonaje[] | undefined) ?? IDS_PERSONAJES
  const hilos = Math.max(1, Math.min(Number(arg('hilos') ?? 6), availableParallelism()))
  const tope = Number(arg('tope') ?? 65)
  const rutaAjuste = arg('ajuste')
  const ajuste: Ajuste | null = rutaAjuste ? (JSON.parse(readFileSync(rutaAjuste, 'utf8')) as Ajuste) : null
  const trabajos: Trabajo[] = []
  let base = 1
  for (const bot of bots) {
    if (!BOTS[bot]) throw new Error(`bot desconocido: ${bot}`)
    for (const yo of solo) for (const rival of IDS_PERSONAJES) for (let s = 0; s < semillas; s++) {
      trabajos.push({ bot, yo, rival, dif, lado: (s % 2) as Lado, semilla: (base++ * 48271) % 2147483647 })
    }
  }
  const lotes: Trabajo[][] = Array.from({ length: hilos }, () => [])
  trabajos.forEach((t, i) => lotes[i % hilos].push(t))
  const t0 = performance.now()
  const cargador = new URL('./cargador.mjs', import.meta.url).pathname
  const partes = await Promise.all(
    lotes.map(
      (lote) =>
        new Promise<Acum>((ok, mal) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { trabajos: lote, ajuste }, execArgv: ['--import', cargador] })
          w.once('message', (m) => ok(m as Acum))
          w.once('error', mal)
        }),
    ),
  )
  const ac: Acum = { c: {}, noTerminan: 0 }
  for (const pa of partes) {
    ac.noTerminan += pa.noTerminan
    for (const [k, v] of Object.entries(pa.c)) {
      const x = (ac.c[k] ??= [0, 0, 0, 0, 0])
      for (let i = 0; i < 5; i++) x[i] += v[i]
    }
  }
  const seg = (performance.now() - t0) / 1000
  const nom = (id: IdPersonaje) => PERSONAJES[id].nombre
  console.log(`# Bots contra la CPU ${dif}: ${trabajos.length} partidas en ${seg.toFixed(0)} s (${semillas} por luchador, bot y rival; reacción ${REACCION} ticks)`)
  console.log()
  console.log(`| bot | ${solo.map(nom).join(' | ')} | todos | por tiempo |`)
  console.log(`|---|${solo.map(() => '---:').join('|')}|---:|---:|`)
  const marcas: string[] = []
  for (const bot of bots) {
    let n = 0
    let g = 0
    let rounds = 0
    let tiempo = 0
    const celdas = solo.map((yo) => {
      let nn = 0
      let gg = 0
      for (const rival of IDS_PERSONAJES) {
        const x = ac.c[`${bot}|${yo}|${rival}`]
        if (!x) continue
        nn += x[0]
        gg += x[1]
        rounds += x[2]
        tiempo += x[3]
        if (x[0] >= 4 && (100 * x[1]) / x[0] >= 85) marcas.push(`${bot} con ${nom(yo)} contra ${nom(rival)}: ${x[1]}/${x[0]}`)
      }
      n += nn
      g += gg
      const v = (100 * gg) / Math.max(1, nn)
      return `${v.toFixed(0)}${v > tope ? ' (!)' : ''}`
    })
    console.log(`| ${bot} | ${celdas.join(' | ')} | ${((100 * g) / Math.max(1, n)).toFixed(1)} | ${((100 * tiempo) / Math.max(1, rounds)).toFixed(1)} % |`)
  }
  console.log()
  console.log(marcas.length ? `Cruces casi seguros (≥ 85 %, muestra chica):\n${marcas.map((m) => `- ${m}`).join('\n')}` : 'Ningún cruce casi seguro (≥ 85 %).')
  if (ac.noTerminan) console.log(`\n${ac.noTerminan} partidas no terminaron`)
  const rutaJson = arg('json')
  if (rutaJson) writeFileSync(rutaJson, JSON.stringify(ac))
}

if (isMainThread && process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  principal().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
