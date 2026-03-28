'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Shield, ChevronDown, ChevronUp, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Role, Branch } from '@/lib/types/database'
import { PERMISSION_CATEGORIES, PERMISSION_DESCRIPTIONS, countActivePermissions, ALL_PERMISSION_KEYS } from '@/lib/permissions'
import { createRole, updateRole, deleteRole } from '@/lib/actions/roles'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface RolesClientProps {
    roles: Role[]
    branches: Branch[]
}

const emptyForm = {
    name: '',
    description: '',
    permissions: {} as Record<string, boolean>,
    branchIds: [] as string[],
}

export function RolesClient({ roles, branches }: RolesClientProps) {
    const router = useRouter()
    const [dialogOpen, setDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)
    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})

    function openCreate() {
        setEditingId(null)
        setForm(emptyForm)
        setExpandedCategories({})
        setDialogOpen(true)
    }

    function openEdit(role: Role) {
        setEditingId(role.id)
        setForm({
            name: role.name,
            description: role.description ?? '',
            permissions: { ...role.permissions },
            branchIds: role.role_branch_scope?.map((s) => s.branch_id) ?? [],
        })
        setExpandedCategories({})
        setDialogOpen(true)
    }

    function openDelete(roleId: string) {
        setDeletingId(roleId)
        setDeleteDialogOpen(true)
    }

    function togglePermission(key: string) {
        setForm((prev) => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [key]: !prev.permissions[key],
            },
        }))
    }

    function toggleAllInCategory(categoryKey: string, permissionKeys: string[]) {
        const allEnabled = permissionKeys.every((k) => form.permissions[k])
        setForm((prev) => {
            const newPerms = { ...prev.permissions }
            permissionKeys.forEach((k) => {
                newPerms[k] = !allEnabled
            })
            return { ...prev, permissions: newPerms }
        })
    }

    function toggleBranch(branchId: string) {
        setForm((prev) => ({
            ...prev,
            branchIds: prev.branchIds.includes(branchId)
                ? prev.branchIds.filter((id) => id !== branchId)
                : [...prev.branchIds, branchId],
        }))
    }

    function toggleCategory(key: string) {
        setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }))
    }

    function selectAllPermissions() {
        const newPerms: Record<string, boolean> = {}
        ALL_PERMISSION_KEYS.forEach((k) => {
            newPerms[k] = true
        })
        setForm((prev) => ({ ...prev, permissions: newPerms }))
    }

    function clearAllPermissions() {
        setForm((prev) => ({ ...prev, permissions: {} }))
    }

    async function handleSave() {
        if (!form.name.trim()) {
            toast.error('El nombre del rol es requerido')
            return
        }
        setSaving(true)
        try {
            const input = {
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                permissions: form.permissions,
                branchIds: form.branchIds,
            }

            const result = editingId
                ? await updateRole(editingId, input)
                : await createRole(input)

            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success(editingId ? 'Rol actualizado' : 'Rol creado')
                setDialogOpen(false)
                router.refresh()
            }
        } catch {
            toast.error('Error inesperado')
        } finally {
            setSaving(false)
        }
    }

    async function handleDelete() {
        if (!deletingId) return
        const result = await deleteRole(deletingId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Rol eliminado')
            router.refresh()
        }
        setDeleteDialogOpen(false)
        setDeletingId(null)
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Roles</h2>
                    <p className="text-sm text-muted-foreground">
                        Creá y gestioná roles con permisos personalizados
                    </p>
                </div>
                <Button onClick={openCreate} className="sm:self-start">
                    <Plus className="size-4" />
                    Crear rol
                </Button>
            </div>

            {roles.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
                    <Shield className="mb-3 size-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No hay roles creados</p>
                    <p className="text-xs text-muted-foreground/80">
                        Creá un rol para asignar permisos personalizados a tu equipo
                    </p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {roles.map((role) => {
                        const activeCount = countActivePermissions(role.permissions)
                        const totalCount = ALL_PERMISSION_KEYS.length
                        const scopeBranches = role.role_branch_scope ?? []

                        return (
                            <Card key={role.id} className="relative transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-2">
                                            <Shield className="size-4 text-primary" />
                                            <CardTitle className="text-base">{role.name}</CardTitle>
                                        </div>
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                onClick={() => openEdit(role)}
                                            >
                                                <Pencil className="size-3" />
                                            </Button>
                                            {!role.is_system && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    onClick={() => openDelete(role.id)}
                                                    className="text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="size-3" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {role.description && (
                                        <p className="text-xs text-muted-foreground">
                                            {role.description}
                                        </p>
                                    )}
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <div className="flex flex-wrap gap-2">
                                        <Badge variant="secondary" className="text-xs">
                                            {activeCount}/{totalCount} permisos
                                        </Badge>
                                        {scopeBranches.length === 0 ? (
                                            <Badge variant="outline" className="text-xs">
                                                Global
                                            </Badge>
                                        ) : (
                                            scopeBranches.map((s) => {
                                                const branchName = branches.find(
                                                    (b) => b.id === s.branch_id
                                                )?.name
                                                return (
                                                    <Badge key={s.branch_id} variant="outline" className="text-xs">
                                                        <Building2 className="mr-1 size-3" />
                                                        {branchName ?? 'Sucursal'}
                                                    </Badge>
                                                )
                                            })
                                        )}
                                        {role.is_system && (
                                            <Badge className="text-xs">Sistema</Badge>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col p-0 gap-0">
                    <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
                        <DialogTitle>
                            {editingId ? 'Editar rol' : 'Nuevo rol'}
                        </DialogTitle>
                        <DialogDescription>
                            {editingId
                                ? 'Modificá el nombre, descripción y permisos del rol.'
                                : 'Definí un nuevo rol con permisos personalizados.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto min-h-0">
                        <div className="space-y-6 px-4 py-2 sm:px-6 pb-6">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>Nombre del rol</Label>
                                    <Input
                                        value={form.name}
                                        onChange={(e) =>
                                            setForm({ ...form, name: e.target.value })
                                        }
                                        placeholder="Ej: Barbero Senior"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Descripción (opcional)</Label>
                                    <Input
                                        value={form.description}
                                        onChange={(e) =>
                                            setForm({ ...form, description: e.target.value })
                                        }
                                        placeholder="Descripción breve del rol..."
                                    />
                                </div>
                            </div>

                            {/* Branch Scope */}
                            <div className="space-y-3">
                                <div>
                                    <Label className="text-base">Alcance por sucursal</Label>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Sin selección = aplica a todas las sucursales (global).
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {branches.map((branch) => (
                                        <button
                                            key={branch.id}
                                            type="button"
                                            onClick={() => toggleBranch(branch.id)}
                                            className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${form.branchIds.includes(branch.id)
                                                ? 'border-primary bg-primary/10 text-primary'
                                                : 'border-border text-muted-foreground hover:border-primary/50 bg-background'
                                                }`}
                                        >
                                            <Building2 className="size-4" />
                                            {branch.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <Separator />

                            {/* Permissions */}
                            <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-muted/30 p-3 rounded-lg border">
                                    <div>
                                        <Label className="text-base">Listado de permisos</Label>
                                        <p className="text-sm text-muted-foreground mt-0.5">Define a qué partes del sistema puede acceder este rol.</p>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={selectAllPermissions}
                                            className="flex-1 sm:flex-none"
                                        >
                                            Seleccionar todos
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={clearAllPermissions}
                                            className="flex-1 sm:flex-none"
                                        >
                                            Limpiar
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid gap-3">
                                    {Object.entries(PERMISSION_CATEGORIES).map(
                                        ([categoryKey, category]) => {
                                            const permKeys = Object.keys(category.permissions)
                                            const enabledInCategory = permKeys.filter(
                                                (k) => form.permissions[k]
                                            ).length
                                            const isExpanded = expandedCategories[categoryKey] ?? false
                                            const allEnabled = permKeys.every((k) => form.permissions[k])

                                            return (
                                                <div
                                                    key={categoryKey}
                                                    className={`rounded-lg border transition-colors ${isExpanded ? 'bg-muted/10 border-primary/20' : 'bg-background hover:bg-muted/30'}`}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleCategory(categoryKey)}
                                                        className="flex w-full items-center justify-between p-4 text-left"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-medium text-base">
                                                                {category.label}
                                                            </span>
                                                            <Badge variant={enabledInCategory > 0 ? "default" : "secondary"} className="h-6">
                                                                {enabledInCategory} / {permKeys.length}
                                                            </Badge>
                                                        </div>
                                                        {isExpanded ? (
                                                            <ChevronUp className="size-5 text-muted-foreground" />
                                                        ) : (
                                                            <ChevronDown className="size-5 text-muted-foreground" />
                                                        )}
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="border-t">
                                                            <div className="px-4 py-3 border-b bg-muted/5 flex justify-end">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        toggleAllInCategory(categoryKey, permKeys)
                                                                    }
                                                                    className="text-sm font-medium text-primary hover:underline"
                                                                >
                                                                    {allEnabled
                                                                        ? 'Desmarcar todos en esta categoría'
                                                                        : 'Marcar todos en esta categoría'}
                                                                </button>
                                                            </div>
                                                            <div className="divide-y">
                                                                {Object.entries(category.permissions).map(
                                                                    ([permKey, permLabel]) => (
                                                                        <label
                                                                            key={permKey}
                                                                            className="flex flex-row items-start gap-3 justify-between px-4 py-3 cursor-pointer hover:bg-muted/5 transition-colors"
                                                                        >
                                                                            <div className="flex flex-col gap-0.5 flex-1 min-w-0 pt-0.5">
                                                                                <span className="text-sm font-medium leading-snug">{permLabel}</span>
                                                                                {PERMISSION_DESCRIPTIONS[permKey] && (
                                                                                    <span className="text-xs text-muted-foreground leading-relaxed">
                                                                                        {PERMISSION_DESCRIPTIONS[permKey]}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <Switch
                                                                                checked={!!form.permissions[permKey]}
                                                                                onCheckedChange={() =>
                                                                                    togglePermission(permKey)
                                                                                }
                                                                                className="shrink-0"
                                                                            />
                                                                        </label>
                                                                    )
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        }
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="px-4 py-3 border-t sm:px-6">
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                            {saving
                                ? 'Guardando...'
                                : editingId
                                    ? 'Guardar cambios'
                                    : 'Crear rol'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar este rol?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Los miembros del equipo con este
                            rol asignado quedarán sin rol.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
