'use client'

import { useState, useTransition, useEffect } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'
import {
  fetchGoals,
  upsertGoal,
  deleteGoal,
  type GoalWithProgress,
} from '@/lib/actions/goals'
import { formatCurrency } from '@/lib/format'
import type { Branch, Staff } from '@/lib/types/database'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Target,
  Building2,
  Scissors,
  Trash2,
} from 'lucide-react'

interface Props {
  initialGoals: GoalWithProgress[]
  branches: Branch[]
  barbers: (Staff & { branch?: { name: string } | null })[]
  currentMonth: string
}

export function MetasClient({
  initialGoals,
  branches,
  barbers,
  currentMonth,
}: Props) {
  const { selectedBranchId } = useBranchStore()
  const [goals, setGoals] = useState(initialGoals)
  const [month, setMonth] = useState(new Date(currentMonth + 'T12:00:00'))
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<GoalWithProgress | null>(null)

  const monthStr = format(month, 'yyyy-MM-01')
  const monthLabel = format(month, 'MMMM yyyy', { locale: es })

  const refresh = (m?: string) => {
    startTransition(async () => {
      const result = await fetchGoals(m ?? monthStr, selectedBranchId)
      setGoals(result)
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId])

  const handleMonthChange = (direction: 'prev' | 'next') => {
    const newMonth = direction === 'prev' ? subMonths(month, 1) : addMonths(month, 1)
    setMonth(newMonth)
    refresh(format(newMonth, 'yyyy-MM-01'))
  }

  const branchGoals = goals.filter((g) => g.branch_id && !g.barber_id)
  const barberGoals = goals.filter((g) => g.barber_id)

  const openNew = () => {
    setEditingGoal(null)
    setDialogOpen(true)
  }

  const openEdit = (goal: GoalWithProgress) => {
    setEditingGoal(goal)
    setDialogOpen(true)
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteGoal(id)
      if (result.error) toast.error(result.error)
      else {
        toast.success('Meta eliminada')
        refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Metas</h2>
        <Button onClick={openNew}>
          <Plus className="mr-2 size-4" /> Nueva meta
        </Button>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => handleMonthChange('prev')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[160px] text-center text-lg font-semibold capitalize">
          {monthLabel}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => handleMonthChange('next')}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-4">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      )}

      <div className={isPending ? 'pointer-events-none opacity-50' : ''}>
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Metas por sucursal</h3>
            </div>
            {branchGoals.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Sin metas de sucursal para este mes
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {branchGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    label={g.branch_name ?? 'Sucursal'}
                    onEdit={() => openEdit(g)}
                    onDelete={() => handleDelete(g.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Scissors className="size-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Metas por barbero</h3>
            </div>
            {barberGoals.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Sin metas de barbero para este mes
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {barberGoals.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    label={g.barber_name ?? 'Barbero'}
                    onEdit={() => openEdit(g)}
                    onDelete={() => handleDelete(g.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <GoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        goal={editingGoal}
        month={monthStr}
        branches={branches}
        barbers={barbers}
        onSaved={() => {
          setDialogOpen(false)
          refresh()
        }}
      />
    </div>
  )
}

/* ─── Goal Card ─── */

function GoalCard({
  goal,
  label,
  onEdit,
  onDelete,
}: {
  goal: GoalWithProgress
  label: string
  onEdit: () => void
  onDelete: () => void
}) {
  const cutsPct =
    goal.target_cuts > 0
      ? Math.min(100, Math.round((goal.actual_cuts / goal.target_cuts) * 100))
      : 0
  const revPct =
    goal.target_revenue > 0
      ? Math.min(
          100,
          Math.round((goal.actual_revenue / goal.target_revenue) * 100)
        )
      : 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}</CardTitle>
          <Target className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProgressBar
          label="Cortes"
          actual={goal.actual_cuts}
          target={goal.target_cuts}
          pct={cutsPct}
          format={(v) => String(v)}
        />
        <ProgressBar
          label="Ingresos"
          actual={goal.actual_revenue}
          target={goal.target_revenue}
          pct={revPct}
          format={formatCurrency}
        />
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </CardFooter>
    </Card>
  )
}

function ProgressBar({
  label,
  actual,
  target,
  pct,
  format: fmt,
}: {
  label: string
  actual: number
  target: number
  pct: number
  format: (v: number) => string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {fmt(actual)} / {fmt(target)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <Badge variant={pct >= 100 ? 'default' : 'secondary'} className="text-xs">
          {pct}%
        </Badge>
      </div>
    </div>
  )
}

/* ─── Goal Dialog ─── */

function GoalDialog({
  open,
  onOpenChange,
  goal,
  month,
  branches,
  barbers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  goal: GoalWithProgress | null
  month: string
  branches: Branch[]
  barbers: (Staff & { branch?: { name: string } | null })[]
  onSaved: () => void
}) {
  const isEdit = !!goal
  const [type, setType] = useState<'branch' | 'barber'>(
    goal?.barber_id ? 'barber' : 'branch'
  )
  const [selectedId, setSelectedId] = useState(
    goal?.barber_id ?? goal?.branch_id ?? ''
  )
  const [targetCuts, setTargetCuts] = useState(goal?.target_cuts ?? 100)
  const [targetRevenue, setTargetRevenue] = useState(goal?.target_revenue ?? 500000)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (goal) {
      setType(goal.barber_id ? 'barber' : 'branch')
      setSelectedId(goal.barber_id ?? goal.branch_id ?? '')
      setTargetCuts(goal.target_cuts)
      setTargetRevenue(goal.target_revenue)
    } else {
      setType('branch')
      setSelectedId('')
      setTargetCuts(100)
      setTargetRevenue(500000)
    }
  }, [goal, open])

  const handleSave = () => {
    startTransition(async () => {
      const result = await upsertGoal({
        id: goal?.id,
        branch_id: type === 'branch' ? selectedId : barbers.find((b) => b.id === selectedId)?.branch_id ?? null,
        barber_id: type === 'barber' ? selectedId : null,
        month,
        target_cuts: targetCuts,
        target_revenue: targetRevenue,
      })
      if (result.error) toast.error(result.error)
      else {
        toast.success(isEdit ? 'Meta actualizada' : 'Meta creada')
        onSaved()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar meta' : 'Nueva meta'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {!isEdit && (
            <>
              <div className="space-y-2">
                <Label>Tipo de meta</Label>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    setType(v as 'branch' | 'barber')
                    setSelectedId('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="branch">Sucursal</SelectItem>
                    <SelectItem value="barber">Barbero</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  {type === 'branch' ? 'Sucursal' : 'Barbero'}
                </Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={`Seleccionar ${type === 'branch' ? 'sucursal' : 'barbero'}`}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {type === 'branch'
                      ? branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))
                      : barbers.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.full_name}
                            {b.branch?.name ? ` (${b.branch.name})` : ''}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Meta de cortes</Label>
              <Input
                type="number"
                min={0}
                value={targetCuts}
                onChange={(e) => setTargetCuts(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Meta de ingresos ($)</Label>
              <Input
                type="number"
                min={0}
                value={targetRevenue}
                onChange={(e) => setTargetRevenue(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending || (!isEdit && !selectedId)}>
            {isPending ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
