'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Banknote, Heart, Check, Scissors, PiggyBank, Wallet, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/format'
import { closeBarberShift, type BarberDaySummary } from '@/lib/actions/shift'
import { logoutBarber } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'
import { vibrate, playSuccessBeep } from '@/lib/barber-feedback'

interface CerrarTurnoClientProps {
  summary: BarberDaySummary
  barberName: string
  branchName: string
  previousClose: {
    cashCounted: number | null
    cashDiff: number | null
    closedAt: string
    notes: string | null
  } | null
}

export function CerrarTurnoClient({
  summary,
  barberName,
  branchName,
  previousClose,
}: CerrarTurnoClientProps) {
  const router = useRouter()
  const [cashCountedStr, setCashCountedStr] = useState<string>(
    previousClose?.cashCounted !== null && previousClose?.cashCounted !== undefined
      ? String(previousClose.cashCounted)
      : ''
  )
  const [notes, setNotes] = useState<string>(previousClose?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [justClosed, setJustClosed] = useState(false)

  const cashCounted = useMemo(() => {
    if (!cashCountedStr.trim()) return null
    const n = Number(cashCountedStr.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : null
  }, [cashCountedStr])

  const cashDiff = cashCounted !== null ? cashCounted - summary.cash_expected : null
  const cashMatches = cashDiff !== null && cashDiff === 0
  const cashShort = cashDiff !== null && cashDiff < 0
  const cashOver = cashDiff !== null && cashDiff > 0

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const fd = new FormData()
      if (cashCountedStr.trim()) fd.set('cash_counted', cashCountedStr.trim())
      if (notes.trim()) fd.set('notes', notes.trim())

      const result = await closeBarberShift(fd)
      if ('error' in result) {
        toast.error(result.error)
        setSubmitting(false)
        return
      }

      vibrate([40, 80, 40, 80, 120])
      playSuccessBeep()
      setJustClosed(true)
      toast.success('Turno cerrado ✓')
    } catch {
      toast.error('Error al cerrar turno')
      setSubmitting(false)
    }
  }

  if (justClosed) {
    return <ClosedCelebration barberName={barberName} cuts={summary.cuts} onLogout={logoutBarber} onKeepWorking={() => router.push('/barbero/fila')} />
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/barbero/fila" aria-label="Volver a la fila">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-black tracking-tight">Cerrar turno</h1>
            <p className="text-xs text-muted-foreground">
              {barberName} · {branchName}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-5 p-4 pb-24">
        {/* ─── HERO: cuánto entregar ─── */}
        <section
          className={cn(
            'rounded-3xl border px-6 py-8 text-center shadow-[0_20px_50px_-20px_oklch(0_0_0/0.25)]',
            'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground',
          )}
        >
          <p className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] opacity-80">
            <PiggyBank className="size-4" />
            Tenés que entregar
          </p>
          <p className="mt-3 text-[clamp(62px,15vw,104px)] font-black leading-none tracking-tighter tabular-nums">
            {formatCurrency(summary.cash_expected)}
          </p>
          <p className="mt-3 text-base font-semibold opacity-85">
            en efectivo
          </p>
          {summary.tips_cash > 0 && (
            <p className="mt-2 text-sm opacity-75">
              Incluye {formatCurrency(summary.tips_cash)} de propinas en efectivo
            </p>
          )}
        </section>

        {/* ─── Detalle del efectivo ─── */}
        <section className="rounded-2xl border bg-card p-5">
          {summary.opening_cash > 0 && (
            <>
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Wallet className="size-6" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Vuelto inicial
                  </p>
                  <p className="text-xl font-black tabular-nums tracking-tight">
                    {formatCurrency(summary.opening_cash)}
                  </p>
                </div>
              </div>
              <div className="my-3 border-t border-dashed" />
            </>
          )}
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Banknote className="size-6" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Cobros en efectivo
              </p>
              <p className="text-xl font-black tabular-nums tracking-tight">
                {formatCurrency(summary.cash_total)}
              </p>
            </div>
          </div>
          {summary.tips_cash > 0 && (
            <>
              <div className="my-3 border-t border-dashed" />
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
                  <Heart className="size-6" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Propinas en efectivo
                  </p>
                  <p className="text-xl font-black tabular-nums tracking-tight">
                    {formatCurrency(summary.tips_cash)}
                  </p>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ─── Números del día (sin total facturado) ─── */}
        <section className="grid grid-cols-2 gap-3">
          <StatTile icon={Scissors} label="Cortes" value={String(summary.cuts)} />
          <StatTile icon={PiggyBank} label="Tu comisión" value={formatCurrency(summary.commission)} />
          <StatTile
            icon={Heart}
            label="Propinas"
            value={formatCurrency(summary.tips)}
            highlight={summary.tips > 0}
            className="col-span-2"
          />
        </section>

        {/* ─── Cash count (opcional) ─── */}
        <section className="rounded-2xl border bg-card p-5">
          <label htmlFor="cash-counted" className="text-sm font-bold">
            ¿Cuánto contaste en efectivo?
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Opcional. Te avisamos si hay diferencia con lo esperado.
          </p>
          <Input
            id="cash-counted"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={cashCountedStr}
            onChange={(e) => setCashCountedStr(e.target.value.replace(/[^0-9]/g, ''))}
            className="mt-3 h-14 text-2xl font-black tabular-nums tracking-tight"
          />
          {cashCounted !== null && (
            <div
              className={cn(
                'mt-3 flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold',
                cashMatches && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                cashShort && 'bg-red-500/10 text-red-700 dark:text-red-400',
                cashOver && 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
              )}
              aria-live="polite"
            >
              <span>
                {cashMatches && '¡Coincide!'}
                {cashShort && `Faltan ${formatCurrency(Math.abs(cashDiff!))}`}
                {cashOver && `Sobra ${formatCurrency(cashDiff!)}`}
              </span>
              {cashMatches && <Check className="size-5" />}
            </div>
          )}
        </section>

        {/* ─── Notas ─── */}
        <section className="rounded-2xl border bg-card p-5">
          <label htmlFor="shift-notes" className="text-sm font-bold">
            Notas al admin <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id="shift-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
            placeholder="Algo que deba saber del día..."
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border bg-transparent p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </section>

        {/* ─── Aviso clock-out ─── */}
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-400">
          <LogOut className="mt-0.5 size-5 shrink-0" />
          <div className="text-sm">
            <p className="font-bold">Al cerrar también marcamos tu salida</p>
            <p className="mt-0.5 text-xs opacity-90">
              Si después querés volver a trabajar, marcá entrada de nuevo en el check-in.
            </p>
          </div>
        </div>

        {/* ─── CTA ─── */}
        <div className="pt-2">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={submitting || summary.cuts === 0}
            className="h-20 w-full text-xl font-black uppercase tracking-wide shadow-xl"
          >
            <Check className="mr-2 size-6" />
            {submitting ? 'Cerrando...' : previousClose ? 'Actualizar cierre' : 'Cerrar turno'}
          </Button>
          {summary.cuts === 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Aún no hay cortes en el día.
            </p>
          )}
          {previousClose && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Ya cerraste hoy a las{' '}
              {new Date(previousClose.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.
              Se actualizarán los números.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  highlight,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  highlight?: boolean
  className?: string
}) {
  return (
    <div className={cn(
      'rounded-2xl border bg-card p-4',
      highlight && 'bg-rose-500/5 border-rose-500/30',
      className,
    )}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('size-3.5', highlight && 'text-rose-500')} />
        {label}
      </div>
      <p className="mt-1 text-2xl font-black tabular-nums tracking-tight">{value}</p>
    </div>
  )
}

function ClosedCelebration({
  barberName,
  cuts,
  onLogout,
  onKeepWorking,
}: {
  barberName: string
  cuts: number
  onLogout: () => void | Promise<void>
  onKeepWorking: () => void
}) {
  const firstName = barberName.split(' ')[0] || barberName
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-gradient-to-b from-background via-background to-primary/5 p-6">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        {Array.from({ length: 20 }).map((_, i) => (
          <span
            key={i}
            className="absolute inline-block size-2 rounded-sm"
            style={{
              left: `${(i * 53) % 100}%`,
              top: `-20px`,
              background: i % 3 === 0 ? 'oklch(0.78 0.12 85)' : i % 3 === 1 ? 'oklch(0.72 0.17 150)' : 'oklch(0.62 0.18 250)',
              animation: `confettiFall 2.5s ease-out ${i * 0.08}s forwards`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md text-center animate-scale-in">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30">
          <Check className="size-10 text-white" />
        </div>
        <h1 className="mt-6 text-4xl font-black tracking-tight">
          ¡Bien hecho, {firstName}!
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Tu turno quedó cerrado.
        </p>

        <div className="mt-8 flex items-center justify-center rounded-3xl border bg-card px-6 py-5">
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cortes</p>
            <p className="mt-0.5 text-4xl font-black tabular-nums">{cuts}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-3">
          <form action={onLogout}>
            <Button size="lg" type="submit" className="h-16 w-full text-lg font-black uppercase tracking-wide">
              Cerrar sesión
            </Button>
          </form>
          <Button size="lg" variant="ghost" onClick={onKeepWorking} className="h-12 w-full text-sm">
            Seguir trabajando
          </Button>
        </div>
      </div>
    </div>
  )
}
