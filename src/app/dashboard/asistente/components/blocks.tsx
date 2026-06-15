'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Download, Maximize2, FileText, TrendingUp, TrendingDown, Loader2, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { exportAssistantReportPDF } from '@/lib/export'
import type { AssistantReport } from '@/lib/asistente/report-schema'
import { formatARS, formatNum } from './types'

// recharts lazy (solo se baja cuando aparece un gráfico)
const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), { ssr: false })
const BarChart = dynamic(() => import('recharts').then((m) => m.BarChart), { ssr: false })
const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false })
const AreaChart = dynamic(() => import('recharts').then((m) => m.AreaChart), { ssr: false })
const Area = dynamic(() => import('recharts').then((m) => m.Area), { ssr: false })
const PieChart = dynamic(() => import('recharts').then((m) => m.PieChart), { ssr: false })
const Pie = dynamic(() => import('recharts').then((m) => m.Pie), { ssr: false })
const Cell = dynamic(() => import('recharts').then((m) => m.Cell), { ssr: false })
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false })
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then((m) => m.CartesianGrid), { ssr: false })

const PIE_COLORS = ['#a3a3a3', '#737373', '#525252', '#d4d4d4', '#404040', '#8a8a8a']
const AXIS = '#737373'
const GRID = '#262626'

// ── KPI strip ───────────────────────────────────────────────────────
export interface Kpi {
  label: string
  value: string
  tone?: 'up' | 'down' | 'neutral'
  delta?: string
}

export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null
  return (
    <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
      {kpis.map((k, i) => (
        <div
          key={i}
          className="animate-scale-in rounded-xl border border-border bg-card/60 p-3"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <p className="text-[11px] text-muted-foreground truncate">{k.label}</p>
          <p className="mt-0.5 text-lg font-bold tracking-tight">{k.value}</p>
          {k.delta && (
            <p className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${k.tone === 'down' ? 'text-red-400' : 'text-emerald-400'}`}>
              {k.tone === 'down' ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
              {k.delta}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Chart genérico ──────────────────────────────────────────────────
interface ChartData {
  title?: string
  type: 'area' | 'bar' | 'pie'
  data: { label: string; value: number }[]
}

export function ChartView({ chart, height = 200 }: { chart: ChartData; height?: number }) {
  if (!chart.data?.length) return null
  return (
    <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
      {chart.title && <p className="mb-2 text-xs font-medium text-muted-foreground">{chart.title}</p>}
      <ResponsiveContainer width="100%" height={height}>
        {chart.type === 'pie' ? (
          <PieChart>
            <Pie data={chart.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={70} innerRadius={36} paddingAngle={3}>
              {chart.data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: '#171717', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
          </PieChart>
        ) : chart.type === 'area' ? (
          <AreaChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#171717', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="value" stroke="#d4d4d4" fill="#d4d4d4" fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        ) : (
          <BarChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} />
            <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ background: '#171717', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" fill="#a3a3a3" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// ── Tabla compacta ──────────────────────────────────────────────────
function MiniTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.slice(0, 10).map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 whitespace-nowrap">{String(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── SQL result ──────────────────────────────────────────────────────
export function SqlResult({ output }: { output: unknown }) {
  const o = output as { resultado?: unknown; error?: string; message?: string }
  if (o?.error) {
    return <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{o.message ?? 'Error en la consulta'}</div>
  }
  const rows = (o?.resultado as Record<string, unknown>[]) ?? []
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="mt-3 rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground">La consulta no devolvió filas.</div>
  }
  const headers = Object.keys(rows[0])
  const body = rows.map((r) => headers.map((h) => {
    const v = r[h]
    return v === null || v === undefined ? '—' : typeof v === 'number' ? formatNum(v) : String(v)
  }))
  return <MiniTable headers={headers} rows={body} />
}

// ── Report card + preview ───────────────────────────────────────────
export function ReportCard({ report, orgName }: { report: AssistantReport; orgName?: string }) {
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  async function download() {
    setDownloading(true)
    try {
      await exportAssistantReportPDF(report, { orgName })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <div className="glass-card mt-3 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-[oklch(0.78_0.12_85)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[oklch(0.78_0.12_85)]">Informe</span>
        </div>
        <h3 className="mt-1 text-base font-bold">{report.title}</h3>
        {(report.periodLabel || report.branchLabel) && (
          <p className="text-xs text-muted-foreground">{[report.periodLabel, report.branchLabel].filter(Boolean).join(' · ')}</p>
        )}
        {report.kpis.length > 0 && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {report.kpis.slice(0, 3).map((k, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/40 p-2">
                <p className="text-[10px] text-muted-foreground truncate">{k.label}</p>
                <p className="text-sm font-bold">{k.value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={download} disabled={downloading} className="btn-gold">
            {downloading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Download className="mr-1.5 size-3.5" />}
            Descargar PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Maximize2 className="mr-1.5 size-3.5" /> Ver completo
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{report.title}</DialogTitle>
          </DialogHeader>
          {(report.periodLabel || report.branchLabel) && (
            <p className="text-sm text-muted-foreground">{[report.periodLabel, report.branchLabel].filter(Boolean).join(' · ')}</p>
          )}
          {report.kpis.length > 0 && <KpiStrip kpis={report.kpis.map((k) => ({ label: k.label, value: k.value, tone: k.tone, delta: k.delta }))} />}
          {report.charts.map((c, i) => (
            <ChartView key={i} chart={c} height={220} />
          ))}
          {report.tables.map((t, i) => (
            <div key={i}>
              <p className="mt-4 mb-1 text-sm font-semibold">{t.title}</p>
              <MiniTable headers={t.headers} rows={t.rows} />
            </div>
          ))}
          {report.narrative && (
            <div className="mt-4 rounded-xl border border-border bg-card/50 p-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {report.narrative}
            </div>
          )}
          <div className="mt-4">
            <Button onClick={download} disabled={downloading} className="btn-gold">
              {downloading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Download className="mr-1.5 size-4" />}
              Descargar PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Dispatcher: tool output → bloque visual ─────────────────────────
type Rec = Record<string, unknown>

export function ToolResultBlock({ name, output, orgName }: { name: string; output: unknown; orgName?: string }) {
  if (!output || typeof output !== 'object') return null
  const o = output as Rec

  if (name === 'generar_reporte') {
    const report = o.report as AssistantReport | undefined
    return report ? <ReportCard report={report} orgName={orgName} /> : null
  }
  if (name === 'consulta_sql') return <SqlResult output={output} />

  if (name === 'finanzas_pyl') {
    const t = o.totales as Rec | undefined
    const be = o.break_even as Rec | undefined
    if (!t) return null
    const kpis: Kpi[] = [
      { label: 'Ingresos', value: formatARS(Number(t.revenue ?? 0)) },
      { label: 'Ganancia neta', value: formatARS(Number(t.netProfit ?? 0)), tone: Number(t.netProfit ?? 0) >= 0 ? 'up' : 'down' },
      { label: 'Cortes', value: formatNum(Number(t.cuts ?? 0)) },
      { label: 'Break-even', value: `${formatNum(Number(be?.cutsNeeded ?? 0))} cortes` },
    ]
    const barbers = (o.top_barberos as Rec[] | undefined)?.slice(0, 6) ?? []
    return (
      <>
        <KpiStrip kpis={kpis} />
        {barbers.length > 0 && (
          <ChartView chart={{ title: 'Ingresos por barbero', type: 'bar', data: barbers.map((b) => ({ label: String(b.name ?? '—').split(' ')[0], value: Number(b.revenue ?? 0) })) }} />
        )}
      </>
    )
  }

  if (name === 'estadisticas') {
    const t = o.totales as Rec | undefined
    if (!t) return null
    const ret = o.retorno_clientes as Rec | undefined
    const kpis: Kpi[] = [
      { label: 'Ingresos', value: formatARS(Number(t.revenue ?? 0)) },
      { label: 'Cortes', value: formatNum(Number(t.cuts ?? 0)) },
      { label: 'Ticket prom.', value: formatARS(Number(t.avgTicket ?? 0)) },
      { label: 'Clientes', value: formatNum(Number(t.clients ?? 0)) },
    ]
    if (ret && Number(ret.clientes_unicos ?? 0) > 0) {
      kpis.push({
        label: `Volvieron (${formatNum(Number(ret.clientes_que_volvieron ?? 0))}/${formatNum(Number(ret.clientes_unicos ?? 0))})`,
        value: `${formatNum(Number(ret.tasa_pct ?? 0))}%`,
      })
    }
    const ranking = (o.ranking_barberos as Rec[] | undefined)?.slice(0, 6) ?? []
    return (
      <>
        <KpiStrip kpis={kpis} />
        {ranking.length > 0 && (
          <ChartView chart={{ title: 'Cortes por barbero', type: 'bar', data: ranking.map((b) => ({ label: String(b.name ?? '—').split(' ')[0], value: Number(b.cuts ?? 0) })) }} />
        )}
      </>
    )
  }

  if (name === 'listar_sucursales') {
    const sucursales = (o.sucursales as Rec[] | undefined) ?? []
    if (sucursales.length === 0) return null
    return (
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sucursales.map((s, i) => (
          <div
            key={i}
            className="animate-scale-in flex items-start gap-2.5 rounded-xl border border-border bg-card/60 p-3"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{String(s.nombre ?? '—')}</p>
              {s.direccion != null && s.direccion !== '' && (
                <p className="truncate text-[11px] text-muted-foreground">{String(s.direccion)}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (name === 'sueldos_comisiones') {
    return (
      <KpiStrip
        kpis={[
          { label: 'Comisiones pendientes', value: formatARS(Number(o.total_pendiente ?? 0)) },
          { label: 'Pagado', value: formatARS(Number(o.total_pagado ?? 0)) },
          { label: 'Pendientes', value: formatNum(Number(o.cantidad_pendiente ?? 0)) },
        ]}
      />
    )
  }

  if (name === 'fidelizacion') {
    return (
      <KpiStrip
        kpis={[
          { label: 'Puntos activos', value: formatNum(Number(o.puntos_activos ?? 0)) },
          { label: 'Ganados', value: formatNum(Number(o.puntos_ganados_historico ?? 0)) },
          { label: 'Canjeados', value: formatNum(Number(o.puntos_canjeados_historico ?? 0)) },
        ]}
      />
    )
  }

  if (name === 'turnos_resumen') {
    const por = (o.por_estado as Record<string, number>) ?? {}
    const kpis: Kpi[] = [
      { label: 'Total turnos', value: formatNum(Number(o.total ?? 0)) },
      ...Object.entries(por).slice(0, 3).map(([k, v]) => ({ label: k, value: formatNum(Number(v)) })),
    ]
    return <KpiStrip kpis={kpis} />
  }

  // Fallback genérico de error: cualquier herramienta que devuelva { error, message }
  // (sin_acceso, sucursal_no_resuelta, etc.) muestra una tarjeta clara en vez de nada.
  if (typeof o.error === 'string') {
    const opciones = Array.isArray(o.sucursales_disponibles) ? (o.sucursales_disponibles as string[]) : []
    return (
      <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
        <p className="text-xs text-amber-300">{String(o.message ?? 'No pude completar la consulta.')}</p>
        {opciones.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {opciones.map((nombre, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                <Building2 className="size-3 opacity-70" />
                {nombre}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}
