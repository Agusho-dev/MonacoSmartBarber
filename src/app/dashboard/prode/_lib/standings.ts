import type { ProdeMatch, ProdeTeam } from './types'

// Cálculo PURO de posiciones por grupo a partir de los resultados cargados.
// No toca la DB; recibe equipos + partidos y devuelve la tabla ordenada.
// Reglas: 3 pts victoria, 1 empate, 0 derrota. Orden: Pts → DG → GF → nombre.
// (No resuelve head-to-head fino de FIFA; suficiente para el panel del dueño.)

export interface TeamStanding {
  teamId: string
  name: string
  shortName: string
  flagUrl: string | null
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
  rank: number // 1..n dentro del grupo (tras ordenar)
}

export interface GroupStanding {
  group: string
  rows: TeamStanding[]
  complete: boolean // todos los partidos del grupo finalizados
}

export interface ThirdPlaceRow extends TeamStanding {
  group: string
  qualifies: boolean // top-8 de los terceros (formato 48 equipos → 32 a 16avos)
}

function newStanding(t: ProdeTeam): TeamStanding {
  return {
    teamId: t.id,
    name: t.name,
    shortName: t.short_name ?? t.code ?? t.name,
    flagUrl: t.flag_url,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    points: 0,
    rank: 0,
  }
}

function applyResult(s: TeamStanding, gf: number, ga: number) {
  s.played += 1
  s.gf += gf
  s.ga += ga
  if (gf > ga) {
    s.won += 1
    s.points += 3
  } else if (gf === ga) {
    s.drawn += 1
    s.points += 1
  } else {
    s.lost += 1
  }
}

function sortRows(rows: TeamStanding[]): TeamStanding[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.name.localeCompare(b.name)
  )
  sorted.forEach((r, i) => {
    r.gd = r.gf - r.ga
    r.rank = i + 1
  })
  return sorted
}

export function computeGroupStandings(
  teams: ProdeTeam[],
  matches: ProdeMatch[]
): GroupStanding[] {
  // Mapa de standings por equipo (solo equipos con grupo).
  const byTeam = new Map<string, TeamStanding>()
  const groups = new Map<string, Set<string>>()
  for (const t of teams) {
    if (!t.group_label) continue
    byTeam.set(t.id, newStanding(t))
    if (!groups.has(t.group_label)) groups.set(t.group_label, new Set())
    groups.get(t.group_label)!.add(t.id)
  }

  const groupMatches = matches.filter((m) => m.stage === 'group')
  for (const m of groupMatches) {
    if (
      m.status !== 'finished' ||
      m.home_team_id == null ||
      m.away_team_id == null ||
      m.home_score == null ||
      m.away_score == null
    )
      continue
    const h = byTeam.get(m.home_team_id)
    const a = byTeam.get(m.away_team_id)
    if (!h || !a) continue
    applyResult(h, m.home_score, m.away_score)
    applyResult(a, m.away_score, m.home_score)
  }

  for (const s of byTeam.values()) s.gd = s.gf - s.ga

  const result: GroupStanding[] = []
  for (const [group, ids] of groups) {
    const rows = sortRows(Array.from(ids).map((id) => byTeam.get(id)!))
    // Cada equipo juega 3 en fase de grupos (formato Mundial).
    const complete = rows.length > 0 && rows.every((r) => r.played >= 3)
    result.push({ group, rows, complete })
  }
  result.sort((a, b) => a.group.localeCompare(b.group))
  return result
}

/**
 * Ranking cross-grupo de los terceros: en el formato de 48 equipos clasifican
 * los 8 mejores terceros a 16avos. Mismo criterio de orden que el grupo.
 */
export function computeBestThirds(groups: GroupStanding[]): ThirdPlaceRow[] {
  const thirds: ThirdPlaceRow[] = groups
    .map((g) => {
      const r = g.rows.find((x) => x.rank === 3)
      return r ? { ...r, group: g.group, qualifies: false } : null
    })
    .filter((x): x is ThirdPlaceRow => x !== null)

  thirds.sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      a.name.localeCompare(b.name)
  )
  thirds.forEach((t, i) => {
    t.qualifies = i < 8
  })
  return thirds
}
