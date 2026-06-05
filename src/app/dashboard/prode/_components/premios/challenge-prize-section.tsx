'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { CheckCircle2, Crown, Loader2, Swords } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ProdeChallengePrize, RewardLite, TournamentLite } from '../../_lib/types'
import { AWARDABLE_CHALLENGES } from '../../_lib/challenges'
import { fmtDateShort } from '../../_lib/fmt'
import {
  awardChallengePrize,
  getChallengeLeaderboard,
  setChallengeReward,
  type ChallengeLeaderboardRow,
} from '@/lib/actions/prode'

/**
 * Premios por Desafío (D1/D2/D3, 16vos, 8vos): elegís un Desafío, ves su tabla
 * (suma de puntos de SUS partidos), mapeás la recompensa y premiás al 1°.
 * Manual (sin crons), igual que el premio semanal. La premiación se habilita
 * cuando los partidos del Desafío terminaron y hay puntos.
 */
export function ChallengePrizeSection({
  tournament,
  challengePrizes,
  rewards,
}: {
  tournament: TournamentLite
  challengePrizes: ProdeChallengePrize[]
  rewards: RewardLite[]
}) {
  const challenges = AWARDABLE_CHALLENGES
  const [selectedKey, setSelectedKey] = useState<string>(challenges[0]?.key ?? '')
  const selected = challenges.find((c) => c.key === selectedKey) ?? null

  const awardedByKey = useMemo(() => {
    const map = new Map<string, ProdeChallengePrize>()
    for (const p of challengePrizes) map.set(p.challenge_key, p)
    return map
  }, [challengePrizes])

  const mapping = (tournament.settings.challenge_rewards ?? {}) as Record<string, string>
  const [rewardId, setRewardId] = useState<string>(selected ? mapping[selected.key] ?? '' : '')

  const [leaderboard, setLeaderboard] = useState<ChallengeLeaderboardRow[]>([])
  const [isLoadingLb, startLoadLb] = useTransition()
  const [isAwarding, startAward] = useTransition()
  const [isSavingMap, startMap] = useTransition()

  const loadLeaderboard = useCallback((stage: string, matchday: number | null) => {
    startLoadLb(async () => {
      const r = await getChallengeLeaderboard({ stage, matchday })
      if ('error' in r) {
        toast.error(r.error)
        setLeaderboard([])
      } else setLeaderboard(r.rows)
    })
  }, [])

  useEffect(() => {
    if (selected) {
      loadLeaderboard(selected.stage, selected.matchday)
      setRewardId(mapping[selected.key] ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const awarded = selected ? awardedByKey.get(selected.key) : undefined

  const onSaveMapping = () => {
    if (!selected || !rewardId) return toast.error('Elegí una recompensa')
    startMap(async () => {
      const r = await setChallengeReward({ key: selected.key, rewardId })
      if ('error' in r) toast.error(r.error)
      else toast.success('Recompensa del desafío guardada')
    })
  }

  const onAward = () => {
    if (!selected) return
    if (!rewardId) return toast.error('Primero elegí y guardá la recompensa')
    startAward(async () => {
      const r = await awardChallengePrize({
        key: selected.key,
        stage: selected.stage,
        matchday: selected.matchday,
        rewardId,
      })
      if ('error' in r) toast.error(r.error)
      else if (r.already) toast.info('Este desafío ya fue premiado')
      else if (r.winner)
        toast.success(`Ganador de ${selected.title}: ${r.winner.display_name} (${r.winner.points} pts)`)
      else toast.info(r.reason ?? 'Todavía no hay puntos en este desafío')
    })
  }

  const mappedReward = rewardId ? rewards.find((r) => r.id === rewardId) ?? null : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Swords className="size-5" /> Premios por Desafío
        </CardTitle>
        <CardDescription>
          Cada Desafío premia al 1° de su tabla. Elegí el desafío, asigná la recompensa y premiá
          cuando terminen sus partidos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedKey} onValueChange={setSelectedKey}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Seleccionar desafío" />
            </SelectTrigger>
            <SelectContent>
              {challenges.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.title} · {c.subtitle} {awardedByKey.has(c.key) ? '✓' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <Badge variant="outline" className="text-xs">
              Premio: {selected.rewardLabel}
            </Badge>
          )}
        </div>

        {/* Recompensa a entregar */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <div className="flex-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Recompensa para este desafío</p>
            <Select value={rewardId} onValueChange={setRewardId}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Elegir recompensa" />
              </SelectTrigger>
              <SelectContent>
                {rewards.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={onSaveMapping}
            disabled={isSavingMap || !rewardId || (selected ? mapping[selected.key] === rewardId : true)}
          >
            {isSavingMap ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Guardar
          </Button>
        </div>

        {mappedReward && !mappedReward.is_active && (
          <p className="text-xs text-amber-600">⚠ La recompensa elegida está inactiva.</p>
        )}

        {/* Estado premiado */}
        {awarded && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
            <CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />
            Desafío premiado el {fmtDateShort(awarded.awarded_at)} · {awarded.winner_points ?? 0} pts
          </div>
        )}

        {/* Botón premiar */}
        <Button onClick={onAward} disabled={isAwarding || !!awarded || !rewardId}>
          {isAwarding ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Crown className="mr-2 size-4" />
          )}
          Premiar al 1° del desafío
        </Button>

        {/* Tabla del desafío */}
        <div className="rounded-lg border">
          {isLoadingLb ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            </div>
          ) : leaderboard.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin jugadas puntuadas en este desafío todavía.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Participante</TableHead>
                  <TableHead className="text-right">Puntos</TableHead>
                  <TableHead className="text-right">Exactos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((row) => (
                  <TableRow key={row.participant_id}>
                    <TableCell className="font-bold">{row.rank}</TableCell>
                    <TableCell>{row.display_name}</TableCell>
                    <TableCell className="text-right font-semibold">{row.challenge_points}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.exact_hits}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
