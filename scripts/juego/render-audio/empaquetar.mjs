// Empaqueta el audio o el render de «Corte Final» en UN script clásico (sin dependencias: usa el
// typescript del repo, transpileModule → CommonJS) para probarlos fuera de Next: el audio en Node
// con el Web Audio de mentira y el render en una página del mismo origen del dev server.
// También verifica la regla del diseño: audio y render sólo importan con rutas relativas.
//
//   node scripts/juego/render-audio/empaquetar.mjs audio    → <salida>/audio-bundle.js   (global CorteFinalAudio)
//   node scripts/juego/render-audio/empaquetar.mjs render   → <salida>/render-bundle.js  (global CorteFinalRender)
//
// <salida> = $SALIDA o <tmp>/corte-final-render-audio (fuera del repo: el bundle no se lintea).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(AQUI, '../../..')
export const SALIDA = process.env.SALIDA || path.join(os.tmpdir(), 'corte-final-render-audio')

function resolver(desde, spec) {
  const base = path.resolve(path.dirname(desde), spec)
  for (const c of [base + '.ts', path.join(base, 'index.ts'), base]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  throw new Error(`no resuelvo «${spec}» desde ${path.relative(REPO, desde)}`)
}

/** Devuelve la ruta del bundle escrito. */
export function empaquetar(modulo) {
  if (modulo !== 'audio' && modulo !== 'render') throw new Error('módulo: audio | render')
  const carpeta = path.join(REPO, 'src/lib/juego', modulo)
  const modulos = new Map()
  const rel = (abs) => path.relative(REPO, abs)
  const agregar = (abs) => {
    const id = rel(abs)
    if (modulos.has(id)) return
    modulos.set(id, '')
    const fuente = fs.readFileSync(abs, 'utf8')
    for (const m of fuente.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
      if (!m[1].startsWith('.')) throw new Error(`${id}: import no relativo «${m[1]}» (no puede importar @/ ni paquetes)`)
    }
    const out = ts.transpileModule(fuente, {
      fileName: abs,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    })
    const deps = []
    const codigo = out.outputText.replace(/require\("([^"]+)"\)/g, (_, spec) => {
      const r = resolver(abs, spec)
      deps.push(r)
      return `require(${JSON.stringify(rel(r))})`
    })
    modulos.set(id, codigo)
    for (const d of deps) agregar(d)
  }
  const archivos = fs.readdirSync(carpeta).filter((f) => f.endsWith('.ts')).sort()
  for (const f of archivos) agregar(path.join(carpeta, f))
  let salida = '(function (raiz) {\n"use strict";\nvar definiciones = {\n'
  for (const [id, codigo] of modulos) salida += `${JSON.stringify(id)}: function (module, exports, require) {\n${codigo}\n},\n`
  const nombre = (f) => f.replace(/\.ts$/, '')
  const internos = archivos.map((f) => `${JSON.stringify(nombre(f))}: requerir(${JSON.stringify(`src/lib/juego/${modulo}/${f}`)})`).join(',\n')
  salida += `};
var cache = {};
function requerir(id) { if (cache[id]) return cache[id].exports; var module = { exports: {} }; cache[id] = module; definiciones[id](module, module.exports, requerir); return module.exports; }
var indice = requerir("src/lib/juego/${modulo}/index.ts");
raiz.${modulo === 'audio' ? 'CorteFinalAudio' : 'CorteFinalRender'} = {
  indice: indice,
  mod: requerir,
  internos: { ${internos}, tipos: requerir("src/lib/juego/tipos.ts"), personajes: requerir("src/lib/juego/personajes.ts") }
};
})(globalThis);
`
  fs.mkdirSync(SALIDA, { recursive: true })
  const destino = path.join(SALIDA, `${modulo}-bundle.js`)
  fs.writeFileSync(destino, salida)
  console.log(`${modulo}: ${modulos.size} módulos, ${(salida.length / 1024).toFixed(1)} KB → ${destino}`)
  return destino
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  empaquetar(process.argv[2] || 'audio')
}
