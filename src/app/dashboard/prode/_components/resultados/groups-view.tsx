'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Medal, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { ProdeMatch, ProdeTeam } from '../../_lib/types'
import {
  computeBestThirds,
  computeGroupStandings,
  type GroupStanding,
} from '../../_lib/standings'
import { fmtTime } from '../../_lib/fmt'
import { TeamFlag } from '../shared'

export function GroupsView({
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

  const groups = useMemo(() => computeGroupStandings(teams, matches), [teams, matches])
  const thirds = useMemo(() => computeBestThirds(groups), [groups])

  const fixturesByGroup = useMemo(() => {
    const map = new Map<string, ProdeMatch[]>()
    for (const m of matches) {
      if (m.stage !== 'group' || !m.group_label) continue
      if (!map.has(m.group_label)) map.set(m.group_label, [])
      map.get(m.group_label)!.push(m)
    }
    for (const arr of map.values())
      arr.sort((a, b) => +new Date(a.kickoff_at) - +new Date(b.kickoff_at))
    return map
  }, [matches])

  if (groups.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Todavía no hay grupos con equipos asignados.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-emerald-500" /> Clasifican a 16avos (1° y 2°)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-amber-500/80" /> Mejores terceros (8 clasifican)
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <GroupCard
            key={g.group}
            group={g}
            fixtures={fixturesByGroup.get(g.group) ?? []}
            teamsMap={teamsMap}
          />
        ))}
      </div>

      <BestThirdsCard thirds={thirds} />
    </div>
  )
}

function GroupCard({
  group,
  fixtures,
  teamsMap,
}: {
  group: GroupStanding
  fixtures: ProdeMatch[]
  teamsMap: Map<string, ProdeTeam>
}) {
  const [open, setOpen] = useState(false)
  const played = fixtures.filter((f) => f.status === 'finished').length

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-6 place-items-center rounded-md bg-foreground text-xs font-bold text-background">
            {group.group}
          </span>
          Grupo {group.group}
        </h4>
        {group.complete ? (
          <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">Completo</Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">{played}/{fixtures.length} jugados</span>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="w-7 py-1.5 pl-3 text-left font-medium">#</th>
            <th className="py-1.5 text-left font-medium">Equipo</th>
            <th className="w-8 py-1.5 text-center font-medium" title="Partidos jugados">PJ</th>
            <th className="w-9 py-1.5 text-center font-medium" title="Diferencia de gol">DG</th>
            <th className="w-9 py-1.5 pr-3 text-center font-medium" title="Puntos">Pts</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => {
            const qualifies = r.rank <= 2
            const isThird = r.rank === 3
            return (
              <tr
                key={r.teamId}
                className={cn(
                  'border-t border-border/60',
                  qualifies && 'bg-emerald-500/[0.07]'
                )}
              >
                <td className="py-2 pl-3">
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded text-[11px] font-bold',
                      qualifies && 'bg-emerald-500 text-white',
                      isThird && 'bg-amber-500/80 text-white',
                      !qualifies && !isThird && 'text-muted-foreground'
                    )}
                  >
                    {r.rank}
                  </span>
                </td>
                <td className="py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamFlag url={r.flagUrl} code={r.shortName} size={20} />
                    <span className="truncate font-medium">{r.shortName}</span>
                  </span>
                </td>
                <td className="py-2 text-center tabular-nums text-muted-foreground">{r.played}</td>
                <td className="py-2 text-center tabular-nums">
                  {r.gd > 0 ? `+${r.gd}` : r.gd}
                </td>
                <td className="py-2 pr-3 text-center font-bold tabular-nums">{r.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1 border-t py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Ocultar partidos' : `Ver ${fixtures.length} partidos`}
      </button>

      {open && (
        <ul className="divide-y border-t bg-muted/20">
          {fixtures.map((m) => {
            const home = m.home_team_id ? teamsMap.get(m.home_team_id) : null
            const away = m.away_team_id ? teamsMap.get(m.away_team_id) : null
            const done = m.status === 'finished'
            return (
              <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="flex flex-1 items-center justify-end gap-1.5 truncate text-right">
                  <span className="truncate">{home?.short_name ?? m.home_team_label ?? '—'}</span>
                  <TeamFlag url={home?.flag_url} code={home?.code} size={16} />
                </span>
                <span
                  className={cn(
                    'min-w-[42px] rounded px-1.5 py-0.5 text-center font-semibold tabular-nums',
                    done ? 'bg-foreground/90 text-background' : 'text-muted-foreground'
                  )}
                >
                  {done ? `${m.home_score}-${m.away_score}` : fmtTime(m.kickoff_at)}
                </span>
                <span className="flex flex-1 items-center gap-1.5 truncate">
                  <TeamFlag url={away?.flag_url} code={away?.code} size={16} />
                  <span className="truncate">{away?.short_name ?? m.away_team_label ?? '—'}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function BestThirdsCard({
  thirds,
}: {
  thirds: ReturnType<typeof computeBestThirds>
}) {
  if (thirds.length === 0) return null
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <Medal className="size-4 text-amber-500" />
        <h4 className="text-sm font-semibold">Mejores terceros</h4>
        <span className="text-[11px] text-muted-foreground">— clasifican los 8 mejores</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="w-10 py-1.5 pl-4 text-left font-medium">#</th>
            <th className="py-1.5 text-left font-medium">Equipo</th>
            <th className="w-12 py-1.5 text-center font-medium">Grupo</th>
            <th className="w-8 py-1.5 text-center font-medium">PJ</th>
            <th className="w-10 py-1.5 text-center font-medium">DG</th>
            <th className="w-10 py-1.5 text-center font-medium">Pts</th>
            <th className="w-24 py-1.5 pr-4 text-right font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {thirds.map((t, i) => (
            <tr key={t.teamId} className={cn('border-t border-border/60', t.qualifies && 'bg-emerald-500/[0.07]')}>
              <td className="py-2 pl-4 font-bold tabular-nums">{i + 1}</td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <TeamFlag url={t.flagUrl} code={t.shortName} size={20} />
                  <span className="font-medium">{t.shortName}</span>
                </span>
              </td>
              <td className="py-2 text-center text-muted-foreground">{t.group}</td>
              <td className="py-2 text-center tabular-nums text-muted-foreground">{t.played}</td>
              <td className="py-2 text-center tabular-nums">{t.gd > 0 ? `+${t.gd}` : t.gd}</td>
              <td className="py-2 text-center font-semibold tabular-nums">{t.points}</td>
              <td className="py-2 pr-4 text-right">
                {t.qualifies ? (
                  <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">Clasifica</Badge>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Afuera</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        <Trophy className="mr-1 inline size-3" />
        El ranking se recalcula solo a medida que cargás los resultados de la fase de grupos.
      </p>
    </div>
  )
}
