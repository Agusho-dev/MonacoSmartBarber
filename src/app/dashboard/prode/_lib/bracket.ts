import type { ProdeMatch } from './types'

// Construcción PURA del árbol de eliminación a partir de los partidos.
// Los partidos de knockout se llenan vía sync (football-data.org) a medida que
// avanza el torneo; hasta entonces son cascarones con fecha. Acá los ordenamos
// por etapa + kickoff para dibujar el bracket.

export const KNOCKOUT_ORDER = [
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
] as const

export interface BracketRound {
  stage: string
  matches: ProdeMatch[] // ordenados por kickoff
}

export interface Bracket {
  rounds: BracketRound[] // solo etapas con al menos 1 partido, en orden
  thirdPlace: ProdeMatch | null
}

export function buildBracket(matches: ProdeMatch[]): Bracket {
  const byStage = new Map<string, ProdeMatch[]>()
  for (const m of matches) {
    if (!m.stage || m.stage === 'group') continue
    if (!byStage.has(m.stage)) byStage.set(m.stage, [])
    byStage.get(m.stage)!.push(m)
  }
  for (const arr of byStage.values()) {
    arr.sort((a, b) => +new Date(a.kickoff_at) - +new Date(b.kickoff_at))
  }

  const rounds: BracketRound[] = []
  for (const stage of KNOCKOUT_ORDER) {
    const ms = byStage.get(stage)
    if (ms && ms.length > 0) rounds.push({ stage, matches: ms })
  }

  const thirdArr = byStage.get('third_place')
  const thirdPlace = thirdArr && thirdArr.length > 0 ? thirdArr[0] : null

  return { rounds, thirdPlace }
}

/** ¿Hay al menos un partido de knockout con equipos asignados? */
export function bracketHasTeams(bracket: Bracket): boolean {
  return bracket.rounds.some((r) =>
    r.matches.some((m) => m.home_team_id != null || m.away_team_id != null)
  )
}
