/**
 * Atajos de PRUEBAS (sólo en desarrollo; `page.tsx` no los lee en producción).
 *
 * Atajo 1: `/juego?prueba=<jugador>,<rival>[,<arena>[,<dificultad>]]`
 * salta directo a una pelea contra la CPU con esos dos, sin tutorial, sin VS y sin tocar nada.
 * Ej.: `/juego?prueba=nico_u,brian`, `/juego?prueba=lucas,stefano,parana,dificil`.
 *
 * Lo leen `page.tsx` (que sólo lo pasa fuera de producción) y la raíz del juego. Todo se valida
 * contra el catálogo VIVO: un id que todavía no existe (o mal escrito) no hace nada.
 */
import { IDS_ARENAS, arenaDeSucursal } from '../arenas'
import { IDS_PERSONAJES, PERSONAJES } from '../personajes'
import type { DatosEntradaJuego, Dificultad, IdArena, IdPersonaje } from '../tipos'
import { nombreSucursal } from './plantel'

export interface PeleaDePrueba {
  jugador: IdPersonaje
  rival: IdPersonaje
  arena: IdArena | null
  dificultad: Dificultad | null
}

const DIFICULTADES: readonly Dificultad[] = ['facil', 'normal', 'dificil']

export function leerPeleaDePrueba(valor: string | undefined): PeleaDePrueba | null {
  if (!valor) return null
  const [a, b, c, d] = valor
    .split(',')
    .map((s) => s.trim().toLowerCase())
  const ids = IDS_PERSONAJES as readonly string[]
  if (!a || !b || !ids.includes(a) || !ids.includes(b)) return null
  const arena = c && (IDS_ARENAS as readonly string[]).includes(c) ? (c as IdArena) : null
  const dificultad = d && (DIFICULTADES as readonly string[]).includes(d) ? (d as Dificultad) : null
  return { jugador: a as IdPersonaje, rival: b as IdPersonaje, arena, dificultad }
}

/**
 * Atajo 2: `/juego?qr=<idPersonaje del barbero>[,<nombre del cliente>]` simula el QR del kiosko
 * sin token ni fila: el barbero asignado es ese personaje, la sucursal (y la arena) la suya y el
 * saludo, el nombre. Sirve para ver «Tu barbero» y la sucursal del cliente sin tocar la base.
 * No hay turno (sin token no se consulta la fila). Con sucursal, el juego entra a la SALA real.
 */
export function leerQrDePrueba(valor: string | undefined): Omit<DatosEntradaJuego, 'token'> | null {
  if (!valor) return null
  const [crudoId, crudoNombre] = valor.split(',').map((s) => s.trim())
  const id = (crudoId ?? '').toLowerCase()
  if (!(IDS_PERSONAJES as readonly string[]).includes(id)) return null
  const ficha = PERSONAJES[id as IdPersonaje]
  const nombre = (crudoNombre ?? '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, '').slice(0, 20).trim()
  return {
    sucursal: { slug: ficha.sucursal, nombre: nombreSucursal(ficha.sucursal) },
    cliente: nombre ? { nombre } : null,
    arenaInicial: arenaDeSucursal(ficha.sucursal),
    barberoAsignado: ficha.staffId,
  }
}
