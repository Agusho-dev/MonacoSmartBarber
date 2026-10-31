/**
 * La presencia de la sala llega TARDE (prod-online, 30/oct/2026): el eco propio vuelve en ≈ 0,2 s
 * pero el cambio tarda 0,3–2,8 s en llegarle al otro, y al volver a la sala después de un duelo el
 * rival seguía «Peleando» o «Eligiendo barbero» con DESAFIAR deshabilitado. Con la Sala REAL
 * (sala.ts) sobre el realtime-js instalado y la red de mentira de duelo-red.mts, con 2,5 s de
 * atraso de la presencia entre «nodos» (reloj virtual).
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs duelo-sala.mts
 *
 * Verifica: el rival libre se ve libre enseguida (y se lo puede desafiar), el orden de dos cambios
 * seguidos (libre y enseguida eligiendo) no se pisa cuando llega la presencia vieja, la sala de un
 * tercero también se entera, y cuántos mensajes cuesta. Sale con código 1 si algo no da.
 */
import { Reloj, Red, Verificador, VERSION_REALTIME, type ClienteDePrueba } from './duelo-red.mts'
import { Sala, type JugadorSala } from '../../../src/lib/juego/online/sala.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

const reloj = new Reloj()
reloj.instalar()
const v = new Verificador()
const ATRASO = 2500
const LATENCIA = 90

const red = new Red(reloj, { latenciaMs: LATENCIA, atrasoPresenciaMs: ATRASO })

function entrar(cel: string, nombre: string): { sala: Sala; cliente: ClienteDePrueba } {
  const cliente = red.crearCliente(cel)
  const sala = new Sala({ slug: 'prueba', cliente: () => cliente as unknown as SupabaseClient, ahora: () => reloj.t })
  sala.setNombre(nombre)
  sala.conectar()
  return { sala, cliente }
}

/** Cómo ve `quien` a `otro` (null = no lo ve). */
const ve = (quien: Sala, otro: Sala): JugadorSala | null => quien.leer().otros.find((j) => j.id === otro.leer().yo.id) ?? null

/** Corre hasta que `quien` vea a `otro` en `estado`; devuelve cuánto tardó (ms) o null. */
async function cuantoTarda(quien: Sala, otro: Sala, estado: JugadorSala['estado'], tope = 6000): Promise<number | null> {
  const t0 = reloj.t
  const ok = await reloj.correrMientras(() => ve(quien, otro)?.estado === estado, t0 + tope, 10)
  return ok ? reloj.t - t0 : null
}

console.log(`duelo-sala · realtime-js ${VERSION_REALTIME} · presencia con ${ATRASO} ms de atraso entre nodos, ${LATENCIA} ms de ida`)

const A = entrar('A', 'Ana')
const B = entrar('B', 'Beto')
const C = entrar('C', 'Caro')
await reloj.correrMientras(
  () => [A, B, C].every((x) => x.sala.leer().otros.length === 2),
  reloj.t + 15_000,
)
v.verificar([A, B, C].every((x) => x.sala.leer().otros.length === 2 && x.sala.leer().otros.every((j) => j.estado === 'libre')), 'los tres se ven libres en la sala')
await reloj.correrHasta(reloj.t + 5000)
const broadcastsAntes = red.servidor.broadcasts

// Ana y Beto se desafían: eligen, pelean y vuelven a la sala.
A.sala.setEstado('eligiendo')
B.sala.setEstado('eligiendo')
const tElige = await cuantoTarda(C.sala, B.sala, 'eligiendo')
v.verificar(tElige !== null && tElige < 600, `Caro ve a Beto «Eligiendo barbero» en ${tElige} ms (la presencia tarda ${ATRASO})`)
await reloj.correrHasta(reloj.t + 20_000)
A.sala.setEstado('peleando')
B.sala.setEstado('peleando')
await reloj.correrHasta(reloj.t + 60_000)
v.verificar(ve(A.sala, B.sala)?.estado === 'peleando' && ve(C.sala, A.sala)?.estado === 'peleando', 'en plena pelea se ven «Peleando»')

// Beto vuelve primero; Ana, un segundo después.
B.sala.setEstado('libre')
const tLibreA = await cuantoTarda(C.sala, B.sala, 'libre')
await reloj.correrHasta(reloj.t + 1000)
A.sala.setEstado('libre')
const tLibreB = await cuantoTarda(A.sala, B.sala, 'libre', 100)
const tAnaLibre = await cuantoTarda(B.sala, A.sala, 'libre')
v.verificar(tLibreA !== null && tLibreA < 600, `al volver a la sala, Caro ve a Beto libre en ${tLibreA} ms`)
v.verificar(tLibreB !== null, 'Ana, al volver, ya ve a Beto libre (DESAFIAR habilitado)')
v.verificar(tAnaLibre !== null && tAnaLibre < 600, `Beto ve a Ana libre en ${tAnaLibre} ms`)
// Ana desafía a Beto enseguida: antes, DESAFIAR quedaba deshabilitado hasta 3 s.
A.sala.desafiar(B.sala.leer().yo.id)
const llega = await reloj.correrMientras(() => B.sala.leer().entrante?.de.id === A.sala.leer().yo.id, reloj.t + 2000, 10)
v.verificar(A.sala.leer().saliente?.estado === 'esperando' && llega, 'Ana puede desafiar a Beto apenas vuelven, y le llega')
B.sala.rechazar('no')
await reloj.correrHasta(reloj.t + 5000)

// Dos cambios seguidos: Beto queda libre y enseguida acepta a Caro (eligiendo). La presencia vieja
// («libre») llega después del broadcast nuevo y no lo tiene que pisar.
B.sala.setEstado('peleando')
await reloj.correrHasta(reloj.t + 40_000)
B.sala.setEstado('libre')
await reloj.correrHasta(reloj.t + 400)
B.sala.setEstado('eligiendo')
const tSeguido = await cuantoTarda(A.sala, B.sala, 'eligiendo')
const vistos: string[] = []
const tFin = reloj.t + 8000
while (reloj.t < tFin) {
  await reloj.correrHasta(reloj.t + 50)
  const e = ve(A.sala, B.sala)?.estado ?? '—'
  if (vistos[vistos.length - 1] !== e) vistos.push(e)
}
v.verificar(tSeguido !== null && tSeguido < 1000, `libre y enseguida eligiendo: Ana ve «Eligiendo» en ${tSeguido} ms`)
v.verificar(vistos.length === 1 && vistos[0] === 'eligiendo', `la presencia vieja no lo pisa (Ana ve a Beto: ${vistos.join(' → ')})`)

// Presupuesto: un broadcast por cambio de estado, a cada uno de los otros dos.
const cambios = 2 + 2 + 2 + 3
const estados = red.servidor.broadcasts - broadcastsAntes
v.verificar(estados <= cambios * 2 + 4, `mensajes: ${estados} entregas de broadcast para ${cambios} cambios de estado y un desafío (tope ${cambios * 2 + 4})`)

// ─── Un «estado» falso por broadcast (el canal es público) no le gana a la presencia ───────────
// Hasta el 31/oct, {de: <otro>, e: 'peleando', s: 999999999} dejaba a ese jugador «Peleando» (con
// DESAFIAR deshabilitado) para todos mientras siguiera en la sala.
B.sala.setEstado('libre')
await reloj.correrHasta(reloj.t + 6000)
v.verificar(ve(A.sala, B.sala)?.estado === 'libre', 'antes de la prueba, Ana ve a Beto libre')
const malo = red.crearCliente('M')
const canalMalo = malo.channel('juego-sala:prueba', { config: { broadcast: { self: false, ack: false } } })
canalMalo.subscribe()
await reloj.correrMientras(() => String(canalMalo.state) === 'joined', reloj.t + 5000)
const idBeto = B.sala.leer().yo.id
/** El número de la presencia de Beto según Ana (privado: sólo para la prueba). */
const sBeto = () => (A.sala as unknown as { presencias: Map<string, { s: number }> }).presencias.get(idBeto)?.s ?? -1
const falso = (e: string, s: number) => void canalMalo.send({ type: 'broadcast', event: 'estado', payload: { de: idBeto, e, s } })
/** Lo que Ana ve de Beto durante `ms` (cada 50 ms, los cambios). */
async function mirar(ms: number): Promise<{ t: number; e: string }[]> {
  const vistos: { t: number; e: string }[] = []
  const t0 = reloj.t
  while (reloj.t < t0 + ms) {
    await reloj.correrHasta(reloj.t + 50)
    const e = ve(A.sala, B.sala)?.estado ?? '—'
    if (vistos[vistos.length - 1]?.e !== e) vistos.push({ t: reloj.t - t0, e })
  }
  return vistos
}
const texto = (x: { t: number; e: string }[]) => x.map((p) => `${(p.t / 1000).toFixed(2)}s ${p.e}`).join(' → ')

// 1) Un número imposible: no se cree nunca.
falso('peleando', 999_999_999)
const imposible = await mirar(12_000)
v.verificar(imposible.length === 1 && imposible[0].e === 'libre', `un «estado» falso con s = 999999999: Ana sigue viendo a Beto libre (${texto(imposible)})`)

// 2) Un número creíble (el siguiente al de su presencia): dura a lo sumo lo que tarda en vencer.
falso('peleando', sBeto() + 1)
const creible = await mirar(12_000)
const volvio = creible.find((p, i) => i > 0 && p.e === 'libre')
v.verificar(
  creible.every((p) => p.e === 'libre' || p.e === 'peleando') && creible[creible.length - 1].e === 'libre' && (volvio === undefined || volvio.t <= 8600),
  `un «estado» falso creíble (s + 1): Beto vuelve a «libre» cuando vence, a lo sumo en 8,6 s (${texto(creible)})`,
)

// 3) Insistir: con la pista vencida sin que la presencia la alcanzara, a Beto no se le cree otra
//    hasta que su presencia avance.
falso('peleando', sBeto() + 2)
await reloj.correrHasta(reloj.t + 3000)
falso('eligiendo', sBeto() + 3)
const insiste = await mirar(10_000)
v.verificar(insiste.length === 1 && insiste[0].e === 'libre', `insistir con otro «estado» falso no sirve: Ana ve a Beto libre (${texto(insiste)})`)

// 4) Beto cambia de verdad: su presencia avanza, se le vuelve a creer y el broadcast vuelve a adelantar.
B.sala.setEstado('eligiendo')
const tVerdad = await cuantoTarda(A.sala, B.sala, 'eligiendo')
await reloj.correrHasta(reloj.t + 6000)
B.sala.setEstado('libre')
const tVuelve = await cuantoTarda(A.sala, B.sala, 'libre')
v.verificar(
  tVerdad !== null && tVuelve !== null && tVuelve < 600,
  `después, los cambios de verdad de Beto se ven: «Eligiendo» en ${tVerdad} ms (por la presencia: su pista se ignoró) y «libre» en ${tVuelve} ms (por broadcast, confiable otra vez)`,
)
void malo.removeChannel(canalMalo)

for (const x of [A, B, C]) x.sala.desconectar()
await reloj.correrHasta(reloj.t + 2000)
v.verificar(reloj.errores.length === 0, `sin excepciones en los temporizadores (${reloj.errores.length})`)
for (const e of reloj.errores.slice(0, 5)) console.log('   ', (e as Error)?.stack ?? e)
v.verificar(reloj.pedidosHttp.length === 0, `ningún mensaje cayó al POST por REST de realtime-js (${reloj.pedidosHttp.length})`)
console.log(`\n${v.fallas === 0 ? 'TODO OK' : `${v.fallas} FALLAS`} · ${v.ok} verificaciones · ${(reloj.t / 1000).toFixed(0)} s virtuales`)
process.exit(v.fallas === 0 ? 0 : 1)
