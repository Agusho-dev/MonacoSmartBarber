// Revisión visual de un luchador en una pelea REAL contra la CPU (/juego?prueba=, sólo desarrollo),
// con toques reales en el stick, los botones y las cartas. Congela el motor (escalaTiempo = 0, el
// render sigue dibujando) en cada momento que interesa y saca la captura: quieto, caminar, correr,
// saltar, caer, esquiva, guardia, agachado, los tres golpes, las dos herramientas, los dos especiales
// (super flash, golpe, proyectil, efecto en el rival), recibir daño, K.O., victoria, el remate y el
// resultado. Lo único que se fuerza: posiciones, carga 10 para los especiales y la vida para cerrar
// los rounds. NO toca ningún botón del resultado (guardarían la partida en la base de producción).
//
// Uso (contra el servidor de DESARROLLO; con varios agentes en la Mac, con el candado de Chrome):
//   node scripts/juego/revision/pelea-revision.mjs <id> <rival> <anchoxalto> [arena] [salida]
//   salida: carpeta de las capturas (por defecto <tmp>/corte-final-revision/peleas); queda
//   <salida>/<anchoxalto>/<id>_NN_<momento>.png, <id>.json (datos) y <id>.txt (registro).
// Después: lamina.py arma la lámina del luchador con esto y la hoja de cuadros.py.
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { abrirChrome, esperar } from './cdp.mjs'

const [ID, RIVAL, TAM = '844x390', ARENA = 'rondeau', SALIDA = path.join(os.tmpdir(), 'corte-final-revision', 'peleas')] = process.argv.slice(2)
if (!ID || !RIVAL) {
  console.error('uso: node pelea-revision.mjs <id> <rival> <anchoxalto> [arena] [salida]')
  process.exit(2)
}
const [ancho, alto] = TAM.split('x').map(Number)
const DIR = path.join(SALIDA, TAM)
mkdirSync(DIR, { recursive: true })
const BASE = process.env.URL_BASE || 'http://localhost:3100'
const URL = `${BASE}/juego?prueba=${ID},${RIVAL},${ARENA},facil`

// Distancia para cada especial (dentro del rango con que la CPU lo usa, motor/movimientos.ts).
const DIST = {
  simon: [200, 300], chipi: [280, 150], nico_u: [260, 110], fabri: [360, 190], luciano: [250, 300],
  gabriel: [120, 240], guillermo: [190, 300], rodrigo: [150, 260], joaquin: [300, 250], nahuel: [280, 130],
  lucas: [140, 250], stefano: [320, 160], brian: [78, 260],
}

const log = []
const anotar = (t) => { log.push(t); console.log(t) }
const fotos = []
const datos = { id: ID, rival: RIVAL, tam: TAM, arena: ARENA, especiales: [], momentos: {} }

const GANCHO = `(() => {
  const C = window.__corteFinal
  const p = C && C.partida
  if (!p) return false
  if (window.__rev && window.__rev.p === p) return true
  const R = (window.__rev = { p, ev: [], iv: [], ult: -1, congelado: false, guardada: 1, pend: null })
  const push0 = p.eventos.push
  p.eventos.push = function (...xs) { for (const e of xs) R.ev.push(Object.assign({ t: p.tick }, e)); return push0.apply(this, xs) }
  R.anims = []
  let previo = ''
  const f = (t) => {
    const a0 = p.luchadores[0]
    const clave = a0.anim + '[' + a0.cuadro + ']'
    if (clave !== previo) { R.anims.push(p.tick + ':' + clave); previo = clave; if (R.anims.length > 400) R.anims.splice(0, 200) }
    if (R.ult >= 0) R.iv.push(t - R.ult)
    R.ult = t
    if (R.pend && !R.congelado) {
      let ok = false
      try { ok = R.pend.cond(p, R) } catch (e) { ok = false }
      if (ok) { R.congelar(); const r = R.pend.res; R.pend = null; r(true) }
      else if (performance.now() > R.pend.hasta) { const r = R.pend.res; R.pend = null; r(false) }
    }
    requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
  R.congelar = () => { if (R.congelado) return; R.guardada = p.escalaTiempo; p.escalaTiempo = 0; R.congelado = true }
  R.soltar = () => { if (!R.congelado) return; p.escalaTiempo = R.guardada > 0 ? R.guardada : 1; R.congelado = false }
  R.esperar = (src, ms) => new Promise((res) => { R.pend = { cond: new Function('p', 'R', 'return (' + src + ')'), res, hasta: performance.now() + ms } })
  R.desde = (tipo, t0) => R.ev.filter((e) => e.tipo === tipo && e.t >= t0)
  return true
})()`

const c = await abrirChrome({ ancho, alto, movil: true, prefs: { tutorialVisto: true, sonido: true, musica: true }, puerto: 9455 })
let n = 0
async function foto(nombre) {
  n++
  const archivo = path.join(DIR, `${ID}_${String(n).padStart(2, '0')}_${nombre}.png`)
  await esperar(70)
  await c.foto(archivo)
  fotos.push({ nombre, archivo })
}
/** Espera la condición (expresión JS sobre p y R), congela, saca la foto y suelta. */
async function momento(nombre, cond, ms = 4000, demora = 0, antesDeSoltar = null) {
  const ok = await c.evaluar(`__rev.esperar(${JSON.stringify(cond)}, ${ms})`, ms + 5000)
  if (ok) {
    if (demora) await esperar(demora)
    await foto(nombre)
    const est = await c.evaluar(`(() => { const p = __rev.p; return p.luchadores.map((l) => l.anim + '[' + l.cuadro + '] ' + l.estado + ' y' + Math.round(l.y)).join(' | ') + ' · ' + p.fase })()`)
    datos.momentos[nombre] = est
    // El toque que sigue (cadena de GOLPE o de MÁQUINA) entra con el motor congelado: el latch de la
    // UI lo guarda y el motor lo lee en el primer tick, dentro de la ventana para encadenar.
    if (antesDeSoltar) await antesDeSoltar()
    await c.evaluar('__rev.soltar()')
  } else {
    datos.momentos[nombre] = 'NO SE VIO'
  }
  anotar(`${ok ? 'foto ' : 'FALTA'} ${nombre}${ok ? ' · ' + datos.momentos[nombre] : ''}`)
  return ok
}
const ev = (js) => c.evaluar(`(() => { const p = __rev.p; const A = p.luchadores[0], B = p.luchadores[1]; ${js} })()`)
const poner = (xa, xb) => ev(`if (A.enSuelo && B.enSuelo) { A.x = ${xa}; B.x = ${xb}; A.vx = 0; B.vx = 0 } return true`)

try {
  await c.cdp('Page.navigate', { url: URL })
  if (!(await c.esperarQue(`window.__corteFinal?.partida?.fase === 'pelea'`, 120000))) throw new Error('no arrancó la pelea')
  await c.evaluar(GANCHO)
  const joy = await c.evaluar(`(() => { const z = document.querySelector('[data-zona="joystick"]').getBoundingClientRect(); return { x: z.left + z.width * 0.45, y: z.top + z.height * 0.55, R: (window.__corteFinal.joystick && window.__corteFinal.joystick().R) || 56 } })()`)
  const btn = {}
  for (const b of ['golpe', 'herramienta', 'guardia', 'dash']) btn[b] = await c.centro(`[data-boton="${b}"]`)
  const carta = [await c.centro('[data-carta="1"]'), await c.centro('[data-carta="2"]')]
  const toque = async (b, ms = 45) => { const q = b; await c.dedo.tocar(q[0], q[1], ms, 2) }
  const stick = async (grados, r = 0.95) => {
    const x = joy.x + Math.cos((grados * Math.PI) / 180) * r * joy.R
    const y = joy.y - Math.sin((grados * Math.PI) / 180) * r * joy.R
    await c.dedo.mover(1, x, y)
  }
  const meta = await c.evaluar(`(() => { const p = window.__corteFinal.partida; return p.config.animaciones.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { n: v.n, imp: v.impactos }]))) })()`)
  const imp = (anim, lado = 0) => { const m = meta[lado][anim]; return m && m.imp.length ? m.imp[m.imp.length - 1] : Math.max(0, (m?.n ?? 1) - 1) }
  const imp0 = (anim, lado = 0) => { const m = meta[lado][anim]; return m && m.imp.length ? m.imp[0] : 0 }

  // 1. Quieto (el primer cuadro de la pelea).
  await poner(330, 630)
  await momento('quieto', `p.fase === 'pelea' && p.luchadores[0].anim === 'quieto'`, 3000)

  // 2. Caminar y correr (el stick a fondo hacia adelante).
  await poner(160, 800)
  await c.dedo.bajar(1, joy.x, joy.y)
  await stick(0)
  await momento('caminar', `p.luchadores[0].anim === 'caminar' && p.luchadores[0].animTick > 8`, 3000)
  await ev(`if (B.enSuelo) B.x = 880; return true`)
  await momento('correr', `p.luchadores[0].anim === 'correr' && p.luchadores[0].animTick > 6`, 3500)
  await c.dedo.subir(1)
  await esperar(250)

  // 3. Saltar y caer (arriba derecho, se suelta enseguida para no volver a saltar).
  await poner(300, 700)
  await c.dedo.bajar(1, joy.x, joy.y)
  await stick(90)
  await momento('saltar', `p.luchadores[0].anim === 'saltar' && p.luchadores[0].y > 75`, 3000)
  await c.dedo.subir(1)
  await momento('caer', `p.luchadores[0].anim === 'caer' && !p.luchadores[0].enSuelo && p.luchadores[0].y > 25`, 3000)
  await esperar(400)

  // 4. Esquiva hacia adelante, guardia y agachado.
  await poner(250, 700)
  await c.dedo.bajar(1, joy.x, joy.y)
  await stick(0)
  await esperar(60)
  await toque(btn.dash)
  await momento('esquiva', `p.luchadores[0].anim === 'dash' && p.luchadores[0].cuadro >= 1`, 2000)
  await c.dedo.subir(1)
  await esperar(500)
  await c.dedo.bajar(2, btn.guardia[0], btn.guardia[1])
  await momento('guardia', `p.luchadores[0].anim === 'guardia' && p.luchadores[0].animTick > 10`, 2000)
  await c.dedo.subir(2)
  await c.dedo.bajar(1, joy.x, joy.y)
  await stick(-90)
  await momento('agachado', `p.luchadores[0].anim === 'agachado' && p.luchadores[0].animTick > 10`, 2000)
  await c.dedo.subir(1)
  await esperar(300)

  // 5. Cadena de GOLPE: puño → patada → combo (cada foto en el cuadro de impacto).
  await poner(400, 495)
  await esperar(150)
  const tg = await c.evaluar('__rev.p.tick')
  const otroGolpe = () => toque(btn.golpe)
  let okGolpe = false
  let okPatada = false
  let okCombo = false
  for (let intento = 0; intento < 3 && !(okGolpe && okPatada && okCombo); intento++) {
    if (intento > 0) {
      await esperar(900)
      await poner(400, 495)
      await esperar(150)
    }
    await toque(btn.golpe)
    const g = await momento(okGolpe ? 'golpe_otra' : 'golpe', `p.luchadores[0].anim === 'golpe' && p.luchadores[0].cuadro === ${imp('golpe')}`, 1500, 0, otroGolpe)
    okGolpe = okGolpe || g
    if (!g) continue
    const pa = await momento(okPatada ? 'patada_otra' : 'patada', `p.luchadores[0].anim === 'patada' && p.luchadores[0].cuadro === ${imp('patada')}`, 1500, 0, otroGolpe)
    okPatada = okPatada || pa
    if (!pa) continue
    okCombo = okCombo || (await momento(okCombo ? 'combo_otra' : 'combo', `p.luchadores[0].anim === 'combo' && p.luchadores[0].cuadro === ${imp('combo')}`, 1800, 30))
  }
  anotar('anims en la cadena: ' + (await c.evaluar(`__rev.anims.filter((x) => +x.split(':')[0] >= ${tg}).join(' ')`)))
  await esperar(700)

  // 6. MÁQUINA (las dos herramientas).
  await poner(400, 500)
  await esperar(150)
  let okH1 = false
  let okH2 = false
  for (let intento = 0; intento < 3 && !(okH1 && okH2); intento++) {
    if (intento > 0) {
      await esperar(900)
      await poner(400, 500)
      await esperar(150)
    }
    await toque(btn.herramienta)
    const h1 = await momento(okH1 ? 'herramienta1_otra' : 'herramienta1', `p.luchadores[0].anim === 'herramienta1' && p.luchadores[0].cuadro === ${imp('herramienta1')}`, 1800, 0, () => toque(btn.herramienta))
    okH1 = okH1 || h1
    if (!h1) continue
    okH2 = okH2 || (await momento(okH2 ? 'herramienta2_otra' : 'herramienta2', `p.luchadores[0].anim === 'herramienta2' && p.luchadores[0].cuadro === ${imp('herramienta2')}`, 1800))
  }
  await esperar(600)

  // 7. Los dos especiales: super flash, cuadro de golpe, proyectil y efecto en el rival.
  for (const k of [1, 2]) {
    const d = DIST[ID][k - 1]
    await esperar(600)
    await ev(`A.carga = 10; B.carga = 0; return true`)
    await poner(300, Math.min(880, 300 + d))
    await esperar(120)
    const t0 = await c.evaluar('__rev.p.tick')
    const nodos0 = await c.evaluar('JSON.stringify(window.__nodosAudio || {})')
    await toque(carta[k - 1], 60)
    for (let intento = 0; intento < 3; intento++) {
      const salio = await c.esperarQue(`__rev.ev.some((e) => e.tipo === 'especial' && e.quien === 0 && e.t >= ${t0})`, 1300)
      if (salio) break
      await ev(`A.carga = 10; B.carga = 0; return true`)
      await poner(300, Math.min(880, 300 + d))
      await toque(carta[k - 1], 60)
    }
    const okFlash = await momento(`e${k}_flash`, `R.ev.some((e) => e.tipo === 'especial' && e.quien === 0 && e.t >= ${t0}) && p.tick - R.ev.find((e) => e.tipo === 'especial' && e.quien === 0 && e.t >= ${t0}).t >= 7`, 2500)
    const nodos1 = await c.evaluar('JSON.stringify(window.__nodosAudio || {})')
    await momento(`e${k}_golpe`, `p.luchadores[0].anim === 'especial${k}' && p.luchadores[0].cuadro >= ${imp0(`especial${k}`)}`, 2500, 20)
    const CON_PROYECTIL = { nico_u: [1], fabri: [2], luciano: [2], gabriel: [2], guillermo: [1, 2], rodrigo: [2], joaquin: [1], nahuel: [1], lucas: [1, 2], stefano: [1, 2], brian: [2], simon: [2], chipi: [1, 2] }
    if ((CON_PROYECTIL[ID] || []).includes(k)) await momento(`e${k}_proyectil`, `p.proyectiles.some((q) => q.duenio === 0 && q.edad >= ${ID === 'gabriel' ? 24 : ID === 'fabri' || ID === 'chipi' || ID === 'nico_u' ? 4 : 10})`, 2000)
    await momento(`e${k}_efecto`, `(() => { const B = p.luchadores[1]; const e = B.efectos; const g = R.desde('golpe', ${t0}).filter((x) => x.atacante === 0); return (g.length > 0 && p.tick - g[g.length - 1].t >= 5) || e.aturdido > 0 || e.mareado > 0 || e.quemado > 0 || e.lento > 0 || B.estado === 'agarrado' || p.luchadores[0].efectos.curando > 20 })()`, 3500, 30)
    await esperar(900)
    const nodos2 = await c.evaluar('JSON.stringify(window.__nodosAudio || {})')
    const evs = await c.evaluar(`__rev.ev.filter((e) => e.t >= ${t0}).map((e) => e.tipo + (e.herramienta ? ':' + e.herramienta : '') + (e.proyectil ? ':' + e.proyectil : '') + (e.atacante !== undefined ? '@' + e.atacante : e.quien !== undefined ? '@' + e.quien : '')).join(' ')`)
    const aud = await c.evaluar(`(() => { const a = window.__corteFinal.audio && window.__corteFinal.audio(); return a ? a.estado + ' voces ' + a.voces : 'sin audio' })()`)
    const n0 = JSON.parse(nodos0), n1 = JSON.parse(nodos1), n2 = JSON.parse(nodos2)
    const fuentes = (n2.osc + n2.buf) - (n0.osc + n0.buf)
    datos.especiales.push({ k, flash: okFlash, fuentesAudio: fuentes, fuentesFlash: (n1.osc + n1.buf) - (n0.osc + n0.buf), audio: aud, eventos: evs })
    anotar(`especial ${k}: fuentes de audio ${fuentes} (en el flash ${(n1.osc + n1.buf) - (n0.osc + n0.buf)}) · ${aud} · ${evs.slice(0, 400)}`)
  }

  // 8. Round 1: K.O. del rival y victoria.
  await esperar(1500)
  await ev(`B.vida = 1; return true`)
  for (let i = 0; i < 40; i++) {
    const f = await ev(`if (p.fase === 'pelea' && A.enSuelo && B.enSuelo && Math.abs(A.x - B.x) > 110) { A.x = B.x - 95 * Math.sign(B.x - A.x || 1) } return p.fase`)
    if (f !== 'pelea') break
    await toque(btn.golpe)
    await esperar(160)
  }
  await momento('ko_rival', `p.fase === 'ko' && p.luchadores[1].anim === 'ko' && p.luchadores[1].cuadro >= 1`, 4000, 40)
  await momento('victoria', `p.fase === 'entre_rounds' && p.luchadores[0].anim === 'victoria' && p.luchadores[0].animTick > 30`, 6000)

  // 9. Round 2: recibe daño, K.O. propio y festeja el rival.
  await c.esperarQue(`window.__rev.p.fase === 'pelea'`, 15000)
  await poner(420, 510)
  await ev(`B.carga = 10; return true`)
  await momento('danio', `p.luchadores[0].anim === 'danio' && (p.luchadores[0].estado === 'aturdido' || p.luchadores[0].estado === 'derribado')`, 12000)
  await ev(`A.vida = 1; return true`)
  const koPropio = await c.evaluar(`__rev.esperar("p.fase === 'ko'", 5000)`, 10000)
  if (koPropio) await c.evaluar('__rev.soltar()')
  else await ev(`A.vida = 0; return true`)
  await momento('ko', `p.luchadores[0].anim === 'ko' && p.luchadores[0].cuadro >= 1`, 4000, 40)
  await momento('rival_victoria', `p.fase === 'entre_rounds' && p.luchadores[1].anim === 'victoria' && p.luchadores[1].animTick > 30`, 6000)

  // 10. Round 3: «¡DEJALO AL CERO!», el remate y el resultado (sin tocar nada).
  await c.esperarQue(`window.__rev.p.fase === 'pelea'`, 15000)
  await ev(`B.vida = 1; return true`)
  for (let i = 0; i < 40; i++) {
    const f = await ev(`if (p.fase === 'pelea' && A.enSuelo && B.enSuelo && Math.abs(A.x - B.x) > 110) { A.x = B.x - 95 * Math.sign(B.x - A.x || 1) } return p.fase`)
    if (f !== 'pelea') break
    await toque(btn.golpe)
    await esperar(160)
  }
  await momento('final', `p.fase === 'final' && p.ticksFase > 40`, 5000)
  await esperar(200)
  await toque(btn.golpe)
  await momento('al_cero', `R.ev.some((e) => e.tipo === 'final_al_cero') && p.luchadores[1].anim === 'ko'`, 5000, 120)
  const llego = await c.esperarQue(`document.querySelector('.cf-juego')?.dataset.pantalla === 'resultado'`, 20000)
  if (llego) { await esperar(2600); await foto('resultado') }
  anotar(`resultado: ${llego ? 'sí' : 'NO'}`)

  const m = await c.evaluar(`(() => { const iv = __rev.iv.slice(30); const s = iv.slice().sort((a, b) => a - b); const prom = iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length); return { fps: +(1000 / prom).toFixed(1), p95ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(1), largos: iv.filter((x) => x > 50).length, cuadros: iv.length } })()`)
  datos.rendimiento = m
  anotar(`rendimiento: ${JSON.stringify(m)}`)
} catch (e) {
  anotar('ERROR ' + ((e && e.stack) || e))
  try { await foto('error') } catch {}
} finally {
  const cons = c.consola.filter((x) => !/favicon/.test(x))
  datos.consola = cons
  anotar(`consola (${cons.length}): ${cons.slice(0, 10).join(' | ') || 'limpia'}`)
  datos.fotos = fotos.map((f) => f.nombre)
  writeFileSync(path.join(DIR, `${ID}.json`), JSON.stringify(datos, null, 1))
  writeFileSync(path.join(DIR, `${ID}.txt`), log.join('\n') + '\n')
  await c.cerrar()
}
