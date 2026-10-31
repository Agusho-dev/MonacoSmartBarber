/**
 * Afinador de las tres balanzas (tercera tanda, 31/oct). El balance se separó en lo que ve cada
 * manera de jugar, y cada balanza tiene sus perillas:
 *
 *  - personas (meta E, la pelea online): el KIT. Corre persona contra persona (las cinco personas
 *    oficiales de balance.mts y las demoras 0, 17 y 20) y corrige el daño de cada barbero (los dos
 *    primeros factores de DANIO_KIT, normales y especiales juntos) hacia el 50 %: mitad el promedio
 *    en logit de las columnas y mitad el punto medio entre la peor y la mejor, así sube la peor
 *    columna y no sólo el promedio. El online no tiene CPU: nada más que el kit lo mueve.
 *  - cpu (meta C, CPU contra CPU): la `pericia` de cada barbero en fácil, normal y difícil hacia el
 *    50 %. Contra una persona no se usa (manda periciaHumano), así que no toca B ni E.
 *  - persona-cpu (meta B, una persona contra la CPU normal): la `asistencia` (fila: el barbero que
 *    elige la persona) y la `periciaHumano` (columna: el barbero de la CPU), centrando el promedio en
 *    logit del simple y del novato en `--objetivo` (def. 0,37).
 *
 * El orden es ése: primero el kit con «personas»; después «cpu» y «persona-cpu», que no lo tocan.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs afinar-balanzas.mts --balanza=personas \
 *     --vueltas=4 --semillas=12 [--desde=ajuste.json] [--salida=x.json] [--ganancia=0.2] [--hilos=10]
 *
 * `--desde` es un ajuste de balance.mts (cambios de kit, costos, …) que se respeta y se completa; el
 * resultado (el mismo ajuste con lo afinado) queda en `--salida` para probarlo con balance.mts
 * --ajuste y copiarlo a mano a movimientos.ts (DANIO_KIT y EstiloCpu). Con el ruido de cada vuelta
 * (12 semillas: ±5 en cada columna de E; 100 en normal: ±2,2 en C) conviene terminar con una corrida
 * grande de balance.mts con dos sales.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DANIO_KIT, MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'
import type { Dificultad, IdPersonaje } from '../../../src/lib/juego/tipos.ts'

const args = process.argv.slice(2)
const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const balanza = arg('balanza') ?? 'personas'
if (!['personas', 'cpu', 'persona-cpu'].includes(balanza)) throw new Error(`--balanza desconocida: ${balanza}`)
const vueltas = Number(arg('vueltas') ?? 4)
const hilos = arg('hilos') ?? '10'
const salida = arg('salida') ?? join(tmpdir(), `corte-final-${balanza}.json`)
const desde = arg('desde')
const objetivo = Number(arg('objetivo') ?? 0.37)
const ganancia = Number(arg('ganancia') ?? (balanza === 'personas' ? 0.2 : 0.06))
const tmp = join(tmpdir(), `corte-final-${balanza}-vuelta.json`)
const crudo = join(tmpdir(), `corte-final-${balanza}-crudo.json`)

type PorDif = Partial<Record<Dificultad, number>>
interface Ajuste {
  danio?: Record<string, number[]>
  pericia?: Record<string, PorDif>
  periciaHumano?: Record<string, PorDif>
  asistencia?: Record<string, PorDif>
  [k: string]: unknown
}
const ajuste: Ajuste = desde && existsSync(desde) ? (JSON.parse(readFileSync(desde, 'utf8')) as Ajuste) : {}
const ids = IDS_PERSONAJES as IdPersonaje[]
const lg = (p: number) => {
  const q = Math.min(0.97, Math.max(0.03, p))
  return Math.log(q / (1 - q))
}
const r3 = (x: number) => Math.round(x * 1000) / 1000
const acotar = (x: number, min: number, max: number) => r3(Math.min(max, Math.max(min, x)))

// Arranca de lo que dice el código (o el ajuste de --desde).
ajuste.danio ??= {}
for (const id of ids) ajuste.danio[id] ??= [...DANIO_KIT[id]]
for (const campo of ['pericia', 'periciaHumano', 'asistencia'] as const) {
  const t = (ajuste[campo] ??= {})
  for (const id of ids) t[id] ??= { ...(MOVIMIENTOS[id].cpu[campo] ?? {}) }
}

function correrBalance(extra: string[]): Record<string, unknown> {
  writeFileSync(tmp, JSON.stringify(ajuste))
  execFileSync(process.execPath, ['--import', './cargador.mjs', 'balance.mts', `--hilos=${hilos}`, `--ajuste=${tmp}`, `--json=${crudo}`, ...extra], {
    cwd: import.meta.dirname,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return JSON.parse(readFileSync(crudo, 'utf8')) as Record<string, unknown>
}

const OFICIALES_E = ['novato', 'apunta', 'botonero', 'casual', 'casual2']

for (let v = 1; v <= vueltas; v++) {
  const lineas: string[] = []
  if (balanza === 'personas') {
    const ac = correrBalance(['--dif=normal', '--semillas=0', '--humano=0', `--novatos=${arg('semillas') ?? 12}`, '--demoras=0,17,20', `--personas=${OFICIALES_E.join(',')}`])
    const reg = ac.personas as Record<string, [number, number, number]>
    const col: Record<string, [number, number]> = {}
    for (const [k, [n, g0, g1]] of Object.entries(reg)) {
      const [bot, d, a, b] = k.split('|')
      if (a === b) continue
      const x = (col[`${bot}|${d}|${a}`] ??= [0, 0])
      x[0] += n
      x[1] += g0
      const y = (col[`${bot}|${d}|${b}`] ??= [0, 0])
      y[0] += n
      y[1] += g1
    }
    for (const id of ids) {
      const vs = Object.entries(col)
        .filter(([k]) => k.endsWith(`|${id}`))
        .map(([, [n, g]]) => lg(g / n))
      const prom = vs.reduce((s, x) => s + x, 0) / vs.length
      const medio = (Math.min(...vs) + Math.max(...vs)) / 2
      const A = 0.5 * prom + 0.5 * medio
      const f = Math.exp(-ganancia * A)
      const d = ajuste.danio[id]
      const antes = `${d[0]}/${d[1]}`
      d[0] = acotar(d[0] * f, 0.5, 1.6)
      d[1] = acotar(d[1] * f, 0.5, 1.7)
      lineas.push(`${id} ${(100 / (1 + Math.exp(-prom))).toFixed(1)} % (peor ${(100 / (1 + Math.exp(-Math.min(...vs)))).toFixed(0)}, mejor ${(100 / (1 + Math.exp(-Math.max(...vs)))).toFixed(0)}) daño ${antes} → ${d[0]}/${d[1]}`)
    }
  } else if (balanza === 'cpu') {
    const ac = correrBalance([`--semillas=${arg('semillas') ?? 40}`, `--semillasNormal=${arg('semillasNormal') ?? 100}`, '--humano=0', '--novatos=0'])
    const cr = ac.cruces as Record<string, [number, number, number]>
    const gan: Record<string, [number, number]> = {}
    for (const [k, [n, g0, g1]] of Object.entries(cr)) {
      const [dif, a, b] = k.split('|')
      if (a === b) continue
      const x = (gan[`${dif}|${a}`] ??= [0, 0])
      x[0] += n
      x[1] += g0
      const y = (gan[`${dif}|${b}`] ??= [0, 0])
      y[0] += n
      y[1] += g1
    }
    for (const id of ids) {
      const partes: string[] = []
      for (const dif of ['facil', 'normal', 'dificil'] as const) {
        const [n, g] = gan[`${dif}|${id}`] ?? [1, 0.5]
        const t = (ajuste.pericia as Record<string, PorDif>)[id]
        const antes = t[dif] ?? 0
        t[dif] = acotar(antes - ganancia * lg(g / n), -2, 2)
        partes.push(`${dif} ${((100 * g) / n).toFixed(1)} % ${antes} → ${t[dif]}`)
      }
      lineas.push(`${id} ${partes.join(' | ')}`)
    }
  } else {
    // Un múltiplo de 26 (los 13 rivales, de los dos lados): así cada fila y cada columna tienen partidas.
    const n = Math.max(26, Math.round(Number(arg('semillas') ?? 780) / 26) * 26)
    const ac = correrBalance(['--dif=normal', '--semillas=0', '--humano=0', `--humanoNormal=${n}`, '--novatos=0', '--humanos=simple,novato'])
    const hum = ac.humanos as Record<string, [number, number]>
    const fila: Record<string, [number, number]> = {}
    const col: Record<string, [number, number]> = {}
    for (const [k, [n, w]] of Object.entries(hum)) {
      const [bot, , yo, cpu] = k.split('|')
      const x = (fila[`${bot}|${yo}`] ??= [0, 0])
      x[0] += n
      x[1] += w
      const y = (col[`${bot}|${cpu}`] ??= [0, 0])
      y[0] += n
      y[1] += w
    }
    const L0 = lg(objetivo)
    for (const id of ids) {
      const F = (lg(fila[`simple|${id}`][1] / fila[`simple|${id}`][0]) + lg(fila[`novato|${id}`][1] / fila[`novato|${id}`][0])) / 2
      const C = (lg(col[`simple|${id}`][1] / col[`simple|${id}`][0]) + lg(col[`novato|${id}`][1] / col[`novato|${id}`][0])) / 2
      const a = (ajuste.asistencia as Record<string, PorDif>)[id]
      const ph = (ajuste.periciaHumano as Record<string, PorDif>)[id]
      const a0 = a.normal ?? 0
      const p0 = ph.normal ?? 0
      a.normal = acotar(a0 + ganancia * (L0 - F), -2, 2)
      ph.normal = acotar(p0 + ganancia * (C - L0), -2, 2)
      const pc = (x: [number, number]) => ((100 * x[1]) / x[0]).toFixed(1)
      lineas.push(
        `${id} fila ${pc(fila[`simple|${id}`])}/${pc(fila[`novato|${id}`])} col ${pc(col[`simple|${id}`])}/${pc(col[`novato|${id}`])} asistencia ${a0} → ${a.normal} periciaHumano ${p0} → ${ph.normal}`,
      )
    }
  }
  console.log(`vuelta ${v} (${balanza})\n  ${lineas.join('\n  ')}`)
  writeFileSync(salida, JSON.stringify(ajuste, null, 2))
}
console.log(`ajuste: ${salida}`)
