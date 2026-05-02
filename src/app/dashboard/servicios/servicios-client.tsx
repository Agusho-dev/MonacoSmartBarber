'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power, ChevronDown, ChevronUp, Percent, Trash2, Sparkles, Package, ShoppingCart, Store, User } from 'lucide-react'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency } from '@/lib/format'
import { HistorialServicios } from './historial-servicios'
import { upsertService, toggleService, deleteService } from '@/lib/actions/services'
import { upsertProduct, toggleProduct, deleteProduct, sellProductFromDashboard } from '@/lib/actions/products'
import type { Service, Branch, ServiceAvailability, BookingMode, StaffServiceCommission, Product, ProductSale } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ServiceWithBranch extends Service {
  branch?: Branch | null
}

interface BarberMinimal {
  id: string
  full_name: string
  branch_id: string | null
  is_active: boolean
}

interface Props {
  services: ServiceWithBranch[]
  branches: Branch[]
  barbers: BarberMinimal[]
  commissions: StaffServiceCommission[]
  products: Product[]
  productSales: ProductSale[]
}

// ─── Empty forms ─────────────────────────────────────────────────────────────

const emptyServiceForm = {
  name: '',
  price: '',
  duration_minutes: '',
  branch_id: '',
  availability: 'both' as ServiceAvailability,
  booking_mode: 'self_service' as BookingMode,
  default_commission_pct: '',
}

const emptyProductForm = {
  name: '',
  cost: '',
  sale_price: '',
  barber_commission: '',
  stock: '',
  branch_id: '',
}

const paymentMethodMap: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  card: 'Tarjeta',
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ServiciosClient({ services, branches, barbers, commissions, products, productSales }: Props) {
  const router = useRouter()
  const { selectedBranchId } = useBranchStore()

  // ── Service state ──
  const [svcDialogOpen, setSvcDialogOpen] = useState(false)
  const [svcEditingId, setSvcEditingId] = useState<string | null>(null)
  const [svcForm, setSvcForm] = useState(emptyServiceForm)
  const [svcSaving, setSvcSaving] = useState(false)
  const [showOverrides, setShowOverrides] = useState(false)
  const [barberOverrides, setBarberOverrides] = useState<Record<string, string>>({})
  const [svcDeleteOpen, setSvcDeleteOpen] = useState(false)
  const [deletingService, setDeletingService] = useState<ServiceWithBranch | null>(null)
  const [svcDeleting, setSvcDeleting] = useState(false)

  // ── Product state ──
  const [prodDialogOpen, setProdDialogOpen] = useState(false)
  const [prodEditingId, setProdEditingId] = useState<string | null>(null)
  const [prodForm, setProdForm] = useState(emptyProductForm)
  const [prodSaving, setProdSaving] = useState(false)
  const [prodDeleteId, setProdDeleteId] = useState<string | null>(null)
  const [prodDeleting, setProdDeleting] = useState(false)

  // ── Sell state ──
  const [sellDialogOpen, setSellDialogOpen] = useState(false)
  const [sellingProduct, setSellingProduct] = useState<Product | null>(null)
  const [sellForm, setSellForm] = useState<{
    seller_type: 'barber' | 'house'
    barber_id: string
    quantity: string
    payment_method: 'cash' | 'transfer' | 'card'
  }>({
    seller_type: 'barber', barber_id: '', quantity: '1', payment_method: 'cash',
  })
  const [selling, setSelling] = useState(false)

  // ── Filtering ──
  const filteredServices = selectedBranchId
    ? services.filter((s) => s.branch_id === selectedBranchId || s.branch_id === null)
    : services

  const filteredProducts = selectedBranchId
    ? products.filter((p) => p.branch_id === selectedBranchId || p.branch_id === null)
    : products

  const filteredSales = selectedBranchId
    ? productSales.filter((s) => s.branch_id === selectedBranchId)
    : productSales

  const getBranchName = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? 'Desconocida') : 'Todas'

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function openAddService() {
    setSvcEditingId(null)
    setSvcForm({ ...emptyServiceForm, branch_id: selectedBranchId ?? '' })
    setBarberOverrides({})
    setShowOverrides(false)
    setSvcDialogOpen(true)
  }

  function openEditService(service: ServiceWithBranch) {
    setSvcEditingId(service.id)
    setSvcForm({
      name: service.name,
      price: String(service.price),
      duration_minutes: service.duration_minutes ? String(service.duration_minutes) : '',
      branch_id: service.branch_id ?? '',
      availability: service.availability ?? 'both',
      booking_mode: service.booking_mode ?? 'self_service',
      default_commission_pct: service.default_commission_pct ? String(service.default_commission_pct) : '',
    })
    const overrides: Record<string, string> = {}
    commissions
      .filter((c) => c.service_id === service.id)
      .forEach((c) => { overrides[c.staff_id] = String(c.commission_pct) })
    setBarberOverrides(overrides)
    setShowOverrides(Object.keys(overrides).length > 0)
    setSvcDialogOpen(true)
  }

  async function handleSaveService() {
    setSvcSaving(true)
    const overridesMap: Record<string, number> = {}
    Object.entries(barberOverrides)
      .filter(([, val]) => val !== '' && Number(val) >= 0)
      .forEach(([staffId, val]) => { overridesMap[staffId] = Number(val) })

    const result = await upsertService({
      id: svcEditingId ?? undefined,
      name: svcForm.name,
      price: Number(svcForm.price),
      duration_minutes: svcForm.duration_minutes ? Number(svcForm.duration_minutes) : null,
      branch_id: svcForm.branch_id || null,
      availability: svcForm.availability,
      booking_mode: svcForm.booking_mode,
      default_commission_pct: svcForm.default_commission_pct ? Number(svcForm.default_commission_pct) : 0,
      barberOverrides: overridesMap,
    })
    setSvcSaving(false)
    if (result.error) { toast.error(result.error); return }
    setSvcDialogOpen(false)
    router.refresh()
  }

  function openDeleteService(service: ServiceWithBranch) {
    setDeletingService(service)
    setSvcDeleteOpen(true)
  }

  async function handleDeleteService() {
    if (!deletingService) return
    setSvcDeleting(true)
    const result = await deleteService(deletingService.id)
    setSvcDeleting(false)
    if (result.error) { toast.error(result.error); return }
    setSvcDeleteOpen(false)
    toast.success(`Servicio "${deletingService.name}" eliminado`)
    setDeletingService(null)
    router.refresh()
  }

  async function handleToggleService(service: Service) {
    const result = await toggleService(service.id, !service.is_active)
    if (result.error) { toast.error(result.error); return }
    router.refresh()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCT CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function openAddProduct() {
    setProdEditingId(null)
    setProdForm({ ...emptyProductForm, branch_id: selectedBranchId ?? '' })
    setProdDialogOpen(true)
  }

  function openEditProduct(product: Product) {
    setProdEditingId(product.id)
    setProdForm({
      name: product.name,
      cost: String(product.cost),
      sale_price: String(product.sale_price),
      barber_commission: String(product.barber_commission),
      stock: product.stock !== null ? String(product.stock) : '',
      branch_id: product.branch_id ?? '',
    })
    setProdDialogOpen(true)
  }

  async function handleSaveProduct() {
    if (!prodForm.name || !prodForm.sale_price) return
    setProdSaving(true)
    const result = await upsertProduct({
      id: prodEditingId ?? undefined,
      name: prodForm.name,
      cost: Number(prodForm.cost) || 0,
      sale_price: Number(prodForm.sale_price) || 0,
      barber_commission: Number(prodForm.barber_commission) || 0,
      stock: prodForm.stock !== '' ? Number(prodForm.stock) : null,
      branch_id: prodForm.branch_id || null,
    })
    setProdSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success(prodEditingId ? 'Producto actualizado' : 'Producto creado')
    setProdDialogOpen(false)
    router.refresh()
  }

  async function handleToggleProduct(product: Product) {
    const result = await toggleProduct(product.id, !product.is_active)
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function handleDeleteProduct() {
    if (!prodDeleteId) return
    setProdDeleting(true)
    const result = await deleteProduct(prodDeleteId)
    setProdDeleting(false)
    if (result.error) { toast.error(result.error); return }
    toast.success('Producto eliminado')
    setProdDeleteId(null)
    router.refresh()
  }

  // ── Sell product ──

  function openSell(product: Product) {
    setSellingProduct(product)
    setSellForm({ seller_type: 'barber', barber_id: '', quantity: '1', payment_method: 'cash' })
    setSellDialogOpen(true)
  }

  const sellableBarbers = sellingProduct
    ? barbers.filter(b => !sellingProduct.branch_id || b.branch_id === sellingProduct.branch_id)
    : []

  const isHouseSale = sellForm.seller_type === 'house'
  const canSubmitSell = !!sellingProduct
    && Number(sellForm.quantity) >= 1
    && (isHouseSale || !!sellForm.barber_id)

  async function handleSell() {
    if (!sellingProduct) return
    if (!isHouseSale && !sellForm.barber_id) return
    setSelling(true)
    const qty = Number(sellForm.quantity) || 1
    const result = await sellProductFromDashboard({
      product_id: sellingProduct.id,
      barber_id: isHouseSale ? null : sellForm.barber_id,
      branch_id: sellingProduct.branch_id || branches[0]?.id || '',
      quantity: qty,
      payment_method: sellForm.payment_method,
    })
    setSelling(false)
    if (result.error) { toast.error(result.error); return }
    toast.success(`Venta registrada: ${qty}x ${sellingProduct.name}`)
    setSellDialogOpen(false)
    router.refresh()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold tracking-tight">Servicios y Productos</h2>
          <p className="text-sm text-muted-foreground hidden sm:block">Catálogo de servicios, productos y precios</p>
        </div>
        <BranchSelector branches={branches} />
      </div>

      <Tabs defaultValue="services" className="w-full">
        <div className="overflow-x-auto -mx-3 px-3 lg:mx-0 lg:px-0">
          <TabsList className="mb-4 min-w-max">
            <TabsTrigger value="services" className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <Sparkles className="size-3.5 sm:size-4" />
              Servicios
            </TabsTrigger>
            <TabsTrigger value="products" className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <Package className="size-3.5 sm:size-4" />
              Productos
            </TabsTrigger>
            <TabsTrigger value="product-sales" className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
              <ShoppingCart className="size-3.5 sm:size-4" />
              Ventas
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ════════════════════════ TAB: SERVICIOS ════════════════════════ */}
        <TabsContent value="services" className="space-y-6 m-0">
          <div className="flex justify-end">
            <Button onClick={openAddService} size="sm">
              <Plus className="size-4" />
              Agregar servicio
            </Button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Comisión %</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead>Disponibilidad</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredServices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No hay servicios registrados
                    </TableCell>
                  </TableRow>
                )}
                {filteredServices.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(service.price)}</TableCell>
                    <TableCell className="text-right">
                      {service.default_commission_pct > 0
                        ? `${service.default_commission_pct}%`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {service.duration_minutes ? `${service.duration_minutes} min` : '—'}
                    </TableCell>
                    <TableCell>
                      {service.availability === 'checkin' && <Badge variant="outline">Totem</Badge>}
                      {service.availability === 'upsell' && <Badge variant="outline">Adicionales</Badge>}
                      {service.availability === 'both' && <Badge variant="outline">Ambos</Badge>}
                    </TableCell>
                    <TableCell>{service.branch?.name ?? 'Todas'}</TableCell>
                    <TableCell>
                      <Badge variant={service.is_active ? 'default' : 'secondary'}>
                        {service.is_active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-xs" onClick={() => openEditService(service)}>
                          <Pencil className="size-3" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => handleToggleService(service)}>
                          <Power className="size-3" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => openDeleteService(service)} className="text-destructive hover:text-destructive">
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredServices.length === 0 && (
              <div className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                No hay servicios registrados
              </div>
            )}
            {filteredServices.map((service) => (
              <div key={service.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{service.name}</p>
                    <p className="text-sm text-muted-foreground">{service.branch?.name ?? 'Todas las sucursales'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={service.is_active ? 'default' : 'secondary'} className="text-[10px]">
                      {service.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                    <Button variant="ghost" size="icon-xs" onClick={() => openEditService(service)}><Pencil className="size-3" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleToggleService(service)}><Power className="size-3" /></Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => openDeleteService(service)} className="text-destructive hover:text-destructive"><Trash2 className="size-3" /></Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-base font-semibold text-foreground">{formatCurrency(service.price)}</span>
                  {service.duration_minutes && <span className="text-muted-foreground">{service.duration_minutes} min</span>}
                  {service.default_commission_pct > 0 && <span className="text-muted-foreground">Comisión: {service.default_commission_pct}%</span>}
                  <div>
                    {service.availability === 'checkin' && <Badge variant="outline" className="text-[10px]">Totem</Badge>}
                    {service.availability === 'upsell' && <Badge variant="outline" className="text-[10px]">Adicionales</Badge>}
                    {service.availability === 'both' && <Badge variant="outline" className="text-[10px]">Ambos</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Historial de servicios */}
          <HistorialServicios branches={branches} barbers={barbers} services={services} />
        </TabsContent>

        {/* ════════════════════════ TAB: PRODUCTOS ════════════════════════ */}
        <TabsContent value="products" className="space-y-6 m-0">
          <div className="flex justify-end">
            <Button onClick={openAddProduct} size="sm">
              <Plus className="size-4" />
              Agregar producto
            </Button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-md border">
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
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No hay productos registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{getBranchName(p.branch_id)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.cost)}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(p.sale_price)}</TableCell>
                      <TableCell className="text-right text-blue-600 dark:text-blue-400">{formatCurrency(p.barber_commission)}</TableCell>
                      <TableCell className="text-right">{p.stock === null ? 'Ilimitado' : p.stock}</TableCell>
                      <TableCell>
                        <Badge variant={p.is_active ? 'default' : 'secondary'}>{p.is_active ? 'Activo' : 'Inactivo'}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-xs" onClick={() => openEditProduct(p)}><Pencil className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => handleToggleProduct(p)}><Power className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => setProdDeleteId(p.id)}><Trash2 className="size-3" /></Button>
                          {p.is_active && (
                            <Button variant="ghost" size="icon-xs" className="text-emerald-600 hover:text-emerald-500" onClick={() => openSell(p)} title="Registrar venta">
                              <ShoppingCart className="size-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredProducts.length === 0 ? (
              <div className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                No hay productos registrados
              </div>
            ) : (
              filteredProducts.map((p) => (
                <div key={p.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{getBranchName(p.branch_id)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Badge variant={p.is_active ? 'default' : 'secondary'} className="text-[10px] mr-1">
                        {p.is_active ? 'Activo' : 'Inactivo'}
                      </Badge>
                      <Button variant="ghost" size="icon-xs" onClick={() => openEditProduct(p)}><Pencil className="size-3" /></Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleToggleProduct(p)}><Power className="size-3" /></Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => setProdDeleteId(p.id)}><Trash2 className="size-3" /></Button>
                      {p.is_active && (
                        <Button variant="ghost" size="icon-xs" className="text-emerald-600 hover:text-emerald-500" onClick={() => openSell(p)} title="Registrar venta">
                          <ShoppingCart className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Precio público</p>
                      <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(p.sale_price)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Comisión</p>
                      <p className="font-medium text-blue-600 dark:text-blue-400">{formatCurrency(p.barber_commission)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Stock</p>
                      <p className="font-medium">{p.stock === null ? 'Ilimitado' : p.stock}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        {/* ════════════════════════ TAB: VENTAS PRODUCTOS ════════════════════════ */}
        <TabsContent value="product-sales" className="space-y-4 m-0">
          {/* Desktop table */}
          <div className="hidden md:block rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Barbero</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-center">Cant.</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Precio U.</TableHead>
                  <TableHead className="text-right">Comisión</TableHead>
                  <TableHead className="text-right">Total Venta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No hay ventas en este mes.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(s.sold_at), "d 'de' MMMM, HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="font-medium">
                        {s.barber?.full_name ?? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Store className="h-3.5 w-3.5" /> Barbería
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{s.product?.name}</TableCell>
                      <TableCell className="text-center">{s.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal text-xs">
                          {paymentMethodMap[s.payment_method] || s.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(s.unit_price)}</TableCell>
                      <TableCell className="text-right text-blue-600 dark:text-blue-400">{formatCurrency(s.commission_amount)}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(s.unit_price * s.quantity)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredSales.length === 0 ? (
              <div className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                No hay ventas en este mes.
              </div>
            ) : (
              filteredSales.map((s) => (
                <div key={s.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{s.product?.name}</p>
                      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        {s.barber?.full_name ?? (<><Store className="h-3 w-3" /> Barbería</>)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(s.unit_price * s.quantity)}</p>
                      <Badge variant="outline" className="font-normal text-[10px]">
                        {paymentMethodMap[s.payment_method] || s.payment_method}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{format(new Date(s.sold_at), "d 'de' MMMM, HH:mm", { locale: es })}</span>
                    <span>Cant: {s.quantity}</span>
                    <span>Precio u.: {formatCurrency(s.unit_price)}</span>
                    <span className="text-blue-600 dark:text-blue-400">Comisión: {formatCurrency(s.commission_amount)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════ DIALOGS ═══════════════════ */}

      {/* Service dialog */}
      <Dialog open={svcDialogOpen} onOpenChange={setSvcDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{svcEditingId ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            <DialogDescription>
              {svcEditingId ? 'Modificá los datos del servicio.' : 'Completá los datos para agregar un nuevo servicio.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nombre del servicio</Label>
              <Input value={svcForm.name} onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })} placeholder="Corte clásico" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Precio (ARS)</Label>
                <Input type="number" min={0} value={svcForm.price} onChange={(e) => setSvcForm({ ...svcForm, price: e.target.value })} placeholder="5000" />
              </div>
              <div className="grid gap-2">
                <Label>Duración (minutos)</Label>
                <Input type="number" min={0} value={svcForm.duration_minutes} onChange={(e) => setSvcForm({ ...svcForm, duration_minutes: e.target.value })} placeholder="30" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Disponibilidad</Label>
                <Select value={svcForm.availability} onValueChange={(v) => setSvcForm({ ...svcForm, availability: v as ServiceAvailability })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Totem y Adicionales</SelectItem>
                    <SelectItem value="checkin">Solo Totem (Ingreso)</SelectItem>
                    <SelectItem value="upsell">Solo Adicionales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Reserva de turnos</Label>
                <Select value={svcForm.booking_mode} onValueChange={(v) => setSvcForm({ ...svcForm, booking_mode: v as BookingMode })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self_service">Cliente puede agendar</SelectItem>
                    <SelectItem value="manual_only">Solo por staff</SelectItem>
                    <SelectItem value="both">Ambos canales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Sucursal</Label>
                <Select value={svcForm.branch_id || 'all'} onValueChange={(v) => setSvcForm({ ...svcForm, branch_id: v === 'all' ? '' : v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Todas las sucursales" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sucursales</SelectItem>
                    {branches.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Comisión barbero % (default)</Label>
                <Input type="number" min={0} max={100} value={svcForm.default_commission_pct} onChange={(e) => setSvcForm({ ...svcForm, default_commission_pct: e.target.value })} placeholder="Ej: 40" />
                <p className="text-xs text-muted-foreground">Se usa si no hay un override por barbero</p>
              </div>
            </div>
            {barbers.length > 0 && (
              <div className="rounded-lg border">
                <button type="button" onClick={() => setShowOverrides(!showOverrides)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                  <span className="flex items-center gap-2">
                    <Percent className="size-4" />
                    Comisiones por barbero
                    {Object.values(barberOverrides).filter(v => v !== '').length > 0 && (
                      <Badge variant="secondary" className="text-xs">{Object.values(barberOverrides).filter(v => v !== '').length} personalizadas</Badge>
                    )}
                  </span>
                  {showOverrides ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                {showOverrides && (
                  <div className="border-t px-4 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">Dejá vacío para usar la comisión default del servicio</p>
                    {barbers.map((barber) => (
                      <div key={barber.id} className="flex items-center gap-3">
                        <span className="text-sm flex-1 truncate">{barber.full_name}</span>
                        <div className="flex items-center gap-1 w-24">
                          <Input type="number" min={0} max={100} value={barberOverrides[barber.id] ?? ''} onChange={(e) => setBarberOverrides({ ...barberOverrides, [barber.id]: e.target.value })} placeholder="—" className="h-8 text-sm" />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSvcDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveService} disabled={svcSaving || !svcForm.name || !svcForm.price}>
              {svcSaving ? 'Guardando...' : svcEditingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete service dialog */}
      <AlertDialog open={svcDeleteOpen} onOpenChange={setSvcDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar servicio?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás por eliminar <strong>{deletingService?.name}</strong>. Si tiene visitas asociadas no se podrá eliminar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={svcDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteService} disabled={svcDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {svcDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Product dialog */}
      <Dialog open={prodDialogOpen} onOpenChange={setProdDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prodEditingId ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
            <DialogDescription>Configurá los precios y comisiones para la venta de este producto.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nombre del Producto *</Label>
              <Input value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} placeholder="Ej: Cera Mate 100g" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Precio de Venta (Público) *</Label>
                <Input type="number" min="0" value={prodForm.sale_price} onChange={(e) => setProdForm({ ...prodForm, sale_price: e.target.value })} placeholder="Ej: 8000" />
              </div>
              <div className="grid gap-2">
                <Label>Costo Operativo</Label>
                <Input type="number" min="0" value={prodForm.cost} onChange={(e) => setProdForm({ ...prodForm, cost: e.target.value })} placeholder="Ej: 4000" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Comisión Barbero (ARS)</Label>
                <Input type="number" min="0" value={prodForm.barber_commission} onChange={(e) => setProdForm({ ...prodForm, barber_commission: e.target.value })} placeholder="Ej: 1000" />
              </div>
              <div className="grid gap-2">
                <Label>Stock (vacío = ilimitado)</Label>
                <Input type="number" min="0" value={prodForm.stock} onChange={(e) => setProdForm({ ...prodForm, stock: e.target.value })} placeholder="Ej: 25" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Sucursal</Label>
              <Select value={prodForm.branch_id || 'all'} onValueChange={(v) => setProdForm({ ...prodForm, branch_id: v === 'all' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todas las sucursales" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {branches.map(b => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProdDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveProduct} disabled={prodSaving || !prodForm.name || !prodForm.sale_price}>
              {prodSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete product dialog */}
      <AlertDialog open={!!prodDeleteId} onOpenChange={() => setProdDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Si el producto tiene ventas registradas, no podrás eliminarlo (deberías desactivarlo en su lugar).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mantener</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteProduct} disabled={prodDeleting}>
              {prodDeleting ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sell product dialog */}
      <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar venta</DialogTitle>
            <DialogDescription>
              {sellingProduct?.name} — Precio: {sellingProduct ? formatCurrency(sellingProduct.sale_price) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>¿Quién hace la venta?</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSellForm({ ...sellForm, seller_type: 'barber' })}
                  className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition-colors ${
                    sellForm.seller_type === 'barber'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <User className="h-4 w-4" />
                  <span className="font-medium">Barbero</span>
                  <span className="text-[10px] opacity-70">Comisión al barbero</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSellForm({ ...sellForm, seller_type: 'house', barber_id: '' })}
                  className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition-colors ${
                    sellForm.seller_type === 'house'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <Store className="h-4 w-4" />
                  <span className="font-medium">Barbería</span>
                  <span className="text-[10px] opacity-70">Ingreso para la casa</span>
                </button>
              </div>
            </div>
            {!isHouseSale && (
              <div className="grid gap-2">
                <Label>Barbero *</Label>
                <Select value={sellForm.barber_id} onValueChange={(v) => setSellForm({ ...sellForm, barber_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar barbero" /></SelectTrigger>
                  <SelectContent>
                    {sellableBarbers.map(b => (<SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Cantidad</Label>
                <Input type="number" min="1" value={sellForm.quantity} onChange={(e) => setSellForm({ ...sellForm, quantity: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Método de pago</Label>
                <Select value={sellForm.payment_method} onValueChange={(v: 'cash' | 'transfer' | 'card') => setSellForm({ ...sellForm, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sellingProduct && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total venta</span>
                  <span className="font-semibold">{formatCurrency(sellingProduct.sale_price * (Number(sellForm.quantity) || 1))}</span>
                </div>
                {isHouseSale ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ingreso barbería</span>
                    <span className="text-emerald-500">{formatCurrency(sellingProduct.sale_price * (Number(sellForm.quantity) || 1))}</span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Comisión barbero</span>
                    <span className="text-blue-500">{formatCurrency(sellingProduct.barber_commission * (Number(sellForm.quantity) || 1))}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSellDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSell} disabled={selling || !canSubmitSell}>
              {selling ? 'Registrando...' : 'Confirmar venta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
