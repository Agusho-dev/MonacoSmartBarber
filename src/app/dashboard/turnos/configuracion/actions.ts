'use server'

import { revalidatePath } from 'next/cache'
import { currentUserCan } from '@/lib/actions/permissions-gate'
import { saveBarberAppointmentDays } from '@/lib/actions/appointment-days'
import {
  updateAppointmentSettings,
  toggleAppointmentStaff,
  updateAppointmentStaffWalkinMode,
} from '@/lib/actions/appointments'
import type { AppointmentSettings } from '@/lib/types/database'

// ─── Tipos del payload ───────────────────────────────────────────────

interface DiaDeAgendaInput {
  dia: number
  /** Ambas en null = toma turnos durante toda su jornada de ese día. */
  inicio: string | null
  fin: string | null
}

/**
 * Agenda completa de UN barbero en la sucursal. Va entera, no por celda:
 * `saveBarberAppointmentDays` reemplaza todos sus días de una (delete+insert),
 * que es lo que hace el guardado idempotente. Lista vacía = lo saca de la
 * agenda de turnos.
 */
interface AgendaDeBarbero {
  staffId: string
  dias: DiaDeAgendaInput[]
}

interface BarberoTurnos {
  staffId: string
  recibeTurnos: boolean
  soloTurnos: boolean
}

/**
 * Campos que esta pantalla puede escribir. Es una allowlist a propósito: el
 * payload viene del browser y `updateAppointmentSettings` acepta cualquier
 * columna de la tabla. Los campos de prepago quedaron FUERA (ver la nota del
 * módulo) para que no se puedan tocar ni por accidente ni por un request armado
 * a mano.
 */
export interface ReglasTurnero {
  is_enabled: boolean
  appointment_hours_open: string
  appointment_hours_close: string
  appointment_days: number[]
  slot_interval_minutes: number
  buffer_minutes: number
  lead_time_minutes: number
  max_advance_days: number
  no_show_tolerance_minutes: number
  cancellation_min_hours: number
  reminder_hours_before_list: number[]
  confirmation_template_id: string | null
  reminder_template_id: string | null
  reschedule_template_id: string | null
  cancellation_template_id: string | null
  waitlist_template_id: string | null
  brand_primary_color: string
  brand_bg_color: string
  brand_text_color: string
  welcome_message: string | null
}

export interface GuardarConfiguracionInput {
  /** Sucursal en pantalla: define a quién pertenece la grilla semanal. */
  branchId: string
  /**
   * Dónde vive la fila de `appointment_settings` que estamos editando. Si la
   * sucursal tiene override propio se escribe ahí; si no, en la fila org-level
   * (branch_id NULL) que es la que aplica a todas las sucursales.
   */
  alcanceReglas: 'org' | 'sucursal'
  reglas: ReglasTurnero | null
  /** Sólo los barberos cuya agenda cambió: el resto no se toca. */
  agenda: AgendaDeBarbero[]
  barberos: BarberoTurnos[]
  /** Escotilla de salida para orgs que quedaron en prepago (circuito roto). */
  pasarAPagoPosterior?: boolean
}

export interface GuardarConfiguracionResultado {
  ok: boolean
  /** Errores por sección, en lenguaje llano. Vacío = todo guardado. */
  errores: string[]
}

const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/
const COLOR_VALIDO = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// 45 está en la lista porque es el valor productivo de Monaco: dejarlo afuera
// haría que el primer guardado le cambiara la grilla sin que nadie lo pida.
const PASOS_VALIDOS = [5, 10, 15, 20, 30, 45, 60]

function acotar(valor: number, min: number, max: number, porDefecto: number): number {
  if (!Number.isFinite(valor)) return porDefecto
  return Math.min(max, Math.max(min, Math.round(valor)))
}

function saneaColor(valor: string, porDefecto: string): string {
  return COLOR_VALIDO.test(valor.trim()) ? valor.trim() : porDefecto
}

/**
 * Días de agenda de un barbero: uno por día de la semana, con la franja bien
 * formada (las dos horas o ninguna).
 */
function saneaDiasDeAgenda(
  dias: DiaDeAgendaInput[]
): { dias: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }>; error?: string } {
  // Una entrada por FRANJA, no por día: desde la mig 182 un día puede venir
  // cortado ("10 a 13 y 16 a 19") y llega como varias entradas con el mismo
  // `dia`. El tope es 7 días × 6 franjas — generoso para cualquier agenda real
  // y acotado para que un payload manipulado no inserte miles de filas.
  const limpios: Array<{ day_of_week: number; start_time: string | null; end_time: string | null }> = []

  for (const d of dias.slice(0, 42)) {
    const dia = Number(d.dia)
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
      return { dias: [], error: 'Día de la semana inválido' }
    }

    const inicio = d.inicio ? d.inicio.slice(0, 5) : null
    const fin = d.fin ? d.fin.slice(0, 5) : null

    // Sin franja = toda su jornada. Es la opción por defecto de la grilla.
    if (inicio === null && fin === null) {
      limpios.push({ day_of_week: dia, start_time: null, end_time: null })
      continue
    }
    if (inicio === null || fin === null) {
      return { dias: [], error: 'Cargá las dos horas de la franja o ninguna' }
    }
    if (!HORA_VALIDA.test(inicio) || !HORA_VALIDA.test(fin)) {
      return { dias: [], error: 'Horario inválido' }
    }
    if (fin <= inicio) {
      return { dias: [], error: 'La hora de fin tiene que ser posterior a la de inicio' }
    }
    limpios.push({ day_of_week: dia, start_time: inicio, end_time: fin })
  }

  // El solape entre franjas del mismo día lo valida `saveBarberAppointmentDays`,
  // que es la dueña de la tabla y ve el conjunto completo.
  return { dias: limpios.sort((a, b) => a.day_of_week - b.day_of_week) }
}

/**
 * Guarda TODO lo que se editó en la pantalla en una sola pasada: reglas del
 * turnero, quién recibe turnos y qué días los toma cada uno.
 *
 * Es un orquestador, no un writer nuevo: cada pieza va por la server action que
 * ya era dueña de esa tabla (`saveBarberAppointmentDays` para
 * `appointment_staff_days`, `toggleAppointmentStaff` para `appointment_staff`,
 * `updateAppointmentSettings` para `appointment_settings`). Duplicar la
 * escritura acá crearía una segunda fuente de verdad para el mismo dato.
 *
 * Esta pantalla NO escribe `staff_schedules`: la jornada de trabajo (fichaje,
 * tardanzas, calendario) es otro eje y se edita en Equipo/Calendario. Hasta la
 * migración 171 compartían tabla, y por eso decir "Fabri sólo toma turnos los
 * martes" le apagaba el resto de la semana de trabajo.
 */
export async function guardarConfiguracionTurnos(
  input: GuardarConfiguracionInput
): Promise<GuardarConfiguracionResultado> {
  if (!(await currentUserCan('appointments.configure'))) {
    return { ok: false, errores: ['No tenés permiso para configurar turnos'] }
  }

  const errores: string[] = []

  // 1. Reglas del turnero ────────────────────────────────────────────
  if (input.reglas) {
    const r = input.reglas
    const apertura = HORA_VALIDA.test(r.appointment_hours_open) ? r.appointment_hours_open : '09:00'
    const cierre = HORA_VALIDA.test(r.appointment_hours_close) ? r.appointment_hours_close : '21:00'

    if (cierre <= apertura) {
      errores.push('El horario del local cierra antes de abrir: revisá "Horario en que se toman turnos".')
    } else {
      const patch: Partial<AppointmentSettings> = {
        is_enabled: !!r.is_enabled,
        appointment_hours_open: apertura,
        appointment_hours_close: cierre,
        appointment_days: [...new Set(r.appointment_days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
        slot_interval_minutes: PASOS_VALIDOS.includes(r.slot_interval_minutes) ? r.slot_interval_minutes : 15,
        buffer_minutes: acotar(r.buffer_minutes, 0, 120, 0),
        lead_time_minutes: acotar(r.lead_time_minutes, 0, 1440, 0),
        max_advance_days: acotar(r.max_advance_days, 1, 90, 30),
        no_show_tolerance_minutes: acotar(r.no_show_tolerance_minutes, 0, 60, 15),
        cancellation_min_hours: acotar(r.cancellation_min_hours, 0, 48, 2),
        reminder_hours_before_list: [...new Set(
          r.reminder_hours_before_list.filter(h => Number.isFinite(h) && h > 0 && h <= 168).map(h => Math.round(h))
        )].sort((a, b) => b - a),
        confirmation_template_id: r.confirmation_template_id,
        reminder_template_id: r.reminder_template_id,
        reschedule_template_id: r.reschedule_template_id,
        cancellation_template_id: r.cancellation_template_id,
        waitlist_template_id: r.waitlist_template_id,
        brand_primary_color: saneaColor(r.brand_primary_color, '#0f172a'),
        brand_bg_color: saneaColor(r.brand_bg_color, '#ffffff'),
        brand_text_color: saneaColor(r.brand_text_color, '#0f172a'),
        welcome_message: r.welcome_message?.trim() ? r.welcome_message.trim().slice(0, 240) : null,
      }

      // `reminder_hours_before` es la columna vieja (un solo recordatorio) y
      // sigue siendo NOT NULL: se mantiene apuntando al recordatorio más lejano.
      patch.reminder_hours_before = patch.reminder_hours_before_list?.[0] ?? 0

      if (input.pasarAPagoPosterior) patch.payment_mode = 'postpago'

      const res = await updateAppointmentSettings(
        patch,
        input.alcanceReglas === 'sucursal' ? input.branchId : undefined
      )
      if (res.error) errores.push(`Reglas del turnero: ${res.error}`)
    }
  }

  // 2. Quién recibe turnos ───────────────────────────────────────────
  // Antes que la agenda: un barbero recién habilitado tiene que existir en
  // `appointment_staff` cuando sus días aterrizan, o queda con días cargados y
  // el motor sin candidato.
  for (const barbero of input.barberos) {
    const res = await toggleAppointmentStaff(barbero.staffId, barbero.recibeTurnos)
    if (res.error) {
      errores.push(`Barberos habilitados: ${res.error}`)
      continue
    }
    if (barbero.recibeTurnos) {
      const modo = await updateAppointmentStaffWalkinMode(
        barbero.staffId,
        barbero.soloTurnos ? 'appointments_only' : 'both'
      )
      if (modo.error) errores.push(`Barberos habilitados: ${modo.error}`)
    }
  }

  // 3. Qué días toma turnos cada uno ──────────────────────────────────
  // `saveBarberAppointmentDays` reemplaza los días de ESE barbero en ESA
  // sucursal, así que el payload va completo por barbero (no por celda) y una
  // lista vacía lo saca de la agenda sin tocarle nada más.
  for (const barbero of input.agenda) {
    const { dias, error } = saneaDiasDeAgenda(barbero.dias ?? [])
    if (error) {
      errores.push(`${error} (revisá la grilla semanal)`)
      continue
    }
    const res = await saveBarberAppointmentDays(input.branchId, barbero.staffId, dias)
    if ('error' in res) errores.push(`Días de turnos: ${res.error}`)
  }

  revalidatePath('/dashboard/turnos/configuracion')

  return { ok: errores.length === 0, errores }
}
