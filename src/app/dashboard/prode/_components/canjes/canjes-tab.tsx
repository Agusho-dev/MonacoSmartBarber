'use client'

import { useMemo, useState } from 'react'
import { Download, Search, TicketPercent, Scissors, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CouponRedemptionRow } from '../../_lib/types'
import { fmtKickoff } from '../../_lib/fmt'
import { formatCurrency } from '@/lib/format'

type Period = 'all' | 'today' | '7d' | '30d'

const PERIOD_LABELS: Record<Period, string> = {
  all: 'Todo el tiempo',
  today: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
}

function benefitLabel(r: CouponRedemptionRow): string {
  if (r.isFreeService) return 'Servicio gratis'
  if (r.discountPct) return `${r.discountPct}% OFF`
  return 'Beneficio'
}

export function CanjesTab({ redemptions }: { redemptions: CouponRedemptionRow[] }) {
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [branch, setBranch] = useState<string>('all')
  // "Ahora" capturado una vez al montar (evita Date.now() impuro en render).
  const [nowMs] = useState(() => Date.now())

  // Sucursales presentes en los datos (para el filtro)
  const branches = useMemo(() => {
    const set = new Set<string>()
    for (const r of redemptions) if (r.branchName) set.add(r.branchName)
    return Array.from(set).sort()
  }, [redemptions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const windowMs =
      period === 'today' ? null : period === '7d' ? 7 * 864e5 : period === '30d' ? 30 * 864e5 : null

    return redemptions.filter((r) => {
      if (branch !== 'all' && r.branchName !== branch) return false

      if (period !== 'all' && r.redeemedAt) {
        const t = new Date(r.redeemedAt).getTime()
        if (period === 'today') {
          const d = new Date(r.redeemedAt)
          const today = new Date(nowMs)
          if (
            d.getFullYear() !== today.getFullYear() ||
            d.getMonth() !== today.getMonth() ||
            d.getDate() !== today.getDate()
          )
            return false
        } else if (windowMs && nowMs - t > windowMs) {
          return false
        }
      }

      if (!q) return true
      return (
        (r.clientName ?? '').toLowerCase().includes(q) ||
        (r.clientPhone ?? '').includes(q) ||
        (r.barberName ?? '').toLowerCase().includes(q) ||
        (r.rewardName ?? '').toLowerCase().includes(q)
      )
    })
  }, [redemptions, query, period, branch, nowMs])

  const totalDescontado = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.discountAmount ?? 0), 0),
    [filtered],
  )

  function exportCsv() {
    const headers = [
      'Fecha',
      'Hora',
      'Cliente',
      'Telefono',
      'Cupon',
      'Beneficio',
      'Barbero',
      'Sucursal',
      'Descuento',
      'Monto cobrado',
    ]
    const esc = (v: string | number | null) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = filtered.map((r) => {
      const d = r.redeemedAt ? new Date(r.redeemedAt) : null
      return [
        d ? d.toLocaleDateString('es-AR') : '',
        d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '',
        r.clientName ?? '',
        r.clientPhone ?? '',
        r.rewardName ?? '',
        benefitLabel(r),
        r.barberName ?? '',
        r.branchName ?? '',
        r.discountAmount ?? '',
        r.visitAmount ?? '',
      ].map(esc).join(',')
    })
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `canjes-cupones-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5 text-xs">
              <TicketPercent className="size-3.5" /> Cupones canjeados
            </CardDescription>
            <CardTitle className="text-3xl tabular-nums">{filtered.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total descontado</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{formatCurrency(totalDescontado)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Período</CardDescription>
            <CardTitle className="text-base">{PERIOD_LABELS[period]}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TicketPercent className="size-5 text-emerald-500" /> Historial de canjes
              </CardTitle>
              <CardDescription>
                Cada cupón consumido: cuándo, qué cliente, qué barbero, en qué sucursal y cuánto se descontó.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cliente, barbero, teléfono…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIOD_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branches.length > 1 && (
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sucursales</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
                <Download className="mr-1.5 size-4" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {redemptions.length === 0
                ? 'Todavía no se canjeó ningún cupón. Aparecerán acá apenas un barbero canjee uno en el cobro.'
                : 'Ningún canje coincide con los filtros.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Cupón</TableHead>
                    <TableHead>Barbero</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Descuento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.redeemedAt ? fmtKickoff(r.redeemedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.clientName ?? '—'}</div>
                        {r.clientPhone && (
                          <div className="text-xs text-muted-foreground">{r.clientPhone}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-[180px]">{r.rewardName ?? '—'}</span>
                          <Badge
                            variant="outline"
                            className="shrink-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          >
                            {benefitLabel(r)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.barberName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Scissors className="size-3.5 text-muted-foreground" />
                            {r.barberName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.branchName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Store className="size-3.5 text-muted-foreground" />
                            {r.branchName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.discountAmount != null ? (
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            −{formatCurrency(r.discountAmount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
