'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Users, Scissors, Clock, DollarSign } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/format'
import type { Branch, BranchOccupancy } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface StaffRow {
  id: string
  branch_id: string | null
  is_active: boolean
}

interface VisitRow {
  branch_id: string
  amount: number
}

interface Props {
  branches: Branch[]
  staff: StaffRow[]
  todayVisits: VisitRow[]
  occupancy: BranchOccupancy[]
}

const emptyForm = {
  name: '',
  address: '',
  phone: '',
}

export function SucursalesClient({ branches, staff, todayVisits, occupancy }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  function getBranchStats(branchId: string) {
    const barberCount = staff.filter((s) => s.branch_id === branchId).length
    const bVisits = todayVisits.filter((v) => v.branch_id === branchId)
    const revenue = bVisits.reduce((s, v) => s + v.amount, 0)
    const occ = occupancy.find((o) => o.branch_id === branchId)
    return {
      barberCount,
      visitsToday: bVisits.length,
      revenue,
      waiting: occ?.clients_waiting ?? 0,
      inProgress: occ?.clients_in_progress ?? 0,
    }
  }

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(branch: Branch) {
    setEditingId(branch.id)
    setForm({
      name: branch.name,
      address: branch.address ?? '',
      phone: branch.phone ?? '',
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const data = {
      name: form.name,
      address: form.address || null,
      phone: form.phone || null,
    }

    if (editingId) {
      await supabase.from('branches').update(data).eq('id', editingId)
    } else {
      await supabase.from('branches').insert(data)
    }

    setSaving(false)
    setDialogOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Sucursales</h2>
          <p className="text-sm text-muted-foreground">
            Gestión de locales y sucursales
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="size-4" />
          Agregar sucursal
        </Button>
      </div>

      {branches.length === 0 && (
        <Card>
          <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
            No hay sucursales registradas
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((branch) => {
          const stats = getBranchStats(branch.id)
          return (
            <Card key={branch.id}>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {branch.name}
                    <Badge
                      variant={branch.is_active ? 'default' : 'secondary'}
                      className="text-[10px]"
                    >
                      {branch.is_active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </CardTitle>
                  {branch.address && (
                    <CardDescription className="mt-1">
                      {branch.address}
                    </CardDescription>
                  )}
                </div>
                <CardAction>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => openEdit(branch)}
                  >
                    <Pencil className="size-3" />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat icon={Users} label="Barberos" value={stats.barberCount} />
                  <MiniStat icon={Scissors} label="Cortes hoy" value={stats.visitsToday} />
                  <MiniStat icon={Clock} label="En cola" value={stats.waiting} />
                  <MiniStat
                    icon={DollarSign}
                    label="Ingresos hoy"
                    value={formatCurrency(stats.revenue)}
                  />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Editar sucursal' : 'Nueva sucursal'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modificá los datos de la sucursal.'
                : 'Completá los datos para agregar una nueva sucursal.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Monaco Centro"
              />
            </div>
            <div className="grid gap-2">
              <Label>Dirección</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Av. Corrientes 1234"
              />
            </div>
            <div className="grid gap-2">
              <Label>Teléfono</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+54 11 1234-5678"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name}>
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  )
}
