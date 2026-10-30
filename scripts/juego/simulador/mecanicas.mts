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
import { CLAVES_ANIMACION, ENTRADA_VACIA } from '../../../src/lib/juego/tipos.ts'
import { avanzar, calcularPuntaje, crearPartida, metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { cuadroDeAtaque, cuadrosDeImpacto } from '../../../src/lib/juego/motor/animacion.ts'
import { MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { EFECTO } from '../../../src/lib/juego/motor/constantes.ts'

// Los daños salen de los kits (ya con el factor de balance de DANIO_KIT): las pruebas miden la
// mecánica (reducción de Chipi, escalado, crítico), no los números de diseño.
const S = MOVIMIENTOS.simon
const C = MOVIMIENTOS.chipi
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
  // Corte Relámpago: flash, rayo, electrocutado, carga −4.
  const p = nueva()
  p.luchadores[0].carga = 5
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
  ok(p.luchadores[0].carga < 1.6, 'gastó 4 de carga', p.luchadores[0].carga.toFixed(2))
  ok(p.estadisticas[0].especialesUsados === 1 && p.estadisticas[0].especialesAcertados === 1, 'estadísticas de especiales')
}
{
  // Corte bloqueado: queda pegado (castigable), 40 a la guardia.
  const p = nueva()
  p.luchadores[0].carga = 5
  const evs = correr(p, 80, (t) => [{ especial1: t < 2 }, { guardia: true }])
  const g = de(evs, 'golpe').find((x) => x.herramienta === 'rayo')
  const gCorte = S.especiales[0].ventanas[0].danioGuardia
  ok(!!g && g.bloqueado && Math.abs(p.luchadores[1].guardia - (100 - gCorte)) < 2, `Corte bloqueado: −${gCorte} de guardia`, `${p.luchadores[1].guardia.toFixed(1)}`)
  ok(Math.abs(p.luchadores[1].x - p.luchadores[0].x) < 110, 'queda pegado al rival', `${Math.abs(p.luchadores[1].x - p.luchadores[0].x).toFixed(0)} px`)
}
{
  // Tijera Tormenta: 6 contactos de 28, arrastra.
  const p = nueva()
  p.luchadores[0].carga = 6
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
  p.luchadores[0].carga = 5
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
  p2.luchadores[0].carga = 5
  const evs2 = correr(p2, 200, (t) => [{ especial1: t < 2 }, { guardia: true }])
  ok(de(evs2, 'guardia_rota').length === 1, 'Sillonazo rompe la guardia aunque bloquee (guardia llena)')
}
{
  // Fijación Extrema: congela 100, pegarle lo rompe con ×1,3.
  const p = nueva(['chipi', 'simon'])
  acercar(p, 140)
  p.luchadores[0].carga = 6
  let congelado = 0
  const evs = correr(p, 160, (t, q) => {
    if (q.luchadores[1].estado === 'congelado') congelado++
    return [{}, {}]
    void t
  })
  void evs
  const p2 = nueva(['chipi', 'simon'])
  acercar(p2, 140)
  p2.luchadores[0].carga = 6
  const evs2 = correr(p2, 200, (t, q) => {
    if (q.luchadores[1].estado === 'congelado') congelado++
    return [{ especial2: t < 2 }, {}]
  })
  ok(de(evs2, 'congelado').length === 1 && congelado >= 95, 'congelado ≈100 ticks', String(congelado))
  ok(de(evs2, 'descongelado').some((d) => !d.roto), 'se descongela solo (roto: false)')
  const p3 = nueva(['chipi', 'simon'])
  acercar(p3, 140)
  p3.luchadores[0].carga = 6
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
  p4.luchadores[0].carga = 6
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

console.log(`\n${pruebas - fallas}/${pruebas} pruebas ok`)
process.exit(fallas ? 1 : 0)
