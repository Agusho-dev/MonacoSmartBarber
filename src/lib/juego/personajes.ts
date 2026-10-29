/**
 * Catálogo de luchadores de «Corte Final». Cada barbero es un personaje.
 *
 * Sumar uno nuevo: (1) procesar su hoja con scripts/juego/extraer_sprites.py (deja el atlas,
 * el retrato y la cara en public/juego/personajes/<id>/), (2) agregar el id a IdPersonaje en
 * tipos.ts, (3) su ficha acá y (4) sus movimientos en src/lib/juego/motor/movimientos.ts.
 * Los costos de los especiales y la vida salen de acá: el motor no los duplica.
 */
import type { FichaPersonaje, FichaProximamente, IdPersonaje } from './tipos'

const ruta = (id: IdPersonaje) => ({
  atlas: `/juego/personajes/${id}/atlas.json`,
  retrato: `/juego/personajes/${id}/retrato.webp`,
  cara: `/juego/personajes/${id}/cara.webp`,
})

export const PERSONAJES: Record<IdPersonaje, FichaPersonaje> = {
  simon: {
    id: 'simon',
    nombre: 'Simón',
    apodo: 'El Relámpago',
    staffId: '9b4be6d2-1382-46d3-a23f-e299909922e2',
    sucursal: 'rondeau',
    color: '#F5B301',
    colorSecundario: '#FF6A00',
    atributos: { fuerza: 6, velocidad: 9, defensa: 5, tecnica: 8, alcance: 6 },
    vidaMax: 1000,
    alturaMundo: 212,
    herramientas: ['Máquina', 'Tijera'],
    especiales: [
      {
        nombre: 'Corte Relámpago',
        costo: 4,
        icono: 'rayo',
        efecto: 'electrocuta',
        descripcion: 'Cruza la pantalla con la máquina cargada de electricidad y deja al rival electrocutado.',
      },
      {
        nombre: 'Tijera Tormenta',
        costo: 6,
        icono: 'tijera',
        efecto: 'multigolpe',
        descripcion: 'Lanza un tornado de tijeras que corta seis veces seguidas.',
      },
    ],
    pasiva: {
      nombre: 'Pulso de fade',
      descripcion: '15 % de golpes críticos. Cada crítico le devuelve carga a la máquina.',
    },
    frases: ['Siguiente, por favor.', 'Te dejé el degradé perfecto.', '¿Quién sigue? Tengo la máquina caliente.'],
    rutas: ruta('simon'),
  },
  chipi: {
    id: 'chipi',
    nombre: 'Chipi',
    apodo: 'El Fijador',
    staffId: '1f7d0366-f536-462d-80b7-1cd6f5d7c7fa',
    sucursal: 'rondeau',
    color: '#38D6FF',
    colorSecundario: '#2A6BFF',
    atributos: { fuerza: 9, velocidad: 5, defensa: 8, tecnica: 6, alcance: 7 },
    vidaMax: 1150,
    alturaMundo: 205,
    herramientas: ['Máquina', 'Peine'],
    especiales: [
      {
        nombre: 'Sillonazo Brutal',
        costo: 5,
        icono: 'sillon',
        efecto: 'rompe_guardia',
        descripcion: 'Revolea un sillón de barbero: rompe la guardia y tira al rival al piso.',
      },
      {
        nombre: 'Fijación Extrema',
        costo: 6,
        icono: 'spray',
        efecto: 'congela',
        descripcion: 'Spray de fijación al máximo: deja al rival duro como una estatua.',
      },
    ],
    pasiva: {
      nombre: 'Cuero duro',
      descripcion: 'Recibe 12 % menos de daño y los golpes leves no lo frenan mientras ataca con la herramienta.',
    },
    frases: ['Quedate quieto que te emparejo.', 'Con gel no se despeina nadie.', 'Pasá por caja.'],
    rutas: ruta('chipi'),
  },
}

export const IDS_PERSONAJES = Object.keys(PERSONAJES) as IdPersonaje[]

/** Los barberos de Rondeau que todavía no tienen hoja de sprites. */
export const PROXIMAMENTE: FichaProximamente[] = [
  { nombre: 'Fabri', sucursal: 'rondeau' },
  { nombre: 'Lucho', sucursal: 'rondeau' },
  { nombre: 'Nico M.', sucursal: 'rondeau' },
  { nombre: 'Nico U.', sucursal: 'rondeau' },
  { nombre: 'Tony', sucursal: 'rondeau' },
]

export function rivalPorDefecto(jugador: IdPersonaje): IdPersonaje {
  const otros = IDS_PERSONAJES.filter((id) => id !== jugador)
  return otros[0] ?? jugador
}
