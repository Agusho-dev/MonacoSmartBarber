import { readFileSync, existsSync, statSync } from 'node:fs'
import type { AtlasPersonaje } from '../../../src/lib/juego/tipos.ts'
import { metaDesdeAtlas } from '../../../src/lib/juego/motor/index.ts'
import { IDS_PERSONAJES } from '../../../src/lib/juego/personajes.ts'
for (const id of IDS_PERSONAJES) {
  const ruta = new URL(`../../../public/juego/personajes/${id}/atlas.json`, import.meta.url).pathname
  if (!existsSync(ruta)) { console.log(id, 'sin atlas'); continue }
  const a = JSON.parse(readFileSync(ruta, 'utf8')) as AtlasPersonaje
  const m = metaDesdeAtlas(a)
  console.log(id, new Date(statSync(ruta).mtimeMs).toISOString(), 'alturaRef', a.alturaReferencia, 'efectos:', Object.keys(a.efectos ?? {}).join(','))
  console.log('  ' + Object.entries(m).map(([k, v]) => `${k} ${v.n}${v.impactos.length ? ' [' + v.impactos.join(',') + ']' : ''}`).join(' · '))
}
