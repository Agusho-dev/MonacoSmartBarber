// Tipos compartidos para la edge function de recordatorios de turnos.

export interface PendingReminder {
  id: string
  appointment_id: string
  organization_id: string
  kind: 'push_24h' | 'push_2h' | 'wa_24h' | 'wa_2h'
  scheduled_for: string
  // Campos del JOIN (fetched por separado)
  appointment_status: string
  starts_at_local: string  // ISO string del rango lower(time_range)
  appointment_date: string
  start_time: string
  client_id: string
  client_name: string | null
  branch_name: string | null
  branch_address: string | null
  branch_timezone: string
  barber_name: string | null
  service_names: string[]
  duration_minutes: number
}

export interface ReminderResult {
  id: string
  status: 'sent' | 'failed' | 'skipped'
  error: string | null
}

export interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default' | null
  badge?: number
  channelId?: string
}

export interface ExpoPushTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}
