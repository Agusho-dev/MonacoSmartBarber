// Mide en Chrome (OfflineAudioContext, con la cadena maestra real: compresor y limitador) el pico
// y el RMS de los sonidos del elenco contra los de referencia (golpe fuerte, crítico, sillón, super
// flash, tornado). Sirve para que lo nuevo quede en la misma franja: bucles por debajo de los golpes
// y nada que recorte.
//
//   node scripts/juego/render-audio/niveles.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirChrome } from './cdp.mjs'
import { empaquetar, SALIDA } from './empaquetar.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const bundle = readFileSync(empaquetar('audio'), 'utf8')
const html = readFileSync(path.join(AQUI, 'niveles.plantilla.html'), 'utf8').replace('/*__BUNDLE__*/', () =>
  bundle.replace(/<\/script/gi, '<\\/script'),
)
const pagina = path.join(SALIDA, 'niveles.html')
writeFileSync(pagina, html)
const c = await abrirChrome({ ancho: 800, alto: 600, movil: false, puerto: 9392 })
try {
  await c.cdp('Page.navigate', { url: `file://${pagina}` })
  await c.esperarQue('typeof window.medirTodo === "function"', 20000)
  const filas = await c.evaluar('window.medirTodo()')
  const ancho = Math.max(...filas.map((f) => f[0].length))
  console.log('sonido'.padEnd(ancho), ' pico dBFS  RMS50ms  largo s  recortes')
  for (const [n, pico, rms, largo, rec] of filas) {
    console.log(n.padEnd(ancho), String(pico).padStart(9), String(rms).padStart(8), String(largo).padStart(8), String(rec).padStart(9))
  }
  const recortes = filas.filter((f) => f[4] > 0)
  console.log(recortes.length ? `RECORTAN: ${recortes.map((f) => f[0]).join(', ')}` : 'ningún sonido recorta')
  console.log('consola:', c.consola.length ? c.consola.slice(0, 5).join(' | ') : 'limpia')
} finally {
  await c.cerrar()
}
