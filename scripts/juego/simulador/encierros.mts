/**
 * Encierros (TOPE_ENCIERRO, constantes.ts): la vara, los guiones forzados y las búsquedas de la
 * verificación del 31/oct (motor-semillas y su confirmación), traídos al simulador. Lo usa
 * cadenas.mts; también se corre solo para una búsqueda larga:
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs encierros.mts [opciones]
 *     --azar=N      guiones al azar por atacante, víctima, manera de escaparse y arranque (def. 30)
 *     --mut=N       mutaciones de cada uno de los 10 mejores guiones de cada atacante (def. 300)
 *     --hueco=N     la vara práctica une rachas separadas por huecos de ≤ N ticks (def. 2)
 *     --semilla=K   semilla de la búsqueda (def. 7717)
 *     --hilos=K     hilos (def. 8)
 *     --json=ruta   los peores casos (sirven de guiones fijos: encierros-casos.json)
 *
 * La vara práctica es la de los verificadores: rachas sin control (sin el bloqueo puro) unidas por
 * huecos de ≤ `hueco` ticks de pelea (el bloqueo cuenta como hueco), medidas de punta a punta en
 * PANTALLA (huecos, hitstop y super flash incluidos). El motor mide lo mismo con su propio reloj
 * (InternoLuchador.sinControl, que no corta el encierro por huecos más cortos que el respiro) y en
 * TOPE_ENCIERRO.tope lo suelta de todo: con `hueco` < respiro, ninguna racha práctica pasa del tope.
 *
 * Las víctimas quieren escaparse de cuatro maneras (las de la verificación): saltar para atrás con
 * arriba sostenido, machacar la esquiva para atrás, cubrirse siempre o machacar GOLPE.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { AtlasPersonaje, EntradaJugador, IdPersonaje, LuchadorEstado, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import type { InternoLuchador } from '../../../src/lib/juego/motor/interno.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { puedeActuar } from '../../../src/lib/juego/motor/cuerpo.ts'
import { TOPE_ENCIERRO } from '../../../src/lib/juego/motor/constantes.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')

// ─── Meta de animaciones ─────────────────────────────────────────────────────

const TIPICA: Record<string, [number, number[]]> = {
  quieto: [5, []], caminar: [6, []], correr: [4, []], dash: [3, []], guardia: [4, []], agachado: [4, []],
  saltar: [4, []], caer: [6, []], golpe: [5, [4]], patada: [4, [2]], combo: [8, [2, 5, 7]], herramienta1: [4, [2]],
  herramienta2: [3, [1]], especial1: [5, [3]], especial2: [6, [2]], danio: [5, []], ko: [3, []], levantarse: [5, []],
  victoria: [6, []], burla: [8, []],
}
/** La típica (la de cadenas.mts: los guiones de la verificación se buscaron con ésta). */
export function metaTipica(): MetaAnimaciones {
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return m
}
/** La del atlas del barbero (la que se usa en las peleas de verdad), o la típica. */
export function metaReal(id: IdPersonaje): MetaAnimaciones {
  const ruta = join(REPO, 'public/juego/personajes', id, 'atlas.json')
  if (existsSync(ruta)) return metaDesdeAtlas(JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje)
  return metaTipica()
}

// ─── La vara ─────────────────────────────────────────────────────────────────

/** Sin control (la misma definición que el motor, escrita acá aparte para poder compararlas). */
export function sinControlVara(l: LuchadorEstado, li: InternoLuchador): boolean {
  if (!l.enSuelo) return li.caidaDerribo > 0 || li.agarradoPor !== null
  return !puedeActuar(l, li) && li.accion === null && li.dash === null
}
/** Sólo el blockstun de un golpe bloqueado, sin otro estado encima. */
export function soloBloqueo(l: LuchadorEstado, li: InternoLuchador): boolean {
  const ef = l.efectos
  return (
    l.enSuelo &&
    li.stun > 0 &&
    li.stunBloqueo &&
    ef.guardiaRota === 0 &&
    ef.congelado === 0 &&
    ef.aturdido === 0 &&
    ef.electrocutado === 0 &&
    li.derribo === 0 &&
    li.levantar === 0 &&
    li.caidaDerribo === 0 &&
    li.agarradoPor === null
  )
}

/**
 * La vara práctica de los verificadores. `paso` va DESPUÉS de cada avanzar(), con `congelado` =
 * el tick que se acaba de simular era de hitstop o super flash (p.congelamientoGolpe > 0 ANTES de
 * avanzar). Mide la racha más larga en pantalla (`reloj`) y en ticks de pelea (`pelea`).
 */
export class VaraPractica {
  reloj = 0
  pelea = 0
  maxReloj = 0
  maxPelea = 0
  /** La racha estricta más larga (sin unir huecos), en pantalla y en pelea. */
  estrictaReloj = 0
  estrictaPelea = 0
  maxEstrictaReloj = 0
  maxEstrictaPelea = 0
  private hueco = 0
  private huecoReloj = 0
  private huecoPelea = 0
  readonly tope: number
  constructor(tope = 2) {
    this.tope = tope
  }
  paso(p: Partida, l: LuchadorEstado, li: InternoLuchador, congelado: boolean): boolean {
    const enc = p.fase === 'pelea' && sinControlVara(l, li) && !soloBloqueo(l, li)
    if (enc) {
      this.reloj += this.huecoReloj + 1
      if (!congelado) this.pelea += this.huecoPelea + 1
      this.hueco = 0
      this.huecoReloj = 0
      this.huecoPelea = 0
      this.estrictaReloj++
      if (!congelado) this.estrictaPelea++
    } else {
      this.estrictaReloj = 0
      this.estrictaPelea = 0
      if (this.reloj > 0) {
        if (p.fase !== 'pelea') this.hueco = this.tope + 1
        else if (!congelado) {
          this.hueco++
          this.huecoPelea++
        }
        this.huecoReloj++
        if (this.hueco > this.tope) {
          this.reloj = 0
          this.pelea = 0
          this.hueco = 0
          this.huecoReloj = 0
          this.huecoPelea = 0
        }
      }
    }
    this.maxReloj = Math.max(this.maxReloj, this.reloj)
    this.maxPelea = Math.max(this.maxPelea, this.pelea)
    this.maxEstrictaReloj = Math.max(this.maxEstrictaReloj, this.estrictaReloj)
    this.maxEstrictaPelea = Math.max(this.maxEstrictaPelea, this.estrictaPelea)
    return enc
  }
}

/**
 * La regla del motor (luchador.ts, contarEncierro) contada acá aparte, para comprobar que el motor
 * cuenta lo que dice: de punta a punta en pantalla, el bloqueo puro y los ticks congelados no
 * respiran, y el encierro termina con TOPE_ENCIERRO.respiro ticks de pelea con control. Al llegar al
 * tope el motor lo suelta en ese mismo tick, y en el tick del KO o del ¡TIEMPO! cuenta con el estado
 * de antes del KO: desde ahí no se compara (`comparable`) hasta que termine ese encierro o el round.
 */
export class VaraMotor {
  c = 0
  private libres = 0
  private round = 1
  private trasTope = false
  private enPelea = false
  get comparable(): boolean {
    return this.enPelea && !this.trasTope
  }
  paso(p: Partida, l: LuchadorEstado, li: InternoLuchador, congelado: boolean): void {
    if (p.round !== this.round) {
      this.round = p.round
      this.c = 0
      this.libres = 0
      this.trasTope = false
    }
    this.enPelea = p.fase === 'pelea'
    if (!this.enPelea) return
    if (sinControlVara(l, li) && !soloBloqueo(l, li)) {
      this.libres = 0
      this.c++
    } else if (this.c > 0) {
      this.c++
      if (!congelado && !soloBloqueo(l, li)) {
        this.libres++
        if (this.libres >= TOPE_ENCIERRO.respiro) {
          this.c = 0
          this.libres = 0
        }
      }
    }
    // Después del tope se vuelve a comparar cuando los dos relojes terminaron ese encierro.
    if (this.c >= TOPE_ENCIERRO.tope - 1) this.trasTope = true
    else if (this.trasTope && this.c === 0 && li.sinControl === 0) this.trasTope = false
  }
}

// ─── Guiones forzados (los de la verificación) ───────────────────────────────

export const ACCIONES = ['golpe', 'herramienta', 'especial1', 'especial2', 'nada', 'adelante', 'atras', 'dash', 'saltar', 'agachadoGolpe', 'acercar'] as const
export type AccionGuion = (typeof ACCIONES)[number]
export type PasoGuion = [AccionGuion, number]
export const POLITICAS = ['salta', 'esquiva', 'guardia', 'pega'] as const
export type Politica = (typeof POLITICAS)[number]

export interface CasoEncierro {
  atacante: IdPersonaje
  victima: IdPersonaje
  politica: Politica
  /** 'rota': la víctima arranca con la guardia en 5 y una MÁQUINA se la rompe; 'neutro': quieta hasta el primer golpe. */
  arranque: 'rota' | 'neutro'
  x1: number
  semilla: number
  guion: PasoGuion[]
}

export interface MedidaEncierro {
  /** El reloj del motor más alto (InternoLuchador.sinControl). */
  motor: number
  /** La racha práctica más larga, en pantalla y en ticks de pelea. */
  reloj: number
  pelea: number
  /** Veces que el motor llegó al tope y lo soltó. */
  sueltas: number
  /** El reloj del motor y la vara de acá no coincidieron (debería ser 0). */
  difMotor: number
}

/** Una partida guionada (el atacante del lado 0 sigue el guion; la víctima, su manera de escaparse). */
export function correrCaso(c: CasoEncierro, hueco = 2, meta: (id: IdPersonaje) => MetaAnimaciones = metaTipica, traza?: (linea: string) => void): MedidaEncierro {
  const p = crearPartida({ personajes: [c.atacante, c.victima], cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(c.atacante), meta(c.victima)], semilla: c.semilla })
  while (p.fase !== 'pelea') avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
  p.eventos.length = 0
  p.luchadores[0].x = 400
  p.luchadores[1].x = c.x1
  p.luchadores[0].carga = 10
  if (c.arranque === 'rota') p.luchadores[1].guardia = 5
  const I = internoDe(p)
  const vara = new VaraPractica(hueco)
  const vm = new VaraMotor()
  let empezo = false
  let rota = c.arranque === 'neutro'
  let k = 0
  let kT = 0
  let motor = 0
  let sueltas = 0
  let difMotor = 0
  let libres = 0
  for (let t = 0; t < 1500 && p.fase === 'pelea'; t++) {
    const a: EntradaJugador = { ...ENTRADA_VACIA }
    const v: EntradaJugador = { ...ENTRADA_VACIA }
    const dir = p.luchadores[1].x >= p.luchadores[0].x ? 1 : -1
    const hacia = dir > 0 ? 'derecha' : 'izquierda'
    const lejos = dir > 0 ? 'izquierda' : 'derecha'
    if (!rota) {
      a.herramienta = t % 2 === 0
      v.guardia = true
    } else {
      const paso = c.guion[k]
      if (paso) {
        const [b, d] = paso
        const pulso = kT % 2 === 0
        switch (b) {
          case 'acercar':
            if (Math.abs(p.luchadores[1].x - p.luchadores[0].x) > d) {
              a[hacia] = true
              kT = -1
            }
            break
          case 'adelante':
            a[hacia] = true
            break
          case 'atras':
            a[lejos] = true
            break
          case 'dash':
            a[hacia] = true
            a.dash = kT === 0
            break
          case 'saltar':
            a.arriba = kT < 2
            a[hacia] = true
            a.golpe = kT > 6 && pulso
            break
          case 'agachadoGolpe':
            a.abajo = true
            a.golpe = pulso
            break
          case 'nada':
            break
          default:
            a[b] = pulso
        }
        if (b === 'acercar') {
          if (kT === -1) kT = 0
          else {
            k++
            kT = 0
          }
        } else if (++kT >= d) {
          k++
          kT = 0
        }
      }
      // La víctima: quieta hasta el primer golpe (arranque neutro); después quiere escaparse.
      if (empezo || c.arranque === 'rota') {
        const huir = dir > 0 ? 'derecha' : 'izquierda'
        if (c.politica === 'salta') {
          v.arriba = true
          v[huir] = true
        } else if (c.politica === 'esquiva') {
          v[huir] = true
          v.dash = t % 2 === 0
        } else if (c.politica === 'guardia') v.guardia = true
        else v.golpe = t % 2 === 0
      }
    }
    const congelado = p.fase === 'pelea' && p.congelamientoGolpe > 0
    const antes = I.luchadores[1].sinControl
    avanzar(p, [a, v])
    const evs = p.eventos.splice(0)
    if (!rota && evs.some((e) => e.tipo === 'guardia_rota' && e.quien === 1)) rota = true
    const l = p.luchadores[1]
    const li = I.luchadores[1]
    if (antes < TOPE_ENCIERRO.tope && li.sinControl >= TOPE_ENCIERRO.tope) sueltas++
    vm.paso(p, l, li, congelado)
    if (vm.comparable && vm.c !== li.sinControl) difMotor++
    if (!rota) continue
    const enc = vara.paso(p, l, li, congelado)
    if (enc) empezo = true
    libres = enc ? 0 : libres + 1
    motor = Math.max(motor, li.sinControl)
    if (traza) {
      const A = p.luchadores[0]
      traza(
        `${t}\tcong=${p.congelamientoGolpe}\tA:${A.estado}/${A.movimiento ?? '-'} x=${A.x.toFixed(0)} carga=${A.carga.toFixed(1)}\tV:${l.estado}/${l.movimiento ?? '-'} x=${l.x.toFixed(0)} vida=${l.vida.toFixed(0)} sinControl=${li.sinControl} conControl=${li.conControl} respiro=${li.respiroInmune}\tpráctico=${vara.reloj}\tev=${evs.map((e) => e.tipo).join(',')}`,
      )
    }
    if (k >= c.guion.length && libres > 40) break
  }
  return { motor, reloj: vara.maxReloj, pelea: vara.maxPelea, sueltas, difMotor }
}

// ─── Búsqueda (guiones al azar y mutaciones) ─────────────────────────────────

export function rngGuion(semilla: number): () => number {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function guionAzar(r: () => number, largo = 360): PasoGuion[] {
  const g: PasoGuion[] = []
  for (let total = 0; total < largo; ) {
    const b = ACCIONES[Math.floor(r() * ACCIONES.length)]
    const d = b === 'acercar' ? 70 + Math.floor(r() * 90) : 1 + Math.floor(r() * (b === 'nada' ? 50 : b === 'dash' ? 20 : 24))
    g.push([b, d])
    total += b === 'acercar' ? 10 : d
  }
  return g
}

function mutar(g: PasoGuion[], r: () => number): PasoGuion[] {
  const h = g.map((x) => [...x] as PasoGuion)
  const n = 1 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const j = Math.floor(r() * h.length)
    const op = r()
    if (op < 0.35 && h[j]) h[j][1] = Math.max(1, h[j][1] + Math.floor(r() * 13) - 6)
    else if (op < 0.6 && h[j]) h[j][0] = ACCIONES[Math.floor(r() * ACCIONES.length)]
    else if (op < 0.8) h.splice(j, 0, [ACCIONES[Math.floor(r() * ACCIONES.length)], 1 + Math.floor(r() * 24)])
    else if (h.length > 2) h.splice(j, 1)
  }
  return h
}

export interface ResultadoBusqueda {
  atacante: IdPersonaje
  sims: number
  /** El peor caso por manera de escaparse (práctico en pantalla). */
  peores: Record<string, { m: MedidaEncierro; c: CasoEncierro }>
  sueltas: number
  difMotor: number
}

/** Guiones al azar contra las 13 víctimas y las 4 maneras de escaparse, y mutaciones de los peores. */
export function buscar(atacante: IdPersonaje, azar: number, mut: number, semilla: number, hueco = 2): ResultadoBusqueda {
  const r = rngGuion(semilla)
  const todos: { m: MedidaEncierro; c: CasoEncierro }[] = []
  let sims = 0
  let sueltas = 0
  let difMotor = 0
  const medir = (c: CasoEncierro) => {
    const m = correrCaso(c, hueco)
    sims++
    sueltas += m.sueltas
    difMotor += m.difMotor
    return m
  }
  for (const victima of IDS_PERSONAJES) {
    for (const politica of POLITICAS) {
      for (const arranque of ['rota', 'neutro'] as const) {
        for (let i = 0; i < azar; i++) {
          const c: CasoEncierro = {
            atacante,
            victima,
            politica,
            arranque,
            x1: arranque === 'rota' ? 480 + Math.floor(r() * 30) : 470 + Math.floor(r() * 260),
            semilla: 1 + Math.floor(r() * 1e9),
            guion: guionAzar(r),
          }
          todos.push({ m: medir(c), c })
        }
      }
    }
  }
  // Búsqueda local sobre los 10 peores (práctico en pantalla).
  const semillas = [...todos].sort((x, y) => y.m.reloj - x.m.reloj || y.m.motor - x.m.motor).slice(0, 10)
  const finales: { m: MedidaEncierro; c: CasoEncierro }[] = []
  for (const s of semillas) {
    let actual = s
    for (let i = 0; i < mut; i++) {
      const c: CasoEncierro = { ...actual.c, guion: mutar(actual.c.guion, r) }
      const m = medir(c)
      if (m.reloj > actual.m.reloj || (r() < 0.05 && m.reloj >= actual.m.reloj - 3)) actual = { m, c }
      finales.push({ m, c })
    }
  }
  const peores: Record<string, { m: MedidaEncierro; c: CasoEncierro }> = {}
  for (const x of [...todos, ...finales]) {
    const q = peores[x.c.politica]
    if (!q || x.m.reloj > q.m.reloj) peores[x.c.politica] = x
  }
  return { atacante, sims, peores, sueltas, difMotor }
}

/** La búsqueda de los 13 atacantes repartida en hilos. */
export async function buscarEnHilos(azar: number, mut: number, semilla: number, hueco: number, hilos: number): Promise<ResultadoBusqueda[]> {
  const n = Math.max(1, Math.min(hilos, availableParallelism()))
  const lotes: IdPersonaje[][] = Array.from({ length: n }, () => [])
  IDS_PERSONAJES.forEach((id, i) => lotes[i % n].push(id))
  const cargador = new URL('./cargador.mjs', import.meta.url).pathname
  const partes = await Promise.all(
    lotes
      .filter((l) => l.length)
      .map(
        (atacantes) =>
          new Promise<ResultadoBusqueda[]>((ok, mal) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { tarea: 'buscar', atacantes, azar, mut, semilla, hueco }, execArgv: ['--import', cargador] })
            w.once('message', (m) => ok(m as ResultadoBusqueda[]))
            w.once('error', mal)
          }),
      ),
  )
  return partes.flat().sort((a, b) => IDS_PERSONAJES.indexOf(a.atacante) - IDS_PERSONAJES.indexOf(b.atacante))
}

// ─── El agarre de Brian desde un arranque natural (confirmación de la verificación) ─────────────

export interface MedidaAgarre {
  agarres: number
  /** Racha práctica (huecos ≤ 2 en pantalla, como la confirmación) y el reloj del motor. */
  practica: number
  motor: number
}

/**
 * Brian y la víctima quietos hasta que Brian junta 10 de carga; Brian camina, agarra (la víctima
 * se cubre: el agarre es imbloqueable) y, W ticks después del derribo, vuelve a apretar el agarre.
 * La víctima: cubriéndose, machacando GOLPE, con arriba sostenido mientras está tirada o machacando
 * la esquiva mientras está tirada. Hasta el 31/oct, con W = 90–96, el segundo agarre la tomaba con
 * 1 o 2 ticks libres: 396 ticks de pantalla (6,6 s) sin control.
 */
export function agarreNatural(victima: IdPersonaje, W: number, pol: 'guardia' | 'golpe' | 'salta' | 'esquiva', meta: (id: IdPersonaje) => MetaAnimaciones = metaReal): MedidaAgarre {
  const p = crearPartida({ personajes: ['brian', victima], cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 99, animaciones: [meta('brian'), meta(victima)], semilla: 12345 })
  const I = internoDe(p)
  let fase: 'juntar' | 'acercar' | 'agarrar1' | 'esperar' | 'agarrar2' | 'fin' = 'juntar'
  let tDerribo = -1
  let agarres = 0
  let prevB: Partial<EntradaJugador> = {}
  let tLibre = 99
  // La vara de la confirmación: huecos de ≤ 2 ticks de PANTALLA (más estricta que la de los guiones).
  let pcur = 0
  let pra = 0
  let hueco = 99
  let motor = 0
  for (let n = 0; n < 99 * 60 * 2 && p.fase !== 'terminada'; n++) {
    const b = p.luchadores[0]
    const v = p.luchadores[1]
    const bi = I.luchadores[0]
    const vi = I.luchadores[1]
    const eb: EntradaJugador = { ...ENTRADA_VACIA }
    const ev: EntradaJugador = { ...ENTRADA_VACIA }
    const d = Math.abs(v.x - b.x)
    if (p.fase === 'pelea') {
      if (fase === 'juntar') {
        if (b.carga >= 10 - 1e-9) fase = 'acercar'
      } else if (fase === 'acercar') {
        if (d > 95) eb.derecha = true
        else fase = 'agarrar1'
      }
      if (fase === 'agarrar1') {
        if (!prevB.especial1 && bi.accion === null) eb.especial1 = true
      } else if (fase === 'esperar') {
        const t = p.tick - tDerribo
        if (d > 100 && bi.accion === null) eb.derecha = true
        if (t >= W && bi.accion === null && b.carga >= 5 - 1e-9) {
          eb.especial1 = !prevB.especial1
          fase = 'agarrar2'
        }
      }
      const tirada = vi.derribo > 0 || vi.levantar > 0 || vi.caidaDerribo > 0 || vi.agarradoPor !== null
      tLibre = tirada ? 0 : tLibre + 1
      if (pol === 'guardia') ev.guardia = true
      else if (pol === 'golpe') ev.golpe = p.tick % 4 === 0
      else if (pol === 'salta') {
        if (tirada || tLibre < 8) ev.arriba = true
        else ev.guardia = true
      } else if (tirada) ev.dash = p.tick % 3 === 0
      else ev.guardia = true
    }
    avanzar(p, [eb, ev])
    prevB = eb
    for (const e of p.eventos.splice(0)) {
      if (e.tipo === 'agarre' && e.victima === 1) agarres++
      if (e.tipo === 'derribo' && e.quien === 1 && (fase === 'agarrar1' || fase === 'agarrar2')) {
        tDerribo = p.tick
        fase = fase === 'agarrar1' ? 'esperar' : 'fin'
      }
    }
    if (p.fase === 'pelea') {
      const enc = sinControlVara(v, vi) && !soloBloqueo(v, vi)
      if (enc) {
        pcur = hueco <= 2 && pcur > 0 ? pcur + hueco + 1 : 1
        hueco = 0
        pra = Math.max(pra, pcur)
      } else {
        hueco++
        if (hueco > 2) pcur = 0
      }
      motor = Math.max(motor, vi.sinControl)
    }
    // Sin un segundo derribo (el segundo agarre no entró o no lo tiró), igual se corta a los 400 ticks.
    if ((fase === 'fin' && p.tick - tDerribo > 200) || (fase === 'agarrar2' && p.tick - tDerribo > W + 400)) break
  }
  return { agarres, practica: pra, motor }
}

// ─── Hilo de trabajo y uso suelto ────────────────────────────────────────────

if (!isMainThread && (workerData as { tarea?: string })?.tarea === 'buscar') {
  const { atacantes, azar, mut, semilla, hueco } = workerData as { atacantes: IdPersonaje[]; azar: number; mut: number; semilla: number; hueco: number }
  parentPort?.postMessage(atacantes.map((a) => buscar(a, azar, mut, semilla + a.length * 7919, hueco)))
}

async function principal(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
  const azar = Number(arg('azar') ?? 30)
  const mut = Number(arg('mut') ?? 300)
  const hueco = Number(arg('hueco') ?? 2)
  const semilla = Number(arg('semilla') ?? 7717)
  const hilos = Number(arg('hilos') ?? 8)
  const t0 = performance.now()
  const res = await buscarEnHilos(azar, mut, semilla, hueco, hilos)
  const seg = (performance.now() - t0) / 1000
  const sims = res.reduce((s, x) => s + x.sims, 0)
  console.log(`# Encierros forzados: ${sims} simulaciones en ${seg.toFixed(0)} s (azar ${azar}, ${mut} mutaciones × 10; huecos ≤ ${hueco}; tope ${TOPE_ENCIERRO.tope} ticks de pantalla)`)
  console.log('')
  console.log(`| atacante | ${POLITICAS.join(' | ')} |`)
  console.log(`|---|${POLITICAS.map(() => '---:').join('|')}|`)
  let peor = 0
  let peorPelea = 0
  for (const x of res) {
    console.log(`| ${x.atacante} | ${POLITICAS.map((q) => (x.peores[q] ? `${x.peores[q].m.reloj} (pelea ${x.peores[q].m.pelea})` : '–')).join(' | ')} |`)
    for (const q of POLITICAS) {
      peor = Math.max(peor, x.peores[q]?.m.reloj ?? 0)
      peorPelea = Math.max(peorPelea, x.peores[q]?.m.pelea ?? 0)
    }
  }
  const sueltas = res.reduce((s, x) => s + x.sueltas, 0)
  const dif = res.reduce((s, x) => s + x.difMotor, 0)
  console.log('')
  console.log(`Máximo práctico: ${peor} ticks de pantalla (${(peor / 60).toFixed(2)} s), ${peorPelea} de pelea; el motor soltó en el tope ${sueltas} veces; reloj del motor distinto de la vara: ${dif} ticks.`)
  const ruta = arg('json')
  if (ruta) {
    const casos = res.flatMap((x) => POLITICAS.filter((q) => x.peores[q]).map((q) => ({ ...x.peores[q].c, antes: x.peores[q].m.reloj })))
    writeFileSync(ruta, JSON.stringify(casos))
  }
  if (peor > TOPE_ENCIERRO.tope || dif > 0) process.exitCode = 1
}

if (isMainThread && process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  principal().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
