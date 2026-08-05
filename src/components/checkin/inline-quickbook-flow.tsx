'use client'

/**
 * Reserva de turno desde el kiosko (modo `appointments` o `hybrid`).
 *
 * Tres decisiones que no son obvias:
 *
 * 1. NO se pregunta el barbero. La agenda de Monaco es de un barbero por día
 *    (Fabri los martes, Simón los miércoles…): preguntarle al cliente con quién
 *    quiere atenderse era pedirle que adivine. El barbero sale del slot que
 *    elige, que es la única fuente confiable de quién trabaja ese día.
 * 2. Se barren hasta 7 días en la timezone de la SUCURSAL, no dos días con el
 *    reloj de la tablet. Antes miraba hoy y mañana con `new Date()` local y, si
 *    no encontraba nada, decía "no hay horarios en los próximos días" — falso
 *    cuando el barbero de esa sucursal trabaja jueves.
 * 3. La búsqueda corta apenas encuentra un día con lugar. `getAvailableSlots`
 *    está rate-limiteado (20/min por IP+sucursal) y la tablet es UNA IP para
 *    todo el local: barrer 7 días de una para cada cliente quemaba la cuota.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Scissors,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  GlassRing,
  TerminalSectionGlow,
  terminalBodyMuted,
} from '@/components/checkin/terminal-theme'
import { AppointmentConfirmation } from '@/components/checkin/appointment-confirmation'
import { PhoneKeypad, PHONE_LENGTH } from '@/components/checkin/phone-keypad'
import { useIdleReset, IDLE_MS_NEUTRAL, IDLE_MS_PERSONAL } from '@/components/checkin/use-idle-reset'
import { quickBookFromKiosk, getAvailableSlotsForKiosk } from '@/lib/actions/kiosk-turnos'
import type { AvailableSlot } from '@/lib/actions/kiosk-turnos'
import type { PublicStaff, PublicService } from '@/lib/actions/public-booking'

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Días hacia adelante que se barren buscando el primer día con lugar. */
const DIAS_A_BARRER = 7
/** Slots que se muestran por día: más que esto no entra ni se lee de pie. */
const MAX_SLOTS_VISIBLES = 8
const DURACION_FALLBACK_MIN = 30

/**
 * `getAvailableSlots` usa el campo `error` para dos cosas distintas: "este día
 * no aplica" (seguí buscando) y "no pudimos leer" (frená y avisá). Como no hay
 * códigos, se distinguen por texto. Si algún día se agregan códigos, este es el
 * único lugar a tocar.
 */
const ERRORES_DE_DIA = ['día no habilitado', 'dia no habilitado', 'fuera del rango']

function esErrorDeDia(mensaje: string): boolean {
  const low = mensaje.toLowerCase()
  return ERRORES_DE_DIA.some((p) => low.includes(p))
}

/** Aritmética de fechas sobre 'YYYY-MM-DD' sin pasar por la TZ del proceso. */
function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

function diaDeLaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function etiquetaDeDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return 'Hoy'
  if (fecha === sumarDias(hoy, 1)) return 'Mañana'
  const [y, m, d] = fecha.split('-').map(Number)
  return format(new Date(y, m - 1, d), "EEEE d 'de' MMMM", { locale: es })
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InlineQuickBookFlowProps {
  branchId: string
  /** Timezone de la sucursal: define qué día es "hoy" para el barrido. */
  branchTimezone: string
  services: PublicService[]
  /** Barberos habilitados para turnos CON horario cargado (`days`: 0=domingo). */
  staff: PublicStaff[]
  /** Falla de carga de servicios/barberos — distinta de "no hay". */
  dataError: string | null
  loadingData: boolean
  isLightBg: boolean
  prefill?: { phone: string; name: string }
  onBack: () => void
  onReset: () => void
}

type QuickBookStep = 'service' | 'slot' | 'datos' | 'done'

const TOTAL_STEPS = 3

function StepsIndicator({ currentIndex, isLightBg }: { currentIndex: number; isLightBg: boolean }) {
  return (
    <div className="flex items-center gap-1.5 w-full max-w-[200px] mx-auto">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 h-1.5 rounded-full transition-all duration-300',
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

// ─── Componente ───────────────────────────────────────────────────────────────

export function InlineQuickBookFlow({
  branchId,
  branchTimezone,
  services,
  staff,
  dataError,
  loadingData,
  isLightBg,
  prefill,
  onBack,
  onReset,
}: InlineQuickBookFlowProps) {
  const [step, setStep] = useState<QuickBookStep>('service')

  const [selectedService, setSelectedService] = useState<PublicService | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null)

  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [slotsDate, setSlotsDate] = useState<string | null>(null)
  /** Desde qué offset (en días) sigue buscando el botón "Ver otro día". */
  const [searchFrom, setSearchFrom] = useState(0)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [sinMasDias, setSinMasDias] = useState(false)

  const [phone, setPhone] = useState(prefill?.phone ?? '')
  const [clientName, setClientName] = useState(prefill?.name ?? '')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bookedBarberName, setBookedBarberName] = useState<string | null>(null)

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: branchTimezone })
  const diasConBarbero = useMemo(() => new Set(staff.flatMap((s) => s.days)), [staff])

  // ── Timeout de inactividad ──

  const idleMs = step === 'datos' ? IDLE_MS_PERSONAL : step === 'done' ? 0 : IDLE_MS_NEUTRAL
  useIdleReset({
    enabled: idleMs > 0 && !isSubmitting,
    timeoutMs: idleMs,
    resetKey: step,
    onIdle: onReset,
  })

  // ── Barrido de disponibilidad ──

  const buscarSlots = useCallback(
    async (desdeOffset: number) => {
      const duracion = selectedService?.duration_minutes ?? DURACION_FALLBACK_MIN

      setLoadingSlots(true)
      setError('')
      setSinMasDias(false)

      for (let offset = desdeOffset; offset < DIAS_A_BARRER; offset++) {
        const fecha = sumarDias(hoy, offset)

        // Ningún barbero con horario ese día: no gastamos una llamada (y una
        // ficha del rate-limit) para que el motor devuelva vacío.
        if (diasConBarbero.size > 0 && !diasConBarbero.has(diaDeLaSemana(fecha))) continue

        const res = await getAvailableSlotsForKiosk({
          branchId,
          date: fecha,
          totalDurationMinutes: duracion,
        })

        if ('error' in res) {
          if (esErrorDeDia(res.error)) continue
          setError(res.error)
          setLoadingSlots(false)
          return
        }

        if (res.slots.length > 0) {
          setSlots(res.slots.slice(0, MAX_SLOTS_VISIBLES))
          setSlotsDate(fecha)
          setSearchFrom(offset + 1)
          setLoadingSlots(false)
          return
        }
      }

      // Se agotó la ventana sin encontrar nada más.
      if (desdeOffset === 0) {
        setSlots([])
        setSlotsDate(null)
      }
      setSinMasDias(true)
      setLoadingSlots(false)
    },
    [branchId, hoy, selectedService, diasConBarbero]
  )

  useEffect(() => {
    if (step !== 'slot' || !selectedService) return
    buscarSlots(0)
    // `buscarSlots` cambia con cada render por `diasConBarbero`; sólo queremos
    // dispararlo al entrar al paso o al cambiar de servicio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedService])

  // ── Navegación ──

  const goBack = () => {
    setError('')
    if (step === 'slot') setStep('service')
    else if (step === 'datos') setStep('slot')
    else onBack()
  }

  const selectService = (service: PublicService) => {
    setSelectedService(service)
    setSlots([])
    setSlotsDate(null)
    setSearchFrom(0)
    setStep('slot')
  }

  const selectSlot = (slot: AvailableSlot) => {
    setSelectedSlot(slot)
    setStep('datos')
  }

  // ── Confirmar ──

  const handleConfirmBook = useCallback(async () => {
    if (!selectedService || !selectedSlot || !clientName.trim() || phone.length !== PHONE_LENGTH) {
      setError('Completá todos los datos')
      return
    }

    setIsSubmitting(true)
    setError('')

    const result = await quickBookFromKiosk({
      branchId,
      serviceIds: [selectedService.id],
      staffId: selectedSlot.barber_id,
      startsAt: selectedSlot.starts_at,
      phone,
      clientName: clientName.trim(),
    })

    setIsSubmitting(false)

    if ('error' in result) {
      setError(result.error)
      return
    }

    setBookedBarberName(selectedSlot.barber_name)
    setStep('done')
  }, [branchId, selectedService, selectedSlot, clientName, phone])

  // ─── Cierre ─────────────────────────────────────────────────────────────────

  if (step === 'done') {
    const cuando = selectedSlot
      ? format(parseISO(selectedSlot.starts_at), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })
      : ''
    return (
      <AppointmentConfirmation
        barberName={bookedBarberName}
        title="¡Turno reservado!"
        message={<span className="capitalize">{cuando}</span>}
        notes={['Te esperamos. Podés venir 10 minutos antes y registrar tu llegada acá mismo.']}
        onReset={onReset}
        isLightBg={isLightBg}
      />
    )
  }

  const stepIndex: Record<QuickBookStep, number> = { service: 0, slot: 1, datos: 2, done: 3 }

  // ─── Piezas compartidas ─────────────────────────────────────────────────────

  const cajaError = error ? (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-3 rounded-2xl border text-base md:text-lg w-full',
        isLightBg ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-950/30 border-red-500/30 text-red-300'
      )}
    >
      <AlertCircle className="size-5 shrink-0" />
      <span>{error}</span>
    </div>
  ) : null

  const botonAtras = (
    <button
      onClick={goBack}
      className={cn(
        'flex items-center gap-2 text-base md:text-lg underline underline-offset-4 transition-colors',
        isLightBg ? 'text-zinc-500 hover:text-zinc-900' : 'text-white/40 hover:text-white/75'
      )}
    >
      <ArrowLeft className="size-5" />
      Atrás
    </button>
  )

  const marco = (children: React.ReactNode) => (
    <div className="relative z-[1] w-full max-w-sm md:max-w-2xl flex flex-col items-center gap-5 md:gap-6 px-4 md:px-8 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-300">
      <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
      <StepsIndicator currentIndex={stepIndex[step]} isLightBg={isLightBg} />
      {children}
    </div>
  )

  const titulo = (texto: string, bajada?: string) => (
    <div className="text-center space-y-1">
      <h2
        className={cn(
          'text-3xl md:text-5xl font-extrabold tracking-tight',
          isLightBg ? 'text-zinc-900' : 'text-white'
        )}
      >
        {texto}
      </h2>
      {bajada && (
        <p className={cn('text-lg md:text-xl', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>{bajada}</p>
      )}
    </div>
  )

  // ─── Paso 1: servicio ───────────────────────────────────────────────────────

  if (step === 'service') {
    // `publicGetBranchServices` ya filtra por is_active y por booking_mode.
    const reservables = services

    return marco(
      <>
        {titulo('¿Qué te vas a hacer?', 'Elegí un servicio para ver los horarios')}

        {loadingData ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className={cn('size-10 animate-spin', isLightBg ? 'text-cyan-600' : 'text-cyan-400')} />
          </div>
        ) : dataError ? (
          // Un fallo de red no puede leerse igual que "el local no cargó
          // servicios": el primero se reintenta, el segundo se resuelve con el
          // dueño. Antes ambos decían "No hay servicios disponibles".
          <div
            className={cn(
              'w-full rounded-2xl border p-5 text-center space-y-4',
              isLightBg ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-amber-950/25 border-amber-400/25 text-amber-200'
            )}
          >
            <p className="text-lg md:text-xl">No pudimos cargar los servicios.</p>
            <p className="text-base opacity-80">{dataError}</p>
          </div>
        ) : reservables.length === 0 ? (
          <p className={cn('text-center text-lg md:text-xl py-8', isLightBg ? 'text-zinc-600' : 'text-white/50')}>
            Esta sucursal todavía no tiene servicios habilitados para reservar. Avisá en el mostrador.
          </p>
        ) : (
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3">
            {reservables.map((service) => (
              <GlassRing key={service.id} halo={false}>
                <button
                  onClick={() => selectService(service)}
                  className={cn(
                    'w-full flex items-center gap-4 rounded-2xl border min-h-20 p-4 md:p-5 text-left transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
                    isLightBg
                      ? 'border-zinc-300 bg-white shadow-sm hover:border-zinc-400 hover:shadow-md'
                      : 'border-white/15 bg-white/5 hover:border-white/28'
                  )}
                >
                  <div
                    className={cn(
                      'size-12 rounded-xl flex items-center justify-center border shrink-0',
                      isLightBg ? 'bg-cyan-50 border-cyan-200' : 'bg-cyan-500/10 border-cyan-400/20'
                    )}
                  >
                    <Scissors className={cn('size-6', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <p className={cn('text-xl md:text-2xl font-bold truncate', isLightBg ? 'text-zinc-900' : 'text-white')}>
                      {service.name}
                    </p>
                    {service.duration_minutes && (
                      <p className={cn('text-base', isLightBg ? 'text-zinc-500' : 'text-white/50')}>
                        {service.duration_minutes} min
                      </p>
                    )}
                  </div>
                </button>
              </GlassRing>
            ))}
          </div>
        )}

        {botonAtras}
      </>
    )
  }

  // ─── Paso 2: horario ────────────────────────────────────────────────────────

  if (step === 'slot') {
    return marco(
      <>
        {titulo('Elegí un horario', selectedService?.name)}

        {loadingSlots ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className={cn('size-10 animate-spin', isLightBg ? 'text-cyan-600' : 'text-cyan-400')} />
          </div>
        ) : slots.length === 0 ? (
          <p className={cn('text-center text-lg md:text-xl py-8', isLightBg ? 'text-zinc-600' : 'text-white/50')}>
            No hay horarios disponibles en los próximos {DIAS_A_BARRER} días. Avisá en el mostrador y lo vemos.
          </p>
        ) : (
          <>
            <div
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-full border capitalize',
                isLightBg ? 'border-zinc-300 bg-white text-zinc-800' : 'border-white/15 bg-white/5 text-white/80'
              )}
            >
              <Calendar className="size-5" strokeWidth={1.75} />
              <span className="text-lg md:text-xl font-semibold">
                {slotsDate ? etiquetaDeDia(slotsDate, hoy) : ''}
              </span>
            </div>

            <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3">
              {slots.map((slot) => (
                <GlassRing key={`${slot.starts_at}-${slot.barber_id}`} halo={false}>
                  <button
                    onClick={() => selectSlot(slot)}
                    className={cn(
                      'w-full flex flex-col items-center justify-center gap-0.5 rounded-2xl border min-h-20 p-3 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
                      isLightBg
                        ? 'border-zinc-300 bg-white shadow-sm hover:border-cyan-400 hover:shadow-md'
                        : 'border-white/15 bg-white/5 hover:border-cyan-400/40'
                    )}
                  >
                    <p className={cn('text-3xl font-extrabold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                      {format(parseISO(slot.starts_at), 'HH:mm')}
                    </p>
                    <p className={cn('text-sm truncate max-w-full', isLightBg ? 'text-zinc-500' : 'text-white/45')}>
                      {slot.barber_name}
                    </p>
                  </button>
                </GlassRing>
              ))}
            </div>

            {!sinMasDias && searchFrom < DIAS_A_BARRER && (
              <button
                onClick={() => buscarSlots(searchFrom)}
                className={cn(
                  'text-base md:text-lg underline underline-offset-4 transition-colors',
                  isLightBg ? 'text-zinc-500 hover:text-zinc-900' : 'text-white/40 hover:text-white/75'
                )}
              >
                Ver otro día
              </button>
            )}
            {sinMasDias && slots.length > 0 && (
              <p className={cn('text-base', isLightBg ? 'text-zinc-500' : 'text-white/40')}>
                No hay más días con lugar esta semana.
              </p>
            )}
          </>
        )}

        {cajaError}
        {botonAtras}
      </>
    )
  }

  // ─── Paso 3: datos ──────────────────────────────────────────────────────────

  if (step === 'datos') {
    const cuando = selectedSlot
      ? format(parseISO(selectedSlot.starts_at), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })
      : ''

    return marco(
      <>
        {titulo('Tus datos')}

        {/* Resumen del turno elegido */}
        <div
          className={cn(
            'w-full rounded-2xl border p-4 flex flex-col gap-2',
            isLightBg ? 'bg-zinc-50 border-zinc-200' : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center gap-2">
            <Clock className={cn('size-5', isLightBg ? 'text-emerald-600' : 'text-emerald-300')} strokeWidth={1.75} />
            <span className={cn('text-lg font-semibold capitalize', isLightBg ? 'text-zinc-800' : 'text-white/80')}>
              {cuando}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Scissors className={cn('size-5', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.75} />
            <span className={cn('text-lg font-semibold', isLightBg ? 'text-zinc-800' : 'text-white/80')}>
              {selectedService?.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <User className={cn('size-5', isLightBg ? 'text-violet-600' : 'text-violet-300')} strokeWidth={1.75} />
            <span className={cn('text-lg font-semibold', isLightBg ? 'text-zinc-800' : 'text-white/80')}>
              {selectedSlot?.barber_name}
            </span>
          </div>
        </div>

        <div className="w-full flex flex-col md:flex-row gap-5">
          <div className="flex-1 space-y-2">
            <label className={cn('text-base font-semibold uppercase tracking-wide', isLightBg ? 'text-zinc-500' : 'text-white/40')}>
              Nombre y apellido
            </label>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="off"
              className={cn(
                'h-16 text-xl md:text-2xl text-center rounded-2xl',
                isLightBg
                  ? 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 shadow-sm focus-visible:border-cyan-500'
                  : 'border-cyan-500/20 bg-zinc-950/50 text-cyan-50 placeholder:text-cyan-200/30 focus-visible:border-cyan-400/40'
              )}
            />
          </div>

          <div className="flex-1 space-y-2">
            <label className={cn('text-base font-semibold uppercase tracking-wide', isLightBg ? 'text-zinc-500' : 'text-white/40')}>
              Teléfono
            </label>
            <PhoneKeypad value={phone} onChange={setPhone} isLightBg={isLightBg} disabled={isSubmitting} />
          </div>
        </div>

        {cajaError}

        <GlassRing halo={!isLightBg} className="w-full">
          <button
            onClick={handleConfirmBook}
            disabled={isSubmitting || !clientName.trim() || phone.length !== PHONE_LENGTH}
            className={cn(
              'relative w-full flex items-center justify-center gap-3 rounded-2xl border min-h-16 md:min-h-[4.5rem] px-6 text-xl md:text-2xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
              isLightBg
                ? 'bg-cyan-500 border-cyan-500 text-white hover:bg-cyan-600 shadow-sm'
                : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-500/25'
            )}
          >
            {isSubmitting ? <Loader2 className="size-6 animate-spin" /> : <CheckCircle2 className="size-6" strokeWidth={2} />}
            Confirmar turno
          </button>
        </GlassRing>

        {botonAtras}
      </>
    )
  }

  return null
}
