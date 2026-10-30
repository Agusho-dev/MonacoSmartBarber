/**
 * Revisión adversarial del motor (30/oct/2026, elenco de 13): cadenas infinitas o casi, bordes,
 * empates, KO doble, el remate «¡AL CERO!», tiempo agotado, estados al terminar el round y el
 * determinismo. Escenarios con entradas guionadas y, al final, miles de partidas CPU contra CPU y
 * de bots que buscan encierros (cuánto tiempo seguido queda alguien sin poder hacer nada).
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs cadenas.mts [--partidas=N]
 */
import type { EntradaJugador, EventoJuego, IdPersonaje, Lado, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida } from '../../../src/lib/juego/motor/index.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { puedeActuar } from '../../../src/lib/juego/motor/cuerpo.ts'
import { EFECTO, X_MAX, X_MIN } from '../../../src/lib/juego/motor/constantes.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES, PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import { hashPartida } from '../../../src/lib/juego/online/hash.ts'

const K = MOVIMIENTOS
const TIPICA: Record<string, [number, number[]]> = {
  quieto: [5, []], caminar: [6, []], correr: [4, []], dash: [3, []], guardia: [4, []], agachado: [4, []],
  saltar: [4, []], caer: [6, []], golpe: [5, [4]], patada: [4, [2]], combo: [8, [2, 5, 7]], herramienta1: [4, [2]],
  herramienta2: [3, [1]], especial1: [5, [3]], especial2: [6, [2]], danio: [5, []], ko: [3, []], levantarse: [5, []],
  victoria: [6, []], burla: [8, []],
}
function meta(): MetaAnimaciones {
  const m = {} as MetaAnimaciones
  for (const c of CLAVES_ANIMACION) m[c] = { n: TIPICA[c][0], impactos: TIPICA[c][1] }
  return m
}

let fallas = 0
let pruebas = 0
function ok(cond: boolean, nombre: string, detalle = '') {
  pruebas++
  if (!cond) fallas++
  console.log(`${cond ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ' — ' + detalle : ''}`)
}

type Gen = (t: number, p: Partida) => [Partial<EntradaJugador>, Partial<EntradaJugador>]

function nueva(pj: [IdPersonaje, IdPersonaje], x0 = 330, x1 = 630, semilla = 7, cpu: [boolean, boolean] = [false, false]): Partida {
  const p = crearPartida({ personajes: pj, cpu, dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
  while (p.fase !== 'pelea') avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
  p.eventos.splice(0)
  p.luchadores[0].x = x0
  p.luchadores[1].x = x1
  return p
}

function correr(p: Partida, n: number, gen: Gen = () => [{}, {}], hastaFin = false): EventoJuego[] {
  const evs: EventoJuego[] = []
  for (let t = 0; t < n; t++) {
    const [a, b] = gen(t, p)
    avanzar(p, [{ ...ENTRADA_VACIA, ...a }, { ...ENTRADA_VACIA, ...b }])
    evs.push(...p.eventos.splice(0))
    if (!hastaFin && p.fase !== 'pelea' && p.fase !== 'final') break
    if (p.fase === 'terminada') break
  }
  return evs
}
const de = <T extends EventoJuego['tipo']>(evs: EventoJuego[], tipo: T) => evs.filter((e) => e.tipo === tipo) as Extract<EventoJuego, { tipo: T }>[]
/** Apretar en el tick t sólo si t es par (flancos). */
const cada2 = (t: number) => t % 2 === 0

// ─── Las cadenas salen del contacto: un golpe al aire no encadena ───
{
  const p = nueva(['simon', 'chipi'], 300, 700)
  const evs = correr(p, 90, (t) => [{ golpe: cada2(t) }, {}])
  const sw = de(evs, 'swing').filter((s) => s.quien === 0)
  ok(sw.length > 0 && sw.every((s) => s.herramienta === 'puno'), 'cadena: al aire no sale la patada (sólo puños)', sw.map((s) => s.herramienta).join(','))
  const p2 = nueva(['simon', 'chipi'], 400, 480)
  const evs2 = correr(p2, 60, (t) => [{ golpe: cada2(t) }, {}])
  const h2 = de(evs2, 'golpe').filter((g) => g.atacante === 0).map((g) => g.herramienta)
  ok(de(evs2, 'swing').some((s) => s.quien === 0 && s.herramienta === 'patada') && h2.length >= 3, 'cadena: con contacto sale puño → patada → combo', h2.join(','))
  const p3 = nueva(['simon', 'chipi'], 400, 480)
  const evs3 = correr(p3, 60, (t) => [{ golpe: cada2(t) }, { guardia: true }])
  ok(de(evs3, 'golpe').filter((g) => g.atacante === 0 && g.bloqueado).length >= 3, 'cadena: bloqueada también encadena')
  // Cancelar en especial también pide contacto: al aire, el especial sale recién al terminar el puño.
  const p4 = nueva(['simon', 'chipi'], 300, 700)
  p4.luchadores[0].carga = 10
  let tEsp = -1
  let tPuno = -1
  correr(p4, 60, (t, q) => {
    if (tPuno < 0 && q.luchadores[0].movimiento === 'puno') tPuno = t
    if (tEsp < 0 && q.luchadores[0].movimiento === 'corte_relampago') tEsp = t
    return [{ golpe: t === 0, especial1: t === 9 }, {}]
  })
  ok(tEsp >= 0 && tEsp - tPuno >= K.simon.movimientos.puno.total - 1, 'cancelar en especial: al aire espera a que termine el puño', `puño ${tPuno}, especial ${tEsp}`)
}

// ─── Estados de control: no se refrescan mientras duran (ni se encadenan después) ───
// Con carga infinita, se vuelve a tirar el especial mientras el rival sigue con el estado: el
// segundo pega pero no puede renovarlo (sin contar los ticks congelados del super flash y el
// hitstop, el estado dura lo mismo que uno solo).
function estadoMaximo(pj: [IdPersonaje, IdPersonaje], x1: number, n: 1 | 2, efecto: 'aturdido' | 'mareado' | 'electrocutado' | 'quemado', segundoEn: (q: Partida) => boolean) {
  const p = nueva(pj, 330, x1)
  let seguidos = 0
  let max = 0
  let renovaciones = 0
  let previo = 0
  let segundos = 0
  const clave = n === 1 ? 'especial1' : 'especial2'
  correr(p, 420, (t, q) => {
    q.luchadores[0].carga = 10
    const v = q.luchadores[1].efectos[efecto]
    if (v > previo && previo > 0) renovaciones++
    previo = v
    if (q.congelamientoGolpe === 0) {
      if (v > 0) seguidos++
      else seguidos = 0
      max = Math.max(max, seguidos)
    }
    const quiere = t < 2 || segundoEn(q)
    if (quiere && t >= 2 && q.luchadores[0].movimiento === null) segundos++
    return [{ [clave]: quiere && cada2(t) }, {}]
  })
  return { max, renovaciones, segundos }
}
{
  const tb = K.nico_u.especiales[0].proyectil?.ticksEfecto ?? 70
  const r = estadoMaximo(['nico_u', 'simon'], 560, 1, 'aturdido', (q) => q.luchadores[1].efectos.aturdido > 0 && q.luchadores[1].efectos.aturdido < 40)
  ok(r.renovaciones === 0 && r.max <= tb + 2 && r.segundos > 0, 'aturdido: un bombo encima de otro no alarga el aturdido', `${r.max} ticks (uno solo: ${tb}), ${r.renovaciones} renovaciones`)
  const tm = K.guillermo.especiales[0].proyectil?.ticksEfecto ?? 120
  const r2 = estadoMaximo(['guillermo', 'simon'], 520, 1, 'mareado', (q) => q.luchadores[1].efectos.mareado > 0 && q.luchadores[1].efectos.mareado < 60)
  ok(r2.renovaciones === 0 && r2.max <= tm + 2 && r2.segundos > 0, 'mareado: un trago encima de otro no alarga el mareo', `${r2.max} ticks (uno solo: ${tm}), ${r2.renovaciones} renovaciones`)
  const r3 = estadoMaximo(['simon', 'chipi'], 560, 1, 'electrocutado', (q) => q.luchadores[1].efectos.electrocutado > 0 && q.luchadores[1].efectos.electrocutado < 30)
  ok(r3.renovaciones === 0 && r3.max <= EFECTO.electrocutado + 2, 'electrocutado: dos Cortes Relámpago no lo alargan', `${r3.max} ticks, ${r3.renovaciones} renovaciones`)
  const tq = K.stefano.especiales[1].proyectil?.ticksEfecto ?? 180
  const r4 = estadoMaximo(['stefano', 'simon'], 460, 2, 'quemado', (q) => q.luchadores[1].efectos.quemado > 0 && q.luchadores[1].efectos.quemado < 120)
  ok(r4.renovaciones === 0 && r4.max <= tq + 2 && r4.segundos > 0, 'quemado: dos termos no alargan la quemadura', `${r4.max} ticks (uno solo: ${tq}), ${r4.renovaciones} renovaciones`)
}

// ─── Contra la pared: GOLPE → especial → GOLPE → especial no se sostiene ───
// (simular.mts encontró a Gabriel encadenando cadena + Break Dance contra la pared: 20 golpes y
// 6 s sin que el otro se pudiera mover. Con carga infinita, el combo se tiene que caer igual.)
for (const id of ['gabriel', 'simon', 'nico_u', 'luciano', 'joaquin'] as IdPersonaje[]) {
  const p = nueva([id, 'fabri'], 150, 75)
  let maxCombo = 0
  let seguidos = 0
  let peor = 0
  correr(p, 900, (t, q) => {
    q.luchadores[0].carga = 10
    maxCombo = Math.max(maxCombo, q.luchadores[0].combo)
    const vi = internoDe(q).luchadores[1]
    if (q.congelamientoGolpe === 0) {
      if (!puedeActuar(q.luchadores[1], vi)) seguidos++
      else seguidos = 0
      peor = Math.max(peor, seguidos)
    }
    const k = MOVIMIENTOS[id].cpu.especialDeCombo || 1
    return [{ golpe: cada2(t), [k === 1 ? 'especial1' : 'especial2']: t % 4 === 1 }, {}]
  })
  ok(maxCombo <= 16 && peor <= 240, `contra la pared con ${id}: el combo se cae solo`, `combo máx ${maxCombo}, ${peor} ticks seguidos sin moverse`)
}

// ─── Agarre: no sigue apretando después del «¡TIEMPO!», y un re-agarre se escapa saltando ───
{
  const p = nueva(['brian', 'simon'], 330, 420)
  p.luchadores[0].carga = 10
  p.tiempoRestante = 40
  let golpesDespues = 0
  let vidaEnTiempo = -1
  let enTiempo = false
  const evs = correr(
    p,
    400,
    (t, q) => {
      if (q.fase === 'tiempo' && !enTiempo) {
        enTiempo = true
        vidaEnTiempo = q.luchadores[1].vida
      }
      return [{ especial1: t < 2 }, {}]
    },
    true,
  )
  let fase = false
  for (const e of evs) {
    if (e.tipo === 'tiempo') fase = true
    else if (fase && e.tipo === 'golpe') golpesDespues++
  }
  ok(de(evs, 'agarre').length === 1 && de(evs, 'tiempo').length === 1, 'agarre en el final del reloj: agarra y se acaba el tiempo')
  ok(golpesDespues === 0, 'agarre: después del «¡TIEMPO!» no aprieta ni tira', `${golpesDespues} golpes después (vida al «¡TIEMPO!» ${vidaEnTiempo})`)
  ok(p.fase !== 'tiempo' || p.luchadores[1].estado !== 'agarrado', 'agarre: al terminar el round nadie queda colgado')
}
{
  // Re-agarre al levantarse: si el rival salta apenas puede, el segundo agarre no entra. Y si no
  // hace nada, entra (no es un error: es la lectura de Brian), pero la carga no da para un tercero.
  const reagarre = (salta: boolean) => {
    const p = nueva(['brian', 'simon'], 330, 420)
    p.luchadores[0].carga = 10
    let fueAgarrado = false
    const evs = correr(p, 420, (t, q) => {
      const v = q.luchadores[1]
      if (v.estado === 'agarrado') fueAgarrado = true
      const libre = puedeActuar(v, internoDe(q).luchadores[1])
      const brianLibre = q.luchadores[0].movimiento === null
      return [{ especial1: brianLibre && cada2(t) && Math.abs(v.x - q.luchadores[0].x) < 110 }, { arriba: salta && fueAgarrado && libre }]
    })
    return { agarres: de(evs, 'agarre').length, carga: p.luchadores[0].carga }
  }
  const a = reagarre(true)
  ok(a.agarres === 1, 'agarre: el que salta al levantarse no vuelve a ser agarrado', `${a.agarres} agarres`)
  const b = reagarre(false)
  ok(b.agarres <= 2, 'agarre: sin carga no hay un tercero', `${b.agarres} agarres, carga ${b.carga.toFixed(1)}`)
}

// ─── El remate «¡AL CERO!» espera a que el ganador se pueda mover ───
{
  // Simón deja a Chipi en 1 y le pega: KO que define la partida (fase final). En ese mismo
  // momento lo tiramos al piso a él (como un intercambio de golpes): el remate tiene que esperar.
  const q = nueva(['simon', 'chipi'], 400, 480)
  q.rondasGanadas[0] = 1
  q.luchadores[1].vida = 1
  let f = -1
  let libre = -1
  let tRemate = -1
  const evs = correr(
    q,
    400,
    (t, x) => {
      const I = internoDe(x)
      if (x.fase === 'final' && f < 0) {
        f = t
        I.luchadores[0].derribo = 50
      }
      if (f >= 0 && libre < 0 && I.luchadores[0].derribo === 0 && I.luchadores[0].levantar === 0) libre = t
      if (tRemate < 0 && x.luchadores[0].movimiento === 'remate') tRemate = t
      return [{ golpe: f < 0 ? t < 2 : cada2(t) }, {}]
    },
    true,
  )
  ok(f >= 0, 'remate: la pelea llega a la fase final')
  const remate = evs.some((e) => e.tipo === 'final_al_cero')
  ok(!remate || (libre >= 0 && tRemate >= libre), 'remate: no sale tirado en el piso', `final ${f}, libre ${libre}, remate ${tRemate}`)
  ok(q.fase === 'terminada' && q.ganadorPartida === 0, 'remate: la partida termina con el ganador')
}

// ─── KO doble: sobrevive uno con 1 de vida y la partida sigue ───
{
  const p = nueva(['simon', 'simon'], 430, 530)
  p.luchadores[0].vida = 1
  p.luchadores[1].vida = 1
  let vidasKO = ''
  const evs = correr(
    p,
    2000,
    (t, q) => {
      if (!vidasKO && (q.fase === 'ko' || q.fase === 'final')) vidasKO = q.luchadores.map((l) => l.vida).join('/')
      return [{ golpe: t === 0 }, { golpe: t === 0 }]
    },
    true,
  )
  const ko = de(evs, 'ko')
  const golpes = de(evs, 'golpe').filter((g) => !g.bloqueado)
  ok(ko.length >= 1 && golpes.length >= 2 && (vidasKO === '1/0' || vidasKO === '0/1'), 'KO doble: los dos pegan en el mismo tick, gana uno y queda con 1', `vidas al KO ${vidasKO}, golpes ${golpes.length}`)
  ok(p.fase === 'terminada' || p.round === 2, 'KO doble: la partida sigue sola', `fase ${p.fase}, round ${p.round}`)
}

// ─── Tiempo con empate exacto: siempre hay ganador y sigue el round siguiente ───
{
  const p = nueva(['simon', 'simon'], 300, 660)
  p.tiempoRestante = 5
  const evs = correr(p, 400, () => [{}, {}], true)
  const t = de(evs, 'tiempo')
  ok(t.length === 1 && t[0].ganador !== null && p.round === 2, 'tiempo empatado: gana uno (la moneda) y sigue', `ganador ${t[0]?.ganador}, round ${p.round}`)
}

// ─── Al empezar un round no queda nada del anterior ───
{
  const p = nueva(['stefano', 'lucas'], 330, 470)
  p.luchadores[0].carga = 10
  p.luchadores[1].carga = 10
  // Termo + pañal y el reloj por terminar: los dos con estados y proyectiles encima.
  p.tiempoRestante = 70
  let limpio = true
  let revisados = 0
  correr(
    p,
    600,
    (t, q) => {
      if (q.fase === 'anuncio' && q.ticksFase === 1) {
        revisados++
        for (const l of q.luchadores) {
          const ef = l.efectos
          if (ef.aturdido || ef.mareado || ef.quemado || ef.lento || ef.curando || ef.congelado || ef.electrocutado || ef.guardiaRota) limpio = false
          if (l.vida !== l.vidaMax || l.x === 0) limpio = false
        }
        if (q.proyectiles.length) limpio = false
        const I = internoDe(q)
        for (const li of I.luchadores) if (li.quema || li.agarradoPor !== null || li.accion) limpio = false
      }
      return [{ especial2: t < 2 }, { especial2: t >= 30 && t < 32 }]
    },
    true,
  )
  ok(limpio && revisados >= 1 && p.round >= 2, 'round nuevo: sin estados, proyectiles, quemadura ni agarre del anterior', `round ${p.round}, ${revisados} revisado(s)`)
}

// ─── Volumen: CPU contra CPU y bots, buscando encierros y bordes ───
interface Encierro {
  ticks: number
  quien: string
  contra: string
  semilla: number
}
const args = process.argv.slice(2)
const PARTIDAS = Number(args.find((a) => a.startsWith('--partidas='))?.split('=')[1] ?? 2)
let peor: Encierro = { ticks: 0, quien: '', contra: '', semilla: 0 }
let fueraDeBorde = 0
let maxProy = 0
let noTerminan = 0
let vidaMala = 0
const hashes: string[] = []
for (const dif of ['facil', 'normal', 'dificil'] as const) {
  for (const a of IDS_PERSONAJES) {
    for (const b of IDS_PERSONAJES) {
      for (let s = 0; s < PARTIDAS; s++) {
        const semilla = 1 + s * 1009 + a.length * 31 + b.length * 7
        const p = crearPartida({ personajes: [a, b], cpu: [true, true], dificultad: dif, arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
        const I = internoDe(p)
        const seguidos: [number, number] = [0, 0]
        let h = 0
        while (p.fase !== 'terminada' && p.tick < 6 * 3600) {
          avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
          p.eventos.length = 0
          if (p.tick % 60 === 0) h = (Math.imul(h ^ hashPartida(p), 0x01000193) >>> 0)
          maxProy = Math.max(maxProy, p.proyectiles.length)
          for (const lado of [0, 1] as const) {
            const l = p.luchadores[lado]
            const li = I.luchadores[lado]
            if (l.x < X_MIN || l.x > X_MAX || l.y < 0 || !Number.isFinite(l.x)) fueraDeBorde++
            if (l.vida > l.vidaMax || l.vida < 0 || !Number.isFinite(l.vida)) vidaMala++
            const sinControl = p.fase === 'pelea' && p.congelamientoGolpe === 0 && !puedeActuar(l, li) && li.accion === null && li.dash === null && l.enSuelo !== false
            const enElAire = p.fase === 'pelea' && !l.enSuelo && (li.caidaDerribo > 0 || li.agarradoPor !== null)
            if (sinControl || enElAire) seguidos[lado]++
            else if (p.fase === 'pelea' && p.congelamientoGolpe === 0) seguidos[lado] = 0
            if (seguidos[lado] > peor.ticks) peor = { ticks: seguidos[lado], quien: l.id, contra: p.luchadores[(1 - lado) as Lado].id, semilla }
          }
        }
        if (p.fase !== 'terminada') noTerminan++
        if (dif === 'normal' && s === 0) hashes.push(`${a}-${b}:${h.toString(16)}`)
      }
    }
  }
}
ok(fueraDeBorde === 0, 'bordes: nadie sale del escenario', `${fueraDeBorde} ticks afuera`)
ok(vidaMala === 0, 'vida: nunca negativa ni por encima del máximo')
ok(noTerminan === 0, 'todas las partidas terminan', `${noTerminan} sin terminar`)
ok(maxProy <= 16, 'proyectiles: no se acumulan', `máx ${maxProy} a la vez`)
// El encierro más largo (sin poder actuar, sin contar el hitstop ni los super flash): un derribo
// largo + levantarse ronda los 80 ticks; guardia rota → agarre → derribo, ≈ 210. Nada debería pasar de 4 s.
ok(peor.ticks <= 240, 'encierros: nadie queda más de 4 s seguidos sin poder hacer nada', `${peor.ticks} ticks (${peor.quien} contra ${peor.contra}, semilla ${peor.semilla})`)

// ─── Determinismo: dos corridas iguales dan el mismo hash, tick por tick ───
{
  const ids = IDS_PERSONAJES
  let iguales = true
  let distintosEntreSemillas = 0
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]
    const b = ids[(i + 5) % ids.length]
    const corrida = (semilla: number) => {
      const p = crearPartida({ personajes: [a, b], cpu: [true, true], dificultad: 'dificil', arena: 'parana', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
      const hs: number[] = []
      while (p.fase !== 'terminada' && p.tick < 6 * 3600) {
        avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
        p.eventos.length = 0
        hs.push(hashPartida(p))
      }
      return hs
    }
    const x = corrida(4242 + i)
    const y = corrida(4242 + i)
    if (x.length !== y.length || x.some((v, j) => v !== y[j])) iguales = false
    const z = corrida(9999 + i)
    if (z.length !== x.length || z.some((v, j) => v !== x[j])) distintosEntreSemillas++
  }
  ok(iguales, 'determinismo: misma semilla → mismo hash en cada tick (13 cruces)')
  ok(distintosEntreSemillas === ids.length, 'determinismo: otra semilla → otra partida', `${distintosEntreSemillas}/${ids.length}`)
}

console.log(`\n${pruebas - fallas}/${pruebas} pruebas ok${fallas ? ` — ${fallas} FALLAS` : ''}`)
void PERSONAJES
process.exit(fallas ? 1 : 0)
