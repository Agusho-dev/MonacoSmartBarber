'use client'

import { useMemo, useState, useTransition } from 'react'
import {
    Plus,
    Pencil,
    Trash2,
    Building2,
    Globe,
    Copy as CopyIcon,
    Link as LinkIcon,
    CalendarDays,
    Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
import type { Branch, FixedExpense } from '@/lib/types/database'
import { CatalogFormDialog } from './catalog-form-dialog'
import {
    deleteFixedExpense,
    toggleFixedExpenseActive,
} from '@/lib/actions/fixed-expenses'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
    fixedExpenses: FixedExpense[]
    branches: Branch[]
    canManage: boolean
    selectedBranchId: string | null
}

export function CatalogView({ fixedExpenses, branches, canManage, selectedBranchId }: Props) {
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<FixedExpense | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<FixedExpense | null>(null)
    const [deleting, startDeletingTransition] = useTransition()
    const [togglingId, setTogglingId] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    const filtered = useMemo(() => {
        let list = fixedExpenses
        if (selectedBranchId) {
            list = list.filter((e) => e.branch_id === selectedBranchId)
        }
        if (search.trim()) {
            const q = search.trim().toLowerCase()
            list = list.filter((e) =>
                e.name.toLowerCase().includes(q)
                || (e.category ?? '').toLowerCase().includes(q)
                || (e.description ?? '').toLowerCase().includes(q)
            )
        }
        return list
    }, [fixedExpenses, selectedBranchId, search])

    const activeCount = filtered.filter((e) => e.is_active).length

    function handleOpenCreate() {
        setEditing(null)
        setDialogOpen(true)
    }

    function handleOpenEdit(expense: FixedExpense) {
        setEditing(expense)
        setDialogOpen(true)
    }

    async function handleToggleActive(expense: FixedExpense) {
        setTogglingId(expense.id)
        const result = await toggleFixedExpenseActive(expense.id, !expense.is_active)
        setTogglingId(null)
        if (result.error) {
            toast.error(result.error)
            return
        }
        toast.success(expense.is_active ? 'Gasto desactivado' : 'Gasto activado')
    }

    function handleConfirmDelete() {
        if (!deleteTarget) return
        startDeletingTransition(async () => {
            const result = await deleteFixedExpense(deleteTarget.id)
            if (result.error) {
                toast.error(result.error)
                return
            }
            toast.success('Gasto fijo eliminado')
            setDeleteTarget(null)
        })
    }

    return (
        <div className="space-y-4">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h3 className="text-base lg:text-lg font-bold tracking-tight">
                        Catálogo de gastos fijos
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {filtered.length} en total · <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{activeCount} activos</span>
                    </p>
                </div>
                {canManage && (
                    <Button onClick={handleOpenCreate} size="sm" className="shrink-0">
                        <Plus className="mr-1.5 size-4" />
                        Nuevo gasto fijo
                    </Button>
                )}
            </div>

            {/* ── Search ── */}
            {fixedExpenses.length > 3 && (
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nombre, categoría o descripción…"
                    className="max-w-md h-9"
                />
            )}

            {/* ── Empty state ── */}
            {filtered.length === 0 && (
                <div className="rounded-xl border border-dashed bg-muted/20 py-12 px-4 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted mb-3">
                        <Building2 className="size-6 text-muted-foreground" />
                    </div>
                    <h4 className="font-semibold text-sm">
                        {fixedExpenses.length === 0
                            ? 'Todavía no hay gastos fijos'
                            : 'Sin resultados con ese filtro'}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        {fixedExpenses.length === 0
                            ? 'Cargá acá los servicios que pagás todos los meses: alquiler, luz, internet, software, etc.'
                            : 'Probá con otro término o quitá el filtro de sucursal.'}
                    </p>
                    {fixedExpenses.length === 0 && canManage && (
                        <Button onClick={handleOpenCreate} className="mt-4" size="sm">
                            <Plus className="mr-1.5 size-4" />
                            Agregar el primero
                        </Button>
                    )}
                </div>
            )}

            {/* ── Lista ── */}
            {filtered.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((expense) => {
                        const copyCount =
                            (expense.copyable_1_label ? 1 : 0) + (expense.copyable_2_label ? 1 : 0)
                        const branchName = branches.find((b) => b.id === expense.branch_id)?.name
                        return (
                            <div
                                key={expense.id}
                                className={cn(
                                    'rounded-lg border bg-card p-3 transition-all hover:shadow-sm',
                                    !expense.is_active && 'opacity-60',
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-sm truncate">
                                            {expense.name}
                                        </div>
                                        {expense.description && (
                                            <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                                {expense.description}
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                            {expense.category && (
                                                <Badge variant="outline" className="text-[10px] font-normal">
                                                    {expense.category}
                                                </Badge>
                                            )}
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                {expense.branch_id ? (
                                                    <>
                                                        <Building2 className="size-2.5" />
                                                        {branchName ?? 'Sucursal'}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Globe className="size-2.5" />
                                                        Organización
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    {canManage && (
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <div className="flex items-center gap-0.5">
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    onClick={() => handleOpenEdit(expense)}
                                                    aria-label="Editar"
                                                >
                                                    <Pencil className="size-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    onClick={() => setDeleteTarget(expense)}
                                                    aria-label="Eliminar"
                                                >
                                                    <Trash2 className="size-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-2.5 pt-2.5 border-t flex items-center justify-between gap-2 text-[11px]">
                                    <div className="flex items-center gap-2.5 text-muted-foreground flex-wrap">
                                        {expense.due_day != null && (
                                            <span className="inline-flex items-center gap-1">
                                                <CalendarDays className="size-3" />
                                                Vence día {expense.due_day}
                                            </span>
                                        )}
                                        {expense.payment_url && (
                                            <span className="inline-flex items-center gap-1">
                                                <LinkIcon className="size-3" />
                                                Link
                                            </span>
                                        )}
                                        {copyCount > 0 && (
                                            <span className="inline-flex items-center gap-1">
                                                <CopyIcon className="size-3" />
                                                {copyCount} dato{copyCount === 1 ? '' : 's'}
                                            </span>
                                        )}
                                    </div>
                                    {canManage && (
                                        <div className="flex items-center gap-1.5">
                                            {togglingId === expense.id && (
                                                <Loader2 className="size-3 animate-spin text-muted-foreground" />
                                            )}
                                            <Switch
                                                checked={expense.is_active}
                                                onCheckedChange={() => handleToggleActive(expense)}
                                                disabled={togglingId === expense.id}
                                                aria-label={expense.is_active ? 'Desactivar' : 'Activar'}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Dialogs */}
            <CatalogFormDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                branches={branches}
                expense={editing}
                defaultBranchId={selectedBranchId}
            />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar {deleteTarget?.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se borra el gasto del catálogo Y todos los períodos de pago asociados (pendientes e históricos). Si querés conservar el histórico, mejor desactivalo.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault()
                                handleConfirmDelete()
                            }}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Eliminando...
                                </>
                            ) : (
                                'Sí, eliminar'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
