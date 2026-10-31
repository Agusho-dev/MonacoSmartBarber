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
import { EFECTO, TOPE_ENCIERRO, X_MAX, X_MIN } from '../../../src/lib/juego/motor/constantes.ts'
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

// ─── Encierros: la vara ───
/**
 * Ticks seguidos sin poder actuar, después de este tick: en el piso sin poder actuar ni un
 * movimiento propio en curso, o en el aire cayendo derribado o agarrado. Sin contar el hitstop ni
 * los super flash (el reloj de pelea del motor tampoco los cuenta: TOPE_ENCIERRO). Hasta el 30/oct
 * los ticks congelados del agarrado SÍ se contaban (en el aire no se miraba el congelamiento): por
 * eso el agarre de Brian medía ≈ 30 ticks de más que lo que mide el motor.
 */
function encierro(p: Partida, lado: Lado, seguidos: number): number {
  if (p.fase !== 'pelea' || p.congelamientoGolpe > 0) return seguidos
  const l = p.luchadores[lado]
  const li = internoDe(p).luchadores[lado]
  const sinControl = l.enSuelo ? !puedeActuar(l, li) && li.accion === null && li.dash === null : li.caidaDerribo > 0 || li.agarradoPor !== null
  return sinControl ? seguidos + 1 : 0
}

// ─── El motor lleva la misma cuenta y la usa (TOPE_ENCIERRO) ───
{
  // Guardia rota y un golpe: el reloj del motor (sinControl) y el de acá cuentan lo mismo (el
  // motor cuenta el tick del golpe y no el último del hitstop: a lo sumo uno de diferencia).
  const p = nueva(['simon', 'brian'], 400, 470)
  p.luchadores[1].guardia = 1
  let mio = 0
  let difMax = 0
  let maxMotor = 0
  let maxMio = 0
  correr(p, 200, (t, q) => {
    mio = encierro(q, 1, mio)
    const motor = internoDe(q).luchadores[1].sinControl
    difMax = Math.max(difMax, Math.abs(mio - motor))
    maxMotor = Math.max(maxMotor, motor)
    maxMio = Math.max(maxMio, mio)
    return [{ herramienta: t < 2 || (t > 30 && t < 33) }, { guardia: t < 30 }]
  })
  ok(difMax <= 1 && maxMotor >= 60 && Math.abs(maxMotor - maxMio) <= 1, 'encierro: el motor cuenta lo mismo que cadenas', `máx motor ${maxMotor}, acá ${maxMio}, diferencia ≤ ${difMax}`)
  // Inmune al control: con el reloj pasado del tope, el agarre no agarra, el congelado no entra y
  // el golpe que derriba sólo pega.
  const inmune = (pj: [IdPersonaje, IdPersonaje], n: 1 | 2, x1: number) => {
    const q = nueva(pj, 400, x1)
    q.luchadores[0].carga = 10
    internoDe(q).luchadores[1].sinControl = TOPE_ENCIERRO.inmuneDesde
    internoDe(q).luchadores[1].stun = 60
    const evs = correr(q, 140, (t) => [{ [n === 1 ? 'especial1' : 'especial2']: t < 2 }, {}])
    return evs
  }
  const ag = inmune(['brian', 'simon'], 1, 470)
  ok(de(ag, 'agarre').length === 0, 'inmune al control: el agarre no agarra')
  const fr = inmune(['chipi', 'simon'], 2, 520)
  ok(de(fr, 'congelado').length === 0 && de(fr, 'golpe').some((g) => g.atacante === 0 && g.herramienta === 'spray'), 'inmune al control: la Fijación pega pero no congela')
  const sl = inmune(['luciano', 'simon'], 1, 560)
  ok(de(sl, 'derribo').length === 0 && de(sl, 'golpe').some((g) => g.atacante === 0 && g.herramienta === 'moto'), 'inmune al control: la Moto pega pero no derriba')
}

// ─── Encierros forzados por un JUGADOR después de una guardia rota (los 13) ───
// Lo que encontró la verificación del 30/oct: con un guion a propósito, Brian dejaba 256 ticks sin
// moverse (guardia rota → remate → agarre → derribo) y Chipi 298 (guardia rota → máquina → Fijación
// → golpe → Sillonazo). Acá cada atacante le rompe la guardia al rival (guardia en 5 y un golpe de
// MÁQUINA) y sigue con guiones al azar y con planes deliberados (esperar W ticks, acercarse y
// encadenar hacia cada especial); la víctima quiere irse (arriba y atrás sostenidos, salta apenas
// puede). Nada puede pasar de 240 ticks (TOPE_ENCIERRO). Se informa también el reloj CON
// congelamientos (lo que ve el que mira la pantalla).
type PasoGuion = ['golpe' | 'herramienta' | 'especial1' | 'especial2' | 'nada' | 'adelante', number] | ['acercar', number]
const PASOS_AZAR = ['golpe', 'herramienta', 'especial1', 'especial2', 'nada', 'adelante'] as const

function rngGuion(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Rompe la guardia y sigue el guion. Devuelve el encierro más largo (sin y con congelamientos). */
function encierroForzado(atacante: IdPersonaje, victima: IdPersonaje, semilla: number, guionFijo: PasoGuion[] | null): { ticks: number; reloj: number } {
  const r = rngGuion(semilla)
  const p = crearPartida({ personajes: [atacante, victima], cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla })
  while (p.fase !== 'pelea') avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
  p.eventos.length = 0
  p.luchadores[0].x = 400
  p.luchadores[1].x = 480 + Math.floor(r() * 30)
  p.luchadores[0].carga = 10
  p.luchadores[1].guardia = 5
  const guion: PasoGuion[] = guionFijo ? [...guionFijo] : []
  for (let total = 0; !guionFijo && total < 320; ) {
    const b = PASOS_AZAR[Math.floor(r() * PASOS_AZAR.length)]
    const d = 1 + Math.floor(r() * (b === 'nada' ? 40 : 18))
    guion.push([b, d])
    total += d
  }
  let rota = -1
  let k = 0
  let kT = 0
  let seguidos = 0
  let reloj = 0
  let mejor = 0
  let mejorReloj = 0
  for (let t = 0; t < 1200 && p.fase === 'pelea'; t++) {
    const a: EntradaJugador = { ...ENTRADA_VACIA }
    const v: EntradaJugador = { ...ENTRADA_VACIA }
    if (rota < 0) {
      a.herramienta = t % 2 === 0
      v.guardia = true
    } else {
      v.arriba = true
      v.derecha = true
      const paso = guion[k]
      if (paso) {
        const [b, d] = paso
        if (b === 'acercar') {
          if (Math.abs(p.luchadores[1].x - p.luchadores[0].x) > d) a.derecha = true
          else {
            k++
            kT = 0
          }
        } else {
          if (b === 'adelante') a.derecha = true
          else if (b !== 'nada') a[b] = kT % 2 === 0
          if (++kT >= d) {
            k++
            kT = 0
          }
        }
      }
    }
    avanzar(p, [a, v])
    const evs = p.eventos.splice(0)
    if (rota < 0 && evs.some((e) => e.tipo === 'guardia_rota' && e.quien === 1)) rota = t
    if (rota < 0) continue
    seguidos = encierro(p, 1, seguidos)
    const li = internoDe(p).luchadores[1]
    const l = p.luchadores[1]
    // El reloj de pantalla: cuenta también los congelamientos mientras no pueda actuar.
    const atrapado = p.fase === 'pelea' && (l.enSuelo ? !puedeActuar(l, li) && li.accion === null && li.dash === null : li.caidaDerribo > 0 || li.agarradoPor !== null)
    reloj = atrapado ? reloj + 1 : 0
    mejor = Math.max(mejor, seguidos)
    mejorReloj = Math.max(mejorReloj, reloj)
    if (k >= guion.length && seguidos === 0 && t > rota + 5) break
  }
  return { ticks: mejor, reloj: mejorReloj }
}

{
  const FUZZ = Number(process.argv.slice(2).find((a) => a.startsWith('--fuzz='))?.split('=')[1] ?? 400)
  const victimas: IdPersonaje[] = ['simon', 'brian']
  // Planes deliberados: esperar W ticks con la guardia rota, acercarse a 100 px y encadenar.
  const planes: Record<string, PasoGuion[]> = {
    e1: [['especial1', 14]],
    e2: [['especial2', 14]],
    'golpe→e1': [['golpe', 40], ['especial1', 30]],
    'golpe→e2': [['golpe', 40], ['especial2', 30]],
    'máquina→e1': [['herramienta', 2], ['especial1', 30]],
    'máquina→e2': [['herramienta', 2], ['especial2', 30]],
    'máquina×2→e1': [['herramienta', 34], ['especial1', 30]],
    'máquina×2→e2': [['herramienta', 34], ['especial2', 30]],
  }
  const lineas: string[] = []
  let peorTodo = { ticks: 0, reloj: 0, quien: '', como: '' }
  for (const atacante of IDS_PERSONAJES) {
    let peor = { ticks: 0, reloj: 0, como: '' }
    for (const victima of victimas) {
      for (let i = 0; i < FUZZ; i++) {
        const semilla = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(atacante.length * 31 + victima.length, 0x5bd1e995)) >>> 0
        const r = encierroForzado(atacante, victima, semilla, null)
        if (r.ticks > peor.ticks) peor = { ...r, como: `azar ${semilla} contra ${victima}` }
        else if (r.reloj > peor.reloj) peor.reloj = r.reloj
      }
      for (const [nombre, plan] of Object.entries(planes)) {
        for (let w = 0; w <= 72; w += 3) {
          const guion: PasoGuion[] = [...(w > 0 ? [['nada', w] as PasoGuion] : []), ['acercar', 100], ...plan]
          const r = encierroForzado(atacante, victima, 12345 + w, guion)
          if (r.ticks > peor.ticks) peor = { ...r, como: `«${nombre}» esperando ${w} contra ${victima}` }
          else if (r.reloj > peor.reloj) peor.reloj = r.reloj
        }
      }
    }
    lineas.push(`${atacante} ${peor.ticks} (reloj ${peor.reloj}; ${peor.como})`)
    if (peor.ticks > peorTodo.ticks) peorTodo = { ticks: peor.ticks, reloj: peor.reloj, quien: atacante, como: peor.como }
  }
  console.log(`     encierros forzados (${FUZZ} guiones al azar y ${Object.keys(planes).length} planes por atacante y víctima): ${lineas.join(' · ')}`)
  ok(peorTodo.ticks <= 240, 'encierros forzados después de una guardia rota: nadie pasa de 4 s (los 13)', `${peorTodo.ticks} ticks con ${peorTodo.quien} (${peorTodo.como}; con congelamientos ${peorTodo.reloj})`)
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
        const seguidos: [number, number] = [0, 0]
        let h = 0
        while (p.fase !== 'terminada' && p.tick < 6 * 3600) {
          avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
          p.eventos.length = 0
          if (p.tick % 60 === 0) h = (Math.imul(h ^ hashPartida(p), 0x01000193) >>> 0)
          maxProy = Math.max(maxProy, p.proyectiles.length)
          for (const lado of [0, 1] as const) {
            const l = p.luchadores[lado]
            if (l.x < X_MIN || l.x > X_MAX || l.y < 0 || !Number.isFinite(l.x)) fueraDeBorde++
            if (l.vida > l.vidaMax || l.vida < 0 || !Number.isFinite(l.vida)) vidaMala++
            const n = encierro(p, lado, seguidos[lado])
            seguidos[lado] = n
            if (n > peor.ticks) peor = { ticks: n, quien: l.id, contra: p.luchadores[(1 - lado) as Lado].id, semilla }
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
