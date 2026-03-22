'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power, ChevronDown, ChevronUp, Percent } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import { formatCurrency } from '@/lib/format'
import { HistorialServicios } from './historial-servicios'
import type { Service, Branch, ServiceAvailability, Staff, StaffServiceCommission } from '@/lib/types/database'
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

export function ServiciosClient({ services, branches, barbers, commissions }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  // Service state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="space-y-8">
      {/* Services section */}
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight lg:text-2xl">Servicios</h2>
            <p className="text-sm text-muted-foreground">
              Catálogo de servicios y precios
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <BranchSelector branches={branches} />
            <Button onClick={openAdd} size="sm" className="w-full sm:w-auto">
              <Plus className="size-4" />
              Agregar servicio
            </Button>
          </div>
        </div>

        {/* Vista tabla — solo en desktop */}
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
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
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

        {/* Vista cards — solo en mobile */}
        <div className="md:hidden space-y-3">
          {filtered.length === 0 && (
            <div className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
              No hay servicios registrados
            </div>
          )}
          {filtered.map((service) => (
            <div key={service.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{service.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {service.branch?.name ?? 'Todas las sucursales'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant={service.is_active ? 'default' : 'secondary'} className="text-[10px]">
                    {service.is_active ? 'Activo' : 'Inactivo'}
                  </Badge>
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
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <span className="text-base font-semibold text-foreground">
                  {formatCurrency(service.price)}
                </span>
                {service.duration_minutes && (
                  <span className="text-muted-foreground">
                    {service.duration_minutes} min
                  </span>
                )}
                {service.default_commission_pct > 0 && (
                  <span className="text-muted-foreground">
                    Comisión: {service.default_commission_pct}%
                  </span>
                )}
                <div>
                  {service.availability === 'checkin' && <Badge variant="outline" className="text-[10px]">Totem</Badge>}
                  {service.availability === 'upsell' && <Badge variant="outline" className="text-[10px]">Adicionales</Badge>}
                  {service.availability === 'both' && <Badge variant="outline" className="text-[10px]">Ambos</Badge>}
                </div>
              </div>
            </div>
          ))}
        </div>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

      <Separator />

      {/* History section */}
      <HistorialServicios branches={branches} barbers={barbers} services={services} />
    </div>
  )
}
