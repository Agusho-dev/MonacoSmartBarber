'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { upsertFixedExpense, deleteFixedExpense } from '@/lib/actions/finances'
import { useBranchStore } from '@/stores/branch-store'
import type { Branch } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

interface FixedExpenseRow {
    id: string
    branch_id: string
    name: string
    category: string | null
    amount: number
    is_active: boolean
    due_day?: number | null    // día de vencimiento del mes
    created_at: string
    updated_at: string
    branch?: { name: string } | null
}

interface Props {
    fixedExpenses: FixedExpenseRow[]
    branches: Branch[]
}

const CATEGORIES = [
    'Alquiler',
    'Servicios (luz, agua, gas)',
    'Internet y Telefonía',
    'Seguros',
    'Impuestos',
    'Software y Suscripciones',
    'Contabilidad',
    'Varios',
]

const emptyForm = {
    id: '',
    name: '',
    category: '',
    amount: '',
    branch_id: '',
    is_active: true,
    due_day: '',    // string vacío para el input de número
}

export function GastosFijosClient({ fixedExpenses, branches }: Props) {
    const { selectedBranchId } = useBranchStore()

    const [dialogOpen, setDialogOpen] = useState(false)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const filtered = selectedBranchId
        ? fixedExpenses.filter(e => e.branch_id === selectedBranchId)
        : fixedExpenses

    const totalActive = filtered
        .filter(e => e.is_active)
        .reduce((s, e) => s + Number(e.amount), 0)

    function openAdd() {
        setForm({
            ...emptyForm,
            branch_id: selectedBranchId ?? (branches[0]?.id || ''),
        })
        setDialogOpen(true)
    }

    function openEdit(expense: FixedExpenseRow) {
        setForm({
            id: expense.id,
            name: expense.name,
            category: expense.category ?? '',
            amount: String(expense.amount),
            branch_id: expense.branch_id,
            is_active: expense.is_active,
            due_day: expense.due_day != null ? String(expense.due_day) : '',
        })
        setDialogOpen(true)
    }

    async function handleSave() {
        if (!form.name.trim() || !form.amount || !form.branch_id) return

        // Validar due_day entre 1 y 31 si fue ingresado
        const dueDayNum = form.due_day ? Number(form.due_day) : null
        if (dueDayNum !== null && (isNaN(dueDayNum) || dueDayNum < 1 || dueDayNum > 31)) {
            toast.error('El día de vencimiento debe ser un número entre 1 y 31')
            return
        }

        setSaving(true)

        const result = await upsertFixedExpense({
            id: form.id || undefined,
            branch_id: form.branch_id,
            name: form.name.trim(),
            category: form.category || null,
            amount: Number(form.amount),
            due_day: dueDayNum,
            is_active: form.is_active,
        })

        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success(form.id ? 'Gasto fijo actualizado' : 'Gasto fijo creado')
            setDialogOpen(false)
        }
        setSaving(false)
    }

    async function handleDelete() {
        if (!deleteId) return
        setDeleting(true)
        const result = await deleteFixedExpense(deleteId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Gasto fijo eliminado')
        }
        setDeleting(false)
        setDeleteId(null)
    }

    const getBranchName = (id: string) =>
        branches.find(b => b.id === id)?.name ?? 'Desconocida'

    return (
        <div className="space-y-4 lg:space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg lg:text-xl font-bold tracking-tight">Gastos Fijos</h2>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                        Total activo: <span className="font-medium text-foreground">{formatCurrency(totalActive)}/mes</span>
                    </p>
                </div>
                <Button onClick={openAdd} size="sm" className="w-full sm:w-auto">
                    <Plus className="mr-2 size-4" />
                    Agregar gasto fijo
                </Button>
            </div>

            {/* Vista desktop */}
            <div className="hidden md:block rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Sucursal</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead className="text-right">Monto/mes</TableHead>
                            <TableHead className="text-right">Vence día</TableHead>
                            <TableHead className="text-center">Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    No hay gastos fijos registrados
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((expense) => (
                                <TableRow key={expense.id} className={!expense.is_active ? 'opacity-50' : ''}>
                                    <TableCell className="font-medium">{expense.name}</TableCell>
                                    <TableCell>{expense.branch?.name ?? getBranchName(expense.branch_id)}</TableCell>
                                    <TableCell>
                                        {expense.category ? (
                                            <Badge variant="outline">{expense.category}</Badge>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {formatCurrency(expense.amount)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {expense.due_day != null ? (
                                            <span className="text-sm">día {expense.due_day}</span>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {expense.is_active ? (
                                            <CheckCircle2 className="mx-auto size-4 text-green-500" />
                                        ) : (
                                            <XCircle className="mx-auto size-4 text-muted-foreground" />
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon-xs" onClick={() => openEdit(expense)}>
                                                <Pencil className="size-3" />
                                            </Button>
                                            <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(expense.id)}>
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

            {/* Vista mobile */}
            <div className="md:hidden space-y-2">
                {filtered.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                        No hay gastos fijos registrados
                    </div>
                ) : (
                    filtered.map((expense) => (
                        <div key={expense.id} className={`rounded-lg border p-3 ${!expense.is_active ? 'opacity-50' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm">{expense.name}</p>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        <span className="text-xs text-muted-foreground">{expense.branch?.name ?? getBranchName(expense.branch_id)}</span>
                                        {expense.category && <Badge variant="outline" className="text-[10px]">{expense.category}</Badge>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="font-medium text-sm">{formatCurrency(expense.amount)}</span>
                                    <Button variant="ghost" size="icon-xs" onClick={() => openEdit(expense)}>
                                        <Pencil className="size-3" />
                                    </Button>
                                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(expense.id)}>
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            </div>
                            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                                {expense.due_day != null && <span>Vence día {expense.due_day}</span>}
                                <span>{expense.is_active ? 'Activo' : 'Inactivo'}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Dialog de creación/edición */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{form.id ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}</DialogTitle>
                        <DialogDescription>
                            Los gastos fijos se aplican mensualmente al cálculo financiero.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Sucursal *</Label>
                            <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
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
                            <Label>Nombre *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Ej: Alquiler local"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Categoría</Label>
                            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Sin categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Monto mensual *</Label>
                            <Input
                                type="number"
                                min="0"
                                value={form.amount}
                                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                placeholder="Ej: 150000"
                            />
                        </div>

                        {/* Campo de día de vencimiento */}
                        <div className="grid gap-2">
                            <Label>Día de vencimiento (opcional)</Label>
                            <Input
                                type="number"
                                min="1"
                                max="31"
                                value={form.due_day}
                                onChange={(e) => setForm({ ...form, due_day: e.target.value })}
                                placeholder="Ej: 10 (día del mes en que vence)"
                            />
                        </div>

                        {form.id && (
                            <div className="flex items-center gap-3">
                                <Switch
                                    checked={form.is_active}
                                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                                />
                                <Label>{form.is_active ? 'Activo' : 'Inactivo'}</Label>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !form.name.trim() || !form.amount || !form.branch_id}
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
                        <AlertDialogTitle>¿Eliminar gasto fijo?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se eliminará permanentemente este gasto fijo del cálculo financiero mensual.
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
