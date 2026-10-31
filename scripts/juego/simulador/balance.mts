/**
 * Balance del elenco de «Corte Final»: CPU contra CPU en TODOS los cruces (los dos lados, espejos
 * incluidos) y en las 3 dificultades, repartido en hilos (worker_threads); además, lo que vive un
 * cliente: personas de bot (personas.mts) contra la CPU con cada barbero, de los dos lados y contra
 * cada rival, y persona contra persona (la pelea online), con y sin la demora del online.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs balance.mts [opciones]
 *     --semillas=N        partidas por cruce ORDENADO y dificultad (def. 60)
 *     --semillasNormal=N  ídem sólo para normal (def. = semillas): la matriz 13×13 sale de normal. Un
 *                         cruce de normal se decide con ≥ 400 partidas (los dos lados): 200 o más
 *     --humano=N          partidas de CADA humano por barbero del humano y dificultad, repartidas
 *                         entre los 13 rivales y los dos lados (def. 52). Con un múltiplo de 26 cada
 *                         celda de la matriz humano×CPU tiene lo mismo. Todos los humanos juegan las
 *                         MISMAS partidas (rival, lado y semilla): las diferencias entre ellos son de
 *                         a pares
 *     --humanoNormal=N    ídem sólo para normal (def. = humano): la matriz humano×CPU sale de normal
 *     --humanos=a,b       qué personas juegan contra la CPU (def. simple,novato,simple@0,novato@0,
 *                         botonero). «simple» y «novato» ven el ataque con REACCION_HUMANA ticks de
 *                         retraso: son los OFICIALES de la meta B. «simple@0» y «novato@0» son los de
 *                         antes (lo ven en el mismo tick): referencia. El botonero mide el salto entre
 *                         dificultades
 *     --novatos=N         persona contra persona: partidas por cruce ordenado de cada persona y
 *                         demora (def. 10; 0 = no corre). Corre además la referencia de antes
 *                         (novato@0 contra novato@0, sin demora)
 *     --personas=a,b      qué personas pelean entre sí (def. novato,apunta,botonero,casual,casual2)
 *     --demoras=0,17,20   demora de entrada del online, en ticks (def. 0,17,20; ver personas.mts)
 *     --matricesE         escribe también la matriz 13×13 de cada persona y demora
 *     --sal=K             semillas NUEVAS (un hash del contador y de K): para validar con semillas
 *                         distintas de las que usó el ajuste. Sin --sal, las de siempre
 *     --sales=base,1      varias tandas de semillas juntas en un solo informe («base» = las de siempre)
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
 *  - C, CPU contra CPU: cada luchador 45–55 % en cada dificultad; ningún cruce fuera de 35–65 % en
 *    normal (decidido con ≥ 400 partidas por cruce: con menos, el informe lo marca como indicativo);
 *    sesgo de lado < 3 %; espejos ≈ 50 %; casi ningún round por tiempo; todos los especiales se usan.
 *  - B, humanos contra la CPU NORMAL (la dificultad por defecto): con los dos oficiales (el simple y
 *    el novato CON reacción humana), el % que gana el humano queda entre 25 y 55 % para cada barbero,
 *    de los dos lados de la matriz (el que elige el humano y el que maneja la CPU). En fácil el simple
 *    gana ≥ 70 % con cada barbero y en difícil ninguno de los dos pasa de 20 %.
 *  - D, la CPU usa los DOS especiales: contra el simple, cada especial es ≥ 20 % de los que tira con
 *    cada barbero, en cada dificultad.
 *  - E, persona contra persona (la pelea online): con las cinco personas (novato, apunta, botonero,
 *    casual y casual2) y las tres demoras (0, 17 y 20), el promedio de cada barbero entre 35 y 65 %
 *    y ninguna columna (persona y demora) fuera de 30–70. Es la balanza del KIT: el online no tiene
 *    CPU, así que ni la pericia ni la asistencia la tocan (tercera tanda, 31/oct). «simple contra
 *    simple» (sólo GOLPE) se puede pedir con --personas, pero no es meta: sólo mide los normales.
 * Ruido: con n partidas, el error de un porcentaje es ≈ ±100/√n (al 95 %): 260 por fila de B dan ±6.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AtlasPersonaje, Dificultad, EntradaJugador, IdPersonaje, Lado, MetaAnimaciones } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA, TPS } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { duracionesDeRounds } from '../../../src/lib/juego/motor/partida.ts'
import { DANIO_KIT, KITS_DISENIO, MOVIMIENTOS, conDanio } from '../../../src/lib/juego/motor/movimientos.ts'
import type { KitPersonaje } from '../../../src/lib/juego/motor/movimientos.ts'
import { CONTRA_PERSONA, PARAMS_CPU } from '../../../src/lib/juego/motor/cpu.ts'
import type { ParamsCpu } from '../../../src/lib/juego/motor/cpu.ts'
import { IDS_PERSONAJES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import type { Persona } from './personas.mts'
import { conDemora, crearPersona, leerNombre, reaccionDe } from './personas.mts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const MAX_TICKS = 6 * 60 * TPS
const DIFS: Dificultad[] = ['facil', 'normal', 'dificil']

/** Metas (ver el encabezado). */
const META_HUMANO_NORMAL: readonly [number, number] = [25, 55]
const TOPE_HUMANO_DIFICIL = 20
const MIN_SIMPLE_FACIL = 70
const MIN_ESPECIAL_CPU = 20
const META_NOVATOS: readonly [number, number] = [35, 65]
/** E: ninguna columna (persona y demora) fuera de esto. */
const META_E_CELDA: readonly [number, number] = [30, 70]
/** Partidas por cruce de normal para decidir si está fuera de 35–65 (con menos: ±5 o más). */
const CRUCE_DECIDE = 400
/** Los humanos de la meta B (con reacción humana); los demás se informan como referencia. */
const OFICIALES = ['simple', 'novato']
const HUMANOS_DEF = ['simple', 'novato', 'simple@0', 'novato@0', 'botonero']
const PERSONAS_DEF = ['novato', 'apunta', 'botonero', 'casual', 'casual2']
const DEMORAS_DEF = [0, 17, 20]
/** La referencia de E de antes del 31/oct: novato contra novato que ven el ataque en el mismo tick, sin demora. */
const NOVATO_REF = 'novato@0'

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

// ─── Una partida ─────────────────────────────────────────────────────────────

type TipoTrabajo = 'cpu' | 'humano' | 'personas' | 'novatos'

interface Trabajo {
  a: IdPersonaje
  b: IdPersonaje
  dif: Dificultad
  semilla: number
  tipo: TipoTrabajo
  /** Lado del humano contra la CPU (tipo 'humano'). */
  humano: Lado | null
  /** La persona (tipo 'humano' o 'personas'). */
  bot: string | null
  /** Demora del online en ticks (tipo 'personas'). */
  demora: number
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
  const dosPersonas = t.tipo === 'personas' || t.tipo === 'novatos'
  const p = crearPartida({
    personajes: [t.a, t.b],
    cpu: dosPersonas ? [false, false] : [t.humano !== 0, t.humano !== 1],
    dificultad: t.dif,
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [metas[t.a], metas[t.b]],
    semilla: t.semilla,
  })
  const I = internoDe(p)
  // Las personas de cada lado, cada una con su azar (como siempre: semilla·7+3 y semilla·13+11).
  const personas: [Persona | null, Persona | null] = [null, null]
  if (dosPersonas) {
    const nombre = t.tipo === 'novatos' ? NOVATO_REF : (t.bot ?? 'novato')
    personas[0] = conDemora(crearPersona(nombre, t.semilla * 7 + 3), t.demora)
    personas[1] = conDemora(crearPersona(nombre, t.semilla * 13 + 11), t.demora)
  } else if (t.tipo === 'humano' && t.humano !== null) personas[t.humano] = crearPersona(t.bot ?? 'simple', t.semilla * 7 + 3)
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
      const persona = personas[lado]
      if (persona) ent[lado] = persona(p, lado)
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
  /** clave `${a}|${b}` (a en el lado 0) → [partidas, ganó lado 0, ganó lado 1]: la referencia de E (novato@0, sin demora). */
  novatos: Record<string, [number, number, number]>
  /** clave `${persona}|${demora}|${a}|${b}` → [partidas, ganó lado 0, ganó lado 1]: persona contra persona. */
  personas: Record<string, [number, number, number]>
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
    personas: {},
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
  const resultado = [1, r.ganador === 0 ? 1 : 0, r.ganador === 1 ? 1 : 0]
  if (t.tipo === 'novatos') {
    sumarEn(ac.novatos, `${t.a}|${t.b}`, resultado, () => [0, 0, 0])
    return
  }
  if (t.tipo === 'personas') {
    sumarEn(ac.personas, `${t.bot}|${t.demora}|${t.a}|${t.b}`, resultado, () => [0, 0, 0])
    return
  }
  if (t.tipo === 'humano' && t.humano !== null) {
    const bot = t.bot ?? 'simple'
    const id = t.humano === 0 ? t.a : t.b
    const cpu = (1 - t.humano) as Lado
    const idCpu = cpu === 0 ? t.a : t.b
    sumarEn(ac.humanos, `${bot}|${t.dif}|${id}|${idCpu}|${t.humano}`, [1, r.ganador === t.humano ? 1 : 0], () => [0, 0])
    sumarEn(ac.especialesCpu, `${bot}|${t.dif}|${idCpu}`, [r.usos[cpu][0], r.usos[cpu][1], 1], () => [0, 0, 0])
    return
  }
  const k = `${t.dif}|${t.a}|${t.b}`
  sumarEn(ac.cruces, k, resultado, () => [0, 0, 0])
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
  for (const [k, v] of Object.entries(b.personas ?? {})) sumarEn(a.personas, k, v, () => [0, 0, 0])
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
 * persona contra persona). Sin sal, la fórmula de siempre. Con sal, un hash del contador, de la sal y
 * de la clase: semillas que no tocó ningún ajuste. Cada clase lleva su propio contador (desde el
 * 31/oct): sumar o sacar humanos no cambia las semillas de CPU contra CPU.
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
  const humanos = arg('humanos') !== undefined ? (arg('humanos') ?? '').split(',').filter(Boolean) : HUMANOS_DEF
  for (const h of humanos) leerNombre(h)
  const semillasNovatos = Number(arg('novatos') ?? 10)
  const personas = arg('personas') !== undefined ? (arg('personas') ?? '').split(',').filter(Boolean) : PERSONAS_DEF
  for (const h of personas) leerNombre(h)
  const demoras = arg('demoras') !== undefined ? (arg('demoras') ?? '').split(',').filter(Boolean).map(Number) : DEMORAS_DEF
  const salArg = arg('sal')
  const salesArg = arg('sales')
  const sales: (number | null)[] = salesArg ? salesArg.split(',').map((s) => (s === 'base' ? null : Number(s))) : [salArg !== undefined ? Number(salArg) : null]
  const difs = (arg('dif')?.split(',') ?? DIFS) as Dificultad[]
  const ids: IdPersonaje[] = [...IDS_PERSONAJES]
  const solo = arg('solo')?.split(',') as IdPersonaje[] | undefined
  const hilos = Math.max(1, Math.min(Number(arg('hilos') ?? 6), availableParallelism()))
  const rutaAjuste = arg('ajuste')
  const ajuste: Ajuste | null = rutaAjuste ? (JSON.parse(readFileSync(rutaAjuste, 'utf8')) as Ajuste) : null
  aplicarAjuste(ajuste)

  const trabajos: Trabajo[] = []
  for (const sal of sales) {
    // Un contador por clase de trabajo (ver semillaDe).
    let bCpu = 1
    let bHum = 1
    let bPer = 1
    for (const dif of difs) {
      const n = dif === 'normal' ? semillasNormal : semillas
      for (const a of ids) {
        for (const b of ids) {
          for (let s = 0; s < n; s++) {
            const semilla = semillaDe(bCpu++, 7919, sal)
            if (!solo || solo.includes(a) || solo.includes(b)) trabajos.push({ a, b, dif, semilla, tipo: 'cpu', humano: null, bot: null, demora: 0 })
          }
        }
      }
      // Los humanos: cada barbero del humano contra los 13 rivales, alternando el lado de la pantalla.
      // Todos los humanos juegan las mismas partidas (la misma semilla para la misma celda y vuelta).
      const nh = dif === 'normal' ? semillasHumanoNormal : semillasHumano
      for (const yo of ids) {
        for (let s = 0; s < nh; s++) {
          const rival = ids[Math.floor(s / 2) % ids.length]
          const semilla = semillaDe(bHum++, 104729, sal)
          if (solo && !solo.includes(yo) && !solo.includes(rival)) continue
          const lado = (s % 2) as Lado
          const [a, b] = lado === 0 ? [yo, rival] : [rival, yo]
          for (const bot of humanos) trabajos.push({ a, b, dif, semilla, tipo: 'humano', humano: lado, bot, demora: 0 })
        }
      }
    }
    // Persona contra persona (no hay CPU: la dificultad no cambia nada; va como normal). Todas las
    // personas y demoras juegan las mismas partidas.
    if (semillasNovatos > 0) {
      for (const a of ids) {
        for (const b of ids) {
          for (let s = 0; s < semillasNovatos; s++) {
            const semilla = semillaDe(bPer++, 1299709, sal)
            if (solo && !solo.includes(a) && !solo.includes(b)) continue
            trabajos.push({ a, b, dif: 'normal', semilla, tipo: 'novatos', humano: null, bot: NOVATO_REF, demora: 0 })
            for (const bot of personas) for (const demora of demoras) trabajos.push({ a, b, dif: 'normal', semilla, tipo: 'personas', humano: null, bot, demora })
          }
        }
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
    {
      difs,
      ids,
      seg,
      partidas: trabajos.length,
      semillas,
      semillasNormal,
      semillasHumano,
      semillasHumanoNormal,
      humanos,
      personas,
      demoras,
      semillasNovatos,
      sales,
      origenes,
      hilos,
      matricesE: args.includes('--matricesE'),
    },
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
  humanos: string[]
  personas: string[]
  demoras: number[]
  semillasNovatos: number
  sales: (number | null)[]
  origenes: string
  hilos: number
  matricesE: boolean
}

/** Cómo se llama una persona en el informe: «novato (reacción 14)». */
function rotulo(bot: string): string {
  const r = reaccionDe(bot)
  return `${bot} (reacción ${r}${r ? ` = ${Math.round((r * 1000) / 60)} ms` : ''})`
}

function informe(ac: Acum, o: Opciones, rutaMd?: string, rutaJson?: string): void {
  const lineas: string[] = []
  const fallas: string[] = []
  const L = (s = '') => lineas.push(s)
  const nombre = (id: IdPersonaje) => PERSONAJES[id].nombre
  const salesTxt = o.sales.map((s) => (s === null ? 'las de siempre' : `sal ${s}`)).join(' + ')
  L(`# Balance de «Corte Final» — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
  L()
  L(
    `${o.partidas} partidas en ${o.seg.toFixed(0)} s (${o.hilos} hilos). CPU contra CPU: ${o.semillas} por cruce ordenado (normal ${o.semillasNormal}); ` +
      `humanos (${o.humanos.join(', ') || 'ninguno'}): ${o.semillasHumano} por barbero y dificultad (normal ${o.semillasHumanoNormal}); ` +
      `persona contra persona (${o.personas.join(', ') || 'ninguna'}; demoras ${o.demoras.join(', ')}): ${o.semillasNovatos} por cruce ordenado. Semillas: ${salesTxt}.`,
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
    L('## C. Victorias por luchador (CPU contra CPU, sin espejos)')
    L()
    L(`| Luchador | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const x = porLuchador[d]?.[id]
        const v = x ? pct(x[1], x[0]) : NaN
        if (Number.isFinite(v) && (v < 45 || v > 55)) fallas.push(`${nombre(id)} gana ${f1(v)} % en ${d} (meta 45–55)`)
        return `${f1(v)} ±${f1(ic(v, x?.[0] ?? 0))}${Number.isFinite(v) && (v < 45 || v > 55) ? ' (!)' : ''}`
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
    L(`## C. Cruces en ${dm} (gana la fila contra la columna, los dos lados juntos)`)
    L()
    L(`| | ${o.ids.map((id) => nombre(id)).join(' | ')} |`)
    L(`|---|${o.ids.map(() => '---:').join('|')}|`)
    const fueraLista: string[] = []
    const indicativos: string[] = []
    let peor = { v: 50, a: '', b: '', n: 0 }
    let nMin = Infinity
    for (const a of o.ids) {
      const celdas = o.ids.map((b) => {
        if (a === b) return '·'
        const x = ac.cruces[`${dm}|${a}|${b}`]
        const y = ac.cruces[`${dm}|${b}|${a}`]
        const n = (x?.[0] ?? 0) + (y?.[0] ?? 0)
        const g = (x?.[1] ?? 0) + (y?.[2] ?? 0)
        const v = pct(g, n)
        if (n > 0) nMin = Math.min(nMin, n)
        if (Number.isFinite(v) && Math.abs(v - 50) > Math.abs(peor.v - 50)) peor = { v, a: nombre(a), b: nombre(b), n }
        const malo = Number.isFinite(v) && (v < 35 || v > 65)
        if (malo && a < b) (n >= CRUCE_DECIDE ? fueraLista : indicativos).push(`${nombre(a)}–${nombre(b)} ${f1(v)} (${n})`)
        return `${Number.isFinite(v) ? v.toFixed(0) : '–'}${malo ? '(!)' : ''}`
      })
      L(`| ${nombre(a)} | ${celdas.join(' | ')} |`)
    }
    L()
    L(
      `Cruces fuera de 35–65 % con ≥ ${CRUCE_DECIDE} partidas: ${fueraLista.length}${fueraLista.length ? ` (${fueraLista.join(', ')})` : ''}.` +
        (indicativos.length ? ` Con menos partidas (indicativos, no deciden): ${indicativos.join(', ')}.` : '') +
        ` El más desparejo: ${peor.a} contra ${peor.b}, ${f1(peor.v)} % (${peor.n} partidas, ±${f1(ic(peor.v, peor.n))}).`,
    )
    if (fueraLista.length > 0 && dm === 'normal') fallas.push(`${fueraLista.length} cruces fuera de 35–65 % en normal: ${fueraLista.join(', ')}`)
    if (dm === 'normal' && Number.isFinite(nMin) && nMin < CRUCE_DECIDE) L(`Los cruces tienen ${nMin} partidas: para decidirlos hacen falta ${CRUCE_DECIDE} (--semillasNormal=${CRUCE_DECIDE / 2} o dos sales).`)
    L()

    // Rounds.
    L('## C. Rounds (CPU contra CPU)')
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
    L('## C. Especiales (CPU contra CPU, todas las dificultades): usos por partida, % que acierta y parte de cada uno')
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
  const botsHumanos = o.humanos.filter((bot) => Object.keys(ac.humanos).some((k) => k.startsWith(`${bot}|`)))
  if (botsHumanos.length) {
    // Resumen de B: cada persona contra la CPU en cada dificultad (todas las celdas juntas).
    L('## B. Personas contra la CPU: % que gana la persona (los 13 barberos y los 13 rivales, los dos lados)')
    L()
    L(`Oficiales para la meta B: ${OFICIALES.filter((b) => botsHumanos.includes(b)).map(rotulo).join(', ') || 'ninguno'}. Referencia: ${botsHumanos.filter((b) => !OFICIALES.includes(b)).map(rotulo).join(', ') || 'ninguna'}.`)
    L()
    L(`| Persona | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const bot of botsHumanos) {
      L(`| ${bot}${OFICIALES.includes(bot) ? ' (oficial)' : ''} | ${o.difs.map((d) => {
        const [n, g] = hum(bot, d, () => true)
        const v = pct(g, n)
        return `${f1(v)} ±${f1(ic(v, n))}`
      }).join(' | ')} |`)
    }
    L()
  }
  for (const bot of botsHumanos) {
    const oficial = OFICIALES.includes(bot)
    L(`## B. Humano «${bot}»${oficial ? ' (oficial)' : ' (referencia)'} contra la CPU: % que gana con cada barbero (los 13 rivales, los dos lados)`)
    L()
    L(`Reacción: ${rotulo(bot)}.`)
    L()
    L(`| Barbero del humano | ${o.difs.join(' | ')} |`)
    L(`|---|${o.difs.map(() => '---:').join('|')}|`)
    for (const id of o.ids) {
      const celdas = o.difs.map((d) => {
        const [n, g] = hum(bot, d, (yo) => yo === id)
        const v = pct(g, n)
        if (oficial && d === 'dificil' && Number.isFinite(v) && v > TOPE_HUMANO_DIFICIL) fallas.push(`humano ${bot} con ${nombre(id)} gana ${f1(v)} % en difícil (tope ${TOPE_HUMANO_DIFICIL})`)
        if (oficial && d === 'facil' && bot === 'simple' && Number.isFinite(v) && v < MIN_SIMPLE_FACIL) fallas.push(`humano simple con ${nombre(id)} gana ${f1(v)} % en fácil (mínimo ${MIN_SIMPLE_FACIL})`)
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
      const malo = oficial && Number.isFinite(v) && (v < lo || v > hi)
      if (malo) fallas.push(`humano ${bot} en normal con ${nombre(yo)} gana ${f1(v)} % (meta ${lo}–${hi})`)
      L(`| ${nombre(yo)} | ${celdas.join(' | ')} | ${f1(v)} ±${f1(ic(v, n))}${malo ? ' (!)' : ''} |`)
    }
    const porCpu = o.ids.map((cpu) => {
      const [n, g] = hum(bot, 'normal', (_y, c) => c === cpu)
      const v = pct(g, n)
      const malo = oficial && Number.isFinite(v) && (v < lo || v > hi)
      if (malo) fallas.push(`humano ${bot} en normal contra la CPU ${nombre(cpu)} gana ${f1(v)} % (meta ${lo}–${hi})`)
      return `${f1(v)}${malo ? ' (!)' : ''}`
    })
    const [nt, gt] = hum(bot, 'normal', () => true)
    L(`| por barbero de la CPU | ${porCpu.join(' | ')} | ${f1(pct(gt, nt))} |`)
    L()
  }

  // ─── Reparto de especiales de la CPU contra el humano simple (oficial) ───
  if (Object.keys(ac.especialesCpu).some((k) => k.startsWith('simple|'))) {
    L('## D. Especiales de la CPU contra el humano simple (oficial): parte de cada especial (y usos por partida)')
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

  // ─── Persona contra persona ───
  /** % de cada barbero (los dos lados juntos) y lado izquierdo, desde un registro `a|b` → [n, g0, g1]. */
  const marginales = (reg: Record<string, [number, number, number]>) => {
    const fila: Record<string, [number, number]> = {}
    let n0 = 0
    let g0 = 0
    for (const [k, [n, x0, x1]] of Object.entries(reg)) {
      const [a, b] = k.split('|')
      n0 += x0 + x1
      g0 += x0
      if (a === b) continue
      ;(fila[a] ??= [0, 0])[0] += n
      fila[a][1] += x0
      ;(fila[b] ??= [0, 0])[0] += n
      fila[b][1] += x1
    }
    return { fila, lado: pct(g0, n0), n: n0 }
  }
  const matriz = (reg: Record<string, [number, number, number]>) => {
    L(`| | ${o.ids.map((id) => nombre(id)).join(' | ')} | total |`)
    L(`|---|${o.ids.map(() => '---:').join('|')}|---:|`)
    const { fila } = marginales(reg)
    for (const a of o.ids) {
      const celdas = o.ids.map((b) => {
        if (a === b) return '·'
        const x = reg[`${a}|${b}`]
        const y = reg[`${b}|${a}`]
        const n = (x?.[0] ?? 0) + (y?.[0] ?? 0)
        const g = (x?.[1] ?? 0) + (y?.[2] ?? 0)
        return n ? pct(g, n).toFixed(0) : '–'
      })
      const [na, ga] = fila[a] ?? [0, 0]
      const v = pct(ga, na)
      L(`| ${nombre(a)} | ${celdas.join(' | ')} | ${f1(v)} ±${f1(ic(v, na))} |`)
    }
    L()
  }
  const regPersona: Record<string, Record<string, [number, number, number]>> = {}
  for (const [k, v] of Object.entries(ac.personas)) {
    const [bot, demora, a, b] = k.split('|')
    ;(regPersona[`${bot}|${demora}`] ??= {})[`${a}|${b}`] = v
  }
  const combos = o.personas.flatMap((bot) => o.demoras.map((d) => `${bot}|${d}`)).filter((c) => regPersona[c])
  if (combos.length) {
    const [lo, hi] = META_NOVATOS
    const [clo, chi] = META_E_CELDA
    // «simple contra simple» (sólo GOLPE) se informa pero no cuenta para la meta (ver el encabezado).
    const cuenta = (c: string) => !c.startsWith('simple|') && !c.startsWith('simple@')
    L('## E. Persona contra persona (la pelea online): % que gana cada barbero, por persona y demora de entrada')
    L()
    L(
      `Cada columna es una persona contra sí misma con la demora del online (D ticks: lo que aprieta en el tick n se aplica en n + D; ` +
        `se suma a su reacción). Medido entre dos jugadores el 30/oct: RTT ≈ 370–400 ms por Realtime → D = 17–18 (lockstep.ts). ` +
        `Meta: el promedio de las columnas entre ${lo} y ${hi} % y ninguna columna fuera de ${clo}–${chi} («simple» no cuenta).`,
    )
    L()
    const cab = combos.map((c) => {
      const [bot, d] = c.split('|')
      return `${bot}, D ${d}`
    })
    L(`| Barbero | ${cab.join(' | ')} | promedio | mín–máx |`)
    L(`|---|${combos.map(() => '---:').join('|')}|---:|---:|`)
    const fueraCelda: string[] = []
    const fueraPromedio: string[] = []
    const margs = Object.fromEntries(combos.map((c) => [c, marginales(regPersona[c])]))
    for (const id of o.ids) {
      const vs: number[] = []
      const celdas = combos.map((c) => {
        const [n, g] = margs[c].fila[id] ?? [0, 0]
        const v = pct(g, n)
        const malo = cuenta(c) && Number.isFinite(v) && (v < clo || v > chi)
        if (cuenta(c) && Number.isFinite(v)) vs.push(v)
        if (malo) {
          const [bot, d] = c.split('|')
          fueraCelda.push(`${nombre(id)} ${bot}·D${d} ${f1(v)}`)
        }
        return `${f1(v)}${malo ? ' (!)' : ''}`
      })
      const prom = vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : NaN
      const malo = Number.isFinite(prom) && (prom < lo || prom > hi)
      if (malo) fueraPromedio.push(`${nombre(id)} ${f1(prom)}`)
      const rango = vs.length ? `${Math.min(...vs).toFixed(0)}–${Math.max(...vs).toFixed(0)}` : '–'
      L(`| ${nombre(id)} | ${celdas.join(' | ')} | ${f1(prom)}${malo ? ' (!)' : ''} | ${rango} |`)
    }
    L(`| lado izquierdo | ${combos.map((c) => f1(margs[c].lado)).join(' | ')} | | |`)
    const nPorFila = combos.map((c) => Object.values(margs[c].fila)[0]?.[0] ?? 0)
    L()
    L(`Partidas por barbero en cada columna: ${Math.min(...nPorFila)} (±${f1(ic(50, Math.min(...nPorFila)))} en el medio).`)
    L()
    if (fueraPromedio.length) fallas.push(`E: ${fueraPromedio.length} barberos con el promedio fuera de ${lo}–${hi}: ${fueraPromedio.join(', ')}`)
    if (fueraCelda.length) fallas.push(`E: ${fueraCelda.length} columnas fuera de ${clo}–${chi}: ${fueraCelda.join(', ')}`)
    if (o.matricesE) {
      for (const c of combos) {
        const [bot, d] = c.split('|')
        L(`### E. ${rotulo(bot)}, demora ${d}: gana la fila contra la columna`)
        L()
        matriz(regPersona[c])
      }
    }
  }
  if (Object.keys(ac.novatos).length) {
    L(`## E. Referencia: novato contra novato que ven el ataque en el mismo tick, sin demora (la tabla de antes del 31/oct)`)
    L()
    matriz(ac.novatos)
    L(`Lado: gana el de la izquierda ${f1(marginales(ac.novatos).lado)} % (${marginales(ac.novatos).n} partidas, espejos incluidos).`)
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
