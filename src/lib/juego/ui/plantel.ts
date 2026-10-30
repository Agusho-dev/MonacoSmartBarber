/**
 * El plantel de «Corte Final» visto desde la UI: quién es «tu barbero», qué luchador y qué rival
 * salen por defecto, el orden de la grilla y el filtro por sucursal. Puro (sin React ni DOM): lo
 * usan la raíz, la selección y la elección online, y todo sale del catálogo VIVO (personajes.ts):
 * un barbero nuevo aparece solo, sin listas a mano.
 */
import { ARENAS, IDS_ARENAS } from '../arenas'
import { IDS_PERSONAJES, PERSONAJES, PROXIMAMENTE } from '../personajes'
import type { FichaProximamente, IdPersonaje } from '../tipos'

/** El personaje del barbero que atiende al cliente (staff.id del QR), si es luchador. */
export function personajeDelBarbero(staffId: string | null | undefined): IdPersonaje | null {
  if (!staffId) return null
  return IDS_PERSONAJES.find((id) => PERSONAJES[id].staffId === staffId) ?? null
}

/** «parana» → «Paraná» (el nombre bien escrito de la arena); si no hay arena, con mayúscula. */
export function nombreSucursal(slug: string): string {
  const arena = IDS_ARENAS.find((id) => ARENAS[id].sucursalSlug === slug)
  if (arena) return ARENAS[arena].nombre
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : ''
}

export interface SucursalPlantel {
  slug: string
  nombre: string
  /** Luchadores jugables de esa sucursal. */
  cuantos: number
}

/** Las sucursales que tienen luchadores, en el orden del catálogo (para el filtro). */
export function sucursalesDelPlantel(): SucursalPlantel[] {
  const lista: SucursalPlantel[] = []
  for (const id of IDS_PERSONAJES) {
    const slug = PERSONAJES[id].sucursal
    const ya = lista.find((s) => s.slug === slug)
    if (ya) ya.cuantos += 1
    else lista.push({ slug, nombre: nombreSucursal(slug), cuantos: 1 })
  }
  return lista
}

/**
 * El orden de la grilla: el del catálogo (agrupado por sucursal), con la sucursal del cliente
 * primero. Con `filtro`, sólo los de esa sucursal.
 */
export function plantelOrdenado(sucursalCliente: string | null, filtro: string | null = null): IdPersonaje[] {
  const base = filtro ? IDS_PERSONAJES.filter((id) => PERSONAJES[id].sucursal === filtro) : [...IDS_PERSONAJES]
  if (!sucursalCliente || filtro) return base
  const propios = base.filter((id) => PERSONAJES[id].sucursal === sucursalCliente)
  return propios.length > 0 ? [...propios, ...base.filter((id) => PERSONAJES[id].sucursal !== sucursalCliente)] : base
}

/** Los que todavía no tienen personaje (con el mismo filtro y orden que la grilla). */
export function proximamenteOrdenado(sucursalCliente: string | null, filtro: string | null = null): FichaProximamente[] {
  const base = filtro ? PROXIMAMENTE.filter((p) => p.sucursal === filtro) : [...PROXIMAMENTE]
  if (!sucursalCliente || filtro) return base
  return [...base.filter((p) => p.sucursal === sucursalCliente), ...base.filter((p) => p.sucursal !== sucursalCliente)]
}

function primeroDe(sucursal: string | null | undefined, menos: IdPersonaje | null): IdPersonaje | null {
  if (!sucursal) return null
  return IDS_PERSONAJES.find((id) => id !== menos && PERSONAJES[id].sucursal === sucursal) ?? null
}

interface Contexto {
  /** El personaje del barbero que lo atiende (QR), si es luchador. */
  barbero: IdPersonaje | null
  /** La sucursal del cliente (QR o ?s=). */
  sucursal: string | null
}

/**
 * Con quién arranca el jugador: el último que eligió (salvo que sea su barbero, que va de
 * rival); si no, uno de su sucursal; si no, el primero del catálogo.
 */
export function jugadorSugerido(ultimo: IdPersonaje | null, { barbero, sucursal }: Contexto): IdPersonaje {
  if (ultimo && PERSONAJES[ultimo] && ultimo !== barbero) return ultimo
  return (
    primeroDe(sucursal, barbero) ??
    primeroDe(barbero ? PERSONAJES[barbero].sucursal : null, barbero) ??
    IDS_PERSONAJES.find((id) => id !== barbero) ??
    IDS_PERSONAJES[0]
  )
}

/**
 * El rival por defecto: el barbero que lo atiende; si no tiene (o lo eligió para pelear), uno
 * de su sucursal; si no, uno de la sucursal del luchador elegido; si no, el primero que no sea él.
 */
export function rivalSugerido(jugador: IdPersonaje, { barbero, sucursal }: Contexto): IdPersonaje {
  if (barbero && barbero !== jugador) return barbero
  return (
    primeroDe(sucursal, jugador) ??
    primeroDe(PERSONAJES[jugador]?.sucursal, jugador) ??
    IDS_PERSONAJES.find((id) => id !== jugador) ??
    jugador
  )
}
