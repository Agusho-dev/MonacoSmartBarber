'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback } from 'react'
import { format, parseISO, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Scissors,
  User,
  Clock,
  Calendar,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Delete,
  ArrowLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  GlassRing,
  TerminalSectionGlow,
  terminalBodyMuted,
  terminalKeypadKey,
  terminalKeypadShell,
} from '@/components/checkin/terminal-theme'
import { AppointmentConfirmation } from '@/components/checkin/appointment-confirmation'
import {
  quickBookFromKiosk,
  getAvailableSlotsForKiosk,
} from '@/lib/actions/kiosk-turnos'
import type { AvailableSlot } from '@/lib/actions/kiosk-turnos'
import type { Service, Staff } from '@/lib/types/database'

// ─── Constantes ───────────────────────────────────────────────────────────────

const PHONE_LENGTH = 10
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function formatPhone(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

const TOTAL_STEPS = 4

/** Indicador de progreso de pasos — componente estático para evitar recreación en render */
function StepsIndicator({
  currentIndex,
  isLightBg,
}: {
  currentIndex: number
  isLightBg: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 w-full max-w-[180px] mx-auto">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 h-1 rounded-full transition-all duration-300',
            i < currentIndex
              ? isLightBg ? 'bg-cyan-500' : 'bg-cyan-400'
              : i === currentIndex
                ? isLightBg ? 'bg-cyan-500/60' : 'bg-cyan-400/50'
                : isLightBg ? 'bg-zinc-200' : 'bg-white/10'
          )}
        />
      ))}
    </div>
  )
}

type QuickBookStep =
  | 'service'
  | 'staff'
  | 'slot'
  | 'name_phone'
  | 'confirming'
  | 'done'

interface InlineQuickBookFlowProps {
  branchId: string
  services: Service[]
  barbers: Staff[]
  isLightBg: boolean
  onBack: () => void
  onReset: () => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function InlineQuickBookFlow({
  branchId,
  services,
  barbers,
  isLightBg,
  onBack,
  onReset,
}: InlineQuickBookFlowProps) {
  const [step, setStep] = useState<QuickBookStep>('service')

  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [selectedBarber, setSelectedBarber] = useState<Staff | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null)

  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  const [phone, setPhone] = useState('')
  const [clientName, setClientName] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bookedBarberName, setBookedBarberName] = useState<string | null>(null)

  // ── Cargar slots cuando se elige servicio + barbero ──

  useEffect(() => {
    if (step !== 'slot' || !selectedService || !selectedBarber) return

    const duration = selectedService.duration_minutes ?? 30
    const today = format(new Date(), 'yyyy-MM-dd')
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')

    // Carga async para evitar setState sincrónico detectado por el React Compiler
    const cargarSlots = async () => {
      setLoadingSlots(true)
      setError('')

      // Buscar slots de hoy primero; si hay, usarlos. Si no, buscar mañana.
      const resHoy = await getAvailableSlotsForKiosk({
        branchId,
        date: today,
        totalDurationMinutes: duration,
        staffId: selectedBarber.id,
      })

      if ('error' in resHoy) {
        setError(resHoy.error)
        setLoadingSlots(false)
        return
      }
      if (resHoy.slots.length > 0) {
        setSlots(resHoy.slots.slice(0, 6))
        setLoadingSlots(false)
        return
      }

      // Sin slots hoy → buscar mañana
      const resMañana = await getAvailableSlotsForKiosk({
        branchId,
        date: tomorrow,
        totalDurationMinutes: duration,
        staffId: selectedBarber.id,
      })

      if ('error' in resMañana) {
        setError(resMañana.error)
      } else {
        setSlots(resMañana.slots.slice(0, 6))
      }
      setLoadingSlots(false)
    }

    cargarSlots()
  }, [step, branchId, selectedService, selectedBarber])

  // ── Helpers de navegación ──

  const goBack = () => {
    setError('')
    if (step === 'staff') setStep('service')
    else if (step === 'slot') setStep('staff')
    else if (step === 'name_phone') setStep('slot')
    else onBack()
  }

  // ── Selecciones ──

  const selectService = (service: Service) => {
    setSelectedService(service)
    setStep('staff')
  }

  const selectBarber = (barber: Staff) => {
    setSelectedBarber(barber)
    setSlots([])
    setStep('slot')
  }

  const selectSlot = (slot: AvailableSlot) => {
    setSelectedSlot(slot)
    setStep('name_phone')
  }

  // ── Keypad teléfono ──

  const pressDigit = (digit: string) => {
    if (phone.length >= PHONE_LENGTH) return
    const next = phone + digit
    setPhone(next)
  }

  const pressDelete = () => {
    if (phone.length === 0) return
    setPhone((p) => p.slice(0, -1))
  }

  // ── Confirmar reserva ──

  const handleConfirmBook = useCallback(async () => {
    if (!selectedService || !selectedBarber || !selectedSlot || !clientName.trim() || phone.length !== PHONE_LENGTH) {
      setError('Completá todos los datos')
      return
    }

    setIsSubmitting(true)
    setError('')

    const result = await quickBookFromKiosk({
      branchId,
      serviceIds: [selectedService.id],
      staffId: selectedBarber.id,
      startsAt: selectedSlot.starts_at,
      phone,
      clientName: clientName.trim(),
    })

    setIsSubmitting(false)

    if ('error' in result) {
      setError(result.error)
      return
    }

    setBookedBarberName(selectedBarber.full_name)
    setStep('done')
  }, [branchId, selectedService, selectedBarber, selectedSlot, clientName, phone])

  // ─── Pantalla: reserva confirmada ───────────────────────────────────────────

  if (step === 'done') {
    return (
      <AppointmentConfirmation
        barberName={bookedBarberName}
        onReset={onReset}
        isLightBg={isLightBg}
      />
    )
  }

  // ─── Índice de paso actual ───────────────────────────────────────────────────

  const stepIndex: Record<QuickBookStep, number> = {
    service: 0,
    staff: 1,
    slot: 2,
    name_phone: 3,
    confirming: 3,
    done: 4,
  }
  const currentIndex = stepIndex[step]

  // StepsIndicator está definido fuera del componente (arriba del archivo)
  // para evitar que el React Compiler lo detecte como componente creado en render.

  // ─── Pantalla: selección de servicio ────────────────────────────────────────

  const appointmentServices = services.filter(
    (s) =>
      s.is_active &&
      (s.availability === 'appointment' ||
        s.availability === 'all' ||
        s.availability === 'both')
  )

  if (step === 'service') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-5 px-4 md:px-6 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <StepsIndicator currentIndex={currentIndex} isLightBg={isLightBg} />

        <div className="text-center space-y-1">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Que servicio querés?
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Elegí para ver disponibilidad
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          {appointmentServices.map((service) => (
            <GlassRing key={service.id} halo={false}>
              <button
                onClick={() => selectService(service)}
                className={cn(
                  'w-full flex items-center justify-between gap-4 rounded-2xl border p-4 md:p-5 text-left transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                  isLightBg
                    ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                    : 'border-white/15 bg-white/5 hover:border-white/28 focus-visible:ring-white/50'
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'size-10 md:size-12 rounded-xl flex items-center justify-center border',
                      isLightBg
                        ? 'bg-cyan-50 border-cyan-200'
                        : 'bg-cyan-500/10 border-cyan-400/20'
                    )}
                  >
                    <Scissors
                      className={cn(
                        'size-5',
                        isLightBg ? 'text-cyan-600' : 'text-cyan-300'
                      )}
                      strokeWidth={1.75}
                    />
                  </div>
                  <div>
                    <p
                      className={cn(
                        'text-base md:text-lg font-bold',
                        isLightBg ? 'text-zinc-900' : 'text-white'
                      )}
                    >
                      {service.name}
                    </p>
                    {service.duration_minutes && (
                      <p
                        className={cn(
                          'text-sm',
                          isLightBg ? 'text-zinc-500' : 'text-white/50'
                        )}
                      >
                        {service.duration_minutes} min
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </GlassRing>
          ))}

          {appointmentServices.length === 0 && (
            <p
              className={cn(
                'text-center text-base py-8',
                isLightBg ? 'text-zinc-500' : 'text-white/40'
              )}
            >
              No hay servicios disponibles para reservar.
            </p>
          )}
        </div>

        <button
          onClick={goBack}
          className={cn(
            'flex items-center gap-1.5 text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          <ArrowLeft className="size-4" />
          Atras
        </button>
      </div>
    )
  }

  // ─── Pantalla: selección de barbero ─────────────────────────────────────────

  if (step === 'staff') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-5 px-4 md:px-6 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <StepsIndicator currentIndex={currentIndex} isLightBg={isLightBg} />

        <div className="text-center space-y-1">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Con quien te atendes?
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Servicio:{' '}
            <span
              className={cn('font-semibold', isLightBg ? 'text-zinc-900' : 'text-white')}
            >
              {selectedService?.name}
            </span>
          </p>
        </div>

        <div className="w-full grid grid-cols-2 gap-3">
          {barbers
            .filter((b) => b.is_active && !b.hidden_from_checkin)
            .map((barber) => (
              <GlassRing key={barber.id} halo={false}>
                <button
                  onClick={() => selectBarber(barber)}
                  className={cn(
                    'w-full flex flex-col items-center gap-3 rounded-2xl border p-4 md:p-5 text-center transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                    isLightBg
                      ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                      : 'border-white/15 bg-white/5 hover:border-white/28 focus-visible:ring-white/50'
                  )}
                >
                  {barber.avatar_url ? (
                    <Image
                      src={barber.avatar_url}
                      alt={barber.full_name}
                      width={80}
                      height={80}
                      className="size-16 md:size-20 rounded-full object-cover ring-2 ring-offset-2 ring-cyan-400/30"
                    />
                  ) : (
                    <div
                      className={cn(
                        'size-16 md:size-20 rounded-full flex items-center justify-center text-2xl font-bold',
                        isLightBg ? 'bg-zinc-200 text-zinc-700' : 'bg-white/10 text-white'
                      )}
                    >
                      {barber.full_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p
                    className={cn(
                      'text-base md:text-lg font-bold truncate w-full',
                      isLightBg ? 'text-zinc-900' : 'text-white'
                    )}
                  >
                    {barber.full_name}
                  </p>
                </button>
              </GlassRing>
            ))}
        </div>

        <button
          onClick={goBack}
          className={cn(
            'flex items-center gap-1.5 text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          <ArrowLeft className="size-4" />
          Atras
        </button>
      </div>
    )
  }

  // ─── Pantalla: selección de slot ────────────────────────────────────────────

  if (step === 'slot') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-5 px-4 md:px-6 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <StepsIndicator currentIndex={currentIndex} isLightBg={isLightBg} />

        <div className="text-center space-y-1">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Elegí un horario
          </h2>
          <p
            className={cn(
              'text-base md:text-lg',
              isLightBg ? 'text-zinc-600' : terminalBodyMuted
            )}
          >
            Con{' '}
            <span className={cn('font-semibold', isLightBg ? 'text-zinc-900' : 'text-white')}>
              {selectedBarber?.full_name}
            </span>
          </p>
        </div>

        {loadingSlots ? (
          <div className="flex items-center justify-center py-12">
            <Loader2
              className={cn(
                'size-8 animate-spin',
                isLightBg ? 'text-cyan-600' : 'text-cyan-400'
              )}
            />
          </div>
        ) : slots.length === 0 ? (
          <p
            className={cn(
              'text-center text-base py-8',
              isLightBg ? 'text-zinc-500' : 'text-white/40'
            )}
          >
            No hay horarios disponibles en los proximos dias.
          </p>
        ) : (
          <div className="w-full grid grid-cols-2 gap-3">
            {slots.map((slot) => {
              const slotDate = parseISO(slot.starts_at)
              const isToday =
                format(slotDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
              return (
                <GlassRing key={slot.starts_at} halo={false}>
                  <button
                    onClick={() => selectSlot(slot)}
                    className={cn(
                      'w-full flex flex-col items-center gap-1 rounded-2xl border p-4 text-center transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2',
                      isLightBg
                        ? 'border-zinc-300 bg-white shadow-sm hover:border-cyan-400 hover:shadow-md focus-visible:ring-cyan-600/35'
                        : 'border-white/15 bg-white/5 hover:border-cyan-400/40 focus-visible:ring-white/50'
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Calendar
                        className={cn(
                          'size-3.5',
                          isLightBg ? 'text-zinc-500' : 'text-white/40'
                        )}
                        strokeWidth={1.75}
                      />
                      <p
                        className={cn(
                          'text-xs font-semibold uppercase tracking-wide',
                          isLightBg ? 'text-zinc-500' : 'text-white/40'
                        )}
                      >
                        {isToday
                          ? 'Hoy'
                          : format(slotDate, 'EEE d MMM', { locale: es })}
                      </p>
                    </div>
                    <p
                      className={cn(
                        'text-2xl md:text-3xl font-extrabold',
                        isLightBg ? 'text-zinc-900' : 'text-white'
                      )}
                    >
                      {format(slotDate, 'HH:mm')}
                    </p>
                  </button>
                </GlassRing>
              )
            })}
          </div>
        )}

        {error && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm md:text-base w-full',
              isLightBg
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-950/30 border-red-500/30 text-red-300'
            )}
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={goBack}
          className={cn(
            'flex items-center gap-1.5 text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          <ArrowLeft className="size-4" />
          Atras
        </button>
      </div>
    )
  }

  // ─── Pantalla: nombre + teléfono ────────────────────────────────────────────

  if (step === 'name_phone') {
    const slotFormatted = selectedSlot
      ? format(
          parseISO(selectedSlot.starts_at),
          "EEEE d 'de' MMMM 'a las' HH:mm",
          { locale: es }
        )
      : ''

    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-5 px-4 md:px-6 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-400">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />

        <StepsIndicator currentIndex={currentIndex} isLightBg={isLightBg} />

        <div className="text-center space-y-1">
          <h2
            className={cn(
              'text-2xl md:text-4xl font-extrabold',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Tus datos
          </h2>
          <p
            className={cn(
              'text-sm md:text-base capitalize',
              isLightBg ? 'text-zinc-500' : 'text-white/40'
            )}
          >
            {slotFormatted}
          </p>
        </div>

        {/* Resumen del turno */}
        <div
          className={cn(
            'w-full rounded-2xl border p-4 flex flex-col gap-2',
            isLightBg ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center gap-2">
            <Scissors
              className={cn('size-4', isLightBg ? 'text-cyan-600' : 'text-cyan-300')}
              strokeWidth={1.75}
            />
            <span className={cn('text-sm font-semibold', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
              {selectedService?.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <User
              className={cn('size-4', isLightBg ? 'text-violet-600' : 'text-violet-300')}
              strokeWidth={1.75}
            />
            <span className={cn('text-sm font-semibold', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
              {selectedBarber?.full_name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock
              className={cn('size-4', isLightBg ? 'text-emerald-600' : 'text-emerald-300')}
              strokeWidth={1.75}
            />
            <span className={cn('text-sm font-semibold capitalize', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
              {slotFormatted}
            </span>
          </div>
        </div>

        {/* Nombre */}
        <div className="w-full space-y-2">
          <label
            className={cn(
              'text-sm font-semibold uppercase tracking-wide',
              isLightBg ? 'text-zinc-500' : 'text-white/40'
            )}
          >
            Nombre y apellido
          </label>
          <Input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Tu nombre completo"
            autoComplete="off"
            className={cn(
              'h-14 md:h-16 text-lg md:text-xl text-center rounded-2xl',
              isLightBg
                ? 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 shadow-sm focus-visible:border-cyan-500'
                : 'border-cyan-500/20 bg-zinc-950/50 text-cyan-50 placeholder:text-cyan-200/30 shadow-[inset_0_0_24px_rgba(34,211,238,0.04)] focus-visible:border-cyan-400/40'
            )}
          />
        </div>

        {/* Teléfono via keypad */}
        <div className="w-full space-y-2">
          <label
            className={cn(
              'text-sm font-semibold uppercase tracking-wide',
              isLightBg ? 'text-zinc-500' : 'text-white/40'
            )}
          >
            Numero de telefono
          </label>

          <div
            className={cn(
              'w-full rounded-2xl border p-3 text-center relative overflow-hidden',
              isLightBg ? 'border-zinc-300 bg-white shadow-sm' : terminalKeypadShell
            )}
          >
            <p
              className={cn(
                'text-xl md:text-2xl font-mono font-bold tracking-[0.15em] min-h-8 flex items-center justify-center',
                isLightBg ? 'text-zinc-900' : 'text-white'
              )}
            >
              {phone ? (
                formatPhone(phone)
              ) : (
                <span className={isLightBg ? 'text-zinc-300' : 'text-white/20'}>
                  __ ____ ____
                </span>
              )}
            </p>
            {isSubmitting && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
          </div>

          <div className="w-full grid grid-cols-3 gap-2">
            {KEYPAD.map((d) => (
              <button
                key={d}
                onClick={() => pressDigit(d)}
                disabled={phone.length >= PHONE_LENGTH}
                className={cn(
                  'h-11 md:h-14 text-xl md:text-2xl',
                  isLightBg
                    ? 'relative rounded-xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
                    : terminalKeypadKey
                )}
              >
                {d}
              </button>
            ))}
            <button
              onClick={pressDelete}
              disabled={phone.length === 0}
              className={cn(
                'h-11 md:h-14 flex items-center justify-center',
                isLightBg
                  ? 'relative rounded-xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
                  : terminalKeypadKey
              )}
            >
              <Delete className="size-5 md:size-6" />
            </button>
            <button
              onClick={() => pressDigit('0')}
              disabled={phone.length >= PHONE_LENGTH}
              className={cn(
                'h-11 md:h-14 text-xl md:text-2xl',
                isLightBg
                  ? 'relative rounded-xl border border-zinc-300 bg-white text-zinc-900 font-semibold transition-all duration-200 hover:border-zinc-400 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shadow-sm'
                  : terminalKeypadKey
              )}
            >
              0
            </button>
            <div />
          </div>
        </div>

        {error && (
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm md:text-base w-full',
              isLightBg
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-950/30 border-red-500/30 text-red-300'
            )}
          >
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* CTA confirmar reserva */}
        <GlassRing halo={!isLightBg} className="w-full">
          <button
            onClick={handleConfirmBook}
            disabled={
              isSubmitting ||
              !clientName.trim() ||
              phone.length !== PHONE_LENGTH
            }
            className={cn(
              'relative w-full flex items-center justify-center gap-3 rounded-2xl border py-4 md:py-5 px-6 text-lg md:text-xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
              isLightBg
                ? 'bg-cyan-500 border-cyan-500 text-white hover:bg-cyan-600 focus-visible:ring-cyan-500/40 shadow-sm'
                : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300 hover:border-cyan-400/70 hover:bg-cyan-500/25 focus-visible:ring-cyan-400/50 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
            )}
          >
            {isSubmitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-5" strokeWidth={2} />
            )}
            Confirmar turno
          </button>
        </GlassRing>

        <button
          onClick={goBack}
          className={cn(
            'flex items-center gap-1.5 text-sm md:text-base underline underline-offset-4 transition-colors',
            isLightBg
              ? 'text-zinc-500 hover:text-zinc-800'
              : 'text-white/35 hover:text-white/65'
          )}
        >
          <ArrowLeft className="size-4" />
          Atras
        </button>
      </div>
    )
  }

  return null
}
