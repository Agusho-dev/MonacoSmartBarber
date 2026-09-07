'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Image from 'next/image'
import { ChevronLeft, Loader2, MapPin, Phone, Scissors, ShieldCheck, Wallet } from 'lucide-react'
import { publicBookAppointment, publicPrepararSena } from '@/lib/actions/public-booking'
import { ServicesStep } from './wizard/services-step'
import { SlotStep, type SlotSelection } from './wizard/slot-step'
import { IdentifyStep, esTelefonoValido, type EstadoIdentidad, type Identidad } from './wizard/identify-step'
import { ConfirmationStep } from './wizard/confirmation-step'
import { DepositStep } from './wizard/deposit-step'
import { StepProgress } from './wizard/step-progress'
import { Avatar } from './wizard/avatar'
import { PieLegal } from './pie-legal'
import { buildTurneroTheme, themeVars } from './theme'
import { TurneroAmbient, TurneroStyles, ConfirmacionVerde, glassInteractive } from './glass'
import { diasDeVentana } from './ventana'
import { calcularSena } from '@/lib/senas/contrato'
import { construirPolitica } from '@/lib/senas/politica'
import { formatCurrency } from '@/lib/format'
import { toDateStr } from '@/lib/time-utils'
import { cn } from '@/lib/utils'
import type { BranchDepositSettings } from '@/lib/senas/contrato'
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
  /**
   * Config de la seña de ESTA sucursal, o null si no tiene fila.
   *
   * Viaja entera al browser a propósito: `calcularSena` es pura y la comparten
   * el servidor que cobra y esta pantalla que muestra el monto, así que el
   * número se puede pintar sin esperar un round-trip y sin riesgo de divergir.
   * Al confirmar, el servidor lo vuelve a calcular y su resultado es el que
   * manda (ver `senaServidor` más abajo).
   */
  deposito: BranchDepositSettings | null
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
type WizardStep = 'identify' | 'services' | 'slot' | 'sena' | 'confirmation'

/** Los pasos sin seña. El paso `sena` se agrega sólo cuando corresponde cobrarla. */
const PASOS_BASE: WizardStep[] = ['identify', 'services', 'slot']

const STEP_LABELS: Record<WizardStep, string> = {
  identify: 'Tus datos',
  services: 'Servicio',
  slot: 'Día y horario',
  sena: 'Seña',
  confirmation: 'Confirmación',
}
const STEP_TITLES: Record<WizardStep, string> = {
  identify: '¿Quién sos?',
  services: '¿Qué te hacés?',
  slot: '¿Cuándo te viene bien?',
  sena: 'Confirmá y pagá la seña',
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

/**
 * Los dos rechazos de la seña que necesitan un texto propio.
 *
 * El mensaje del servidor es correcto pero está escrito para cualquier canal;
 * leído acá, debajo de un botón que dice "Pagar seña $8.000", no le dice a
 * nadie qué hacer. Los dos casos se resuelven recargando —la config y la cuenta
 * de Mercado Pago se leen en el servidor al pintar la página, así que una
 * recarga devuelve el wizard normal de tres pasos y el turno se puede reservar
 * igual, sin pagar.
 */
function mensajeDeSena(code: string, message: string): string {
  if (code === 'SENA_NO_APLICA') {
    return 'Esta sucursal dejó de pedir seña mientras reservabas. Recargá la página y confirmá el turno sin pagar nada.'
  }
  if (code === 'MP_NO_CONECTADO') {
    return 'No podemos cobrar la seña en este momento. Recargá la página para reservar sin seña, o comunicate con la sucursal.'
  }
  return message
}

/**
 * El aviso de la seña, en una línea.
 *
 * Anuncia el PORCENTAJE y no el monto a propósito: el monto exacto —con su
 * moneda— lo escribe el servidor en `politica.titulo` y se lee en el paso de la
 * seña. Así el mismo texto sirve en el pie del turnero y en el de la app, que
 * no puede calcular la seña sin reimplementar `calcularSena` (dos fórmulas para
 * la misma plata terminan diciendo números distintos).
 *
 * Si cambia esta redacción, hay que cambiarla también en
 * `Monaco-mobile/lib/features/appointments/presentation/widgets/wizard_footer.dart`.
 */
function textoAvisoSena(porcentaje: number): string {
  return porcentaje >= 100
    ? 'Este turno se reserva pagando el total por adelantado, online.'
    : `Este turno se reserva con una seña del ${porcentaje}%; el resto lo pagás en el local.`
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
  deposito,
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
  /** Aceptación de la seña. Es un consentimiento distinto y por eso es otra casilla. */
  const [senaAceptada, setSenaAceptada] = useState(false)
  /**
   * El monto que devolvió el servidor cuando NO coincide con el que se venía
   * mostrando (la sucursal cambió el porcentaje o el precio del servicio entre
   * que se abrió la página y se tocó el botón).
   *
   * No se redirige a Mercado Pago con un número distinto del que el cliente
   * leyó y aceptó: se repinta la pantalla con el monto real y hace falta un
   * segundo toque. Guardarlo es además lo que evita el bucle — sin esto, el
   * reintento volvería a compararse contra el cálculo viejo y nunca saldría.
   */
  const [montoServidor, setMontoServidor] = useState<number | null>(null)
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

  // ─── La seña ────────────────────────────────────────────────────
  //
  // `calcularSena` es la MISMA función que usa el servidor para cobrar. No hay
  // una fórmula "de la UI": si la hubiera, tarde o temprano el botón diría un
  // número y Mercado Pago cobraría otro.

  const sena = useMemo(
    () => calcularSena(totalPrice, deposito, 'web', deposito?.channels ?? ['app', 'web']),
    [totalPrice, deposito]
  )
  const senaAplica = sena.aplica

  /** Lo que se muestra: el cálculo local, salvo que el servidor haya dicho otra cosa. */
  const senaMostrada = useMemo(() => {
    if (montoServidor == null) return sena
    return { ...sena, sena: montoServidor, resto: Math.max(0, sena.total - montoServidor) }
  }, [sena, montoServidor])

  const politica = useMemo(() => {
    if (!deposito || !senaAplica) return null
    return construirPolitica(deposito, senaMostrada, {
      servicios: selectedServices.map(s => s.name).join(' + '),
      sucursal: branch.name,
      horasParaCancelar: settings.cancellation_min_hours,
    })
  }, [deposito, senaAplica, senaMostrada, selectedServices, branch.name, settings.cancellation_min_hours])

  /**
   * ¿Esta sucursal cobra seña por la web? Se sabe ANTES de elegir un servicio:
   * es config de la sucursal, no del carrito. Por eso el aviso del pie puede
   * aparecer desde el primer paso, cuando el cliente todavía no invirtió nada.
   */
  const senaConfigurada =
    !!deposito?.is_enabled && (deposito.channels ?? ['app', 'web']).includes('web')

  /**
   * La línea que anuncia la seña en el pie, desde el paso 1.
   *
   * Antes la seña recién aparecía en el paso 4: el cliente se identificaba,
   * elegía servicio y horario, y ahí se enteraba de que tenía que pagar la
   * mitad por adelantado. El que no puede o no quiere hacía todo el trabajo al
   * pedo, y eso se lee como una trampa. Con el aviso arriba del precio, la
   * decisión de seguir la toma sabiendo.
   *
   * Sin servicio elegido todavía no hay monto, así que se anuncia el
   * porcentaje; con el servicio elegido, el número exacto —el mismo que
   * calcula el servidor—. Si el total no llega al mínimo de la sucursal, esta
   * reserva NO lleva seña y la línea no se muestra: anunciar un cobro que no
   * va a existir es el mismo problema al revés.
   */
  const avisoSena = useMemo(() => {
    if (!senaConfigurada || !deposito) return null
    // Con un servicio ya elegido sabemos si esta reserva lleva seña de verdad:
    // por debajo del mínimo de la sucursal no lleva, y anunciar un cobro que no
    // va a existir es el mismo problema al revés.
    if (selectedServices.length > 0 && !senaAplica) return null

    const pct = Math.min(100, Math.max(1, Math.round(deposito.percentage || 50)))
    return textoAvisoSena(pct)
  }, [senaConfigurada, deposito, selectedServices.length, senaAplica])

  /**
   * El paso de la seña sólo existe cuando hay algo que cobrar. Una sucursal sin
   * seña —o un servicio por debajo del mínimo— ve el wizard de tres pasos de
   * siempre, sin una pantalla intermedia que no aporta nada.
   */
  const pasos = useMemo<WizardStep[]>(
    () => (senaAplica ? [...PASOS_BASE, 'sena'] : PASOS_BASE),
    [senaAplica]
  )

  const currentStepIndex = pasos.indexOf(step)
  const isFirstStep = currentStepIndex <= 0
  const isLastContentStep = step === pasos[pasos.length - 1]

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
  /**
   * La lista de pasos VIGENTE, para el listener de `popstate`.
   *
   * El listener se registra una sola vez (al montar) y por eso no puede leer
   * `pasos` de la clausura: la lista cambia de largo cuando el cliente elige un
   * servicio que dispara la seña, o cuando lo deselecciona. Con la lista vieja
   * congelada, el gesto de volver del teléfono apuntaría a un índice que ya no
   * existe.
   */
  const pasosRef = useRef<WizardStep[]>(pasos)

  useEffect(() => {
    pasoRef.current = step
  }, [step])

  useEffect(() => {
    pasosRef.current = pasos
  }, [pasos])

  useEffect(() => {
    try {
      const previo = (window.history.state ?? {}) as EstadoHistorial
      window.history.replaceState({ ...previo, turneroStep: pasosRef.current.indexOf(step) }, '')
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

      const lista = pasosRef.current
      const destino = (ev.state as EstadoHistorial | null)?.turneroStep
      const actual = lista.indexOf(pasoRef.current)
      if (typeof destino !== 'number' || actual < 0) return
      // Sólo hacia atrás: avanzar desde el historial saltearía las validaciones
      // de cada paso y podría dejar el wizard en un estado incompleto.
      if (destino >= actual) return
      // La lista pudo achicarse (el cliente sacó el servicio que pedía seña):
      // un índice que ya no existe se ignora en vez de dejar el paso en
      // `undefined` y la pantalla en blanco.
      const siguiente = lista[destino]
      if (!siguiente) return

      setError('')
      setDireccion('atras')
      setStep(siguiente)
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

  // El error se pinta ARRIBA del contenido y el botón vive en el pie fijo: en
  // un paso largo —la seña son cuatro bloques y la política entera— el cliente
  // toca "Pagar seña $8.000", el servidor rechaza y el mensaje aparece a
  // ochocientos píxeles de donde está mirando. Desde su lado el botón no hizo
  // nada, y lo que hace cualquiera cuando un botón de pagar no hace nada es
  // volver a tocarlo. Se sube a mostrarlo.
  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [error])

  // ─── Navegación ─────────────────────────────────────────────────

  function avanzarA(next: WizardStep) {
    setError('')
    setDireccion('adelante')
    setStep(next)

    const idx = pasos.indexOf(next)
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
    const actual = pasos.indexOf(pasoRef.current)
    if (actual <= 0) return

    const marca = (window.history.state as EstadoHistorial | null)?.turneroStep
    if (marca === actual) {
      window.history.back()
      return
    }

    setError('')
    setDireccion('atras')
    setStep(pasos[actual - 1])
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

      // Con seña, el paso del horario ya no confirma nada: lleva a la pantalla
      // donde se lee el monto y la política antes de cobrar. La casilla de
      // cancelación de este pie no aplica ahí — la aceptación de la seña es un
      // consentimiento distinto y vive en la pantalla siguiente.
      if (senaAplica) {
        avanzarA('sena')
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
        // El velo verde SÓLO acá: en este camino el turno ya existe y está
        // `confirmed`. Con seña no se muestra nunca desde el wizard — "turno
        // confirmado" con sonido y háptica sobre un turno impago es una promesa
        // falsa. Ese momento pasó a ser de `/pago/[id]`, que lee el estado real
        // de la seña.
        confirmadoRef.current = true
        setDireccion('adelante')
        setMostrandoVerde(true)
        setStep('confirmation')
        notificarAppMobile(result.data.appointment_id)
      })
      return
    }

    if (step === 'sena') {
      if (!selectedDate || !selectedSlot) {
        setError('Falta fecha u horario. Volvé al paso anterior.')
        return
      }
      if (!senaAceptada) {
        setError('Aceptá la seña y la política de cancelación para poder pagar.')
        return
      }

      startTransition(async () => {
        if (!selectedDate || !selectedSlot) return

        const result = await publicPrepararSena({
          branch_id: branch.id,
          client_phone: identidad.phone,
          client_name: clientName,
          staff_id: selectedSlot.staffId,
          starts_at: toDateStr(selectedDate),
          start_time: selectedSlot.time,
          service_ids: selectedServiceIds,
          duration_minutes: totalDuration,
        })

        if (!result.ok) {
          setError(mensajeDeSena(result.code, result.message))
          // El hueco se ocupó mientras leía la política: volver a la grilla
          // recargada, porque el paso de la seña no tiene forma de arreglarlo.
          if (result.code === 'SLOT_TAKEN') {
            setSelectedSlot(null)
            setSlotRefreshKey(k => k + 1)
            setSenaAceptada(false)
            setDireccion('atras')
            setStep('slot')
          }
          return
        }

        // El servidor es el que cobra, así que su monto es el que vale. Si no
        // es el que el cliente leyó y aceptó, no se lo manda al checkout: se le
        // muestra el número real y decide de nuevo.
        if (Math.round(result.amount) !== Math.round(senaMostrada.sena)) {
          setMontoServidor(result.amount)
          setSenaAceptada(false)
          setError(
            `El monto de la seña se actualizó a ${formatCurrency(result.amount)}. ` +
            'Revisalo y volvé a tocar el botón.'
          )
          return
        }

        if (!result.init_point) {
          setError('No pudimos abrir el pago de Mercado Pago. Probá de nuevo en un momento.')
          return
        }

        // Sin velo verde y sin paso de confirmación: acá todavía no hay turno.
        // El cliente vuelve de Mercado Pago a `/pago/<id>`, que es la única
        // pantalla que sabe si el pago se acreditó.
        window.location.href = result.init_point
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
    // Y con el precio cambia la seña: lo que el cliente había aceptado ya no es
    // lo que se le va a cobrar.
    setSenaAceptada(false)
    setMontoServidor(null)
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
    if (step === 'slot') {
      const horaLista = !!selectedDate && !!selectedSlot
      return senaAplica ? horaLista : horaLista && policyAccepted
    }
    if (step === 'sena') return !!selectedDate && !!selectedSlot && senaAceptada
    return false
  }

  const habilitado = canProceed() && !isPending
  const ctaLabel = step === 'sena'
    ? `Pagar seña ${formatCurrency(senaMostrada.sena)}`
    : isLastContentStep
      ? 'Confirmar turno'
      : 'Continuar'
  const mostrarAtras = !isFirstStep && step !== 'confirmation'

  /**
   * El título del paso de la seña lo escribe el SERVIDOR (`politica.titulo`,
   * "Seña $8.000 ARS") y se muestra tal cual, igual que en la app.
   *
   * No es cosmético: trae el monto y la MONEDA, que es lo único que le permite
   * al cliente cotejar contra lo que va a ver en el checkout de Mercado Pago.
   * El encabezado escrito acá ("Confirmá y pagá la seña") perdía las dos cosas,
   * y un texto propio es además la forma de que las dos superficies terminen
   * diciendo cosas distintas sobre la misma plata.
   */
  const tituloDelPaso = step === 'sena' && politica ? politica.titulo : STEP_TITLES[step]
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
            total={pasos.length}
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
                {tituloDelPaso}
              </h1>
              {step === 'sena' && (
                <p className="mt-1.5 text-sm text-[var(--t-text-muted)]">
                  Revisá el turno y la política antes de pagar.
                </p>
              )}
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

          {step === 'sena' && politica && selectedDate && selectedSlot && (
            <DepositStep
              calculo={senaMostrada}
              politica={politica}
              branchName={branch.name}
              branchAddress={branch.address}
              services={selectedServices}
              durationMinutes={totalDuration}
              date={selectedDate}
              time={selectedSlot.time}
              staffName={selectedSlot.staffName}
              staffAvatarUrl={selectedSlot.staffAvatarUrl}
              clientName={clientName}
              clientPhone={identidad.phone}
              aceptado={senaAceptada}
              onAceptar={v => { setSenaAceptada(v); setError('') }}
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

        {/* El pie legal va DENTRO del contenedor que scrollea, no fijo: el pie
            fijo ya está ocupado por el CTA, y una barra más comería la mitad de
            la pantalla de un celular chico. La ley pide que el botón de
            arrepentimiento esté a simple vista y en el primer acceso, no que
            tape la reserva. */}
        <div className="mt-8">
          <PieLegal sucursal={branch.slug} />
        </div>
      </div>

      {/* Footer sticky con resumen + acciones */}
      {step !== 'confirmation' && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--t-glass-border)] bg-[var(--t-chrome-bg)] backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-2xl px-4 py-3">
            {/* El aviso de la seña, arriba del precio y desde el primer paso.
                Una línea sola: el detalle completo —monto, política y
                devolución— es la pantalla siguiente, y repetirlo en cada paso
                lo convierte en ruido que se deja de leer. En el paso de la seña
                no va: ahí la pantalla entera habla de esto. */}
            {avisoSena && step !== 'sena' && (
              <p className="mb-2.5 flex items-start gap-2 px-0.5 text-[11.5px] font-medium leading-snug text-[var(--t-text-muted)]">
                <Wallet className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{avisoSena}</span>
              </p>
            )}

            {/* En el paso de la seña el resumen está entero arriba, en grande:
                repetirlo acá sólo le come alto al bloque que importa. */}
            {selectedServices.length > 0 && step !== 'services' && step !== 'sena' && (
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
                hora elegida para no ocupar el pie durante todo el flujo.

                Con seña NO va: este botón ya no confirma nada, y la aceptación
                que corresponde —la de la seña, con su monto y su política de
                devolución— vive en la pantalla siguiente, que es la que está
                inmediatamente antes del cobro (art. 1111 CCyC). */}
            {step === 'slot' && selectedSlot && !senaAplica && (
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
                    {step === 'sena' ? 'Abriendo Mercado Pago…' : 'Confirmando…'}
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
