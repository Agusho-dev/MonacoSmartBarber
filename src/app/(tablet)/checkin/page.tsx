'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { checkinClient, checkinClientByFace, reassignMyBarber } from '@/lib/actions/queue'
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
  AlertTriangle,
  RefreshCw,
  Search,
} from 'lucide-react'
import type { Branch, Staff, QueueEntry, Visit } from '@/lib/types/database'
import {
  buildBarberAvgMinutes,
  getBarberStats,
  formatWaitTime,
  statusConfig,
  getLoadColor,
} from '@/lib/barber-utils'
import { FaceCamera } from '@/components/checkin/face-camera'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'
import type { FaceMatchResult } from '@/lib/face-recognition'

type Step =
  | 'branch'
  | 'face_scan'
  | 'phone'
  | 'name'
  | 'face_enroll'
  | 'barber'
  | 'success'
  | 'manage_phone'
  | 'manage_turn'

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
  const [expandedPausedBarber, setExpandedPausedBarber] = useState<string | null>(null)

  const [queueEntryId, setQueueEntryId] = useState<string | null>(null)
  const [changingBarberInSuccess, setChangingBarberInSuccess] = useState(false)

  const [managePhone, setManagePhone] = useState('')
  const [myQueueEntry, setMyQueueEntry] = useState<QueueEntry | null>(null)
  const [changingBarberInManage, setChangingBarberInManage] = useState(false)
  const [lookingUpManage, setLookingUpManage] = useState(false)

  const [faceMatch, setFaceMatch] = useState<FaceMatchResult | null>(null)
  const [faceDescriptor, setFaceDescriptor] = useState<Float32Array | null>(null)
  const [faceClientId, setFaceClientId] = useState<string | null>(null)
  const [hasExistingFace, setHasExistingFace] = useState(false)

  const resetTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('branches')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setBranches(data)
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

      const [staffRes, queueRes, visitsRes] = await Promise.all([
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
      ])

      if (staffRes.data) setBarbers(staffRes.data)
      if (queueRes.data) setQueueEntries(queueRes.data)
      if (visitsRes.data) {
        setBarberAvgMinutes(
          buildBarberAvgMinutes(
            visitsRes.data as Pick<Visit, 'barber_id' | 'started_at' | 'completed_at'>[],
            25
          )
        )
      }
      setLoadingBarbers(false)
    },
    []
  )

  // Load barber data + realtime when viewing barbers
  const needsBarbers =
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
    setSelectedBranch(null)
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
    setExpandedPausedBarber(null)
    setQueueEntryId(null)
    setChangingBarberInSuccess(false)
    setManagePhone('')
    setMyQueueEntry(null)
    setChangingBarberInManage(false)
    setLookingUpManage(false)
    setFaceMatch(null)
    setFaceDescriptor(null)
    setFaceClientId(null)
    setHasExistingFace(false)
    goTo('branch')
  }

  // ── Branch ──

  const selectBranch = (branch: Branch) => {
    setSelectedBranch(branch)
    goTo('face_scan')
  }

  // ── Phone keypad ──

  const pressDigit = (digit: string, target: 'phone' | 'manage') => {
    const current = target === 'phone' ? phone : managePhone
    const setter = target === 'phone' ? setPhone : setManagePhone
    const isLooking = target === 'phone' ? lookingUp : lookingUpManage

    if (current.length >= PHONE_LENGTH || isLooking) return
    const next = current + digit
    setter(next)

    if (next.length === PHONE_LENGTH) {
      if (target === 'phone') {
        lookupPhone(next)
      } else {
        lookupManageTurn(next)
      }
    }
  }

  const pressDeleteFor = (target: 'phone' | 'manage') => {
    const isLooking = target === 'phone' ? lookingUp : lookingUpManage
    if (isLooking) return
    const setter = target === 'phone' ? setPhone : setManagePhone
    setter((p) => p.slice(0, -1))
  }

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

  const lookupManageTurn = async (ph: string) => {
    setLookingUpManage(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', ph)
        .single()

      if (!client) {
        setError('No se encontró un cliente con ese número')
        setLookingUpManage(false)
        return
      }

      const { data: entry } = await supabase
        .from('queue_entries')
        .select('*, barber:staff(id, full_name, status, is_active, branch_id, role, commission_pct, email, pin, auth_user_id, created_at, updated_at)')
        .eq('client_id', client.id)
        .in('status', ['waiting', 'in_progress'])
        .order('checked_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!entry) {
        setError('No tenés turno activo')
        setLookingUpManage(false)
        return
      }

      setMyQueueEntry(entry as unknown as QueueEntry)
      goTo('manage_turn')
    } catch {
      setError('Error al buscar turno')
    } finally {
      setLookingUpManage(false)
    }
  }

  // ── Barber selection helpers ──

  const maxLoad = useMemo(
    () =>
      Math.max(
        1,
        ...barbers.map((b) => getBarberStats(b, queueEntries, barberAvgMinutes).totalLoad)
      ),
    [barbers, queueEntries, barberAvgMinutes]
  )

  const minWaitBarber = useMemo(() => {
    const active = barbers.filter((b) => b.status !== 'paused')
    if (active.length === 0) return null
    let best: Staff | null = null
    let bestEta = Infinity
    for (const b of active) {
      const stats = getBarberStats(b, queueEntries, barberAvgMinutes)
      if (stats.eta < bestEta) {
        bestEta = stats.eta
        best = b
      }
    }
    return best
  }, [barbers, queueEntries, barberAvgMinutes])

  const minWaitEta = useMemo(() => {
    if (!minWaitBarber) return 0
    return getBarberStats(minWaitBarber, queueEntries, barberAvgMinutes).eta
  }, [minWaitBarber, queueEntries, barberAvgMinutes])

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
        goTo('barber')
      }
    },
    []
  )

  const handleFaceNoMatch = useCallback(
    (descriptor: Float32Array) => {
      setFaceDescriptor(descriptor)
      goTo('phone')
    },
    []
  )

  const handleFaceManualEntry = useCallback(() => {
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
          chosenBarberId
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
    [selectedBranch, faceClientId, submitting]
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

        if (!faceClientId && result.queueEntryId) {
          const supabase = createClient()
          const { data: entry } = await supabase
            .from('queue_entries')
            .select('client_id')
            .eq('id', result.queueEntryId)
            .single()
          if (entry) setFaceClientId(entry.client_id)
        }

        setSubmitting(false)
        goTo('success')
        resetTimer.current = setTimeout(reset, RESET_DELAY_MS)
      } catch {
        setError('Error al registrar. Intentá de nuevo.')
        setSubmitting(false)
      }
    },
    [selectedBranch, name, phone, submitting, faceClientId, handleFaceConfirmBarber]
  )

  const handleBarberClick = (barber: Staff) => {
    if (submitting) return
    const stats = getBarberStats(barber, queueEntries, barberAvgMinutes)
    if (stats.status === 'paused') {
      setExpandedPausedBarber((prev) => (prev === barber.id ? null : barber.id))
    } else {
      handleConfirm(barber.id)
    }
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
    goTo('barber')
  }

  // ── Shared UI pieces ──

  const backButton = (onBack: () => void) => (
    <button
      onClick={onBack}
      className="self-start flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 -ml-1"
    >
      <ArrowLeft className="size-5" />
      <span className="text-lg">Atrás</span>
    </button>
  )

  const renderBarberCard = (
    barber: Staff,
    onSelect: (barberId: string) => void,
    showExpand = true
  ) => {
    const stats = getBarberStats(barber, queueEntries, barberAvgMinutes)
    const cfg = statusConfig[stats.status]
    const loadPct = Math.min(100, (stats.totalLoad / Math.max(maxLoad, 4)) * 100)
    const isExpanded = showExpand && expandedPausedBarber === barber.id

    return (
      <div
        key={barber.id}
        className="w-full rounded-2xl border border-white/8 bg-white/2 text-left transition-all duration-200 overflow-hidden"
      >
        <button
          onClick={() => {
            if (stats.status === 'paused' && showExpand) {
              setExpandedPausedBarber((prev) => (prev === barber.id ? null : barber.id))
            } else {
              onSelect(barber.id)
            }
          }}
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

        {/* Expanded paused warning */}
        {isExpanded && (
          <div className="border-t border-white/8 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
              <AlertTriangle className="size-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-300">
                  Este barbero está en pausa
                </p>
                <p className="text-sm text-yellow-400/70 mt-1">
                  Podés esperarlo, pero puede demorar más de lo estimado.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => onSelect(barber.id)}
                disabled={submitting}
                className="flex-1 h-14 text-base rounded-xl font-semibold"
                variant="default"
              >
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  `Esperar a ${barber.full_name.split(' ')[0]}`
                )}
              </Button>
              <Button
                onClick={() => setExpandedPausedBarber(null)}
                variant="outline"
                className="h-14 text-base rounded-xl px-6"
              >
                Elegir otro
              </Button>
            </div>
          </div>
        )}
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
        {barbers.map((barber) => renderBarberCard(barber, onSelect, showExpand))}
      </div>
    </div>
  )

  const renderPhoneKeypad = (
    currentPhone: string,
    target: 'phone' | 'manage',
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
            onClick={() => pressDigit(d, target)}
            disabled={isLooking}
            className="h-[72px] rounded-2xl bg-white/4 border border-white/6 text-2xl font-semibold transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {d}
          </button>
        ))}

        <button
          onClick={() => pressDeleteFor(target)}
          disabled={isLooking || currentPhone.length === 0}
          className="h-[72px] rounded-2xl bg-white/4 border border-white/6 flex items-center justify-center transition-all duration-150 hover:bg-white/8 active:bg-white/12 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Delete className="size-6" />
        </button>
        <button
          onClick={() => pressDigit('0', target)}
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
    <div className="min-h-dvh flex flex-col items-center justify-center select-none bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.03)_0%,transparent_60%)]">
      {/* ═══════════════ BRANCH SELECTION ═══════════════ */}
      {step === 'branch' && (
        <div
          key={`branch-${animKey}`}
          className="w-full max-w-2xl flex flex-col items-center gap-10 px-8 animate-in fade-in zoom-in-95 duration-500"
        >
          <div className="flex flex-col items-center gap-5">
            <div className="size-24 rounded-3xl bg-white/4 border border-white/10 flex items-center justify-center">
              <Scissors className="size-12 text-white" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <h1 className="text-5xl font-bold tracking-tight">
                Monaco Smart Barber
              </h1>
              <p className="text-xl text-muted-foreground mt-3">Bienvenido</p>
            </div>
          </div>

          <div className="w-24 h-px bg-white/10" />

          <div className="w-full space-y-4">
            <p className="text-center text-muted-foreground text-lg">
              Seleccioná tu sucursal
            </p>

            {branches.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    onClick={() => selectBranch(branch)}
                    className="group flex items-center gap-5 w-full rounded-2xl border border-white/8 bg-white/2 p-6 text-left transition-all duration-200 hover:bg-white/6 hover:border-white/20 active:scale-[0.98]"
                  >
                    <div className="shrink-0 size-16 rounded-xl bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors duration-200">
                      <MapPin className="size-7 text-white/60 group-hover:text-white/80 transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-2xl font-semibold block">
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

          <div className="w-full h-px bg-white/8" />

          <button
            onClick={() => goTo('manage_phone')}
            className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors py-3"
          >
            <Search className="size-5" />
            <span className="text-lg">Ya tengo turno</span>
          </button>
        </div>
      )}

      {/* ═══════════════ FACE SCAN ═══════════════ */}
      {step === 'face_scan' && (
        <div
          key={`face-scan-${animKey}`}
          className="w-full max-w-lg flex flex-col items-center gap-5 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setSelectedBranch(null)
            goTo('branch')
          })}

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
          className="w-full max-w-md flex flex-col items-center gap-5 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            goTo('face_scan')
          })}

          <div className="text-center mt-2">
            <h2 className="text-3xl font-bold">Ingresá tu número</h2>
            <p className="text-muted-foreground mt-2 text-lg">
              {selectedBranch?.name}
            </p>
          </div>

          {renderPhoneKeypad(phone, 'phone', lookingUp)}
        </div>
      )}

      {/* ═══════════════ NAME CONFIRMATION / ENTRY ═══════════════ */}
      {step === 'name' && (
        <div
          key={`name-${animKey}`}
          className="w-full max-w-lg flex flex-col items-center gap-6 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setPhone('')
            setName('')
            setIsReturning(false)
            goTo('phone')
          })}

          {isReturning ? (
            <div className="flex flex-col items-center gap-6 mt-6">
              <div className="size-24 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-75 duration-500">
                <span className="text-5xl">👋</span>
              </div>
              <div className="text-center">
                <h2 className="text-3xl font-bold">¡Bienvenido de vuelta!</h2>
                <p className="text-4xl font-bold mt-4">{name}</p>
                <p className="text-muted-foreground mt-3 text-lg">
                  Tel: {formatPhone(phone)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 mt-6 w-full">
              <div className="text-center">
                <h2 className="text-3xl font-bold">¡Primera vez!</h2>
                <p className="text-xl text-muted-foreground mt-2">
                  Te damos la bienvenida
                </p>
                <p className="text-muted-foreground mt-1 text-base">
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
                className="h-16 text-2xl text-center rounded-2xl border-white/10 bg-white/3"
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
            className="w-full h-16 text-xl rounded-2xl font-semibold mt-2"
            size="lg"
          >
            Continuar
          </Button>
        </div>
      )}

      {/* ═══════════════ FACE ENROLLMENT ═══════════════ */}
      {step === 'face_enroll' && faceClientId && (
        <div
          key={`face-enroll-${animKey}`}
          className="w-full max-w-lg flex flex-col items-center gap-5 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          <FaceEnrollment
            clientId={faceClientId}
            clientName={name}
            source="checkin"
            onComplete={reset}
            onSkip={reset}
          />
        </div>
      )}

      {/* ═══════════════ BARBER SELECTION ═══════════════ */}
      {step === 'barber' && (
        <div
          key={`barber-${animKey}`}
          className="w-full max-w-2xl flex flex-col items-center gap-6 px-6 animate-in fade-in slide-in-from-right-4 duration-400 max-h-dvh overflow-y-auto py-8"
        >
          {backButton(() => {
            setExpandedPausedBarber(null)
            goTo('name')
          })}

          <div className="text-center">
            <h2 className="text-3xl font-bold">Elegí tu barbero</h2>
            <p className="text-muted-foreground mt-2 text-lg">
              {name} · {selectedBranch?.name}
            </p>
          </div>

          {loadingBarbers ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : barbers.length === 0 ? (
            <div className="text-center py-16">
              <User className="size-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">
                No hay barberos activos en esta sucursal
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
          className="w-full max-w-2xl flex flex-col items-center gap-8 px-6 animate-in fade-in zoom-in-95 duration-500 max-h-dvh overflow-y-auto py-8"
        >
          {!changingBarberInSuccess ? (
            <>
              <div className="size-28 rounded-full bg-white/4 border border-white/10 flex items-center justify-center animate-in zoom-in-50 duration-700">
                <CheckCircle2 className="size-16 text-white" strokeWidth={1.5} />
              </div>

              <div className="text-center">
                <h2 className="text-4xl font-bold">¡Estás en la fila!</h2>
                <div className="mt-6 py-8 px-12 rounded-3xl border border-white/10 bg-white/3">
                  <p className="text-muted-foreground text-lg">Tu turno</p>
                  <p className="text-8xl font-bold mt-2 tabular-nums">
                    #{position}
                  </p>
                </div>
              </div>

              {queueEntryId && (
                <button
                  onClick={() => {
                    if (resetTimer.current) clearTimeout(resetTimer.current)
                    setChangingBarberInSuccess(true)
                  }}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/2 p-5 w-full max-w-lg transition-all hover:bg-white/6 hover:border-white/20 active:scale-[0.98]"
                >
                  <RefreshCw className="size-6 text-muted-foreground shrink-0" />
                  <div className="text-left">
                    <p className="text-base font-medium">Cambiar barbero</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Si cambiaste de idea, podés elegir otro
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
                  className="flex items-center gap-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 w-full max-w-lg transition-all hover:bg-blue-500/10 hover:border-blue-500/30 active:scale-[0.98]"
                >
                  <div className="shrink-0 size-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <User className="size-6 text-blue-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-base font-medium text-blue-300">Registrar tu cara</p>
                    <p className="text-sm text-blue-400/70 mt-0.5">
                      La próxima vez hacé check-in solo con mirarte
                    </p>
                  </div>
                </button>
              )}

              {/* App promo */}
              <div className="flex items-center gap-4 rounded-2xl border border-white/6 bg-white/2 p-5 mt-2">
                <Smartphone className="size-8 text-muted-foreground shrink-0" />
                <p className="text-base text-muted-foreground leading-relaxed">
                  ¿Sabías que podés ver la ocupación en tiempo real?{' '}
                  <span className="text-foreground font-medium">
                    Descargá nuestra app
                  </span>
                </p>
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
              <p className="text-sm text-muted-foreground">
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
                <h2 className="text-3xl font-bold">Cambiar barbero</h2>
                <p className="text-muted-foreground mt-2 text-lg">
                  Turno #{position}
                </p>
              </div>

              {loadingBarbers ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
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

      {/* ═══════════════ MANAGE PHONE ═══════════════ */}
      {step === 'manage_phone' && (
        <div
          key={`manage-phone-${animKey}`}
          className="w-full max-w-md flex flex-col items-center gap-5 px-6 animate-in fade-in slide-in-from-right-4 duration-400"
        >
          {backButton(() => {
            setManagePhone('')
            setError('')
            goTo('branch')
          })}

          <div className="text-center mt-2">
            <h2 className="text-3xl font-bold">Buscá tu turno</h2>
            <p className="text-muted-foreground mt-2 text-lg">
              Ingresá el número con el que te registraste
            </p>
          </div>

          {error && (
            <p className="text-destructive text-center text-lg">{error}</p>
          )}

          {renderPhoneKeypad(managePhone, 'manage', lookingUpManage)}
        </div>
      )}

      {/* ═══════════════ MANAGE TURN ═══════════════ */}
      {step === 'manage_turn' && myQueueEntry && (
        <div
          key={`manage-turn-${animKey}`}
          className="w-full max-w-2xl flex flex-col items-center gap-6 px-6 animate-in fade-in slide-in-from-right-4 duration-400 max-h-dvh overflow-y-auto py-8"
        >
          {backButton(() => {
            setManagePhone('')
            setMyQueueEntry(null)
            setChangingBarberInManage(false)
            setError('')
            goTo('branch')
          })}

          {!changingBarberInManage ? (
            <>
              <div className="text-center">
                <h2 className="text-3xl font-bold">Tu turno</h2>
              </div>

              <div className="py-8 px-12 rounded-3xl border border-white/10 bg-white/3 text-center">
                <p className="text-muted-foreground text-lg">Posición</p>
                <p className="text-8xl font-bold mt-2 tabular-nums">
                  #{myQueueEntry.position}
                </p>
                {myQueueEntry.status === 'in_progress' && (
                  <p className="text-emerald-400 font-medium mt-3 text-lg">
                    Te están atendiendo
                  </p>
                )}
              </div>

              {myQueueEntry.barber && (
                <div className="w-full max-w-lg rounded-2xl border border-white/8 bg-white/2 p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex size-14 items-center justify-center rounded-full bg-white/6 border border-white/10 text-lg font-bold">
                      {(myQueueEntry.barber as Staff).full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {(myQueueEntry.barber as Staff).full_name}
                      </p>
                      <p className="text-base text-muted-foreground">
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
                  className="h-14 text-lg rounded-2xl px-8"
                >
                  <RefreshCw className="size-5 mr-2" />
                  Cambiar barbero
                </Button>
              )}

              <button
                onClick={reset}
                className="text-muted-foreground hover:text-foreground transition-colors py-3 text-lg"
              >
                Volver al inicio
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <h2 className="text-3xl font-bold">Cambiar barbero</h2>
                <p className="text-muted-foreground mt-2 text-lg">
                  Turno #{myQueueEntry.position}
                </p>
              </div>

              {loadingBarbers ? (
                <div className="flex items-center justify-center py-16">
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
