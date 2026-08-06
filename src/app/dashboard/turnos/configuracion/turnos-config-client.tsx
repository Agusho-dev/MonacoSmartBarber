'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Loader2, TriangleAlert, Undo2, Store, CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { AppointmentSettings } from '@/lib/types/database'
import type { TemplateOption } from '@/components/messaging/template-picker-select'
import type { BranchOperationMode } from '@/lib/actions/turnos-mode'
import { EstadoTurnero, type ItemEstado } from '@/components/appointments/config/estado-turnero'
import { ModoOperacion } from '@/components/appointments/config/modo-operacion'
import { SemanaBarberos } from '@/components/appointments/config/semana-barberos'
import { ReglasTurnero, type ValoresReglas } from '@/components/appointments/config/reglas-turnero'
import { MensajesTurnero, type ValoresMensajes } from '@/components/appointments/config/mensajes-turnero'
import { MarcaTurnero, type ValoresMarca } from '@/components/appointments/config/marca-turnero'
import {
  NOMBRES_DIAS,
  ORDEN_SEMANA,
  agendaTieneDias,
  clonarAgenda,
  diasConTurnos,
  franjasIguales,
  normalizarHora,
  tramosDeTurnos,
  type AgendaTurnos,
  type BarberoConfig,
  type DiaDeAgenda,
  type JornadaSemanal,
  type ServicioReservable,
} from '@/components/appointments/config/tipos'
import { guardarConfiguracionTurnos } from './actions'

interface SucursalResumen {
  id: string
  nombre: string
  slug: string | null
  modo: BranchOperationMode
}

interface Props {
  sucursales: SucursalResumen[]
  sucursalActivaId: string | null
  modoSucursal: BranchOperationMode
  slugSucursal: string | null
  /** Dónde vive la fila de settings que se está editando. */
  alcanceReglas: 'org' | 'sucursal'
  settings: AppointmentSettings | null
  barberos: BarberoConfig[]
  /** Quién toma turnos cada día (`appointment_staff_days`). Lo que se edita. */
  agenda: AgendaTurnos
  /** Jornada de trabajo (`staff_schedules`). Contexto de sólo lectura. */
  jornada: JornadaSemanal
  /** ¿La sucursal ya tiene agenda por día guardada? */
  usaAgendaPorDia: boolean
  /**
   * Hay días cargados de barberos que no se dibujan en la grilla (dados de baja
   * o movidos de sucursal). No se pueden editar acá, pero mantienen a la
   * sucursal en el modelo por día.
   */
  hayDiasDeBarberosOcultos: boolean
  servicios: ServicioReservable[]
  templates: TemplateOption[]
  hasWhatsAppChannel: boolean
  org: { nombre: string; slug: string; logoUrl: string | null }
}

interface Estado {
  prendido: boolean
  reglas: ValoresReglas
  mensajes: ValoresMensajes
  marca: ValoresMarca
  agenda: AgendaTurnos
  barberos: BarberoConfig[]
}

const DIAS_POR_DEFECTO = [1, 2, 3, 4, 5, 6]

function estadoInicial(props: Props): Estado {
  const s = props.settings
  return {
    prendido: s?.is_enabled ?? false,
    reglas: {
      // La DB devuelve `time` con segundos y `<input type="time">` no lo dibuja:
      // sin normalizar, los campos de horario aparecían vacíos.
      apertura: normalizarHora(s?.appointment_hours_open) || '09:00',
      cierre: normalizarHora(s?.appointment_hours_close) || '21:00',
      dias: s?.appointment_days?.length ? [...s.appointment_days].sort() : DIAS_POR_DEFECTO,
      paso: s?.slot_interval_minutes ?? 15,
      descanso: s?.buffer_minutes ?? 10,
      anticipacionMinima: s?.lead_time_minutes ?? 60,
      diasMaximos: s?.max_advance_days ?? 30,
      toleranciaTardanza: s?.no_show_tolerance_minutes ?? 15,
      horasParaCancelar: s?.cancellation_min_hours ?? 2,
    },
    mensajes: {
      confirmacion: s?.confirmation_template_id ?? null,
      recordatorio: s?.reminder_template_id ?? null,
      reprogramacion: s?.reschedule_template_id ?? null,
      cancelacion: s?.cancellation_template_id ?? null,
      esperaLiberada: s?.waitlist_template_id ?? null,
      recordatorios: s?.reminder_hours_before_list?.length ? [...s.reminder_hours_before_list].sort((a, b) => b - a) : [24, 2],
    },
    marca: {
      primario: s?.brand_primary_color ?? '#0f172a',
      fondo: s?.brand_bg_color ?? '#ffffff',
      texto: s?.brand_text_color ?? '#0f172a',
      bienvenida: s?.welcome_message ?? '',
    },
    agenda: clonarAgenda(props.agenda),
    barberos: props.barberos.map(b => ({ ...b })),
  }
}

export function TurnosConfigClient(props: Props) {
  const {
    sucursales,
    sucursalActivaId,
    modoSucursal,
    slugSucursal,
    alcanceReglas,
    settings,
    jornada,
    usaAgendaPorDia: usaAgendaPorDiaGuardada,
    hayDiasDeBarberosOcultos,
    servicios,
    templates,
    hasWhatsAppChannel,
    org,
  } = props

  const router = useRouter()
  const [guardando, iniciarGuardado] = useTransition()
  const [estado, setEstado] = useState<Estado>(() => estadoInicial(props))
  const [guardado, setGuardado] = useState<Estado>(estado)
  const [forzarPagoPosterior, setForzarPagoPosterior] = useState(false)
  // El aviso de "esta sucursal cambia de modelo" se muestra una sola vez, al
  // prender la primera celda. Si el dueño lo cancela, no queda visto.
  const [avisoModeloVisto, setAvisoModeloVisto] = useState(false)
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string
    descripcion: string
    etiqueta: string
    accion: () => void
  } | null>(null)

  const sucursalActiva = sucursales.find(s => s.id === sucursalActivaId) ?? null

  // ─── Diferencias contra lo último guardado ─────────────────────────

  // La agenda se guarda por barbero (la action reemplaza todos sus días de una
  // sola vez), pero se marca sucia por celda: la celda es la unidad que el dueño
  // toca.
  const cambiosAgenda = useMemo(() => {
    const porBarbero: Array<{ staffId: string; dias: Array<{ dia: number; inicio: string | null; fin: string | null }> }> = []
    const sucias = new Set<string>()

    for (const barbero of estado.barberos) {
      let cambio = false
      for (let dia = 0; dia <= 6; dia++) {
        if (!franjasIguales(estado.agenda[barbero.id]?.[dia], guardado.agenda[barbero.id]?.[dia])) {
          sucias.add(`${barbero.id}:${dia}`)
          cambio = true
        }
      }
      if (!cambio) continue
      porBarbero.push({
        staffId: barbero.id,
        dias: diasConTurnos(estado.agenda, barbero.id).map(dia => {
          const franja = estado.agenda[barbero.id][dia].franja
          return { dia, inicio: franja?.inicio ?? null, fin: franja?.fin ?? null }
        }),
      })
    }

    return { porBarbero, sucias }
  }, [estado.agenda, estado.barberos, guardado.agenda])

  const barberosCambiados = useMemo(() => {
    return estado.barberos.filter(b => {
      const antes = guardado.barberos.find(g => g.id === b.id)
      if (!antes) return false
      return antes.recibeTurnos !== b.recibeTurnos || antes.soloTurnos !== b.soloTurnos
    })
  }, [estado.barberos, guardado.barberos])

  const reglasCambiadas =
    forzarPagoPosterior ||
    estado.prendido !== guardado.prendido ||
    JSON.stringify(estado.reglas) !== JSON.stringify(guardado.reglas) ||
    JSON.stringify(estado.mensajes) !== JSON.stringify(guardado.mensajes) ||
    JSON.stringify(estado.marca) !== JSON.stringify(guardado.marca)

  const hayCambios = reglasCambiadas || cambiosAgenda.porBarbero.length > 0 || barberosCambiados.length > 0

  /**
   * ¿La sucursal va a trabajar con agenda por día? Se mira el estado EN
   * PANTALLA, no lo guardado: apenas el dueño prende la primera celda, la previa
   * y el checklist tienen que hablar del modelo nuevo — y si las apaga todas,
   * del viejo. Los días de barberos que ya no están en la grilla igual cuentan:
   * el motor los ve.
   */
  const usaAgendaPorDia = hayDiasDeBarberosOcultos || agendaTieneDias(estado.agenda)

  // Cerrar la pestaña con cambios sin guardar es la forma más silenciosa de
  // perder media hora de configuración.
  useEffect(() => {
    if (!hayCambios) return
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [hayCambios])

  // ─── Mutadores ─────────────────────────────────────────────────────

  function cambiarDia(staffId: string, dia: number, valor: DiaDeAgenda | null) {
    const aplicar = () =>
      setEstado(prev => {
        const dias = { ...(prev.agenda[staffId] ?? {}) }
        if (valor) dias[dia] = valor
        else delete dias[dia]
        return {
          ...prev,
          agenda: { ...prev.agenda, [staffId]: dias },
          // Marcar un día ES decir "este barbero toma turnos": si el interruptor
          // estaba apagado se prende solo, porque sin fila en `appointment_staff`
          // el motor nunca lo ofrece y el día quedaría muerto.
          barberos: valor
            ? prev.barberos.map(b => (b.id === staffId ? { ...b, recibeTurnos: true } : b))
            : prev.barberos,
        }
      })

    // Primera celda de la sucursal: deja de valer "atiende cualquiera que
    // trabaje" y pasa a valer sólo lo que esté marcado. Es un cambio de
    // comportamiento real, no una preferencia visual.
    const esLaPrimera =
      !!valor && !usaAgendaPorDiaGuardada && !hayDiasDeBarberosOcultos && !agendaTieneDias(estado.agenda)

    if (esLaPrimera && !avisoModeloVisto) {
      setConfirmacion({
        titulo: 'A partir de acá, la agenda la definís vos',
        descripcion:
          'Hoy esta sucursal ofrece turnos con cualquier barbero habilitado que trabaje ese día. ' +
          'Al marcar el primer día pasa a ofrecer únicamente los días que marques: los que queden ' +
          'en blanco no van a mostrar ningún horario, aunque el barbero trabaje. Su jornada de ' +
          'trabajo, el fichaje y la asistencia no cambian.',
        etiqueta: 'Marcar el día',
        accion: () => {
          setAvisoModeloVisto(true)
          aplicar()
        },
      })
      return
    }

    aplicar()
  }

  function cambiarBarbero(staffId: string, cambio: { recibeTurnos?: boolean; soloTurnos?: boolean }) {
    setEstado(prev => ({
      ...prev,
      barberos: prev.barberos.map(b => (b.id === staffId ? { ...b, ...cambio } : b)),
      // "No recibe turnos" y "tiene días de turnos cargados" no pueden convivir:
      // apagar el interruptor le limpia la agenda (se ve en la grilla al toque, y
      // Descartar lo revierte).
      agenda: cambio.recibeTurnos === false ? { ...prev.agenda, [staffId]: {} } : prev.agenda,
    }))
  }

  function irASeccion(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function cambiarSucursal(id: string) {
    if (id === sucursalActivaId) return
    const ir = () => router.push(`/dashboard/turnos/configuracion?sucursal=${id}`)
    if (!hayCambios) {
      ir()
      return
    }
    setConfirmacion({
      titulo: 'Tenés cambios sin guardar',
      descripcion: 'Si cambiás de sucursal ahora, se pierden los cambios que hiciste en esta pantalla.',
      etiqueta: 'Cambiar igual',
      accion: ir,
    })
  }

  function descartar() {
    setConfirmacion({
      titulo: '¿Descartar los cambios?',
      descripcion: 'Vuelve todo a como estaba la última vez que guardaste.',
      etiqueta: 'Descartar',
      accion: () => {
        setEstado(guardado)
        setForzarPagoPosterior(false)
        setAvisoModeloVisto(false)
      },
    })
  }

  function guardar() {
    iniciarGuardado(async () => {
      const resultado = await guardarConfiguracionTurnos({
        branchId: sucursalActivaId ?? '',
        alcanceReglas: alcanceReglas === 'sucursal' ? 'sucursal' : 'org',
        reglas: reglasCambiadas
          ? {
              is_enabled: estado.prendido,
              appointment_hours_open: estado.reglas.apertura,
              appointment_hours_close: estado.reglas.cierre,
              appointment_days: estado.reglas.dias,
              slot_interval_minutes: estado.reglas.paso,
              buffer_minutes: estado.reglas.descanso,
              lead_time_minutes: estado.reglas.anticipacionMinima,
              max_advance_days: estado.reglas.diasMaximos,
              no_show_tolerance_minutes: estado.reglas.toleranciaTardanza,
              cancellation_min_hours: estado.reglas.horasParaCancelar,
              reminder_hours_before_list: estado.mensajes.recordatorios,
              confirmation_template_id: estado.mensajes.confirmacion,
              reminder_template_id: estado.mensajes.recordatorio,
              reschedule_template_id: estado.mensajes.reprogramacion,
              cancellation_template_id: estado.mensajes.cancelacion,
              waitlist_template_id: estado.mensajes.esperaLiberada,
              brand_primary_color: estado.marca.primario,
              brand_bg_color: estado.marca.fondo,
              brand_text_color: estado.marca.texto,
              welcome_message: estado.marca.bienvenida,
            }
          : null,
        agenda: cambiosAgenda.porBarbero,
        barberos: barberosCambiados.map(b => ({
          staffId: b.id,
          recibeTurnos: b.recibeTurnos,
          soloTurnos: b.soloTurnos,
        })),
        pasarAPagoPosterior: forzarPagoPosterior,
      })

      if (!resultado.ok) {
        toast.error(resultado.errores[0] ?? 'No pudimos guardar los cambios')
        // A propósito NO refrescamos: el refresh remonta la pantalla (ver la
        // `key` de la page) y se llevaría puestos los cambios que todavía no
        // entraron. Reintentar el guardado es idempotente.
        return
      }

      setGuardado(estado)
      setForzarPagoPosterior(false)
      toast.success('Configuración guardada')
      router.refresh()
    })
  }

  // ─── Checklist ─────────────────────────────────────────────────────

  const barberosQueAtienden = estado.barberos.filter(b => b.recibeTurnos)

  /**
   * Barberos habilitados que el turnero no va a ofrecer NINGÚN día. Se mide
   * contra la agenda por día cuando la sucursal la usa, y contra la jornada de
   * trabajo cuando sigue con el modelo viejo: es exactamente el criterio del
   * motor en cada caso.
   */
  const sinDias = barberosQueAtienden.filter(
    b =>
      !ORDEN_SEMANA.some(
        dia =>
          tramosDeTurnos({ agenda: estado.agenda, jornada, staffId: b.id, dia, usaAgendaPorDia }).length > 0
      )
  )
  // Días abiertos a reservas en los que el cliente no va a ver ni un horario.
  const diasSinNadie = ORDEN_SEMANA.filter(
    dia =>
      estado.reglas.dias.includes(dia) &&
      !barberosQueAtienden.some(
        b =>
          tramosDeTurnos({ agenda: estado.agenda, jornada, staffId: b.id, dia, usaAgendaPorDia }).length > 0
      )
  )
  const diasAbiertos = estado.reglas.dias.length
  const serviciosSinDuracion = servicios.filter(s => !s.duracionMinutos || s.duracionMinutos <= 0)
  const serviciosConDuracion = servicios.filter(s => s.duracionMinutos && s.duracionMinutos > 0)

  const items: ItemEstado[] = [
    {
      id: 'modo',
      titulo: 'Esta sucursal acepta turnos',
      ok: modoSucursal !== 'walk_in',
      detalle:
        modoSucursal === 'walk_in'
          ? 'Hoy trabaja sólo por orden de llegada: el link de reservas avisa que no hace falta turno.'
          : undefined,
      accion: { etiqueta: 'Cambiar', onClick: () => irASeccion('seccion-modo') },
    },
    {
      id: 'prendido',
      titulo: 'Las reservas online están prendidas',
      ok: estado.prendido,
      pendiente: estado.prendido !== (settings?.is_enabled ?? false),
      detalle: estado.prendido ? undefined : 'El turnero está apagado: nadie puede reservar aunque el resto esté listo.',
      accion: { etiqueta: 'Prender', onClick: () => setEstado(prev => ({ ...prev, prendido: true })) },
    },
    {
      id: 'barberos',
      titulo: 'Hay barberos que reciben turnos',
      ok: barberosQueAtienden.length > 0,
      pendiente: barberosCambiados.length > 0,
      detalle:
        barberosQueAtienden.length > 0
          ? `${barberosQueAtienden.length} de ${estado.barberos.length}: ${barberosQueAtienden.map(b => b.nombre).join(', ')}`
          : 'Ninguno está habilitado, así que el turnero no muestra horarios.',
      accion: { etiqueta: 'Elegir', onClick: () => irASeccion('seccion-semana') },
    },
    {
      id: 'agenda',
      titulo: 'Está definido quién atiende cada día',
      // No bloquea: sin agenda por día el turnero funciona igual, ofreciendo a
      // todos. Pero el dueño tiene que saber que la rotación que tiene en la
      // cabeza todavía no está escrita en ningún lado.
      ok: true,
      aviso: !usaAgendaPorDia || diasSinNadie.length > 0,
      pendiente: usaAgendaPorDia && !usaAgendaPorDiaGuardada,
      detalle: !usaAgendaPorDia
        ? 'Esta sucursal todavía no lo definió: por ahora el turnero ofrece a cualquier barbero habilitado que trabaje ese día. Si tu agenda rota (uno los martes, otro los miércoles), marcá los días en la grilla.'
        : diasSinNadie.length
          ? `Nadie toma turnos ${listarDias(diasSinNadie)}: esos días el cliente no va a ver ningún horario.`
          : `Los ${diasAbiertos} días abiertos a reservas tienen a alguien asignado.`,
      accion: { etiqueta: 'Definir', onClick: () => irASeccion('seccion-semana') },
    },
    {
      id: 'dias',
      titulo: usaAgendaPorDia
        ? 'Cada barbero habilitado tiene al menos un día'
        : 'Cada barbero habilitado tiene horario cargado',
      ok: barberosQueAtienden.length > 0 && sinDias.length === 0,
      pendiente: cambiosAgenda.porBarbero.length > 0,
      detalle: sinDias.length
        ? usaAgendaPorDia
          ? `Sin ningún día de turnos: ${sinDias.map(b => b.nombre).join(', ')}. El turnero no los ofrece nunca.`
          : `Sin horario de trabajo cargado: ${sinDias.map(b => b.nombre).join(', ')}. El motor los saltea en silencio.`
        : barberosQueAtienden.length === 0
          ? 'Primero marcá quién recibe turnos.'
          : undefined,
      accion: usaAgendaPorDia
        ? { etiqueta: 'Cargar', onClick: () => irASeccion('seccion-semana') }
        : { etiqueta: 'Horarios', href: '/dashboard/calendario' },
    },
    {
      id: 'servicios',
      titulo: 'Los servicios reservables tienen duración',
      ok: serviciosConDuracion.length > 0 && serviciosSinDuracion.length === 0,
      detalle: !servicios.length
        ? 'No hay ningún servicio habilitado para reservar online.'
        : serviciosSinDuracion.length
          ? `Sin duración: ${serviciosSinDuracion.map(s => s.nombre).join(', ')}. Sin ese dato no se sabe cuánto ocupa el turno.`
          : `${serviciosConDuracion.length} servicios listos para reservar.`,
      accion: { etiqueta: 'Servicios', href: '/dashboard/servicios' },
    },
    {
      id: 'whatsapp',
      titulo: 'Se avisa por WhatsApp al reservar',
      ok: hasWhatsAppChannel && !!estado.mensajes.confirmacion,
      pendiente: estado.mensajes.confirmacion !== (settings?.confirmation_template_id ?? null),
      detalle: !hasWhatsAppChannel
        ? 'WhatsApp no está conectado. Los turnos funcionan igual, pero el cliente no recibe confirmación.'
        : !estado.mensajes.confirmacion
          ? 'Falta elegir el mensaje de confirmación.'
          : undefined,
      accion: hasWhatsAppChannel
        ? { etiqueta: 'Elegir', onClick: () => irASeccion('seccion-mensajes') }
        : { etiqueta: 'Conectar', href: '/dashboard/mensajeria?settings=1' },
    },
  ]

  // ─── Sin sucursales accesibles ─────────────────────────────────────

  if (!sucursalActiva || !sucursalActivaId) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Store className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="font-medium">No hay sucursales para configurar</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Creá una sucursal desde Configuración y volvé a esta pantalla.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-5', hayCambios && 'pb-24')}>
      {/* Barra de contexto: sucursal + interruptor maestro */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configurando</p>
          <div className="flex flex-wrap gap-1.5">
            {sucursales.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => cambiarSucursal(s.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  s.id === sucursalActivaId
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                )}
              >
                {s.nombre}
                {s.modo !== 'walk_in' && (
                  <CalendarCheck
                    className={cn('size-3.5', s.id === sucursalActivaId ? 'opacity-80' : 'text-emerald-500')}
                  />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="text-right">
            <p className="text-sm font-medium leading-tight">Reservas online</p>
            <p className="text-xs text-muted-foreground">
              {alcanceReglas === 'org' ? 'Vale para todas tus sucursales' : 'Sólo para esta sucursal'}
            </p>
          </div>
          <Switch
            checked={estado.prendido}
            onCheckedChange={valor => setEstado(prev => ({ ...prev, prendido: valor }))}
            aria-label="Reservas online"
          />
        </div>
      </div>

      {/* Escotilla de salida: el prepago quedó fuera de la pantalla porque su
          circuito de cobro no funciona, pero una org que ya lo tenía prendido
          necesita poder salir de ahí. */}
      {settings?.payment_mode === 'prepago' && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Los turnos están pidiendo pago por adelantado</p>
              <p className="text-xs text-muted-foreground">
                Ese cobro no está operativo: los turnos quedan trabados en &ldquo;esperando pago&rdquo; y el
                cliente nunca recibe la confirmación.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={forzarPagoPosterior}
            onClick={() => setForzarPagoPosterior(true)}
          >
            {forzarPagoPosterior ? 'Listo, guardá los cambios' : 'Cobrar después del servicio'}
          </Button>
        </div>
      )}

      <EstadoTurnero
        items={items}
        linkPublico={slugSucursal ? `/turnos/${slugSucursal}` : null}
        hayCambiosSinGuardar={hayCambios}
      />

      <ModoOperacion sucursal={{ id: sucursalActiva.id, nombre: sucursalActiva.nombre }} modo={modoSucursal} />

      <SemanaBarberos
        barberos={estado.barberos}
        agenda={estado.agenda}
        jornada={jornada}
        usaAgendaPorDia={usaAgendaPorDia}
        diasHabilitados={estado.reglas.dias}
        horarioLocal={{ inicio: estado.reglas.apertura, fin: estado.reglas.cierre }}
        celdasSucias={cambiosAgenda.sucias}
        onCambiarDia={cambiarDia}
        onCambiarBarbero={cambiarBarbero}
      />

      <ReglasTurnero
        valores={estado.reglas}
        onCambiar={cambio => setEstado(prev => ({ ...prev, reglas: { ...prev.reglas, ...cambio } }))}
        barberos={estado.barberos}
        agenda={estado.agenda}
        jornada={jornada}
        usaAgendaPorDia={usaAgendaPorDia}
        servicios={servicios}
      />

      <MensajesTurnero
        valores={estado.mensajes}
        onCambiar={cambio => setEstado(prev => ({ ...prev, mensajes: { ...prev.mensajes, ...cambio } }))}
        templates={templates}
        hayCanalWhatsApp={hasWhatsAppChannel}
      />

      <MarcaTurnero
        valores={estado.marca}
        onCambiar={cambio => setEstado(prev => ({ ...prev, marca: { ...prev.marca, ...cambio } }))}
        org={org}
        sucursales={sucursales.map(s => s.nombre)}
      />

      {/* Barra de guardado */}
      {hayCambios && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm">
              <span className="size-2 shrink-0 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">
                {describirCambios(cambiosAgenda.sucias.size, barberosCambiados.length, reglasCambiadas)}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={descartar} disabled={guardando}>
                <Undo2 className="mr-1.5 size-3.5" />
                Descartar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!confirmacion} onOpenChange={abierto => !abierto && setConfirmacion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmacion?.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{confirmacion?.descripcion}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmacion?.accion()
                setConfirmacion(null)
              }}
            >
              {confirmacion?.etiqueta}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** "los martes", "los martes y los jueves", "los martes, los jueves y los sábados". */
function listarDias(dias: number[]): string {
  const nombres = dias.map(d => `los ${NOMBRES_DIAS[d].toLowerCase()}`)
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

function describirCambios(dias: number, barberos: number, reglas: boolean): string {
  const partes: string[] = []
  if (dias) partes.push(`${dias} ${dias === 1 ? 'día' : 'días'} de agenda`)
  if (barberos) partes.push(`${barberos} ${barberos === 1 ? 'barbero' : 'barberos'}`)
  if (reglas) partes.push('reglas del turnero')
  if (!partes.length) return 'Hay cambios sin guardar'
  return `Sin guardar: ${partes.join(' · ')}`
}
