'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import { formatCurrency } from '@/lib/format'
import type { Staff, Branch, UserRole } from '@/lib/types/database'
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

interface BarberVisitRow {
  barber_id: string
  amount: number
}

interface Props {
  barbers: Staff[]
  branches: Branch[]
  todayVisits: BarberVisitRow[]
}

const roleLabels: Record<UserRole, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  receptionist: 'Recepcionista',
  barber: 'Barbero',
}

const emptyForm = {
  full_name: '',
  branch_id: '',
  commission_pct: '30',
  pin: '',
  role: 'barber' as UserRole,
  email: '',
  phone: '',
}

export function BarberosClient({ barbers, branches, todayVisits }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const filtered = selectedBranchId
    ? barbers.filter((b) => b.branch_id === selectedBranchId)
    : barbers

  const barberStats = new Map<string, { cuts: number; revenue: number }>()
  todayVisits.forEach((v) => {
    const existing = barberStats.get(v.barber_id) ?? { cuts: 0, revenue: 0 }
    barberStats.set(v.barber_id, {
      cuts: existing.cuts + 1,
      revenue: existing.revenue + v.amount,
    })
  })

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(barber: Staff) {
    setEditingId(barber.id)
    setForm({
      full_name: barber.full_name,
      branch_id: barber.branch_id ?? '',
      commission_pct: String(barber.commission_pct),
      pin: barber.pin ?? '',
      role: barber.role,
      email: barber.email ?? '',
      phone: barber.phone ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (form.pin && form.pin.length !== 4) {
      alert('El PIN debe ser de exactamente 4 dígitos')
      return
    }
    setSaving(true)
    const data = {
      full_name: form.full_name,
      branch_id: form.branch_id || null,
      commission_pct: Number(form.commission_pct),
      pin: form.pin || null,
      role: form.role,
      email: form.email || null,
      phone: form.phone || null,
    }

    if (editingId) {
      await supabase.from('staff').update(data).eq('id', editingId)
    } else {
      await supabase.from('staff').insert(data)
    }

    setSaving(false)
    setDialogOpen(false)
    router.refresh()
  }

  async function toggleActive(barber: Staff) {
    await supabase
      .from('staff')
      .update({ is_active: !barber.is_active })
      .eq('id', barber.id)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Barberos</h2>
          <p className="text-sm text-muted-foreground">
            Gestión del equipo de trabajo
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="size-4" />
          Agregar barbero
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Sucursal</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="text-right">Comisión %</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Hoy</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No hay barberos registrados
                </TableCell>
              </TableRow>
            )}
            {filtered.map((barber) => {
              const stats = barberStats.get(barber.id)
              return (
                <TableRow key={barber.id}>
                  <TableCell className="font-medium">{barber.full_name}</TableCell>
                  <TableCell>{barber.branch?.name ?? '—'}</TableCell>
                  <TableCell>{roleLabels[barber.role]}</TableCell>
                  <TableCell className="text-right">{barber.commission_pct}%</TableCell>
                  <TableCell className="text-muted-foreground">{barber.phone ?? '—'}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {barber.pin ? '••••' : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={barber.is_active ? 'default' : 'secondary'}>
                      {barber.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {stats ? (
                      <span className="text-sm">
                        {stats.cuts} cortes · {formatCurrency(stats.revenue)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => openEdit(barber)}>
                        <Pencil className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => toggleActive(barber)}>
                        <Power className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar barbero' : 'Nuevo barbero'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modificá los datos del barbero.'
                : 'Completá los datos para agregar un nuevo barbero.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nombre completo</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Juan Pérez"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="juan@email.com"
                />
              </div>
              <div className="grid gap-2">
                <Label>Teléfono</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="3410000000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Sucursal</Label>
                <Select
                  value={form.branch_id}
                  onValueChange={(v) => setForm({ ...form, branch_id: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Rol</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as UserRole })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="barber">Barbero</SelectItem>
                    <SelectItem value="receptionist">Recepcionista</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Comisión %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.commission_pct}
                  onChange={(e) => setForm({ ...form, commission_pct: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>PIN (4 dígitos)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={form.pin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setForm({ ...form, pin: val })
                  }}
                  placeholder="1234"
                  className="font-mono tracking-widest"
                />
                {form.pin.length > 0 && form.pin.length < 4 && (
                  <p className="text-xs text-muted-foreground">
                    {4 - form.pin.length} dígitos restantes
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.full_name}>
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
