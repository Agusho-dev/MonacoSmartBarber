'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, Wallet, Pencil, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { createExpenseTicket, deleteExpenseTicket, updateExpenseTicket } from '@/lib/actions/expense-tickets'
import { useBranchStore } from '@/stores/branch-store'
import type { Branch, ExpenseTicket, PaymentAccount } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

interface AccountWithBranch extends PaymentAccount {
    branch?: { name: string } | null
}

interface Props {
    expenseTickets: ExpenseTicket[]
    branches: Branch[]
    accounts: AccountWithBranch[]
}

const CATEGORIES = [
    'Insumos y Proveedores',
    'Limpieza',
    'Mantenimiento y Arreglos',
    'Comida y Bebida',
    'Varios'
]

const emptyForm = {
    amount: '',
    category: CATEGORIES[0],
    customCategory: '',
    description: '',
    branch_id: '',
    payment_account_id: '',
}

export function EgresosClient({ expenseTickets, branches, accounts }: Props) {
    const { selectedBranchId } = useBranchStore()

    // Estado del formulario
    const [dialogOpen, setDialogOpen] = useState(false)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)

    // Estado de edición
    const [editId, setEditId] = useState<string | null>(null)

    // Estado de eliminación
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    // Estado de filtros
    const [filterAccount, setFilterAccount] = useState<string>('__all__')
    const [filterYear, setFilterYear] = useState<string>('__all__')
    const [filterMonth, setFilterMonth] = useState<string>('__all__')

    // Años disponibles calculados desde los tickets
    const availableYears = useMemo(() => {
        const years = [...new Set(expenseTickets.map(t => t.expense_date.slice(0, 4)))]
        return years.sort().reverse()
    }, [expenseTickets])

    const filteredTickets = expenseTickets.filter((t) => {
        if (selectedBranchId && t.branch_id !== selectedBranchId) return false
        if (filterAccount !== '__all__') {
            if (filterAccount === '__cash__') { if (t.payment_account_id) return false }
            else if (t.payment_account_id !== filterAccount) return false
        }
        if (filterYear !== '__all__' && !t.expense_date.startsWith(filterYear)) return false
        if (filterMonth !== '__all__' && !t.expense_date.startsWith(`${filterYear}-${filterMonth}`)) return false
        return true
    })

    // Total del filtrado actual
    const filteredTotal = filteredTickets.reduce((s, t) => s + Number(t.amount), 0)

    // Categorías disponibles combinando las base y las existentes en los registros
    const availableCategories = Array.from(
        new Set([
            ...CATEGORIES,
            ...expenseTickets.map(t => t.category).filter(Boolean)
        ])
    ).sort()

    // Cuentas activas filtradas por sucursal seleccionada en el form
    const filteredAccounts = accounts.filter(a =>
        a.is_active && (form.branch_id ? a.branch_id === form.branch_id : true)
    )

    function openAdd() {
        setForm({
            ...emptyForm,
            branch_id: selectedBranchId ?? (branches[0]?.id || ''),
        })
        setEditId(null)
        setDialogOpen(true)
    }

    function openEdit(ticket: ExpenseTicket) {
        setEditId(ticket.id)
        setForm({
            amount: String(ticket.amount),
            category: CATEGORIES.includes(ticket.category) ? ticket.category : '__other__',
            customCategory: CATEGORIES.includes(ticket.category) ? '' : ticket.category,
            description: ticket.description || '',
            branch_id: ticket.branch_id,
            payment_account_id: ticket.payment_account_id || '',
        })
        setDialogOpen(true)
    }

    async function handleSave() {
        const finalCategory = form.category === '__other__' ? form.customCategory.trim() : form.category
        if (!form.amount || !finalCategory || !form.branch_id) return
        setSaving(true)

        let result
        if (editId) {
            result = await updateExpenseTicket(editId, {
                amount: Number(form.amount) || 0,
                category: finalCategory,
                description: form.description,
                expense_date: expenseTickets.find(t => t.id === editId)?.expense_date ?? new Date().toISOString().slice(0, 10),
                payment_account_id: form.payment_account_id || null,
            })
        } else {
            result = await createExpenseTicket({
                amount: Number(form.amount) || 0,
                category: finalCategory,
                description: form.description,
                branch_id: form.branch_id,
                payment_account_id: form.payment_account_id || null,
            })
        }

        if ('error' in result && result.error) {
            toast.error(result.error)
        } else {
            toast.success(editId ? 'Egreso actualizado' : 'Egreso registrado')
            setDialogOpen(false)
            setEditId(null)
        }
        setSaving(false)
    }

    async function handleDelete() {
        if (!deleteId) return
        setDeleting(true)
        const result = await deleteExpenseTicket(deleteId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Egreso eliminado')
        }
        setDeleting(false)
        setDeleteId(null)
    }

    const getBranchName = (id: string) => {
        return branches.find((b) => b.id === id)?.name ?? 'Desconocida'
    }

    const getAccountName = (ticket: ExpenseTicket) => {
        if (!ticket.payment_account_id) return '-'
        const acc = ticket.payment_account
        if (acc) return acc.name
        // Fallback: buscar en la prop accounts
        const found = accounts.find(a => a.id === ticket.payment_account_id)
        return found?.name ?? '-'
    }

    // Escapar campo CSV: envolver en comillas si contiene coma, comillas o salto de línea
    function csvField(val: string | number): string {
        const s = String(val)
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`
        }
        return s
    }

    // Exportar los tickets filtrados como CSV
    function exportToCSV() {
        const headers = ['Fecha', 'Sucursal', 'Cuenta', 'Categoría', 'Descripción', 'Monto']
        const rows = filteredTickets.map(t => [
            t.expense_date,
            getBranchName(t.branch_id),
            getAccountName(t),
            t.category,
            t.description || '',
            t.amount,
        ])
        const csvContent = [headers, ...rows].map(row => row.map(csvField).join(',')).join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `egresos.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="space-y-4 lg:space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg lg:text-xl font-bold tracking-tight">Registro de Egresos</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        {filteredTickets.length > 0
                            ? <><span className="font-medium text-foreground">{filteredTickets.length} registros · Total: {formatCurrency(filteredTotal)}</span></>
                            : 'Registrá la salida de dinero para gastos e insumos'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {/* Filtro por año */}
                    <Select value={filterYear} onValueChange={(v) => { setFilterYear(v); setFilterMonth('__all__') }}>
                        <SelectTrigger className="w-[110px] h-9">
                            <SelectValue placeholder="Año" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">Todos</SelectItem>
                            {availableYears.map(y => (
                                <SelectItem key={y} value={y}>{y}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Filtro por mes — solo visible si hay año seleccionado */}
                    {filterYear !== '__all__' && (
                        <Select value={filterMonth} onValueChange={setFilterMonth}>
                            <SelectTrigger className="w-[120px] h-9">
                                <SelectValue placeholder="Mes" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">Todos</SelectItem>
                                {[
                                    ['01', 'Enero'], ['02', 'Febrero'], ['03', 'Marzo'], ['04', 'Abril'],
                                    ['05', 'Mayo'], ['06', 'Junio'], ['07', 'Julio'], ['08', 'Agosto'],
                                    ['09', 'Septiembre'], ['10', 'Octubre'], ['11', 'Noviembre'], ['12', 'Diciembre']
                                ].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}

                    {/* Filtro por cuenta */}
                    <Select value={filterAccount} onValueChange={setFilterAccount}>
                        <SelectTrigger className="w-[160px] h-9">
                            <SelectValue placeholder="Todas las cuentas" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">Todas las cuentas</SelectItem>
                            <SelectItem value="__cash__">Efectivo</SelectItem>
                            {accounts.map((acc) => (
                                <SelectItem key={acc.id} value={acc.id}>
                                    {acc.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button variant="outline" size="sm" onClick={exportToCSV}>
                        <Download className="mr-1.5 size-3.5" />
                        Exportar CSV
                    </Button>
                    <Button onClick={openAdd}>
                        <Plus className="mr-2 size-4" />
                        Registrar egreso
                    </Button>
                </div>
            </div>

            {/* Vista desktop: tabla */}
            <div className="hidden md:block rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Sucursal</TableHead>
                            <TableHead>Cuenta</TableHead>
                            <TableHead>Registrado por</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead>Descripción</TableHead>
                            <TableHead className="text-right">Monto</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredTickets.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                    No hay egresos registrados en esta sucursal
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredTickets.map((t) => (
                                <TableRow key={t.id}>
                                    <TableCell className="whitespace-nowrap">
                                        {format(new Date(t.expense_date), "d 'de' MMMM", { locale: es })}
                                    </TableCell>
                                    <TableCell>{getBranchName(t.branch_id)}</TableCell>
                                    <TableCell>
                                        {t.payment_account_id ? (
                                            <div className="flex items-center gap-1.5">
                                                <Wallet className="size-3 text-muted-foreground" />
                                                <span className="text-sm">{getAccountName(t)}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1.5">
                                                <Wallet className="size-3 text-muted-foreground" />
                                                <span className="text-sm">Efectivo</span>
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>{t.created_by_staff?.full_name || 'Admin'}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{t.category}</Badge>
                                    </TableCell>
                                    <TableCell className="max-w-[250px] truncate">
                                        {t.description || '-'}
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-destructive">
                                        -{formatCurrency(t.amount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon-xs" onClick={() => openEdit(t)}>
                                                <Pencil className="size-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(t.id)}>
                                                <Trash2 className="size-3" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Vista mobile: cards */}
            <div className="md:hidden space-y-2">
                {filteredTickets.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                        No hay egresos registrados en esta sucursal
                    </div>
                ) : (
                    filteredTickets.map((t) => (
                        <div key={t.id} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {format(new Date(t.expense_date), "d MMM", { locale: es })}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-sm truncate">{t.description || '-'}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {getBranchName(t.branch_id)} · {t.created_by_staff?.full_name || 'Admin'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="font-medium text-sm text-destructive">-{formatCurrency(t.amount)}</span>
                                    <Button variant="ghost" size="icon-xs" onClick={() => openEdit(t)}>
                                        <Pencil className="size-3" />
                                    </Button>
                                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(t.id)}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Dialog de creación/edición */}
            <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditId(null) } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editId ? 'Editar egreso' : 'Registrar nuevo egreso'}</DialogTitle>
                        <DialogDescription>
                            Añadí los detalles del gasto a registrar en caja.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Sucursal *</Label>
                            <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v, payment_account_id: '' })} disabled={!!editId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label className="flex items-center gap-1.5">
                                <Wallet className="size-3.5" />
                                Medio de pago / Cuenta
                            </Label>
                            <Select value={form.payment_account_id} onValueChange={(v) => setForm({ ...form, payment_account_id: v === '__none__' ? '' : v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Efectivo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Efectivo</SelectItem>
                                    {filteredAccounts.map(acc => (
                                        <SelectItem key={acc.id} value={acc.id}>
                                            {acc.name}
                                            {acc.alias_or_cbu ? ` · ${acc.alias_or_cbu}` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Monto *</Label>
                            <Input
                                type="number"
                                min="0"
                                value={form.amount}
                                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                placeholder="Ej: 5000"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Categoría *</Label>
                            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v, customCategory: '' })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableCategories.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                    <SelectItem value="__other__">Otro (crear nueva)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {form.category === '__other__' && (
                            <div className="grid gap-2">
                                <Label>Nueva Categoría *</Label>
                                <Input
                                    value={form.customCategory}
                                    onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
                                    placeholder="Ej: Suscripciones"
                                    autoFocus
                                />
                            </div>
                        )}

                        <div className="grid gap-2">
                            <Label>Descripción / Motivo (opcional)</Label>
                            <Input
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder="Ej: Gasto en lavandería de toallas"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setDialogOpen(false); setEditId(null) }}>Cancelar</Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !form.amount || !form.branch_id || (form.category === '__other__' ? !form.customCategory.trim() : !form.category)}
                        >
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmación de eliminación */}
            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar egreso?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer y el monto regresará a las estadísticas del día.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={handleDelete}
                            disabled={deleting}
                        >
                            {deleting ? 'Eliminando...' : 'Eliminar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
