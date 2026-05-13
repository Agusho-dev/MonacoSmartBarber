'use client'

import { useEffect, useState, useMemo, useTransition } from 'react'
import { Clock, Timer, Users, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { getServiceTimings, type ServiceTimingsResult } from '@/lib/actions/services'
import { cn } from '@/lib/utils'

type Loaded = Extract<ServiceTimingsResult, { service: unknown }>

interface Props {
  serviceId: string | null
  serviceName?: string
  onOpenChange: (open: boolean) => void
}

const DATE_FMT = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

function formatMinutes(m: number): string {
  if (m < 1) return '<1 min'
  return `${m.toFixed(1)} min`
}

function deltaBadge(actual: number, configured: number | null) {
  if (!configured) return null
  const diff = actual - configured
  const pct = Math.abs(diff / configured) * 100

  // Tolerancia del ±10% se considera "ok"
  if (pct < 10) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Minus className="size-3" />
        En target
      </Badge>
    )
  }
  if (diff < 0) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <TrendingDown className="size-3" />
        {Math.abs(diff).toFixed(1)} min menos
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
      <TrendingUp className="size-3" />
      {diff.toFixed(1)} min más
    </Badge>
  )
}

export function ServiceTimingsDialog({ serviceId, serviceName, onOpenChange }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedId, setLastFetchedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Reset durante render cuando el serviceId apunta a uno nuevo (evita flash
  // de datos viejos al cambiar de servicio). Se ignora la transición a null
  // para no parpadear durante la animación de cierre del Sheet.
  if (serviceId !== null && serviceId !== lastFetchedId) {
    setData(null)
    setError(null)
    setLastFetchedId(serviceId)
  }

  useEffect(() => {
    if (!serviceId) return
    let cancelled = false
    startTransition(async () => {
      const result = await getServiceTimings(serviceId)
      if (cancelled) return
      if ('error' in result) {
        setError(result.error)
      } else {
        setData(result)
      }
    })
    return () => { cancelled = true }
  }, [serviceId])

  const maxBarberAvg = useMemo(() => {
    if (!data?.byBarber.length) return 0
    return Math.max(...data.byBarber.map((b) => b.avgMinutes))
  }, [data])

  return (
    <Sheet open={!!serviceId} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="size-5" />
            Tiempos reales
            {(data?.service.name ?? serviceName) && (
              <span className="text-muted-foreground font-normal">
                — {data?.service.name ?? serviceName}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {data ? `Últimos ${data.daysBack} días · ${data.summary?.totalVisits ?? 0} cortes válidos` : 'Calculando…'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8 space-y-6">
          {isPending && !data && <LoadingSkeleton />}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <AlertCircle className="size-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm text-destructive">{error}</div>
            </div>
          )}

          {data && !error && (
            <>
              {/* Summary */}
              <section className="rounded-xl border bg-card">
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0">
                  <Stat
                    label="Configurado"
                    value={data.service.duration_minutes ? `${data.service.duration_minutes} min` : '—'}
                    icon={<Timer className="size-3.5" />}
                  />
                  <Stat
                    label="Promedio real"
                    value={data.summary ? formatMinutes(data.summary.avgMinutes) : '—'}
                    highlight
                  />
                  <Stat
                    label="Mediana"
                    value={data.summary ? formatMinutes(data.summary.medianMinutes) : '—'}
                  />
                  <Stat
                    label="Barberos"
                    value={String(data.byBarber.length)}
                    icon={<Users className="size-3.5" />}
                  />
                </div>
                {data.summary && data.service.duration_minutes && (
                  <div className="border-t px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">vs duración configurada</span>
                    {deltaBadge(data.summary.avgMinutes, data.service.duration_minutes)}
                  </div>
                )}
              </section>

              {/* Por barbero */}
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">Por barbero</h3>
                  <span className="text-xs text-muted-foreground">ordenado del más rápido al más lento</span>
                </div>

                {data.byBarber.length === 0 ? (
                  <EmptyHint text="Sin datos de barberos en los últimos 90 días" />
                ) : (
                  <ul className="space-y-2">
                    {data.byBarber.map((b) => {
                      const widthPct = maxBarberAvg > 0 ? (b.avgMinutes / maxBarberAvg) * 100 : 0
                      const cfg = data.service.duration_minutes
                      const isFaster = cfg ? b.avgMinutes < cfg * 0.9 : false
                      const isSlower = cfg ? b.avgMinutes > cfg * 1.1 : false

                      return (
                        <li key={b.barberId} className="rounded-lg border bg-card px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{b.fullName}</p>
                              <p className="text-xs text-muted-foreground">
                                {b.count} {b.count === 1 ? 'corte' : 'cortes'} · mediana {formatMinutes(b.medianMinutes)}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={cn(
                                'text-base font-semibold tabular-nums',
                                isFaster && 'text-emerald-600 dark:text-emerald-400',
                                isSlower && 'text-amber-600 dark:text-amber-400',
                              )}>
                                {formatMinutes(b.avgMinutes)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {formatMinutes(b.minMinutes)} – {formatMinutes(b.maxMinutes)}
                              </p>
                            </div>
                          </div>
                          <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'absolute inset-y-0 left-0 rounded-full',
                                isFaster ? 'bg-emerald-500' : isSlower ? 'bg-amber-500' : 'bg-primary',
                              )}
                              style={{ width: `${widthPct}%` }}
                            />
                            {cfg && cfg <= maxBarberAvg && maxBarberAvg > 0 && (
                              <div
                                className="absolute inset-y-[-2px] w-px bg-foreground/70"
                                style={{ left: `${(cfg / maxBarberAvg) * 100}%` }}
                                title={`Configurado: ${cfg} min`}
                              />
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                {data.service.duration_minutes && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <span className="inline-block h-2 w-px bg-foreground/70" />
                    marca el valor configurado ({data.service.duration_minutes} min)
                  </p>
                )}
              </section>

              {/* Últimas visitas */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Últimas {data.recent.length} visitas</h3>
                {data.recent.length === 0 ? (
                  <EmptyHint text="Sin visitas registradas" />
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9 text-xs">Fecha</TableHead>
                          <TableHead className="h-9 text-xs">Barbero</TableHead>
                          <TableHead className="h-9 text-xs">Cliente</TableHead>
                          <TableHead className="h-9 text-xs text-right">Tiempo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.recent.map((v) => {
                          const isOutlier = v.minutes < 1 || v.minutes > 120
                          return (
                            <TableRow key={v.visitId}>
                              <TableCell className="py-2 text-xs whitespace-nowrap">
                                {DATE_FMT.format(new Date(v.date))}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                {v.barberName ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="py-2 text-xs">
                                {v.clientName ? (
                                  <span className="truncate inline-block max-w-[140px] align-middle">{v.clientName}</span>
                                ) : v.clientPhone ? (
                                  <span className="text-muted-foreground">{v.clientPhone}</span>
                                ) : (
                                  <span className="text-muted-foreground">Sin cliente</span>
                                )}
                              </TableCell>
                              <TableCell className={cn(
                                'py-2 text-xs text-right tabular-nums font-medium',
                                isOutlier && 'text-muted-foreground italic',
                              )}>
                                {formatMinutes(v.minutes)}
                                {isOutlier && <span className="ml-1 text-[10px]">(outlier)</span>}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value, icon, highlight }: {
  label: string
  value: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className={cn(
        'mt-0.5 font-semibold tabular-nums',
        highlight ? 'text-lg' : 'text-base',
      )}>
        {value}
      </p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pt-2">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}
