'use client'

/**
 * Flujo del kiosko para sucursales en modo `appointments` o `hybrid`.
 *
 * Es el flujo que pidió el dueño, y arranca con la MISMA pantalla que el
 * walk-in ("¿Estás registrado?" · Sí / No):
 *
 *   Sí → cámara (match 1:N) → turno de hoy del cliente reconocido → confirmar
 *        llegada. Sin turno: se ofrece fila (hybrid) o reservar.
 *   No → teclado → "¿Sos vos?" → turno de hoy → OFRECER REGISTRAR LA CARA →
 *        confirmar llegada → cierre que explica para qué sirvió el registro.
 *
 * El orden importa y es deliberado: el enrolamiento va DESPUÉS de mostrarle el
 * turno (ya sabe que la máquina lo reconoció bien y confía) y ANTES de la
 * confirmación final (así el mensaje de cierre puede explicar el beneficio).
 *
 * Reemplaza a `appointment-lookup-flow.tsx` y `hybrid-router.tsx`, que eran dos
 * copias del mismo lookup + confirmar llegada, sin cámara y sin timeouts.
 */

import { useCallback, useState } from 'react'
import Image from 'next/image'
import { format, parseISO, differenceInMinutes } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  RotateCcw,
  ScanFace,
  Scissors,
  Settings2,
  User,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toLocalPhone } from '@/lib/phone'
import { Input } from '@/components/ui/input'
import {
  GlassRing,
  TerminalSectionGlow,
  terminalBodyMuted,
} from '@/components/checkin/terminal-theme'
import { FaceCamera } from '@/components/checkin/face-camera'
import { FaceEnrollment } from '@/components/checkin/face-enrollment'
import { PhoneKeypad, PHONE_LENGTH, formatPhone } from '@/components/checkin/phone-keypad'
import { AppointmentConfirmation } from '@/components/checkin/appointment-confirmation'
import { useAppointmentLookup } from '@/components/checkin/use-appointment-lookup'
import {
  useIdleReset,
  IDLE_MS_NEUTRAL,
  IDLE_MS_PERSONAL,
} from '@/components/checkin/use-idle-reset'
import { enrollFaceDescriptor, saveFacePhoto } from '@/lib/face-recognition'
import type { FaceMatchResult } from '@/lib/face-recognition'
import type { AppointmentInfo } from '@/lib/actions/kiosk-turnos'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NewClientPrefill {
  phone: string
  name: string
}

/**
 * Identidad ya resuelta que este flujo le entrega a la fila walk-in.
 *
 * El cliente que llega acá YA dio su teléfono (o puso la cara) y, si era nuevo,
 * su nombre. Mandarlo a la fila sin esos datos lo obligaba a empezar de cero
 * desde "¿Estás registrado?" — nadie completaba eso dos veces, así que el 95%
 * del negocio (walk-in) se perdía en el híbrido.
 */
export interface WalkInHandoff {
  /** 10 dígitos. Puede venir vacío si el cliente ya existe (alcanza `clientId`). */
  phone: string
  name: string
  /** Ya existía en `clients`: la fila no le vuelve a ofrecer el alta. */
  isReturning: boolean
  /** Ficha del cliente cuando la conocemos: evita el find-or-create por teléfono. */
  clientId?: string | null
}

interface TurnosCheckinFlowProps {
  branchId: string
  branchName: string
  /** Acota el match 1:N de la cámara a la org: sin esto busca en toda la base. */
  organizationId: string
  orgName: string
  orgLogoUrl: string | null
  operationMode: 'appointments' | 'hybrid'
  isLightBg: boolean
  /** Falso si la sucursal no tiene barberos con horario o servicios reservables. */
  canBook: boolean
  /** Abre el sub-flujo de reserva; el prefill evita re-tipear teléfono y nombre. */
  onBook: (prefill?: NewClientPrefill) => void
  /** Sólo hybrid: manda al flujo walk-in con la identidad ya resuelta. */
  onWalkIn: (datos?: WalkInHandoff) => void
  /** Vuelve el kiosko a cero (lo remonta desde el padre). */
  onReset: () => void
  onChangeBranch: () => void
}

// ─── Pasos ────────────────────────────────────────────────────────────────────

type TurnoStep =
  | 'home'
  | 'face_scan'
  | 'phone'
  | 'verify_client'
  | 'new_client_name'
  | 'appointment'
  | 'face_offer'
  | 'face_enroll'
  | 'no_appointment'
  | 'too_early'
  | 'too_late'
  | 'arrival_error'
  | 'success'

/**
 * Ventana de inactividad por pantalla. Las que muestran datos de una persona
 * (nombre, teléfono, turno) se limpian rápido; las neutras dan aire.
 * `home` no tiene: ya está en cero.
 */
const IDLE_POR_PASO: Record<TurnoStep, number> = {
  home: 0,
  face_scan: IDLE_MS_NEUTRAL,
  phone: IDLE_MS_NEUTRAL,
  verify_client: IDLE_MS_PERSONAL,
  new_client_name: IDLE_MS_PERSONAL,
  appointment: IDLE_MS_PERSONAL,
  face_offer: IDLE_MS_NEUTRAL,
  face_enroll: IDLE_MS_NEUTRAL,
  no_appointment: IDLE_MS_PERSONAL,
  too_early: IDLE_MS_PERSONAL,
  too_late: IDLE_MS_PERSONAL,
  arrival_error: IDLE_MS_PERSONAL,
  success: 0, // tiene su propio contador visible
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function TurnosCheckinFlow({
  branchId,
  branchName,
  organizationId,
  orgName,
  orgLogoUrl,
  operationMode,
  isLightBg,
  canBook,
  onBook,
  onWalkIn,
  onReset,
  onChangeBranch,
}: TurnosCheckinFlowProps) {
  const [step, setStep] = useState<TurnoStep>('home')
  const [phone, setPhone] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [newClientName, setNewClientName] = useState('')
  /** El cliente ya tiene cara cargada → no tiene sentido ofrecerle registrarla. */
  const [hasFace, setHasFace] = useState(false)
  const [faceJustEnrolled, setFaceJustEnrolled] = useState(false)
  const [adoptedEntry, setAdoptedEntry] = useState(false)
  const [tooEarlyStartsAt, setTooEarlyStartsAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isLookingClient, setIsLookingClient] = useState(false)
  /** Llegó por cámara: cambia el texto de la salida hacia el teclado. */
  const [viaCamara, setViaCamara] = useState(false)

  const {
    appointment,
    isLooking,
    isConfirming,
    lookupByPhone,
    lookupByClient,
    confirmArrival,
  } = useAppointmentLookup(branchId)

  const esHybrid = operationMode === 'hybrid'

  const irA = useCallback((next: TurnoStep) => {
    setError('')
    setStep(next)
  }, [])

  /**
   * Navegar DEJANDO un error a la vista. `irA` lo limpia por diseño (cambiar de
   * pantalla no arrastra el error de la anterior), así que sin esta variante la
   * única forma de mostrar un fallo era quedarse donde estaba — que es
   * exactamente lo que dejaba la tablet muda.
   */
  const irAConError = useCallback((next: TurnoStep, mensaje: string) => {
    setError(mensaje)
    setStep(next)
  }, [])

  // ── Confirmar llegada ──

  const confirmar = useCallback(
    async (apt: AppointmentInfo) => {
      const outcome = await confirmArrival(apt.id)

      if (outcome.kind === 'confirmed') {
        setAdoptedEntry(outcome.adoptedExistingEntry)
        irA('success')
        return
      }
      if (outcome.kind === 'too_early') {
        setTooEarlyStartsAt(outcome.startsAt ?? apt.starts_at)
        irA('too_early')
        return
      }
      if (outcome.kind === 'too_late') {
        irA('too_late')
        return
      }
      // El fallo tiene que aterrizar en una pantalla que lo MUESTRE y ofrezca
      // salida. `confirmar()` se llama desde tres lugares y dos de ellos
      // (`face_offer` y `face_enroll`) no pintan `cajaError` ni tienen botones
      // de escape: un simple error de red al confirmar la llegada dejaba al
      // cliente frente a una pantalla que no reaccionaba, con sus datos a la
      // vista y sin manera de volver. Por eso el error tiene pantalla propia.
      irAConError('arrival_error', outcome.message)
    },
    [confirmArrival, irA, irAConError]
  )

  // Timeout de inactividad. En los pasos de enrolamiento NO reseteamos: la
  // llegada todavía no está confirmada y perderla sería peor que dejar la cara
  // sin registrar. Si el cliente se fue de la tablet, lo damos por llegado.
  const idleMs = IDLE_POR_PASO[step]
  const onIdle = useCallback(() => {
    if ((step === 'face_offer' || step === 'face_enroll') && appointment) {
      confirmar(appointment)
      return
    }
    onReset()
  }, [step, appointment, confirmar, onReset])

  useIdleReset({
    enabled: idleMs > 0 && !isConfirming && !isLooking,
    timeoutMs: idleMs,
    resetKey: step,
    onIdle,
  })

  // ── Reconocimiento facial ──

  const handleFaceMatch = useCallback(
    async (match: FaceMatchResult, descriptor: Float32Array, photoBlob: Blob | null) => {
      setClientId(match.clientId)
      setClientName(match.clientName)
      // `match_face_descriptor` devuelve `clients.phone` CRUDO y en prod hay ~50
      // clientes guardados con prefijo internacional ("5493512554674"). Ese
      // teléfono viaja como prefill a la reserva inline, que trabaja con 10
      // dígitos: crudo, bloquea el botón de confirmar o reserva con un número
      // truncado. `toLocalPhone` devuelve '' si no hay 10 dígitos válidos —
      // preferimos que el cliente lo tipee antes que prellenar mal.
      setPhone(toLocalPhone(match.clientPhone))
      setHasFace(true)
      setViaCamara(true)

      // Retroalimentación del modelo con el match confirmado (fire & forget),
      // igual que en el walk-in: cada reconocimiento mejora el siguiente.
      enrollFaceDescriptor(match.clientId, descriptor, 'checkin', 0.85, branchId).catch(() => {})
      if (photoBlob) saveFacePhoto(match.clientId, photoBlob, branchId).catch(() => {})

      const outcome = await lookupByClient(match.clientId)
      if (outcome.kind === 'found') {
        irA('appointment')
      } else if (outcome.kind === 'not_found') {
        irA('no_appointment')
      } else {
        // Falló la búsqueda (no es que no tenga turno): el teléfono va por otro
        // camino en la DB, así que ofrecerlo es un reintento real, no un loop.
        setPhone('')
        irAConError('phone', 'No pudimos buscar tu turno. Probá con tu teléfono.')
      }
    },
    [branchId, lookupByClient, irA, irAConError]
  )

  const handleFaceNoMatch = useCallback(() => {
    setPhone('')
    irA('phone')
  }, [irA])

  // ── Teléfono ──

  const buscarPorTelefono = useCallback(
    async (ph: string) => {
      setError('')
      setIsLookingClient(true)
      const { lookupClientByPhone } = await import('@/lib/actions/clients')
      const res = await lookupClientByPhone(ph, branchId)

      if (res.rateLimited) {
        setIsLookingClient(false)
        setPhone('')
        setError('Demasiados intentos. Esperá un momento.')
        return
      }

      if (res.data) {
        setIsLookingClient(false)
        setClientId(res.data.id)
        setClientName(res.data.name)
        irA('verify_client')
        return
      }

      // `lookupClientByPhone` matchea el teléfono EXACTO; el RPC de turnos
      // matchea por los últimos 10 dígitos. Un cliente guardado como
      // "+54 9 351 …" no aparece en el primero pero sí en el segundo, y decirle
      // "sos nuevo" a alguien que tiene turno reservado es el peor final
      // posible. Por eso, antes de darlo por nuevo, preguntamos por su turno.
      const outcome = await lookupByPhone(ph)
      setIsLookingClient(false)

      if (outcome.kind === 'found') {
        setClientId(outcome.appointment.client_id)
        setClientName(outcome.appointment.client_name)
        irA('appointment')
        return
      }

      if (outcome.kind === 'error') {
        setError(outcome.message)
        return
      }

      setClientId(null)
      setClientName('')
      setNewClientName('')
      irA('new_client_name')
    },
    [branchId, irA, lookupByPhone]
  )

  /** [Sí, soy yo] → buscamos su turno de hoy por client_id. */
  const confirmarIdentidad = useCallback(async () => {
    if (!clientId) return
    const outcome = await lookupByClient(clientId)

    if (outcome.kind === 'error') {
      setError(outcome.message)
      return
    }

    if (outcome.kind === 'not_found') {
      irA('no_appointment')
      return
    }

    // Si ya tiene cara cargada no lo molestamos con el enrolamiento.
    //
    // La lectura va por SERVER ACTION, no desde la tablet: la anon key no tiene
    // ningún grant sobre `client_face_descriptors` (única policy: service_role),
    // así que la query desde el browser respondía 42501 SIEMPRE. Como el fallo
    // se interpretaba como "ya tiene cara", el paso `face_offer` no se mostró
    // nunca y la función estrella del kiosko (registrar el rostro para entrar
    // mirando la cámara) quedó muerta desde el día uno. `clientHasFaceEnrolled`
    // devuelve false ante error → se ofrece, que es el default seguro.
    const { clientHasFaceEnrolled } = await import('@/lib/actions/kiosk-face')
    setHasFace(await clientHasFaceEnrolled(clientId, branchId))

    irA('appointment')
  }, [clientId, branchId, lookupByClient, irA])

  const volverAlTeclado = useCallback(() => {
    setPhone('')
    setClientId(null)
    setClientName('')
    setViaCamara(false)
    irA('phone')
  }, [irA])

  // ── Salida hacia la fila (sólo hybrid) ──

  /**
   * Arma el traspaso a la fila con lo que ya sabemos del cliente.
   *
   * Dos identidades posibles, y cada una necesita cosas distintas:
   *  - Cliente ya registrado (`clientId`): la fila lo anota por id, el teléfono
   *    es decorativo. Por eso alcanza con el id aunque el número guardado en
   *    `clients` venga con prefijo internacional y `toLocalPhone` lo haya dejado
   *    vacío (pasa con ~50 fichas en prod).
   *  - Cliente nuevo: la fila lo tiene que crear, y para eso van sí o sí nombre
   *    y teléfono completo. Sin eso devolvemos `undefined` y la fila arranca de
   *    cero, que es feo pero honesto: no podemos inventarle un número.
   */
  const datosParaLaFila = useCallback((): WalkInHandoff | undefined => {
    const nombre = (clientName || appointment?.client_name || '').trim()
    const tel = phone.replace(/\D/g, '')
    if (!clientId && (nombre.length < 2 || tel.length !== PHONE_LENGTH)) return undefined
    return { phone: tel, name: nombre, isReturning: Boolean(clientId), clientId }
  }, [clientName, appointment, phone, clientId])

  const entrarALaFila = useCallback(() => {
    onWalkIn(datosParaLaFila())
  }, [onWalkIn, datosParaLaFila])

  // ── Handlers del paso "tiene turno" ──

  const handleConfirmarLlegada = useCallback(() => {
    if (!appointment) return
    // Enrolamiento sólo para quien llegó por teléfono, no tiene cara cargada y
    // tiene ficha de cliente (sin `client_id` no hay dónde guardar el rostro).
    if (!hasFace && clientId) {
      irA('face_offer')
      return
    }
    confirmar(appointment)
  }, [appointment, hasFace, clientId, confirmar, irA])

  const handleEnrolamientoTerminado = useCallback(
    (enrolado: boolean) => {
      setFaceJustEnrolled(enrolado)
      if (appointment) {
        confirmar(appointment)
        return
      }
      // Sin turno en memoria no hay nada que confirmar. Antes esto era un
      // `if` sin `else`: el cliente tocaba "Ahora no" y no pasaba absolutamente
      // nada, sin mensaje y sin botón para salir.
      irAConError('arrival_error', 'Perdimos los datos de tu turno. Avisá en el mostrador.')
    },
    [appointment, confirmar, irAConError]
  )

  // ── Piezas compartidas ──

  const primerNombre = (clientName || appointment?.client_name || '').trim().split(' ')[0]

  const cajaError = error ? (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-3 rounded-2xl border text-base md:text-lg w-full',
        isLightBg
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-red-950/30 border-red-500/30 text-red-300'
      )}
    >
      <AlertCircle className="size-5 shrink-0" />
      <span>{error}</span>
    </div>
  ) : null

  const botonPrimario = (
    texto: string,
    onClick: () => void,
    opts?: { icon?: React.ReactNode; loading?: boolean; tone?: 'emerald' | 'cyan' }
  ) => {
    const tone = opts?.tone ?? 'emerald'
    return (
      <GlassRing halo={!isLightBg} className="w-full">
        <button
          type="button"
          onClick={onClick}
          disabled={opts?.loading}
          className={cn(
            'relative w-full flex items-center justify-center gap-3 rounded-2xl border min-h-16 md:min-h-[4.5rem] px-6 text-xl md:text-2xl font-bold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2',
            tone === 'emerald'
              ? isLightBg
                ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500/40 shadow-sm'
                : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-500/25 focus-visible:ring-emerald-400/50 shadow-[0_0_24px_rgba(52,211,153,0.15)]'
              : isLightBg
                ? 'bg-cyan-500 border-cyan-500 text-white hover:bg-cyan-600 focus-visible:ring-cyan-500/40 shadow-sm'
                : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-500/25 focus-visible:ring-cyan-400/50 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
          )}
        >
          {opts?.loading ? <Loader2 className="size-6 animate-spin" /> : opts?.icon}
          {texto}
        </button>
      </GlassRing>
    )
  }

  const botonSecundario = (texto: string, onClick: () => void, icon?: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-center gap-3 rounded-2xl border min-h-16 px-6 text-lg md:text-xl font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
        isLightBg
          ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md'
          : 'border-white/15 bg-white/5 text-white hover:border-white/28'
      )}
    >
      {icon}
      {texto}
    </button>
  )

  const enlace = (texto: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-base md:text-lg underline underline-offset-4 transition-colors',
        isLightBg ? 'text-zinc-500 hover:text-zinc-900' : 'text-white/40 hover:text-white/75'
      )}
    >
      {texto}
    </button>
  )

  const encabezado = (titulo: string, bajada?: string) => (
    <div className="text-center space-y-2">
      <h2
        className={cn(
          'text-3xl md:text-5xl font-extrabold tracking-tight text-balance',
          isLightBg ? 'text-zinc-900' : 'text-white'
        )}
      >
        {titulo}
      </h2>
      {bajada && (
        <p className={cn('text-lg md:text-2xl', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
          {bajada}
        </p>
      )}
    </div>
  )

  const contenedor = (children: React.ReactNode, ancho = 'md:max-w-2xl') => (
    <div
      className={cn(
        'relative z-[1] w-full max-w-sm flex flex-col items-center gap-5 md:gap-7 px-4 md:px-8 py-6 my-auto animate-in fade-in slide-in-from-right-4 duration-300',
        ancho
      )}
    >
      <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
      {children}
    </div>
  )

  // ─── HOME ───────────────────────────────────────────────────────────────────

  if (step === 'home') {
    return contenedor(
      <>
        <div className="relative flex flex-col items-center gap-3 md:gap-4">
          <div className="relative size-16 md:size-24 rounded-full flex items-center justify-center">
            <div
              className="pointer-events-none absolute -inset-6 rounded-full bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.22),rgba(167,139,250,0.12)_45%,transparent_70%)] blur-xl opacity-80 motion-reduce:opacity-60"
              aria-hidden
            />
            <div className="relative size-full rounded-full overflow-hidden flex items-center justify-center ring-1 ring-white/10 bg-zinc-950/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <Image
                src={orgLogoUrl || '/logo-barberos.png'}
                alt={orgName}
                fill
                sizes="(max-width: 768px) 64px, 96px"
                className="absolute inset-0 z-[1] size-full object-cover"
                priority
                unoptimized
              />
            </div>
          </div>
          <div className="text-center space-y-2">
            <h1
              className={cn(
                'text-2xl md:text-4xl font-bold tracking-tight text-balance leading-tight',
                isLightBg ? 'text-zinc-900' : 'text-white'
              )}
            >
              Bienvenido a {orgName}
            </h1>
            <div
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
                isLightBg ? 'border border-zinc-300 bg-white/70' : 'border border-white/10 bg-zinc-950/50'
              )}
            >
              <MapPin className={cn('size-3.5', isLightBg ? 'text-cyan-700' : 'text-cyan-300/70')} />
              <p className={cn('text-sm font-medium tracking-wide', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
                {branchName}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full max-w-xs md:max-w-lg flex flex-col gap-4">
          <h2
            className={cn(
              'text-center text-lg md:text-xl font-medium tracking-[0.08em] uppercase',
              isLightBg ? 'text-zinc-600' : 'text-white/55'
            )}
          >
            ¿Estás registrado?
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <GlassRing halo={!isLightBg}>
              <button
                type="button"
                onClick={() => irA('face_scan')}
                className={cn(
                  'group relative w-full min-h-[5.5rem] md:min-h-[6.5rem] rounded-2xl border flex items-center justify-center gap-3 px-4 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
                  isLightBg
                    ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md'
                    : 'border-white/15 checkin-glass-surface'
                )}
              >
                <ScanFace
                  className={cn(
                    'size-8 md:size-9 transition-transform duration-300 group-hover:scale-110',
                    isLightBg ? 'text-cyan-700' : 'text-white drop-shadow-[0_0_10px_rgba(34,211,238,0.7)]'
                  )}
                  strokeWidth={1.75}
                />
                <span className={cn('text-2xl md:text-3xl font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                  Sí
                </span>
              </button>
            </GlassRing>

            <GlassRing halo={!isLightBg}>
              <button
                type="button"
                onClick={() => irA('phone')}
                className={cn(
                  'group relative w-full min-h-[5.5rem] md:min-h-[6.5rem] rounded-2xl border flex items-center justify-center gap-3 px-4 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
                  isLightBg
                    ? 'border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-400 hover:shadow-md'
                    : 'border-white/15 checkin-glass-surface'
                )}
              >
                <UserPlus
                  className={cn(
                    'size-8 md:size-9 transition-transform duration-300 group-hover:scale-110',
                    isLightBg ? 'text-zinc-700' : 'text-white'
                  )}
                  strokeWidth={1.75}
                />
                <span className={cn('text-2xl md:text-3xl font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                  No
                </span>
              </button>
            </GlassRing>
          </div>
        </div>

        <button
          type="button"
          onClick={onChangeBranch}
          className={cn(
            'group flex items-center gap-2 text-sm md:text-base transition-colors py-1.5 px-2 rounded-lg font-medium',
            isLightBg ? 'text-zinc-500 hover:text-zinc-800' : 'text-white/40 hover:text-white/70'
          )}
        >
          <Settings2 className="size-4 transition-transform group-hover:rotate-45" />
          <span>Cambiar sucursal</span>
        </button>
      </>
    )
  }

  // ─── CÁMARA ─────────────────────────────────────────────────────────────────

  if (step === 'face_scan') {
    return (
      <div className="relative z-[1] w-full max-w-lg md:max-w-3xl flex flex-col items-center gap-3 px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-300">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
        {isLooking ? (
          <div className="flex flex-col items-center gap-4 my-auto">
            <Loader2 className={cn('size-10 animate-spin', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} />
            <p className={cn('text-xl md:text-2xl', isLightBg ? 'text-zinc-700' : 'text-white/70')}>
              Buscando tu turno…
            </p>
          </div>
        ) : (
          <FaceCamera
            variant="terminal"
            isLightBg={isLightBg}
            branchName={branchName}
            orgId={organizationId}
            onMatch={handleFaceMatch}
            onNoMatch={handleFaceNoMatch}
            onManualEntry={handleFaceNoMatch}
          />
        )}
      </div>
    )
  }

  // ─── TELÉFONO ───────────────────────────────────────────────────────────────

  if (step === 'phone') {
    return contenedor(
      <>
        {encabezado('Tu teléfono', 'Lo usamos para encontrar tu turno')}
        <PhoneKeypad
          value={phone}
          onChange={setPhone}
          onComplete={buscarPorTelefono}
          isLightBg={isLightBg}
          loading={isLookingClient}
        />
        {cajaError}
        {/* Con el número ya completo el autosubmit no se vuelve a disparar: sin
            este botón, un error de red obligaba a borrar y retipear 10 dígitos. */}
        {error && phone.length === PHONE_LENGTH &&
          botonSecundario('Reintentar', () => buscarPorTelefono(phone), <RotateCcw className="size-5" />)}
        {enlace('Volver al inicio', onReset)}
      </>,
      'md:max-w-md'
    )
  }

  // ─── ¿SOS VOS? ──────────────────────────────────────────────────────────────

  if (step === 'verify_client') {
    return contenedor(
      <>
        <div
          className={cn(
            'size-20 md:size-24 rounded-full border flex items-center justify-center',
            isLightBg ? 'border-cyan-300 bg-cyan-50' : 'border-cyan-400/25 bg-cyan-500/10'
          )}
        >
          <User className={cn('size-10', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.5} />
        </div>
        {encabezado(`¿Sos ${clientName}?`, formatPhone(phone))}
        {cajaError}
        <div className="w-full flex flex-col gap-3">
          {botonPrimario('Sí, soy yo', confirmarIdentidad, {
            icon: <CheckCircle2 className="size-6" strokeWidth={2} />,
            loading: isLooking,
          })}
          {botonSecundario('No soy yo', volverAlTeclado, <ArrowLeft className="size-5" />)}
        </div>
      </>,
      'md:max-w-lg'
    )
  }

  // ─── CLIENTE NUEVO: NOMBRE ──────────────────────────────────────────────────

  if (step === 'new_client_name') {
    const seguir = () => {
      const nombre = newClientName.trim()
      if (nombre.length < 2) {
        setError('Ingresá tu nombre para continuar.')
        return
      }
      setClientName(nombre)
      if (esHybrid) {
        irA('no_appointment')
        return
      }
      onBook({ phone, name: nombre })
    }

    return contenedor(
      <>
        {encabezado('¿Cómo te llamás?', 'Es tu primera vez con nosotros')}
        <Input
          value={newClientName}
          onChange={(e) => setNewClientName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') seguir()
          }}
          placeholder="Nombre y apellido"
          autoComplete="off"
          autoFocus
          className={cn(
            'h-16 md:h-20 text-2xl md:text-3xl text-center rounded-2xl',
            isLightBg
              ? 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 shadow-sm focus-visible:border-cyan-500'
              : 'border-cyan-500/20 bg-zinc-950/50 text-cyan-50 placeholder:text-cyan-200/30 focus-visible:border-cyan-400/40'
          )}
        />
        {cajaError}
        {botonPrimario('Continuar', seguir, { tone: 'cyan' })}
        {enlace('Volver', volverAlTeclado)}
      </>,
      'md:max-w-lg'
    )
  }

  // ─── TIENE TURNO ────────────────────────────────────────────────────────────

  if (step === 'appointment' && appointment) {
    const inicio = parseISO(appointment.starts_at)
    const hora = format(inicio, 'HH:mm')
    const duracion = differenceInMinutes(parseISO(appointment.ends_at), inicio)

    return contenedor(
      <>
        <div className="text-center space-y-1">
          <p className={cn('text-lg md:text-2xl', isLightBg ? 'text-zinc-600' : terminalBodyMuted)}>
            Hola{primerNombre ? `, ${primerNombre}` : ''}
          </p>
          <h2
            className={cn(
              'text-3xl md:text-5xl font-extrabold tracking-tight text-balance',
              isLightBg ? 'text-zinc-900' : 'text-white'
            )}
          >
            Tenés turno hoy a las {hora}
            {appointment.barber_name ? ` con ${appointment.barber_name}` : ''}
          </h2>
        </div>

        <div
          className={cn(
            'w-full rounded-2xl border p-5 md:p-6 flex items-center gap-5',
            isLightBg ? 'bg-white border-zinc-200 shadow-sm' : 'bg-white/5 border-white/10'
          )}
        >
          {appointment.barber_avatar_url ? (
            <Image
              src={appointment.barber_avatar_url}
              alt={appointment.barber_name ?? 'Barbero'}
              width={96}
              height={96}
              unoptimized
              className="size-20 md:size-24 rounded-full object-cover ring-2 ring-cyan-400/30 shrink-0"
            />
          ) : (
            <div
              className={cn(
                'size-20 md:size-24 rounded-full flex items-center justify-center text-3xl font-bold shrink-0',
                isLightBg ? 'bg-zinc-200 text-zinc-700' : 'bg-white/10 text-white'
              )}
            >
              {(appointment.barber_name ?? '?').charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className={cn('size-5 shrink-0', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.75} />
              <span className={cn('text-lg md:text-xl font-semibold capitalize', isLightBg ? 'text-zinc-900' : 'text-white')}>
                {format(inicio, "EEEE d 'a las' HH:mm", { locale: es })}
                {duracion > 0 ? ` · ${duracion} min` : ''}
              </span>
            </div>
            {appointment.services.length > 0 && (
              <div className="flex items-center gap-2">
                <Scissors className={cn('size-5 shrink-0', isLightBg ? 'text-emerald-600' : 'text-emerald-300')} strokeWidth={1.75} />
                <span className={cn('text-lg md:text-xl truncate', isLightBg ? 'text-zinc-700' : 'text-white/75')}>
                  {appointment.services.join(', ')}
                </span>
              </div>
            )}
            {appointment.barber_name && (
              <div className="flex items-center gap-2">
                <User className={cn('size-5 shrink-0', isLightBg ? 'text-violet-600' : 'text-violet-300')} strokeWidth={1.75} />
                <span className={cn('text-lg md:text-xl', isLightBg ? 'text-zinc-700' : 'text-white/75')}>
                  {appointment.barber_name}
                </span>
              </div>
            )}
          </div>
        </div>

        {cajaError}

        {botonPrimario('Confirmar mi llegada', handleConfirmarLlegada, {
          icon: <CheckCircle2 className="size-6" strokeWidth={2} />,
          loading: isConfirming,
        })}
        {enlace('No soy yo', volverAlTeclado)}
      </>
    )
  }

  // ─── OFRECER REGISTRAR LA CARA ──────────────────────────────────────────────

  if (step === 'face_offer') {
    return contenedor(
      <>
        <div
          className={cn(
            'size-20 md:size-24 rounded-2xl border flex items-center justify-center',
            isLightBg ? 'border-cyan-300 bg-cyan-50' : 'border-cyan-400/25 bg-cyan-500/10'
          )}
        >
          <ScanFace className={cn('size-10', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.5} />
        </div>
        {encabezado(
          'Registrá tu cara',
          'La próxima vez entrás con sólo mirar la cámara, sin escribir tu teléfono'
        )}
        {/* Ninguna pantalla del flujo puede quedarse con un error seteado y no
            mostrarlo: así se trababa la tablet. Hoy los fallos se van a
            `arrival_error`, esto es red de seguridad para el próximo cambio. */}
        {cajaError}
        <div className="w-full flex flex-col gap-3">
          {botonPrimario('Registrar mi cara', () => irA('face_enroll'), {
            icon: <ScanFace className="size-6" strokeWidth={2} />,
            tone: 'cyan',
          })}
          {botonSecundario('Ahora no', () => handleEnrolamientoTerminado(false))}
        </div>
      </>,
      'md:max-w-lg'
    )
  }

  if (step === 'face_enroll') {
    return (
      <div className="relative z-[1] w-full max-w-sm md:max-w-lg flex flex-col items-center gap-3 px-4 md:px-6 pt-10 md:pt-12 pb-4 flex-1 min-h-0 animate-in fade-in slide-in-from-right-4 duration-300">
        <TerminalSectionGlow className={isLightBg ? 'hidden' : undefined} />
        <FaceEnrollment
          clientId={clientId ?? undefined}
          clientName={clientName || 'Cliente'}
          source="checkin"
          branchId={branchId}
          onComplete={() => handleEnrolamientoTerminado(true)}
          onSkip={() => handleEnrolamientoTerminado(false)}
        />
      </div>
    )
  }

  // ─── SIN TURNO ──────────────────────────────────────────────────────────────

  if (step === 'no_appointment') {
    return contenedor(
      <>
        <div
          className={cn(
            'size-16 md:size-20 rounded-2xl border flex items-center justify-center',
            isLightBg ? 'border-amber-300 bg-amber-50' : 'border-amber-400/25 bg-amber-500/10'
          )}
        >
          <Calendar className={cn('size-8 md:size-10', isLightBg ? 'text-amber-600' : 'text-amber-300')} strokeWidth={1.5} />
        </div>
        {encabezado(
          clientName ? `${primerNombre}, no tenés turno para hoy` : 'No encontramos un turno para hoy',
          esHybrid ? '¿Entrás a la fila?' : undefined
        )}

        {/* Red de seguridad: ver comentario en `face_offer`. */}
        {cajaError}

        <div className="w-full flex flex-col gap-3">
          {esHybrid &&
            botonPrimario('Entrar a la fila', entrarALaFila, {
              icon: <Zap className="size-6" fill="currentColor" />,
            })}

          {canBook &&
            (esHybrid
              ? botonSecundario(
                  'Reservar un turno',
                  () => onBook(clientName && phone ? { phone, name: clientName } : undefined),
                  <Calendar className="size-5" />
                )
              : botonPrimario(
                  'Reservar un turno',
                  () => onBook(clientName && phone ? { phone, name: clientName } : undefined),
                  { icon: <Calendar className="size-6" />, tone: 'cyan' }
                ))}

          {!canBook && !esHybrid && (
            <p className={cn('text-center text-lg md:text-xl', isLightBg ? 'text-zinc-600' : 'text-white/60')}>
              Acercate al mostrador y te damos un turno.
            </p>
          )}

          {botonSecundario(
            viaCamara ? 'Buscar con mi teléfono' : 'Probar con otro número',
            volverAlTeclado,
            <User className="size-5" />
          )}
        </div>

        {enlace('Volver al inicio', onReset)}
      </>,
      'md:max-w-lg'
    )
  }

  // ─── LLEGÓ DEMASIADO TEMPRANO ───────────────────────────────────────────────

  if (step === 'too_early') {
    const hora = tooEarlyStartsAt ? format(parseISO(tooEarlyStartsAt), 'HH:mm') : null

    return contenedor(
      <>
        <div
          className={cn(
            'size-16 md:size-20 rounded-2xl border flex items-center justify-center',
            isLightBg ? 'border-cyan-300 bg-cyan-50' : 'border-cyan-400/25 bg-cyan-500/10'
          )}
        >
          <Clock className={cn('size-8 md:size-10', isLightBg ? 'text-cyan-600' : 'text-cyan-300')} strokeWidth={1.5} />
        </div>
        {encabezado(
          hora ? `Tu turno es a las ${hora}` : 'Todavía falta para tu turno',
          'Llegaste con bastante tiempo: podés registrar tu llegada desde una hora antes.'
        )}

        <div className="w-full flex flex-col gap-3">
          {esHybrid &&
            botonPrimario('Entrar a la fila mientras tanto', entrarALaFila, {
              icon: <Zap className="size-6" fill="currentColor" />,
            })}
          {botonSecundario('Listo, vuelvo después', onReset, <CheckCircle2 className="size-5" />)}
        </div>
      </>,
      'md:max-w-lg'
    )
  }

  // ─── LLEGÓ TARDE ────────────────────────────────────────────────────────────

  if (step === 'too_late') {
    return contenedor(
      <>
        <div
          className={cn(
            'size-16 md:size-20 rounded-2xl border flex items-center justify-center',
            isLightBg ? 'border-amber-300 bg-amber-50' : 'border-amber-400/25 bg-amber-500/10'
          )}
        >
          <AlertCircle className={cn('size-8 md:size-10', isLightBg ? 'text-amber-600' : 'text-amber-300')} strokeWidth={1.5} />
        </div>
        {encabezado(
          'Se pasó la hora de tu turno',
          'Ya no podemos registrarlo desde acá, pero te podemos atender igual.'
        )}

        <div className="w-full flex flex-col gap-3">
          {esHybrid &&
            botonPrimario('Entrar a la fila', entrarALaFila, {
              icon: <Zap className="size-6" fill="currentColor" />,
            })}
          {botonSecundario('Avisar en el mostrador', onReset, <Users className="size-5" />)}
        </div>
      </>,
      'md:max-w-lg'
    )
  }

  // ─── NO SE PUDO CONFIRMAR LA LLEGADA ────────────────────────────────────────
  //
  // Destino único de cualquier fallo de `confirmar()`. Existe porque el error
  // se seteaba y el flujo se quedaba donde estuviera: viniendo de `face_offer`
  // o `face_enroll` —que no pintan el error ni tienen botones— la tablet
  // quedaba trabada con los datos del cliente en pantalla. Acá el mensaje se ve
  // y siempre hay dos salidas: reintentar o ir al mostrador (más el timeout de
  // inactividad, que la devuelve sola al inicio).
  //
  // No se ofrece "entrar a la fila" a propósito: uno de los fallos posibles es
  // QUEUE_CONFLICT ("ya estás anotado"), y ahí un segundo ingreso duplicaría al
  // cliente en la cola.
  if (step === 'arrival_error') {
    return contenedor(
      <>
        <div
          className={cn(
            'size-16 md:size-20 rounded-2xl border flex items-center justify-center',
            isLightBg ? 'border-amber-300 bg-amber-50' : 'border-amber-400/25 bg-amber-500/10'
          )}
        >
          <AlertCircle className={cn('size-8 md:size-10', isLightBg ? 'text-amber-600' : 'text-amber-300')} strokeWidth={1.5} />
        </div>
        {encabezado(
          'No pudimos registrar tu llegada',
          'Probá de nuevo. Si sigue sin andar, avisá en el mostrador: te atendemos igual.'
        )}

        {cajaError}

        <div className="w-full flex flex-col gap-3">
          {appointment &&
            botonPrimario('Reintentar', () => confirmar(appointment), {
              icon: <RotateCcw className="size-6" strokeWidth={2} />,
              loading: isConfirming,
              tone: 'cyan',
            })}
          {botonSecundario('Avisar en el mostrador', onReset, <Users className="size-5" />)}
        </div>
      </>,
      'md:max-w-lg'
    )
  }

  // ─── CIERRE ─────────────────────────────────────────────────────────────────

  if (step === 'success') {
    const notas: string[] = []
    if (adoptedEntry) {
      notas.push('Ya estabas anotado: sumamos tu turno a tu lugar en la fila.')
    }
    if (faceJustEnrolled) {
      notas.push('La próxima vez entrás con sólo mirar la cámara.')
    }

    return (
      <AppointmentConfirmation
        barberName={appointment?.barber_name ?? null}
        appointmentTime={appointment ? format(parseISO(appointment.starts_at), 'HH:mm') : null}
        title="¡Listo, avisamos que llegaste!"
        message={
          appointment?.barber_name ? (
            <>
              <span className={cn('font-bold', isLightBg ? 'text-zinc-900' : 'text-white')}>
                {appointment.barber_name}
              </span>{' '}
              ya sabe que estás acá.
            </>
          ) : undefined
        }
        notes={notas}
        onReset={onReset}
        isLightBg={isLightBg}
      />
    )
  }

  // Estado inconsistente (p. ej. `appointment` se perdió): volver a cero es
  // preferible a dejar la tablet en blanco.
  return contenedor(
    <>
      {encabezado('Empecemos de nuevo')}
      {botonPrimario('Volver al inicio', onReset, { tone: 'cyan' })}
    </>,
    'md:max-w-md'
  )
}
