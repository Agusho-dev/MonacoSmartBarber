/**
 * Cortes de red en plena pelea online, con el código REAL: dos Duelo con su Lockstep, el
 * transporte de verdad (transporte.ts, con su sondeo por el latido) sobre el realtime-js instalado
 * y la red de mentira de duelo-red.mts (reloj virtual: cada escenario corre en segundos y da
 * siempre igual). Lo que verificó prod-online el 30/oct/2026: si la red de un celular se TRABA
 * (el 4G que se estanca sin cerrar el socket), el canal sigue «unido» y los dos reclamaban el
 * abandono a los 10 s: la pelea quedaba anulada aunque sólo uno hubiera perdido la red, el trabado
 * veía «¡Ganaste por abandono!» y, si la traba duraba más que el latido, los dos se anotaban la
 * victoria. B es siempre el que pierde la red; A desafió (lado 0).
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs duelo-corte.mts [escenario,…]
 *
 * Escenarios: traba-13, traba-9, caida-13, dos-13, larga-40, latido-corto, barrido, caida-corta,
 * motor-distinto, motor-rondas, motor-igual (y los textos, siempre). Sale con código 1 si algo no da.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Reloj, Red, Verificador, VERSION_REALTIME, type ClienteDePrueba, type ModoRed } from './duelo-red.mts'
import { Duelo, type EstadoDuelo, type FinPeleaLocal, type ResultadoDuelo } from '../../../src/lib/juego/online/duelo.ts'
import { ABANDONO_MS, type Lockstep } from '../../../src/lib/juego/online/lockstep.ts'
import { abrirTransportePelea } from '../../../src/lib/juego/online/transporte.ts'
import {
  bajadaResultado,
  cartelEspera,
  textoRivalAusente,
  tituloResultado,
} from '../../../src/lib/juego/online/textos.ts'
import { ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import type { EstadisticasLuchador, IdArena } from '../../../src/lib/juego/tipos.ts'

const reloj = new Reloj()
reloj.instalar()
const v = new Verificador()
const NOMBRES = { A: 'Prueba A', B: 'Prueba B' } as const
type Quien = 'A' | 'B'

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
  /** Ya llegó al final del motor (escenarios «motor»). */
  finMotor: boolean
  /** Cambios del cartel de la espera (lo que muestra hud-online), con la hora relativa a la pelea. */
  carteles: { t: number; texto: string | null; reconectando: boolean }[]
  /** Cambios del resultado (título y bajada como los dibuja resultado-online). */
  resultados: { t: number; ganador: ResultadoDuelo['ganador']; motivo: ResultadoDuelo['motivo']; titulo: string; bajada: string | null }[]
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

function armar(red: Red, opcionesRealtime: { heartbeatIntervalMs?: number } = {}): { A: Celular; B: Celular; t0: number } {
  const peleaId = `pelea-prueba-${Math.floor(reloj.t)}`
  const ids = { A: 'jugador-a-00000001', B: 'jugador-b-00000002' }
  const t0 = reloj.t
  const crear = (quien: Quien): Celular => {
    const otro: Quien = quien === 'A' ? 'B' : 'A'
    const cliente = red.crearCliente(quien, opcionesRealtime)
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
      finMotor: false,
      carteles: [],
      resultados: [],
      anotado: [],
      cuenta: undefined,
      inicioPelea: Infinity,
    })
    let ultimo = ''
    duelo.suscribir(() => {
      const e = duelo!.leer()
      const r = e.resultado
      if (!r) return
      const clave = `${r.k}:${r.ganador}:${r.motivo}`
      if (clave === ultimo) return
      ultimo = clave
      cel.resultados.push({
        t: reloj.t - cel.inicioPelea,
        ganador: r.ganador,
        motivo: r.motivo,
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
  if (cel.apagado) return
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

async function arrancar(red: Red, opciones: { heartbeatIntervalMs?: number } = {}) {
  const par = armar(red, opciones)
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
    ? `${e.fase} · «${r.titulo}» / «${r.bajada ?? ''}» · ganador ${r.ganador} (${r.motivo}) · marcador ${e.marcador.join('-')} · récord ${JSON.stringify(c.anotado.map((x) => x.ahora))}`
    : `${e.fase} · sin resultado · tick ${c.tick}`
}
const conDigito = (t: string | null) => t !== null && /\d/.test(t)
const textosCartel = (c: Celular) => c.carteles.map((x) => `${(x.t / 1000).toFixed(2)}s ${x.texto ?? '—'}${x.reconectando ? ' / Reconectando…' : ''}`).join(' → ')
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

/** Programa los cambios de red de un escenario (ms desde `inicio`). */
function programarRed(eventos: { en: number; cel: Quien; modo: ModoRed }[], inicio: number, rojo: Red): void {
  for (const ev of eventos) setTimeout(() => rojo.ponerModo(ev.cel, ev.modo), Math.max(0, inicio + ev.en - reloj.t))
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
    await reloj.correrHasta(inicio + 30_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    console.log(`   cartel A: ${textosCartel(A)}\n   cartel B: ${textosCartel(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === 'yo' && rA.motivo === 'abandono_rival', `traba 13 s: gana A, que tenía red («${rA?.titulo}» / «${rA?.bajada}»)`)
    v.verificar(rB?.ganador === 'rival' && rB.motivo === 'abandone', `traba 13 s: pierde B, el trabado («${rB?.titulo}» / «${rB?.bajada}»)`)
    v.verificar(rA?.bajada === 'Prueba B se quedó sin conexión' && rB?.bajada === 'Te desconectaste en el medio de la pelea', 'traba 13 s: las bajadas dicen lo que pasó')
    v.verificar(!B.resultados.some((r) => r.ganador === 'yo'), 'traba 13 s: B nunca vio «¡Ganaste por abandono!»')
    v.verificar(bTrabado?.ganador === 'rival', `traba 13 s: B, todavía trabado, ya sabe que perdió (${bTrabado ? `«${bTrabado.titulo}» a los ${(bTrabado.t / 1000).toFixed(1)} s` : 'sin resultado'})`)
    v.verificar(B.carteles.some((c) => c.texto === 'Sin conexión' && c.reconectando) && !B.carteles.some((c) => conDigito(c.texto)), 'traba 13 s: B ve «Sin conexión / Reconectando…» y nunca una cuenta hacia una victoria')
    v.verificar(A.carteles.some((c) => conDigito(c.texto)) && !A.carteles.some((c) => c.texto === 'Sin conexión'), 'traba 13 s: A ve la cuenta («Conexión lenta… N») y nunca «Sin conexión»')
    v.verificar(JSON.stringify(A.anotado.map((x) => x.ahora)) === '[true]' && JSON.stringify(B.anotado.map((x) => x.ahora)) === '[false]', 'traba 13 s: el récord de A suma una victoria y el de B una derrota')
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
    console.log(`   cartel B: ${textosCartel(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === 'yo' && rA.motivo === 'abandono_rival', `caída real 13 s: gana A («${rA?.bajada}»)`)
    v.verificar(rB?.ganador === 'rival' && rB.motivo === 'abandone', `caída real 13 s: pierde B («${rB?.bajada}»)`)
    v.verificar(B.carteles.some((c) => c.texto === 'Sin conexión' && c.reconectando) && !B.carteles.some((c) => conDigito(c.texto)), 'caída real 13 s: B ve «Sin conexión / Reconectando…»')
    v.verificar(!dosVictorias(A, B), 'caída real 13 s: nunca los dos con la victoria')
    cerrarTodo(A, B)
  },

  async 'dos-13'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed(
      [
        { en: 1000, cel: 'A', modo: 'trabado' },
        { en: 1000, cel: 'B', modo: 'trabado' },
        { en: 14_000, cel: 'A', modo: 'normal' },
        { en: 14_000, cel: 'B', modo: 'normal' },
      ],
      inicio,
      rojo,
    )
    await reloj.correrHasta(inicio + 30_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    const rA = final(A)
    const rB = final(B)
    v.verificar(rA?.ganador === null && rA.motivo === 'corte' && rB?.ganador === null && rB.motivo === 'corte', `los dos trabados 13 s: anulada para los dos («${rA?.titulo}» / «${rA?.bajada}»)`)
    v.verificar(!dosVictorias(A, B) && A.cuenta === null && B.cuenta === null, `los dos trabados: no cuenta para nadie (récord A ${JSON.stringify(A.anotado.map((x) => x.ahora))}, B ${JSON.stringify(B.anotado.map((x) => x.ahora))})`)
    v.verificar(!A.resultados.some((r) => r.ganador === 'yo') && !B.resultados.some((r) => r.ganador === 'yo'), 'los dos trabados: ninguno vio «¡Ganaste por abandono!»')
    cerrarTodo(A, B)
  },

  async 'larga-40'() {
    const rojo = new Red(reloj, { latenciaMs: 90 })
    const { A, B, inicio } = await arrancar(rojo)
    programarRed([{ en: 1000, cel: 'B', modo: 'trabado' }, { en: 41_000, cel: 'B', modo: 'normal' }], inicio, rojo)
    // A vuelve a la sala 6 s después de ver su resultado.
    const salio = reloj.correrMientras(() => final(A) !== null, inicio + 30_000)
    await salio
    await reloj.correrHasta(reloj.t + 6000)
    A.duelo.salir('salir')
    A.apagado = true
    await reloj.correrHasta(inicio + 80_000)
    console.log(`   A: ${resumen(A)}\n   B: ${resumen(B)}`)
    const cierresB = rojo.cierresDeCliente.filter((c) => c.cel === 'B')
    console.log(`   B cerró su socket: ${JSON.stringify(cierresB.map((c) => ({ t: ((c.t - inicio) / 1000).toFixed(1), motivo: c.reason })))}`)
    v.verificar(cierresB.some((c) => /heartbeat/i.test(c.reason)), 'traba de 40 s: más que el latido (realtime-js cerró el socket de B y lo retenido se perdió)')
    v.verificar(final(A)?.ganador === 'yo' && final(B)?.ganador === 'rival', `traba de 40 s: gana A y pierde B (A «${final(A)?.titulo}», B «${final(B)?.titulo}»)`)
    v.verificar(!dosVictorias(A, B) && A.cuenta === true && B.cuenta === false, `traba de 40 s: nunca los dos con la victoria (récord A ${JSON.stringify(A.anotado.map((x) => x.ahora))}, B ${JSON.stringify(B.anotado.map((x) => x.ahora))})`)
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
      const texto = rA === null && rB === null ? 'la pelea sigue' : `A ${rA?.ganador ?? '—'} (${rA?.motivo ?? '—'}) · B ${rB?.ganador ?? '—'} (${rB?.motivo ?? '—'})`
      v.verificar(coinciden && !dosVictorias(A, B) && !B.resultados.some((r) => r.ganador === 'yo' && r.motivo === 'abandono_rival'), `traba de ${(ms / 1000).toFixed(1)} s: ${texto}`)
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
    v.verificar(A.cuenta === null && B.cuenta === null, `dos finales distintos: no cuenta para nadie (récord A ${JSON.stringify(A.anotado.map((x) => x.ahora))}, B ${JSON.stringify(B.anotado.map((x) => x.ahora))})`)
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
}

function textos(): void {
  const c = (ms: number, ok: boolean) => {
    const x = cartelEspera(ms, ok)
    return x ? `${x.texto}${x.reconectando ? ' / Reconectando…' : ''}` : null
  }
  v.verificar(c(300, true) === null && c(500, true) === 'Conexión lenta…' && c(3500, true) === 'Conexión lenta… 7' && c(9990, true) === 'Conexión lenta… 1' && c(12_000, true) === 'Conexión lenta… 0', 'cartel de la espera: «Conexión lenta…» y la cuenta desde los 3 s')
  v.verificar(c(500, false) === 'Sin conexión / Reconectando…' && c(5000, false) === 'Sin conexión / Reconectando…', 'cartel sin red: «Sin conexión / Reconectando…», sin cuenta')
  const r = (motivo: ResultadoDuelo['motivo'], ganador: ResultadoDuelo['ganador']): ResultadoDuelo => ({ k: 1, ganador, motivo, rondas: [0, 0], estadisticas: null, duracionSeg: 0 })
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
