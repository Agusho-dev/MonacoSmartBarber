// Pelea ONLINE de punta a punta con dos «celulares» (contextos aislados de UN Chrome headless):
// Ana en horizontal (844x390) desafía a Beto (vertical, 390x844) en la sala de una sucursal, cada uno
// elige un barbero en la elección online (13 caras, sin scroll), VS, y bots de teclado pelean hasta el
// final. Compara el hash de CADA tick de los dos celulares (lockstep), el ganador, los eventos que vio
// cada uno, los pedidos con error y la consola.
//   node scripts/juego/integracion/online-elenco.mjs [barberoAna] [barberoBeto]   (por defecto Lucas y Brian)
//   URL_BASE (obligatoria: el servidor, p. ej. http://localhost:3210; o la URL entera con /juego?s=…)
//   · SALA (la sucursal, por defecto pueyrredon) · SALIDA (capturas e informe)
// OJO: entra a la presencia REAL de esa sala en el Realtime de producción (ver «Sala online» en
// .claude/rules/juego.md): usar una sucursal sin clientes jugando o fuera de horario. Las peleas online
// no escriben en la base. No editar archivos del juego mientras corre (el Fast Refresh los saca de la
// sala). Con el candado: TURNO=chrome <scratchpad>/herramientas/turno.sh node …
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = process.env.SALIDA || join(tmpdir(), 'corte-final-integracion')
mkdirSync(DIR, { recursive: true })
const PERFIL = join(tmpdir(), `corte-final-perfil-online-${process.pid}`)
const PUERTO = 9391
/** URL_BASE es obligatoria: el :3100 es el servidor de desarrollo del dueño. */
const BASE = (() => {
  const u = (process.env.URL_BASE || '').trim().replace(/\/+$/, '')
  if (!u) {
    console.error('Falta URL_BASE: el servidor de desarrollo a probar (p. ej. URL_BASE=http://localhost:3210). El :3100 es el del dueño: usalo sólo a propósito.')
    process.exit(2)
  }
  return u.includes('/juego') ? u : `${u}/juego?s=${process.env.SALA || 'pueyrredon'}`
})()
const TAM = { Ana: [844, 390], Beto: [390, 844] }
rmSync(PERFIL, { recursive: true, force: true })
mkdirSync(PERFIL, { recursive: true })

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--user-data-dir=${PERFIL}`, `--remote-debugging-port=${PUERTO}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--window-size=844,844',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} ; try { rmSync(PERFIL, { recursive: true, force: true }) } catch {} })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const informe = []
const log = (txt) => {
  const l = `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${txt}`
  informe.push(l)
  console.log(l)
}
let fallas = 0
const verificar = (cond, txt) => {
  log(`${cond ? 'OK   ' : 'FALLA'} ${txt}`)
  if (!cond) fallas++
}
function terminar(codigo) {
  try { chrome.kill('SIGTERM') } catch {}
  writeFileSync(`${DIR}/online_elenco_informe.txt`, informe.join('\n') + '\n')
  setTimeout(() => { rmSync(PERFIL, { recursive: true, force: true }); process.exit(codigo) }, 800)
}

// ─── CDP a nivel navegador, con sesiones planas por página ──────────────────
let ws
let sigId = 0
const pendientes = new Map()
const oyentes = []
async function conectar() {
  let info = null
  for (let i = 0; i < 60 && !info; i++) {
    await esperar(200)
    try { info = await (await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).json() } catch {}
  }
  ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id); return }
    for (const o of oyentes) o(d)
  })
}
const cdp = (method, params = {}, sessionId) => new Promise((r) => {
  const id = ++sigId
  pendientes.set(id, r)
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
})

async function nuevaPagina(nombre, apodo) {
  const [ancho, alto] = TAM[nombre]
  const { result: ctx } = await cdp('Target.createBrowserContext', { disposeOnDetach: true })
  const { result: t } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId: ctx.browserContextId, newWindow: true })
  const { result: s } = await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  const p = { nombre, ancho, alto, targetId: t.targetId, sid: s.sessionId, ctx: ctx.browserContextId, consola: [], frames: [], fuentesMax: 0 }
  oyentes.push((d) => {
    if (d.sessionId !== p.sid) return
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(d.params.type)) {
      p.consola.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
    }
    if (d.method === 'Runtime.exceptionThrown') p.consola.push('EXCEPCION: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 400))
    if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) {
      p.consola.push(`log-${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url ?? ''}`.slice(0, 300))
    }
    if (d.method === 'Network.webSocketFrameSent') {
      const r = d.params.response ?? {}
      const datos = r.opcode === 2 ? Buffer.from(r.payloadData ?? '', 'base64').toString('latin1') : (r.payloadData ?? '')
      const tipo = datos.includes('heartbeat') ? 'heartbeat' : datos.includes('presence') ? 'presence' : datos.includes('phx_join') ? 'join' : datos.includes('phx_leave') ? 'leave' : r.opcode === 2 || datos.includes('broadcast') ? 'broadcast' : 'otro'
      p.frames.push({ t: Date.now(), tb: d.params.timestamp * 1000, tipo, canal: /juego-pelea/.test(datos) ? 'pelea' : /juego-sala/.test(datos) ? 'sala' : 'otro' })
    }
  })
  const c = (m, params = {}) => cdp(m, params, p.sid)
  p.c = c
  await c('Runtime.enable')
  await c('Page.enable')
  await c('Network.enable')
  await c('Log.enable')
  await c('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 2, mobile: true })
  await c('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await c('Emulation.setFocusEmulationEnabled', { enabled: true })
  await c('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, apodo: ${JSON.stringify(apodo)} })) } catch (e) {}`,
  })
  p.evaluar = async (expr) => (await c('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  p.foto = async (archivo) => {
    const f = await c('Page.captureScreenshot', { format: 'png' })
    if (f.result?.data) writeFileSync(`${DIR}/${archivo}.png`, Buffer.from(f.result.data, 'base64'))
  }
  p.esperar = async (expr, ms, cada = 200) => {
    const fin = Date.now() + ms
    while (Date.now() < fin) {
      if (await p.evaluar(expr)) return true
      await esperar(cada)
    }
    return false
  }
  // Dedos. En Chrome (CDP), touchStart y touchMove generan un evento por cada punto que CAMBIÓ,
  // pero touchEnd suelta los puntos que LISTA (y con [] los suelta todos): mandar los que quedan
  // apoyados, como antes, soltaba el stick y dejaba el botón apretado, y los toques siguientes con
  // ese id ya no llegaban. Se manda siempre SÓLO el punto que cambia (Chrome 156; ver
  // v3-verif/confirmar-movil-emulado/multitouch.mjs).
  const activos = new Map()
  const punto = (id) => { const q = activos.get(id); return { x: q.x, y: q.y, id, radiusX: 8, radiusY: 8, force: 1 } }
  p.dedo = {
    async bajar(id, x, y) { activos.set(id, { x, y }); await c('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punto(id)] }) },
    async mover(id, x, y) { activos.set(id, { x, y }); await c('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [punto(id)] }) },
    async subir(id) { if (!activos.has(id)) return; const q = punto(id); activos.delete(id); await c('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [q] }) },
  }
  p.tocar = async (sel, texto) => {
    // La cortina entre pantallas (≈ 0,7 s) se come los toques a propósito: se espera a que se vaya.
    await p.esperar(`!document.querySelector('.cf-cortina')`, 3000, 50)
    const r = await p.evaluar(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
      const e = ${texto ? `els.find((x) => x.textContent.includes(${JSON.stringify(texto)}))` : 'els[0]'}
      if (!e) return null
      const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]
    })()`)
    if (!r) throw new Error(`${nombre}: no está ${sel} ${texto ?? ''}`)
    await p.dedo.bajar(90, r[0], r[1])
    await p.dedo.subir(90)
  }
  p.tecla = (tipo, code, key) => c('Input.dispatchKeyEvent', { type: tipo, code, key })
  p.pantalla = () => p.evaluar(`document.querySelector('.cf-juego')?.dataset.pantalla ?? null`)
  p.ir = async (url) => c('Page.navigate', { url })
  p.audio = async () => {
    const a = await p.evaluar(`(() => { const f = window.__corteFinal?.audio; const d = f ? f() : null; return d && { estado: d.estado, tema: d.tema, sonando: d.sonandoPista, pos: d.posicionPista, fuentes: d.fuentesVivas, pista: d.pista } })()`)
    if (a && a.fuentes > p.fuentesMax) p.fuentesMax = a.fuentes
    return a
  }
  p.esperarAudio = async (cond, ms) => {
    const fin = Date.now() + ms
    let a = null
    while (Date.now() < fin) {
      a = await p.audio()
      if (a && cond(a)) return { ok: true, a }
      await esperar(150)
    }
    return { ok: false, a }
  }
  return p
}

// Bot de entradas aleatorias por teclado (mismo camino que un jugador: CapturaEntrada).
function crearBot(p, semilla) {
  let s = semilla >>> 0
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const sostenidas = new Set()
  const TECLAS = { izq: ['KeyA', 'a'], der: ['KeyD', 'd'], arr: ['KeyW', 'w'], aba: ['KeyS', 's'], golpe: ['KeyJ', 'j'], herr: ['KeyK', 'k'], guardia: ['KeyL', 'l'], e1: ['KeyU', 'u'], e2: ['KeyI', 'i'], dash: ['ShiftLeft', 'Shift'] }
  const bajar = async (k) => { if (!sostenidas.has(k)) { sostenidas.add(k); await p.tecla('keyDown', ...TECLAS[k]) } }
  const subir = async (k) => { if (sostenidas.has(k)) { sostenidas.delete(k); await p.tecla('keyUp', ...TECLAS[k]) } }
  let vivo = true
  let acciones = 0
  const correr = (async () => {
    while (vivo) {
      const x = r()
      if (x < 0.3) { await subir('izq'); await bajar('der') }
      else if (x < 0.5) { await subir('der'); await bajar('izq') }
      else if (x < 0.6) { await subir('der'); await subir('izq') }
      const toque = r()
      const k = toque < 0.38 ? 'golpe' : toque < 0.52 ? 'herr' : toque < 0.62 ? 'arr' : toque < 0.7 ? 'e1' : toque < 0.77 ? 'e2' : toque < 0.82 ? 'dash' : toque < 0.9 ? 'guardia' : 'aba'
      await bajar(k)
      await esperar(40 + Math.floor(r() * 120))
      await subir(k)
      acciones++
      await esperar(50 + Math.floor(r() * 140))
    }
    for (const k of [...sostenidas]) await subir(k)
  })()
  return { parar: async () => { vivo = false; await correr; return acciones } }
}




const [PJ_A = 'Lucas', PJ_B = 'Brian'] = process.argv.slice(2)
const marcar = (p, nombre) => p.evaluar(`(() => { document.querySelectorAll('[data-prueba]').forEach((e) => e.removeAttribute('data-prueba')); const f = [...document.querySelectorAll('.cf-eleccion-online .cf-ficha')].find((b) => b.querySelector('.cf-ficha__nombre')?.textContent.trim().toLowerCase() === ${JSON.stringify(nombre.toLowerCase())}); if (!f) return false; f.setAttribute('data-prueba', ''); f.scrollIntoView({ block: 'nearest' }); return true })()`)
const OBSERVAR = `(() => {
  const p = window.__corteFinal && window.__corteFinal.partida
  if (!p || p.__observada) return !!p
  window.__evs = []
  const push = p.eventos.push.bind(p.eventos)
  p.eventos.push = (...a) => { for (const e of a) window.__evs.push(e); return push(...a) }
  Object.defineProperty(p, '__observada', { value: true, enumerable: false })
  return true
})()`
try {
  await conectar()
  log('Chrome listo')
  const A = await nuevaPagina('Ana', 'Ana')
  const B = await nuevaPagina('Beto', 'Beto')
  await A.ir(BASE)
  verificar(await A.esperar(`!!document.querySelector('.cf-inicio__tocar')`, 120_000), 'Ana (844x390): inicio')
  await esperar(2000)
  await B.ir(BASE)
  verificar(await B.esperar(`!!document.querySelector('.cf-inicio__tocar')`, 120_000), 'Beto (390x844): inicio')
  const seVen = (await A.esperar(`!!document.querySelector('.cf-sala-chip, .cf-sala-aviso')`, 25_000, 100)) && (await B.esperar(`!!document.querySelector('.cf-sala-chip, .cf-sala-aviso')`, 25_000, 100))
  verificar(seVen, 'se ven en la sala de Pueyrredón')
  await esperar(800)
  await A.tocar(await A.evaluar(`!!document.querySelector('.cf-sala-aviso__ver')`) ? '.cf-sala-aviso__ver' : '.cf-sala-chip')
  verificar(await A.esperar(`!!document.querySelector('.cf-sala-fila__desafiar')`, 10_000), 'Ana: la sala muestra a Beto')
  await A.tocar('.cf-sala-fila__desafiar')
  verificar(await B.esperar(`!!document.querySelector('.cf-desafio__aceptar')`, 10_000), 'Beto: le llega el desafío')
  await esperar(500)
  await B.tocar('.cf-desafio__aceptar')
  const eligen = (await A.esperar(`!!document.querySelector('.cf-eleccion-online .cf-plantel') && !document.querySelector('.cf-eleccion-online__conectando')`, 15_000)) &&
    (await B.esperar(`!!document.querySelector('.cf-eleccion-online .cf-plantel') && !document.querySelector('.cf-eleccion-online__conectando')`, 15_000))
  verificar(eligen, 'los dos en la elección online')
  await esperar(900)
  const caras = async (p) => p.evaluar(`(() => ({ caras: document.querySelectorAll('.cf-eleccion-online .cf-ficha').length, scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }))()`)
  const cA = await caras(A)
  const cB = await caras(B)
  verificar(cA.caras === 13 && cB.caras === 13 && !cA.scroll && !cB.scroll, `elección online: 13 caras en los dos, sin scroll horizontal (${JSON.stringify(cA)} · ${JSON.stringify(cB)})`)
  await A.foto('online_1_eleccion_A')
  await B.foto('online_1_eleccion_B')
  verificar(await marcar(A, PJ_A), `Ana encuentra a ${PJ_A}`)
  await A.tocar('.cf-ficha[data-prueba]')
  verificar(await marcar(B, PJ_B), `Beto encuentra a ${PJ_B}`)
  await B.tocar('.cf-ficha[data-prueba]')
  await esperar(500)
  await A.tocar('.cf-eleccion-online .cf-seleccion__pelear')
  verificar(await B.esperar(`!!document.querySelector('.cf-eleccion-online__estado[data-listo]')`, 6000), 'Beto ve que Ana ya eligió')
  await esperar(400)
  await B.tocar('.cf-eleccion-online .cf-seleccion__pelear')
  verificar(await A.esperar(`!!document.querySelector('.cf-vs')`, 8000) && (await B.esperar(`!!document.querySelector('.cf-vs')`, 8000)), 'VS online en los dos')
  await esperar(900)
  await A.foto('online_2_vs_A')
  await B.foto('online_2_vs_B')
  const pelean = (await A.esperar(`!!document.querySelector('.cf-pelea[data-online]')`, 40_000)) && (await B.esperar(`!!document.querySelector('.cf-pelea[data-online]')`, 40_000))
  verificar(pelean, 'pelea online montada en los dos')
  for (const p of [A, B]) await p.esperar(OBSERVAR, 10_000, 100)
  // Sin `cpu`: online el gancho expone la vista del audio (vistaParaAudio), que marca al otro como CPU
  // en cada celular a propósito; la partida simulada es la misma.
  const cfg = await A.evaluar(`(() => { const k = window.__corteFinal?.partida?.config; return k && { personajes: k.personajes, arena: k.arena, semilla: k.semilla } })()`)
  const cfgB = await B.evaluar(`(() => { const k = window.__corteFinal?.partida?.config; return k && { personajes: k.personajes, arena: k.arena, semilla: k.semilla } })()`)
  verificar(JSON.stringify(cfg) === JSON.stringify(cfgB) && cfg.personajes.join() === [PJ_A, PJ_B].map((n) => n.toLowerCase()).join(), `la misma partida en los dos: ${JSON.stringify(cfg)}`)
  const tPelea = Date.now()
  const enPelea = (await A.esperar(`window.__corteFinal?.partida?.fase === 'pelea'`, 15_000, 100)) && (await B.esperar(`window.__corteFinal?.partida?.fase === 'pelea'`, 15_000, 100))
  verificar(enPelea, 'los dos en la fase de pelea')
  const botA = crearBot(A, 31)
  const botB = crearBot(B, 47)
  await esperar(12_000)
  await A.foto('online_3_pelea_A')
  await B.foto('online_3_pelea_B')
  const terminaron = (await A.esperar(`document.querySelector('.cf-juego')?.dataset.pantalla === 'online-resultado'`, 360_000, 1000)) &&
    (await B.esperar(`document.querySelector('.cf-juego')?.dataset.pantalla === 'online-resultado'`, 30_000, 500))
  const tFin = Date.now()
  const accA = await botA.parar()
  const accB = await botB.parar()
  verificar(terminaron, `la pelea termina (${((tFin - tPelea) / 1000).toFixed(0)} s, ${accA}/${accB} acciones de los bots)`)
  const hA = await A.evaluar(`(() => { const o = window.__corteFinal?.online; return o ? { h: Array.from(o.hashes, (x) => x ?? null), fin: o.tickFin, g: o.ganador } : null })()`)
  const hB = await B.evaluar(`(() => { const o = window.__corteFinal?.online; return o ? { h: Array.from(o.hashes, (x) => x ?? null), fin: o.tickFin, g: o.ganador } : null })()`)
  const hasta = Math.min(hA.fin || hA.h.length - 1, hB.fin || hB.h.length - 1)
  let distintos = 0
  let faltan = 0
  let primero = -1
  for (let t = 1; t <= hasta; t++) {
    if (hA.h[t] == null || hB.h[t] == null) { faltan++; continue }
    if (hA.h[t] !== hB.h[t]) { distintos++; if (primero < 0) primero = t }
  }
  verificar(distintos === 0 && faltan === 0 && hasta > 1000, `hashes de CADA tick iguales: ${hasta} ticks comparados, ${distintos} distintos${primero >= 0 ? ' (primero ' + primero + ')' : ''}, ${faltan} sin dato`)
  verificar(hA.fin === hB.fin && hA.fin > 0 && hA.g !== null && hA.g === hB.g, `mismo final: tick ${hA.fin} / ${hB.fin}, ganador lado ${hA.g} / ${hB.g}`)
  const resumen = (p) => p.evaluar(`(() => { const c = {}; for (const e of window.__evs || []) { const k = e.tipo === 'especial' ? 'especial' + e.numero + ':' + e.quien : e.tipo === 'proyectil' ? 'proyectil:' + e.proyectil : ['agarre', 'nube', 'sismo', 'aturdido', 'mareado', 'quemado', 'curacion', 'derribo', 'guardia_rota', 'final_al_cero', 'fin_partida'].includes(e.tipo) ? e.tipo : null; if (k) c[k] = (c[k] || 0) + 1 } return c })()`)
  const rA = await resumen(A)
  const rB = await resumen(B)
  verificar(JSON.stringify(rA) === JSON.stringify(rB) && Object.keys(rA).some((k) => k.startsWith('especial')), `los dos celulares vieron los mismos eventos: ${JSON.stringify(rA)}`)
  const tA = await A.evaluar(`document.querySelector('.cf-resultado-online__titulo')?.textContent ?? ''`)
  const tB = await B.evaluar(`document.querySelector('.cf-resultado-online__titulo')?.textContent ?? ''`)
  log(`      resultado: Ana «${tA}» · Beto «${tB}»`)
  await esperar(1500)
  await A.foto('online_4_resultado_A')
  await B.foto('online_4_resultado_B')
  for (const p of [A, B]) {
    const malos = await p.evaluar(`performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400).map((r) => r.responseStatus + ' ' + r.name)`)
    verificar(malos.length === 0, `${p.nombre}: ningún pedido con error (${malos.join(' | ') || 'ninguno'})`)
  }
  await A.tocar('.cf-resultado__acciones .cf-btn--sec')
  await B.tocar('.cf-resultado__acciones .cf-btn--sec')
  await esperar(2500)
  const ruido = (l) => /Download the React DevTools|\[Fast Refresh\]|webpack-hmr|turbopack|\[HMR\]/i.test(l)
  const errA = A.consola.filter((l) => !ruido(l))
  const errB = B.consola.filter((l) => !ruido(l))
  verificar(errA.length === 0 && errB.length === 0, `consola sin errores ni avisos: Ana ${errA.length} · Beto ${errB.length}`)
  for (const l of [...errA.slice(0, 8), ...errB.slice(0, 8)]) log('      ' + l)
  log(fallas === 0 ? 'TODO OK' : `${fallas} FALLAS`)
  ws.close()
  terminar(fallas === 0 ? 0 : 1)
} catch (e) {
  log('ERROR ' + (e?.stack ?? e))
  terminar(2)
}
