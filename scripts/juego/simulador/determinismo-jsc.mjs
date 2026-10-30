// Determinismo ENTRE MOTORES de JavaScript: la misma partida en V8 (Chrome, Android, Node) y en
// JavaScriptCore (Safari, todo iPhone) tiene que dar el mismo hash en cada tick. Es lo que sostiene
// las peleas online entre dos celulares (lockstep): si un número sale distinto en un iPhone, la
// pelea se anula por hash. Revisión del 30/oct/2026 (elenco de 13).
//
//   node scripts/juego/simulador/determinismo-jsc.mjs [partidas por cruce = 1]
//
// Empaqueta el motor (motor/**, tipos, personajes, online/hash) en UN script clásico con el
// typescript del repo, lo corre en Node y en el `jsc` de macOS
// (/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc) y compara,
// partida por partida, un resumen de los hashes de TODOS los ticks. Cada partida: CPU contra CPU
// en las 3 dificultades y además un «humano» de entradas al azar (semilla fija) contra la CPU,
// así pasan todos los especiales, estados y proyectiles. Sólo para la Mac (fuera de la Mac, salta).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(AQUI, '../../..')
const JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc'
const SALIDA = path.join(os.tmpdir(), 'corte-final-determinismo')
const PARTIDAS = Number(process.argv[2] ?? 1)

function resolver(desde, spec) {
  const base = path.resolve(path.dirname(desde), spec)
  for (const c of [base + '.ts', path.join(base, 'index.ts'), base]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  throw new Error(`no resuelvo «${spec}» desde ${path.relative(REPO, desde)}`)
}

/** Empaqueta los módulos que alcanzan las entradas (imports relativos) en un script clásico. */
function empaquetar(entradas) {
  const modulos = new Map()
  const rel = (abs) => path.relative(REPO, abs)
  const agregar = (abs) => {
    const id = rel(abs)
    if (modulos.has(id)) return
    modulos.set(id, '')
    const fuente = fs.readFileSync(abs, 'utf8')
    const out = ts.transpileModule(fuente, {
      fileName: abs,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    })
    const deps = []
    const codigo = out.outputText.replace(/require\("([^"]+)"\)/g, (_, spec) => {
      if (!spec.startsWith('.')) throw new Error(`${id}: import no relativo «${spec}»`)
      const r = resolver(abs, spec)
      deps.push(r)
      return `require(${JSON.stringify(rel(r))})`
    })
    modulos.set(id, codigo)
    for (const d of deps) agregar(d)
  }
  for (const e of entradas) agregar(e)
  let s = 'var CF = (function () {\n"use strict";\nvar definiciones = {\n'
  for (const [id, codigo] of modulos) s += `${JSON.stringify(id)}: function (module, exports, require) {\n${codigo}\n},\n`
  s += `};
var cache = {};
function requerir(id) {
  if (cache[id]) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  definiciones[id](module, module.exports, requerir);
  return module.exports;
}
return {
  motor: requerir(${JSON.stringify(rel(entradas[0]))}),
  hash: requerir(${JSON.stringify(rel(entradas[1]))}),
  personajes: requerir(${JSON.stringify(rel(entradas[2]))}),
};
})();\n`
  return s
}

// El programa que corre igual en los dos motores (sin nada de Node ni del navegador).
const PROGRAMA = `
var log = typeof print === 'function' ? print : console.log;
function rng(semilla) {
  var s = semilla >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var VACIA = { izquierda: false, derecha: false, arriba: false, abajo: false, golpe: false, herramienta: false, guardia: false, especial1: false, especial2: false, dash: false };
function botAzar(semilla) {
  var r = rng(semilla), e = Object.assign({}, VACIA), cambio = 0;
  return function () {
    if (--cambio <= 0) {
      cambio = 3 + Math.floor(r() * 14);
      var d = r();
      e.izquierda = d < 0.3; e.derecha = d > 0.65; e.arriba = r() < 0.1; e.abajo = r() < 0.08;
      e.golpe = r() < 0.4; e.herramienta = r() < 0.15; e.guardia = r() < 0.12;
      e.especial1 = r() < 0.14; e.especial2 = r() < 0.12; e.dash = r() < 0.05;
    }
    return Object.assign({}, e);
  };
}
var ids = CF.personajes.IDS_PERSONAJES;
var difs = ['facil', 'normal', 'dificil'];
var lineas = [];
for (var i = 0; i < ids.length; i++) for (var j = 0; j < ids.length; j++) for (var k = 0; k < PARTIDAS; k++) {
  var dif = difs[(i + j + k) % 3];
  var humano = (i + j + k) % 2;
  var semilla = 1 + i * 7919 + j * 104729 + k * 31337;
  var p = CF.motor.crearPartida({ personajes: [ids[i], ids[j]], cpu: [humano !== 0, true], dificultad: dif, arena: 'parana', rondasParaGanar: 2, segundosPorRound: 60, animaciones: [META[ids[i]], META[ids[j]]], semilla: semilla });
  var bot = botAzar(semilla * 3 + 1);
  var h = 0x811c9dc5, eventos = 0;
  while (p.fase !== 'terminada' && p.tick < 6 * 3600) {
    CF.motor.avanzar(p, [humano === 1 ? bot() : VACIA, VACIA]);
    eventos += p.eventos.length;
    p.eventos.length = 0;
    h = Math.imul(h ^ CF.hash.hashPartida(p), 0x01000193) >>> 0;
  }
  lineas.push(ids[i] + '-' + ids[j] + '/' + dif + '/' + (humano ? 'h' : 'c') + ' ' + p.tick + ' ' + h.toString(16) + ' ' + p.ganadorPartida + ' ' + eventos);
}
log(lineas.join('\\n'));
`

function main() {
  fs.mkdirSync(SALIDA, { recursive: true })
  const motor = path.join(REPO, 'src/lib/juego/motor/index.ts')
  const hash = path.join(REPO, 'src/lib/juego/online/hash.ts')
  const personajes = path.join(REPO, 'src/lib/juego/personajes.ts')
  const bundle = empaquetar([motor, hash, personajes])
  // La meta de animaciones de cada atlas (la misma en los dos motores).
  const metaDesdeAtlas = (atlas) => {
    const out = {}
    for (const [clave, anim] of Object.entries(atlas.animaciones)) out[clave] = { n: Math.max(1, anim.cuadros.length), impactos: anim.impactos ?? [] }
    return out
  }
  const metas = {}
  const idsTexto = fs.readFileSync(personajes, 'utf8')
  for (const m of idsTexto.matchAll(/^  ([a-z_]+): \{\n    id: '/gm)) {
    const ruta = path.join(REPO, 'public/juego/personajes', m[1], 'atlas.json')
    metas[m[1]] = fs.existsSync(ruta) ? metaDesdeAtlas(JSON.parse(fs.readFileSync(ruta, 'utf8'))) : undefined
  }
  const script = path.join(SALIDA, 'determinismo.js')
  fs.writeFileSync(script, `${bundle}\nvar PARTIDAS = ${PARTIDAS};\nvar META = ${JSON.stringify(metas)};\n${PROGRAMA}`)
  const t0 = performance.now()
  const v8 = execFileSync(process.execPath, [script], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n')
  const tV8 = performance.now() - t0
  if (!fs.existsSync(JSC)) {
    console.log(`Sin JavaScriptCore (${JSC}): sólo corrió V8 (${v8.length} partidas). Nada que comparar.`)
    return
  }
  const t1 = performance.now()
  const jsc = execFileSync(JSC, [script], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n')
  const tJsc = performance.now() - t1
  let distintas = 0
  let ticks = 0
  for (let i = 0; i < v8.length; i++) {
    ticks += Number(v8[i].split(' ')[1])
    if (v8[i] !== jsc[i]) {
      distintas++
      if (distintas <= 5) console.log(`DISTINTA: V8 «${v8[i]}» / JSC «${jsc[i]}»`)
    }
  }
  console.log(`${v8.length} partidas (${ticks} ticks) en V8 (${(tV8 / 1000).toFixed(1)} s) y en JavaScriptCore (${(tJsc / 1000).toFixed(1)} s): ${distintas === 0 && v8.length === jsc.length ? 'IDÉNTICAS tick a tick' : `${distintas} distintas`}`)
  process.exit(distintas === 0 && v8.length === jsc.length ? 0 : 1)
}

main()
