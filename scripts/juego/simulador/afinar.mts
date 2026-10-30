/**
 * Afinador del balance: corre balance.mts con un ajuste de prueba (factores de daño [normales,
 * especiales, guardia] por barbero), mira el % de victorias de cada uno en cada dificultad (CPU
 * contra CPU, sin espejos) y corrige: los daños con el promedio de las 3 dificultades hacia el
 * 50 %, y el daño a la guardia con la diferencia difícil − fácil hacia 0 (la CPU difícil se cubre
 * mucho y la fácil casi nunca: si un barbero gana más en fácil, le falta romper guardias).
 * Repite `--vueltas` veces y deja el último ajuste en `--salida`.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs afinar.mts --vueltas=5 --semillas=16 --salida=/tmp/ajuste.json [--desde=…] [--brecha=0]
 *     [--gmin=0.8 --gmax=1.3]  tope del factor de GUARDIA de los normales (def. 0.35–2.6). Con la guardia
 *                              muy alta la cadena de la MÁQUINA rompía la guardia de una (revisión del 30/oct).
 *     [--gemax=2]              tope de la guardia de los ESPECIALES (def. = gmax): se mueve con la de los
 *                              normales y sigue cuando aquélla llegó a su tope.
 *     [--division=0.8]         además reparte entre normales y especiales: la CPU fácil casi no usa
 *                              especiales, así que un barbero que gana más en normal/difícil que en
 *                              fácil tiene especiales de más y normales de menos (y al revés).
 *     [--guardia=dn]           qué brecha corrige la guardia: 'df' (difícil − fácil, el de siempre) o
 *                              'dn' (difícil − normal, cuando la división ya se ocupa de fácil).
 *     [--peso=0.25,0.5,0.25]   peso de fácil, normal y difícil en el nivel de daño (def. parejo). Normal
 *                              es la dificultad por defecto: conviene que sea la que queda más pareja.
 *
 * Es una herramienta para iterar: los factores que salen se copian a mano a DANIO_KIT
 * (motor/movimientos.ts) y se confirma con balance.mts con más semillas.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DANIO_KIT } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import type { IdPersonaje } from '../../../src/lib/juego/tipos.ts'

const args = process.argv.slice(2)
const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const vueltas = Number(arg('vueltas') ?? 5)
const semillas = arg('semillas') ?? '16'
const salida = arg('salida') ?? join(tmpdir(), 'corte-final-ajuste.json')
const ganancia = Number(arg('ganancia') ?? 0.9)
const brecha = Number(arg('brecha') ?? 0.6)
const desde = arg('desde')
const division = Number(arg('division') ?? 0)
const brechaGuardia = arg('guardia') ?? 'df'
const [pf, pn, pd] = (arg('peso') ?? '1,1,1').split(',').map(Number)
const gmin = Number(arg('gmin') ?? 0.35)
const gmax = Number(arg('gmax') ?? 2.6)
const gemax = Number(arg('gemax') ?? gmax)
// Los intermedios van al temporal del sistema (no ensucian el repo).
const tmp = join(tmpdir(), 'corte-final-afinar.json')
const crudo = join(tmpdir(), 'corte-final-afinar-crudo.json')

interface Ajuste {
  danio: Record<string, [number, number, number, number]>
  vida?: Record<string, number>
  costo?: Record<string, [number, number]>
}
const ajuste: Ajuste = desde && existsSync(desde) ? JSON.parse(readFileSync(desde, 'utf8')) : { danio: {} }
for (const id of IDS_PERSONAJES) {
  ajuste.danio[id] ??= [DANIO_KIT[id][0], DANIO_KIT[id][1], DANIO_KIT[id][2], DANIO_KIT[id][3]]
  const d = ajuste.danio[id] as number[]
  if (d.length < 3) d[2] = 1
  if (d.length < 4) d[3] = d[2]
  d[2] = Math.min(gmax, Math.max(gmin, d[2]))
  d[3] = Math.min(gemax, Math.max(gmin, d[3]))
}
const acotar = (x: number, min = 0.55, max = 1.7) => Math.round(Math.min(max, Math.max(min, x)) * 1000) / 1000

for (let v = 1; v <= vueltas; v++) {
  writeFileSync(tmp, JSON.stringify(ajuste))
  execFileSync(process.execPath, ['--import', './cargador.mjs', 'balance.mts', `--semillas=${semillas}`, '--humano=0', '--hilos=7', `--ajuste=${tmp}`, `--json=${crudo}`], {
    cwd: import.meta.dirname,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  const ac = JSON.parse(readFileSync(crudo, 'utf8')) as { cruces: Record<string, [number, number, number]> }
  const gan: Record<string, [number, number]> = {}
  for (const [k, [n, g0, g1]] of Object.entries(ac.cruces)) {
    const [dif, a, b] = k.split('|')
    if (a === b) continue
    const ka = `${dif}|${a}`
    const kb = `${dif}|${b}`
    ;(gan[ka] ??= [0, 0])[0] += n
    gan[ka][1] += g0
    ;(gan[kb] ??= [0, 0])[0] += n
    gan[kb][1] += g1
  }
  const linea: string[] = []
  let peor = 0
  for (const id of IDS_PERSONAJES as IdPersonaje[]) {
    const w = (d: string) => {
      const [n, g] = gan[`${d}|${id}`] ?? [1, 0.5]
      return g / n
    }
    const wf = w('facil')
    const wn = w('normal')
    const wd = w('dificil')
    peor = Math.max(peor, Math.abs(wf - 0.5), Math.abs(wn - 0.5), Math.abs(wd - 0.5))
    const e = (pf * wf + pn * wn + pd * wd) / (pf + pn + pd) - 0.5
    const g = brechaGuardia === 'dn' ? wd - wn : wd - wf
    const sp = (wn + wd) / 2 - wf
    const [fn, fe, fg, fge] = ajuste.danio[id]
    const nn = acotar(fn * (1 - ganancia * e) * (1 + division * sp))
    const ne = acotar(fe * (1 - ganancia * e) * (1 - division * sp))
    const ng = acotar(fg * (1 - 2.2 * brecha * g), gmin, gmax)
    const nge = acotar(fge * (1 - 2.2 * brecha * g), gmin, gemax)
    linea.push(`${id} ${(100 * wf).toFixed(0)}/${(100 * wn).toFixed(0)}/${(100 * wd).toFixed(0)} [${fn}, ${fe}, ${fg}, ${fge}]→[${nn}, ${ne}, ${ng}, ${nge}]`)
    ajuste.danio[id] = [nn, ne, ng, nge]
  }
  console.log(`vuelta ${v} (peor ±${(100 * peor).toFixed(1)})\n  ${linea.join('\n  ')}`)
  writeFileSync(salida, JSON.stringify(ajuste, null, 2))
}
