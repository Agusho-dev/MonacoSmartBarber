'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useBranchStore } from '@/stores/branch-store'
import { RefreshCw, Search } from 'lucide-react'

interface Branch {
  id: string
  name: string
}

interface Barber {
  id: string
  full_name: string
  branch_id: string | null
}

interface VisitHistory {
  id: string
  amount: number
  completed_at: string
  payment_method: string
  branch: { name: string } | null
  barber: { full_name: string } | null
  client: { name: string; phone: string } | null
  service: { name: string } | null
}

interface DayGroup {
  dateKey: string;
  dateObj: Date;
  visits: VisitHistory[];
  totalAmount: number;
  totalCuts: number;
  cashCuts: number;
  transferCuts: number;
  cardCuts: number;
}

interface Props {
  branches: Branch[]
  barbers: Barber[]
}

export function HistorialServicios({ branches, barbers }: Props) {
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  const [visits, setVisits] = useState<VisitHistory[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [branchId, setBranchId] = useState<string>(selectedBranchId ?? 'all')
  const [barberId, setBarberId] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')

  // Sync branch from store if not touched manually
  useEffect(() => {
    if (selectedBranchId) {
      setBranchId(selectedBranchId)
    } else {
      setBranchId('all')
    }
  }, [selectedBranchId])

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('visits')
        .select(`
          id, 
          amount, 
          completed_at, 
          payment_method, 
          branch:branches(name), 
          barber:staff(full_name), 
          client:clients(name, phone), 
          service:services(name)
        `)
        .order('completed_at', { ascending: false })
        .limit(100)

      if (branchId !== 'all') {
        q = q.eq('branch_id', branchId)
      }
      if (barberId !== 'all') {
        q = q.eq('barber_id', barberId)
      }
      if (dateFrom) {
        q = q.gte('completed_at', dateFrom + 'T00:00:00-03:00')
      }
      if (dateTo) {
        q = q.lte('completed_at', dateTo + 'T23:59:59.999-03:00')
      }

      const { data, error } = await q
      if (!error && data) {
        setVisits(data as unknown as VisitHistory[])
      }
    } finally {
      setLoading(false)
    }
  }, [supabase, branchId, barberId, dateFrom, dateTo])

  // Load initial data
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Get barbers for the selected branch filter (or all)
  const filteredBarbers = branchId !== 'all' 
    ? barbers.filter(b => b.branch_id === branchId)
    : barbers

  // Grouping logic
  const groupedVisits: DayGroup[] = []
  if (!loading && visits.length > 0) {
    let currentGroup: DayGroup | null = null
    for (const v of visits) {
      const d = new Date(v.completed_at)
      const dateKey = d.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
      if (!currentGroup || currentGroup.dateKey !== dateKey) {
        if (currentGroup) groupedVisits.push(currentGroup)
        currentGroup = {
          dateKey,
          dateObj: d,
          visits: [],
          totalAmount: 0,
          totalCuts: 0,
          cashCuts: 0,
          transferCuts: 0,
          cardCuts: 0
        }
      }
      currentGroup.visits.push(v)
      currentGroup.totalAmount += v.amount
      currentGroup.totalCuts += 1
      if (v.payment_method === 'cash') currentGroup.cashCuts += 1
      else if (v.payment_method === 'transfer') currentGroup.transferCuts += 1
      else if (v.payment_method === 'card') currentGroup.cardCuts += 1
    }
    if (currentGroup) groupedVisits.push(currentGroup)
  }

  const todayStr = new Date().toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Historial de Servicios</CardTitle>
        <CardDescription>
          Registro detallado de los últimos 100 servicios completados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label>Sucursal</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Barbero</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los barberos</SelectItem>
                {filteredBarbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Desde</Label>
            <Input 
              type="date" 
              value={dateFrom} 
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Hasta</Label>
            <Input 
              type="date" 
              value={dateTo} 
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="flex items-end space-x-2">
            <Button onClick={fetchHistory} disabled={loading} className="w-full">
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Filtrar
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Barbero</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && visits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    Cargando historial...
                  </TableCell>
                </TableRow>
              ) : visits.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No se encontraron servicios con esos filtros
                  </TableCell>
                </TableRow>
              ) : (
                groupedVisits.map((group) => {
                  const isToday = group.dateKey === todayStr
                  const dayStr = isToday ? `Hoy (${group.dateKey})` : group.dateKey
                  return (
                    <Fragment key={group.dateKey}>
                      <TableRow className="bg-white hover:bg-white">
                        <TableCell colSpan={8} className="py-2.5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="font-semibold text-black">{dayStr}</span>
                            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-neutral-600">
                              <span><strong>{group.totalCuts}</strong> {group.totalCuts === 1 ? 'corte' : 'cortes'}</span>
                              <span className="px-1">•</span>
                              <span className="font-semibold text-black">{formatCurrency(group.totalAmount)}</span>
                              <div className="flex gap-2 border-l border-neutral-300 pl-3 sm:pl-4">
                                <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">Efe: {group.cashCuts}</Badge>
                                <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">Tra: {group.transferCuts}</Badge>
                                <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">Tar: {group.cardCuts}</Badge>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                      {group.visits.map((visit) => {
                        const dateObj = new Date(visit.completed_at)
                        return (
                          <TableRow key={visit.id}>
                            <TableCell className="text-muted-foreground">
                              {dateObj.toLocaleDateString('es-AR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric'
                              })}
                            </TableCell>
                            <TableCell>
                              {dateObj.toLocaleTimeString('es-AR', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </TableCell>
                            <TableCell className="font-medium">
                              {visit.client?.name || 'Consumidor Final'}
                            </TableCell>
                            <TableCell>{visit.barber?.full_name}</TableCell>
                            <TableCell>{visit.service?.name || '-'}</TableCell>
                            <TableCell>{visit.branch?.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {visit.payment_method === 'cash' ? 'Efectivo' : visit.payment_method === 'card' ? 'Tarjeta' : visit.payment_method === 'transfer' ? 'Transferencia' : visit.payment_method}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(visit.amount)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
