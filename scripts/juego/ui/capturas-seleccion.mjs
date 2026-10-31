// Capturas de «Elegí tu barbero» en los tamaños de celular que importan, con medidas: que no haya
// scroll horizontal, cuántas caras hay, dónde caen la grilla, el duelo y «¡A pelear!», y la consola.
//
//   node scripts/juego/ui/capturas-seleccion.mjs [query] [tamaños] [extras]
//     query:   lo que va después de /juego? (ej. "qr=brian,Juan" simula el QR de un cliente de Brian,
//              sólo en desarrollo; "s=parana" entra con la sucursal)
//     tamaños: "390x844,360x740,844x390,667x375" (por defecto)
//     extras:  "rival" (también la captura eligiendo el rival), "scroll" (también el final de la lista)
//   SALIDA=<carpeta> (por defecto, <tmp>/corte-final-capturas) · URL_BASE (obligatoria, p. ej. http://localhost:3210)
//
// Contra el servidor de DESARROLLO (el atajo ?qr= no existe en producción). No escribe en la base.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirChrome, esperar, urlBase } from './cdp.mjs'

const SALIDA = process.env.SALIDA || join(tmpdir(), 'corte-final-capturas')
const BASE = urlBase()
const [query = '', tams = '390x844,360x740,844x390,667x375', extras = ''] = process.argv.slice(2)
const prefijo = 'seleccion' + (query ? '_' + query.replace(/[^a-z0-9]+/gi, '-') : '')
mkdirSync(SALIDA, { recursive: true })

const ch = await abrirChrome({ puerto: 9361 })
let codigo = 0
try {
  const p = await ch.pagina()
  await p.alAbrir(`try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, sonido: false })) } catch (e) {}`)
  for (const t of tams.split(',')) {
    const [w, h] = t.split('x').map(Number)
    await p.tam(w, h, true)
    p.consola.length = 0
    await p.navegar(`${BASE}/juego${query ? `?${query}` : ''}`)
    if (!(await p.esperarSelector('.cf-inicio__tocar', 90000))) throw new Error('no apareció el inicio')
    await esperar(700)
    await p.tocar('.cf-inicio__tocar')
    if (!(await p.esperarSelector('.cf-seleccion .cf-plantel', 15000))) throw new Error('no apareció la selección')
    await p.sinCortina(4000)
    await esperar(1300)
    const m = await p.evaluar(`(() => {
      const de = document.documentElement
      const caja = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] }
      const fichas = [...document.querySelectorAll('.cf-ficha')]
      return {
        scrollHorizontal: de.scrollWidth > de.clientWidth,
        caras: fichas.length,
        anchoCara: fichas[0] ? Math.round(fichas[0].getBoundingClientRect().width) : 0,
        grilla: caja('.cf-plantel'), duelo: caja('.cf-duelo'), pelear: caja('.cf-seleccion__pelear'),
        rival: document.querySelector('.cf-duelo__lado[data-lado="rival"] b')?.textContent,
        vos: document.querySelector('.cf-duelo__lado[data-lado="vos"] b')?.textContent,
      }
    })()`)
    console.log(`${t} ${JSON.stringify(m)}`)
    await p.foto(join(SALIDA, `${prefijo}_${t}.png`))
    if (extras.includes('rival')) {
      await p.tocar('.cf-duelo__lado[data-lado="rival"]')
      await esperar(900)
      await p.foto(join(SALIDA, `${prefijo}_${t}_rival.png`))
      await p.tocar('.cf-duelo__lado[data-lado="vos"]')
      await esperar(400)
    }
    if (extras.includes('scroll')) {
      await p.evaluar(
        `(() => { const c = document.querySelector('.cf-seleccion__panel'); const d = document.querySelector('.cf-seleccion__cuerpo'); (getComputedStyle(c).overflowY === 'auto' ? c : d).scrollTop = 99999 })()`,
      )
      await esperar(600)
      await p.foto(join(SALIDA, `${prefijo}_${t}_abajo.png`))
    }
    console.log('  consola: ' + (p.consola.length ? p.consola.join(' | ') : '(limpia)'))
  }
  console.log('capturas en ' + SALIDA)
} catch (e) {
  console.error(e)
  codigo = 1
} finally {
  await ch.cerrar()
  process.exit(codigo)
}
