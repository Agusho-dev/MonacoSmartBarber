// El menú del dashboard en GRUPOS (pedido del dueño, 22/oct/2026: "Hay
// demasiadas secciones, podrías anidarlas? … anidarlas dentro de principales y
// que sean tabs de estas"). Eran 16 entradas en el menú lateral; ahora son
// cinco grupos y sus pestañas son las secciones de antes, con las MISMAS rutas,
// etiquetas, íconos y permisos. Tex salió del menú: es un botón flotante.
//
// Módulo PURO, sin React ni 'use client': lo usan el shell, la barra inferior
// del celular, las pestañas del encabezado y las pruebas de node. Los íconos van
// como clave (el componente de lucide lo pone quien dibuja, en iconos-nav.ts).
//
// Las URLs no cambiaron: los enlaces de Tex, los revalidatePath, los favoritos y
// los guards de cada página dependen de ellas. Las pestañas navegan por ruta.

import { NAV_FEATURE_MAP } from '@/lib/billing/nav-feature-map'

export type ClaveIcono =
  | 'Store'
  | 'Users'
  | 'Scissors'
  | 'DollarSign'
  | 'Settings'
  | 'ListOrdered'
  | 'CalendarClock'
  | 'BarChart3'
  | 'MessageSquare'
  | 'Smartphone'
  | 'Gift'
  | 'Handshake'
  | 'IdCard'
  | 'Receipt'
  | 'ScanLine'
  | 'Scale'
  | 'FileCheck2'
  | 'Building2'
  | 'Sparkles'

export type GrupoId = 'operacion' | 'clientes' | 'equipo' | 'finanzas' | 'configuracion'

export interface PestanaNav {
  readonly href: string
  readonly etiqueta: string
  readonly icono: ClaveIcono
  /** Alcanza con tener UNO, como en el menú de antes. */
  readonly permisos: readonly string[]
}

export interface GrupoNav {
  readonly id: GrupoId
  readonly etiqueta: string
  /**
   * La de la barra inferior del celular: cinco etiquetas de 10,5 px tienen que
   * entrar enteras en 360 px (≈66 px por ranura: la cápsula flotante deja 12 px
   * a cada lado y 4 adentro). "Configuración" mide 72 px.
   */
  readonly etiquetaCorta: string
  readonly icono: ClaveIcono
  readonly pestanas: readonly PestanaNav[]
}

export const GRUPOS_NAV: readonly GrupoNav[] = [
  {
    id: 'operacion',
    etiqueta: 'Operación',
    etiquetaCorta: 'Operación',
    icono: 'Store',
    pestanas: [
      { href: '/dashboard/fila', etiqueta: 'Fila', icono: 'ListOrdered', permisos: ['queue.view'] },
      { href: '/dashboard/turnos', etiqueta: 'Turnos', icono: 'CalendarClock', permisos: ['appointments.view'] },
      { href: '/dashboard/estadisticas', etiqueta: 'Estadísticas', icono: 'BarChart3', permisos: ['stats.view'] },
    ],
  },
  {
    id: 'clientes',
    etiqueta: 'Clientes',
    etiquetaCorta: 'Clientes',
    icono: 'Users',
    pestanas: [
      { href: '/dashboard/clientes', etiqueta: 'Clientes', icono: 'Users', permisos: ['clients.view'] },
      { href: '/dashboard/mensajeria', etiqueta: 'Mensajería', icono: 'MessageSquare', permisos: ['clients.view'] },
      { href: '/dashboard/app-movil', etiqueta: 'APP Móvil', icono: 'Smartphone', permisos: ['rewards.view'] },
      { href: '/dashboard/fidelizacion', etiqueta: 'Fidelización', icono: 'Gift', permisos: ['rewards.view'] },
      { href: '/dashboard/convenios', etiqueta: 'Convenios', icono: 'Handshake', permisos: ['agreements.view'] },
    ],
  },
  {
    id: 'equipo',
    etiqueta: 'Equipo',
    etiquetaCorta: 'Equipo',
    icono: 'Scissors',
    pestanas: [
      {
        href: '/dashboard/equipo',
        etiqueta: 'Equipo',
        icono: 'Scissors',
        permisos: ['staff.view', 'roles.manage', 'breaks.view', 'incentives.view', 'discipline.view'],
      },
      { href: '/dashboard/rrhh', etiqueta: 'Recursos humanos', icono: 'IdCard', permisos: ['rrhh.view'] },
    ],
  },
  {
    id: 'finanzas',
    etiqueta: 'Finanzas',
    etiquetaCorta: 'Finanzas',
    icono: 'DollarSign',
    pestanas: [
      { href: '/dashboard/finanzas', etiqueta: 'Finanzas', icono: 'DollarSign', permisos: ['finances.view', 'salary.view'] },
      { href: '/dashboard/caja', etiqueta: 'Caja', icono: 'Receipt', permisos: ['caja.view'] },
      { href: '/dashboard/comprobantes', etiqueta: 'Comprobantes', icono: 'ScanLine', permisos: ['comprobantes.view'] },
      { href: '/dashboard/conciliacion', etiqueta: 'Conciliación', icono: 'Scale', permisos: ['conciliacion.view'] },
      // "Facturación ARCA" y no "Facturación" a secas: el menú del avatar ya usa
      // esa palabra para /dashboard/billing, que es la suscripción del SaaS.
      { href: '/dashboard/facturacion', etiqueta: 'Facturación ARCA', icono: 'FileCheck2', permisos: ['arca.view'] },
    ],
  },
  {
    id: 'configuracion',
    etiqueta: 'Configuración',
    etiquetaCorta: 'Ajustes',
    icono: 'Settings',
    pestanas: [
      { href: '/dashboard/configuracion', etiqueta: 'Configuración', icono: 'Settings', permisos: ['settings.view'] },
      { href: '/dashboard/sucursales', etiqueta: 'Sucursales', icono: 'Building2', permisos: ['branches.view'] },
      { href: '/dashboard/servicios', etiqueta: 'Servicios y Productos', icono: 'Sparkles', permisos: ['services.view'] },
    ],
  },
]

/**
 * Pantallas que no son pestañas pero pertenecen a un grupo: marcan activos el
 * grupo y la pestaña de la derecha. Son rutas viejas o internas que siguen
 * vivas (las sub-secciones de Equipo, Sueldos y Cuentas dentro de Finanzas…).
 */
export const ALIAS_DE_RUTA: Readonly<Record<string, string>> = {
  '/dashboard/barberos': '/dashboard/equipo',
  '/dashboard/calendario': '/dashboard/equipo',
  '/dashboard/descansos': '/dashboard/equipo',
  '/dashboard/disciplina': '/dashboard/equipo',
  '/dashboard/incentivos': '/dashboard/equipo',
  '/dashboard/sueldos': '/dashboard/finanzas',
  '/dashboard/cuentas': '/dashboard/finanzas',
  '/dashboard/productos': '/dashboard/servicios',
  '/dashboard/notificaciones': '/dashboard/app-movil',
  '/dashboard/configuracion/turnos': '/dashboard/configuracion',
}

/**
 * Pantallas fuera de los grupos que en el celular conservan su título de
 * siempre (antes salía del ítem del menú). Las demás (Mi cuenta, la
 * suscripción) muestran el nombre de la organización, como antes.
 */
const TITULOS_FUERA_DE_GRUPO: Readonly<Record<string, string>> = {
  '/dashboard/asistente': 'Tex',
}

/** ¿La ruta es `href` o está debajo? Por segmento: /dashboard/fila no es /dashboard/filas. */
export function coincideRuta(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === href || pathname.startsWith(href + '/')
}

// ── Ubicación activa ──────────────────────────────────────────────────────

export interface UbicacionNav {
  readonly grupo: GrupoNav
  readonly pestana: PestanaNav
}

const UBICACION_POR_HREF: ReadonlyMap<string, UbicacionNav> = new Map(
  GRUPOS_NAV.flatMap((grupo) => grupo.pestanas.map((pestana) => [pestana.href, { grupo, pestana }] as const)),
)

/** Cada ruta que marca una pestaña (las pestañas y sus alias) → la pestaña. */
const RUTAS_QUE_MARCAN: ReadonlyArray<readonly [string, UbicacionNav]> = [
  ...UBICACION_POR_HREF.entries(),
  // Un alias hacia una pestaña que no existe no marca nada (las pruebas lo atajan).
  ...Object.entries(ALIAS_DE_RUTA).flatMap(([alias, destino]) => {
    const u = UBICACION_POR_HREF.get(destino)
    return u ? [[alias, u] as const] : []
  }),
]
  // La más larga primero: /dashboard/configuracion/turnos antes que /dashboard/configuracion.
  .sort((a, b) => b[0].length - a[0].length)

/** El grupo y la pestaña de una ruta (con alias), o null si no es de ningún grupo. */
export function ubicacionDeRuta(pathname: string | null | undefined): UbicacionNav | null {
  for (const [ruta, ubicacion] of RUTAS_QUE_MARCAN) {
    if (coincideRuta(ruta, pathname)) return ubicacion
  }
  return null
}

/** Título del celular para una pantalla fuera de los grupos; null = el nombre de la organización. */
export function tituloFueraDeGrupo(pathname: string | null | undefined): string | null {
  for (const [ruta, titulo] of Object.entries(TITULOS_FUERA_DE_GRUPO)) {
    if (coincideRuta(ruta, pathname)) return titulo
  }
  return null
}

// ── Plan y permisos ───────────────────────────────────────────────────────

export type EstadoBloqueo = 'unlocked' | 'upgrade' | 'coming_soon'

export interface BloqueoPestana {
  readonly estado: EstadoBloqueo
  readonly minPlan?: 'start' | 'pro' | 'enterprise'
  readonly moduleId?: string | null
  readonly moduleName?: string
  readonly moduleTeaser?: string | null
  readonly estimatedRelease?: string | null
}

export interface ModuloVisible {
  readonly moduleId: string
  readonly name: string
  readonly teaser: string | null
  readonly estimatedRelease: string | null
  readonly status: 'active' | 'beta' | 'coming_soon'
}

export interface ContextoPlan {
  /** Features del plan; null = la org no tiene suscripción (instalación vieja): todo desbloqueado. */
  readonly features: Readonly<Record<string, boolean>> | null
  readonly modulos?: readonly ModuloVisible[]
}

/**
 * El mismo cálculo que hacía el menú de antes: sin suscripción, todo
 * desbloqueado; un módulo "coming_soon" se ve con "Pronto"; un feature que el
 * plan no incluye queda en 'upgrade' (y no se muestra).
 */
export function bloqueoDePestana(href: string, plan: ContextoPlan): BloqueoPestana {
  if (!plan.features) return { estado: 'unlocked' }
  const meta = NAV_FEATURE_MAP[href]
  if (!meta || !meta.featureKey) return { estado: 'unlocked' }
  const modulo = meta.moduleId ? plan.modulos?.find((m) => m.moduleId === meta.moduleId) : undefined
  if (modulo?.status === 'coming_soon') {
    return {
      estado: 'coming_soon',
      moduleId: meta.moduleId ?? null,
      moduleName: modulo.name,
      moduleTeaser: modulo.teaser,
      estimatedRelease: modulo.estimatedRelease,
    }
  }
  if (plan.features[meta.featureKey] === true) return { estado: 'unlocked' }
  return { estado: 'upgrade', minPlan: meta.minPlan ?? 'pro', moduleId: meta.moduleId ?? null }
}

export interface PestanaVisible extends PestanaNav {
  readonly grupoId: GrupoId
  readonly bloqueo: BloqueoPestana
}

export interface GrupoVisible extends Omit<GrupoNav, 'pestanas'> {
  readonly pestanas: readonly PestanaVisible[]
}

/** ¿Se puede navegar? (las "Pronto" se ven pero abren el aviso del módulo). */
export function estaDesbloqueada(p: PestanaVisible): boolean {
  return p.bloqueo.estado === 'unlocked'
}

/**
 * Los grupos que ve esta persona, en el orden por defecto, cada uno con sus
 * pestañas visibles. Una pestaña se ve con el mismo filtro que un ítem del menú
 * de antes (algún permiso + el plan no la deja en 'upgrade'); un grupo, si tiene
 * al menos una pestaña visible.
 */
export function gruposVisibles(permisos: Readonly<Record<string, boolean>>, plan: ContextoPlan): GrupoVisible[] {
  const salida: GrupoVisible[] = []
  for (const grupo of GRUPOS_NAV) {
    const pestanas: PestanaVisible[] = []
    for (const p of grupo.pestanas) {
      // Con la misma vara que el menú de antes (`permissions[p]`, por verdad).
      if (!p.permisos.some((k) => Boolean(permisos[k]))) continue
      const bloqueo = bloqueoDePestana(p.href, plan)
      if (bloqueo.estado === 'upgrade') continue
      pestanas.push({ ...p, grupoId: grupo.id, bloqueo })
    }
    if (pestanas.length > 0) salida.push({ ...grupo, pestanas })
  }
  return salida
}

// ── Orden de los grupos ("Personalizar orden") ────────────────────────────

export const ORDEN_POR_DEFECTO: readonly GrupoId[] = GRUPOS_NAV.map((g) => g.id)

const ES_GRUPO = new Set<string>(ORDEN_POR_DEFECTO)

/** Las claves de localStorage. Por nombre, como la del menú de antes. */
export function claveOrdenGrupos(usuario: string): string {
  return `nav-grupos-orden-${usuario}`
}
/** La del menú de antes: un array de hrefs. Se lee para no perder un orden ya elegido; no se escribe. */
export function claveOrdenVieja(usuario: string): string {
  return `nav-order-${usuario}`
}
export function claveUltimasPestanas(usuario: string): string {
  return `nav-grupos-ultima-${usuario}`
}

function parsearListaDeTextos(crudo: string | null | undefined): string[] | null {
  if (!crudo) return null
  try {
    const v: unknown = JSON.parse(crudo)
    if (!Array.isArray(v)) return null
    return v.filter((x): x is string => typeof x === 'string')
  } catch {
    return null
  }
}

/** El orden guardado con la clave nueva (ids de grupo); null si no hay o no sirve. */
export function parsearOrdenGrupos(crudo: string | null | undefined): GrupoId[] | null {
  const lista = parsearListaDeTextos(crudo)
  if (!lista) return null
  const vistos = new Set<string>()
  const ids: GrupoId[] = []
  for (const x of lista) {
    if (ES_GRUPO.has(x) && !vistos.has(x)) {
      vistos.add(x)
      ids.push(x as GrupoId)
    }
  }
  return ids.length > 0 ? ids : null
}

/**
 * El orden de los grupos a partir del orden viejo de las 16 secciones: cada
 * grupo va donde estaba su primera pestaña (la primera del grupo que aparezca en
 * el orden viejo: el array viejo sólo guardaba las secciones que esa persona
 * veía). Un grupo sin ninguna pestaña en el orden viejo va al final.
 */
export function ordenDesdeClaveVieja(crudo: string | null | undefined): GrupoId[] | null {
  const hrefs = parsearListaDeTextos(crudo)
  if (!hrefs || hrefs.length === 0) return null
  const rangos = GRUPOS_NAV.map((g, i) => {
    let rango = Number.POSITIVE_INFINITY
    for (const p of g.pestanas) {
      const pos = hrefs.indexOf(p.href)
      if (pos >= 0) {
        rango = pos
        break
      }
    }
    return { id: g.id, rango, i }
  })
  if (rangos.every((r) => r.rango === Number.POSITIVE_INFINITY)) return null
  return rangos.sort((a, b) => a.rango - b.rango || a.i - b.i).map((r) => r.id)
}

/** El orden a usar: la clave nueva si sirve; si no, el derivado de la vieja; si no, null (por defecto). */
export function resolverOrdenGuardado(crudoNuevo: string | null | undefined, crudoViejo: string | null | undefined): GrupoId[] | null {
  return parsearOrdenGrupos(crudoNuevo) ?? ordenDesdeClaveVieja(crudoViejo)
}

/** Ordena según `orden`; lo que no figura va al final, en el orden por defecto. */
export function ordenarGrupos<T extends { readonly id: GrupoId }>(grupos: readonly T[], orden: readonly GrupoId[] | null): T[] {
  const pos = (id: GrupoId) => {
    const i = orden ? orden.indexOf(id) : -1
    return i >= 0 ? i : orden ? orden.length + ORDEN_POR_DEFECTO.indexOf(id) : ORDEN_POR_DEFECTO.indexOf(id)
  }
  return [...grupos].sort((a, b) => pos(a.id) - pos(b.id))
}

/**
 * El orden completo después de arrastrar `desde` hasta donde estaba `hasta`
 * (entre los grupos que se ven). Los que esta persona no ve quedan al final,
 * en su orden: no se pierden si mañana le dan el permiso.
 */
export function moverGrupo(visiblesEnOrden: readonly GrupoId[], ordenGuardado: readonly GrupoId[] | null, desde: GrupoId, hasta: GrupoId): GrupoId[] {
  const lista = [...visiblesEnOrden]
  const i = lista.indexOf(desde)
  const j = lista.indexOf(hasta)
  if (i >= 0 && j >= 0 && i !== j) {
    lista.splice(i, 1)
    lista.splice(j, 0, desde)
  }
  const resto = ordenarGrupos(
    ORDEN_POR_DEFECTO.filter((id) => !lista.includes(id)).map((id) => ({ id })),
    ordenGuardado,
  ).map((g) => g.id)
  return [...lista, ...resto]
}

// ── Navegar por grupos ────────────────────────────────────────────────────

export type UltimasPestanas = Readonly<Partial<Record<GrupoId, string>>>

/** La última pestaña usada de cada grupo (lo que se guarda en localStorage). */
export function parsearUltimas(crudo: string | null | undefined): UltimasPestanas {
  if (!crudo) return {}
  try {
    const v: unknown = JSON.parse(crudo)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const salida: Partial<Record<GrupoId, string>> = {}
    for (const [k, href] of Object.entries(v as Record<string, unknown>)) {
      if (ES_GRUPO.has(k) && typeof href === 'string' && UBICACION_POR_HREF.get(href)?.grupo.id === k) {
        salida[k as GrupoId] = href
      }
    }
    return salida
  } catch {
    return {}
  }
}

/** Las mismas últimas con `href` como la de su grupo (el mismo objeto si no cambió nada). */
export function recordarUltima(ultimas: UltimasPestanas, href: string): UltimasPestanas {
  const u = UBICACION_POR_HREF.get(href)
  if (!u || ultimas[u.grupo.id] === href) return ultimas
  return { ...ultimas, [u.grupo.id]: href }
}

/**
 * Adónde lleva tocar un grupo: la última pestaña que se usó, si sigue visible y
 * desbloqueada; si no, la primera desbloqueada; si todas son "Pronto", la
 * primera (y quien dibuja abre el aviso en vez de navegar).
 */
export function destinoDeGrupo(grupo: GrupoVisible, ultimaHref: string | null | undefined): PestanaVisible | null {
  const desbloqueadas = grupo.pestanas.filter(estaDesbloqueada)
  const ultima = ultimaHref ? desbloqueadas.find((p) => p.href === ultimaHref) : undefined
  return ultima ?? desbloqueadas[0] ?? grupo.pestanas[0] ?? null
}

export interface PasoDeslizar {
  readonly grupo: GrupoVisible
  readonly pestana: PestanaVisible
}

/**
 * Lo que recorre el gesto de deslizar en el celular: las pestañas visibles y
 * desbloqueadas, grupo por grupo, en el orden de los grupos.
 */
export function secuenciaDeslizar(gruposEnOrden: readonly GrupoVisible[]): PasoDeslizar[] {
  return gruposEnOrden.flatMap((grupo) => grupo.pestanas.filter(estaDesbloqueada).map((pestana) => ({ grupo, pestana })))
}
