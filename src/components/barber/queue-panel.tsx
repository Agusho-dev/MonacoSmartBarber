'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import { attendNextClient, cancelQueueEntry, pauseActiveService, resumeActiveService } from '@/lib/actions/queue'
import { fetchBarberDayStats, fetchBranchAssignmentData } from '@/lib/actions/barber'
import { logoutBarber } from '@/lib/actions/auth'
import {
  requestBreak,
  getBarberActiveBreakRequest,
  cancelBreakRequest,
  completeBreakRequest,
  approveBreak as approveBreakAction,
  rejectBreak as rejectBreakAction,
  getPendingBreakRequests,
} from '@/lib/actions/break-requests'
import type { QueueEntry, Staff, Client, BreakConfig, StaffSchedule } from '@/lib/types/database'
import { assignDynamicBarbers } from '@/lib/barber-utils'
import { BarberTimeline } from '@/components/barber/barber-timeline'
import { UpcomingAppointmentBanner } from '@/components/barber/upcoming-appointment-banner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  X,
  Gift,
  Coffee,
  CheckCircle2,
  XCircle,
  Power,
  EyeOff,
  Eye,
  MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { DirectSaleDialog } from './direct-sale-dialog'
import { ClientProfileSheet } from './client-profile-sheet'
import { ActiveClientCard, ActiveBreakCard } from './active-client-card'
import { NextClientAlert } from './next-client-alert'
import { BarberStatsBar } from './barber-stats-bar'
import { primeAudioContext } from '@/lib/barber-feedback'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface BarberSession {
  staff_id: string
  full_name: string
  branch_id: string
  role: string
  role_id?: string | null
  permissions?: Record<string, boolean>
}

interface QueuePanelProps {
  session: BarberSession
  branchName: string
  breakConfigs?: BreakConfig[]
  appointments?: import('@/lib/types/database').Appointment[]
  noShowToleranceMinutes?: number
  /** Modo de operación de la sucursal: afecta el layout del panel */
  operationMode?: 'walk_in' | 'appointments' | 'hybrid'
}

interface BreakRequestRow {
  id: string
  staff_id: string
  branch_id: string
  break_config_id: string
  status: string
  cuts_before_break: number
  requested_at: string
  staff?: { id: string; full_name: string } | null
  break_config?: { name: string; duration_minutes: number } | null
}

export function QueuePanel({
  session,
  branchName,
  breakConfigs = [],
  appointments = [],
  noShowToleranceMinutes: _noShowToleranceMinutes = 15,
  operationMode = 'walk_in',
}: QueuePanelProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [completingEntry, setCompletingEntry] = useState<QueueEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [dayStats, setDayStats] = useState({ servicesCount: 0, revenue: 0 })
  const [otherBarbers, setOtherBarbers] = useState<Staff[]>([])
  const [allBarbers, setAllBarbers] = useState<Staff[]>([])
  const [notClockedInBarbers, setNotClockedInBarbers] = useState<Set<string>>(new Set())
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [profileClient, setProfileClient] = useState<Client | null>(null)
  // Break request state
  const [breakDialogOpen, setBreakDialogOpen] = useState(false)
  const [selectedBreakConfig, setSelectedBreakConfig] = useState('')
  const [breakRequestStatus, setBreakRequestStatus] = useState<string | null>(null)
  const [breakRequestId, setBreakRequestId] = useState<string | null>(null)
  const [breakRequestLoading, setBreakRequestLoading] = useState(false)
  const [breakDurationMinutes, setBreakDurationMinutes] = useState<number | null>(null)
  // Self-approve cuts
  const [selfApproveCuts, setSelfApproveCuts] = useState('0')
  // Break requests management (for barbers with breaks.grant)
  const [breakRequestsDialogOpen, setBreakRequestsDialogOpen] = useState(false)
  const [pendingBreakRequests, setPendingBreakRequests] = useState<BreakRequestRow[]>([])
  const [approveLoading, setApproveLoading] = useState<string | null>(null)
  const [approveCutsInputs, setApproveCutsInputs] = useState<Record<string, string>>({})
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dynamicCooldownMs, setDynamicCooldownMs] = useState(120_000)

  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false)
  const [deactivateLoading, setDeactivateLoading] = useState<string | null>(null)

  const [hiddenFromCheckin, setHiddenFromCheckin] = useState(false)
  const [hiddenLoading, setHiddenLoading] = useState(false)

  const [directSaleOpen, setDirectSaleOpen] = useState(false)
  // (mobilePanelTab eliminado: no se usaba en el render)

  // Next client alert state
  const [nextClientAlertMinutes, setNextClientAlertMinutes] = useState(5)
  const [idleSince, setIdleSince] = useState<number | null>(null)
  const [showWaitWarning, setShowWaitWarning] = useState(false)
  const [warningStarting, setWarningStarting] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const beepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevBreakRequestCountRef = useRef<number>(0)

  const supabase = useMemo(() => createClient(), [])
  const canManageBreaks = session.role === 'admin' || session.role === 'owner' || session.permissions?.['breaks.grant'] === true
  const canDeactivateStaff = session.role === 'admin' || session.role === 'owner' || session.permissions?.['staff.deactivate'] === true
  const canHideSelf = session.role === 'admin' || session.role === 'owner' || session.permissions?.['queue.hide_self'] === true

  const fetchQueue = useCallback(async () => {
    // Query liviano: eliminamos visits(count) — era un correlated subquery por cliente
    // que generaba 177k calls/día según pg_stat_statements. El conteo ya vive en
    // clients.total_visits y en la vista client_loyalty_state.total_visits.
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients(id, name, phone, loyalty:client_loyalty_state(total_visits)), barber:staff(id, full_name, avatar_url), service:services(id, name, duration_minutes, price)')
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

  const fetchBarbersAndSchedules = useCallback(async () => {
    const [barbersRes, schedRes, settingsRes, attendanceRes, assignmentData] = await Promise.all([
      supabase
        .from('staff')
        .select('*')
        .eq('branch_id', session.branch_id)
        .or('role.eq.barber,is_also_barber.eq.true')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('staff_schedules')
        .select('*')
        .eq('day_of_week', new Date().getDay())
        .eq('is_active', true),
      supabase
        .from('app_settings')
        .select('shift_end_margin_minutes, next_client_alert_minutes, dynamic_cooldown_seconds')
        .maybeSingle(),
      supabase
        .from('attendance_logs')
        .select('staff_id, action_type')
        .eq('branch_id', session.branch_id)
        .gte('recorded_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order('recorded_at', { ascending: false }),
      fetchBranchAssignmentData(session.branch_id),
    ])

    if (barbersRes.data) {
      setAllBarbers(barbersRes.data as Staff[])
      setOtherBarbers((barbersRes.data as Staff[]).filter(b => b.id !== session.staff_id))

      const latestAttendance: Record<string, string> = {}
      if (attendanceRes.data) {
        attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
          if (!latestAttendance[log.staff_id]) {
            latestAttendance[log.staff_id] = log.action_type
          }
        })
      }
      const notClocked = new Set<string>()
      for (const b of barbersRes.data as Staff[]) {
        if (latestAttendance[b.id] !== 'clock_in') {
          notClocked.add(b.id)
        }
      }
      setNotClockedInBarbers(notClocked)
    }

    if (schedRes.data) {
      setSchedules(schedRes.data as StaffSchedule[])
    }

    if (settingsRes.data) {
      const settingsData = settingsRes.data as { shift_end_margin_minutes?: number; next_client_alert_minutes?: number; dynamic_cooldown_seconds?: number }
      const margin = settingsData.shift_end_margin_minutes
      if (typeof margin === 'number' && margin >= 0) {
        setShiftEndMargin(margin)
      }
      const alertMin = settingsData.next_client_alert_minutes
      if (typeof alertMin === 'number' && alertMin > 0) {
        setNextClientAlertMinutes(alertMin)
      }
      const cooldownSec = settingsData.dynamic_cooldown_seconds
      if (typeof cooldownSec === 'number' && cooldownSec >= 0) {
        setDynamicCooldownMs(cooldownSec * 1000)
      }
    }

    setDailyServiceCounts(assignmentData.dailyServiceCounts ?? {})
    setLastCompletedAt(assignmentData.lastCompletedAt ?? {})
  }, [supabase, session.branch_id, session.staff_id])

  const fetchBreakRequestStatus = useCallback(async () => {
    const { data } = await getBarberActiveBreakRequest(session.staff_id)
    if (data) {
      setBreakRequestStatus(data.status)
      setBreakRequestId(data.id)
      setBreakDurationMinutes((data.break_config as { duration_minutes?: number } | null)?.duration_minutes ?? null)
    } else {
      setBreakRequestStatus(null)
      setBreakRequestId(null)
      setBreakDurationMinutes(null)
    }
  }, [session.staff_id])

  const fetchPendingBreakRequests = useCallback(async () => {
    if (!canManageBreaks) return
    const { data } = await getPendingBreakRequests(session.branch_id)
    if (data) {
      // Filter out the current barber's own requests
      setPendingBreakRequests(
        (data as BreakRequestRow[]).filter(r => r.staff_id !== session.staff_id)
      )
    }
  }, [canManageBreaks, session.branch_id, session.staff_id])

  const fetchHiddenStatus = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('hidden_from_checkin')
      .eq('id', session.staff_id)
      .single()
    if (data) setHiddenFromCheckin(data.hidden_from_checkin ?? false)
  }, [supabase, session.staff_id])

  useEffect(() => {
    fetchQueue()
    refreshStats()
    fetchBarbersAndSchedules()
    fetchBreakRequestStatus()
    fetchPendingBreakRequests()
    fetchHiddenStatus()

    const channel = supabase
      .channel(`barber-queue-${session.branch_id}-${session.staff_id}`)
      // queue_entries → solo refresca cola + stats, NO barbers/schedules (son datos estables)
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
      // staff → solo refresca barberos + estado de visibilidad propio
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchBarbersAndSchedules()
          fetchHiddenStatus()
        }
      )
      // break_requests filtrado por branch_id para evitar stampede multi-sucursal
      // (attendance_logs fue removido de supabase_realtime publication — listener eliminado)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'break_requests',
          filter: `branch_id=eq.${session.branch_id}`,
        },
        () => {
          fetchBreakRequestStatus()
          fetchPendingBreakRequests()
        }
      )
      .subscribe((status) => {
        // Re-fetch todo al reconectar el WebSocket
        if (status === 'SUBSCRIBED') {
          fetchQueue()
          refreshStats()
          fetchBarbersAndSchedules()
          fetchBreakRequestStatus()
          fetchPendingBreakRequests()
          fetchHiddenStatus()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, session.branch_id, session.staff_id, fetchQueue, refreshStats, fetchBarbersAndSchedules, fetchBreakRequestStatus, fetchPendingBreakRequests, fetchHiddenStatus])

  // Al volver al tab o en el polling fallback, refrescamos solo la cola y las stats.
  // Los datos de barberos/schedules cambian con poca frecuencia y se refrescan
  // cuando el WebSocket reconecta (evento SUBSCRIBED). Esto reduce el burst de queries
  // cuando múltiples tablets reconectan simultáneamente.
  useVisibilityRefresh(
    useCallback(() => {
      fetchQueue()
      refreshStats()
    }, [fetchQueue, refreshStats]),
    30_000
  )

  useEffect(() => {
    // 5s en lugar de 1s: los textos "elapsed" no necesitan resolución de segundo,
    // y bajar la frecuencia ahorra 30-60% de CPU en tablets de gama baja.
    const interval = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(interval)
  }, [])

  // Timestamp estable para la asignación dinámica: solo cambia cuando los datos subyacentes
  // cambian (entries, barbers, etc.), NO cada segundo. Esto garantiza que todos los
  // dispositivos que reciben el mismo evento Realtime calculen la misma asignación,
  // evitando que clientes aparezcan en la fila de barberos distintos por diferencias de reloj.
  const assignmentTimeRef = useRef<number>(Date.now())
  useEffect(() => {
    assignmentTimeRef.current = Date.now()
  }, [entries, allBarbers, dailyServiceCounts, lastCompletedAt, notClockedInBarbers])
  const assignmentTime = assignmentTimeRef.current

  const dynamicEntries = useMemo(() => {
    return assignDynamicBarbers(entries, allBarbers, schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, dynamicCooldownMs)
  }, [entries, allBarbers, schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, dynamicCooldownMs])

  // My active break (ghost entry that is in_progress)
  const myActiveBreak = dynamicEntries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress' && e.is_break
  )

  const myActiveEntry = dynamicEntries.find(
    (e) => e.barber_id === session.staff_id && e.status === 'in_progress' && !e.is_break
  )

  // "Mi fila": only entries assigned to this barber (by DB or by assignDynamicBarbers).
  // Nunca mostramos entries con barber_id=null aquí para evitar que el mismo cliente
  // aparezca en la fila de múltiples barberos simultáneamente.
  // La asignación real ocurre en el servidor via attendNextClient(), esto es solo visualización.
  const myWaitingEntries = dynamicEntries
    .filter(
      (e) =>
        e.status === 'waiting' &&
        e.barber_id === session.staff_id
    )
    .sort((a, b) => {
      if (a.is_break !== b.is_break) return a.is_break ? 1 : -1
      if (a.is_break && b.is_break) return a.position - b.position
      return new Date(a.priority_order).getTime() - new Date(b.priority_order).getTime()
    })

  // "Fila general": ALL waiting clients
  const allWaitingEntries = dynamicEntries.filter((e) => e.status === 'waiting')

  // Real waiting clients for this barber (non-break)
  const myRealWaitingEntries = myWaitingEntries.filter(e => !e.is_break)

  // ── Next client alert logic ──
  // Track when barber becomes idle with clients waiting
  useEffect(() => {
    const isIdle = !myActiveEntry && !myActiveBreak
    const hasWaiting = myRealWaitingEntries.length > 0

    if (isIdle && hasWaiting) {
      // Start tracking idle time if not already
      setIdleSince(prev => prev ?? Date.now())
    } else {
      // Reset when barber is busy, on break, or no clients waiting
      setIdleSince(null)
      setShowWaitWarning(false)
    }
  }, [myActiveEntry, myActiveBreak, myRealWaitingEntries.length])

  // Check if countdown has expired
  useEffect(() => {
    if (!idleSince || showWaitWarning) return

    const thresholdMs = nextClientAlertMinutes * 60_000
    const elapsed = now - idleSince

    if (elapsed >= thresholdMs) {
      setShowWaitWarning(true)
      // Vibrate if supported
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200])
      }
    }
  }, [now, idleSince, nextClientAlertMinutes, showWaitWarning])

  // Play beep sound when warning is active
  useEffect(() => {
    if (!showWaitWarning) {
      // Stop beep
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
      return
    }

    const playBeep = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        }
        const ctx = audioContextRef.current
        if (ctx.state === 'suspended') ctx.resume()

        const oscillator = ctx.createOscillator()
        const gainNode = ctx.createGain()
        oscillator.connect(gainNode)
        gainNode.connect(ctx.destination)

        oscillator.frequency.value = 880
        oscillator.type = 'sine'
        gainNode.gain.setValueAtTime(0.15, ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)

        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.4)
      } catch {
        // Audio not available
      }
    }

    // Play immediately + every 3 seconds
    playBeep()
    beepIntervalRef.current = setInterval(playBeep, 3000)

    return () => {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current)
        beepIntervalRef.current = null
      }
    }
  }, [showWaitWarning])

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (beepIntervalRef.current) clearInterval(beepIntervalRef.current)
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
    }
  }, [])

  // Bell sound when a new break request arrives (for managers)
  useEffect(() => {
    const currentCount = pendingBreakRequests.length
    if (canManageBreaks && currentCount > prevBreakRequestCountRef.current && prevBreakRequestCountRef.current >= 0) {
      // Only play if we had a previous count (not initial load when ref is 0 and count > 0 on first real change)
      if (prevBreakRequestCountRef.current > 0 || currentCount > 0) {
        try {
          if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          }
          const ctx = audioContextRef.current
          if (ctx.state === 'suspended') ctx.resume()

          // Bell-like tone: two harmonics for a richer "ding"
          const playTone = (freq: number, delay: number) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = freq
            osc.type = 'sine'
            gain.gain.setValueAtTime(0.2, ctx.currentTime + delay)
            gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + delay + 0.6)
            osc.start(ctx.currentTime + delay)
            osc.stop(ctx.currentTime + delay + 0.6)
          }
          playTone(523, 0)     // C5
          playTone(659, 0)     // E5 - harmony
          playTone(784, 0.15)  // G5 - second ding
        } catch {
          // Audio not available
        }
      }
    }
    prevBreakRequestCountRef.current = currentCount
  }, [pendingBreakRequests.length, canManageBreaks])

  async function handleWarningStartService() {
    const firstEntry = myRealWaitingEntries[0]
    if (!firstEntry || warningStarting) return
    setWarningStarting(true)
    await handleStartService(firstEntry.id)
    setShowWaitWarning(false)
    setIdleSince(null)
    setWarningStarting(false)
  }

  const otherInProgress = dynamicEntries.filter(
    (e) => e.status === 'in_progress' && e.barber_id !== session.staff_id && !e.is_break
  )

  // Turno próximo para el banner de conflicto (modo hybrid): dentro de los próximos 15 min
  // y no está checked_in todavía.
  const upcomingAppointmentForBanner = useMemo(() => {
    if (operationMode !== 'hybrid') return null
    const nowDate = new Date()
    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
    return appointments.find((a) => {
      if (!['confirmed'].includes(a.status)) return false
      const [h, m] = a.start_time.split(':').map(Number)
      const apptMinutes = h * 60 + m
      const diff = apptMinutes - nowMinutes
      return diff >= 0 && diff <= 15
    }) ?? null
  }, [appointments, operationMode])

  async function handleStartService(entryId: string) {
    setActionLoading(entryId)
    const result = await attendNextClient(session.staff_id, session.branch_id, entryId)
    if ('error' in result) {
      toast.error(result.error)
    } else if (!result.entryId) {
      toast.info('No hay clientes en espera')
    } else if (result.entryId !== entryId) {
      toast.info('El cliente fue tomado por otro barbero. Se asignó el siguiente.')
    }
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

  async function handleCancelBreakRequest() {
    if (!breakRequestId) return
    setBreakRequestLoading(true)
    const result = await cancelBreakRequest(breakRequestId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Solicitud de descanso cancelada')
      setBreakRequestStatus(null)
      setBreakRequestId(null)
    }
    setBreakRequestLoading(false)
    fetchQueue()
  }

  async function handleCompleteBreak() {
    if (!myActiveBreak) return
    setActionLoading(myActiveBreak.id)
    const result = await completeBreakRequest(myActiveBreak.id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Descanso finalizado')
      setBreakRequestStatus(null)
      setBreakRequestId(null)
    }
    await fetchQueue()
    setActionLoading(null)
  }

  async function handlePauseActive() {
    if (!myActiveEntry) return
    const result = await pauseActiveService(myActiveEntry.id)
    if ('error' in result && result.error) {
      toast.error(result.error)
    } else {
      toast.success('Corte en pausa')
    }
    await fetchQueue()
  }

  async function handleResumeActive() {
    if (!myActiveEntry) return
    const result = await resumeActiveService(myActiveEntry.id)
    if ('error' in result && result.error) {
      toast.error(result.error)
    } else {
      toast.success('Corte reanudado')
    }
    await fetchQueue()
  }

  async function handleApproveOtherBreak(requestId: string) {
    const cuts = parseInt(approveCutsInputs[requestId] || '0', 10)
    if (isNaN(cuts) || cuts < 0) { toast.error('Número de cortes inválido'); return }
    setApproveLoading(requestId)
    const result = await approveBreakAction(requestId, cuts)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Descanso aprobado')
      fetchPendingBreakRequests()
      fetchQueue()
    }
    setApproveLoading(null)
  }

  async function handleRejectOtherBreak(requestId: string) {
    setApproveLoading(requestId)
    const result = await rejectBreakAction(requestId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Solicitud rechazada')
      fetchPendingBreakRequests()
    }
    setApproveLoading(null)
  }

  async function handleDeactivateBarber(barberId: string) {
    setDeactivateLoading(barberId)
    const { deactivateBarber } = await import('@/lib/actions/barber')
    const result = await deactivateBarber(barberId)
    if (result.error) {
      toast.error(result.error)
    } else {
      const msg = result.reassignedCount && result.reassignedCount > 0
        ? `Barbero desactivado. ${result.reassignedCount} cliente(s) reasignados.`
        : 'Barbero desactivado'
      toast.success(msg)
      fetchBarbersAndSchedules()
      fetchQueue()
    }
    setDeactivateLoading(null)
  }

  async function handleToggleVisibility() {
    setHiddenLoading(true)
    const { toggleBarberVisibility } = await import('@/lib/actions/barber')
    const result = await toggleBarberVisibility(session.staff_id)
    if (result.error) {
      toast.error(result.error)
    } else {
      setHiddenFromCheckin(result.hidden ?? false)
      toast.success(result.hidden ? 'Te ocultaste del check-in' : 'Volviste a ser visible en el check-in')
    }
    setHiddenLoading(false)
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

  function renderGhostBreakEntry(entry: QueueEntry) {
    // Count real waiting clients before this ghost for this barber
    const myRealWaiting = entries.filter(
      e => e.status === 'waiting' && !e.is_break && e.barber_id === session.staff_id && e.position < entry.position
    ).length

    return (
      <Card key={entry.id} className="gap-0 py-0 border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-center gap-4 p-5 md:p-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
            <Coffee className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-amber-600">Tu descanso</p>
            <p className="text-sm text-muted-foreground">
              {myRealWaiting === 0
                ? 'Siguiente en atenderse'
                : `En ${myRealWaiting} corte${myRealWaiting > 1 ? 's' : ''}`}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  function renderQueueEntry(entry: QueueEntry, isGeneralQueue: boolean = false) {
    // Render ghost break entries differently
    if (entry.is_break) {
      if (entry.barber_id === session.staff_id) {
        return renderGhostBreakEntry(entry)
      }
      return null // Don't show other barbers' ghost breaks
    }

    // (isMyEntry / isReassigning eliminados — no se usan en el render actual)

    return (
      <div key={entry.id} className="space-y-2">
        <Card className="gap-0 py-0">
          <CardContent className="flex items-center gap-2.5 sm:gap-4 p-3 sm:p-5 md:p-6">
            <div className="flex size-10 sm:size-14 shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-secondary text-sm sm:text-xl font-bold">
              #{entry.position}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <p className="truncate text-base sm:text-lg font-semibold">
                  {entry.client?.name ?? 'Cliente'}
                </p>
                {(() => {
                  const phone = entry.client?.phone ?? ''
                  const isKid = phone.startsWith('00') && phone.length === 10
                  if (isKid) {
                    return (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/30">
                        Especial
                      </Badge>
                    )
                  }
                  // Usamos total_visits del cliente directamente (desnormalizado en clients)
                  // o lo tomamos de la vista loyalty si está disponible. Ya no existe visits(count).
                  const totalVisits = entry.client?.total_visits
                    ?? entry.client?.loyalty?.[0]?.total_visits
                    ?? 0
                  if (totalVisits === 0) {
                    return (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
                        Primer Corte
                      </Badge>
                    )
                  }
                  return null
                })()}
                {entry.is_dynamic && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-wider bg-blue-500/15 text-blue-500 border-blue-500/30">
                    ⚡️ Menor Espera
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{entry.client?.phone}</span>
                {entry.service && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="font-medium text-foreground/70">
                      {entry.service.name}
                    </span>
                  </>
                )}
              </div>
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
              {isGeneralQueue && entry.barber && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="size-3" />
                  <span>Se atiende con <span className="font-medium text-foreground/70">{entry.barber.full_name}</span></span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {(!myActiveEntry && !myActiveBreak && entry.id === myWaitingEntries[0]?.id) && (
                <Button
                  size="sm"
                  className="h-10 px-3 sm:h-14 sm:px-6 text-sm sm:text-lg"
                  onClick={() => handleStartService(entry.id)}
                  disabled={actionLoading === entry.id}
                >
                  <Scissors className="size-4 sm:size-5 sm:mr-2" />
                  <span className="hidden sm:inline">Atender</span>
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionLoading === entry.id}
                    className="size-10 sm:size-14 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="No se presentó / Ausente"
                  >
                    <X className="size-4 sm:size-6" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿El cliente no se presentó?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esto marcará a <strong>{entry.client?.name ?? 'Cliente'}</strong> como Ausente y lo quitará de la fila de espera de forma permanente.
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
      <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
        <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-muted animate-float">
          <Scissors className="size-8 text-muted-foreground/60" />
        </div>
        <p className="text-base font-bold">Esperando clientes</p>
        <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
          Cuando llegue alguien aparecerá acá.
        </p>
        {dayStats.servicesCount > 0 && (
          <p className="mt-3 text-[11px] font-semibold text-muted-foreground">
            Hoy: {dayStats.servicesCount} corte{dayStats.servicesCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
    )
  }
  return (
    <div
      className="flex h-[calc(100dvh-4rem)] flex-col bg-background"
      onPointerDown={primeAudioContext}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 backdrop-blur px-3 py-2.5 md:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Scissors className="size-3.5 sm:size-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="font-semibold leading-none text-sm sm:text-base">{session.full_name}</p>
              {hiddenFromCheckin && (
                <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-500 border-amber-500/30">
                  <EyeOff className="size-2.5 mr-0.5" />
                  Oculto
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{branchName}</p>
          </div>
        </div>

        {/* Stats del día — visible entre el nombre y los controles */}
        <div className="hidden md:block mx-4 flex-1">
          <BarberStatsBar servicesCount={dayStats.servicesCount} />
        </div>

        {/* Desktop: all buttons inline */}
        <div className="hidden sm:flex items-center gap-2">
          {!breakRequestStatus && !myActiveBreak && breakConfigs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setBreakDialogOpen(true)}>
              <Coffee className="size-4" />
              Descanso
            </Button>
          )}
          {breakRequestStatus === 'pending' && (
            <Button variant="ghost" size="sm" className="text-yellow-500" onClick={handleCancelBreakRequest} disabled={breakRequestLoading}>
              <Coffee className="size-4 mr-1" />
              Solicitado
              <X className="size-3 ml-1" />
            </Button>
          )}
          {breakRequestStatus === 'approved' && !myActiveBreak && (
            <Badge variant="outline" className="bg-green-500/15 text-green-600 border-green-500/30">
              <Coffee className="size-3 mr-1" />
              Aprobado
            </Badge>
          )}
          {canManageBreaks && (
            <Button variant="ghost" size="sm" onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }} className="relative">
              <Coffee className="size-4" />
              Gestionar
              {pendingBreakRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  {pendingBreakRequests.length}
                </span>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setDirectSaleOpen(true)}>
            <Gift className="size-4" />
            Vender
          </Button>
          {canHideSelf && (
            <Button variant="ghost" size="sm" onClick={handleToggleVisibility} disabled={hiddenLoading} className={hiddenFromCheckin ? 'text-amber-500' : ''}>
              {hiddenFromCheckin ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {hiddenFromCheckin ? 'Oculto' : 'Visible'}
            </Button>
          )}
          {canDeactivateStaff && otherBarbers.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDeactivateDialogOpen(true)}>
              <Power className="size-4" />
              Barberos
            </Button>
          )}
          <form action={logoutBarber}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut className="size-4" />
              Salir
            </Button>
          </form>
        </div>

        {/* Mobile: break status + overflow menu */}
        <div className="flex sm:hidden items-center gap-1.5">
          {/* Break status — always visible on mobile */}
          {!breakRequestStatus && !myActiveBreak && breakConfigs.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setBreakDialogOpen(true)}>
              <Coffee className="size-4" />
            </Button>
          )}
          {breakRequestStatus === 'pending' && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-yellow-500" onClick={handleCancelBreakRequest} disabled={breakRequestLoading}>
              <Coffee className="size-4" />
              <X className="size-3 ml-0.5" />
            </Button>
          )}
          {breakRequestStatus === 'approved' && !myActiveBreak && (
            <Badge variant="outline" className="h-6 px-1.5 bg-green-500/15 text-green-600 border-green-500/30 text-[10px]">
              <Coffee className="size-3 mr-0.5" />
              OK
            </Badge>
          )}
          {canManageBreaks && pendingBreakRequests.length > 0 && (
            <button
              onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }}
              className="relative flex size-8 items-center justify-center rounded-md hover:bg-muted/50"
            >
              <Coffee className="size-4" />
              <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pendingBreakRequests.length}
              </span>
            </button>
          )}

          {/* Overflow dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 px-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canManageBreaks && (
                <DropdownMenuItem onClick={() => { fetchPendingBreakRequests(); setBreakRequestsDialogOpen(true) }}>
                  <Coffee className="size-4 mr-2" />
                  Gestionar descansos
                  {pendingBreakRequests.length > 0 && (
                    <Badge className="ml-auto h-4 px-1 text-[10px] bg-amber-500">{pendingBreakRequests.length}</Badge>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDirectSaleOpen(true)}>
                <Gift className="size-4 mr-2" />
                Venta directa
              </DropdownMenuItem>
              {canHideSelf && (
                <DropdownMenuItem onClick={handleToggleVisibility} disabled={hiddenLoading}>
                  {hiddenFromCheckin ? <EyeOff className="size-4 mr-2 text-amber-500" /> : <Eye className="size-4 mr-2" />}
                  {hiddenFromCheckin ? 'Volver a ser visible' : 'Ocultarme del check-in'}
                </DropdownMenuItem>
              )}
              {canDeactivateStaff && otherBarbers.length > 0 && (
                <DropdownMenuItem onClick={() => setDeactivateDialogOpen(true)}>
                  <Power className="size-4 mr-2" />
                  Gestionar barberos
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <form action={logoutBarber}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="w-full flex items-center text-destructive focus:text-destructive">
                    <LogOut className="size-4 mr-2" />
                    Cerrar sesión
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Banner de turno próximo — solo modo hybrid */}
      {operationMode === 'hybrid' && upcomingAppointmentForBanner && (
        <UpcomingAppointmentBanner
          appointment={upcomingAppointmentForBanner}
          staffId={session.staff_id}
          branchId={session.branch_id}
        />
      )}

      <main className="flex flex-1 flex-col overflow-hidden sm:flex-row">

        {/* ── MODO APPOINTMENTS: solo timeline, sin tab de cola ── */}
        {operationMode === 'appointments' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <BarberTimeline
              session={session}
              initialAppointments={appointments}
            />
          </div>
        )}

        {/* ── MODO HYBRID: timeline (60%) + cola walk-in (40%) ── */}
        {operationMode === 'hybrid' && (
          <>
            {/* Timeline de turnos */}
            <div className="flex flex-col overflow-hidden sm:flex-[3]">
              <BarberTimeline
                session={session}
                initialAppointments={appointments}
              />
            </div>

            {/* Cola walk-in lateral */}
            <div className="flex flex-col overflow-hidden border-t sm:border-t-0 sm:border-l sm:flex-[2]">
              <div className="shrink-0 border-b px-3 py-2 bg-card/60">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Cola walk-in
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="space-y-2 p-3">
                  {loading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
                    ))
                  ) : myWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    myWaitingEntries.map((e) => renderQueueEntry(e, false))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </div>
              {(myActiveEntry || myActiveBreak) && (
                <div className="shrink-0 border-t p-3">
                  {myActiveBreak ? (
                    <ActiveBreakCard
                      startedAt={myActiveBreak.started_at}
                      durationMinutes={breakDurationMinutes}
                      onComplete={handleCompleteBreak}
                      actionLoading={actionLoading === myActiveBreak.id}
                    />
                  ) : myActiveEntry ? (
                    <ActiveClientCard
                      entry={myActiveEntry}
                      variant="mobile"
                      onComplete={() => setCompletingEntry(myActiveEntry)}
                      onPause={handlePauseActive}
                      onResume={handleResumeActive}
                      actionLoading={actionLoading === myActiveEntry.id}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── MODO WALK_IN: layout original sin cambios ── */}
        {operationMode === 'walk_in' && (
          <>
        {/* ── MOBILE: unified layout ── */}
        <div className="flex flex-1 flex-col overflow-hidden sm:hidden bg-background">
          {/* Stats compactos mobile */}
          {dayStats.servicesCount > 0 && (
            <div className="border-b bg-card/80 px-3 py-2">
              <BarberStatsBar
                servicesCount={dayStats.servicesCount}
                className="justify-center"
              />
            </div>
          )}
          <Tabs defaultValue="my-queue" className="flex flex-1 flex-col overflow-hidden h-full">
            <div className="px-3 pt-3 pb-2 bg-card border-b">
              <TabsList className="w-full h-11 bg-muted/80 p-1">
                <TabsTrigger value="my-queue" className="flex-1 text-sm h-9">
                  Mi fila
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm bg-background">
                    {myWaitingEntries.filter((e) => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="general-queue" className="flex-1 text-sm h-9">
                  General
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm bg-background">
                    {allWaitingEntries.filter((e) => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                {appointments.length > 0 && (
                  <TabsTrigger value="appointments" className="flex-1 text-sm h-9">
                    Turnos
                    <Badge variant="secondary" className="ml-2 px-1.5 py-0 min-w-5 h-5 flex items-center justify-center text-[11px] font-bold shadow-sm bg-background">
                      {appointments.filter((a) => ['confirmed', 'checked_in'].includes(a.status)).length}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <TabsContent value="my-queue" className="mt-0 flex-1 overflow-hidden bg-muted/10">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3 pb-8">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                    ))
                  ) : myWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    myWaitingEntries.map((e) => renderQueueEntry(e, false))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="general-queue" className="mt-0 flex-1 overflow-hidden bg-muted/10">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3 pb-8">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                    ))
                  ) : allWaitingEntries.length === 0 ? (
                    renderEmptyQueue()
                  ) : (
                    allWaitingEntries.map((e) => renderQueueEntry(e, true))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
            {appointments.length > 0 && (
              <TabsContent value="appointments" className="mt-0 flex-1 overflow-hidden bg-muted/10">
                <div className="h-full overflow-hidden">
                  <BarberTimeline
                    session={session}
                    initialAppointments={appointments}
                  />
                </div>
              </TabsContent>
            )}
          </Tabs>

          {/* TIMER ABAJO (Sticky Footer para cliente/break activo) */}
          {(myActiveEntry || myActiveBreak) && (
            <div className="shrink-0 max-h-[60vh] overflow-y-auto border-t border-border/50 bg-background/80 backdrop-blur z-10 pb-safe">
              <div className="p-3 sm:p-4">
                {myActiveBreak ? (
                  <ActiveBreakCard
                    startedAt={myActiveBreak.started_at}
                    durationMinutes={breakDurationMinutes}
                    onComplete={handleCompleteBreak}
                    actionLoading={actionLoading === myActiveBreak.id}
                  />
                ) : myActiveEntry ? (
                  <ActiveClientCard
                    entry={myActiveEntry}
                    variant="mobile"
                    onComplete={() => setCompletingEntry(myActiveEntry)}
                    onPause={handlePauseActive}
                    onResume={handleResumeActive}
                    actionLoading={actionLoading === myActiveEntry.id}
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* ── DESKTOP: side-by-side layout ── */}
        {/* Queue list */}
        <section className="hidden sm:flex min-h-0 flex-1 flex-col overflow-hidden border-r">
          <Tabs defaultValue="my-queue" className="flex flex-1 flex-col overflow-hidden">
            <div className="px-3 py-2 md:px-5">
              <TabsList className="w-full">
                <TabsTrigger value="my-queue" className="flex-1 py-2 md:py-3 text-base md:text-lg">
                  Mi fila
                  <Badge variant="secondary" className="ml-2 px-2 text-base">
                    {myWaitingEntries.filter(e => !e.is_break).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="general-queue" className="flex-1 py-2 md:py-3 text-base md:text-lg">
                  Fila general
                  <Badge variant="secondary" className="ml-2 px-2 text-base">
                    {allWaitingEntries.filter(e => !e.is_break).length}
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
                    myWaitingEntries.map((e) => renderQueueEntry(e, false))
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
                    allWaitingEntries.map((e) => renderQueueEntry(e, true))
                  )}
                  {!loading && renderInProgressOthers()}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </section>

        {/* Current client / Active break — desktop only */}
        <section className="hidden sm:flex shrink-0 flex-col sm:w-[340px] md:w-[400px] lg:w-[460px]">
          <div className="px-5 py-4 md:px-6 md:py-5">
            <h2 className="text-xl md:text-2xl font-black tracking-tight">
              {myActiveBreak ? 'En descanso' : myActiveEntry ? 'Cliente actual' : 'Sin cliente'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {myActiveBreak
                ? 'Tomate el tiempo que necesites'
                : myActiveEntry
                  ? 'El color de abajo indica tu ritmo'
                  : 'Seleccioná un cliente de la fila'}
            </p>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col p-4 md:p-5">
            {myActiveBreak ? (
              <ActiveBreakCard
                startedAt={myActiveBreak.started_at}
                durationMinutes={breakDurationMinutes}
                onComplete={handleCompleteBreak}
                actionLoading={actionLoading === myActiveBreak.id}
              />
            ) : myActiveEntry ? (
              <ActiveClientCard
                entry={myActiveEntry}
                variant="desktop"
                onComplete={() => setCompletingEntry(myActiveEntry)}
                onPause={handlePauseActive}
                onResume={handleResumeActive}
                actionLoading={actionLoading === myActiveEntry.id}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="flex size-20 items-center justify-center rounded-3xl bg-muted animate-float">
                  <Scissors className="size-10 text-muted-foreground/50" />
                </div>
                <p className="mt-4 text-lg font-bold">Listo para atender</p>
                <p className="mt-1 max-w-[260px] text-sm text-muted-foreground">
                  Cuando un cliente entre a tu fila, apretá <span className="font-semibold text-foreground">Atender</span> para empezar.
                </p>
              </div>
            )}
          </div>
        </section>
          </>
        )}
        {/* ── FIN MODO WALK_IN ── */}
      </main>

      {/* Next client waiting warning overlay */}
      {showWaitWarning && (
        <NextClientAlert
          clientName={myRealWaitingEntries[0]?.client?.name ?? null}
          onStart={handleWarningStartService}
          starting={warningStarting}
        />
      )}

      <CompleteServiceDialog
        entry={completingEntry}
        branchId={session.branch_id}
        onClose={() => setCompletingEntry(null)}
        onCompleted={fetchQueue}
      />

      <DirectSaleDialog
        open={directSaleOpen}
        branchId={session.branch_id}
        barberId={session.staff_id}
        onClose={() => setDirectSaleOpen(false)}
        onCompleted={() => {
          refreshStats()
        }}
      />

      <ClientProfileSheet
        client={profileClient}
        isOpen={!!profileClient}
        onClose={() => setProfileClient(null)}
      />

      {/* Break request dialog */}
      <Dialog open={breakDialogOpen} onOpenChange={setBreakDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canManageBreaks ? 'Tomar descanso' : 'Solicitar descanso'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Seleccioná el tipo de descanso:</p>
              <Select value={selectedBreakConfig} onValueChange={setSelectedBreakConfig}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de descanso..." />
                </SelectTrigger>
                <SelectContent>
                  {breakConfigs.filter(bc => bc.is_active && bc.branch_id === session.branch_id).map((bc) => (
                    <SelectItem key={bc.id} value={bc.id}>
                      {bc.name} ({bc.duration_minutes} min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canManageBreaks && (
              <div>
                <Label className="text-sm">¿Luego de cuántos cortes?</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    className="w-24"
                    value={selfApproveCuts}
                    onChange={(e) => setSelfApproveCuts(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">cortes (0 = ahora)</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBreakDialogOpen(false)}>Cancelar</Button>
            <Button
              disabled={!selectedBreakConfig || breakRequestLoading}
              onClick={async () => {
                setBreakRequestLoading(true)
                if (canManageBreaks) {
                  const cuts = parseInt(selfApproveCuts, 10) || 0
                  // Request + auto-approve
                  const reqResult = await requestBreak(session.staff_id, session.branch_id, selectedBreakConfig)
                  if (reqResult.error) {
                    toast.error(reqResult.error)
                  } else {
                    // Get the request ID and approve it
                    const { data: req } = await getBarberActiveBreakRequest(session.staff_id)
                    if (req) {
                      const approveResult = await approveBreakAction(req.id, cuts)
                      if (approveResult.error) {
                        toast.error(approveResult.error)
                      } else {
                        toast.success(cuts === 0 ? 'Descanso iniciado' : `Descanso programado en ${cuts} corte${cuts > 1 ? 's' : ''}`)
                        setBreakRequestStatus('approved')
                        setBreakRequestId(req.id)
                        fetchQueue()
                      }
                    }
                  }
                } else {
                  const result = await requestBreak(session.staff_id, session.branch_id, selectedBreakConfig)
                  if (result.error) {
                    toast.error(result.error)
                  } else {
                    toast.success('Solicitud de descanso enviada')
                    setBreakRequestStatus('pending')
                    fetchBreakRequestStatus()
                  }
                }
                setBreakDialogOpen(false)
                setSelectedBreakConfig('')
                setSelfApproveCuts('0')
                setBreakRequestLoading(false)
              }}
            >
              <Coffee className="size-4 mr-2" />
              {canManageBreaks ? 'Iniciar' : 'Solicitar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage break requests dialog (for barbers with breaks.grant) */}
      <Dialog open={breakRequestsDialogOpen} onOpenChange={setBreakRequestsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Solicitudes de descanso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {pendingBreakRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay solicitudes pendientes de otros barberos.
              </p>
            ) : (
              pendingBreakRequests.map((req) => {
                const staffName = req.staff?.full_name ?? 'Barbero'
                const breakName = req.break_config?.name ?? 'Descanso'
                const duration = req.break_config?.duration_minutes ?? 0
                const isPending = req.status === 'pending'

                return (
                  <div key={req.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 font-semibold text-sm">
                        {staffName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{staffName}</p>
                        <p className="text-xs text-muted-foreground">
                          {breakName} ({duration}min) · {isPending ? 'Pendiente' : `Aprobado — en ${req.cuts_before_break} cortes`}
                        </p>
                      </div>
                    </div>
                    {isPending && (
                      <div className="flex items-center gap-2">
                        <Label className="text-xs whitespace-nowrap">Luego de</Label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="w-20 h-8 text-sm"
                          value={approveCutsInputs[req.id] ?? '0'}
                          onChange={(e) => setApproveCutsInputs(prev => ({ ...prev, [req.id]: e.target.value }))}
                        />
                        <span className="text-xs text-muted-foreground">cortes</span>
                        <div className="flex-1" />
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 border-green-500/30 hover:bg-green-500/10"
                          onClick={() => handleApproveOtherBreak(req.id)}
                          disabled={approveLoading === req.id}
                        >
                          <CheckCircle2 className="size-3.5 mr-1" />
                          Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => handleRejectOtherBreak(req.id)}
                          disabled={approveLoading === req.id}
                        >
                          <XCircle className="size-3.5 mr-1" />
                          Rechazar
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate barbers dialog (for barbers with staff.deactivate) */}
      <Dialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gestionar barberos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            {otherBarbers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay otros barberos activos.
              </p>
            ) : (
              otherBarbers.map((barber) => {
                const barberWaiting = dynamicEntries.filter(
                  (e) => e.barber_id === barber.id && e.status === 'waiting' && !e.is_break
                ).length
                return (
                  <div key={barber.id} className="rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-sm">
                        {barber.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{barber.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {barberWaiting > 0
                            ? `${barberWaiting} cliente(s) en espera — serán reasignados`
                            : 'Sin clientes en espera'}
                        </p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                            disabled={deactivateLoading === barber.id}
                          >
                            <Power className="size-3.5 mr-1" />
                            Desactivar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Desactivar a {barber.full_name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {barberWaiting > 0
                                ? `Este barbero tiene ${barberWaiting} cliente(s) en espera. Serán reasignados automáticamente al barbero con menor carga.`
                                : 'Este barbero no aparecerá como opción para nuevos clientes hasta que sea reactivado.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDeactivateBarber(barber.id)}
                            >
                              Sí, desactivar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
