/**
 * Ventana de reserva del turnero público: qué días se pueden OFRECER.
 *
 * Existe por una asimetría del motor de disponibilidad (`getAvailableSlots` en
 * `src/lib/actions/appointments.ts`), que valida el rango así:
 *
 *   const targetDate = new Date(date + 'T12:00:00')      // el día pedido, a las 12:00
 *   const maxDate = new Date()                           // AHORA, con la hora actual
 *   maxDate.setDate(maxDate.getDate() + max_advance_days)
 *   if (targetDate > maxDate) → 'Fecha fuera del rango permitido'
 *
 * Los dos lados no son homogéneos: el día pedido se ancla al MEDIODÍA y el tope
 * CONSERVA la hora del reloj. Cuando el proceso corre antes del mediodía (en
 * Vercel el proceso está en UTC, así que eso pasa entre las 00:00 y las 09:00 de
 * Argentina) el tope cae por debajo del mediodía y el ÚLTIMO día de la ventana
 * —hoy + max_advance_days— se rechaza. La tira lo dibujaba igual y el cliente
 * que lo tocaba se comía un error rojo sin poder hacer nada.
 *
 * Como el motor no se toca desde acá, la regla es no ofrecer un día que vaya a
 * ser rechazado. Se replica su chequeo bajo las DOS timezones posibles del
 * proceso (UTC en Vercel, la del dispositivo en dev local) y se descarta el día
 * si cualquiera de las dos lecturas lo rechazaría. El costo máximo es un día en
 * el borde de una ventana de 15–30; el beneficio es que ningún chip miente.
 *
 * Si algún día el motor pasa a comparar mediodía contra mediodía, este módulo
 * devuelve la ventana completa solo — no hay que acordarse de borrarlo.
 */

const MS_DIA = 24 * 60 * 60 * 1000

/** ¿El motor va a aceptar esta fecha como día de turno? */
export function fechaDentroDeVentana(
  fecha: Date,
  maxAdvanceDays: number,
  ahora: Date = new Date()
): boolean {
  const y = fecha.getFullYear()
  const m = fecha.getMonth()
  const d = fecha.getDate()

  // Lectura A — proceso en UTC (producción, Vercel). En UTC no hay DST, así que
  // `setDate(+N)` equivale exactamente a sumar N días de milisegundos.
  if (Date.UTC(y, m, d, 12, 0, 0, 0) > ahora.getTime() + maxAdvanceDays * MS_DIA) {
    return false
  }

  // Lectura B — proceso en la timezone del dispositivo (dev local).
  const topeLocal = new Date(ahora)
  topeLocal.setDate(topeLocal.getDate() + maxAdvanceDays)
  if (new Date(y, m, d, 12, 0, 0, 0).getTime() > topeLocal.getTime()) {
    return false
  }

  return true
}

/**
 * Días que la tira puede ofrecer, desde hoy, ya recortados por la ventana.
 *
 * Cada Date viene al MEDIODÍA local y no a las 00:00: sumar días sobre la
 * medianoche puede caer en el salto de horario de verano y devolver el día
 * anterior a las 23:00.
 */
export function diasDeVentana(
  maxAdvanceDays: number,
  ahora: Date = new Date()
): Date[] {
  const base = new Date(ahora)
  base.setHours(12, 0, 0, 0)

  const out: Date[] = []
  for (let i = 0; i <= maxAdvanceDays; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    // La condición es monótona (más lejos = más chance de rechazo), pero se
    // evalúa día por día para no depender de eso si el motor cambia.
    if (!fechaDentroDeVentana(d, maxAdvanceDays, ahora)) break
    out.push(d)
  }
  return out
}
