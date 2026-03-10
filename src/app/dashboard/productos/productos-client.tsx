'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power, Trash2, Package, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { upsertProduct, toggleProduct, deleteProduct } from '@/lib/actions/products'
import { useBranchStore } from '@/stores/branch-store'
import type { Product, Branch, ProductSale } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    products: Product[]
    branches: Branch[]
    sales: ProductSale[]
}

const emptyForm = {
    name: '',
    cost: '',
    sale_price: '',
    barber_commission: '',
    stock: '',
    branch_id: '',
}

export function ProductosClient({ products, branches, sales }: Props) {
    const router = useRouter()
    const { selectedBranchId } = useBranchStore()

    // Product dialog state
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState(emptyForm)
    const [saving, setSaving] = useState(false)

    // Delete state
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState(false)

    const filteredProducts = selectedBranchId
        ? products.filter((p) => p.branch_id === selectedBranchId)
        : products

    const filteredSales = selectedBranchId
        ? sales.filter((s) => s.branch_id === selectedBranchId)
        : sales

    function openAdd() {
        setEditingId(null)
        setForm({
            ...emptyForm,
            branch_id: selectedBranchId ?? (branches[0]?.id || ''),
        })
        setDialogOpen(true)
    }

    function openEdit(product: Product) {
        setEditingId(product.id)
        setForm({
            name: product.name,
            cost: String(product.cost),
            sale_price: String(product.sale_price),
            barber_commission: String(product.barber_commission),
            stock: product.stock !== null ? String(product.stock) : '',
            branch_id: product.branch_id,
        })
        setDialogOpen(true)
    }

    async function handleSave() {
        if (!form.name || !form.sale_price || !form.branch_id) return
        setSaving(true)

        const result = await upsertProduct({
            id: editingId ?? undefined,
            name: form.name,
            cost: Number(form.cost) || 0,
            sale_price: Number(form.sale_price) || 0,
            barber_commission: Number(form.barber_commission) || 0,
            stock: form.stock !== '' ? Number(form.stock) : null,
            branch_id: form.branch_id,
        })

        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success(editingId ? 'Producto actualizado' : 'Producto creado')
            setDialogOpen(false)
        }
        setSaving(false)
    }

    async function handleToggle(product: Product) {
        const result = await toggleProduct(product.id, !product.is_active)
        if (result.error) toast.error(result.error)
    }

    async function handleDelete() {
        if (!deleteId) return
        setDeleting(true)
        const result = await deleteProduct(deleteId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Producto eliminado')
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
                    <h2 className="text-2xl font-bold tracking-tight">Productos</h2>
                    <p className="text-sm text-muted-foreground">
                        Gestión de inventario y ventas
                    </p>
                </div>
                <Button onClick={openAdd}>
                    <Plus className="mr-2 size-4" />
                    Agregar producto
                </Button>
            </div>

            <Tabs defaultValue="inventory" className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="inventory" className="flex items-center gap-2">
                        <Package className="size-4" />
                        Inventario
                    </TabsTrigger>
                    <TabsTrigger value="sales" className="flex items-center gap-2">
                        <TrendingUp className="size-4" />
                        Ventas / Comisiones
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="inventory" className="space-y-4 m-0">
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>Sucursal</TableHead>
                                    <TableHead className="text-right">Costo</TableHead>
                                    <TableHead className="text-right">Precio Público</TableHead>
                                    <TableHead className="text-right">Comisión Barbero</TableHead>
                                    <TableHead className="text-right">Stock</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredProducts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center">
                                            No hay productos registrados
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredProducts.map((p) => (
                                        <TableRow key={p.id}>
                                            <TableCell className="font-medium">{p.name}</TableCell>
                                            <TableCell>{getBranchName(p.branch_id)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(p.cost)}</TableCell>
                                            <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(p.sale_price)}
                                            </TableCell>
                                            <TableCell className="text-right text-blue-600 dark:text-blue-400">
                                                {formatCurrency(p.barber_commission)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {p.stock === null ? 'Ilimitado' : p.stock}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={p.is_active ? 'default' : 'secondary'}>
                                                    {p.is_active ? 'Activo' : 'Inactivo'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="icon-xs" onClick={() => openEdit(p)}>
                                                        <Pencil className="size-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon-xs" onClick={() => handleToggle(p)}>
                                                        <Power className="size-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon-xs" onClick={() => setDeleteId(p.id)}>
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
                </TabsContent>

                <TabsContent value="sales" className="space-y-4 m-0">
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Barbero</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead className="text-center">Cant.</TableHead>
                                    <TableHead className="text-right">Precio U.</TableHead>
                                    <TableHead className="text-right">Comisión</TableHead>
                                    <TableHead className="text-right">Total Venta</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSales.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                            No hay ventas en este mes.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredSales.map((s) => (
                                        <TableRow key={s.id}>
                                            <TableCell className="whitespace-nowrap">
                                                {format(new Date(s.sold_at), "d 'de' MMMM, HH:mm", { locale: es })}
                                            </TableCell>
                                            <TableCell className="font-medium">{s.barber?.full_name}</TableCell>
                                            <TableCell>{s.product?.name}</TableCell>
                                            <TableCell className="text-center">{s.quantity}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(s.unit_price)}</TableCell>
                                            <TableCell className="text-right text-blue-600 dark:text-blue-400">
                                                {formatCurrency(s.commission_amount)}
                                            </TableCell>
                                            <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">
                                                {formatCurrency(s.unit_price * s.quantity)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Form Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
                        <DialogDescription>
                            Configurá los precios y comisiones para la venta de este producto.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Nombre del Producto *</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Ej: Cera Mate 100g"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Precio de Venta (Público) *</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={form.sale_price}
                                    onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                                    placeholder="Ej: 8000"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Costo Operativo</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={form.cost}
                                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                                    placeholder="Ej: 4000"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Comisión Barbero</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={form.barber_commission}
                                    onChange={(e) => setForm({ ...form, barber_commission: e.target.value })}
                                    placeholder="Ej: 1000"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Stock (Dejar vacío si es ilimitado)</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={form.stock}
                                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                                    placeholder="Ej: 25"
                                />
                            </div>
                        </div>

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
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving || !form.name || !form.sale_price || !form.branch_id}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Si el producto ya tiene ventas registradas, no podrás eliminarlo (deberías desactivarlo en su lugar).
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Mantener</AlertDialogCancel>
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
