'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Gift,
  Save,
  Plus,
  Pencil,
  Power,
  Megaphone,
  Smartphone,
  ImageIcon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { updateRewardConfig } from '@/lib/actions/rewards'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'

// ── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: string
  name: string
}

interface RewardConfig {
  id: string
  branch_id: string
  points_per_visit: number
  redemption_threshold: number
  reward_description: string
  is_active: boolean
}

interface CatalogItem {
  id: string
  name: string
  description: string | null
  type: string
  discount_pct: number | null
  is_free_service: boolean
  stock: number | null
  spin_probability: number | null
  is_active: boolean
  valid_from: string | null
  valid_until: string | null
  points_cost: number
  created_at: string
}

interface BillboardItem {
  id: string
  branch_id: string | null
  title: string
  subtitle: string | null
  image_url: string | null
  bg_color: string | null
  sort_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  link_type: string | null
  link_value: string | null
  branch: { name: string } | null
}

interface Props {
  branches: Branch[]
  initialConfigs: RewardConfig[]
  initialCatalog: CatalogItem[]
  initialBillboard: BillboardItem[]
}

// ── Reward type labels ───────────────────────────────────────────────────────

const REWARD_TYPES: Record<string, string> = {
  points_redemption: 'Canje por puntos',
  spin_prize: 'Premio ruleta',
  return_discount: 'Descuento retorno',
  milestone_free: 'Gratis por hito',
  manual: 'Manual',
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AppMovilClient({
  branches,
  initialConfigs,
  initialCatalog,
  initialBillboard,
}: Props) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Smartphone className="size-7 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">APP Móvil</h1>
          <p className="text-muted-foreground">
            Configurá los contenidos y recompensas que ven los clientes en la app.
          </p>
        </div>
      </div>

      <Tabs defaultValue="puntos" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="puntos" className="gap-2">
            <Gift className="size-4" />
            Puntos
          </TabsTrigger>
          <TabsTrigger value="catalogo" className="gap-2">
            <Gift className="size-4" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="cartelera" className="gap-2">
            <Megaphone className="size-4" />
            Cartelera
          </TabsTrigger>
        </TabsList>

        <TabsContent value="puntos">
          <PuntosTab branches={branches} initialConfigs={initialConfigs} />
        </TabsContent>
        <TabsContent value="catalogo">
          <CatalogoTab initialCatalog={initialCatalog} />
        </TabsContent>
        <TabsContent value="cartelera">
          <CarteleraTab branches={branches} initialBillboard={initialBillboard} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: Configuración de Puntos
// ══════════════════════════════════════════════════════════════════════════════

function PuntosTab({
  branches,
  initialConfigs,
}: {
  branches: Branch[]
  initialConfigs: RewardConfig[]
}) {
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id || '')
  const [isPending, startTransition] = useTransition()

  const currentConfig = initialConfigs.find((c) => c.branch_id === selectedBranchId)

  const [formData, setFormData] = useState({
    points_per_visit: currentConfig?.points_per_visit ?? 1,
    redemption_threshold: currentConfig?.redemption_threshold ?? 10,
    reward_description: currentConfig?.reward_description ?? 'Corte gratis',
    is_active: currentConfig?.is_active ?? true,
  })

  function handleBranchChange(branchId: string) {
    setSelectedBranchId(branchId)
    const config = initialConfigs.find((c) => c.branch_id === branchId)
    setFormData({
      points_per_visit: config?.points_per_visit ?? 1,
      redemption_threshold: config?.redemption_threshold ?? 10,
      reward_description: config?.reward_description ?? 'Corte gratis',
      is_active: config?.is_active ?? true,
    })
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateRewardConfig(selectedBranchId, formData)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Configuración de puntos guardada')
      }
    })
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-5 text-primary" />
            Configurar Puntos por Sucursal
          </CardTitle>
          <CardDescription>
            Definí cuántos puntos ganan los clientes por visita y cuántos necesitan para canjear.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Select value={selectedBranchId} onValueChange={handleBranchChange}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Seleccionar sucursal" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Sistema Activado</Label>
              <p className="text-sm text-muted-foreground">
                Si se desactiva, no se otorgarán puntos nuevos.
              </p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, is_active: checked })
              }
            />
          </div>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Puntos por cada visita</Label>
              <Input
                type="number"
                min={1}
                value={formData.points_per_visit}
                onChange={(e) =>
                  setFormData({ ...formData, points_per_visit: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Puntos necesarios para canjear</Label>
              <Input
                type="number"
                min={1}
                value={formData.redemption_threshold}
                onChange={(e) =>
                  setFormData({ ...formData, redemption_threshold: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Beneficio a otorgar</Label>
              <Input
                value={formData.reward_description}
                onChange={(e) =>
                  setFormData({ ...formData, reward_description: e.target.value })
                }
                placeholder="Ej: Corte gratis"
              />
            </div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={isPending}>
            {isPending ? (
              'Guardando...'
            ) : (
              <>
                <Save className="mr-2 size-4" />
                Guardar Configuración
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>¿Cómo funciona?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            1. Cada vez que un barbero <strong>finaliza un servicio</strong>, el cliente
            suma automáticamente los puntos configurados.
          </p>
          <p>
            2. Los clientes ven sus puntos en la <strong>App Móvil</strong>.
          </p>
          <p>
            3. Cuando alcanza el umbral, puede &quot;Canjear premio&quot; desde la app.
          </p>
          <p>
            4. El barbero verá el ícono 🎁 en su turno y al finalizar elegirá pago con
            <strong> Puntos</strong> (costo $0, debita puntos automáticamente).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: Catálogo de Premios
// ══════════════════════════════════════════════════════════════════════════════

const emptyCatalogForm = {
  name: '',
  description: '',
  type: 'points_redemption' as string,
  points_cost: '0',
  discount_pct: '',
  is_free_service: false,
  stock: '',
  spin_probability: '',
  valid_from: '',
  valid_until: '',
  is_active: true,
}

function CatalogoTab({ initialCatalog }: { initialCatalog: CatalogItem[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyCatalogForm)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setEditingId(null)
    setForm(emptyCatalogForm)
    setDialogOpen(true)
  }

  function openEdit(item: CatalogItem) {
    setEditingId(item.id)
    setForm({
      name: item.name,
      description: item.description || '',
      type: item.type,
      points_cost: String(item.points_cost),
      discount_pct: item.discount_pct != null ? String(item.discount_pct) : '',
      is_free_service: item.is_free_service,
      stock: item.stock != null ? String(item.stock) : '',
      spin_probability: item.spin_probability != null ? String(item.spin_probability) : '',
      valid_from: item.valid_from ? item.valid_from.slice(0, 10) : '',
      valid_until: item.valid_until ? item.valid_until.slice(0, 10) : '',
      is_active: item.is_active,
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    setSaving(true)

    const data: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      type: form.type,
      points_cost: parseInt(form.points_cost) || 0,
      discount_pct: form.discount_pct ? parseInt(form.discount_pct) : null,
      is_free_service: form.is_free_service,
      stock: form.stock ? parseInt(form.stock) : null,
      spin_probability: form.spin_probability ? parseFloat(form.spin_probability) : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: form.is_active,
    }

    let error
    if (editingId) {
      const res = await supabase.from('reward_catalog').update(data).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('reward_catalog').insert(data)
      error = res.error
    }

    setSaving(false)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(editingId ? 'Premio actualizado' : 'Premio creado')
      setDialogOpen(false)
      router.refresh()
    }
  }

  async function toggleActive(item: CatalogItem) {
    const { error } = await supabase
      .from('reward_catalog')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    if (error) {
      toast.error(error.message)
    } else {
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Catálogo de Premios</h2>
          <p className="text-sm text-muted-foreground">
            Premios que los clientes pueden canjear con puntos desde la app.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 size-4" />
          Agregar Premio
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Costo (pts)</TableHead>
              <TableHead className="text-right">Descuento</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialCatalog.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No hay premios en el catálogo. Agregá uno para empezar.
                </TableCell>
              </TableRow>
            ) : (
              initialCatalog.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {REWARD_TYPES[item.type] || item.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{item.points_cost}</TableCell>
                  <TableCell className="text-right">
                    {item.discount_pct != null ? `${item.discount_pct}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.stock != null ? item.stock : '∞'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.is_active ? 'default' : 'secondary'}>
                      {item.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(item)}>
                      <Power className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Premio' : 'Nuevo Premio'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Corte gratis"
              />
            </div>

            <div className="grid gap-2">
              <Label>Descripción</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción opcional del premio"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select
                  value={form.type}
                  onValueChange={(val) => setForm({ ...form, type: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REWARD_TYPES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Costo en puntos</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.points_cost}
                  onChange={(e) => setForm({ ...form, points_cost: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Descuento %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.discount_pct}
                  onChange={(e) => setForm({ ...form, discount_pct: e.target.value })}
                  placeholder="Opcional"
                />
              </div>
              <div className="grid gap-2">
                <Label>Stock</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  placeholder="Vacío = ilimitado"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Válido desde</Label>
                <Input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Válido hasta</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Servicio gratis</Label>
                <p className="text-xs text-muted-foreground">El premio es un servicio sin costo</p>
              </div>
              <Switch
                checked={form.is_free_service}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_free_service: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Activo</Label>
                <p className="text-xs text-muted-foreground">Visible para los clientes</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: Cartelera (Billboard)
// ══════════════════════════════════════════════════════════════════════════════

const emptyBillboardForm = {
  title: '',
  subtitle: '',
  image_url: '',
  bg_color: '#1a1a2e',
  branch_id: '__all__',
  sort_order: '0',
  is_active: true,
  starts_at: '',
  ends_at: '',
  link_type: '',
  link_value: '',
}

function CarteleraTab({
  branches,
  initialBillboard,
}: {
  branches: Branch[]
  initialBillboard: BillboardItem[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyBillboardForm)
  const [saving, setSaving] = useState(false)

  function openAdd() {
    setEditingId(null)
    setForm(emptyBillboardForm)
    setDialogOpen(true)
  }

  function openEdit(item: BillboardItem) {
    setEditingId(item.id)
    setForm({
      title: item.title,
      subtitle: item.subtitle || '',
      image_url: item.image_url || '',
      bg_color: item.bg_color || '#1a1a2e',
      branch_id: item.branch_id || '__all__',
      sort_order: String(item.sort_order),
      is_active: item.is_active,
      starts_at: item.starts_at ? item.starts_at.slice(0, 10) : '',
      ends_at: item.ends_at ? item.ends_at.slice(0, 10) : '',
      link_type: item.link_type || '',
      link_value: item.link_value || '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('El título es obligatorio')
      return
    }
    setSaving(true)

    const data: Record<string, unknown> = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      image_url: form.image_url.trim() || null,
      bg_color: form.bg_color || null,
      branch_id: form.branch_id === '__all__' ? null : form.branch_id,
      sort_order: parseInt(form.sort_order) || 0,
      is_active: form.is_active,
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
      link_type: form.link_type || null,
      link_value: form.link_value || null,
    }

    let error
    if (editingId) {
      const res = await supabase.from('billboard_items').update(data).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('billboard_items').insert(data)
      error = res.error
    }

    setSaving(false)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(editingId ? 'Item actualizado' : 'Item creado')
      setDialogOpen(false)
      router.refresh()
    }
  }

  async function toggleActive(item: BillboardItem) {
    const { error } = await supabase
      .from('billboard_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    if (error) {
      toast.error(error.message)
    } else {
      router.refresh()
    }
  }

  function formatDateShort(dateStr: string | null) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Cartelera</h2>
          <p className="text-sm text-muted-foreground">
            Banners y promociones que aparecen en el inicio de la app.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 size-4" />
          Agregar Item
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Subtítulo</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead className="text-center">Orden</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialBillboard.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  <ImageIcon className="mx-auto mb-2 size-8 opacity-20" />
                  No hay items en la cartelera. Agregá uno para empezar.
                </TableCell>
              </TableRow>
            ) : (
              initialBillboard.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.subtitle || '—'}
                  </TableCell>
                  <TableCell>{item.branch?.name || 'Todas'}</TableCell>
                  <TableCell className="text-center">{item.sort_order}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateShort(item.starts_at)} – {formatDateShort(item.ends_at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.is_active ? 'default' : 'secondary'}>
                      {item.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(item)}>
                      <Power className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Item' : 'Nuevo Item de Cartelera'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Título</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ej: Promo Verano 2026"
              />
            </div>

            <div className="grid gap-2">
              <Label>Subtítulo</Label>
              <Input
                value={form.subtitle}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                placeholder="Descripción breve (opcional)"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Sucursal</Label>
                <Select
                  value={form.branch_id}
                  onValueChange={(val) => setForm({ ...form, branch_id: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas las sucursales</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>URL de imagen</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div className="grid gap-2">
                <Label>Color de fondo</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.bg_color}
                    onChange={(e) => setForm({ ...form, bg_color: e.target.value })}
                    placeholder="#1a1a2e"
                  />
                  <input
                    type="color"
                    value={form.bg_color}
                    onChange={(e) => setForm({ ...form, bg_color: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded border p-1"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Inicio</Label>
                <Input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Fin</Label>
                <Input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Tipo de link</Label>
                <Select
                  value={form.link_type || '__none__'}
                  onValueChange={(val) =>
                    setForm({ ...form, link_type: val === '__none__' ? '' : val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Ninguno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Ninguno</SelectItem>
                    <SelectItem value="url">URL externa</SelectItem>
                    <SelectItem value="screen">Pantalla de la app</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.link_type && (
                <div className="grid gap-2">
                  <Label>Valor del link</Label>
                  <Input
                    value={form.link_value}
                    onChange={(e) => setForm({ ...form, link_value: e.target.value })}
                    placeholder={form.link_type === 'url' ? 'https://...' : '/rewards'}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label>Activo</Label>
                <p className="text-xs text-muted-foreground">Visible en la app</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
