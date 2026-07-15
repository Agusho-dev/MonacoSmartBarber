'use client'

import { useState, useMemo, useTransition } from 'react'
import { upsertPaymentAccount, togglePaymentAccount, deletePaymentAccount, getAccountBalanceSummary, getAccountMonthlyAccumulated } from '@/lib/actions/paymentAccounts'
import type { Branch, PaymentAccount } from '@/lib/types/database'
import {
  pickTransferAccount,
  accountRemaining,
  accountUsage,
  type TransferAccountState,
} from '@/lib/payment-accounts'
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
import {
  Plus,
  Pencil,
  Trash2,
  Wallet,
  Eye,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  AlertTriangle,
  CircleCheck,
  CirclePause,
  Clock,
  RefreshCw,
  Infinity as InfinityIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AccountWithBranch extends PaymentAccount {
  branch?: { name: string } | null
}

export interface AccountMonthIncome {
  monthIncome: number
  monthCount: number
}

interface Props {
  accounts: AccountWithBranch[]
  branches: Branch[]
  /** Acumulado real del mes por cuenta (derivado de transfer_logs en la DB, mig 160). */
  monthIncome: Record<string, AccountMonthIncome>
}

type BalanceSummary = Awaited<ReturnType<typeof getAccountBalanceSummary>>

const EMPTY_FORM = { id: '', branch_id: '', name: '', alias_or_cbu: '', monthly_limit: '', sort_order: '0', is_active: true, is_salary_account: false }

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** Estado de una cuenta dentro de la cadena de rotación de su sucursal. */
type RotationRole = 'receiving' | 'receiving_overflow' | 'waiting' | 'full' | 'paused'

const ROLE_STYLE: Record<RotationRole, { label: string; badge: string; dot: string }> = {
  receiving: {
    label: 'Recibiendo ahora',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    dot: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  // Todas llenas: el sistema igual cobra en la menos excedida (así lo hace la tablet).
  receiving_overflow: {
    label: 'Recibiendo — tope superado',
    badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    dot: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
  waiting: {
    label: 'En espera',
    badge: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted text-muted-foreground',
  },
  full: {
    label: 'Llegó al tope',
    badge: 'bg-destructive/15 text-destructive border-destructive/30',
    dot: 'bg-destructive/15 text-destructive',
  },
  paused: {
    label: 'Pausada',
    badge: 'bg-muted text-muted-foreground border-border',
    dot: 'bg-muted text-muted-foreground',
  },
}

/**
 * A este ritmo, ¿cuándo se llena? Texto corto o null (sin tope / sin datos).
 * La tasa es una aproximación month-to-date (ingreso del mes / días transcurridos): para una
 * cuenta que recién entró en rotación subestima el ritmo real, así que es un "a este ritmo…",
 * no una fecha exacta.
 */
function fillForecast(monthIncome: number, limit: number | null): string | null {
  if (!limit || limit <= 0) return null
  const remaining = limit - monthIncome
  if (remaining <= 0) return null

  const now = new Date()
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dailyRate = monthIncome / dayOfMonth
  if (dailyRate <= 0) return null

  const daysToFill = remaining / dailyRate
  // El guard de fin de mes va PRIMERO: si a este ritmo no llega al tope antes de que termine
  // el mes, "se llena mañana/en N días" sería engañoso (el tope se resetea el día 1).
  if (dayOfMonth + daysToFill > daysInMonth) return 'A este ritmo no se llena este mes'
  if (daysToFill < 1) return 'A este ritmo se llena hoy'
  if (daysToFill < 2) return 'A este ritmo se llena mañana'
  return `A este ritmo se llena en ${Math.round(daysToFill)} días`
}

export function CuentasClient({ accounts, branches, monthIncome }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [filterBranchId, setFilterBranchId] = useState<string>('all')
  const [, startTransition] = useTransition()
  // Cuenta cuyo borrado se bloqueó por tener historial contable (transfer_logs).
  const [blockedAccount, setBlockedAccount] = useState<{ id: string; name: string; isActive: boolean; count: number } | null>(null)

  // Balance dialog state
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false)
  const [balanceAccount, setBalanceAccount] = useState<AccountWithBranch | null>(null)
  const [balanceData, setBalanceData] = useState<BalanceSummary | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const todayStr = new Date().toISOString().slice(0, 10)
  const [balanceFrom, setBalanceFrom] = useState<string>(todayStr)
  const [balanceTo, setBalanceTo] = useState<string>(todayStr)
  // Histórico mensual: mes cerrado que el dueño quiera revisar
  const nowDate = useMemo(() => new Date(), [])
  const [histYear, setHistYear] = useState<number>(nowDate.getFullYear())
  const [histMonth, setHistMonth] = useState<number>(nowDate.getMonth() + 1)
  const [histTotal, setHistTotal] = useState<number | null>(null)
  const [histLoading, setHistLoading] = useState(false)

  const currentMonthName = MONTH_NAMES[nowDate.getMonth()]

  function incomeOf(accountId: string): number {
    return monthIncome[accountId]?.monthIncome ?? 0
  }
  function countOf(accountId: string): number {
    return monthIncome[accountId]?.monthCount ?? 0
  }

  /**
   * La cadena de rotación de cada sucursal: quién recibe ahora, quién espera, quién
   * llegó al tope. Se calcula con la MISMA regla que usa la tablet del barbero
   * (pickTransferAccount), así las dos pantallas nunca dicen cosas distintas.
   */
  const branchesInView = useMemo(() => {
    const visible = filterBranchId === 'all'
      ? branches
      : branches.filter((b) => b.id === filterBranchId)

    return visible
      .map((branch) => {
        const branchAccounts = accounts
          .filter((a) => a.branch_id === branch.id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))

        const activeStates: TransferAccountState[] = branchAccounts
          .filter((a) => a.is_active)
          .map((a) => ({
            id: a.id,
            name: a.name,
            alias_or_cbu: a.alias_or_cbu,
            sort_order: a.sort_order ?? 0,
            monthly_limit: a.monthly_limit,
            month_income: incomeOf(a.id),
            is_full: a.monthly_limit != null && incomeOf(a.id) >= a.monthly_limit,
          }))

        const pick = pickTransferAccount(activeStates)

        const roleOf = (acc: AccountWithBranch): RotationRole => {
          if (!acc.is_active) return 'paused'
          // La cuenta que efectivamente recibe: normal, o "overflow" si todas están llenas.
          if (pick.account?.id === acc.id) return pick.allFull ? 'receiving_overflow' : 'receiving'
          if (acc.monthly_limit != null && incomeOf(acc.id) >= acc.monthly_limit) return 'full'
          return 'waiting'
        }

        return {
          branch,
          accounts: branchAccounts,
          receiving: pick.account,
          allFull: pick.allFull,
          hasActive: activeStates.length > 0,
          roleOf,
        }
      })
      .filter((b) => b.accounts.length > 0 || filterBranchId !== 'all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, branches, filterBranchId, monthIncome])

  function openCreate() {
    const branchId = filterBranchId !== 'all' ? filterBranchId : branches[0]?.id ?? ''
    setForm({ ...EMPTY_FORM, branch_id: branchId })
    setDialogOpen(true)
  }

  function openEdit(acc: AccountWithBranch) {
    setForm({
      id: acc.id,
      branch_id: acc.branch_id,
      name: acc.name,
      alias_or_cbu: acc.alias_or_cbu ?? '',
      monthly_limit: acc.monthly_limit ? String(acc.monthly_limit) : '',
      sort_order: String(acc.sort_order ?? 0),
      is_active: acc.is_active,
      is_salary_account: acc.is_salary_account ?? false,
    })
    setDialogOpen(true)
  }

  async function openBalance(acc: AccountWithBranch) {
    setBalanceAccount(acc)
    setBalanceData(null)
    setBalanceDialogOpen(true)
    setBalanceFrom(todayStr)
    setBalanceTo(todayStr)
    setHistYear(nowDate.getFullYear())
    setHistMonth(nowDate.getMonth() + 1)
    setHistTotal(null)
    await loadBalance(acc.id, todayStr, todayStr)
    await loadHistorical(acc.id, nowDate.getFullYear(), nowDate.getMonth() + 1)
  }

  async function loadBalance(accountId: string, from: string, to: string) {
    setBalanceLoading(true)
    try {
      const fromISO = new Date(`${from}T00:00:00`).toISOString()
      const toISO = new Date(`${to}T23:59:59.999`).toISOString()
      const data = await getAccountBalanceSummary(accountId, { from: fromISO, to: toISO })
      setBalanceData(data)
    } catch {
      toast.error('Error al cargar el balance')
    }
    setBalanceLoading(false)
  }

  async function loadHistorical(accountId: string, year: number, month: number) {
    setHistLoading(true)
    try {
      const res = await getAccountMonthlyAccumulated(accountId, year, month)
      setHistTotal(res.total)
    } catch {
      setHistTotal(null)
    }
    setHistLoading(false)
  }

  const historyYearOptions = (() => {
    const years = [] as number[]
    for (let y = nowDate.getFullYear(); y >= nowDate.getFullYear() - 3; y--) years.push(y)
    return years
  })()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    if (form.id) fd.append('id', form.id)
    fd.append('branch_id', form.branch_id)
    fd.append('name', form.name)
    fd.append('alias_or_cbu', form.alias_or_cbu)
    if (form.monthly_limit) fd.append('monthly_limit', form.monthly_limit)
    fd.append('sort_order', form.sort_order)
    fd.append('is_active', String(form.is_active))
    fd.append('is_salary_account', String(form.is_salary_account))

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

  function handleDelete(acc: AccountWithBranch) {
    startTransition(async () => {
      const result = await deletePaymentAccount(acc.id)
      if ('blocked' in result) {
        // Tiene historial: no se borra, se ofrece desactivar (o se informa si ya está inactiva).
        setBlockedAccount({ id: acc.id, name: acc.name, isActive: acc.is_active, count: result.transferCount })
        return
      }
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Cuenta eliminada')
    })
  }

  function confirmDeactivateBlocked() {
    if (!blockedAccount) return
    const { id, name } = blockedAccount
    setBlockedAccount(null)
    startTransition(async () => {
      const result = await togglePaymentAccount(id, false)
      if (result.error) toast.error(result.error)
      else toast.success(`"${name}" quedó desactivada`)
    })
  }

  const hasAnyAccount = accounts.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Cuentas de cobro</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Los cobros por transferencia entran en la primera cuenta activa que todavía no llegó a su
            tope del mes. Cuando se llena, el sistema pasa solo a la siguiente.
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

      {!hasAnyAccount ? (
        <div className="rounded-xl border bg-card p-12 text-center">
          <Wallet className="size-10 mx-auto mb-4 text-muted-foreground" />
          <p className="font-medium">No hay cuentas configuradas</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Agregá cuentas bancarias o alias para que los barberos las usen al cerrar cada servicio.
          </p>
          <Button onClick={openCreate} variant="outline">
            <Plus className="size-4 mr-2" />
            Agregar primera cuenta
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {branchesInView.map(({ branch, accounts: branchAccounts, receiving, allFull, hasActive, roleOf }) => (
            <section key={branch.id} className="space-y-3">
              {/* Cabecera de sucursal: quién está cobrando AHORA */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {branch.name}
                </h2>
                {receiving && (
                  <p className="text-xs text-muted-foreground">
                    Cobrando en{' '}
                    <span className="font-medium text-foreground">{receiving.name}</span>
                    {allFull ? (
                      <span className="text-orange-600 dark:text-orange-400"> · todas al tope</span>
                    ) : accountRemaining(receiving) !== null ? (
                      <> · le entran {formatCurrency(accountRemaining(receiving)!)} antes del tope</>
                    ) : null}
                  </p>
                )}
              </div>

              {branchAccounts.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                  Esta sucursal no tiene cuentas de cobro.
                </div>
              ) : (
                <>
                  {/* Sin cuenta disponible: los cobros por transferencia siguen entrando igual */}
                  {!hasActive && (
                    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                      <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                      <p>
                        No hay ninguna cuenta activa en {branch.name}: los barberos no pueden cobrar por
                        transferencia. Activá al menos una.
                      </p>
                    </div>
                  )}
                  {hasActive && allFull && (
                    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                      <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                      <p>
                        Todas las cuentas activas de {branch.name} llegaron al tope del mes. Los cobros
                        siguen entrando en la menos excedida: activá otra cuenta o subí el tope.
                      </p>
                    </div>
                  )}

                  <div className="divide-y rounded-xl border bg-card">
                    {branchAccounts.map((acc) => {
                      const role = roleOf(acc)
                      const style = ROLE_STYLE[role]
                      const income = incomeOf(acc.id)
                      const count = countOf(acc.id)
                      const limit = acc.monthly_limit
                      const usage = accountUsage({ monthly_limit: limit, month_income: income })
                      const remaining = accountRemaining({ monthly_limit: limit, month_income: income })
                      const forecast = role === 'receiving' ? fillForecast(income, limit) : null

                      return (
                        <div
                          key={acc.id}
                          className={cn(
                            'flex items-center gap-4 px-5 py-4',
                            role === 'paused' && 'opacity-60'
                          )}
                        >
                          <div className={cn('flex size-10 items-center justify-center rounded-full shrink-0', style.dot)}>
                            {role === 'receiving' ? (
                              <CircleCheck className="size-5" />
                            ) : role === 'receiving_overflow' ? (
                              <RefreshCw className="size-5" />
                            ) : role === 'full' ? (
                              <AlertTriangle className="size-5" />
                            ) : role === 'paused' ? (
                              <CirclePause className="size-5" />
                            ) : (
                              <Clock className="size-5" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{acc.name}</p>
                              <Badge variant="outline" className={cn('text-xs', style.badge)}>
                                {style.label}
                              </Badge>
                              {acc.is_salary_account && (
                                <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                                  Sueldos
                                </Badge>
                              )}
                            </div>

                            {acc.alias_or_cbu ? (
                              <p className="text-sm text-muted-foreground font-mono">{acc.alias_or_cbu}</p>
                            ) : (
                              <p className="text-sm text-amber-600 dark:text-amber-400">
                                Sin alias cargado — el barbero no puede mostrarle nada al cliente
                              </p>
                            )}

                            <div className="mt-3 max-w-sm text-xs text-muted-foreground">
                              <div className="flex justify-between gap-3 mb-1.5">
                                <span>
                                  {currentMonthName}
                                  {count > 0 && <> · {count} transferencia{count === 1 ? '' : 's'}</>}
                                </span>
                                <span className="font-medium text-foreground tabular-nums">
                                  {formatCurrency(income)}
                                  {limit !== null && <> / {formatCurrency(limit)}</>}
                                </span>
                              </div>

                              {limit !== null ? (
                                <>
                                  <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                                    <div
                                      className={cn(
                                        'h-full transition-all',
                                        usage >= 1
                                          ? 'bg-destructive'
                                          : usage >= 0.9
                                            ? 'bg-orange-500'
                                            : usage >= 0.7
                                              ? 'bg-amber-500'
                                              : 'bg-emerald-500'
                                      )}
                                      style={{ width: `${Math.min(usage * 100, 100)}%` }}
                                    />
                                  </div>
                                  <p className="mt-1.5">
                                    {usage >= 1 ? (
                                      <span className="text-destructive font-medium">
                                        Tope superado por {formatCurrency(income - limit)}
                                      </span>
                                    ) : (
                                      <>
                                        <span className="text-foreground font-medium">
                                          {formatCurrency(remaining ?? 0)}
                                        </span>{' '}
                                        disponibles ({Math.round(usage * 100)}% del tope)
                                        {forecast && <> · {forecast}</>}
                                      </>
                                    )}
                                  </p>
                                </>
                              ) : (
                                <p className="flex items-center gap-1.5 text-[11px]">
                                  <InfinityIcon className="size-3.5" />
                                  Sin tope: nunca rota a la siguiente cuenta
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <Button variant="ghost" size="icon" onClick={() => openBalance(acc)} title="Ver balance">
                              <Eye className="size-4" />
                            </Button>
                            <Switch
                              checked={acc.is_active}
                              onCheckedChange={() => handleToggle(acc.id, acc.is_active)}
                              title={acc.is_active ? 'Pausar cuenta' : 'Activar cuenta'}
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
                                    Si la cuenta tiene transferencias registradas, se conserva el historial contable y vas a poder desactivarla en lugar de eliminarla. Las visitas ya imputadas mantienen su registro.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => handleDelete(acc)}
                                  >
                                    Eliminar
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>
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
                placeholder="Ej: barberia.principal"
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
                placeholder="Ej: barberia.principal o 0000003100..."
                value={form.alias_or_cbu}
                onChange={(e) => setForm((f) => ({ ...f, alias_or_cbu: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tope mensual ($)</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min={1}
                  placeholder="Ej: 500000"
                  value={form.monthly_limit}
                  onChange={(e) => setForm((f) => ({ ...f, monthly_limit: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Al alcanzarlo, el cobro pasa solo a la siguiente cuenta. Vacío = sin tope.
                </p>
              </div>
              <div>
                <Label>Orden de rotación</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  placeholder="Ej: 1"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Menor número = se usa primero.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Estado de la cuenta</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {form.is_active ? 'Activa — entra en la rotación de cobros' : 'Pausada — los barberos no la ven'}
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Cuenta de sueldos</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {form.is_salary_account
                    ? 'Se usa para pagar sueldos — filtrable en caja'
                    : 'Cuenta de cobro estándar'}
                </p>
              </div>
              <Switch
                checked={form.is_salary_account}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_salary_account: checked }))}
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

          {/* Tope del MES en curso: no depende del rango de fechas de abajo */}
          {balanceAccount && balanceAccount.monthly_limit !== null && (() => {
            const income = incomeOf(balanceAccount.id)
            const limit = balanceAccount.monthly_limit!
            const usage = accountUsage({ monthly_limit: limit, month_income: income })
            return (
              <div className="rounded-lg border p-3">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Tope de {currentMonthName}</span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(income)} / {formatCurrency(limit)}
                  </span>
                </div>
                <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all',
                      usage >= 1 ? 'bg-destructive' : usage >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500'
                    )}
                    style={{ width: `${Math.min(usage * 100, 100)}%` }}
                  />
                </div>
                {usage >= 0.8 && (
                  <p className={cn(
                    'text-xs mt-1.5 flex items-center gap-1.5',
                    usage >= 1 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                  )}>
                    <AlertTriangle className="size-3.5" />
                    {usage >= 1 ? 'Llegó al tope del mes' : 'Cerca del tope del mes'}
                  </p>
                )}
              </div>
            )
          })()}

          {/* Filtro de rango de fechas para los movimientos */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
            <div>
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={balanceFrom}
                max={balanceTo}
                onChange={(e) => setBalanceFrom(e.target.value)}
                onBlur={() => balanceAccount && loadBalance(balanceAccount.id, balanceFrom, balanceTo)}
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={balanceTo}
                min={balanceFrom}
                onChange={(e) => setBalanceTo(e.target.value)}
                onBlur={() => balanceAccount && loadBalance(balanceAccount.id, balanceFrom, balanceTo)}
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>

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
                  <p className="text-xs text-muted-foreground">Ingresos</p>
                  <p className="text-lg font-bold text-emerald-500">{formatCurrency(balanceData.totalIncome)}</p>
                </div>
                <div className="rounded-lg border bg-red-500/10 border-red-500/20 p-3 text-center">
                  <ArrowUpRight className="size-4 mx-auto mb-1 text-red-500" />
                  <p className="text-xs text-muted-foreground">Egresos</p>
                  <p className="text-lg font-bold text-red-500">{formatCurrency(balanceData.totalExpenses)}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <Wallet className="size-4 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground">Saldo est.</p>
                  <p className="text-lg font-bold">{formatCurrency(balanceData.estimatedBalance)}</p>
                </div>
              </div>

              {/* Acumulado mensual histórico */}
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">Acumulado mensual histórico</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={String(histMonth)}
                    onValueChange={(v) => {
                      const m = Number(v)
                      setHistMonth(m)
                      if (balanceAccount) loadHistorical(balanceAccount.id, histYear, m)
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(histYear)}
                    onValueChange={(v) => {
                      const y = Number(v)
                      setHistYear(y)
                      if (balanceAccount) loadHistorical(balanceAccount.id, y, histMonth)
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {historyYearOptions.map((y) => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between text-sm pt-1">
                  <span className="text-muted-foreground">Total ingresado</span>
                  <span className="font-semibold tabular-nums">
                    {histLoading ? '…' : formatCurrency(histTotal ?? 0)}
                  </span>
                </div>
              </div>

              {/* Recent movements */}
              <div>
                <p className="text-sm font-medium mb-2">Movimientos del rango</p>
                {balanceData.transfers.length === 0 && balanceData.expenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No hay movimientos en el rango</p>
                ) : (
                  <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                    {balanceData.transfers.map((t) => {
                      const visit = t.visit as { client?: { name: string } | null; barber?: { full_name: string } | null } | null
                      const tip = Number(t.tip_amount ?? 0)
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
                              {tip > 0 && <> · incluye {formatCurrency(tip)} de propina</>}
                            </p>
                          </div>
                        </div>
                        <span className="text-sm font-medium text-emerald-500 shrink-0 tabular-nums">
                          +{formatCurrency(Number(t.amount) + tip)}
                        </span>
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
                        <span className="text-sm font-medium text-red-500 shrink-0 tabular-nums">-{formatCurrency(e.amount)}</span>
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

      {/* Borrado bloqueado por historial contable → ofrecer desactivar (o informar) */}
      <AlertDialog open={!!blockedAccount} onOpenChange={(open) => { if (!open) setBlockedAccount(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No se puede eliminar esta cuenta</AlertDialogTitle>
            <AlertDialogDescription>
              {blockedAccount && (blockedAccount.isActive ? (
                <>
                  <span className="font-medium text-foreground">{blockedAccount.name}</span> tiene{' '}
                  {blockedAccount.count.toLocaleString('es-AR')} transferencia{blockedAccount.count === 1 ? '' : 's'} registrada{blockedAccount.count === 1 ? '' : 's'}. Eliminarla borraría ese historial de balances, caja y comprobantes.{' '}
                  En su lugar podés <span className="font-medium text-foreground">desactivarla</span>: deja de ofrecerse a los barberos al cobrar y conserva todos los registros.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{blockedAccount.name}</span> ya está desactivada y tiene{' '}
                  {blockedAccount.count.toLocaleString('es-AR')} transferencia{blockedAccount.count === 1 ? '' : 's'} registrada{blockedAccount.count === 1 ? '' : 's'}. Se conserva por el historial contable de balances, caja y comprobantes, por eso no puede eliminarse.
                </>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {blockedAccount?.isActive ? (
              <>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeactivateBlocked}>
                  Desactivar cuenta
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={() => setBlockedAccount(null)}>
                Entendido
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
