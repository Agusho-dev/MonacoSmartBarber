'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cancelQueueEntry, reassignBarber } from '@/lib/actions/queue'
import { useBranchStore } from '@/stores/branch-store'
import type { QueueEntry, StaffStatus, StaffSchedule, Staff } from '@/lib/types/database'
import { assignDynamicBarbers } from '@/lib/barber-utils'
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
} from 'lucide-react'
import { toast } from 'sonner'

interface BarberRow {
  id: string
  full_name: string
  branch_id: string | null
  status: StaffStatus
  is_active: boolean
}

interface BranchRow {
  id: string
  name: string
}

interface ColaClientProps {
  initialEntries: QueueEntry[]
  barbers: BarberRow[]
  branches: BranchRow[]
}

export function ColaClient({
  initialEntries,
  barbers,
  branches,
}: ColaClientProps) {
  const { selectedBranchId } = useBranchStore()
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [monthlyServiceCounts, setMonthlyServiceCounts] = useState<Record<string, number>>({})

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
      .select('id, full_name, branch_id, status, is_active')
      .eq('role', 'barber')
      .eq('is_active', true)
      .order('full_name')

    if (data) setLiveBarbers(data as BarberRow[])
  }, [supabase])

  const fetchSchedules = useCallback(async () => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [schedRes, settingsRes, monthlyVisitsRes] = await Promise.all([
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
        .gte('completed_at', monthStart.toISOString())
        .not('barber_id', 'is', null),
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
      setMonthlyServiceCounts(counts)
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, fetchQueue, fetchBarbers, fetchSchedules])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const dynamicEntries = useMemo(() => {
    return assignDynamicBarbers(entries, liveBarbers as unknown as Staff[], schedules, now, shiftEndMargin, monthlyServiceCounts)
  }, [entries, liveBarbers, schedules, now, shiftEndMargin, monthlyServiceCounts])

  // Filter by selected branch
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
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cola en vivo</h2>
        <p className="text-sm text-muted-foreground">
          Gestión de la cola de espera en tiempo real
        </p>
      </div>

      {/* Barber status summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {filteredBarbers.map((barber) => {
          const activeEntry = inProgressEntries.find(
            (e) => e.barber_id === barber.id
          )
          const isPaused = false

          return (
            <Card key={barber.id} className="gap-0 py-0">
              <CardContent className="flex items-center gap-3 p-4">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${isPaused
                    ? 'bg-yellow-500/15'
                    : activeEntry
                      ? 'bg-primary/10'
                      : 'bg-muted'
                    }`}
                >
                  {activeEntry ? (
                    <Scissors className="size-4 text-primary" />
                  ) : (
                    <CircleDot className="size-4 text-green-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {barber.full_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {activeEntry
                      ? `Atendiendo a ${activeEntry.client?.name ?? 'cliente'}`
                      : 'Disponible'}
                  </p>
                </div>
                {activeEntry?.started_at && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {formatElapsed(activeEntry.started_at)}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Queue entries */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cola de espera</CardTitle>
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
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-3">
                {waitingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-4 rounded-xl border p-4"
                  >
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-lg font-bold">
                      #{entry.position}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {entry.client?.name ?? 'Cliente'}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
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

                    {/* Reassign barber */}
                    <div className="shrink-0">
                      <Select
                        value={entry.barber_id ?? '__none__'}
                        onValueChange={(v) => handleReassign(entry.id, v)}
                        disabled={actionLoading === entry.id}
                      >
                        <SelectTrigger className="w-[160px]">
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

                    {/* Cancel */}
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
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* In progress */}
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
                  className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/3 p-4"
                >
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Scissors className="size-5 text-primary" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {entry.client?.name ?? 'Cliente'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Atendido por{' '}
                      <span className="font-medium text-foreground">
                        {entry.barber?.full_name ?? 'barbero'}
                      </span>
                    </p>
                  </div>

                  {entry.started_at && (
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">
                        Tiempo de servicio
                      </p>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatElapsed(entry.started_at)}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
