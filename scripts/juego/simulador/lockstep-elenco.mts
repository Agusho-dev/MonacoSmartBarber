/**
 * Banco de pruebas del lockstep online con el elenco de 13: dos clientes con el motor REAL, el
 * loop.ts REAL (con requestAnimationFrame simulado), el lockstep y una red simulada (latencia,
 * jitter, pérdida, entrega en orden como WebSocket). Compara el hash de CADA tick de los dos lados.
 * Los cruces son de barberos nuevos (agarre, nube, onda, chorros, cura, bumerán) y el bot aprieta
 * especiales seguido. Versión tipada del banco de la sala online (30/oct), revisión del motor.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs lockstep-elenco.mts [latencia] [jitter] [perdida] [partidas]
 */
import { existsSync, readFileSync } from 'node:fs'
import type { AtlasPersonaje, ConfigPartida, EntradaJugador, IdPersonaje, Lado, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { crearLoop } from '../../../src/lib/juego/ui/loop.ts'
import type { LoteEntradas } from '../../../src/lib/juego/online/lockstep.ts'
import { CADA_HASH, Lockstep, demoraParaRtt } from '../../../src/lib/juego/online/lockstep.ts'
import { hashPartida } from '../../../src/lib/juego/online/hash.ts'
import { leerMensajePelea } from '../../../src/lib/juego/online/protocolo.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'

const REPO = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const [latArg, jitArg, perArg, semArg] = process.argv.slice(2)
const LAT = Number(latArg ?? 190)
const JIT = Number(jitArg ?? 30)
const PERDIDA = Number(perArg ?? 0.01)
const PARTIDAS = Number(semArg ?? 8)

const META = {} as Record<IdPersonaje, MetaAnimaciones>
for (const id of IDS_PERSONAJES) {
  const ruta = `${REPO}/public/juego/personajes/${id}/atlas.json`
  if (!existsSync(ruta)) throw new Error('sin atlas ' + id)
  META[id] = metaDesdeAtlas(JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje)
}
const CRUCES: [IdPersonaje, IdPersonaje][] = [
  ['brian', 'lucas'],
  ['guillermo', 'rodrigo'],
  ['fabri', 'stefano'],
  ['joaquin', 'nahuel'],
  ['gabriel', 'luciano'],
  ['nico_u', 'brian'],
  ['lucas', 'guillermo'],
  ['rodrigo', 'joaquin'],
]

/** mulberry32 para el bot y la red (fuera del motor). */
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

// ─── Reloj y requestAnimationFrame simulados ─────────────────────────────────
let ahora = 0
interface Tarea {
  t: number
  fn: () => void
  orden: number
}
const cola: Tarea[] = []
let orden = 0
function programar(t: number, fn: () => void) {
  cola.push({ t, fn, orden: orden++ })
}

interface Cliente {
  nombre: string
  lado: Lado
  periodo: number
  fase: number
  rnd: () => number
  rafId: number
  rafCancelado: Set<number>
  p: Partida
  lock: Lockstep | null
  hashes: number[]
  terminadaEn: number | null
  ganador: Lado | null
  enviados: number[]
  bot: () => EntradaJugador
  otro: Cliente | null
  ultimaEntrega: number
}
let clienteActual: Cliente | null = null
const global = globalThis as unknown as {
  requestAnimationFrame: (cb: (t: number) => void) => number
  cancelAnimationFrame: (id: number) => void
}
global.requestAnimationFrame = (cb) => {
  const c = clienteActual as Cliente
  const id = ++c.rafId
  const proximo = Math.floor(ahora / c.periodo + 1) * c.periodo + c.fase + (c.rnd() < 0.01 ? 40 : 0)
  programar(proximo, () => {
    if (c.rafCancelado.has(id)) return
    clienteActual = c
    cb(ahora)
    clienteActual = null
  })
  return id
}
global.cancelAnimationFrame = (id) => {
  clienteActual?.rafCancelado.add(id)
}

function crearBot(semilla: number): () => EntradaJugador {
  const r = rng(semilla)
  const e: EntradaJugador = { ...ENTRADA_VACIA }
  let cambio = 0
  return () => {
    if (--cambio <= 0) {
      cambio = 4 + Math.floor(r() * 16)
      const dir = r()
      e.izquierda = dir < 0.3
      e.derecha = dir > 0.65
      e.arriba = r() < 0.08
      e.abajo = r() < 0.08
      e.golpe = r() < 0.35
      e.herramienta = r() < 0.12
      e.guardia = r() < 0.12
      e.especial1 = r() < 0.12
      e.especial2 = r() < 0.1
      e.dash = r() < 0.03
    }
    return { ...e }
  }
}

function correr(semilla: number): boolean {
  ahora = 0
  cola.length = 0
  const personajes = CRUCES[(semilla - 1) % CRUCES.length]
  const config: ConfigPartida = {
    personajes,
    cpu: [false, false],
    dificultad: 'normal',
    arena: 'rondeau',
    rondasParaGanar: 2,
    segundosPorRound: 60,
    animaciones: [META[personajes[0]], META[personajes[1]]],
    semilla: 1000 + semilla * 7919,
  }
  const D = demoraParaRtt(2 * LAT)
  const red = rng(semilla * 31 + 7)
  const clientes: Cliente[] = (['A', 'B'] as const).map((nombre, i) => ({
    nombre,
    lado: i as Lado,
    periodo: 1000 / 60,
    fase: i === 0 ? 0 : 5.3,
    rnd: rng(semilla * 13 + i),
    rafId: 0,
    rafCancelado: new Set<number>(),
    p: crearPartida(config),
    lock: null,
    hashes: [],
    terminadaEn: null,
    ganador: null,
    enviados: [],
    bot: crearBot(semilla * 101 + i),
    otro: null,
    ultimaEntrega: 0,
  }))
  clientes[0].otro = clientes[1]
  clientes[1].otro = clientes[0]
  for (const c of clientes) {
    const enviar = (m: unknown) => {
      c.enviados.push(ahora)
      if (red() < PERDIDA) return true
      const json: unknown = JSON.parse(JSON.stringify(m))
      const llegada = Math.max(c.ultimaEntrega, ahora + LAT + red() * JIT)
      c.ultimaEntrega = llegada
      programar(llegada, () => {
        const msg = leerMensajePelea(json)
        if (!msg) throw new Error('mensaje inválido ' + JSON.stringify(json))
        const lockOtro = c.otro?.lock
        if (!lockOtro) return
        if (msg.t === 'e') lockOtro.recibirLote({ n: msg.n, b: msg.b, c: msg.c, h: msg.h })
        if (msg.t === 'pide') lockOtro.responderPedido(msg.desde)
      })
      return true
    }
    c.lock = new Lockstep({
      lado: c.lado,
      demora: D,
      tomarPropia: c.bot,
      enviarLote: (l: LoteEntradas) => enviar({ t: 'e', de: 'jugador-' + c.nombre + '-0000', k: 1, n: l.n, b: l.b, c: l.c, h: l.h }),
      pedir: (desde: number) => {
        enviar({ t: 'pide', de: 'jugador-' + c.nombre + '-0000', k: 1, desde })
      },
      ahora: () => ahora,
    })
  }
  const loops = clientes.map((c) =>
    crearLoop({
      partida: c.p,
      renderizador: { dibujar() {}, redimensionar() {}, destruir() {} },
      avanzar,
      tomarEntrada: () => {
        throw new Error('no se usa')
      },
      tomarEntradas: () => {
        if (c.p.fase === 'terminada' || !c.lock) return null
        const n = c.p.tick + 1
        c.lock.preparar(n)
        return c.lock.entradas(n)
      },
      ritmo: () => c.lock?.ritmo() ?? 1,
      alPaso: (p) => {
        const h = hashPartida(p)
        c.hashes[p.tick] = h
        if (p.tick % CADA_HASH === 0) c.lock?.registrarHash(p.tick, h)
        if (p.fase === 'terminada' && c.terminadaEn === null) {
          c.terminadaEn = ahora
          c.ganador = p.ganadorPartida
          c.lock?.cerrar()
        }
      },
      alError: (e) => {
        throw e
      },
    }),
  )
  // B arranca medio rtt después (le llega el «inicio»).
  clienteActual = clientes[0]
  loops[0].iniciar()
  clienteActual = null
  programar(LAT + red() * JIT, () => {
    clienteActual = clientes[1]
    loops[1].iniciar()
    clienteActual = null
  })
  const LIMITE = 8 * 60 * 1000
  while (cola.length && ahora < LIMITE) {
    cola.sort((x, y) => x.t - y.t || x.orden - y.orden)
    const t = cola.shift() as Tarea
    ahora = Math.max(ahora, t.t)
    t.fn()
    if (clientes.every((c) => c.terminadaEn !== null)) break
  }
  loops.forEach((l) => l.detener())
  const [a, b] = clientes
  const hasta = Math.min(a.hashes.length, b.hashes.length) - 1
  let distintos = 0
  let primero = -1
  for (let t = 1; t <= hasta; t++) {
    if (a.hashes[t] !== b.hashes[t]) {
      distintos++
      if (primero < 0) primero = t
    }
  }
  const la = a.lock as Lockstep
  const lb = b.lock as Lockstep
  console.log(
    `${personajes.join('-')}  D=${D}  ticks ${a.p.tick}/${b.p.tick}  comparados ${hasta}  distintos ${distintos}${primero >= 0 ? ' (primero ' + primero + ')' : ''}` +
      `  ganador ${a.ganador}/${b.ganador}  especiales ${a.p.estadisticas[0].especialesUsados + a.p.estadisticas[1].especialesUsados}  hashes ${la.comparados}/${lb.comparados}  desync ${la.desincronizadoEn}/${lb.desincronizadoEn}`,
  )
  return distintos === 0 && a.ganador !== null && a.ganador === b.ganador && la.desincronizadoEn === null && lb.desincronizadoEn === null
}

console.log(`red: latencia ${LAT} ms, jitter ${JIT} ms, pérdida ${(PERDIDA * 100).toFixed(1)} %`)
let ok = true
for (let s = 1; s <= PARTIDAS; s++) ok = correr(s) && ok
console.log(ok ? 'OK: todos los ticks iguales y mismo ganador' : 'FALLÓ')
process.exit(ok ? 0 : 1)
