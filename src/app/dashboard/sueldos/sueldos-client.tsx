'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import {
  upsertSalaryConfig,
  getSalaryReports,
  getPaymentBatches,
  createManualSalaryReport,
  generateCommissionReport,
  deleteSalaryReport,
  paySelectedReports,
} from '@/lib/actions/salary'
import type { SalaryReport, SalaryPaymentBatch } from '@/lib/actions/salary'
import { formatCurrency } from '@/lib/format'
import type { Branch, SalaryConfig, SalaryScheme } from '@/lib/types/database'
import type { BarberWithConfig } from './page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Settings2,
  Trash2,
  Plus,
  TrendingUp,
  ChevronRight,
  Banknote,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useBranchStore } from '@/stores/branch-store'

// ─── Tipos y constantes ───────────────────────────────────────────────────────

interface Props {
  branches: Branch[]
  barbers: BarberWithConfig[]
}

const SCHEME_LABELS: Record<SalaryScheme, string> = {
  fixed: 'Fijo',
  commission: 'Comisión',
  hybrid: 'Híbrido',
}

const SCHEME_DESCRIPTIONS: Record<SalaryScheme, string> = {
  fixed: 'Cobra un monto fijo sin importar lo que facture',
  commission: 'Cobra según lo que produce (% de facturación)',
  hybrid: 'El fijo actúa como piso mínimo; si las comisiones lo superan, cobra las comisiones',
}

// Colores de badges por tipo de reporte
const TYPE_BADGE: Record<
  SalaryReport['type'],
  { label: string; className: string }
> = {
  commission: {
    label: 'Comisión',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  base_salary: {
    label: 'Sueldo base',
    className: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  },
  bonus: {
    label: 'Bono',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  advance: {
    label: 'Adelanto',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  hybrid_deficit: {
    label: 'Déficit híbrido',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonthIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function formatReportDate(dateStr: string) {
  return new Date(dateStr + 'T12:00').toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatBatchDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function SueldosClient({ branches, barbers }: Props) {
  const { selectedBranchId: storeBranchId, setSelectedBranchId: setStoreBranchId } =
    useBranchStore()

  // Inicializa sucursal en el store si no está seteada
  useEffect(() => {
    if (!storeBranchId && branches.length > 0) {
      setStoreBranchId(branches[0].id)
    }
  }, [storeBranchId, branches, setStoreBranchId])

  const selectedBranchId = storeBranchId ?? (branches[0]?.id ?? '')

  // Barberos de la sucursal seleccionada
  const branchBarbers = barbers.filter((b) => b.branch_id === selectedBranchId)

  // Barbero activo en el sidebar
  const [activeBarberId, setActiveBarberId] = useState<string | null>(null)
  const activeBarber = branchBarbers.find((b) => b.id === activeBarberId) ?? branchBarbers[0] ?? null

  // Datos cargados por server action al seleccionar barbero
  const [reports, setReports] = useState<SalaryReport[]>([])
  const [batches, setBatches] = useState<
    { batch: SalaryPaymentBatch; reports: SalaryReport[] }[]
  >([])
  const [loadingData, setLoadingData] = useState(false)

  // Checkboxes de reportes
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Transición para mutaciones
  const [isPending, startTransition] = useTransition()

  // ─── Dialogs ───────────────────────────────────────────────────────────────

  // Config salarial
  const [configOpen, setConfigOpen] = useState(false)
  const [configForm, setConfigForm] = useState<{
    scheme: SalaryScheme
    base_amount: string
    commission_pct: string
  }>({ scheme: 'fixed', base_amount: '0', commission_pct: '0' })

  // Generar comisión
  const [commissionDialogOpen, setCommissionDialogOpen] = useState(false)
  const [commissionDate, setCommissionDate] = useState(todayIso())
  const [commissionError, setCommissionError] = useState<string | null>(null)

  // Bono / Adelanto
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false)
  const [bonusForm, setBonusForm] = useState<{
    type: 'bonus' | 'advance'
    amount: string
    notes: string
    date: string
  }>({ type: 'bonus', amount: '', notes: '', date: todayIso() })

  // Confirmación de pago
  const [payDialogOpen, setPayDialogOpen] = useState(false)
  const [payNotes, setPayNotes] = useState('')

  // ─── Carga de datos por barbero ────────────────────────────────────────────

  const loadBarberData = useCallback(
    async (barberId: string) => {
      if (!barberId || !selectedBranchId) return
      setLoadingData(true)
      setSelectedIds(new Set())
      try {
        const [reportsRes, batchesRes] = await Promise.all([
          getSalaryReports(barberId, selectedBranchId),
          getPaymentBatches(barberId, selectedBranchId),
        ])
        setReports(reportsRes.error ? [] : (reportsRes.data ?? []))
        setBatches(
          batchesRes.error || !('data' in batchesRes)
            ? []
            : (
                batchesRes.data as {
                  batch: SalaryPaymentBatch
                  reports: SalaryReport[]
                }[]
              ) ?? []
        )
      } finally {
        setLoadingData(false)
      }
    },
    [selectedBranchId]
  )

  // Carga datos al cambiar de barbero activo o de sucursal
  useEffect(() => {
    const targetId = activeBarberId ?? branchBarbers[0]?.id
    if (targetId) loadBarberData(targetId)
  }, [activeBarberId, selectedBranchId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando cambia la sucursal, resetea el barbero activo
  useEffect(() => {
    setActiveBarberId(null)
    setReports([])
    setBatches([])
    setSelectedIds(new Set())
  }, [selectedBranchId])

  // ─── Totales pendientes por barbero (para sidebar) ─────────────────────────
  // Se recalcula localmente en base a los reportes ya cargados para el barbero activo.
  // Para los demás barberos no tenemos los totales (se cargan on-demand).
  const pendingTotal = reports.reduce((acc, r) => acc + r.amount, 0)

  // ─── Checkboxes ───────────────────────────────────────────────────────────

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(reports.map((r) => r.id)) : new Set())
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedTotal = reports
    .filter((r) => selectedIds.has(r.id))
    .reduce((acc, r) => acc + r.amount, 0)

  // ─── Acciones ─────────────────────────────────────────────────────────────

  function openConfig() {
    if (!activeBarber) return
    const cfg: SalaryConfig | undefined = activeBarber.salary_configs?.[0]
    setConfigForm({
      scheme: (cfg?.scheme ?? 'fixed') as SalaryScheme,
      base_amount: String(cfg?.base_amount ?? 0),
      commission_pct: String(cfg?.commission_pct ?? activeBarber.commission_pct ?? 0),
    })
    setConfigOpen(true)
  }

  function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault()
    if (!activeBarber) return
    startTransition(async () => {
      const r = await upsertSalaryConfig(
        activeBarber.id,
        configForm.scheme,
        parseFloat(configForm.base_amount),
        parseFloat(configForm.commission_pct)
      )
      if (r.error) {
        toast.error(r.error)
      } else {
        toast.success('Configuración guardada')
        setConfigOpen(false)
      }
    })
  }

  function handleGenerateCommission() {
    if (!activeBarber || !selectedBranchId) return
    setCommissionError(null)
    startTransition(async () => {
      const r = await generateCommissionReport(
        activeBarber.id,
        selectedBranchId,
        commissionDate
      )
      if (r.error) {
        setCommissionError(r.error)
      } else {
        toast.success('Reporte de comisión generado')
        setCommissionDialogOpen(false)
        setCommissionDate(todayIso())
        await loadBarberData(activeBarber.id)
      }
    })
  }

  function handleCreateBonus(e: React.FormEvent) {
    e.preventDefault()
    if (!activeBarber || !selectedBranchId) return
    const amount = parseFloat(bonusForm.amount)
    if (!amount || amount <= 0) {
      toast.error('El monto debe ser mayor a cero')
      return
    }
    startTransition(async () => {
      const r = await createManualSalaryReport(
        activeBarber.id,
        selectedBranchId,
        bonusForm.type,
        amount,
        bonusForm.notes,
        bonusForm.date
      )
      if (r.error) {
        toast.error(r.error)
      } else {
        toast.success(
          bonusForm.type === 'bonus' ? 'Bono registrado' : 'Adelanto registrado'
        )
        setBonusDialogOpen(false)
        setBonusForm({ type: 'bonus', amount: '', notes: '', date: todayIso() })
        await loadBarberData(activeBarber.id)
      }
    })
  }

  function handleDelete(reportId: string) {
    startTransition(async () => {
      const r = await deleteSalaryReport(reportId)
      if (r.error) {
        toast.error(r.error)
      } else {
        toast.success('Reporte eliminado')
        if (activeBarber) await loadBarberData(activeBarber.id)
      }
    })
  }

  function handlePay() {
    if (!activeBarber || !selectedBranchId || selectedIds.size === 0) return
    startTransition(async () => {
      const r = await paySelectedReports(
        Array.from(selectedIds),
        activeBarber.id,
        selectedBranchId,
        payNotes || undefined
      )
      if (r.error) {
        toast.error(r.error)
      } else {
        toast.success('Pago registrado correctamente')
        setPayDialogOpen(false)
        setPayNotes('')
        await loadBarberData(activeBarber.id)
      }
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const currentBarber = activeBarber
  const currentConfig: SalaryConfig | undefined = currentBarber?.salary_configs?.[0]

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Header de página */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Sueldos</h1>
        <Select value={selectedBranchId} onValueChange={setStoreBranchId}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder="Sucursal" />
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

      {/* Layout de dos columnas */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar de barberos ─────────────────────────────────────────── */}
        <aside className="w-60 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
            Barberos
          </div>
          {branchBarbers.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center mt-4">
              Sin barberos en esta sucursal
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="py-1">
                {branchBarbers.map((barber) => {
                  const isActive =
                    currentBarber?.id === barber.id ||
                    (!activeBarberId && barber.id === branchBarbers[0]?.id)
                  const cfg: SalaryConfig | undefined = barber.salary_configs?.[0]

                  return (
                    <button
                      key={barber.id}
                      onClick={() => setActiveBarberId(barber.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors relative',
                        'hover:bg-accent/50',
                        isActive && 'bg-accent'
                      )}
                    >
                      {/* Indicador lateral activo */}
                      {isActive && (
                        <span className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-primary" />
                      )}
                      {/* Avatar inicial */}
                      <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                        {barber.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            'text-sm font-medium truncate',
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          )}
                        >
                          {barber.full_name}
                        </p>
                        {cfg && (
                          <p className="text-xs text-muted-foreground truncate">
                            {SCHEME_LABELS[cfg.scheme]}
                          </p>
                        )}
                      </div>
                      {/* Badge total pendiente (solo barbero activo) */}
                      {isActive && pendingTotal !== 0 && (
                        <Badge
                          variant="secondary"
                          className="text-xs shrink-0 tabular-nums"
                        >
                          {formatCurrency(pendingTotal)}
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </aside>

        {/* ── Panel principal ──────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!currentBarber ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Seleccioná una sucursal con barberos
            </div>
          ) : (
            <>
              {/* Header del barbero */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                    {currentBarber.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{currentBarber.full_name}</p>
                    {currentConfig ? (
                      <Badge
                        variant="outline"
                        className="text-xs mt-0.5 h-5"
                      >
                        {SCHEME_LABELS[currentConfig.scheme]}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin configurar</span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={openConfig}>
                  <Settings2 className="size-3.5 mr-1.5" />
                  Configurar
                </Button>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="pendientes" className="flex flex-col flex-1 min-h-0">
                <div className="px-6 pt-3 shrink-0">
                  <TabsList className="h-8">
                    <TabsTrigger value="pendientes" className="text-xs">
                      Reportes Pendientes
                    </TabsTrigger>
                    <TabsTrigger value="historial" className="text-xs">
                      Historial de Pagos
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* ── Tab: Reportes pendientes ─────────────────────────── */}
                <TabsContent
                  value="pendientes"
                  className="flex-1 flex flex-col min-h-0 mt-0 px-6"
                >
                  {/* Barra de acciones */}
                  <div className="flex items-center gap-2 py-3 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCommissionDate(todayIso())
                        setCommissionError(null)
                        setCommissionDialogOpen(true)
                      }}
                    >
                      <TrendingUp className="size-3.5 mr-1.5" />
                      Generar comisión
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBonusForm({
                          type: 'bonus',
                          amount: '',
                          notes: '',
                          date: todayIso(),
                        })
                        setBonusDialogOpen(true)
                      }}
                    >
                      <Plus className="size-3.5 mr-1.5" />
                      Bono / Adelanto
                    </Button>
                  </div>

                  {/* Tabla de reportes */}
                  <div className="flex-1 overflow-auto min-h-0 rounded-lg border border-border">
                    {loadingData ? (
                      <div className="p-4 space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <Skeleton key={i} className="h-10 w-full" />
                        ))}
                      </div>
                    ) : reports.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
                        <Banknote className="size-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                          No hay reportes pendientes
                        </p>
                        <p className="text-xs text-muted-foreground/60">
                          Generá una comisión o registrá un bono para empezar
                        </p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="px-3 py-2.5 w-10">
                              <input
                                type="checkbox"
                                className="rounded border-border"
                                checked={
                                  selectedIds.size === reports.length && reports.length > 0
                                }
                                onChange={(e) => toggleAll(e.target.checked)}
                                aria-label="Seleccionar todos los reportes"
                              />
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Fecha
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Tipo
                            </th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Motivo
                            </th>
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">
                              Monto
                            </th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {reports.map((report) => {
                            const typeMeta = TYPE_BADGE[report.type]
                            const isNegative = report.amount < 0
                            const isDeletable =
                              report.type === 'bonus' || report.type === 'advance'
                            return (
                              <tr
                                key={report.id}
                                className={cn(
                                  'hover:bg-muted/30 transition-colors',
                                  selectedIds.has(report.id) && 'bg-accent/40'
                                )}
                              >
                                <td className="px-3 py-2.5">
                                  <input
                                    type="checkbox"
                                    className="rounded border-border"
                                    checked={selectedIds.has(report.id)}
                                    onChange={() => toggleOne(report.id)}
                                    aria-label={`Seleccionar reporte del ${formatReportDate(report.report_date)}`}
                                  />
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                  {formatReportDate(report.report_date)}
                                </td>
                                <td className="px-3 py-2.5">
                                  <Badge
                                    variant="outline"
                                    className={cn('text-xs', typeMeta.className)}
                                  >
                                    {typeMeta.label}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[200px] truncate">
                                  {report.notes ?? '—'}
                                </td>
                                <td
                                  className={cn(
                                    'px-3 py-2.5 text-right font-medium tabular-nums',
                                    isNegative ? 'text-red-400' : 'text-foreground'
                                  )}
                                >
                                  {isNegative
                                    ? `−${formatCurrency(Math.abs(report.amount))}`
                                    : formatCurrency(report.amount)}
                                </td>
                                <td className="px-3 py-2.5">
                                  {isDeletable && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-7 text-muted-foreground hover:text-destructive"
                                      onClick={() => handleDelete(report.id)}
                                      disabled={isPending}
                                      aria-label="Eliminar reporte"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Footer de pago */}
                  {selectedIds.size > 0 && (
                    <div className="shrink-0 border-t border-border py-3 flex items-center justify-end gap-4">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">
                          {selectedIds.size} reporte{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
                        </p>
                        <p className="text-base font-semibold tabular-nums">
                          Total:{' '}
                          <span
                            className={
                              selectedTotal < 0 ? 'text-red-400' : 'text-foreground'
                            }
                          >
                            {selectedTotal < 0
                              ? `−${formatCurrency(Math.abs(selectedTotal))}`
                              : formatCurrency(selectedTotal)}
                          </span>
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          setPayNotes('')
                          setPayDialogOpen(true)
                        }}
                        disabled={isPending}
                      >
                        <Banknote className="size-4 mr-2" />
                        Pagar reportes
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* ── Tab: Historial de pagos ──────────────────────────── */}
                <TabsContent
                  value="historial"
                  className="flex-1 overflow-auto min-h-0 mt-0 px-6 pb-4"
                >
                  {loadingData ? (
                    <div className="pt-4 space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full" />
                      ))}
                    </div>
                  ) : batches.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
                      <Banknote className="size-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No hay pagos registrados todavía
                      </p>
                    </div>
                  ) : (
                    <Accordion
                      type="single"
                      collapsible
                      defaultValue={batches[0]?.batch.id}
                      className="pt-4 space-y-2"
                    >
                      {batches.map(({ batch, reports: batchReports }) => (
                        <AccordionItem
                          key={batch.id}
                          value={batch.id}
                          className="border border-border rounded-lg px-4 overflow-hidden"
                        >
                          <AccordionTrigger className="hover:no-underline py-3">
                            <div className="flex items-center justify-between flex-1 mr-2">
                              <div className="flex items-center gap-2">
                                <Banknote className="size-4 text-muted-foreground shrink-0" />
                                <span className="text-sm font-medium">
                                  Liquidación del {formatBatchDate(batch.paid_at)}
                                </span>
                              </div>
                              <span className="text-sm font-semibold tabular-nums text-foreground">
                                {formatCurrency(batch.total_amount)}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-3">
                            <Separator className="mb-3" />
                            {batch.notes && (
                              <p className="text-xs text-muted-foreground mb-3 italic">
                                {batch.notes}
                              </p>
                            )}
                            <div className="space-y-2">
                              {batchReports.map((r) => {
                                const typeMeta = TYPE_BADGE[r.type]
                                const isNeg = r.amount < 0
                                return (
                                  <div
                                    key={r.id}
                                    className="flex items-center gap-3 text-sm"
                                  >
                                    <ChevronRight className="size-3 text-muted-foreground/50 shrink-0" />
                                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                                      {formatReportDate(r.report_date)}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className={cn('text-xs', typeMeta.className)}
                                    >
                                      {typeMeta.label}
                                    </Badge>
                                    {r.notes && (
                                      <span className="text-xs text-muted-foreground truncate flex-1">
                                        {r.notes}
                                      </span>
                                    )}
                                    <span
                                      className={cn(
                                        'ml-auto font-medium tabular-nums text-xs whitespace-nowrap',
                                        isNeg ? 'text-red-400' : 'text-foreground'
                                      )}
                                    >
                                      {isNeg
                                        ? `−${formatCurrency(Math.abs(r.amount))}`
                                        : formatCurrency(r.amount)}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </main>
      </div>

      {/* ── Dialog: Configurar sueldo ───────────────────────────────────────── */}
      <Dialog open={configOpen} onOpenChange={(o) => !o && setConfigOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Esquema salarial — {currentBarber?.full_name}
            </DialogTitle>
            <DialogDescription>
              Configurá cómo se calcula el sueldo de este barbero.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveConfig} className="space-y-5">
            <div>
              <Label>Esquema</Label>
              <Select
                value={configForm.scheme}
                onValueChange={(v) =>
                  setConfigForm((f) => ({ ...f, scheme: v as SalaryScheme }))
                }
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCHEME_LABELS) as SalaryScheme[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SCHEME_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1.5">
                {SCHEME_DESCRIPTIONS[configForm.scheme]}
              </p>
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
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, base_amount: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, commission_pct: e.target.value }))
                  }
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfigOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Generar comisión ────────────────────────────────────────── */}
      <Dialog
        open={commissionDialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setCommissionDialogOpen(false)
            setCommissionError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar comisión</DialogTitle>
            <DialogDescription>
              Calculá y registrá las comisiones de {currentBarber?.full_name} para una fecha específica.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="commission-date">Fecha</Label>
              <Input
                id="commission-date"
                type="date"
                className="mt-1.5"
                value={commissionDate}
                max={todayIso()}
                onChange={(e) => {
                  setCommissionDate(e.target.value)
                  setCommissionError(null)
                }}
              />
            </div>
            {commissionError && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {commissionError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCommissionDialogOpen(false)
                setCommissionError(null)
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleGenerateCommission}
              disabled={isPending || !commissionDate}
            >
              Generar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Bono / Adelanto ─────────────────────────────────────────── */}
      <Dialog
        open={bonusDialogOpen}
        onOpenChange={(o) => !o && setBonusDialogOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Bono / Adelanto</DialogTitle>
            <DialogDescription>
              Registrá un bono (suma) o adelanto (descuento) para {currentBarber?.full_name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateBonus} className="space-y-4">
            {/* Radio: Bono / Adelanto */}
            <div>
              <Label>Tipo</Label>
              <div className="flex gap-4 mt-2">
                {(['bonus', 'advance'] as const).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      'flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2.5 text-sm transition-colors flex-1 justify-center',
                      bonusForm.type === t
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground'
                    )}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={t}
                      checked={bonusForm.type === t}
                      onChange={() => setBonusForm((f) => ({ ...f, type: t }))}
                      className="sr-only"
                    />
                    {t === 'bonus' ? 'Bono' : 'Adelanto'}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="bonus-amount">Monto</Label>
              <Input
                id="bonus-amount"
                type="number"
                min="1"
                step="100"
                placeholder="10000"
                className="mt-1.5"
                value={bonusForm.amount}
                onChange={(e) =>
                  setBonusForm((f) => ({ ...f, amount: e.target.value }))
                }
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Siempre positivo — el signo se aplica automáticamente según el tipo.
              </p>
            </div>
            <div>
              <Label htmlFor="bonus-notes">Motivo</Label>
              <Input
                id="bonus-notes"
                type="text"
                placeholder="Premio por objetivo, nafta, etc."
                className="mt-1.5"
                value={bonusForm.notes}
                onChange={(e) =>
                  setBonusForm((f) => ({ ...f, notes: e.target.value }))
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="bonus-date">Fecha</Label>
              <Input
                id="bonus-date"
                type="date"
                className="mt-1.5"
                value={bonusForm.date}
                onChange={(e) =>
                  setBonusForm((f) => ({ ...f, date: e.target.value }))
                }
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBonusDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Confirmar pago ──────────────────────────────────────────── */}
      <Dialog open={payDialogOpen} onOpenChange={(o) => !o && setPayDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pago</DialogTitle>
            <DialogDescription>
              Vas a registrar el pago de {selectedIds.size} reporte
              {selectedIds.size !== 1 ? 's' : ''} para {currentBarber?.full_name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Resumen de reportes seleccionados */}
            <div className="rounded-lg border border-border divide-y divide-border text-sm">
              {reports
                .filter((r) => selectedIds.has(r.id))
                .map((r) => {
                  const isNeg = r.amount < 0
                  return (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn('text-xs', TYPE_BADGE[r.type].className)}
                        >
                          {TYPE_BADGE[r.type].label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatReportDate(r.report_date)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          'font-medium tabular-nums text-xs',
                          isNeg ? 'text-red-400' : 'text-foreground'
                        )}
                      >
                        {isNeg
                          ? `−${formatCurrency(Math.abs(r.amount))}`
                          : formatCurrency(r.amount)}
                      </span>
                    </div>
                  )
                })}
              {/* Total */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30">
                <span className="font-semibold text-sm">Total</span>
                <span
                  className={cn(
                    'font-bold tabular-nums',
                    selectedTotal < 0 ? 'text-red-400' : 'text-foreground'
                  )}
                >
                  {selectedTotal < 0
                    ? `−${formatCurrency(Math.abs(selectedTotal))}`
                    : formatCurrency(selectedTotal)}
                </span>
              </div>
            </div>
            {/* Notas opcionales */}
            <div>
              <Label htmlFor="pay-notes">Notas (opcional)</Label>
              <Textarea
                id="pay-notes"
                placeholder="Observaciones del pago..."
                className="mt-1.5 min-h-16 resize-none"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handlePay} disabled={isPending}>
              Confirmar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
