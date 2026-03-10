'use client'

import { useState } from 'react'
import { Plus, Trash2, CalendarIcon, Receipt } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { createExpenseTicket, deleteExpenseTicket } from '@/lib/actions/expense-tickets'
import { useBranchStore } from '@/stores/branch-store'
import type { Branch, ExpenseTicket } from '@/lib/types/database'
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

interface Props {
    expenseTickets: ExpenseTicket[]
    branches: Branch[]
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
    description: '',
    branch_id: '',
}

export function EgresosClient({ expenseTickets, branches }: Props) {
    const { selectedBranchId } = useBranchStore()

    // Form state
    const [dialogOpen, setDialogOpen] = useState(false)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const filteredTickets = selectedBranchId
        ? expenseTickets.filter((t) => t.branch_id === selectedBranchId)
        : expenseTickets

    function openAdd() {
        setForm({
            ...emptyForm,
            branch_id: selectedBranchId ?? (branches[0]?.id || ''),
        })
        setDialogOpen(true)
    }

    async function handleSave() {
        if (!form.amount || !form.category || !form.branch_id) return
        setSaving(true)

        const result = await createExpenseTicket({
            amount: Number(form.amount) || 0,
            category: form.category,
            description: form.description,
            branch_id: form.branch_id,
        })

        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Egreso registrado')
            setDialogOpen(false)
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Registro de Egresos</h2>
                    <p className="text-sm text-muted-foreground">
                        Registrá la salida de dinero para gastos e insumos
                    </p>
                </div>
                <Button onClick={openAdd}>
                    <Plus className="mr-2 size-4" />
                    Registrar egreso
                </Button>
            </div>

            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Sucursal</TableHead>
                            <TableHead>Vendedor/Registrado Por</TableHead>
                            <TableHead>Categoría</TableHead>
                            <TableHead>Descripción</TableHead>
                            <TableHead className="text-right">Monto</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredTickets.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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
                                        <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(t.id)}>
                                            <Trash2 className="size-3" />
                                        </Button>
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
                        <DialogTitle>Registrar nuevo egreso</DialogTitle>
                        <DialogDescription>
                            Añadí los detalles del gasto a registrar en caja.
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
                            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar categoría" />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

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
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving || !form.amount || !form.branch_id || !form.category}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
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
