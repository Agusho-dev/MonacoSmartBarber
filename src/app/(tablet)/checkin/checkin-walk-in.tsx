
'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { checkinClient, checkinClientByFace, reassignMyBarber } from '@/lib/actions/queue'
import { registerBarberClockIn, registerBarberClockOut } from '@/lib/actions/attendance'
import { verifyBarberPin } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Scissors,
  ArrowLeft,
  Delete,
  MapPin,
  CheckCircle2,
  Loader2,
  Zap,
  User,
  RefreshCw,
  LogIn,
  LogOut,
  ScanFace,
  Settings2,
  ChevronDown,
  Sparkles,
  Check,
  X,
  UserPlus,
} from 'lucide-react'
import type { Branch, Staff, QueueEntry, Visit, Service, StaffSchedule } from '@/lib/types/database'
import {
  buildBarberAvgMinutes,
  getBarberStats,
  assignDynamicBarbers,
  isBarberBlockedByShiftEnd,
  calculateEffectiveAhead,
  getMobileBarberStatus,
  mobileStatusColors,
  mobileStatusLabels,
  formatWaitTime,
} from '@/lib/barber-utils'
import { FaceCamera } from '@/components/checkin/face-camera'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'
import {
  TerminalAmbient,
  TerminalGlobalStyles,
  GlassRing,
  TerminalSectionGlow,
  terminalBodyMuted,
  terminalDialogSurface,
  terminalGlassCard,
  terminalGlassCardInner,
  terminalH1,
  terminalH1Gradient,
  terminalH2,
  terminalKeypadKey,
  terminalKeypadShell,
  terminalListItem,
  terminalPrimaryInnerBtn,
  terminalProgressFill,
  terminalProgressTrack,
} from '@/components/checkin/terminal-theme'
import type { FaceMatchResult } from '@/lib/face-recognition'
import { saveFacePhoto, enrollFaceDescriptor, enrollStaffFaceDescriptor, saveStaffFacePhoto } from '@/lib/face-recognition'
import { cn } from '@/lib/utils'
import { resolveCheckinBackground } from '@/lib/checkin-bg'

type Step =
  | 'branch'
  | 'home'
  | 'face_scan'
  | 'face_confirm'
  | 'phone'
  | 'name'
  | 'face_enroll'
  | 'service_selection'
  | 'barber'
  | 'success'
  | 'manage_turn'
  | 'staff_face_scan'
  | 'staff_action_confirm'
  | 'staff_pin'
  | 'staff_face_enroll'

type AttendanceActionType = 'clock_in' | 'clock_out'

const LOCALSTORAGE_KEY = 'checkin_branch'

const PHONE_LENGTH = 10
const RESET_DELAY_MS = 5_000
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

export function CheckinWalkIn() {
  const searchParams = useSearchParams()
  const [step, setStep] = useState<Step>('branch')
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [wantsEnrollment, setWantsEnrollment] = useState(false)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [isReturning, setIsReturning] = useState(false)
  const [, setPosition] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [error, setError] = useState('')
  const [animKey, setAnimKey] = useState(0)

  const [barbers, setBarbers] = useState<Staff[]>([])
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([])
  const [barberAvgMinutes, setBarberAvgMinutes] = useState<Record<string, number>>({})
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [loadingBarbers, setLoadingBarbers] = useState(false)

  const [, setBranchIsOpen] = useState(true)
  const [, setBranchHours] = useState<{ opens: string; closes: string } | null>(null)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dynamicCooldownMs, setDynamicCooldownMs] = useState(120_000)
  const [notClockedInBarbers, setNotClockedInBarbers] = useState<Set<string>>(new Set())
  const [barberNextArrival, setBarberNextArrival] = useState<Record<string, string>>({})

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const [queueEntryId, setQueueEntryId] = useState<string | null>(null)
  const [changingBarberInSuccess, setChangingBarberInSuccess] = useState(false)

  const [myQueueEntry, setMyQueueEntry] = useState<QueueEntry | null>(null)
  const [changingBarberInManage, setChangingBarberInManage] = useState(false)

  const [faceMatch, setFaceMatch] = useState<FaceMatchResult | null>(null)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [faceClientId, setFaceClientId] = useState<string | null>(null)
  const [hasExistingFace, setHasExistingFace] = useState(false)

  const [capturedFaceDescriptors, setCapturedFaceDescriptors] = useState<Float32Array[]>([])
  const [capturedFacePhoto, setCapturedFacePhoto] = useState<Blob | null>(null)
  const [capturedScanPhoto, setCapturedScanPhoto] = useState<Blob | null>(null)

  // Staff attendance state
  const [staffFaceMatch, setStaffFaceMatch] = useState<FaceMatchResult | null>(null)
  const [staffAction, setStaffAction] = useState<AttendanceActionType | null>(null)
  const [staffActionDone, setStaffActionDone] = useState(false)

  // Staff PIN + face enrollment state
  const [staffPinBarbers, setStaffPinBarbers] = useState<Staff[]>([])
  const [staffPinLoading, setStaffPinLoading] = useState(false)
  const [staffPinSelected, setStaffPinSelected] = useState<Staff | null>(null)
  const [staffPinValue, setStaffPinValue] = useState('')
  const [staffPinError, setStaffPinError] = useState('')
  const [staffPinSubmitting, setStaffPinSubmitting] = useState(false)
  const [staffEnrollId, setStaffEnrollId] = useState<string | null>(null)
  const [staffEnrollName, setStaffEnrollName] = useState('')

  const [services, setServices] = useState<Service[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [showBarberPreference, setShowBarberPreference] = useState(false)
  const [globalCheckinBg, setGlobalCheckinBg] = useState('#3f3f46')

  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Cargar branches filtradas por org via server action
    const loadBranches = async () => {
      const { getPublicBranches, getPublicAppCheckinBgColor } = await import('@/lib/actions/org')
      const [data, globalBg] = await Promise.all([getPublicBranches(), getPublicAppCheckinBgColor()])
      setGlobalCheckinBg(globalBg)
      if (data) {
          setBranches(data as Branch[])

          // Prioridad 1: parámetro ?branch= en la URL (viene del dashboard)
          const branchParam = searchParams.get('branch')
          if (branchParam) {
            const found = data.find((b: Branch) => b.id === branchParam)
            if (found) {
              setSelectedBranch(found as Branch)
              setStep('home')
              return
            }
          }

          // Prioridad 2: Restore branch from localStorage
          try {
            const stored = localStorage.getItem(LOCALSTORAGE_KEY)
            if (stored) {
              const cachedBranch = JSON.parse(stored) as Branch
              const found = data.find((b) => b.id === cachedBranch.id)
              if (found) {
                setSelectedBranch(found)
                setStep('home')
              } else {
                // Cached branch no longer exists — clear it
                localStorage.removeItem(LOCALSTORAGE_KEY)
              }
            }
          } catch {
            localStorage.removeItem(LOCALSTORAGE_KEY)
          }
      }
    }
    loadBranches()
    // searchParams es estable (only read once on mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  useEffect(() => {
    if (step === 'name' && !isReturning) {
      setTimeout(() => nameInputRef.current?.focus(), 150)
    }
  }, [step, isReturning])

  const loadBarberData = useCallback(
    async (branchId: string) => {
      setLoadingBarbers(true)

      const { getCheckinData } = await import('@/lib/actions/kiosk')
      const res = await getCheckinData(branchId)

      if (res.error || !res.staff) {
        setLoadingBarbers(false)
        console.error('getCheckinData error:', res.error)
        return
      }

      // Track branch open status
      if (res.openStatus && res.openStatus.length > 0) {
        const status = res.openStatus[0] as { is_open: boolean; opens_at: string; closes_at: string }
        setBranchIsOpen(status.is_open)
        setBranchHours({ opens: status.opens_at, closes: status.closes_at })
      }

      if (res.settings) {
        const sd = res.settings as { shift_end_margin_minutes?: number; dynamic_cooldown_seconds?: number }
        if (typeof sd.shift_end_margin_minutes === 'number' && sd.shift_end_margin_minutes >= 0) {
          setShiftEndMargin(sd.shift_end_margin_minutes)
        }
        if (typeof sd.dynamic_cooldown_seconds === 'number' && sd.dynamic_cooldown_seconds >= 0) {
          setDynamicCooldownMs(sd.dynamic_cooldown_seconds * 1000)
        }
      }

      if (res.staff) {
        const latestAttendance: Record<string, string> = {}
        if (res.attendance) {
          res.attendance.forEach((log: { staff_id: string; action_type: string }) => {
            if (!latestAttendance[log.staff_id]) {
              latestAttendance[log.staff_id] = log.action_type
            }
          })
        }

        const notClocked = new Set<string>()
        const nextArrivals: Record<string, string> = {}

        const currentTimeStr = (() => {
          const n = new Date()
          return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}:00`
        })()

        const filtered = (res.staff as Staff[]).filter((s) => {
          if (s.hidden_from_checkin) return false

          const lastAction = latestAttendance[s.id]
          if (lastAction === 'clock_in') return true

          type ScheduleBlock = { staff_id: string; start_time: string; end_time: string }
          const barberBlocks = ((res.schedules ?? []) as ScheduleBlock[])
            .filter((sched) => sched.staff_id === s.id)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))

          if (lastAction === 'clock_out') {
            const nextBlock = barberBlocks.find((block) => block.start_time > currentTimeStr)
            if (nextBlock) {
              notClocked.add(s.id)
              nextArrivals[s.id] = nextBlock.start_time
              return true
            }
            return false
          }

          if (barberBlocks.length > 0) {
            notClocked.add(s.id)
            const nextBlock = barberBlocks.find((block) => block.end_time > currentTimeStr)
            if (nextBlock) {
              nextArrivals[s.id] = nextBlock.start_time
            }
            return true
          }

          return false
        })
        setBarbers(filtered)
        setNotClockedInBarbers(notClocked)
        setBarberNextArrival(nextArrivals)
      }

      if (res.queueEntries) setQueueEntries(res.queueEntries as QueueEntry[])

      if (res.visits) {
        setBarberAvgMinutes(
          buildBarberAvgMinutes(
            res.visits as Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
            25
          )
        )
        // Derive last completed per barber (visits already sorted by completed_at desc)
        const lastMap: Record<string, string> = {}
        for (const v of res.visits as { barber_id: string; completed_at: string }[]) {
          if (v.completed_at && !lastMap[v.barber_id]) {
            lastMap[v.barber_id] = v.completed_at
          }
        }
        setLastCompletedAt(lastMap)
      }

      if (res.services) {
        setServices(res.services as Service[])
      }

      if (res.schedules) {
        setSchedules(res.schedules as StaffSchedule[])
      }

      if (res.monthlyVisits) {
        const counts: Record<string, number> = {}
        for (const v of res.monthlyVisits as { barber_id: string }[]) {
          counts[v.barber_id] = (counts[v.barber_id] || 0) + 1
        }
        setDailyServiceCounts(counts)
      }
      setLoadingBarbers(false)
    },
    []
  )

  // Load barber data + realtime when viewing barbers
  const needsBarbers =
    step === 'service_selection' ||
    step === 'barber' ||
    (step === 'success' && changingBarberInSuccess) ||
    (step === 'manage_turn' && changingBarberInManage)

  useEffect(() => {
    const branchId = selectedBranch?.id ?? myQueueEntry?.branch_id
    if (!needsBarbers || !branchId) return

    const supabase = createClient()
    let cancelled = false

    loadBarberData(branchId)

    const channel = supabase
      .channel(`checkin-queue-${branchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `branch_id=eq.${branchId}`,
        },
        () => {
          supabase
            .from('queue_entries')
            .select('*')
            .eq('branch_id', branchId)
            .in('status', ['waiting', 'in_progress'])
            .then(({ data }) => {
              if (data && !cancelled) setQueueEntries(data)
            })
          // Refresca conteos y tiempos de finalización para que el tiebreaker use datos actuales
          if (!cancelled) loadBarberData(branchId)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff',
          filter: `branch_id=eq.${branchId}`,
        },
        () => {
          if (!cancelled) loadBarberData(branchId)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_logs',
          filter: `branch_id=eq.${branchId}`,
        },
        () => {
          if (!cancelled) loadBarberData(branchId)
        }
      )
      .subscribe((status) => {
        // Re-fetch everything on reconnection
        if (status === 'SUBSCRIBED' && !cancelled) {
          loadBarberData(branchId)
        }
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [needsBarbers, selectedBranch?.id, myQueueEntry?.branch_id, loadBarberData])

  useEffect(() => {
    if (step !== 'staff_pin' || !selectedBranch) return
    setStaffPinLoading(true)
    const supabase = createClient()
    supabase
      .from('staff')
      .select('*')
      .eq('branch_id', selectedBranch.id)
      .in('role', ['barber', 'admin', 'owner'])
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => {
        setStaffPinBarbers(data ?? [])
        setStaffPinLoading(false)
      })
  }, [step, selectedBranch])

  const goTo = (next: Step) => {
    setAnimKey((k) => k + 1)
    setStep(next)
    setError('')
    setShowBarberPreference(false)
  }

  const reset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setPhone('')
    setName('')
    setIsReturning(false)
    setPosition(0)
    setSubmitting(false)
    setLookingUp(false)
    setError('')
    setBarbers([])
    setQueueEntries([])
    setBarberAvgMinutes({})
    setDailyServiceCounts({})
    setLastCompletedAt({})
    setLoadingBarbers(false)

    setQueueEntryId(null)
    setChangingBarberInSuccess(false)
    setMyQueueEntry(null)
    setChangingBarberInManage(false)
    setWantsEnrollment(false)
    setFaceMatch(null)
    setFaceDescriptor(null)
    setFaceClientId(null)
    setHasExistingFace(false)
    setCapturedFaceDescriptors([])
    setCapturedFacePhoto(null)
    setCapturedScanPhoto(null)
    setStaffFaceMatch(null)
    setStaffAction(null)
    setStaffActionDone(false)
    setSelectedServiceId(null)
    setStaffPinBarbers([])
    setStaffPinSelected(null)
    setStaffPinValue('')
    setStaffPinError('')
    setStaffPinSubmitting(false)
    setStaffEnrollId(null)
    setStaffEnrollName('')
    setBarberNextArrival({})
    // Keep selectedBranch — go back to home, not branch
    goTo('home')
  }

  // ── Branch ──

  const selectBranch = (branch: Branch) => {
    setSelectedBranch(branch)
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(branch))
    } catch { /* ignore */ }
    // Setear cookie de org para que futuros loads filtren correctamente
    import('@/lib/actions/org').then(({ setActiveOrgFromBranch }) => {
      setActiveOrgFromBranch(branch.id)
    })
    goTo('home')
  }

  const changeBranch = () => {
    setSelectedBranch(null)
    try {
      localStorage.removeItem(LOCALSTORAGE_KEY)
    } catch { /* ignore */ }
    goTo('branch')
  }

  // ── Phone keypad ──

  const lookupPhone = async (ph: string) => {
    // Si es el código genérico de niño
    if (ph === '0000000000') {
      const randomId = Math.floor(Math.random() * 100000000).toString().padStart(8, '0')
      const virtualPhone = `00${randomId}`
      setPhone(virtualPhone)
      setName('')
      setFaceClientId(null)
      setIsReturning(false)
      setHasExistingFace(false)
      goTo('name')
      return
    }

    setLookingUp(true)
    try {
      if (!selectedBranch) {
        setLookingUp(false)
        return
      }
      
      const { lookupClientByPhone } = await import('@/lib/actions/clients')
      const { data } = await lookupClientByPhone(ph, selectedBranch.id)

      if (data) {
        setName(data.name)
        setFaceClientId(data.id)
        setIsReturning(true)

        // Retroalimentación: si el cliente negó ser el match facial, guardar foto/descriptor al cliente real
        if (capturedScanPhoto) {
           const { saveFacePhoto } = await import('@/lib/face-recognition')
           saveFacePhoto(data.id, capturedScanPhoto, selectedBranch.id).catch(() => {})
           setCapturedScanPhoto(null)
        }
        if (faceDescriptor) {
           const { enrollFaceDescriptor } = await import('@/lib/face-recognition')
           enrollFaceDescriptor(data.id, faceDescriptor, 'checkin', 0.85, selectedBranch.id).catch(() => {})
           setFaceDescriptor(null)
        }

        const supabase = createClient()
        const { data: faceData } = await supabase
          .from('client_face_descriptors')
          .select('id')
          .eq('client_id', data.id)
          .limit(1)
        setHasExistingFace(!!(faceData && faceData.length > 0))

        const { data: activeEntry } = await supabase
          .from('queue_entries')
          .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
          .eq('client_id', data.id)
          .in('status', ['waiting', 'in_progress'])
          .order('checked_in_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (activeEntry) {
          setMyQueueEntry(activeEntry as unknown as QueueEntry)
          setLookingUp(false)
          goTo('manage_turn')
          resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
          return
        }
      } else {
        setName('')
        setFaceClientId(null)
        setIsReturning(false)
        setHasExistingFace(false)
      }
    } catch {
      setName('')
      setIsReturning(false)
    }
    setLookingUp(false)
    goTo('name')
  }

  const pressDigit = (digit: string) => {
    if (phone.length >= PHONE_LENGTH || lookingUp) return
    const next = phone + digit
    setPhone(next)

    if (next.length === PHONE_LENGTH) {
      lookupPhone(next)
    }
  }

  const pressDelete = () => {
    if (lookingUp) return
    setPhone((p) => p.slice(0, -1))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const assignmentTime = useMemo(() => Date.now(), [queueEntries, barbers, dailyServiceCounts, lastCompletedAt, notClockedInBarbers])

  const dynamicEntries = useMemo(() => {
    return assignDynamicBarbers(queueEntries, barbers, schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, dynamicCooldownMs)
  }, [queueEntries, barbers, schedules, assignmentTime, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, dynamicCooldownMs])



  const minWaitBarber = useMemo(() => {
    const active = barbers.filter(b =>
      !isBarberBlockedByShiftEnd(b, dynamicEntries, schedules, now, shiftEndMargin) &&
      !notClockedInBarbers.has(b.id)
    )
    if (active.length === 0) return null
    let best = active[0]
    let bestLoad = getBarberStats(active[0], dynamicEntries, barberAvgMinutes).totalLoad
    for (let i = 1; i < active.length; i++) {
      const load = getBarberStats(active[i], dynamicEntries, barberAvgMinutes).totalLoad
      if (load < bestLoad) {
        bestLoad = load
        best = active[i]
      } else if (load === bestLoad) {
        const countI = dailyServiceCounts[active[i].id] || 0
        const countBest = dailyServiceCounts[best.id] || 0
        if (countI < countBest) {
          best = active[i]
          bestLoad = load
        } else if (countI === countBest) {
          const lastI = lastCompletedAt[active[i].id] || ''
          const lastBest = lastCompletedAt[best.id] || ''
          if (lastI < lastBest) {
            best = active[i]
            bestLoad = load
          } else if (lastI === lastBest && active[i].id < best.id) {
            best = active[i]
            bestLoad = load
          }
        }
      }
    }
    return best
  }, [barbers, dynamicEntries, schedules, barberAvgMinutes, now, shiftEndMargin, notClockedInBarbers, dailyServiceCounts, lastCompletedAt])

  // Barberos activos para cálculo de posición optimista
  const activeBarberCount = useMemo(() => {
    return barbers.filter(b => b.is_active && !b.hidden_from_checkin && !notClockedInBarbers.has(b.id)).length
  }, [barbers, notClockedInBarbers])

  // Posición optimista del cliente en la fila (considerando paralelismo)
  const effectiveAhead = useMemo(() => {
    if (!queueEntryId) return null
    return calculateEffectiveAhead(dynamicEntries, queueEntryId, activeBarberCount)
  }, [dynamicEntries, queueEntryId, activeBarberCount])

  // Nivel de disponibilidad global (1-4) usado por el CTA "Menor espera".
  // La vista por barbero usa directamente la lógica del mobile
  // (getMobileBarberStatus + ETA + fila) en lugar de este nivel agregado.
  const globalAvailability = useMemo((): 1 | 2 | 3 | 4 => {
    const activeBarbersList = barbers.filter(b => !notClockedInBarbers.has(b.id))
    const availableCount = activeBarbersList.filter(b =>
      getBarberStats(b, dynamicEntries, barberAvgMinutes).status === 'available'
    ).length
    const totalWaiting = dynamicEntries.filter(e => e.status === 'waiting').length

    if (availableCount >= 1) return 1
    if (totalWaiting === 0) return 2
    if (activeBarbersList.length === 0 || totalWaiting < 2 * activeBarbersList.length) return 3
    return 4
  }, [barbers, notClockedInBarbers, dynamicEntries, barberAvgMinutes])

  // ── Face ID handlers ──

  const handleFaceMatch = useCallback(
    (match: FaceMatchResult, descriptor: Float32Array, photoBlob: Blob | null) => {
      setFaceMatch(match)
      setFaceDescriptor(descriptor)
      setCapturedScanPhoto(photoBlob)
      setName(match.clientName)
      setPhone(match.clientPhone)
      setFaceClientId(match.clientId)
      setIsReturning(true)
      setHasExistingFace(true)
      goTo('face_confirm')
    },
    []
  )

  const handleFaceConfirmYes = useCallback(async () => {
    if (!faceClientId || !faceDescriptor || !selectedBranch) return

    // Retroalimentar el sistema con el descriptor y foto confirmados (fire & forget)
    enrollFaceDescriptor(faceClientId, faceDescriptor, 'checkin', 0.85, selectedBranch.id).catch(() => {})
    if (capturedScanPhoto) {
      saveFacePhoto(faceClientId, capturedScanPhoto, selectedBranch.id).catch(() => {})
    }

    const supabase = createClient()
    const { data: activeEntry } = await supabase
      .from('queue_entries')
      .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
      .eq('client_id', faceClientId)
      .in('status', ['waiting', 'in_progress'])
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeEntry) {
      setMyQueueEntry(activeEntry as unknown as QueueEntry)
      goTo('manage_turn')
      resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
    } else {
      goTo('service_selection')
    }
    // reset es estable y no causa re-trigger del callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceClientId, faceDescriptor, capturedScanPhoto, selectedBranch])

  const handleFaceConfirmNo = useCallback(() => {
    // Mantenemos faceDescriptor y capturedScanPhoto para guardarlos al cliente real que ingrese por teléfono
    setFaceMatch(null)
    setName('')
    setPhone('')
    setFaceClientId(null)
    setIsReturning(false)
    setHasExistingFace(false)
    goTo('phone')
  }, [])

  const handleFaceNoMatch = useCallback(
    (descriptor: Float32Array, photoBlob: Blob | null) => {
      setFaceDescriptor(descriptor)
      setCapturedScanPhoto(photoBlob)
      setPhone('')
      setName('')
      goTo('phone')
    },
    []
  )

  const handleFaceManualEntry = useCallback(() => {
    setPhone('')
    setName('')
    goTo('phone')
  }, [])

  const handleFaceConfirmBarber = useCallback(
    async (chosenBarberId: string | null) => {
      if (!selectedBranch || !faceClientId || submitting) return
      setSubmitting(true)
      setError('')

      try {
        const result = await checkinClientByFace(
          faceClientId,
          selectedBranch.id,
          chosenBarberId,
          selectedServiceId
        )

        if ('error' in result && result.error) {
          setError(result.error)
          setSubmitting(false)
          return
        }

        if ('alreadyInQueue' in result && result.alreadyInQueue) {
          const supabase = createClient()
          const { data: entry } = await supabase
            .from('queue_entries')
            .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
            .eq('id', result.queueEntryId)
            .maybeSingle()
          if (entry) setMyQueueEntry(entry as unknown as QueueEntry)
          setSubmitting(false)
          goTo('manage_turn')
          resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
          return
        }

        setPosition(result.position)
        if ('queueEntryId' in result) {
          setQueueEntryId(result.queueEntryId as string)
        }
        setSubmitting(false)
        goTo('success')
        resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
      } catch {
        setError('Error al registrar. Intentá de nuevo.')
        setSubmitting(false)
      }
    },
    // reset es estable y no causa re-trigger del callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedBranch, faceClientId, submitting, selectedServiceId]
  )

  // ── Confirm ──

  const handleConfirm = useCallback(
    async (chosenBarberId: string | null) => {
      if (faceClientId && selectedBranch) {
        return handleFaceConfirmBarber(chosenBarberId)
      }

      if (!selectedBranch || !name.trim() || submitting) return
      setSubmitting(true)
      setError('')

      try {
        const fd = new FormData()
        fd.append('name', name.trim())
        fd.append('phone', phone)
        fd.append('branch_id', selectedBranch.id)
        if (chosenBarberId) {
          fd.append('barber_id', chosenBarberId)
        }
        if (selectedServiceId) {
          fd.append('service_id', selectedServiceId)
        }

        const result = await checkinClient(fd)

        if ('error' in result && result.error) {
          setError(result.error)
          setSubmitting(false)
          return
        }

        if ('alreadyInQueue' in result && result.alreadyInQueue) {
          const supabase = createClient()
          const { data: entry } = await supabase
            .from('queue_entries')
            .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
            .eq('id', result.queueEntryId)
            .maybeSingle()
          if (entry) setMyQueueEntry(entry as unknown as QueueEntry)
          setSubmitting(false)
          goTo('manage_turn')
          resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
          return
        }

        setPosition(result.position)
        if ('queueEntryId' in result) {
          setQueueEntryId(result.queueEntryId as string)
        }

        const newClientId = result.clientId || faceClientId

        // If we captured face data during this flow, save it now to the real client
        if (wantsEnrollment && capturedFaceDescriptors.length > 0 && newClientId) {
          const savePromises: Promise<boolean>[] = capturedFaceDescriptors.map((d, i) =>
            enrollFaceDescriptor(newClientId, d, 'checkin', i === 0 ? 0.99 : 0, selectedBranch.id) // placeholder score for best descriptor
          )
          if (capturedFacePhoto) {
            savePromises.push(saveFacePhoto(newClientId, capturedFacePhoto, selectedBranch.id).then((url) => url !== null))
          }
          await Promise.all(savePromises)
          setHasExistingFace(true)
          setWantsEnrollment(false)
          setFaceClientId(newClientId)
        }

        if (!faceClientId && newClientId) {
          setFaceClientId(newClientId)
        }

        setSubmitting(false)
        goTo('success')
        resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
      } catch {
        setError('Error al registrar. Intentá de nuevo.')
        setSubmitting(false)
      }
    },
    // reset es estable y no causa re-trigger del callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedBranch, name, phone, submitting, faceClientId, handleFaceConfirmBarber, wantsEnrollment, capturedFaceDescriptors, capturedFacePhoto, selectedServiceId]
  )

  const handleReassign = useCallback(
    async (entryId: string, newBarberId: string) => {
      setSubmitting(true)
      setError('')
      try {
        const result = await reassignMyBarber(entryId, newBarberId)
        if ('error' in result && result.error) {
          setError(result.error)
        } else {
          setChangingBarberInSuccess(false)
          setChangingBarberInManage(false)
          if (myQueueEntry) {
            const supabase = createClient()
            const { data } = await supabase
              .from('queue_entries')
              .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
              .eq('id', entryId)
              .maybeSingle()
            if (data) setMyQueueEntry(data as unknown as QueueEntry)
          }
        }
      } catch {
        setError('Error al cambiar barbero')
      } finally {
        setSubmitting(false)
      }
    },
    [myQueueEntry]
  )

  const goToBarberStep = () => {
    if (!name.trim()) return

    const isChildVirtualPhone = phone.startsWith('00') && phone.length === 10

    // New clients: go to face enrollment first (unless it's a child profile)
    if (!isReturning && !hasExistingFace && !isChildVirtualPhone) {
      setWantsEnrollment(true)
      goTo('face_enroll')
    } else {
      goTo('service_selection')
    }
  }

  // ── Shared UI pieces ──

  const getBackAction = () => {
    switch (step) {
      case 'face_scan':
      case 'staff_face_scan':
        return () => goTo('home')
      case 'face_confirm':
        return () => {
          setFaceMatch(null)
          setFaceDescriptor(null)
          setFaceClientId(null)
          setName('')
          setPhone('')
          setIsReturning(false)
          setHasExistingFace(false)
          setCapturedScanPhoto(null)
          goTo('face_scan')
        }
      case 'phone':
        return () => { setPhone(''); goTo('home') }
      case 'name':
        return () => { setPhone(''); setName(''); setIsReturning(false); goTo('phone') }
      case 'service_selection':
        return () => {
          if (!isReturning && !hasExistingFace) goTo('face_enroll')
          else goTo('name')
        }
      case 'barber':
        return () => goTo('service_selection')
      case 'face_enroll':
        return () => goTo('name')
      case 'success':
        if (changingBarberInSuccess) {
          return () => {
            setChangingBarberInSuccess(false)
            resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
          }
        }
        return null
      case 'staff_pin':
        return () => {
          setStaffPinSelected(null)
          setStaffPinValue('')
          setStaffPinError('')
          goTo('staff_face_scan')
        }
      case 'staff_face_enroll':
        return () => goTo('staff_pin')
      case 'manage_turn':
        return reset
      default:
        return null
    }
  }

  const handleBack = getBackAction()

  const effectiveCheckinBgRaw =
    (selectedBranch?.checkin_bg_color && selectedBranch.checkin_bg_color.trim()) || globalCheckinBg
  const bgInfo = resolveCheckinBackground(effectiveCheckinBgRaw)
  const branchBg = { background: bgInfo.css, color: bgInfo.isLight ? '#18181b' : '#f4f4f5' }
  const isLightBg = bgInfo.isLight

  const backButton = handleBack ? (
    <button
      onClick={handleBack}
      className={cn(
        'fixed top-3 left-3 md:top-6 md:left-6 z-50 flex items-center gap-2 transition-colors py-2 px-3 rounded-xl backdrop-blur-sm',
        isLightBg
          ? 'text-zinc-600 hover:text-zinc-900 bg-zinc-900/[0.04] hover:bg-zinc-900/[0.08]'
          : 'text-muted-foreground hover:text-foreground bg-white/5 hover:bg-white/10'
      )}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm md:text-base">Atrás</span>
    </button>
  ) : null

  // ── Availability indicator (4 niveles, 3 sillas) ──
  const AvailabilityIndicator = ({ level, size = 'md' }: { level: 1 | 2 | 3 | 4; size?: 'sm' | 'md' | 'lg' }) => {
    const sizeClass = size === 'lg' ? 'size-7 md:size-8' : size === 'md' ? 'size-5 md:size-6' : 'size-4 md:size-5'
    const gapClass = size === 'lg' ? 'gap-2' : size === 'md' ? 'gap-1.5' : 'gap-1'
    const labels = ['Sin espera', 'Baja espera', 'Espera media', 'Espera elevada']
    // Cuántas sillas encender: nivel 1=0, nivel 2=1, nivel 3=2, nivel 4=3
    const litCount = level - 1
    // Color de las sillas encendidas según el nivel general
    const activeColors = ['text-emerald-400', 'text-emerald-400', 'text-amber-400', 'text-red-400']
    const activeColor = activeColors[level - 1]
    const inactiveColor = isLightBg ? 'text-zinc-300' : 'text-white/15'
    const badgeColors = [
      'bg-emerald-400/10 border-emerald-400/30 text-emerald-400', // sin espera
      'bg-emerald-400/10 border-emerald-400/30 text-emerald-400', // baja
      'bg-amber-400/10 border-amber-400/30 text-amber-400',       // media
      'bg-red-400/10 border-red-400/30 text-red-400',             // alta
    ]

    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className={`flex items-center ${gapClass}`}>
          {[0, 1, 2].map((i) => {
            const isLit = i < litCount
            return (
              <svg
                key={i}
                className={`${sizeClass} ${isLit ? activeColor : inactiveColor} transition-colors duration-300`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
              </svg>
            )
          })}
        </div>
        {size !== 'sm' && (
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeColors[level - 1]}`}>
            <span>{labels[level - 1]}</span>
          </div>
        )}
      </div>
    )
  }

  const renderBarberCard = (
    barber: Staff,
    onSelect: (barberId: string) => void,
    _showExpand = true
  ) => {
    const isNotClockedIn = notClockedInBarbers.has(barber.id)
    const stats = getBarberStats(barber, dynamicEntries, barberAvgMinutes)
    const mobileStatus = getMobileBarberStatus(barber, stats.attending)
    const palette = mobileStatusColors[mobileStatus]
    const statusLabel = mobileStatusLabels[mobileStatus]

    // Ring color alineado con el estado
    const ringColor = isNotClockedIn
      ? 'ring-orange-500/60'
      : mobileStatus === 'disponible'
        ? 'ring-emerald-500/60'
        : mobileStatus === 'ocupado'
          ? 'ring-amber-500/60'
          : 'ring-zinc-500/60'

    // Línea de subtítulo: igual al mobile
    //   - ocupado: "~X min de espera" si hay fila, si no 'Atendiendo ahora'
    //   - disponible: 'Libre ahora'
    //   - descanso: 'En descanso'
    const subtitle = isNotClockedIn
      ? null
      : mobileStatus === 'ocupado'
        ? stats.eta > 0
          ? `Espera ${formatWaitTime(stats.eta)}`
          : 'Atendiendo ahora'
        : mobileStatus === 'descanso'
          ? 'En descanso'
          : 'Libre ahora'

    // Queue "tijeras" — max 5 visibles + contador
    const queueAhead = stats.waiting
    const displayScissors = Math.min(queueAhead, 5)
    const extra = queueAhead > 5 ? queueAhead - 5 : 0

    return (
      <GlassRing key={barber.id} halo={false}>
        <button
          onClick={() => onSelect(barber.id)}
          disabled={submitting}
          className={cn(
            'group relative w-full overflow-hidden rounded-2xl border p-4 md:p-5 text-left transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
            isLightBg
              ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
              : 'border-white/15 checkin-glass-surface hover:border-white/28 focus-visible:ring-white/50'
          )}
        >
          {/* Stripe lateral coloreado (misma señal visual que mobile BarberStatusTile) */}
          {!isNotClockedIn && (
            <span
              aria-hidden
              className={cn('absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl', palette.stripe)}
            />
          )}

          <div className="relative flex flex-col items-center gap-3">
            <div className={`shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-transparent ${ringColor}`}>
              {barber.avatar_url ? (
                <Image
                  src={barber.avatar_url}
                  alt={barber.full_name}
                  width={96}
                  height={96}
                  className="size-20 md:size-24 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <div className={cn('flex size-20 md:size-24 items-center justify-center rounded-full text-3xl font-bold', isLightBg ? 'bg-zinc-200 text-zinc-700' : 'bg-white/10 text-white')}>
                  {barber.full_name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="w-full text-center space-y-1.5">
              <p className={cn('text-xl md:text-2xl font-bold truncate', isLightBg ? 'text-zinc-900' : 'text-white')}>{barber.full_name}</p>

              {isNotClockedIn ? (
                <>
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs md:text-sm font-medium bg-orange-500/15 text-orange-300 border-orange-400/40">
                    Aún no llegó
                  </span>
                  <p className="text-sm md:text-base text-orange-300/80">
                    {barberNextArrival[barber.id]
                      ? `Ingresa a las ${barberNextArrival[barber.id].slice(0, 5)}`
                      : 'Todavía no llegó'}
                  </p>
                </>
              ) : (
                <>
                  {/* Badge de estado con dot pulsante (mismo patrón que mobile) */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs md:text-sm font-semibold',
                      palette.badge,
                    )}
                  >
                    <span className="relative inline-flex size-2">
                      {mobileStatus !== 'descanso' && (
                        <span
                          className={cn('absolute inline-flex size-full rounded-full opacity-75 animate-ping', palette.stripe)}
                        />
                      )}
                      <span className={cn('relative inline-flex size-2 rounded-full', palette.stripe)} />
                    </span>
                    {statusLabel}
                  </span>

                  {subtitle && (
                    <p className={cn('text-sm md:text-base font-medium', palette.accentText)}>
                      {subtitle}
                    </p>
                  )}

                  {/* Indicador de fila con tijeras, idéntico a BarberStatusTile */}
                  {queueAhead > 0 && (
                    <div className="flex items-center justify-center gap-1 pt-1" aria-label={`${queueAhead} en fila`}>
                      {Array.from({ length: displayScissors }).map((_, i) => (
                        <Scissors
                          key={i}
                          className={cn('size-3.5 md:size-4', palette.accentText)}
                          strokeWidth={2.5}
                        />
                      ))}
                      {extra > 0 && (
                        <span className={cn('ml-0.5 text-xs md:text-sm font-bold', palette.accentText)}>
                          +{extra}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </button>
      </GlassRing>
    )
  }

  const renderBarberList = (onSelect: (barberId: string) => void, showExpand = true) => {
    const availableBarbers = barbers.filter(b =>
      !isBarberBlockedByShiftEnd(b, dynamicEntries, schedules, now, shiftEndMargin) &&
      !notClockedInBarbers.has(b.id)
    )
    const notArrivedBarbers = barbers.filter(b =>
      !isBarberBlockedByShiftEnd(b, dynamicEntries, schedules, now, shiftEndMargin) &&
      notClockedInBarbers.has(b.id)
    )

    return (
      <div className="w-full flex flex-col gap-5 overflow-y-auto min-h-0 flex-1">

        {/* ── Title ── */}
        <div className="text-center">
          <h2 className={cn('text-2xl md:text-4xl font-bold tracking-tight', isLightBg ? 'text-zinc-900' : 'text-white')}>¿Cómo querés atenderte?</h2>
          <p className={cn('mt-1.5 text-base md:text-xl', isLightBg ? 'text-zinc-600' : 'text-white/60')}>Elegí una opción para continuar</p>
        </div>

        {/* ── TWO MAIN CTAs ── */}
        <div className="flex flex-col gap-4 w-full">

          {/* ── CTA 1: Menor Espera (recommended) ── */}
          {minWaitBarber && (
            <GlassRing halo={!isLightBg}>
              <button
                onClick={() => onSelect(null as unknown as string)}
                disabled={submitting}
                className={cn(
                  'group relative w-full flex items-center gap-4 md:gap-6 rounded-2xl md:rounded-[1.25rem] border p-4 md:p-6 text-left overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
                  isLightBg
                    ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                    : 'border-white/18 checkin-glass-surface hover:border-white/30 focus-visible:ring-white/60'
                )}
              >
                <div className="relative shrink-0">
                  <div className={cn(
                    'size-14 md:size-20 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-transform duration-300',
                    isLightBg
                      ? 'bg-emerald-50 border-emerald-300'
                      : 'bg-gradient-to-br from-emerald-400/25 to-cyan-400/20 border-emerald-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_0_18px_rgba(16,185,129,0.25)]'
                  )}>
                    <Zap className={cn('size-7 md:size-10', isLightBg ? 'text-emerald-600' : 'text-emerald-200 drop-shadow-[0_0_10px_rgba(16,185,129,0.7)]')} fill="currentColor" />
                  </div>
                </div>

                <div className="relative flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={cn('text-xl md:text-3xl font-extrabold', isLightBg ? 'text-zinc-900' : 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.25)]')}>
                      Menor espera
                    </h3>
                    <div className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] md:text-xs font-bold uppercase tracking-wider', isLightBg ? 'bg-emerald-100 border border-emerald-300' : 'bg-emerald-400/15 border border-emerald-400/40')}>
                      <Sparkles className={cn('size-2.5 md:size-3', isLightBg ? 'text-cyan-600' : 'text-cyan-200')} />
                      <span className={isLightBg ? 'text-emerald-700' : 'text-emerald-200'}>IA</span>
                    </div>
                  </div>
                  <p className={cn('text-sm md:text-lg', isLightBg ? 'text-zinc-600' : 'text-white/70')}>
                    Te asignamos al barbero con menos fila
                  </p>
                  <p className={cn('text-[11px] md:text-sm mt-1 md:mt-1.5 font-semibold tracking-wide uppercase', isLightBg ? 'text-emerald-600' : 'text-emerald-200/80')}>
                    Tocá para continuar →
                  </p>
                </div>

                <div className="relative shrink-0">
                  <AvailabilityIndicator level={globalAvailability} size="lg" />
                </div>
              </button>
            </GlassRing>
          )}

          {/* ── CTA 2: Elegir barbero (secondary) ── */}
          <GlassRing halo={false}>
            <button
              onClick={() => setShowBarberPreference(true)}
              disabled={submitting}
              className={cn(
                'group relative w-full flex items-center gap-3 md:gap-5 rounded-2xl border p-4 md:p-5 text-left overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
                isLightBg
                  ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                  : 'border-white/15 checkin-glass-surface hover:border-white/28 focus-visible:ring-white/50'
              )}
            >
              <div className="relative shrink-0">
                <div className={cn(
                  'size-12 md:size-16 rounded-xl border flex items-center justify-center group-hover:scale-105 transition-transform duration-300',
                  isLightBg
                    ? 'bg-violet-50 border-violet-300'
                    : 'bg-gradient-to-br from-violet-400/25 to-indigo-400/15 border-violet-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_0_16px_rgba(139,92,246,0.2)]'
                )}>
                  <User className={cn('size-6 md:size-8', isLightBg ? 'text-violet-600' : 'text-violet-200 drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]')} />
                </div>
              </div>

              <div className="relative flex-1 min-w-0">
                <h3 className={cn('text-lg md:text-2xl font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                  Elegir barbero
                </h3>
                <p className={cn('text-sm md:text-base mt-0.5', isLightBg ? 'text-zinc-600' : 'text-white/60')}>
                  ¿Tenés preferencia? Elegí con quién atenderte
                </p>
              </div>

              <div className="relative shrink-0">
                <ChevronDown className={cn(`size-6 md:size-7 transition-transform duration-300 ${showBarberPreference ? 'rotate-180' : ''}`, isLightBg ? 'text-zinc-400' : 'text-white/60')} />
              </div>
            </button>
          </GlassRing>
        </div>

        {/* ── Barber Selection Dialog Modal ── */}
        <Dialog open={showBarberPreference} onOpenChange={setShowBarberPreference}>
          <DialogContent className={cn(
            isLightBg
              ? 'inset-4 translate-x-0 translate-y-0 m-auto h-fit max-w-[95vw] md:max-w-2xl max-h-[80dvh] flex flex-col overflow-hidden border border-zinc-200 bg-white p-4 md:p-8 rounded-2xl md:rounded-[2rem] shadow-xl'
              : terminalDialogSurface
          )}>
            <DialogHeader className="text-left mb-3 md:mb-6 shrink-0">
              <DialogTitle className={cn(
                'text-xl md:text-3xl font-extrabold',
                isLightBg ? 'text-zinc-900' : 'bg-gradient-to-r from-violet-200 to-indigo-200 bg-clip-text text-transparent'
              )}>
                Elegí tu barbero
              </DialogTitle>
              <DialogDescription className={cn('text-sm md:text-base', isLightBg ? 'text-zinc-500' : 'text-violet-300/70')}>
                Seleccioná con quién te querés atender
              </DialogDescription>
            </DialogHeader>

            <div className={cn(
              'flex-1 min-h-0 overflow-y-auto pr-2 -mr-2 space-y-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full',
              isLightBg
                ? '[&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'
                : '[&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20'
            )}>
              <div className="grid grid-cols-2 gap-3 md:gap-4 pb-2">
                {availableBarbers.map((barber) => renderBarberCard(barber, (id) => {
                  setShowBarberPreference(false);
                  onSelect(id);
                }, showExpand))}
              </div>

              {notArrivedBarbers.length > 0 && (
                <>
                  <div className={cn('w-full h-px my-6', isLightBg ? 'bg-zinc-200' : 'bg-white/8')} />
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn('h-px flex-1', isLightBg ? 'bg-zinc-200' : 'bg-white/10')} />
                    <h4 className={cn('text-xs font-bold uppercase tracking-widest shrink-0', isLightBg ? 'text-zinc-400' : 'text-white/40')}>Aún no llegaron</h4>
                    <div className={cn('h-px flex-1', isLightBg ? 'bg-zinc-200' : 'bg-white/10')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:gap-4 pb-4">
                    {notArrivedBarbers.map((barber) => renderBarberCard(barber, (id) => {
                      setShowBarberPreference(false);
                      onSelect(id);
                    }, showExpand))}
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  const renderPhoneKeypad = (
    currentPhone: string,
    isLooking: boolean
  ) => (
    <>
      <div className={isLightBg ? 'w-full rounded-2xl border border-zinc-300 bg-white p-3 md:p-4 text-center relative overflow-hidden shadow-sm' : terminalKeypadShell}>
        <p className={cn('text-2xl md:text-3xl font-mono font-bold tracking-[0.15em] min-h-8 md:min-h-10 flex items-center justify-center', isLightBg && 'text-zinc-900')}>
          {currentPhone ? (
            formatPhone(currentPhone)
          ) : (
            <span className={isLightBg ? 'text-zinc-300' : 'text-white/20'}>__ ____ ____</span>
          )}
        </p>
        <p className="text-xs md:text-sm text-muted-foreground mt-1 md:mt-2">
          {currentPhone.length < PHONE_LENGTH
            ? `${PHONE_LENGTH - currentPhone.length} dígitos restantes`
            : 'Buscando...'}
        </p>
        {isLooking && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
      </div>

      <div className="w-full grid grid-cols-3 gap-2 md:gap-3 mt-1">
        {KEYPAD.map((d) => (
          <button
            key={d}
            onClick={() => pressDigit(d)}
            disabled={isLooking}
            className={cn('h-11 md:h-[56px] text-xl md:text-2xl', isLightBg ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm' : terminalKeypadKey)}
          >
            {d}
          </button>
        ))}

        <button
          onClick={() => pressDelete()}
          disabled={isLooking || currentPhone.length === 0}
          className={cn('h-11 md:h-[56px] flex items-center justify-center', isLightBg ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm' : terminalKeypadKey)}
        >
          <Delete className="size-5 md:size-6" />
        </button>
        <button
          onClick={() => pressDigit('0')}
          disabled={isLooking}
          className={cn('h-11 md:h-[56px] text-xl md:text-2xl', isLightBg ? 'relative rounded-xl md:rounded-2xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35 shadow-sm' : terminalKeypadKey)}
        >
          0
        </button>
        <div />
      </div>
    </>
  )

  // ── Render ──

  return (
    <div
      className={cn(
        'relative h-dvh flex flex-col items-center select-none overflow-y-auto overflow-x-hidden py-2 md:py-4',
        !isLightBg && 'bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)]'
      )}
      style={branchBg}
    >
      <TerminalGlobalStyles />
      <TerminalAmbient className={isLightBg ? 'hidden' : undefined} />
      {backButton}
      {/* ═══════════════ BRANCH SELECTION ═══════════════ */}
      {step === 'branch' && (
        <div
          key={`branch-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-2xl flex flex-col items-center gap-4 md:gap-8 px-4 md:px-8 my-auto animate-in fade-in zoom-in-95 duration-500"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          <div className="relative flex flex-col items-center gap-3 md:gap-5">
            <div
              className={cn(
                'size-16 md:size-24 rounded-[1.25rem] md:rounded-3xl flex items-center justify-center ring-1',
                isLightBg
                  ? 'bg-white border border-zinc-200 shadow-md ring-zinc-200/80'
                  : 'bg-zinc-950/50 border border-cyan-500/25 shadow-[0_0_32px_rgba(34,211,238,0.12)] ring-cyan-400/15'
              )}
            >
              <Scissors
                className={cn('size-8 md:size-12', isLightBg ? 'text-cyan-700' : 'text-cyan-200')}
                strokeWidth={1.5}
              />
            </div>
            <div className="text-center">
              <h1 className={cn(terminalH1, isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>BarberOS</h1>
              <p className={cn('text-base md:text-xl mt-1 md:mt-3', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
                Bienvenido
              </p>
            </div>
          </div>

          <div
            className={cn(
              'relative h-px w-32 bg-gradient-to-r from-transparent to-transparent',
              isLightBg ? 'via-cyan-600/35' : 'via-cyan-400/40'
            )}
          />

          <div className="relative w-full space-y-4">
            <p className={cn('text-center text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
              Seleccioná tu sucursal
            </p>

            {branches.length === 0 ? (
              <div className="flex items-center justify-center py-10 md:py-16">
                <Loader2 className={cn('size-8 animate-spin', isLightBg ? 'text-cyan-600/60' : 'text-cyan-400/50')} />
              </div>
            ) : (
              <div className="grid gap-3 md:gap-4 w-full">
                {branches.map((branch) => (
                  <GlassRing key={branch.id} halo={false}>
                    <button
                      onClick={() => selectBranch(branch)}
                      className={cn(
                        'group flex items-center gap-4 md:gap-5 w-full p-4 md:p-6 text-left overflow-hidden rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
                        isLightBg
                          ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md'
                          : terminalListItem
                      )}
                    >
                      <div
                        className={cn(
                          'shrink-0 size-12 md:size-16 rounded-xl flex items-center justify-center transition-colors duration-200 border',
                          isLightBg
                            ? 'border-zinc-200 bg-zinc-100 group-hover:border-zinc-300'
                            : 'border-white/15 bg-white/[0.06] group-hover:border-white/28'
                        )}
                      >
                        <MapPin
                          className={cn(
                            'size-6 md:size-7',
                            isLightBg
                              ? 'text-cyan-700'
                              : 'text-white drop-shadow-[0_0_8px_rgba(34,211,238,0.45)]'
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <span
                          className={cn(
                            'text-lg md:text-2xl font-semibold block truncate',
                            isLightBg ? 'text-zinc-900' : 'text-white'
                          )}
                        >
                          {branch.name}
                        </span>
                        {branch.address && (
                          <span
                            className={cn(
                              'text-base block mt-1 truncate',
                              isLightBg ? 'text-zinc-600' : 'text-white/60'
                            )}
                          >
                            {branch.address}
                          </span>
                        )}
                      </div>
                    </button>
                  </GlassRing>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ HOME (sucursal seleccionada) ═══════════════ */}
      {step === 'home' && selectedBranch && (
        <div
          key={`home-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-2xl flex flex-col items-center justify-center gap-5 md:gap-8 px-4 md:px-8 py-4 md:py-8 my-auto animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="relative flex flex-col items-center gap-3 md:gap-4">
            <div className="relative size-16 md:size-24 rounded-full flex items-center justify-center">
              <div
                className="pointer-events-none absolute -inset-6 rounded-full bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.22),rgba(167,139,250,0.12)_45%,transparent_70%)] blur-xl opacity-80 motion-reduce:opacity-60"
                aria-hidden
              />
              <div className="relative size-full rounded-full overflow-hidden flex items-center justify-center ring-1 ring-white/10 bg-zinc-950/80 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/10" />
                <Image
                  src={selectedBranch.organizations?.logo_url || '/logo-barberos.png'}
                  alt={selectedBranch.organizations?.name?.trim() || 'BarberOS'}
                  fill
                  sizes="(max-width: 768px) 64px, 96px"
                  className="absolute inset-0 z-[1] size-full object-cover"
                  priority
                  unoptimized
                />
              </div>
            </div>
            <div className="text-center space-y-1.5 md:space-y-2.5">
              <h1
                className={cn(
                  'text-xl md:text-4xl font-bold tracking-tight text-balance px-1 leading-tight',
                  isLightBg ? 'text-zinc-900' : 'text-white'
                )}
              >
                Bienvenido a{' '}
                <span className={isLightBg ? '' : 'drop-shadow-[0_0_24px_rgba(34,211,238,0.25)]'}>
                  {selectedBranch.organizations?.name?.trim() || 'BarberOS'}
                </span>
              </h1>
              <div
                className={cn(
                  'inline-flex items-center gap-1.5 md:gap-2 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full backdrop-blur-sm',
                  isLightBg
                    ? 'border border-zinc-300 bg-white/70'
                    : 'border border-white/10 bg-zinc-950/50'
                )}
              >
                <MapPin className={cn('size-3 md:size-3.5', isLightBg ? 'text-cyan-700' : 'text-cyan-300/70')} />
                <p className={cn('text-xs md:text-sm font-medium tracking-wide', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
                  {selectedBranch.name}
                </p>
              </div>
            </div>
          </div>

          <div
            role="group"
            aria-labelledby="checkin-registro-pregunta"
            className="relative z-[1] w-full max-w-xs md:max-w-lg flex flex-col items-stretch gap-3 md:gap-5"
          >
            <h2
              id="checkin-registro-pregunta"
              className={cn(
                'text-center text-base md:text-xl font-medium tracking-[0.08em] uppercase',
                isLightBg ? 'text-zinc-600' : 'text-white/55'
              )}
            >
              ¿Estás registrado?
            </h2>
            <div className="grid grid-cols-2 gap-3 md:gap-4 w-full items-stretch">
              <GlassRing halo={!isLightBg}>
                <button
                  type="button"
                  onClick={() => goTo('face_scan')}
                  className={cn(
                    'group relative w-full min-h-[4.75rem] md:min-h-[5.75rem] rounded-2xl md:rounded-[1.25rem] overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 border',
                    isLightBg
                      ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                      : 'border-white/15 checkin-glass-surface focus-visible:ring-white/60'
                  )}
                >
                  <span className="relative flex h-full w-full items-center justify-center gap-2.5 md:gap-3 px-3 py-3 md:px-5 md:py-4">
                    <span
                      className={cn(
                        'relative flex size-10 shrink-0 items-center justify-center rounded-xl backdrop-blur-sm md:size-12 border',
                        isLightBg
                          ? 'border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 shadow-sm'
                          : 'border-white/25 bg-gradient-to-br from-white/20 via-white/8 to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_0_16px_rgba(34,211,238,0.18)]'
                      )}
                      aria-hidden
                    >
                      <ScanFace
                        className={cn(
                          'size-6 transition-transform duration-300 group-hover:scale-110 md:size-7',
                          isLightBg
                            ? 'text-cyan-700'
                            : 'text-white drop-shadow-[0_0_10px_rgba(34,211,238,0.7)]'
                        )}
                        strokeWidth={1.75}
                      />
                    </span>
                    <span
                      className={cn(
                        'text-lg font-bold tracking-wide md:text-2xl',
                        isLightBg ? 'text-zinc-900' : 'text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.35)]'
                      )}
                    >
                      Sí
                    </span>
                  </span>
                </button>
              </GlassRing>

              <GlassRing halo={!isLightBg}>
                <button
                  type="button"
                  onClick={() => goTo('phone')}
                  className={cn(
                    'group relative w-full min-h-[4.75rem] md:min-h-[5.75rem] rounded-2xl md:rounded-[1.25rem] overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 border',
                    isLightBg
                      ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                      : 'border-white/15 checkin-glass-surface focus-visible:ring-white/55'
                  )}
                >
                  <span className="relative flex h-full w-full items-center justify-center gap-2.5 md:gap-3 px-3 py-3 md:px-5 md:py-4">
                    <span
                      className={cn(
                        'relative flex size-10 shrink-0 items-center justify-center rounded-xl backdrop-blur-sm md:size-12 border',
                        isLightBg
                          ? 'border-zinc-200 bg-gradient-to-br from-zinc-50 to-zinc-100 shadow-sm'
                          : 'border-white/22 bg-gradient-to-br from-white/18 via-white/6 to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_0_14px_rgba(255,255,255,0.08)]'
                      )}
                      aria-hidden
                    >
                      <UserPlus
                        className={cn(
                          'size-6 transition-transform duration-300 group-hover:scale-110 md:size-7',
                          isLightBg
                            ? 'text-zinc-700'
                            : 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.35)]'
                        )}
                        strokeWidth={1.75}
                      />
                    </span>
                    <span
                      className={cn(
                        'text-lg font-bold tracking-wide md:text-2xl',
                        isLightBg ? 'text-zinc-900' : 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]'
                      )}
                    >
                      No
                    </span>
                  </span>
                </button>
              </GlassRing>
            </div>
          </div>

          <div className="relative z-[1] flex flex-col items-center gap-2 md:gap-3">
            <div className={cn('h-px w-24 md:w-32 bg-gradient-to-r from-transparent to-transparent', isLightBg ? 'via-zinc-400/50' : 'via-white/15')} />
            <div className="flex items-center gap-4 md:gap-6">
              <button
                onClick={() => goTo('staff_face_scan')}
                className={cn(
                  'group flex items-center gap-1.5 md:gap-2 text-sm md:text-base transition-colors py-1.5 px-2 rounded-lg font-medium',
                  isLightBg ? 'text-zinc-600 hover:text-cyan-700' : 'text-white/55 hover:text-cyan-200'
                )}
              >
                <LogIn className="size-4 md:size-[18px] transition-transform group-hover:-translate-x-0.5" />
                <span>Soy barbero</span>
              </button>
              <div className={cn('h-4 w-px', isLightBg ? 'bg-zinc-300' : 'bg-white/10')} aria-hidden />
              <button
                onClick={changeBranch}
                className={cn(
                  'group flex items-center gap-1.5 md:gap-2 text-sm md:text-base transition-colors py-1.5 px-2 rounded-lg font-medium',
                  isLightBg ? 'text-zinc-500 hover:text-zinc-800' : 'text-white/40 hover:text-white/70'
                )}
              >
                <Settings2 className="size-3.5 md:size-4 transition-transform group-hover:rotate-45" />
                <span>Cambiar sucursal</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ FACE SCAN ═══════════════ */}
      {step === 'face_scan' && (
        <div
          key={`face-scan-${animKey}`}
          className="relative z-[1] w-full max-w-lg md:max-w-3xl flex flex-col items-center gap-3 px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          <FaceCamera
            variant="terminal"
            isLightBg={isLightBg}
            branchName={selectedBranch?.name}
            orgId={selectedBranch?.organization_id}
            onMatch={handleFaceMatch}
            onNoMatch={handleFaceNoMatch}
            onManualEntry={handleFaceManualEntry}
          />
        </div>
      )}

      {/* ═══════════════ FACE CONFIRM ═══════════════ */}
      {step === 'face_confirm' && faceMatch && (
        <div
          key={`face-confirm-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-8 md:gap-10 px-6 pt-16 md:pt-20 pb-8 flex-1 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          {/* Nombre y pregunta */}
          <div className="relative text-center">
            <p className={cn('text-lg md:text-xl', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>¿Sos vos?</p>
            <h2 className={cn('text-4xl md:text-5xl font-bold mt-2', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>{faceMatch.clientName}</h2>
          </div>

          {/* Botones de confirmación */}
          <div className="relative flex items-center gap-10 md:gap-16">
            {/* No soy yo */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleFaceConfirmNo}
                className={cn(
                  'size-24 md:size-28 rounded-full border-2 flex items-center justify-center active:scale-95 transition-all duration-200',
                  isLightBg
                    ? 'bg-red-100 border-red-300 hover:bg-red-200 hover:border-red-400'
                    : 'bg-red-950/40 border-red-500/50 shadow-[0_0_28px_rgba(239,68,68,0.2)] hover:bg-red-950/60 hover:border-red-400 hover:shadow-[0_0_36px_rgba(239,68,68,0.35)]'
                )}
              >
                <X className={cn('size-12 md:size-14', isLightBg ? 'text-red-500' : 'text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.5)]')} strokeWidth={2.5} />
              </button>
              <span className={cn('text-sm md:text-base', isLightBg ? 'text-red-600' : 'text-red-300/80')}>No soy yo</span>
            </div>

            {/* Sí, soy yo */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleFaceConfirmYes}
                className={cn(
                  'size-24 md:size-28 rounded-full border-2 flex items-center justify-center active:scale-95 transition-all duration-200',
                  isLightBg
                    ? 'bg-emerald-100 border-emerald-300 hover:bg-emerald-200 hover:border-emerald-400'
                    : 'bg-zinc-950/90 border-emerald-400/45 shadow-[0_0_28px_rgba(52,211,153,0.22)] hover:border-emerald-300/70 hover:shadow-[0_0_36px_rgba(52,211,153,0.32)]'
                )}
              >
                <Check className={cn('size-12 md:size-14', isLightBg ? 'text-emerald-600' : 'text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.55)]')} strokeWidth={2.5} />
              </button>
              <span className={cn('text-sm md:text-base', isLightBg ? 'text-emerald-700' : 'text-emerald-300/85')}>Sí, soy yo</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ PHONE ENTRY ═══════════════ */}
      {step === 'phone' && (
        <div
          key={`phone-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-2 md:gap-4 px-4 md:px-6 pt-6 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          {/* Show no-match header if coming from face scan */}
          {faceDescriptor && (
            <div className="relative flex flex-col items-center gap-1.5 md:gap-2 mb-1 md:mb-2">
              <div className={cn(
                'size-10 md:size-14 rounded-full border flex items-center justify-center',
                isLightBg
                  ? 'border-cyan-300 bg-cyan-50'
                  : 'border-cyan-500/20 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
              )}>
                <User className={cn('size-5 md:size-7', isLightBg ? 'text-cyan-600' : 'text-cyan-300/80')} />
              </div>
              <p className={cn('text-sm md:text-base text-center', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
                No te reconocemos · número de teléfono
              </p>
            </div>
          )}

          <div className="relative text-center mt-1 md:mt-2">
            <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>Número de teléfono</h2>
            <p className={cn('mt-0.5 md:mt-2 text-sm md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>{selectedBranch?.name}</p>
          </div>

          {renderPhoneKeypad(phone, lookingUp)}
        </div>
      )}

      {/* ═══════════════ NAME CONFIRMATION / ENTRY ═══════════════ */}
      {step === 'name' && (
        <div
          key={`name-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          {isReturning ? (
            <div className="relative flex flex-col items-center gap-4 md:gap-6 mt-4 md:mt-6">
              <div className={cn(
                'size-20 md:size-24 rounded-full border flex items-center justify-center animate-in zoom-in-75 duration-500',
                isLightBg
                  ? 'border-cyan-300 bg-cyan-100 shadow-md'
                  : 'border-cyan-500/25 bg-cyan-500/10 shadow-[0_0_28px_rgba(34,211,238,0.15)]'
              )}>
                <span className="text-4xl md:text-5xl">👋</span>
              </div>
              <div className="text-center">
                <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>¡Bienvenido de vuelta!</h2>
                <p className={cn('text-3xl md:text-4xl font-bold mt-2 md:mt-4', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>{name}</p>
                <p className={cn('mt-2 md:mt-3 text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>Tel: {formatPhone(phone)}</p>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-col items-center gap-4 md:gap-6 mt-4 md:mt-6 w-full">
              <div className="text-center">
                <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>¡Primera vez!</h2>
                <p className={cn('text-lg md:text-xl mt-1 md:mt-2', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>Te damos la bienvenida</p>
                <p className={cn('mt-1 text-sm md:text-base', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>
                  Ingresá tu nombre para continuar
                </p>
              </div>
              <Input
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) goToBarberStep()
                }}
                placeholder="Nombre y apellido"
                className={cn(
                  'h-14 md:h-16 text-xl md:text-2xl text-center rounded-2xl',
                  isLightBg
                    ? 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 shadow-sm focus-visible:border-cyan-500'
                    : 'border-cyan-500/20 bg-zinc-950/50 text-cyan-50 placeholder:text-cyan-200/30 shadow-[inset_0_0_24px_rgba(34,211,238,0.04)] focus-visible:border-cyan-400/40'
                )}
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <p className="text-destructive text-center text-lg">{error}</p>
          )}

          <GlassRing radius="rounded-[0.875rem] md:rounded-[1.375rem]" halo={!isLightBg} className="w-full mt-2">
            <Button
              onClick={goToBarberStep}
              disabled={!name.trim()}
              className={cn(
                isLightBg
                  ? 'relative z-[1] flex w-full flex-row items-center justify-center gap-3 md:gap-4 overflow-hidden rounded-[0.875rem] md:rounded-[1.375rem] border border-zinc-300 bg-white text-zinc-900 shadow-sm px-3 py-3 md:px-5 md:py-4 transition-all duration-300 hover:border-zinc-400 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/35'
                  : terminalPrimaryInnerBtn,
                'h-14 md:h-16 min-h-0 rounded-[0.875rem] md:rounded-[1.375rem] text-lg md:text-xl font-semibold shadow-none disabled:opacity-40 disabled:hover:scale-100'
              )}
              size="lg"
            >
              {!isLightBg && <span className="checkin-terminal-shimmer-layer pointer-events-none absolute inset-0 rounded-[inherit] opacity-30 motion-reduce:opacity-0" />}
              <span className={cn('relative font-bold tracking-wide', isLightBg ? 'text-zinc-900' : 'text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]')}>
                Continuar
              </span>
            </Button>
          </GlassRing>
        </div>
      )}

      {/* ═══════════════ FACE ENROLLMENT ═══════════════ */}
      {step === 'face_enroll' && (
        <div
          key={`face-enroll-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          <FaceEnrollment
            clientId={faceClientId || undefined}
            clientName={name || 'Cliente'}
            source="checkin"
            branchId={selectedBranch?.id}
            captureOnly={wantsEnrollment}
            onCapture={(descriptors, photo) => {
              setCapturedFaceDescriptors(descriptors)
              setCapturedFacePhoto(photo)
              goTo('service_selection')
            }}
            onComplete={() => goTo('service_selection')}
            onSkip={() => {
              goTo('service_selection')
            }}
          />
        </div>
      )}

      {/* ═══════════════ SERVICE SELECTION ═══════════════ */}
      {step === 'service_selection' && (
        <div
          key={`service-${animKey}`}
          className={cn(
            'relative z-[1] w-full flex flex-col items-center gap-3 md:gap-6 px-4 md:px-6 pt-6 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400',
            services.length <= 6 && 'max-w-sm md:max-w-3xl',
            services.length > 6 && services.length <= 12 && 'max-w-sm md:max-w-5xl',
            services.length > 12 && 'max-w-sm md:max-w-7xl',
          )}
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          <div className="relative text-center">
            <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>¿Qué te vas a hacer?</h2>
            <p className={cn('mt-0.5 md:mt-2 text-sm md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
              Elegí tu servicio
            </p>
          </div>

          <div
            className={cn(
              'relative w-full grid gap-3 md:gap-4 mt-1 md:mt-2 min-h-0 flex-1 auto-rows-fr',
              services.length <= 6 && 'grid-cols-1',
              services.length > 6 && services.length <= 12 && 'grid-cols-1 md:grid-cols-2',
              services.length > 12 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
            )}
          >
            {services.map(s => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedServiceId(s.id)
                  goTo('barber')
                }}
                className={cn(
                  'flex items-center justify-between gap-4 w-full h-full min-h-[4.5rem] px-5 md:px-7 py-4 md:py-5 rounded-xl md:rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] text-left',
                  isLightBg
                    ? 'border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md'
                    : terminalListItem
                )}
              >
                <h3
                  className={cn(
                    'text-lg md:text-2xl font-semibold leading-tight line-clamp-2 flex-1 min-w-0',
                    isLightBg ? 'text-zinc-900' : 'text-white'
                  )}
                >
                  {s.name}
                </h3>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {s.duration_minutes && (
                    <p
                      className={cn(
                        'text-xs md:text-sm font-medium',
                        isLightBg ? 'text-zinc-600' : 'text-white/60'
                      )}
                    >
                      {s.duration_minutes} min
                    </p>
                  )}
                  {s.price > 0 && (
                    <p className={cn('text-base md:text-xl font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                      ${s.price}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════ BARBER SELECTION ═══════════════ */}
      {step === 'barber' && (
        <div
          key={`barber-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-3 md:gap-5 px-4 md:px-6 pt-4 md:pt-10 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          <div className="relative text-center">
            <p className={cn('text-sm md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
              {name} · {selectedBranch?.name}
            </p>
          </div>

          {loadingBarbers ? (
            <div className="flex items-center justify-center py-10 md:py-16">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : barbers.length === 0 ? (
            <div className="text-center py-10 md:py-16">
              <User className="size-10 md:size-12 text-muted-foreground mx-auto mb-3 md:mb-4" />
              <p className="text-base md:text-lg text-muted-foreground">
                No hay barberos disponibles en este momento
              </p>
            </div>
          ) : (
            renderBarberList((barberId) => handleConfirm(barberId))
          )}

          {error && (
            <p className="text-destructive text-center text-lg">{error}</p>
          )}

          {submitting && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-lg">Registrando...</span>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ SUCCESS ═══════════════ */}
      {step === 'success' && (
        <div
          key={`success-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-xl flex flex-col items-center justify-center gap-2.5 md:gap-4 px-4 md:px-6 pt-6 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          {!changingBarberInSuccess ? (
            <>
              <div
                className={cn(
                  'w-full max-w-xl p-5 md:p-10 flex flex-col items-center gap-3 md:gap-5 animate-in zoom-in-50 duration-700',
                  isLightBg
                    ? 'rounded-2xl md:rounded-3xl border border-zinc-200 bg-white shadow-lg'
                    : terminalGlassCard
                )}
              >
                <div className={cn(
                  'size-12 md:size-16 rounded-full border flex items-center justify-center',
                  isLightBg
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-emerald-500/10 border-emerald-400/30 shadow-[0_0_24px_rgba(52,211,153,0.15)]'
                )}>
                  <CheckCircle2 className={cn('size-6 md:size-9', isLightBg ? 'text-emerald-600' : 'text-emerald-400')} strokeWidth={1.5} />
                </div>

                <h2 className={cn('text-lg md:text-2xl font-bold', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>¡Estás en la fila!</h2>

                <div className="text-center">
                  <p className={cn('text-4xl md:text-6xl font-bold leading-tight mt-2', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>
                    ¡Tomá asiento!
                  </p>
                  {effectiveAhead && effectiveAhead.label && (
                    <p className={cn('text-lg md:text-xl font-medium mt-3', isLightBg ? 'text-emerald-600' : 'text-emerald-400')}>
                      {effectiveAhead.label}
                    </p>
                  )}
                  <p className={cn('text-base md:text-lg mt-2', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>
                    Te llamaremos cuando sea tu turno
                  </p>
                </div>
              </div>

              <div className="w-full max-w-xl flex flex-col items-center gap-2">
                {queueEntryId && (
                  <Button
                    onClick={() => {
                      if (resetTimer.current) clearTimeout(resetTimer.current)
                      setChangingBarberInSuccess(true)
                    }}
                    variant="outline"
                    className={cn(
                      'h-11 md:h-12 text-sm md:text-base rounded-xl w-full max-w-xs',
                      isLightBg
                        ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-400'
                        : 'border-cyan-500/25 bg-zinc-950/40 text-cyan-100 hover:bg-cyan-950/30 hover:text-white hover:border-cyan-400/40'
                    )}
                  >
                    <RefreshCw className="size-4 mr-2" />
                    Cambiar barbero
                  </Button>
                )}

                {/* Face enrollment offer */}
                {!hasExistingFace && faceClientId && (
                  <button
                    onClick={() => {
                      if (resetTimer.current) clearTimeout(resetTimer.current)
                      goTo('face_enroll')
                    }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3 w-full max-w-xs transition-all active:scale-[0.98]',
                      isLightBg
                        ? 'border-zinc-300 bg-white hover:bg-zinc-50 hover:border-zinc-400 hover:shadow-sm'
                        : 'border-cyan-500/25 bg-cyan-950/30 hover:bg-cyan-950/45 hover:border-cyan-400/40 hover:shadow-[0_0_24px_rgba(34,211,238,0.12)]'
                    )}
                  >
                    <div className={cn('shrink-0 size-8 rounded-lg border flex items-center justify-center', isLightBg ? 'border-cyan-300 bg-cyan-50' : 'border-cyan-500/20 bg-cyan-500/10')}>
                      <User className={cn('size-4', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} />
                    </div>
                    <div className="text-left">
                      <p className={cn('text-sm font-medium', isLightBg ? 'text-zinc-800' : 'text-cyan-200')}>Registrar tu cara</p>
                      <p className={cn('text-xs mt-0.5', isLightBg ? 'text-zinc-500' : 'text-cyan-300/65')}>
                        Hacé check-in solo con mirarte
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {/* Countdown bar */}
              <div className={cn(isLightBg ? 'w-full max-w-xs h-1 rounded-full bg-zinc-200 overflow-hidden border border-zinc-300' : terminalProgressTrack, 'mt-2')}>
                <div
                  className={isLightBg ? 'h-full rounded-full origin-left bg-gradient-to-r from-cyan-500 via-zinc-700 to-violet-500' : terminalProgressFill}
                  style={{
                    animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards`,
                  }}
                />
              </div>
              <p className={cn('text-xs', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>Volviendo al inicio...</p>
            </>
          ) : (
            <>

              <div className="relative text-center">
                <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>Cambiar barbero</h2>
                <p className={cn('mt-1 md:mt-2 text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
                  Seleccioná otro barbero
                </p>
              </div>

              {loadingBarbers ? (
                <div className="flex items-center justify-center py-10 md:py-16">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : barbers.length === 0 ? (
                <div className="text-center py-10 md:py-16">
                  <p className="text-base md:text-lg text-muted-foreground">
                    No hay barberos disponibles
                  </p>
                </div>
              ) : (
                renderBarberList((barberId) => {
                  if (queueEntryId) handleReassign(queueEntryId, barberId)
                }, false)
              )}

              {error && (
                <p className="text-destructive text-center text-lg">{error}</p>
              )}

              {submitting && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-lg">Cambiando...</span>
                </div>
              )}
            </>
          )}
        </div>
      )}



      {step === 'staff_face_scan' && (
        <div
          key={`staff-face-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          <div className="relative text-center mt-2">
            <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>Identificación barbero</h2>
            <p className={cn('mt-1 md:mt-2 text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
              Mirá la cámara para identificarte
            </p>
          </div>
          <FaceCamera
            variant="terminal"
            isLightBg={isLightBg}
            branchName={selectedBranch?.name ?? 'Sucursal'}
            targetRole="staff"
            orgId={selectedBranch?.organization_id}
            onMatch={(match) => {
              setStaffFaceMatch(match)
              goTo('staff_action_confirm')
            }}
            onNoMatch={() => {
              goTo('staff_pin')
            }}
            onManualEntry={() => {
              goTo('staff_pin')
            }}
          />
          {error && <p className="text-destructive text-center text-lg">{error}</p>}
        </div>
      )}

      {/* ═══════════════ STAFF ACTION CONFIRM ═══════════════ */}
      {step === 'staff_action_confirm' && staffFaceMatch && (
        <div
          key={`staff-action-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
          {!staffActionDone ? (
            <>
              <div className="relative text-center">
                <div className="size-20 md:size-24 rounded-full border border-cyan-500/25 bg-cyan-500/10 shadow-[0_0_28px_rgba(34,211,238,0.12)] flex items-center justify-center mx-auto mb-3 md:mb-4 animate-in zoom-in-50 duration-700">
                  <span className="text-4xl md:text-5xl font-bold bg-gradient-to-br from-cyan-200 to-violet-200 bg-clip-text text-transparent">
                    {staffFaceMatch.clientName.charAt(0)}
                  </span>
                </div>
                <h2 className={cn('text-2xl md:text-3xl font-bold', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>{staffFaceMatch.clientName}</h2>
                <p className={cn('mt-1 md:mt-2 text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>¿Qué querés registrar?</p>
              </div>

              <div className="relative w-full grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 max-w-2xl mx-auto">
                <button
                  onClick={async () => {
                    const branchId = selectedBranch?.id
                    if (!branchId) return
                    const staffId = staffFaceMatch.clientId
                    if (!staffId) { setError('Barbero no encontrado'); return }

                    const res = await registerBarberClockIn(staffId, branchId, true)
                    if (res.error) { setError(res.error); return }

                    setStaffAction('clock_in')
                    setStaffActionDone(true)
                    resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
                  }}
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-400/35 bg-emerald-950/35 p-6 shadow-[0_0_24px_rgba(52,211,153,0.08)] backdrop-blur-sm transition-all hover:border-emerald-300/50 hover:bg-emerald-950/50 hover:shadow-[0_0_32px_rgba(52,211,153,0.15)] active:scale-95"
                >
                  <LogIn className="size-10 text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.4)]" />
                  <span className="text-lg font-semibold text-emerald-200">Entrada</span>
                </button>

                <button
                  onClick={async () => {
                    const branchId = selectedBranch?.id
                    if (!branchId) return
                    const staffId = staffFaceMatch.clientId
                    if (!staffId) { setError('Barbero no encontrado'); return }

                    const res = await registerBarberClockOut(staffId, branchId, true)
                    if (res.error) { setError(res.error); return }

                    setStaffAction('clock_out')
                    setStaffActionDone(true)
                    resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
                  }}
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-400/35 bg-red-950/35 p-6 shadow-[0_0_24px_rgba(248,113,113,0.08)] backdrop-blur-sm transition-all hover:border-red-300/50 hover:bg-red-950/50 hover:shadow-[0_0_32px_rgba(248,113,113,0.15)] active:scale-95"
                >
                  <LogOut className="size-10 text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.4)]" />
                  <span className="text-lg font-semibold text-red-200">Salida</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => goTo('branch')}
                className={cn(
                  'mt-2 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2 text-sm text-white/60 hover:bg-white/[0.05] hover:text-white transition-colors',
                  isLightBg && 'border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                )}
              >
                <ArrowLeft className="size-4" />
                Cancelar
              </button>

              {error && <p className="text-destructive text-center text-base md:text-lg">{error}</p>}
            </>
          ) : (
            <>
              <div className={cn(
                'size-24 md:size-28 rounded-full border flex items-center justify-center animate-in zoom-in-50 duration-700',
                isLightBg
                  ? 'border-cyan-300 bg-cyan-50 shadow-md'
                  : 'border-cyan-400/30 bg-zinc-950/60 shadow-[0_0_36px_rgba(34,211,238,0.15)]'
              )}>
                <CheckCircle2 className={cn('size-12 md:size-16', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <h2 className={cn('text-3xl md:text-4xl font-bold', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>
                  {staffAction === 'clock_in' ? '¡Entrada registrada!' : '¡Salida registrada!'}
                </h2>
                <p className={cn('text-xl md:text-2xl mt-2 md:mt-3', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>{staffFaceMatch.clientName}</p>
                <p className={cn('text-base md:text-lg mt-1', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>
                  {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className={isLightBg ? 'w-full max-w-xs h-1 rounded-full bg-zinc-200 overflow-hidden border border-zinc-300' : terminalProgressTrack}>
                <div
                  className={isLightBg ? 'h-full rounded-full origin-left bg-gradient-to-r from-cyan-500 via-zinc-700 to-violet-500' : terminalProgressFill}
                  style={{ animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards` }}
                />
              </div>
              <p className={cn('text-sm', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>Volviendo al inicio...</p>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ STAFF PIN (face not recognized) ═══════════════ */}
      {step === 'staff_pin' && (
        <div
          key={`staff-pin-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          {!staffPinSelected ? (
            <>
              <div className="relative text-center mt-2">
                <div className="size-14 md:size-16 rounded-full border border-amber-400/35 bg-amber-950/30 shadow-[0_0_24px_rgba(251,191,36,0.12)] flex items-center justify-center mx-auto mb-3">
                  <ScanFace className="size-7 md:size-8 text-amber-300" strokeWidth={1.5} />
                </div>
                <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>No te reconocimos</h2>
                <p className={cn('mt-1 md:mt-2 text-base md:text-lg', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
                  Ingresá tu PIN para registrar tu rostro
                </p>
              </div>

              {staffPinLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : staffPinBarbers.length === 0 ? (
                <p className="text-center text-base text-muted-foreground py-10">
                  No hay barberos en esta sucursal
                </p>
              ) : (
                <div className="w-full grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto min-h-0 flex-1">
                  {staffPinBarbers.map((barber) => (
                    <button
                      key={barber.id}
                      onClick={() => {
                        setStaffPinSelected(barber)
                        setStaffPinValue('')
                        setStaffPinError('')
                      }}
                      className={cn('flex flex-col items-center gap-3 rounded-2xl p-5', terminalListItem)}
                    >
                      {barber.avatar_url ? (
                        <Image
                          src={barber.avatar_url}
                          alt={barber.full_name}
                          width={64}
                          height={64}
                          className="size-16 rounded-full object-cover ring-1 ring-cyan-500/20"
                          unoptimized
                        />
                      ) : (
                        <div className="flex size-16 items-center justify-center rounded-full border border-cyan-500/15 bg-cyan-950/40 text-xl font-bold text-cyan-100">
                          {barber.full_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-center text-sm font-medium leading-tight">
                        {barber.full_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 mt-2">
                {staffPinSelected.avatar_url ? (
                  <Image
                    src={staffPinSelected.avatar_url}
                    alt={staffPinSelected.full_name}
                    width={80}
                    height={80}
                    className="size-20 rounded-full object-cover border-2 border-white/10"
                    unoptimized
                  />
                ) : (
                  <div className="flex size-20 items-center justify-center rounded-full bg-white/8 border-2 border-white/10 text-2xl font-bold">
                    {staffPinSelected.full_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <h2 className="text-xl md:text-2xl font-bold">{staffPinSelected.full_name}</h2>
                <p className="text-muted-foreground text-base">Ingresá tu PIN</p>
              </div>

              <div className="flex gap-3 my-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn('size-4 rounded-full border-2 transition-colors', i < staffPinValue.length
                      ? (isLightBg ? 'border-zinc-900 bg-zinc-900' : 'border-white bg-white')
                      : (isLightBg ? 'border-zinc-300' : 'border-white/30')
                    )}
                  />
                ))}
              </div>

              {staffPinError && (
                <p className="text-destructive text-center text-base">{staffPinError}</p>
              )}

              {staffPinSubmitting && (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              )}

              <div className="w-full max-w-[280px] grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    disabled={staffPinSubmitting}
                    onClick={() => {
                      if (staffPinValue.length >= 4 || staffPinSubmitting) return
                      const next = staffPinValue + d
                      setStaffPinValue(next)
                      setStaffPinError('')
                      if (next.length === 4) {
                        setStaffPinSubmitting(true)
                        verifyBarberPin(staffPinSelected.id, next).then((res) => {
                          if (res.error) {
                            setStaffPinError(res.error)
                            setStaffPinValue('')
                            setStaffPinSubmitting(false)
                          } else if ('success' in res && res.success) {
                            setStaffEnrollId(res.staffId)
                            setStaffEnrollName(res.staffName)
                            setStaffPinSubmitting(false)
                            goTo('staff_face_enroll')
                          }
                        })
                      }
                    }}
                    className={cn('h-14 text-2xl', terminalKeypadKey)}
                  >
                    {d}
                  </button>
                ))}
                <button
                  onClick={() => {
                    if (!staffPinSubmitting) {
                      setStaffPinValue((p) => p.slice(0, -1))
                      setStaffPinError('')
                    }
                  }}
                  disabled={staffPinSubmitting || staffPinValue.length === 0}
                  className={cn('h-14 flex items-center justify-center', terminalKeypadKey)}
                >
                  <Delete className="size-6" />
                </button>
                <button
                  disabled={staffPinSubmitting}
                  onClick={() => {
                    if (staffPinValue.length >= 4 || staffPinSubmitting) return
                    const next = staffPinValue + '0'
                    setStaffPinValue(next)
                    setStaffPinError('')
                    if (next.length === 4) {
                      setStaffPinSubmitting(true)
                      verifyBarberPin(staffPinSelected.id, next).then((res) => {
                        if (res.error) {
                          setStaffPinError(res.error)
                          setStaffPinValue('')
                          setStaffPinSubmitting(false)
                        } else if ('success' in res && res.success) {
                          setStaffEnrollId(res.staffId)
                          setStaffEnrollName(res.staffName)
                          setStaffPinSubmitting(false)
                          goTo('staff_face_enroll')
                        }
                      })
                    }
                  }}
                  className={cn('h-14 text-2xl', terminalKeypadKey)}
                >
                  0
                </button>
                <div />
              </div>

              <button
                onClick={() => {
                  setStaffPinSelected(null)
                  setStaffPinValue('')
                  setStaffPinError('')
                }}
                className="text-muted-foreground hover:text-foreground transition-colors py-2 text-sm"
              >
                Elegir otro barbero
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ STAFF FACE ENROLL ═══════════════ */}
      {step === 'staff_face_enroll' && staffEnrollId && (
        <div
          key={`staff-enroll-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          <FaceEnrollment
            clientName={staffEnrollName}
            source="checkin"
            captureOnly
            onCapture={async (descriptors, photo) => {
              const saves = descriptors.map((d, i) =>
                enrollStaffFaceDescriptor(staffEnrollId!, d, 'checkin', i === 0 ? 0.99 : 0)
              )
              if (photo) {
                saves.push(saveStaffFacePhoto(staffEnrollId!, photo).then(() => true))
              }
              await Promise.all(saves)

              setStaffFaceMatch({
                clientId: staffEnrollId!,
                clientName: staffEnrollName,
                clientPhone: '',
                facePhotoUrl: null,
                distance: 0,
              })
              goTo('staff_action_confirm')
            }}
            onComplete={() => {
              setStaffFaceMatch({
                clientId: staffEnrollId!,
                clientName: staffEnrollName,
                clientPhone: '',
                facePhotoUrl: null,
                distance: 0,
              })
              goTo('staff_action_confirm')
            }}
            onSkip={() => {
              goTo('home')
            }}
          />
        </div>
      )}

      {/* ═══════════════ MANAGE TURN ═══════════════ */}
      {step === 'manage_turn' && myQueueEntry && (
        <div
          key={`manage-turn-${animKey}`}
          className="relative z-[1] w-full max-w-sm md:max-w-xl flex flex-col items-center justify-center gap-4 md:gap-5 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

          {!changingBarberInManage ? (
            <>
              <div
                className={cn(
                  'w-full max-w-xl p-5 md:p-10 flex flex-col items-center gap-3 md:gap-5 animate-in zoom-in-50 duration-700',
                  isLightBg
                    ? 'rounded-2xl md:rounded-3xl border border-zinc-200 bg-white shadow-lg'
                    : terminalGlassCard
                )}
              >
                {myQueueEntry.status === 'in_progress' ? (
                  <>
                    <div className={cn('size-12 md:size-16 rounded-full border flex items-center justify-center', isLightBg ? 'bg-emerald-50 border-emerald-300' : 'bg-emerald-500/10 border-emerald-400/30 shadow-[0_0_24px_rgba(52,211,153,0.12)]')}>
                      <CheckCircle2 className={cn('size-6 md:size-9', isLightBg ? 'text-emerald-600' : 'text-emerald-400')} strokeWidth={1.5} />
                    </div>
                    <h2 className={cn('text-lg md:text-2xl font-bold', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>¡Ya es tu turno!</h2>
                    <div className="text-center">
                      <p className={cn('text-4xl md:text-6xl font-bold leading-tight mt-2', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>
                        ¡Acercate!
                      </p>
                      <p className={cn('text-base md:text-lg mt-2', isLightBg ? 'text-emerald-600' : 'text-emerald-400')}>
                        Tu barbero te está esperando
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={cn('size-12 md:size-16 rounded-full border flex items-center justify-center', isLightBg ? 'bg-emerald-50 border-emerald-300' : 'bg-emerald-500/10 border-emerald-400/30 shadow-[0_0_24px_rgba(52,211,153,0.12)]')}>
                      <CheckCircle2 className={cn('size-6 md:size-9', isLightBg ? 'text-emerald-600' : 'text-emerald-400')} strokeWidth={1.5} />
                    </div>
                    <h2 className={cn('text-lg md:text-2xl font-bold', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>¡Estás en la fila!</h2>
                    <div className="text-center">
                      <p className={cn('text-4xl md:text-6xl font-bold leading-tight mt-2', isLightBg ? 'text-zinc-900' : terminalH1Gradient)}>
                        ¡Tomá asiento!
                      </p>
                      <p className={cn('text-base md:text-lg mt-2', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>
                        Ya te llamamos cuando sea tu turno
                      </p>
                    </div>
                  </>
                )}

                {myQueueEntry.barber && (
                  <div className={cn('w-full p-3 md:p-4 mt-1', isLightBg ? 'rounded-xl border border-zinc-200 bg-zinc-50' : terminalGlassCardInner)}>
                    <div className="flex items-center gap-3 justify-center">
                      <div className={cn('flex size-10 md:size-12 items-center justify-center rounded-full border text-sm md:text-base font-bold shrink-0', isLightBg ? 'border-cyan-300 bg-cyan-50 text-cyan-700' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-100')}>
                        {(myQueueEntry.barber as Staff).full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className={cn('text-base md:text-lg font-semibold truncate', isLightBg && 'text-zinc-900')}>
                          {(myQueueEntry.barber as Staff).full_name}
                        </p>
                        <p className={cn('text-xs md:text-sm', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>Tu barbero asignado</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="w-full max-w-xl flex flex-col items-center gap-2">
                {myQueueEntry.status === 'waiting' && (
                  <Button
                    onClick={() => {
                      if (resetTimer.current) clearTimeout(resetTimer.current)
                      setChangingBarberInManage(true)
                    }}
                    variant="outline"
                    className={cn(
                      'h-11 md:h-12 text-sm md:text-base rounded-xl w-full max-w-xs',
                      isLightBg
                        ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-400'
                        : 'border-cyan-500/25 bg-zinc-950/40 text-cyan-100 hover:bg-cyan-950/30 hover:text-white'
                    )}
                  >
                    <RefreshCw className="size-4 mr-2" />
                    Cambiar barbero
                  </Button>
                )}
              </div>

              {/* Countdown bar */}
              <div className={isLightBg ? 'w-full max-w-xs h-1 rounded-full bg-zinc-200 overflow-hidden border border-zinc-300' : terminalProgressTrack}>
                <div
                  className={isLightBg ? 'h-full rounded-full origin-left bg-gradient-to-r from-cyan-500 via-zinc-700 to-violet-500' : terminalProgressFill}
                  style={{ animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards` }}
                />
              </div>
              <p className={cn('text-xs md:text-sm text-center', isLightBg ? 'text-zinc-500' : terminalBodyMuted)}>Volviendo al inicio...</p>
            </>
          ) : (
            <>
              <div className="relative text-center">
                <h2 className={cn(terminalH2, isLightBg && 'text-zinc-900')}>Cambiar barbero</h2>
              </div>

              {loadingBarbers ? (
                <div className="flex items-center justify-center py-10 md:py-16">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                renderBarberList((barberId) => {
                  handleReassign(myQueueEntry.id, barberId)
                }, false)
              )}

              {error && (
                <p className="text-destructive text-center text-lg">{error}</p>
              )}

              {submitting && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="text-lg">Cambiando...</span>
                </div>
              )}

              <button
                onClick={() => setChangingBarberInManage(false)}
                className="text-muted-foreground hover:text-foreground transition-colors py-3 text-base md:text-lg"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
