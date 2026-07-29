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
  thresholds: SegmentThresholds
  page: number
  pageSize: number
  /**
   * Nunca devolvemos una lista vacía en silencio ante un fallo: un tablero que
   * muestra 0 clientes cuando en realidad no pudo leer es indistinguible de una
   * base vacía (Known Risk #15).
   */
  error: string | null
}

const EMPTY_RESULT = (page: number, pageSize: number, error: string): ClientsDirectoryResult => ({
  clients: [],
  total: 0,
  counts: [],
  thresholds: { riskDays: DEFAULT_RISK_DAYS, lostDays: DEFAULT_LOST_DAYS, vipVisits: VIP_VISITS },
  page,
  pageSize,
  error,
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

function mapRow(r: RawRow): DirectoryClient {
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
  return { ok: true, branchIds: scoped.length > 0 ? scoped : null }
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

  const [listRes, countsRes] = await Promise.all([
    supabase.rpc('search_clients_page', listArgs),
    supabase.rpc('client_segment_counts', {
      p_organization_id: orgId,
      p_branch_ids: scope.branchIds,
      p_query: search || null,
      p_only_with_visits: onlyWithVisits,
      p_hide_walkins: hideWalkins,
      p_risk_days: thresholds.riskDays,
      p_lost_days: thresholds.lostDays,
      p_vip_visits: thresholds.vipVisits,
    }),
  ])

  if (listRes.error) {
    console.error('[clients-directory] search_clients_page:', listRes.error.message)
    return EMPTY_RESULT(page, pageSize, 'No pudimos leer la base de clientes')
  }

  const rows = (listRes.data ?? []) as RawRow[]

  // Los conteos son secundarios: si fallan, la lista igual sirve. Pero lo decimos.
  if (countsRes.error) {
    console.error('[clients-directory] client_segment_counts:', countsRes.error.message)
  }

  const counts: SegmentCount[] = ((countsRes.data ?? []) as Array<{
    segment: string
    client_count: number
    total_spent: string | number
  }>)
    .filter((c) => (CLIENT_SEGMENTS as string[]).includes(c.segment))
    .map((c) => ({
      segment: c.segment as ClientSegment,
      count: Number(c.client_count) || 0,
      totalSpent: num(c.total_spent),
    }))

  return {
    clients: rows.map(mapRow),
    total: rows.length > 0 ? Number(rows[0].total_rows) || 0 : 0,
    counts,
    thresholds,
    page,
    pageSize,
    error: null,
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

  const PAGE = 200
  const all: DirectoryClient[] = []
  let offset = 0

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
    all.push(...rows.map(mapRow))
    if (rows.length < PAGE) break
    offset += PAGE
  }

  return { rows: all, truncated: all.length >= EXPORT_CAP, error: null }
}
