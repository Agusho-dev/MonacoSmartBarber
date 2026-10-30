/**
 * Chequeo del catálogo contra los archivos de public/: que cada barbero de `PERSONAJES` tenga su
 * atlas (las 20 animaciones, cuadros dentro de la imagen, impactos en rango y sólo efectos
 * conocidos), retrato y cara, kit de movimientos y factores de balance, y que los sprites pelados
 * del remate existan si y sólo si la ficha los declara (`rutas.rapado`): así ninguna pantalla pide un
 * archivo que no existe. Sale con código 1 si algo no da.
 *
 *   cd scripts/juego/simulador && node --import ./cargador.mjs catalogo.mts
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AtlasPersonaje } from '../../../src/lib/juego/tipos.ts'
import { CLAVES_ANIMACION, EFECTOS_ATLAS } from '../../../src/lib/juego/tipos.ts'
import { DANIO_KIT, MOVIMIENTOS } from '../../../src/lib/juego/motor/movimientos.ts'
import { IDS_PERSONAJES, PERSONAJES, PROXIMAMENTE } from '../../../src/lib/juego/personajes.ts'

const PUBLICO = new URL('../../../public', import.meta.url).pathname
const fallas: string[] = []
const archivo = (url: string) => join(PUBLICO, url)
// Los efectos de Simón y Chipi son anteriores a EFECTOS_ATLAS.
const EFECTOS_OK = new Set<string>([...EFECTOS_ATLAS, 'tornado', 'sillon', 'spray', 'rayo', 'tijera', 'estatua'])

/** Ancho y alto de un PNG o WebP leyendo su cabecera (sin dependencias). */
function medidas(ruta: string): [number, number] | null {
  const b = readFileSync(ruta)
  if (b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)]
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const tipo = b.toString('ascii', 12, 16)
    if (tipo === 'VP8L') {
      const n = b.readUInt32LE(21)
      return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]
    }
    if (tipo === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
    if (tipo === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  }
  return null
}

let kb = 0
for (const id of IDS_PERSONAJES) {
  const f = PERSONAJES[id]
  const mal = (t: string) => fallas.push(`${id}: ${t}`)
  if (f.id !== id) mal(`la ficha dice id «${f.id}»`)
  if (!MOVIMIENTOS[id]) mal('sin kit en movimientos.ts')
  if (!DANIO_KIT[id]) mal('sin factores en DANIO_KIT')
  for (const url of [f.rutas.atlas, f.rutas.retrato, f.rutas.cara]) if (!existsSync(archivo(url))) mal(`falta ${url}`)
  const r = f.rutas.rapado
  const pelados = [`/juego/personajes/${id}/rapado.json`, `/juego/personajes/${id}/retrato_rapado.webp`, `/juego/personajes/${id}/cara_rapado.webp`]
  if (r) {
    for (const url of [r.atlas, r.retrato, r.cara]) if (!existsSync(archivo(url))) mal(`declara rapado pero falta ${url}`)
  } else {
    for (const url of pelados) if (existsSync(archivo(url))) mal(`${url} existe pero la ficha no lo declara (ruta(id, true))`)
  }
  if (!existsSync(archivo(f.rutas.atlas))) continue
  const atlas = JSON.parse(readFileSync(archivo(f.rutas.atlas), 'utf8')) as AtlasPersonaje
  const img = join(PUBLICO, f.rutas.atlas, '..', atlas.imagen)
  if (!existsSync(img)) {
    mal(`falta la imagen del atlas ${atlas.imagen}`)
    continue
  }
  const dim = medidas(img)
  if (!dim) mal(`no se pudo leer el tamaño de ${atlas.imagen}`)
  for (const u of [img, archivo(f.rutas.retrato), archivo(f.rutas.cara)]) if (existsSync(u)) kb += statSync(u).size / 1024
  for (const clave of CLAVES_ANIMACION) {
    const a = atlas.animaciones[clave]
    if (!a || !a.cuadros?.length) {
      mal(`sin animación «${clave}»`)
      continue
    }
    for (const i of a.impactos ?? []) if (i < 0 || i >= a.cuadros.length) mal(`${clave}: impacto ${i} fuera de rango`)
    for (const c of a.cuadros) {
      if (dim && (c.x < 0 || c.y < 0 || c.x + c.w > dim[0] || c.y + c.h > dim[1])) mal(`${clave}: cuadro fuera de la imagen`)
    }
  }
  for (const ataque of ['golpe', 'patada', 'combo', 'herramienta1', 'herramienta2', 'especial1', 'especial2'] as const) {
    if (!atlas.animaciones[ataque]?.impactos?.length) mal(`${ataque} sin impactos`)
  }
  for (const e of Object.keys(atlas.efectos ?? {})) if (!EFECTOS_OK.has(e)) mal(`efecto desconocido «${e}»`)
}
const conRapado = IDS_PERSONAJES.filter((id) => PERSONAJES[id].rutas.rapado).join(', ')
console.log(`${IDS_PERSONAJES.length} barberos, ${PROXIMAMENTE.length} próximamente; con rapado: ${conRapado}; atlas + retratos + caras: ${(kb / 1024).toFixed(2)} MB`)
if (fallas.length) {
  console.log(`FALLAS (${fallas.length}):\n - ${fallas.join('\n - ')}`)
  process.exit(1)
}
console.log('TODO OK: cada ruta del catálogo existe y nada pide un archivo que falta')
