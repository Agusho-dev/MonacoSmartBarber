'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useVisibilityRefresh } from '@/hooks/use-visibility-refresh'
import { startService, attendNextClient, cancelQueueEntry, reassignBarber } from '@/lib/actions/queue'
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
import { formatCurrency } from '@/lib/format'
import type { QueueEntry, Staff, Client, BreakConfig, StaffSchedule } from '@/lib/types/database'
import { assignDynamicBarbers } from '@/lib/barber-utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Check,
  X,
  DollarSign,
  Gift,
  ArrowRightLeft,
  Receipt,
  Coffee,
  CheckCircle2,
  XCircle,
  Instagram,
  Power,
  EyeOff,
  Eye,
  AlertTriangle,
  MoreHorizontal,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CompleteServiceDialog } from './complete-service-dialog'
import { DirectSaleDialog } from './direct-sale-dialog'
import { ClientProfileSheet } from './client-profile-sheet'
import { ClientHistory } from './client-history'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
  const [reassigningEntryId, setReassigningEntryId] = useState<string | null>(null)
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
  const [mobilePanelTab, setMobilePanelTab] = useState<'queue' | 'active'>('queue')

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
    const { data } = await supabase
      .from('queue_entries')
      .select('*, client:clients(*, loyalty:client_loyalty_state(total_visits), visits(count)), barber:staff(*), service:services(*)')
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
        .eq('role', 'barber')
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

    setDailyServiceCounts(assignmentData.dailyServiceCounts)
    setLastCompletedAt(assignmentData.lastCompletedAt)
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
        },
        () => {
          fetchQueue()
          refreshStats()
          fetchBarbersAndSchedules()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
        },
        () => {
          fetchBarbersAndSchedules()
          fetchHiddenStatus()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'break_requests',
        },
        () => {
          fetchBreakRequestStatus()
          fetchPendingBreakRequests()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_logs',
        },
        () => {
          fetchBarbersAndSchedules()
        }
      )
      .subscribe((status) => {
        // Re-fetch everything on reconnection
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

  // Refresh data when returning to tab or as polling fallback (critical for low-end tablets)
  useVisibilityRefresh(
    useCallback(() => {
      fetchQueue()
      refreshStats()
      fetchBarbersAndSchedules()
      fetchBreakRequestStatus()
      fetchPendingBreakRequests()
      fetchHiddenStatus()
    }, [fetchQueue, refreshStats, fetchBarbersAndSchedules, fetchBreakRequestStatus, fetchPendingBreakRequests, fetchHiddenStatus]),
    30_000
  )

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Timestamp estable para la asignación dinámica: solo cambia cuando los datos subyacentes
  // cambian (entries, barbers, etc.), NO cada segundo. Esto garantiza que todos los
  // dispositivos que reciben el mismo evento Realtime calculen la misma asignación,
  // evitando que clientes aparezcan en la fila de barberos distintos por diferencias de reloj.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const assignmentTime = useMemo(() => Date.now(), [entries, allBarbers, dailyServiceCounts, lastCompletedAt, notClockedInBarbers])

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

    const isMyEntry = entry.barber_id === session.staff_id
    const isReassigning = reassigningEntryId === entry.id

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
                  const realVisits = entry.client?.visits?.[0]?.count ?? 0
                  const loyaltyVisits = entry.client?.loyalty?.[0]?.total_visits ?? 0
                  if (Math.max(realVisits, loyaltyVisits) === 0) {
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
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <User className="mb-3 size-10 opacity-30" />
        <p className="text-sm">No hay clientes en espera</p>
      </div>
    )
  }
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col bg-background">
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

      <main className="flex flex-1 flex-col overflow-hidden sm:flex-row">

        {/* ── MOBILE: unified layout ── */}
        <div className="flex flex-1 flex-col overflow-hidden sm:hidden bg-background">
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
          </Tabs>

          {/* TIMER PARA ABAJO (Sticky Footer for Active Client) */}
          {(myActiveEntry || myActiveBreak) && (
            <div className="shrink-0 max-h-[60vh] overflow-y-auto border-t border-primary/20 bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.12)] z-10 pb-safe">
              <div className="p-3 sm:p-4">
                {myActiveBreak ? (
                  (() => {
                    const breakElapsedMs = myActiveBreak.started_at ? now - new Date(myActiveBreak.started_at).getTime() : 0
                    const breakDurationMs = (breakDurationMinutes ?? 0) * 60_000
                    const isBreakOverdue = breakDurationMinutes !== null && breakDurationMinutes > 0 && breakElapsedMs > breakDurationMs
                    const overdueMs = Math.max(0, breakElapsedMs - breakDurationMs)
                    const formatOverdue = (ms: number) => {
                      const totalSeconds = Math.floor(ms / 1000)
                      const m = Math.floor(totalSeconds / 60)
                      const s = totalSeconds % 60
                      return `${m}m ${s}s`
                    }
                    return (
                      <Card className={`border-none ${isBreakOverdue ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
                        <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
                          <CardTitle className={`text-lg flex items-center gap-2 ${isBreakOverdue ? 'text-red-600' : 'text-amber-700'}`}>
                            <Coffee className={`size-5 ${isBreakOverdue ? 'text-red-500' : 'text-amber-600'}`} />
                            {isBreakOverdue ? 'Demorado' : 'Descanso'}
                          </CardTitle>
                          <p className={`text-2xl font-bold tabular-nums tracking-tight ${isBreakOverdue ? 'text-red-600' : 'text-amber-700'}`}>
                            {myActiveBreak.started_at ? (isBreakOverdue ? formatOverdue(overdueMs) : formatElapsed(myActiveBreak.started_at)) : '—'}
                          </p>
                        </CardHeader>
                        <CardContent className="p-3 pt-1">
                          <Button className={`h-12 w-full text-base font-semibold ${isBreakOverdue ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700 text-white'}`} size="lg" onClick={handleCompleteBreak} disabled={actionLoading === myActiveBreak.id}>
                            <Check className="mr-2 size-5" />
                            Finalizar descanso
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })()
                ) : myActiveEntry ? (
                  <Card className="border border-primary/30 bg-primary/5 shadow-sm">
                    <CardHeader className="p-3 pb-2 flex flex-row items-start gap-3 space-y-0">
                      <div className="flex size-11 pt-[2px] shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground shadow-sm">
                        #{myActiveEntry.position}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <CardTitle className="text-base sm:text-lg leading-tight truncate font-bold flex items-center gap-1.5">
                          {myActiveEntry.client?.name ?? 'Cliente'}
                        </CardTitle>
                        <p className="text-xs font-semibold text-primary mt-0.5 truncate bg-primary/10 w-fit px-1.5 py-0.5 rounded-sm">
                          {myActiveEntry.service?.name || 'Servicio'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase mb-0.5">Tiempo</p>
                        <div className="flex items-center justify-end gap-1.5">
                          <Clock className="size-4 shrink-0 text-primary animate-pulse" />
                          <p className="text-2xl sm:text-3xl font-black tabular-nums tracking-tighter text-foreground">
                            {myActiveEntry.started_at ? formatElapsed(myActiveEntry.started_at) : '—'}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-3 pt-2 space-y-2.5">
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="history" className="border-none">
                          <AccordionTrigger className="flex h-10 items-center justify-between rounded-lg border border-primary/20 bg-background/60 px-3 py-0 hover:bg-background/80 hover:no-underline [&[data-state=open]>svg]:rotate-180 transition-colors">
                            <span className="text-sm font-semibold flex items-center gap-2 text-foreground/80">
                              <User className="size-4 text-primary/70" />
                              Historial y Ficha
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2.5 pb-0">
                            <div className="space-y-3 rounded-lg border bg-card/50 p-3 mb-3 shadow-inner">
                              <div>
                                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                  <Instagram className="size-3" />
                                  Instagram
                                </label>
                                <div className="text-sm font-medium">
                                  {myActiveEntry.client?.instagram ? myActiveEntry.client.instagram : <span className="text-muted-foreground font-normal">No especificado</span>}
                                </div>
                              </div>
                              <Separator className="bg-primary/10" />
                              <div>
                                <label className="mb-1 block text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                                  Observaciones
                                </label>
                                <div className="w-full rounded-md bg-background/50 border border-primary/10 px-2.5 py-2 text-sm text-foreground italic min-h-[40px]">
                                  {myActiveEntry.client?.notes ? myActiveEntry.client.notes : <span className="text-muted-foreground not-italic">Ninguna</span>}
                                </div>
                              </div>
                            </div>
                            <div className="px-1">
                              {myActiveEntry.client && (
                                <ClientHistory clientId={myActiveEntry.client.id} />
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                      <Button className="h-12 w-full text-base font-bold shadow-[0_4px_14px_rgba(var(--primary),0.3)]" size="lg" onClick={() => setCompletingEntry(myActiveEntry)}>
                        <Check className="mr-2 size-5" />
                        Finalizar Servicio
                      </Button>
                    </CardContent>
                  </Card>
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
        <section className="hidden sm:flex shrink-0 flex-col sm:w-[300px] md:w-[360px] lg:w-[420px]">
          <div className="px-4 py-3 md:px-5 md:py-4">
            <h2 className="text-lg md:text-xl font-semibold">
              {myActiveBreak ? 'En descanso' : 'Tu cliente actual'}
            </h2>
          </div>
          <Separator />
          <div className="flex flex-1 flex-col p-3 md:p-5">
            {myActiveBreak ? (
              /* Active break panel */
              (() => {
                const breakElapsedMs = myActiveBreak.started_at
                  ? now - new Date(myActiveBreak.started_at).getTime()
                  : 0
                const breakDurationMs = (breakDurationMinutes ?? 0) * 60_000
                const isBreakOverdue = breakDurationMinutes !== null && breakDurationMinutes > 0 && breakElapsedMs > breakDurationMs
                const overdueMs = Math.max(0, breakElapsedMs - breakDurationMs)
                const formatOverdue = (ms: number) => {
                  const totalSeconds = Math.floor(ms / 1000)
                  const m = Math.floor(totalSeconds / 60)
                  const s = totalSeconds % 60
                  return `${m}m ${s}s`
                }
                return (
                  <Card className={isBreakOverdue ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'}>
                    <CardHeader className="p-5 md:p-6">
                      <div className="flex items-center gap-4">
                        <div className={`flex size-16 shrink-0 items-center justify-center rounded-xl ${isBreakOverdue ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-600'}`}>
                          <Coffee className="size-8" />
                        </div>
                        <div>
                          <CardTitle className={`text-2xl md:text-3xl ${isBreakOverdue ? 'text-red-500' : 'text-amber-600'}`}>
                            {isBreakOverdue ? 'Tiempo de demora' : 'Descanso'}
                          </CardTitle>
                          <p className="mt-1.5 text-base text-muted-foreground">
                            {isBreakOverdue ? 'Superaste el tiempo de descanso ⚠️' : 'Disfrutá tu descanso ☕'}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5 p-5 pt-0 md:p-6 md:pt-0">
                      <div className={`flex items-center gap-4 rounded-xl px-5 py-4 ${isBreakOverdue ? 'bg-red-500/10 border border-red-500/20' : 'bg-secondary'}`}>
                        <Clock className={`size-6 shrink-0 ${isBreakOverdue ? 'text-red-500' : 'text-muted-foreground'}`} />
                        <div>
                          <p className={`text-sm font-medium ${isBreakOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                            {isBreakOverdue ? 'Tiempo de demora' : 'Tiempo de descanso'}
                          </p>
                          <p className={`text-4xl font-bold tabular-nums tracking-tight ${isBreakOverdue ? 'text-red-500' : ''}`}>
                            {myActiveBreak.started_at
                              ? isBreakOverdue
                                ? formatOverdue(overdueMs)
                                : formatElapsed(myActiveBreak.started_at)
                              : '—'}
                          </p>
                        </div>
                      </div>
                      <Button
                        className="h-16 w-full text-xl"
                        size="lg"
                        onClick={handleCompleteBreak}
                        disabled={actionLoading === myActiveBreak.id}
                      >
                        <Check className="mr-2 size-6" />
                        Finalizar descanso
                      </Button>
                    </CardContent>
                  </Card>
                )
              })()
            ) : myActiveEntry ? (
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
                      {myActiveEntry.service && (
                        <p className="mt-1 font-medium text-primary">
                          {myActiveEntry.service.name}
                        </p>
                      )}
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

                  {/* Desktop view (sm and up) */}
                  <div className="hidden sm:block space-y-4">
                    {myActiveEntry.client?.notes && (
                      <div className="rounded-lg bg-muted/50 p-4 border border-border/50">
                        <p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">
                          <User className="size-3.5" />
                          Observaciones del cliente
                        </p>
                        <p className="text-sm font-medium italic text-foreground whitespace-pre-wrap">
                          {myActiveEntry.client.notes}
                        </p>
                      </div>
                    )}

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
                        Ver Historial y Fotos
                      </Button>
                    </div>
                  </div>

                  {/* Mobile view (under sm) */}
                  <div className="sm:hidden -mx-2">
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="history" className="border-none px-2">
                        <AccordionTrigger className="flex h-14 items-center justify-between rounded-lg border bg-card px-4 py-0 hover:bg-accent hover:no-underline [&[data-state=open]>svg]:rotate-180">
                          <div className="flex items-center gap-2">
                            <User className="size-5" />
                            <span className="text-lg font-medium">Historial y Fotos</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pt-4 pb-2">
                          <div className="space-y-4 rounded-lg border bg-card/30 p-4 mb-4">
                            <div>
                              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                                <Instagram className="size-4" />
                                Instagram
                              </label>
                              <div className="text-sm font-medium mt-1">
                                {myActiveEntry.client?.instagram ? myActiveEntry.client.instagram : <span className="text-muted-foreground font-normal">No especificado</span>}
                              </div>
                            </div>

                            <div>
                              <label className="mb-1.5 block text-sm font-medium">
                                Observaciones internas
                              </label>
                              <div className="w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground min-h-[80px]">
                                {myActiveEntry.client?.notes ? myActiveEntry.client.notes : <span className="text-muted-foreground">Ninguna</span>}
                              </div>
                            </div>
                          </div>

                          <div className="px-1">
                            {myActiveEntry.client && (
                              <ClientHistory clientId={myActiveEntry.client.id} />
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
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
                  Selecciona un cliente de la fila para comenzar
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Next client waiting warning overlay */}
      {showWaitWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="mx-4 w-full max-w-md space-y-6 rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-8 shadow-2xl shadow-amber-500/20 backdrop-blur-xl animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-amber-500/20 animate-pulse">
                <AlertTriangle className="size-10 text-amber-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-amber-500">
                  ¡Tu cliente te está esperando!
                </h2>
                <p className="mt-2 text-base text-amber-200/80">
                  {myRealWaitingEntries[0]?.client?.name
                    ? <><strong>{myRealWaitingEntries[0].client.name}</strong> está en la fila</>
                    : 'Tenés clientes en espera'}
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="h-16 w-full text-xl bg-amber-500 hover:bg-amber-600 text-black font-bold"
              onClick={handleWarningStartService}
              disabled={warningStarting}
            >
              <Scissors className="mr-3 size-6" />
              {warningStarting ? 'Iniciando...' : 'Empezar a cortar'}
            </Button>
          </div>
        </div>
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
