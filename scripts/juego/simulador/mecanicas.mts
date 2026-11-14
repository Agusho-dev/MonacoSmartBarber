/**
 * Pruebas de mecánica del motor, escenario por escenario (humano contra humano, entradas
 * guionadas). node --import ./cargador.mjs mecanicas.ts
 */
import type {
  AtlasPersonaje,
  EntradaJugador,
  EventoJuego,
  IdPersonaje,
  MetaAnimaciones,
  Partida,
} from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, ENTRADA_VACIA, TIEMPOS_PROYECTIL } from '../../../src/lib/juego/tipos.ts'
import { avanzar, calcularPuntaje, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { cuadroDeAtaque, cuadrosDeImpacto } from '../../../src/lib/juego/motor/animacion.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { EFECTO, HIPNOSIS, INMUNIDAD } from '../../../src/lib/juego/motor/constantes.ts'
import { cajaCuerpo } from '../../../src/lib/juego/motor/cuerpo.ts'
import { internoDe } from '../../../src/lib/juego/motor/interno.ts'
import { PERSONAJES } from '../../../src/lib/juego/personajes.ts'

// Los daños salen de los kits (ya con el factor de balance de DANIO_KIT): las pruebas miden la
// mecánica (reducción de Chipi, escalado, crítico), no los números de diseño.
const S = MOVIMIENTOS.simon
const C = MOVIMIENTOS.chipi
// Los costos salen de la ficha (cambiaron en la tercera tanda, 31/oct: Simón 6/7, Chipi 4/8).
const COSTO = (id: 'simon' | 'chipi', n: 1 | 2) => PERSONAJES[id].especiales[n - 1].costo
const PUNO_S = S.movimientos.puno.ventanas[0].danio
const PUNO_C = C.movimientos.puno.ventanas[0].danio

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

function nueva(pj: [IdPersonaje, IdPersonaje] = ['simon', 'chipi'], semilla = 7, rondas = 2, segundos = 60): Partida {
  const p = crearPartida({ personajes: pj, cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: rondas, segundosPorRound: segundos, animaciones: [meta(), meta()], semilla })
  while (p.fase !== 'pelea') avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
  p.eventos.splice(0)
  return p
}

function correr(p: Partida, n: number, gen: Gen = () => [{}, {}]): EventoJuego[] {
  const evs: EventoJuego[] = []
  for (let t = 0; t < n; t++) {
    const [a, b] = gen(t, p)
    avanzar(p, [{ ...ENTRADA_VACIA, ...a }, { ...ENTRADA_VACIA, ...b }])
    evs.push(...p.eventos.splice(0))
  }
  return evs
}
const de = <T extends EventoJuego['tipo']>(evs: EventoJuego[], tipo: T) => evs.filter((e) => e.tipo === tipo) as Extract<EventoJuego, { tipo: T }>[]
/** Pulsa un botón 2 ticks cada `cada` ticks. */
const pulso = (t: number, cada: number, desde = 0) => t >= desde && (t - desde) % cada < 2

// ─── Arranque ───
{
  const p = crearPartida({ personajes: ['simon', 'chipi'], cpu: [false, false], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [meta(), meta()], semilla: 1 })
  const evs: EventoJuego[] = [...p.eventos.splice(0)]
  let tPelea = -1
  for (let t = 0; t < 400 && tPelea < 0; t++) {
    avanzar(p, [ENTRADA_VACIA, ENTRADA_VACIA])
    for (const e of p.eventos.splice(0)) {
      evs.push(e)
      if (e.tipo === 'pelea') tPelea = p.tick
    }
  }
  const tipos = evs.map((e) => e.tipo)
  ok(tipos[0] === 'presentacion' && tipos.includes('burla') && tipos.includes('round') && tipos.includes('pelea'), 'fases iniciales', tipos.join(','))
  ok(tPelea === 90 + 96, 'presentación 90 + anuncio 96 ticks', `pelea en t=${tPelea}`)
  const r = de(evs, 'round')[0]
  ok(r && r.numero === 1 && r.final === false, 'evento round 1 (no final)')
}

// ─── Movimiento ───
{
  const p = nueva()
  const x0 = p.luchadores[0].x
  correr(p, 10, () => [{ derecha: true }, {}])
  ok(Math.abs(p.luchadores[0].x - (x0 + 10 * 4.1)) < 0.01, 'camina 4,1 px/tick (Simón)', `${(p.luchadores[0].x - x0).toFixed(2)} px`)
  ok(p.luchadores[0].estado === 'caminando' && p.luchadores[0].anim === 'caminar', 'estado/anim caminando')
  correr(p, 20, () => [{ derecha: true }, {}])
  ok(p.luchadores[0].anim === 'correr' || Math.abs(p.luchadores[1].x - p.luchadores[0].x) < 140, 'a los 24 ticks corre (si está lejos)', p.luchadores[0].anim)
  const p2 = nueva()
  correr(p2, 100, () => [{ izquierda: true }, {}])
  ok(p2.luchadores[0].x === 70, 'no sale del escenario (x ≥ 70)', String(p2.luchadores[0].x))
  ok(p2.luchadores[0].mira === 1, 'camina para atrás mirando al rival')
  // Empuje: caminar contra el otro lo empuja suave, no lo atraviesa.
  const p3 = nueva()
  correr(p3, 160, () => [{ derecha: true }, {}])
  const d = p3.luchadores[1].x - p3.luchadores[0].x
  ok(d >= 61.9 && d < 70, 'empuje entre cuerpos: no se atraviesan', `distancia ${d.toFixed(1)}`)
  ok(p3.luchadores[1].x > 630, 'empuja al rival', `rival x=${p3.luchadores[1].x.toFixed(1)}`)
}

// ─── Salto ───
{
  const p = nueva()
  let maxY = 0
  let enAire = 0
  const evs = correr(p, 60, (t, q) => {
    if (!q.luchadores[0].enSuelo) {
      enAire++
      maxY = Math.max(maxY, q.luchadores[0].y)
    }
    return [{ arriba: t < 2, derecha: t < 2 }, {}]
  })
  ok(de(evs, 'salto').length === 1 && de(evs, 'aterrizaje').length === 1, 'salto y aterrizaje (un evento cada uno)')
  ok(maxY > 150 && maxY < 170, 'altura del salto ≈160', maxY.toFixed(1))
  ok(enAire >= 36 && enAire <= 40, '≈0,62 s en el aire', `${enAire} ticks`)
  ok(p.luchadores[0].x > 330 + 100, 'salto con dirección avanza', p.luchadores[0].x.toFixed(1))
}

// ─── Agacharse ───
{
  const p = nueva()
  correr(p, 20, () => [{ abajo: true }, {}])
  ok(p.luchadores[0].estado === 'agachado' && p.luchadores[0].anim === 'agachado' && p.luchadores[0].cuadro === 3, 'agachado: pose sostenida en el último cuadro', `${p.luchadores[0].anim}/${p.luchadores[0].cuadro}`)
}

// ─── Dash ───
{
  const p = nueva()
  const x0 = p.luchadores[0].x
  let invul = 0
  const evs = correr(p, 30, (t, q) => {
    if (q.luchadores[0].estado === 'dash' && q.luchadores[0].invulnerable) invul++
    return [{ derecha: t < 3 || (t >= 6 && t < 9) }, {}]
  })
  ok(de(evs, 'dash').length === 1, 'doble toque → dash')
  ok(Math.abs(p.luchadores[0].x - x0 - (150 + 3 * 3.9)) < 25, 'dash adelante ≈150 px', `${(p.luchadores[0].x - x0).toFixed(1)}`)
  ok(invul >= 7 && invul <= 8, '8 ticks invulnerable', String(invul))
  const p2 = nueva()
  const x1 = p2.luchadores[0].x
  const evs2 = correr(p2, 30, (t) => [{ dash: t < 2 }, {}])
  ok(de(evs2, 'dash').length === 1 && Math.abs(x1 - p2.luchadores[0].x - 120) < 1, 'botón dash sin dirección → atrás 120 px', `${(x1 - p2.luchadores[0].x).toFixed(1)}`)
  // El dash duró 14 ticks; a los 30 quedan 14 de los 30 de enfriamiento.
  const evs3 = correr(p2, 12, (t) => [{ dash: t % 4 < 2 }, {}])
  ok(de(evs3, 'dash').length === 0, 'enfriamiento de 0,5 s')
  const evs3b = correr(p2, 12, (t) => [{ dash: t % 4 < 2 }, {}])
  ok(de(evs3b, 'dash').length === 1, 'después del enfriamiento vuelve a poder')
  // Mantener apretado y volver a apretar tarde NO es doble toque.
  const p3 = nueva()
  const evs4 = correr(p3, 40, (t) => [{ derecha: t < 20 || t >= 24 }, {}])
  ok(de(evs4, 'dash').length === 0, 'un toque largo + otro no es dash')
}

// ─── Cadena de GOLPE (puño → patada → combo) y combo ───
function acercar(p: Partida, d = 100) {
  p.luchadores[0].x = 480 - d / 2
  p.luchadores[1].x = 480 + d / 2
}
{
  const p = nueva()
  acercar(p)
  const evs = correr(p, 90, (t) => [{ golpe: pulso(t, 6) && t < 40 }, {}])
  const golpes = de(evs, 'golpe').filter((e) => e.atacante === 0)
  const herr = golpes.map((g) => g.herramienta).join(',')
  ok(golpes.length === 4, 'cadena completa: puño, patada y combo de 2', herr)
  const combos = de(evs, 'combo').map((c) => c.golpes)
  ok(combos.join(',') === '2,3,4', 'contador de combo 2-3-4 (combo verdadero)', combos.join(','))
  ok(p.estadisticas[0].comboMax === 4, 'estadística comboMax = 4')
  ok(de(evs, 'swing').filter((s) => s.quien === 0).length === 4, 'un swing por ventana activa')
  const danios = golpes.map((g) => g.danio)
  const sinCrit = golpes.every((g) => !g.critico)
  const esperado = [
    Math.round(PUNO_S * 0.88),
    Math.round(S.movimientos.patada.ventanas[0].danio * 0.88),
    Math.round(S.movimientos.combo.ventanas[0].danio * 0.88),
    Math.round(S.movimientos.combo.ventanas[1].danio * 0.88 * 0.88),
  ].join(',')
  if (sinCrit) ok(danios.join(',') === esperado, 'daños con −12 % de Chipi y escalado desde el 4.º', `${danios.join(',')} (esperado ${esperado})`)
}
{
  // Buffer: apretar 6 ticks antes de que se abra la ventana igual encadena.
  const p = nueva()
  acercar(p)
  const evs = correr(p, 60, (t) => [{ golpe: t < 2 || (t >= 1 && t < 3) || (t >= 2 && t < 3) }, {}])
  void evs
  const p2 = nueva()
  acercar(p2)
  // El puño pega en t=5; la ventana se abre en t=6 (+ hitstop 4). Apretar en t=2 (antes) → igual sale la patada.
  const evs2 = correr(p2, 60, (t) => [{ golpe: t < 1 || t === 3 }, {}])
  ok(de(evs2, 'golpe').filter((e) => e.atacante === 0).length >= 2, 'buffer de 8 ticks: apretado antes, encadena')
}

// ─── Guardia, chip, agachado esquiva el puño, guardia rota ───
{
  const p = nueva()
  acercar(p)
  const evs = correr(p, 40, (t) => [{ golpe: t < 2 }, { guardia: true }])
  const g = de(evs, 'golpe')[0]
  // El chip sale del puño del kit (con su factor de balance): 15 %, menos el 12 % de Chipi.
  const chip = Math.max(1, Math.round(S.movimientos.puno.ventanas[0].danio * 0.15 * (1 - 0.12)))
  ok(!!g && g.bloqueado && g.danio === chip, `puño bloqueado: chip 15 % (con −12 %) = ${chip}`, g ? `${g.danio}` : 'sin golpe')
  ok(p.estadisticas[1].golpesBloqueados === 1, 'estadística golpesBloqueados (del que bloquea)')
  const p2 = nueva()
  acercar(p2)
  const evs2 = correr(p2, 30, (t) => [{ golpe: t < 2 }, { abajo: true, guardia: true }])
  ok(de(evs2, 'golpe').length === 0, 'agachado: el puño pasa por arriba')
  const p3 = nueva()
  acercar(p3)
  const evs3 = correr(p3, 400, (t) => [{ herramienta: pulso(t, 9) }, { guardia: true }])
  const rota = de(evs3, 'guardia_rota')
  ok(rota.length >= 1, 'herramientas contra la guardia → GUARDIA ROTA')
  ok(p3.estadisticas[0].guardiasRotas >= 1, 'estadística guardiasRotas (del que rompe)')
  const p4 = nueva()
  acercar(p4)
  let rotaTicks = 0
  let volvio = -1
  correr(p4, 600, (t, q) => {
    if (q.luchadores[1].efectos.guardiaRota > 0) rotaTicks++
    else if (rotaTicks > 0 && volvio < 0) volvio = q.luchadores[1].guardia
    return [{ herramienta: rotaTicks === 0 && pulso(t, 9) }, { guardia: true }]
  })
  ok(rotaTicks >= 70 && rotaTicks <= 80, 'guardia rota: 70 ticks (+ el hitstop del golpe que la rompe)', String(rotaTicks))
  ok(volvio >= 50 && volvio < 52, 'la guardia vuelve a 50', String(volvio))
}

// ─── Críticos (tasa) ───
{
  let golpesS = 0
  let critS = 0
  let golpesC = 0
  let critC = 0
  for (let s = 0; s < 40; s++) {
    const p = nueva(['simon', 'chipi'], 100 + s)
    acercar(p)
    const evs = correr(p, 3000, (t, q) => {
      if (q.fase !== 'pelea') return [{}, {}]
      acercar(q)
      q.luchadores[1].vida = 1150
      return [{ golpe: pulso(t, 20) }, {}]
    })
    for (const g of de(evs, 'golpe')) if (g.herramienta === 'puno') {
      golpesS++
      if (g.critico) critS++
    }
    const p2 = nueva(['chipi', 'simon'], 200 + s)
    const evs2 = correr(p2, 3000, (t, q) => {
      if (q.fase !== 'pelea') return [{}, {}]
      acercar(q)
      q.luchadores[1].vida = 1000
      return [{ golpe: pulso(t, 20) }, {}]
    })
    for (const g of de(evs2, 'golpe')) if (g.herramienta === 'puno') {
      golpesC++
      if (g.critico) critC++
    }
  }
  ok(Math.abs(critS / golpesS - 0.15) < 0.03, 'Simón: 15 % de críticos', `${((100 * critS) / golpesS).toFixed(1)} % de ${golpesS}`)
  ok(Math.abs(critC / golpesC - 0.08) < 0.025, 'Chipi: 8 % de críticos', `${((100 * critC) / golpesC).toFixed(1)} % de ${golpesC}`)
}
{
  // Crítico: ×1,6, aura 30 ticks, +0,5 de carga (Simón).
  for (let s = 0; s < 200; s++) {
    const p = nueva(['simon', 'chipi'], 900 + s)
    acercar(p)
    p.luchadores[0].carga = 2
    const evs = correr(p, 8, (t) => [{ golpe: t < 2 }, {}])
    const g = de(evs, 'golpe')[0]
    if (g && g.critico) {
      ok(g.danio === Math.round(PUNO_S * 1.6 * 0.88), 'crítico ×1,6', String(g.danio))
      ok(p.luchadores[0].efectos.critico > 25, 'aura de crítico', String(p.luchadores[0].efectos.critico))
      ok(p.luchadores[0].carga > 2 + 0.2 + 0.5 - 0.01, 'Simón: +0,5 de carga por crítico', p.luchadores[0].carga.toFixed(3))
      break
    }
  }
}

// ─── Hitstop ───
{
  const p = nueva()
  acercar(p)
  let cg = 0
  correr(p, 7, (t, q) => {
    cg = Math.max(cg, q.congelamientoGolpe)
    return [{ golpe: t < 2 }, {}]
  })
  ok(cg === 4 || cg === 8, 'hitstop leve 4 (crítico +4)', String(cg))
}

// ─── Especiales ───
{
  // sin_carga
  const p = nueva()
  const evs = correr(p, 5, (t) => [{ especial2: t < 2 }, {}])
  ok(de(evs, 'sin_carga').length === 1 && de(evs, 'especial').length === 0, 'sin carga: evento sin_carga y nada más')
}
{
  // Corte Relámpago: flash, rayo, electrocutado, gasta su costo.
  const p = nueva()
  p.luchadores[0].carga = COSTO('simon', 1)
  let flash = 0
  let invProy = false
  const evs = correr(p, 80, (t, q) => {
    flash = Math.max(flash, q.congelamientoGolpe)
    if (q.proyectiles.some((x) => x.tipo === 'rayo')) invProy = true
    return [{ especial1: t < 2 }, {}]
  })
  const esp = de(evs, 'especial')[0]
  ok(!!esp && esp.nombre === 'Corte Relámpago' && esp.numero === 1, 'evento especial con nombre')
  ok(flash === 24, 'super flash: 24 ticks de mundo congelado', String(flash))
  ok(de(evs, 'proyectil').some((x) => x.proyectil === 'rayo') && invProy, 'rayo visual acompaña la corrida')
  const g = de(evs, 'golpe').find((x) => x.herramienta === 'rayo')
  const corte = Math.round(S.especiales[0].ventanas[0].danio * 0.88)
  ok(!!g && !g.bloqueado && g.danio === corte, `Corte Relámpago (−12 %) = ${corte}`, g ? String(g.danio) : 'no pegó')
  ok(de(evs, 'electrocutado').length === 1, 'electrocutado')
  ok(p.luchadores[0].carga < 1.6, `gastó ${COSTO('simon', 1)} de carga`, p.luchadores[0].carga.toFixed(2))
  ok(p.estadisticas[0].especialesUsados === 1 && p.estadisticas[0].especialesAcertados === 1, 'estadísticas de especiales')
}
{
  // Corte bloqueado: queda pegado (castigable), 40 a la guardia.
  const p = nueva()
  p.luchadores[0].carga = COSTO('simon', 1)
  const evs = correr(p, 80, (t) => [{ especial1: t < 2 }, { guardia: true }])
  const g = de(evs, 'golpe').find((x) => x.herramienta === 'rayo')
  const gCorte = S.especiales[0].ventanas[0].danioGuardia
  ok(!!g && g.bloqueado && Math.abs(p.luchadores[1].guardia - (100 - gCorte)) < 2, `Corte bloqueado: −${gCorte} de guardia`, `${p.luchadores[1].guardia.toFixed(1)}`)
  ok(Math.abs(p.luchadores[1].x - p.luchadores[0].x) < 110, 'queda pegado al rival', `${Math.abs(p.luchadores[1].x - p.luchadores[0].x).toFixed(0)} px`)
}
{
  // Tijera Tormenta: 6 contactos de 28, arrastra.
  const p = nueva()
  p.luchadores[0].carga = COSTO('simon', 2)
  const x1 = p.luchadores[1].x
  const evs = correr(p, 200, (t) => [{ especial2: t < 2 }, {}])
  const g = de(evs, 'golpe').filter((x) => x.herramienta === 'tornado')
  ok(g.length === 6, 'tornado: 6 contactos', String(g.length))
  ok(p.luchadores[0].combo === 0 && p.estadisticas[0].comboMax === 6, 'combo de 6', String(p.estadisticas[0].comboMax))
  ok(p.luchadores[1].x > x1 + 20, 'arrastra al rival', `${(p.luchadores[1].x - x1).toFixed(0)} px`)
}
{
  // Sillonazo: 190, derriba, levantarse invulnerable.
  const p = nueva(['chipi', 'simon'])
  p.luchadores[0].carga = COSTO('chipi', 1)
  let derribado = 0
  let levantInv = true
  let vioLevantarse = false
  const evs = correr(p, 200, (t, q) => {
    const v = q.luchadores[1]
    if (v.estado === 'derribado') derribado++
    if (v.estado === 'levantandose') {
      vioLevantarse = true
      if (!v.invulnerable) levantInv = false
    }
    return [{ especial1: t < 2 }, {}]
  })
  const g = de(evs, 'golpe').find((x) => x.herramienta === 'sillon')
  const sillon = C.especiales[0].proyectil?.danio ?? 0
  ok(!!g && g.danio === sillon && !g.bloqueado, `Sillonazo: ${sillon} de daño`, g ? String(g.danio) : 'no pegó')
  ok(de(evs, 'derribo').length === 1 && derribado > 50, 'derribo', `${derribado} ticks derribado`)
  ok(vioLevantarse && levantInv, 'se levanta invulnerable')
  const p2 = nueva(['chipi', 'simon'])
  p2.luchadores[0].carga = COSTO('chipi', 1)
  const evs2 = correr(p2, 200, (t) => [{ especial1: t < 2 }, { guardia: true }])
  ok(de(evs2, 'guardia_rota').length === 1, 'Sillonazo rompe la guardia aunque bloquee (guardia llena)')
}
{
  // Fijación Extrema: congela lo que dice su ticksEfecto (60 desde la tercera tanda; si falta, los 100
  // de EFECTO.congelado), pegarle lo rompe con ×1,3.
  const tCongela = C.especiales[1].proyectil?.ticksEfecto || EFECTO.congelado
  const p = nueva(['chipi', 'simon'])
  acercar(p, 140)
  p.luchadores[0].carga = COSTO('chipi', 2)
  let congelado = 0
  const evs = correr(p, 160, (t, q) => {
    if (q.luchadores[1].estado === 'congelado') congelado++
    return [{}, {}]
    void t
  })
  void evs
  const p2 = nueva(['chipi', 'simon'])
  acercar(p2, 140)
  p2.luchadores[0].carga = COSTO('chipi', 2)
  const evs2 = correr(p2, 200, (t, q) => {
    if (q.luchadores[1].estado === 'congelado') congelado++
    return [{ especial2: t < 2 }, {}]
  })
  ok(de(evs2, 'congelado').length === 1 && congelado >= tCongela - 5, `congelado ≈${tCongela} ticks`, String(congelado))
  ok(de(evs2, 'descongelado').some((d) => !d.roto), 'se descongela solo (roto: false)')
  const p3 = nueva(['chipi', 'simon'])
  acercar(p3, 140)
  p3.luchadores[0].carga = COSTO('chipi', 2)
  const evs3 = correr(p3, 140, (t, q) => {
    const congeladoAhora = q.luchadores[1].efectos.congelado > 0
    return [{ especial2: t < 2, golpe: congeladoAhora && t > 60 && t % 6 < 2, derecha: congeladoAhora && t > 50 }, {}]
  })
  const roto = de(evs3, 'descongelado').find((d) => d.roto)
  const golpeRompe = de(evs3, 'golpe').find((g) => g.herramienta === 'puno')
  ok(!!roto, 'pegarle lo descongela (roto: true)')
  ok(!!golpeRompe && (golpeRompe.danio === Math.round(PUNO_C * 1.3) || golpeRompe.danio === Math.round(PUNO_C * 1.3 * 1.6)), 'el golpe que rompe el hielo hace ×1,3', golpeRompe ? String(golpeRompe.danio) : '-')
  const p4 = nueva(['chipi', 'simon'])
  acercar(p4, 140)
  p4.luchadores[0].carga = COSTO('chipi', 2)
  let cong4 = 0
  correr(p4, 200, (t, q) => {
    if (q.luchadores[1].efectos.congelado > 0) cong4++
    return [{ especial2: t < 2 }, { guardia: true }]
  })
  ok(cong4 >= EFECTO.congeladoBloqueo && cong4 <= EFECTO.congeladoBloqueo + 10, `bloqueado: congela ${EFECTO.congeladoBloqueo} igual (+ hitstop)`, String(cong4))
}

// ─── Armadura de Chipi (máquina contra leves) ───
{
  const p = nueva(['chipi', 'simon'])
  acercar(p)
  const evs = correr(p, 40, (t) => [{ herramienta: t < 2 }, { golpe: t >= 3 && t < 5 }])
  const maq = de(evs, 'golpe').find((g) => g.herramienta === 'maquina')
  const pun = de(evs, 'golpe').find((g) => g.herramienta === 'puno')
  ok(!!pun && !!maq, 'Chipi: el puño le pega pero la máquina sale igual (super armadura)', `${pun ? 'puño' : '-'} ${maq ? 'máquina' : '-'}`)
}

// ─── Carga: recarga, eventos, turbo ───
{
  const p = nueva()
  const evs = correr(p, 140)
  const c = de(evs, 'carga').filter((x) => x.quien === 0)
  ok(c.length === 1 && c[0].nivel === 3, 'recarga 1 cada 2,2 s (evento carga nivel 3)', c.map((x) => x.nivel).join(','))
  ok(Math.abs(p.luchadores[0].carga - (2 + 140 / 132)) < 0.02, 'carga fraccional', p.luchadores[0].carga.toFixed(3))
  p.tiempoRestante = 20 * 60 + 2
  const antes = p.luchadores[0].carga
  const evs2 = correr(p, 66)
  ok(de(evs2, 'turbo').length === 1 && p.turbo, 'TURBO a los 20 s finales')
  ok(Math.abs(p.luchadores[0].carga - antes - (2 / 132 * 64 + 2 / 132)) < 0.05 || p.luchadores[0].carga > antes + 0.9, 'turbo: recarga doble', `${(p.luchadores[0].carga - antes).toFixed(3)}`)
}

// ─── KO, cámara lenta, entre rounds, round 2 ───
{
  const p = nueva()
  acercar(p)
  p.luchadores[1].vida = 1
  let escalaMin = 1
  const fases = new Set<string>()
  const evs = correr(p, 400, (t, q) => {
    fases.add(q.fase)
    escalaMin = Math.min(escalaMin, q.escalaTiempo)
    return [{ golpe: t < 2 }, {}]
  })
  const ko = de(evs, 'ko')[0]
  ok(!!ko && ko.ganador === 0 && ko.perdedor === 1 && ko.perfecto, 'KO perfecto (sin recibir daño)')
  ok(escalaMin === 0.35, 'cámara lenta 0,35', String(escalaMin))
  ok(fases.has('ko') && fases.has('entre_rounds') && p.round === 2, 'ko → entre_rounds → round 2', [...fases].join(','))
  ok(p.luchadores[1].vida === p.luchadores[1].vidaMax && p.luchadores[0].carga < 3, 'round nuevo: vida y carga reseteadas', `${p.luchadores[1].vida} ${p.luchadores[0].carga.toFixed(2)}`)
  ok(p.rondasGanadas[0] === 1 && p.estadisticas[0].rondasPerfectas === 1, 'rounds y perfectos contados')
  ok(de(evs, 'fin_round').length === 1, 'fin_round')
}

// ─── Fase final: ¡DEJALO AL CERO! ───
// (Al rival lo dejamos en 1: el daño del puño depende del factor de balance de cada momento.)
{
  const p = nueva()
  p.rondasGanadas[0] = 1
  acercar(p)
  p.luchadores[1].vida = 1
  let mareado = false
  const evs = correr(p, 700, (t, q) => {
    if (q.luchadores[1].estado === 'mareado') mareado = true
    const golpe = (t < 2) || (q.fase === 'final' && q.ticksFase > 40 && q.ticksFase < 44)
    return [{ golpe }, {}]
  })
  ok(de(evs, 'final_disponible').length === 1 && mareado, 'final: perdedor mareado y evento final_disponible')
  ok(de(evs, 'final_al_cero').length === 1 && p.estadisticas[0].finalAlCero, 'remate AL CERO')
  ok(p.fase === 'terminada' && p.ganadorPartida === 0 && de(evs, 'fin_partida').length === 1, 'terminada + fin_partida')
  const pu = calcularPuntaje(p, 0)
  ok(pu.partes.reduce((s, x) => s + x.puntos, 0) === pu.total && pu.partes.some((x) => x.puntos === 1500), 'puntaje: partes = total, incluye «¡Al cero!» 1500', `${pu.total} ${pu.rango}`)
  p.estadisticas[1].danioHecho = 501
  const pu1 = calcularPuntaje(p, 1)
  ok(pu1.total === 250 && pu1.partes.some((x) => x.etiqueta.startsWith('Derrota') && x.puntos === -251), 'el que pierde: la mitad', JSON.stringify(pu1.partes))
  // Sin remate: se desploma solo.
  const p2 = nueva()
  p2.rondasGanadas[0] = 1
  acercar(p2)
  p2.luchadores[1].vida = 1
  const evs2 = correr(p2, 700, (t) => [{ golpe: t < 2 }, {}])
  ok(de(evs2, 'final_al_cero').length === 0 && de(evs2, 'ko').length === 1 && p2.fase === 'terminada', 'sin remate: KO a los 3 s y termina')
}

// ─── Tiempo ───
{
  const p = nueva(['simon', 'chipi'], 3, 2, 12)
  p.luchadores[1].vida = 1000
  const evs = correr(p, 12 * 60 + 20)
  const t = de(evs, 'tiempo')[0]
  ok(!!t && t.ganador === 0, 'TIEMPO: gana el de más % de vida', t ? String(t.ganador) : 'sin evento')
  const p2 = nueva(['simon', 'simon'], 4, 1, 10)
  const evs2 = correr(p2, 10 * 60 + 400)
  ok(de(evs2, 'tiempo').length === 1 && p2.fase === 'terminada' && p2.ganadorPartida !== null, 'empate exacto: siempre hay ganador y termina')
}

// ─── Animación: cuadros de ataque según el atlas ───
{
  const v = [{ desde: 5, ticks: 3 }]
  const imp = cuadrosDeImpacto(5, [4], 1)
  const cuadros = Array.from({ length: 17 }, (_, t) => cuadroDeAtaque(t, 17, v, imp, 5))
  ok(cuadros.join('') === '00123444444444444', 'puño [4]: arranque 0-3, impacto 4 en la ventana, se sostiene', cuadros.join(''))
  const v2 = [{ desde: 6, ticks: 2 }, { desde: 12, ticks: 3 }]
  const imp2 = cuadrosDeImpacto(8, [2, 5, 7], 2)
  const c2 = Array.from({ length: 33 }, (_, t) => cuadroDeAtaque(t, 33, v2, imp2, 8))
  ok(imp2.join(',') === '2,7' && c2[6] === 2 && c2[12] === 7 && c2[9] > 2 && c2[9] < 7, 'combo 2 golpes con 3 impactos: repartidos', c2.join(''))
  ok(cuadrosDeImpacto(5, [], 1)[0] === 2 && cuadrosDeImpacto(8, [], 2).join(',') === '2,5', 'sin impactos: mitad / repartidos')
  ok(cuadrosDeImpacto(1, [], 3).join(',') === '0,0,0', 'n = 1')
  const p = nueva()
  acercar(p)
  const vistos: string[] = []
  correr(p, 18, (t, q) => {
    vistos.push(`${q.luchadores[0].anim}:${q.luchadores[0].cuadro}`)
    return [{ golpe: t < 2 }, {}]
  })
  ok(vistos.slice(1, 6).every((x) => x.startsWith('golpe')), 'anim golpe al pegar', vistos.slice(0, 8).join(' '))
}
{
  const atlas = { version: 1, personaje: 'simon', imagen: 'a.png', alturaReferencia: 200, animaciones: { golpe: { cuadros: [{}, {}, {}], impactos: [2, 9, -1] } }, efectos: {} } as unknown as AtlasPersonaje
  const m = metaDesdeAtlas(atlas)
  ok(m.golpe.n === 3 && m.golpe.impactos.join(',') === '2' && m.quieto.n === 1 && CLAVES_ANIMACION.every((c) => m[c].n >= 1), 'metaDesdeAtlas: acota y completa lo que falta')
}

// ─── Determinismo de la semilla y CPU con meta vacía ───
{
  const a = crearPartida({ personajes: ['chipi', 'simon'], cpu: [true, true], dificultad: 'dificil', arena: 'caseros', rondasParaGanar: 1, segundosPorRound: 30, animaciones: [{} as MetaAnimaciones, {} as MetaAnimaciones], semilla: 1.7e12 })
  let n = 0
  while (a.fase !== 'terminada' && n < 20000) {
    avanzar(a, [ENTRADA_VACIA, ENTRADA_VACIA])
    a.eventos.splice(0)
    n++
  }
  ok(a.fase === 'terminada', 'CPU vs CPU con meta vacía, 1 round de 30 s y semilla enorme: termina', `${n} ticks`)
}

// ─── Revisión del 30/oct (segunda tanda): los defectos que encontró la verificación ───

/** Arranca una pelea con posiciones y carga 10 para los dos. */
function pelea(pj: [IdPersonaje, IdPersonaje], x0: number, x1: number, semilla = 7): Partida {
  const p = nueva(pj, semilla)
  p.luchadores[0].x = x0
  p.luchadores[1].x = x1
  p.luchadores[0].carga = 10
  p.luchadores[1].carga = 10
  return p
}

// crearNube borraba otro proyectil (el índice quedaba corrido al sacar la nube vieja): Lucas tira dos
// Pañalazos y Nahuel un Pelotazo mientras vuela el segundo. Ningún tiro desaparece sin pegar, sin
// salir de la pantalla o sin vencer, cada pañal que toca el piso o pega deja UNA nube y el pañal
// que pega no sigue volando.
{
  let combinaciones = 0
  let malas: string[] = []
  let pelotasVistas = 0
  for (let m = 70; m <= 190; m += 24) {
    for (let k = m; k <= m + 120; k += 24) {
      combinaciones++
      const p = pelea(['lucas', 'nahuel'], 300, 760)
      const vistos = new Map<number, { tipo: string; duenio: number; edad: number }>()
      for (let t = 0; t < 420 && p.fase === 'pelea'; t++) {
        p.luchadores[0].carga = 10
        p.luchadores[1].carga = 10
        avanzar(p, [
          { ...ENTRADA_VACIA, especial2: t < 2 || (t >= m && t < m + 2) },
          { ...ENTRADA_VACIA, especial1: t >= k && t < k + 2 },
        ])
        const evs = p.eventos.splice(0)
        const nubes = de(evs, 'nube').filter((e) => e.quien === 0).length
        const golpesPanal = de(evs, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'panal').length
        if (nubes > 1) malas.push(`m${m} k${k} t${t}: ${nubes} nubes en un tick`)
        if (golpesPanal > nubes) malas.push(`m${m} k${k} t${t}: el pañal pegó y no dejó nube`)
        if (p.proyectiles.some((q) => q.tipo === 'panal' && q.golpesRestantes <= 0)) malas.push(`m${m} k${k} t${t}: un pañal que ya pegó sigue volando`)
        const ahora = new Set(p.proyectiles.map((q) => q.id))
        for (const [id, q] of vistos) {
          if (ahora.has(id) || q.duenio !== 1) continue
          pelotasVistas++
          const pego = de(evs, 'golpe').some((g) => g.atacante === 1 && g.herramienta === 'pelota')
          const vence = q.edad + 1 >= (MOVIMIENTOS.nahuel.especiales[0].proyectil?.vida ?? 75)
          if (!pego && !vence) malas.push(`m${m} k${k} t${t}: la pelota de Nahuel desapareció sin pegar (edad ${q.edad})`)
        }
        vistos.clear()
        for (const q of p.proyectiles) vistos.set(q.id, { tipo: q.tipo, duenio: q.duenio, edad: q.edad })
      }
    }
  }
  malas = [...new Set(malas)]
  ok(malas.length === 0 && pelotasVistas > 0, 'nube: dos pañales y un tiro del rival en vuelo — no se borra nada ajeno, una nube por pañal', `${combinaciones} combinaciones, ${pelotasVistas} pelotas seguidas${malas.length ? '; ' + malas.slice(0, 3).join(' | ') : ''}`)
}

// Graffiti Slam: cubrirse no puede costar más vida que comérselo (con 5 golpes e intervalo 0 rompía
// la guardia al 2.º contacto y el 3.º entraba limpio: 310 contra 182).
{
  const vidaPerdida = (cubre: boolean) => {
    const p = pelea(['gabriel', 'simon'], 300, 550)
    const v0 = p.luchadores[1].vida
    correr(p, 120, (t) => [{ especial2: t < 2 }, { guardia: cubre }])
    return v0 - p.luchadores[1].vida
  }
  const cubierto = vidaPerdida(true)
  const limpio = vidaPerdida(false)
  ok(cubierto > 0 && limpio > 0 && cubierto < limpio, 'graffiti: cubrirse cuesta menos vida que comérselo', `cubierto ${cubierto}, sin cubrirse ${limpio}`)
}

// Agarre contra golpe en el mismo tick: gana el golpe (sin importar el lado), nadie queda «agarrado»
// sin que lo agarren y el agarre que no salió no cuenta como acertado. El golpe es la MÁQUINA de
// Fabri (fuerte): un puño leve no frena a Brian (su armadura) y el agarre sale igual, que está bien.
{
  let cruces = 0
  let huerfanos = 0
  let malContado = 0
  for (const brianLado of [0, 1] as const) {
    for (let f = 0; f <= 30; f++) {
      const pj: [IdPersonaje, IdPersonaje] = brianLado === 0 ? ['brian', 'fabri'] : ['fabri', 'brian']
      const p = pelea(pj, brianLado === 0 ? 400 : 465, brianLado === 0 ? 465 : 400)
      const I = internoDe(p)
      const fabri = (1 - brianLado) as 0 | 1
      let agarres = 0
      for (let t = 0; t < 160 && p.fase === 'pelea'; t++) {
        const ent: [EntradaJugador, EntradaJugador] = [{ ...ENTRADA_VACIA }, { ...ENTRADA_VACIA }]
        ent[brianLado].especial1 = t >= 10 && t < 12
        ent[fabri].herramienta = t >= f && t < f + 2
        const aBrian = I.luchadores[brianLado].accion
        const ventana = aBrian?.mov.id === 'agarre_y_apreton' && aBrian.t >= 8 && aBrian.t < 14
        avanzar(p, ent)
        const evs = p.eventos.splice(0)
        agarres += de(evs, 'agarre').length
        if (ventana && p.congelamientoGolpe > 0 && de(evs, 'golpe').some((g) => g.atacante === fabri && !g.bloqueado && g.fuerza !== 'leve')) cruces++
        for (const lado of [0, 1] as const) {
          const li = I.luchadores[lado]
          if (li.agarradoPor !== null && I.luchadores[li.agarradoPor].accion?.agarre?.victima !== lado) huerfanos++
        }
      }
      if (agarres === 0 && p.estadisticas[brianLado].especialesAcertados > 0) malContado++
    }
  }
  ok(cruces > 0 && huerfanos === 0 && malContado === 0, 'agarre contra golpe: gana el golpe, nadie queda colgado y no cuenta como acertado', `${cruces} golpes en la ventana del agarre, ${huerfanos} ticks agarrado sin agarre, ${malContado} aciertos de más`)
}

// La onda del Grito no arrastra ni aturde fuera de la pelea: si Rodrigo cae mientras lleva al rival,
// el ganador remata «¡AL CERO!».
{
  const p = pelea(['rodrigo', 'stefano'], 90, 260)
  p.rondasGanadas[1] = 1
  let arrastrado = false
  let remate = false
  let aturdidoEnFinal = 0
  for (let t = 0; t < 700 && p.fase !== 'terminada'; t++) {
    const enOnda = p.proyectiles.some((q) => q.tipo === 'onda') && p.luchadores[1].estado === 'aturdido'
    if (enOnda && !arrastrado && p.fase === 'pelea') {
      arrastrado = true
      p.luchadores[0].vida = 0
    }
    if (p.fase === 'final' && p.congelamientoGolpe === 0 && p.luchadores[1].estado === 'aturdido') aturdidoEnFinal++
    avanzar(p, [{ ...ENTRADA_VACIA, especial2: t < 2 }, { ...ENTRADA_VACIA, golpe: p.fase === 'final' && t % 6 < 2 }])
    if (p.eventos.splice(0).some((e) => e.tipo === 'final_al_cero')) remate = true
  }
  ok(arrastrado && remate && aturdidoEnFinal < 30, 'onda: con Rodrigo noqueado no arrastra más y el ganador remata', `aturdido ${aturdidoEnFinal} ticks de la fase final, remate ${remate}`)
}

// «Curándose» se apaga cuando el ¡TIEMPO! corta la Curación.
{
  const p = pelea(['fabri', 'simon'], 300, 700)
  p.luchadores[0].vida = 500
  p.tiempoRestante = 30
  let curandoEnTiempo = 0
  let curo = false
  for (let t = 0; t < 200 && p.fase !== 'entre_rounds'; t++) {
    avanzar(p, [{ ...ENTRADA_VACIA, especial1: t < 2 }, ENTRADA_VACIA])
    if (p.eventos.splice(0).some((e) => e.tipo === 'curacion')) curo = true
    if (p.fase === 'tiempo') curandoEnTiempo = Math.max(curandoEnTiempo, p.luchadores[0].efectos.curando)
  }
  ok(curo && curandoEnTiempo === 0, 'cura: el «curándose» se apaga con el ¡TIEMPO!', `curando durante «tiempo» = ${curandoEnTiempo}`)
}

// «Precisión»: los aciertos nunca pasan a los intentos (el molino de 5 golpes y el agarre con sus
// apretones contaban más aciertos que intentos).
{
  const p = pelea(['gabriel', 'simon'], 300, 420)
  correr(p, 200, (t) => [{ especial1: t < 2 || (t > 120 && t < 123) }, {}])
  const g = p.estadisticas[0]
  const q = pelea(['brian', 'simon'], 400, 470)
  correr(q, 200, (t) => [{ especial1: t < 2 }, {}])
  const b = q.estadisticas[0]
  ok(g.golpesAcertados >= 5 && g.golpesAcertados <= g.golpesIntentados, 'precisión: el molino no pasa de 100 %', `${g.golpesAcertados}/${g.golpesIntentados}`)
  ok(b.golpesAcertados === 1 && b.golpesIntentados === 1, 'precisión: el agarre cuenta un intento y un acierto', `${b.golpesAcertados}/${b.golpesIntentados}`)
}

// ─── Quinta tanda (14/nov): una prueba guionada por cada pieza nueva ───
// Los números salen de los kits (con su factor de DANIO_KIT): se mide la mecánica.
const K5 = MOVIMIENTOS
/** Corre registrando cada tick: lo que pasó y cómo estaba cada luchador justo antes. */
function correrConEstado(p: Partida, n: number, gen: Gen) {
  const ticks: { t: number; evs: EventoJuego[]; antes: { enSuelo: boolean; x: number }[] }[] = []
  for (let t = 0; t < n; t++) {
    const antes = p.luchadores.map((l) => ({ enSuelo: l.enSuelo, x: l.x }))
    const [a, b] = gen(t, p)
    avanzar(p, [{ ...ENTRADA_VACIA, ...a }, { ...ENTRADA_VACIA, ...b }])
    ticks.push({ t, evs: p.eventos.splice(0), antes })
  }
  return ticks
}

// Contra (DefEspecial.contra, el All In de Chino).
{
  const ct = K5.chino.especiales[1].contra
  // Un golpe dentro del dominio: no hace nada, no le abre la cadena al que pega y la embestida sale con el bono.
  const p = pelea(['chino', 'simon'], 400, 490)
  const v0 = p.luchadores[0].vida
  let dominioVisto = 0
  const evs = correr(p, 160, (t, q) => {
    dominioVisto = Math.max(dominioVisto, q.luchadores[0].efectos.dominio)
    return [{ especial2: t < 2 }, { golpe: pulso(t, 6, 30) && t < 44 }]
  })
  const contra = de(evs, 'contra')
  const bono = de(evs, 'golpe').find((g) => g.atacante === 0 && g.herramienta === 'dominio')
  ok(contra.length === 1 && contra[0].quien === 0 && p.luchadores[0].vida === v0, 'contra: el golpe en el dominio no le hace nada (evento «contra»)', `${contra.length} contras, vida ${v0} → ${p.luchadores[0].vida}`)
  ok(!!bono && !!ct && bono.danio === ct.bono.danio && de(evs, 'derribo').some((d) => d.quien === 1), 'contra: la embestida pega con el bono y derriba', `${bono?.danio} (bono ${ct?.bono.danio})`)
  ok(!de(evs, 'swing').some((s) => s.quien === 1 && s.herramienta === 'patada'), 'contra: el golpe contrarrestado no abre la cadena del que pegó')
  ok(dominioVisto > 0 && p.luchadores[0].efectos.dominio === 0, 'contra: efectos.dominio mientras está armada y 0 después', `máx ${dominioVisto}`)
  // Si nadie le pega, sale la embestida floja (sin bono, no derriba).
  const p2 = pelea(['chino', 'simon'], 300, 500)
  const evs2 = correr(p2, 140, (t) => [{ especial2: t < 2 }, {}])
  const base = de(evs2, 'golpe').find((g) => g.atacante === 0 && g.herramienta === 'dominio')
  ok(de(evs2, 'contra').length === 0 && !!base && base.danio === K5.chino.especiales[1].ventanas[0].danio && de(evs2, 'derribo').length === 0, 'contra: sin golpe, la embestida floja del final (empuja, no derriba)', `${base?.danio}`)
  // Un tiro en el dominio: se deshace y salta la contra.
  let conContra = 0
  let pelotaPego = 0
  for (let t0 = 30; t0 <= 54; t0 += 4) {
    const q = pelea(['chino', 'nahuel'], 300, 700)
    const e = correr(q, 200, (t) => [{ especial2: t >= t0 && t < t0 + 2 }, { especial1: t < 2 }])
    if (de(e, 'contra').length) {
      conContra++
      if (de(e, 'golpe').some((g) => g.victima === 0 && g.herramienta === 'pelota')) pelotaPego++
    }
  }
  ok(conContra > 0 && pelotaPego === 0, 'contra: el pelotazo en el dominio se deshace y salta la contra', `${conContra} contras, ${pelotaPego} pelotas que pegaron`)
  // El agarre le gana a la contra.
  const p4 = pelea(['chino', 'brian'], 400, 470)
  const evs4 = correr(p4, 200, (t) => [{ especial2: t < 2 }, { especial1: t >= 10 && t < 12 }])
  ok(de(evs4, 'agarre').length === 1 && de(evs4, 'contra').length === 0, 'contra: el agarre de Brian le gana')
}

// Hipnotiza (efecto 'hipnotiza', los Lentes de Fran).
{
  const tLente = K5.fran.especiales[0].proyectil?.ticksEfecto ?? EFECTO.hipnotizado
  // De lejos: camina hacia Fran a HIPNOSIS.paso px por tick, sin control.
  const p = pelea(['fran', 'simon'], 300, 520)
  let maxPaso = 0
  let hipno = 0
  let xAntes = p.luchadores[1].x
  const evs = correr(p, 160, (t, q) => {
    const s = q.luchadores[1]
    if (s.efectos.hipnotizado > 0) hipno++
    if (s.efectos.hipnotizado > 0 && q.congelamientoGolpe === 0) maxPaso = Math.max(maxPaso, Math.abs(s.x - xAntes))
    xAntes = s.x
    return [{ especial1: t < 2 }, {}]
  })
  ok(de(evs, 'hipnotizado').length === 1 && de(evs, 'hipnotizado')[0].quien === 1, 'lentes: hipnotiza (evento «hipnotizado»)')
  ok(p.luchadores[1].x < 520 - 50 && maxPaso <= HIPNOSIS.paso + 1e-9, `hipnotizado: camina hacia Fran a ${HIPNOSIS.paso} px por tick`, `x ${p.luchadores[1].x.toFixed(0)}, paso máx ${maxPaso.toFixed(2)}`)
  ok(hipno > 0 && hipno <= tLente + 30 && internoDe(p).luchadores[1].inmune.hipnotizado > 0, 'hipnotizado: no pasa de su tope y deja inmunidad', `${hipno} ticks (tope ${tLente} + hitstop)`)
  // Cerca: llega a HIPNOSIS.llega px y se despierta enseguida.
  const p2 = pelea(['fran', 'simon'], 300, 430)
  let dMin = 999
  correr(p2, 160, (t, q) => {
    if (q.luchadores[1].efectos.hipnotizado > 0) dMin = Math.min(dMin, Math.abs(q.luchadores[1].x - q.luchadores[0].x))
    return [{ especial1: t < 2 }, {}]
  })
  ok(Math.abs(dMin - HIPNOSIS.llega) < 1, `hipnotizado: se para a ${HIPNOSIS.llega} px`, dMin.toFixed(1))
  // El primer golpe limpio lo despierta.
  const p3 = pelea(['fran', 'simon'], 300, 430)
  let pegoHipnotizado = false
  let despierto = false
  for (let t = 0; t < 200 && !pegoHipnotizado; t++) {
    const s = p3.luchadores[1]
    const estaba = s.efectos.hipnotizado > 0
    const cerca = estaba && Math.abs(s.x - p3.luchadores[0].x) < 110
    avanzar(p3, [{ ...ENTRADA_VACIA, especial1: t < 2, golpe: cerca && t % 4 < 2 }, ENTRADA_VACIA])
    const e = p3.eventos.splice(0)
    if (estaba && e.some((x) => x.tipo === 'golpe' && x.atacante === 0 && x.herramienta === 'puno' && !x.bloqueado)) {
      pegoHipnotizado = true
      // (relojes ya descontó un tick de la inmunidad en el mismo tick del golpe)
      despierto = s.efectos.hipnotizado === 0 && internoDe(p3).luchadores[1].inmune.hipnotizado === INMUNIDAD.hipnotizado - 1
    }
  }
  ok(pegoHipnotizado && despierto, 'hipnotizado: el primer golpe limpio lo despierta (y deja inmunidad)')
  // Agachado o cubierto no lo hipnotiza.
  const p4 = pelea(['fran', 'simon'], 300, 520)
  const evs4 = correr(p4, 160, (t) => [{ especial1: t < 2 }, { abajo: true }])
  ok(de(evs4, 'hipnotizado').length === 0 && !de(evs4, 'golpe').some((g) => g.herramienta === 'hipnosis'), 'lentes: agachado le pasa por arriba')
  const p5 = pelea(['fran', 'simon'], 300, 520)
  const evs5 = correr(p5, 160, (t) => [{ especial1: t < 2 }, { guardia: true }])
  ok(de(evs5, 'hipnotizado').length === 0 && de(evs5, 'golpe').some((g) => g.herramienta === 'hipnosis' && g.bloqueado), 'lentes: cubierto no hipnotiza')
  // En el aire pega pero no hipnotiza.
  let enAire = 0
  let hipnoEnAire = 0
  for (let s = 20; s <= 44; s += 2) {
    const q = pelea(['fran', 'simon'], 300, 520)
    const tk = correrConEstado(q, 180, (t) => [{ especial1: t < 2 }, { arriba: t >= s && t < s + 2 }])
    for (const x of tk) {
      if (x.evs.some((e) => e.tipo === 'golpe' && e.herramienta === 'hipnosis') && !x.antes[1].enSuelo) {
        enAire++
        if (x.evs.some((e) => e.tipo === 'hipnotizado')) hipnoEnAire++
      }
    }
  }
  ok(enAire > 0 && hipnoEnAire === 0, 'lentes: al que salta le pega, pero no lo hipnotiza', `${enAire} en el aire`)
}

// Punta (VentanaGolpe.punta, el Corte de Precisión de Fran).
{
  const w = K5.fran.especiales[1].ventanas[0]
  const p = pelea(['fran', 'simon'], 300, 470)
  const evs = correr(p, 100, (t) => [{ especial2: t < 2 }, {}])
  const g = de(evs, 'golpe').find((x) => x.atacante === 0 && x.herramienta === 'tijera')
  ok(!!g && g.critico && g.danio === Math.round(w.danio * 1.6) && de(evs, 'precision').length === 1, 'punta: a 170 px es crítico seguro (evento «precision»)', `${g?.danio} crítico ${g?.critico}`)
  const p2 = pelea(['fran', 'simon'], 380, 470)
  const evs2 = correr(p2, 100, (t) => [{ especial2: t < 2 }, {}])
  const g2 = de(evs2, 'golpe').find((x) => x.atacante === 0 && x.herramienta === 'tijera')
  ok(!!g2 && !g2.critico && g2.danio === w.danio && de(evs2, 'precision').length === 0, 'punta: a 90 px pega el base, sin crítico', `${g2?.danio}`)
}

// Pulso fino (PasivaKit.criticoTrasBloqueo, Fran): el golpe que sale después de cubrir uno es crítico.
{
  let criticos = 0
  let golpes = 0
  for (let s = 0; s < 10; s++) {
    const p = nueva(['fran', 'simon'], 300 + s)
    p.luchadores[0].x = 400
    p.luchadores[1].x = 480
    const evs = correr(p, 40, (t) => [{ guardia: t < 12, golpe: t === 16 || t === 17 }, { golpe: t < 2 }])
    const g = de(evs, 'golpe').find((x) => x.atacante === 0 && x.herramienta === 'puno' && !x.bloqueado)
    if (g) {
      golpes++
      if (g.critico) criticos++
    }
  }
  ok(golpes === 10 && criticos === 10, 'Pulso fino: después de cubrir, el puño es crítico', `${criticos}/${golpes}`)
}

// Cuerpo (DefMovimiento.cuerpo, el Gigante de Lautaro) y su armadura contra leves y medios.
{
  const cu = K5.lautaro.especiales[0].cuerpo
  const p = pelea(['lautaro', 'simon'], 300, 700)
  let caja = { ancho: 0, alto: 0 }
  correr(p, 100, (t, q) => {
    const I = internoDe(q)
    const a = I.luchadores[0].accion
    if (a && a.especial === 1 && a.t === 30) {
      const c = cajaCuerpo(q.luchadores[0], I.luchadores[0])
      if (c) caja = { ancho: c.x1 - c.x0, alto: c.y1 - c.y0 }
    }
    return [{ especial1: t < 2 }, {}]
  })
  const altoEsperado = (PERSONAJES.lautaro.alturaMundo - 10) * (cu?.altoMult ?? 1)
  ok(!!cu && Math.abs(caja.ancho - cu.ancho) < 1e-6 && Math.abs(caja.alto - altoEsperado) < 1e-6, 'gigante: la caja de daño crece mientras dura', `${caja.ancho}×${caja.alto.toFixed(1)}`)
  // Puños sueltos (la cadena de GOLPE termina en un golpe fuerte, que sí lo corta).
  const p2 = pelea(['lautaro', 'simon'], 400, 500)
  const evs2 = correr(p2, 140, (t) => [{ especial1: t < 2 }, { golpe: t === 26 || t === 27 || t === 50 || t === 51 }])
  const leves = de(evs2, 'golpe').filter((g) => g.victima === 0 && g.fuerza === 'leve').length
  ok(leves > 0 && de(evs2, 'golpe').some((g) => g.atacante === 0 && g.herramienta === 'gigante') && de(evs2, 'derribo').some((d) => d.quien === 1), 'gigante: los leves pegan pero no lo frenan, y el aplastón derriba', `${leves} leves`)
  const p3 = pelea(['lautaro', 'simon'], 400, 500)
  const evs3 = correr(p3, 140, (t) => [{ especial1: t < 2 }, { herramienta: t >= 26 && t < 28 }])
  ok(!de(evs3, 'golpe').some((g) => g.atacante === 0 && g.herramienta === 'gigante'), 'gigante: un golpe fuerte (la MÁQUINA) lo corta')
}

// Agarre en el aire y revoleo (DefAgarre.aire, tiron.vy: el Lanzamiento Aéreo de Lautaro).
{
  let aereos = 0
  let lejos = 0
  for (let s = 18; s <= 40; s += 2) {
    const p = pelea(['lautaro', 'simon'], 400, 520)
    const tk = correrConEstado(p, 220, (t) => [{ especial2: t < 2 }, { arriba: t >= s && t < s + 2 }])
    const iAg = tk.findIndex((x) => x.evs.some((e) => e.tipo === 'agarre'))
    if (iAg >= 0 && !tk[iAg].antes[1].enSuelo) {
      aereos++
      if (Math.abs(p.luchadores[1].x - p.luchadores[0].x) > 150 && tk.some((x) => x.evs.some((e) => e.tipo === 'derribo' && e.quien === 1))) lejos++
    }
  }
  ok(aereos > 0 && lejos === aereos, 'lanzamiento aéreo: agarra al que salta y lo revolea lejos, derribado', `${aereos} en el aire, ${lejos} lejos`)
  const p2 = pelea(['lautaro', 'simon'], 400, 500)
  const evs2 = correr(p2, 120, (t) => [{ especial2: t < 2 }, { abajo: true }])
  ok(de(evs2, 'agarre').length === 0, 'lanzamiento aéreo: al agachado no lo agarra (la mano va al cuello)')
  const p3 = pelea(['lautaro', 'simon'], 400, 500)
  const evs3 = correr(p3, 120, (t) => [{ especial2: t < 2 }, { guardia: true }])
  ok(de(evs3, 'agarre').length === 1, 'lanzamiento aéreo: imbloqueable (agarra al que se cubre)')
}

// Apunta (DefProyectil.apunta, las herramientas de Leo).
{
  let enAire = 0
  const p = pelea(['leo', 'simon'], 300, 560)
  const tk = correrConEstado(p, 160, (t) => [{ especial1: t < 2 }, { arriba: t >= 20 }])
  for (const x of tk) if (x.evs.some((e) => e.tipo === 'golpe' && e.herramienta === 'secador') && !x.antes[1].enSuelo) enAire++
  ok(enAire > 0, 'herramientas: apuntan al que salta y le pegan en el aire', `${enAire} en el aire`)
  const p2 = pelea(['leo', 'simon'], 300, 560)
  const evs2 = correr(p2, 160, (t) => [{ especial1: t < 2 }, { abajo: true }])
  ok(de(evs2, 'golpe').filter((g) => g.herramienta === 'secador').length >= 2, 'herramientas: agachado también le pegan (apuntan abajo)')
  const p3 = pelea(['leo', 'simon'], 300, 560)
  const evs3 = correr(p3, 160, (t) => [{ especial1: t < 2 }, { guardia: true }])
  const b = de(evs3, 'golpe').filter((g) => g.herramienta === 'secador')
  ok(b.length === 3 && b.every((g) => g.bloqueado), 'herramientas: cubierto, las tres bloqueadas')
}

// Ciega (efecto 'ciega', el Spray de Leo): sin pegar, con control; lo corta el primer golpe limpio.
{
  const p = pelea(['leo', 'simon'], 300, 480)
  let cegados = 0
  let libre = false
  const x0: number[] = []
  let pego = false
  for (let t = 0; t < 150; t++) {
    const s = p.luchadores[1]
    // Cegado y ya sin el aturdimiento del golpe: aprieta todo (el buffer se vacía antes de que se le pase).
    const ciego = s.efectos.cegado > 12 && internoDe(p).luchadores[1].stun === 0
    if (ciego) {
      libre = true
      x0.push(s.x)
    }
    avanzar(p, [{ ...ENTRADA_VACIA, especial2: t < 2 }, { ...ENTRADA_VACIA, golpe: ciego && t % 4 < 2, especial1: ciego && t % 6 < 2, dash: ciego && t % 8 < 2, derecha: ciego }])
    const e = p.eventos.splice(0)
    cegados += de(e, 'cegado').length
    if (ciego && e.some((x) => (x.tipo === 'swing' || x.tipo === 'especial' || x.tipo === 'dash') && x.quien === 1)) pego = true
  }
  const seMovio = x0.length > 2 && x0[x0.length - 1] > x0[0] + 5
  ok(cegados === 1 && libre, 'spray: ciega (evento «cegado»)')
  ok(seMovio && !pego, 'cegado: camina pero no pega, no tira especiales ni esquiva', `se movió ${seMovio}, pegó ${pego}`)
  const p2 = pelea(['leo', 'simon'], 300, 480)
  let pegoCiego = false
  let cortado = false
  for (let t = 0; t < 200 && !pegoCiego; t++) {
    const s = p2.luchadores[1]
    const estaba = s.efectos.cegado > 0
    const ciego = estaba && internoDe(p2).luchadores[1].stun === 0
    const cerca = Math.abs(s.x - p2.luchadores[0].x) < 130
    avanzar(p2, [{ ...ENTRADA_VACIA, especial2: t < 2, golpe: ciego && cerca && t % 4 < 2, derecha: ciego && !cerca }, ENTRADA_VACIA])
    const e = p2.eventos.splice(0)
    if (estaba && e.some((x) => x.tipo === 'golpe' && x.atacante === 0 && x.herramienta === 'tijera' && !x.bloqueado)) {
      pegoCiego = true
      cortado = s.efectos.cegado === 0 && internoDe(p2).luchadores[1].inmune.cegado === INMUNIDAD.cegado - 1
    }
  }
  ok(pegoCiego && cortado, 'cegado: el primer golpe limpio lo corta (y deja inmunidad)')
  const p3 = pelea(['leo', 'simon'], 300, 480)
  const evs3 = correr(p3, 120, (t) => [{ especial2: t < 2 }, { guardia: true }])
  ok(de(evs3, 'cegado').length === 0 && de(evs3, 'golpe').some((g) => g.herramienta === 'aerosol' && g.bloqueado), 'spray: cubierto no ciega')
}

// Pibe de goma (PasivaKit.multDerribo, Leo): tirado queda menos.
{
  const tirado = (victima: IdPersonaje) => {
    const p = pelea(['luciano', victima], 200, 700)
    let max = 0
    correr(p, 160, (t, q) => {
      max = Math.max(max, internoDe(q).luchadores[1].derribo)
      return [{ especial1: t < 2 }, {}]
    })
    return max
  }
  // (el máximo que se ve es uno menos: relojes ya lo descontó en el tick en que cayó)
  const leo = tirado('leo') + 1
  const simon = tirado('simon') + 1
  const md = K5.leo.pasiva?.multDerribo ?? 1
  ok(simon === EFECTO.derribo && leo === Math.round(EFECTO.derribo * md), 'Pibe de goma: Leo queda tirado menos', `${leo} contra ${simon}`)
}

// La casa siempre gana (PasivaKit.cargaPorEspecialRival, Chino).
{
  const p = pelea(['chino', 'simon'], 300, 700)
  p.luchadores[0].carga = 3
  correr(p, 1, () => [{}, { especial1: true }])
  const c = K5.chino.pasiva?.cargaPorEspecialRival ?? 0
  ok(c > 0 && Math.abs(p.luchadores[0].carga - (3 + c + 1 / 132)) < 1e-6, 'La casa siempre gana: cada especial del rival le da carga', p.luchadores[0].carga.toFixed(3))
}

// Roba (DefAgarre.roba, el Agarre y Ejecución de Nacho) y su caja de media distancia.
{
  const roba = K5.nacho.especiales[0].agarre?.roba
  const p = pelea(['nacho', 'simon'], 300, 480)
  p.luchadores[1].carga = 5
  const evs = correr(p, 200, (t) => [{ especial1: t < 2 }, {}])
  const r = de(evs, 'carga_robada')[0]
  ok(de(evs, 'agarre').length === 1 && !!roba && !!r && r.cantidad === roba.carga && r.atacante === 0 && r.victima === 1, 'ejecución: agarra de media distancia y el tirón roba carga', `robó ${r?.cantidad}`)
  ok(de(evs, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'ejecucion').length === 3 && de(evs, 'derribo').some((d) => d.quien === 1), 'ejecución: dos apretones y el tirón (con su herramienta), derriba')
  const p2 = pelea(['nacho', 'simon'], 400, 470)
  const evs2 = correr(p2, 120, (t) => [{ especial1: t < 2 }, {}])
  ok(de(evs2, 'agarre').length === 0, 'ejecución: pegado (70 px) no alcanza')
  const p3 = pelea(['nacho', 'simon'], 300, 480)
  const evs3 = correr(p3, 120, (t) => [{ especial1: t < 2 }, { arriba: t >= 24 && t < 30 }])
  ok(de(evs3, 'agarre').length === 0, 'ejecución: en el aire no agarra')
}

// Distancia por tiro (TiroRafaga.distancia, el Terremoto de Código de Nacho).
{
  const p = pelea(['nacho', 'simon'], 200, 860)
  const xs: number[] = []
  let ancho0 = 0
  let ancho1 = 0
  correr(p, 120, (t, q) => {
    for (const pr of q.proyectiles) {
      if (pr.tipo !== 'codigo') continue
      if (pr.edad === 1) xs.push(Math.round(pr.x - q.luchadores[0].x))
      if (pr.edad === TIEMPOS_PROYECTIL.codigoEstalla - 2) ancho0 = pr.ancho
      if (pr.edad === TIEMPOS_PROYECTIL.codigoEstalla + 1) ancho1 = pr.ancho
    }
    return [{ especial2: t < 2 }, {}]
  })
  ok(xs.join(',') === '105,195,285,375', 'terremoto: cuatro columnas, cada una más lejos', xs.join(','))
  ok(ancho1 > ancho0, `terremoto: cada columna estalla a los ${TIEMPOS_PROYECTIL.codigoEstalla} ticks`, `${ancho0} → ${ancho1}`)
  const p2 = pelea(['nacho', 'simon'], 300, 500)
  const evs2 = correr(p2, 140, (t) => [{ especial2: t < 2 }, {}])
  const g2 = de(evs2, 'golpe').filter((g) => g.herramienta === 'codigo')
  ok(g2.length === 1 && !g2[0].bloqueado && de(evs2, 'derribo').length === 1, 'terremoto: la que agarra lo tira y las otras ya no lo tocan', `${g2.length} golpes`)
  const p3 = pelea(['nacho', 'simon'], 300, 500)
  const evs3 = correr(p3, 140, (t) => [{ especial2: t < 2 }, { guardia: true }])
  const g3 = de(evs3, 'golpe').filter((g) => g.herramienta === 'codigo')
  ok(g3.length >= 1 && g3.every((g) => g.bloqueado), 'terremoto: se cubre (cada columna aparte)', `${g3.length} bloqueadas`)
}

// Overclock (PasivaKit.velocidadConCarga, Nacho).
{
  const camina = (carga: number) => {
    const p = pelea(['nacho', 'simon'], 300, 800)
    const x0 = p.luchadores[0].x
    correr(p, 10, (_t, q) => {
      q.luchadores[0].carga = carga
      return [{ derecha: true }, {}]
    })
    return p.luchadores[0].x - x0
  }
  const oc = K5.nacho.pasiva?.velocidadConCarga
  const lleno = camina(9)
  const vacio = camina(2)
  ok(!!oc && Math.abs(vacio - 10 * K5.nacho.caminar) < 0.01 && Math.abs(lleno - 10 * K5.nacho.caminar * oc.mult) < 0.01, 'Overclock: con la carga alta camina más rápido', `${vacio.toFixed(2)} → ${lleno.toFixed(2)}`)
}

// Hasta el rival (DefEmbestida.hastaRival, Desaparecer de Nehuen).
{
  const emb = K5.nehuen.especiales[0].embestida
  const p = pelea(['nehuen', 'simon'], 200, 700)
  let intocable = 0
  let tocable = 0
  const evs = correr(p, 120, (t, q) => {
    const a = internoDe(q).luchadores[0].accion
    if (a && a.especial === 1 && a.t > 0 && a.t < (emb?.invulnerableHasta ?? 0) && q.congelamientoGolpe === 0) {
      if (q.luchadores[0].invulnerable) intocable++
      else tocable++
    }
    return [{ especial1: t < 2 }, {}]
  })
  const g = de(evs, 'golpe').find((x) => x.atacante === 0 && x.herramienta === 'fantasma')
  const dFinal = Math.abs(p.luchadores[1].x - p.luchadores[0].x)
  ok(!!g && !!emb && intocable > 10 && tocable === 0, 'desaparecer: intocable mientras cruza y reaparece pegando', `${intocable} ticks intocable`)
  const p2 = pelea(['nehuen', 'simon'], 200, 700)
  let xLlego = 0
  correr(p2, 60, (t, q) => {
    const a = internoDe(q).luchadores[0].accion
    if (a && a.especial === 1 && a.t === 20) xLlego = q.luchadores[0].x
    return [{ especial1: t < 2 }, {}]
  })
  ok(Math.abs(700 - xLlego - (emb?.hastaRival ?? 0)) < 1, `desaparecer: frena a ${emb?.hastaRival} px del rival (no lo atraviesa)`, `${(700 - xLlego).toFixed(1)} px; después del golpe ${dFinal.toFixed(0)}`)
  const p3 = pelea(['nehuen', 'simon'], 400, 480)
  let xMax = 400
  correr(p3, 50, (t, q) => {
    xMax = Math.max(xMax, q.luchadores[0].x)
    return [{ especial1: t < 2 }, {}]
  })
  ok(xMax < 401, 'desaparecer: si ya está cerca, no se mueve', xMax.toFixed(1))
}

// Devuelve (DefEspecial.devuelve, el Smash de Pádel de Nehuen).
{
  let devueltos = 0
  let bien = 0
  for (let t0 = 20; t0 <= 70; t0 += 2) {
    const p = pelea(['nehuen', 'nahuel'], 300, 700)
    const evs = correr(p, 220, (t) => [{ especial2: t >= t0 && t < t0 + 2 }, { especial1: t < 2 }])
    const d = de(evs, 'devuelto')
    if (!d.length) continue
    devueltos++
    const contraNahuel = de(evs, 'golpe').some((g) => g.atacante === 0 && g.victima === 1 && g.herramienta === 'pelota')
    const aNehuen = de(evs, 'golpe').some((g) => g.victima === 0 && g.herramienta === 'pelota')
    if (d[0].quien === 0 && d[0].proyectil === 'pelota' && contraNahuel && !aNehuen && p.estadisticas[0].especialesAcertados >= 1) bien++
  }
  ok(devueltos > 0 && bien === devueltos, 'smash: devuelve el pelotazo, que le pega al que lo tiró (y cuenta para Nehuen)', `${bien}/${devueltos}`)
  const p2 = pelea(['nehuen', 'simon'], 300, 390)
  const evs2 = correr(p2, 100, (t) => [{ especial2: t < 2 }, {}])
  ok(de(evs2, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'paleta').length === 2, 'smash: de cerca entran el paletazo y la pelota')
}

// Volea (PasivaKit.multAereo, Nehuen): sus golpes aéreos pegan más.
{
  const base = K5.nehuen.movimientos.voladora.ventanas[0].danio
  const ma = K5.nehuen.pasiva?.multAereo ?? 1
  let visto = 0
  let bien = 0
  for (let s = 0; s < 6; s++) {
    const p = nueva(['nehuen', 'simon'], 500 + s)
    p.luchadores[0].x = 300
    p.luchadores[1].x = 420
    const evs = correr(p, 60, (t) => [{ arriba: t < 2, derecha: t < 2, golpe: t === 8 || t === 9 }, {}])
    const g = de(evs, 'golpe').find((x) => x.atacante === 0 && !x.bloqueado)
    if (!g) continue
    visto++
    if (g.danio === Math.round(base * ma * (g.critico ? 1.6 : 1))) bien++
  }
  ok(visto > 0 && bien === visto, 'Volea: la patada voladora pega 25 % más', `${bien}/${visto}`)
}

// Trampa (DefProyectil.trampa, las Espinas de Nico M.): lo que no pega se clava y tira al que lo pisa.
{
  const tr = K5.nico_m.especiales[1].proyectil?.trampa
  // Lejos: las tres se clavan, quietas, más o menos a 220, 325 y 430 px.
  const p = pelea(['nico_m', 'simon'], 300, 880)
  const evs = correr(p, 110, (t) => [{ especial2: t < 2 }, {}])
  const clavadas = p.proyectiles.filter((q) => q.tipo === 'espina' && q.plantado)
  const xs = de(evs, 'plantada').map((e) => Math.round(e.x - 300))
  ok(de(evs, 'plantada').length === 3 && clavadas.length === 3 && clavadas.every((q) => q.vx === 0 && q.vy === 0), 'espinas: las tres que no pegan se clavan, quietas (plantado)', xs.join(','))
  ok(xs.length === 3 && Math.abs(xs[0] - 220) < 40 && Math.abs(xs[2] - 430) < 40, 'espinas: se clavan escalonadas, cada una más lejos', xs.join(','))
  // Pisar una tira (imbloqueable, aunque se cubra después) y se deshacen las de la tirada.
  const p2 = pelea(['nico_m', 'simon'], 200, 880)
  correr(p2, 110, (t) => [{ especial2: t < 2 }, {}])
  const evs2 = correr(p2, 120, () => [{}, { izquierda: true }])
  const pisada = de(evs2, 'golpe').find((g) => g.herramienta === 'espinas' && g.victima === 1)
  correr(p2, 2)
  ok(!!pisada && !pisada.bloqueado && !!tr && pisada.danio === tr.danio && de(evs2, 'derribo').some((d) => d.quien === 1), 'espinas: pisar una clavada tira al piso (imbloqueable)', `${pisada?.danio}`)
  ok(!p2.proyectiles.some((q) => q.plantado), 'espinas: una trampa por tirada (las otras se deshacen)')
  // Saltándolas no pasa nada; si nadie las pisa, se apagan.
  // En el aire no hacen nada: con una sola clavada, saltarla de largo no pega; caminarla, sí.
  const conUna = () => {
    const q = pelea(['nico_m', 'simon'], 200, 880)
    correr(q, 110, (t) => [{ especial2: t < 2 }, {}])
    const I = internoDe(q)
    const clav = I.proyectiles.filter((x) => x.pub.plantado).sort((x, y) => x.pub.x - y.pub.x)
    for (const x of clav.slice(1)) {
      I.proyectiles.splice(I.proyectiles.indexOf(x), 1)
      q.proyectiles.splice(q.proyectiles.indexOf(x.pub), 1)
    }
    q.luchadores[1].x = (clav[0]?.pub.x ?? 424) + 96
    return q
  }
  const p3 = conUna()
  const evs3 = correr(p3, 70, (t) => [{}, { arriba: t < 2, izquierda: t < 2 }])
  const p3b = conUna()
  const evs3b = correr(p3b, 70, () => [{}, { izquierda: true }])
  ok(!de(evs3, 'golpe').some((g) => g.herramienta === 'espinas') && de(evs3b, 'golpe').some((g) => g.herramienta === 'espinas'), 'espinas: saltada de largo no pega; caminándola, sí')
  const p4 = pelea(['nico_m', 'simon'], 300, 880)
  correr(p4, 110, (t) => [{ especial2: t < 2 }, {}])
  const quedan = p4.proyectiles.filter((q) => q.plantado).length
  correr(p4, (tr?.vida ?? 150) + 10)
  ok(quedan === 3 && !p4.proyectiles.some((q) => q.plantado), `espinas: si nadie las pisa, se apagan a los ${tr?.vida} ticks`)
  // De pie en el camino le pegan directo (golpe medio común, se cubre).
  const p5 = pelea(['nico_m', 'simon'], 300, 520)
  const evs5 = correr(p5, 110, (t) => [{ especial2: t < 2 }, { guardia: true }])
  const directas = de(evs5, 'golpe').filter((g) => g.herramienta === 'espinas')
  ok(directas.length >= 1 && directas.every((g) => g.bloqueado), 'espinas: en vuelo son un golpe común (se cubren)', `${directas.length}`)
}

// Aceleración (DefProyectil.aceleracion, el monopatín de Tony).
{
  const ac = K5.tony.especiales[0].proyectil?.aceleracion
  const p = pelea(['tony', 'simon'], 200, 880)
  const vs: number[] = []
  correr(p, 120, (t, q) => {
    const m = q.proyectiles.find((x) => x.tipo === 'monopatin')
    if (m) vs.push(Math.abs(m.vx))
    return [{ especial1: t < 2 }, {}]
  })
  const crece = vs.length > 5 && vs.every((v, i) => i === 0 || v >= vs[i - 1] - 1e-9)
  ok(!!ac && crece && vs[0] < 6 && Math.abs(Math.max(...vs) - ac.max) < 1e-9, 'monopatín: sale lento y acelera hasta su tope', `${vs[0]?.toFixed(1)} → ${Math.max(...vs).toFixed(1)}`)
  const p2 = pelea(['tony', 'simon'], 400, 500)
  const evs2 = correr(p2, 120, (t) => [{ especial1: t < 2 }, {}])
  ok(de(evs2, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'monopatin').length === 2 && de(evs2, 'derribo').some((d) => d.quien === 1), 'monopatín: de cerca entran el revoleo y el monopatín, y tira')
}

// Si pega (DefEspecial.siPega, el Despido Final de Tony) y frenarEmbestida sólo con la embestida en marcha.
{
  const sp = K5.tony.especiales[1].siPega
  const p = pelea(['tony', 'simon'], 400, 520)
  let arrodillado = 0
  const evs = correr(p, 160, (t, q) => {
    if (internoDe(q).luchadores[1].stun > 0 && q.congelamientoGolpe === 0) arrodillado++
    return [{ especial2: t < 2 }, {}]
  })
  const golpes = de(evs, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'despido')
  ok(de(evs, 'despido').length === 1 && golpes.length === 2 && !golpes[1].bloqueado && de(evs, 'derribo').some((d) => d.quien === 1), 'despido: el papel limpio arrodilla y sale la patada voladora, que tira', `${golpes.length} golpes`)
  // Del papel (22) a la patada (≈ 52) sin poder hacer nada: la patada lo agarra arrodillado.
  const papel = K5.tony.especiales[1].ventanas[0].desde
  const patada = K5.tony.especiales[1].ventanas[1].desde
  ok(!!sp && arrodillado >= patada - papel - 2 && sp.aturde > patada - papel, 'despido: arrodillado (aturdido) hasta que llega la patada', `${arrodillado} ticks`)
  const p2 = pelea(['tony', 'simon'], 400, 520)
  let dura = 0
  const evs2 = correr(p2, 160, (t, q) => {
    const a = internoDe(q).luchadores[0].accion
    if (a && a.especial === 2) dura = Math.max(dura, a.t)
    return [{ especial2: t < 2 }, { guardia: true }]
  })
  const g2 = de(evs2, 'golpe').filter((g) => g.atacante === 0 && g.herramienta === 'despido')
  ok(de(evs2, 'despido').length === 0 && g2.length === 1 && g2[0].bloqueado && dura < (sp?.total ?? 92) - 30, 'despido: cubierto no hay patada y Tony queda regalado', `la acción llegó al tick ${dura}`)
}

// Pelo de punta (PasivaKit.pincha, Nico M.): el que le pega de cerca se pincha.
{
  const pc = K5.nico_m.pasiva?.pincha
  const p = pelea(['simon', 'nico_m'], 400, 480)
  const v0 = p.luchadores[0].vida
  const evs = correr(p, 12, (t) => [{ golpe: t < 2 }, {}])
  const pin = de(evs, 'pinchazo')
  ok(!!pc && pin.length === 1 && pin[0].quien === 0 && v0 - p.luchadores[0].vida === pc.danio, 'Pelo de punta: el que le pega se pincha', `${pin.length} pinchazos, −${v0 - p.luchadores[0].vida}`)
  const p2 = pelea(['simon', 'nico_m'], 400, 480)
  const evs2 = correr(p2, 12, (t) => [{ golpe: t < 2 }, { guardia: true }])
  ok(de(evs2, 'pinchazo').length === 1 && de(evs2, 'golpe').some((g) => g.bloqueado), 'Pelo de punta: también si lo cubre')
  const p3 = pelea(['nahuel', 'nico_m'], 300, 700)
  const evs3 = correr(p3, 120, (t) => [{ especial1: t < 2 }, {}])
  ok(de(evs3, 'golpe').some((g) => g.herramienta === 'pelota') && de(evs3, 'pinchazo').length === 0, 'Pelo de punta: un tiro no se pincha')
}

// Presencia de jefe (PasivaKit.presencia, Tony): cerca de él, el rival camina más lento.
{
  const pr = K5.tony.pasiva?.presencia
  const camina = (x1: number) => {
    const p = pelea(['tony', 'simon'], 300, x1)
    const x0 = p.luchadores[1].x
    correr(p, 5, () => [{}, { izquierda: true }])
    return x0 - p.luchadores[1].x
  }
  const cerca = camina(450)
  const lejos = camina(800)
  ok(!!pr && Math.abs(lejos - 5 * K5.simon.caminar) < 0.01 && Math.abs(cerca - 5 * K5.simon.caminar * pr.mult) < 0.01, 'Presencia de jefe: cerca de Tony el rival camina más lento', `${lejos.toFixed(2)} → ${cerca.toFixed(2)}`)
}

console.log(`\n${pruebas - fallas}/${pruebas} pruebas ok`)
process.exit(fallas ? 1 : 0)
