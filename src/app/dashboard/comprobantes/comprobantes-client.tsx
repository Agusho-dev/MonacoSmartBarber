'use client'

import { useEffect, useMemo, useState, useTransition, type ComponentType } from 'react'
import {
  ScanLine, Settings, CheckCircle2, AlertTriangle, Copy, Clock, FileQuestion,
  ReceiptText, Download, Sparkles, Cpu, ShieldCheck, ExternalLink, X, ChevronRight,
  Loader2, Building2, Wallet, CalendarX2, CalendarClock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { toast } from 'sonner'
import {
  getReconciliation, getReceiptSignedUrl, reviewReceipt, updateReceiptSettings,
  type ReconResult, type ReconRow, type ReconState,
} from '@/lib/actions/receipts'
import type { TransferReceiptSettingsView } from '@/lib/actions/receipts'
import type { ReceiptEngine } from '@/lib/types/database'

// ── Metadata visual por estado ──────────────────────────────
const STATE_META: Record<ReconState, {
  label: string; short: string; icon: ComponentType<{ className?: string }>
  text: string; bg: string; ring: string
}> = {
  conciliado:      { label: 'Conciliado',        short: 'Conciliados',     icon: CheckCircle2,  text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'border-emerald-500/30' },
  sin_comprobante: { label: 'Sin comprobante',   short: 'Sin comprobante', icon: ReceiptText,   text: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/10',   ring: 'border-amber-500/30' },
  monto:           { label: 'Monto no coincide', short: 'Monto ≠',         icon: AlertTriangle, text: 'text-orange-600 dark:text-orange-400',   bg: 'bg-orange-500/10',  ring: 'border-orange-500/30' },
  fecha:           { label: 'Fecha vieja',        short: 'Fecha vieja',    icon: CalendarX2,    text: 'text-rose-600 dark:text-rose-400',       bg: 'bg-rose-500/10',    ring: 'border-rose-500/30' },
  duplicado:       { label: 'Duplicado',         short: 'Duplicados',      icon: Copy,          text: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/10',     ring: 'border-red-500/30' },
  revision:        { label: 'En revisión',       short: 'En revisión',     icon: Clock,         text: 'text-sky-600 dark:text-sky-400',         bg: 'bg-sky-500/10',     ring: 'border-sky-500/30' },
  huerfano:        { label: 'Sin cobro',         short: 'Sin cobro',       icon: FileQuestion,  text: 'text-violet-600 dark:text-violet-400',   bg: 'bg-violet-500/10',  ring: 'border-violet-500/30' },
  historico:       { label: 'Histórico',         short: 'Histórico',       icon: Clock,         text: 'text-muted-foreground',                  bg: 'bg-muted',          ring: 'border-border' },
}

// La fecha ya no es un estado de conciliación: los cobros con monto correcto quedan
// 'conciliado' y la discrepancia de fecha se muestra como aviso suave aparte (dateReview).
const TILE_ORDER: ReconState[] = ['conciliado', 'sin_comprobante', 'monto', 'duplicado', 'revision', 'huerfano']

function useCountUp(target: number, dur = 750): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      setV(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, dur])
  return v
}

function ConciliationRing({ pct }: { pct: number }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100)
  const stroke = pct >= 95 ? 'oklch(0.72 0.17 152)' : pct >= 75 ? 'oklch(0.78 0.16 75)' : 'oklch(0.63 0.22 25)'
  const shown = useCountUp(pct, 900)
  return (
    <div className="relative grid size-40 shrink-0 place-items-center">
      <svg viewBox="0 0 128 128" className="size-40 -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="9" className="text-muted/50" />
        <circle
          cx="64" cy="64" r={r} fill="none" stroke={stroke} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-black tabular-nums leading-none">{shown}%</span>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">conciliado</span>
      </div>
    </div>
  )
}

function BigFigure({ label, amount, tone = 'default' }: { label: string; amount: number; tone?: 'default' | 'good' | 'bad' }) {
  const v = useCountUp(amount)
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-black tabular-nums sm:text-3xl',
        tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'bad' && amount > 0 && 'text-red-600 dark:text-red-400')}>
        {formatCurrency(v)}
      </p>
    </div>
  )
}

function StatusBadge({ state }: { state: ReconState }) {
  const m = STATE_META[state]
  const Icon = m.icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', m.bg, m.ring, m.text)}>
      <Icon className="size-3.5" /> {m.label}
    </span>
  )
}

/** Aviso suave: cobro conciliado por monto, pero la fecha leída parece de otro día. */
function DateReviewPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
      <CalendarClock className="size-3.5" /> Revisar fecha
    </span>
  )
}

interface Props {
  initialRecon: ReconResult
  initialRange: { from: string; to: string }
  settings: TransferReceiptSettingsView
  branches: { id: string; name: string }[]
  accounts: { id: string; name: string; branch_id: string }[]
  canManage: boolean
}

type Preset = 'hoy' | '7d' | '30d'

function rangeFor(p: Preset): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now)
  if (p === 'hoy') from.setHours(0, 0, 0, 0)
  else if (p === '7d') from.setTime(now.getTime() - 7 * 86400000)
  else from.setTime(now.getTime() - 30 * 86400000)
  return { from: from.toISOString(), to: now.toISOString() }
}

export function ComprobantesClient({ initialRecon, settings: initialSettings, branches, accounts, canManage }: Props) {
  const [recon, setRecon] = useState(initialRecon)
  const [preset, setPreset] = useState<Preset>('7d')
  const [branchId, setBranchId] = useState<string>('all')
  const [accountId, setAccountId] = useState<string>('all')
  const [stateFilter, setStateFilter] = useState<ReconState | null>(null)
  const [dateFilter, setDateFilter] = useState(false)
  const [pending, startTransition] = useTransition()

  const [settings, setSettings] = useState(initialSettings)

  // Detalle (side-effects en el click handler, no en effects)
  const [detail, setDetail] = useState<ReconRow | null>(null)
  const [detailUrl, setDetailUrl] = useState<string | null>(null)
  const [detailLoadingUrl, setDetailLoadingUrl] = useState(false)
  const [detailNote, setDetailNote] = useState('')
  const [detailSaving, setDetailSaving] = useState(false)

  // Configuración
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sEnabled, setSEnabled] = useState(initialSettings.isEnabled)
  const [sEngine, setSEngine] = useState<ReceiptEngine>(initialSettings.engine)
  const [sDateTol, setSDateTol] = useState(initialSettings.dateToleranceMinutes)
  const [sSaving, setSSaving] = useState(false)

  function refetch(next?: { preset?: Preset; branchId?: string; accountId?: string }) {
    const p = next?.preset ?? preset
    const b = next?.branchId ?? branchId
    const a = next?.accountId ?? accountId
    const { from, to } = rangeFor(p)
    startTransition(async () => {
      const res = await getReconciliation({ from, to, branchId: b === 'all' ? null : b, accountId: a === 'all' ? null : a })
      setRecon(res)
    })
  }

  async function openDetail(row: ReconRow) {
    setDetail(row)
    setDetailNote(row.receipt?.reviewNote ?? '')
    setDetailUrl(null)
    if (row.receipt?.imagePath) {
      setDetailLoadingUrl(true)
      const u = await getReceiptSignedUrl(row.receipt.imagePath)
      setDetailUrl(u)
      setDetailLoadingUrl(false)
    } else {
      setDetailLoadingUrl(false)
    }
  }

  async function reviewDetail(action: 'manual_ok' | 'note', successMsg?: string) {
    if (!detail?.receipt) return
    setDetailSaving(true)
    const res = await reviewReceipt(detail.receipt.id, action, detailNote.trim() || undefined)
    setDetailSaving(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success(successMsg ?? (action === 'manual_ok' ? 'Marcado como conciliado' : 'Nota guardada'))
    setDetail(null)
    refetch()
  }

  function openSettings() {
    setSEnabled(settings.isEnabled)
    setSEngine(settings.engine)
    setSDateTol(settings.dateToleranceMinutes)
    setSettingsOpen(true)
  }

  async function saveSettings() {
    setSSaving(true)
    const res = await updateReceiptSettings({ isEnabled: sEnabled, engine: sEngine, dateToleranceMinutes: sDateTol })
    setSSaving(false)
    if ('error' in res) { toast.error(res.error); return }
    toast.success('Configuración guardada')
    setSettings({ ...settings, isEnabled: sEnabled, engine: sEngine, dateToleranceMinutes: sDateTol, requiredSince: settings.requiredSince ?? (sEnabled ? new Date().toISOString() : null) })
    setSettingsOpen(false)
    refetch()
  }

  const summary = recon.summary
  const visibleRows = useMemo(() => {
    if (dateFilter) return recon.rows.filter((r) => r.dateReview)
    if (stateFilter) return recon.rows.filter((r) => r.state === stateFilter)
    return recon.rows
  }, [recon.rows, stateFilter, dateFilter])
  const cappedRows = visibleRows.slice(0, 400)
  const anomalies = summary.counts.sin_comprobante + summary.counts.monto + summary.counts.duplicado + summary.counts.huerfano

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight lg:text-2xl">
            <ScanLine className="size-6 text-emerald-500" /> Comprobantes
          </h1>
          <p className="text-sm text-muted-foreground">
            Conciliá cada cobro por transferencia con su comprobante escaneado.
          </p>
        </div>
        <Button variant="outline" onClick={openSettings} className="gap-2">
          <Settings className="size-4" /> Configuración
        </Button>
      </div>

      {/* Banner: feature apagada */}
      {!settings.isEnabled && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent p-4 sm:p-5">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-500/15">
            <ShieldCheck className="size-6 text-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">La verificación de comprobantes está apagada</p>
            <p className="text-sm text-muted-foreground">
              Al activarla, cada cobro por transferencia va a exigir escanear el comprobante y vas a ver acá si todo coincide.
            </p>
          </div>
          {canManage && (
            <Button onClick={openSettings} className="bg-emerald-600 text-white hover:bg-emerald-700">Activar</Button>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
          {(['hoy', '7d', '30d'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => { setPreset(p); refetch({ preset: p }) }}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                preset === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {p === 'hoy' ? 'Hoy' : p === '7d' ? '7 días' : '30 días'}
            </button>
          ))}
        </div>

        {branches.length > 1 && (
          <Select value={branchId} onValueChange={(v) => { setBranchId(v); refetch({ branchId: v }) }}>
            <SelectTrigger className="h-9 w-[170px]"><Building2 className="mr-1.5 size-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las sucursales</SelectItem>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {accounts.length > 1 && (
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); refetch({ accountId: v }) }}>
            <SelectTrigger className="h-9 w-[170px]"><Wallet className="mr-1.5 size-3.5" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las cuentas</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

        <div className="ml-auto">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(visibleRows)}>
            <Download className="size-4" /> Exportar
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="grid gap-4 rounded-2xl border bg-card p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-5 sm:gap-6">
          <ConciliationRing pct={summary.pctConciliado} />
          <div className="space-y-3">
            <BigFigure label="Total transferido" amount={summary.totalTransferido} />
            <BigFigure label="Respaldado con comprobante" amount={summary.totalRespaldado} tone="good" />
            <BigFigure label="Brecha sin respaldo" amount={summary.brecha} tone="bad" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 self-center sm:grid-cols-3 lg:border-l lg:pl-6">
          {TILE_ORDER.map((s) => {
            const m = STATE_META[s]
            const Icon = m.icon
            const count = summary.counts[s]
            const active = stateFilter === s
            return (
              <button
                key={s}
                onClick={() => { setDateFilter(false); setStateFilter(active ? null : s) }}
                className={cn('flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all hover:shadow-sm',
                  active ? cn(m.ring, m.bg) : 'border-border bg-background hover:bg-muted/50',
                  count === 0 && 'opacity-55')}
              >
                <div className={cn('grid size-9 shrink-0 place-items-center rounded-lg', m.bg)}>
                  <Icon className={cn('size-[18px]', m.text)} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-black tabular-nums leading-none">{count}</p>
                  <p className="truncate text-[11px] font-medium text-muted-foreground">{m.short}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Aviso interno de fecha: cobros conciliados por monto, con fecha a revisar.
          NO frena al barbero — el aviso vive acá, en el dashboard. */}
      {settings.isEnabled && summary.dateReview > 0 && (
        <button
          onClick={() => { setStateFilter(null); setDateFilter((v) => !v) }}
          className={cn('flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:shadow-sm',
            dateFilter ? 'border-amber-500/40 bg-amber-500/10 ring-1 ring-amber-500/20' : 'border-amber-500/25 bg-amber-500/[0.06]')}
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15">
            <CalendarClock className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {summary.dateReview} {summary.dateReview === 1 ? 'comprobante con fecha a revisar' : 'comprobantes con fecha a revisar'}
            </p>
            <p className="text-xs text-muted-foreground">
              El monto coincide y el cobro está conciliado. Confirmá que la fecha del comprobante sea correcta.
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-amber-600/80 dark:text-amber-400/80">
            {dateFilter ? 'Ver todo' : 'Revisar'}
          </span>
          <ChevronRight className="size-4 shrink-0 text-amber-600/60" />
        </button>
      )}

      {/* Aviso salud / filtro activo */}
      {settings.isEnabled && anomalies === 0 && summary.scopeCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" /> Todo cuadra: cada transferencia del período tiene su comprobante.
        </div>
      )}
      {stateFilter && (
        <button onClick={() => setStateFilter(null)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <X className="size-3.5" /> Quitar filtro: {STATE_META[stateFilter].label}
        </button>
      )}
      {dateFilter && (
        <button onClick={() => setDateFilter(false)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <X className="size-3.5" /> Quitar filtro: Fecha a revisar
        </button>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Fecha</th>
                <th className="px-4 py-2.5 font-semibold">Barbero</th>
                <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Cliente</th>
                <th className="px-4 py-2.5 text-right font-semibold">Monto</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {cappedRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                  No hay movimientos por transferencia en este período.
                </td></tr>
              )}
              {cappedRows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  onClick={() => openDetail(row)}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(row.datetime)}</td>
                  <td className="px-4 py-3 font-medium">{row.barberName ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{row.clientName ?? (row.kind === 'orphan' ? 'Comprobante suelto' : '—')}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">
                    {row.chargedAmount != null ? formatCurrency(row.chargedAmount) : (row.receipt?.extractedAmount != null ? formatCurrency(row.receipt.extractedAmount) : '—')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge state={row.state} />
                      {row.dateReview && <DateReviewPill />}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-muted-foreground"><ChevronRight className="size-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleRows.length > cappedRows.length && (
          <p className="border-t bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
            Mostrando {cappedRows.length} de {visibleRows.length}. Filtrá por sucursal o acortá el rango para ver el resto.
          </p>
        )}
        {recon.truncated && (
          <p className="border-t bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
            El período supera el máximo de filas. Acortá el rango para incluir todo.
          </p>
        )}
      </div>

      {/* Detalle */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <StatusBadge state={detail.state} />
                  {detail.dateReview && <DateReviewPill />}
                </SheetTitle>
                <SheetDescription>{formatDateTime(detail.datetime)} · {detail.barberName ?? 'Sin barbero'}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-8">
                <div className="grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl border bg-muted/40">
                  {detailLoadingUrl ? (
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  ) : detailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={detailUrl} alt="Comprobante" className="size-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <FileQuestion className="size-8" /><span className="text-sm">Sin imagen</span>
                    </div>
                  )}
                </div>
                {detailUrl && (
                  <a href={detailUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                    <ExternalLink className="size-3.5" /> Abrir imagen completa
                  </a>
                )}

                <div className="space-y-2 rounded-xl border p-4">
                  <CompareRow label="Monto cobrado" value={detail.chargedAmount != null ? formatCurrency(detail.chargedAmount) : '—'} />
                  <CompareRow label="Monto en el comprobante" value={detail.receipt?.extractedAmount != null ? formatCurrency(detail.receipt.extractedAmount) : '—'} ok={detail.receipt?.amountMatches} />
                  <CompareRow
                    label="Fecha del comprobante"
                    value={detail.receipt?.extractedDatetime ? new Date(detail.receipt.extractedDatetime).toLocaleString('es-AR') : '—'}
                    ok={detail.receipt?.dateOk}
                  />
                  <Separator />
                  <CompareRow label="Nº de operación" value={detail.receipt?.operationNumber ?? '—'} mono />
                  <CompareRow label="Alias/CBU destino" value={detail.receipt?.recipientAlias ?? '—'} ok={detail.receipt?.aliasMatches} mono />
                  <CompareRow label="Remitente" value={detail.receipt?.senderName ?? '—'} />
                  <CompareRow label="Banco / billetera" value={detail.receipt?.bankOrWallet ?? '—'} />
                  {detail.receipt && (
                    <CompareRow label="Leído por" value={detail.receipt.engine === 'ai' ? 'IA' : detail.receipt.engine === 'ocr' ? 'Motor OCR' : '—'} />
                  )}
                </div>

                {detail.dateReview && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                      <CalendarClock className="size-4" /> La fecha leída parece de otro día
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      El cobro ya está conciliado por monto — la plata entró. Mirá la imagen: si la fecha es correcta (o no importa), marcala como revisada y este aviso desaparece.
                    </p>
                    {canManage && detail.receipt && (
                      <Button
                        variant="outline"
                        className="mt-3 w-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                        disabled={detailSaving}
                        onClick={() => reviewDetail('note', 'Fecha marcada como revisada')}
                      >
                        {detailSaving ? <Loader2 className="size-4 animate-spin" /> : <><CheckCircle2 className="mr-1.5 size-4" /> Marcar fecha como revisada</>}
                      </Button>
                    )}
                  </div>
                )}

                {canManage && detail.receipt && (
                  <div className="space-y-2">
                    <textarea
                      value={detailNote}
                      onChange={(e) => setDetailNote(e.target.value.slice(0, 400))}
                      placeholder="Nota de conciliación (opcional)…"
                      rows={2}
                      className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" disabled={detailSaving} onClick={() => reviewDetail('note')}>
                        Guardar nota
                      </Button>
                      {detail.state !== 'conciliado' && (
                        <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={detailSaving} onClick={() => reviewDetail('manual_ok')}>
                          {detailSaving ? <Loader2 className="size-4 animate-spin" /> : <><CheckCircle2 className="mr-1.5 size-4" /> Dar por válido</>}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Configuración */}
      <Sheet open={settingsOpen} onOpenChange={(o) => !o && setSettingsOpen(false)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2"><Settings className="size-5" /> Verificación de comprobantes</SheetTitle>
            <SheetDescription>Exigí un comprobante en cada cobro por transferencia y elegí cómo se lee.</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-8">
            <label className={cn('flex items-center justify-between gap-4 rounded-xl border p-4', !canManage && 'opacity-60')}>
              <div>
                <p className="font-semibold">Exigir comprobante</p>
                <p className="text-sm text-muted-foreground">Obligatorio para cerrar un cobro por transferencia.</p>
              </div>
              <Switch checked={sEnabled} onCheckedChange={setSEnabled} disabled={!canManage} />
            </label>

            <div className={cn(!sEnabled && 'pointer-events-none opacity-50')}>
              <p className="mb-2 text-sm font-semibold">Motor de lectura</p>
              <div className="grid grid-cols-2 gap-2">
                <EngineOption active={sEngine === 'ai'} onClick={() => canManage && setSEngine('ai')}
                  icon={Sparkles} title="IA" subtitle="GPT-4o mini" badge="Barata" tone="ai"
                  desc="Rápida y precisa con reflejos. Usa tu cuenta de IA (OpenAI/Claude), centavos por lectura." />
                <EngineOption active={sEngine === 'ocr'} onClick={() => canManage && setSEngine('ocr')}
                  icon={Cpu} title="Motor" subtitle="OCR local" badge="Gratis" tone="ocr"
                  desc="Sin costo, corre en la tablet. Menos preciso." />
              </div>
            </div>

            <div className={cn(!sEnabled && 'pointer-events-none opacity-50')}>
              <p className="mb-2 text-sm font-semibold">Tolerancia de horario</p>
              <Select value={String(sDateTol)} onValueChange={(v) => canManage && setSDateTol(Number(v))}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="60">1 hora</SelectItem>
                  <SelectItem value="120">2 horas</SelectItem>
                  <SelectItem value="180">3 horas</SelectItem>
                  <SelectItem value="360">6 horas</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Si el comprobante es de <b>otro día</b>, se marca para <span className="font-semibold text-amber-600 dark:text-amber-400">revisar la fecha</span> acá en el dashboard — el cobro igual se cierra en la caja, sin frenar al barbero delante del cliente. Esta ventana tolera transferencias hechas un rato antes (útil cerca de medianoche).
              </p>
            </div>

            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-muted-foreground">
              Si la lectura falla, el comprobante se guarda igual y queda <span className="font-semibold text-sky-600 dark:text-sky-400">en revisión</span> — el cobro no se bloquea.
            </div>

            {canManage && (
              <Button onClick={saveSettings} disabled={sSaving} className="h-11 w-full font-semibold">
                {sSaving ? <Loader2 className="size-4 animate-spin" /> : 'Guardar'}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function CompareRow({ label, value, ok, mono }: { label: string; value: string; ok?: boolean | null; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-medium', mono && 'font-mono text-xs')}>
        {value}
        {ok === true && <CheckCircle2 className="size-4 text-emerald-500" />}
        {ok === false && <AlertTriangle className="size-4 text-amber-500" />}
      </span>
    </div>
  )
}

function EngineOption({ active, onClick, icon: Icon, title, subtitle, badge, desc, tone }: {
  active: boolean; onClick: () => void; icon: ComponentType<{ className?: string }>
  title: string; subtitle: string; badge: string; desc: string; tone: 'ai' | 'ocr'
}) {
  return (
    <button
      onClick={onClick}
      className={cn('flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-all',
        active
          ? tone === 'ai' ? 'border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30' : 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30'
          : 'border-border hover:bg-muted/50')}
    >
      <div className="flex items-center justify-between">
        <Icon className={cn('size-5', tone === 'ai' ? 'text-violet-500' : 'text-emerald-500')} />
        <Badge variant="outline" className={cn('text-[10px]', tone === 'ocr' && 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400')}>{badge}</Badge>
      </div>
      <div>
        <p className="text-sm font-bold leading-tight">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{desc}</p>
    </button>
  )
}

function exportCsv(rows: ReconRow[]) {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['Fecha', 'Barbero', 'Cliente', 'Cuenta', 'Monto cobrado', 'Estado', 'Revisar fecha', 'Monto leido', 'Nro operacion', 'Motor']
  const lines = rows.map((r) => [
    formatDateTime(r.datetime), r.barberName ?? '', r.clientName ?? '', r.accountName ?? '',
    r.chargedAmount ?? '', STATE_META[r.state].label, r.dateReview ? 'Si' : '', r.receipt?.extractedAmount ?? '',
    r.receipt?.operationNumber ?? '', r.receipt?.engine ?? '',
  ].map(cell).join(','))
  const csv = '﻿' + [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `comprobantes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
