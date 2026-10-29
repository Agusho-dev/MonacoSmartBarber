// Ganchos de resolución para correr el motor con Node (quita tipos solo): los imports relativos
// sin extensión ('../tipos', './constantes') se resuelven a .ts, como hace el bundler de Next.
import { statSync } from 'node:fs'
import { dirname, join, resolve as resolverRuta } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function esArchivo(ruta) {
  try {
    return statSync(ruta).isFile()
  } catch {
    return false
  }
}

export async function resolve(especificador, contexto, siguiente) {
  const padre = contexto.parentURL
  if ((especificador.startsWith('./') || especificador.startsWith('../')) && padre && padre.startsWith('file:')) {
    const base = resolverRuta(dirname(fileURLToPath(padre)), especificador)
    if (!esArchivo(base)) {
      for (const candidato of [base + '.ts', join(base, 'index.ts')]) {
        if (esArchivo(candidato)) {
          return { url: pathToFileURL(candidato).href, format: 'module-typescript', shortCircuit: true }
        }
      }
    }
  }
  const r = await siguiente(especificador, contexto)
  if (r.url && r.url.endsWith('.ts')) return { ...r, format: 'module-typescript' }
  return r
}
