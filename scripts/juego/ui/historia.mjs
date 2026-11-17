// El modo historia de punta a punta contra el servidor de DESARROLLO (16/nov/2026). Termina cada pelea
// con el gancho de pruebas (window.__corteFinal, sólo en desarrollo): le pone 0 de vida al que tiene
// que perder. Sin pase y con Realtime bloqueado; el torneo no escribe en la base (no va al ranking).
//
//   URL_BASE=http://localhost:3210 node scripts/juego/ui/historia.mjs <carpeta> [<ancho>x<alto>] [modo]
//     modo: completo (por defecto: intro, elección y los 9 pisos, con una derrota en el piso 3 → campeón)
//           desde5   (inyecta una torre en el piso 5: el último barbero y los 4 Bosses)
//           final    (inyecta una torre en el piso 9: Tony, una derrota y la victoria)
//           intro    (intro, elección y la torre del piso 1; sin peleas)
//   Saca una captura de cada pantalla en <carpeta> y sale con código 1 si algo falla (consola incluida).
//   Como todos los arneses: con el candado de Chrome (TURNO=chrome) y nunca contra el :3100 del dueño.
import { abrirChrome, esperar, urlBase } from './cdp.mjs'
const [SAL, TAM = '390x844', MODO = 'completo'] = process.argv.slice(2)
if (!SAL) {
  console.error('Falta la carpeta de las capturas')
  process.exit(2)
}
const [W, H] = TAM.split('x').map(Number)
const BASE = urlBase()
const ch = await abrirChrome({ puerto: 9367 })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
let fallas = 0
const falla = (m) => { fallas++; log('FALLA', m) }
try {
  const p = await ch.pagina()
  await p.cdp('Network.enable', {})
  await p.cdp('Network.setBlockedURLs', { urls: ['*supabase.co/realtime*'] })
  let pre = `try { localStorage.setItem('cf.preferencias.v1', JSON.stringify({ tutorialVisto: true, sonido: false, musica: false })) } catch (e) {}`
  if (MODO === 'final' || MODO === 'desde5') {
    const torre = { v: 1, jugador: 'leo', dificultad: 'normal', rivales: ['simon','gabriel','rodrigo','fran','chipi','nacho','nehuen','nico_m','tony'], arenas: ['rondeau','caseros','parana','pueyrredon','rondeau','pueyrredon','caseros','parana','rondeau'], piso: MODO === 'final' ? 8 : 4, reintentos: 3, derrotasPiso: 0, inicio: Date.now() - 600000, segundosPelea: 610, barberoDelCliente: null }
    pre += `; try { localStorage.setItem('cf.historia.v1', JSON.stringify({ torre: ${JSON.stringify(torre)}, campeones: [{ id: 'simon', dificultad: 'facil', fecha: 1, reintentos: 0, segundos: 500 }], introVista: true })) } catch (e) {}`
  }
  await p.alAbrir(pre)
  await p.tam(W, H, true)
  await p.navegar(`${BASE}/juego`)
  if (!(await p.esperarSelector('.cf-inicio__historia', 120000))) throw new Error('no apareció la portada')
  await esperar(1600)
  await p.foto(`${SAL}/00-portada.png`)
  await p.tocar('.cf-inicio__historia')

  const terminarPelea = async (pierde) => {
    if (!(await p.esperarSelector('.cf-pelea canvas', 60000))) throw new Error('no arrancó la pelea')
    for (let t = 0; t < 900; t++) {
      await p.evaluar(`(() => { const q = window.__corteFinal?.partida; if (!q) return 'sin'; if (q.fase === 'pelea') { q.luchadores[${pierde ? 0 : 1}].vida = 0; return 'ko' } return q.fase })()`)
      const fuera = await p.evaluar(`!!document.querySelector('.cf-hist-victoria, .cf-hist-continuar, .cf-hist-campeon')`)
      if (fuera) return
      await esperar(200)
    }
    throw new Error('la pelea no terminó')
  }

  if (MODO === 'completo' || MODO === 'intro') {
    if (!(await p.esperarSelector('.cf-hist-intro', 15000))) throw new Error('no apareció la intro')
    await esperar(0)
    for (let i = 0; i < 4; i++) {
      await p.sinCortina(5000)
      await esperar(1500)
      await p.foto(`${SAL}/01-intro-${i + 1}.png`)
      await p.tocar('.cf-hist-intro__botones .cf-btn:last-child')
      await esperar(500)
    }
    if (!(await p.esperarSelector('.cf-hist-seleccion', 15000))) throw new Error('no apareció la elección')
    await p.sinCortina(5000)
    await esperar(1200)
    await p.foto(`${SAL}/02-eleccion.png`)
    await p.tocar('.cf-hist-seleccion .cf-seleccion__pelear')
  }

  if (!(await p.esperarSelector('.cf-hist-torre', 15000))) throw new Error('no apareció la torre')
  if (MODO === 'intro') {
    await p.sinCortina(5000)
    await esperar(1300)
    await p.foto(`${SAL}/10-torre-p1.png`)
    throw new Error('FIN-INTRO')
  }
  const pisos = MODO === 'final' ? [8] : MODO === 'desde5' ? [4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8]
  for (const piso of pisos) {
    await p.sinCortina(5000)
    await esperar(1300)
    const pisoUi = await p.evaluar(`document.querySelector('.cf-hist-rival__piso')?.textContent`)
    log('torre', piso + 1, pisoUi)
    await p.foto(`${SAL}/10-torre-p${piso + 1}.png`)
    await p.tocar('.cf-hist-rival__pelear')
    const jefe = piso >= 5
    if (jefe) {
      if (!(await p.esperarSelector('.cf-hist-jefe', 15000))) throw new Error('no apareció la presentación del Boss')
      await p.sinCortina(5000)
      await esperar(500)
      await p.foto(`${SAL}/20-jefe-p${piso + 1}-alarma.png`)
      await esperar(2200)
      await p.foto(`${SAL}/21-jefe-p${piso + 1}-entra.png`)
      for (let k = 0; k < 12; k++) {
        if (await p.evaluar(`!!document.querySelector('.cf-hist-dialogo__pelear')`)) break
        await p.tocar('.cf-hist-jefe__tocar')
        await esperar(450)
      }
      await p.foto(`${SAL}/22-jefe-p${piso + 1}-dialogo.png`)
      await p.tocar('.cf-hist-dialogo__pelear')
    }
    if (!(await p.esperarSelector('.cf-vs', 15000))) throw new Error('no apareció el VS')
    await esperar(900)
    if (jefe || piso === 0) await p.foto(`${SAL}/30-vs-p${piso + 1}.png`)
    if (!(await p.esperarSelector('.cf-pelea canvas', 60000))) throw new Error('no arrancó la pelea')
    await esperar(5200)
    if (jefe || piso === 0) {
      await p.foto(`${SAL}/40-pelea-p${piso + 1}.png`)
      const m = await p.evaluar(`(() => { const q = window.__corteFinal?.partida; return q ? { vidaMax: q.luchadores.map((l) => l.vidaMax), jefes: q.config.jefes ?? null, dif: q.config.dificultad } : null })()`)
      log('partida', JSON.stringify(m))
      const hud = await p.evaluar(`document.querySelector('.cf-hud__lado[data-lado="1"] .cf-hud__cpu')?.textContent`)
      log('hud rival', hud)
    }
    const conDerrota = (MODO === 'completo' && piso === 2) || MODO === 'final'
    if (conDerrota) {
      await terminarPelea(true)
      if (!(await p.esperarSelector('.cf-hist-continuar', 15000))) throw new Error('no apareció ¿Continuar?')
      await p.sinCortina(5000)
      await esperar(1500)
      await p.foto(`${SAL}/50-continuar-p${piso + 1}.png`)
      await p.tocar('.cf-hist-continuar__botones .cf-btn--grande')
    }
    await terminarPelea(false)
    if (piso === 8) {
      if (!(await p.esperarSelector('.cf-hist-campeon', 15000))) throw new Error('no apareció el campeón')
      await p.sinCortina(5000)
      await esperar(2200)
      await p.foto(`${SAL}/70-campeon.png`)
      await p.evaluar(`document.querySelector('.cf-hist-campeon').scrollTop = 2000`)
      await esperar(600)
      await p.foto(`${SAL}/71-campeon-abajo.png`)
      const h = await p.evaluar(`localStorage.getItem('cf.historia.v1')`)
      log('guardado', h)
      await p.tocar('.cf-hist-campeon__botones .cf-btn--grande')
      if (!(await p.esperarSelector('.cf-inicio__historia', 15000))) falla('no volvió a la portada')
      await p.sinCortina(5000)
      await esperar(900)
      log('portada', await p.evaluar(`document.querySelector('.cf-inicio__historia')?.textContent`))
      break
    }
    if (!(await p.esperarSelector('.cf-hist-victoria', 15000))) throw new Error('no apareció la victoria del piso')
    await p.sinCortina(5000)
    await esperar(1400)
    await p.foto(`${SAL}/60-victoria-p${piso + 1}.png`)
    await p.tocar('.cf-hist-victoria__seguir')
    if (!(await p.esperarSelector('.cf-hist-torre', 15000))) throw new Error('no volvió a la torre')
  }
  const ruido = p.consola.filter((l) => !/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(l))
  log('consola:', ruido.length ? JSON.stringify(ruido.slice(0, 12)) : 'limpia')
  if (ruido.length) fallas++
} catch (e) {
  if (e.message !== 'FIN-INTRO') falla(e.message)
} finally {
  await ch.cerrar()
}
log(fallas ? `FALLAS: ${fallas}` : 'TODO OK')
process.exit(fallas ? 1 : 0)
