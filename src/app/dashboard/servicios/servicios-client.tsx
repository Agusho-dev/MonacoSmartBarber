'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power, Trash2, Tag, ChevronDown, ChevronUp, Percent } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency } from '@/lib/format'
import {
  upsertServiceTag,
  deleteServiceTag,
} from '@/lib/actions/tags'
import { HistorialServicios } from './historial-servicios'
import type { Service, Branch, ServiceTag, ServiceAvailability, Staff, StaffServiceCommission } from '@/lib/types/database'
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
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

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
  tags: ServiceTag[]
  barbers: BarberMinimal[]
  commissions: StaffServiceCommission[]
}

const emptyForm = {
  name: '',
  price: '',
  duration_minutes: '',
  branch_id: '',
  availability: 'both' as ServiceAvailability,
  default_commission_pct: '',
}

export function ServiciosClient({ services, branches, tags, barbers, commissions }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  // Service state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // Tag state
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagSaving, setTagSaving] = useState(false)

  // Commission overrides state
  const [showOverrides, setShowOverrides] = useState(false)
  const [barberOverrides, setBarberOverrides] = useState<Record<string, string>>({})

  const filtered = selectedBranchId
    ? services.filter(
      (s) => s.branch_id === selectedBranchId || s.branch_id === null
    )
    : services

  // --- Service CRUD ---
  function openAdd() {
    setEditingId(null)
    setForm({
      ...emptyForm,
      branch_id: selectedBranchId ?? '',
    })
    setBarberOverrides({})
    setShowOverrides(false)
    setDialogOpen(true)
  }

  function openEdit(service: ServiceWithBranch) {
    setEditingId(service.id)
    setForm({
      name: service.name,
      price: String(service.price),
      duration_minutes: service.duration_minutes
        ? String(service.duration_minutes)
        : '',
      branch_id: service.branch_id ?? '',
      availability: service.availability ?? 'both',
      default_commission_pct: service.default_commission_pct
        ? String(service.default_commission_pct)
        : '',
    })
    // Load existing barber overrides for this service
    const overrides: Record<string, string> = {}
    commissions
      .filter((c) => c.service_id === service.id)
      .forEach((c) => {
        overrides[c.staff_id] = String(c.commission_pct)
      })
    setBarberOverrides(overrides)
    setShowOverrides(Object.keys(overrides).length > 0)
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const data = {
      name: form.name,
      price: Number(form.price),
      duration_minutes: form.duration_minutes
        ? Number(form.duration_minutes)
        : null,
      branch_id: form.branch_id || null,
      availability: form.availability,
      default_commission_pct: form.default_commission_pct
        ? Number(form.default_commission_pct)
        : 0,
    }

    let serviceId = editingId

    if (editingId) {
      await supabase.from('services').update(data).eq('id', editingId)
    } else {
      const { data: inserted } = await supabase
        .from('services')
        .insert(data)
        .select('id')
        .single()
      if (inserted) serviceId = inserted.id
    }

    // Save barber commission overrides
    if (serviceId) {
      // Delete existing overrides for this service
      await supabase
        .from('staff_service_commissions')
        .delete()
        .eq('service_id', serviceId)

      // Insert non-empty overrides
      const rows = Object.entries(barberOverrides)
        .filter(([, val]) => val !== '' && Number(val) >= 0)
        .map(([staffId, val]) => ({
          staff_id: staffId,
          service_id: serviceId!,
          commission_pct: Number(val),
        }))

      if (rows.length > 0) {
        await supabase.from('staff_service_commissions').insert(rows)
      }
    }

    setSaving(false)
    setDialogOpen(false)
    router.refresh()
  }

  async function toggleActive(service: Service) {
    await supabase
      .from('services')
      .update({ is_active: !service.is_active })
      .eq('id', service.id)
    router.refresh()
  }

  // --- Tag CRUD ---
  function openAddTag() {
    setEditingTagId(null)
    setTagName('')
    setTagDialogOpen(true)
  }

  function openEditTag(tag: ServiceTag) {
    setEditingTagId(tag.id)
    setTagName(tag.name)
    setTagDialogOpen(true)
  }

  async function handleSaveTag() {
    if (!tagName.trim()) return
    setTagSaving(true)
    const result = await upsertServiceTag(
      tagName.trim(),
      editingTagId ?? undefined
    )
    if (result.error) {
      toast.error(result.error)
    }
    setTagSaving(false)
    setTagDialogOpen(false)
    router.refresh()
  }

  async function handleDeleteTag(id: string) {
    const result = await deleteServiceTag(id)
    if (result.error) {
      toast.error(result.error)
    }
    router.refresh()
  }

  return (
    <div className="space-y-8">
      {/* Services section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Servicios</h2>
            <p className="text-sm text-muted-foreground">
              Catálogo de servicios y precios
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BranchSelector branches={branches} />
            <Button onClick={openAdd}>
              <Plus className="size-4" />
              Agregar servicio
            </Button>
          </div>
        </div>

        <div className="rounded-lg border">
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
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No hay servicios registrados
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(service.price)}
                  </TableCell>
                  <TableCell className="text-right">
                    {service.default_commission_pct > 0
                      ? `${service.default_commission_pct}%`
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {service.duration_minutes
                      ? `${service.duration_minutes} min`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {service.availability === 'checkin' && <Badge variant="outline">Totem</Badge>}
                    {service.availability === 'upsell' && <Badge variant="outline">Adicionales</Badge>}
                    {service.availability === 'both' && <Badge variant="outline">Ambos</Badge>}
                  </TableCell>
                  <TableCell>{service.branch?.name ?? 'Todas'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={service.is_active ? 'default' : 'secondary'}
                    >
                      {service.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => openEdit(service)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => toggleActive(service)}
                      >
                        <Power className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Separator />

      {/* Tags section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">
              Etiquetas de servicio
            </h3>
            <p className="text-sm text-muted-foreground">
              Etiquetas disponibles para describir los cortes realizados
            </p>
          </div>
          <Button size="sm" onClick={openAddTag}>
            <Plus className="size-4" />
            Agregar etiqueta
          </Button>
        </div>

        {tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center text-muted-foreground">
            <Tag className="mb-2 size-8 opacity-30" />
            <p className="text-sm">No hay etiquetas configuradas</p>
            <p className="mt-1 text-xs">
              Las etiquetas ayudan a los barberos a categorizar los cortes
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="group flex items-center gap-1.5 rounded-lg border bg-secondary/50 px-3 py-1.5"
              >
                <Tag className="size-3 text-muted-foreground" />
                <span className="text-sm">{tag.name}</span>
                <button
                  type="button"
                  onClick={() => openEditTag(tag)}
                  className="ml-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteTag(tag.id)}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Service dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar servicio' : 'Nuevo servicio'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modificá los datos del servicio.'
                : 'Completá los datos para agregar un nuevo servicio.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nombre del servicio</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Corte clásico"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Precio (ARS)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="5000"
                />
              </div>
              <div className="grid gap-2">
                <Label>Duración (minutos)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.duration_minutes}
                  onChange={(e) =>
                    setForm({ ...form, duration_minutes: e.target.value })
                  }
                  placeholder="30"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Disponibilidad</Label>
                <Select
                  value={form.availability}
                  onValueChange={(v) => setForm({ ...form, availability: v as ServiceAvailability })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Totem y Adicionales</SelectItem>
                    <SelectItem value="checkin">Solo Totem (Ingreso)</SelectItem>
                    <SelectItem value="upsell">Solo Adicionales</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Sucursal</Label>
                <Select
                  value={form.branch_id || 'all'}
                  onValueChange={(v) =>
                    setForm({ ...form, branch_id: v === 'all' ? '' : v })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todas las sucursales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sucursales</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Comisión barbero % (default)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.default_commission_pct}
                  onChange={(e) =>
                    setForm({ ...form, default_commission_pct: e.target.value })
                  }
                  placeholder="Ej: 40"
                />
                <p className="text-xs text-muted-foreground">
                  Se usa si no hay un override por barbero
                </p>
              </div>
            </div>

            {/* Per-barber commission overrides */}
            {barbers.length > 0 && (
              <div className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setShowOverrides(!showOverrides)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Percent className="size-4" />
                    Comisiones por barbero
                    {Object.values(barberOverrides).filter(v => v !== '').length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {Object.values(barberOverrides).filter(v => v !== '').length} personalizadas
                      </Badge>
                    )}
                  </span>
                  {showOverrides ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                {showOverrides && (
                  <div className="border-t px-4 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">
                      Dejá vacío para usar la comisión default del servicio
                    </p>
                    {barbers.map((barber) => (
                      <div key={barber.id} className="flex items-center gap-3">
                        <span className="text-sm flex-1 truncate">{barber.full_name}</span>
                        <div className="flex items-center gap-1 w-24">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={barberOverrides[barber.id] ?? ''}
                            onChange={(e) =>
                              setBarberOverrides({
                                ...barberOverrides,
                                [barber.id]: e.target.value,
                              })
                            }
                            placeholder="—"
                            className="h-8 text-sm"
                          />
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name || !form.price}
            >
              {saving
                ? 'Guardando...'
                : editingId
                  ? 'Guardar cambios'
                  : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingTagId ? 'Editar etiqueta' : 'Nueva etiqueta'}
            </DialogTitle>
            <DialogDescription>
              Las etiquetas se usan para describir los cortes realizados.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label>Nombre de la etiqueta</Label>
            <Input
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="Ej: Degradé"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTag()
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTagDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveTag}
              disabled={tagSaving || !tagName.trim()}
            >
              {tagSaving
                ? 'Guardando...'
                : editingTagId
                  ? 'Guardar'
                  : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

      {/* History section */}
      <HistorialServicios branches={branches} barbers={barbers} />
    </div>
  )
}
