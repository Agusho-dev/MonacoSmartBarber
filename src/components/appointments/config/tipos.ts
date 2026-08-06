/**
 * Tipos y utilidades compartidas por la pantalla de configuración de turnos.
 *
 * El cálculo de horarios de acá es un espejo del motor canónico
 * (`getAvailableSlots` en `src/lib/actions/appointments.ts`): sirve para la vista
 * previa en vivo, que necesita recalcular mientras el dueño toca los chips y no
 * puede ir al servidor en cada tecla. Si el motor cambia su forma de armar la
 * grilla, esto tiene que cambiar igual — es la única copia tolerada.
 */

export const NOMBRES_DIAS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
]

export const NOMBRES_DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/**
 * Orden visual de la semana: un dueño lee la semana de lunes a domingo, pero
 * `day_of_week` guarda 0=domingo. Nunca usar el índice del array como día:
 * siempre el valor.
 */
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]

/** Un tramo horario dentro de un día ("10:00"–"13:00"). Hora de pared. */
export interface Tramo {
  inicio: string
  fin: string
}

/**
 * Jornada de trabajo (`staff_schedules`): barbero → día (0-6) → tramos que
 * trabaja ese día.
 *
 * En esta pantalla es **sólo contexto, nunca se escribe**: es la misma tabla que
 * usan fichaje, tardanzas y calendario. Lo que se edita acá es la agenda de
 * turnos (`AgendaTurnos`), que es un eje distinto.
 */
export type JornadaSemanal = Record<string, Record<number, Tramo[]>>

/**
 * Un día de la agenda de turnos (`appointment_staff_days`).
 *
 * Que la clave del día exista ya significa "este barbero toma turnos ese día".
 * `franja` en `null` = los toma durante toda su jornada normal (NULL/NULL en la
 * tabla); con valor, sólo dentro de esa franja — y en ese caso ni siquiera hace
 * falta que tenga jornada cargada.
 */
export interface DiaDeAgenda {
  franja: Tramo | null
}

/** Agenda de turnos: barbero → día (0-6) → cómo toma turnos ese día. */
export type AgendaTurnos = Record<string, Record<number, DiaDeAgenda>>

export interface BarberoConfig {
  id: string
  nombre: string
  avatarUrl: string | null
  /** Fila activa en `appointment_staff`: sin esto el turnero jamás lo ofrece. */
  recibeTurnos: boolean
  /** `walkin_mode = 'appointments_only'`: no aparece en la fila de walk-in. */
  soloTurnos: boolean
}

export interface ServicioReservable {
  id: string
  nombre: string
  duracionMinutos: number | null
}

// ─── Horas ───────────────────────────────────────────────────────────

/** 'HH:MM:SS' o 'HH:MM' → 'HH:MM'. La DB devuelve time con segundos. */
export function normalizarHora(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor.slice(0, 5)
}

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

export function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "13:00" → "13 h"; "13:30" → "13:30". Para leer de un vistazo en la grilla. */
export function horaCorta(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return m === '00' ? `${Number(h)}` : `${Number(h)}:${m}`
}

export function rangoCorto(tramo: Tramo): string {
  return `${horaCorta(tramo.inicio)}–${horaCorta(tramo.fin)}`
}

// ─── Tramos ──────────────────────────────────────────────────────────

/**
 * Ordena y saca repetidos.
 *
 * `staff_schedules` NO tiene UNIQUE(staff_id, day_of_week): en producción hay
 * barberos con la misma jornada cargada dos veces. Sin esto la grilla mostraría
 * "10–19 · 10–19" y el popover dejaría editar dos filas que son la misma.
 */
export function normalizarTramos(tramos: Tramo[]): Tramo[] {
  const vistos = new Set<string>()
  const limpios: Tramo[] = []
  for (const t of tramos) {
    const inicio = normalizarHora(t.inicio)
    const fin = normalizarHora(t.fin)
    if (!inicio || !fin) continue
    const clave = `${inicio}-${fin}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    limpios.push({ inicio, fin })
  }
  return limpios.sort((a, b) => aMinutos(a.inicio) - aMinutos(b.inicio))
}

/** "10–13 · 16–21". Resumen de una jornada partida, para leer de un vistazo. */
export function resumenTramos(tramos: Tramo[]): string {
  return tramos.map(rangoCorto).join(' · ')
}

export function franjaValida(franja: Tramo): boolean {
  return (
    /^\d{2}:\d{2}$/.test(franja.inicio) &&
    /^\d{2}:\d{2}$/.test(franja.fin) &&
    aMinutos(franja.fin) > aMinutos(franja.inicio)
  )
}

// ─── Franjas del turnero (mig 172) ───────────────────────────────────

/**
 * Una ventana de `appointment_hours`: en qué horas la SUCURSAL acepta turnos.
 *
 * Es un eje distinto de `Tramo` (que en esta pantalla habla del horario de un
 * barbero) y a propósito comparte el shape exacto de la server action
 * `appointment-hours.ts`, para pasarse de una a la otra sin traducir. Se declara
 * acá y no se importa de ahí porque ese módulo es `'use server'`.
 */
export interface Franja {
  start_time: string
  end_time: string
}

/** Franjas por día (0=domingo … 6=sábado). Varias por día = día entrecortado. */
export type FranjasSemana = Record<number, Franja[]>

export function semanaSinFranjas(): FranjasSemana {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
}

export function clonarFranjas(franjas: FranjasSemana): FranjasSemana {
  const copia = semanaSinFranjas()
  for (let dia = 0; dia <= 6; dia++) copia[dia] = (franjas[dia] ?? []).map(f => ({ ...f }))
  return copia
}

/**
 * Ordena, descarta lo inválido y FUSIONA lo que se toca o se pisa.
 *
 * `saveBranchAppointmentHours` rechaza los solapes, así que normalizar acá es lo
 * que evita que el dueño se coma un error del servidor por agregar una franja
 * que ya estaba cubierta. Y dos tramos pegados (10–13 y 13–16) son un solo
 * horario: mostrarlos separados haría creer que hay un corte donde no lo hay.
 */
export function normalizarFranjasDia(franjas: Franja[]): Franja[] {
  const limpias = franjas
    .map(f => ({ start_time: normalizarHora(f.start_time), end_time: normalizarHora(f.end_time) }))
    .filter(
      f =>
        /^\d{2}:\d{2}$/.test(f.start_time) &&
        /^\d{2}:\d{2}$/.test(f.end_time) &&
        aMinutos(f.end_time) > aMinutos(f.start_time)
    )
    .sort((a, b) => aMinutos(a.start_time) - aMinutos(b.start_time))

  const salida: Franja[] = []
  for (const f of limpias) {
    const ultima = salida[salida.length - 1]
    if (ultima && aMinutos(f.start_time) <= aMinutos(ultima.end_time)) {
      if (aMinutos(f.end_time) > aMinutos(ultima.end_time)) ultima.end_time = f.end_time
      continue
    }
    salida.push({ ...f })
  }
  return salida
}

export function normalizarFranjasSemana(franjas: FranjasSemana): FranjasSemana {
  const copia = semanaSinFranjas()
  for (let dia = 0; dia <= 6; dia++) copia[dia] = normalizarFranjasDia(franjas[dia] ?? [])
  return copia
}

/** Días con al menos una franja, en orden de semana (lunes primero). */
export function diasConFranjas(franjas: FranjasSemana): number[] {
  return ORDEN_SEMANA.filter(dia => (franjas[dia] ?? []).length > 0)
}

export function franjasSemanaIguales(a: FranjasSemana, b: FranjasSemana): boolean {
  return JSON.stringify(normalizarFranjasSemana(a)) === JSON.stringify(normalizarFranjasSemana(b))
}

/** Las franjas del turnero leídas como tramos, para el cálculo de la previa. */
export function franjasATramos(franjas: Franja[]): Tramo[] {
  return normalizarFranjasDia(franjas).map(f => ({ inicio: f.start_time, fin: f.end_time }))
}

/** Minutos totales que un día acepta turnos. */
export function duracionFranjas(franjas: Franja[]): number {
  return normalizarFranjasDia(franjas).reduce(
    (total, f) => total + (aMinutos(f.end_time) - aMinutos(f.start_time)),
    0
  )
}

/** "10:00–13:00 · 16:00–19:00". */
export function resumenFranjas(franjas: Franja[]): string {
  return normalizarFranjasDia(franjas)
    .map(f => `${f.start_time}–${f.end_time}`)
    .join(' · ')
}

/**
 * "lunes a sábado", "martes y jueves", "todos los días".
 *
 * Detecta el tramo corrido de lunes a X porque es cómo el dueño describe su
 * semana; cualquier otra combinación se enumera.
 */
export function describirDias(dias: number[]): string {
  const ordenados = ORDEN_SEMANA.filter(d => dias.includes(d))
  if (!ordenados.length) return 'ningún día'
  if (ordenados.length === 7) return 'todos los días'
  if (ordenados.length === 1) return `los ${NOMBRES_DIAS[ordenados[0]].toLowerCase()}`

  // "de lunes a martes" suena peor que "lunes y martes": el rango recién paga
  // desde tres días.
  const corrido = ordenados.length >= 3 && ordenados.every((d, i) => d === ORDEN_SEMANA[i])
  if (corrido) {
    return `de ${NOMBRES_DIAS[ordenados[0]].toLowerCase()} a ${NOMBRES_DIAS[ordenados[ordenados.length - 1]].toLowerCase()}`
  }

  const nombres = ordenados.map(d => NOMBRES_DIAS[d].toLowerCase())
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

// ─── Agenda de turnos ────────────────────────────────────────────────

/** Compara dos celdas de la grilla, contando "no toma turnos" (undefined). */
export function franjasIguales(a: DiaDeAgenda | undefined, b: DiaDeAgenda | undefined): boolean {
  if (!a || !b) return !a && !b
  if (!a.franja || !b.franja) return !a.franja && !b.franja
  return a.franja.inicio === b.franja.inicio && a.franja.fin === b.franja.fin
}

export function clonarAgenda(agenda: AgendaTurnos): AgendaTurnos {
  const copia: AgendaTurnos = {}
  for (const [staffId, dias] of Object.entries(agenda)) {
    copia[staffId] = {}
    for (const [dia, valor] of Object.entries(dias)) {
      copia[staffId][Number(dia)] = { franja: valor.franja ? { ...valor.franja } : null }
    }
  }
  return copia
}

/** Días de turnos de un barbero, en orden de semana (lunes primero). */
export function diasConTurnos(agenda: AgendaTurnos, staffId: string): number[] {
  return ORDEN_SEMANA.filter(dia => !!agenda[staffId]?.[dia])
}

/**
 * ¿Esta sucursal ya definió quién atiende cada día?
 *
 * Es la señal que cambia el modelo entero: mientras no haya ninguna celda
 * prendida, el motor sigue con el comportamiento viejo (candidatos = todos los
 * habilitados que tengan jornada ese día). Apenas hay una, manda la agenda y un
 * día sin nadie asignado no ofrece nada.
 */
export function agendaTieneDias(agenda: AgendaTurnos): boolean {
  return Object.values(agenda).some(dias => Object.keys(dias).length > 0)
}

/**
 * Franja real en la que un barbero acepta turnos ese día — espejo de lo que hace
 * el motor (`getAvailableSlots`).
 *
 * Devuelve `[]` cuando el turnero no va a ofrecer nada, incluido el caso
 * silencioso: día asignado sin franja propia y sin jornada cargada.
 */
export function tramosDeTurnos({
  agenda,
  jornada,
  staffId,
  dia,
  usaAgendaPorDia,
}: {
  agenda: AgendaTurnos
  jornada: JornadaSemanal
  staffId: string
  dia: number
  usaAgendaPorDia: boolean
}): Tramo[] {
  const jornadaDelDia = jornada[staffId]?.[dia] ?? []
  if (!usaAgendaPorDia) return jornadaDelDia
  const entrada = agenda[staffId]?.[dia]
  if (!entrada) return []
  return entrada.franja ? [entrada.franja] : jornadaDelDia
}

// ─── Vista previa de horarios (espejo del motor) ─────────────────────

export interface ParametrosPrevia {
  /**
   * Ventanas en que la SUCURSAL acepta turnos ese día. Con franjas cargadas
   * (mig 172) son los tramos del día; sin ellas, el rango único de siempre.
   */
  ventanas: Tramo[]
  /** `slot_interval_minutes`: cada cuánto puede arrancar un turno. */
  paso: number
  /** Duración del servicio de referencia. */
  duracion: number
  /** Franjas en que los BARBEROS toman turnos ese día (unión de los que atienden). */
  tramos: Tramo[]
}

/**
 * Horarios que el cliente va a ver en el turnero para un día tipo.
 *
 * Igual que el motor: la grilla avanza cada `paso` y el turno tiene que entrar
 * COMPLETO (inicio + duración) tanto dentro de UNA ventana del turnero como
 * dentro de un tramo del barbero. Que tenga que entrar entero en una sola
 * ventana es lo que hace funcionar el corte del mediodía: con 10–13 / 16–19 y un
 * servicio de 45 min, el último turno de la mañana es 12:15, no 12:45.
 *
 * No contempla turnos ya tomados ni bloqueos: es una previa de la configuración,
 * no de la agenda de un día real.
 */
export function horariosOfrecidos({ ventanas, paso, duracion, tramos }: ParametrosPrevia): string[] {
  const salto = paso > 0 ? paso : 15
  const dura = duracion > 0 ? duracion : salto
  const limpias = ventanas.filter(v => franjaValida(v))
  if (!limpias.length || !tramos.length) return []

  const abre = Math.min(...limpias.map(v => aMinutos(v.inicio)))
  const cierra = Math.max(...limpias.map(v => aMinutos(v.fin)))
  if (!Number.isFinite(abre) || !Number.isFinite(cierra) || cierra <= abre) return []

  const horarios: string[] = []
  // Techo defensivo: con parámetros absurdos (paso 1 sobre 24 h) el loop podría
  // generar miles de chips y congelar el render de la previa.
  for (let m = abre; m + dura <= cierra && horarios.length < 200; m += salto) {
    const inicio = m
    const fin = m + dura
    const enVentana = limpias.some(v => inicio >= aMinutos(v.inicio) && fin <= aMinutos(v.fin))
    if (!enVentana) continue
    const enTramo = tramos.some(t => inicio >= aMinutos(t.inicio) && fin <= aMinutos(t.fin))
    if (enTramo) horarios.push(aHora(inicio))
  }
  return horarios
}
