'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import type { QueueEntry, StaffStatus, StaffSchedule, Staff } from '@/lib/types/database'
import { assignDynamicBarbers } from '@/lib/barber-utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Scissors, Clock, User, ChevronRight, Zap } from 'lucide-react'

// --- Tipos y utilidades de sizing ---

type SizeMode = 'large' | 'compact' | 'scroll'

function getSizeMode(count: number): SizeMode {
  if (count <= 4) return 'large'
  if (count <= 7) return 'compact'
  return 'scroll'
}

const inProgressStyles = {
  large: {
    container: 'p-4 lg:p-6 2xl:p-10 gap-4 lg:gap-6 2xl:gap-10',
    card: 'p-4 lg:p-6 2xl:p-10 gap-4 lg:gap-6 2xl:gap-10 rounded-2xl lg:rounded-[2rem] 2xl:rounded-[3rem]',
    avatar: 'size-20 lg:size-24 2xl:size-40 rounded-2xl lg:rounded-3xl 2xl:rounded-[2.5rem]',
    avatarIcon: 'size-8 lg:size-10 2xl:size-16',
    greenDot: 'size-6 lg:size-7 2xl:size-10 border-[4px] 2xl:border-[6px]',
    greenDotPos: '-bottom-1 -right-1 2xl:-bottom-2 2xl:-right-2',
    clientName: 'text-3xl lg:text-4xl 2xl:text-6xl mb-1 lg:mb-2 2xl:mb-4',
    barberName: 'text-xl lg:text-2xl 2xl:text-4xl gap-2 lg:gap-3 2xl:gap-5',
  },
  compact: {
    container: 'p-3 lg:p-4 2xl:p-5 gap-2 lg:gap-3 2xl:gap-4',
    card: 'p-3 lg:p-4 2xl:p-5 gap-3 lg:gap-4 2xl:gap-5 rounded-xl lg:rounded-2xl 2xl:rounded-2xl',
    avatar: 'size-12 lg:size-14 2xl:size-20 rounded-xl lg:rounded-xl 2xl:rounded-2xl',
    avatarIcon: 'size-5 lg:size-6 2xl:size-8',
    greenDot: 'size-4 lg:size-5 2xl:size-6 border-[3px] 2xl:border-[4px]',
    greenDotPos: '-bottom-0.5 -right-0.5 2xl:-bottom-1 2xl:-right-1',
    clientName: 'text-xl lg:text-2xl 2xl:text-3xl mb-0.5 lg:mb-1 2xl:mb-2',
    barberName: 'text-base lg:text-lg 2xl:text-xl gap-1.5 lg:gap-2 2xl:gap-3',
  },
}

const waitingStyles = {
  large: {
    container: 'p-4 lg:p-6 2xl:p-10 gap-3 lg:gap-4 2xl:gap-8',
    card: 'p-4 lg:p-6 2xl:p-8 gap-4 lg:gap-6 2xl:gap-10 rounded-2xl lg:rounded-3xl 2xl:rounded-[2.5rem]',
    positionBox: 'size-14 lg:size-16 2xl:size-28 rounded-xl lg:rounded-2xl 2xl:rounded-3xl text-2xl lg:text-3xl 2xl:text-5xl',
    clientName: 'text-2xl lg:text-3xl 2xl:text-5xl',
    barberInfo: 'text-lg lg:text-xl 2xl:text-3xl mt-1 lg:mt-2 2xl:mt-4 gap-2 2xl:gap-4',
    chevronSize: 'size-4 lg:size-5 2xl:size-8',
  },
  compact: {
    container: 'p-3 lg:p-4 2xl:p-5 gap-1.5 lg:gap-2 2xl:gap-3',
    card: 'p-2.5 lg:p-3 2xl:p-4 gap-3 lg:gap-4 2xl:gap-5 rounded-xl lg:rounded-2xl 2xl:rounded-2xl',
    positionBox: 'size-10 lg:size-12 2xl:size-16 rounded-lg lg:rounded-xl 2xl:rounded-xl text-lg lg:text-xl 2xl:text-2xl',
    clientName: 'text-lg lg:text-xl 2xl:text-2xl',
    barberInfo: 'text-sm lg:text-base 2xl:text-lg mt-0.5 lg:mt-1 2xl:mt-2 gap-1.5 2xl:gap-2',
    chevronSize: 'size-3 lg:size-4 2xl:size-5',
  },
}

// --- Hook de auto-scroll ping-pong para TV ---

function useAutoScroll(enabled: boolean, speed: number = 0.5) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [needsScroll, setNeedsScroll] = useState(false)
  const scrollPos = useRef(0)
  const rafId = useRef(0)
  const pausedRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null)
  const directionRef = useRef<'down' | 'up'>('down')

  // Detectar overflow
  useEffect(() => {
    if (!enabled) {
      setNeedsScroll(false)
      return
    }
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const check = () => {
      setNeedsScroll(content.scrollHeight > container.clientHeight + 10)
    }

    const observer = new ResizeObserver(check)
    observer.observe(container)
    observer.observe(content)
    check()

    return () => observer.disconnect()
  }, [enabled])

  // Reset scroll cuando ya no hace falta
  useEffect(() => {
    if (!needsScroll && containerRef.current) {
      containerRef.current.scrollTop = 0
      scrollPos.current = 0
      directionRef.current = 'down'
    }
  }, [needsScroll])

  // Animar scroll (ping-pong: baja → pausa → sube → pausa → repite)
  useEffect(() => {
    if (!needsScroll) return
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const animate = () => {
      if (pausedRef.current) return
      const el = containerRef.current
      const contentEl = contentRef.current
      if (!el || !contentEl) return

      const maxScroll = contentEl.scrollHeight - el.clientHeight

      if (directionRef.current === 'down') {
        scrollPos.current += speed
        if (scrollPos.current >= maxScroll) {
          scrollPos.current = maxScroll
          el.scrollTop = maxScroll
          directionRef.current = 'up'
          pausedRef.current = true
          timeoutRef.current = setTimeout(() => {
            pausedRef.current = false
            rafId.current = requestAnimationFrame(animate)
          }, 3000)
          return
        }
      } else {
        scrollPos.current -= speed
        if (scrollPos.current <= 0) {
          scrollPos.current = 0
          el.scrollTop = 0
          directionRef.current = 'down'
          pausedRef.current = true
          timeoutRef.current = setTimeout(() => {
            pausedRef.current = false
            rafId.current = requestAnimationFrame(animate)
          }, 3000)
          return
        }
      }

      el.scrollTop = scrollPos.current
      rafId.current = requestAnimationFrame(animate)
    }

    // Pausa inicial antes de empezar
    pausedRef.current = true
    directionRef.current = 'down'
    scrollPos.current = 0
    timeoutRef.current = setTimeout(() => {
      pausedRef.current = false
      rafId.current = requestAnimationFrame(animate)
    }, 3000)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      cancelAnimationFrame(rafId.current)
      pausedRef.current = false
    }
  }, [needsScroll, speed])

  return { containerRef, contentRef, needsScroll }
}

// --- Tipos de datos ---

interface BarberRow {
  id: string
  full_name: string
  branch_id: string | null
  status: StaffStatus
  is_active: boolean
  avatar_url?: string | null
}

interface BranchRow {
  id: string
  name: string
}

interface TvClientProps {
  initialEntries: QueueEntry[]
  barbers: BarberRow[]
  branches: BranchRow[]
}

export function TvClient({
  initialEntries,
  barbers,
  branches,
}: TvClientProps) {
  const { selectedBranchId, setSelectedBranchId } = useBranchStore()
  const [entries, setEntries] = useState<QueueEntry[]>(initialEntries)
  const [liveBarbers, setLiveBarbers] = useState<BarberRow[]>(barbers)
  const [schedules, setSchedules] = useState<StaffSchedule[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shiftEndMargin, setShiftEndMargin] = useState(35)
  const [dynamicCooldownMs, setDynamicCooldownMs] = useState(60_000)
  const [dailyServiceCounts, setDailyServiceCounts] = useState<Record<string, number>>({})
  const [lastCompletedAt, setLastCompletedAt] = useState<Record<string, string>>({})
  const [latestAttendance, setLatestAttendance] = useState<Record<string, string>>({})

  const supabase = useMemo(() => createClient(), [])

  // Si no hay sucursal seleccionada y hay sucursales disponibles, seleccionamos la primera
  useEffect(() => {
    if (!selectedBranchId && branches.length > 0) {
      setSelectedBranchId(branches[0].id)
    }
  }, [branches, selectedBranchId, setSelectedBranchId])

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
      .select('id, full_name, branch_id, status, is_active, avatar_url')
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
        .select('shift_end_margin_minutes, dynamic_cooldown_seconds')
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
      const sd = settingsRes.data as { shift_end_margin_minutes?: number; dynamic_cooldown_seconds?: number }
      if (typeof sd.shift_end_margin_minutes === 'number' && sd.shift_end_margin_minutes >= 0) setShiftEndMargin(sd.shift_end_margin_minutes)
      if (typeof sd.dynamic_cooldown_seconds === 'number' && sd.dynamic_cooldown_seconds >= 0) setDynamicCooldownMs(sd.dynamic_cooldown_seconds * 1000)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchQueue()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBarbers()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSchedules()

    const channel = supabase
      .channel('tv-queue')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
        },
        () => {
          fetchQueue()
          fetchSchedules()
        }
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
    const interval = setInterval(() => setNow(Date.now()), 30_000)
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
    const branchEntries = selectedBranchId ? entries.filter(e => e.branch_id === selectedBranchId) : entries
    const branchBarbers = selectedBranchId ? liveBarbers.filter(b => b.branch_id === selectedBranchId) : liveBarbers
    return assignDynamicBarbers(branchEntries, branchBarbers as unknown as Staff[], schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, dynamicCooldownMs)
  }, [entries, liveBarbers, schedules, now, shiftEndMargin, dailyServiceCounts, lastCompletedAt, notClockedInBarbers, selectedBranchId, dynamicCooldownMs])

  const waitingEntries = useMemo(
    () => dynamicEntries.filter((e) => e.status === 'waiting'),
    [dynamicEntries]
  )
  const inProgressEntries = useMemo(
    () => dynamicEntries.filter((e) => e.status === 'in_progress'),
    [dynamicEntries]
  )

  // --- Sizing dinámico por columna ---
  const ipMode = getSizeMode(inProgressEntries.length)
  const wMode = getSizeMode(waitingEntries.length)

  const ips = inProgressStyles[ipMode === 'large' ? 'large' : 'compact']
  const ws = waitingStyles[wMode === 'large' ? 'large' : 'compact']

  // --- Auto-scroll independiente por columna (siempre habilitado, el ResizeObserver decide si hace falta) ---
  const ipScroll = useAutoScroll(inProgressEntries.length > 0, 0.4)
  const wScroll = useAutoScroll(waitingEntries.length > 0, 0.5)

  // --- Render helpers ---
  const renderInProgressCard = (entry: QueueEntry, key: string) => (
    <div
      key={key}
      className={`group relative flex items-center ${ips.card} bg-gradient-to-r from-white/[0.05] to-transparent border border-white/5 overflow-hidden transition-all duration-500`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Avatar Barber */}
      <div className="relative shrink-0">
        <div className={`${ips.avatar} bg-zinc-800 flex items-center justify-center overflow-hidden border border-white/10 shadow-xl lg:shadow-2xl`}>
          {entry.barber?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.barber.avatar_url} alt="Barber" className="w-full h-full object-cover" />
          ) : (
            <User className={`${ips.avatarIcon} text-zinc-500`} />
          )}
        </div>
        <div className={`absolute ${ips.greenDotPos} bg-green-500 ${ips.greenDot} rounded-full border-black`} />
      </div>

      <div className="flex-1 min-w-0 z-10">
        <p className={`${ips.clientName} font-semibold truncate tracking-tight text-white`}>
          {entry.client?.name ?? 'Cliente'}
        </p>
        <p className={`text-zinc-400 ${ips.barberName} flex items-center`}>
          <span>con</span>
          <span className="font-medium text-zinc-200">{entry.barber?.full_name ?? 'Barbero'}</span>
        </p>
      </div>
    </div>
  )

  const renderWaitingCard = (entry: QueueEntry, index: number, key: string) => (
    <div
      key={key}
      className={`flex items-center ${ws.card} border border-white/5 transition-all duration-300 ${
        index === 0 ? 'bg-white/10 shadow-xl lg:shadow-2xl scale-[1.01] origin-left' : 'bg-white/[0.03]'
      }`}
    >
      <div className={`flex items-center justify-center ${ws.positionBox} shrink-0 font-bold ${
        index === 0 ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'
      }`}>
        {entry.position}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`${ws.clientName} font-medium truncate ${index === 0 ? 'text-white' : 'text-zinc-300'}`}>
          {entry.client?.name ?? 'Cliente'}
        </p>
        {(entry as any)._is_dynamically_assigned ? (
          <p className={`text-emerald-400 ${ws.barberInfo} flex items-center`}>
            <Zap className={ws.chevronSize} />
            <span className="font-medium">Menor espera</span>
            <ChevronRight className={ws.chevronSize} />
            <span className="font-medium text-zinc-300">{entry.barber?.full_name}</span>
          </p>
        ) : entry.is_dynamic && !entry.barber_id ? (
          <p className={`text-emerald-400/70 ${ws.barberInfo} flex items-center`}>
            <Zap className={ws.chevronSize} />
            <span className="font-medium">Menor espera</span>
          </p>
        ) : entry.barber_id && entry.barber ? (
          <p className={`text-zinc-500 ${ws.barberInfo} flex items-center`}>
            <ChevronRight className={ws.chevronSize} />
            <span>Se corta con <span className="font-medium text-zinc-300">{entry.barber.full_name}</span></span>
          </p>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="h-screen max-h-screen w-screen bg-black text-white font-sans selection:bg-primary/30 flex flex-col overflow-hidden">
      {/* Navbar Minimalista (Fijo sin interaccion) */}
      <header className="flex items-center justify-between px-6 py-4 2xl:px-12 2xl:py-8 bg-gradient-to-b from-black/80 to-transparent z-10 shrink-0">
        <div className="flex items-center gap-4 2xl:gap-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-monaco.png"
            alt="Monaco Logo"
            className="h-[80px] w-auto object-contain 2xl:h-[140px]"
          />
          <div className="ml-4 2xl:ml-8">
            <h1 className="text-3xl lg:text-4xl 2xl:text-6xl font-semibold tracking-tight">Monaco</h1>
            <p className="text-zinc-500 text-lg lg:text-xl 2xl:text-3xl font-medium uppercase tracking-widest mt-1 2xl:mt-2">Smart Barber</p>
          </div>
        </div>

        <div className="flex items-center">
          <Select value={selectedBranchId || ''} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="text-white/40 hover:text-white/80 text-lg lg:text-2xl 2xl:text-4xl font-medium tracking-wide border-none bg-transparent shadow-none focus:ring-0 [&>svg]:hidden px-0 h-auto cursor-pointer transition-colors">
              <SelectValue placeholder="Seleccionar sucursal" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-white/10 text-white 2xl:text-2xl">
              {branches.map(b => (
                <SelectItem key={b.id} value={b.id} className="focus:bg-zinc-800 focus:text-white cursor-pointer text-base 2xl:text-2xl 2xl:py-3">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-2 gap-6 lg:gap-8 2xl:gap-16 p-6 lg:p-8 2xl:p-14 pt-0 lg:pt-0 2xl:pt-0">

        {/* En Atención (In Progress) */}
        <section className="flex flex-col gap-4 lg:gap-6 2xl:gap-10 min-h-0">
          <div className="flex items-center gap-3 2xl:gap-6 px-2 lg:px-4 2xl:px-6 pb-2 2xl:pb-4">
            <div className="flex items-center justify-center size-10 lg:size-12 2xl:size-20 rounded-full bg-green-500/20 text-green-400">
              <Scissors className="size-5 lg:size-6 2xl:size-10" />
            </div>
            <h2 className="text-3xl lg:text-4xl 2xl:text-6xl font-medium tracking-tight">En Atención</h2>
            <span className="ml-auto bg-white/10 px-4 py-1.5 lg:px-5 lg:py-2 2xl:px-8 2xl:py-3 rounded-full text-xl lg:text-2xl 2xl:text-4xl font-medium">{inProgressEntries.length}</span>
          </div>

          <div
            ref={ipScroll.containerRef}
            className="flex-1 min-h-0 overflow-hidden relative rounded-2xl lg:rounded-3xl 2xl:rounded-[2.5rem] border border-white/5 bg-white/[0.02]"
          >
            {/* Gradient fades para scroll */}
            {ipScroll.needsScroll && (
              <>
                <div className="absolute top-0 left-0 right-0 h-12 2xl:h-20 bg-gradient-to-b from-black/70 to-transparent z-10 pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 h-12 2xl:h-20 bg-gradient-to-t from-black/70 to-transparent z-10 pointer-events-none" />
              </>
            )}

            <div
              ref={ipScroll.contentRef}
              className={`${ips.container} flex flex-col items-stretch`}
            >
              {inProgressEntries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 lg:gap-6 2xl:gap-10 min-h-[200px]">
                  <Scissors className="size-16 lg:size-24 2xl:size-40 opacity-20" />
                  <p className="text-2xl lg:text-3xl 2xl:text-5xl font-medium">No hay servicios activos</p>
                </div>
              ) : (
                <>
                  {inProgressEntries.map((entry) => renderInProgressCard(entry, entry.id))}
                </>
              )}
            </div>
          </div>
        </section>

        {/* Cola de Espera (Waiting) */}
        <section className="flex flex-col gap-4 lg:gap-6 2xl:gap-10 min-h-0">
          <div className="flex items-center gap-3 2xl:gap-6 px-2 lg:px-4 2xl:px-6 pb-2 2xl:pb-4">
            <div className="flex items-center justify-center size-10 lg:size-12 2xl:size-20 rounded-full bg-blue-500/20 text-blue-400">
              <Clock className="size-5 lg:size-6 2xl:size-10" />
            </div>
            <h2 className="text-3xl lg:text-4xl 2xl:text-6xl font-medium tracking-tight">Próximos Turnos</h2>
            <span className="ml-auto bg-white/10 px-4 py-1.5 lg:px-5 lg:py-2 2xl:px-8 2xl:py-3 rounded-full text-xl lg:text-2xl 2xl:text-4xl font-medium">{waitingEntries.length}</span>
          </div>

          <div
            ref={wScroll.containerRef}
            className="flex-1 min-h-0 overflow-hidden relative rounded-2xl lg:rounded-3xl 2xl:rounded-[2.5rem] border border-white/5 bg-white/[0.02]"
          >
            {/* Gradient fades para scroll */}
            {wScroll.needsScroll && (
              <>
                <div className="absolute top-0 left-0 right-0 h-12 2xl:h-20 bg-gradient-to-b from-black/70 to-transparent z-10 pointer-events-none" />
                <div className="absolute bottom-0 left-0 right-0 h-12 2xl:h-20 bg-gradient-to-t from-black/70 to-transparent z-10 pointer-events-none" />
              </>
            )}

            <div
              ref={wScroll.contentRef}
              className={`${ws.container} flex flex-col items-stretch`}
            >
              {waitingEntries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 lg:gap-6 2xl:gap-10 min-h-[200px]">
                  <User className="size-16 lg:size-24 2xl:size-40 opacity-20" />
                  <p className="text-2xl lg:text-3xl 2xl:text-5xl font-medium">La sala está libre</p>
                </div>
              ) : (
                <>
                  {waitingEntries.map((entry, index) => renderWaitingCard(entry, index, entry.id))}
                </>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* Footer minimalista */}
      <footer className="py-4 lg:py-5 2xl:py-8 text-center text-zinc-600 text-xs lg:text-sm 2xl:text-2xl font-medium tracking-[0.2em] uppercase shrink-0">
        Powered By: Barber.OS
      </footer>
    </div>
  )
}
