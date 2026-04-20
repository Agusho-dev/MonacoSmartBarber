'use client'

import { useState, useTransition } from 'react'
import { upsertIncentiveRule, toggleIncentiveRule, deleteIncentiveRule, logAchievement } from '@/lib/actions/incentives'
import { formatCurrency } from '@/lib/format'
import type { IncentiveRule, IncentiveAchievement, IncentiveMetric, IncentivePeriod } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Trophy, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useBranchStore } from '@/stores/branch-store'

interface BarberBasic {
  id: string
  full_name: string
  branch_id: string | null
}

interface AchievementWithRule extends Omit<IncentiveAchievement, 'rule'> {
  rule?: { name: string } | null
}

interface Props {
  rules: IncentiveRule[]
  barbers: BarberBasic[]
  achievements: AchievementWithRule[]
  defaultPeriod: string
}

const METRIC_LABELS: Record<IncentiveMetric, string> = {
  haircut_count: 'Cantidad de cortes',
  content_post: 'Publicaciones en redes',
  custom: 'Métrica personalizada',
}

const PERIOD_LABELS: Record<IncentivePeriod, string> = {
  monthly: 'Mensual',
  weekly: 'Semanal',
}

const EMPTY_FORM = {
  id: '', branch_id: '', name: '', description: '',
  metric: 'haircut_count' as IncentiveMetric,
  threshold: '', reward_amount: '',
  period: 'monthly' as IncentivePeriod,
}

export function IncentivosClient({ rules, barbers, achievements, defaultPeriod }: Props) {
  const { selectedBranchId } = useBranchStore()
  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod)
  const [ruleDialog, setRuleDialog] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [achieveDialog, setAchieveDialog] = useState(false)
  const [achieveForm, setAchieveForm] = useState({ staff_id: '', rule_id: '', notes: '' })
  const [, startTransition] = useTransition()

  const branchRules = rules.filter((r) => r.branch_id === selectedBranchId)
  const branchBarbers = barbers.filter((b) => b.branch_id === selectedBranchId)

  function openCreate() {
    setForm({ ...EMPTY_FORM, branch_id: selectedBranchId || '' })
    setRuleDialog(true)
  }

  function openEdit(rule: IncentiveRule) {
    setForm({
      id: rule.id,
      branch_id: rule.branch_id,
      name: rule.name,
      description: rule.description ?? '',
      metric: rule.metric,
      threshold: String(rule.threshold),
      reward_amount: String(rule.reward_amount),
      period: rule.period,
    })
    setRuleDialog(true)
  }

  function handleRuleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v) })
    startTransition(async () => {
      const r = await upsertIncentiveRule(fd)
      if (r.error) toast.error(r.error)
      else { toast.success(form.id ? 'Regla actualizada' : 'Regla creada'); setRuleDialog(false) }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const r = await deleteIncentiveRule(id)
      if (r.error) toast.error(r.error)
      else toast.success('Regla eliminada')
    })
  }

  function handleToggle(id: string, current: boolean) {
    startTransition(async () => {
      const r = await toggleIncentiveRule(id, !current)
      if (r.error) toast.error(r.error)
    })
  }

  function handleAchieve(e: React.FormEvent) {
    e.preventDefault()
    const rule = branchRules.find((r) => r.id === achieveForm.rule_id)
    if (!rule) return
    startTransition(async () => {
      const r = await logAchievement(
        achieveForm.staff_id,
        achieveForm.rule_id,
        selectedPeriod,
        rule.reward_amount,
        achieveForm.notes || undefined
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Logro registrado'); setAchieveDialog(false) }
    })
  }

  const periodAchievements = achievements.filter(() => true)

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold">Metas e Incentivos</h1>
          <p className="text-sm text-muted-foreground mt-1 hidden sm:block">
            Configurá las metas y registrá logros de los barberos para calcular premios.
          </p>
        </div>
        <Button onClick={openCreate} size="sm" className="w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Nueva regla
        </Button>
      </div>

      <Tabs defaultValue="reglas">
        <TabsList>
          <TabsTrigger value="reglas">Reglas activas</TabsTrigger>
          <TabsTrigger value="logros">Logros del período</TabsTrigger>
        </TabsList>

        <TabsContent value="reglas" className="mt-4">
          {branchRules.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center">
              <Trophy className="size-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No hay reglas de incentivos configuradas.</p>
              <Button onClick={openCreate} variant="outline" className="mt-4">
                <Plus className="size-4 mr-2" />
                Crear primera regla
              </Button>
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {branchRules.map((rule) => (
                <div key={rule.id} className="flex items-start sm:items-center gap-3 px-3 py-3 sm:px-5 sm:py-4">
                  <Trophy className="size-5 text-yellow-500 shrink-0 mt-0.5 sm:mt-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <p className="font-medium text-sm sm:text-base">{rule.name}</p>
                      <Badge variant="secondary" className="text-[10px] sm:text-xs">{PERIOD_LABELS[rule.period]}</Badge>
                      {!rule.is_active && <Badge variant="secondary" className="text-[10px] sm:text-xs">Inactiva</Badge>}
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                      {METRIC_LABELS[rule.metric]} ≥ {rule.threshold} → {formatCurrency(rule.reward_amount)}
                    </p>
                    {rule.description && <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{rule.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                    <Switch checked={rule.is_active} onCheckedChange={() => handleToggle(rule.id, rule.is_active)} />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}>
                      <Pencil className="size-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>¿Eliminar regla?</AlertDialogTitle>
                          <AlertDialogDescription>Los logros ya registrados no se borrarán.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => handleDelete(rule.id)}>Eliminar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logros" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Input
              type="month"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-44"
            />
            <Button variant="outline" onClick={() => { setAchieveForm({ staff_id: '', rule_id: '', notes: '' }); setAchieveDialog(true) }}>
              <Plus className="size-4 mr-2" />
              Registrar logro
            </Button>
          </div>

          {periodAchievements.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
              No hay logros registrados para este período.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {periodAchievements.map((a) => {
                const barber = barbers.find((b) => b.id === a.staff_id)
                return (
                  <div key={a.id} className="flex items-center gap-4 px-5 py-4">
                    <CheckCircle2 className="size-5 text-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{barber?.full_name ?? 'Barbero'}</p>
                      <p className="text-sm text-muted-foreground">
                        {(a.rule as { name: string } | null)?.name ?? 'Regla'} · {a.period_label}
                      </p>
                      {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
                    </div>
                    <p className="font-semibold tabular-nums shrink-0">{formatCurrency(a.amount_earned)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Rule dialog */}
      <Dialog open={ruleDialog} onOpenChange={setRuleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar regla' : 'Nueva regla de incentivo'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRuleSubmit} className="space-y-4">
            <div>
              <Label>Nombre</Label>
              <Input className="mt-1.5" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <Label>Descripción <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label>Métrica</Label>
                <Select value={form.metric} onValueChange={(v) => setForm((f) => ({ ...f, metric: v as IncentiveMetric }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(METRIC_LABELS) as IncentiveMetric[]).map((m) => (
                      <SelectItem key={m} value={m}>{METRIC_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Período</Label>
                <Select value={form.period} onValueChange={(v) => setForm((f) => ({ ...f, period: v as IncentivePeriod }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PERIOD_LABELS) as IncentivePeriod[]).map((p) => (
                      <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label>Meta ({form.metric === 'haircut_count' ? 'cant. cortes' : 'cant. posts'})</Label>
                <Input type="number" min="1" className="mt-1.5" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} required />
              </div>
              <div>
                <Label>Premio ($ ARS)</Label>
                <Input type="number" min="0" step="1000" className="mt-1.5" value={form.reward_amount} onChange={(e) => setForm((f) => ({ ...f, reward_amount: e.target.value }))} required />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuleDialog(false)}>Cancelar</Button>
              <Button type="submit">{form.id ? 'Guardar' : 'Crear'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Achievement dialog */}
      <Dialog open={achieveDialog} onOpenChange={setAchieveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar logro — {selectedPeriod}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAchieve} className="space-y-4">
              <div className="grid gap-2">
                <Label>Aplica a...</Label>
                <Select value={achieveForm.staff_id} onValueChange={(v) => setAchieveForm({ ...achieveForm, staff_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar barbero" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchBarbers.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            <div>
              <Label>Incentivo alcanzado</Label>
              <Select value={achieveForm.rule_id} onValueChange={(v) => setAchieveForm((f) => ({ ...f, rule_id: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Seleccionar regla" /></SelectTrigger>
                <SelectContent>
                  {branchRules.filter((r) => r.is_active).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} — {formatCurrency(r.reward_amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notas <span className="text-muted-foreground">(opcional)</span></Label>
              <Textarea className="mt-1.5 resize-none" rows={2} value={achieveForm.notes} onChange={(e) => setAchieveForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAchieveDialog(false)}>Cancelar</Button>
              <Button type="submit" disabled={!achieveForm.staff_id || !achieveForm.rule_id}>Registrar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
