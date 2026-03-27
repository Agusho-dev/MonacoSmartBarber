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
        })
        setDialogOpen(true)
    }

    async function handleSave() {
        if (!form.name.trim() || !form.amount || !form.branch_id) return
        setSaving(true)

        const result = await upsertFixedExpense({
            id: form.id || undefined,
            branch_id: form.branch_id,
            name: form.name.trim(),
            category: form.category || null,
            amount: Number(form.amount),
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
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Gastos Fijos</h2>
                    <p className="text-sm text-muted-foreground">
                        Gastos recurrentes mensuales — Total activo: {formatCurrency(totalActive)}/mes
                    </p>
                </div>
                <Button onClick={openAdd}>
                    <Plus className="mr-2 size-4" />
                    Agregar gasto fijo
                </Button>
            </div>

            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Sucursal</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead className="text-right">Monto/mes</TableHead>
                            <TableHead className="text-center">Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
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

            {/* Form Dialog */}
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

            {/* Delete Confirmation */}
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
