'use client'

import { useEffect, useState } from 'react'
import { Activity, CalendarClock, Gamepad2, Trophy, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProdeStats, TournamentLite } from '../_lib/types'
import { TOURNAMENT_STATUS_LABELS } from '../_lib/fmt'

export function ProdeHero({
  tournament,
  stats,
}: {
  tournament: TournamentLite
  stats: ProdeStats
}) {
  const status = tournament.status
  const pct =
    stats.matchesTotal > 0 ? Math.round((stats.matchesPlayed / stats.matchesTotal) * 100) : 0

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-emerald-950/20 p-5 sm:p-6">
      {/* Halo decorativo */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-24 size-48 rounded-full bg-amber-500/5 blur-3xl" />

      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-amber-950 shadow-lg shadow-amber-900/30">
              <Trophy className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{tournament.name}</h1>
              <p className="text-sm text-muted-foreground">Prode Mundial · Temporada {tournament.season}</p>
            </div>
          </div>
          <StatusPill status={status} />
        </div>

        {status === 'upcoming' ? (
          <Countdown target={tournament.starts_at} />
        ) : status === 'active' ? (
          <Progress pct={pct} played={stats.matchesPlayed} total={stats.matchesTotal} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Trophy className="size-4 text-amber-500" /> Torneo finalizado — ¡gracias por jugar!
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={Users} label="Participantes" value={stats.participants} />
          <Stat icon={Gamepad2} label="Jugadas" value={stats.plays} />
          <Stat
            icon={Activity}
            label="Partidos jugados"
            value={`${stats.matchesPlayed}/${stats.matchesTotal}`}
          />
          <Stat icon={CalendarClock} label="Avance" value={`${pct}%`} />
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide',
        status === 'active' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
        status === 'upcoming' && 'border-amber-500/40 bg-amber-500/10 text-amber-400',
        status === 'finished' && 'border-border bg-muted text-muted-foreground'
      )}
    >
      {status === 'active' && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
      )}
      {TOURNAMENT_STATUS_LABELS[status] ?? status}
    </span>
  )
}

function Countdown({ target }: { target: string }) {
  const [remaining, setRemaining] = useState<number>(() => +new Date(target) - Date.now())

  useEffect(() => {
    const id = setInterval(() => setRemaining(+new Date(target) - Date.now()), 1000)
    return () => clearInterval(id)
  }, [target])

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
        ¡El Mundial ya arrancó!
      </div>
    )
  }

  const days = Math.floor(remaining / 86400000)
  const hours = Math.floor((remaining % 86400000) / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  const secs = Math.floor((remaining % 60000) / 1000)

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Arranca en</p>
      <div className="flex gap-2">
        <TimeBox value={days} label="días" />
        <TimeBox value={hours} label="horas" />
        <TimeBox value={mins} label="min" />
        <TimeBox value={secs} label="seg" />
      </div>
    </div>
  )
}

function TimeBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-[58px] flex-col items-center rounded-lg border bg-background/40 px-3 py-2">
      <span className="text-2xl font-bold tabular-nums leading-none">
        {value.toString().padStart(2, '0')}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}

function Progress({ pct, played, total }: { pct: number; played: number; total: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Progreso del torneo</span>
        <span className="font-medium text-foreground">
          {played} de {total} partidos
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-xl border bg-background/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
