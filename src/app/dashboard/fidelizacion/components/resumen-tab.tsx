'use client'

// =============================================================================
// Resumen: el interruptor del programa, las 4 categorías como tarjeta, KPIs de
// 30 días y la línea de tiempo de lo último que pasó.
// =============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock, Coins, Gift, Hourglass, Loader2,
  Power, RefreshCw, Sparkles, UserPlus, Wrench, XCircle, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { runLoyaltyMaintenanceNow, setLoyaltyProgramEnabled } from '@/lib/actions/loyalty'
import type { LoyaltyMaintenanceResult, LoyaltyOverview, LoyaltySettings, LoyaltyTier } from '@/lib/types/loyalty'
import { MonacoCardPreview } from './monaco-card-preview'
import { describirEvento, fmtFecha, fmtRelativo, horaMantenimientoLocal, numero } from './helpers'

interface Props {
  overview: LoyaltyOverview
  settings: LoyaltySettings
  tiers: LoyaltyTier[]
  canManage: boolean
  timezone: string
  onSettingsChange: (s: LoyaltySettings) => void
}

const PUNTOS_EJEMPLO: Record<string, number> = { bronce: 120, plata: 340, oro: 650, platinum: 1200 }

export function ResumenTab({ overview, settings, tiers, canManage, timezone, onSettingsChange }: Props) {
  const router = useRouter()
  const [confirmar, setConfirmar] = useState<null | boolean>(null)
  // Qué acción está en juego, separada de "el diálogo está abierto": al
  // confirmar, `confirmar` vuelve a null ANTES de que arranque la transición,
  // así que el velo (y el diálogo durante su animación de cierre) leerían la
  // rama equivocada — activar el programa mostraba "Apagando…".
  const [accion, setAccion] = useState(false)
  const [pending, startTransition] = useTransition()
  const [mantPending, startMant] = useTransition()
  const [mant, setMant] = useState<LoyaltyMaintenanceResult | null>(null)

  const activo = settings.is_enabled
  const nombresTier = Object.fromEntries(tiers.map(t => [t.code, t.name]))

  // Con el programa apagado, la distribución real es 0 en todos lados: se
  // muestra la simulación "si prendés hoy" con los umbrales configurados.
  const usarPreview = !activo || overview.tiers.every(t => t.count === 0)
  const dist = overview.distribution_preview
  const totalReal = overview.tiers.reduce((a, t) => a + t.count, 0)
  const total = usarPreview ? (dist?.total ?? 0) : totalReal

  function cantidadDe(code: string): number {
    if (usarPreview) return (dist?.[code as keyof typeof dist] as number | undefined) ?? 0
    return overview.tiers.find(t => t.code === code)?.count ?? 0
  }

  function aplicar(enabled: boolean) {
    startTransition(async () => {
      const r = await setLoyaltyProgramEnabled(enabled)
      if ('error' in r) { toast.error(r.error); return }
      onSettingsChange({ ...settings, is_enabled: enabled, program_started_at: settings.program_started_at ?? (enabled ? new Date().toISOString() : null) })
      toast.success(enabled
        ? `Programa activado. ${numero(r.enrolled)} clientes recibieron su categoría inicial.`
        : 'Programa apagado. Los saldos y categorías quedan guardados.')
      router.refresh()
    })
  }

  function correrMantenimiento() {
    startMant(async () => {
      const r = await runLoyaltyMaintenanceNow()
      if ('error' in r) { toast.error(r.error); return }
      setMant(r.result)
      toast.success('Mantenimiento ejecutado')
      router.refresh()
    })
  }

  const kpis = [
    { label: 'Puntos emitidos · 30 d', value: overview.points.issued_30d, icon: ArrowUpRight, tono: 'ok' },
    { label: 'Puntos canjeados · 30 d', value: overview.points.redeemed_30d, icon: Gift, tono: 'info' },
    { label: 'Puntos vencidos · 30 d', value: overview.points.expired_30d, icon: ArrowDownRight, tono: 'neutral' },
    { label: 'Por vencer · próx. 30 d', value: overview.points.expiring_30d, icon: Hourglass, tono: overview.points.expiring_30d > 0 ? 'warn' : 'neutral' },
    { label: 'Beneficios usados · 30 d', value: overview.rewards.used_30d, icon: CheckCircle2, tono: 'ok' },
    { label: 'Referidos completados · 30 d', value: overview.referrals.completed_30d, icon: UserPlus, tono: 'info' },
    { label: 'Clientes en gracia', value: overview.in_grace, icon: Clock, tono: overview.in_grace > 0 ? 'warn' : 'neutral' },
    { label: 'Errores · 7 d', value: overview.errors_7d, icon: overview.errors_7d > 0 ? XCircle : CheckCircle2, tono: overview.errors_7d > 0 ? 'bad' : 'ok' },
  ] as const

  return (
    <div className="space-y-6">
      {/* ── Interruptor ─────────────────────────────────────────────── */}
      <section
        className={cn(
          'relative overflow-hidden rounded-2xl border p-5 sm:p-6',
          activo ? 'border-emerald-500/25 bg-[radial-gradient(90%_120%_at_0%_0%,rgba(16,185,129,.14),transparent_60%)]' : 'border-white/[0.08] bg-zinc-900/40',
        )}
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl border', activo ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
              <Power className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Programa de fidelización</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {activo
                  ? <>Activo desde el <span className="text-foreground">{fmtFecha(settings.program_started_at, timezone)}</span>. Las visitas cobradas suman puntos y mueven categorías.</>
                  : <>Apagado. Los clientes ven sus puntos en la app pero sin categoría, y ninguna visita acredita puntos hasta que lo prendas.</>}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Ventana de {settings.window_weeks} semanas · {settings.grace_days} días de gracia · {settings.base_points} pts base · vencen a los {settings.points_expiry_days} días
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:flex-col md:items-end">
            <span className={cn('text-xs font-semibold uppercase tracking-wider', activo ? 'text-emerald-400' : 'text-muted-foreground')}>
              {activo ? 'Activo' : 'Apagado'}
            </span>
            <Switch
              checked={activo}
              disabled={!canManage || pending}
              onCheckedChange={v => { setAccion(v); setConfirmar(v) }}
              aria-label={activo ? 'Apagar el programa' : 'Activar el programa'}
              className="origin-right scale-[1.6] data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm">
            <span className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> {accion ? 'Asignando categorías…' : 'Apagando…'}</span>
          </div>
        )}
      </section>

      <AlertDialog open={confirmar !== null} onOpenChange={o => { if (!o) setConfirmar(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{accion ? 'Activar el programa' : 'Apagar el programa'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {accion ? (
                  <>
                    <p>Al prenderlo pasan dos cosas, en el momento:</p>
                    <ul className="list-disc space-y-1 pl-5">
                      <li><span className="text-foreground">Todos los clientes con historial reciben su categoría inicial</span> según sus visitas de las últimas {settings.window_weeks} semanas. Quien ya venía con frecuencia de Platinum entra como Platinum.</li>
                      <li><span className="text-foreground">Los puntos empiezan a contar desde hoy.</span> Las visitas anteriores definen la categoría pero no acreditan puntos retroactivos.</li>
                    </ul>
                    {dist && (
                      <p className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 text-xs">
                        Con la configuración actual quedarían así: {tiers.map(t => `${t.name} ${numero(cantidadDe(t.code))}`).join(' · ')}.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p>Se dejan de acreditar puntos y de mover categorías. Nada se borra: saldos, lotes y categorías quedan guardados y vuelven al prenderlo.</p>
                    <p>En la app los clientes van a ver sus puntos sin categoría.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmar(null); aplicar(accion) }}>
              {accion ? 'Activar ahora' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Categorías ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Categorías</h3>
          <p className="text-xs text-muted-foreground">
            {usarPreview
              ? <><Info className="mr-1 inline size-3.5" />Distribución <span className="text-foreground">si prendés hoy</span>, sobre {numero(total)} clientes con visitas</>
              : <>{numero(total)} clientes con categoría</>}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiers.map(t => {
            const n = cantidadDe(t.code)
            const pct = total > 0 ? Math.round((n / total) * 100) : 0
            const enGracia = overview.tiers.find(o => o.code === t.code)?.in_grace ?? 0
            return (
              <div key={t.code} className="space-y-2.5">
                <MonacoCardPreview tier={t} points={PUNTOS_EJEMPLO[t.code] ?? 0} clientName="Cliente Monaco" memberSince={String(new Date().getFullYear())} compact />
                <div className="px-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold tabular-nums tracking-tight">{numero(n)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{pct} %</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundImage: `linear-gradient(90deg, ${t.color_primary}, ${t.color_secondary})` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {t.min_visits}{t.max_visits === null ? '+' : `–${t.max_visits}`} visitas · ×{(t.multiplier_pct / 100).toFixed(2)}
                    {enGracia > 0 && <span className="text-amber-400"> · {enGracia} en gracia</span>}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── KPIs ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Últimos 30 días</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {kpis.map(k => (
            <div
              key={k.label}
              className={cn(
                'rounded-xl border px-3 py-3',
                k.tono === 'bad' ? 'border-red-500/30 bg-red-500/10' : k.tono === 'warn' ? 'border-amber-500/25 bg-amber-500/[0.06]' : 'border-white/[0.06] bg-zinc-900/40',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <k.icon className={cn('size-3.5 shrink-0', k.tono === 'bad' ? 'text-red-400' : k.tono === 'warn' ? 'text-amber-400' : k.tono === 'ok' ? 'text-emerald-400' : 'text-muted-foreground')} />
              </div>
              <p className={cn('mt-1.5 text-xl font-bold tabular-nums tracking-tight', k.tono === 'bad' && 'text-red-400')}>{numero(k.value)}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Saldo vivo en toda la base: <span className="text-foreground tabular-nums">{numero(overview.points.live_balance)} pts</span> en {numero(overview.points.clients_with_points)} clientes · {numero(overview.rewards.available)} beneficios sin usar · {numero(overview.referrals.pending)} referidos pendientes
        </p>
      </section>

      {/* ── Timeline + mantenimiento ────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40">
          <header className="flex items-center justify-between border-b border-white/[0.05] px-4 py-3">
            <h3 className="text-sm font-semibold">Últimos movimientos</h3>
            <span className="text-[11px] text-muted-foreground">{overview.events.length} eventos</span>
          </header>
          {overview.events.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Sparkles className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Todavía no pasó nada. {activo ? 'El primer corte cobrado va a aparecer acá.' : 'Prendé el programa para empezar.'}</p>
            </div>
          ) : (
            <ol className="divide-y divide-white/[0.04]">
              {overview.events.map(e => {
                const h = describirEvento(e, nombresTier)
                return (
                  <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      h.tono === 'ok' ? 'bg-emerald-400' : h.tono === 'warn' ? 'bg-amber-400' : h.tono === 'bad' ? 'bg-red-500' : h.tono === 'info' ? 'bg-sky-400' : 'bg-zinc-500',
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', h.tono === 'bad' && 'text-red-300')}>{h.titulo}</p>
                      {h.detalle && <p className="truncate text-xs text-muted-foreground">{h.detalle}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtRelativo(e.created_at)}</span>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <aside className="space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Mantenimiento diario</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Corre solo todos los días a las {horaMantenimientoLocal(timezone)}: vence lotes, avisa los que están por vencer, revisa gracias y bajadas, y vence beneficios sin usar. Si necesitás verlo ahora, corrélo a mano.
          </p>
          <Button variant="outline" size="sm" className="w-full" disabled={!canManage || mantPending} onClick={correrMantenimiento}>
            {mantPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Correr mantenimiento ahora
          </Button>
          {mant && (
            <ul className="space-y-1 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-xs">
              <li><span className="tabular-nums text-foreground">{numero(mant.lots_expired)}</span> lotes vencidos</li>
              <li><span className="tabular-nums text-foreground">{numero(mant.expiring_notified)}</span> avisos de vencimiento</li>
              <li><span className="tabular-nums text-foreground">{numero(mant.tier_changes)}</span> cambios de categoría o gracia</li>
              <li><span className="tabular-nums text-foreground">{numero(mant.grace_reminders)}</span> recordatorios de gracia</li>
              <li><span className="tabular-nums text-foreground">{numero(mant.rewards_expired)}</span> beneficios vencidos</li>
            </ul>
          )}
          {overview.errors_7d > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Hubo {overview.errors_7d} errores del programa esta semana. Ningún cobro se bloqueó, pero conviene mirarlos en la lista de movimientos.
            </p>
          )}
          <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <Coins className="mt-0.5 size-3 shrink-0" />
            Los puntos y categorías se recalculan solos con cada cobro; este botón no acredita nada extra.
          </p>
        </aside>
      </section>
    </div>
  )
}
