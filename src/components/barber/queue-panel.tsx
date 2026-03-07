'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startService, cancelQueueEntry } from '@/lib/actions/queue'
import { logoutBarber } from '@/lib/actions/auth'
import type { QueueEntry } from '@/lib/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Clock, User, Scissors, LogOut, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { ClientHistory } from './client-history'

interface BarberSession {
  staff_id: string
  full_name: string
  branch_id: string
  role: string
}

interface QueuePanelProps {
  session: BarberSession
  branchName: string
}

export function QueuePanel({ session, branchName }: QueuePanelProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [now, setNow] = useState(Date.now())

  const supabase = useMemo(() => createClient(), [])

  const fetchQueue = useCallback(async () => {
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients(*), barber:staff(*)')
      .eq('branch_id', session.branch_id)
      .in('status', ['waiting', 'in_progress'])
      .order('position')

    if (data) setEntries(data as QueueEntry[])
    setLoading(false)
  }, [supabase, session.branch_id])

  useEffect(() => {
    fetchQueue()

    const channel = supabase
      .channel('queue')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => fetchQueue()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, session.branch_id, fetchQueue])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const myActiveEntry = entries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress'
  )
  const waitingEntries = entries.filter((e) => e.status === 'waiting')
  const otherInProgress = entries.filter(
    (e) => e.status === 'in_progress' && e.barber_id !== session.staff_id
  )

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
        <form action={logoutBarber}>
          <Button variant="ghost" size="sm" type="submit">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </form>
      </header>

      <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Queue list */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-3 md:px-6">
            <h2 className="text-lg font-semibold">Cola de espera</h2>
            <Badge variant="secondary">{waitingEntries.length} esperando</Badge>
          </div>
          <Separator />
          <ScrollArea className="flex-1">
            <div className="space-y-2 p-4 md:p-6">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
                ))
              ) : waitingEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <User className="mb-3 size-10 opacity-30" />
                  <p className="text-sm">No hay clientes en espera</p>
                </div>
              ) : (
                waitingEntries.map((entry) => (
                  <Card key={entry.id} className="gap-0 py-0">
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-lg font-bold">
                        #{entry.position}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {entry.client?.name ?? 'Cliente'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {entry.client?.phone}
                        </p>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3" />
                          <span>{formatElapsed(entry.checked_in_at)} esperando</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {!myActiveEntry && (
                          <Button
                            size="lg"
                            onClick={() => handleStartService(entry.id)}
                            disabled={actionLoading === entry.id}
                          >
                            <Scissors className="size-4" />
                            <span className="hidden sm:inline">Atender</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCancel(entry.id)}
                          disabled={actionLoading === entry.id}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}

              {otherInProgress.length > 0 && (
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
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Current client */}
        <section className="flex shrink-0 flex-col lg:w-[420px]">
          <div className="px-4 py-3 md:px-6">
            <h2 className="text-lg font-semibold">Tu cliente actual</h2>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col p-4 md:p-6">
            {myActiveEntry ? (
              <Card className="border-primary/20 bg-primary/3">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
                      #{myActiveEntry.position}
                    </div>
                    <div>
                      <CardTitle className="text-xl">
                        {myActiveEntry.client?.name ?? 'Cliente'}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {myActiveEntry.client?.phone}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-3">
                    <Clock className="size-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Tiempo de servicio
                      </p>
                      <p className="text-2xl font-bold tabular-nums tracking-tight">
                        {myActiveEntry.started_at
                          ? formatElapsed(myActiveEntry.started_at)
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {myActiveEntry.client_id && (
                    <ClientHistory clientId={myActiveEntry.client_id} />
                  )}

                  <div className="flex gap-3">
                    <Button
                      className="flex-1"
                      size="lg"
                      onClick={() => setCompletingEntry(myActiveEntry)}
                    >
                      <Check className="size-4" />
                      Finalizar
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => handleCancel(myActiveEntry.id)}
                      disabled={actionLoading === myActiveEntry.id}
                    >
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
                <Scissors className="mb-3 size-12 opacity-15" />
                <p className="font-medium">Sin cliente en atención</p>
                <p className="mt-1 max-w-[220px] text-xs opacity-60">
                  Selecciona un cliente de la cola para comenzar
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
    </div>
  )
}
