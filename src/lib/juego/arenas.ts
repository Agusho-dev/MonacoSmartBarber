/**
 * Arenas de «Corte Final»: una por sucursal. Las imágenes viven en public/juego/arenas/
 * (sin las barras de vida que traían dibujadas: el HUD es nuestro).
 *
 * `suelo` es la fracción del alto de la imagen donde apoyan los pies; se midió sobre cada
 * imagen para que los luchadores pisen el piso del local y no floten.
 * `luces` marca los neones, aros de luz y lámparas que el render hace titilar (x, y en
 * fracciones de la imagen; `radio` en fracción del ancho). Las medidas y la hoja de revisión
 * que las muestra salen de scripts/juego/arenas.py.
 */
import type { ArenaDef, IdArena } from './tipos'

export const ARENAS: Record<IdArena, ArenaDef> = {
  rondeau: {
    id: 'rondeau',
    nombre: 'Rondeau',
    sucursalSlug: 'rondeau',
    imagen: '/juego/arenas/rondeau.webp',
    miniatura: '/juego/arenas/rondeau-mini.webp',
    suelo: 0.87,
    luces: [
      { x: 0.195, y: 0.403, radio: 0.022, color: '#FFF3E3' }, // aro de luz del primer espejo
      { x: 0.568, y: 0.458, radio: 0.012, color: '#FFF3E3' }, // aro de luz del fondo
      { x: 0.628, y: 0.194, radio: 0.085, color: '#FFE6C0' }, // tiras LED del techo
      { x: 0.78, y: 0.317, radio: 0.055, color: '#FFE6C0' },
      { x: 0.819, y: 0.479, radio: 0.024, color: '#F2D9A6' }, // cartel redondo MÓNACO
    ],
    tono: '#27201B',
  },
  caseros: {
    id: 'caseros',
    nombre: 'Caseros',
    sucursalSlug: 'caseros',
    imagen: '/juego/arenas/caseros.webp',
    miniatura: '/juego/arenas/caseros-mini.webp',
    suelo: 0.87,
    luces: [
      { x: 0.222, y: 0.43, radio: 0.04, color: '#FFE6C2' }, // neón «M» de la pared de cemento
      { x: 0.897, y: 0.462, radio: 0.026, color: '#EEF2FF' }, // neón «M» del fondo
      { x: 0.278, y: 0.118, radio: 0.014, color: '#FFD597' }, // spots colgantes
      { x: 0.484, y: 0.188, radio: 0.013, color: '#FFD597' },
      { x: 0.614, y: 0.24, radio: 0.011, color: '#FFD597' },
      { x: 0.854, y: 0.245, radio: 0.035, color: '#EAF1FF' }, // tubo fluorescente
    ],
    tono: '#1E212A',
  },
  pueyrredon: {
    id: 'pueyrredon',
    nombre: 'Pueyrredón',
    sucursalSlug: 'pueyrredon',
    imagen: '/juego/arenas/pueyrredon.webp',
    miniatura: '/juego/arenas/pueyrredon-mini.webp',
    suelo: 0.88,
    luces: [
      { x: 0.539, y: 0.201, radio: 0.065, color: '#DCEBFF' }, // neón MONACO («MON»)
      { x: 0.664, y: 0.239, radio: 0.065, color: '#DCEBFF' }, // neón MONACO («ACO»)
      { x: 0.866, y: 0.443, radio: 0.075, color: '#E2EDFF' }, // «M» gigante de neón
      { x: 0.341, y: 0.362, radio: 0.06, color: '#FFD9A0' }, // techo del salón, tras el vidrio
      { x: 0.176, y: 0.455, radio: 0.055, color: '#B07CFF' }, // pantalla de la vidriera
    ],
    tono: '#202127',
  },
  parana: {
    id: 'parana',
    nombre: 'Paraná',
    sucursalSlug: 'parana',
    imagen: '/juego/arenas/parana.webp',
    miniatura: '/juego/arenas/parana-mini.webp',
    suelo: 0.87,
    luces: [
      { x: 0.827, y: 0.42, radio: 0.032, color: '#D4F0FF' }, // neón «M» en el espejo
      { x: 0.062, y: 0.438, radio: 0.016, color: '#FFC46B' }, // aplique de la pared
      { x: 0.192, y: 0.282, radio: 0.06, color: '#FFD49A' }, // tiras de luz del techo
      { x: 0.477, y: 0.194, radio: 0.06, color: '#FFD49A' },
      { x: 0.661, y: 0.092, radio: 0.06, color: '#FFD49A' },
    ],
    tono: '#1F2225',
  },
}

export const IDS_ARENAS = Object.keys(ARENAS) as IdArena[]

/** La arena de la sucursal donde está el cliente; Rondeau si no se sabe. */
export function arenaDeSucursal(slug: string | null | undefined): IdArena {
  const s = (slug ?? '').toLowerCase()
  return IDS_ARENAS.find((id) => ARENAS[id].sucursalSlug === s) ?? 'rondeau'
}
