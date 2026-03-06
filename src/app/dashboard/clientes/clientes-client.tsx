'use client'

import { useMemo, useState } from 'react'
import { Search, Eye } from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface VisitRow {
  id: string
  client_id: string
  branch_id: string
  amount: number
  completed_at: string
  service: { name: string }[] | null
  barber: { full_name: string }[] | null
}

interface PointsRow {
  client_id: string
  points_balance: number
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
}

export function ClientesClient({ clients, visits, points }: Props) {
  const { selectedBranchId } = useBranchStore()
  const [search, setSearch] = useState('')
  const [detailClient, setDetailClient] = useState<Client | null>(null)

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

  const clientStats = useMemo(() => {
    const map = new Map<
      string,
      { totalVisits: number; last30Visits: number; lastVisitDate: string | null }
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
  }, [branchVisits, now])

  function getSegment(client: Client): Segment {
    const stats = clientStats.get(client.id)
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
  const filteredClients = clients.filter((c) => {
    if (!searchLower) return true
    return (
      c.name.toLowerCase().includes(searchLower) ||
      c.phone.includes(searchLower)
    )
  })

  const clientVisitHistory = useMemo(
    () =>
      detailClient
        ? branchVisits.filter((v) => v.client_id === detailClient.id)
        : [],
    [detailClient, branchVisits]
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
        <p className="text-sm text-muted-foreground">
          Base de datos y segmentación de clientes
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="text-right">Total visitas</TableHead>
              <TableHead>Última visita</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead className="text-right">Puntos</TableHead>
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
              const stats = clientStats.get(client.id)
              const segment = getSegment(client)
              const segCfg = segmentConfig[segment]
              const pts = pointsMap.get(client.id) ?? 0

              return (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {client.phone}
                  </TableCell>
                  <TableCell className="text-right">
                    {stats?.totalVisits ?? 0}
                  </TableCell>
                  <TableCell>
                    {stats?.lastVisitDate
                      ? formatDate(stats.lastVisitDate)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={segCfg.className}>
                      {segCfg.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{pts}</TableCell>
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

      <Dialog
        open={!!detailClient}
        onOpenChange={(open) => !open && setDetailClient(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailClient?.name}</DialogTitle>
          </DialogHeader>

          {detailClient && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Teléfono</p>
                  <p className="font-mono">{detailClient.phone}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Puntos</p>
                  <p className="font-medium">
                    {pointsMap.get(detailClient.id) ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cliente desde</p>
                  <p>{formatDate(detailClient.created_at)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Segmento</p>
                  <Badge
                    variant="outline"
                    className={segmentConfig[getSegment(detailClient)].className}
                  >
                    {segmentConfig[getSegment(detailClient)].label}
                  </Badge>
                </div>
              </div>

              {detailClient.notes && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Notas</p>
                  <p>{detailClient.notes}</p>
                </div>
              )}

              <Separator />

              <div>
                <p className="mb-3 text-sm font-medium">Historial de visitas</p>
                <ScrollArea className="h-[240px]">
                  {clientVisitHistory.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Sin visitas registradas
                    </p>
                  )}
                  <div className="space-y-3">
                    {clientVisitHistory.map((visit) => (
                      <div
                        key={visit.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {visit.service?.[0]?.name ?? 'Servicio'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {visit.barber?.[0]?.full_name ?? 'Barbero'} &middot;{' '}
                            {formatDateTime(visit.completed_at)}
                          </p>
                        </div>
                        <p className="text-sm font-medium">
                          {formatCurrency(visit.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
