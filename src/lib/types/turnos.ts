/**
 * Tipos compartidos del sistema de turnos.
 * Reusables entre dashboard, kiosk, panel barbero y server actions.
 */

export type BranchOperationMode = 'walk_in' | 'appointments' | 'hybrid'

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type AppointmentSource =
  | 'public'
  | 'public_link'
  | 'manual'
  | 'dashboard'
  | 'kiosk'
  | 'mobile'
  | 'whatsapp'

export type ReminderKind = 'push_24h' | 'push_2h' | 'wa_24h' | 'wa_2h'

export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled' | 'skipped'

export interface AppointmentRow {
  id: string
  organization_id: string
  branch_id: string
  client_id: string
  barber_id: string | null
  service_id: string | null
  appointment_date: string
  start_time: string
  end_time: string
  duration_minutes: number
  status: AppointmentStatus
  source: AppointmentSource | string
  cancellation_token: string | null
  queue_entry_id: string | null
  created_by_staff_id: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  no_show_marked_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  /** tstzrange computado por trigger en mig 119 (TZ-aware via branches.timezone). */
  time_range: string
}

export interface AppointmentServiceRow {
  id: string
  appointment_id: string
  organization_id: string
  service_id: string
  sort_order: number
  duration_snapshot: number
  price_snapshot: number
  created_at: string
}

export interface AppointmentSettingsRow {
  id: string
  organization_id: string
  branch_id: string | null
  is_enabled: boolean
  slot_interval_minutes: number
  buffer_minutes: number
  lead_time_minutes: number
  no_show_tolerance_minutes: number
  cancellation_min_hours: number
  max_advance_days: number
  reminder_hours_before_list: number[]
}

export interface AvailableSlot {
  slot_start: string
  available_staff_ids: string[]
}

export interface AppointmentWithRelations extends AppointmentRow {
  client: { id: string; name: string; phone: string } | null
  barber: { id: string; full_name: string; avatar_url: string | null } | null
  branch: { id: string; name: string; slug: string; timezone: string } | null
  services: Array<{ id: string; name: string; duration: number; price: number }>
}

/**
 * Errores comunes que devuelven las RPCs como `{success:false, error: <code>}`.
 * Usar como discriminated union en server actions.
 */
export type RpcErrorCode =
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_NOT_ACCEPTING_APPOINTMENTS'
  | 'APPOINTMENTS_DISABLED'
  | 'INVALID_SERVICES_OR_DURATION'
  | 'INVALID_PHONE'
  | 'INVALID_NAME'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'BELOW_LEAD_TIME'
  | 'BRANCH_CLOSED_DAY'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'SLOT_TAKEN'
  | 'STAFF_REQUIRED'
  | 'STAFF_NOT_SCHEDULED'
  | 'STALE_DATA'
  | 'INVALID_STATUS'
  | 'NOT_CANCELLABLE'
  | 'NOT_FOUND'
  | 'NOT_FOUND_OR_NOT_CANCELLABLE'
  | 'TOO_LATE'
  | 'TOO_EARLY'
  | 'PHONE_QUOTA_EXCEEDED'
  | 'HAS_FUTURE_APPOINTMENTS'
  | 'HAS_ACTIVE_QUEUE'
  | 'FORBIDDEN'

export const RPC_ERROR_LABELS: Record<RpcErrorCode, string> = {
  BRANCH_NOT_FOUND: 'Sucursal no encontrada.',
  BRANCH_NOT_ACCEPTING_APPOINTMENTS: 'Esta sucursal no acepta turnos online.',
  APPOINTMENTS_DISABLED: 'Los turnos no están habilitados en esta sucursal.',
  INVALID_SERVICES_OR_DURATION: 'Los servicios elegidos no tienen duración configurada.',
  INVALID_PHONE: 'El teléfono ingresado no es válido.',
  INVALID_NAME: 'Ingresá tu nombre completo.',
  OUTSIDE_BOOKING_WINDOW: 'La fecha está fuera del rango de reserva.',
  BELOW_LEAD_TIME: 'No se puede reservar tan cerca del horario.',
  BRANCH_CLOSED_DAY: 'La sucursal no atiende ese día.',
  OUTSIDE_BUSINESS_HOURS: 'El horario está fuera del horario de atención.',
  SLOT_TAKEN: 'Ese horario ya no está disponible. Elegí otro.',
  STAFF_REQUIRED: 'Tenés que asignar un barbero.',
  STAFF_NOT_SCHEDULED: 'El barbero no trabaja en ese horario.',
  STALE_DATA: 'El turno fue modificado mientras editabas. Refrescá la pantalla.',
  INVALID_STATUS: 'El turno está en un estado que no permite esta acción.',
  NOT_CANCELLABLE: 'Este turno ya no se puede cancelar.',
  NOT_FOUND: 'Turno no encontrado.',
  NOT_FOUND_OR_NOT_CANCELLABLE: 'No se encontró el turno o ya no se puede cancelar.',
  TOO_LATE: 'Pasó la ventana de tolerancia. Hablá con recepción.',
  TOO_EARLY: 'Es muy temprano para hacer el check-in.',
  PHONE_QUOTA_EXCEEDED: 'Ya tenés 3 turnos activos. Cancelá alguno antes de reservar otro.',
  HAS_FUTURE_APPOINTMENTS: 'Hay turnos futuros. Resolvelos antes de cambiar el modo.',
  HAS_ACTIVE_QUEUE: 'Hay clientes en la cola. Esperá a que se atiendan.',
  FORBIDDEN: 'No tenés permisos para hacer esto.',
}
