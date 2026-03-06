'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import { formatCurrency } from '@/lib/format'
import type { Service, Branch } from '@/lib/types/database'
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

interface ServiceWithBranch extends Service {
  branch?: Branch | null
}

interface Props {
  services: ServiceWithBranch[]
  branches: Branch[]
}

const emptyForm = {
  name: '',
  price: '',
  duration_minutes: '',
  branch_id: '',
}

export function ServiciosClient({ services, branches }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const filtered = selectedBranchId
    ? services.filter((s) => s.branch_id === selectedBranchId)
    : services

  function openAdd() {
    setEditingId(null)
    setForm({
      ...emptyForm,
      branch_id: selectedBranchId ?? '',
    })
    setDialogOpen(true)
  }

  function openEdit(service: ServiceWithBranch) {
    setEditingId(service.id)
    setForm({
      name: service.name,
      price: String(service.price),
      duration_minutes: service.duration_minutes ? String(service.duration_minutes) : '',
      branch_id: service.branch_id ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const data = {
      name: form.name,
      price: Number(form.price),
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      branch_id: form.branch_id || null,
    }

    if (editingId) {
      await supabase.from('services').update(data).eq('id', editingId)
    } else {
      await supabase.from('services').insert(data)
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Servicios</h2>
          <p className="text-sm text-muted-foreground">
            Catálogo de servicios y precios
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="size-4" />
          Agregar servicio
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Duración</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
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
                  {service.duration_minutes ? `${service.duration_minutes} min` : '—'}
                </TableCell>
                <TableCell>{service.branch?.name ?? 'Todas'}</TableCell>
                <TableCell>
                  <Badge variant={service.is_active ? 'default' : 'secondary'}>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name || !form.price}
            >
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
