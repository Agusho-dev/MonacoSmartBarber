'use client'

import { useMemo, useState, useEffect, useCallback, useTransition } from 'react'
import { Search, Eye, Star, Tag, Camera, Save, MessageCircle, Instagram, Plus, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { updateClientNotes } from '@/lib/actions/clients'
import { checkinClient } from '@/lib/actions/queue'
import { createReviewRequest } from '@/lib/actions/reviews'
import type { Client } from '@/lib/types/database'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface VisitRow {
  id: string
  client_id: string
  branch_id: string
  barber_id: string
  amount: number
  completed_at: string
  notes: string | null
  tags: string[] | null
  service: { name: string } | null
  barber: { full_name: string } | null
}

interface PointsRow {
  client_id: string
  points_balance: number
}

interface PhotoRow {
  id: string
  visit_id: string
  storage_path: string
  order_index: number
}

type Segment = 'nuevo' | 'regular' | 'vip' | 'en_riesgo' | 'perdido'

const segmentConfig: Record<Segment, { label: string; className: string }> = {
  nuevo: {
    label: 'Nuevo',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  regular: {
    label: 'Regular',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  vip: {
    label: 'VIP',
    className: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  },
  en_riesgo: {
    label: 'En riesgo',
    className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  },
  perdido: {
    label: 'Perdido',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
}

interface Props {
  clients: Client[]
  visits: VisitRow[]
  points: PointsRow[]
  branches: { id: string; name: string }[]
}

export function ClientesClient({ clients, visits, points, branches }: Props) {
  const { selectedBranchId } = useBranchStore()
  const supabase = useMemo(() => createClient(), [])
  const [search, setSearch] = useState('')
  const [segmentFilter, setSegmentFilter] = useState<Segment | 'all'>('all')
  const [sortBy, setSortBy] = useState<'lastVisit' | 'totalVisits' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [detailClient, setDetailClient] = useState<Client | null>(null)
  const [photos, setPhotos] = useState<PhotoRow[]>([])
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null)
  const [editableNotes, setEditableNotes] = useState('')
  const [editableInstagram, setEditableInstagram] = useState('')
  const [isSavingNotes, startSavingNotes] = useTransition()
  const [requestingReview, setRequestingReview] = useState<string | null>(null)

  const now = Date.now()
  const thirtyDaysMs = 30 * 86400000

  const pointsMap = useMemo(() => {
    const m = new Map<string, number>()
    points.forEach((p) => m.set(p.client_id, p.points_balance))
    return m
  }, [points])

  const branchVisits = useMemo(
    () =>
      selectedBranchId
        ? visits.filter((v) => v.branch_id === selectedBranchId)
        : visits,
    [visits, selectedBranchId]
  )

  const globalClientStats = useMemo(() => {
    const map = new Map<
      string,
      {
        totalVisits: number
        last30Visits: number
        lastVisitDate: string | null
      }
    >()

    visits.forEach((v) => {
      const existing = map.get(v.client_id) ?? {
        totalVisits: 0,
        last30Visits: 0,
        lastVisitDate: null,
      }
      existing.totalVisits++
      if (now - new Date(v.completed_at).getTime() <= thirtyDaysMs) {
        existing.last30Visits++
      }
      if (!existing.lastVisitDate || v.completed_at > existing.lastVisitDate) {
        existing.lastVisitDate = v.completed_at
      }
      map.set(v.client_id, existing)
    })

    return map
  }, [visits, now])

  const branchClientStats = useMemo(() => {
    if (!selectedBranchId) return globalClientStats
    const map = new Map<
      string,
      {
        totalVisits: number
        last30Visits: number
        lastVisitDate: string | null
      }
    >()

    branchVisits.forEach((v) => {
      const existing = map.get(v.client_id) ?? {
        totalVisits: 0,
        last30Visits: 0,
        lastVisitDate: null,
      }
      existing.totalVisits++
      if (now - new Date(v.completed_at).getTime() <= thirtyDaysMs) {
        existing.last30Visits++
      }
      if (!existing.lastVisitDate || v.completed_at > existing.lastVisitDate) {
        existing.lastVisitDate = v.completed_at
      }
      map.set(v.client_id, existing)
    })

    return map
  }, [branchVisits, globalClientStats, selectedBranchId, now])

  function getSegment(client: Client): Segment {
    const stats = globalClientStats.get(client.id)
    if (!stats || !stats.lastVisitDate) {
      const createdDaysAgo = Math.floor(
        (now - new Date(client.created_at).getTime()) / 86400000
      )
      return createdDaysAgo <= 30 ? 'nuevo' : 'perdido'
    }

    const daysSinceLastVisit = Math.floor(
      (now - new Date(stats.lastVisitDate).getTime()) / 86400000
    )

    if (daysSinceLastVisit >= 40) return 'perdido'
    if (daysSinceLastVisit >= 25) return 'en_riesgo'
    if (stats.last30Visits >= 4) return 'vip'
    if (stats.totalVisits >= 2) return 'regular'
    return 'nuevo'
  }

  const searchLower = search.toLowerCase()

  function toggleSort(field: 'lastVisit' | 'totalVisits') {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function SortIcon({ field }: { field: 'lastVisit' | 'totalVisits' }) {
    if (sortBy !== field) return <ArrowUpDown className="ml-1.5 size-3 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="ml-1.5 size-3" />
      : <ArrowDown className="ml-1.5 size-3" />
  }

  const filteredClients = useMemo(() => {
    let list = clients.filter((c) => {
      if (searchLower && !c.name.toLowerCase().includes(searchLower) && !c.phone.includes(searchLower)) return false
      if (segmentFilter !== 'all' && getSegment(c) !== segmentFilter) return false
      // Si hay sucursal seleccionada, mostrar solo clientes con visitas en esa sucursal
      if (selectedBranchId && !branchClientStats.has(c.id)) return false
      return true
    })

    if (sortBy) {
      list = [...list].sort((a, b) => {
        let valA: number, valB: number
        if (sortBy === 'lastVisit') {
          const dA = branchClientStats.get(a.id)?.lastVisitDate
          const dB = branchClientStats.get(b.id)?.lastVisitDate
          valA = dA ? new Date(dA).getTime() : 0
          valB = dB ? new Date(dB).getTime() : 0
        } else {
          valA = branchClientStats.get(a.id)?.totalVisits ?? 0
          valB = branchClientStats.get(b.id)?.totalVisits ?? 0
        }
        return sortDir === 'asc' ? valA - valB : valB - valA
      })
    }

    return list
  }, [clients, searchLower, segmentFilter, sortBy, sortDir, branchClientStats])

  const clientVisitHistory = useMemo(
    () =>
      detailClient
        ? branchVisits.filter((v) => v.client_id === detailClient.id)
        : [],
    [detailClient, branchVisits]
  )

  const frequentBarber = useMemo(() => {
    if (!clientVisitHistory.length) return null
    const counts = new Map<string, { name: string; count: number }>()
    for (const v of clientVisitHistory) {
      const name = v.barber?.full_name ?? '?'
      const existing = counts.get(v.barber_id) || { name, count: 0 }
      existing.count++
      counts.set(v.barber_id, existing)
    }
    let best: { name: string; count: number } | null = null
    for (const [, data] of counts) {
      if (!best || data.count > best.count) best = data
    }
    return best
  }, [clientVisitHistory])

  const loadPhotos = useCallback(
    async (visitIds: string[]) => {
      if (!visitIds.length) {
        setPhotos([])
        return
      }
      const { data } = await supabase
        .from('visit_photos')
        .select('id, visit_id, storage_path, order_index')
        .in('visit_id', visitIds)
        .order('order_index')
      setPhotos(data ?? [])
    },
    [supabase]
  )

  useEffect(() => {
    if (detailClient) {
      setEditableNotes(detailClient.notes ?? '')
      setEditableInstagram(detailClient.instagram ?? '')
      const ids = clientVisitHistory.map((v) => v.id)
      loadPhotos(ids)
    } else {
      setPhotos([])
      setEditableNotes('')
      setEditableInstagram('')
    }
  }, [detailClient, clientVisitHistory, loadPhotos])

  const photosByVisit = useMemo(() => {
    const m = new Map<string, PhotoRow[]>()
    for (const p of photos) {
      const arr = m.get(p.visit_id) || []
      arr.push(p)
      m.set(p.visit_id, arr)
    }
    return m
  }, [photos])

  function getUrl(path: string) {
    const { data } = supabase.storage.from('visit-photos').getPublicUrl(path)
    return data.publicUrl
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
          <p className="text-sm text-muted-foreground">
            Base de datos y segmentación de clientes
          </p>
        </div>
        <BranchSelector branches={branches} allowAll />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'nuevo', 'regular', 'vip', 'en_riesgo', 'perdido'] as const).map((seg) => {
            const isActive = segmentFilter === seg
            if (seg === 'all') {
              return (
                <button
                  key="all"
                  onClick={() => setSegmentFilter('all')}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'border-foreground/30 bg-foreground/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                  }`}
                >
                  Todos
                </button>
              )
            }
            const cfg = segmentConfig[seg]
            return (
              <button
                key={seg}
                onClick={() => setSegmentFilter(seg)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  isActive ? cfg.className : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                }`}
              >
                {cfg.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden sm:table-cell">Teléfono</TableHead>
              <TableHead className="text-right hidden md:table-cell">
                <button
                  onClick={() => toggleSort('totalVisits')}
                  className="inline-flex items-center justify-end w-full hover:text-foreground transition-colors"
                >
                  Total visitas
                  <SortIcon field="totalVisits" />
                </button>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <button
                  onClick={() => toggleSort('lastVisit')}
                  className="inline-flex items-center hover:text-foreground transition-colors"
                >
                  Última visita
                  <SortIcon field="lastVisit" />
                </button>
              </TableHead>
              <TableHead className="hidden lg:table-cell">Segmento</TableHead>
              <TableHead className="text-right hidden sm:table-cell">Puntos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {search
                    ? 'No se encontraron clientes'
                    : 'No hay clientes registrados'}
                </TableCell>
              </TableRow>
            )}
            {filteredClients.map((client) => {
              const displayStats = branchClientStats.get(client.id)
              const segment = getSegment(client)
              const segCfg = segmentConfig[segment]
              const pts = pointsMap.get(client.id) ?? 0

              return (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="font-mono text-sm hidden sm:table-cell">
                    {client.phone}
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    {displayStats?.totalVisits ?? 0}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {displayStats?.lastVisitDate
                      ? formatDate(displayStats.lastVisitDate)
                      : <span className="text-xs italic text-muted-foreground/60">Se retiró antes del servicio</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="outline" className={segCfg.className}>
                      {segCfg.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">{pts}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDetailClient(client)}
                    >
                      <Eye className="size-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Client profile sheet */}
      <Sheet
        open={!!detailClient}
        onOpenChange={(open) => !open && setDetailClient(null)}
      >
        <SheetContent className="w-full !max-w-[480px] overflow-y-auto p-0">
          {detailClient && (() => {
            const segment = getSegment(detailClient)
            const segCfg = segmentConfig[segment]
            const pts = pointsMap.get(detailClient.id) ?? 0
            const stats = branchClientStats.get(detailClient.id)

            return (
              <>
                {/* Header with gradient accent */}
                <div className="relative border-b bg-gradient-to-b from-white/[0.03] to-transparent px-6 pb-5 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-bold tracking-tight">
                        {detailClient.name}
                      </h2>
                      <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                        {detailClient.phone}
                      </p>
                    </div>
                    <Badge variant="outline" className={`shrink-0 ${segCfg.className}`}>
                      {segCfg.label}
                    </Badge>
                  </div>

                  {/* Stats row */}
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border bg-card/50 px-3 py-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Visitas</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {stats?.totalVisits ?? 0}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-card/50 px-3 py-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Puntos</p>
                      <p className="text-lg font-semibold tabular-nums">{pts}</p>
                    </div>
                    <div className="rounded-lg border bg-card/50 px-3 py-2.5 text-center">
                      <p className="text-xs text-muted-foreground">Cliente desde</p>
                      <p className="text-sm font-medium">{formatDate(detailClient.created_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="space-y-5 px-6 py-5">
                  {/* Action buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20 hover:text-green-400 transition-colors"
                      onClick={() => window.open(`https://wa.me/${detailClient.phone.replace(/\D/g, '')}`, '_blank')}
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
                          toast.error('Seleccioná una sucursal para añadir a la fila.')
                          return
                        }
                        const formData = new FormData()
                        formData.append('name', detailClient.name)
                        formData.append('phone', detailClient.phone)
                        formData.append('branch_id', selectedBranchId!)
                        const res = await checkinClient(formData)
                        if (res?.error) {
                          toast.error(res.error)
                        } else {
                          toast.success(`${detailClient.name} añadido a la fila`)
                        }
                      }}
                    >
                      <Plus className="mr-2 size-4" />
                      Añadir a fila
                    </Button>
                  </div>

                  {/* Frequent barber */}
                  {frequentBarber && (
                    <div className="flex items-center gap-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5 text-sm">
                      <Star className="size-4 shrink-0 text-yellow-400" />
                      <span className="text-muted-foreground">
                        Barbero habitual:{' '}
                        <strong className="text-foreground">
                          {frequentBarber.name}
                        </strong>{' '}
                        ({frequentBarber.count} visitas)
                      </span>
                    </div>
                  )}

                  {/* Instagram & Notes section */}
                  <div className="space-y-3 rounded-lg border bg-card/30 p-4">
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
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 text-xs font-medium text-muted-foreground block">
                        Observaciones internas
                      </label>
                      <textarea
                        value={editableNotes}
                        onChange={(e) => setEditableNotes(e.target.value)}
                        placeholder="Ej: Prefiere degradé bajo, alérgico a ciertos productos..."
                        rows={2}
                        className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8"
                        disabled={isSavingNotes || (editableNotes === (detailClient.notes ?? '') && editableInstagram === (detailClient.instagram ?? ''))}
                        onClick={() => {
                          startSavingNotes(async () => {
                            const result = await updateClientNotes(
                              detailClient.id,
                              editableNotes.trim() || null,
                              editableInstagram.trim() || null
                            )
                            if (result.error) {
                              toast.error(result.error)
                            } else {
                              toast.success('Datos actualizados')
                              detailClient.notes = editableNotes.trim() || null
                              detailClient.instagram = editableInstagram.trim() || null
                            }
                          })
                        }}
                      >
                        <Save className="mr-1.5 size-3.5" />
                        {isSavingNotes ? 'Guardando...' : 'Guardar'}
                      </Button>
                    </div>
                  </div>

                  {/* Visit history */}
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Historial de visitas</h3>
                      <Badge variant="secondary" className="text-xs tabular-nums">
                        {clientVisitHistory.length}
                      </Badge>
                    </div>
                    <ScrollArea className="h-[320px]">
                      {clientVisitHistory.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                          <Camera className="mb-2 size-8 opacity-30" />
                          <p className="text-sm">Sin visitas registradas</p>
                        </div>
                      )}
                      <div className="space-y-2 pr-2">
                        {clientVisitHistory.map((visit) => {
                          const visitPhotos = photosByVisit.get(visit.id) ?? []
                          return (
                            <div
                              key={visit.id}
                              className="space-y-2 rounded-lg border bg-card/30 p-3 transition-colors hover:bg-card/60"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">
                                    {visit.service?.name ?? 'Servicio'}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {visit.barber?.full_name ?? 'Barbero'}{' '}
                                    &middot; {formatDateTime(visit.completed_at)}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold tabular-nums">
                                    {formatCurrency(visit.amount)}
                                  </p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 mt-1 px-2 text-[10px] text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20"
                                    disabled={requestingReview === visit.id}
                                    onClick={async () => {
                                      setRequestingReview(visit.id)
                                      try {
                                        const res = await createReviewRequest(
                                          visit.client_id,
                                          visit.branch_id,
                                          visit.id,
                                          visit.barber_id
                                        )
                                        if (res.error) {
                                          toast.error(res.error)
                                          return
                                        }
                                        const url = `${window.location.origin}/review/${res.token}`
                                        const msg = `¡Hola ${detailClient?.name}! Gracias por visitarnos en Monaco Smart Barber. Podés contarnos qué te pareció el servicio acá: ${url}`
                                        window.open(`https://wa.me/${detailClient?.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
                                      } finally {
                                        setRequestingReview(null)
                                      }
                                    }}
                                  >
                                    <Star className="mr-1 size-3" />
                                    Pedir Reseña
                                  </Button>
                                </div>
                              </div>

                              {visit.notes && (
                                <p className="text-xs text-muted-foreground">
                                  {visit.notes}
                                </p>
                              )}

                              {visit.tags && visit.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {visit.tags.map((tag: string) => (
                                    <Badge
                                      key={tag}
                                      variant="secondary"
                                      className="gap-1 text-xs"
                                    >
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
                                        <img
                                          src={url}
                                          alt="Corte"
                                          className="size-20 rounded-md border object-cover transition-opacity hover:opacity-80"
                                        />
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </>
            )
          })()}
        </SheetContent>
      </Sheet>

      {/* Enlarged photo overlay */}
      <Dialog
        open={!!enlargedPhoto}
        onOpenChange={(open) => !open && setEnlargedPhoto(null)}
      >
        <DialogContent className="max-w-lg p-2">
          {enlargedPhoto && (
            <img
              src={enlargedPhoto}
              alt="Foto ampliada"
              className="w-full rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
