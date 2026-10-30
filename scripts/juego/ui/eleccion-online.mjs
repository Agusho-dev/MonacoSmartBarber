// La elección de la pelea ONLINE con dos «celulares» (contextos aislados del mismo Chrome): Ana en
// vertical desafía a Beto (horizontal) en la sala, eligen entre todos los luchadores con el reloj
// de 20 s, VS online, unos segundos de pelea y Ana abandona desde el menú (vuelve a la sala con un
// aviso; Beto ve «¡Ganaste por abandono!»). Capturas de cada paso en los dos.
//
//   node scripts/juego/ui/eleccion-online.mjs [sucursal] [luchadorAna] [luchadorBeto]
//     sucursal: caseros (por defecto). OJO: entra a la presencia REAL de esa sala en el Realtime de
//               producción (ver «Sala online» en .claude/rules/juego.md): usar una sucursal sin
//               clientes jugando o hacerlo fuera de horario. Las peleas online no escriben en la base.
//   SALIDA=<carpeta> (por defecto, <tmp>/corte-final-capturas) · URL_BASE (http://localhost:3100)
//
// No editar archivos del juego mientras corre: el Fast Refresh del servidor de desarrollo saca a los
// dos de la sala.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abrirChrome, esperar } from './cdp.mjs'

const SALIDA = process.env.SALIDA || join(tmpdir(), 'corte-final-capturas')
const BASE = process.env.URL_BASE || 'http://localhost:3100'
const [slug = 'caseros', pjA = 'nico u.', pjB = 'chipi'] = process.argv.slice(2)
mkdirSync(SALIDA, { recursive: true })
const t0 = Date.now()
const log = (t) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${t}`)

const ch = await abrirChrome({ puerto: 9363 })
let codigo = 0
try {
  const A = await ch.pagina({ aislada: true })
  const B = await ch.pagina({ aislada: true })
  await A.alAbrir(`try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, sonido: false, apodo: 'Ana' })) } catch (e) {}`)
  await B.alAbrir(`try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, sonido: false, apodo: 'Beto' })) } catch (e) {}`)
  await A.tam(390, 844, true)
  await B.tam(844, 390, true)
  await A.navegar(`${BASE}/juego?s=${slug}`)
  await B.navegar(`${BASE}/juego?s=${slug}`)
  if (!(await A.esperarSelector('.cf-inicio__tocar', 90000)) || !(await B.esperarSelector('.cf-inicio__tocar', 90000))) throw new Error('sin inicio')
  if (!(await A.esperarSelector('.cf-sala-chip, .cf-sala-aviso', 25000))) throw new Error('Ana no ve a nadie en la sala')
  log('se ven en la sala')
  await esperar(800)
  await A.tocar((await A.evaluar(`!!document.querySelector('.cf-sala-aviso__ver')`)) ? '.cf-sala-aviso__ver' : '.cf-sala-chip')
  if (!(await A.esperarSelector('.cf-sala-fila__desafiar', 10000))) throw new Error('Ana no ve a Beto en la sala')
  await A.sinCortina(3000)
  await A.tocar('.cf-sala-fila__desafiar')
  if (!(await B.esperarSelector('.cf-desafio__aceptar', 10000))) throw new Error('a Beto no le llegó el desafío')
  await esperar(500)
  await B.tocar('.cf-desafio__aceptar')
  log('Beto aceptó')
  if (!(await A.esperarSelector('.cf-eleccion-online .cf-plantel', 15000)) || !(await B.esperarSelector('.cf-eleccion-online .cf-plantel', 15000))) {
    throw new Error('no apareció la elección online')
  }
  await A.esperarSelector('.cf-eleccion-online:not(:has(.cf-eleccion-online__conectando))', 10000)
  await A.sinCortina(3000)
  await B.sinCortina(3000)
  await esperar(900)
  const estado = (p) =>
    p.evaluar(
      `(() => ({ caras: document.querySelectorAll('.cf-eleccion-online .cf-ficha').length, reloj: document.querySelector('.cf-eleccion-online__reloj')?.textContent, scrollHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth, elegido: document.querySelector('.cf-ficha[data-elegido] .cf-ficha__nombre')?.textContent }))()`,
    )
  log(`Ana ${JSON.stringify(await estado(A))} · Beto ${JSON.stringify(await estado(B))}`)
  await A.foto(join(SALIDA, 'online_1_eleccion_ana_390x844.png'))
  await B.foto(join(SALIDA, 'online_1_eleccion_beto_844x390.png'))
  if (!(await A.marcarFicha(pjA))) throw new Error('Ana no encuentra a ' + pjA)
  await A.tocar('.cf-ficha[data-prueba]')
  if (!(await B.marcarFicha(pjB))) throw new Error('Beto no encuentra a ' + pjB)
  await B.tocar('.cf-ficha[data-prueba]')
  await esperar(500)
  await A.tocar('.cf-eleccion-online .cf-seleccion__pelear')
  await B.esperarSelector('.cf-eleccion-online__estado[data-listo]', 5000)
  await esperar(500)
  log(`Ana confirmó · Ana ${JSON.stringify(await estado(A))} · Beto ${JSON.stringify(await estado(B))}`)
  await A.foto(join(SALIDA, 'online_2_ana_confirmo_390x844.png'))
  await B.foto(join(SALIDA, 'online_2_beto_ve_que_eligio_844x390.png'))
  await B.tocar('.cf-eleccion-online .cf-seleccion__pelear')
  if (!(await A.esperarSelector('.cf-vs', 8000))) throw new Error('sin VS online')
  await A.sinCortina(3000)
  await esperar(700)
  await A.foto(join(SALIDA, 'online_3_vs_ana_390x844.png'))
  await B.foto(join(SALIDA, 'online_3_vs_beto_844x390.png'))
  const pelean =
    (await A.esperarSelector('.cf-pelea[data-online] .cf-pelea__canvas', 30000)) &&
    (await B.esperarSelector('.cf-pelea[data-online] .cf-pelea__canvas', 30000))
  log('pelea online en los dos: ' + pelean)
  await esperar(5000)
  await A.foto(join(SALIDA, 'online_4_pelea_ana_390x844.png'))
  await B.foto(join(SALIDA, 'online_4_pelea_beto_844x390.png'))
  await A.tocar('.cf-hud__pausa')
  await A.esperarSelector('.cf-online-menu', 3000)
  await A.tocar('.cf-online-menu .cf-btn--sec')
  await esperar(250)
  await A.tocar('.cf-online-menu .cf-btn--sec')
  const anaSala = await A.esperarSelector('.cf-juego[data-pantalla="sala"]', 10000)
  const betoRes = await B.esperarSelector('.cf-resultado-online', 10000)
  log(`Ana abandonó: vuelve a la sala ${anaSala} · Beto ve el resultado ${betoRes}`)
  await B.sinCortina(3000)
  await esperar(1500)
  await A.foto(join(SALIDA, 'online_5_sala_ana_390x844.png'))
  await B.foto(join(SALIDA, 'online_5_resultado_beto_844x390.png'))
  await B.tocar('.cf-resultado-online .cf-btn--sec')
  await esperar(1500)
  log('consola de Ana: ' + (A.consola.length ? '\n   ' + A.consola.join('\n   ') : '(limpia)'))
  log('consola de Beto: ' + (B.consola.length ? '\n   ' + B.consola.join('\n   ') : '(limpia)'))
  console.log('capturas en ' + SALIDA)
} catch (e) {
  console.error(e)
  codigo = 1
} finally {
  await ch.cerrar()
  process.exit(codigo)
}
