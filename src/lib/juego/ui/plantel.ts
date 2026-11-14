/**
 * El plantel de «Corte Final» visto desde la UI: quién es «tu barbero», qué luchador y qué rival
 * salen por defecto, el orden de la grilla y el filtro por sucursal. Puro (sin React ni DOM): lo
 * usan la raíz, la selección y la elección online, y todo sale del catálogo VIVO (personajes.ts):
 * un barbero nuevo aparece solo, sin listas a mano.
 *
 * Los personajes de los dueños (`soloDuenos`) no son parte del plantel de los clientes: la grilla,
 * el filtro y los «por defecto» son de los barberos (`IDS_PARA_CLIENTES`). Con el pase de dueños
 * (ui/pase-duenos.ts) aparecen aparte, en su grupo (`IDS_SOLO_DUENOS`), y pueden ser el último
 * elegido o el barbero del QR; nunca un «por defecto» que salga de la sucursal o del catálogo.
 */
import { ARENAS, IDS_ARENAS } from '../arenas'
import { IDS_PARA_CLIENTES, IDS_PERSONAJES, PERSONAJES, PROXIMAMENTE, esSoloDuenos } from '../personajes'
import type { FichaProximamente, IdPersonaje } from '../tipos'

/**
 * El personaje del barbero que atiende al cliente (staff.id del QR), si es luchador y este celular
 * lo puede ver: el de un dueño, sólo con el pase (sin él, el rival por defecto sale de su sucursal).
 */
export function personajeDelBarbero(staffId: string | null | undefined, conPase = false): IdPersonaje | null {
  if (!staffId) return null
  const id = IDS_PERSONAJES.find((p) => PERSONAJES[p].staffId === staffId) ?? null
  if (!id || (esSoloDuenos(id) && !conPase)) return null
  return id
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

/** Las sucursales que tienen barberos, en el orden del catálogo (para el filtro; sin los dueños). */
export function sucursalesDelPlantel(): SucursalPlantel[] {
  const lista: SucursalPlantel[] = []
  for (const id of IDS_PARA_CLIENTES) {
    const slug = PERSONAJES[id].sucursal
    const ya = lista.find((s) => s.slug === slug)
    if (ya) ya.cuantos += 1
    else lista.push({ slug, nombre: nombreSucursal(slug), cuantos: 1 })
  }
  return lista
}

/**
 * El orden de la grilla de los barberos: el del catálogo (agrupado por sucursal), con la sucursal
 * del cliente primero. Con `filtro`, sólo los de esa sucursal. Los dueños van aparte.
 */
export function plantelOrdenado(sucursalCliente: string | null, filtro: string | null = null): IdPersonaje[] {
  const base = filtro ? IDS_PARA_CLIENTES.filter((id) => PERSONAJES[id].sucursal === filtro) : [...IDS_PARA_CLIENTES]
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

/** Un barbero de esa sucursal (nunca un dueño) que no sea `menos`. */
function primeroDe(sucursal: string | null | undefined, menos: IdPersonaje | null): IdPersonaje | null {
  if (!sucursal) return null
  return IDS_PARA_CLIENTES.find((id) => id !== menos && PERSONAJES[id].sucursal === sucursal) ?? null
}

interface Contexto {
  /** El personaje del barbero que lo atiende (QR), si es luchador y este celular lo ve. */
  barbero: IdPersonaje | null
  /** La sucursal del cliente (QR o ?s=). */
  sucursal: string | null
  /** Con el pase de dueños (ui/pase-duenos.ts): el último elegido puede ser un dueño. */
  conPase?: boolean
}

/** ¿Este celular puede elegir a ese personaje? (los dueños, sólo con el pase). */
function visible(id: IdPersonaje | null | undefined, conPase: boolean): id is IdPersonaje {
  return !!id && !!PERSONAJES[id] && (conPase || !esSoloDuenos(id))
}

/**
 * Con quién arranca el jugador: el último que eligió (salvo que sea su barbero, que va de rival, o
 * un dueño sin el pase); si no, un barbero de su sucursal; si no, el primero del catálogo.
 */
export function jugadorSugerido(ultimo: IdPersonaje | null, { barbero, sucursal, conPase = false }: Contexto): IdPersonaje {
  if (visible(ultimo, conPase) && ultimo !== barbero) return ultimo
  return (
    primeroDe(sucursal, barbero) ??
    primeroDe(barbero ? PERSONAJES[barbero].sucursal : null, barbero) ??
    IDS_PARA_CLIENTES.find((id) => id !== barbero) ??
    IDS_PARA_CLIENTES[0]
  )
}

/**
 * El rival por defecto: el barbero que lo atiende; si no tiene (o lo eligió para pelear, o es un
 * dueño y el celular no tiene el pase), un barbero de su sucursal; si no, uno de la sucursal del
 * luchador elegido; si no, el primero que no sea él. Nunca un dueño que no sea su barbero.
 */
export function rivalSugerido(jugador: IdPersonaje, { barbero, sucursal }: Contexto): IdPersonaje {
  if (barbero && barbero !== jugador) return barbero
  return (
    primeroDe(sucursal, jugador) ??
    primeroDe(PERSONAJES[jugador]?.sucursal, jugador) ??
    IDS_PARA_CLIENTES.find((id) => id !== jugador) ??
    jugador
  )
}

/**
 * El personaje con el que arranca la elección online (el que va si se acaba el tiempo): el último
 * elegido si este celular lo puede elegir; si no, `porDefecto` (el jugador de la selección).
 */
export function personajeInicialOnline(ultimo: IdPersonaje | null, porDefecto: IdPersonaje, conPase: boolean): IdPersonaje {
  return visible(ultimo, conPase) ? ultimo : porDefecto
}
