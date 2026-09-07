'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentOrgId } from './org'
import { getAllowedBranchIds, getScopedBranchIds } from './branch-access'
import { currentUserCan } from './permissions-gate'

/**
 * Directorio de clientes — única fuente de verdad de la pantalla /dashboard/clientes.
 *
 * Todo (búsqueda, segmentación, orden, paginación y métricas) se resuelve en la RPC
 * `search_clients_page` (migración 167). Antes esto se hacía trayendo los 5.537
 * clientes + las visitas de 90 días al browser, lo que además de lento producía
 * números distintos según la pantalla.
 */

export type ClientSegment =
  | 'vip'
  | 'activo'
  | 'nuevo'
  | 'en_riesgo'
  | 'probo_no_volvio'
  | 'perdido'
  | 'sin_visitas'

// No se exporta: en un módulo 'use server' sólo pueden exportarse funciones async.
const CLIENT_SEGMENTS: ClientSegment[] = [
  'vip',
  'activo',
  'nuevo',
  'en_riesgo',
  'probo_no_volvio',
  'perdido',
  'sin_visitas',
]

/**
 * Origen del alta (`clients.signup_source`, mig 210). Es NULL para los 6.419
 * clientes anteriores a la migración: inventarles un origen sería peor que no
 * tenerlo, así que en la UI se muestran como "Sin dato".
 */
export type SignupSource = 'kiosk' | 'app' | 'web' | 'staff' | 'import'

/** Lo que se puede elegir en el filtro: los orígenes reales + los que no declaran uno. */
export type SignupFilter = SignupSource | 'desconocido'

const SIGNUP_SOURCES: SignupSource[] = ['kiosk', 'app', 'web', 'staff', 'import']
const SIGNUP_FILTERS: SignupFilter[] = [...SIGNUP_SOURCES, 'desconocido']

/**
 * Tope de filas que escanea el filtro por origen.
 *
 * `search_clients_page` (mig 167) NO devuelve `signup_source` y acá no se aplican
 * migraciones, así que el filtro se resuelve del lado del server action: se pide
 * una ventana grande de la RPC —con el MISMO orden y los mismos filtros— y se
 * cruza contra el conjunto de ids de cada origen. Es el mismo tope que ya usa la
 * exportación, y cuando se toca se avisa (`signupTruncated`) en vez de recortar
 * en silencio.
 */
const ORIGEN_SCAN_CAP = 5000

/**
 * Tope de ids con origen declarado que se traen para resolver el filtro.
 * Hoy son 0 filas (la columna nace vacía) y crece sólo con las altas nuevas.
 */
const ORIGEN_IDS_CAP = 20000

/** PostgREST corta en 1000 filas sin avisar: toda lista larga se pagina. */
const PAGINA_REST = 1000

export type ClientSortKey =
  | 'relevance'
  | 'name'
  | 'visits'
  | 'spent'
  | 'ticket'
  | 'last_visit'
  | 'created'

const SORT_KEYS: ClientSortKey[] = [
  'relevance',
  'name',
  'visits',
  'spent',
  'ticket',
  'last_visit',
  'created',
]

/** VIP = clientes con al menos estas visitas y actividad reciente. */
const VIP_VISITS = 6

/**
 * Defaults alineados con `/dashboard/estadisticas` (`stats.ts`), que lee los mismos
 * campos de `app_settings`. Que las dos pantallas usen el mismo umbral es parte de
 * arreglar la incoherencia de datos: antes había TRES reglas de segmento distintas.
 */
const DEFAULT_RISK_DAYS = 25
const DEFAULT_LOST_DAYS = 40

export interface SegmentThresholds {
  riskDays: number
  lostDays: number
  vipVisits: number
}

export interface DirectoryClient {
  id: string
  name: string
  phone: string
  instagram: string | null
  notes: string | null
  createdAt: string
  /** Walk-in registrado sin teléfono real (la fila les asigna uno virtual). */
  isWalkin: boolean
  /** Visitas dentro del scope elegido (sucursal seleccionada o toda la org). */
  visitCount: number
  lastVisitAt: string | null
  firstVisitAt: string | null
  totalSpent: number
  avgTicket: number | null
  /** Cada cuántos días vuelve, con 3+ visitas. */
  cadenceDays: number | null
  /** Visitas en TODA la organización — se muestra al filtrar por sucursal. */
  globalVisitCount: number
  branchCount: number
  segment: ClientSegment
  topBarberId: string | null
  topBarberName: string | null
  topBranchName: string | null
  /** Cómo entró a la base. NULL = alta anterior a la mig 210 (o camino sin cubrir). */
  signupSource: SignupSource | null
}

export interface SegmentCount {
  segment: ClientSegment
  count: number
  totalSpent: number
}

export interface ClientsDirectoryQuery {
  branchId?: string | null
  search?: string
  segments?: ClientSegment[]
  onlyWithVisits?: boolean
  hideWalkins?: boolean
  /** Orígenes de alta a mostrar. Vacío = todos (no filtra nada). */
  signupSources?: SignupFilter[]
  sort?: ClientSortKey
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface ClientsDirectoryResult {
  clients: DirectoryClient[]
  /** Total que matchea los filtros actuales (para la paginación). */
  total: number
  /** Conteo por segmento con los mismos filtros, menos el de segmento. */
  counts: SegmentCount[]
  /**
   * Tamaño real de la base, SIN búsqueda ni toggles: es el denominador honesto
   * ("312 resultados en los 5.541 clientes"). Usar la suma de `counts` acá estaría
   * mal, porque esa suma ya viene filtrada por la búsqueda.
   */
  baseTotal: number
  /** De `baseTotal`, cuántos tienen al menos una visita en el scope elegido. */
  baseWithVisits: number
  thresholds: SegmentThresholds
  page: number
  pageSize: number
  /**
   * Nunca devolvemos una lista vacía en silencio ante un fallo: un tablero que
   * muestra 0 clientes cuando en realidad no pudo leer es indistinguible de una
   * base vacía (Known Risk #15).
   */
  error: string | null
  /**
   * Los conteos son secundarios (si fallan, la lista igual sirve), pero la UI tiene
   * que poder mostrar "—" en vez de un 0 inventado.
   */
  countsError: string | null
  /**
   * El filtro por origen tocó el tope de escaneo: lo que se muestra es un recorte
   * del universo, no el universo. Se avisa; un recorte silencioso es un dato falso.
   */
  signupTruncated: boolean
}

const EMPTY_RESULT = (page: number, pageSize: number, error: string): ClientsDirectoryResult => ({
  clients: [],
  total: 0,
  counts: [],
  baseTotal: 0,
  baseWithVisits: 0,
  thresholds: { riskDays: DEFAULT_RISK_DAYS, lostDays: DEFAULT_LOST_DAYS, vipVisits: VIP_VISITS },
  page,
  pageSize,
  error,
  countsError: error,
  signupTruncated: false,
})

interface RawRow {
  id: string
  name: string
  phone: string | null
  instagram: string | null
  notes: string | null
  created_at: string
  is_walkin: boolean
  visit_count: number
  last_visit_at: string | null
  first_visit_at: string | null
  total_spent: string | number
  avg_ticket: string | number | null
  cadence_days: number | null
  global_visit_count: number
  branch_count: number
  segment: string
  top_barber_id: string | null
  top_barber_name: string | null
  top_branch_name: string | null
  total_rows: number
}

function num(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function mapRow(r: RawRow, origen: SignupSource | null = null): DirectoryClient {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    instagram: r.instagram,
    notes: r.notes,
    createdAt: r.created_at,
    isWalkin: r.is_walkin,
    visitCount: r.visit_count ?? 0,
    lastVisitAt: r.last_visit_at,
    firstVisitAt: r.first_visit_at,
    totalSpent: num(r.total_spent),
    avgTicket: r.avg_ticket == null ? null : num(r.avg_ticket),
    cadenceDays: r.cadence_days,
    globalVisitCount: r.global_visit_count ?? 0,
    branchCount: r.branch_count ?? 0,
    segment: (CLIENT_SEGMENTS as string[]).includes(r.segment)
      ? (r.segment as ClientSegment)
      : 'sin_visitas',
    topBarberId: r.top_barber_id,
    topBarberName: r.top_barber_name,
    topBranchName: r.top_branch_name,
    signupSource: origen,
  }
}

/**
 * Resuelve el scope de sucursales del pedido.
 * - `branchId` explícito: se valida contra el scope real del usuario. Si no lo tiene
 *   permitido devolvemos null (denegado), no un fallback silencioso a "todas".
 * - Sin `branchId`: null = métricas de toda la organización.
 *
 * Ojo: un usuario con scope restringido por rol (`role_branch_scope`) tiene que ver
 * métricas de SUS sucursales, no de la org entera, así que ahí sí pasamos el array.
 */
async function resolveBranchScope(
  branchId: string | null | undefined
): Promise<{ ok: true; branchIds: string[] | null } | { ok: false }> {
  if (branchId) {
    const scoped = await getScopedBranchIds()
    if (!scoped.includes(branchId)) return { ok: false }
    return { ok: true, branchIds: [branchId] }
  }

  // Sin sucursal elegida: "todas". Para owner/admin (`getAllowedBranchIds() === null`)
  // pasamos null y la RPC agrega la organización entera — más barato que enumerar, y
  // además cuenta las visitas de sucursales dadas de baja, que igual son plata que
  // el cliente gastó. Un usuario con scope de rol restringido ve las métricas de SUS
  // sucursales, no las de la org.
  const allowed = await getAllowedBranchIds()
  if (allowed === null) return { ok: true, branchIds: null }
  if (allowed.length === 0) return { ok: false }
  const scoped = await getScopedBranchIds()
  // Falla CERRADO: `p_branch_ids = null` significa "toda la organización" para la RPC,
  // y `getScopedBranchIds()` devuelve [] tanto cuando el usuario no tiene sucursales
  // como cuando la query a `branches` falló. Mandar null acá le mostraría a un
  // encargado restringido la facturación de toda la cadena.
  if (scoped.length === 0) return { ok: false }
  return { ok: true, branchIds: scoped }
}

async function getThresholds(orgId: string): Promise<SegmentThresholds> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('at_risk_client_days, lost_client_days')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) {
    console.error('[clients-directory] app_settings:', error.message)
  }

  return {
    riskDays: data?.at_risk_client_days ?? DEFAULT_RISK_DAYS,
    lostDays: data?.lost_client_days ?? DEFAULT_LOST_DAYS,
    vipVisits: VIP_VISITS,
  }
}

/**
 * Origen de alta de un puñado de ids (los de la página visible).
 *
 * Por qué una segunda consulta y no un cambio en la RPC: `search_clients_page`
 * es de la migración 167 y acá no se aplican migraciones. Redefinirla desde el
 * código sería peor (dos cuerpos de la misma función, que es exactamente la
 * trampa de la mig 166: el repo decía una cosa y prod otra). La consulta va
 * acotada a los ≤200 ids de la página y por PK, así que cuesta milisegundos.
 *
 * Devuelve el error en vez de un mapa vacío: una etiqueta faltante tiene que
 * poder distinguirse de "no lo pudimos leer" (Known Risk #5).
 */
async function traerOrigenesDeIds(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  ids: string[]
): Promise<{ origenes: Map<string, SignupSource | null>; error: string | null }> {
  const origenes = new Map<string, SignupSource | null>()
  if (ids.length === 0) return { origenes, error: null }

  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, signup_source')
      .eq('organization_id', orgId)
      .in('id', ids.slice(i, i + 200))
    if (error) {
      console.error('[clients-directory] signup_source de la página:', error.message)
      return { origenes: new Map(), error: 'No pudimos leer el origen de las altas' }
    }
    for (const row of (data ?? []) as { id: string; signup_source: string | null }[]) {
      const src = row.signup_source
      origenes.set(row.id, SIGNUP_SOURCES.includes(src as SignupSource) ? (src as SignupSource) : null)
    }
  }
  return { origenes, error: null }
}

/**
 * Todos los clientes de la org que SÍ declaran origen, como mapa id → origen.
 *
 * El complemento ("sin dato") se deriva por ausencia: los 6.419 clientes previos
 * a la mig 210 no se traen nunca. Sólo se llama cuando el filtro por origen está
 * activo. Pagina de a 1000 porque PostgREST corta ahí sin avisar.
 */
async function traerOrigenesDeclarados(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<{ origenes: Map<string, SignupSource>; truncated: boolean; error: string | null }> {
  const origenes = new Map<string, SignupSource>()
  let desde = 0

  while (desde < ORIGEN_IDS_CAP) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, signup_source')
      .eq('organization_id', orgId)
      .not('signup_source', 'is', null)
      .order('id')
      .range(desde, desde + PAGINA_REST - 1)
    if (error) {
      console.error('[clients-directory] signup_source declarados:', error.message)
      return { origenes: new Map(), truncated: false, error: 'No pudimos leer los orígenes de alta' }
    }
    const filas = (data ?? []) as { id: string; signup_source: string | null }[]
    for (const row of filas) {
      if (SIGNUP_SOURCES.includes(row.signup_source as SignupSource)) {
        origenes.set(row.id, row.signup_source as SignupSource)
      }
    }
    if (filas.length < PAGINA_REST) return { origenes, truncated: false, error: null }
    desde += PAGINA_REST
  }

  return { origenes, truncated: true, error: null }
}

/** ¿Este cliente entra por el filtro de origen elegido? */
function pasaFiltroOrigen(origen: SignupSource | null, elegidos: SignupFilter[]): boolean {
  if (elegidos.length === 0) return true
  return origen === null
    ? elegidos.includes('desconocido')
    : elegidos.includes(origen)
}

export async function fetchClientsDirectory(
  query: ClientsDirectoryQuery
): Promise<ClientsDirectoryResult> {
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const pageSize = Math.min(200, Math.max(10, Math.floor(query.pageSize ?? 50)))

  if (!(await currentUserCan('clients.view'))) {
    return EMPTY_RESULT(page, pageSize, 'No tenés permiso para ver clientes')
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return EMPTY_RESULT(page, pageSize, 'Organización no encontrada')

  const scope = await resolveBranchScope(query.branchId)
  if (!scope.ok) return EMPTY_RESULT(page, pageSize, 'No autorizado para esta sucursal')

  const thresholds = await getThresholds(orgId)
  const supabase = createAdminClient()

  const search = (query.search ?? '').trim()
  const segments = (query.segments ?? []).filter((s) =>
    (CLIENT_SEGMENTS as string[]).includes(s)
  )
  const sort: ClientSortKey = SORT_KEYS.includes(query.sort as ClientSortKey)
    ? (query.sort as ClientSortKey)
    : search
      ? 'relevance'
      : 'name'
  const dir = query.dir === 'asc' ? 'asc' : 'desc'
  const onlyWithVisits = query.onlyWithVisits === true
  const hideWalkins = query.hideWalkins === true
  const origenes = (query.signupSources ?? []).filter((o) =>
    (SIGNUP_FILTERS as string[]).includes(o)
  )
  // Elegir los seis valores es no filtrar nada: se trata como "todos" para no
  // pagar el escaneo grande al pedo.
  const filtraPorOrigen = origenes.length > 0 && origenes.length < SIGNUP_FILTERS.length

  const listArgs = {
    p_organization_id: orgId,
    p_branch_ids: scope.branchIds,
    p_query: search || null,
    p_segments: segments.length > 0 ? segments : null,
    p_only_with_visits: onlyWithVisits,
    p_hide_walkins: hideWalkins,
    p_risk_days: thresholds.riskDays,
    p_lost_days: thresholds.lostDays,
    p_vip_visits: thresholds.vipVisits,
    p_sort: sort,
    p_sort_dir: sort === 'name' && !query.dir ? 'asc' : dir,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  }

  const countsArgs = {
    p_organization_id: orgId,
    p_branch_ids: scope.branchIds,
    p_risk_days: thresholds.riskDays,
    p_lost_days: thresholds.lostDays,
    p_vip_visits: thresholds.vipVisits,
  }

  // Con filtro por origen, `counts` deja de servir como denominador: se calcula
  // sobre la población YA filtrada, así que el tamaño real de la base tiene que
  // pedirse aparte igual que cuando hay búsqueda o toggles.
  const hayFiltrosDeBase = Boolean(search) || onlyWithVisits || hideWalkins || filtraPorOrigen

  const [listRes, countsRes, baseRes] = await Promise.all([
    // Con filtro por origen se pide una ventana grande y se pagina acá (la RPC no
    // conoce `signup_source`); sin filtro, la RPC pagina como siempre.
    supabase.rpc(
      'search_clients_page',
      filtraPorOrigen ? { ...listArgs, p_limit: ORIGEN_SCAN_CAP, p_offset: 0 } : listArgs
    ),
    // Conteos por segmento CON los filtros actuales: es lo que muestran los chips.
    // Con filtro por origen se derivan de las filas ya filtradas (abajo): la RPC
    // no sabe de orígenes y devolvería un desglose de otra población.
    filtraPorOrigen
      ? Promise.resolve(null)
      : supabase.rpc('client_segment_counts', {
          ...countsArgs,
          p_query: search || null,
          p_only_with_visits: onlyWithVisits,
          p_hide_walkins: hideWalkins,
        }),
    // Tamaño de la base SIN filtros: el denominador. Si no hay filtros es la misma
    // consulta, así que no la repetimos.
    hayFiltrosDeBase
      ? supabase.rpc('client_segment_counts', {
          ...countsArgs,
          p_query: null,
          p_only_with_visits: false,
          p_hide_walkins: false,
        })
      : Promise.resolve(null),
  ])

  if (listRes.error) {
    console.error('[clients-directory] search_clients_page:', listRes.error.message)
    return EMPTY_RESULT(page, pageSize, 'No pudimos leer la base de clientes')
  }

  const rows = (listRes.data ?? []) as RawRow[]

  type CountRow = { segment: string; client_count: number; total_spent: string | number }
  const parseCounts = (data: unknown): SegmentCount[] =>
    ((data ?? []) as CountRow[])
      .filter((c) => (CLIENT_SEGMENTS as string[]).includes(c.segment))
      .map((c) => ({
        segment: c.segment as ClientSegment,
        count: Number(c.client_count) || 0,
        totalSpent: num(c.total_spent),
      }))

  let countsError: string | null = null
  if (countsRes && countsRes.error) {
    console.error('[clients-directory] client_segment_counts:', countsRes.error.message)
    countsError = 'No pudimos calcular los segmentos'
  }
  if (baseRes && baseRes.error) {
    console.error('[clients-directory] client_segment_counts (base):', baseRes.error.message)
    countsError = countsError ?? 'No pudimos calcular el total de la base'
  }

  const baseCountsSource = baseRes ? parseCounts(baseRes.data) : null

  // ── Origen del alta ────────────────────────────────────────────────
  // Dos caminos, y el barato es el default:
  //   · sin filtro → sólo hacen falta las etiquetas de la página (≤200 ids);
  //   · con filtro → hace falta el universo de orígenes declarados para poder
  //     paginar sobre la población correcta.
  let visibles: RawRow[] = rows
  let total = rows.length > 0 ? Number(rows[0].total_rows) || 0 : page > 1 ? -1 : 0
  let counts = parseCounts(countsRes?.data)
  let signupTruncated = false
  const origenPorId = new Map<string, SignupSource | null>()

  if (filtraPorOrigen) {
    const declarados = await traerOrigenesDeclarados(supabase, orgId)
    if (declarados.error) {
      return EMPTY_RESULT(page, pageSize, declarados.error)
    }
    signupTruncated = declarados.truncated || rows.length >= ORIGEN_SCAN_CAP

    const filtradas = rows.filter((r) =>
      pasaFiltroOrigen(declarados.origenes.get(r.id) ?? null, origenes)
    )
    for (const r of filtradas) origenPorId.set(r.id, declarados.origenes.get(r.id) ?? null)

    total = filtradas.length
    const desde = (page - 1) * pageSize
    // Página fuera de rango: mismo contrato que la RPC (-1 ⇒ reencuadrar).
    visibles = desde >= filtradas.length && page > 1 ? [] : filtradas.slice(desde, desde + pageSize)
    if (desde >= filtradas.length && page > 1) total = -1

    // Los chips se derivan de la MISMA población filtrada. No es una regla nueva
    // de segmento: el segmento ya viene calculado por la RPC, acá sólo se agrupa.
    const acumulado = new Map<ClientSegment, { count: number; totalSpent: number }>()
    for (const r of filtradas) {
      const seg = ((CLIENT_SEGMENTS as string[]).includes(r.segment)
        ? r.segment
        : 'sin_visitas') as ClientSegment
      const prev = acumulado.get(seg) ?? { count: 0, totalSpent: 0 }
      acumulado.set(seg, { count: prev.count + 1, totalSpent: prev.totalSpent + num(r.total_spent) })
    }
    counts = CLIENT_SEGMENTS.filter((seg) => acumulado.has(seg)).map((seg) => ({
      segment: seg,
      count: acumulado.get(seg)!.count,
      totalSpent: acumulado.get(seg)!.totalSpent,
    }))
  } else {
    const etiquetas = await traerOrigenesDeIds(supabase, orgId, rows.map((r) => r.id))
    if (etiquetas.error) {
      // La lista sirve igual sin la etiqueta de origen: se avisa y se sigue.
      countsError = countsError ?? etiquetas.error
    }
    for (const [id, origen] of etiquetas.origenes) origenPorId.set(id, origen)
  }

  const baseCounts = baseCountsSource ?? counts
  const baseTotal = baseCounts.reduce((acc, c) => acc + c.count, 0)
  const sinVisitas = baseCounts.find((c) => c.segment === 'sin_visitas')?.count ?? 0

  return {
    clients: visibles.map((r) => mapRow(r, origenPorId.get(r.id) ?? null)),
    // `total_rows` viaja en las filas, así que una página fuera de rango no lo trae.
    // En ese caso devolvemos -1 para que el llamador sepa que hay que reencuadrar,
    // en vez de reportar "0 clientes" (que sería el cero silencioso otra vez).
    total,
    counts,
    baseTotal,
    baseWithVisits: Math.max(0, baseTotal - sinVisitas),
    thresholds,
    page,
    pageSize,
    error: null,
    countsError,
    signupTruncated,
  }
}

/** Tope de filas exportables — evita que un CSV de una org enorme tumbe el request. */
const EXPORT_CAP = 5000

export interface ClientsExportResult {
  rows: DirectoryClient[]
  truncated: boolean
  error: string | null
}

/**
 * Exporta el resultado del filtro actual (no sólo la página visible).
 * Devuelve `truncated` cuando se llegó al tope: un CSV recortado en silencio es un
 * dato falso.
 */
export async function fetchClientsForExport(
  query: ClientsDirectoryQuery
): Promise<ClientsExportResult> {
  if (!(await currentUserCan('clients.view'))) {
    return { rows: [], truncated: false, error: 'No tenés permiso para ver clientes' }
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { rows: [], truncated: false, error: 'Organización no encontrada' }

  const scope = await resolveBranchScope(query.branchId)
  if (!scope.ok) return { rows: [], truncated: false, error: 'No autorizado para esta sucursal' }

  const thresholds = await getThresholds(orgId)
  const supabase = createAdminClient()

  const search = (query.search ?? '').trim()
  const segments = (query.segments ?? []).filter((s) =>
    (CLIENT_SEGMENTS as string[]).includes(s)
  )

  const origenes = (query.signupSources ?? []).filter((o) =>
    (SIGNUP_FILTERS as string[]).includes(o)
  )
  const filtraPorOrigen = origenes.length > 0 && origenes.length < SIGNUP_FILTERS.length

  // El CSV lleva la columna Origen siempre, así que el mapa de orígenes
  // declarados se trae una sola vez y sirve para etiquetar y para filtrar.
  const declarados = await traerOrigenesDeclarados(supabase, orgId)
  if (declarados.error) {
    return { rows: [], truncated: false, error: declarados.error }
  }

  const PAGE = 200
  const all: DirectoryClient[] = []
  let offset = 0

  // `offset` cuenta filas ESCANEADAS (no las que quedaron): con filtro por origen
  // el CSV puede tener muchas menos y el tope sigue siendo del escaneo.
  while (offset < EXPORT_CAP) {
    const { data, error } = await supabase.rpc('search_clients_page', {
      p_organization_id: orgId,
      p_branch_ids: scope.branchIds,
      p_query: search || null,
      p_segments: segments.length > 0 ? segments : null,
      p_only_with_visits: query.onlyWithVisits === true,
      p_hide_walkins: query.hideWalkins === true,
      p_risk_days: thresholds.riskDays,
      p_lost_days: thresholds.lostDays,
      p_vip_visits: thresholds.vipVisits,
      p_sort: query.sort ?? 'spent',
      p_sort_dir: query.dir ?? 'desc',
      p_limit: PAGE,
      p_offset: offset,
    })

    if (error) {
      console.error('[clients-directory] export:', error.message)
      return { rows: [], truncated: false, error: 'No pudimos exportar la lista' }
    }

    const rows = (data ?? []) as RawRow[]
    for (const r of rows) {
      const origen = declarados.origenes.get(r.id) ?? null
      if (filtraPorOrigen && !pasaFiltroOrigen(origen, origenes)) continue
      all.push(mapRow(r, origen))
    }
    if (rows.length < PAGE) break
    offset += PAGE
  }

  return {
    rows: all,
    truncated: offset >= EXPORT_CAP || declarados.truncated,
    error: null,
  }
}

// ─── Altas por origen: la conversión real de la publicidad ────────────

/** Ventanas ofrecidas por la UI. Días corridos hacia atrás desde ahora. */
const VENTANAS_ALTAS = [7, 30, 90] as const

export interface SignupFunnelRow {
  source: SignupSource
  /** Fichas creadas por ese camino dentro del período. */
  creados: number
  /** De esos, cuántos ya tienen al menos una visita registrada. */
  conVisita: number
}

export interface SignupFunnelResult {
  days: number
  rows: SignupFunnelRow[]
  /**
   * Altas del período SIN origen declarado. No es ruido: si esto crece, hay un
   * camino de alta que no está escribiendo `signup_source` y la conversión de la
   * publicidad se está midiendo sobre un universo incompleto.
   */
  sinOrigen: number
  /** Se tocó el tope de escaneo: los números son un piso, no el total. */
  truncated: boolean
  error: string | null
}

/** Tope de altas que se analizan por período. */
const ALTAS_CAP = 20000

/**
 * Cuántas cuentas se crearon por cada camino en los últimos `days` días y
 * cuántas de ellas ya vinieron al local.
 *
 * Es la única métrica que responde "¿la publicidad trajo gente de verdad?": una
 * cuenta creada es una descarga; una cuenta creada QUE YA VINO es un cliente.
 *
 * Se calcula en TypeScript y no en SQL porque acá no se aplican migraciones; el
 * costo está acotado a las altas del período (hoy, sobre 6.419 clientes, ninguna
 * declara origen: la columna nace vacía a propósito).
 *
 * Es org-scope a propósito: una ficha de cliente no pertenece a una sucursal
 * —la app ni siquiera tiene sucursal desde el rediseño del 24/8— así que
 * filtrar por la sucursal elegida daría un número que no significa nada.
 */
export async function fetchSignupFunnel(days: number): Promise<SignupFunnelResult> {
  const ventana = (VENTANAS_ALTAS as readonly number[]).includes(days) ? days : 30
  const vacio = (error: string | null): SignupFunnelResult => ({
    days: ventana,
    rows: [],
    sinOrigen: 0,
    truncated: false,
    error,
  })

  if (!(await currentUserCan('clients.view'))) {
    return vacio('No tenés permiso para ver clientes')
  }

  const orgId = await getCurrentOrgId()
  if (!orgId) return vacio('Organización no encontrada')

  const supabase = createAdminClient()
  const desde = new Date(Date.now() - ventana * 24 * 60 * 60 * 1000).toISOString()

  const idsPorOrigen = new Map<SignupSource, string[]>()
  let sinOrigen = 0
  let truncated = false
  let leidos = 0

  while (leidos < ALTAS_CAP) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, signup_source')
      .eq('organization_id', orgId)
      .gte('created_at', desde)
      .order('id')
      .range(leidos, leidos + PAGINA_REST - 1)

    if (error) {
      console.error('[clients-directory] altas por origen:', error.message)
      return vacio('No pudimos leer las altas del período')
    }

    const filas = (data ?? []) as { id: string; signup_source: string | null }[]
    for (const row of filas) {
      const src = row.signup_source
      if (SIGNUP_SOURCES.includes(src as SignupSource)) {
        const lista = idsPorOrigen.get(src as SignupSource) ?? []
        lista.push(row.id)
        idsPorOrigen.set(src as SignupSource, lista)
      } else {
        sinOrigen++
      }
    }

    leidos += filas.length
    if (filas.length < PAGINA_REST) break
    if (leidos >= ALTAS_CAP) truncated = true
  }

  // ¿Cuáles de esas fichas ya tienen una visita? Una sola pasada sobre `visits`
  // acotada a esos ids. Se pagina de a 1000 (PostgREST corta ahí en silencio) y
  // un cliente puede tener varias visitas, así que se dedupe con un Set.
  const todosLosIds = [...idsPorOrigen.values()].flat()
  const conVisita = new Set<string>()

  for (let i = 0; i < todosLosIds.length; i += 200) {
    const lote = todosLosIds.slice(i, i + 200)
    let desdeFila = 0
    for (;;) {
      const { data, error } = await supabase
        .from('visits')
        .select('client_id')
        .eq('organization_id', orgId)
        .in('client_id', lote)
        .range(desdeFila, desdeFila + PAGINA_REST - 1)
      if (error) {
        console.error('[clients-directory] visitas de las altas:', error.message)
        return vacio('No pudimos cruzar las altas con las visitas')
      }
      const filas = (data ?? []) as { client_id: string | null }[]
      for (const f of filas) if (f.client_id) conVisita.add(f.client_id)
      if (filas.length < PAGINA_REST) break
      desdeFila += PAGINA_REST
    }
  }

  const rows: SignupFunnelRow[] = SIGNUP_SOURCES.filter((src) => idsPorOrigen.has(src)).map(
    (src) => {
      const ids = idsPorOrigen.get(src)!
      return {
        source: src,
        creados: ids.length,
        conVisita: ids.filter((id) => conVisita.has(id)).length,
      }
    }
  )

  return { days: ventana, rows, sinOrigen, truncated, error: null }
}
