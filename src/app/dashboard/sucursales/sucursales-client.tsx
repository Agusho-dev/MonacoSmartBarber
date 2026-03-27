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
  business_hours_open: '09:00',
  business_hours_close: '21:00',
  business_days: [1, 2, 3, 4, 5, 6] as number[],
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
      business_hours_open: branch.business_hours_open?.slice(0, 5) ?? '09:00',
      business_hours_close: branch.business_hours_close?.slice(0, 5) ?? '21:00',
      business_days: branch.business_days ?? [1, 2, 3, 4, 5, 6],
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    const data = {
      name: form.name,
      address: form.address || null,
      phone: form.phone || null,
      business_hours_open: form.business_hours_open,
      business_hours_close: form.business_hours_close,
      business_days: form.business_days,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight lg:text-2xl">Sucursales</h2>
          <p className="text-sm text-muted-foreground">
            Gestión de locales y sucursales
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="w-full sm:w-auto">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <MiniStat icon={Clock} label="En fila" value={stats.waiting} />
                  <MiniStat
                    icon={DollarSign}
                    label="Ingresos hoy"
                    value={formatCurrency(stats.revenue)}
                  />
                </div>
                {(branch.business_hours_open || branch.business_hours_close) && (
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-3">
                    <Clock className="size-3" />
                    <span>
                      {branch.business_hours_open?.slice(0, 5)} – {branch.business_hours_close?.slice(0, 5)}
                    </span>
                    <span className="mx-1">·</span>
                    <span>
                      {['D', 'L', 'M', 'X', 'J', 'V', 'S']
                        .filter((_, i) => branch.business_days?.includes(i))
                        .join(' ')}
                    </span>
                  </div>
                )}
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
            <div className="border-t pt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Horarios de atención</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="grid gap-2">
                  <Label>Apertura</Label>
                  <Input
                    type="time"
                    value={form.business_hours_open}
                    onChange={(e) => setForm({ ...form, business_hours_open: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Cierre</Label>
                  <Input
                    type="time"
                    value={form.business_hours_close}
                    onChange={(e) => setForm({ ...form, business_hours_close: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Días de atención</Label>
                <div className="flex gap-1 flex-wrap">
                  {[
                    { label: 'D', value: 0 },
                    { label: 'L', value: 1 },
                    { label: 'M', value: 2 },
                    { label: 'X', value: 3 },
                    { label: 'J', value: 4 },
                    { label: 'V', value: 5 },
                    { label: 'S', value: 6 },
                  ].map(({ label, value }) => {
                    const active = form.business_days.includes(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setForm({
                            ...form,
                            business_days: active
                              ? form.business_days.filter((d) => d !== value)
                              : [...form.business_days, value].sort((a, b) => a - b),
                          })
                        }}
                        className={`h-8 w-8 rounded-md text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-input bg-background text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
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
