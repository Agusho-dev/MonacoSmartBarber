// Una pelea contra la CPU de punta a punta, eligiendo luchador y RIVAL por la grilla:
// portada → «Elegí tu barbero» → VS → pelea → resultado, con capturas de cada paso. Además mide que
// recorrer la selección NO baje atlas (sólo se bajan los dos de la pelea, desde «¡A pelear!").
//
//   node scripts/juego/ui/flujo-cpu.mjs <jugador> <rival> [tamaño] [query]
//     jugador / rival: el nombre como aparece en la grilla ("nico u.", "guillermo", "simón")
//     tamaño: 844x390 (por defecto) · query: lo que va después de /juego? (ej. "qr=brian,Juan")
//   SALIDA=<carpeta> (por defecto, <tmp>/corte-final-capturas) · URL_BASE (obligatoria, p. ej. http://localhost:3210)
//
// Para no esperar dos rounds enteros, cuando la pelea arranca el rival queda con 1 de vida en cada
// round (por el gancho de pruebas `window.__corteFinal`, sólo en desarrollo) y se aprieta GOLPE.
// En el resultado NO se toca ningún botón: «Revancha», «Cambiar barbero» y «Ranking» guardan la
// partida (como «Anónimo») en la base de PRODUCCIÓN.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirChrome, esperar, urlBase } from './cdp.mjs'

const SALIDA = process.env.SALIDA || join(tmpdir(), 'corte-final-capturas')
const BASE = urlBase()
const [jugador = '', rival = '', tam = '844x390', query = ''] = process.argv.slice(2)
const [w, h] = tam.split('x').map(Number)
const prefijo = `cpu_${(jugador || 'x').replace(/[^a-z]+/gi, '')}_vs_${(rival || 'x').replace(/[^a-z]+/gi, '')}_${tam}`
mkdirSync(SALIDA, { recursive: true })
const atlasPedidos = (p) =>
  p.evaluar(`performance.getEntriesByType('resource').filter((r) => /\\/atlas\\./.test(r.name)).map((r) => r.name.split('/').slice(-2).join('/'))`)

const ch = await abrirChrome({ puerto: 9362 })
let codigo = 0
try {
  const p = await ch.pagina()
  await p.alAbrir(`try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, sonido: false })) } catch (e) {}`)
  await p.tam(w, h, true)
  await p.navegar(`${BASE}/juego${query ? `?${query}` : ''}`)
  if (!(await p.esperarSelector('.cf-inicio__tocar', 90000))) throw new Error('no apareció el inicio')
  await esperar(900)
  await p.foto(join(SALIDA, `${prefijo}_0_portada.png`))
  console.log('atlas bajados en la portada:', JSON.stringify(await atlasPedidos(p)))
  await p.tocar('.cf-inicio__tocar')
  if (!(await p.esperarSelector('.cf-seleccion .cf-plantel', 15000))) throw new Error('no apareció la selección')
  await p.sinCortina(4000)
  await esperar(600)
  if (jugador) {
    if (!(await p.marcarFicha(jugador))) throw new Error('no está ' + jugador)
    await p.tocar('.cf-ficha[data-prueba]')
    await esperar(500)
  }
  if (rival) {
    await p.tocar('.cf-duelo__lado[data-lado="rival"]')
    await esperar(400)
    if (!(await p.marcarFicha(rival))) throw new Error('no está ' + rival)
    await p.tocar('.cf-ficha[data-prueba]')
    await esperar(700)
  }
  await p.foto(join(SALIDA, `${prefijo}_1_seleccion.png`))
  console.log('atlas bajados recorriendo la selección:', JSON.stringify(await atlasPedidos(p)))
  await p.tocar('.cf-seleccion__pelear')
  if (!(await p.esperarSelector('.cf-vs', 8000))) throw new Error('no apareció el VS')
  await p.sinCortina(3000)
  await esperar(900)
  await p.foto(join(SALIDA, `${prefijo}_2_vs.png`))
  if (!(await p.esperarSelector('.cf-pelea__canvas', 40000))) {
    await p.foto(join(SALIDA, `${prefijo}_x_sin_pelea.png`))
    throw new Error('no arrancó la pelea: ' + (await p.evaluar('document.querySelector(".cf-juego")?.dataset.pantalla')))
  }
  console.log('atlas bajados hasta la pelea:', JSON.stringify(await atlasPedidos(p)))
  console.log(
    'partida:',
    JSON.stringify(await p.evaluar(`(() => { const c = window.__corteFinal?.partida?.config; return c && { personajes: c.personajes, arena: c.arena, dificultad: c.dificultad } })()`)),
  )
  await esperar(4200)
  await p.foto(join(SALIDA, `${prefijo}_3_pelea.png`))
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    if ((await p.evaluar(`document.querySelector('.cf-juego')?.dataset.pantalla`)) === 'resultado') break
    await p.evaluar(
      `(() => { const pa = window.__corteFinal?.partida; if (pa && pa.fase === 'pelea') { pa.luchadores[1].vida = 1; const dx = pa.luchadores[1].x - pa.luchadores[0].x; if (Math.abs(dx) > 90) pa.luchadores[0].x = pa.luchadores[1].x - 80 * Math.sign(dx || 1) } return true })()`,
    )
    await p.cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyJ', key: 'j' })
    await esperar(60)
    await p.cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyJ', key: 'j' })
    await esperar(160)
  }
  if (!(await p.esperarSelector('.cf-resultado', 15000))) throw new Error('no apareció el resultado')
  await p.sinCortina(3000)
  await esperar(2600)
  await p.foto(join(SALIDA, `${prefijo}_4_resultado.png`))
  console.log('consola: ' + (p.consola.length ? '\n  ' + p.consola.join('\n  ') : '(limpia)'))
  console.log('capturas en ' + SALIDA)
} catch (e) {
  console.error(e)
  codigo = 1
} finally {
  await ch.cerrar()
  process.exit(codigo)
}
