
'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
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
  Smartphone,
  Zap,
  User,
  RefreshCw,
  Search,
  LogIn,
  LogOut,
  Coffee,
  ScanFace,
  Settings2,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import type { Branch, Staff, QueueEntry, Visit, Service, StaffSchedule, AppSettings } from '@/lib/types/database'
import {
  buildBarberAvgMinutes,
  getBarberStats,
  statusConfig,
  assignDynamicBarbers,
  isBarberBlockedByShiftEnd,
} from '@/lib/barber-utils'
import { FaceCamera } from '@/components/checkin/face-camera'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'
import type { FaceMatchResult } from '@/lib/face-recognition'
import { saveFacePhoto, enrollFaceDescriptor, enrollStaffFaceDescriptor, saveStaffFacePhoto } from '@/lib/face-recognition'

type Step =
  | 'branch'
  | 'home'
  | 'face_scan'
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

export default function CheckinPage() {
  const [step, setStep] = useState<Step>('branch')
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [wantsEnrollment, setWantsEnrollment] = useState(false)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [isReturning, setIsReturning] = useState(false)
  const [position, setPosition] = useState(0)
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

  const [branchIsOpen, setBranchIsOpen] = useState(true)
  const [branchHours, setBranchHours] = useState<{ opens: string; closes: string } | null>(null)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
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

  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('branches')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          setBranches(data)

          // Restore branch from localStorage, but validate it still exists in DB
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
      })
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
      const supabase = createClient()
      setLoadingBarbers(true)

      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)

      const [staffRes, queueRes, visitsRes, availableRes, openRes, attendanceRes, servicesRes, schedulesRes, settingsRes, monthlyVisitsRes] = await Promise.all([
        supabase
          .from('staff')
          .select('*')
          .eq('branch_id', branchId)
          .eq('role', 'barber')
          .eq('is_active', true)
          .order('full_name'),
        supabase
          .from('queue_entries')
          .select('*')
          .eq('branch_id', branchId)
          .in('status', ['waiting', 'in_progress']),
        supabase
          .from('visits')
          .select('barber_id, started_at, completed_at')
          .eq('branch_id', branchId)
          .order('completed_at', { ascending: false })
          .limit(200),
        supabase.rpc('get_available_barbers_today', { p_branch_id: branchId }),
        supabase.rpc('get_branch_open_status', { p_branch_id: branchId }),
        supabase
          .from('attendance_logs')
          .select('staff_id, action_type')
          .eq('branch_id', branchId)
          .gte('recorded_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .order('recorded_at', { ascending: false }),
        supabase
          .from('services')
          .select('*')
          .eq('is_active', true)
          .in('availability', ['checkin', 'both'])
          .or(`branch_id.eq.${branchId},branch_id.is.null`)
          .order('name'),
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
          .eq('branch_id', branchId)
          .gte('completed_at', dayStart.toISOString())
          .not('barber_id', 'is', null),
      ])

      let branchOpen = true

      // Track branch open status
      if (openRes.data && openRes.data.length > 0) {
        const status = openRes.data[0] as { is_open: boolean; opens_at: string; closes_at: string }
        branchOpen = status.is_open
        setBranchIsOpen(status.is_open)
        setBranchHours({ opens: status.opens_at, closes: status.closes_at })
      }

      if (settingsRes?.data) {
        const margin = (settingsRes.data as { shift_end_margin_minutes?: number }).shift_end_margin_minutes
        if (typeof margin === 'number' && margin >= 0) {
          setShiftEndMargin(margin)
        }
      }

      if (staffRes.data) {
        const latestAttendance: Record<string, string> = {}
        if (attendanceRes.data) {
          attendanceRes.data.forEach((log: { staff_id: string; action_type: string }) => {
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

        const filtered = staffRes.data.filter((s) => {
          if (s.status === 'blocked') return false
          if (s.hidden_from_checkin) return false

          const lastAction = latestAttendance[s.id]
          if (lastAction === 'clock_in') return true

          const barberBlocks = (schedulesRes?.data || [])
            .filter((sched: StaffSchedule) => sched.staff_id === s.id)
            .sort((a: StaffSchedule, b: StaffSchedule) => a.start_time.localeCompare(b.start_time))

          if (lastAction === 'clock_out') {
            const nextBlock = barberBlocks.find((block: StaffSchedule) => block.start_time > currentTimeStr)
            if (nextBlock) {
              notClocked.add(s.id)
              nextArrivals[s.id] = nextBlock.start_time
              return true
            }
            return false
          }

          if (barberBlocks.length > 0) {
            notClocked.add(s.id)
            const nextBlock = barberBlocks.find((block: StaffSchedule) => block.end_time > currentTimeStr)
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
      if (queueRes.data) setQueueEntries(queueRes.data)
      if (visitsRes.data) {
        setBarberAvgMinutes(
          buildBarberAvgMinutes(
            visitsRes.data as Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
            25
          )
        )
        // Derive last completed per barber (visits already sorted by completed_at desc)
        const lastMap: Record<string, string> = {}
        for (const v of visitsRes.data as { barber_id: string; completed_at: string }[]) {
          if (v.completed_at && !lastMap[v.barber_id]) {
            lastMap[v.barber_id] = v.completed_at
          }
        }
        setLastCompletedAt(lastMap)
      }
      if (servicesRes?.data) {
        setServices(servicesRes.data as Service[])
      }
      if (schedulesRes?.data) {
        setSchedules(schedulesRes.data as StaffSchedule[])
      }
      if (monthlyVisitsRes?.data) {
        const counts: Record<string, number> = {}
        for (const v of monthlyVisitsRes.data as { barber_id: string }[]) {
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
      .subscribe()

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
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('id, name, phone, face_photo_url')
        .eq('phone', ph)
        .single()

      if (data) {
        setName(data.name)
        setFaceClientId(data.id)
        setIsReturning(true)

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

  const dynamicEntries = useMemo(() => {
    return assignDynamicBarbers(queueEntries, barbers, schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers)
  }, [queueEntries, barbers, schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers])



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

  const minWaitEta = useMemo(() => {
    if (!minWaitBarber) return 0
    return getBarberStats(minWaitBarber, dynamicEntries, barberAvgMinutes).eta
  }, [minWaitBarber, dynamicEntries, barberAvgMinutes])

  // ── Availability level: 1 (green/low), 2 (yellow/medium), 3 (orange/high) ──
  const getAvailabilityLevel = useCallback((eta: number): 1 | 2 | 3 => {
    // Calculate the global average service time
    const avgValues = Object.entries(barberAvgMinutes)
      .filter(([k]) => k !== '__fallback')
      .map(([, v]) => v)
    const globalAvg = avgValues.length > 0
      ? avgValues.reduce((a, b) => a + b, 0) / avgValues.length
      : barberAvgMinutes.__fallback ?? 30

    // Level thresholds based on avg service time
    // 1 chair (green) = less than 1x average (quick service)
    // 2 chairs (yellow) = between 1x and 2x average
    // 3 chairs (orange) = more than 2x average
    if (eta <= globalAvg * 0.8) return 1
    if (eta <= globalAvg * 1.8) return 2
    return 3
  }, [barberAvgMinutes])

  const globalAvailability = useMemo(() => {
    return getAvailabilityLevel(minWaitEta)
  }, [minWaitEta, getAvailabilityLevel])

  // ── Face ID handlers ──

  const handleFaceMatch = useCallback(
    async (match: FaceMatchResult, descriptor: Float32Array) => {
      setFaceMatch(match)
      setFaceDescriptor(descriptor)
      setName(match.clientName)
      setPhone(match.clientPhone)
      setFaceClientId(match.clientId)
      setIsReturning(true)
      setHasExistingFace(true)

      const supabase = createClient()
      const { data: activeEntry } = await supabase
        .from('queue_entries')
        .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
        .eq('client_id', match.clientId)
        .in('status', ['waiting', 'in_progress'])
        .order('checked_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeEntry) {
        setMyQueueEntry(activeEntry as unknown as QueueEntry)
        goTo('manage_turn')
      } else {
        goTo('service_selection')
      }
    },
    []
  )

  const handleFaceNoMatch = useCallback(
    (descriptor: Float32Array) => {
      setFaceDescriptor(descriptor)
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
          return
        }

        setPosition(result.position)
        if ('queueEntryId' in result) {
          setQueueEntryId(result.queueEntryId as string)
        }

        const newClientId = result.clientId || faceClientId

        // If we captured face data during this flow, save it now to the real client
        if (wantsEnrollment && capturedFaceDescriptors.length > 0 && newClientId) {
          const savePromises = capturedFaceDescriptors.map((d, i) =>
            enrollFaceDescriptor(newClientId, d, 'checkin', i === 0 ? 0.99 : 0) // We use 0.99 as a placeholder score for the best descriptor
          )
          if (capturedFacePhoto) {
            savePromises.push(saveFacePhoto(newClientId, capturedFacePhoto).then(() => true))
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
    [selectedBranch, name, phone, submitting, faceClientId, handleFaceConfirmBarber, wantsEnrollment, capturedFaceDescriptors, capturedFacePhoto, selectedServiceId]
  )

  const handleBarberClick = (barber: Staff) => {
    if (submitting) return
    handleConfirm(barber.id)
  }

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

  const backButton = handleBack ? (
    <button
      onClick={handleBack}
      className="fixed top-3 left-3 md:top-6 md:left-6 z-50 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 backdrop-blur-sm"
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm md:text-base">Atrás</span>
    </button>
  ) : null

  // ── Availability indicator (3 chairs) ──
  const AvailabilityIndicator = ({ level, size = 'md' }: { level: 1 | 2 | 3; size?: 'sm' | 'md' | 'lg' }) => {
    const sizeClass = size === 'lg' ? 'size-7 md:size-8' : size === 'md' ? 'size-5 md:size-6' : 'size-4 md:size-5'
    const gapClass = size === 'lg' ? 'gap-2' : size === 'md' ? 'gap-1.5' : 'gap-1'
    const labels = ['Baja espera', 'Espera media', 'Espera elevada']
    const colors = [
      { active: 'text-emerald-400', inactive: 'text-white/15' },
      { active: 'text-amber-400', inactive: 'text-white/15' },
      { active: 'text-orange-400', inactive: 'text-white/15' },
    ]
    const bgColors = [
      'bg-emerald-400/10 border-emerald-400/30',
      'bg-amber-400/10 border-amber-400/30',
      'bg-orange-400/10 border-orange-400/30',
    ]
    const textColors = ['text-emerald-400', 'text-amber-400', 'text-orange-400']
    const color = colors[level - 1]

    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className={`flex items-center ${gapClass}`}>
          {[1, 2, 3].map((i) => (
            <svg key={i} className={`${sizeClass} ${i <= level ? color.active : color.inactive} transition-colors duration-300`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
          ))}
        </div>
        {size !== 'sm' && (
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${bgColors[level - 1]}`}>
            <span className={textColors[level - 1]}>{labels[level - 1]}</span>
          </div>
        )}
      </div>
    )
  }

  const renderBarberCard = (
    barber: Staff,
    onSelect: (barberId: string) => void,
    showExpand = true
  ) => {
    const isNotClockedIn = notClockedInBarbers.has(barber.id)
    const stats = getBarberStats(barber, dynamicEntries, barberAvgMinutes)
    const cfg = statusConfig[stats.status]
    const availLevel = getAvailabilityLevel(stats.eta)

    const ringColor = isNotClockedIn
      ? 'ring-orange-500/60'
      : stats.status === 'available'
        ? 'ring-emerald-500/60'
        : stats.status === 'occupied'
          ? 'ring-blue-500/60'
          : 'ring-amber-500/60'

    return (
      <div
        key={barber.id}
        className="w-full rounded-2xl border border-white/8 bg-white/2 text-left transition-all duration-200 overflow-hidden"
      >
        <button
          onClick={() => onSelect(barber.id)}
          disabled={submitting}
          className="w-full p-4 text-left hover:bg-white/6 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          <div className="flex flex-col items-center gap-3">
            <div className={`shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-black ${ringColor}`}>
              {barber.avatar_url ? (
                <img
                  src={barber.avatar_url}
                  alt={barber.full_name}
                  className="size-20 rounded-full object-cover"
                />
              ) : (
                <div className="flex size-20 items-center justify-center rounded-full bg-white/8 text-2xl font-bold">
                  {barber.full_name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="w-full text-center space-y-1.5">
              <p className="text-lg font-bold truncate">{barber.full_name}</p>
              {isNotClockedIn ? (
                <>
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium bg-orange-500/15 text-orange-400 border-orange-500/30">
                    Aún no llegó
                  </span>
                  <p className="text-sm text-orange-400/70">
                    {barberNextArrival[barber.id]
                      ? `Ingresa a las ${barberNextArrival[barber.id].slice(0, 5)}`
                      : 'Todavía no llegó'}
                  </p>
                </>
              ) : (
                <>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
                  >
                    {cfg.label}
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {stats.attending && 'Atendiendo 1'}
                    {stats.attending && stats.waiting > 0 && ' · '}
                    {stats.waiting > 0 &&
                      `${stats.waiting} ${stats.waiting === 1 ? 'espera' : 'esperan'}`}
                    {!stats.attending && stats.waiting === 0 && 'Sin espera'}
                  </p>

                  {/* Availability indicator instead of wait time */}
                  <div className="pt-1">
                    <AvailabilityIndicator level={availLevel} size="sm" />
                  </div>
                </>
              )}
            </div>
          </div>
        </button>
      </div>
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
          <h2 className="text-2xl md:text-3xl font-bold">¿Cómo querés atenderte?</h2>
          <p className="text-muted-foreground mt-1 text-base md:text-lg">Elegí una opción para continuar</p>
        </div>

        {/* ── TWO MAIN CTAs ── */}
        <div className="flex flex-col gap-4 w-full">

          {/* ── CTA 1: Menor Espera (recommended, bigger, glowing border) ── */}
          {minWaitBarber && (
            <div className="relative rounded-[1.25rem]" style={{ padding: '2px' }}>
              {/* Animated rotating border glow */}
              <div className="absolute inset-0 rounded-[1.25rem] overflow-hidden pointer-events-none">
                <div className="absolute inset-[-200%] bg-[conic-gradient(from_0deg,transparent_0%,rgba(16,185,129,0.7)_10%,rgba(34,211,238,0.7)_20%,transparent_30%)] animate-[checkin-border-rotate_3s_linear_infinite]" />
              </div>
              {/* Inner glow pulse */}
              <div className="absolute -inset-2 rounded-[1.75rem] bg-gradient-to-r from-emerald-500/30 via-cyan-400/30 to-emerald-500/30 blur-xl opacity-50 animate-[checkin-pulse-glow_3s_ease-in-out_infinite] pointer-events-none" />
              
              <button
                onClick={() => onSelect(null as unknown as string)}
                disabled={submitting}
                className="group relative w-full flex items-center gap-5 rounded-[1.15rem] bg-gradient-to-r from-emerald-950/90 to-cyan-950/90 p-7 md:p-8 text-left transition-all duration-300 hover:shadow-[0_0_50px_rgba(16,185,129,0.3)] active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none overflow-hidden backdrop-blur-sm"
              >
                {/* Shimmer sweep */}
                <div className="absolute inset-0 overflow-hidden rounded-[1.15rem] pointer-events-none">
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', animation: 'checkin-shimmer 2.5s ease-in-out infinite' }} />
                </div>

                {/* Icon */}
                <div className="relative shrink-0">
                  <div className="size-[4.5rem] md:size-20 rounded-xl bg-gradient-to-br from-emerald-400/25 to-cyan-400/25 border border-emerald-400/40 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                    <Zap className="size-9 md:size-10 text-emerald-300 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" fill="currentColor" />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-emerald-200 via-white to-cyan-200 bg-clip-text text-transparent">
                      Menor espera
                    </h3>
                    <div className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-400/15 border border-emerald-400/30">
                      <Sparkles className="size-2.5 text-cyan-300" />
                      <span className="text-emerald-300">IA</span>
                    </div>
                  </div>
                  <p className="text-sm md:text-base text-emerald-300/70">
                    Te asignamos al barbero con menos fila
                  </p>
                  <p className="text-xs text-emerald-400/50 mt-1.5 font-medium tracking-wide uppercase">
                    Tocá para continuar →
                  </p>
                </div>

                {/* Availability indicator */}
                <div className="shrink-0">
                  <AvailabilityIndicator level={globalAvailability} size="lg" />
                </div>
              </button>
            </div>
          )}

          {/* ── CTA 2: Elegir barbero (secondary, smaller) ── */}
          <button
            onClick={() => setShowBarberPreference(true)}
            disabled={submitting}
            className="group relative w-full flex items-center gap-4 rounded-2xl border-2 border-violet-400/30 bg-gradient-to-r from-violet-950/40 to-indigo-950/40 p-4 md:p-5 text-left transition-all duration-300 hover:border-violet-400/60 hover:shadow-[0_0_30px_rgba(139,92,246,0.15)] active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none overflow-hidden backdrop-blur-sm"
          >
            {/* Icon */}
            <div className="relative shrink-0">
              <div className="size-12 md:size-14 rounded-xl bg-gradient-to-br from-violet-400/20 to-indigo-400/20 border border-violet-400/30 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                <User className="size-6 md:size-7 text-violet-300" />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <h3 className="text-xl md:text-2xl font-bold text-white">
                Elegir barbero
              </h3>
              <p className="text-xs md:text-sm text-violet-300/70 mt-0.5">
                ¿Tenés preferencia? Elegí con quién atenderte
              </p>
            </div>

            {/* Arrow indicator */}
            <div className="shrink-0">
              <ChevronDown className={`size-6 text-violet-300/60 transition-transform duration-300 ${showBarberPreference ? 'rotate-180' : ''}`} />
            </div>
          </button>
        </div>

        {/* ── Barber Selection Dialog Modal ── */}
        <Dialog open={showBarberPreference} onOpenChange={setShowBarberPreference}>
          <DialogContent className="max-w-2xl bg-zinc-950/90 backdrop-blur-2xl border-white/10 p-6 md:p-8 rounded-[2rem] shadow-2xl">
            <DialogHeader className="text-left mb-6">
              <DialogTitle className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-violet-200 to-indigo-200 bg-clip-text text-transparent">
                Elegí tu barbero
              </DialogTitle>
              <DialogDescription className="text-base text-violet-300/70">
                Seleccioná con quién te querés atender
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto max-h-[60vh] pr-2 -mr-2 space-y-3 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20">
              <div className="grid grid-cols-2 gap-3 md:gap-4 pb-2">
                {availableBarbers.map((barber) => renderBarberCard(barber, (id) => {
                  setShowBarberPreference(false);
                  onSelect(id);
                }, showExpand))}
              </div>

              {notArrivedBarbers.length > 0 && (
                <>
                  <div className="w-full h-px bg-white/8 my-6" />
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px bg-white/10 flex-1" />
                    <h4 className="text-xs font-bold text-white/40 uppercase tracking-widest shrink-0">Aún no llegaron</h4>
                    <div className="h-px bg-white/10 flex-1" />
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
      <div className="w-full rounded-2xl border border-white/8 bg-white/2 p-4 text-center relative overflow-hidden">
        <p className="text-3xl font-mono font-bold tracking-[0.15em] min-h-10 flex items-center justify-center">
          {currentPhone ? (
            formatPhone(currentPhone)
          ) : (
            <span className="text-white/20">__ ____ ____</span>
          )}
        </p>
        <p className="text-sm text-muted-foreground mt-2">
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

      <div className="w-full grid grid-cols-3 gap-3 mt-1">
        {KEYPAD.map((d) => (
          <button
            key={d}
            onClick={() => pressDigit(d)}
            disabled={isLooking}
            className="h-[56px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {d}
          </button>
        ))}

        <button
          onClick={() => pressDelete()}
          disabled={isLooking || currentPhone.length === 0}
          className="h-[56px] rounded-2xl bg-white/4 border border-white/6 flex items-center justify-center transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Delete className="size-6" />
        </button>
        <button
          onClick={() => pressDigit('0')}
          disabled={isLooking}
          className="h-[56px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          0
        </button>
        <div />
      </div>
    </>
  )

  // ── Render ──

  return (
    <div className="h-dvh flex flex-col items-center select-none overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)] py-3 md:py-4">
      {backButton}
      {/* ═══════════════ BRANCH SELECTION ═══════════════ */}
      {step === 'branch' && (
        <div
          key={`branch-${animKey}`}
          className="w-full max-w-sm md:max-w-2xl flex flex-col items-center gap-6 md:gap-8 px-4 md:px-8 my-auto animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="flex flex-col items-center gap-4 md:gap-5">
            <div className="size-20 md:size-24 rounded-[1.5rem] md:rounded-3xl bg-white/4 border border-white/10 flex items-center justify-center">
              <Scissors className="size-10 md:size-12 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
                Monaco Smart Barber
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mt-2 md:mt-3">Bienvenido</p>
            </div>
          </div>

          <div className="w-24 h-px bg-white/10" />

          <div className="w-full space-y-4">
            <p className="text-center text-muted-foreground text-base md:text-lg">
              Seleccioná tu sucursal
            </p>

            {branches.length === 0 ? (
              <div className="flex items-center justify-center py-10 md:py-16">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-3 md:gap-4 w-full">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() => selectBranch(branch)}
                    className="group flex items-center gap-4 md:gap-5 w-full rounded-2xl border border-white/8 bg-white/2 p-4 md:p-6 text-left transition-all duration-200 hover:bg-white/6 hover:border-white/20 active:scale-[0.98]"
                  >
                    <div className="shrink-0 size-12 md:size-16 rounded-xl bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors duration-200">
                      <MapPin className="size-6 md:size-7 text-white/60 group-hover:text-white/80 transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-lg md:text-2xl font-semibold block truncate">
                        {branch.name}
                      </span>
                      {branch.address && (
                        <span className="text-base text-muted-foreground block mt-1 truncate">
                          {branch.address}
                        </span>
                      )}
                    </div>
                  </button>
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
          className="w-full max-w-sm md:max-w-2xl flex flex-col items-center justify-center gap-3 md:gap-4 px-4 md:px-8 py-4 md:py-6 my-auto animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="size-14 md:size-16 rounded-[1.25rem] md:rounded-2xl overflow-hidden flex items-center justify-center">
              <img src="/logo-monaco.png" alt="Monaco Smart Barber" className="w-full h-full object-contain" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                Monaco Smart Barber
              </h1>
              <div className="flex items-center justify-center gap-2 mt-1 md:mt-2">
                <MapPin className="size-4 text-muted-foreground" />
                <p className="text-sm md:text-lg text-muted-foreground">{selectedBranch.name}</p>
              </div>
            </div>
          </div>

          <Button
            onClick={() => goTo('face_scan')}
            className="w-full max-w-xs md:max-w-md h-12 md:h-14 text-lg md:text-2xl rounded-2xl md:rounded-3xl font-bold tracking-wide gap-3 md:gap-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            size="lg"
          >
            <ScanFace className="size-6 md:size-8" strokeWidth={1.5} />
            INGRESAR
          </Button>

          <div className="flex flex-col items-center gap-2 justify-center">
            <div className="flex items-center gap-6 justify-center">
              <button
                onClick={() => goTo('phone')}
                className="flex items-center gap-2 md:gap-3 text-muted-foreground hover:text-foreground transition-colors py-1.5"
              >
                <Search className="size-4 md:size-5" />
                <span className="text-base md:text-lg">Soy Nuevo</span>
              </button>
              <span className="text-white/20">·</span>
              <button
                onClick={() => goTo('staff_face_scan')}
                className="flex items-center gap-2 md:gap-3 text-muted-foreground hover:text-foreground transition-colors py-1.5"
              >
                <LogIn className="size-4 md:size-5" />
                <span className="text-base md:text-lg">Soy barbero</span>
              </button>
            </div>

            <button
              onClick={changeBranch}
              className="flex items-center gap-2 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1"
            >
              <Settings2 className="size-4" />
              Cambiar sucursal
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ FACE SCAN ═══════════════ */}
      {step === 'face_scan' && (
        <div
          key={`face-scan-${animKey}`}
          className="relative w-full max-w-lg md:max-w-3xl flex flex-col items-center gap-3 px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          <FaceCamera
            branchName={selectedBranch?.name}
            onMatch={handleFaceMatch}
            onNoMatch={handleFaceNoMatch}
            onManualEntry={handleFaceManualEntry}
          />
        </div>
      )}

      {/* ═══════════════ PHONE ENTRY ═══════════════ */}
      {step === 'phone' && (
        <div
          key={`phone-${animKey}`}
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          {/* Show no-match header if coming from face scan */}
          {faceDescriptor && (
            <div className="flex flex-col items-center gap-2 mb-2">
              <div className="size-12 md:size-14 rounded-full bg-white/4 border border-white/10 flex items-center justify-center">
                <User className="size-6 md:size-7 text-white/60" />
              </div>
              <p className="text-base text-muted-foreground">No te reconocemos · número de teléfono</p>
            </div>
          )}

          <div className="text-center mt-2">
            <h2 className="text-2xl md:text-3xl font-bold">Número de teléfono</h2>
            <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
              {selectedBranch?.name}
            </p>
          </div>

          {renderPhoneKeypad(phone, lookingUp)}
        </div>
      )}

      {/* ═══════════════ NAME CONFIRMATION / ENTRY ═══════════════ */}
      {step === 'name' && (
        <div
          key={`name-${animKey}`}
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          {isReturning ? (
            <div className="flex flex-col items-center gap-4 md:gap-6 mt-4 md:mt-6">
              <div className="size-20 md:size-24 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-75 duration-500">
                <span className="text-4xl md:text-5xl">👋</span>
              </div>
              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">¡Bienvenido de vuelta!</h2>
                <p className="text-3xl md:text-4xl font-bold mt-2 md:mt-4">{name}</p>
                <p className="text-muted-foreground mt-2 md:mt-3 text-base md:text-lg">
                  Tel: {formatPhone(phone)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 md:gap-6 mt-4 md:mt-6 w-full">
              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">¡Primera vez!</h2>
                <p className="text-lg md:text-xl text-muted-foreground mt-1 md:mt-2">
                  Te damos la bienvenida
                </p>
                <p className="text-muted-foreground mt-1 text-sm md:text-base">
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
                className="h-14 md:h-16 text-xl md:text-2xl text-center rounded-2xl border-white/10 bg-white/3"
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <p className="text-destructive text-center text-lg">{error}</p>
          )}

          <Button
            onClick={goToBarberStep}
            disabled={!name.trim()}
            className="w-full h-14 md:h-16 text-lg md:text-xl rounded-2xl font-semibold mt-2"
            size="lg"
          >
            Continuar
          </Button>
        </div>
      )}

      {/* ═══════════════ FACE ENROLLMENT ═══════════════ */}
      {step === 'face_enroll' && (
        <div
          key={`face-enroll-${animKey}`}
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          <FaceEnrollment
            clientId={faceClientId || undefined}
            clientName={name || 'Cliente'}
            source="checkin"
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
          className="relative w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold">¿Qué te vas a hacer?</h2>
            <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
              Elegí tu servicio
            </p>
          </div>

          <div className="w-full grid gap-3 md:gap-4 mt-2 overflow-y-auto min-h-0 flex-1">
            {services.map(s => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedServiceId(s.id)
                  goTo('barber')
                }}
                className="flex items-center justify-between p-5 rounded-2xl border border-white/8 bg-white/2 hover:bg-white/6 hover:border-white/20 transition-all text-left"
              >
                <div>
                  <h3 className="text-lg md:text-xl font-semibold">{s.name}</h3>
                </div>
                <div className="shrink-0 text-right">
                  {s.duration_minutes && (
                    <p className="text-sm font-medium text-muted-foreground mb-1">{s.duration_minutes} min</p>
                  )}
                  {s.price > 0 && (
                    <p className="text-sm font-bold text-foreground">${s.price}</p>
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
          className="relative w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-4 md:gap-5 px-4 md:px-6 pt-8 md:pt-10 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          <div className="text-center">
            <p className="text-muted-foreground text-base md:text-lg">
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

          {/* CSS Animations for barber selection */}
          <style>{`
            @keyframes checkin-pulse-glow {
              0%, 100% { opacity: 0.4; transform: scale(1); }
              50% { opacity: 0.8; transform: scale(1.02); }
            }
            @keyframes checkin-shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(200%); }
            }
            @keyframes checkin-float-particle {
              0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
              50% { transform: translateY(-12px) scale(1.3); opacity: 0.8; }
            }
            @keyframes checkin-border-rotate {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* ═══════════════ SUCCESS ═══════════════ */}
      {step === 'success' && (
        <div
          key={`success-${animKey}`}
          className="relative w-full max-w-sm md:max-w-xl flex flex-col items-center justify-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500"
        >
          {!changingBarberInSuccess ? (
            <>
              <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/3 p-8 md:p-10 flex flex-col items-center gap-5 animate-in zoom-in-50 duration-700">
                <div className="size-14 md:size-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="size-8 md:size-9 text-emerald-400" strokeWidth={1.5} />
                </div>

                <h2 className="text-xl md:text-2xl font-bold text-muted-foreground">¡Estás en la fila!</h2>

                <div className="text-center">
                  <p className="text-8xl md:text-9xl font-bold tabular-nums leading-none">
                    #{position}
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
                    className="h-11 md:h-12 text-sm md:text-base rounded-xl w-full max-w-xs"
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
                    className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 w-full max-w-xs transition-all hover:bg-blue-500/10 hover:border-blue-500/30 active:scale-[0.98]"
                  >
                    <div className="shrink-0 size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <User className="size-4 text-blue-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-blue-300">Registrar tu cara</p>
                      <p className="text-xs text-blue-400/70 mt-0.5">
                        Hacé check-in solo con mirarte
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {/* Countdown bar */}
              <div className="w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden mt-2">
                <div
                  className="h-full bg-white/40 rounded-full origin-left"
                  style={{
                    animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Volviendo al inicio...
              </p>

              <style>{`
                @keyframes checkin-countdown {
                  from { transform: scaleX(1); }
                  to { transform: scaleX(0); }
                }
              `}</style>
            </>
          ) : (
            <>

              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">Cambiar barbero</h2>
                <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
                  Turno #{position}
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
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <div className="text-center mt-2">
            <h2 className="text-2xl md:text-3xl font-bold">Identificación barbero</h2>
            <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">Mirá la cámara para identificarte</p>
          </div>
          <FaceCamera
            branchName={selectedBranch?.name ?? 'Sucursal'}
            targetRole="staff"
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
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in zoom-in-95 duration-500"
        >
          {!staffActionDone ? (
            <>
              <div className="text-center">
                <div className="size-20 md:size-24 rounded-full bg-white/4 border border-white/10 flex items-center justify-center mx-auto mb-3 md:mb-4 animate-in zoom-in-50 duration-700">
                  <span className="text-4xl md:text-5xl font-bold">{staffFaceMatch.clientName.charAt(0)}</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold">{staffFaceMatch.clientName}</h2>
                <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">¿Qué querés registrar?</p>
              </div>

              <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
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
                  className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-left transition-all hover:bg-emerald-500/10 active:scale-95"
                >
                  <LogIn className="size-10 text-emerald-400" />
                  <span className="text-lg font-semibold text-emerald-300">Entrada</span>
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
                  className="flex flex-col items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-left transition-all hover:bg-red-500/10 active:scale-95"
                >
                  <LogOut className="size-10 text-red-400" />
                  <span className="text-lg font-semibold text-red-300">Salida</span>
                </button>

                <button
                  onClick={() => {
                    goTo('branch')
                  }}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/2 p-6 text-left transition-all hover:bg-white/6 active:scale-95"
                >
                  <Coffee className="size-10 text-yellow-400" />
                  <span className="text-lg font-semibold text-yellow-300">Volver</span>
                </button>
              </div>

              {error && <p className="text-destructive text-center text-base md:text-lg">{error}</p>}
            </>
          ) : (
            <>
              <div className="size-24 md:size-28 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-50 duration-700">
                <CheckCircle2 className="size-12 md:size-16 text-white" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <h2 className="text-3xl md:text-4xl font-bold">
                  {staffAction === 'clock_in' ? '¡Entrada registrada!' : '¡Salida registrada!'}
                </h2>
                <p className="text-xl md:text-2xl text-muted-foreground mt-2 md:mt-3">{staffFaceMatch.clientName}</p>
                <p className="text-base md:text-lg text-muted-foreground mt-1">
                  {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-white/40 rounded-full origin-left"
                  style={{ animation: `checkin-countdown ${RESET_DELAY_MS}ms linear forwards` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">Volviendo al inicio...</p>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ STAFF PIN (face not recognized) ═══════════════ */}
      {step === 'staff_pin' && (
        <div
          key={`staff-pin-${animKey}`}
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          {!staffPinSelected ? (
            <>
              <div className="text-center mt-2">
                <div className="size-14 md:size-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <ScanFace className="size-7 md:size-8 text-amber-400" strokeWidth={1.5} />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold">No te reconocimos</h2>
                <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
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
                      className="flex flex-col items-center gap-3 rounded-2xl border border-white/8 bg-white/2 p-5 transition-all hover:bg-white/6 active:scale-[0.98]"
                    >
                      {barber.avatar_url ? (
                        <img
                          src={barber.avatar_url}
                          alt={barber.full_name}
                          className="size-16 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex size-16 items-center justify-center rounded-full bg-white/8 text-xl font-bold">
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
                  <img
                    src={staffPinSelected.avatar_url}
                    alt={staffPinSelected.full_name}
                    className="size-20 rounded-full object-cover border-2 border-white/10"
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
                    className={`size-4 rounded-full border-2 transition-colors ${i < staffPinValue.length
                      ? 'border-white bg-white'
                      : 'border-white/30'
                      }`}
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
                    className="h-14 rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40"
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
                  className="h-14 rounded-2xl bg-white/4 border border-white/6 flex items-center justify-center transition-all hover:bg-white/8 active:scale-95 disabled:opacity-40"
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
                  className="h-14 rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40"
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
          className="relative w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

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
          className="relative w-full max-w-sm md:max-w-xl flex flex-col items-center justify-center gap-4 md:gap-5 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-400"
        >

          {!changingBarberInManage ? (
            <>
              <div className="w-full rounded-3xl border border-white/10 bg-white/3 p-8 md:p-10 flex flex-col items-center gap-5">
                <h2 className="text-xl md:text-2xl font-bold text-muted-foreground">Tu turno</h2>

                <div className="text-center">
                  <p className="text-8xl md:text-9xl font-bold tabular-nums leading-none">
                    #{myQueueEntry.position}
                  </p>
                  {myQueueEntry.status === 'in_progress' && (
                    <p className="text-emerald-400 font-medium mt-3 text-lg">
                      Te están atendiendo
                    </p>
                  )}
                  {myQueueEntry.status === 'waiting' && (
                    <p className="text-muted-foreground mt-3 text-lg">
                      Esperando...
                    </p>
                  )}
                </div>

                {myQueueEntry.barber && (
                  <div className="w-full rounded-xl border border-white/8 bg-white/3 p-3 md:p-4">
                    <div className="flex items-center gap-3 justify-center">
                      <div className="flex size-10 md:size-12 items-center justify-center rounded-full bg-white/6 border border-white/10 text-sm md:text-base font-bold shrink-0">
                        {(myQueueEntry.barber as Staff).full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-base md:text-lg font-semibold truncate">
                          {(myQueueEntry.barber as Staff).full_name}
                        </p>
                        <p className="text-xs md:text-sm text-muted-foreground">
                          Tu barbero asignado
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="w-full flex flex-col items-center gap-2">
                {myQueueEntry.status === 'waiting' && (
                  <Button
                    onClick={() => setChangingBarberInManage(true)}
                    variant="outline"
                    className="h-11 md:h-12 text-sm md:text-base rounded-xl w-full max-w-xs"
                  >
                    <RefreshCw className="size-4 mr-2" />
                    Cambiar barbero
                  </Button>
                )}

                <button
                  onClick={reset}
                  className="text-muted-foreground hover:text-foreground transition-colors py-2 text-sm md:text-base text-center"
                >
                  Volver al inicio
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">Cambiar barbero</h2>
                <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
                  Turno #{myQueueEntry.position}
                </p>
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
