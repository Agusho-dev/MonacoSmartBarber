'use client'

import { useState, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Power, Trash2, Camera, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import { formatCurrency } from '@/lib/format'
import type { Staff, Branch, UserRole, Role } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface BarberVisitRow {
  barber_id: string
  amount: number
}

interface ServiceHistoryItem {
  barber: { id: string; full_name: string } | null
  started_at: string | null
  completed_at: string | null
}

interface Props {
  barbers: Staff[]
  branches: Branch[]
  todayVisits: BarberVisitRow[]
  roles: Role[]
  serviceHistory?: ServiceHistoryItem[]
}

function computeIdleTimes(visits: ServiceHistoryItem[]) {
  const byBarber = new Map<string, { name: string; sessions: Array<{ start: Date; end: Date }> }>()

  for (const v of visits) {
    if (!v.barber || !v.started_at || !v.completed_at) continue
    const start = new Date(v.started_at)
    const end = new Date(v.completed_at)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) continue

    const entry = byBarber.get(v.barber.id) ?? { name: v.barber.full_name, sessions: [] }
    entry.sessions.push({ start, end })
    byBarber.set(v.barber.id, entry)
  }

  const result: Array<{ name: string; avgIdleMin: number; gapCount: number }> = []

  for (const { name, sessions } of byBarber.values()) {
    sessions.sort((a, b) => a.start.getTime() - b.start.getTime())

    const gaps: number[] = []
    for (let i = 1; i < sessions.length; i++) {
      const gapMin = (sessions[i].start.getTime() - sessions[i - 1].end.getTime()) / 60_000
      // Only count gaps that are positive and under 2 hours (exclude end-of-day / overnight gaps)
      if (gapMin > 0 && gapMin < 120) {
        gaps.push(gapMin)
      }
    }

    if (gaps.length === 0) continue

    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
    result.push({ name, avgIdleMin: Math.round(avg * 10) / 10, gapCount: gaps.length })
  }

  return result.sort((a, b) => b.avgIdleMin - a.avgIdleMin)
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
  role_id: '',
  email: '',
  phone: '',
}

export function BarberosClient({ barbers, branches, todayVisits, roles, serviceHistory }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { selectedBranchId } = useBranchStore()

  const idleTimeData = useMemo(
    () => computeIdleTimes(serviceHistory ?? []),
    [serviceHistory]
  )

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm, password: '', hasAuth: false })
  const [saving, setSaving] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

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
    setForm({ ...emptyForm, password: '', hasAuth: false })
    setAvatarFile(null)
    setAvatarPreview(null)
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
      role_id: barber.role_id ?? '',
      email: barber.email ?? '',
      phone: barber.phone ?? '',
      password: '',
      hasAuth: !!barber.auth_user_id,
    })
    setAvatarFile(null)
    setAvatarPreview(barber.avatar_url ?? null)
    setDialogOpen(true)
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const url = URL.createObjectURL(file)
    setAvatarPreview(url)
  }

  async function handleSave() {
    if (form.pin && form.pin.length !== 4) {
      alert('El PIN debe ser de exactamente 4 dígitos')
      return
    }

    // Validate password constraints if providing access
    if (form.email && !form.hasAuth && !editingId && !form.password) {
      // If setting up a new user with an email, a password might be expected
      // We will let it pass if they just want to save the email without creating an auth user yet,
      // but if the user wants to create dashboard access they need both.
    }

    if (form.password && form.password.length < 6) {
      alert('La contraseña de acceso debe tener al menos 6 caracteres')
      return
    }

    setSaving(true)
    const data = {
      full_name: form.full_name,
      branch_id: form.branch_id || null,
      commission_pct: Number(form.commission_pct),
      pin: form.pin || null,
      role: form.role,
      role_id: form.role_id || null,
      email: form.email || null,
      phone: form.phone || null,
    }

    let savedStaffId = editingId

    if (editingId) {
      const { error } = await supabase.from('staff').update(data).eq('id', editingId)
      if (error) {
        alert('Error al actualizar staff: ' + error.message)
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error } = await supabase.from('staff').insert(data).select('id').single()
      if (error) {
        alert('Error al crear staff: ' + error.message)
        setSaving(false)
        return
      }
      if (inserted) savedStaffId = inserted.id
    }

    // Handle auth linkage if email and password provided
    if (savedStaffId && form.email && form.password) {
      try {
        const { manageStaffAccess } = await import('@/lib/actions/barber')
        const authResult = await manageStaffAccess(savedStaffId, form.email, form.password)
        if (authResult?.error) {
          alert(authResult.error)
        }
      } catch (err) {
        console.error('Failed to update staff access', err)
      }
    }

    // Upload avatar if a new file was selected
    if (savedStaffId && avatarFile) {
      try {
        const { uploadStaffAvatar } = await import('@/lib/image-utils')
        const { updateBarberAvatar } = await import('@/lib/actions/barber')
        const avatarUrl = await uploadStaffAvatar(supabase, savedStaffId, avatarFile)
        if (avatarUrl) {
          await updateBarberAvatar(savedStaffId, avatarUrl)
        }
      } catch (err) {
        console.error('Failed to upload avatar', err)
      }
    }

    setSaving(false)
    setDialogOpen(false)
    router.refresh()
  }

  async function toggleActive(barber: Staff) {
    if (barber.is_active) {
      const { deactivateBarber } = await import('@/lib/actions/barber')
      const result = await deactivateBarber(barber.id)
      if (result.error) {
        alert(result.error)
        return
      }
      if (result.reassignedCount && result.reassignedCount > 0) {
        alert(`Barbero desactivado. ${result.reassignedCount} cliente(s) fueron reasignados automáticamente.`)
      }
    } else {
      const { activateBarber } = await import('@/lib/actions/barber')
      const result = await activateBarber(barber.id)
      if (result.error) {
        alert(result.error)
        return
      }
    }
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Estás seguro de que querés eliminar a este miembro del equipo? Esta acción no se puede revertir.')) return

    const { error } = await supabase.from('staff').delete().eq('id', id)
    if (error) {
      alert('No se pudo eliminar el miembro del equipo. Es posible que tenga registros asociados (cortes de pelo, caja, etc). Considerá cambiar su estado a inactivo en su lugar.\nDetalles: ' + error.message)
    } else {
      router.refresh()
    }
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
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7 shrink-0">
                        <AvatarImage src={barber.avatar_url ?? undefined} alt={barber.full_name} />
                        <AvatarFallback className="text-xs">
                          {barber.full_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span>{barber.full_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{barber.branch?.name ?? '—'}</TableCell>
                  <TableCell>
                    {barber.custom_role?.name ?? barber.role_id
                      ? roles.find((r) => r.id === barber.role_id)?.name ?? roleLabels[barber.role]
                      : roleLabels[barber.role]}
                  </TableCell>
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
                      <Button variant="ghost" size="icon-xs" title="Activar/Desactivar" onClick={() => toggleActive(barber)}>
                        <Power className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive hover:bg-destructive/10" title="Eliminar" onClick={() => handleDelete(barber.id)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {idleTimeData.length > 0 && (
        <div className="rounded-lg border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">Tiempo promedio sin atención</h3>
              <p className="text-xs text-muted-foreground">
                Promedio de minutos entre clientes · mes actual
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(100, idleTimeData.length * 48)}>
            <BarChart
              data={idleTimeData}
              layout="vertical"
              margin={{ top: 0, right: 48, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => `${v} min`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 13 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number) => [`${value} min`, 'Promedio inactivo']}
                labelFormatter={(label: string) => label}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Bar
                dataKey="avgIdleMin"
                fill="hsl(var(--chart-4))"
                radius={[0, 4, 4, 0]}
                label={{
                  position: 'right',
                  formatter: (v: number) => `${v} min`,
                  fontSize: 11,
                  fill: 'hsl(var(--muted-foreground))',
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col sm:max-w-[550px]">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editingId ? 'Editar barbero' : 'Nuevo barbero'}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modificá los datos del barbero.'
                : 'Completá los datos para agregar un nuevo barbero.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-4 -mr-4 py-2 space-y-4">
            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-2 pb-2">
              <div
                className="relative group cursor-pointer"
                onClick={() => avatarInputRef.current?.click()}
              >
                <Avatar className="size-20">
                  <AvatarImage src={avatarPreview ?? undefined} alt="Foto de perfil" />
                  <AvatarFallback className="text-2xl bg-muted">
                    {form.full_name
                      ? form.full_name.charAt(0).toUpperCase()
                      : <Camera className="size-7 text-muted-foreground" />
                    }
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="size-5 text-white" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {avatarFile ? avatarFile.name : 'Clic para cambiar foto de perfil'}
              </p>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>

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
                <Label>Rol base</Label>
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
            <div className="grid gap-2">
              <Label>Rol personalizado</Label>
              <Select
                value={form.role_id || 'none'}
                onValueChange={(v) => setForm({ ...form, role_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sin rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin rol personalizado</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Label>PIN de la Barbería (4 dígitos)</Label>
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

            <div className="mt-4 border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Acceso al Dashboard</h4>
              <div className="grid gap-4 bg-muted/30 p-4 rounded-lg border">
                {form.hasAuth ? (
                  <div className="text-sm text-muted-foreground flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-green-500"></span>
                      Cuenta vinculada
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-2">
                    Para que este miembro pueda ingresar al panel, ingresá un email arriba y establecé una contraseña.
                  </p>
                )}

                <div className="grid gap-2">
                  <Label>Contraseña de acceso {form.hasAuth && '(opcional, para cambiar)'}</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={form.hasAuth ? "••••••••" : "Mínimo 6 caracteres"}
                  />
                  {!form.email && form.password.length > 0 && (
                    <p className="text-xs text-destructive">Debés ingresar un email arriba para crear la cuenta.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 pt-4">
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
