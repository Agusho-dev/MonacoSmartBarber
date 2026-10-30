/**
 * Simulador headless del motor de «Corte Final».
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs simular.mts [--rapido] [--semillas=N] [--humano=N]
 *   (Node ≥ 23.6: quita los tipos solo; cargador.mjs registra ganchos.mjs, que resuelve los imports
 *   relativos sin extensión del motor a .ts. Escribe resultado.json al lado.)
 *
 * Corre CPU vs CPU (todas las combinaciones de personajes y dificultades, semillas distintas) y
 * un «jugador humano simple» (sólo aprieta GOLPE cerca y a veces guardia) contra la CPU. Verifica
 * invariantes (terminan, sin NaN, dentro del escenario, nadie trabado, cuadros válidos), que todo
 * ocurra alguna vez (cada especial y cada efecto del elenco), la duración de los rounds y un
 * balance grueso (cada luchador entre 40 y 60 %). El balance fino (13×13, las metas del dueño)
 * está en balance.mts, con hilos. Si existen los atlas reales (public/juego/personajes/<id>/atlas.json)
 * usa su meta; si no, la meta típica. Sale con código 1 si algo no da.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AtlasPersonaje,
  ConfigPartida,
  Dificultad,
  EntradaJugador,
  EventoJuego,
  IdPersonaje,
  Lado,
  MetaAnimaciones,
  Partida,
} from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA, TPS } from '../../../src/lib/juego/tipos.ts'
import { avanzar, calcularPuntaje, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { duracionesDeRounds } from '../../../src/lib/juego/motor/partida.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const ARGS = process.argv.slice(2)
const RAPIDO = ARGS.includes('--rapido')
// Con 13 luchadores: por defecto 12 semillas por cruce ordenado y dificultad (6084 partidas CPU vs
// CPU, ≈ 40 s en un hilo) y 3 del humano simple por cruce (1521). --rapido para iterar.
const SEMILLAS = Number(ARGS.find((a) => a.startsWith('--semillas='))?.split('=')[1] ?? (RAPIDO ? 2 : 12))
const SEMILLAS_HUMANO = Number(ARGS.find((a) => a.startsWith('--humano='))?.split('=')[1] ?? (RAPIDO ? 1 : 3))
const MAX_TICKS = 6 * 60 * TPS
const TRABADO_TICKS = 6 * TPS
const PERSONAJES: IdPersonaje[] = [...IDS_PERSONAJES]
const DIFICULTADES: Dificultad[] = ['facil', 'normal', 'dificil']

// ─── Meta de animaciones ─────────────────────────────────────────────────────

const TIPICA: Record<string, [number, number[]]> = {
  quieto: [5, []],
  caminar: [6, []],
  correr: [4, []],
  dash: [3, []],
  guardia: [4, []],
  agachado: [4, []],
  saltar: [4, []],
  caer: [6, []],
  golpe: [5, [4]],
  patada: [4, [2]],
  combo: [8, [2, 5, 7]],
  herramienta1: [4, [2]],
  herramienta2: [3, [1]],
  especial1: [5, [3]],
  especial2: [6, [2]],
  danio: [5, []],
  ko: [3, []],
  levantarse: [5, []],
  victoria: [6, []],
  burla: [8, []],
}

function metaTipica(): MetaAnimaciones {
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return m
}

const ORIGEN_META: Record<string, string> = {}
function metaDe(id: IdPersonaje): MetaAnimaciones {
  const ruta = join(REPO, 'public/juego/personajes', id, 'atlas.json')
  if (existsSync(ruta)) {
    try {
      const atlas = JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje
      ORIGEN_META[id] = 'atlas real'
      return metaDesdeAtlas(atlas)
    } catch (e) {
      ORIGEN_META[id] = `atlas ilegible (${(e as Error).message}), meta típica`
    }
  } else ORIGEN_META[id] = 'meta típica (no hay atlas todavía)'
  return metaTipica()
}
const META = Object.fromEntries(PERSONAJES.map((id) => [id, metaDe(id)])) as Record<IdPersonaje, MetaAnimaciones>

// Meta rara para probar robustez (1 cuadro, impactos vacíos o fuera de rango).
function metaRara(semilla: number): MetaAnimaciones {
  const m = {} as MetaAnimaciones
  let s = semilla
  for (const c of CLAVES_ANIMACION) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const n = 1 + (s % 9)
    m[c] = { n, impactos: s % 3 === 0 ? [] : [s % 11, (s >> 3) % 7] }
  }
  return m
}

// ─── Azar del simulador (no el del motor) ───────────────────────────────────

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

// ─── Jugador humano simple: GOLPE cerca y a veces guardia ────────────────────

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

interface Resultado {
  ganador: Lado | null
  ticks: number
  terminada: boolean
  rounds: number[]
  kos: number
  tiempos: number
  violaciones: string[]
  puntajes: [number, number]
  rangos: [string, string]
  stats: Partida['estadisticas']
}

interface Conteo {
  [clave: string]: number
}

const CONTEO: Conteo = {}
function contar(clave: string, n = 1) {
  CONTEO[clave] = (CONTEO[clave] ?? 0) + n
}

function numeroValido(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v)
}

function revisar(p: Partida, meta: [MetaAnimaciones, MetaAnimaciones], violaciones: string[]) {
  const malo = (m: string) => {
    if (violaciones.length < 12) violaciones.push(`t=${p.tick} ${p.fase}: ${m}`)
  }
  for (const k of ['tick', 'ticksFase', 'tiempoRestante', 'escalaTiempo', 'congelamientoGolpe', 'round'] as const) {
    if (!numeroValido(p[k])) malo(`p.${k} = ${p[k]}`)
  }
  if (p.escalaTiempo <= 0 || p.escalaTiempo > 1) malo(`escalaTiempo ${p.escalaTiempo}`)
  for (const l of p.luchadores) {
    for (const k of ['x', 'y', 'vx', 'vy', 'vida', 'guardia', 'carga', 'destello', 'animTick', 'cuadro', 'combo'] as const) {
      if (!numeroValido(l[k])) malo(`${l.id}.${k} = ${l[k]}`)
    }
    for (const k of ['congelado', 'electrocutado', 'guardiaRota', 'critico'] as const) {
      if (!numeroValido(l.efectos[k]) || l.efectos[k] < 0) malo(`${l.id}.efectos.${k} = ${l.efectos[k]}`)
    }
    if (l.x < 70 || l.x > 890) malo(`${l.id} fuera del escenario x=${l.x}`)
    if (l.y < 0) malo(`${l.id} bajo el piso y=${l.y}`)
    if (l.vida < 0 || l.vida > l.vidaMax) malo(`${l.id} vida ${l.vida}`)
    if (l.carga < 0 || l.carga > 10 + 1e-9) malo(`${l.id} carga ${l.carga}`)
    if (l.guardia < 0 || l.guardia > l.guardiaMax + 1e-9) malo(`${l.id} guardia ${l.guardia}`)
    const n = meta[l.lado][l.anim]?.n ?? 0
    if (!Number.isInteger(l.cuadro) || l.cuadro < 0 || l.cuadro >= n) malo(`${l.id} cuadro ${l.cuadro} de ${l.anim} (n=${n})`)
    if (l.enSuelo && l.y !== 0) malo(`${l.id} enSuelo con y=${l.y}`)
  }
  for (const q of p.proyectiles) {
    for (const k of ['x', 'y', 'vx', 'vy', 'rot', 'edad', 'golpesRestantes'] as const) {
      if (!numeroValido(q[k])) malo(`proyectil ${q.tipo}.${k} = ${q[k]}`)
    }
  }
}

function tallyEventos(evs: EventoJuego[], p: Partida, maxCombo: { v: number }) {
  for (const ev of evs) {
    contar(`ev:${ev.tipo}`)
    switch (ev.tipo) {
      case 'golpe':
        if (ev.critico) contar('critico')
        if (ev.bloqueado) contar('golpe_bloqueado')
        contar(`herramienta:${ev.herramienta}`)
        if (!numeroValido(ev.danio) || !numeroValido(ev.x) || !numeroValido(ev.y)) contar('evento_invalido')
        break
      case 'especial':
        contar(`especial:${p.luchadores[ev.quien].id}:${ev.numero}`)
        break
      case 'ko':
        if (ev.perfecto) contar('perfecto')
        break
      case 'descongelado':
        contar(ev.roto ? 'descongelado_roto' : 'descongelado_solo')
        break
      case 'combo':
        if (ev.golpes > maxCombo.v) maxCombo.v = ev.golpes
        break
      case 'proyectil':
        contar(`proyectil:${ev.proyectil}`)
        break
      default:
        break
    }
  }
}

function jugar(
  personajes: [IdPersonaje, IdPersonaje],
  dificultad: Dificultad,
  semilla: number,
  humano: Lado | null,
  metaForzada?: [MetaAnimaciones, MetaAnimaciones],
): Resultado {
  const meta: [MetaAnimaciones, MetaAnimaciones] = metaForzada ?? [META[personajes[0]], META[personajes[1]]]
  const config: ConfigPartida = {
    personajes,
    cpu: [humano !== 0, humano !== 1],
    dificultad,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: meta,
    semilla,
  }
  const p = crearPartida(config)
  const violaciones: string[] = []
  const h: Humano = { r: rng(semilla * 7 + 3), guardiaT: 0, golpeT: 0, movRival: null }
  const desde: [{ estado: string; t: number }, { estado: string; t: number }] = [
    { estado: '', t: 0 },
    { estado: '', t: 0 },
  ]
  const maxCombo = { v: 0 }
  let kos = 0
  let tiempos = 0
  let peleaTicks = 0
  while (p.fase !== 'terminada' && p.tick < MAX_TICKS) {
    const ent: [EntradaJugador, EntradaJugador] = [ENTRADA_VACIA, ENTRADA_VACIA]
    if (humano !== null) ent[humano] = entradaHumano(h, p, humano)
    avanzar(p, ent)
    const evs = p.eventos.splice(0)
    tallyEventos(evs, p, maxCombo)
    for (const ev of evs) {
      if (ev.tipo === 'ko') kos++
      if (ev.tipo === 'tiempo') tiempos++
    }
    revisar(p, meta, violaciones)
    if (p.fase === 'pelea') {
      peleaTicks++
      for (const l of p.luchadores) {
        const d = desde[l.lado]
        if (d.estado !== l.estado) {
          d.estado = l.estado
          d.t = peleaTicks
        } else if (peleaTicks - d.t > TRABADO_TICKS) {
          if (violaciones.length < 12) violaciones.push(`t=${p.tick}: ${l.id} trabado en «${l.estado}» > 6 s`)
          d.t = peleaTicks
          contar(`trabado:${l.estado}`)
        }
      }
    } else {
      desde[0].estado = ''
      desde[1].estado = ''
    }
  }
  contar('combo_max_visto', 0)
  if (maxCombo.v > (CONTEO['combo_max_visto'] ?? 0)) CONTEO['combo_max_visto'] = maxCombo.v
  const p0 = calcularPuntaje(p, 0)
  const p1 = calcularPuntaje(p, 1)
  for (const pu of [p0, p1]) {
    const suma = pu.partes.reduce((s, x) => s + x.puntos, 0)
    if (suma !== pu.total) violaciones.push(`puntaje: partes ${suma} ≠ total ${pu.total}`)
  }
  return {
    ganador: p.ganadorPartida,
    ticks: p.tick,
    terminada: p.fase === 'terminada',
    rounds: [...duracionesDeRounds(p)],
    kos,
    tiempos,
    violaciones,
    puntajes: [p0.total, p1.total],
    rangos: [p0.rango, p1.rango],
    stats: p.estadisticas,
  }
}

// ─── Determinismo ────────────────────────────────────────────────────────────

function huella(personajes: [IdPersonaje, IdPersonaje], dificultad: Dificultad, semilla: number): string {
  const p = crearPartida({
    personajes,
    cpu: [true, true],
    dificultad,
    arena: 'parana',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [META[personajes[0]], META[personajes[1]]],
    semilla,
  })
  let h = 2166136261
  const mezclar = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  while (p.fase !== 'terminada' && p.tick < MAX_TICKS) {
    avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
    for (const ev of p.eventos.splice(0)) mezclar(JSON.stringify(ev))
    const [a, b] = p.luchadores
    mezclar(`${a.x.toFixed(6)},${a.y.toFixed(6)},${a.vida},${a.cuadro},${b.x.toFixed(6)},${b.y.toFixed(6)},${b.vida},${b.cuadro}`)
  }
  return `${(h >>> 0).toString(16)}:${p.tick}`
}

// ─── Corrida ─────────────────────────────────────────────────────────────────

const t0 = performance.now()
const fallas: string[] = []
const resultadosCpu: { pj: [IdPersonaje, IdPersonaje]; dif: Dificultad; r: Resultado }[] = []
let semillaBase = 1000
for (const dif of DIFICULTADES) {
  for (const a of PERSONAJES) {
    for (const b of PERSONAJES) {
      for (let s = 0; s < SEMILLAS; s++) {
        const semilla = semillaBase++ * 7919
        const r = jugar([a, b], dif, semilla, null)
        resultadosCpu.push({ pj: [a, b], dif, r })
      }
    }
  }
}
// Robustez con metas raras (n = 1, impactos vacíos o fuera de rango).
for (let s = 0; s < (RAPIDO ? 4 : 12); s++) {
  const par: [IdPersonaje, IdPersonaje] = [PERSONAJES[s % PERSONAJES.length], PERSONAJES[(s * 5 + 3) % PERSONAJES.length]]
  const r = jugar(par, DIFICULTADES[s % 3], 50000 + s, null, [metaRara(s + 1), metaRara(s + 99)])
  if (!r.terminada || r.violaciones.length) fallas.push(`meta rara ${s}: ${r.violaciones.slice(0, 3).join(' | ') || 'no terminó'}`)
}

const resultadosHumano: { dif: Dificultad; humano: IdPersonaje; cpu: IdPersonaje; gano: boolean; r: Resultado }[] = []
for (const dif of DIFICULTADES) {
  for (const hu of PERSONAJES) {
    for (const cp of PERSONAJES) {
      for (let s = 0; s < SEMILLAS_HUMANO; s++) {
        const semilla = semillaBase++ * 104729
        const r = jugar([hu, cp], dif, semilla, 0)
        resultadosHumano.push({ dif, humano: hu, cpu: cp, gano: r.ganador === 0, r })
      }
    }
  }
}
const ms = performance.now() - t0

// ─── Chequeos ────────────────────────────────────────────────────────────────

const todos = [...resultadosCpu.map((x) => x.r), ...resultadosHumano.map((x) => x.r)]
const noTerminan = todos.filter((r) => !r.terminada).length
if (noTerminan) fallas.push(`${noTerminan} partidas no terminaron en 6 min simulados`)
const conViolaciones = todos.filter((r) => r.violaciones.length)
if (conViolaciones.length) {
  fallas.push(`${conViolaciones.length} partidas con violaciones; ejemplo: ${conViolaciones[0].violaciones.slice(0, 4).join(' | ')}`)
}
const maxTicks = Math.max(...todos.map((r) => r.ticks))

const roundsCpu = resultadosCpu.flatMap((x) => x.r.rounds)
const mediaRound = roundsCpu.reduce((s, x) => s + x, 0) / Math.max(1, roundsCpu.length) / TPS
if (mediaRound < 25 || mediaRound > 55) fallas.push(`duración media de round ${mediaRound.toFixed(1)} s (fuera de 25–55)`)

const porDif: Record<string, { rounds: number[]; kos: number; tiempos: number; gana: Record<string, [number, number]> }> = {}
for (const { pj, dif, r } of resultadosCpu) {
  const d = (porDif[dif] ??= { rounds: [], kos: 0, tiempos: 0, gana: {} })
  d.rounds.push(...r.rounds)
  d.kos += r.kos
  d.tiempos += r.tiempos
  if (pj[0] !== pj[1] && r.ganador !== null) {
    for (const lado of [0, 1] as const) {
      const g = (d.gana[pj[lado]] ??= [0, 0])
      g[0]++
      if (r.ganador === lado) g[1]++
    }
  }
}
// Balance grueso por luchador (el fino, con las metas del dueño, en balance.mts).
const balance: Record<string, Record<string, number>> = {}
for (const dif of DIFICULTADES) {
  const d = porDif[dif]
  balance[dif] = {}
  for (const id of PERSONAJES) {
    const g = d.gana[id] ?? [0, 0]
    const pct = (100 * g[1]) / Math.max(1, g[0])
    balance[dif][id] = pct
    if (!RAPIDO && (pct < 40 || pct > 60)) fallas.push(`balance en ${dif}: ${id} gana ${pct.toFixed(1)} % (fuera de 40–60)`)
  }
}

const humano: Record<string, { ganadas: number; total: number }> = {}
for (const x of resultadosHumano) {
  const h = (humano[x.dif] ??= { ganadas: 0, total: 0 })
  h.total++
  if (x.gano) h.ganadas++
}
const pctHumano = (d: Dificultad) => (100 * humano[d].ganadas) / Math.max(1, humano[d].total)
if (pctHumano('facil') < 30) fallas.push(`humano simple vs fácil gana ${pctHumano('facil').toFixed(1)} % (< 30)`)
if (pctHumano('dificil') > 10) fallas.push(`humano simple vs difícil gana ${pctHumano('dificil').toFixed(1)} % (> 10)`)

const DEBEN_OCURRIR: [string, string][] = [
  ['critico', 'golpe crítico'],
  ['ev:guardia_rota', 'guardia rota'],
  ['ev:congelado', 'congelado'],
  ['descongelado_roto', 'congelado roto a golpes'],
  ['ev:electrocutado', 'electrocutado'],
  ['ev:derribo', 'derribo'],
  ['ev:final_disponible', '¡dejalo al cero!'],
  ['ev:final_al_cero', 'al cero'],
  ['ev:turbo', 'turbo'],
  ['perfecto', 'round perfecto'],
  ...PERSONAJES.flatMap((id) => [1, 2].map((n): [string, string] => [`especial:${id}:${n}`, `${id}: especial ${n}`])),
  ['herramienta:rayo', 'golpe del Corte Relámpago'],
  ['herramienta:tornado', 'golpe del tornado'],
  ['herramienta:sillon', 'golpe del sillón'],
  ['herramienta:spray', 'golpe del spray'],
  ...(['bombo', 'navaja', 'guante', 'moto', 'bala', 'break', 'graffiti', 'trago', 'botella', 'baile', 'onda', 'gorro', 'dragon', 'pelota', 'leche', 'panal', 'mate', 'agua', 'agarre', 'sismo'] as const).map(
    (h): [string, string] => [`herramienta:${h}`, `golpe de ${h}`],
  ),
  ['ev:agarre', 'agarre'],
  ['ev:aturdido', 'aturdido'],
  ['ev:mareado', 'mareado'],
  ['ev:quemado', 'quemado'],
  ['ev:nube', 'nube'],
  ['ev:sismo', 'sismo'],
  ['ev:disparo', 'disparo'],
  ['ev:curacion', 'curación'],
  ['ev:tiempo', 'round por tiempo'],
  ['ev:dash', 'dash'],
  ['ev:salto', 'salto'],
  ['ev:carga', 'carga'],
]
for (const [clave, nombre] of DEBEN_OCURRIR) if (!CONTEO[clave]) fallas.push(`nunca ocurrió: ${nombre}`)

const det1 = huella(['simon', 'chipi'], 'dificil', 123456)
const det2 = huella(['simon', 'chipi'], 'dificil', 123456)
const det3 = huella(['simon', 'chipi'], 'dificil', 123457)
if (det1 !== det2) fallas.push(`no es determinista: ${det1} ≠ ${det2}`)
if (det1 === det3) fallas.push('semillas distintas dieron la misma partida')

// ─── Informe ─────────────────────────────────────────────────────────────────

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)} %`
const prom = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
console.log(`\nCORTE FINAL — simulador del motor (${(ms / 1000).toFixed(1)} s)`)
console.log(`meta: ${PERSONAJES.map((id) => `${id} = ${ORIGEN_META[id]}`).join('; ')}`)
console.log(`partidas CPU vs CPU: ${resultadosCpu.length}; humano simple vs CPU: ${resultadosHumano.length}; metas raras: ${RAPIDO ? 4 : 12}`)
console.log(`terminan: ${todos.length - noTerminan}/${todos.length} (máx ${(maxTicks / TPS / 60).toFixed(2)} min simulados)`)
console.log(`violaciones (NaN, fuera de escenario, cuadros, trabados): ${conViolaciones.length} partidas`)
console.log(`round medio CPU vs CPU: ${mediaRound.toFixed(1)} s`)
for (const dif of DIFICULTADES) {
  const d = porDif[dif]
  const rs = d.rounds.map((x) => x / TPS)
  const vals = Object.values(balance[dif])
  console.log(
    `  ${dif.padEnd(7)} round ${prom(rs).toFixed(1)} s (min ${Math.min(...rs).toFixed(1)}, máx ${Math.max(...rs).toFixed(1)}) · KO ${d.kos} / tiempo ${d.tiempos} · victorias por luchador entre ${Math.min(...vals).toFixed(1)} y ${Math.max(...vals).toFixed(1)} %`,
  )
}
for (const dif of DIFICULTADES) {
  const h = humano[dif]
  const rs = resultadosHumano.filter((x) => x.dif === dif)
  const rondasHumano = rs.flatMap((x) => x.r.rounds).map((x) => x / TPS)
  console.log(`humano simple vs ${dif.padEnd(7)}: round medio ${prom(rondasHumano).toFixed(1)} s`)
  const rangos: Record<string, number> = {}
  for (const x of rs) rangos[x.r.rangos[0]] = (rangos[x.r.rangos[0]] ?? 0) + 1
  console.log(
    `humano simple vs ${dif.padEnd(7)}: gana ${pct(h.ganadas, h.total)} (${h.ganadas}/${h.total}) · puntaje medio ${prom(rs.map((x) => x.r.puntajes[0])).toFixed(0)} · rangos ${JSON.stringify(rangos)}`,
  )
}
const percentil = (xs: number[], q: number) => {
  const o = [...xs].sort((a, b) => a - b)
  return o.length ? o[Math.min(o.length - 1, Math.floor(q * o.length))] : 0
}
const durPartida = resultadosCpu.map((x) => x.r.ticks / TPS)
console.log(`duración de la partida CPU vs CPU: media ${(prom(durPartida) / 60).toFixed(2)} min (p10 ${(percentil(durPartida, 0.1) / 60).toFixed(2)}, p90 ${(percentil(durPartida, 0.9) / 60).toFixed(2)})`)
for (const dif of DIFICULTADES) {
  const gan = resultadosHumano.filter((x) => x.dif === dif && x.gano).map((x) => x.r.puntajes[0])
  const per = resultadosHumano.filter((x) => x.dif === dif && !x.gano).map((x) => x.r.puntajes[0])
  const ganCpu = resultadosCpu.filter((x) => x.dif === dif && x.r.ganador !== null).map((x) => x.r.puntajes[x.r.ganador as Lado])
  console.log(
    `  puntajes ${dif.padEnd(7)}: ganador CPU p10/p50/p90 ${percentil(ganCpu, 0.1)}/${percentil(ganCpu, 0.5)}/${percentil(ganCpu, 0.9)} · humano gana p50 ${percentil(gan, 0.5)} · humano pierde p50/p90 ${percentil(per, 0.5)}/${percentil(per, 0.9)}`,
  )
}
const ganadores = resultadosCpu.filter((x) => x.r.ganador !== null)
const puntGanador = ganadores.map((x) => x.r.puntajes[x.r.ganador as Lado])
console.log(`puntaje del ganador CPU vs CPU: medio ${prom(puntGanador).toFixed(0)}, máx ${Math.max(...puntGanador)}`)
for (const dif of DIFICULTADES) {
  const xs = resultadosCpu.filter((x) => x.dif === dif && x.r.ganador !== null).map((x) => x.r.puntajes[x.r.ganador as Lado])
  const rangos: Record<string, number> = {}
  for (const x of resultadosCpu.filter((y) => y.dif === dif && y.r.ganador !== null)) {
    const rg = x.r.rangos[x.r.ganador as Lado]
    rangos[rg] = (rangos[rg] ?? 0) + 1
  }
  console.log(`  ganador en ${dif.padEnd(7)}: puntaje medio ${prom(xs).toFixed(0)} · rangos ${JSON.stringify(rangos)}`)
}
const st = resultadosCpu.flatMap((x) => x.r.stats)
console.log(
  `por luchador y partida (CPU): daño ${prom(st.map((s) => s.danioHecho)).toFixed(0)} · combo máx ${prom(st.map((s) => s.comboMax)).toFixed(1)} · críticos ${prom(st.map((s) => s.criticos)).toFixed(1)} · especiales ${prom(st.map((s) => s.especialesUsados)).toFixed(1)} (acertados ${prom(st.map((s) => s.especialesAcertados)).toFixed(1)}) · precisión ${pct(st.reduce((s, x) => s + x.golpesAcertados, 0), st.reduce((s, x) => s + x.golpesIntentados, 0))} · bloqueos ${prom(st.map((s) => s.golpesBloqueados)).toFixed(1)}`,
)
const claves = Object.keys(CONTEO).sort()
console.log('eventos y efectos:', claves.map((k) => `${k}=${CONTEO[k]}`).join(' '))
console.log(`determinismo: ${det1} == ${det2} (otra semilla: ${det3})`)
if (fallas.length) {
  console.log(`\nFALLAS (${fallas.length}):`)
  for (const f of fallas) console.log(' - ' + f)
} else console.log('\nTODO OK')

writeFileSync(
  join(import.meta.dirname, 'resultado.json'),
  JSON.stringify(
    {
      fecha: new Date().toISOString(),
      meta: ORIGEN_META,
      partidas: { cpu: resultadosCpu.length, humano: resultadosHumano.length },
      mediaRound,
      porDificultad: Object.fromEntries(
        DIFICULTADES.map((d) => [d, { roundMedio: prom(porDif[d].rounds) / TPS, kos: porDif[d].kos, tiempos: porDif[d].tiempos, victorias: balance[d] }]),
      ),
      humano: Object.fromEntries(DIFICULTADES.map((d) => [d, pctHumano(d)])),
      conteo: CONTEO,
      fallas,
    },
    null,
    2,
  ),
)
process.exit(fallas.length ? 1 : 0)
