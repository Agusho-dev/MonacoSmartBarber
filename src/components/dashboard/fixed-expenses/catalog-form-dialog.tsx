'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Link as LinkIcon, Copy, Building2, Calendar, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
import { upsertFixedExpense } from '@/lib/actions/fixed-expenses'
import type { Branch, FixedExpense } from '@/lib/types/database'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const CATEGORIES = [
    'Alquiler',
    'Servicios (luz, agua, gas)',
    'Internet y Telefonía',
    'Seguros',
    'Impuestos',
    'Software y Suscripciones',
    'Contabilidad',
    'Marketing',
    'Varios',
]

const ORG_BRANCH_SENTINEL = '__ORG__'

interface CatalogFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    branches: Branch[]
    expense: FixedExpense | null              // null para crear
    defaultBranchId?: string | null
}

interface FormState {
    id: string
    name: string
    description: string
    category: string
    branch_id: string                          // '' = org-wide (sentinel)
    due_day: string
    payment_url: string
    copy1_label: string
    copy1_value: string
    copy2_label: string
    copy2_value: string
    is_active: boolean
}

function buildInitialForm(expense: FixedExpense | null, defaultBranchId?: string | null): FormState {
    if (expense) {
        return {
            id: expense.id,
            name: expense.name,
            description: expense.description ?? '',
            category: expense.category ?? '',
            branch_id: expense.branch_id ?? ORG_BRANCH_SENTINEL,
            due_day: expense.due_day != null ? String(expense.due_day) : '',
            payment_url: expense.payment_url ?? '',
            copy1_label: expense.copyable_1_label ?? '',
            copy1_value: expense.copyable_1_value ?? '',
            copy2_label: expense.copyable_2_label ?? '',
            copy2_value: expense.copyable_2_value ?? '',
            is_active: expense.is_active,
        }
    }
    return {
        id: '',
        name: '',
        description: '',
        category: '',
        branch_id: defaultBranchId || ORG_BRANCH_SENTINEL,
        due_day: '',
        payment_url: '',
        copy1_label: '',
        copy1_value: '',
        copy2_label: '',
        copy2_value: '',
        is_active: true,
    }
}

export function CatalogFormDialog({
    open,
    onOpenChange,
    branches,
    expense,
    defaultBranchId,
}: CatalogFormDialogProps) {
    const [form, setForm] = useState<FormState>(() => buildInitialForm(expense, defaultBranchId))
    const [isPending, startTransition] = useTransition()

    useEffect(() => {
        if (open) {
            setForm(buildInitialForm(expense, defaultBranchId))
        }
    }, [open, expense, defaultBranchId])

    const dueDayNum = form.due_day ? Number(form.due_day) : null
    const dueDayValid = dueDayNum === null || (Number.isInteger(dueDayNum) && dueDayNum >= 1 && dueDayNum <= 31)
    const nameValid = form.name.trim().length > 0
    const copy1Coherent = (!!form.copy1_label.trim()) === (!!form.copy1_value.trim())
    const copy2Coherent = (!!form.copy2_label.trim()) === (!!form.copy2_value.trim())
    const canSave = nameValid && dueDayValid && copy1Coherent && copy2Coherent

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!canSave) return

        startTransition(async () => {
            const result = await upsertFixedExpense({
                id: form.id || undefined,
                name: form.name.trim(),
                description: form.description.trim() || null,
                category: form.category || null,
                branch_id: form.branch_id === ORG_BRANCH_SENTINEL ? null : form.branch_id,
                due_day: dueDayNum,
                payment_url: form.payment_url.trim() || null,
                copyable_1: form.copy1_label.trim()
                    ? { label: form.copy1_label.trim(), value: form.copy1_value.trim() }
                    : null,
                copyable_2: form.copy2_label.trim()
                    ? { label: form.copy2_label.trim(), value: form.copy2_value.trim() }
                    : null,
                is_active: form.is_active,
            })
            if (result.error) {
                toast.error(result.error)
                return
            }
            toast.success(form.id ? 'Gasto fijo actualizado' : 'Gasto fijo creado')
            onOpenChange(false)
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Building2 className="size-5" />
                        {form.id ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
                    </DialogTitle>
                    <DialogDescription>
                        El precio se carga cada mes al momento del pago. Acá definís QUÉ pagás y cómo acceder al servicio.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 py-2">
                    {/* ── Sección 1: Datos básicos ── */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <FileText className="size-3.5" />
                            Datos básicos
                        </div>

                        <div className="grid gap-1.5">
                            <Label htmlFor="fe-name">Nombre *</Label>
                            <Input
                                id="fe-name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Ej: Luz — Edenor (Sucursal Centro)"
                                maxLength={120}
                                autoFocus={!form.id}
                            />
                        </div>

                        <div className="grid gap-1.5">
                            <Label htmlFor="fe-description">Descripción (opcional)</Label>
                            <Textarea
                                id="fe-description"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder="Notas internas, número de cliente adicional, detalles del plan, etc."
                                rows={2}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label htmlFor="fe-branch">Sucursal</Label>
                                <Select
                                    value={form.branch_id}
                                    onValueChange={(v) => setForm({ ...form, branch_id: v })}
                                >
                                    <SelectTrigger id="fe-branch">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ORG_BRANCH_SENTINEL}>
                                            Todas las sucursales (organización)
                                        </SelectItem>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>
                                                {b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid gap-1.5">
                                <Label htmlFor="fe-category">Categoría</Label>
                                <Select
                                    value={form.category}
                                    onValueChange={(v) => setForm({ ...form, category: v })}
                                >
                                    <SelectTrigger id="fe-category">
                                        <SelectValue placeholder="Sin categoría" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map((c) => (
                                            <SelectItem key={c} value={c}>
                                                {c}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </section>

                    {/* ── Sección 2: Pago ── */}
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            <Calendar className="size-3.5" />
                            Pago y vencimiento
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                            <div className="grid gap-1.5">
                                <Label htmlFor="fe-url" className="flex items-center gap-1.5">
                                    <LinkIcon className="size-3.5" />
                                    Link para pagar
                                </Label>
                                <Input
                                    id="fe-url"
                                    value={form.payment_url}
                                    onChange={(e) => setForm({ ...form, payment_url: e.target.value })}
                                    placeholder="https://pagos.edenor.com"
                                    type="url"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Aparece como botón directo al pagar.
                                </p>
                            </div>

                            <div className="grid gap-1.5">
                                <Label htmlFor="fe-due-day">Día vencimiento</Label>
                                <Input
                                    id="fe-due-day"
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    max="31"
                                    value={form.due_day}
                                    onChange={(e) => setForm({ ...form, due_day: e.target.value })}
                                    placeholder="—"
                                    className={cn(!dueDayValid && 'border-destructive')}
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Si pasa el último día del mes, se ajusta automáticamente.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* ── Sección 3: Datos copiables ── */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Copy className="size-3.5" />
                                Datos para copiar al pagar
                            </div>
                            <span className="text-[11px] text-muted-foreground">Hasta 2</span>
                        </div>

                        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                                <div className="grid gap-1">
                                    <Label htmlFor="fe-copy1-label" className="text-[11px] text-muted-foreground">
                                        Etiqueta
                                    </Label>
                                    <Input
                                        id="fe-copy1-label"
                                        value={form.copy1_label}
                                        onChange={(e) => setForm({ ...form, copy1_label: e.target.value })}
                                        placeholder="Nº cliente"
                                        className="h-9"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="fe-copy1-value" className="text-[11px] text-muted-foreground">
                                        Valor
                                    </Label>
                                    <Input
                                        id="fe-copy1-value"
                                        value={form.copy1_value}
                                        onChange={(e) => setForm({ ...form, copy1_value: e.target.value })}
                                        placeholder="12345-67"
                                        className={cn('h-9 font-mono', !copy1Coherent && 'border-destructive')}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                                <div className="grid gap-1">
                                    <Label htmlFor="fe-copy2-label" className="text-[11px] text-muted-foreground">
                                        Etiqueta
                                    </Label>
                                    <Input
                                        id="fe-copy2-label"
                                        value={form.copy2_label}
                                        onChange={(e) => setForm({ ...form, copy2_label: e.target.value })}
                                        placeholder="CUIT prestador"
                                        className="h-9"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="fe-copy2-value" className="text-[11px] text-muted-foreground">
                                        Valor
                                    </Label>
                                    <Input
                                        id="fe-copy2-value"
                                        value={form.copy2_value}
                                        onChange={(e) => setForm({ ...form, copy2_value: e.target.value })}
                                        placeholder="30-12345678-9"
                                        className={cn('h-9 font-mono', !copy2Coherent && 'border-destructive')}
                                    />
                                </div>
                            </div>
                            {(!copy1Coherent || !copy2Coherent) && (
                                <p className="text-[11px] text-destructive">
                                    Cada dato copiable necesita etiqueta Y valor.
                                </p>
                            )}
                        </div>
                    </section>

                    {/* ── Estado ── */}
                    {form.id && (
                        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                            <div>
                                <div className="text-sm font-semibold">
                                    {form.is_active ? 'Activo' : 'Inactivo'}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                    {form.is_active
                                        ? 'Se genera un período de pago cada mes'
                                        : 'No se generan nuevos períodos (los actuales se mantienen)'}
                                </div>
                            </div>
                            <Switch
                                checked={form.is_active}
                                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                            />
                        </div>
                    )}

                    <DialogFooter className="gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={!canSave || isPending}>
                            {isPending ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Guardando...
                                </>
                            ) : (
                                form.id ? 'Guardar cambios' : 'Crear gasto fijo'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
