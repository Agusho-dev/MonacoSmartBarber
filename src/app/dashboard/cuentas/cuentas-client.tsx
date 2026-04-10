'use client'

import { useState, useTransition } from 'react'
import { upsertPaymentAccount, togglePaymentAccount, deletePaymentAccount, getAccountBalanceSummary } from '@/lib/actions/paymentAccounts'
import type { Branch, PaymentAccount } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Pencil, Trash2, Wallet, Eye, ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'

interface AccountWithBranch extends PaymentAccount {
  branch?: { name: string } | null
}

interface Props {
  accounts: AccountWithBranch[]
  branches: Branch[]
}

type BalanceSummary = Awaited<ReturnType<typeof getAccountBalanceSummary>>

const EMPTY_FORM = { id: '', branch_id: '', name: '', alias_or_cbu: '', daily_limit: '', sort_order: '0', is_active: true }

export function CuentasClient({ accounts, branches }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filterBranchId, setFilterBranchId] = useState<string>('all')
  const [, startTransition] = useTransition()

  const filteredAccounts = filterBranchId === 'all'
    ? accounts
    : accounts.filter((a) => a.branch_id === filterBranchId)

  // Balance dialog state
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const [balanceAccount, setBalanceAccount] = useState<AccountWithBranch | null>(null)
  const [balanceData, setBalanceData] = useState<BalanceSummary | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  function openCreate() {
    setForm({ ...EMPTY_FORM, branch_id: branches[0]?.id ?? '' })
    setDialogOpen(true)
  }

  function openEdit(acc: AccountWithBranch) {
    setForm({
      id: acc.id,
      branch_id: acc.branch_id,
      name: acc.name,
      alias_or_cbu: acc.alias_or_cbu ?? '',
      daily_limit: acc.daily_limit ? String(acc.daily_limit) : '',
      sort_order: String(acc.sort_order ?? 0),
      is_active: acc.is_active,
    })
    setDialogOpen(true)
  }

  async function openBalance(acc: AccountWithBranch) {
    setBalanceAccount(acc)
    setBalanceData(null)
    setBalanceDialogOpen(true)
    setBalanceLoading(true)
    try {
      const data = await getAccountBalanceSummary(acc.id)
      setBalanceData(data)
    } catch {
      toast.error('Error al cargar el balance')
    }
    setBalanceLoading(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    if (form.id) fd.append('id', form.id)
    fd.append('branch_id', form.branch_id)
    fd.append('name', form.name)
    fd.append('alias_or_cbu', form.alias_or_cbu)
    if (form.daily_limit) fd.append('daily_limit', form.daily_limit)
    fd.append('sort_order', form.sort_order)
    fd.append('is_active', String(form.is_active))

    startTransition(async () => {
      const result = await upsertPaymentAccount(fd)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(form.id ? 'Cuenta actualizada' : 'Cuenta creada')
        setDialogOpen(false)
      }
    })
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const result = await togglePaymentAccount(id, !current)
      if (result.error) toast.error(result.error)
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePaymentAccount(id)
      if (result.error) toast.error(result.error)
      else toast.success('Cuenta eliminada')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cuentas de cobro</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá los alias y CBUs disponibles para que los barberos puedan imputar cobros.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4 mr-2" />
          Nueva cuenta
        </Button>
      </div>

      <div className="space-y-2 max-w-xs">
        <Label>Sucursal</Label>
        <Select value={filterBranchId} onValueChange={setFilterBranchId}>
          <SelectTrigger>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sucursales</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredAccounts.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Wallet className="size-10 mx-auto mb-4 text-muted-foreground" />
          <p className="font-medium">
            {filterBranchId === 'all' ? 'No hay cuentas configuradas' : 'No hay cuentas en esta sucursal'}
          </p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {filterBranchId === 'all'
              ? 'Agregá cuentas bancarias o alias para que los barberos las usen al cerrar cada servicio.'
              : 'Elegí otra sucursal o creá una cuenta nueva para esta.'}
          </p>
          <Button onClick={openCreate} variant="outline">
            <Plus className="size-4 mr-2" />
            {filterBranchId === 'all' ? 'Agregar primera cuenta' : 'Agregar cuenta'}
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {filteredAccounts.map((acc) => (
            <div key={acc.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted shrink-0">
                <Wallet className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{acc.name}</p>
                  {!acc.is_active && (
                    <Badge variant="secondary" className="text-xs">Inactiva</Badge>
                  )}
                </div>
                {acc.alias_or_cbu && (
                  <p className="text-sm text-muted-foreground font-mono">{acc.alias_or_cbu}</p>
                )}
                <div className="flex gap-2 items-center mt-1">
                  <Badge variant="outline" className="text-xs">Orden: {acc.sort_order}</Badge>
                </div>
                {acc.daily_limit !== null && (
                  <div className="mt-3 text-xs text-muted-foreground max-w-[240px]">
                    <div className="flex justify-between mb-1.5">
                      <span>Acumulado hoy:</span>
                      <span className="font-medium text-foreground">{formatCurrency(acc.accumulated_today ?? 0)} / {formatCurrency(acc.daily_limit)}</span>
                    </div>
                    <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${((acc.accumulated_today ?? 0) / acc.daily_limit) >= 1 ? 'bg-destructive' : 'bg-primary'}`}
                        style={{ width: `${Math.min(((acc.accumulated_today ?? 0) / acc.daily_limit) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {acc.branch && (
                  <p className="text-xs text-muted-foreground mt-1.5">{acc.branch.name}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => openBalance(acc)} title="Ver balance">
                  <Eye className="size-4" />
                </Button>
                <Switch
                  checked={acc.is_active}
                  onCheckedChange={() => handleToggle(acc.id, acc.is_active)}
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(acc)}>
                  <Pencil className="size-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar cuenta?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Las visitas ya imputadas a esta cuenta conservarán el registro.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => handleDelete(acc.id)}
                      >
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar cuenta' : 'Nueva cuenta de cobro'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Sucursal</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Seleccionar sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nombre de la cuenta</Label>
              <Input
                className="mt-1.5"
                placeholder="Ej: monaco.barber.1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>
                Alias o CBU{' '}
                <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                className="mt-1.5 font-mono"
                placeholder="Ej: monaco.barber.uno o 0000003100..."
                value={form.alias_or_cbu}
                onChange={(e) => setForm((f) => ({ ...f, alias_or_cbu: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Límite Diario ($) <span className="text-muted-foreground">(opcional)</span></Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  placeholder="Ej: 50000"
                  value={form.daily_limit}
                  onChange={(e) => setForm((f) => ({ ...f, daily_limit: e.target.value }))}
                />
              </div>
              <div>
                <Label>Orden de prioridad</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  placeholder="Ej: 1"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Estado de la cuenta</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {form.is_active ? 'Activa — visible para barberos' : 'Inactiva — oculta para barberos'}
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!form.name || !form.branch_id}>
                {form.id ? 'Guardar cambios' : 'Crear cuenta'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Balance Dialog */}
      <Dialog open={balanceDialogOpen} onOpenChange={setBalanceDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="size-5" />
              Balance: {balanceAccount?.name}
            </DialogTitle>
            {balanceAccount?.alias_or_cbu && (
              <p className="text-sm text-muted-foreground font-mono">{balanceAccount.alias_or_cbu}</p>
            )}
          </DialogHeader>

          {balanceLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : balanceData ? (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-emerald-500/10 border-emerald-500/20 p-3 text-center">
                  <ArrowDownRight className="size-4 mx-auto mb-1 text-emerald-500" />
                  <p className="text-xs text-muted-foreground">Ingresos hoy</p>
                  <p className="text-lg font-bold text-emerald-500">{formatCurrency(balanceData.totalIncome)}</p>
                </div>
                <div className="rounded-lg border bg-red-500/10 border-red-500/20 p-3 text-center">
                  <ArrowUpRight className="size-4 mx-auto mb-1 text-red-500" />
                  <p className="text-xs text-muted-foreground">Egresos hoy</p>
                  <p className="text-lg font-bold text-red-500">{formatCurrency(balanceData.totalExpenses)}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Wallet className="size-4 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground">Saldo est.</p>
                  <p className="text-lg font-bold">{formatCurrency(balanceData.estimatedBalance)}</p>
                </div>
              </div>

              {/* Daily limit progress */}
              {balanceAccount?.daily_limit !== null && balanceAccount?.daily_limit !== undefined && (
                <div className="rounded-lg border p-3">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Tope diario</span>
                    <span className="font-medium">{formatCurrency(balanceData.totalIncome)} / {formatCurrency(balanceAccount.daily_limit)}</span>
                  </div>
                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${(balanceData.totalIncome / balanceAccount.daily_limit) >= 1 ? 'bg-destructive' : (balanceData.totalIncome / balanceAccount.daily_limit) >= 0.8 ? 'bg-yellow-500' : 'bg-primary'}`}
                      style={{ width: `${Math.min((balanceData.totalIncome / balanceAccount.daily_limit) * 100, 100)}%` }}
                    />
                  </div>
                  {(balanceData.totalIncome / balanceAccount.daily_limit) >= 0.8 && (
                    <p className="text-xs text-yellow-500 mt-1.5">
                      {(balanceData.totalIncome / balanceAccount.daily_limit) >= 1
                        ? '⚠️ Tope diario alcanzado'
                        : '⚠️ Próximo al tope diario'}
                    </p>
                  )}
                </div>
              )}

              {/* Recent movements */}
              <div>
                <p className="text-sm font-medium mb-2">Movimientos del día</p>
                {balanceData.transfers.length === 0 && balanceData.expenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No hay movimientos hoy</p>
                ) : (
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                    {balanceData.transfers.map((t) => {
                      const visit = t.visit as { client?: { name: string } | null; barber?: { full_name: string } | null } | null
                      return (
                      <div key={`t-${t.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <ArrowDownRight className="size-4 text-emerald-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {visit?.client?.name ?? 'Cliente'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {visit?.barber?.full_name ?? 'Barbero'} · {new Date(t.transferred_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-emerald-500 shrink-0">+{formatCurrency(t.amount)}</span>
                      </div>
                      )
                    })}
                    {balanceData.expenses.map((e) => {
                      const staffRaw = e.created_by_staff as unknown
                      const staff = (Array.isArray(staffRaw) ? staffRaw[0] : staffRaw) as { full_name: string } | null | undefined
                      return (
                      <div key={`e-${e.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <ArrowUpRight className="size-4 text-red-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {e.category}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {staff?.full_name ?? 'Admin'} · {e.description ?? 'Sin descripción'}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-red-500 shrink-0">-{formatCurrency(e.amount)}</span>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
