'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2, MapPin, Phone, Scissors } from 'lucide-react'
import { publicBookAppointment } from '@/lib/actions/public-booking'
import { ServicesStep } from './wizard/services-step'
import { StaffStep } from './wizard/staff-step'
import { SlotStep } from './wizard/slot-step'
import { ContactStep } from './wizard/contact-step'
import { ConfirmationStep } from './wizard/confirmation-step'
import { formatCurrency } from '@/lib/format'
import type { PublicService, PublicStaff, PublicBookingResult } from '@/lib/actions/public-booking'

// ─── Tipos de props ──────────────────────────────────────────────────

interface Branch {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  timezone: string
}

interface Settings {
  max_advance_days: number
  appointment_days: number[]
  slot_interval_minutes: number
  cancellation_min_hours: number
}

interface Branding {
  bg: string
  primary: string
  text: string
  logo_url: string | null
  welcome_message: string | null
  branch_name: string
  branch_address: string | null
  branch_phone: string | null
}

interface Props {
  branch: Branch
  services: PublicService[]
  staff: PublicStaff[]
  settings: Settings
  branding: Branding
}

// ─── Steps del wizard ────────────────────────────────────────────────

type WizardStep = 'services' | 'staff' | 'slot' | 'contact' | 'confirmation'

const STEP_ORDER: WizardStep[] = ['services', 'staff', 'slot', 'contact', 'confirmation']
const STEP_LABELS: Record<WizardStep, string> = {
  services: 'Servicio',
  staff: 'Barbero',
  slot: 'Horario',
  contact: 'Datos',
  confirmation: 'Confirmación',
}
const STEP_NUMBERS: Record<WizardStep, number> = {
  services: 1,
  staff: 2,
  slot: 3,
  contact: 4,
  confirmation: 5,
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isValidName(name: string): boolean {
  return name.trim().length >= 2
}

function isValidPhone(phone: string): boolean {
  return /^\+?[\d\s\-]{8,15}$/.test(phone.trim())
}

function mapErrorCode(code: string): string {
  const map: Record<string, string> = {
    INVALID_NAME: 'El nombre debe tener al menos 2 caracteres.',
    INVALID_PHONE: 'Ingresá un número de teléfono válido.',
    PHONE_QUOTA_EXCEEDED: 'Ya tenés varios turnos reservados. Si necesitás ayuda, comunicate con la sucursal.',
    SLOT_TAKEN: 'Ese horario ya fue tomado por alguien más. Elegí otro.',
    TOO_LATE: 'El horario seleccionado ya no está disponible. Elegí otro.',
    NOT_FOUND_OR_NOT_CANCELLABLE: 'No se pudo cancelar el turno.',
  }
  return map[code] ?? code
}

// ─── Componente principal ────────────────────────────────────────────

export function BookingWizard({ branch, services, staff, settings, branding }: Props) {
  const [step, setStep] = useState<WizardStep>('services')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedSlotStaffId, setSelectedSlotStaffId] = useState<string>('')
  const [selectedSlotStaffName, setSelectedSlotStaffName] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [bookingResult, setBookingResult] = useState<PublicBookingResult | null>(null)

  const currentStepIndex = STEP_ORDER.indexOf(step)
  const isFirstStep = currentStepIndex === 0
  const isLastContentStep = step === 'contact'

  // Servicio y staff derivados para mostrar en resumen
  const primaryService = services.find(s => selectedServiceIds[0] === s.id)
  const primaryDuration = selectedServiceIds.reduce((acc, id) => {
    const svc = services.find(s => s.id === id)
    return acc + (svc?.duration_minutes ?? settings.slot_interval_minutes)
  }, 0)

  const effectiveStaffForSlot = selectedStaffId  // null = cualquiera

  // ─── Navegación ─────────────────────────────────────────────────

  function goBack() {
    const prev = STEP_ORDER[currentStepIndex - 1]
    if (prev) {
      setError('')
      setStep(prev)
    }
  }

  function goNext() {
    setError('')

    if (step === 'services') {
      if (selectedServiceIds.length === 0) {
        setError('Seleccioná al menos un servicio para continuar.')
        return
      }
      setStep('staff')
      return
    }

    if (step === 'staff') {
      setStep('slot')
      return
    }

    if (step === 'slot') {
      if (!selectedDate || !selectedTime) {
        setError('Seleccioná un día y horario para continuar.')
        return
      }
      setStep('contact')
      return
    }

    if (step === 'contact') {
      if (!isValidName(clientName)) {
        setError('Ingresá tu nombre completo (mínimo 2 caracteres).')
        return
      }
      if (!isValidPhone(clientPhone)) {
        setError('Ingresá un número de teléfono válido.')
        return
      }
      if (!policyAccepted) {
        setError('Aceptá la política de cancelación para continuar.')
        return
      }

      // Confirmar turno
      startTransition(async () => {
        if (!selectedDate || !selectedTime) {
          setError('Falta fecha u horario. Volvé al paso anterior.')
          return
        }

        const dateStr = (() => {
          const y = selectedDate.getFullYear()
          const m = String(selectedDate.getMonth() + 1).padStart(2, '0')
          const d = String(selectedDate.getDate()).padStart(2, '0')
          return `${y}-${m}-${d}`
        })()

        const result = await publicBookAppointment({
          branch_slug: branch.slug,
          branch_id: branch.id,
          client_phone: clientPhone,
          client_name: clientName,
          staff_id: selectedSlotStaffId || effectiveStaffForSlot,
          starts_at: dateStr,
          start_time: selectedTime,
          service_ids: selectedServiceIds,
          duration_minutes: primaryDuration,
        })

        if ('error' in result) {
          setError(mapErrorCode(result.error))
          return
        }

        setBookingResult({
          ...result.data,
          barber_name: selectedSlotStaffName || null,
        })
        setStep('confirmation')
      })
    }
  }

  // ─── Handlers ───────────────────────────────────────────────────

  function toggleService(id: string) {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    setError('')
  }

  function handleContactChange(field: 'name' | 'phone' | 'accepted', value: string | boolean) {
    if (field === 'name') setClientName(value as string)
    else if (field === 'phone') setClientPhone(value as string)
    else setPolicyAccepted(value as boolean)
    setError('')
  }

  function handleSlotSelect(time: string, staffId: string, staffName: string) {
    setSelectedTime(time)
    setSelectedSlotStaffId(staffId)
    setSelectedSlotStaffName(staffName)
    setError('')
  }

  // ─── Helpers visuales ───────────────────────────────────────────

  function canProceed(): boolean {
    if (step === 'services') return selectedServiceIds.length > 0
    if (step === 'staff') return true
    if (step === 'slot') return !!selectedDate && !!selectedTime
    if (step === 'contact') return isValidName(clientName) && isValidPhone(clientPhone) && policyAccepted
    return false
  }

  const ctaLabel = isLastContentStep ? 'Confirmar turno' : 'Continuar'

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: branding.bg }}
    >
      {/* Header sticky con nombre + dirección + tel */}
      <header
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: branding.bg, borderColor: 'rgba(0,0,0,0.08)' }}
      >
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            {branding.logo_url ? (
              <Image
                src={branding.logo_url}
                alt={branch.name}
                width={36}
                height={36}
                unoptimized
                className="h-9 w-9 shrink-0 rounded-full object-cover shadow-sm"
              />
            ) : (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: branding.primary }}
              >
                {branch.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-sm font-bold leading-tight"
                style={{ color: branding.text }}
              >
                {branch.name}
              </p>
              <div className="flex items-center gap-2 overflow-hidden">
                {branch.address && (
                  <span
                    className="flex items-center gap-0.5 truncate text-[11px]"
                    style={{ color: branding.text, opacity: 0.55 }}
                  >
                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                    {branch.address}
                  </span>
                )}
                {branch.phone && (
                  <a
                    href={`tel:${branch.phone}`}
                    className="flex shrink-0 items-center gap-0.5 text-[11px] hover:underline"
                    style={{ color: branding.primary }}
                  >
                    <Phone className="h-2.5 w-2.5" />
                    {branch.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 pb-40 pt-5">
        {/* Stepper */}
        {step !== 'confirmation' && (
          <div className="mb-6">
            <div className="flex items-center justify-between">
              {STEP_ORDER.filter(s => s !== 'confirmation').map((s, idx) => {
                const isCompleted = STEP_NUMBERS[s] < STEP_NUMBERS[step]
                const isCurrent = s === step
                return (
                  <div key={s} className="flex flex-1 items-center">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all',
                        )}
                        style={{
                          backgroundColor: isCompleted || isCurrent
                            ? branding.primary
                            : `${branding.primary}15`,
                          color: isCompleted || isCurrent
                            ? '#ffffff'
                            : `${branding.text}60`,
                        }}
                      >
                        {idx + 1}
                      </div>
                      <span
                        className="hidden text-[10px] font-medium sm:block"
                        style={{
                          color: isCurrent ? branding.primary : branding.text,
                          opacity: isCurrent ? 1 : 0.4,
                        }}
                      >
                        {STEP_LABELS[s]}
                      </span>
                    </div>
                    {idx < STEP_ORDER.filter(x => x !== 'confirmation').length - 1 && (
                      <div
                        className="mx-1 h-0.5 flex-1 rounded-full transition-all"
                        style={{
                          backgroundColor: isCompleted
                            ? branding.primary
                            : `${branding.primary}20`,
                        }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Título del step */}
        {step !== 'confirmation' && (
          <div className="mb-4">
            <h1 className="text-lg font-bold" style={{ color: branding.text }}>
              {step === 'services' && 'Elegí tu servicio'}
              {step === 'staff' && 'Elegí tu barbero'}
              {step === 'slot' && 'Elegí día y horario'}
              {step === 'contact' && 'Tus datos de contacto'}
            </h1>
            {step === 'services' && branding.welcome_message && (
              <p className="mt-1 text-sm" style={{ color: branding.text, opacity: 0.6 }}>
                {branding.welcome_message}
              </p>
            )}
          </div>
        )}

        {/* Mensaje de error global */}
        {error && (
          <div
            className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Contenido del step */}
        {step === 'services' && (
          <ServicesStep
            services={services}
            selected={selectedServiceIds}
            onToggle={toggleService}
            branding={branding}
          />
        )}

        {step === 'staff' && (
          <StaffStep
            staff={staff}
            selected={selectedStaffId}
            onSelect={id => { setSelectedStaffId(id); setSelectedTime(''); setSelectedSlotStaffId('') }}
            branding={branding}
          />
        )}

        {step === 'slot' && (
          <SlotStep
            branchId={branch.id}
            serviceId={selectedServiceIds[0] ?? ''}
            staffId={effectiveStaffForSlot}
            slotIntervalMinutes={settings.slot_interval_minutes}
            maxAdvanceDays={settings.max_advance_days}
            appointmentDays={settings.appointment_days}
            selectedDate={selectedDate}
            selectedTime={selectedTime}
            onDateChange={d => { setSelectedDate(d); setSelectedTime('') }}
            onSlotSelect={handleSlotSelect}
            branding={branding}
          />
        )}

        {step === 'contact' && (
          <ContactStep
            name={clientName}
            phone={clientPhone}
            accepted={policyAccepted}
            cancellationHours={settings.cancellation_min_hours}
            onChange={handleContactChange}
            branding={branding}
          />
        )}

        {step === 'confirmation' && bookingResult && (
          <ConfirmationStep
            appointmentId={bookingResult.appointment_id}
            cancellationToken={bookingResult.cancellation_token}
            branch={branch}
            service={primaryService}
            staff={staff.find(s => s.id === selectedSlotStaffId) ?? null}
            staffName={selectedSlotStaffName || 'Por asignar'}
            date={selectedDate!}
            time={selectedTime}
            clientName={clientName}
            clientPhone={clientPhone}
            branding={branding}
          />
        )}
      </div>

      {/* Footer sticky con resumen + botones */}
      {step !== 'confirmation' && (
        <div
          className="fixed bottom-0 left-0 right-0 z-20 border-t"
          style={{ backgroundColor: branding.bg, borderColor: 'rgba(0,0,0,0.08)' }}
        >
          <div className="mx-auto max-w-2xl px-4 py-3">
            {/* Resumen mini */}
            {selectedServiceIds.length > 0 && step !== 'services' && (
              <div
                className="mb-2.5 flex items-center gap-2 rounded-lg p-2.5 text-xs"
                style={{ backgroundColor: `${branding.primary}08` }}
              >
                <Scissors className="h-3 w-3 shrink-0" style={{ color: branding.primary }} />
                <span className="truncate font-medium" style={{ color: branding.text }}>
                  {services
                    .filter(s => selectedServiceIds.includes(s.id))
                    .map(s => s.name)
                    .join(', ')}
                </span>
                {primaryService && (
                  <span className="ml-auto shrink-0 font-bold" style={{ color: branding.primary }}>
                    {formatCurrency(
                      services
                        .filter(s => selectedServiceIds.includes(s.id))
                        .reduce((acc, s) => acc + s.price, 0)
                    )}
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {!isFirstStep && (
                <Button
                  variant="outline"
                  onClick={goBack}
                  disabled={isPending}
                  className="h-12 px-4"
                  aria-label="Volver al paso anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <Button
                className="h-12 flex-1 text-base font-bold"
                onClick={goNext}
                disabled={isPending || !canProceed()}
                style={{
                  backgroundColor: canProceed() && !isPending ? branding.primary : undefined,
                  color: canProceed() && !isPending ? '#ffffff' : undefined,
                  opacity: (!canProceed() || isPending) ? 0.5 : 1,
                }}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirmando…
                  </>
                ) : (
                  ctaLabel
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
