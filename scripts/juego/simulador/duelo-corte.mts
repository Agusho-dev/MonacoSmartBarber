/**
 * Cortes de red en plena pelea online, con el código REAL: dos Duelo con su Lockstep, el
 * transporte de verdad (transporte.ts, con su sondeo por el latido) sobre el realtime-js instalado
 * y la red de mentira de duelo-red.mts (reloj virtual: cada escenario corre en segundos y da
 * siempre igual). Lo que verificó prod-online el 30/oct/2026: si la red de un celular se TRABA
 * (el 4G que se estanca sin cerrar el socket), el canal sigue «unido» y los dos reclamaban el
 * abandono a los 10 s: la pelea quedaba anulada aunque sólo uno hubiera perdido la red, el trabado
 * veía «¡Ganaste por abandono!» y, si la traba duraba más que el latido, los dos se anotaban la
 * victoria. B es el que pierde la red salvo que el escenario diga otra cosa; A desafió (lado 0).
 *
 * Tercera tanda (31/oct): la derrota que un celular se da sin red (o con la página oculta) es
 * provisoria hasta que el rival la confirma; el adiós dice si el que se fue dejó la pelea por la
 * mitad («abandono-en-traba»: antes, con el rival trabado 10 s o más, los dos se anotaban una
 * derrota); con la red de los dos caída la pelea no cuenta aunque no vuelva («dos-sin-vuelta»,
 * «uno-sale-antes»); con el canal caído el transporte reconecta apenas hay red («vuelve-la-red»:
 * la anulada tardaba 12–22 s); el pie del resultado no culpa al rival si el sin red es éste
 * (traba-13, solo-B-cae); la página oculta dice «Te fuiste del juego» («oculta»); y si el latido de
 * realtime-js no es el conocido, el duelo decide como antes del sondeo («api-*»).
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs duelo-corte.mts [escenario,…]
 *
 * Escenarios: traba-13, traba-9, caida-13, dos-13, larga-40, larga-70, latido-corto, barrido,
 * caida-corta, motor-distinto, motor-rondas, motor-igual, abandono-en-traba, dos-trabados-uno-se-va,
 * dos-sin-vuelta, dos-trabados-sin-vuelta, uno-sale-antes, solo-B-cae, solo-B-cae-vuelve,
 * vuelve-la-red, oculta, api-sin-latido, api-latido-cambiado (y los textos, siempre). Sale con
 * código 1 si algo no da.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Reloj, Red, Verificador, VERSION_REALTIME, type ClienteDePrueba, type ModoRed } from './duelo-red.mts'
import { Duelo, type EstadoDuelo, type FinPeleaLocal, type ResultadoDuelo } from '../../../src/lib/juego/online/duelo.ts'
import { ABANDONO_MS, type Lockstep } from '../../../src/lib/juego/online/lockstep.ts'
import type { MotivoAdios } from '../../../src/lib/juego/online/protocolo.ts'
import { abrirTransportePelea } from '../../../src/lib/juego/online/transporte.ts'
import {
  bajadaResultado,
  cartelEspera,
  textoRivalAusente,
  textoSinRed,
  tituloResultado,
} from '../../../src/lib/juego/online/textos.ts'
import { ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import type { EstadisticasLuchador, IdArena } from '../../../src/lib/juego/tipos.ts'

const reloj = new Reloj()
reloj.instalar()
const v = new Verificador()
const NOMBRES = { A: 'Prueba A', B: 'Prueba B' } as const
type Quien = 'A' | 'B'
type ClienteRealtime = SupabaseClient['realtime']

/** Lo que ve y anota cada «celular». */
interface Celular {
  quien: Quien
  cliente: ClienteDePrueba
  duelo: Duelo
  lock: Lockstep | null
  lockK: number
  tick: number
  listo: boolean
  apagado: boolean
  /** La página oculta: sin cuadros (como el requestAnimationFrame de un navegador), el resto sigue. */
  oculto: boolean
  /** Ya llegó al final del motor (escenarios «motor»). */
  finMotor: boolean
  /** Cambios del cartel de la espera (lo que muestra hud-online), con la hora relativa a la pelea. */
  carteles: { t: number; texto: string | null; reconectando: boolean }[]
  /** Cambios del resultado (título y bajada como los dibuja resultado-online). */
  resultados: {
    t: number
    ganador: ResultadoDuelo['ganador']
    motivo: ResultadoDuelo['motivo']
    provisorio: boolean
    titulo: string
    bajada: string | null
  }[]
  /** Cambios del pie del resultado como lo dibuja resultado-online (null = el botón REVANCHA). */
  pies: { t: number; pie: string | null }[]
  /** Lo que se anotó en el récord (alResultado): ahora/antes. */
  anotado: { t: number; ahora: boolean | null; antes: boolean | null | undefined }[]
  /** Lo que el récord de este celular tiene de la pelea (el último `ahora`). */
  cuenta: boolean | null | undefined
  inicioPelea: number
}

const hashFalso = (n: number) => Math.imul(n, 0x9e3779b1) >>> 0

const ESTADISTICAS: EstadisticasLuchador = {
  danioHecho: 0,
  danioRecibido: 0,
  golpesAcertados: 0,
  golpesIntentados: 0,
  comboMax: 0,
  especialesUsados: 0,
  especialesAcertados: 0,
  criticos: 0,
} as unknown as EstadisticasLuchador

function fin(ganadorLado: 0 | 1 | null, rondas: [number, number]): FinPeleaLocal {
  return { ganadorLado, rondasPorLado: rondas, estadisticasPorLado: [ESTADISTICAS, ESTADISTICAS], duracionSeg: 20 }
}

/** El pie del resultado (lo que resultado-online pone en lugar de REVANCHA); null = REVANCHA. */
function pieDe(e: EstadoDuelo): string | null {
  const r = e.resultado
  if (!r) return null
  if (e.sinRed) return textoSinRed()
  return e.rivalPresente ? null : textoRivalAusente(r, e.rival.nombre, e.rivalSeFue)
}

interface OpcionesArmar {
  heartbeatIntervalMs?: number
  /** Toca el realtime-js de cada celular antes de abrir el transporte (escenarios «api-*»). */
  tocarRealtime?: (rt: ClienteRealtime) => void
  /**
   * Cada celular está además en el canal de la sala (como en el juego): al cerrar el canal de la
   * pelea el socket sigue abierto. Sin la sala, removeChannel corta el socket y, con la red
   * trabada, lo que estaba retenido (el adiós) se pierde.
   */
  conSala?: boolean
}

function armar(red: Red, op: OpcionesArmar = {}): { A: Celular; B: Celular; t0: number } {
  const peleaId = `pelea-prueba-${Math.floor(reloj.t)}`
  const ids = { A: 'jugador-a-00000001', B: 'jugador-b-00000002' }
  const t0 = reloj.t
  const opcionesRealtime = op.heartbeatIntervalMs ? { heartbeatIntervalMs: op.heartbeatIntervalMs } : {}
  const crear = (quien: Quien): Celular => {
    const otro: Quien = quien === 'A' ? 'B' : 'A'
    const cliente = red.crearCliente(quien, opcionesRealtime)
    op.tocarRealtime?.(cliente.realtime)
    if (op.conSala) cliente.channel('juego-sala:prueba', { config: { broadcast: { self: false, ack: false } } }).subscribe()
    let duelo: Duelo | null = null
    const transporte = abrirTransportePelea(cliente as unknown as SupabaseClient, peleaId, (crudo) => duelo?.recibir(crudo))
    const cel = {} as Celular
    duelo = new Duelo({
      peleaId,
      lado: quien === 'A' ? 0 : 1,
      yo: { id: ids[quien], nombre: NOMBRES[quien] },
      rival: { id: ids[otro], nombre: NOMBRES[otro] },
      arena: 'pueyrredon' as IdArena,
      personajeInicial: quien === 'A' ? 'chipi' : 'joaquin',
      version: 'prueba#2',
      transporte,
      ahora: () => reloj.t,
      semilla: () => 4242,
      alResultado: (ahora, antes) => {
        cel.anotado.push({ t: reloj.t - cel.inicioPelea, ahora, antes })
        cel.cuenta = ahora
      },
    })
    Object.assign(cel, {
      quien,
      cliente,
      duelo,
      lock: null,
      lockK: 0,
      tick: 0,
      listo: false,
      apagado: false,
      oculto: false,
      finMotor: false,
      carteles: [],
      resultados: [],
      pies: [],
      anotado: [],
      cuenta: undefined,
      inicioPelea: Infinity,
    })
    let ultimo = ''
    duelo.suscribir(() => {
      const e = duelo!.leer()
      const r = e.resultado
      if (!r || e.fase !== 'resultado') return
      const pie = pieDe(e)
      const ultPie = cel.pies[cel.pies.length - 1]
      if (!ultPie || ultPie.pie !== pie) cel.pies.push({ t: reloj.t - cel.inicioPelea, pie })
      const clave = `${r.k}:${r.ganador}:${r.motivo}:${r.provisorio}`
      if (clave === ultimo) return
      ultimo = clave
      cel.resultados.push({
        t: reloj.t - cel.inicioPelea,
        ganador: r.ganador,
        motivo: r.motivo,
        provisorio: r.provisorio,
        titulo: tituloResultado(r, e.rival.nombre),
        bajada: bajadaResultado(r, e.rival.nombre, e.rivalSeFue),
      })
    })
    return cel
  }
  const A = crear('A')
  const B = crear('B')
  for (const cel of [A, B]) {
    // La pantalla: un cuadro cada 16,7 ms, como pantalla-pelea.tsx (un tick por cuadro si están las dos entradas).
    setInterval(() => cuadro(cel), 1000 / 60)
  }
  return { A, B, t0 }
}

function cuadro(cel: Celular): void {
  if (cel.apagado || cel.oculto) return
  const d = cel.duelo
  const e = d.leer()
  if (e.fase === 'eligiendo' && !e.confirmada) d.confirmar()
  if (e.fase === 'preparando' && !cel.listo) {
    cel.listo = true
    setTimeout(() => d.marcarListo(), 300)
  }
  if (e.fase !== 'peleando') return
  if (!cel.lock || cel.lockK !== e.k) {
    cel.lock = d.crearLockstep(() => ENTRADA_VACIA)
    cel.lockK = e.k
    cel.tick = 0
    cel.inicioPelea = Math.min(cel.inicioPelea, reloj.t)
  }
  const lock = cel.lock
  if (!lock || cel.finMotor) return
  const n = cel.tick + 1
  lock.preparar(n)
  if (lock.entradas(n)) {
    cel.tick = n
    if (n % 60 === 0) lock.registrarHash(n, hashFalso(n))
  }
  // Lo de pantalla-pelea: el HUD pregunta si hay red en cada cuadro y, con la espera cumplida, el duelo decide.
  const c = cartelEspera(lock.msEsperando(), d.estaConectado())
  const ult = cel.carteles[cel.carteles.length - 1]
  const texto = c?.texto ?? null
  if (!ult || ult.texto !== texto || ult.reconectando !== (c?.reconectando ?? false)) {
    cel.carteles.push({ t: reloj.t - cel.inicioPelea, texto, reconectando: c?.reconectando ?? false })
  }
  if (lock.msEsperando() >= ABANDONO_MS) d.abandonoDelRival()
}

/** Termina la pelea en el motor de este celular (con el festejo de 1,5 s, como la pantalla). */
function terminarMotor(cel: Celular, f: FinPeleaLocal): void {
  cel.finMotor = true
  cel.lock?.cerrar()
  cel.duelo.finDelMotor(f)
  setTimeout(() => cel.duelo.terminarPelea(f), 1500)
}

/** La página de este celular se oculta `ms` (sin cuadros) y vuelve: lo de pantalla-pelea.tsx al volver. */
function ocultar(cel: Celular, ms: number): void {
  cel.oculto = true
  const desde = reloj.t
  setTimeout(() => {
    cel.oculto = false
    if (reloj.t - desde >= ABANDONO_MS) cel.duelo.rendirsePorAusencia()
  }, ms)
}

/** Se va del duelo como lo hace juego-raiz: salir() y, al quedar cerrado, destruir(). */
function salirDe(cel: Celular, motivo: MotivoAdios): void {
  cel.duelo.salir(motivo)
  cel.duelo.destruir()
  cel.apagado = true
}

async function arrancar(red: Red, op: OpcionesArmar = {}) {
  const par = armar(red, op)
  const ok = await reloj.correrMientras(() => par.A.tick >= 120 && par.B.tick >= 120, reloj.t + 20_000)
  if (!ok) throw new Error(`la pelea no arrancó (fases ${par.A.duelo.leer().fase}/${par.B.duelo.leer().fase})`)
  // Desde acá cuentan los tiempos del escenario (≈ 2 s de pelea).
  return { ...par, inicio: reloj.t }
}

function cerrarTodo(...cels: Celular[]): void {
  for (const c of cels) {
    c.apagado = true
    try {
      c.duelo.destruir()
    } catch {}
    try {
      c.cliente.realtime.disconnect()
    } catch {}
  }
  reloj.limpiar()
}

const final = (c: Celular) => c.resultados[c.resultados.length - 1] ?? null
const resumen = (c: Celular) => {
  const e = c.duelo.leer()
  const r = final(c)
  return r
    ? `${e.fase} · «${r.titulo}» / «${r.bajada ?? ''}»${r.provisorio ? ' (provisoria)' : ''} · ganador ${r.ganador} (${r.motivo}) · marcador ${e.marcador.join('-')} · récord ${JSON.stringify(c.anotado.map((x) => x.ahora))}`
    : `${e.fase} · sin resultado · tick ${c.tick}`
}
const conDigito = (t: string | null) => t !== null && /\d/.test(t)
const textosCartel = (c: Celular) => c.carteles.map((x) => `${(x.t / 1000).toFixed(2)}s ${x.texto ?? '—'}${x.reconectando ? ' / Reconectando…' : ''}`).join(' → ')
const textosPie = (c: Celular) => c.pies.map((x) => `${(x.t / 1000).toFixed(2)}s ${x.pie ?? 'REVANCHA'}`).join(' → ')
const recordDe = (c: Celular) => JSON.stringify(c.anotado.map((x) => x.ahora))
/** ¿Hubo algún momento en que los DOS tenían anotada la victoria de esta pelea? */
function dosVictorias(A: Celular, B: Celular): boolean {
  const eventos = [...A.anotado.map((x) => ({ ...x, q: 'A' as const })), ...B.anotado.map((x) => ({ ...x, q: 'B' as const }))].sort((a, b) => a.t - b.t)
  let a: boolean | null | undefined
  let b: boolean | null | undefined
  for (const ev of eventos) {
    if (ev.q === 'A') a = ev.ahora
    else b = ev.ahora
    if (a === true && b === true) return true
  }
  return false
}
/** El pie culpó al rival («Sin revancha: X ya no está») en algún momento. */
const culpoAlRival = (c: Celular) => c.pies.some((p) => p.pie !== null && p.pie.startsWith('Sin revancha: '))

/** Programa los cambios de red de un escenario (ms desde `inicio`). */
function programarRed(eventos: { en: number; cel: Quien; modo: ModoRed }[], inicio: number, rojo: Red): void {
  for (const ev of eventos) setTimeout(() => rojo.ponerModo(ev.cel, ev.modo), Math.max(0, inicio + ev.en - reloj.t))
}

/** Lo mismo para los dos celulares. */
function redDeLosDos(desde: number, hasta: number | null, modo: ModoRed): { en: number; cel: Quien; modo: ModoRed }[] {
  const ev: { en: number; cel: Quien; modo: ModoRed }[] = [
    { en: desde, cel: 'A', modo },
    { en: desde, cel: 'B', modo },
  ]
  if (hasta !== null) ev.push({ en: hasta, cel: 'A', modo: 'normal' }, { en: hasta, cel: 'B', modo: 'normal' })
  return ev
}

/** Cuenta los console.warn mientras corre `fn` (el aviso del transporte con otra versión de realtime-js). */
async function contandoAvisos(fn: () => Promise<void>): Promise<string[]> {
  const avisos: string[] = []
  const original = console.warn
  console.warn = (...a: unknown[]) => {
    avisos.push(a.map(String).join(' '))
  }
  try {
    await fn()
  } finally {
    console.warn = original
  }
  return avisos
}

// ─── Escenarios ──────────────────────────────────────────────────────────────

const ESCENARIOS: Record<string, () => Promise<void>> = {
  async 'traba-13'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 14_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    // Mientras dura la traba: ¿qué ve B?
    await reloj.correrHasta(inicio + 13_500)
    const bTrabado = final(B)
    const piesTrabado = B.pies.slice()
    await reloj.correrHasta(inicio + 30_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   cartel A: ${textosCartel(A)}\n   cartel B: ${textosCartel(B)}`)
    console.log(`   pie A: ${textosPie(A)}\n   pie B: ${textosPie(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === 'yo' && rA.motivo === 'abandono_rival', `traba 13 s: gana A, que tenía red («${rA?.titulo}» / «${rA?.bajada}»)`)
    v.verificar(rB?.ganador === 'rival' && rB.motivo === 'abandone', `traba 13 s: pierde B, el trabado («${rB?.titulo}» / «${rB?.bajada}»)`)
    v.verificar(
      rA?.bajada === 'Prueba B se quedó sin conexión' && rB?.bajada === 'Te desconectaste en el medio de la pelea',
      'traba 13 s: las bajadas dicen lo que pasó (la de B, ya confirmada por A)',
    )
    v.verificar(!B.resultados.some((r) => r.ganador === 'yo'), 'traba 13 s: B nunca vio «¡Ganaste por abandono!»')
    v.verificar(
      bTrabado?.ganador === 'rival' && bTrabado.provisorio && bTrabado.bajada === 'Te desconectaste. Si a Prueba A también se le cortó, no cuenta',
      `traba 13 s: B, todavía trabado, ya sabe que perdió y que es provisorio (${bTrabado ? `«${bTrabado.titulo}» / «${bTrabado.bajada}» a los ${(bTrabado.t / 1000).toFixed(1)} s` : 'sin resultado'})`,
    )
    v.verificar(B.carteles.some((c) => c.texto === 'Sin conexión' && c.reconectando) && !B.carteles.some((c) => conDigito(c.texto)), 'traba 13 s: B ve «Sin conexión / Reconectando…» y nunca una cuenta hacia una victoria')
    v.verificar(A.carteles.some((c) => conDigito(c.texto)) && !A.carteles.some((c) => c.texto === 'Sin conexión'), 'traba 13 s: A ve la cuenta («Conexión lenta… N») y nunca «Sin conexión»')
    v.verificar(
      piesTrabado.length > 0 && piesTrabado.every((p) => p.pie === textoSinRed()),
      `traba 13 s: sin red, el pie de B dice «${textoSinRed()}» desde el primer cuadro del resultado (sin REVANCHA ni «Sin revancha: Prueba A ya no está»): ${piesTrabado.map((p) => p.pie ?? 'REVANCHA').join(' → ')}`,
    )
    v.verificar(!culpoAlRival(B) && B.pies[B.pies.length - 1]?.pie === null, `traba 13 s: con la red de vuelta B tiene REVANCHA otra vez (pie: ${textosPie(B)})`)
    v.verificar(
      recordDe(A) === '[true]' && B.cuenta === false && !B.anotado.some((x) => x.ahora === true) && B.anotado[0]?.ahora === null,
      `traba 13 s: el récord de A suma una victoria; el de B, una derrota recién cuando A la confirma (A ${recordDe(A)}, B ${recordDe(B)})`,
    )
    v.verificar(A.duelo.leer().marcador.join() === '1,0' && B.duelo.leer().marcador.join() === '0,1', 'traba 13 s: marcador de hoy 1-0 / 0-1')
    cerrarTodo(A, B)
  },

  async 'traba-9'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 10_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    await reloj.correrHasta(inicio + 10_000)
    const tickA = A.tick
    await reloj.correrHasta(inicio + 25_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   cartel A: ${textosCartel(A)}\n   cartel B: ${textosCartel(B)}`)
    v.verificar(A.duelo.leer().fase === 'peleando' && B.duelo.leer().fase === 'peleando' && !A.resultados.length && !B.resultados.length, 'traba 9 s: sin resultado, la pelea sigue')
    v.verificar(A.tick > tickA + 600 && Math.abs(A.tick - B.tick) < 60, `traba 9 s: el lockstep siguió (A ${tickA} → ${A.tick}, B ${B.tick})`)
    v.verificar(A.anotado.length === 0 && B.anotado.length === 0, 'traba 9 s: nada anotado en el récord')
    v.verificar(B.carteles.some((c) => c.texto === 'Sin conexión') && A.carteles[A.carteles.length - 1]?.texto === null && B.carteles[B.carteles.length - 1]?.texto === null, 'traba 9 s: B vio «Sin conexión» durante la traba y al final no hay cartel')
    cerrarTodo(A, B)
  },

  async 'caida-13'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'caido' }, { en: 14_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    await reloj.correrHasta(inicio + 40_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   cartel B: ${textosCartel(B)}\n   pie B: ${textosPie(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === 'yo' && rA.motivo === 'abandono_rival', `caída real 13 s: gana A («${rA?.bajada}»)`)
    v.verificar(rB?.ganador === 'rival' && rB.motivo === 'abandone' && !rB.provisorio, `caída real 13 s: pierde B y, con la red de vuelta, A se lo confirma («${rB?.bajada}»)`)
    v.verificar(B.carteles.some((c) => c.texto === 'Sin conexión' && c.reconectando) && !B.carteles.some((c) => conDigito(c.texto)), 'caída real 13 s: B ve «Sin conexión / Reconectando…»')
    v.verificar(!dosVictorias(A, B) && A.cuenta === true && B.cuenta === false, `caída real 13 s: nunca los dos con la victoria (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(!culpoAlRival(B), `caída real 13 s: el pie de B no culpa a A (${textosPie(B)})`)
    cerrarTodo(A, B)
  },

  async 'dos-13'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed(redDeLosDos(1000, 14_000, 'trabado'), inicio, rojo)
    await reloj.correrHasta(inicio + 30_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === null && rA.motivo === 'corte' && rB?.ganador === null && rB.motivo === 'corte', `los dos trabados 13 s: anulada para los dos («${rA?.titulo}» / «${rA?.bajada}»)`)
    v.verificar(!dosVictorias(A, B) && A.cuenta === null && B.cuenta === null, `los dos trabados: no cuenta para nadie (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(!A.resultados.some((r) => r.ganador === 'yo') && !B.resultados.some((r) => r.ganador === 'yo'), 'los dos trabados: ninguno vio «¡Ganaste por abandono!»')
    cerrarTodo(A, B)
  },

  async 'larga-40'() {
    // Traba de 40 s (más que el latido de realtime-js, 25 s). Los sondeos del resultado (20 s) le
    // reinician el reloj: el socket trabado sigue vivo y, cuando vuelve la red, llega el resultado
    // de A y su adiós (A volvió a la sala 6 s después de ganar).
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 41_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    await reloj.correrMientras(() => final(A) !== null, inicio + 30_000)
    await reloj.correrHasta(reloj.t + 6000)
    salirDe(A, 'salir')
    await reloj.correrHasta(inicio + 80_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   pie B: ${textosPie(B)}`)
    const cierresB = rojo.cierresDeCliente.filter((c) => c.cel === 'B')
    v.verificar(cierresB.length === 0, `traba de 40 s: el socket trabado de B sigue vivo (${cierresB.length} cierres)`)
    v.verificar(final(A)?.ganador === 'yo' && final(B)?.ganador === 'rival', `traba de 40 s: gana A y pierde B (A «${final(A)?.titulo}», B «${final(B)?.titulo}»)`)
    v.verificar(!dosVictorias(A, B) && A.cuenta === true && B.cuenta === false, `traba de 40 s: al volver la red, A le confirma la derrota a B (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(B.pies[B.pies.length - 1]?.pie === 'Prueba A volvió a la sala' && !culpoAlRival(B), `traba de 40 s: el pie de B nunca culpó a A y termina en «Prueba A volvió a la sala» (${textosPie(B)})`)
    cerrarTodo(A, B)
  },

  async 'larga-70'() {
    // Más que los sondeos del resultado y el latido: realtime-js da el socket de B por muerto (lo
    // retenido se pierde, también el resultado de A). B se queda sin la confirmación: no cuenta.
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 71_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    await reloj.correrMientras(() => final(A) !== null, inicio + 30_000)
    await reloj.correrHasta(reloj.t + 6000)
    salirDe(A, 'salir')
    await reloj.correrHasta(inicio + 100_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   pie B: ${textosPie(B)}`)
    const cierresB = rojo.cierresDeCliente.filter((c) => c.cel === 'B')
    console.log(`   B cerró su socket: ${JSON.stringify(cierresB.map((c) => ({ t: ((c.t - inicio) / 1000).toFixed(1), motivo: c.reason })))}`)
    v.verificar(cierresB.some((c) => /heartbeat/i.test(c.reason)), 'traba de 70 s: más que los sondeos y el latido (realtime-js cerró el socket de B y lo retenido se perdió)')
    v.verificar(!dosVictorias(A, B) && A.cuenta === true && B.cuenta === null && final(B)?.ganador === 'rival', `traba de 70 s: A gana; B perdió en pantalla pero sin la confirmación de A no se anota (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(B.duelo.leer().fase === 'resultado' && !B.duelo.leer().sinRed, 'traba de 70 s: con la red de vuelta, B sabe que tiene red (el transporte reconectó)')
    cerrarTodo(A, B)
  },

  async 'latido-corto'() {
    // A se queda colgado sin despedirse (la página murió) y B, CON red, espera. Con el latido de
    // realtime-js cada 2–3 s (en vez de 25) y varias latencias, alguno cae en medio de un sondeo: si
    // el sondeo no reiniciara ese reloj, realtime-js encontraría el latido pendiente, lo daría por
    // vencido y cortaría el socket sano de B.
    for (const [latido, latencia] of [
      [2100, 90],
      [2300, 250],
      [2600, 90],
      [2600, 250],
      [2900, 180],
      [3300, 250],
    ] as const) {
      const rojo = new Red(reloj, { latenciaMs: latencia })
      const { A, B, inicio } = await arrancar(rojo, { heartbeatIntervalMs: latido })
      setTimeout(() => {
        A.apagado = true
        A.duelo.destruir()
      }, 1000)
      await reloj.correrHasta(inicio + 20_000)
      const cierresB = rojo.cierresDeCliente.filter((c) => c.cel === 'B')
      v.verificar(
        final(B)?.ganador === 'yo' && final(B)?.motivo === 'abandono_rival' && cierresB.length === 0 && !B.carteles.some((c) => c.texto === 'Sin conexión'),
        `rival colgado (latido ${latido} ms, ida ${latencia} ms): B, con red, gana por abandono («${final(B)?.bajada}»), sin «Sin conexión» y sin que los sondeos le corten el socket (${cierresB.length} cierres)`,
      )
      cerrarTodo(A, B)
    }
  },

  async barrido() {
    // La traba de B termina alrededor del momento en que A reclama: los dos tienen que terminar
    // diciendo lo mismo y nunca los dos con la victoria.
    for (const ms of [9_600, 9_900, 10_100, 10_300, 10_500, 10_700, 11_000, 11_500, 12_500, 16_000, 20_000]) {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 1000 + ms, cel: 'B', modo: 'normal' }], inicio, rojo)
      await reloj.correrHasta(inicio + 1000 + ms + 12_000)
      const rA = final(A)
      const rB = final(B)
      const coinciden =
        (rA === null && rB === null) ||
        (rA?.ganador === 'yo' && rB?.ganador === 'rival') ||
        (rA?.ganador === 'rival' && rB?.ganador === 'yo') ||
        (rA?.ganador === null && rB?.ganador === null && rA !== null && rB !== null)
      const cuentas = rA === null && rB === null ? true : (A.cuenta === true && B.cuenta === false) || (A.cuenta === null && B.cuenta === null)
      const texto = rA === null && rB === null ? 'la pelea sigue' : `A ${rA?.ganador ?? '—'} (${rA?.motivo ?? '—'}) · B ${rB?.ganador ?? '—'} (${rB?.motivo ?? '—'}) · récord A ${recordDe(A)} B ${recordDe(B)}`
      v.verificar(coinciden && cuentas && !dosVictorias(A, B) && !B.resultados.some((r) => r.ganador === 'yo' && r.motivo === 'abandono_rival'), `traba de ${(ms / 1000).toFixed(1)} s: ${texto}`)
      cerrarTodo(A, B)
    }
  },

  async 'caida-corta'() {
    // El rival se va sin despedirse (la página murió) y a B, CON red, se le corta un instante en
    // algún momento de la espera (a veces con un sondeo en vuelo, que vuelve «sin red» DESPUÉS de
    // reconectar). B tiene que ganar siempre: un «sin red» de antes de reconectar no cuenta.
    for (const en of [3400, 3600, 3800, 4000, 4200, 4400, 4600, 4800, 5000, 5200]) {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      setTimeout(() => {
        A.apagado = true
        A.duelo.destruir()
      }, 1000)
      programarRed([{ en, cel: 'B', modo: 'caido' }, { en: en + 300, cel: 'B', modo: 'normal' }], inicio, rojo)
      await reloj.correrHasta(inicio + 30_000)
      const r = final(B)
      v.verificar(r?.ganador === 'yo' && r.motivo === 'abandono_rival', `rival que se fue y corte de 0,3 s a los ${(en / 1000).toFixed(1)} s: B gana por abandono (${r ? `${r.ganador}, ${r.motivo}, a los ${(r.t / 1000).toFixed(1)} s` : 'sin resultado'})`)
      cerrarTodo(A, B)
    }
  },

  async 'motor-distinto'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B } = await arrancar(rojo)
    terminarMotor(A, fin(0, [2, 1]))
    terminarMotor(B, fin(1, [1, 2]))
    await reloj.correrHasta(reloj.t + 8000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    v.verificar(final(A)?.motivo === 'desync' && final(B)?.motivo === 'desync' && final(A)?.ganador === null && final(B)?.ganador === null, `dos finales del motor con distinto ganador: anulada en los dos («${final(A)?.titulo}» / «${final(A)?.bajada}»)`)
    v.verificar(A.cuenta === null && B.cuenta === null, `dos finales distintos: no cuenta para nadie (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    cerrarTodo(A, B)
  },

  async 'motor-rondas'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B } = await arrancar(rojo)
    terminarMotor(A, fin(0, [2, 1]))
    terminarMotor(B, fin(0, [2, 0]))
    await reloj.correrHasta(reloj.t + 8000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    v.verificar(final(A)?.motivo === 'desync' && final(B)?.motivo === 'desync', 'mismo ganador pero otros rounds (2-1 contra 2-0): anulada en los dos')
    cerrarTodo(A, B)
  },

  async 'motor-igual'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B } = await arrancar(rojo)
    terminarMotor(A, fin(1, [1, 2]))
    terminarMotor(B, fin(1, [1, 2]))
    await reloj.correrHasta(reloj.t + 8000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    v.verificar(final(A)?.ganador === 'rival' && final(A)?.motivo === 'pelea' && final(B)?.ganador === 'yo' && final(B)?.motivo === 'pelea', `el mismo final en los dos: queda («${final(A)?.titulo}» / «${final(B)?.titulo}»)`)
    v.verificar(A.cuenta === false && B.cuenta === true, 'el mismo final: A anota una derrota y B una victoria')
    cerrarTodo(A, B)
  },

  async 'abandono-en-traba'() {
    // El que TIENE red se va (menú, cerrar la página, «¡Te toca!») mientras el otro está trabado.
    // Hasta el 31/oct, con la traba de 10,5 s o más, el trabado se daba por perdido sin red, el
    // adiós le llegaba con la red de vuelta y sólo avisaba: los dos se anotaban una derrota.
    const BAJADAS: Record<'abandono' | 'cerro' | 'turno', string> = {
      abandono: 'abandonó la pelea',
      cerro: 'cerró el juego',
      turno: 'fue llamado a cortarse',
    }
    let malas = 0
    let casos = 0
    for (const trabado of ['B', 'A'] as const) {
      const seVa: Quien = trabado === 'B' ? 'A' : 'B'
      for (const trabaMs of [4000, 10_800, 13_000, 20_000]) {
        for (const motivo of ['abandono', 'cerro', 'turno'] as const) {
          for (const aLos of [1500, 4000, 8000, 9500]) {
            const rojo = new Red(reloj, { latenciaMs: 90 })
            const par = await arrancar(rojo)
            const T = par[trabado]
            const V = par[seVa]
            programarRed([{ en: 1000, cel: trabado, modo: 'trabado' }, { en: 1000 + trabaMs, cel: trabado, modo: 'normal' }], par.inicio, rojo)
            let faseAlIrse = ''
            setTimeout(() => {
              faseAlIrse = V.duelo.leer().fase
              salirDe(V, motivo)
            }, Math.max(0, par.inicio + 1000 + aLos - reloj.t))
            await reloj.correrHasta(par.inicio + 1000 + Math.max(trabaMs, aLos) + 15_000)
            casos++
            const rT = final(T)
            const esperado = `${NOMBRES[seVa]} ${BAJADAS[motivo]}`
            const ok =
              faseAlIrse === 'peleando' &&
              V.cuenta === false &&
              T.cuenta === true &&
              rT?.ganador === 'yo' &&
              rT.motivo === (motivo === 'turno' ? 'turno_rival' : 'abandono_rival') &&
              rT.bajada === esperado &&
              !dosVictorias(par.A, par.B)
            if (!ok) malas++
            v.verificar(
              ok,
              `${trabado} trabado ${(trabaMs / 1000).toFixed(1)} s, ${seVa} se va (${motivo}) a los ${(aLos / 1000).toFixed(1)} s: ${seVa} ${recordDe(V)} · ${trabado} ${recordDe(T)} «${rT?.titulo}» / «${rT?.bajada}»`,
            )
            cerrarTodo(par.A, par.B)
          }
        }
      }
    }
    console.log(`   ${casos} casos, ${malas} incoherentes (nunca dos derrotas ni dos victorias: el que se fue pierde y el otro gana)`)
  },

  async 'dos-trabados-uno-se-va'() {
    // Los dos trabados y A abandona a los 4 s (sin red). Con la sala abierta (como en el juego) el
    // socket de A sigue vivo: su adiós («pierdo») sale cuando vuelve la red y B gana. Sin la sala,
    // removeChannel corta el socket de A y lo retenido se pierde: B no se entera, su derrota queda
    // provisoria y no cuenta. Nunca dos derrotas (antes, las dos).
    for (const conSala of [true, false]) {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo, { conSala })
      programarRed(redDeLosDos(1000, 14_000, 'trabado'), inicio, rojo)
      setTimeout(() => salirDe(A, 'abandono'), Math.max(0, inicio + 5000 - reloj.t))
      await reloj.correrHasta(inicio + 40_000)
      console.log(`   ${conSala ? 'con' : 'sin'} sala: B: ${resumen(B)} · pie ${textosPie(B)}`)
      const esperadoB = conSala ? B.cuenta === true && final(B)?.motivo === 'abandono_rival' : B.cuenta === null
      v.verificar(
        A.cuenta === false && esperadoB && !dosVictorias(A, B),
        `los dos trabados y A abandona, ${conSala ? 'con la sala abierta: su adiós llega al volver la red y B gana' : 'sin la sala: su adiós se pierde con el socket y la derrota de B no cuenta'} (récord A ${recordDe(A)}, B ${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
  },

  async 'dos-sin-vuelta'() {
    // El wifi del local se cae (los dos) y no vuelve mientras miran el resultado.
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed(redDeLosDos(1000, null, 'caido'), inicio, rojo)
    await reloj.correrHasta(inicio + 90_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   pie A: ${textosPie(A)}\n   pie B: ${textosPie(B)}`)
    const ok = [A, B].every((c) => final(c)?.ganador === 'rival' && final(c)?.provisorio && c.cuenta === null && !c.anotado.some((x) => x.ahora !== null))
    v.verificar(ok, `los dos sin red y no vuelve: cada uno perdió en pantalla, provisorio, y no cuenta (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(
      [A, B].every((c) => final(c)?.bajada === `Te desconectaste. Si a ${NOMBRES[c.quien === 'A' ? 'B' : 'A']} también se le cortó, no cuenta`),
      `los dos sin red: la bajada lo dice («${final(A)?.bajada}»)`,
    )
    v.verificar([A, B].every((c) => !culpoAlRival(c) && c.pies.every((p) => p.pie === textoSinRed())), `los dos sin red: el pie dice «${textoSinRed()}» y nunca culpa al otro`)
    cerrarTodo(A, B)
  },

  async 'dos-trabados-sin-vuelta'() {
    // Lo mismo con la red TRABADA (el wifi que se cuelga sin cerrar los sockets).
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed(redDeLosDos(1000, null, 'trabado'), inicio, rojo)
    await reloj.correrHasta(inicio + 90_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    v.verificar(
      [A, B].every((c) => final(c)?.ganador === 'rival' && c.cuenta === null && !c.anotado.some((x) => x.ahora !== null)),
      `los dos trabados y no vuelve: no cuenta para ninguno (récord A ${recordDe(A)}, B ${recordDe(B)})`,
    )
    v.verificar([A, B].every((c) => !culpoAlRival(c)), 'los dos trabados: el pie nunca culpa al otro')
    cerrarTodo(A, B)
  },

  async 'uno-sale-antes'() {
    // Los dos sin red; uno vuelve a la sala ANTES de que vuelva la red: su derrota provisoria se va
    // sin contar y la del otro nunca recibe la confirmación. Caída y traba.
    for (const [modo, sale, vuelve] of [
      ['caido', 25_000, 40_000],
      ['trabado', 15_000, 20_000],
    ] as const) {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      programarRed(redDeLosDos(1000, vuelve, modo), inicio, rojo)
      setTimeout(() => salirDe(A, 'salir'), Math.max(0, inicio + sale - reloj.t))
      await reloj.correrHasta(inicio + 90_000)
      console.log(`   ${modo}: A: ${resumen(A)}\n   ${modo}: B: ${resumen(B)} · pie ${textosPie(B)}`)
      v.verificar(
        A.cuenta === null && B.cuenta === null && !dosVictorias(A, B) && ![A, B].some((c) => c.anotado.some((x) => x.ahora !== null)),
        `los dos ${modo === 'caido' ? 'sin red' : 'trabados'}, A sale a los ${sale / 1000} s y la red vuelve a los ${vuelve / 1000} s: no cuenta para ninguno (récord A ${recordDe(A)}, B ${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
  },

  async 'solo-B-cae'() {
    // Control: sólo B pierde la red y no vuelve. A gana (cuenta); B pierde en pantalla pero, sin la
    // confirmación de A, no se anota; su pie no culpa a A.
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'caido' }], inicio, rojo)
    await reloj.correrHasta(inicio + 60_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}\n   pie B: ${textosPie(B)}`)
    v.verificar(A.cuenta === true && final(A)?.ganador === 'yo', `sólo B sin red: A gana y se anota la victoria (${recordDe(A)})`)
    v.verificar(
      final(B)?.ganador === 'rival' && final(B)?.provisorio === true && B.cuenta === null && !B.resultados.some((r) => r.ganador === 'yo'),
      `sólo B sin red: B pierde en pantalla («${final(B)?.titulo}» / «${final(B)?.bajada}») y, sin la confirmación de A, no se anota (${recordDe(B)})`,
    )
    v.verificar(!culpoAlRival(B) && B.pies.every((p) => p.pie === textoSinRed()), `sólo B sin red: el pie de B dice «${textoSinRed()}»`)
    cerrarTodo(A, B)
  },

  async 'solo-B-cae-vuelve'() {
    // Control: B pierde la red y le vuelve a los 30 s, con A todavía en el resultado: A le confirma la derrota.
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'caido' }, { en: 30_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    await reloj.correrHasta(inicio + 60_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}\n   pie B: ${textosPie(B)}`)
    const conf = B.anotado.find((x) => x.ahora === false)
    const vuelta = 30_000 - (B.inicioPelea - inicio)
    v.verificar(A.cuenta === true && B.cuenta === false && !dosVictorias(A, B), `B con la red de vuelta a los 30 s: A gana y B pierde, confirmado (récord A ${recordDe(A)}, B ${recordDe(B)})`)
    v.verificar(
      conf !== undefined && conf.t - vuelta <= 4000,
      `la confirmación llega ${conf ? ((conf.t - vuelta) / 1000).toFixed(1) : '—'} s después de que vuelve la red (el transporte reconecta sin esperar a realtime-js)`,
    )
    v.verificar(final(B)?.bajada === 'Te desconectaste en el medio de la pelea' && B.pies[B.pies.length - 1]?.pie === null, `B: bajada confirmada y REVANCHA de nuevo (${textosPie(B)})`)
    cerrarTodo(A, B)
  },

  async 'vuelve-la-red'() {
    // Los dos sin red; la red vuelve con los dos en el resultado: «Pelea anulada». Antes tardaba
    // 12–22 s más (la espera creciente de realtime-js para el socket y para volver a unirse al canal).
    const filas: string[] = []
    for (const [modo, vuelve] of [
      ['caido', 12_000],
      ['caido', 16_000],
      ['caido', 25_000],
      ['caido', 40_000],
      ['caido', 61_000],
      ['trabado', 16_000],
      ['trabado', 40_000],
      ['trabado', 75_000],
    ] as const) {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      programarRed(redDeLosDos(1000, vuelve, modo), inicio, rojo)
      await reloj.correrHasta(inicio + vuelve + 30_000)
      const anulada = (c: Celular) => c.resultados.find((r) => r.motivo === 'corte')
      const demora = (c: Celular) => {
        const r = anulada(c)
        return r ? r.t - (vuelve - (c.inicioPelea - inicio)) : null
      }
      const dA = demora(A)
      const dB = demora(B)
      const ok = dA !== null && dB !== null && dA <= 6000 && dB <= 6000 && A.cuenta === null && B.cuenta === null
      filas.push(`${modo} hasta ${vuelve / 1000} s → anulada ${dA === null ? '—' : (dA / 1000).toFixed(1)} s / ${dB === null ? '—' : (dB / 1000).toFixed(1)} s después`)
      v.verificar(
        ok,
        `red ${modo === 'caido' ? 'caída' : 'trabada'} de los dos hasta los ${vuelve / 1000} s: «Pelea anulada» en A ${dA === null ? 'nunca' : `${(dA / 1000).toFixed(1)} s`} y en B ${dB === null ? 'nunca' : `${(dB / 1000).toFixed(1)} s`} después de que vuelve (récord A ${recordDe(A)}, B ${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
    console.log('   ' + filas.join('\n   '))
  },

  async oculta() {
    // B se va a otra app (la página oculta, sin cuadros) con la red viva. En Android y en la compu el
    // socket sigue recibiendo: el «fin» de A llega antes de que B vuelva. Tiene que decir que se fue
    // del juego, no que se desconectó.
    {
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      setTimeout(() => ocultar(B, 12_600), Math.max(0, inicio + 1000 - reloj.t))
      await reloj.correrHasta(inicio + 30_000)
      console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
      const rB = final(B)
      v.verificar(final(A)?.ganador === 'yo' && A.cuenta === true, `pestaña oculta 12,6 s: gana A («${final(A)?.titulo}»)`)
      v.verificar(
        rB?.ganador === 'rival' && rB.motivo === 'ausente' && rB.bajada === 'Te fuiste del juego más de 10 segundos' && B.cuenta === false,
        `pestaña oculta 12,6 s: B lee «${rB?.titulo}» / «${rB?.bajada}» y se anota la derrota (${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
    {
      // Las dos ocultas 12 s: cada una se rinde al volver (provisorio) y, al conciliar, se anula.
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      setTimeout(() => {
        ocultar(A, 12_000)
        ocultar(B, 12_000)
      }, Math.max(0, inicio + 1000 - reloj.t))
      await reloj.correrHasta(inicio + 30_000)
      console.log(`   las dos: A: ${resumen(A)}\n   las dos: B: ${resumen(B)}`)
      v.verificar(
        final(A)?.motivo === 'corte' && final(B)?.motivo === 'corte' && A.cuenta === null && B.cuenta === null && !dosVictorias(A, B),
        `las dos páginas ocultas 12 s: anulada, no cuenta (récord A ${recordDe(A)}, B ${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
    {
      // Oculta 6 s: vuelve y la pelea sigue.
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo)
      setTimeout(() => ocultar(B, 6000), Math.max(0, inicio + 1000 - reloj.t))
      await reloj.correrHasta(inicio + 20_000)
      v.verificar(A.duelo.leer().fase === 'peleando' && B.duelo.leer().fase === 'peleando' && A.anotado.length === 0, 'pestaña oculta 6 s: la pelea sigue')
      cerrarTodo(A, B)
    }
  },

  async 'api-sin-latido'() {
    // Otra versión de realtime-js sin una pieza del latido (acá, sin onHeartbeat): el transporte no
    // ofrece el sondeo y el duelo decide como antes del 31/oct (el canal unido alcanza). Nunca un
    // «Sin conexión» falso ni un abandono falso al que tiene red.
    const sinLatido = (rt: ClienteRealtime) => {
      ;(rt as unknown as Record<string, unknown>).onHeartbeat = undefined
    }
    await escenariosSinSondeo('sin onHeartbeat', sinLatido)
  },

  async 'api-latido-cambiado'() {
    // Otra versión de realtime-js que manda el latido después (no queda pendiente al volver de
    // sendHeartbeat): el primer sondeo lo nota, dice «no sé» y el duelo sigue como antes del sondeo.
    const latidoDiferido = (rt: ClienteRealtime) => {
      const original = rt.sendHeartbeat.bind(rt)
      rt.sendHeartbeat = () => new Promise<void>((listo) => setTimeout(() => void original().then(listo, listo), 0))
    }
    await escenariosSinSondeo('latido diferido', latidoDiferido)
  },
}

/** Lo que tiene que pasar con un realtime-js cuyo latido no es el conocido (el duelo, como antes del sondeo). */
async function escenariosSinSondeo(etiqueta: string, tocar: (rt: ClienteRealtime) => void): Promise<void> {
  const avisos = await contandoAvisos(async () => {
    {
      // El rival se cuelga sin despedirse: B, con red, gana a los 10 s, sin «Sin conexión» ni cortes.
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo, { tocarRealtime: tocar })
      setTimeout(() => {
        A.apagado = true
        A.duelo.destruir()
      }, 1000)
      await reloj.correrHasta(inicio + 20_000)
      const cierresB = rojo.cierresDeCliente.filter((c) => c.cel === 'B')
      v.verificar(
        final(B)?.ganador === 'yo' && final(B)?.motivo === 'abandono_rival' && cierresB.length === 0 && !B.carteles.some((c) => c.texto === 'Sin conexión'),
        `${etiqueta}: rival colgado, B con red gana por abandono (${final(B)?.motivo ?? 'sin resultado'}), sin «Sin conexión» y sin cortes (${cierresB.length})`,
      )
      cerrarTodo(A, B)
    }
    {
      // Traba de 9 s: la pelea sigue; el que tiene red nunca ve «Sin conexión».
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo, { tocarRealtime: tocar })
      programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 10_000, cel: 'B', modo: 'normal' }], inicio, rojo)
      await reloj.correrHasta(inicio + 25_000)
      v.verificar(
        A.duelo.leer().fase === 'peleando' && B.duelo.leer().fase === 'peleando' && !A.carteles.some((c) => c.texto === 'Sin conexión'),
        `${etiqueta}: traba de 9 s, la pelea sigue y A nunca ve «Sin conexión»`,
      )
      cerrarTodo(A, B)
    }
    {
      // Traba de 13 s: como antes del sondeo, los dos reclaman (el canal de B sigue unido) y, al
      // volver la red, la pelea se anula. Ninguno ve un «Sin conexión» que no se midió.
      const rojo = new Red(reloj, { latenciaMs: 90 })
      const { A, B, inicio } = await arrancar(rojo, { tocarRealtime: tocar })
      programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 14_000, cel: 'B', modo: 'normal' }], inicio, rojo)
      await reloj.correrHasta(inicio + 30_000)
      console.log(`   ${etiqueta}, traba 13: A: ${resumen(A)}\n   ${etiqueta}, traba 13: B: ${resumen(B)}`)
      v.verificar(
        final(A)?.motivo === 'corte' && final(B)?.motivo === 'corte' && A.cuenta === null && B.cuenta === null && ![A, B].some((c) => c.carteles.some((x) => x.texto === 'Sin conexión')),
        `${etiqueta}: traba de 13 s como antes del sondeo: los dos reclaman y, al volver la red, se anula (récord A ${recordDe(A)}, B ${recordDe(B)})`,
      )
      cerrarTodo(A, B)
    }
  })
  console.log(`   avisos: ${avisos.length ? avisos[0] : '(ninguno)'}`)
}

function textos(): void {
  const c = (ms: number, ok: boolean) => {
    const x = cartelEspera(ms, ok)
    return x ? `${x.texto}${x.reconectando ? ' / Reconectando…' : ''}` : null
  }
  v.verificar(c(300, true) === null && c(500, true) === 'Conexión lenta…' && c(3500, true) === 'Conexión lenta… 7' && c(9990, true) === 'Conexión lenta… 1' && c(12_000, true) === 'Conexión lenta… 0', 'cartel de la espera: «Conexión lenta…» y la cuenta desde los 3 s')
  v.verificar(c(500, false) === 'Sin conexión / Reconectando…' && c(5000, false) === 'Sin conexión / Reconectando…', 'cartel sin red: «Sin conexión / Reconectando…», sin cuenta')
  const r = (motivo: ResultadoDuelo['motivo'], ganador: ResultadoDuelo['ganador'], provisorio = false): ResultadoDuelo => ({
    k: 1,
    ganador,
    motivo,
    provisorio,
    rondas: [0, 0],
    estadisticas: null,
    duracionSeg: 0,
  })
  const caso = (motivo: ResultadoDuelo['motivo'], ganador: ResultadoDuelo['ganador'], seFue: EstadoDuelo['rivalSeFue']) =>
    `${bajadaResultado(r(motivo, ganador), 'Juan', seFue) ?? '∅'} | ${textoRivalAusente(r(motivo, ganador), 'Juan', seFue)}`
  const casos: [string, string][] = [
    [caso('abandono_rival', 'yo', 'abandono'), 'Juan abandonó la pelea | Juan volvió a la sala'],
    [caso('abandono_rival', 'yo', 'cerro'), 'Juan cerró el juego | Sin revancha'],
    [caso('turno_rival', 'yo', 'turno'), 'Juan fue llamado a cortarse | Sin revancha'],
    [caso('abandono_rival', 'yo', 'salir'), 'Juan se fue de la pelea | Juan volvió a la sala'],
    [caso('abandono_rival', 'yo', 'sin_conexion'), 'Juan se quedó sin conexión | Sin revancha: Juan ya no está'],
    [caso('pelea', 'yo', 'cerro'), '∅ | Juan cerró el juego'],
    [caso('pelea', 'rival', 'abandono'), '∅ | Juan volvió a la sala'],
    [caso('pelea', 'yo', 'turno'), '∅ | Juan fue llamado a cortarse'],
  ]
  for (const [obtenido, esperado] of casos) v.verificar(obtenido === esperado, `pie del resultado: ${obtenido}`)
  v.verificar(
    bajadaResultado(r('abandone', 'rival', true), 'Juan') === 'Te desconectaste. Si a Juan también se le cortó, no cuenta' &&
      bajadaResultado(r('abandone', 'rival'), 'Juan') === 'Te desconectaste en el medio de la pelea' &&
      bajadaResultado(r('ausente', 'rival', true), 'Juan') === 'Te fuiste del juego más de 10 segundos',
    'bajada de la derrota sin red: provisoria («Si a Juan también se le cortó, no cuenta») y confirmada',
  )
  v.verificar(textoSinRed() === 'Sin revancha hasta que vuelva tu conexión', `pie sin red de este lado: «${textoSinRed()}»`)
}

// ─── Corrida ─────────────────────────────────────────────────────────────────

const pedidos = (process.argv[2] ?? Object.keys(ESCENARIOS).join(',')).split(',').filter(Boolean)
console.log(`duelo-corte · realtime-js ${VERSION_REALTIME} · escenarios: ${pedidos.join(', ')}`)
const inicioReal = process.hrtime.bigint()
textos()
for (const nombre of pedidos) {
  const esc = ESCENARIOS[nombre]
  if (!esc) {
    v.verificar(false, `escenario desconocido: ${nombre}`)
    continue
  }
  console.log(`\n── ${nombre}`)
  try {
    await esc()
  } catch (e) {
    v.verificar(false, `${nombre}: ${(e as Error)?.stack ?? e}`)
    reloj.limpiar()
  }
}
v.verificar(reloj.errores.length === 0, `sin excepciones en los temporizadores (${reloj.errores.length})`)
v.verificar(reloj.pedidosHttp.length === 0, `ningún mensaje cayó al POST por REST de realtime-js (${reloj.pedidosHttp.length})`)
for (const e of reloj.errores.slice(0, 5)) console.log('   ', (e as Error)?.stack ?? e)
const segundosReales = Number(process.hrtime.bigint() - inicioReal) / 1e9
console.log(`\n${v.fallas === 0 ? 'TODO OK' : `${v.fallas} FALLAS`} · ${v.ok} verificaciones · ${(reloj.t / 1000).toFixed(0)} s virtuales en ${segundosReales.toFixed(1)} s`)
process.exit(v.fallas === 0 ? 0 : 1)
