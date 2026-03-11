'use client'

import { useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { createExpenseTicket, deleteExpenseTicket } from '@/lib/actions/expense-tickets'
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
    description: '',
    branch_id: '',
    payment_account_id: '',
}

export function EgresosClient({ expenseTickets, branches, accounts }: Props) {
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

    // Filter active accounts by selected branch
    const filteredAccounts = accounts.filter(a =>
        a.is_active && (form.branch_id ? a.branch_id === form.branch_id : true)
    )

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
            payment_account_id: form.payment_account_id || null,
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

    const getAccountName = (ticket: ExpenseTicket) => {
        if (!ticket.payment_account_id) return '-'
        const acc = ticket.payment_account
        if (acc) return acc.name
        // Fallback: look up from accounts prop
        const found = accounts.find(a => a.id === ticket.payment_account_id)
        return found?.name ?? '-'
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
                            <TableHead>Cuenta</TableHead>
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
                                            <span className="text-muted-foreground">-</span>
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
                            <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v, payment_account_id: '' })}>
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
                                Cuenta / Alias <span className="text-muted-foreground">(opcional)</span>
                            </Label>
                            <Select value={form.payment_account_id} onValueChange={(v) => setForm({ ...form, payment_account_id: v === '__none__' ? '' : v })}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Sin cuenta asociada" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Sin cuenta asociada</SelectItem>
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
