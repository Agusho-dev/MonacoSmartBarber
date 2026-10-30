// Galería del render del elenco en Chrome headless, contra el dev server (http://localhost:3100):
// una partida falsa (galeria-pagina.js) con cada proyectil, estado y especial, sin motor.
//
//   capturas: node scripts/juego/render-audio/galeria.mjs capturas 844x390 todas [alta|media|baja]
//             node scripts/juego/render-audio/galeria.mjs capturas 390x844 arsenal1,estados
//   fps:      node scripts/juego/render-audio/galeria.mjs fps 844x390 4 [segundos]
//             (todo encendido a la vez, CPU frenada ×4, calidad alta, media y baja)
//
// Las capturas van a <salida>/capturas (ver empaquetar.mjs). Con varios agentes en la Mac, correrlo
// con el candado de Chrome. Los ids de las escenas tienen que tener atlas en public/juego/personajes.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirChrome, esperar } from './cdp.mjs'
import { empaquetar, SALIDA } from './empaquetar.mjs'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const [modo = 'capturas', tam = '844x390', arg3 = 'todas', arg4] = process.argv.slice(2)
const [ancho, alto] = tam.split('x').map(Number)
const CAPTURAS = path.join(SALIDA, 'capturas')
mkdirSync(CAPTURAS, { recursive: true })

const ESCENAS = {
  graffiti: { ids: ['gabriel', 'nico_u'], esc: ['graffiti'], fotos: [130, 330, 480, 560, 640] },
  guante: { ids: ['nico_u', 'stefano'], esc: ['guante'], fotos: [400, 600] },
  arsenal1: { ids: ['nico_u', 'stefano'], esc: ['arsenal1'], fotos: [700, 1500, 2300] },
  arsenal2: { ids: ['joaquin', 'gabriel'], esc: ['arsenal2'], fotos: [900, 1700, 2500, 3300] },
  chorros: { ids: ['nico_u', 'stefano'], esc: ['chorros'], fotos: [450, 900] },
  estados: { ids: ['stefano', 'nico_u'], esc: ['estados'], fotos: [1200, 4200, 6900] },
  golpes: { ids: ['nico_u', 'joaquin'], esc: ['golpes'], fotos: [600, 1400, 2200, 3000] },
  esp_nico1: { ids: ['nico_u', 'stefano'], esc: ['especial', 1], fotos: [250, 650, 1100] },
  esp_nico2: { ids: ['nico_u', 'stefano'], esc: ['especial', 2], fotos: [250, 650, 1100] },
  esp_gabriel1: { ids: ['gabriel', 'nico_u'], esc: ['especial', 1], fotos: [300, 700, 1100] },
  esp_gabriel2: { ids: ['gabriel', 'nico_u'], esc: ['especial', 2], fotos: [300, 700] },
  esp_joaquin1: { ids: ['joaquin', 'nico_u'], esc: ['especial', 1], fotos: [300, 700] },
  esp_joaquin2: { ids: ['joaquin', 'nico_u'], esc: ['especial', 2], fotos: [300, 650, 1000] },
  esp_stefano1: { ids: ['stefano', 'nico_u'], esc: ['especial', 1], fotos: [300, 700] },
  esp_stefano2: { ids: ['stefano', 'nico_u'], esc: ['especial', 2], fotos: [300, 700] },
  // barberos sin hoja todavía: sus efectos, dibujados con la hoja de otro
  esp_moto: { ids: ['luciano=nico_u', 'stefano'], esc: ['especial', 1], fotos: [300, 650, 900] },
  esp_chilena: { ids: ['nahuel=gabriel', 'nico_u'], esc: ['especial', 2], fotos: [300, 650, 900] },
  esp_baile: { ids: ['rodrigo=joaquin', 'nico_u'], esc: ['especial', 1], fotos: [300, 650, 900] },
  esp_cura: { ids: ['fabri=stefano', 'nico_u'], esc: ['especial', 1], fotos: [300, 750, 1100] },
  esp_guante: { ids: ['fabri=nico_u', 'stefano'], esc: ['especial', 2], fotos: [300, 650] },
  esp_agarre: { ids: ['brian=stefano', 'nico_u'], esc: ['especial', 1], fotos: [300, 800, 1300] },
  esp_sismo: { ids: ['brian=stefano', 'nico_u'], esc: ['especial', 2], fotos: [300, 550, 800] },
}

const bundle = readFileSync(empaquetar('render'), 'utf8')
const pagina = readFileSync(path.join(AQUI, 'galeria-pagina.js'), 'utf8')
const c = await abrirChrome({ ancho, alto, movil: true, puerto: 9391 })
let fallas = 0
try {
  // una página liviana del mismo origen: los atlas se bajan del dev server sin CORS
  await c.cdp('Page.navigate', { url: 'http://localhost:3100/juego/efectos/efectos.json' })
  await esperar(1200)
  await c.evaluar(bundle + ';true')
  await c.evaluar(pagina + ';true')
  if (modo === 'fps') {
    const freno = Number(arg3) || 4
    const seg = Number(arg4) || 6
    await c.cdp('Emulation.setCPUThrottlingRate', { rate: freno })
    for (const calidad of ['alta', 'media', 'baja']) {
      await c.evaluar(`G.crear(['nico_u', 'stefano'], 'rondeau', ${JSON.stringify(calidad)})`)
      await c.evaluar(`G.escena('todo')`)
      await esperar(1500)
      await c.evaluar('(G.tiempos.length = 0, G.intervalos.length = 0, true)')
      await esperar(seg * 1000)
      const m = await c.evaluar('G.medir()')
      await c.foto(path.join(CAPTURAS, `todo_${tam}_${calidad}_x${freno}.png`))
      console.log(`${calidad} (CPU x${freno}, ${tam}): ${JSON.stringify(m)}`)
    }
  } else {
    const calidad = arg4 || 'alta'
    const elegidas = arg3 === 'todas' ? Object.keys(ESCENAS) : arg3.split(',')
    let actuales = ''
    for (const nombre of elegidas) {
      const e = ESCENAS[nombre]
      if (!e) {
        console.log('no existe la escena', nombre)
        continue
      }
      if (actuales !== e.ids.join()) {
        await c.evaluar(`G.crear(${JSON.stringify(e.ids)}, 'rondeau', ${JSON.stringify(calidad)})`)
        actuales = e.ids.join()
      }
      await c.evaluar(`G.escena(${e.esc.map((x) => JSON.stringify(x)).join(',')})`)
      let antes = 0
      for (const [i, ms] of e.fotos.entries()) {
        await esperar(ms - antes)
        antes = ms
        await c.foto(path.join(CAPTURAS, `${nombre}_${tam}_${calidad}_${i + 1}.png`))
      }
      console.log(`${nombre}: ${JSON.stringify(await c.evaluar('G.medir()'))}`)
    }
  }
  const errores = await c.evaluar('G.errores.slice()')
  const consola = c.consola.filter((x) => !/rapado|favicon/.test(x))
  if (errores.length || consola.some((x) => /error en el render|EXCEPCION/.test(x))) fallas++
  console.log('errores de la página:', errores.length ? errores.join(' | ') : 'ninguno')
  console.log('consola:', consola.length ? consola.slice(0, 8).join(' | ') : 'limpia')
  console.log('capturas en', CAPTURAS)
} catch (e) {
  fallas++
  console.log('FALLÓ', (e && e.stack) || e)
} finally {
  await c.cerrar()
  process.exitCode = fallas ? 1 : 0
}
