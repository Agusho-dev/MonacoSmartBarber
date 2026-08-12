'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { ChevronLeft, Loader2, MapPin, Phone, Scissors, ShieldCheck } from 'lucide-react'
import { publicBookAppointment } from '@/lib/actions/public-booking'
import { ServicesStep } from './wizard/services-step'
import { SlotStep, type SlotSelection } from './wizard/slot-step'
import { IdentifyStep, esTelefonoValido, type EstadoIdentidad, type Identidad } from './wizard/identify-step'
import { ConfirmationStep } from './wizard/confirmation-step'
import { StepProgress } from './wizard/step-progress'
import { Avatar } from './wizard/avatar'
import { buildTurneroTheme, themeVars } from './theme'
import { TurneroAmbient, TurneroStyles, ConfirmacionVerde, glassInteractive } from './glass'
import { diasDeVentana } from './ventana'
import { formatCurrency } from '@/lib/format'
import { toDateStr } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import type {
  PublicService,
  PublicStaff,
  PublicWalkInStaff,
} from '@/lib/actions/public-booking'

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

interface Prefill {
  name: string
  phone: string
  /** true = el turnero corre dentro del WebView de la app mobile. */
  embedded: boolean
}

interface Props {
  branch: Branch
  services: PublicService[]
  staff: PublicStaff[]
  walkInStaff: PublicWalkInStaff[]
  settings: Settings
  branding: Branding
  prefill?: Prefill
}

/**
 * Avisa a la app mobile que la reserva se confirmó.
 *
 * El wizard es una SPA: al confirmar no navega, sólo cambia de step, así que
 * el WebView no tenía forma de enterarse. Se emiten dos señales redundantes —
 * el canal JS que inyecta la app y un cambio de query que el WebView polea.
 */
function notificarAppMobile(appointmentId: string) {
  if (typeof window === 'undefined') return

  try {
    const bridge = (window as unknown as {
      BookingBridge?: { postMessage: (msg: string) => void }
    }).BookingBridge
    bridge?.postMessage(JSON.stringify({ type: 'booking_confirmed', id: appointmentId }))
  } catch {
    // Fuera del WebView el canal no existe: no es un error.
  }

  try {
    const url = new URL(window.location.href)
    url.searchParams.set('booking', 'success')
    // El primer argumento va con el state ACTUAL, no `null`: ahí vive el paso
    // del wizard que usa el botón físico de atrás del celular. Pisarlo con null
    // dejaba la última entrada del historial sin marca y el gesto de volver se
    // salía del turnero en vez de retroceder de paso.
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // No-op
  }
}

// ─── Steps del wizard ────────────────────────────────────────────────

/**
 * El teléfono va PRIMERO.
 *
 * Antes el orden era servicio → horario → datos, y el nombre y el teléfono se
 * pedían al final, cuando el cliente ya había hecho todo el trabajo. Poniendo
 * la identificación adelante pasan tres cosas: el que ya vino no vuelve a
 * tipear su nombre (lo autocompleta el teléfono), el turnero puede tratarlo por
 * su nombre desde la primera pantalla, y los rechazos que dependen de QUIÉN es
 * —"ya tenés un turno ese día"— aparecen antes de elegir nada en vez de
 * después de elegirlo todo.
 *
 * El barbero sigue sin ser un paso: la agenda real es de un barbero por día, y
 * quien quiera elegir tiene el botón "Elegir barbero" adentro del paso de
 * horario.
 */
type WizardStep = 'identify' | 'services' | 'slot' | 'confirmation'

const STEP_ORDER: WizardStep[] = ['identify', 'services', 'slot']
const STEP_LABELS: Record<WizardStep, string> = {
  identify: 'Tus datos',
  services: 'Servicio',
  slot: 'Día y horario',
  confirmation: 'Confirmación',
}
const STEP_TITLES: Record<WizardStep, string> = {
  identify: '¿Quién sos?',
  services: '¿Qué te hacés?',
  slot: '¿Cuándo te viene bien?',
  confirmation: '',
}

/** Marca que el wizard deja en cada entrada del historial del navegador. */
interface EstadoHistorial {
  turneroStep?: number
}

// ─── Helpers ─────────────────────────────────────────────────────────

function mapErrorCode(code: string): string {
  const map: Record<string, string> = {
    INVALID_NAME: 'El nombre debe tener al menos 2 caracteres.',
    INVALID_PHONE: 'Ingresá un número de teléfono válido.',
    PHONE_QUOTA_EXCEEDED: 'Ya tenés varios turnos reservados. Si necesitás ayuda, comunicate con la sucursal.',
    SLOT_TAKEN: 'Ese horario ya fue tomado por alguien más. Elegí otro.',
    TOO_LATE: 'El horario seleccionado ya no está disponible. Elegí otro.',
    ALREADY_BOOKED_TODAY: 'Ya tenés un turno reservado para ese día. Si querés cambiarlo, gestionalo desde el link que te enviamos.',
    NOT_FOUND_OR_NOT_CANCELLABLE: 'No se pudo cancelar el turno.',
  }
  return map[code] ?? code
}

/** Separa el prefill de la app mobile en nombre y apellido. */
function partirNombre(completo: string): { firstName: string; lastName: string } {
  const partes = completo.trim().split(/\s+/).filter(Boolean)
  return { firstName: partes[0] ?? '', lastName: partes.slice(1).join(' ') }
}

// ─── Componente principal ────────────────────────────────────────────

export function BookingWizard({
  branch,
  services,
  staff,
  walkInStaff,
  settings,
  branding,
  prefill,
}: Props) {
  // Prefill desde la app mobile: el cliente ya se identificó ahí, así que se
  // arranca directo en el servicio. Re-pedirle el teléfono adentro de su propia
  // app es preguntarle algo que la app ya sabe.
  const prefillListo = !!prefill?.phone && esTelefonoValido(prefill.phone) && prefill.name.trim().length >= 2

  const [step, setStep] = useState<WizardStep>(prefillListo ? 'services' : 'identify')
  /** Dirección de la última navegación: decide de qué lado entra el contenido. */
  const [direccion, setDireccion] = useState<'adelante' | 'atras'>('adelante')

  const [identidad, setIdentidad] = useState<Identidad>(() => ({
    phone: prefill?.phone ?? '',
    ...partirNombre(prefill?.name ?? ''),
  }))
  const [estadoIdentidad, setEstadoIdentidad] = useState<EstadoIdentidad>('vacio')
  const [turnoExistente, setTurnoExistente] = useState<{ date: string; time: string } | null>(null)

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined)
  const [selectedSlot, setSelectedSlot] = useState<SlotSelection | null>(null)
  const [policyAccepted, setPolicyAccepted] = useState(false)
  // Bumpear esta key fuerza a SlotStep a re-pedir la disponibilidad.
  const [slotRefreshKey, setSlotRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [appointmentToken, setAppointmentToken] = useState('')
  /** Velo verde de "confirmado". Se apaga solo cuando termina su animación. */
  const [mostrandoVerde, setMostrandoVerde] = useState(false)
  /**
   * Cómo tiene que registrar su llegada en la tablet, según lo que el servidor
   * ya sabe de este teléfono. Sale de la reserva, no se adivina en el cliente.
   */
  const [llegada, setLlegada] = useState({ tieneCara: false, esNuevo: true })

  const theme = useMemo(
    () => buildTurneroTheme({ bg: branding.bg, primary: branding.primary, text: branding.text }),
    [branding.bg, branding.primary, branding.text]
  )

  const currentStepIndex = STEP_ORDER.indexOf(step)
  const isFirstStep = currentStepIndex <= 0
  const isLastContentStep = step === 'slot'

  const clientName = [identidad.firstName, identidad.lastName]
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')

  const selectedServices = useMemo(
    () =>
      selectedServiceIds
        .map(id => services.find(s => s.id === id))
        .filter((s): s is PublicService => !!s),
    [selectedServiceIds, services]
  )

  const totalPrice = selectedServices.reduce((acc, s) => acc + s.price, 0)
  const totalDuration = selectedServices.reduce(
    (acc, s) => acc + (s.duration_minutes ?? settings.slot_interval_minutes),
    0
  )

  /**
   * Días que se pueden reservar de verdad: los configurados para la sucursal
   * que además tengan al menos un barbero con horario cargado. Ofrecer un
   * miércoles donde no atiende nadie sólo lleva a "no hay turnos disponibles".
   */
  const enabledDays = useMemo(() => {
    const trabajados = new Set(staff.flatMap(s => s.days))
    const cruce = settings.appointment_days.filter(d => trabajados.has(d))
    // Sin cruce (config incompleta) preferimos mostrar los días configurados
    // antes que una tira entera deshabilitada.
    return cruce.length ? cruce : settings.appointment_days
  }, [staff, settings.appointment_days])

  function primerDiaHabilitado(): Date | undefined {
    // Misma ventana que la tira: si el motor no acepta el último día, tampoco
    // hay que preseleccionarlo (ver `ventana.ts`).
    return diasDeVentana(settings.max_advance_days).find(d =>
      enabledDays.includes(d.getDay())
    )
  }

  // ─── Botón físico de atrás ──────────────────────────────────────
  //
  // Es la queja número uno de cualquier wizard en celular: el gesto de volver
  // del teléfono se sale del sitio entero en vez de retroceder un paso, y el
  // cliente pierde todo lo que había cargado. Se resuelve empujando una entrada
  // de historial por paso y escuchando `popstate`.

  const pasoRef = useRef<WizardStep>(step)
  const confirmadoRef = useRef(false)

  useEffect(() => {
    pasoRef.current = step
  }, [step])

  useEffect(() => {
    try {
      const previo = (window.history.state ?? {}) as EstadoHistorial
      window.history.replaceState({ ...previo, turneroStep: STEP_ORDER.indexOf(step) }, '')
    } catch {
      // Historial bloqueado (algún WebView viejo): el wizard sigue andando con
      // los botones de la pantalla, sólo se pierde el gesto del sistema.
    }

    function alVolver(ev: PopStateEvent) {
      // Con el turno YA reservado no se retrocede: el paso anterior editaría
      // datos de algo que ya existe en la base. Las entradas que quedan se
      // consumen sin efecto y a los pocos toques el cliente sale del sitio,
      // que es lo que corresponde después de confirmar.
      if (confirmadoRef.current) return

      const destino = (ev.state as EstadoHistorial | null)?.turneroStep
      const actual = STEP_ORDER.indexOf(pasoRef.current)
      if (typeof destino !== 'number' || actual < 0) return
      // Sólo hacia atrás: avanzar desde el historial saltearía las validaciones
      // de cada paso y podría dejar el wizard en un estado incompleto.
      if (destino >= actual) return

      setError('')
      setDireccion('atras')
      setStep(STEP_ORDER[destino])
    }

    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
    // Sólo al montar: `step` se lee para sellar la entrada inicial (que con
    // prefill no es la 0) y después el listener trabaja contra `pasoRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cada paso empieza arriba. Sin esto, pasar de una grilla de horarios larga a
  // la confirmación dejaba al cliente mirando la mitad de la pantalla.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // ─── Navegación ─────────────────────────────────────────────────

  function avanzarA(next: WizardStep) {
    setError('')
    setDireccion('adelante')
    setStep(next)

    const idx = STEP_ORDER.indexOf(next)
    if (idx > 0) {
      try {
        window.history.pushState({ turneroStep: idx } satisfies EstadoHistorial, '')
      } catch {
        // Ver arriba: sin historial el wizard igual funciona.
      }
    }
  }

  /**
   * Un solo camino hacia atrás para el botón de la pantalla y el del sistema:
   * se le pide al navegador que retroceda y el `popstate` hace el cambio de
   * paso. Si el estado del historial no es el nuestro (WebView que no lo
   * soporta), se retrocede a mano.
   */
  function retroceder() {
    const actual = STEP_ORDER.indexOf(pasoRef.current)
    if (actual <= 0) return

    const marca = (window.history.state as EstadoHistorial | null)?.turneroStep
    if (marca === actual) {
      window.history.back()
      return
    }

    setError('')
    setDireccion('atras')
    setStep(STEP_ORDER[actual - 1])
  }

  function goNext() {
    setError('')

    if (step === 'identify') {
      if (!esTelefonoValido(identidad.phone)) {
        setError('Ingresá un número de teléfono válido.')
        return
      }
      if (clientName.length < 2) {
        setError('Ingresá tu nombre para continuar.')
        return
      }
      avanzarA('services')
      return
    }

    if (step === 'services') {
      if (selectedServiceIds.length === 0) {
        setError('Seleccioná al menos un servicio para continuar.')
        return
      }
      // Entrar al paso con un día ya elegido: la grilla se ve de una, sin el
      // "seleccioná un día" que antes obligaba a un click extra.
      if (!selectedDate) setSelectedDate(primerDiaHabilitado())
      avanzarA('slot')
      return
    }

    if (step === 'slot') {
      if (!selectedDate || !selectedSlot) {
        setError('Elegí un horario para continuar.')
        return
      }
      if (!policyAccepted) {
        setError('Aceptá la política de cancelación para confirmar.')
        return
      }

      startTransition(async () => {
        if (!selectedDate || !selectedSlot) {
          setError('Falta fecha u horario. Volvé al paso anterior.')
          return
        }

        const result = await publicBookAppointment({
          branch_slug: branch.slug,
          branch_id: branch.id,
          client_phone: identidad.phone,
          client_name: clientName,
          // El barbero sale del slot elegido: el motor devuelve un grupo por
          // barbero, así que la hora ya viene con dueño.
          staff_id: selectedSlot.staffId,
          starts_at: toDateStr(selectedDate),
          start_time: selectedSlot.time,
          service_ids: selectedServiceIds,
          duration_minutes: totalDuration,
        })

        if ('error' in result) {
          setError(mapErrorCode(result.error))
          // Si el hueco se ocupó mientras completaba sus datos, el cartel de
          // error quedaba arriba de todo, fuera de pantalla, con la grilla
          // vieja intacta: el cliente reintentaba el mismo horario en loop.
          // Lo devolvemos a la grilla recargada.
          if (result.error === 'SLOT_TAKEN' || result.error === 'TOO_LATE') {
            setSelectedSlot(null)
            setSlotRefreshKey(k => k + 1)
          }
          return
        }

        setAppointmentToken(result.data.cancellation_token)
        setLlegada({
          tieneCara: result.data.client_has_face,
          esNuevo: result.data.client_is_new,
        })
        confirmadoRef.current = true
        setDireccion('adelante')
        setMostrandoVerde(true)
        setStep('confirmation')
        notificarAppMobile(result.data.appointment_id)
      })
    }
  }

  // ─── Handlers ───────────────────────────────────────────────────

  function toggleService(id: string) {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    // La duración total cambia y con ella la grilla: cualquier hora ya elegida
    // deja de ser válida.
    setSelectedSlot(null)
    setError('')
  }

  function cambiarIdentidad(v: Identidad) {
    setIdentidad(v)
    setError('')
  }

  function canProceed(): boolean {
    if (step === 'identify') {
      return esTelefonoValido(identidad.phone) && clientName.length >= 2
    }
    if (step === 'services') return selectedServiceIds.length > 0
    if (step === 'slot') return !!selectedDate && !!selectedSlot && policyAccepted
    return false
  }

  const habilitado = canProceed() && !isPending
  const ctaLabel = isLastContentStep ? 'Confirmar turno' : 'Continuar'
  const mostrarAtras = !isFirstStep && step !== 'confirmation'
  const horasCancelacion = `${settings.cancellation_min_hours} ${
    settings.cancellation_min_hours === 1 ? 'hora' : 'horas'
  }`

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div
      // La hoja de barberos se portalea acá adentro: es el elemento que publica
      // los tokens `--t-*` y, al ser `relative` SIN z-index, no abre un contexto
      // de apilamiento que le encierre el z-index (ver `barber-sheet.tsx`).
      data-turnero-root
      className="relative min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]"
      style={themeVars(theme)}
    >
      <TurneroStyles />
      <TurneroAmbient />

      {mostrandoVerde && <ConfirmacionVerde onDone={() => setMostrandoVerde(false)} />}

      {/* Header sticky con nombre + dirección + tel */}
      <header className="sticky top-0 z-30 border-b border-[var(--t-glass-border)] bg-[var(--t-chrome-bg)] backdrop-blur-xl">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Segunda salida hacia atrás, arriba de todo: en un celular el
                pulgar vive abajo, pero cuando el teclado del paso de datos tapa
                el footer esta es la única que queda a la vista. */}
            {mostrarAtras && (
              <button
                type="button"
                onClick={retroceder}
                disabled={isPending}
                className={cn(
                  glassInteractive,
                  'flex h-10 shrink-0 items-center gap-1 rounded-xl pl-1.5 pr-3 text-[13px] font-bold text-[var(--t-text)] disabled:opacity-50'
                )}
              >
                <ChevronLeft className="h-4 w-4" />
                Atrás
              </button>
            )}

            {branding.logo_url ? (
              <Image
                src={branding.logo_url}
                alt={branch.name}
                width={40}
                height={40}
                unoptimized
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                style={{ backgroundColor: 'var(--t-primary)', color: 'var(--t-on-primary)' }}
              >
                {branch.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight text-[var(--t-text)]">
                {branch.name}
              </p>
              <div className="flex items-center gap-2.5 overflow-hidden">
                {branch.address && (
                  <span className="flex items-center gap-1 truncate text-[11px] text-[var(--t-text-muted)]">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {branch.address}
                  </span>
                )}
                {branch.phone && (
                  <a
                    href={`tel:${branch.phone}`}
                    className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--t-accent)] hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {branch.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-4 pb-52 pt-5">
        {step !== 'confirmation' && (
          <StepProgress
            current={currentStepIndex + 1}
            total={STEP_ORDER.length}
            label={STEP_LABELS[step]}
          />
        )}

        {/* La key remonta el bloque en cada paso: es lo que dispara la
            animación de entrada. La barra de progreso queda AFUERA para que se
            llene con una transición continua en vez de reaparecer. */}
        <div
          key={step}
          className={cn('t-step', direccion === 'atras' && 't-step-back')}
        >
          {step !== 'confirmation' && (
            <div className="mb-5 mt-5">
              <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--t-text)]">
                {STEP_TITLES[step]}
              </h1>
              {step === 'identify' && (
                <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
                  Con tu número alcanza. Si ya viniste, completamos el resto nosotros.
                </p>
              )}
              {step === 'services' && branding.welcome_message && (
                <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
                  {branding.welcome_message}
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              className="mb-4 rounded-2xl p-3.5 text-sm font-medium"
              style={{ backgroundColor: 'var(--t-danger-bg)', color: 'var(--t-danger-text)' }}
              role="alert"
            >
              {error}
            </div>
          )}

          {step === 'identify' && (
            <IdentifyStep
              branchId={branch.id}
              valor={identidad}
              estado={estadoIdentidad}
              turnoExistente={turnoExistente}
              onCambio={cambiarIdentidad}
              onEstado={setEstadoIdentidad}
              onTurnoExistente={setTurnoExistente}
            />
          )}

          {step === 'services' && (
            <ServicesStep
              services={services}
              selected={selectedServiceIds}
              onToggle={toggleService}
            />
          )}

          {step === 'slot' && (
            <SlotStep
              key={slotRefreshKey}
              branchId={branch.id}
              serviceIds={selectedServiceIds}
              staff={staff}
              walkInStaff={walkInStaff}
              maxAdvanceDays={settings.max_advance_days}
              enabledDays={enabledDays}
              selectedDate={selectedDate}
              selectedTime={selectedSlot?.time ?? ''}
              selectedStaffId={selectedSlot?.staffId ?? ''}
              onDateChange={d => { setSelectedDate(d); setSelectedSlot(null) }}
              onSlotSelect={slot => { setSelectedSlot(slot); setError('') }}
              onClearSlot={() => setSelectedSlot(null)}
            />
          )}

          {step === 'confirmation' && (
            <ConfirmationStep
              cancellationToken={appointmentToken}
              branch={branch}
              services={selectedServices}
              totalPrice={totalPrice}
              durationMinutes={totalDuration}
              staffName={selectedSlot?.staffName ?? 'Por asignar'}
              staffAvatarUrl={selectedSlot?.staffAvatarUrl ?? null}
              date={selectedDate!}
              time={selectedSlot?.time ?? ''}
              clientName={clientName}
              clientPhone={identidad.phone}
              clienteTieneCara={llegada.tieneCara}
              clienteEsNuevo={llegada.esNuevo}
            />
          )}
        </div>
      </div>

      {/* Footer sticky con resumen + acciones */}
      {step !== 'confirmation' && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--t-glass-border)] bg-[var(--t-chrome-bg)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-2xl px-4 py-3">
            {selectedServices.length > 0 && step !== 'services' && (
              <div className="t-glass mb-2.5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs">
                {selectedSlot ? (
                  <Avatar
                    url={selectedSlot.staffAvatarUrl}
                    name={selectedSlot.staffName}
                    size={22}
                  />
                ) : (
                  <Scissors className="h-4 w-4 shrink-0 text-[var(--t-text-muted)]" />
                )}
                <span className="min-w-0 flex-1 truncate font-semibold text-[var(--t-text)]">
                  {selectedServices.map(s => s.name).join(' + ')}
                  {selectedSlot && (
                    <span className="font-normal text-[var(--t-text-muted)]">
                      {' · '}
                      {selectedSlot.time} con {selectedSlot.staffName}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-bold text-[var(--t-accent)]">
                  {formatCurrency(totalPrice)}
                </span>
              </div>
            )}

            {/* La política se acepta ACÁ, pegada al botón que confirma, y no en
                un paso propio: es el único momento en que el cliente está
                decidiendo comprometerse con un horario. Aparece recién con la
                hora elegida para no ocupar el pie durante todo el flujo. */}
            {step === 'slot' && selectedSlot && (
              <label
                htmlFor="cancel-policy"
                className={cn(
                  glassInteractive,
                  't-rise mb-2.5 flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5'
                )}
              >
                <input
                  id="cancel-policy"
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={e => { setPolicyAccepted(e.target.checked); setError('') }}
                  className="peer sr-only"
                />
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-[background-color,border-color] duration-200"
                  style={{
                    borderColor: policyAccepted ? 'var(--t-primary)' : 'var(--t-text-faint)',
                    backgroundColor: policyAccepted ? 'var(--t-primary)' : 'transparent',
                    color: 'var(--t-on-primary)',
                  }}
                  aria-hidden
                >
                  {policyAccepted && <ShieldCheck className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-snug text-[var(--t-text-muted)]">
                  Entiendo que puedo cancelar hasta{' '}
                  <strong className="font-bold text-[var(--t-text)]">
                    {horasCancelacion} antes
                  </strong>{' '}
                  del turno. Te mandamos el link por WhatsApp.
                </span>
              </label>
            )}

            <div className="flex gap-2.5">
              {/* Antes era un chevron pelado de 14×14 sin etiqueta, del mismo
                  gris que el fondo de marca: el dueño miró la pantalla y no lo
                  encontró. Ahora es un botón de vidrio con borde y la palabra
                  "Atrás". */}
              {mostrarAtras && (
                <button
                  type="button"
                  onClick={retroceder}
                  disabled={isPending}
                  className={cn(
                    glassInteractive,
                    'flex h-14 shrink-0 items-center gap-1.5 rounded-xl pl-3 pr-4 text-[15px] font-bold text-[var(--t-text)] disabled:opacity-50'
                  )}
                >
                  <ChevronLeft className="h-5 w-5" />
                  Atrás
                </button>
              )}
              <button
                type="button"
                className={cn(
                  'flex h-14 flex-1 items-center justify-center gap-2 rounded-xl text-base font-bold',
                  'transition-[background-color,color,box-shadow,transform] duration-200',
                  'active:scale-[0.99] disabled:cursor-not-allowed',
                  habilitado && 't-sheen'
                )}
                onClick={goNext}
                disabled={!habilitado}
                style={{
                  backgroundColor: habilitado ? 'var(--t-cta)' : 'var(--t-glass-bg)',
                  color: habilitado ? 'var(--t-on-cta)' : 'var(--t-text-faint)',
                  // El borde no es decorativo: con una marca oscura sobre un
                  // fondo oscuro es lo que le da silueta al botón. Ver `cta` en
                  // `theme.ts`.
                  boxShadow: habilitado
                    ? 'inset 0 0 0 1px var(--t-cta-border), 0 10px 30px -12px var(--t-ring), var(--t-glass-shadow)'
                    : 'inset 0 0 0 1px var(--t-glass-border)',
                }}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Confirmando…
                  </>
                ) : (
                  ctaLabel
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
