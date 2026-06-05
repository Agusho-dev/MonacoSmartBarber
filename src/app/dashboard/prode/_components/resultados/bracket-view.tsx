'use client'

import { useMemo, useState, useTransition } from 'react'
import { Loader2, Pencil, Trophy, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProdeMatch, ProdeTeam } from '../../_lib/types'
import { buildBracket } from '../../_lib/bracket'
import { STAGE_SHORT, fmtDayMonth, fmtTime } from '../../_lib/fmt'
import { TeamFlag } from '../shared'
import { setMatchTeams, setResult } from '@/lib/actions/prode'
import styles from './bracket.module.css'

export function BracketView({
  matches,
  teams,
}: {
  matches: ProdeMatch[]
  teams: ProdeTeam[]
}) {
  const teamsMap = useMemo(() => {
    const m = new Map<string, ProdeTeam>()
    for (const t of teams) m.set(t.id, t)
    return m
  }, [teams])

  const bracket = useMemo(() => buildBracket(matches), [matches])
  const [editing, setEditing] = useState<ProdeMatch | null>(null)

  if (bracket.rounds.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Todavía no hay partidos de eliminación cargados.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Las llaves se completan solas con el sync a medida que avanza el Mundial. Tocá un cruce para
        asignar equipos o cargar el resultado a mano.
      </p>

      <div className="overflow-x-auto rounded-xl border bg-card/40 p-2">
        <div className={styles.bracket}>
          {bracket.rounds.map((round, ri) => (
            <div key={round.stage} className={styles.round}>
              <div className={styles.roundHeader}>{STAGE_SHORT[round.stage] ?? round.stage}</div>
              <div className={styles.cells}>
                {round.matches.map((m, mi) => (
                  <div
                    key={m.id}
                    className={cn(styles.cell, ri < bracket.rounds.length - 1 && styles.notLast)}
                  >
                    <div
                      className={cn(styles.card, ri > 0 && styles.notFirst)}
                      data-pair={mi % 2}
                    >
                      <BracketCard
                        match={m}
                        teamsMap={teamsMap}
                        isFinal={round.stage === 'final'}
                        onEdit={() => setEditing(m)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {bracket.thirdPlace && (
        <div className="max-w-[260px]">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tercer puesto
          </div>
          <BracketCard
            match={bracket.thirdPlace}
            teamsMap={teamsMap}
            isFinal={false}
            onEdit={() => setEditing(bracket.thirdPlace)}
          />
        </div>
      )}

      <BracketEditDialog
        match={editing}
        teams={teams}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

function BracketCard({
  match,
  teamsMap,
  isFinal,
  onEdit,
}: {
  match: ProdeMatch
  teamsMap: Map<string, ProdeTeam>
  isFinal: boolean
  onEdit: () => void
}) {
  const home = match.home_team_id ? teamsMap.get(match.home_team_id) : null
  const away = match.away_team_id ? teamsMap.get(match.away_team_id) : null
  const finished = match.status === 'finished'
  const live = match.status === 'live'
  const hs = match.home_score
  const as = match.away_score
  const homeWon = finished && hs != null && as != null && hs > as
  const awayWon = finished && hs != null && as != null && as > hs

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card text-xs shadow-sm transition-colors',
        isFinal && 'border-amber-500/50 bg-amber-500/[0.04]',
        live && 'border-emerald-500/60'
      )}
    >
      <div className="flex items-center justify-between border-b px-2 py-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          {isFinal && <Trophy className="size-3 text-amber-500" />}
          {live ? (
            <span className="flex items-center gap-1 font-semibold text-emerald-500">
              <Radio className="size-2.5 animate-pulse" /> En vivo
            </span>
          ) : (
            `${fmtDayMonth(match.kickoff_at)} · ${fmtTime(match.kickoff_at)}`
          )}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label="Editar cruce"
        >
          <Pencil className="size-3" />
        </button>
      </div>
      <BracketTeamRow team={home} label={match.home_team_label} score={hs} won={homeWon} dimmed={finished && !homeWon} />
      <div className="border-t" />
      <BracketTeamRow team={away} label={match.away_team_label} score={as} won={awayWon} dimmed={finished && !awayWon} />
    </div>
  )
}

function BracketTeamRow({
  team,
  label,
  score,
  won,
  dimmed,
}: {
  team?: ProdeTeam | null
  label: string | null
  score: number | null
  won: boolean
  dimmed: boolean
}) {
  const name = team?.short_name || team?.name || label || 'Por definir'
  const placeholder = !team && !label
  return (
    <div className={cn('flex items-center gap-1.5 px-2 py-1.5', dimmed && 'opacity-55')}>
      <TeamFlag url={team?.flag_url} code={team?.code} size={18} />
      <span className={cn('flex-1 truncate', won && 'font-bold', placeholder && 'italic text-muted-foreground')}>
        {name}
      </span>
      <span className={cn('w-4 text-right tabular-nums', won ? 'font-bold' : 'text-muted-foreground')}>
        {score ?? ''}
      </span>
    </div>
  )
}

function BracketEditDialog({
  match,
  teams,
  onClose,
}: {
  match: ProdeMatch | null
  teams: ProdeTeam[]
  onClose: () => void
}) {
  return (
    <Dialog open={!!match} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md overflow-y-auto">
        {match && <BracketEditForm key={match.id} match={match} teams={teams} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

const NONE = '__none__'

function BracketEditForm({
  match,
  teams,
  onClose,
}: {
  match: ProdeMatch
  teams: ProdeTeam[]
  onClose: () => void
}) {
  const [homeId, setHomeId] = useState<string>(match.home_team_id ?? NONE)
  const [awayId, setAwayId] = useState<string>(match.away_team_id ?? NONE)
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? '')
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? '')
  const [savingTeams, startTeams] = useTransition()
  const [savingScore, startScore] = useTransition()

  const onSaveTeams = () => {
    startTeams(async () => {
      const r = await setMatchTeams({
        matchId: match.id,
        homeTeamId: homeId === NONE ? null : homeId,
        awayTeamId: awayId === NONE ? null : awayId,
      })
      if ('error' in r) toast.error(r.error)
      else toast.success('Equipos asignados')
    })
  }

  const onSaveScore = () => {
    const h = Number(home)
    const a = Number(away)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      toast.error('Ingresá un resultado válido')
      return
    }
    startScore(async () => {
      const r = await setResult({ matchId: match.id, home: h, away: a })
      if ('error' in r) toast.error(r.error)
      else {
        toast.success(`Resultado guardado. ${r.scored} jugada(s) puntuada(s).`)
        onClose()
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar cruce</DialogTitle>
        <DialogDescription>
          {STAGE_SHORT[match.stage ?? ''] ?? match.stage} · {fmtDayMonth(match.kickoff_at)}{' '}
          {fmtTime(match.kickoff_at)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-3">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Equipos</Label>
          <TeamSelect value={homeId} onChange={setHomeId} teams={teams} placeholder="Local" />
          <TeamSelect value={awayId} onChange={setAwayId} teams={teams} placeholder="Visitante" />
          <Button variant="outline" size="sm" className="w-full" onClick={onSaveTeams} disabled={savingTeams}>
            {savingTeams ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Guardar equipos
          </Button>
        </div>

        <div className="space-y-3 border-t pt-4">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Resultado final</Label>
          <div className="flex items-center justify-center gap-3">
            <Input
              type="number"
              min={0}
              max={30}
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="w-16 text-center"
              aria-label="Goles local"
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="number"
              min={0}
              max={30}
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="w-16 text-center"
              aria-label="Goles visitante"
            />
          </div>
          <Button className="w-full" onClick={onSaveScore} disabled={savingScore}>
            {savingScore ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Guardar resultado y puntuar
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Guardar el resultado marca el partido como finalizado y reparte los puntos de las jugadas.
          </p>
        </div>
      </div>
    </>
  )
}

function TeamSelect({
  value,
  onChange,
  teams,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  teams: ProdeTeam[]
  placeholder: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">Sin asignar</span>
        </SelectItem>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            <span className="flex items-center gap-2">
              <TeamFlag url={t.flag_url} code={t.code} size={16} />
              {t.name}
              {t.group_label ? <span className="text-muted-foreground">· {t.group_label}</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
