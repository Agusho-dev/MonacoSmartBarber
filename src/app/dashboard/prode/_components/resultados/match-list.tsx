'use client'

import { useMemo, useState, useTransition } from 'react'
import { CalendarDays, Loader2, Radio, Search, Star } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProdeMatch, ProdeTeam } from '../../_lib/types'
import {
  MATCH_STATUS_LABELS,
  STAGE_LABELS,
  STAGE_SHORT,
  dayKey,
  fmtDayLabel,
  fmtTime,
} from '../../_lib/fmt'
import { TeamFlag } from '../shared'
import { setFeatured, setResult } from '@/lib/actions/prode'

const STAGE_OPTIONS = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]

export function MatchList({
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

  const [stage, setStage] = useState<string>('all')
  const [group, setGroup] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [query, setQuery] = useState('')

  const groupLabels = useMemo(() => {
    const s = new Set<string>()
    for (const m of matches) if (m.group_label) s.add(m.group_label)
    return Array.from(s).sort()
  }, [matches])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return matches.filter((m) => {
      if (stage !== 'all' && m.stage !== stage) return false
      if (group !== 'all' && m.group_label !== group) return false
      if (status === 'pending' && m.status === 'finished') return false
      if (status === 'finished' && m.status !== 'finished') return false
      if (q) {
        const home = teamsMap.get(m.home_team_id ?? '')?.name ?? m.home_team_label ?? ''
        const away = teamsMap.get(m.away_team_id ?? '')?.name ?? m.away_team_label ?? ''
        if (!`${home} ${away}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [matches, stage, group, status, query, teamsMap])

  // Agrupar por día
  const days = useMemo(() => {
    const map = new Map<string, ProdeMatch[]>()
    for (const m of filtered) {
      const k = dayKey(m.kickoff_at)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(m)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar selección…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las etapas</SelectItem>
            {STAGE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {groupLabels.length > 0 && (
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los grupos</SelectItem>
              {groupLabels.map((g) => (
                <SelectItem key={g} value={g}>
                  Grupo {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
            <SelectItem value="finished">Finalizados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {days.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay partidos con estos filtros.
        </p>
      ) : (
        <div className="space-y-5">
          {days.map(([day, dayMatches]) => (
            <div key={day}>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium capitalize text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {fmtDayLabel(day)}
                <span className="text-muted-foreground/60">· {dayMatches.length}</span>
              </div>
              <div className="space-y-2">
                {dayMatches.map((m) => (
                  <MatchRow key={m.id} match={m} teamsMap={teamsMap} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MatchRow({
  match,
  teamsMap,
}: {
  match: ProdeMatch
  teamsMap: Map<string, ProdeTeam>
}) {
  const home = match.home_team_id ? teamsMap.get(match.home_team_id) : null
  const away = match.away_team_id ? teamsMap.get(match.away_team_id) : null

  const [homeScore, setHomeScore] = useState<string>(match.home_score?.toString() ?? '')
  const [awayScore, setAwayScore] = useState<string>(match.away_score?.toString() ?? '')
  const [featured, setFeaturedState] = useState(match.is_featured)
  const [isPending, startTransition] = useTransition()
  const [isFeaturePending, startFeatureTransition] = useTransition()

  const finished = match.status === 'finished'
  const live = match.status === 'live'

  const onSave = () => {
    const h = Number(homeScore)
    const a = Number(awayScore)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      toast.error('Ingresá resultados válidos (números enteros)')
      return
    }
    startTransition(async () => {
      const r = await setResult({ matchId: match.id, home: h, away: a })
      if ('error' in r) toast.error(r.error)
      else toast.success(`Resultado guardado. ${r.scored} jugada(s) puntuada(s).`)
    })
  }

  const onToggleFeatured = () => {
    const next = !featured
    setFeaturedState(next)
    startFeatureTransition(async () => {
      const r = await setFeatured({ matchId: match.id, featured: next })
      if ('error' in r) {
        setFeaturedState(!next)
        toast.error(r.error)
      } else {
        toast.success(next ? 'Marcado como partido del día' : 'Quitado de partido del día')
      }
    })
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-3 transition-colors sm:flex-row sm:items-center',
        featured && 'border-amber-500/40 bg-amber-500/[0.03]',
        live && 'border-emerald-500/50'
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onToggleFeatured}
          disabled={isFeaturePending}
          aria-label="Partido del día"
          title="Marcar como partido del día (puntos x2)"
          className="shrink-0"
        >
          <Star className={cn('size-5', featured ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{fmtTime(match.kickoff_at)}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground/70">
              {STAGE_SHORT[match.stage ?? ''] ?? match.stage}
              {match.group_label ? ` ${match.group_label}` : ''}
            </span>
            {live ? (
              <Badge className="gap-1 bg-emerald-600 text-[10px] hover:bg-emerald-600">
                <Radio className="size-2.5 animate-pulse" /> En vivo
              </Badge>
            ) : finished ? (
              <Badge variant="secondary" className="text-[10px]">
                {MATCH_STATUS_LABELS.finished}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="flex min-w-0 items-center justify-end gap-2 text-right">
              <span className={cn('truncate font-medium', finished && (match.home_score ?? 0) > (match.away_score ?? 0) && 'font-bold')}>
                {home?.short_name ?? home?.name ?? match.home_team_label ?? 'Por definir'}
              </span>
              <TeamFlag url={home?.flag_url} code={home?.code} size={22} />
            </span>
            <span className="text-xs text-muted-foreground">vs</span>
            <span className="flex min-w-0 items-center gap-2">
              <TeamFlag url={away?.flag_url} code={away?.code} size={22} />
              <span className={cn('truncate font-medium', finished && (match.away_score ?? 0) > (match.home_score ?? 0) && 'font-bold')}>
                {away?.short_name ?? away?.name ?? match.away_team_label ?? 'Por definir'}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:pl-2">
        <Input
          type="number"
          min={0}
          max={30}
          value={homeScore}
          onChange={(e) => setHomeScore(e.target.value)}
          className="w-14 text-center"
          aria-label="Goles local"
        />
        <span className="text-muted-foreground">-</span>
        <Input
          type="number"
          min={0}
          max={30}
          value={awayScore}
          onChange={(e) => setAwayScore(e.target.value)}
          className="w-14 text-center"
          aria-label="Goles visitante"
        />
        <Button onClick={onSave} disabled={isPending} size="sm" className="min-w-[84px]">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : finished ? 'Actualizar' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}
