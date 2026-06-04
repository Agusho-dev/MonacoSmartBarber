'use client'

import { useState, useTransition, useMemo, useCallback, useRef, useEffect } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Trophy,
  Star,
  CheckCircle2,
  XCircle,
  Loader2,
  Users,
  Gift,
  MessageCircle,
  QrCode,
  Camera,
  KeySquare,
  RotateCcw,
  Trash2,
  Crown,
  Calendar,
  ShieldAlert,
} from 'lucide-react'
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
import type { ProdeMatch, ProdeQuestion, ProdeTeam, ProdeWeeklyPrize } from './page'
import {
  setResult,
  setFeatured,
  resolveQuestion,
  deleteParticipant,
  deleteLeague,
  getWeeklyLeaderboard,
  awardWeek,
  awardGrandPrize,
  createReminderTemplate,
  sendReminders,
  redeemRewardByQr,
  type WeeklyLeaderboardRow,
} from '@/lib/actions/prode'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TournamentLite {
  id: string
  name: string
  season: string
  status: string
  starts_at: string
  ends_at: string
}

interface ParticipantRow {
  id: string
  display_name: string
  phone: string | null
  client_name: string | null
  profile_completed: boolean
  created_at: string
}

interface LeagueRow {
  id: string
  name: string
  invite_code: string
  is_house: boolean
  is_public: boolean
  member_count: number
}

interface ProdeClientProps {
  tournament: TournamentLite | null
  matches: ProdeMatch[]
  questions: ProdeQuestion[]
  teams: ProdeTeam[]
  participants: ParticipantRow[]
  leagues: LeagueRow[]
  weeklyPrizes: ProdeWeeklyPrize[]
  whatsappActive: boolean
  reminderTemplateStatus: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtKickoff(iso: string): string {
  return format(new Date(iso), "EEE d MMM, HH:mm", { locale: es })
}

function fmtDateShort(iso: string): string {
  return format(new Date(iso), "d 'de' MMM", { locale: es })
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programado',
  live: 'En vivo',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
}

// Semanas Lun–Dom (ARG) desde starts_at hasta min(ends_at, hoy).
interface WeekWindow {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
  label: string
}

function computeWeekWindows(startsAt: string, endsAt: string): WeekWindow[] {
  const TZ = 'America/Argentina/Buenos_Aires'
  // Fecha calendario en ARG (YYYY-MM-DD), luego tratada como UTC-midnight para la
  // aritmética de días. Así las fronteras Lun–Dom coinciden con el bucketing
  // (kickoff_at AT TIME ZONE ARG)::date que usa prode_weekly_leaderboard.
  const toArgDate = (iso: string | Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      typeof iso === 'string' ? new Date(iso) : iso
    )
  const midnight = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

  const todayArg = midnight(toArgDate(new Date()))
  const endArg = midnight(toArgDate(endsAt))
  const cap = endArg < todayArg ? endArg : todayArg

  // Lunes de la semana de starts_at (en ARG)
  const monday = midnight(toArgDate(startsAt))
  const dow = monday.getUTCDay() // 0=Dom
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
    windows.push({
      start: startStr,
      end: endStr,
      label: `${fmtDateShort(startStr)} – ${fmtDateShort(endStr)}`,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 7)
    guard++
  }
  return windows
}

// ===========================================================================
// Componente principal
// ===========================================================================

export function ProdeClient(props: ProdeClientProps) {
  const { tournament } = props

  if (!tournament) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-5 text-primary" /> Prode Mundial
            </CardTitle>
            <CardDescription>
              Todavía no hay ningún torneo configurado para esta organización.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="size-6 text-primary" />
            Prode Mundial
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tournament.name} · Temporada {tournament.season}
          </p>
        </div>
        <Badge
          variant={tournament.status === 'active' ? 'default' : 'secondary'}
          className="uppercase tracking-wide"
        >
          {tournament.status === 'active'
            ? 'Activo'
            : tournament.status === 'upcoming'
              ? 'Próximamente'
              : 'Finalizado'}
        </Badge>
      </div>

      <Tabs defaultValue="resultados" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="resultados">Resultados</TabsTrigger>
          <TabsTrigger value="quiniela">Quiniela</TabsTrigger>
          <TabsTrigger value="participantes">Participantes y Ligas</TabsTrigger>
          <TabsTrigger value="premios">Premios</TabsTrigger>
          <TabsTrigger value="recordatorios">Recordatorios</TabsTrigger>
          <TabsTrigger value="canjear">Canjear premio</TabsTrigger>
        </TabsList>

        <TabsContent value="resultados" className="mt-4">
          <ResultadosTab matches={props.matches} />
        </TabsContent>
        <TabsContent value="quiniela" className="mt-4">
          <QuinielaTab questions={props.questions} teams={props.teams} />
        </TabsContent>
        <TabsContent value="participantes" className="mt-4">
          <ParticipantesTab participants={props.participants} leagues={props.leagues} />
        </TabsContent>
        <TabsContent value="premios" className="mt-4">
          <PremiosTab tournament={tournament} weeklyPrizes={props.weeklyPrizes} />
        </TabsContent>
        <TabsContent value="recordatorios" className="mt-4">
          <RecordatoriosTab
            whatsappActive={props.whatsappActive}
            reminderTemplateStatus={props.reminderTemplateStatus}
          />
        </TabsContent>
        <TabsContent value="canjear" className="mt-4">
          <CanjearTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ===========================================================================
// Tab: Resultados
// ===========================================================================

function ResultadosTab({ matches }: { matches: ProdeMatch[] }) {
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'finished'>('all')

  const filtered = useMemo(() => {
    if (filter === 'all') return matches
    if (filter === 'finished') return matches.filter((m) => m.status === 'finished')
    return matches.filter((m) => m.status !== 'finished')
  }, [matches, filter])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Partidos</CardTitle>
            <CardDescription>
              Cargá el resultado de cada partido. Al guardar se puntúan las jugadas automáticamente.
            </CardDescription>
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="scheduled">Pendientes</SelectItem>
              <SelectItem value="finished">Finalizados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No hay partidos para mostrar.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <MatchRow key={m.id} match={m} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MatchRow({ match }: { match: ProdeMatch }) {
  const [home, setHome] = useState<string>(match.home_score?.toString() ?? '')
  const [away, setAway] = useState<string>(match.away_score?.toString() ?? '')
  const [featured, setFeaturedState] = useState(match.is_featured)
  const [lastScored, setLastScored] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isFeaturePending, startFeatureTransition] = useTransition()

  const isFinished = match.status === 'finished'

  const onSave = () => {
    const h = Number(home)
    const a = Number(away)
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
      toast.error('Ingresá resultados válidos (números enteros)')
      return
    }
    startTransition(async () => {
      const r = await setResult({ matchId: match.id, home: h, away: a })
      if ('error' in r) {
        toast.error(r.error)
      } else {
        setLastScored(r.scored)
        toast.success(`Resultado guardado. ${r.scored} jugada(s) puntuada(s).`)
      }
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
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="size-3.5" />
          {fmtKickoff(match.kickoff_at)}
          {match.stage && <span className="capitalize">· {match.stage}</span>}
          {match.group_label && <span>· {match.group_label}</span>}
          <Badge variant="outline" className="text-[10px]">
            {STATUS_LABELS[match.status] ?? match.status}
          </Badge>
        </div>
        <div className="mt-1 font-medium truncate">
          {match.home_team_label ?? '?'} <span className="text-muted-foreground">vs</span>{' '}
          {match.away_team_label ?? '?'}
        </div>
        {isFinished && (
          <div className="mt-1 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" /> Finalizado
            {lastScored !== null && <span>· {lastScored} jugada(s) puntuada(s)</span>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleFeatured}
          disabled={isFeaturePending}
          aria-label="Partido del día"
          title="Partido del día"
        >
          <Star
            className={cn('size-5', featured ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')}
          />
        </Button>
        <Input
          type="number"
          min={0}
          max={30}
          value={home}
          onChange={(e) => setHome(e.target.value)}
          className="w-14 text-center"
          aria-label="Goles local"
        />
        <span className="text-muted-foreground">-</span>
        <Input
          type="number"
          min={0}
          max={30}
          value={away}
          onChange={(e) => setAway(e.target.value)}
          className="w-14 text-center"
          aria-label="Goles visitante"
        />
        <Button onClick={onSave} disabled={isPending} size="sm">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}

// ===========================================================================
// Tab: Quiniela
// ===========================================================================

function QuinielaTab({ questions, teams }: { questions: ProdeQuestion[]; teams: ProdeTeam[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quiniela / Preguntas especiales</CardTitle>
        <CardDescription>
          Resolvé cada pregunta con la respuesta correcta. Al resolver se reparten los puntos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No hay preguntas configuradas.</p>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionRow key={q.id} question={q} teams={teams} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QuestionRow({ question, teams }: { question: ProdeQuestion; teams: ProdeTeam[] }) {
  const [answer, setAnswer] = useState<string>(question.correct_answer ?? '')
  const [resolved, setResolved] = useState(!!question.resolved_at)
  const [isPending, startTransition] = useTransition()

  const choiceOptions = useMemo(() => {
    const opts = question.options
    if (Array.isArray(opts)) {
      return opts.map((o) =>
        typeof o === 'string' ? o : String((o as { value?: unknown; label?: unknown })?.value ?? (o as { label?: unknown })?.label ?? o)
      )
    }
    return [] as string[]
  }, [question.options])

  const onResolve = () => {
    if (!answer.trim()) {
      toast.error('Ingresá una respuesta')
      return
    }
    startTransition(async () => {
      const r = await resolveQuestion({ questionId: question.id, answer: answer.trim() })
      if ('error' in r) {
        toast.error(r.error)
      } else {
        setResolved(true)
        toast.success(`Pregunta resuelta. ${r.scored} jugada(s) puntuada(s).`)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{question.label}</span>
          <Badge variant="outline" className="text-[10px]">
            {question.points} pts
          </Badge>
          {resolved && (
            <Badge className="bg-emerald-600 text-[10px]">
              <CheckCircle2 className="mr-1 size-3" /> Resuelta
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {question.answer_type === 'team' ? (
          <Select value={answer} onValueChange={setAnswer}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Equipo correcto" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : question.answer_type === 'choice' && choiceOptions.length > 0 ? (
          <Select value={answer} onValueChange={setAnswer}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Opción correcta" />
            </SelectTrigger>
            <SelectContent>
              {choiceOptions.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={question.answer_type === 'number' ? 'number' : 'text'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Respuesta correcta"
            className="w-52"
          />
        )}
        <Button onClick={onResolve} disabled={isPending} size="sm">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Resolver'}
        </Button>
      </div>
    </div>
  )
}

// ===========================================================================
// Tab: Participantes y Ligas
// ===========================================================================

function ParticipantesTab({
  participants,
  leagues,
}: {
  participants: ParticipantRow[]
  leagues: LeagueRow[]
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" /> Participantes ({participants.length})
          </CardTitle>
          <CardDescription>
            Usá esto para limpiar data de prueba antes de abrir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin participantes.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {participants.map((p) => (
                  <ParticipantRowItem key={p.id} participant={p} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-5" /> Ligas ({leagues.length})
          </CardTitle>
          <CardDescription>
            La liga de la casa no se puede eliminar. Borrá las ligas de prueba individualmente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leagues.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Sin ligas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Miembros</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leagues.map((l) => (
                  <LeagueRowItem key={l.id} league={l} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ParticipantRowItem({ participant }: { participant: ParticipantRow }) {
  const [isPending, startTransition] = useTransition()
  const onDelete = () => {
    startTransition(async () => {
      const r = await deleteParticipant(participant.id)
      if ('error' in r) toast.error(r.error)
      else toast.success('Participante eliminado')
    })
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{participant.display_name}</TableCell>
      <TableCell>{participant.phone ?? '—'}</TableCell>
      <TableCell>
        {participant.profile_completed ? (
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            Completo
          </Badge>
        ) : (
          <Badge variant="outline">Incompleto</Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{fmtDateShort(participant.created_at)}</TableCell>
      <TableCell className="text-right">
        <ConfirmDelete
          title="¿Eliminar participante?"
          description={`Se eliminará "${participant.display_name}" y sus jugadas. Esta acción no se puede deshacer.`}
          onConfirm={onDelete}
          disabled={isPending}
        />
      </TableCell>
    </TableRow>
  )
}

function LeagueRowItem({ league }: { league: LeagueRow }) {
  const [isPending, startTransition] = useTransition()
  const onDelete = () => {
    startTransition(async () => {
      const r = await deleteLeague(league.id)
      if ('error' in r) toast.error(r.error)
      else toast.success('Liga eliminada')
    })
  }
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {league.name}
          {league.is_house && <Badge className="text-[10px]">Casa</Badge>}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">{league.invite_code}</TableCell>
      <TableCell>{league.member_count}</TableCell>
      <TableCell className="text-right">
        {league.is_house ? (
          <Button variant="ghost" size="icon" disabled aria-label="No se puede eliminar">
            <Trash2 className="size-4 text-muted-foreground/40" />
          </Button>
        ) : (
          <ConfirmDelete
            title="¿Eliminar liga?"
            description={`Se eliminará la liga "${league.name}" y sus membresías. Esta acción no se puede deshacer.`}
            onConfirm={onDelete}
            disabled={isPending}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

function ConfirmDelete({
  title,
  description,
  onConfirm,
  disabled,
}: {
  title: string
  description: string
  onConfirm: () => void
  disabled?: boolean
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label="Eliminar">
          {disabled ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4 text-destructive" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ===========================================================================
// Tab: Premios
// ===========================================================================

function PremiosTab({
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

  const [selectedWeek, setSelectedWeek] = useState<string>(weeks.length > 0 ? weeks[weeks.length - 1].start : '')
  const selected = weeks.find((w) => w.start === selectedWeek) ?? null

  const [leaderboard, setLeaderboard] = useState<WeeklyLeaderboardRow[]>([])
  const [isLoadingLb, startLoadLb] = useTransition()
  const [isAwarding, startAward] = useTransition()
  const [isGrandPrize, startGrand] = useTransition()

  const loadLeaderboard = useCallback(
    (w: WeekWindow) => {
      startLoadLb(async () => {
        const r = await getWeeklyLeaderboard({ weekStart: w.start, weekEnd: w.end })
        if ('error' in r) {
          toast.error(r.error)
          setLeaderboard([])
        } else {
          setLeaderboard(r.rows)
        }
      })
    },
    []
  )

  // Cargar al cambiar de semana
  useEffect(() => {
    if (selected) loadLeaderboard(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek])

  const onAwardWeek = () => {
    if (!selected) return
    startAward(async () => {
      const r = await awardWeek({ weekStart: selected.start, weekEnd: selected.end })
      if ('error' in r) {
        toast.error(r.error)
      } else if (r.already) {
        toast.info('Esta semana ya fue premiada')
      } else if (r.winner) {
        toast.success(`Ganador de la semana: ${r.winner.display_name} (${r.winner.points} pts)`)
      } else {
        toast.info('No hubo ganador para esta semana (sin jugadas)')
      }
    })
  }

  const onGrandPrize = () => {
    startGrand(async () => {
      const r = await awardGrandPrize()
      if ('error' in r) {
        toast.error(r.error)
      } else if (r.already) {
        toast.info('El Gran Premio ya fue otorgado')
      } else if (r.winner) {
        toast.success(`¡Campeón del Prode: ${r.winner.display_name}! Torneo finalizado.`)
      } else {
        toast.info('No hay ganador disponible')
      }
    })
  }

  const selectedAwarded = selected ? awardedByWeek.get(`${selected.start}|${selected.end}`) : undefined

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-5" /> Premio semanal
          </CardTitle>
          <CardDescription>
            Elegí una semana (Lun–Dom), revisá el top 10 y premiá al 1°.
          </CardDescription>
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
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Crown className="size-4 mr-2" />
                  )}
                  Cerrar semana y premiar al 1°
                </Button>
              </div>

              {selectedAwarded && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm">
                  <CheckCircle2 className="inline size-4 mr-1 text-emerald-600" />
                  Semana premiada el {fmtDateShort(selectedAwarded.awarded_at)} ·{' '}
                  {selectedAwarded.winner_points ?? 0} pts
                </div>
              )}

              <div className="rounded-lg border">
                {isLoadingLb ? (
                  <div className="p-8 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : leaderboard.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground text-center">
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

      <Card className="border-amber-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-5 text-amber-500" /> Gran Premio
          </CardTitle>
          <CardDescription>
            Premia al campeón general del torneo y lo marca como finalizado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="default" className="bg-amber-500 hover:bg-amber-600" disabled={isGrandPrize}>
                {isGrandPrize ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Crown className="size-4 mr-2" />
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
                  Esto premia al 1° de la tabla general y <strong>marca el torneo como finalizado</strong>.
                  No se puede deshacer. ¿Confirmás?
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
    </div>
  )
}

// ===========================================================================
// Tab: Recordatorios
// ===========================================================================

function RecordatoriosTab({
  whatsappActive,
  reminderTemplateStatus,
}: {
  whatsappActive: boolean
  reminderTemplateStatus: string | null
}) {
  const [tplStatus, setTplStatus] = useState<string | null>(reminderTemplateStatus)
  const [isCreating, startCreate] = useTransition()
  const [isSending, startSend] = useTransition()

  const isApproved = tplStatus === 'approved'

  const onCreate = () => {
    startCreate(async () => {
      const r = await createReminderTemplate()
      if (r.error) {
        toast.error(r.error)
      } else {
        setTplStatus(r.status ?? 'pending')
        toast.success('Plantilla enviada a Meta. Esperá la aprobación para poder enviar.')
      }
    })
  }

  const onSend = () => {
    startSend(async () => {
      const r = await sendReminders()
      if (r.error) {
        toast.error(r.error)
      } else if ((r.enqueued ?? 0) > 0) {
        toast.success(`${r.enqueued} recordatorio(s) encolado(s). Se envían en el próximo ciclo.`)
      } else {
        toast.info(r.reason ?? 'No se encoló ningún recordatorio')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5" /> Recordatorios por WhatsApp
        </CardTitle>
        <CardDescription>
          Avisá a los participantes que no jugaron el próximo partido destacado (“jugá hoy”).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">WhatsApp Business:</span>
            {whatsappActive ? (
              <Badge className="bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Activo
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 size-3" /> No configurado
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Plantilla “prode_recordatorio”:</span>
            {tplStatus === null ? (
              <Badge variant="outline">No creada</Badge>
            ) : isApproved ? (
              <Badge className="bg-emerald-600">
                <CheckCircle2 className="mr-1 size-3" /> Aprobada
              </Badge>
            ) : (
              <Badge variant="secondary" className="capitalize">{tplStatus}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={onCreate} disabled={isCreating || !whatsappActive}>
            {isCreating ? <Loader2 className="size-4 mr-2 animate-spin" /> : <MessageCircle className="size-4 mr-2" />}
            Crear plantilla de recordatorio
          </Button>
          <Button onClick={onSend} disabled={isSending || !isApproved}>
            {isSending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <MessageCircle className="size-4 mr-2" />}
            Enviar recordatorio ahora
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          El envío solo funciona una vez que Meta <strong>aprueba</strong> la plantilla (puede tardar
          unos minutos). Un cron diario también encola los recordatorios automáticamente para el
          próximo partido destacado. Es idempotente: no duplica avisos al mismo cliente en el día.
        </p>
      </CardContent>
    </Card>
  )
}

// ===========================================================================
// Tab: Canjear premio (staff)
// ===========================================================================

type RedeemResult =
  | { success: true; rewardName: string | null; isFreeService: boolean; discountPct: number | null }
  | { success: false; error: string }

function CanjearTab() {
  const [code, setCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<RedeemResult | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastScannedRef = useRef<string | null>(null)

  const runRedeem = useCallback((raw: string) => {
    const clean = raw.trim()
    if (clean.length < 8) {
      toast.error('El código es muy corto')
      return
    }
    startTransition(async () => {
      const r = await redeemRewardByQr(clean)
      if ('error' in r) {
        setResult({ success: false, error: r.error })
      } else {
        setResult({
          success: true,
          rewardName: r.rewardName,
          isFreeService: r.isFreeService,
          discountPct: r.discountPct,
        })
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.([100, 60, 100])
        }
      }
    })
  }, [])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    runRedeem(code)
  }

  const onScan = useCallback(
    (detected: IDetectedBarcode[]) => {
      if (!detected.length) return
      const raw = (detected[0]?.rawValue ?? '').trim()
      if (!raw || raw === lastScannedRef.current) return
      lastScannedRef.current = raw
      setCode(raw)
      setScannerOpen(false)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(50)
      runRedeem(raw)
    },
    [runRedeem]
  )

  const onScanError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    if (/permission|denied|NotAllowed/i.test(message)) {
      toast.error('Permiso de cámara denegado')
      setScannerOpen(false)
    }
  }, [])

  const reset = () => {
    setCode('')
    setResult(null)
    lastScannedRef.current = null
    inputRef.current?.focus()
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-primary" /> Canjear premio del cliente
          </CardTitle>
          <CardDescription>
            Escaneá el QR del premio o ingresá el código manualmente para validarlo en el mostrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result ? (
            <div className="space-y-4">
              <Button
                type="button"
                className="w-full h-14 text-base"
                onClick={() => {
                  lastScannedRef.current = null
                  setScannerOpen(true)
                }}
                disabled={isPending}
              >
                <Camera className="size-5 mr-2" />
                Escanear QR con cámara
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">o</span>
                </div>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="prode-code" className="flex items-center gap-1.5">
                    <KeySquare className="size-3.5" /> Ingresar código manualmente
                  </Label>
                  <Input
                    id="prode-code"
                    ref={inputRef}
                    placeholder="código del QR"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    className="font-mono"
                    disabled={isPending}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full h-12 text-base"
                  disabled={isPending || code.trim().length < 8}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="size-5 mr-2 animate-spin" /> Validando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-5 mr-2" /> Validar y canjear
                    </>
                  )}
                </Button>
              </form>
            </div>
          ) : result.success ? (
            <div className="text-center space-y-4">
              <div className="size-20 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-10" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                  ¡Premio canjeado!
                </h2>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4 text-left space-y-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Premio</p>
                  <p className="font-semibold">{result.rewardName ?? 'Premio'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Beneficio</p>
                  <p className="font-medium">
                    {result.isFreeService
                      ? 'Servicio gratis'
                      : result.discountPct
                        ? `${result.discountPct}% de descuento`
                        : 'Beneficio'}
                  </p>
                </div>
              </div>
              <Button onClick={reset} className="w-full" size="lg">
                <RotateCcw className="size-4 mr-2" /> Canjear otro
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="size-20 rounded-full bg-red-500 text-white flex items-center justify-center mx-auto">
                <XCircle className="size-10" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-red-700 dark:text-red-300">No se pudo canjear</h2>
                <p className="text-sm text-muted-foreground mt-1">{result.error}</p>
              </div>
              <Button onClick={reset} className="w-full" size="lg" variant="outline">
                <RotateCcw className="size-4 mr-2" /> Probar con otro código
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={scannerOpen}
        onOpenChange={(open) => {
          setScannerOpen(open)
          if (!open) lastScannedRef.current = null
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="size-5" /> Escanear QR
            </DialogTitle>
            <DialogDescription>
              Apuntá la cámara al QR del premio que muestra el cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
            {scannerOpen && (
              <Scanner
                onScan={onScan}
                onError={onScanError}
                constraints={{ facingMode: 'environment' }}
                formats={['qr_code']}
                classNames={{ container: 'size-full', video: 'size-full object-cover' }}
                components={{ finder: true, torch: true, zoom: true }}
                allowMultiple={false}
                scanDelay={300}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Si no se abre la cámara, verificá que el navegador tenga permiso y que la página esté en HTTPS.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
