'use client'

import { useState, useMemo, useTransition } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ClientStep } from './wizard/client-step'
import { ServicesStep } from './wizard/services-step'
import { SlotStep } from './wizard/slot-step'
import { bookAppointment } from '@/lib/actions/turnos'
import type { TurnosClientResult, TurnosService, TurnosStaff } from '@/lib/actions/turnos'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  branchId: string
  services: TurnosService[]
  staff: TurnosStaff[]
  /** Pre-cargar fecha y hora al hacer click en un hueco del grid */
  defaultDate?: string | null
  defaultTime?: string | null
  onBooked?: () => void
}

type Step = 0 | 1 | 2

const STEP_LABELS = ['Cliente', 'Servicios', 'Horario']

export function NewAppointmentDialog({
  open,
  onOpenChange,
  branchId,
  services,
  staff,
  defaultDate,
  defaultTime,
  onBooked,
}: Props) {
  const [step, setStep] = useState<Step>(0)

  // Step 0 — cliente
  const [selectedClient, setSelectedClient] = useState<TurnosClientResult | null>(null)

  // Step 1 — servicios + barbero
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)

  // Step 2 — slot
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultDate ?? null)
  const [selectedTime, setSelectedTime] = useState<string | null>(defaultTime ?? null)

  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState('')

  const totalDuration = useMemo(() => {
    return services
      .filter((s) => selectedServiceIds.includes(s.id))
      .reduce((acc, s) => acc + s.duration_minutes, 0)
  }, [services, selectedServiceIds])

  function handleClose() {
    onOpenChange(false)
    // Reset con timeout para evitar flash al animar el cierre
    setTimeout(() => {
      setStep(0)
      setSelectedClient(null)
      setSelectedServiceIds([])
      setSelectedStaffId(null)
      setSelectedDate(defaultDate ?? null)
      setSelectedTime(defaultTime ?? null)
      setSubmitError('')
    }, 200)
  }

  function canAdvance(): boolean {
    if (step === 0) return selectedClient !== null
    if (step === 1) return selectedServiceIds.length > 0
    if (step === 2) return selectedDate !== null && selectedTime !== null
    return false
  }

  function handleNext() {
    if (step < 2) setStep((s) => (s + 1) as Step)
    else handleSubmit()
  }

  function handleSubmit() {
    if (!selectedClient || !selectedDate || !selectedTime || selectedServiceIds.length === 0) return
    setSubmitError('')
    startTransition(async () => {
      const res = await bookAppointment({
        branchId,
        clientId: selectedClient.id,
        serviceIds: selectedServiceIds,
        staffId: selectedStaffId,
        startsAt: `${selectedDate}T${selectedTime}:00`,
        startTime: selectedTime,
        appointmentDate: selectedDate,
        totalDurationMinutes: totalDuration,
      })
      if ('error' in res) {
        setSubmitError(res.error)
        toast.error(res.error)
        return
      }
      toast.success('Turno creado correctamente')
      onBooked?.()
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5" />
            Nuevo turno
          </DialogTitle>
          <DialogDescription className="sr-only">
            Creá un nuevo turno en 3 pasos: elegí el cliente, los servicios y el horario.
          </DialogDescription>
        </DialogHeader>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-1" aria-label="Pasos del wizard">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => i < step && setStep(i as Step)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                  i === step && 'border-primary bg-primary text-primary-foreground',
                  i < step && 'border-green-500 bg-green-500 text-white cursor-pointer',
                  i > step && 'border-muted-foreground/30 text-muted-foreground'
                )}
                aria-current={i === step ? 'step' : undefined}
                disabled={i >= step}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </button>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  i === step ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Contenido del step activo */}
        <div className="min-h-[200px]">
          {step === 0 && (
            <ClientStep
              selectedClient={selectedClient}
              onSelect={(c) => {
                setSelectedClient(c)
              }}
            />
          )}
          {step === 1 && (
            <ServicesStep
              services={services}
              staff={staff}
              selectedServiceIds={selectedServiceIds}
              selectedStaffId={selectedStaffId}
              onServicesChange={setSelectedServiceIds}
              onStaffChange={setSelectedStaffId}
            />
          )}
          {step === 2 && (
            <SlotStep
              branchId={branchId}
              totalDurationMinutes={totalDuration}
              staffId={selectedStaffId}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onSelect={(date, time) => {
                setSelectedDate(date)
                setSelectedTime(time)
              }}
            />
          )}
        </div>

        {submitError && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {submitError}
          </p>
        )}

        {/* Botones de navegación */}
        <div className="flex items-center justify-between border-t pt-3">
          <Button
            variant="outline"
            onClick={() => step > 0 ? setStep((s) => (s - 1) as Step) : handleClose()}
          >
            {step > 0 ? (
              <>
                <ChevronLeft className="mr-1.5 size-4" />
                Atrás
              </>
            ) : (
              'Cancelar'
            )}
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canAdvance() || isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : step < 2 ? (
              <>
                Continuar
                <ChevronRight className="ml-1.5 size-4" />
              </>
            ) : (
              <>
                <Check className="mr-2 size-4" />
                Confirmar turno
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
