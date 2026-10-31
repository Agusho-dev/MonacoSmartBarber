// Pruebas de la CARGA de recursos (src/lib/juego/render/recursos.ts) en Node, contra un servidor HTTP
// propio dentro del mismo proceso que sirve public/ como Vercel (ETag fuerte, Range) y puede cortar,
// trabar o gotear cada pedido. Usa el render empaquetado (empaquetar.mjs) con createImageBitmap de
// mentira: lo que se prueba son los pedidos y los bytes que llegan a decodificar.
//
//   node scripts/juego/render-audio/prueba-carga.mjs [escenario …]
//
// Escenarios: corte (se corta a la mitad y el reintento pide sólo el resto con Range/If-Range),
// cambio (el archivo cambió entre los dos intentos: 200 y de cero), trabado (deja de llegar: el vigía
// corta a los 15 s y retoma), goteo (gotas de 100 bytes: menos de 2 KB en 15 s es un pedido colgado),
// lento (5 KB/s parejo durante 20 s: NO se corta), manual (dos cortes: el error de la carga y el
// «Reintentar» retoma lo bajado), cancelar (la carga se cancela: rechaza ya, cierra los pedidos y la
// siguiente no reusa la bajada colgada), compartida (dos cargas con el mismo atlas: cancelar una no
// corta la otra), noexiste (un 404 no se reintenta). Sale con código 1 si algo no da.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { empaquetar, REPO } from './empaquetar.mjs'

const PUBLICO = path.join(REPO, 'public')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const md5 = (b) => createHash('md5').update(b).digest('hex')

// ─── Servidor ────────────────────────────────────────────────────────────────
/** Por archivo: cómo responder cada pedido (null = normal). Lo arma cada escenario. */
let reglas = () => null
/** Archivos «cambiados» (se sirven con otro contenido y otro ETag). */
const cambiados = new Map()
/** Archivos que el servidor contesta con 404. */
const faltan = new Set()
const pedidos = []

/** El archivo de `ruta` («/juego/…»), o su versión «cambiada». */
function contenido(ruta) {
  if (cambiados.has(ruta)) return cambiados.get(ruta)
  return readFileSync(path.join(PUBLICO, ruta))
}

/** Pedidos del escenario en curso (cada uno arranca con el render recién cargado: sin cachés). */
let desdePedido = 0
const delEscenario = () => pedidos.slice(desdePedido)

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const ruta = decodeURIComponent(url.pathname)
  const registro = { ruta, range: req.headers.range ?? null, ifRange: req.headers['if-range'] ?? null, estado: 0, enviados: 0, cerrado: false }
  pedidos.push(registro)
  req.on('close', () => {
    if (!res.writableEnded) registro.cerrado = true
  })
  let cuerpo
  try {
    if (faltan.has(ruta)) throw new Error('falta')
    cuerpo = contenido(ruta)
  } catch {
    registro.estado = 404
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('no')
    return
  }
  const etag = `"${md5(cuerpo)}"`
  const tipo = ruta.endsWith('.json') ? 'application/json' : ruta.endsWith('.webp') ? 'image/webp' : 'image/png'
  let desde = 0
  let estado = 200
  const m = registro.range && /^bytes=(\d+)-$/.exec(registro.range)
  if (m && (!registro.ifRange || registro.ifRange === etag)) {
    desde = Number(m[1])
    if (desde >= cuerpo.length) {
      registro.estado = 416
      res.writeHead(416, { 'content-range': `bytes */${cuerpo.length}` })
      res.end()
      return
    }
    estado = 206
  }
  const parte = cuerpo.subarray(desde)
  const cab = { 'content-type': tipo, 'content-length': String(parte.length), etag, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=0, must-revalidate' }
  if (estado === 206) cab['content-range'] = `bytes ${desde}-${cuerpo.length - 1}/${cuerpo.length}`
  registro.estado = estado
  res.writeHead(estado, cab)
  const regla = reglas(registro, delEscenario().filter((p) => p.ruta === ruta).length)
  if (!regla) {
    registro.enviados = parte.length
    res.end(parte)
    return
  }
  // Una regla: { hasta: bytes a mandar enteros, despues: 'cortar' | 'trabar' | 'gotear' | 'lento', ... }
  const primero = Math.min(parte.length, regla.hasta ?? parte.length)
  res.write(parte.subarray(0, primero))
  registro.enviados = primero
  let i = primero
  if (regla.despues === 'cortar') {
    await esperar(50)
    req.socket.destroy()
    return
  }
  if (regla.despues === 'trabar') return // nunca más un byte (el socket queda abierto)
  const paso = regla.despues === 'gotear' ? 100 : regla.porSegundo / 10
  const cada = regla.despues === 'gotear' ? 2000 : 100
  while (i < parte.length && !registro.cerrado) {
    await esperar(cada)
    if (registro.cerrado) return
    const n = Math.min(paso, parte.length - i)
    res.write(parte.subarray(i, i + n))
    i += n
    registro.enviados = i
  }
  if (!registro.cerrado) res.end()
})
await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const ORIGEN = `http://127.0.0.1:${servidor.address().port}`

// ─── Entorno del render ──────────────────────────────────────────────────────
globalThis.location = { href: `${ORIGEN}/juego`, origin: ORIGEN }
const decodificados = []
globalThis.createImageBitmap = async (blob) => {
  const bytes = Buffer.from(await blob.arrayBuffer())
  const img = { width: 1, height: 1, close() {}, md5: md5(bytes), largo: bytes.length }
  decodificados.push(img)
  return img
}
const bundle = empaquetar('render')
/** El render de cada escenario: el bundle cargado de nuevo (módulos nuevos, cachés vacías). */
let R = null
async function renderNuevo(etiqueta) {
  await import(`${pathToFileURL(bundle).href}?escenario=${encodeURIComponent(etiqueta)}`)
  R = globalThis.CorteFinalRender.indice
}

const ATLAS = (id) => `/juego/personajes/${id}/${JSON.parse(readFileSync(path.join(PUBLICO, `juego/personajes/${id}/atlas.json`), 'utf8')).imagen}`
const fallas = []
const ok = (cond, texto) => {
  console.log(`${cond ? '  ok ' : '  MAL'} ${texto}`)
  if (!cond) fallas.push(texto)
}
const delAtlas = (id) => delEscenario().filter((p) => p.ruta === ATLAS(id))
const ESCENARIOS = {
  async corte() {
    const ruta = ATLAS('fabri')
    const largo = contenido(ruta).length
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: Math.floor(largo * 0.4), despues: 'cortar' } : null)
    const rec = await R.cargarRecursos(['fabri', 'luciano'], 'caseros')
    const ps = delAtlas('fabri')
    ok(ps.length === 2, `dos pedidos del atlas (hubo ${ps.length})`)
    ok(ps[1]?.range === `bytes=${ps[0]?.enviados}-` && ps[1]?.ifRange === `"${md5(contenido(ruta))}"`, `el segundo pide el resto con Range e If-Range (${ps[1]?.range} ${ps[1]?.ifRange})`)
    ok(ps[1]?.estado === 206, `el segundo es un 206 (${ps[1]?.estado})`)
    ok(ps.reduce((s, p) => s + p.enviados, 0) === largo, `en total se bajó el archivo una vez (${ps.reduce((s, p) => s + p.enviados, 0)} de ${largo} bytes)`)
    ok(rec.atlas.fabri?.imagen?.md5 === md5(contenido(ruta)), 'lo decodificado es el archivo entero, byte a byte')
  },
  async cambio() {
    const ruta = ATLAS('gabriel')
    const original = contenido(ruta)
    reglas = (r, n) => {
      if (r.ruta === ruta && n === 1) {
        // Después del corte, el archivo «cambia» (un deploy en el medio): otro ETag.
        setTimeout(() => cambiados.set(ruta, Buffer.concat([original, Buffer.from('cambio')])), 10)
        return { hasta: Math.floor(original.length * 0.4), despues: 'cortar' }
      }
      return null
    }
    const rec = await R.cargarRecursos(['gabriel', 'guillermo'], 'caseros')
    const ps = delAtlas('gabriel')
    ok(ps.length === 2 && ps[1].range !== null && ps[1].estado === 200, `con otro ETag el servidor manda el archivo entero (${ps.map((p) => p.estado).join(', ')})`)
    ok(rec.atlas.gabriel?.imagen?.md5 === md5(cambiados.get(ruta)), 'lo decodificado es el archivo NUEVO entero (no mezcla)')
    cambiados.clear()
  },
  async trabado() {
    const ruta = ATLAS('rodrigo')
    const largo = contenido(ruta).length
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: Math.floor(largo * 0.3), despues: 'trabar' } : null)
    const t0 = Date.now()
    const rec = await R.cargarRecursos(['rodrigo', 'joaquin'], 'parana')
    const s = (Date.now() - t0) / 1000
    const ps = delAtlas('rodrigo')
    ok(ps.length === 2 && ps[0].cerrado, `el pedido trabado se cortó (${ps.length} pedidos, el primero cerrado: ${ps[0]?.cerrado})`)
    ok(s >= 14.5 && s < 18, `lo cortó el vigía a los ≈ 15 s (la carga tardó ${s.toFixed(1)} s)`)
    ok(ps[1]?.estado === 206 && ps[1].range === `bytes=${ps[0].enviados}-`, `y el reintento retomó (${ps[1]?.range}, ${ps[1]?.estado})`)
    ok(rec.atlas.rodrigo?.imagen?.md5 === md5(contenido(ruta)), 'archivo entero')
  },
  async goteo() {
    const ruta = ATLAS('nahuel')
    const largo = contenido(ruta).length
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: Math.floor(largo * 0.3), despues: 'gotear' } : null)
    const t0 = Date.now()
    const rec = await R.cargarRecursos(['nahuel', 'lucas'], 'parana')
    const s = (Date.now() - t0) / 1000
    const ps = delAtlas('nahuel')
    ok(ps.length === 2 && ps[0].cerrado, `100 bytes cada 2 s es un pedido colgado: se cortó (${ps.length} pedidos)`)
    ok(s >= 14.5 && s < 18, `a los ≈ 15 s (${s.toFixed(1)} s)`)
    ok(ps[1]?.estado === 206 && ps[1].range === `bytes=${ps[0].enviados}-`, `y retomó desde lo que había llegado (${ps[1]?.range})`)
    ok(rec.atlas.nahuel?.imagen?.md5 === md5(contenido(ruta)), 'archivo entero')
  },
  async lento() {
    // 5 KB/s parejos: el atlas tarda > 60 s; con el tope viejo de 60 s se cortaba. Acá se corta la
    // prueba a los 20 s (cancelando) y se mira que el pedido NUNCA se cortó solo.
    const ruta = ATLAS('stefano')
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: 0, despues: 'lento', porSegundo: 5000 } : null)
    const control = new AbortController()
    const carga = R.cargarRecursos(['stefano', 'brian'], 'parana', undefined, { senal: control.signal })
    await esperar(20_000)
    const ps = delAtlas('stefano')
    ok(ps.length === 1 && !ps[0].cerrado && ps[0].enviados > 90_000, `a 5 KB/s sigue bajando a los 20 s, sin cortes (${ps.length} pedido, ${ps[0]?.enviados} bytes)`)
    control.abort()
    let error = null
    try {
      await carga
    } catch (e) {
      error = e
    }
    ok(R.esCancelacion(error), `cancelada, rechaza con AbortError (${error?.name})`)
    await esperar(100)
    ok(delAtlas('stefano')[0]?.cerrado === true, 'y el pedido lento se cerró')
  },
  async manual() {
    // Los dos intentos de bajar() se cortan: la carga da error. El «Reintentar» (otra carga) retoma
    // lo que juntaron los dos (sin depender de la caché del navegador).
    const ruta = ATLAS('simon')
    const largo = contenido(ruta).length
    reglas = (r, n) => (r.ruta === ruta && n <= 2 ? { hasta: Math.floor(largo * 0.25), despues: 'cortar' } : null)
    let error = null
    try {
      await R.cargarRecursos(['simon', 'chipi'], 'rondeau')
    } catch (e) {
      error = e
    }
    ok(error && !R.esCancelacion(error), `con dos cortes la carga falla (el error de la pantalla: ${String(error?.message).slice(0, 60)}…)`)
    const rec = await R.cargarRecursos(['simon', 'chipi'], 'rondeau')
    const ps = delAtlas('simon')
    ok(ps.length === 3 && ps[2].range === `bytes=${ps[0].enviados + ps[1].enviados}-` && ps[2].estado === 206, `«Reintentar» pide sólo lo que falta (${ps.map((p) => p.range ?? 'entero').join(' → ')})`)
    ok(rec.atlas.simon?.imagen?.md5 === md5(contenido(ruta)), 'archivo entero')
  },
  async cancelar() {
    const ruta = ATLAS('nico_u')
    const largo = contenido(ruta).length
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: Math.floor(largo * 0.2), despues: 'trabar' } : null)
    const control = new AbortController()
    const carga = R.cargarRecursos(['nico_u', 'fabri'], 'rondeau', undefined, { senal: control.signal })
    await esperar(1500)
    const t0 = Date.now()
    control.abort()
    let error = null
    try {
      await carga
    } catch (e) {
      error = e
    }
    ok(R.esCancelacion(error) && Date.now() - t0 < 200, `«Volver»: la carga rechaza enseguida con AbortError (${Date.now() - t0} ms)`)
    await esperar(150)
    ok(delAtlas('nico_u')[0]?.cerrado === true, 'el pedido colgado se cerró (no sigue compitiendo por la red)')
    const t1 = Date.now()
    const rec = await R.cargarRecursos(['nico_u', 'fabri'], 'rondeau')
    const ps = delAtlas('nico_u')
    ok(ps.length === 2 && Date.now() - t1 < 3000, `el siguiente «¡A pelear!» no espera la bajada colgada: pide de nuevo (${ps.length} pedidos, ${Date.now() - t1} ms)`)
    ok(ps[1]?.estado === 206, `y retoma lo ya bajado (${ps[1]?.range})`)
    ok(rec.atlas.nico_u?.imagen?.md5 === md5(contenido(ruta)), 'archivo entero')
  },
  async compartida() {
    const ruta = ATLAS('joaquin')
    reglas = (r, n) => (r.ruta === ruta && n === 1 ? { hasta: 0, despues: 'lento', porSegundo: 400_000 } : null)
    const a = new AbortController()
    const cargaA = R.cargarRecursos(['joaquin', 'stefano'], 'parana', undefined, { senal: a.signal })
    await esperar(200)
    const cargaB = R.cargarRecursos(['joaquin', 'nahuel'], 'parana')
    await esperar(200)
    a.abort()
    let errorA = null
    try {
      await cargaA
    } catch (e) {
      errorA = e
    }
    const recB = await cargaB
    const ps = delAtlas('joaquin')
    ok(R.esCancelacion(errorA), 'la carga cancelada rechaza')
    ok(ps.length === 1 && !ps[0].cerrado, `la otra carga sigue con la MISMA bajada (${ps.length} pedido, cortado: ${ps[0]?.cerrado})`)
    ok(recB.atlas.joaquin?.imagen?.md5 === md5(contenido(ruta)), 'y la termina entera')
  },
  async noexiste() {
    // Un 404 (la cara de Lucas, que es opcional) no se reintenta y la carga sigue sin ella.
    reglas = () => null
    faltan.add('/juego/personajes/lucas/cara.webp')
    const avisos = []
    const warn0 = console.warn
    console.warn = (...a) => avisos.push(a.join(' '))
    let error = null
    let rec = null
    try {
      rec = await R.cargarRecursos(['lucas', 'brian'], 'rondeau')
    } catch (e) {
      error = e
    } finally {
      console.warn = warn0
    }
    const caras = delEscenario().filter((p) => p.ruta === '/juego/personajes/lucas/cara.webp')
    ok(!error && rec && !rec.caras.lucas, 'la carga sigue sin la cara que falta')
    ok(caras.length === 1 && caras[0].estado === 404, `un 404 no se reintenta (${caras.length} pedido)`)
    ok(avisos.some((a) => /sin cara de Lucas/.test(a)), 'y se avisa en la consola como antes')
    faltan.clear()
  },
}

const pedidosEscenarios = process.argv.slice(2)
const lista = pedidosEscenarios.length ? pedidosEscenarios : Object.keys(ESCENARIOS)
for (const nombre of lista) {
  if (!ESCENARIOS[nombre]) {
    console.log(`escenario desconocido: ${nombre}`)
    fallas.push(nombre)
    continue
  }
  console.log(`· ${nombre}`)
  try {
    desdePedido = pedidos.length
    await renderNuevo(nombre)
    await ESCENARIOS[nombre]()
  } catch (e) {
    console.log(`  MAL ${nombre}: ${e?.stack ?? e}`)
    fallas.push(nombre)
  }
}
servidor.closeAllConnections?.()
servidor.close()
console.log(fallas.length ? `\n${fallas.length} cosas no dan` : '\ntodo da')
process.exit(fallas.length ? 1 : 0)
