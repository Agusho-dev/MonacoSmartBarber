'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Crown,
  DoorOpen,
  Eye,
  FileDown,
  Instagram,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Plus,
  Repeat2,
  Save,
  Search,
  Sparkles,
  Star,
  Tag,
  Users,
  UserX,
  X,
} from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { exportCSV } from '@/lib/export'
import { createClient } from '@/lib/supabase/client'
import { updateClientNotes } from '@/lib/actions/clients'
import { checkinClient } from '@/lib/actions/queue'
import { createReviewRequest } from '@/lib/actions/reviews'
import { getClientVisits } from '@/lib/actions/visit-history'
import type { ClientProfileVisit } from '@/lib/actions/visit-history'
import {
  fetchClientsDirectory,
  fetchClientsForExport,
  type ClientSegment,
  type ClientSortKey,
  type ClientsDirectoryQuery,
  type ClientsDirectoryResult,
  type DirectoryClient,
} from '@/lib/actions/clients-directory'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface PhotoRow {
  id: string
  visit_id: string
  storage_path: string
  order_index: number
}

/**
 * Vocabulario de segmentos. Antes había TRES reglas distintas en el repo
 * (`clientes-client`, `client-segments`, `stats`); ahora la calcula la RPC y acá
 * sólo se pinta. El corte que faltaba y más valor tiene es "Probó y no volvió":
 * son ~2.000 personas que estaban escondidas dentro de "Perdido" y son el
 * segmento más accionable del negocio.
 */
const SEGMENT_META: Record<
  ClientSegment,
  {
    label: string
    short: string
    hint: (t: { riskDays: number; lostDays: number; vipVisits: number }) => string
    icon: typeof Users
    text: string
    bg: string
    ring: string
    badge: string
  }
> = {
  vip: {
    label: 'VIP',
    short: 'VIP',
    hint: (t) => `${t.vipVisits}+ visitas y activo`,
    icon: Crown,
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    ring: 'border-violet-500/40',
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  activo: {
    label: 'Activo',
    short: 'Activos',
    hint: (t) => `2+ visitas, vino hace menos de ${t.riskDays} días`,
    icon: Repeat2,
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    ring: 'border-emerald-500/40',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  nuevo: {
    label: 'Nuevo',
    short: 'Nuevos',
    hint: (t) => `1ª visita hace menos de ${t.riskDays} días`,
    icon: Sparkles,
    text: 'text-sky-400',
    bg: 'bg-sky-500/10',
    ring: 'border-sky-500/40',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  en_riesgo: {
    label: 'En riesgo',
    short: 'En riesgo',
    hint: (t) => `Cliente fiel sin venir hace ${t.riskDays}–${t.lostDays} días`,
    icon: AlertTriangle,
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    ring: 'border-amber-500/40',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  probo_no_volvio: {
    label: 'Probó y no volvió',
    short: 'No volvió',
    hint: (t) => `Vino una sola vez, hace más de ${t.riskDays} días`,
    icon: DoorOpen,
    text: 'text-orange-400',
    bg: 'bg-orange-500/10',
    ring: 'border-orange-500/40',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  perdido: {
    label: 'Perdido',
    short: 'Perdidos',
    hint: (t) => `Era cliente y no vuelve hace más de ${t.lostDays} días`,
    icon: UserX,
    text: 'text-rose-400',
    bg: 'bg-rose-500/10',
    ring: 'border-rose-500/40',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  sin_visitas: {
    label: 'Sin visitas',
    short: 'Sin visitas',
    hint: () => 'Está en la base pero nunca se atendió',
    icon: CircleDashed,
    text: 'text-zinc-400',
    bg: 'bg-white/[0.04]',
    ring: 'border-white/20',
    badge: 'bg-white/[0.06] text-zinc-300 border-white/15',
  },
}

const SEGMENT_ORDER: ClientSegment[] = [
  'activo',
  'vip',
  'nuevo',
  'en_riesgo',
  'probo_no_volvio',
  'perdido',
  'sin_visitas',
]

const PAGE_SIZE = 50

function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor(ms / 86400000))
}

function textoRelativo(dias: number | null): string {
  if (dias === null) return 'nunca'
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} d`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
  const anios = Math.floor(dias / 365)
  return `hace ${anios} ${anios === 1 ? 'año' : 'años'}`
}

/**
 * En la base hay filas con nombre "." o vacío: son walk-ins que se cargaron sin
 * datos desde la fila. Mostrar "." en una lista parece un error de la app.
 */
function nombreVisible(nombre: string): string {
  const limpio = (nombre ?? '').trim()
  if (limpio.length === 0 || !/[a-záéíóúüñ0-9]/i.test(limpio)) return 'Sin nombre'
  return limpio
}

function iniciales(nombre: string): string {
  const limpio = nombreVisible(nombre)
  if (limpio === 'Sin nombre') return '?'
  const partes = limpio.split(/\s+/).filter(Boolean)
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[1][0]).toUpperCase()
}

function telefonoLegible(phone: string, isWalkin: boolean): string {
  if (isWalkin) return 'Sin teléfono'
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

interface Props {
  initial: ClientsDirectoryResult
  branches: { id: string; name: string }[]
  orgName?: string
  canEdit: boolean
}

export function ClientesClient({ initial, branches, orgName = 'BarberOS', canEdit }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId)

  // --- Estado de consulta -------------------------------------------------
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [segments, setSegments] = useState<ClientSegment[]>([])
  const [onlyWithVisits, setOnlyWithVisits] = useState(false)
  const [hideWalkins, setHideWalkins] = useState(false)
  // Debe coincidir con el fetch inicial de page.tsx (el primer refetch se omite).
  const [sort, setSort] = useState<ClientSortKey>('last_visit')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  /** El usuario tocó un encabezado: a partir de ahí su elección gana sobre el default. */
  const [sortManual, setSortManual] = useState(false)
  const [page, setPage] = useState(1)

  const [result, setResult] = useState<ClientsDirectoryResult>(initial)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Debounce del input. 250 ms: suficiente para no disparar por tecla y no tanto
  // como para que se sienta lento.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  // Al buscar se ordena por relevancia y al limpiar se vuelve al default, PERO sólo
  // mientras el usuario no haya elegido un orden a mano. Sin `sortManual`, hacer clic
  // en "Cliente" con el buscador lleno no hacía nada y la flechita mentía.
  // Se DERIVA en vez de sincronizarse con un useEffect: así el efecto de carga nunca
  // corre con el sort viejo.
  const sortEfectivo: ClientSortKey =
    !sortManual && search && (sort === 'last_visit' || sort === 'name') ? 'relevance' : sort
  const dirEfectiva: 'asc' | 'desc' = sortEfectivo === sort ? dir : 'desc'

  const segmentKey = segments.join(',')

  // Cualquier cambio de filtro vuelve a la página 1. Se ajusta DURANTE el render
  // (patrón soportado por React: re-renderiza sin commitear), no en un useEffect:
  // así el efecto de carga nunca llega a dispararse con la página vieja. Cubre
  // también al BranchSelector, que escribe directo al store Zustand y no pasa por
  // ningún handler de esta pantalla.
  const filtroKey = [selectedBranchId ?? '', search, segmentKey, onlyWithVisits, hideWalkins].join('|')
  const [prevFiltroKey, setPrevFiltroKey] = useState(filtroKey)
  if (prevFiltroKey !== filtroKey) {
    setPrevFiltroKey(filtroKey)
    setPage(1)
  }

  const query = useMemo<ClientsDirectoryQuery>(
    () => ({
      branchId: selectedBranchId,
      search,
      segments: segmentKey ? (segmentKey.split(',') as ClientSegment[]) : [],
      onlyWithVisits,
      hideWalkins,
      sort: sortEfectivo,
      dir: dirEfectiva,
      page,
      pageSize: PAGE_SIZE,
    }),
    [selectedBranchId, search, segmentKey, onlyWithVisits, hideWalkins, sortEfectivo, dirEfectiva, page]
  )



  // Descarta respuestas viejas: con búsqueda debounced, una respuesta lenta de
  // "ag" no puede pisar la de "agustin".
  const reqIdRef = useRef(0)
  const firstRunRef = useRef(true)

  const load = useCallback(async (q: ClientsDirectoryQuery) => {
    const myId = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await fetchClientsDirectory(q)
      if (reqIdRef.current !== myId) return
      // total = -1 ⇒ la página pedida quedó fuera de rango (la RPC manda el total
      // dentro de las filas, así que una página vacía no lo trae). Volvemos a la
      // primera en vez de mostrar "0 clientes", que sería mentira.
      if (res.total < 0) {
        setPage(1)
        return
      }
      setResult(res)
      if (res.error) toast.error(res.error)
    } catch {
      if (reqIdRef.current !== myId) return
      setResult((prev) => ({ ...prev, error: 'No pudimos leer la base de clientes' }))
      toast.error('No pudimos leer la base de clientes')
    } finally {
      if (reqIdRef.current === myId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // La primera página ya vino del server component... pero SÓLO si el estado
    // coincide. `useBranchStore` es un singleton de módulo que no se resetea al
    // navegar, así que entrar a Clientes desde otra pantalla con una sucursal
    // elegida monta este componente con `selectedBranchId` ya seteado mientras
    // `initial` trae métricas de toda la organización. Saltear ese fetch dejaba la
    // pantalla rotulada "en Parana" con los números de las cuatro sucursales.
    if (firstRunRef.current) {
      firstRunRef.current = false
      if (!selectedBranchId) return
    }
    load(query)
  }, [query, load, selectedBranchId])

  // --- Derivados ----------------------------------------------------------
  const countsMap = useMemo(() => {
    const m = new Map<ClientSegment, { count: number; totalSpent: number }>()
    for (const c of result.counts) m.set(c.segment, { count: c.count, totalSpent: c.totalSpent })
    return m
  }, [result.counts])

  const hayError = Boolean(result.error)
  const hayErrorDeConteos = hayError || Boolean(result.countsError)

  // Denominador honesto: el tamaño de la base SIN búsqueda ni toggles. Usar la suma
  // de los chips daría "181 resultados en los 181 clientes de la base".
  const baseTotal = result.baseTotal
  // Suma de los chips: la población que matchea la búsqueda y los toggles actuales.
  // El tile "Todos" tiene que usar ESTO (si no, dice 5.541 arriba de siete chips que
  // suman 312 y parece un desglose roto). El tamaño real de la base va en el header.
  const totalDeLosChips = result.counts.reduce((acc, c) => acc + c.count, 0)
  // Con una sucursal elegida, "sin visitas" significa "sin visitas ACÁ", así que
  // baseWithVisits es exactamente cuántos clientes pasaron por esa sucursal.
  const conVisitasEnScope = result.baseWithVisits

  // Ante un fallo de lectura se muestra "—", nunca un 0 inventado.
  const numero = (n: number) => (hayErrorDeConteos ? '—' : n.toLocaleString('es-AR'))

  const hayFiltros =
    search !== '' || segments.length > 0 || onlyWithVisits || hideWalkins

  const branchName = selectedBranchId
    ? (branches.find((b) => b.id === selectedBranchId)?.name ?? 'esta sucursal')
    : null

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
  const desde = result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const hasta = Math.min(page * PAGE_SIZE, result.total)

  function toggleSegment(seg: ClientSegment) {
    setPage(1)
    setSegments((prev) => (prev.includes(seg) ? prev.filter((s) => s !== seg) : [...prev, seg]))
  }

  function toggleSort(field: ClientSortKey) {
    setPage(1)
    setSortManual(true)
    if (sort === field) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(field)
      setDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  function limpiarFiltros() {
    setSearchInput('')
    setSegments([])
    setOnlyWithVisits(false)
    setHideWalkins(false)
    setSortManual(false)
    setSort('last_visit')
    setDir('desc')
    setPage(1)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await fetchClientsForExport(query)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.rows.length === 0) {
        toast.error('No hay clientes para exportar con estos filtros')
        return
      }
      exportCSV(
        [
          'Nombre',
          'Teléfono',
          'Segmento',
          branchName ? `Visitas en ${branchName}` : 'Visitas',
          'Visitas totales',
          branchName ? `Gastado en ${branchName}` : 'Gastado',
          'Ticket promedio',
          'Cada (días)',
          'Última visita',
          'Barbero habitual',
          'Sucursal habitual',
          'Cliente desde',
          'Observaciones',
        ],
        res.rows.map((c) => [
          c.name,
          c.isWalkin ? '' : c.phone,
          SEGMENT_META[c.segment].label,
          c.visitCount,
          c.globalVisitCount,
          c.totalSpent,
          c.avgTicket ?? '',
          c.cadenceDays ?? '',
          c.lastVisitAt ? formatDate(c.lastVisitAt) : '',
          c.topBarberName ?? '',
          c.topBranchName ?? '',
          formatDate(c.createdAt),
          c.notes ?? '',
        ]),
        `clientes-${new Date().toISOString().slice(0, 10)}`
      )
      if (res.truncated) {
        toast.warning(
          `Exportamos las primeras ${res.rows.length} filas. Afiná los filtros para el resto.`
        )
      } else {
        toast.success(`${res.rows.length} clientes exportados`)
      }
    } catch {
      // Sin este catch el spinner se apagaba, no bajaba ningún CSV y no había
      // ningún aviso: el usuario concluye "el botón no anda".
      toast.error('No pudimos exportar la lista. Probá de nuevo.')
    } finally {
      setExporting(false)
    }
  }

  // --- Sheet de detalle ---------------------------------------------------
  const [detailClient, setDetailClient] = useState<DirectoryClient | null>(null)
  const [lazyVisits, setLazyVisits] = useState<ClientProfileVisit[]>([])
  const [lazyTotalCount, setLazyTotalCount] = useState(0)
  const [lazyHasMore, setLazyHasMore] = useState(false)
  const [lazyOffset, setLazyOffset] = useState(0)
  const [isLoadingVisits, startLoadingVisits] = useTransition()
  const [visitsFetched, setVisitsFetched] = useState(false)
  const [visitsError, setVisitsError] = useState(false)
  // Mismo patrón que `load`: sin esto, abrir un cliente lento y después otro rápido
  // pisaba el historial del segundo con las visitas del primero — y "Pedir reseña"
  // generaba el token de una visita ajena.
  const visitsReqRef = useRef(0)
  const [isLoadingMore, startLoadingMore] = useTransition()
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null)
  const [editableNotes, setEditableNotes] = useState('')
  const [editableInstagram, setEditableInstagram] = useState('')
  const [isSavingNotes, startSavingNotes] = useTransition()
  const [requestingReview, setRequestingReview] = useState<string | null>(null)

  useEffect(() => {
    visitsReqRef.current++
    if (!detailClient) {
      setLazyVisits([])
      setLazyTotalCount(0)
      setLazyHasMore(false)
      setLazyOffset(0)
      setPhotos([])
      setEditableNotes('')
      setEditableInstagram('')
      setVisitsFetched(false)
      setVisitsError(false)
      return
    }
    const myId = visitsReqRef.current
    setEditableNotes(detailClient.notes ?? '')
    setEditableInstagram(detailClient.instagram ?? '')
    setLazyVisits([])
    setLazyTotalCount(0)
    setLazyHasMore(false)
    setLazyOffset(0)
    setPhotos([])
    setVisitsFetched(false)
    setVisitsError(false)
    startLoadingVisits(async () => {
      try {
        const res = await getClientVisits(detailClient.id, { limit: 50, offset: 0 })
        if (visitsReqRef.current !== myId) return
        setLazyVisits(res.visits)
        setLazyTotalCount(res.totalCount)
        setLazyHasMore(res.hasMore)
        setLazyOffset(50)
        const ids = res.visits.map((v) => v.id)
        if (ids.length > 0) {
          const { data } = await supabase
            .from('visit_photos')
            .select('id, visit_id, storage_path, order_index')
            .in('visit_id', ids)
            .order('order_index')
          if (visitsReqRef.current !== myId) return
          setPhotos(data ?? [])
        }
      } catch {
        // Si la promesa RECHAZA (red caída, AbortError del timeout de 8s) hay que
        // dejar rastro igual: sin esto el sheet dibujaba "Sin visitas registradas",
        // que es exactamente el cero silencioso que queremos evitar.
        if (visitsReqRef.current !== myId) return
        setVisitsError(true)
      } finally {
        if (visitsReqRef.current === myId) setVisitsFetched(true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailClient?.id])

  const photosByVisit = useMemo(() => {
    const m = new Map<string, PhotoRow[]>()
    for (const p of photos) {
      const arr = m.get(p.visit_id) ?? []
      arr.push(p)
      m.set(p.visit_id, arr)
    }
    return m
  }, [photos])

  function getUrl(path: string) {
    return supabase.storage.from('visit-photos').getPublicUrl(path).data.publicUrl
  }

  function openCrmChat(clientId: string) {
    router.push(`/dashboard/mensajeria?clientId=${clientId}`)
  }

  // --- Render -------------------------------------------------------------
  // Lee el orden EFECTIVO, no el pedido: si no, con el buscador lleno la flecha
  // marcaba "Cliente" mientras la lista venía por relevancia.
  const SortIcon = ({ field }: { field: ClientSortKey }) => {
    if (sortEfectivo !== field) return <ArrowUpDown className="ml-1 size-3 opacity-30" />
    return dirEfectiva === 'asc' ? (
      <ArrowUp className="ml-1 size-3" />
    ) : (
      <ArrowDown className="ml-1 size-3" />
    )
  }

  const Th = ({
    field,
    children,
    className,
    align = 'left',
  }: {
    field?: ClientSortKey
    children: React.ReactNode
    className?: string
    align?: 'left' | 'right'
  }) => (
    <th
      className={cn(
        'px-3 py-2.5 font-semibold',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
    >
      {field ? (
        <button
          onClick={() => toggleSort(field)}
          className="inline-flex items-center whitespace-nowrap transition-colors hover:text-foreground"
        >
          {children}
          <SortIcon field={field} />
        </button>
      ) : (
        <span className="whitespace-nowrap">{children}</span>
      )}
    </th>
  )

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden lg:h-[calc(100dvh-5rem)]">
      {/* ---------- Header sticky ---------- */}
      <div className="shrink-0 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto max-w-[100rem] space-y-2.5 px-4 pt-3 pb-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2.5">
              <h2 className="bg-gradient-to-b from-zinc-50 to-zinc-300 bg-clip-text text-lg font-bold tracking-tight text-transparent lg:text-xl">
                Clientes
              </h2>
              {/* Los dos números, siempre visibles: es lo que mata la sospecha de
                  que "faltan clientes" al elegir una sucursal. */}
              <span className="text-xs text-muted-foreground tabular-nums">
                {numero(baseTotal)} en la base
                {branchName && (
                  <>
                    {' · '}
                    <span className="text-zinc-300">
                      {numero(conVisitasEnScope)} con visitas en {branchName}
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-white/[0.08] bg-zinc-900/40 text-xs"
                onClick={handleExport}
                disabled={exporting || result.total === 0}
              >
                {exporting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileDown className="size-3.5" />
                )}
                Exportar
              </Button>
              <div className="flex items-center gap-1.5">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  Métricas de:
                </span>
                <BranchSelector
                  branches={branches}
                  allowAll
                  className="h-8 w-[170px] border-white/[0.08] bg-zinc-900/40 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Buscador + toggles */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 border-white/[0.08] bg-zinc-900/40 pl-9 pr-9"
                placeholder="Buscar por nombre, teléfono u observación en toda la base..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {loading ? (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                searchInput && (
                  <button
                    onClick={() => setSearchInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="size-3.5" />
                  </button>
                )
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {selectedBranchId && (
                <FilterToggle
                  active={onlyWithVisits}
                  onClick={() => {
                    setPage(1)
                    setOnlyWithVisits((v) => !v)
                  }}
                >
                  Sólo con visitas acá
                </FilterToggle>
              )}
              <FilterToggle
                active={hideWalkins}
                onClick={() => {
                  setPage(1)
                  setHideWalkins((v) => !v)
                }}
              >
                Ocultar sin teléfono
              </FilterToggle>
              {hayFiltros && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={limpiarFiltros}
                >
                  <X className="size-3" />
                  Limpiar
                </Button>
              )}
            </div>
          </div>

          {/* Contador honesto: siempre se ve sobre cuántos se buscó */}
          <p className="text-[11px] text-muted-foreground">
            {search ? (
              <>
                <span className="font-semibold text-zinc-200 tabular-nums">
                  {numero(result.total)}
                </span>{' '}
                {result.total === 1 ? 'resultado' : 'resultados'} para{' '}
                <span className="text-zinc-300">«{search}»</span> en los{' '}
                {numero(baseTotal)} clientes de la base
              </>
            ) : (
              <>
                Mostrando{' '}
                <span className="font-semibold text-zinc-200 tabular-nums">
                  {numero(result.total)}
                </span>{' '}
                {result.total === 1 ? 'cliente' : 'clientes'}
                {branchName && (
                  <>
                    {' '}
                    · métricas de <span className="text-zinc-300">{branchName}</span>
                    {!onlyWithVisits && ' (la lista sigue siendo toda la base)'}
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* ---------- Cuerpo scrolleable ---------- */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-4">
          {result.error && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4">
              <AlertTriangle className="size-5 shrink-0 text-red-400" />
              <div className="text-sm">
                <p className="font-semibold text-red-200">{result.error}</p>
                <p className="text-red-200/70">
                  Esto no significa que no tengas clientes: no pudimos leer la base. Reintentá en
                  unos segundos.
                </p>
              </div>
            </div>
          )}

          {/* Segmentos: son las tarjetas Y el filtro */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <SegmentTile
              active={segments.length === 0}
              icon={Users}
              label="Todos"
              count={totalDeLosChips}
              unknown={hayErrorDeConteos}
              text="text-zinc-200"
              bg="bg-white/[0.05]"
              ring="border-white/25"
              onClick={() => {
                setPage(1)
                setSegments([])
              }}
            />
            {SEGMENT_ORDER.map((seg) => {
              const meta = SEGMENT_META[seg]
              const c = countsMap.get(seg)
              return (
                <SegmentTile
                  key={seg}
                  active={segments.includes(seg)}
                  icon={meta.icon}
                  label={meta.short}
                  hint={meta.hint(result.thresholds)}
                  count={c?.count ?? 0}
                  money={seg === 'en_riesgo' || seg === 'probo_no_volvio' ? c?.totalSpent : undefined}
                  unknown={hayErrorDeConteos}
                  text={meta.text}
                  bg={meta.bg}
                  ring={meta.ring}
                  onClick={() => toggleSegment(seg)}
                />
              )
            })}
          </div>

          {/* Tabla desktop */}
          <div className="hidden overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/40 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-white/[0.06] bg-white/[0.02]">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    <Th field="name">Cliente</Th>
                    <Th field="last_visit">Estado</Th>
                    <Th field="visits" align="right">
                      {branchName ? 'Visitas acá' : 'Visitas'}
                    </Th>
                    <Th field="spent" align="right">
                      Gastado
                    </Th>
                    <Th field="ticket" align="right" className="hidden xl:table-cell">
                      Ticket
                    </Th>
                    <Th align="right" className="hidden xl:table-cell">
                      Cada
                    </Th>
                    <Th className="hidden lg:table-cell">Barbero</Th>
                    <th className="px-3 py-2.5 text-right font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {loading && result.clients.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin opacity-50" />
                        Buscando...
                      </td>
                    </tr>
                  )}
                  {!loading && !hayError && result.clients.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <Users className="mx-auto mb-2 size-10 opacity-20" />
                        <p className="text-sm text-muted-foreground">
                          {search
                            ? `Sin resultados para «${search}» en toda la base`
                            : hayFiltros
                              ? 'Ningún cliente coincide con estos filtros'
                              : 'Todavía no hay clientes registrados'}
                        </p>
                        {hayFiltros && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 h-7 text-xs"
                            onClick={limpiarFiltros}
                          >
                            Limpiar filtros
                          </Button>
                        )}
                      </td>
                    </tr>
                  )}
                  {result.clients.map((c) => {
                    const meta = SEGMENT_META[c.segment]
                    const dias = diasDesde(c.lastVisitAt)
                    const sinVisitasAca = !!branchName && c.visitCount === 0
                    return (
                      <tr
                        key={c.id}
                        className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                        onClick={() => setDetailClient(c)}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={cn(
                                'grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                                meta.bg,
                                meta.text
                              )}
                            >
                              {iniciales(c.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium leading-tight">{nombreVisible(c.name)}</p>
                              <p
                                className={cn(
                                  'truncate font-mono text-[11px]',
                                  c.isWalkin ? 'italic text-muted-foreground/60' : 'text-muted-foreground'
                                )}
                              >
                                {telefonoLegible(c.phone, c.isWalkin)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn('shrink-0 text-[10px]', meta.badge)}>
                              {meta.label}
                            </Badge>
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                              {textoRelativo(dias)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {sinVisitasAca ? (
                            <span className="text-[11px] italic text-muted-foreground/50">
                              {c.globalVisitCount > 0 ? `0 · ${c.globalVisitCount} en otra` : '0'}
                            </span>
                          ) : (
                            <>
                              {c.visitCount}
                              {branchName && c.globalVisitCount > c.visitCount && (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  /{c.globalVisitCount}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                          {c.totalSpent > 0 ? (
                            formatCurrency(c.totalSpent)
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground xl:table-cell">
                          {c.avgTicket ? formatCurrency(c.avgTicket) : '—'}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground xl:table-cell">
                          {c.cadenceDays ? `${c.cadenceDays} d` : '—'}
                        </td>
                        <td className="hidden max-w-[9rem] px-3 py-2.5 lg:table-cell">
                          <span className="block truncate text-muted-foreground">
                            {c.topBarberName ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5">
                            {!c.isWalkin && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                title="Abrir WhatsApp"
                                onClick={() =>
                                  window.open(
                                    `https://wa.me/${c.phone.replace(/\D/g, '')}`,
                                    '_blank'
                                  )
                                }
                              >
                                <MessageCircle className="size-3 text-green-500" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Abrir chat en CRM"
                              onClick={() => openCrmChat(c.id)}
                            >
                              <MessagesSquare className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              title="Ver detalle"
                              onClick={() => setDetailClient(c)}
                            >
                              <Eye className="size-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Paginacion
              desde={desde}
              hasta={hasta}
              total={result.total}
              page={page}
              totalPages={totalPages}
              loading={loading}
              onPage={setPage}
            />
          </div>

          {/* Cards mobile */}
          <div className="space-y-2 md:hidden">
            {loading && result.clients.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                <Loader2 className="mx-auto mb-2 size-6 animate-spin opacity-50" />
                Buscando...
              </div>
            )}
            {!loading && !hayError && result.clients.length === 0 && (
              <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 py-12 text-center">
                <Users className="mx-auto mb-2 size-10 opacity-20" />
                <p className="text-sm text-muted-foreground">
                  {search ? `Sin resultados para «${search}»` : 'Ningún cliente coincide'}
                </p>
              </div>
            )}
            {result.clients.map((c) => {
              const meta = SEGMENT_META[c.segment]
              return (
                <button
                  key={c.id}
                  onClick={() => setDetailClient(c)}
                  className="w-full rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3 text-left transition-colors active:bg-white/[0.04]"
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        'grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold',
                        meta.bg,
                        meta.text
                      )}
                    >
                      {iniciales(c.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium leading-tight">{nombreVisible(c.name)}</p>
                        <Badge variant="outline" className={cn('shrink-0 text-[10px]', meta.badge)}>
                          {meta.label}
                        </Badge>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {telefonoLegible(c.phone, c.isWalkin)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          {c.visitCount} {c.visitCount === 1 ? 'visita' : 'visitas'}
                        </span>
                        {c.totalSpent > 0 && (
                          <span className="font-semibold tabular-nums text-zinc-300">
                            {formatCurrency(c.totalSpent)}
                          </span>
                        )}
                        <span>{textoRelativo(diasDesde(c.lastVisitAt))}</span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
            {result.clients.length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40">
                <Paginacion
                  desde={desde}
                  hasta={hasta}
                  total={result.total}
                  page={page}
                  totalPages={totalPages}
                  loading={loading}
                  onPage={setPage}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Sheet de detalle ---------- */}
      <Sheet open={!!detailClient} onOpenChange={(open) => !open && setDetailClient(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:!max-w-[480px]">
          {detailClient &&
            (() => {
              const c = detailClient
              const meta = SEGMENT_META[c.segment]
              const dias = diasDesde(c.lastVisitAt)
              // Si el cliente tiene visitas pero el historial vino vacío, es un fallo
              // de lectura, no "sin visitas". Decirlo evita el cero silencioso.
              const historialSospechoso =
                visitsFetched &&
                !isLoadingVisits &&
                lazyVisits.length === 0 &&
                (visitsError || c.globalVisitCount > 0)

              return (
                <>
                  <div className="relative border-b border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'grid size-12 shrink-0 place-items-center rounded-full text-sm font-bold',
                          meta.bg,
                          meta.text
                        )}
                      >
                        {iniciales(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-xl font-bold tracking-tight">{nombreVisible(c.name)}</h2>
                        <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                          {telefonoLegible(c.phone, c.isWalkin)}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0', meta.badge)}>
                        {meta.label}
                      </Badge>
                    </div>

                    <p className="mt-2 text-xs text-muted-foreground">
                      {meta.hint(result.thresholds)}
                      {dias !== null && ` · última visita ${textoRelativo(dias)}`}
                    </p>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <StatBox
                        label={branchName ? `Visitas en ${branchName}` : 'Visitas'}
                        value={String(c.visitCount)}
                        sub={
                          branchName && c.globalVisitCount !== c.visitCount
                            ? `${c.globalVisitCount} en total`
                            : undefined
                        }
                      />
                      <StatBox
                        label="Gastado"
                        value={c.totalSpent > 0 ? formatCurrency(c.totalSpent) : '—'}
                        sub={c.avgTicket ? `${formatCurrency(c.avgTicket)} promedio` : undefined}
                      />
                      <StatBox
                        label="Frecuencia"
                        value={c.cadenceDays ? `${c.cadenceDays} d` : '—'}
                        sub={c.cadenceDays ? 'entre visitas' : 'pocas visitas'}
                      />
                    </div>
                  </div>

                  <div className="space-y-4 px-4 py-4 sm:space-y-5 sm:px-6 sm:py-5">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={c.isWalkin}
                        className="h-9 border-green-500/20 bg-green-500/10 text-green-500 transition-colors hover:bg-green-500/20 hover:text-green-400 disabled:opacity-40"
                        onClick={() =>
                          window.open(`https://wa.me/${c.phone.replace(/\D/g, '')}`, '_blank')
                        }
                      >
                        <MessageCircle className="mr-2 size-4" />
                        WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 transition-colors"
                        onClick={async () => {
                          if (!selectedBranchId) {
                            toast.error('Elegí una sucursal para añadir a la fila.')
                            return
                          }
                          const fd = new FormData()
                          fd.append('name', c.name)
                          fd.append('phone', c.phone)
                          fd.append('branch_id', selectedBranchId)
                          const res = await checkinClient(fd)
                          if (res?.error) toast.error(res.error)
                          else toast.success(`${nombreVisible(c.name)} añadido a la fila`)
                        }}
                      >
                        <Plus className="mr-2 size-4" />
                        Añadir a fila
                      </Button>
                    </div>

                    {(c.topBarberName || c.topBranchName) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {c.topBarberName && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/5 px-2.5 py-1">
                            <Star className="size-3 shrink-0 text-yellow-400" />
                            <span className="text-muted-foreground">
                              Barbero habitual:{' '}
                              <strong className="text-foreground">{c.topBarberName}</strong>
                            </span>
                          </span>
                        )}
                        {c.topBranchName && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-muted-foreground">
                            {c.topBranchName}
                            {c.branchCount > 1 && (
                              <span className="text-[10px] text-zinc-400">
                                +{c.branchCount - 1} suc.
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div>
                        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Instagram className="size-3" />
                          Instagram
                        </label>
                        <Input
                          value={editableInstagram}
                          onChange={(e) => setEditableInstagram(e.target.value)}
                          placeholder="@usuario"
                          className="h-9"
                          disabled={!canEdit}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          Observaciones internas
                        </label>
                        <textarea
                          value={editableNotes}
                          onChange={(e) => setEditableNotes(e.target.value)}
                          placeholder="Ej: prefiere degradé bajo, alérgico a ciertos productos..."
                          rows={2}
                          disabled={!canEdit}
                          className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground/70">
                          Las observaciones también se buscan desde el buscador de arriba.
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            className="h-8"
                            disabled={
                              isSavingNotes ||
                              (editableNotes === (c.notes ?? '') &&
                                editableInstagram === (c.instagram ?? ''))
                            }
                            onClick={() => {
                              startSavingNotes(async () => {
                                const res = await updateClientNotes(
                                  c.id,
                                  editableNotes.trim() || null,
                                  editableInstagram.trim() || null
                                )
                                if (res.error) {
                                  toast.error(res.error)
                                  return
                                }
                                toast.success('Datos actualizados')
                                const notes = editableNotes.trim() || null
                                const instagram = editableInstagram.trim() || null
                                setDetailClient((prev) =>
                                  prev ? { ...prev, notes, instagram } : prev
                                )
                                setResult((prev) => ({
                                  ...prev,
                                  clients: prev.clients.map((x) =>
                                    x.id === c.id ? { ...x, notes, instagram } : x
                                  ),
                                }))
                              })
                            }}
                          >
                            <Save className="mr-1.5 size-3.5" />
                            {isSavingNotes ? 'Guardando...' : 'Guardar'}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-sm font-semibold">Historial de visitas</h3>
                        {isLoadingVisits ? (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <Badge variant="secondary" className="text-xs tabular-nums">
                            {lazyTotalCount > 0 ? lazyTotalCount : lazyVisits.length}
                          </Badge>
                        )}
                      </div>
                      <ScrollArea className="h-[320px]">
                        {isLoadingVisits && lazyVisits.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <Loader2 className="mb-2 size-6 animate-spin opacity-50" />
                            <p className="text-sm">Cargando historial...</p>
                          </div>
                        )}
                        {historialSospechoso && (
                          <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
                            <AlertTriangle className="mb-1 size-7 text-amber-400/70" />
                            <p className="text-sm text-amber-200/90">
                              No pudimos cargar el historial
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {c.globalVisitCount > 0
                                ? `Este cliente tiene ${c.globalVisitCount} ${c.globalVisitCount === 1 ? 'visita registrada' : 'visitas registradas'}.`
                                : 'Reintentá abriendo el cliente de nuevo.'}
                            </p>
                          </div>
                        )}
                        {!isLoadingVisits && lazyVisits.length === 0 && !historialSospechoso && (
                          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                            <Camera className="mb-2 size-8 opacity-30" />
                            <p className="text-sm">Sin visitas registradas</p>
                          </div>
                        )}
                        <div className="space-y-2 pr-2">
                          {lazyVisits.map((visit) => {
                            const visitPhotos = photosByVisit.get(visit.id) ?? []
                            return (
                              <div
                                key={visit.id}
                                className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">
                                      {visit.service_name ?? 'Servicio'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {visit.barber_name} &middot;{' '}
                                      {formatDateTime(visit.completed_at)}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-semibold tabular-nums">
                                      {formatCurrency(visit.amount)}
                                    </p>
                                    {!c.isWalkin && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="mt-1 h-6 border border-transparent px-2 text-[10px] text-muted-foreground hover:border-amber-500/20 hover:bg-amber-500/10 hover:text-amber-500"
                                        disabled={requestingReview === visit.id}
                                        onClick={async () => {
                                          setRequestingReview(visit.id)
                                          try {
                                            const res = await createReviewRequest(
                                              c.id,
                                              visit.branch_id,
                                              visit.id,
                                              visit.barber_id
                                            )
                                            if (res.error) {
                                              toast.error(res.error)
                                              return
                                            }
                                            const url = `${window.location.origin}/review/${res.token}`
                                            const msg = `¡Hola ${nombreVisible(c.name)}! Gracias por visitarnos en ${orgName}. Podés contarnos qué te pareció el servicio acá: ${url}`
                                            window.open(
                                              `https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`,
                                              '_blank'
                                            )
                                          } finally {
                                            setRequestingReview(null)
                                          }
                                        }}
                                      >
                                        <Star className="mr-1 size-3" />
                                        Pedir reseña
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {visit.notes && (
                                  <p className="text-xs text-muted-foreground">{visit.notes}</p>
                                )}

                                {visit.tags && visit.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {visit.tags.map((tag: string) => (
                                      <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                                        <Tag className="size-2.5" />
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}

                                {visitPhotos.length > 0 && (
                                  <div className="flex gap-2 overflow-x-auto pt-1">
                                    {visitPhotos.map((photo) => {
                                      const url = getUrl(photo.storage_path)
                                      return (
                                        <button
                                          key={photo.id}
                                          type="button"
                                          onClick={() => setEnlargedPhoto(url)}
                                          className="shrink-0"
                                        >
                                          <Image
                                            src={url}
                                            alt="Corte"
                                            width={80}
                                            height={80}
                                            className="size-20 rounded-md border object-cover transition-opacity hover:opacity-80"
                                            unoptimized
                                          />
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {lazyHasMore && (
                            <button
                              type="button"
                              disabled={isLoadingMore}
                              onClick={() => {
                                const myId = visitsReqRef.current
                                startLoadingMore(async () => {
                                  try {
                                    const res = await getClientVisits(c.id, {
                                      limit: 50,
                                      offset: lazyOffset,
                                    })
                                    if (visitsReqRef.current !== myId) return
                                    setLazyVisits((prev) => [...prev, ...res.visits])
                                    setLazyHasMore(res.hasMore)
                                    setLazyOffset((prev) => prev + 50)
                                    const newIds = res.visits.map((v) => v.id)
                                    if (newIds.length > 0) {
                                      const { data } = await supabase
                                        .from('visit_photos')
                                        .select('id, visit_id, storage_path, order_index')
                                        .in('visit_id', newIds)
                                        .order('order_index')
                                      if (visitsReqRef.current !== myId) return
                                      setPhotos((prev) => [...prev, ...(data ?? [])])
                                    }
                                  } catch {
                                    // Sin esto el botón volvía a su estado normal y el
                                    // usuario creía que ya no había más visitas.
                                    if (visitsReqRef.current !== myId) return
                                    toast.error('No pudimos cargar más visitas')
                                  }
                                })
                              }}
                              className="w-full rounded-lg border border-dashed py-2.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
                            >
                              {isLoadingMore ? (
                                <span className="flex items-center justify-center gap-1.5">
                                  <Loader2 className="size-3 animate-spin" />
                                  Cargando...
                                </span>
                              ) : (
                                `Ver más (${lazyTotalCount - lazyVisits.length} restantes)`
                              )}
                            </button>
                          )}
                        </div>
                      </ScrollArea>
                    </div>

                    <p className="text-center text-[11px] text-muted-foreground/70">
                      Cliente desde {formatDate(c.createdAt)}
                    </p>
                  </div>
                </>
              )
            })()}
        </SheetContent>
      </Sheet>

      <Dialog open={!!enlargedPhoto} onOpenChange={(open) => !open && setEnlargedPhoto(null)}>
        <DialogContent className="max-w-lg p-2">
          {enlargedPhoto && (
            <Image
              src={enlargedPhoto}
              alt="Foto ampliada"
              width={1024}
              height={1024}
              className="h-auto w-full rounded-lg"
              unoptimized
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------

function FilterToggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
          : 'border-white/[0.08] text-muted-foreground hover:border-white/20 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function SegmentTile({
  active,
  icon: Icon,
  label,
  hint,
  count,
  money,
  unknown,
  text,
  bg,
  ring,
  onClick,
}: {
  active: boolean
  icon: typeof Users
  label: string
  hint?: string
  count: number
  money?: number
  /** No pudimos leer los conteos: mostrar "—", nunca un 0 que parece un dato. */
  unknown?: boolean
  text: string
  bg: string
  ring: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={cn(
        'flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all',
        active ? cn(ring, bg) : 'border-white/[0.06] bg-zinc-900/40 hover:bg-white/[0.04]',
        count === 0 && !active && !unknown && 'opacity-50'
      )}
    >
      <div className={cn('grid size-8 shrink-0 place-items-center rounded-lg', bg)}>
        <Icon className={cn('size-4', text)} />
      </div>
      <div className="min-w-0">
        <p className="text-base font-black leading-none tabular-nums">
          {unknown ? '—' : count.toLocaleString('es-AR')}
        </p>
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        {!unknown && money !== undefined && money > 0 && (
          <p className="truncate text-[10px] tabular-nums text-muted-foreground/70">
            {formatCurrency(money)}
          </p>
        )}
      </div>
    </button>
  )
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2.5 text-center">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

function Paginacion({
  desde,
  hasta,
  total,
  page,
  totalPages,
  loading,
  onPage,
}: {
  desde: number
  hasta: number
  total: number
  page: number
  totalPages: number
  loading: boolean
  onPage: (p: number) => void
}) {
  if (total === 0) return null
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {desde.toLocaleString('es-AR')}–{hasta.toLocaleString('es-AR')} de{' '}
        <span className="font-semibold text-zinc-300">{total.toLocaleString('es-AR')}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[5.5rem] text-center text-[11px] text-muted-foreground tabular-nums">
          Pág. {page} de {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
