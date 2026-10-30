// Mini cliente de Chrome DevTools Protocol para probar la UI de «Corte Final» sin dependencias
// (Node ≥ 22: usa el WebSocket y el fetch globales). Lo usan los otros scripts de esta carpeta.
//
//   const ch = await abrirChrome({ puerto: 9347 })
//   const p = await ch.pagina()                    // o { aislada: true }: otro «celular» (storage propio)
//   await p.tam(390, 844, true)                     // celular vertical con toques
//   await p.navegar('http://localhost:3100/juego')
//   await p.esperarSelector('.cf-inicio__tocar')
//   await p.tocar('.cf-inicio__tocar')
//   await p.foto('/tmp/x.png')
//   p.consola                                       // errores y avisos de la consola y la red
//   await ch.cerrar()                               // mata Chrome y borra el perfil temporal
//
// Chrome headless con un perfil temporal (se borra al cerrar). En la Mac compartida, correrlo con el
// candado de Chrome (uno a la vez): TURNO=chrome <scratchpad>/herramientas/turno.sh node …
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function abrirChrome({ puerto = 9347, ancho = 844, alto = 844 } = {}) {
  const perfil = mkdtempSync(join(tmpdir(), 'corte-final-chrome-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--user-data-dir=${perfil}`,
      `--remote-debugging-port=${puerto}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      // Dos «celulares» en dos ventanas: la de atrás no se congela (sin esto el toque no llega nunca).
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--window-size=${ancho},${alto}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  const cerrar = async () => {
    try {
      chrome.kill('SIGTERM')
    } catch {}
    await esperar(800)
    rmSync(perfil, { recursive: true, force: true })
  }
  process.on('exit', () => {
    try {
      chrome.kill('SIGKILL')
    } catch {}
    try {
      rmSync(perfil, { recursive: true, force: true })
    } catch {}
  })

  let version = null
  for (let i = 0; i < 80 && !version; i++) {
    await esperar(200)
    try {
      version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json()
    } catch {}
  }
  if (!version) {
    await cerrar()
    throw new Error('Chrome no levantó')
  }

  let navWs = null
  let navId = 0
  const navPend = new Map()
  const nav = async (method, params = {}) => {
    if (!navWs) {
      navWs = new WebSocket(version.webSocketDebuggerUrl)
      await new Promise((r) => navWs.addEventListener('open', r, { once: true }))
      navWs.addEventListener('message', (m) => {
        const d = JSON.parse(m.data)
        if (d.id && navPend.has(d.id)) {
          navPend.get(d.id)(d)
          navPend.delete(d.id)
        }
      })
    }
    return new Promise((r) => {
      const n = ++navId
      navPend.set(n, r)
      navWs.send(JSON.stringify({ id: n, method, params }))
    })
  }

  const pagina = async ({ aislada = false } = {}) => {
    let url
    if (aislada) {
      const ctx = await nav('Target.createBrowserContext', { disposeOnDetach: false })
      const t = await nav('Target.createTarget', { url: 'about:blank', browserContextId: ctx.result.browserContextId, newWindow: true })
      url = `ws://127.0.0.1:${puerto}/devtools/page/${t.result.targetId}`
    } else {
      const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()
      url = lista.find((t) => t.type === 'page').webSocketDebuggerUrl
    }
    const ws = new WebSocket(url)
    await new Promise((r, x) => {
      ws.addEventListener('open', r, { once: true })
      ws.addEventListener('error', () => x(new Error('no se pudo conectar a ' + url)), { once: true })
      setTimeout(() => x(new Error('sin respuesta de ' + url)), 15000)
    })
    let id = 0
    const pendientes = new Map()
    const consola = []
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data)
      if (d.id && pendientes.has(d.id)) {
        pendientes.get(d.id)(d)
        pendientes.delete(d.id)
      }
      if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(d.params.type)) {
        consola.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '))
      }
      if (d.method === 'Runtime.exceptionThrown') {
        consola.push('EXCEPCION: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text))
      }
      if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) {
        consola.push(`log-${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url ?? ''}`)
      }
    })
    const cdp = (method, params = {}) =>
      new Promise((r) => {
        const n = ++id
        pendientes.set(n, r)
        ws.send(JSON.stringify({ id: n, method, params }))
      })
    const evaluar = async (expr) => {
      // Con tope: si el dev server recarga la página en medio (Fast Refresh), la respuesta no llega nunca.
      const r = await Promise.race([
        cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
        new Promise((x) => setTimeout(() => x({ result: { exceptionDetails: { text: 'sin respuesta en 15 s' } } }), 15000)),
      ])
      if (r.result?.exceptionDetails) throw new Error('evaluar: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400))
      return r.result?.result?.value
    }
    await cdp('Runtime.enable')
    await cdp('Page.enable')
    await cdp('Log.enable')

    let movil = true
    const tam = async (w, h, esMovil = true) => {
      movil = esMovil
      await cdp('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: esMovil ? 2 : 1,
        mobile: esMovil,
        screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
      })
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: esMovil, maxTouchPoints: 5 })
    }
    const alAbrir = (js) => cdp('Page.addScriptToEvaluateOnNewDocument', { source: js })
    const navegar = (u) => cdp('Page.navigate', { url: u })
    const foto = async (archivo) => {
      const f = await cdp('Page.captureScreenshot', { format: 'png' })
      writeFileSync(archivo, Buffer.from(f.result.data, 'base64'))
    }
    const esperarSelector = async (sel, ms = 30000) => {
      for (let t = 0; t < ms; t += 200) {
        try {
          if (await evaluar(`!!document.querySelector(${JSON.stringify(sel)})`)) return true
        } catch {}
        await esperar(200)
      }
      return false
    }
    /** La cortina entre pantallas se come los toques ≈ 0,7 s a propósito. */
    const sinCortina = async (ms = 5000) => {
      for (let t = 0; t < ms; t += 100) {
        if (await evaluar(`!document.querySelector('.cf-cortina')`)) return true
        await esperar(100)
      }
      return false
    }
    const centro = (sel) =>
      evaluar(
        `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()`,
      )
    const tocarEn = async (x, y) => {
      if (movil) {
        await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        await esperar(40)
        await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      }
    }
    const tocar = async (sel) => {
      if (!(await centro(sel))) throw new Error('no está ' + sel)
      await esperar(60)
      const [x, y] = await centro(sel)
      await tocarEn(x, y)
    }
    /** Marca la ficha de la grilla con ese nombre (el visible, en minúsculas) para tocarla. */
    const marcarFicha = (nombre) =>
      evaluar(
        `(() => { document.querySelectorAll('[data-prueba]').forEach((e) => e.removeAttribute('data-prueba')); const f = [...document.querySelectorAll('.cf-ficha')].find((b) => b.querySelector('.cf-ficha__nombre')?.textContent.trim().toLowerCase() === ${JSON.stringify(nombre.toLowerCase())}); if (!f) return false; f.setAttribute('data-prueba', ''); return true })()`,
      )
    return { cdp, evaluar, tam, alAbrir, navegar, foto, esperarSelector, sinCortina, tocar, tocarEn, centro, marcarFicha, consola }
  }

  return { pagina, cerrar }
}
