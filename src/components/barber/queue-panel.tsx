'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startService, cancelQueueEntry, reassignBarber } from '@/lib/actions/queue'
import { toggleBarberStatus, fetchBarberDayStats } from '@/lib/actions/barber'
import { logoutBarber } from '@/lib/actions/auth'
import { formatCurrency } from '@/lib/format'
import type { QueueEntry, Staff, StaffStatus, Client } from '@/lib/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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
import {
  Clock,
  User,
  Scissors,
  LogOut,
  Check,
  X,
  Pause,
  Play,
  DollarSign,
  Gift,
  ArrowRightLeft,
  Receipt,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { ClientHistory } from './client-history'
import { ClientProfileSheet } from './client-profile-sheet'

interface BarberSession {
  staff_id: string
  full_name: string
  branch_id: string
  role: string
}

interface QueuePanelProps {
  session: BarberSession
  branchName: string
  initialStatus?: StaffStatus
}

export function QueuePanel({
  session,
  branchName,
  initialStatus = 'available',
}: QueuePanelProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [barberStatus, setBarberStatus] = useState<StaffStatus>(initialStatus)
  const [statusLoading, setStatusLoading] = useState(false)
  const [dayStats, setDayStats] = useState({ servicesCount: 0, revenue: 0 })
  const [otherBarbers, setOtherBarbers] = useState<Staff[]>([])
  const [reassigningEntryId, setReassigningEntryId] = useState<string | null>(null)
  const [profileClient, setProfileClient] = useState<Client | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const isPaused = barberStatus === 'paused'

  const fetchQueue = useCallback(async () => {
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients(*, loyalty:client_loyalty_state(total_visits)), barber:staff(*)')
      .eq('branch_id', session.branch_id)
      .in('status', ['waiting', 'in_progress'])
      .order('position')

    if (data) setEntries(data as QueueEntry[])
    setLoading(false)
  }, [supabase, session.branch_id])

  const refreshStats = useCallback(async () => {
    const stats = await fetchBarberDayStats(session.staff_id, session.branch_id)
    setDayStats(stats)
  }, [session.staff_id, session.branch_id])

  const fetchOtherBarbers = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('branch_id', session.branch_id)
      .eq('role', 'barber')
      .eq('is_active', true)
      .neq('id', session.staff_id)
      .order('full_name')

    if (data) setOtherBarbers(data as Staff[])
  }, [supabase, session.branch_id, session.staff_id])

  useEffect(() => {
    fetchQueue()
    refreshStats()
    fetchOtherBarbers()

    const channel = supabase
      .channel(`barber-queue-${session.branch_id}-${session.staff_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchQueue()
          refreshStats()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchOtherBarbers()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, session.branch_id, fetchQueue, refreshStats, fetchOtherBarbers])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const myActiveEntry = entries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress'
  )

  // "Mi cola": clients that have no barber assigned or are assigned to me
  const myWaitingEntries = entries.filter(
    (e) =>
      e.status === 'waiting' &&
      (!e.barber_id || e.barber_id === session.staff_id)
  )

  // "Cola general": ALL waiting clients
  const allWaitingEntries = entries.filter((e) => e.status === 'waiting')

  const otherInProgress = entries.filter(
    (e) => e.status === 'in_progress' && e.barber_id !== session.staff_id
  )

  async function handleToggleStatus() {
    setStatusLoading(true)
    const result = await toggleBarberStatus(session.staff_id)
    if ('error' in result) {
      toast.error(result.error)
    } else if (result.status) {
      setBarberStatus(result.status)
      toast.success(
        result.status === 'paused' ? 'En pausa' : 'Disponible'
      )
    }
    setStatusLoading(false)
  }

  async function handleStartService(entryId: string) {
    setActionLoading(entryId)
    const result = await startService(entryId, session.staff_id)
    if ('error' in result) toast.error(result.error)
    await fetchQueue()
    setActionLoading(null)
  }

  async function handleCancel(entryId: string) {
    setActionLoading(entryId)
    const result = await cancelQueueEntry(entryId)
    if ('error' in result) toast.error(result.error)
    await fetchQueue()
    setActionLoading(null)
  }

  async function handleReassign(entryId: string, targetBarberId: string) {
    setActionLoading(entryId)
    const result = await reassignBarber(entryId, targetBarberId)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      const target = otherBarbers.find((b) => b.id === targetBarberId)
      toast.success(`Reasignado a ${target?.full_name ?? 'otro barbero'}`)
      setReassigningEntryId(null)
    }
    await fetchQueue()
    setActionLoading(null)
  }

  function formatElapsed(timestamp: string) {
    const elapsed = now - new Date(timestamp).getTime()
    if (isNaN(elapsed) || elapsed < 0) return '0m 0s'
    const totalSeconds = Math.floor(elapsed / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m ${seconds}s`
  }

  function renderQueueEntry(entry: QueueEntry) {
    const isMyEntry = entry.barber_id === session.staff_id
    const canReassign = isPaused && isMyEntry && entry.status === 'waiting' && otherBarbers.length > 0
    const isReassigning = reassigningEntryId === entry.id

    return (
      <div key={entry.id} className="space-y-2">
        <Card className="gap-0 py-0">
          <CardContent className="flex items-center gap-4 p-5 md:p-6">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-secondary text-xl font-bold">
              #{entry.position}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-semibold">
                  {entry.client?.name ?? 'Cliente'}
                </p>
                {(!entry.client?.loyalty?.length || entry.client.loyalty[0]?.total_visits === 0) && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                    Primer Corte
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {entry.client?.phone}
              </p>
              {entry.reward_claimed && (
                <Badge variant="secondary" className="mt-1 gap-1 text-xs bg-purple-500/15 text-purple-500 hover:bg-purple-500/25 border-purple-500/20">
                  <Gift className="size-3" />
                  Premio reclamado
                </Badge>
              )}
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                <span>{formatElapsed(entry.checked_in_at)} esperando</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!myActiveEntry && !isPaused && (
                <Button
                  size="lg"
                  className="h-14 px-6 text-lg"
                  onClick={() => handleStartService(entry.id)}
                  disabled={actionLoading === entry.id}
                >
                  <Scissors className="mr-2 size-5" />
                  <span className="hidden xl:inline">Atender</span>
                </Button>
              )}
              {canReassign && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-14 px-5 text-base text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                  onClick={() =>
                    setReassigningEntryId(isReassigning ? null : entry.id)
                  }
                  disabled={actionLoading === entry.id}
                >
                  <ArrowRightLeft className="size-5 md:mr-2" />
                  <span className="hidden xl:inline">Reasignar</span>
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionLoading === entry.id}
                    className="size-14 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="No se presentó / Ausente"
                  >
                    <X className="size-6" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿El cliente no se presentó?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esto marcará a <strong>{entry.client?.name ?? 'Cliente'}</strong> como Ausente y lo quitará de la cola de espera de forma permanente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Volver</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => handleCancel(entry.id)}
                    >
                      Sí, cancelar turno
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        {isReassigning && (
          <Card className="gap-0 border-yellow-500/20 bg-yellow-500/3 py-0 animate-in fade-in slide-in-from-top-2 duration-200">
            <CardContent className="p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Reasignar a:
              </p>
              <div className="grid gap-1.5">
                {otherBarbers
                  .map((barber) => {
                    const waitCount = entries.filter(
                      (e) => e.status === 'waiting' && e.barber_id === barber.id
                    ).length
                    return { ...barber, waitCount }
                  })
                  .sort((a, b) => a.waitCount - b.waitCount)
                  .map((barber) => (
                    <button
                      key={barber.id}
                      onClick={() => handleReassign(entry.id, barber.id)}
                      disabled={actionLoading === entry.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent active:bg-accent/80 disabled:opacity-50"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                        {barber.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {barber.full_name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {barber.waitCount === 0
                            ? 'Sin clientes'
                            : `${barber.waitCount} en espera`}
                        </p>
                      </div>
                      {actionLoading === entry.id && (
                        <div className="size-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                      )}
                    </button>
                  ))}
              </div>
              <button
                onClick={() => setReassigningEntryId(null)}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                Cancelar
              </button>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  function renderInProgressOthers() {
    if (otherInProgress.length === 0) return null
    return (
      <>
        <div className="flex items-center gap-3 pt-4">
          <Separator className="flex-1" />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            En atención por otros barberos
          </span>
          <Separator className="flex-1" />
        </div>
        {otherInProgress.map((entry) => (
          <Card
            key={entry.id}
            className="gap-0 border-dashed py-0 opacity-60"
          >
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Scissors className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {entry.client?.name ?? 'Cliente'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Atendido por {entry.barber?.full_name ?? 'otro barbero'}
                </p>
                {entry.started_at && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    <span>{formatElapsed(entry.started_at)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </>
    )
  }

  function renderEmptyQueue() {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <User className="mb-3 size-10 opacity-30" />
        <p className="text-sm">No hay clientes en espera</p>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="size-4" />
          </div>
          <div>
            <p className="font-semibold leading-none">{session.full_name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{branchName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <form action={logoutBarber}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </form>
        </div>
      </header>

      {/* Day stats bar */}
      <div className="flex items-center gap-6 border-b px-4 py-2 md:px-6">
        <div className="flex items-center gap-2 text-sm">
          <Scissors className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Hoy:</span>
          <span className="font-semibold">{dayStats.servicesCount} servicios</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="size-3.5 text-muted-foreground" />
          <span className="font-semibold">{formatCurrency(dayStats.revenue)}</span>
        </div>
        <Link href="/barbero/facturacion" className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <Receipt className="size-3.5" />
          <span className="hidden sm:inline">Ver detalle</span>
        </Link>
        {isPaused && (
          <Badge
            variant="outline"
            className="ml-auto bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
          >
            En pausa
          </Badge>
        )}
      </div>

      <main className="flex flex-1 flex-col overflow-hidden sm:flex-row">
        {/* Queue list */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-b sm:border-b-0 sm:border-r">
          <Tabs defaultValue="my-queue" className="flex flex-1 flex-col overflow-hidden">
            <div className="px-4 py-3 md:px-6">
              <TabsList className="w-full">
                <TabsTrigger value="my-queue" className="flex-1 py-3 text-lg">
                  Mi cola
                  <Badge variant="secondary" className="ml-2 px-2 text-base">
                    {myWaitingEntries.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="general-queue" className="flex-1 py-3 text-lg">
                  Cola general
                  <Badge variant="secondary" className="ml-2 px-2 text-base">
                    {allWaitingEntries.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>
            <Separator />

            <TabsContent
              value="my-queue"
              className="mt-0 flex-1 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4 md:p-6">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                    ))
                  ) : myWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    myWaitingEntries.map(renderQueueEntry)
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent
              value="general-queue"
              className="mt-0 flex-1 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="space-y-2 p-4 md:p-6">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                    ))
                  ) : allWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    allWaitingEntries.map(renderQueueEntry)
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </section>

        {/* Current client */}
        <section className="flex shrink-0 flex-col sm:w-[280px] md:w-[340px] lg:w-[420px]">
          <div className="px-4 py-4 md:px-6">
            <h2 className="text-xl font-semibold">Tu cliente actual</h2>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col p-4 md:p-6">
            {myActiveEntry ? (
              <Card className="border-primary/20 bg-primary/3">
                <CardHeader className="p-5 md:p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground">
                      #{myActiveEntry.position}
                    </div>
                    <div>
                      <CardTitle className="text-2xl md:text-3xl">
                        {myActiveEntry.client?.name ?? 'Cliente'}
                      </CardTitle>
                      <p className="mt-1.5 text-base text-muted-foreground">
                        {myActiveEntry.client?.phone}
                      </p>
                    </div>
                    {myActiveEntry.reward_claimed && (
                      <div className="ml-auto">
                        <Badge variant="secondary" className="gap-1 bg-purple-500/15 text-purple-500 hover:bg-purple-500/25 border-purple-500/20 px-3 py-1">
                          <Gift className="size-3.5" />
                          Tiene premio
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-5 pt-0 md:p-6 md:pt-0">
                  <div className="flex items-center gap-4 rounded-xl bg-secondary px-5 py-4">
                    <Clock className="size-6 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Tiempo de servicio
                      </p>
                      <p className="text-4xl font-bold tabular-nums tracking-tight">
                        {myActiveEntry.started_at
                          ? formatElapsed(myActiveEntry.started_at)
                          : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <Button
                      variant="outline"
                      className="h-14 w-full bg-card text-lg hover:bg-accent flex-1"
                      onClick={() => {
                        if (myActiveEntry?.client) {
                          setProfileClient(myActiveEntry.client)
                        }
                      }}
                    >
                      <User className="mr-2 size-5" />
                      Ver Perfil y Notas
                    </Button>
                  </div>

                  <div className="flex gap-4">
                    <Button
                      className="h-16 flex-1 text-xl"
                      size="lg"
                      onClick={() => setCompletingEntry(myActiveEntry)}
                    >
                      <Check className="mr-2 size-6" />
                      Finalizar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
                <Scissors className="mb-3 size-12 opacity-15" />
                <p className="font-medium">Sin cliente en atención</p>
                <p className="mt-1 max-w-[220px] text-xs opacity-60">
                  {isPaused
                    ? 'Estás en pausa. Reanudate para atender clientes.'
                    : 'Selecciona un cliente de la cola para comenzar'}
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <CompleteServiceDialog
        entry={completingEntry}
        branchId={session.branch_id}
        onClose={() => setCompletingEntry(null)}
        onCompleted={fetchQueue}
      />

      <ClientProfileSheet
        client={profileClient}
        isOpen={!!profileClient}
        onClose={() => setProfileClient(null)}
      />
    </div>
  )
}
