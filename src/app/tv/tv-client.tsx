'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchStore } from '@/stores/branch-store'
import type { QueueEntry, StaffStatus, StaffSchedule, Staff } from '@/lib/types/database'
import { assignDynamicBarbers } from '@/lib/barber-utils'

import { Scissors, Clock, User, ChevronRight } from 'lucide-react'

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
  const [monthlyServiceCounts, setMonthlyServiceCounts] = useState<Record<string, number>>({})
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
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [schedRes, settingsRes, monthlyVisitsRes, lastVisitsRes, attendanceRes] = await Promise.all([
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
    const interval = setInterval(() => setNow(Date.now()), 1000)
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
    return assignDynamicBarbers(entries, liveBarbers as unknown as Staff[], schedules, now, shiftEndMargin, monthlyServiceCounts, lastCompletedAt, notClockedInBarbers)
  }, [entries, liveBarbers, schedules, now, shiftEndMargin, monthlyServiceCounts, lastCompletedAt, notClockedInBarbers])

  const filteredEntries = selectedBranchId
    ? dynamicEntries.filter((e) => e.branch_id === selectedBranchId)
    : dynamicEntries

  const waitingEntries = filteredEntries.filter((e) => e.status === 'waiting')
  const inProgressEntries = filteredEntries.filter(
    (e) => e.status === 'in_progress'
  )

  function formatElapsed(timestamp: string) {
    const elapsed = now - new Date(timestamp).getTime()
    if (isNaN(elapsed) || elapsed < 0) return '0m'
    const totalSeconds = Math.floor(elapsed / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  return (
    <div className="h-screen max-h-screen w-screen bg-black text-white font-sans selection:bg-primary/30 flex flex-col overflow-hidden">
      {/* Navbar Minimalista (Fijo sin interacción) */}
      <header className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 to-transparent z-10 shrink-0">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            src="/logo-monaco.png" 
            alt="Monaco Logo" 
            style={{ height: '80px', width: 'auto', objectFit: 'contain' }}
          />
          <div className="ml-4">
            <h1 className="text-3xl font-semibold tracking-tight">Monaco</h1>
            <p className="text-zinc-500 text-lg font-medium uppercase tracking-widest mt-1">Smart Barber</p>
          </div>
        </div>

        {selectedBranchId && branches.length > 0 && (
          <div className="text-white/40 text-2xl font-medium tracking-wide">
            {branches.find(b => b.id === selectedBranchId)?.name}
          </div>
        )}
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-2 gap-6 lg:gap-8 p-6 lg:p-8 pt-0 lg:pt-0">
        
        {/* En Atención (In Progress) */}
        <section className="flex flex-col gap-4 lg:gap-6 min-h-0">
          <div className="flex items-center gap-3 px-2 lg:px-4 pb-2">
            <div className="flex items-center justify-center size-10 lg:size-12 rounded-full bg-green-500/20 text-green-400">
              <Scissors className="size-5 lg:size-6" />
            </div>
            <h2 className="text-3xl lg:text-4xl font-medium tracking-tight">En Atención</h2>
            <span className="ml-auto bg-white/10 px-4 py-1.5 lg:px-5 lg:py-2 rounded-full text-xl lg:text-2xl font-medium">{inProgressEntries.length}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative rounded-2xl lg:rounded-3xl border border-white/5 bg-white/[0.02]">
            <div className="absolute inset-0 p-4 lg:p-6 space-y-4 lg:space-y-6 overflow-hidden flex flex-col items-stretch">
              {inProgressEntries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 lg:gap-6">
                  <Scissors className="size-16 lg:size-24 opacity-20" />
                  <p className="text-2xl lg:text-3xl font-medium">No hay servicios activos</p>
                </div>
              ) : (
                inProgressEntries.map((entry) => (
                  <div 
                    key={entry.id}
                    className="group relative flex items-center p-4 lg:p-6 gap-4 lg:gap-6 rounded-2xl lg:rounded-[2rem] bg-gradient-to-r from-white/[0.05] to-transparent border border-white/5 overflow-hidden transition-all duration-500"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"/>
                    
                    {/* Avatar Barber */}
                    <div className="relative shrink-0">
                      <div className="size-20 lg:size-24 rounded-2xl lg:rounded-3xl bg-zinc-800 flex items-center justify-center overflow-hidden border border-white/10 shadow-xl lg:shadow-2xl">
                        {entry.barber?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={entry.barber.avatar_url} alt="Barber" className="w-full h-full object-cover" />
                        ) : (
                          <User className="size-8 lg:size-10 text-zinc-500" />
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-green-500 size-6 lg:size-7 rounded-full border-[4px] border-black"/>
                    </div>

                    <div className="flex-1 min-w-0 z-10">
                      <p className="text-3xl lg:text-4xl font-semibold truncate tracking-tight text-white mb-1 lg:mb-2">
                        {entry.client?.name ?? 'Cliente'}
                      </p>
                      <p className="text-zinc-400 text-xl lg:text-2xl flex items-center gap-2 lg:gap-3">
                        <span>con</span>
                        <span className="font-medium text-zinc-200">{entry.barber?.full_name ?? 'Barbero'}</span>
                      </p>
                    </div>

                    <div className="shrink-0 text-right z-10">
                      <div className="inline-flex flex-col items-end">
                        <span className="text-zinc-500 text-sm lg:text-base uppercase tracking-widest font-medium mb-1 lg:mb-2">Tiempo</span>
                        <span className="text-4xl lg:text-5xl font-light tabular-nums text-green-400">
                          {entry.started_at ? formatElapsed(entry.started_at) : '0m'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Cola de Espera (Waiting) */}
        <section className="flex flex-col gap-4 lg:gap-6 min-h-0">
          <div className="flex items-center gap-3 px-2 lg:px-4 pb-2">
            <div className="flex items-center justify-center size-10 lg:size-12 rounded-full bg-blue-500/20 text-blue-400">
              <Clock className="size-5 lg:size-6" />
            </div>
            <h2 className="text-3xl lg:text-4xl font-medium tracking-tight">Próximos Turnos</h2>
            <span className="ml-auto bg-white/10 px-4 py-1.5 lg:px-5 lg:py-2 rounded-full text-xl lg:text-2xl font-medium">{waitingEntries.length}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative rounded-2xl lg:rounded-3xl border border-white/5 bg-white/[0.02]">
            <div className="absolute inset-0 p-4 lg:p-6 space-y-3 lg:space-y-4 overflow-hidden flex flex-col items-stretch">
              {waitingEntries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 lg:gap-6">
                  <User className="size-16 lg:size-24 opacity-20" />
                  <p className="text-2xl lg:text-3xl font-medium">La sala está libre</p>
                </div>
              ) : (
                waitingEntries.map((entry, index) => (
                  <div 
                    key={entry.id}
                    className={`flex items-center p-4 lg:p-6 gap-4 lg:gap-6 rounded-2xl lg:rounded-3xl border border-white/5 transition-all duration-300 ${
                      index === 0 ? 'bg-white/10 shadow-xl lg:shadow-2xl scale-[1.01] origin-left' : 'bg-white/[0.03]'
                    }`}
                  >
                    <div className={`flex items-center justify-center size-14 lg:size-16 shrink-0 rounded-xl lg:rounded-2xl font-bold text-2xl lg:text-3xl ${
                      index === 0 ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {entry.position}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-2xl lg:text-3xl font-medium truncate ${index === 0 ? 'text-white' : 'text-zinc-300'}`}>
                        {entry.client?.name ?? 'Cliente'}
                      </p>
                      {entry.barber_id && entry.barber && (
                        <p className="text-zinc-500 text-lg lg:text-xl mt-1 lg:mt-2 flex items-center gap-2">
                          <ChevronRight className="size-4 lg:size-5" />
                          <span>Se corta con <span className="font-medium text-zinc-300">{entry.barber.full_name}</span></span>
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <span className={`text-3xl lg:text-4xl font-light tabular-nums ${index === 0 ? 'text-blue-300' : 'text-zinc-500'}`}>
                        {formatElapsed(entry.checked_in_at)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </main>

      {/* Footer minimalista */}
      <footer className="py-4 lg:py-5 text-center text-zinc-600 text-xs lg:text-sm font-medium tracking-[0.2em] uppercase shrink-0">
        Powered By: Barber.OS
      </footer>
    </div>
  )
}
