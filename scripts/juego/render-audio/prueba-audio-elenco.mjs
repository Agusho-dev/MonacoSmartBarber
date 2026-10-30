// Pruebas del audio del ELENCO en Node con el Web Audio de mentira (webaudio-falso.mjs): que cada
// evento, herramienta, especial y proyectil del elenco suene, que los bucles vivan con su proyectil
// y se corten, que los finales (salpicadura, vidrio, estallido) suenen una sola vez, que la
// curación suba de tono, que nada se apile hasta saturar y que no queden nodos colgados.
//
//   node scripts/juego/render-audio/prueba-audio-elenco.mjs      (empaqueta el audio y prueba)
import { pathToFileURL } from 'node:url'
import { empaquetar } from './empaquetar.mjs'
import { MockAudioContext } from './webaudio-falso.mjs'

globalThis.fetch = () => Promise.reject(new Error('sin red en el arnés'))

function crearObjetivo() {
  const oyentes = new Map()
  return {
    addEventListener(tipo, fn) {
      if (!oyentes.has(tipo)) oyentes.set(tipo, new Set())
      oyentes.get(tipo).add(fn)
    },
    removeEventListener(tipo, fn) {
      oyentes.get(tipo)?.delete(fn)
    },
  }
}
const ventana = crearObjetivo()
const documento = crearObjetivo()
documento.visibilityState = 'visible'
globalThis.window = Object.assign(globalThis, { addEventListener: ventana.addEventListener, removeEventListener: ventana.removeEventListener })
globalThis.document = documento
globalThis.AudioContext = MockAudioContext
const intervalos = new Map()
let proximoId = 1
globalThis.setInterval = (fn) => {
  const id = proximoId++
  intervalos.set(id, fn)
  return id
}
globalThis.clearInterval = (id) => intervalos.delete(id)

await import(pathToFileURL(empaquetar('audio')).href)
const { indice, internos } = globalThis.CorteFinalAudio
const { crearAudio, diagnosticarAudio } = indice
const { PERSONAJES } = internos.personajes

let fallas = 0
const ok = (cond, msg) => {
  if (cond) console.log('  ok  ', msg)
  else {
    fallas++
    console.log('  FALLA', msg)
  }
}
const ctxActual = () => MockAudioContext.instancias[MockAudioContext.instancias.length - 1]
function avanzar(ctx, seg) {
  const pasos = Math.round(seg / 0.025)
  for (let i = 0; i < pasos; i++) {
    ctx.avanzar(0.025)
    for (const fn of [...intervalos.values()]) fn()
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const ELENCO = ['nico_u', 'fabri', 'luciano', 'gabriel', 'guillermo', 'rodrigo', 'joaquin', 'nahuel', 'lucas', 'stefano', 'brian']
function partida(extra = {}, personajes = ['nico_u', 'brian']) {
  const luchador = (lado, x) => ({ id: personajes[lado], lado, x, y: 0, carga: 2 })
  return {
    config: { personajes, cpu: [false, true], dificultad: 'normal', arena: 'rondeau', rondasParaGanar: 2, segundosPorRound: 60, semilla: 1 },
    fase: 'pelea',
    round: 1,
    turbo: false,
    luchadores: [luchador(0, 300), luchador(1, 660)],
    proyectiles: [],
    escalaTiempo: 1,
    ...extra,
  }
}
const HERRAMIENTAS = [
  'bombo', 'navaja', 'celular', 'anteojos', 'guante', 'moto', 'bala', 'graffiti', 'break', 'trago', 'botella', 'baile', 'onda',
  'gorro', 'dragon', 'pelota', 'leche', 'panal', 'nube', 'mate', 'agua', 'sismo', 'agarre', 'pesado',
]
/** Herramientas cuyo swing NO suena a propósito (suenan con su proyectil o su disparo). */
const SWING_MUDO = new Set(['pelota', 'leche', 'agua', 'graffiti', 'onda', 'nube', 'bala'])
const PROYECTILES = ['bombo', 'bala', 'graffiti', 'trago', 'botella', 'onda', 'gorro', 'pelota', 'leche', 'panal', 'nube', 'mate', 'agua', 'sismo', 'guante']
const CON_BUCLE = new Set(['bombo', 'graffiti', 'onda', 'gorro', 'leche', 'agua', 'nube', 'sismo', 'guante'])
const CON_FINAL = new Set(['trago', 'botella', 'mate', 'pelota', 'bombo', 'guante', 'graffiti'])
/** Lanzamientos que no suenan a propósito (la bala suena con `disparo`; nube y sismo con su evento; graffiti, leche y agua con su bucle). */
const LANZAMIENTO_MUDO = new Set(['bala', 'nube', 'sismo', 'graffiti', 'leche', 'agua'])

async function main() {
  const a = crearAudio()
  await a.desbloquear()
  await esperar(0)
  const ctx = ctxActual()
  a.musica(null)
  avanzar(ctx, 3)
  const base = ctx.conectados.size
  ok(base === 15 && ctx.state === 'running', `contexto andando, grafo fijo de ${base} nodos`)

  console.log('\n1) Eventos nuevos')
  const eventos = [
    { tipo: 'curacion', quien: 0, cantidad: 30 },
    { tipo: 'agarre', atacante: 1, victima: 0 },
    { tipo: 'aturdido', quien: 1 },
    { tipo: 'mareado', quien: 1 },
    { tipo: 'quemado', quien: 1 },
    { tipo: 'nube', quien: 0, x: 600 },
    { tipo: 'sismo', quien: 1, x: 640 },
    { tipo: 'disparo', quien: 0, x: 360, y: 120 },
  ]
  for (const e of eventos) {
    const antes = ctx.iniciosAgendados.length
    const nodos = ctx.creados
    a.procesar([e], partida())
    const fuentes = ctx.iniciosAgendados.length - antes
    ok(fuentes > 0, `${e.tipo}: ${fuentes} fuentes, ${ctx.creados - nodos} nodos`)
    avanzar(ctx, 0.4)
  }
  ok(ctx.errores.length === 0, `errores de la API: ${ctx.errores.length}${ctx.errores.length ? ' → ' + [...new Set(ctx.errores)].slice(0, 4).join(' | ') : ''}`)

  console.log('\n2) Herramientas: swing y golpe (normal, crítico, bloqueado)')
  const mudosMal = []
  const sinGolpe = []
  for (const h of HERRAMIENTAS) {
    for (const fuerza of ['leve', 'medio', 'fuerte', 'especial']) {
      const antes = ctx.iniciosAgendados.length
      a.procesar([{ tipo: 'swing', quien: 0, fuerza, herramienta: h }], partida())
      const sono = ctx.iniciosAgendados.length > antes
      if (sono === SWING_MUDO.has(h)) mudosMal.push(`${h}/${fuerza}:${sono ? 'sonó' : 'mudo'}`)
      avanzar(ctx, 0.3)
    }
    for (const [critico, bloqueado] of [
      [false, false],
      [true, false],
      [false, true],
    ]) {
      const antes = ctx.iniciosAgendados.length
      a.procesar([{ tipo: 'golpe', atacante: 0, victima: 1, x: 480, y: 120, danio: 50, critico, bloqueado, fuerza: 'medio', herramienta: h }], partida())
      if (ctx.iniciosAgendados.length === antes) sinGolpe.push(`${h}${critico ? '/crit' : ''}${bloqueado ? '/bloq' : ''}`)
      avanzar(ctx, 0.3)
    }
  }
  ok(mudosMal.length === 0, `swings: suenan los que tienen que sonar y callan ${[...SWING_MUDO].join(', ')}${mudosMal.length ? ' → ' + mudosMal.slice(0, 6).join(' ') : ''}`)
  ok(sinGolpe.length === 0, `los ${HERRAMIENTAS.length} golpes nuevos suenan en sus tres variantes${sinGolpe.length ? ' → ' + sinGolpe.join(' ') : ''}`)
  ok(ctx.errores.length === 0, `errores de la API: ${ctx.errores.length}${ctx.errores.length ? ' → ' + [...new Set(ctx.errores)].slice(0, 4).join(' | ') : ''}`)

  console.log('\n3) Los 22 especiales nuevos (super flash con su capa propia)')
  const capas = []
  for (const id of ELENCO) {
    const ficha = PERSONAJES[id]
    if (!ficha) {
      ok(false, `falta la ficha de ${id} en personajes.ts`)
      continue
    }
    for (const numero of [1, 2]) {
      const esp = ficha.especiales[numero - 1]
      const antes = ctx.iniciosAgendados.length
      const nodos = ctx.creados
      a.procesar([{ tipo: 'especial', quien: 0, numero, nombre: esp.nombre }], partida({}, [id, 'simon']))
      capas.push([`${id}.${esp.icono}`, ctx.iniciosAgendados.length - antes, ctx.creados - nodos])
      avanzar(ctx, 0.9)
    }
  }
  // el super flash solo (sin capa) agenda 7 fuentes (golpe, chasquido, coro de 4 y el barrido)
  const soloBase = capas.filter(([, f]) => f <= 7)
  ok(capas.length === 22 && soloBase.length === 0, `22 especiales con capa propia (fuentes por especial: ${capas.map(([n, f]) => n.split('.')[1] + ' ' + f).join(', ')})`)
  ok(ctx.errores.length === 0, `errores de la API: ${ctx.errores.length}`)

  console.log('\n4) Proyectiles: lanzamiento, bucle en vuelo, final al desaparecer, sin fugas')
  avanzar(ctx, 3)
  for (const tipo of PROYECTILES) {
    const pr = { id: 1000 + PROYECTILES.indexOf(tipo), tipo, duenio: 0, x: 320, y: 60, vx: 6, vy: 0, mira: 1, rot: 0, edad: 0, golpesRestantes: 1, vuelta: false, ancho: 60, alto: 40 }
    const p = partida({ proyectiles: [pr] })
    const antes = ctx.iniciosAgendados.length
    a.procesar([{ tipo: 'proyectil', quien: 0, proyectil: tipo }], p)
    const lanzo = ctx.iniciosAgendados.length - antes
    const voces0 = diagnosticarAudio(a).voces
    // vuela 1 s (60 cuadros) moviéndose y envejeciendo
    let explosiones = 0
    for (let f = 0; f < 60; f++) {
      pr.x += 4
      pr.edad++
      const a0 = ctx.iniciosAgendados.length
      a.procesar([], p)
      if (tipo === 'graffiti' && ctx.iniciosAgendados.length > a0) explosiones++
      avanzar(ctx, 1 / 60)
    }
    const conBucle = diagnosticarAudio(a).voces > 0
    p.proyectiles = []
    const a1 = ctx.iniciosAgendados.length
    a.procesar([], p)
    const finSono = ctx.iniciosAgendados.length > a1
    avanzar(ctx, 3)
    const limpio = ctx.conectados.size === base
    const esperaBucle = CON_BUCLE.has(tipo) && tipo !== 'graffiti'
    const esperaFinal = CON_FINAL.has(tipo) && tipo !== 'graffiti'
    const lanzaOk = LANZAMIENTO_MUDO.has(tipo) ? true : lanzo > 0
    const bucleOk = esperaBucle ? conBucle : true
    const finalOk = esperaFinal ? finSono : tipo === 'graffiti' ? !finSono && explosiones === 1 : true
    ok(lanzaOk && bucleOk && finalOk && limpio, `${tipo}: lanzamiento ${lanzo} fuentes · bucle ${conBucle ? 'sí' : 'no'} (voces al salir ${voces0}) · final ${finSono ? 'sí' : 'no'}${tipo === 'graffiti' ? ` · estalló ${explosiones} vez` : ''} · ${limpio ? 'sin restos' : ctx.conectados.size + ' conectados'}`)
  }
  ok(ctx.errores.length === 0, `errores de la API: ${ctx.errores.length}${ctx.errores.length ? ' → ' + [...new Set(ctx.errores)].slice(0, 4).join(' | ') : ''}`)

  console.log('\n5) Graffiti que desaparece antes de estallar: estalla igual (una vez)')
  {
    const pr = { id: 2001, tipo: 'graffiti', duenio: 0, x: 500, y: 100, vx: 0, vy: 0, mira: 1, rot: 0, edad: 0, golpesRestantes: 1, vuelta: false, ancho: 150, alto: 150 }
    const p = partida({ proyectiles: [pr] })
    a.procesar([{ tipo: 'proyectil', quien: 0, proyectil: 'graffiti' }], p)
    for (let f = 0; f < 10; f++) {
      pr.edad++
      a.procesar([], p)
      avanzar(ctx, 1 / 60)
    }
    p.proyectiles = []
    const a1 = ctx.iniciosAgendados.length
    a.procesar([], p)
    const sono = ctx.iniciosAgendados.length > a1
    a.procesar([], p)
    const a2 = ctx.iniciosAgendados.length
    a.procesar([], p)
    ok(sono && ctx.iniciosAgendados.length === a2, 'estalla al desaparecer y no repite')
    avanzar(ctx, 3)
  }

  console.log('\n6) La curación sube de tono pedacito a pedacito')
  {
    const frecs = []
    for (let i = 0; i < 6; i++) {
      const previos = new Set(ctx.conectados)
      a.procesar([{ tipo: 'curacion', quien: 0, cantidad: 25 }], partida())
      const nuevos = [...ctx.conectados].filter((n) => !previos.has(n) && n.tipo === 'osc' && n.frequency.eventos.length)
      const f = nuevos.map((n) => n.frequency.eventos[0].v).filter((v) => v > 600 && v < 6000)
      frecs.push(Math.round(Math.min(...f)))
      avanzar(ctx, 0.17)
    }
    const sube = frecs.every((f, i) => i === 0 || f > frecs[i - 1])
    ok(sube, `notas de la curación: ${frecs.join(' → ')} Hz`)
    avanzar(ctx, 1.5)
    const previos = new Set(ctx.conectados)
    a.procesar([{ tipo: 'curacion', quien: 0, cantidad: 25 }], partida())
    const nuevos = [...ctx.conectados].filter((n) => !previos.has(n) && n.tipo === 'osc' && n.frequency.eventos.length)
    const f0 = Math.min(...nuevos.map((n) => n.frequency.eventos[0].v).filter((v) => v > 600 && v < 6000))
    ok(Math.round(f0) === frecs[0], `una curación nueva arranca de abajo (${Math.round(f0)} Hz)`)
    avanzar(ctx, 2)
  }

  console.log('\n7) Ráfaga: tres tiros, cuatro mates que caen, el sismo y la nube en el mismo cuadro')
  {
    const mates = [0, 1, 2, 3].map((k) => ({ id: 3000 + k, tipo: 'mate', duenio: 0, x: 400 + k * 60, y: 40, vx: 3, vy: -2, mira: 1, rot: 0, edad: 10, golpesRestantes: 1, vuelta: false, ancho: 34, alto: 34 }))
    const p = partida({ proyectiles: [...mates] })
    a.procesar([], p)
    p.proyectiles = []
    const t0 = process.hrtime.bigint()
    a.procesar(
      [
        { tipo: 'disparo', quien: 0, x: 360, y: 120 },
        { tipo: 'disparo', quien: 0, x: 360, y: 120 },
        { tipo: 'disparo', quien: 0, x: 360, y: 120 },
        { tipo: 'sismo', quien: 1, x: 640 },
        { tipo: 'nube', quien: 0, x: 600 },
        { tipo: 'golpe', atacante: 1, victima: 0, x: 400, y: 100, danio: 80, critico: true, bloqueado: false, fuerza: 'especial', herramienta: 'sismo' },
        { tipo: 'aturdido', quien: 0 },
      ],
      p,
    )
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    const d = diagnosticarAudio(a)
    ok(d.voces <= 36, `${d.voces} voces vivas (tope global 36), ${ms.toFixed(1)} ms en Node`)
    ok(a && ctx.errores.length === 0, 'sin errores de la API')
    avanzar(ctx, 4)
    ok(ctx.conectados.size === base, `todo se liberó (${ctx.conectados.size} conectados, base ${base})`)
  }

  console.log('\n8) Topes por tipo (nada se apila hasta saturar)')
  {
    const m2ctx = new MockAudioContext()
    m2ctx.state = 'running'
    const m2 = new internos.mesa.Mesa(m2ctx)
    const E = internos.elenco
    for (let i = 0; i < 20; i++) E.moto(m2, m2.ahora() + i * 0.05, { pan: 0 })
    ok(m2.cuantasVoces('moto') === 1, `moto: 20 pedidos → ${m2.cuantasVoces('moto')} voz (la última pisa)`)
    for (let i = 0; i < 20; i++) E.disparo(m2, m2.ahora(), 0)
    ok(m2.cuantasVoces('disparo') === 1, `disparo: 20 en el mismo instante → ${m2.cuantasVoces('disparo')} (anti-ráfaga)`)
    for (let i = 0; i < 30; i++) E.mate(m2, m2.ahora() + i * 0.05, 0)
    ok(m2.cuantasVoces('mate') <= 3, `mate: 30 seguidos → ${m2.cuantasVoces('mate')} voces`)
    for (let i = 0; i < 10; i++) E.grito(m2, m2.ahora() + i * 0.2, 0)
    ok(m2.cuantasVoces('grito') === 1, `grito: 10 → ${m2.cuantasVoces('grito')}`)
    ok(m2ctx.errores.length === 0, 'sin errores de la API')
  }

  console.log('\n9) Silenciado: nada del elenco crea voces')
  {
    a.silenciar(true)
    const antes = ctx.iniciosAgendados.length
    a.procesar(eventos, partida())
    a.procesar([{ tipo: 'especial', quien: 0, numero: 1, nombre: 'Bombo Aturdidor' }], partida())
    ok(ctx.iniciosAgendados.length === antes, 'silenciado: cero fuentes')
    a.silenciar(false)
  }

  a.destruir()
  ok(ctx.state === 'closed', 'destruir() cierra el contexto')
  console.log(`\n${fallas === 0 ? 'TODO OK' : fallas + ' FALLAS'}`)
  process.exit(fallas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
