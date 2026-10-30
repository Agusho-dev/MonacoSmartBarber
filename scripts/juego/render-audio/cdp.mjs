// Chrome headless por CDP (sin dependencias) para la galería del render y la medición de niveles.
// Perfil temporal propio que se borra al cerrar.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { SALIDA } from './empaquetar.mjs'

export const DIR = SALIDA
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

export async function abrirChrome({ ancho = 844, alto = 390, movil = true, prefs = { tutorialVisto: true }, flags = [], puerto = 9373 } = {}) {
  const PERFIL = `${DIR}/perfil-${process.pid}`
  rmSync(PERFIL, { recursive: true, force: true })
  mkdirSync(PERFIL, { recursive: true })
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--user-data-dir=${PERFIL}`, `--remote-debugging-port=${puerto}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${ancho},${alto}`,
    ...flags, 'about:blank',
  ], { stdio: 'ignore' })
  let cerrado = false
  const cerrar = async () => {
    if (cerrado) return
    cerrado = true
    try { ws?.close() } catch {}
    try { chrome.kill('SIGTERM') } catch {}
    await esperar(700)
    rmSync(PERFIL, { recursive: true, force: true })
  }
  process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} ; try { rmSync(PERFIL, { recursive: true, force: true }) } catch {} })
  let lista = null
  for (let i = 0; i < 60 && !lista; i++) {
    await esperar(200)
    try { lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json() } catch {}
  }
  if (!lista) { await cerrar(); throw new Error('chrome no levantó') }
  const pagina = lista.find((t) => t.type === 'page')
  var ws = new WebSocket(pagina.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pendientes = new Map()
  const consola = []
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id) }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(d.params.type)) {
      consola.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '))
    }
    if (d.method === 'Runtime.exceptionThrown') consola.push('EXCEPCION: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text))
    if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) {
      consola.push(`log-${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url ?? ''}`)
    }
  })
  const cdp = (method, params = {}) => new Promise((r) => { const n = ++id; pendientes.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
  const cdpYa = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })) }
  const evaluar = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error('evaluar: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    return r.result?.result?.value
  }
  const foto = async (archivo) => {
    const f = await cdp('Page.captureScreenshot', { format: 'png' })
    writeFileSync(archivo, Buffer.from(f.result.data, 'base64'))
  }
  const esperarQue = async (expr, ms) => {
    for (let t = 0; t < ms; t += 150) {
      try { if (await evaluar(expr)) return true } catch {}
      await esperar(150)
    }
    return false
  }
  const centro = async (sel) => evaluar(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`)
  // Toques: mantiene el conjunto de dedos activos (CDP quiere todos en cada evento).
  const activos = new Map()
  const lista2 = () => [...activos.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 }))
  const dedo = {
    async bajar(id, x, y) { activos.set(id, { x, y }); await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: lista2() }) },
    async mover(id, x, y) { activos.set(id, { x, y }); await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: lista2() }) },
    /** Sin esperar la respuesta: para mandar movimientos a 60 Hz de verdad. */
    moverYa(id, x, y) { activos.set(id, { x, y }); cdpYa('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: lista2() }) },
    async subir(id) { activos.delete(id); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lista2() }) },
  }
  const tocar = async (sel) => {
    const c = await centro(sel)
    if (!c) throw new Error('no está ' + sel)
    if (movil) { await dedo.bajar(99, c[0], c[1]); await esperar(40); await dedo.subir(99) }
    else {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', clickCount: 1 })
    }
  }
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Log.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: movil ? 2 : 1, mobile: movil })
  if (movil) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('cf.preferencias.v1', ${JSON.stringify(JSON.stringify(prefs))}) } catch (e) {}`,
  })
  return { cdp, evaluar, foto, esperarQue, centro, tocar, dedo, consola, cerrar }
}

/** De la pantalla de inicio a la pelea (fase 'pelea' del motor). */
export async function entrarAPelea(c, url) {
  await c.cdp('Page.navigate', { url })
  if (!(await c.esperarQue(`!!document.querySelector('.cf-inicio__tocar')`, 90000))) throw new Error('no apareció el inicio')
  await esperar(900)
  await c.tocar('.cf-inicio__tocar')
  if (!(await c.esperarQue(`!!document.querySelector('.cf-seleccion__pelear')`, 15000))) throw new Error('no apareció la selección')
  await esperar(700)
  await c.tocar('.cf-seleccion__pelear')
  if (!(await c.esperarQue(`window.__corteFinal?.partida?.fase === 'pelea'`, 40000))) throw new Error('no arrancó la pelea')
}
