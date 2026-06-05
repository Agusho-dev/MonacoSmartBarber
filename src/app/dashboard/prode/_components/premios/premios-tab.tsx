'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { CheckCircle2, Crown, Gift, Loader2, ShieldAlert, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { ProdeWeeklyPrize, RewardLite, TournamentLite } from '../../_lib/types'
import { fmtDateShort } from '../../_lib/fmt'
import {
  awardGrandPrize,
  awardWeek,
  getWeeklyLeaderboard,
  type WeeklyLeaderboardRow,
} from '@/lib/actions/prode'
import { PrizeSlotCard, type PrizeSlot } from './prize-slot-card'

// Semanas Lun–Dom (ARG) desde starts_at hasta min(ends_at, hoy).
interface WeekWindow {
  start: string
  end: string
  label: string
}

function computeWeekWindows(startsAt: string, endsAt: string): WeekWindow[] {
  const TZ = 'America/Argentina/Buenos_Aires'
  const toArgDate = (iso: string | Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      typeof iso === 'string' ? new Date(iso) : iso
    )
  const midnight = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

  const todayArg = midnight(toArgDate(new Date()))
  const endArg = midnight(toArgDate(endsAt))
  const cap = endArg < todayArg ? endArg : todayArg

  const monday = midnight(toArgDate(startsAt))
  const dow = monday.getUTCDay()
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  monday.setUTCDate(monday.getUTCDate() + diffToMonday)

  const windows: WeekWindow[] = []
  const cursor = new Date(monday)
  let guard = 0
  while (cursor <= cap && guard < 60) {
    const wStart = new Date(cursor)
    const wEnd = new Date(cursor)
    wEnd.setUTCDate(wEnd.getUTCDate() + 6)
    const startStr = wStart.toISOString().slice(0, 10)
    const endStr = wEnd.toISOString().slice(0, 10)
    windows.push({ start: startStr, end: endStr, label: `${fmtDateShort(startStr)} – ${fmtDateShort(endStr)}` })
    cursor.setUTCDate(cursor.getUTCDate() + 7)
    guard++
  }
  return windows
}

const SLOTS: { slot: PrizeSlot; title: string; legacyName: string; settingsKey: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  {
    slot: 'welcome',
    title: 'Bienvenida',
    legacyName: 'Cupón Mundial: Bienvenida',
    settingsKey: 'welcome_reward_id',
    icon: Sparkles,
    hint: 'Se entrega al sumarse al Prode.',
  },
  {
    slot: 'weekly',
    title: 'Premio semanal',
    legacyName: 'Mundial: Servicio Gratis (Semanal)',
    settingsKey: 'weekly_reward_id',
    icon: Gift,
    hint: 'Para el 1° de cada semana.',
  },
  {
    slot: 'grand',
    title: 'Gran Premio',
    legacyName: 'Mundial: Gran Premio',
    settingsKey: 'grand_reward_id',
    icon: Crown,
    hint: 'Para el campeón del torneo.',
  },
]

export function PremiosTab({
  tournament,
  weeklyPrizes,
  rewards,
}: {
  tournament: TournamentLite
  weeklyPrizes: ProdeWeeklyPrize[]
  rewards: RewardLite[]
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Gift className="size-4 text-muted-foreground" /> Recompensas del Prode
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          {SLOTS.map((s) => {
            const mappedId = tournament.settings[s.settingsKey] as string | undefined
            const reward =
              (mappedId && rewards.find((r) => r.id === mappedId)) ||
              rewards.find((r) => r.name === s.legacyName) ||
              null
            return (
              <PrizeSlotCard
                key={s.slot}
                slot={s.slot}
                title={s.title}
                hint={s.hint}
                icon={s.icon}
                reward={reward}
                rewards={rewards}
              />
            )
          })}
        </div>
      </div>

      <WeeklyPrizeSection tournament={tournament} weeklyPrizes={weeklyPrizes} />

      <GrandPrizeCard />
    </div>
  )
}

function WeeklyPrizeSection({
  tournament,
  weeklyPrizes,
}: {
  tournament: TournamentLite
  weeklyPrizes: ProdeWeeklyPrize[]
}) {
  const weeks = useMemo(
    () => computeWeekWindows(tournament.starts_at, tournament.ends_at),
    [tournament.starts_at, tournament.ends_at]
  )

  const awardedByWeek = useMemo(() => {
    const map = new Map<string, ProdeWeeklyPrize>()
    for (const p of weeklyPrizes) map.set(`${p.week_start}|${p.week_end}`, p)
    return map
  }, [weeklyPrizes])

  const [selectedWeek, setSelectedWeek] = useState<string>(
    weeks.length > 0 ? weeks[weeks.length - 1].start : ''
  )
  const selected = weeks.find((w) => w.start === selectedWeek) ?? null

  const [leaderboard, setLeaderboard] = useState<WeeklyLeaderboardRow[]>([])
  const [isLoadingLb, startLoadLb] = useTransition()
  const [isAwarding, startAward] = useTransition()

  const loadLeaderboard = useCallback((w: WeekWindow) => {
    startLoadLb(async () => {
      const r = await getWeeklyLeaderboard({ weekStart: w.start, weekEnd: w.end })
      if ('error' in r) {
        toast.error(r.error)
        setLeaderboard([])
      } else setLeaderboard(r.rows)
    })
  }, [])

  useEffect(() => {
    if (selected) loadLeaderboard(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek])

  const selectedAwarded = selected ? awardedByWeek.get(`${selected.start}|${selected.end}`) : undefined

  const onAwardWeek = () => {
    if (!selected) return
    startAward(async () => {
      const r = await awardWeek({ weekStart: selected.start, weekEnd: selected.end })
      if ('error' in r) toast.error(r.error)
      else if (r.already) toast.info('Esta semana ya fue premiada')
      else if (r.winner)
        toast.success(`Ganador de la semana: ${r.winner.display_name} (${r.winner.points} pts)`)
      else toast.info('No hubo ganador para esta semana (sin jugadas)')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="size-5" /> Premio semanal
        </CardTitle>
        <CardDescription>Elegí una semana (Lun–Dom), revisá el top 10 y premiá al 1°.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {weeks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            El torneo todavía no empezó. No hay semanas para premiar.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Seleccionar semana" />
                </SelectTrigger>
                <SelectContent>
                  {weeks.map((w) => {
                    const awarded = awardedByWeek.has(`${w.start}|${w.end}`)
                    return (
                      <SelectItem key={w.start} value={w.start}>
                        {w.label} {awarded ? '✓' : ''}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <Button onClick={onAwardWeek} disabled={isAwarding || !!selectedAwarded}>
                {isAwarding ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Crown className="mr-2 size-4" />
                )}
                Cerrar semana y premiar al 1°
              </Button>
            </div>

            {selectedAwarded && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">
                <CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />
                Semana premiada el {fmtDateShort(selectedAwarded.awarded_at)} ·{' '}
                {selectedAwarded.winner_points ?? 0} pts
              </div>
            )}

            <div className="rounded-lg border">
              {isLoadingLb ? (
                <div className="p-8 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </div>
              ) : leaderboard.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Sin jugadas puntuadas en esta semana.
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
                        <TableCell className="text-right font-semibold">{row.week_points}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{row.exact_hits}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function GrandPrizeCard() {
  const [isGrandPrize, startGrand] = useTransition()

  const onGrandPrize = () => {
    startGrand(async () => {
      const r = await awardGrandPrize()
      if ('error' in r) toast.error(r.error)
      else if (r.already) toast.info('El Gran Premio ya fue otorgado')
      else if (r.winner)
        toast.success(`¡Campeón del Prode: ${r.winner.display_name}! Torneo finalizado.`)
      else toast.info('No hay ganador disponible')
    })
  }

  return (
    <Card className="border-amber-300/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="size-5 text-amber-500" /> Gran Premio
        </CardTitle>
        <CardDescription>Premia al campeón general del torneo y lo marca como finalizado.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-600" disabled={isGrandPrize}>
              {isGrandPrize ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Crown className="mr-2 size-4" />
              )}
              Premiar al campeón (Gran Premio)
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-500" /> Premiar al campeón
              </AlertDialogTitle>
              <AlertDialogDescription>
                Esto premia al 1° de la tabla general y <strong>marca el torneo como finalizado</strong>. No se
                puede deshacer. ¿Confirmás?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={onGrandPrize}
                className="bg-amber-500 text-white hover:bg-amber-600"
              >
                Sí, premiar al campeón
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
