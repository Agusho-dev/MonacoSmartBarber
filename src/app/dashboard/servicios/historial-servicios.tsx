'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useBranchStore } from '@/stores/branch-store'
import { RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

interface Branch {
  id: string
  name: string
}

interface Barber {
  id: string
  full_name: string
  branch_id: string | null
}

interface PaymentAccountOption {
  id: string
  name: string
  alias_or_cbu: string | null
}

interface VisitHistory {
  id: string
  amount: number
  completed_at: string
  payment_method: string
  payment_account_id: string | null
  notes: string | null
  tags: string[] | null
  branch: { name: string } | null
  barber: { full_name: string } | null
  client: { name: string; phone: string } | null
  service: { name: string } | null
  payment_account: PaymentAccountOption | null
}

interface DayGroup {
  dateKey: string
  dateObj: Date
  visits: VisitHistory[]
  totalAmount: number
  totalCuts: number
  cashCuts: number
  transferCuts: number
  cardCuts: number
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

  // Edit sheet
  const [editingVisit, setEditingVisit] = useState<VisitHistory | null>(null)
  const [editPaymentMethod, setEditPaymentMethod] = useState('')
  const [editPaymentAccountId, setEditPaymentAccountId] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editTagsInput, setEditTagsInput] = useState('')
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([])
  const [saving, setSaving] = useState(false)

  // Sync branch from store
  useEffect(() => {
    setBranchId(selectedBranchId ?? 'all')
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
          payment_account_id,
          notes,
          tags,
          branch:branches(name),
          barber:staff(full_name),
          client:clients(name, phone),
          service:services(name),
          payment_account:payment_accounts(id, name, alias_or_cbu)
        `)
        .order('completed_at', { ascending: false })
        .limit(100)

      if (branchId !== 'all') q = q.eq('branch_id', branchId)
      if (barberId !== 'all') q = q.eq('barber_id', barberId)
      if (dateFrom) q = q.gte('completed_at', dateFrom + 'T00:00:00-03:00')
      if (dateTo) q = q.lte('completed_at', dateTo + 'T23:59:59.999-03:00')

      const { data, error } = await q
      if (!error && data) setVisits(data as unknown as VisitHistory[])
    } finally {
      setLoading(false)
    }
  }, [supabase, branchId, barberId, dateFrom, dateTo])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const fetchPaymentAccounts = useCallback(async () => {
    const { data } = await supabase
      .from('payment_accounts')
      .select('id, name, alias_or_cbu')
      .eq('is_active', true)
      .order('name')
    setPaymentAccounts(data ?? [])
  }, [supabase])

  function openEdit(visit: VisitHistory) {
    setEditingVisit(visit)
    setEditPaymentMethod(visit.payment_method)
    setEditPaymentAccountId(visit.payment_account_id ?? '')
    setEditAmount(String(visit.amount))
    setEditNotes(visit.notes ?? '')
    setEditTagsInput((visit.tags ?? []).join(', '))
    fetchPaymentAccounts()
  }

  async function handleSave() {
    if (!editingVisit) return
    setSaving(true)

    const tags = editTagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const { error } = await supabase
      .from('visits')
      .update({
        payment_method: editPaymentMethod,
        payment_account_id: editPaymentAccountId || null,
        amount: Number(editAmount),
        notes: editNotes.trim() || null,
        tags: tags.length > 0 ? tags : null,
      })
      .eq('id', editingVisit.id)

    if (error) {
      toast.error('Error al guardar los cambios')
    } else {
      toast.success('Visita actualizada')
      const updatedAccount = editPaymentAccountId
        ? (paymentAccounts.find((p) => p.id === editPaymentAccountId) ?? null)
        : null
      setVisits((prev) =>
        prev.map((v) =>
          v.id === editingVisit.id
            ? {
                ...v,
                payment_method: editPaymentMethod,
                payment_account_id: editPaymentAccountId || null,
                amount: Number(editAmount),
                notes: editNotes.trim() || null,
                tags: tags.length > 0 ? tags : null,
                payment_account: updatedAccount,
              }
            : v
        )
      )
      setEditingVisit(null)
    }
    setSaving(false)
  }

  const filteredBarbers =
    branchId !== 'all' ? barbers.filter((b) => b.branch_id === branchId) : barbers

  // Group by day
  const groupedVisits: DayGroup[] = []
  if (!loading && visits.length > 0) {
    let currentGroup: DayGroup | null = null
    for (const v of visits) {
      const d = new Date(v.completed_at)
      const dateKey = d.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
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
          cardCuts: 0,
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
    year: 'numeric',
  })

  function paymentLabel(method: string) {
    if (method === 'cash') return 'Efectivo'
    if (method === 'card') return 'Tarjeta'
    if (method === 'transfer') return 'Transferencia'
    return method
  }

  return (
    <>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Historial de Servicios</CardTitle>
          <CardDescription>
            Últimos 100 servicios completados. Hacé clic en una fila para editarla.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters */}
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
            <div className="flex items-end">
              <Button onClick={fetchHistory} disabled={loading} className="w-full">
                {loading ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Filtrar
              </Button>
            </div>
          </div>

          {/* Table */}
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
                  <TableHead>Método / Alias</TableHead>
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
                                <span>
                                  <strong>{group.totalCuts}</strong>{' '}
                                  {group.totalCuts === 1 ? 'corte' : 'cortes'}
                                </span>
                                <span className="px-1">•</span>
                                <span className="font-semibold text-black">
                                  {formatCurrency(group.totalAmount)}
                                </span>
                                <div className="flex gap-2 border-l border-neutral-300 pl-3 sm:pl-4">
                                  <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">
                                    Efe: {group.cashCuts}
                                  </Badge>
                                  <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">
                                    Tra: {group.transferCuts}
                                  </Badge>
                                  <Badge variant="secondary" className="text-[11px] font-normal px-1.5 py-0 bg-neutral-100 text-neutral-700">
                                    Tar: {group.cardCuts}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                        {group.visits.map((visit) => {
                          const dateObj = new Date(visit.completed_at)
                          return (
                            <TableRow
                              key={visit.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => openEdit(visit)}
                            >
                              <TableCell className="text-muted-foreground">
                                {dateObj.toLocaleDateString('es-AR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                })}
                              </TableCell>
                              <TableCell>
                                {dateObj.toLocaleTimeString('es-AR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </TableCell>
                              <TableCell className="font-medium">
                                {visit.client?.name || 'Consumidor Final'}
                              </TableCell>
                              <TableCell>{visit.barber?.full_name}</TableCell>
                              <TableCell>{visit.service?.name || '—'}</TableCell>
                              <TableCell>{visit.branch?.name}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-0.5">
                                  <Badge variant="outline" className="w-fit capitalize">
                                    {paymentLabel(visit.payment_method)}
                                  </Badge>
                                  {visit.payment_method === 'transfer' &&
                                    visit.payment_account?.alias_or_cbu && (
                                      <span className="text-xs text-muted-foreground font-mono">
                                        {visit.payment_account.alias_or_cbu}
                                      </span>
                                    )}
                                </div>
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

      {/* Edit sheet */}
      <Sheet open={!!editingVisit} onOpenChange={(open) => !open && setEditingVisit(null)}>
        <SheetContent className="w-full !max-w-[440px] overflow-y-auto">
          {editingVisit && (
            <div className="space-y-5 pt-2">
              <SheetHeader>
                <SheetTitle>Editar visita</SheetTitle>
              </SheetHeader>

              {/* Info de solo lectura */}
              <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="font-medium">
                    {editingVisit.client?.name || 'Consumidor Final'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Barbero</span>
                  <span>{editingVisit.barber?.full_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Servicio</span>
                  <span>{editingVisit.service?.name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sucursal</span>
                  <span>{editingVisit.branch?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fecha</span>
                  <span>
                    {new Date(editingVisit.completed_at).toLocaleString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Campos editables */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Método de pago</Label>
                    <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Efectivo</SelectItem>
                        <SelectItem value="transfer">Transferencia</SelectItem>
                        <SelectItem value="card">Tarjeta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Monto</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                    />
                  </div>
                </div>

                {editPaymentMethod === 'transfer' && (
                  <div className="space-y-2">
                    <Label>Cuenta de transferencia</Label>
                    <Select
                      value={editPaymentAccountId || 'none'}
                      onValueChange={(v) => setEditPaymentAccountId(v === 'none' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin cuenta asignada" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin cuenta asignada</SelectItem>
                        {paymentAccounts.map((pa) => (
                          <SelectItem key={pa.id} value={pa.id}>
                            {pa.name}
                            {pa.alias_or_cbu && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                — {pa.alias_or_cbu}
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {editPaymentAccountId &&
                      (() => {
                        const acct = paymentAccounts.find((p) => p.id === editPaymentAccountId)
                        return acct?.alias_or_cbu ? (
                          <p className="text-xs text-muted-foreground font-mono">
                            Alias / CBU: {acct.alias_or_cbu}
                          </p>
                        ) : null
                      })()}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Notas</Label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Observaciones del servicio..."
                    rows={2}
                    className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Etiquetas</Label>
                  <Input
                    value={editTagsInput}
                    onChange={(e) => setEditTagsInput(e.target.value)}
                    placeholder="Degradé, Diseño, ... (separadas por coma)"
                  />
                  <p className="text-xs text-muted-foreground">Separalas por coma</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditingVisit(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} disabled={saving || !editAmount}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
