'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useBranchStore } from '@/stores/branch-store'
import { RefreshCw, Search, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createManualVisit, deleteVisit } from '@/lib/actions/visit-history'

interface Branch {
  id: string
  name: string
}

interface Barber {
  id: string
  full_name: string
  branch_id: string | null
}

interface ServiceOption {
  id: string
  name: string
  price: number
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
  services: ServiceOption[]
}

export function HistorialServicios({ branches, barbers, services }: Props) {
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  const [visits, setVisits] = useState<VisitHistory[]>([])
  const [loading, setLoading] = useState(false)

  // Filtros
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Dialog "Registrar servicio manualmente"
  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)

  // Campos del formulario de registro manual
  const [addBranchId, setAddBranchId] = useState<string>('')
  const [addBarberId, setAddBarberId] = useState<string>('')
  const [addServiceId, setAddServiceId] = useState<string>('')
  const [addDate, setAddDate] = useState<string>('')
  const [addTime, setAddTime] = useState<string>('')
  const [addPaymentMethod, setAddPaymentMethod] = useState<string>('cash')
  const [addPaymentAccountId, setAddPaymentAccountId] = useState<string>('')
  const [addAmount, setAddAmount] = useState<string>('')
  const [addNotes, setAddNotes] = useState<string>('')

  // Búsqueda de cliente
  const [clientSearch, setClientSearch] = useState<string>('')
  const [clientResults, setClientResults] = useState<Array<{ id: string; name: string; phone: string }>>([])
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null)
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const clientDropdownRef = useRef<HTMLDivElement>(null)

  // Sincronizar sucursal desde el store global
  useEffect(() => {
    setBranchId(selectedBranchId ?? 'all')
  }, [selectedBranchId])

  // Cerrar dropdown de cliente al hacer clic afuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
    if (paymentAccounts.length > 0) return
    const { data } = await supabase
      .from('payment_accounts')
      .select('id, name, alias_or_cbu')
      .eq('is_active', true)
      .order('name')
    setPaymentAccounts(data ?? [])
  }, [supabase, paymentAccounts.length])

  function openEdit(visit: VisitHistory) {
    setEditingVisit(visit)
    setEditPaymentMethod(visit.payment_method)
    setEditPaymentAccountId(visit.payment_account_id ?? '')
    setEditAmount(String(visit.amount))
    setEditNotes(visit.notes ?? '')
    setEditTagsInput((visit.tags ?? []).join(', '))
    if (paymentAccounts.length === 0) fetchPaymentAccounts()
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

  async function handleDelete() {
    if (!editingVisit) return
    setDeleting(true)
    const result = await deleteVisit(editingVisit.id)
    if (result.error) {
      toast.error('Error al eliminar la visita')
    } else {
      toast.success('Visita eliminada')
      setVisits((prev) => prev.filter((v) => v.id !== editingVisit.id))
      setEditingVisit(null)
      setDeleteConfirmOpen(false)
    }
    setDeleting(false)
  }

  // Búsqueda de clientes para el formulario manual
  async function searchClients(query: string) {
    if (query.length < 2) {
      setClientResults([])
      return
    }
    const { data } = await supabase
      .from('clients')
      .select('id, name, phone')
      .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
      .limit(8)
    setClientResults(data ?? [])
  }

  // Auto-completar monto cuando cambia el servicio seleccionado
  useEffect(() => {
    if (!addServiceId) return
    const svc = services.find((s) => s.id === addServiceId)
    if (svc) setAddAmount(String(svc.price))
  }, [addServiceId, services])

  // Resetear barbero y servicio cuando cambia la sucursal del formulario
  useEffect(() => {
    setAddBarberId('')
    setAddServiceId('')
  }, [addBranchId])

  // Cargar cuentas de pago cuando se selecciona transferencia
  useEffect(() => {
    if (addPaymentMethod === 'transfer') fetchPaymentAccounts()
  }, [addPaymentMethod, fetchPaymentAccounts])

  function openAddDialog() {
    const today = new Date()
    const dateStr = today.toISOString().split('T')[0]
    const hours = String(today.getHours()).padStart(2, '0')
    const mins = String(today.getMinutes()).padStart(2, '0')
    setAddDate(dateStr)
    setAddTime(`${hours}:${mins}`)
    setAddBranchId(branchId !== 'all' ? branchId : (branches[0]?.id ?? ''))
    setAddBarberId('')
    setAddServiceId('')
    setAddAmount('')
    setAddPaymentMethod('cash')
    setAddPaymentAccountId('')
    setAddNotes('')
    setSelectedClient(null)
    setClientSearch('')
    setClientResults([])
    setClientDropdownOpen(false)
    setAddOpen(true)
  }

  async function handleAddSave() {
    if (!addBranchId || !addBarberId || !addServiceId || !addDate || !addTime || !addAmount) return
    setAddSaving(true)

    // Construir ISO datetime con zona horaria de Argentina (-03:00)
    const completedAt = `${addDate}T${addTime}:00-03:00`

    const result = await createManualVisit({
      branchId: addBranchId,
      clientId: selectedClient?.id ?? null,
      barberId: addBarberId,
      serviceId: addServiceId,
      paymentMethod: addPaymentMethod as 'cash' | 'card' | 'transfer',
      paymentAccountId: addPaymentAccountId || null,
      amount: Number(addAmount),
      completedAt,
      notes: addNotes.trim() || null,
    })

    if ('error' in result) {
      toast.error('Error al registrar: ' + result.error)
    } else {
      toast.success('Servicio registrado correctamente')
      setAddOpen(false)
      fetchHistory()
    }
    setAddSaving(false)
  }

  const filteredBarbers =
    branchId !== 'all' ? barbers.filter((b) => b.branch_id === branchId) : barbers

  const addFilteredBarbers =
    addBranchId ? barbers.filter((b) => b.branch_id === addBranchId) : barbers

  const addFilteredServices = services.filter(
    (s) => s.branch_id === null || s.branch_id === addBranchId
  )

  // Agrupar visitas por día
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

  const addFormValid =
    !!addBranchId && !!addBarberId && !!addServiceId && !!addDate && !!addTime && !!addAmount

  return (
    <>
      <Card className="mt-8">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Historial de Servicios</CardTitle>
              <CardDescription>
                Últimos 100 servicios completados. Hacé clic en una fila para editarla.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Registrar servicio
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filtros */}
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

          {/* Tabla */}
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
        <SheetContent className="flex w-full flex-col !max-w-[420px] p-0 overflow-hidden">
          {editingVisit && (
            <>
              {/* Header fijo */}
              <div className="border-b px-6 py-4">
                <SheetHeader>
                  <SheetTitle className="text-base">Editar visita</SheetTitle>
                </SheetHeader>
              </div>

              {/* Contenido scrolleable */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {/* Info de solo lectura */}
                <div className="rounded-lg border bg-muted/20 divide-y text-sm">
                  {[
                    { label: 'Cliente', value: editingVisit.client?.name || 'Consumidor Final' },
                    { label: 'Barbero', value: editingVisit.barber?.full_name },
                    { label: 'Servicio', value: editingVisit.service?.name || '—' },
                    { label: 'Sucursal', value: editingVisit.branch?.name },
                    {
                      label: 'Fecha',
                      value: new Date(editingVisit.completed_at).toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      }),
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="grid grid-cols-[110px_1fr] items-start gap-2 px-4 py-2.5">
                      <span className="text-muted-foreground shrink-0">{label}</span>
                      <span className="font-medium text-right break-words">{value}</span>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Campos editables */}
                <div className="space-y-4">
                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
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
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {editPaymentAccountId &&
                        (() => {
                          const acct = paymentAccounts.find((p) => p.id === editPaymentAccountId)
                          return acct?.alias_or_cbu ? (
                            <p className="text-xs text-muted-foreground font-mono pl-1">
                              {acct.alias_or_cbu}
                            </p>
                          ) : null
                        })()}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Notas</Label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Observaciones del servicio..."
                      rows={3}
                      className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Etiquetas</Label>
                    <Input
                      value={editTagsInput}
                      onChange={(e) => setEditTagsInput(e.target.value)}
                      placeholder="Degradé, Diseño, ... (separadas por coma)"
                    />
                    <p className="text-xs text-muted-foreground">Separalas por coma</p>
                  </div>
                </div>
              </div>

              {/* Footer fijo */}
              <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                >
                  <Trash2 className="mr-1.5 size-4" />
                  Eliminar
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingVisit(null)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !editAmount}>
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm delete visit */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta visita?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar el registro de{' '}
              <strong>{editingVisit?.service?.name || 'servicio'}</strong> de{' '}
              <strong>{editingVisit?.client?.name || 'Consumidor Final'}</strong>{' '}
              ({editingVisit && new Date(editingVisit.completed_at).toLocaleString('es-AR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}).
              Esta acción no se puede deshacer y se verá reflejada en estadísticas y finanzas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog — Registrar servicio manualmente */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Registrar servicio manualmente</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Sucursal */}
            <div className="grid gap-2">
              <Label>Sucursal <span className="text-destructive">*</span></Label>
              <Select value={addBranchId} onValueChange={setAddBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná una sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Barbero */}
            <div className="grid gap-2">
              <Label>Barbero <span className="text-destructive">*</span></Label>
              <Select
                value={addBarberId}
                onValueChange={setAddBarberId}
                disabled={!addBranchId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un barbero" />
                </SelectTrigger>
                <SelectContent>
                  {addFilteredBarbers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Servicio */}
            <div className="grid gap-2">
              <Label>Servicio <span className="text-destructive">*</span></Label>
              <Select
                value={addServiceId}
                onValueChange={setAddServiceId}
                disabled={!addBranchId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un servicio" />
                </SelectTrigger>
                <SelectContent>
                  {addFilteredServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {formatCurrency(s.price)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cliente */}
            <div className="grid gap-2">
              <Label>Cliente</Label>
              <div className="relative" ref={clientDropdownRef}>
                <Input
                  value={selectedClient ? selectedClient.name : clientSearch}
                  onChange={(e) => {
                    if (selectedClient) {
                      // Al escribir luego de seleccionar, limpiar selección
                      setSelectedClient(null)
                    }
                    setClientSearch(e.target.value)
                    setClientDropdownOpen(true)
                    searchClients(e.target.value)
                  }}
                  onFocus={() => setClientDropdownOpen(true)}
                  placeholder="Buscar por nombre o teléfono..."
                />
                {clientDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {/* Opción fija: Consumidor Final */}
                    <button
                      type="button"
                      className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground text-left"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSelectedClient(null)
                        setClientSearch('')
                        setClientResults([])
                        setClientDropdownOpen(false)
                      }}
                    >
                      <span className="text-muted-foreground italic">Consumidor Final</span>
                    </button>
                    {/* Resultados de búsqueda */}
                    {clientResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground text-left"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setSelectedClient({ id: c.id, name: c.name })
                          setClientSearch('')
                          setClientResults([])
                          setClientDropdownOpen(false)
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                      </button>
                    ))}
                    {clientSearch.length >= 2 && clientResults.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Sin resultados
                      </div>
                    )}
                  </div>
                )}
              </div>
              {selectedClient && (
                <p className="text-xs text-muted-foreground">
                  Cliente seleccionado: <strong>{selectedClient.name}</strong>
                </p>
              )}
            </div>

            {/* Fecha y hora */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Fecha <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Hora <span className="text-destructive">*</span></Label>
                <Input
                  type="time"
                  value={addTime}
                  onChange={(e) => setAddTime(e.target.value)}
                />
              </div>
            </div>

            {/* Método de pago y monto */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Método de pago <span className="text-destructive">*</span></Label>
                <Select value={addPaymentMethod} onValueChange={setAddPaymentMethod}>
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
              <div className="grid gap-2">
                <Label>Monto (ARS) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={0}
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Cuenta de transferencia (solo si método es transfer) */}
            {addPaymentMethod === 'transfer' && (
              <div className="grid gap-2">
                <Label>Cuenta de transferencia</Label>
                <Select
                  value={addPaymentAccountId || 'none'}
                  onValueChange={(v) => setAddPaymentAccountId(v === 'none' ? '' : v)}
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
              </div>
            )}

            {/* Notas */}
            <div className="grid gap-2">
              <Label>Notas</Label>
              <textarea
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Observaciones del servicio..."
                rows={2}
                className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleAddSave}
              disabled={addSaving || !addFormValid}
            >
              {addSaving ? 'Guardando...' : 'Registrar servicio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
