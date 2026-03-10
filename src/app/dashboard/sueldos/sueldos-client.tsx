'use client'

import { useState, useTransition } from 'react'
import { upsertSalaryConfig, calculateAndSaveSalary, markSalaryAsPaid, previewSalary } from '@/lib/actions/salary'
import { formatCurrency } from '@/lib/format'
import type { Branch, SalaryConfig, SalaryScheme, SalaryPayment } from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Banknote, Settings2, CheckCircle2, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface BarberWithConfig {
  id: string
  full_name: string
  commission_pct: number
  branch_id: string | null
  salary_configs: SalaryConfig[]
}

interface PaymentWithStaff extends Omit<SalaryPayment, 'staff'> {
  staff?: { id: string; full_name: string; branch_id: string | null } | null
}

interface Props {
  branches: Branch[]
  barbers: BarberWithConfig[]
  payments: PaymentWithStaff[]
}

const SCHEME_LABELS: Record<SalaryScheme, string> = {
  fixed: 'Sueldo fijo',
  commission: 'Comisiones',
  hybrid: 'Fijo absorbible',
}

const SCHEME_DESCRIPTIONS: Record<SalaryScheme, string> = {
  fixed: 'Cobra un monto fijo sin importar lo que facture',
  commission: 'Cobra según lo que produce (% de facturación)',
  hybrid: 'El fijo actúa como piso mínimo; si las comisiones lo superan, cobra las comisiones',
}

export function SueldosClient({ branches, barbers, payments }: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? '')
  const [configDialog, setConfigDialog] = useState<BarberWithConfig | null>(null)
  const [calcDialog, setCalcDialog] = useState<BarberWithConfig | null>(null)
  const [configForm, setConfigForm] = useState({ scheme: 'fixed' as SalaryScheme, base_amount: '0', commission_pct: '0' })
  const [calcForm, setCalcForm] = useState({ period_start: firstOfMonth(), period_end: today() })
  const [calcPreview, setCalcPreview] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  function firstOfMonth() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  function today() {
    return new Date().toISOString().slice(0, 10)
  }

  const branchBarbers = barbers.filter((b) => b.branch_id === selectedBranchId)
  const branchPayments = payments.filter((p) => (p.staff as { branch_id: string | null } | null)?.branch_id === selectedBranchId)

  function openConfig(barber: BarberWithConfig) {
    const cfg = barber.salary_configs?.[0]
    setConfigForm({
      scheme: (cfg?.scheme ?? 'fixed') as SalaryScheme,
      base_amount: String(cfg?.base_amount ?? 0),
      commission_pct: String(cfg?.commission_pct ?? barber.commission_pct ?? 0),
    })
    setConfigDialog(barber)
  }

  function openCalc(barber: BarberWithConfig) {
    setCalcForm({ period_start: firstOfMonth(), period_end: today() })
    setCalcPreview(null)
    setCalcDialog(barber)
  }

  function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!configDialog) return
    startTransition(async () => {
      const r = await upsertSalaryConfig(
        configDialog.id,
        configForm.scheme,
        parseFloat(configForm.base_amount),
        parseFloat(configForm.commission_pct)
      )
      if (r.error) toast.error(r.error)
      else { toast.success('Configuración guardada'); setConfigDialog(null) }
    })
  }

  function handlePreview() {
    if (!calcDialog) return
    startTransition(async () => {
      const r = await previewSalary(calcDialog.id, calcForm.period_start, calcForm.period_end)
      setCalcPreview(r.amount)
    })
  }

  function handleCalculate() {
    if (!calcDialog) return
    startTransition(async () => {
      const r = await calculateAndSaveSalary(calcDialog.id, calcForm.period_start, calcForm.period_end)
      if (r.error) toast.error(r.error)
      else {
        toast.success(`Sueldo calculado: ${formatCurrency(r.calculatedAmount)}`)
        setCalcDialog(null)
        setCalcPreview(null)
      }
    })
  }

  function handleMarkPaid(paymentId: string) {
    startTransition(async () => {
      const r = await markSalaryAsPaid(paymentId)
      if (r.error) toast.error(r.error)
      else toast.success('Marcado como pagado')
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sueldos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configurá el esquema salarial de cada barbero y calculá los pagos por período.
          </p>
        </div>
        <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sucursal" />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuración</TabsTrigger>
          <TabsTrigger value="historial">Historial de pagos</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          {branchBarbers.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
              No hay barberos en esta sucursal.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {branchBarbers.map((barber) => {
                const cfg = barber.salary_configs?.[0]
                return (
                  <div key={barber.id} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm">
                      {barber.full_name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{barber.full_name}</p>
                      {cfg ? (
                        <p className="text-sm text-muted-foreground">
                          {SCHEME_LABELS[cfg.scheme]} ·{' '}
                          {cfg.scheme !== 'commission' && `Base: ${formatCurrency(cfg.base_amount)} · `}
                          {cfg.scheme !== 'fixed' && `Comisión: ${cfg.commission_pct}%`}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Sin configurar</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => openCalc(barber)}>
                        <Calculator className="size-4 mr-1.5" />
                        Calcular
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openConfig(barber)}>
                        <Settings2 className="size-4 mr-1.5" />
                        Config
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          {branchPayments.length === 0 ? (
            <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
              No hay pagos registrados todavía.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {branchPayments.map((payment) => (
                <div key={payment.id} className="flex items-center gap-4 px-5 py-4">
                  <Banknote className="size-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{(payment.staff as { full_name: string } | null)?.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(payment.period_start + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(payment.period_end + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {payment.notes && <p className="text-xs text-muted-foreground mt-0.5">{payment.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums">{formatCurrency(payment.calculated_amount)}</p>
                    {payment.is_paid ? (
                      <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-600 border-green-500/30">
                        <CheckCircle2 className="size-3 mr-1" />
                        Pagado
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-1" onClick={() => handleMarkPaid(payment.id)}>
                        Marcar pagado
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Config dialog */}
      <Dialog open={!!configDialog} onOpenChange={(o) => !o && setConfigDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Esquema salarial — {configDialog?.full_name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveConfig} className="space-y-5">
            <div>
              <Label>Esquema</Label>
              <Select value={configForm.scheme} onValueChange={(v) => setConfigForm((f) => ({ ...f, scheme: v as SalaryScheme }))}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCHEME_LABELS) as SalaryScheme[]).map((s) => (
                    <SelectItem key={s} value={s}>{SCHEME_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">{SCHEME_DESCRIPTIONS[configForm.scheme]}</p>
            </div>

            {configForm.scheme !== 'commission' && (
              <div>
                <Label>Monto base mensual</Label>
                <Input
                  type="number"
                  min="0"
                  step="1000"
                  className="mt-1.5"
                  value={configForm.base_amount}
                  onChange={(e) => setConfigForm((f) => ({ ...f, base_amount: e.target.value }))}
                />
              </div>
            )}

            {configForm.scheme !== 'fixed' && (
              <div>
                <Label>Porcentaje de comisión (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="mt-1.5"
                  value={configForm.commission_pct}
                  onChange={(e) => setConfigForm((f) => ({ ...f, commission_pct: e.target.value }))}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfigDialog(null)}>Cancelar</Button>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Calc dialog */}
      <Dialog open={!!calcDialog} onOpenChange={(o) => { if (!o) { setCalcDialog(null); setCalcPreview(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Calcular sueldo — {calcDialog?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Desde</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={calcForm.period_start}
                  onChange={(e) => { setCalcForm((f) => ({ ...f, period_start: e.target.value })); setCalcPreview(null) }}
                />
              </div>
              <div>
                <Label>Hasta</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={calcForm.period_end}
                  onChange={(e) => { setCalcForm((f) => ({ ...f, period_end: e.target.value })); setCalcPreview(null) }}
                />
              </div>
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={handlePreview}>
              <Calculator className="size-4 mr-2" />
              Vista previa
            </Button>

            {calcPreview !== null && (
              <div className="rounded-xl border bg-muted/50 p-5 text-center">
                <p className="text-sm text-muted-foreground">Sueldo calculado</p>
                <p className="text-4xl font-bold mt-1 tabular-nums">{formatCurrency(calcPreview)}</p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setCalcDialog(null); setCalcPreview(null) }}>Cancelar</Button>
              <Button onClick={handleCalculate} disabled={!calcForm.period_start || !calcForm.period_end}>
                Guardar período
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
