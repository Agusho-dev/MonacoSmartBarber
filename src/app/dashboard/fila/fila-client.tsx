'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cancelQueueEntry, reassignBarber } from '@/lib/actions/queue'
import { useBranchStore } from '@/stores/branch-store'
import { BranchSelector } from '@/components/dashboard/branch-selector'
import type { QueueEntry, StaffStatus, StaffSchedule, Staff } from '@/lib/types/database'
import { assignDynamicBarbers, isBarberBlockedByShiftEnd } from '@/lib/barber-utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Clock,
  User,
  Scissors,
  X,
  UserCog,
  Pause,
  CircleDot,
  EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'

interface BarberRow {
  id: string
  full_name: string
  branch_id: string | null
  status: StaffStatus
  is_active: boolean
  hidden_from_checkin: boolean
}

interface BranchRow {
  id: string
  name: string
}

interface FilaClientProps {
  initialEntries: QueueEntry[]
  barbers: BarberRow[]
  branches: BranchRow[]
}

export function FilaClient({
  initialEntries,
  barbers,
  branches,
}: FilaClientProps) {
  const { selectedBranchId } = useBranchStore()
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [latestAttendance, setLatestAttendance] = useState<Record<string, string>>({})

  const supabase = useMemo(() => createClient(), [])

  const fetchQueue = useCallback(async () => {
    const query = supabase
      .from('queue_entries')
      .select('*, client:clients(*), barber:staff(*)')
      .in('status', ['waiting', 'in_progress'])
      .order('position')

    const { data } = await query
    if (data) setEntries(data as QueueEntry[])
  }, [supabase])

  const fetchBarbers = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('id, full_name, branch_id, status, is_active, hidden_from_checkin')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name')

    if (data) setLiveBarbers(data as BarberRow[])
  }, [supabase])

  const fetchSchedules = useCallback(async () => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const [schedRes, settingsRes, monthlyVisitsRes, lastVisitsRes, attendanceRes] = await Promise.all([
      supabase
        .from('staff_schedules')
        .select('*')
        .eq('day_of_week', new Date().getDay())
        .eq('is_active', true),
      supabase
        .from('app_settings')
        .select('shift_end_margin_minutes')
        .maybeSingle(),
      supabase
        .from('visits')
        .select('barber_id')
        .gte('completed_at', dayStart.toISOString())
        .not('barber_id', 'is', null),
      supabase
        .from('visits')
        .select('barber_id, completed_at')
        .not('barber_id', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(200),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .gte('recorded_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('recorded_at', { ascending: false }),
    ])
    if (schedRes.data) setSchedules(schedRes.data as StaffSchedule[])
    if (settingsRes.data) {
      const margin = (settingsRes.data as { shift_end_margin_minutes?: number }).shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) setShiftEndMargin(margin)
    }
    if (monthlyVisitsRes?.data) {
      const counts: Record<string, number> = {}
      for (const v of monthlyVisitsRes.data as { barber_id: string }[]) {
        counts[v.barber_id] = (counts[v.barber_id] || 0) + 1
      }
      setDailyServiceCounts(counts)
    }
    if (lastVisitsRes?.data) {
      const lastMap: Record<string, string> = {}
      for (const v of lastVisitsRes.data as { barber_id: string; completed_at: string }[]) {
        if (!lastMap[v.barber_id]) {
          lastMap[v.barber_id] = v.completed_at
        }
      }
      setLastCompletedAt(lastMap)
    }
    if (attendanceRes.data) {
      const latest: Record<string, string> = {}
      attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
        if (!latest[log.staff_id]) {
          latest[log.staff_id] = log.action_type
        }
      })
      setLatestAttendance(latest)
    }
  }, [supabase])

  useEffect(() => {
    fetchQueue()
    fetchBarbers()
    fetchSchedules()

    const channel = supabase
      .channel('admin-queue')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
        },
        () => fetchQueue()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
        },
        () => fetchBarbers()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_logs',
        },
        () => fetchSchedules()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, fetchQueue, fetchBarbers, fetchSchedules])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const notClockedInBarbers = useMemo(() => {
    const notClocked = new Set<string>()
    for (const b of liveBarbers) {
      if (latestAttendance[b.id] !== 'clock_in') notClocked.add(b.id)
    }
    return notClocked
  }, [liveBarbers, latestAttendance])

  const dynamicEntries = useMemo(() => {
    return assignDynamicBarbers(entries, liveBarbers as unknown as Staff[], schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers)
  }, [entries, liveBarbers, schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers])

  // Filtrar por sucursal seleccionada
  const filteredEntries = selectedBranchId
    ? dynamicEntries.filter((e) => e.branch_id === selectedBranchId)
    : dynamicEntries

  const waitingEntries = filteredEntries.filter((e) => e.status === 'waiting')
  const inProgressEntries = filteredEntries.filter(
    (e) => e.status === 'in_progress'
  )

  const filteredBarbers = selectedBranchId
    ? liveBarbers.filter((b) => b.branch_id === selectedBranchId)
    : liveBarbers

  async function handleCancel(entryId: string) {
    setActionLoading(entryId)
    const result = await cancelQueueEntry(entryId)
    if ('error' in result) toast.error(result.error)
    else toast.success('Turno cancelado')
    await fetchQueue()
    setActionLoading(null)
  }

  async function handleReassign(entryId: string, barberId: string) {
    setActionLoading(entryId)
    const result = await reassignBarber(
      entryId,
      barberId === '__none__' ? null : barberId
    )
    if ('error' in result) toast.error(result.error)
    else toast.success('Barbero reasignado')
    await fetchQueue()
    setActionLoading(null)
  }

  function formatElapsed(timestamp: string) {
    const elapsed = now - new Date(timestamp).getTime()
    if (isNaN(elapsed) || elapsed < 0) return '0m'
    const totalSeconds = Math.floor(elapsed / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  function getBranchName(branchId: string) {
    return branches.find((b) => b.id === branchId)?.name ?? ''
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Fila en vivo</h2>
          <p className="text-sm text-muted-foreground">
            Gestión de la fila de espera en tiempo real
          </p>
        </div>
        <BranchSelector branches={branches} />
      </div>

      {/* Resumen de estado de barberos */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filteredBarbers.map((barber) => {
          const activeEntry = inProgressEntries.find(
            (e) => e.barber_id === barber.id
          )
          const isNotClocked = notClockedInBarbers.has(barber.id)
          const isHidden = barber.hidden_from_checkin
          const isShiftEnd = !isNotClocked && isBarberBlockedByShiftEnd(
            barber as unknown as Staff,
            inProgressEntries,
            schedules,
            now,
            shiftEndMargin
          )

          // Determinar estado de visualización (prioridad: oculto > sin entrada > fin turno > atendiendo > disponible)
          let iconBg: string
          let icon: React.ReactNode
          let statusText: string

          if (isHidden) {
            iconBg = 'bg-muted'
            icon = <EyeOff className="size-4 text-muted-foreground/50" />
            statusText = 'Oculto en check-in'
          } else if (isNotClocked) {
            iconBg = 'bg-muted'
            icon = <Clock className="size-4 text-muted-foreground/50" />
            statusText = 'Sin entrada'
          } else if (isShiftEnd) {
            iconBg = 'bg-amber-500/15'
            icon = <Clock className="size-4 text-amber-400" />
            statusText = 'Fin de turno'
          } else if (activeEntry) {
            iconBg = 'bg-primary/10'
            icon = <Scissors className="size-4 text-primary" />
            statusText = `Atendiendo a ${activeEntry.client?.name ?? 'cliente'}`
          } else {
            iconBg = 'bg-muted'
            icon = <CircleDot className="size-4 text-green-400" />
            statusText = 'Disponible'
          }

          const isUnavailable = isHidden || isNotClocked || isShiftEnd

          return (
            <Card key={barber.id} className={`gap-0 py-0 ${isUnavailable ? 'opacity-60' : ''}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
                  {icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {barber.full_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {statusText}
                  </p>
                </div>
                {activeEntry?.started_at && !isUnavailable && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {formatElapsed(activeEntry.started_at)}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Entradas de la fila */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fila de espera</CardTitle>
              <CardDescription>
                {waitingEntries.length} cliente
                {waitingEntries.length !== 1 ? 's' : ''} esperando
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {waitingEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <User className="mb-3 size-10 opacity-30" />
              <p className="text-sm">No hay clientes en espera</p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-340px)] min-h-[300px] pr-4">
              <div className="space-y-3">
                {waitingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border p-4"
                  >
                    {/* Fila superior: posición + datos del cliente + botón cancelar */}
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold">
                        #{entry.position}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {entry.client?.name ?? 'Cliente'}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                          <span>{entry.client?.phone}</span>
                          {!selectedBranchId && (
                            <Badge variant="outline" className="text-xs">
                              {getBranchName(entry.branch_id)}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3" />
                          <span>{formatElapsed(entry.checked_in_at)} esperando</span>
                        </div>
                      </div>

                      {/* Cancelar */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancel(entry.id)}
                        disabled={actionLoading === entry.id}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>

                    {/* Fila inferior: selector de barbero en ancho completo en mobile */}
                    <div className="mt-3 pt-3 border-t">
                      <Select
                        value={entry.barber_id ?? '__none__'}
                        onValueChange={(v) => handleReassign(entry.id, v)}
                        disabled={actionLoading === entry.id}
                      >
                        <SelectTrigger className="w-full sm:w-[200px]">
                          <UserCog className="mr-2 size-3.5 text-muted-foreground" />
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            Cualquiera
                          </SelectItem>
                          {(selectedBranchId
                            ? filteredBarbers
                            : liveBarbers.filter(
                              (b) => b.branch_id === entry.branch_id
                            )
                          ).map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* En atención */}
      {inProgressEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>En atención</CardTitle>
            <CardDescription>
              {inProgressEntries.length} cliente
              {inProgressEntries.length !== 1 ? 's' : ''} siendo atendido
              {inProgressEntries.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {inProgressEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/3 p-4"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Scissors className="size-4 text-primary" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {entry.client?.name ?? 'Cliente'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="hidden sm:inline">Atendido por{' '}</span>
                      <span className="font-medium text-foreground">
                        {entry.barber?.full_name ?? 'barbero'}
                      </span>
                    </p>
                    {entry.started_at && (
                      <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                        {formatElapsed(entry.started_at)} en servicio
                      </p>
                    )}
                  </div>

                  {entry.started_at && (
                    <div className="hidden sm:block shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">
                        Tiempo de servicio
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatElapsed(entry.started_at)}
                      </p>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCancel(entry.id)}
                    disabled={actionLoading === entry.id}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Cancelar servicio"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
