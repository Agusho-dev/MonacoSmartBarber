// Config de Desafíos del Prode (espeja monaco-barber-studio/src/lib/prode/challenges.ts).
// Cada Desafío premia al 1º de SU tabla. La premiación es MANUAL desde el panel
// (igual que el premio semanal) — sin crons nuevos (Vercel Hobby).

export type ChallengeRewardTier = 'month' | 'jersey' | 'roulette'

export interface ProdeChallengeDef {
  key: string
  stage: string
  matchday: number | null
  title: string
  subtitle: string
  rewardTier: ChallengeRewardTier
  rewardLabel: string
  /** false = "Ruleta (a definir)": no se premia automáticamente desde acá todavía. */
  awardable: boolean
}

export const PRODE_CHALLENGES: ProdeChallengeDef[] = [
  { key: 'group-1', stage: 'group', matchday: 1, title: 'Desafío 1', subtitle: 'Fecha 1 · Grupos', rewardTier: 'month', rewardLabel: '1 mes de cortes', awardable: true },
  { key: 'group-2', stage: 'group', matchday: 2, title: 'Desafío 2', subtitle: 'Fecha 2 · Grupos', rewardTier: 'month', rewardLabel: '1 mes de cortes', awardable: true },
  { key: 'group-3', stage: 'group', matchday: 3, title: 'Desafío 3', subtitle: 'Fecha 3 · Grupos', rewardTier: 'month', rewardLabel: '1 mes de cortes', awardable: true },
  { key: 'round_of_32', stage: 'round_of_32', matchday: null, title: '16vos de final', subtitle: 'Eliminatorias', rewardTier: 'jersey', rewardLabel: '1 mes + camiseta', awardable: true },
  { key: 'round_of_16', stage: 'round_of_16', matchday: null, title: '8vos de final', subtitle: 'Eliminatorias', rewardTier: 'jersey', rewardLabel: '1 mes + camiseta', awardable: true },
  { key: 'quarter_final', stage: 'quarter_final', matchday: null, title: 'Cuartos de final', subtitle: 'Eliminatorias', rewardTier: 'roulette', rewardLabel: 'Ruleta (a definir)', awardable: false },
  { key: 'semi_final', stage: 'semi_final', matchday: null, title: 'Semifinales', subtitle: 'Eliminatorias', rewardTier: 'roulette', rewardLabel: 'Ruleta (a definir)', awardable: false },
  { key: 'third_place', stage: 'third_place', matchday: null, title: 'Tercer puesto', subtitle: 'Eliminatorias', rewardTier: 'roulette', rewardLabel: 'Ruleta (a definir)', awardable: false },
  { key: 'final', stage: 'final', matchday: null, title: 'La Final', subtitle: 'Eliminatorias', rewardTier: 'roulette', rewardLabel: 'Ruleta (a definir)', awardable: false },
]

export const AWARDABLE_CHALLENGES = PRODE_CHALLENGES.filter((c) => c.awardable)
