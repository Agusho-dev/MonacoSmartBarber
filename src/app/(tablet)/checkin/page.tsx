'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { checkinClient, checkinClientByFace, reassignMyBarber } from '@/lib/actions/queue'
import { registerBarberClockIn } from '@/lib/actions/attendance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
} from 'lucide-react'
import type { Branch, Staff, QueueEntry, Visit, Service, StaffSchedule } from '@/lib/types/database'
import {
  buildBarberAvgMinutes,
  getBarberStats,
  formatWaitTime,
  statusConfig,
  getLoadColor,
  assignDynamicBarbers,
  isBarberBlockedByShiftEnd,
} from '@/lib/barber-utils'
import { FaceCamera } from '@/components/checkin/face-camera'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'
import type { FaceMatchResult } from '@/lib/face-recognition'
import { saveFacePhoto, enrollFaceDescriptor } from '@/lib/face-recognition'

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
  const [loadingBarbers, setLoadingBarbers] = useState(false)

  const [branchIsOpen, setBranchIsOpen] = useState(true)
  const [branchHours, setBranchHours] = useState<{ opens: string; closes: string } | null>(null)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(Date.now())

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

  const [services, setServices] = useState<Service[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)

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

      const [staffRes, queueRes, visitsRes, availableRes, openRes, attendanceRes, servicesRes, schedulesRes] = await Promise.all([
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
          .or(`branch_id.eq.${branchId},branch_id.is.null`)
          .order('name'),
        supabase
          .from('staff_schedules')
          .select('*')
          .eq('day_of_week', new Date().getDay())
          .eq('is_active', true),
      ])

      let branchOpen = true

      // Track branch open status
      if (openRes.data && openRes.data.length > 0) {
        const status = openRes.data[0] as { is_open: boolean; opens_at: string; closes_at: string }
        branchOpen = status.is_open
        setBranchIsOpen(status.is_open)
        setBranchHours({ opens: status.opens_at, closes: status.closes_at })
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



        const filtered = staffRes.data.filter((s) => {
          if (s.status === 'blocked') return false
          if (latestAttendance[s.id] === 'clock_out') return false
          return true
        })
        setBarbers(filtered)
      }
      if (queueRes.data) setQueueEntries(queueRes.data)
      if (visitsRes.data) {
        setBarberAvgMinutes(
          buildBarberAvgMinutes(
            visitsRes.data as Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
            25
          )
        )
      }
      if (servicesRes?.data) {
        setServices(servicesRes.data as Service[])
      }
      if (schedulesRes?.data) {
        setSchedules(schedulesRes.data as StaffSchedule[])
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

  const goTo = (next: Step) => {
    setAnimKey((k) => k + 1)
    setStep(next)
    setError('')
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
    return assignDynamicBarbers(queueEntries, barbers, schedules, now)
  }, [queueEntries, barbers, schedules, now])

  const maxLoad = useMemo(
    () =>
      Math.max(
        1,
        ...barbers.map((b) => getBarberStats(b, dynamicEntries, barberAvgMinutes).totalLoad)
      ),
    [barbers, dynamicEntries, barberAvgMinutes]
  )

  const minWaitBarber = useMemo(() => {
    const active = barbers.filter(b => !isBarberBlockedByShiftEnd(b, dynamicEntries, schedules, now))
    if (active.length === 0) return null
    let best = active[0]
    let bestLoad = getBarberStats(active[0], dynamicEntries, barberAvgMinutes).totalLoad
    for (let i = 1; i < active.length; i++) {
      const load = getBarberStats(active[i], dynamicEntries, barberAvgMinutes).totalLoad
      if (load < bestLoad) {
        bestLoad = load
        best = active[i]
      } else if (load === bestLoad) {
        const nameCmp = (active[i].full_name || '').localeCompare(best.full_name || '')
        if (nameCmp < 0 || (nameCmp === 0 && active[i].id < best.id)) {
          best = active[i]
          bestLoad = load
        }
      }
    }
    return best
  }, [barbers, dynamicEntries, schedules, barberAvgMinutes, now])

  const minWaitEta = useMemo(() => {
    if (!minWaitBarber) return 0
    return getBarberStats(minWaitBarber, dynamicEntries, barberAvgMinutes).eta
  }, [minWaitBarber, dynamicEntries, barberAvgMinutes])

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
    // New clients: go to face enrollment first
    if (!isReturning && !hasExistingFace) {
      setWantsEnrollment(true)
      goTo('face_enroll')
    } else {
      goTo('service_selection')
    }
  }

  // ── Shared UI pieces ──

  const backButton = (onBack: () => void) => (
    <button
      onClick={onBack}
      className="fixed top-4 left-4 md:top-6 md:left-6 z-50 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 backdrop-blur-sm"
    >
      <ArrowLeft className="size-5" />
      <span className="text-base">Atrás</span>
    </button>
  )

  const renderBarberCard = (
    barber: Staff,
    onSelect: (barberId: string) => void,
    showExpand = true
  ) => {
    const stats = getBarberStats(barber, dynamicEntries, barberAvgMinutes)
    const cfg = statusConfig[stats.status]
    const loadPct = Math.min(100, (stats.totalLoad / Math.max(maxLoad, 4)) * 100)

    return (
      <div
        key={barber.id}
        className="w-full rounded-2xl border border-white/8 bg-white/2 text-left transition-all duration-200 overflow-hidden"
      >
        <button
          onClick={() => onSelect(barber.id)}
          disabled={submitting}
          className="w-full p-5 text-left hover:bg-white/6 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-full bg-white/6 border border-white/10 text-lg font-bold">
                {barber.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xl font-semibold">{barber.full_name}</p>
                <p className="text-base text-muted-foreground mt-0.5">
                  {stats.attending && 'Atendiendo 1 persona'}
                  {stats.attending && stats.waiting > 0 && ' · '}
                  {stats.waiting > 0 &&
                    `${stats.waiting} ${stats.waiting === 1 ? 'persona espera' : 'personas esperan'}`}
                  {!stats.attending && stats.waiting === 0 && 'Sin espera'}
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${cfg.className}`}
            >
              {cfg.label}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {stats.totalLoad} {stats.totalLoad === 1 ? 'persona' : 'personas'} en total
              </span>
              <span className="font-medium text-foreground">
                {formatWaitTime(stats.eta)}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-white/6 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getLoadColor(stats.totalLoad)}`}
                style={{ width: `${loadPct}%` }}
              />
            </div>
          </div>
        </button>
      </div>
    )
  }

  const renderBarberList = (onSelect: (barberId: string) => void, showExpand = true) => (
    <div className="w-full space-y-4">

      {minWaitBarber && (
        <button
          onClick={() => onSelect(minWaitBarber.id)}
          disabled={submitting}
          className="w-full flex items-center gap-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-left transition-all duration-200 hover:bg-emerald-500/10 hover:border-emerald-500/50 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          <div className="shrink-0 size-14 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Zap className="size-7 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold text-emerald-300">Menor espera</p>
            <p className="text-base text-emerald-400/70 mt-0.5">
              Te atiende el barbero con menos cola
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-emerald-400">
              {formatWaitTime(minWaitEta)}
            </p>
          </div>
        </button>
      )}

      <div className="w-full h-px bg-white/8" />

      <div className="grid gap-3">
        {barbers
          .filter(b => !isBarberBlockedByShiftEnd(b, dynamicEntries, schedules, now))
          .map((barber) => renderBarberCard(barber, onSelect, showExpand))}
      </div>
    </div>
  )

  const renderPhoneKeypad = (
    currentPhone: string,
    isLooking: boolean
  ) => (
    <>
      <div className="w-full rounded-2xl border border-white/8 bg-white/2 p-6 text-center relative overflow-hidden">
        <p className="text-4xl font-mono font-bold tracking-[0.15em] min-h-12 flex items-center justify-center">
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
            className="h-[72px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {d}
          </button>
        ))}

        <button
          onClick={() => pressDelete()}
          disabled={isLooking || currentPhone.length === 0}
          className="h-[72px] rounded-2xl bg-white/4 border border-white/6 flex items-center justify-center transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Delete className="size-6" />
        </button>
        <button
          onClick={() => pressDigit('0')}
          disabled={isLooking}
          className="h-[72px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          0
        </button>
        <div />
      </div>
    </>
  )

  // ── Render ──

  return (
    <div className="h-dvh flex flex-col items-center select-none overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)] py-6 md:py-8">
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
                <span className="text-base md:text-lg">Registrar</span>
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
          className="w-full max-w-lg md:max-w-3xl flex flex-col items-center gap-4 px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => goTo('home'))}

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
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-5 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            goTo('home')
          })}

          {/* Show no-match header if coming from face scan */}
          {faceDescriptor && (
            <div className="flex flex-col items-center gap-2 mb-2">
              <div className="size-12 md:size-14 rounded-full bg-white/4 border border-white/10 flex items-center justify-center">
                <User className="size-6 md:size-7 text-white/60" />
              </div>
              <p className="text-base text-muted-foreground">No te reconocemos · ingresá tu número</p>
            </div>
          )}

          <div className="text-center mt-2">
            <h2 className="text-2xl md:text-3xl font-bold">Ingresá tu número</h2>
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
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            setName('')
            setIsReturning(false)
            goTo('phone')
          })}

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
                placeholder="Tu nombre"
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
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-5 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            goTo('name')
          })}

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
          className="w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400 max-h-dvh overflow-y-auto"
        >
          {backButton(() => {
            if (!isReturning && !hasExistingFace) goTo('face_enroll')
            else goTo('name')
          })}

          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold">¿Qué te vas a hacer?</h2>
            <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
              Elegí tu servicio
            </p>
          </div>

          <div className="w-full grid gap-3 md:gap-4 mt-2">
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
          className="w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-4 md:gap-6 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400 max-h-dvh overflow-y-auto"
        >
          {backButton(() => {

            goTo('service_selection')
          })}

          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold">Elegí tu barbero</h2>
            <p className="text-muted-foreground mt-1 md:mt-2 text-base md:text-lg">
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
          className="w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in zoom-in-95 duration-500 max-h-dvh overflow-y-auto"
        >
          {!changingBarberInSuccess ? (
            <>
              <div className="size-16 md:size-20 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-50 duration-700">
                <CheckCircle2 className="size-9 md:size-12 text-white" strokeWidth={1.5} />
              </div>

              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">¡Estás en la fila!</h2>
                <div className="mt-3 md:mt-4 py-4 md:py-5 px-6 md:px-10 rounded-2xl border border-white/10 bg-white/3">
                  <p className="text-muted-foreground text-sm md:text-base">Tu turno</p>
                  <p className="text-5xl md:text-6xl font-bold mt-1 tabular-nums">
                    #{position}
                  </p>
                </div>
              </div>

              <div className="w-full max-w-lg grid gap-2 md:grid-cols-2">
                {queueEntryId && (
                  <button
                    onClick={() => {
                      if (resetTimer.current) clearTimeout(resetTimer.current)
                      setChangingBarberInSuccess(true)
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/2 p-3 md:p-4 w-full transition-all hover:bg-white/6 hover:border-white/20 active:scale-[0.98]"
                  >
                    <RefreshCw className="size-5 text-muted-foreground shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-medium">Cambiar barbero</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Podés elegir otro
                      </p>
                    </div>
                  </button>
                )}

                {/* Face enrollment offer */}
                {!hasExistingFace && faceClientId && (
                  <button
                    onClick={() => {
                      if (resetTimer.current) clearTimeout(resetTimer.current)
                      goTo('face_enroll')
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 md:p-4 w-full transition-all hover:bg-blue-500/10 hover:border-blue-500/30 active:scale-[0.98]"
                  >
                    <div className="shrink-0 size-8 md:size-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <User className="size-4 md:size-5 text-blue-400" />
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

              {/* App promo */}
              <div className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/2 p-3 md:p-4 w-full max-w-lg">
                <Smartphone className="size-5 md:size-6 text-muted-foreground shrink-0" />
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                  ¿Sabías que podés ver la ocupación en tiempo real?{' '}
                  <span className="text-foreground font-medium">
                    Descargá nuestra app
                  </span>
                </p>
              </div>

              {/* Countdown bar */}
              <div className="w-full max-w-xs h-1 rounded-full bg-white/10 overflow-hidden">
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
              {backButton(() => {
                setChangingBarberInSuccess(false)
                resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
              })}

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
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-4 md:gap-5 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => goTo('home'))}
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
              setError('No se reconoció tu cara. Pedí ayuda al administrador.')
            }}
            onManualEntry={() => setError('El ingreso manual no está disponible en modo barbero.')}
          />
          {error && <p className="text-destructive text-center text-lg">{error}</p>}
        </div>
      )}

      {/* ═══════════════ STAFF ACTION CONFIRM ═══════════════ */}
      {step === 'staff_action_confirm' && staffFaceMatch && (
        <div
          key={`staff-action-${animKey}`}
          className="w-full max-w-sm md:max-w-lg flex flex-col items-center gap-6 md:gap-8 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in zoom-in-95 duration-500"
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
                    const supabase = createClient()
                    const branchId = selectedBranch?.id
                    if (!branchId) return
                    const staffId = staffFaceMatch.clientId
                    if (!staffId) { setError('Barbero no encontrado'); return }
                    await supabase.from('attendance_logs').insert({
                      staff_id: staffId,
                      branch_id: branchId,
                      action_type: 'clock_out',
                      face_verified: true,
                    })
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

      {/* ═══════════════ MANAGE TURN ═══════════════ */}
      {step === 'manage_turn' && myQueueEntry && (
        <div
          key={`manage-turn-${animKey}`}
          className="w-full max-w-sm md:max-w-3xl flex flex-col items-center gap-3 md:gap-4 px-4 md:px-6 pt-14 md:pt-16 animate-in fade-in slide-in-from-right-4 duration-400 max-h-dvh overflow-y-auto"
        >
          {backButton(() => {
            setMyQueueEntry(null)
            setChangingBarberInManage(false)
            setError('')
            goTo('home')
          })}

          {!changingBarberInManage ? (
            <>
              <div className="text-center">
                <h2 className="text-2xl md:text-3xl font-bold">Tu turno</h2>
              </div>

              <div className="w-full md:flex md:gap-6 md:items-start">
                <div className="py-4 md:py-5 px-6 md:px-10 rounded-2xl border border-white/10 bg-white/3 text-center md:shrink-0">
                  <p className="text-muted-foreground text-sm md:text-base">Posición</p>
                  <p className="text-5xl md:text-6xl font-bold mt-1 tabular-nums">
                    #{myQueueEntry.position}
                  </p>
                  {myQueueEntry.status === 'in_progress' && (
                    <p className="text-emerald-400 font-medium mt-2 text-sm md:text-base">
                      Te están atendiendo
                    </p>
                  )}
                </div>

                <div className="flex-1 space-y-3 mt-3 md:mt-0">
                  {myQueueEntry.barber && (
                    <div className="w-full rounded-2xl border border-white/8 bg-white/2 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex size-12 items-center justify-center rounded-full bg-white/6 border border-white/10 text-base font-bold">
                          {(myQueueEntry.barber as Staff).full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-lg font-semibold">
                            {(myQueueEntry.barber as Staff).full_name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Tu barbero asignado
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {myQueueEntry.status === 'waiting' && (
                    <Button
                      onClick={() => setChangingBarberInManage(true)}
                      variant="outline"
                      className="h-11 md:h-12 text-sm md:text-base rounded-xl px-5 w-full"
                    >
                      <RefreshCw className="size-4 mr-2" />
                      Cambiar barbero
                    </Button>
                  )}

                  <button
                    onClick={reset}
                    className="text-muted-foreground hover:text-foreground transition-colors py-2 text-sm md:text-base w-full text-center"
                  >
                    Volver al inicio
                  </button>
                </div>
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
                className="text-muted-foreground hover:text-foreground transition-colors py-3 text-lg"
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
