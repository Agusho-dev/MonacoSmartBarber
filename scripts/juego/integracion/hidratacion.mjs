// ¿Vuelve el error de hidratación #418 de React al abrir /juego? Carga la página N veces «en frío»
// (sin caché ni storage, como un cliente que escanea el QR por primera vez) y cuenta las visitas que
// tiran una excepción. Hasta el 31/oct pasaba en ≈ 5–10 % de las primeras visitas en producción y la
// raíz entera se volvía a dibujar en el cliente; lo arregla el <Suspense> de src/app/juego/layout.tsx.
// Cualquier cambio de ese layout se valida con esto: 40 visitas y cero errores.
//
// Va contra un BUILD de producción (`next build` + `next start` en otro puerto; el :3100 es el
// servidor de desarrollo del dueño): en desarrollo React avisa de otra manera. Bloquea el WebSocket
// de Realtime para no entrar a la presencia real de la sala. No escribe en la base.
//   URL_BASE=http://localhost:3231 TURNO=chrome <scratchpad>/herramientas/turno.sh \
//     node scripts/juego/integracion/hidratacion.mjs [anchoxalto = 390x844] [sucursal | - ] [visitas = 40]
// RED=4g (por defecto) emula la red de un celular: es una carrera entre la hidratación y un módulo
// que se baja perezoso, y contra el servidor local sin latencia casi nunca se da. RED=local, sin
// emular. Sale con código 1 si alguna visita tuvo el error. Informe en SALIDA/hidratacion.txt.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIR, abrirChrome, esperar, urlBase } from './cdp.mjs'

const BASE = urlBase()
const [tam = '390x844', sucursal = '-', visitasTxt = '40'] = process.argv.slice(2)
const [ancho, alto] = tam.split('x').map(Number)
const visitas = Number(visitasTxt)
const url = `${BASE}/juego${sucursal !== '-' ? `?s=${encodeURIComponent(sucursal)}` : ''}`
const informe = join(DIR, 'hidratacion.txt')
const ERROR = /EXCEPCION|#418|Hydration|hidrat/i
const RED = process.env.RED || '4g'
const REDES = {
  '4g': { offline: false, latency: 170, downloadThroughput: Math.round(9e6 / 8), uploadThroughput: Math.round(3e6 / 8) },
  '3g': { offline: false, latency: 560, downloadThroughput: Math.round(1.6e6 / 8), uploadThroughput: Math.round(0.75e6 / 8) },
}

const c = await abrirChrome({ ancho, alto, movil: true, prefs: { tutorialVisto: true }, puerto: 9385 })
let conError = 0
try {
  await c.cdp('Network.enable')
  await c.cdp('Network.setBlockedURLs', { urls: ['*supabase.co/realtime*'] })
  if (RED !== 'local') {
    if (!REDES[RED]) throw new Error(`RED=${RED}: usar 4g, 3g o local`)
    await c.cdp('Network.emulateNetworkConditions', REDES[RED])
  }
  for (let i = 1; i <= visitas; i++) {
    // En frío: sin caché ni storage de la visita anterior.
    await c.cdp('Page.navigate', { url: 'about:blank' })
    await esperar(200)
    await c.cdp('Network.clearBrowserCache')
    await c.cdp('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'all' })
    c.consola.length = 0
    await c.cdp('Page.navigate', { url })
    const llego = await c.esperarQue(`!!document.querySelector('.cf-inicio__tocar')`, 60000)
    await esperar(2500)
    const errores = c.consola.filter((t) => ERROR.test(t))
    const otros = c.consola.filter((t) => !ERROR.test(t))
    if (!llego || errores.length) conError++
    const linea = `${tam} ${sucursal} ${RED} visita ${i}: ${!llego ? 'NO LLEGÓ AL INICIO' : errores.length ? 'ERROR ' + errores[0].slice(0, 160) : 'ok'}${otros.length ? ' · otros: ' + otros.map((t) => t.slice(0, 100)).join(' | ') : ''}`
    console.log(linea)
    appendFileSync(informe, linea + '\n')
  }
} finally {
  await c.cerrar()
}
const resumen = `== ${url} (${tam}, red ${RED}): ${conError}/${visitas} visitas con error`
console.log(resumen)
appendFileSync(informe, resumen + '\n')
process.exit(conError ? 1 : 0)
