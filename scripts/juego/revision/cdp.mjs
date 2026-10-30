// Chrome headless por CDP (sin dependencias) para la revisión visual de «Corte Final».
// Perfil temporal propio que se borra al cerrar. Cuenta las fuentes de sonido que crea la página
// (osciladores y buffers de WebAudio) para saber si un especial «sonó».
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const CONTADOR_AUDIO = `
(() => {
  try {
    const n = (window.__nodosAudio = { osc: 0, buf: 0 })
    const P = (window.AudioContext || window.webkitAudioContext).prototype
    const o = P.createOscillator, b = P.createBufferSource
    P.createOscillator = function () { n.osc++; return o.apply(this, arguments) }
    P.createBufferSource = function () { n.buf++; return b.apply(this, arguments) }
  } catch (e) {}
})()`

export async function abrirChrome({ ancho = 844, alto = 390, movil = true, prefs = { tutorialVisto: true }, flags = [], puerto = 9455, escala = 2 } = {}) {
  const PERFIL = path.join(os.tmpdir(), `cf-revision-perfil-${process.pid}-${puerto}`)
  rmSync(PERFIL, { recursive: true, force: true })
  mkdirSync(PERFIL, { recursive: true })
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--user-data-dir=${PERFIL}`, `--remote-debugging-port=${puerto}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', `--window-size=${ancho},${alto}`,
    '--autoplay-policy=no-user-gesture-required',
    ...flags, 'about:blank',
  ], { stdio: 'ignore' })
  let cerrado = false
  let ws = null
  const cerrar = async () => {
    if (cerrado) return
    cerrado = true
    try { ws?.close() } catch {}
    try { chrome.kill('SIGTERM') } catch {}
    await esperar(800)
    try { chrome.kill('SIGKILL') } catch {}
    rmSync(PERFIL, { recursive: true, force: true })
  }
  process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} ; try { rmSync(PERFIL, { recursive: true, force: true }) } catch {} })
  let lista = null
  for (let i = 0; i < 80 && !lista; i++) {
    await esperar(200)
    try { lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json() } catch {}
  }
  if (!lista) { await cerrar(); throw new Error('chrome no levantó') }
  const pagina = lista.find((t) => t.type === 'page')
  ws = new WebSocket(pagina.webSocketDebuggerUrl)
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
  const evaluar = async (expr, msMax = 20000) => {
    const r = await Promise.race([
      cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
      esperar(msMax).then(() => ({ result: { exceptionDetails: { text: 'tiempo agotado' } } })),
    ])
    if (r.result?.exceptionDetails) throw new Error('evaluar: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    return r.result?.result?.value
  }
  const foto = async (archivo, clip) => {
    const f = await cdp('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' })
    writeFileSync(archivo, Buffer.from(f.result.data, 'base64'))
  }
  const esperarQue = async (expr, ms) => {
    for (let t = 0; t < ms; t += 120) {
      try { if (await evaluar(expr)) return true } catch {}
      await esperar(120)
    }
    return false
  }
  const centro = async (sel) => evaluar(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`)
  const activos = new Map()
  const lista2 = () => [...activos.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 }))
  const dedo = {
    async bajar(id, x, y) { activos.set(id, { x, y }); await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: lista2() }) },
    async mover(id, x, y) { activos.set(id, { x, y }); await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: lista2() }) },
    moverYa(id, x, y) { activos.set(id, { x, y }); cdpYa('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: lista2() }) },
    async subir(id) { if (!activos.has(id)) return; activos.delete(id); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lista2() }) },
    async tocar(x, y, ms = 50, id = 7) { await this.bajar(id, x, y); await esperar(ms); await this.subir(id) },
  }
  const tocar = async (sel) => {
    const c = await centro(sel)
    if (!c) throw new Error('no está ' + sel)
    if (movil) await dedo.tocar(c[0], c[1], 45, 99)
    else {
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1 })
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', clickCount: 1 })
    }
  }
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Log.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: movil ? escala : 1, mobile: movil })
  if (movil) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('cf.preferencias.v1', ${JSON.stringify(JSON.stringify(prefs))}) } catch (e) {}\n${CONTADOR_AUDIO}`,
  })
  return { cdp, evaluar, foto, esperarQue, centro, tocar, dedo, consola, cerrar }
}
