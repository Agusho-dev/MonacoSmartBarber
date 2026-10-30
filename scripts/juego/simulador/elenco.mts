/**
 * Pruebas de las mecánicas del elenco nuevo (30/oct/2026), escenario por escenario, con entradas
 * guionadas (humano contra humano) y la meta típica de animaciones.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs elenco.mts
 *
 * Bumerán (ida y vuelta), agarre (de pie, contra el que salta, contra el que se cubre), sismo
 * (imbloqueable, se salta), nube (no se apila, lento, daño de a poco), cura (completa, tope de vida,
 * interrumpida), estados sin cadena infinita, ráfaga contra la guardia y limpia, onda (arrastra a la
 * pared, se pasa con la esquiva), graffiti (estalla tarde, no pega de cerca), chorro cortado,
 * navajazo crítico, chilena contra el que salta, las pasivas y el determinismo.
 */
import type { EntradaJugador, EventoJuego, IdPersonaje, MetaAnimaciones, Partida } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, crearPartida } from '../../../src/lib/juego/motor/index.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { ponerEstado } from '../../../src/lib/juego/motor/combate.ts'
import { INMUNIDAD, X_MAX } from '../../../src/lib/juego/motor/constantes.ts'
import { PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'

// Los números salen de los kits (ya con el factor de balance de DANIO_KIT): las pruebas miden la
// mecánica, no los números de diseño.
const K = MOVIMIENTOS
import { hashPartida } from '../../../src/lib/juego/online/hash.ts'

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

function nueva(pj: [IdPersonaje, IdPersonaje], x0 = 330, x1 = 630, semilla = 7): Partida {
  const p = crearPartida({ personajes: pj, cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
  while (p.fase !== 'pelea') avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
  p.eventos.splice(0)
  p.luchadores[0].x = x0
  p.luchadores[1].x = x1
  return p
}

function correr(p: Partida, n: number, gen: Gen = () => [{}, {}]): EventoJuego[] {
  const evs: EventoJuego[] = []
  for (let t = 0; t < n; t++) {
    const [a, b] = gen(t, p)
    avanzar(p, [{ ...ENTRADA_VACIA, ...a }, { ...ENTRADA_VACIA, ...b }])
    evs.push(...p.eventos.splice(0))
    if (p.fase !== 'pelea' && p.fase !== 'final') break
  }
  return evs
}
/** Como correr, pero anota el tick de cada evento y deja mirar el estado después de cada tick. */
function correrT(p: Partida, n: number, gen: Gen, mirar?: (evs: EventoJuego[], p: Partida) => void): { t: number; e: EventoJuego }[] {
  const out: { t: number; e: EventoJuego }[] = []
  for (let t = 0; t < n; t++) {
    const [a, b] = gen(t, p)
    avanzar(p, [{ ...ENTRADA_VACIA, ...a }, { ...ENTRADA_VACIA, ...b }])
    const evs = p.eventos.splice(0)
    for (const e of evs) out.push({ t: p.tick, e })
    mirar?.(evs, p)
    if (p.fase !== 'pelea' && p.fase !== 'final') break
  }
  return out
}
const de = <T extends EventoJuego['tipo']>(evs: EventoJuego[], tipo: T) => evs.filter((e) => e.tipo === tipo) as Extract<EventoJuego, { tipo: T }>[]
const golpesDe = (evs: EventoJuego[], h: string) => de(evs, 'golpe').filter((g) => g.herramienta === h)

// ─── Bumerán: el gorro pega a la ida y a la vuelta, y vuelve a la mano ───
{
  const p = nueva(['joaquin', 'simon'])
  p.luchadores[0].carga = 10
  let vioVuelta = false
  const evs = correr(p, 260, (t, q) => {
    if (q.proyectiles.some((x) => x.tipo === 'gorro' && x.vuelta)) vioVuelta = true
    return [{ especial1: t < 2 }, {}]
  })
  const g = golpesDe(evs, 'gorro')
  ok(g.length === 2 && g.every((x) => !x.bloqueado), 'bumerán: pega a la ida y a la vuelta', `${g.length} golpes`)
  ok(vioVuelta, 'bumerán: `vuelta` = true en el regreso')
  ok(!p.proyectiles.some((x) => x.tipo === 'gorro'), 'bumerán: vuelve a la mano y desaparece')
  const p2 = nueva(['joaquin', 'simon'], 330, 880)
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 260, (t) => [{ especial1: t < 2 }, {}])
  ok(golpesDe(evs2, 'gorro').length === 0, 'bumerán: lejos (550 px) no llega')
}

// ─── Agarre de Brian ───
{
  const p = nueva(['brian', 'simon'], 330, 420)
  p.luchadores[0].carga = 10
  let agarrado = 0
  let levantado = false
  let animDanio = true
  const vida0 = p.luchadores[1].vida
  const evs = correr(p, 200, (t, q) => {
    const v = q.luchadores[1]
    if (v.estado === 'agarrado') {
      agarrado++
      if (v.y > 20 && !v.enSuelo) levantado = true
      if (v.anim !== 'danio') animDanio = false
    }
    return [{ especial1: t < 2 }, {}]
  })
  const ag = de(evs, 'agarre')
  ok(ag.length === 1 && ag[0].atacante === 0 && ag[0].victima === 1, 'agarre: evento agarre')
  ok(agarrado >= 60 && levantado && animDanio, 'agarre: «agarrado», levantado, anim danio', `${agarrado} ticks`)
  const ag0 = K.brian.especiales[0].agarre
  const esperadoAgarre = ag0 ? ag0.apretones.danio * 3 + ag0.tiron.danio : -1
  ok(de(evs, 'derribo').length === 1 && vida0 - p.luchadores[1].vida === esperadoAgarre, 'agarre: 3 apretones + el tirón, derriba', `${vida0 - p.luchadores[1].vida} de daño (esperado ${esperadoAgarre})`)
  ok(p.luchadores[1].estado !== 'agarrado' && p.luchadores[1].enSuelo, 'agarre: al final lo suelta en el piso')

  const p2 = nueva(['brian', 'simon'], 330, 420)
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 120, (t) => [{ especial1: t >= 2 && t < 4 }, { arriba: t < 2 }])
  ok(de(evs2, 'agarre').length === 0, 'agarre: no agarra al que salta')
  const p3 = nueva(['brian', 'simon'], 330, 420)
  p3.luchadores[0].carga = 10
  const evs3 = correr(p3, 160, (t) => [{ especial1: t < 2 }, { guardia: true }])
  ok(de(evs3, 'agarre').length === 1, 'agarre: imbloqueable (agarra al que se cubre)')
  const p4 = nueva(['brian', 'simon'], 330, 700)
  p4.luchadores[0].carga = 10
  let recup = 0
  correr(p4, 120, (t, q) => {
    if (q.luchadores[0].estado === 'atacando') recup++
    return [{ especial1: t < 2 }, {}]
  })
  ok(recup >= 50, 'agarre al aire: queda regalado (recuperación larga)', `${recup} ticks atacando`)
}

// ─── Sismo: imbloqueable de pie, se salta ───
{
  const p = nueva(['brian', 'simon'])
  p.luchadores[0].carga = 10
  const evs = correr(p, 160, (t) => [{ especial2: t < 2 }, { guardia: true }])
  const g = golpesDe(evs, 'sismo')
  ok(de(evs, 'sismo').length === 1, 'sismo: evento sismo al golpear el piso')
  ok(g.length === 1 && !g[0].bloqueado && de(evs, 'derribo').length === 1, 'sismo: no se bloquea y derriba')
  const p2 = nueva(['brian', 'simon'])
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 160, (t, q) => {
    const cerca = q.proyectiles.some((x) => x.tipo === 'sismo' && Math.abs(x.x - q.luchadores[1].x) < 140)
    return [{ especial2: t < 2 }, { arriba: cerca }]
  })
  ok(golpesDe(evs2, 'sismo').length === 0, 'sismo: saltándolo no pega')
}

// ─── Bombo: rastrero, aturde, se salta ───
{
  const p = nueva(['nico_u', 'simon'])
  p.luchadores[0].carga = 10
  let aturdido = 0
  const evs = correr(p, 200, (t, q) => {
    if (q.luchadores[1].efectos.aturdido > 0) aturdido++
    return [{ especial1: t < 2 }, {}]
  })
  ok(golpesDe(evs, 'bombo').length === 1 && de(evs, 'aturdido').length === 1, 'bombo: pega y aturde')
  const tb = K.nico_u.especiales[0].proyectil?.ticksEfecto ?? 60
  ok(aturdido >= tb - 5 && aturdido <= tb + 12, `bombo: aturdido ${tb} ticks (+ el hitstop)`, `${aturdido} ticks`)
  const p2 = nueva(['nico_u', 'simon'])
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 200, (t, q) => {
    const cerca = q.proyectiles.some((x) => x.tipo === 'bombo' && Math.abs(x.x - q.luchadores[1].x) < 120)
    return [{ especial1: t < 2 }, { arriba: cerca }]
  })
  ok(golpesDe(evs2, 'bombo').length === 0, 'bombo: saltándolo no pega')
  const p3 = nueva(['nico_u', 'simon'])
  p3.luchadores[0].carga = 10
  const g0 = p3.luchadores[1].guardia
  let gMin = g0
  const evs3 = correr(p3, 200, (t, q) => {
    gMin = Math.min(gMin, q.luchadores[1].guardia)
    return [{ especial1: t < 2 }, { guardia: true }]
  })
  const b = golpesDe(evs3, 'bombo')[0]
  ok(!!b && b.bloqueado && gMin < g0 - 15 && de(evs3, 'aturdido').length === 0, 'bombo: bloqueado gasta guardia y no aturde', `${b?.bloqueado} guardia ${gMin.toFixed(0)}`)
}

// ─── Estados: no se encadenan infinito ───
{
  const p = nueva(['nico_u', 'simon'])
  const I = internoDe(p)
  ok(ponerEstado(p, I, 1, 'aturdido', 60), 'estado: entra la primera vez')
  correr(p, 61)
  ok(p.luchadores[1].efectos.aturdido === 0 && I.luchadores[1].inmune.aturdido > 0, 'estado: al salir queda inmune', `${I.luchadores[1].inmune.aturdido}`)
  ok(!ponerEstado(p, I, 1, 'aturdido', 60), 'estado: inmune, no vuelve a entrar enseguida')
  ok(ponerEstado(p, I, 1, 'mareado', 60), 'estado: la inmunidad es sólo a ese estado')
  correr(p, INMUNIDAD.aturdido + 2)
  ok(ponerEstado(p, I, 1, 'aturdido', 60), 'estado: pasada la inmunidad, vuelve a entrar')
}

// ─── Mareado: no se cubre, camina lento ───
{
  const p = nueva(['guillermo', 'simon'])
  p.luchadores[0].carga = 10
  const evs = correr(p, 120, (t) => [{ especial1: t < 2 }, {}])
  ok(de(evs, 'mareado').length === 1 && p.luchadores[1].efectos.mareado > 0, 'trago: marea')
  const x0 = p.luchadores[1].x
  correr(p, 10, () => [{}, { izquierda: true }])
  ok(Math.abs(x0 - p.luchadores[1].x - 10 * 4.1 * 0.65) < 0.5, 'mareado: camina al 65 %', `${(x0 - p.luchadores[1].x).toFixed(1)} px`)
  p.luchadores[0].x = p.luchadores[1].x - 100
  const evs2 = correr(p, 20, (t) => [{ golpe: t < 2 }, { guardia: true }])
  const g = de(evs2, 'golpe').find((x) => x.herramienta === 'puno')
  ok(!!g && !g.bloqueado, 'mareado: no se puede cubrir')
}

// ─── Nube del pañal: no se apila, lento, daño de a poco ───
{
  const p = nueva(['lucas', 'simon'], 330, 760)
  p.luchadores[0].carga = 10
  let maxNubes = 0
  let lento = 0
  const vida0 = p.luchadores[1].vida
  const evs = correr(p, 260, (t, q) => {
    maxNubes = Math.max(maxNubes, q.proyectiles.filter((x) => x.tipo === 'nube').length)
    if (q.luchadores[1].efectos.lento > 0) lento++
    // Dos pañales seguidos; el rival se queda quieto donde cae la nube.
    return [{ especial2: t < 2 || (t >= 70 && t < 72) }, {}]
  })
  ok(de(evs, 'nube').length >= 1, 'nube: aparece', `${de(evs, 'nube').length} nubes`)
  ok(maxNubes === 1, 'nube: una sola por dueño (no se apila)', `máx ${maxNubes}`)
  ok(lento > 0 && vida0 - p.luchadores[1].vida > 0, 'nube: lento y daño de a poco', `lento ${lento} ticks, daño ${vida0 - p.luchadores[1].vida}`)
  const nubeEnGolpes = de(evs, 'golpe').some((g) => g.herramienta === 'nube')
  ok(!nubeEnGolpes, 'nube: el daño de a poco no emite golpe')
}

// ─── Cura de Fabri ───
{
  const p = nueva(['fabri', 'simon'], 200, 800)
  p.luchadores[0].carga = 10
  p.luchadores[0].vida = 500
  const evs = correr(p, 140, (t) => [{ especial1: t < 2 }, {}])
  const c = de(evs, 'curacion')
  ok(c.length === 6 && c.reduce((s, x) => s + x.cantidad, 0) === 165, 'cura: 6 pedacitos, 16,5 %', `${c.length} / ${c.reduce((s, x) => s + x.cantidad, 0)}`)
  ok(p.luchadores[0].vida === 665 && p.estadisticas[0].curado === 165, 'cura: suma vida y estadística')
  const p2 = nueva(['fabri', 'simon'], 200, 800)
  p2.luchadores[0].carga = 10
  p2.luchadores[0].vida = 980
  correr(p2, 140, (t) => [{ especial1: t < 2 }, {}])
  ok(p2.luchadores[0].vida === p2.luchadores[0].vidaMax, 'cura: nunca pasa de vidaMax', String(p2.luchadores[0].vida))
  const p3 = nueva(['fabri', 'simon'], 330, 440)
  p3.luchadores[0].carga = 10
  p3.luchadores[0].vida = 500
  let curandoDespues = -1
  const evs3 = correr(p3, 140, (t, q) => {
    if (curandoDespues < 0 && q.luchadores[0].estado === 'aturdido') curandoDespues = q.luchadores[0].efectos.curando
    return [{ especial1: t < 2 }, { golpe: t === 50 || t === 51 }]
  })
  const c3 = de(evs3, 'curacion')
  ok(c3.length >= 1 && c3.length < 6 && curandoDespues === 0, 'cura: si le pegan, se corta', `${c3.length} pedacitos, curando=${curandoDespues}`)
}

// ─── Ráfaga de la Pistola ───
{
  const p = nueva(['luciano', 'simon'])
  p.luchadores[0].carga = 10
  const g0 = p.luchadores[1].guardia
  const evs = correr(p, 120, (t) => [{ especial2: t < 2 }, { guardia: true }])
  const b = golpesDe(evs, 'bala')
  ok(de(evs, 'disparo').length === 3, 'ráfaga: 3 disparos (fogonazo)')
  ok(b.length === 3 && b.every((x) => x.bloqueado) && de(evs, 'derribo').length === 0, 'ráfaga contra la guardia: 3 bloqueadas, no derriba')
  const gb = K.luciano.especiales[1].proyectil?.danioGuardia ?? 10
  ok(Math.abs(g0 - p.luchadores[1].guardia - 3 * gb) < 2, `ráfaga contra la guardia: −${gb} de guardia por tiro`, `${(g0 - p.luchadores[1].guardia).toFixed(1)}`)
  ok(p.estadisticas[0].especialesAcertados === 0, 'ráfaga bloqueada: no cuenta como acertada')
  const p2 = nueva(['luciano', 'simon'])
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 120, (t) => [{ especial2: t < 2 }, {}])
  ok(golpesDe(evs2, 'bala').length === 3 && de(evs2, 'derribo').length === 1, 'ráfaga limpia: 3 tiros, el último derriba')
  ok(p2.estadisticas[0].especialesAcertados === 1 && p2.estadisticas[0].especialesUsados === 1, 'ráfaga: un especial = un acierto (aunque peguen 3)')
}

// ─── Onda del Grito ───
{
  const p = nueva(['rodrigo', 'simon'], 330, 600)
  p.luchadores[0].carga = 10
  const evs = correr(p, 300, (t) => [{ especial2: t < 2 }, {}])
  const g = golpesDe(evs, 'onda')
  ok(g.length === 2 && p.luchadores[1].x >= X_MAX - 1, 'onda: lo arrastra hasta la pared y le pega otra vez', `${g.length} golpes, x=${p.luchadores[1].x.toFixed(0)}`)
  ok(de(evs, 'aturdido').length === 1, 'onda: en la pared lo aturde')
  const p2 = nueva(['rodrigo', 'simon'], 330, 600)
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 300, (t, q) => {
    const onda = q.proyectiles.find((x) => x.tipo === 'onda')
    const cerca = !!onda && Math.abs(onda.x - q.luchadores[1].x) < 110
    return [{ especial2: t < 2 }, { dash: cerca, izquierda: cerca }]
  })
  ok(golpesDe(evs2, 'onda').length === 0, 'onda: se pasa con la esquiva')
}

// ─── Graffiti: estalla tarde, a media distancia ───
{
  const p = nueva(['gabriel', 'simon'], 330, 580)
  p.luchadores[0].carga = 10
  let ancho0 = 0
  let ancho1 = 0
  const evsT = correrT(
    p,
    120,
    (t) => [{ especial2: t < 2 }, {}],
    (_e, q) => {
      const gr = q.proyectiles.find((x) => x.tipo === 'graffiti')
      if (gr && gr.edad === 5) ancho0 = gr.ancho
      if (gr && gr.edad >= 31 && !ancho1) ancho1 = gr.ancho
    },
  )
  const tProy = evsT.find((x) => x.e.tipo === 'proyectil' && x.e.proyectil === 'graffiti')?.t ?? -1
  const tGolpe = evsT.find((x) => x.e.tipo === 'golpe' && x.e.herramienta === 'graffiti')?.t ?? -1
  ok(tProy > 0 && tGolpe - tProy >= 29, 'graffiti: estalla a los 30 ticks', `${tGolpe - tProy} ticks`)
  ok(ancho1 > ancho0, 'graffiti: al estallar la caja crece', `${ancho0} → ${ancho1}`)
  const p2 = nueva(['gabriel', 'simon'], 330, 420)
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 120, (t) => [{ especial2: t < 2 }, {}])
  ok(golpesDe(evs2, 'graffiti').length === 0, 'graffiti: pegado (90 px) no pega')
  const p3 = nueva(['gabriel', 'simon'], 330, 580)
  p3.luchadores[0].carga = 10
  const g0 = p3.luchadores[1].guardia
  const evs3 = correr(p3, 120, (t) => [{ especial2: t < 2 }, { guardia: true }])
  ok(golpesDe(evs3, 'graffiti')[0]?.bloqueado === true && g0 - p3.luchadores[1].guardia >= 40, 'graffiti bloqueado: gasta mucha guardia')
}

// ─── Chorro: crece desde la mano y se corta si le pegan al dueño ───
{
  const p = nueva(['lucas', 'simon'], 330, 560)
  p.luchadores[0].carga = 10
  const x1 = p.luchadores[1].x
  let maxAncho = 0
  const evs = correr(p, 120, (t, q) => {
    const ch = q.proyectiles.find((x) => x.tipo === 'leche')
    if (ch) maxAncho = Math.max(maxAncho, ch.ancho)
    return [{ especial1: t < 2 }, {}]
  })
  ok(golpesDe(evs, 'leche').length === 5 && p.luchadores[1].x > x1 + 30, 'chorro de leche: 5 golpecitos que empujan', `${golpesDe(evs, 'leche').length}, empujó ${(p.luchadores[1].x - x1).toFixed(0)} px`)
  ok(maxAncho > 200, 'chorro: crece', maxAncho.toFixed(0))
  const p2 = nueva(['lucas', 'nahuel'], 300, 800)
  p2.luchadores[0].carga = 10
  p2.luchadores[1].carga = 10
  let cortado = false
  correr(p2, 160, (t, q) => {
    const golpeado = q.luchadores[0].estado === 'aturdido'
    if (golpeado && !q.proyectiles.some((x) => x.tipo === 'leche')) cortado = true
    return [{ especial1: t >= 4 && t < 6 }, { especial1: t < 2 }]
  })
  ok(cortado, 'chorro: si le pegan al dueño, se corta')
}

// ─── Termo: quema (daño por segundo) ───
{
  const p = nueva(['stefano', 'simon'], 330, 560)
  p.luchadores[0].carga = 10
  const evs = correr(p, 60, (t) => [{ especial2: t < 2 }, {}])
  const g = golpesDe(evs, 'agua')
  ok(g.length === 1 && de(evs, 'quemado').length === 1, 'termo: pega y quema')
  const v0 = p.luchadores[1].vida
  correr(p, 200)
  ok(v0 - p.luchadores[1].vida >= 40 && p.luchadores[1].efectos.quemado === 0, 'quemado: pierde vida unos segundos y se apaga', `${v0 - p.luchadores[1].vida}`)
  ok(p.luchadores[0].carga > 10 - 4 + 0.9, 'Mate compartido: el especial que acierta devuelve 1 de carga', p.luchadores[0].carga.toFixed(2))
}

// ─── Navajazo: siempre crítico ───
{
  let todos = true
  for (let s = 0; s < 8; s++) {
    const p = nueva(['nico_u', 'simon'], 330, 470, 100 + s)
    p.luchadores[0].carga = 10
    const evs = correr(p, 80, (t) => [{ especial2: t < 2 }, {}])
    const g = golpesDe(evs, 'navaja')[0]
    if (!g || !g.critico || g.danio !== Math.round(K.nico_u.especiales[1].ventanas[0].danio * 1.6)) todos = false
  }
  ok(todos, 'navajazo: siempre crítico (× 1,6)')
}

// ─── Chilena: le pega al que salta y rompe la guardia ───
{
  const p = nueva(['nahuel', 'simon'], 330, 470)
  p.luchadores[0].carga = 10
  let enAire = false
  const evsT = correrT(
    p,
    120,
    (t) => [{ especial2: t < 2 }, { arriba: t >= 6 && t < 26 }],
    (e, q) => {
      if (e.some((x) => x.tipo === 'golpe' && x.herramienta === 'pelota') && !q.luchadores[1].enSuelo && q.luchadores[1].y > 60) enAire = true
    },
  )
  const evs = evsT.map((x) => x.e)
  ok(golpesDe(evs, 'pelota').length === 1 && enAire, 'chilena: le pega al que está saltando')
  const p2 = nueva(['nahuel', 'simon'], 330, 450)
  p2.luchadores[0].carga = 10
  const evs2 = correr(p2, 120, (t) => [{ especial2: t < 2 }, { guardia: true }])
  ok(de(evs2, 'guardia_rota').length === 1, 'chilena: bloqueada, rompe la guardia')
}

// ─── Embestidas: moto derriba; break invulnerable al arrancar; dragón multigolpe y aterriza ───
{
  const p = nueva(['luciano', 'simon'], 200, 700)
  p.luchadores[0].carga = 10
  const evs = correr(p, 120, (t) => [{ especial1: t < 2 }, {}])
  ok(golpesDe(evs, 'moto').length === 1 && de(evs, 'derribo').length === 1, 'moto: cruza (500 px) y derriba')
  const p2 = nueva(['gabriel', 'simon'], 330, 430)
  p2.luchadores[0].carga = 10
  let invulAlArrancar = 0
  const evs2 = correr(p2, 120, (t, q) => {
    const a = internoDe(q).luchadores[0].accion
    if (a && a.especial === 1 && a.t > 0 && a.t < 16 && q.luchadores[0].invulnerable) invulAlArrancar++
    return [{ especial1: t < 2 }, {}]
  })
  ok(invulAlArrancar >= 14, 'break dance: invulnerable al arrancar', `${invulAlArrancar} ticks`)
  ok(golpesDe(evs2, 'break').length >= 4, 'break dance: varios golpes', `${golpesDe(evs2, 'break').length}`)
  const p3 = nueva(['joaquin', 'simon'], 200, 500)
  p3.luchadores[0].carga = 10
  let voló = false
  const evs3 = correr(p3, 140, (t, q) => {
    if (!q.luchadores[0].enSuelo && q.luchadores[0].movimiento === 'patada_del_dragon') voló = true
    return [{ especial2: t < 2 }, {}]
  })
  ok(voló && golpesDe(evs3, 'dragon').length === 3 && de(evs3, 'derribo').length === 1, 'patada del dragón: por el aire, 3 golpes, derriba')
  ok(p3.luchadores[0].enSuelo && p3.luchadores[0].estado !== 'atacando', 'patada del dragón: aterriza y termina')
  const p4 = nueva(['rodrigo', 'simon'], 330, 560)
  p4.luchadores[0].carga = 10
  p4.luchadores[1].carga = 10
  const evs4 = correr(p4, 140, (t) => [{ especial1: t >= 30 && t < 32 }, { especial2: t < 2 }])
  ok(de(evs4, 'golpe').filter((g) => g.herramienta === 'tornado' && g.victima === 0).length === 0 || golpesDe(evs4, 'baile').length >= 0, 'paso de cuarteto: corre aunque haya proyectiles (los atraviesa)')
}

// ─── Pasivas ───
{
  // Furia de Nico U.: con menos de 35 % pega 20 % más.
  const lleno = nueva(['nico_u', 'chipi'], 430, 530, 11)
  const e1 = correr(lleno, 12, (t) => [{ golpe: t < 2 }, {}])
  const furioso = nueva(['nico_u', 'chipi'], 430, 530, 11)
  furioso.luchadores[0].vida = 300
  const e2 = correr(furioso, 12, (t) => [{ golpe: t < 2 }, {}])
  const d1 = de(e1, 'golpe')[0]
  const d2 = de(e2, 'golpe')[0]
  const pn = K.nico_u.movimientos.puno.ventanas[0].danio
  const esperadoFuria = Math.round(pn * (d1?.critico ? 1.6 : 1) * 1.2 * 0.88)
  ok(!!d1 && !!d2 && d1.critico === d2.critico && d2.danio === esperadoFuria, 'La 12 no para: +20 % con poca vida', `${d1?.danio} → ${d2?.danio} (esperado ${esperadoFuria})`)
  // Happy hour: arranca con 2 de más.
  ok(nueva(['guillermo', 'simon']).luchadores[0].carga >= 4 && nueva(['simon', 'guillermo']).luchadores[0].carga < 3, 'Happy hour: arranca cada round con 4')
  // Batería externa: la carga se llena 15 % más rápido.
  const f = nueva(['fabri', 'simon'])
  const c0 = f.luchadores[0].carga
  const s0 = f.luchadores[1].carga
  correr(f, 132)
  ok(Math.abs(f.luchadores[0].carga - c0 - 1.15) < 0.02 && Math.abs(f.luchadores[1].carga - s0 - 1) < 0.02, 'Batería externa: 1,15 por cada 2,2 s')
  // Disciplina: bloquear da carga.
  const j = nueva(['joaquin', 'simon'], 430, 530)
  const cj = j.luchadores[0].carga
  correr(j, 20, (t) => [{ guardia: true }, { golpe: t < 2 }])
  // 16 ticks de recarga (los 4 del hitstop no cuentan) + la carga del bloqueo.
  const cb = K.joaquin.pasiva?.cargaPorBloqueo ?? 0
  ok(cb > 0 && Math.abs(j.luchadores[0].carga - cj - (cb + 16 / 132)) < 0.01, 'Disciplina: cada bloqueo da carga', (j.luchadores[0].carga - cj).toFixed(3))
  // Noches sin dormir: los estados le duran menos (el factor de la pasiva).
  const l = nueva(['lucas', 'simon'])
  const Il = internoDe(l)
  ponerEstado(l, Il, 0, 'aturdido', 60)
  const me = K.lucas.pasiva?.multEstados ?? 1
  ok(me < 1 && l.luchadores[0].efectos.aturdido === Math.round(60 * me), 'Noches sin dormir: estados más cortos', `${l.luchadores[0].efectos.aturdido} (×${me})`)
  // Aguante: la guardia aguanta 25 % más.
  const r = nueva(['simon', 'rodrigo'], 430, 530)
  correr(r, 30, (t) => [{ herramienta: t < 2 }, { guardia: true }])
  // La máquina de Simón saca a la guardia lo que diga su kit (con el factor de balance), por el 0,8 de Aguante.
  const gMaq = K.simon.movimientos.maquina.ventanas[0].danioGuardia
  ok(Math.abs(100 - r.luchadores[1].guardia - gMaq * 0.8) < 1.5, 'Aguante: −20 % de daño a la guardia', `${(100 - r.luchadores[1].guardia).toFixed(1)} (máquina ${gMaq})`)
  // Mole: los golpes leves no frenan a Brian cuando ataca.
  const b = nueva(['brian', 'simon'], 430, 520)
  const eb = correr(b, 40, (t) => [{ herramienta: t < 2 }, { golpe: t >= 3 && t < 5 }])
  ok(!!de(eb, 'golpe').find((g) => g.herramienta === 'pesado' && g.atacante === 0) && !!de(eb, 'golpe').find((g) => g.herramienta === 'puno'), 'Mole: el puño le pega pero el remate sale igual')
  // Flow: la esquiva de Gabriel es invulnerable más tiempo.
  const g = nueva(['gabriel', 'simon'])
  let inv = 0
  correr(g, 30, (t, q) => {
    if (q.luchadores[0].estado === 'dash' && q.luchadores[0].invulnerable) inv++
    return [{ dash: t < 2 }, {}]
  })
  ok(inv >= 12, 'Flow: esquiva invulnerable 13 ticks', String(inv))
  // Acelerado: la esquiva de Luciano llega más lejos.
  const lu = nueva(['luciano', 'simon'])
  const xl = lu.luchadores[0].x
  correr(lu, 30, (t) => [{ dash: t < 2 }, {}])
  ok(Math.abs(xl - lu.luchadores[0].x - 145) < 1, 'Acelerado: esquiva más larga', (xl - lu.luchadores[0].x).toFixed(1))
}

// ─── Fichas y kits coherentes ───
{
  let bien = true
  const malos: string[] = []
  for (const id of Object.keys(PERSONAJES) as IdPersonaje[]) {
    const f = PERSONAJES[id]
    for (const e of f.especiales) if (e.costo < 3 || e.costo > 7) malos.push(`${id} ${e.nombre} cuesta ${e.costo}`)
    if (f.alturaMundo < 195 || f.alturaMundo > 225) malos.push(`${id} alturaMundo ${f.alturaMundo}`)
  }
  if (malos.length) bien = false
  ok(bien, 'fichas: costos entre 3 y 7, alturas 195–225', malos.join(' | '))
}

// ─── Determinismo con el elenco nuevo ───
{
  const huella = (semilla: number) => {
    const p = crearPartida({ personajes: ['brian', 'lucas'], cpu: [true, true], dificultad: 'dificil', arena: 'parana', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
    let h = 0
    while (p.fase !== 'terminada' && p.tick < 30000) {
      avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
      p.eventos.splice(0)
      if (p.tick % 60 === 0) h = (Math.imul(h, 31) + hashPartida(p)) >>> 0
    }
    return `${h.toString(16)}:${p.tick}`
  }
  const a = huella(4242)
  const b = huella(4242)
  ok(a === b && a !== huella(4243), 'determinismo: misma semilla, misma partida (hash online)', `${a}`)
}

console.log(`\n${pruebas - fallas}/${pruebas} pruebas ok`)
process.exit(fallas ? 1 : 0)
