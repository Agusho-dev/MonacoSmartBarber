import { getLocalNow } from '@/lib/time-utils'

const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]

/** "09:00:00" -> "09:00" */
function hhmm(time: string | null): string {
  if (!time) return ''
  return time.substring(0, 5)
}

function toMinutes(time: string | null): number | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

export interface EstadoHorario {
  openNow: boolean
  label: string
}

/**
 * Estado de apertura de una sucursal en SU timezone.
 *
 * `getLocalNow` devuelve un Date cuyos campos UTC son la hora de pared en la
 * timezone pedida, así que acá se lee siempre con getUTC* (usar getHours()
 * volvería a aplicar el offset de la máquina y rompería en cualquier server
 * que no esté en UTC).
 */
export function estadoHorario(
  open: string | null,
  close: string | null,
  businessDays: number[] | null,
  timezone: string | null
): EstadoHorario {
  const tz = timezone || 'America/Argentina/Buenos_Aires'
  const openMin = toMinutes(open)
  const closeMin = toMinutes(close)
  const days = businessDays && businessDays.length > 0 ? businessDays : null

  if (openMin == null || closeMin == null || !days) {
    return { openNow: false, label: 'Consultá horarios' }
  }

  const now = getLocalNow(tz)
  const today = now.getUTCDay()
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()

  if (days.includes(today)) {
    if (nowMin >= openMin && nowMin < closeMin) {
      return { openNow: true, label: `Abierto hasta las ${hhmm(close)}` }
    }
    if (nowMin < openMin) {
      return { openNow: false, label: `Abre hoy a las ${hhmm(open)}` }
    }
  }

  // Próximo día habilitado (mirando hasta 7 días hacia adelante)
  for (let offset = 1; offset <= 7; offset++) {
    const day = (today + offset) % 7
    if (!days.includes(day)) continue
    const cuando = offset === 1 ? 'mañana' : `el ${DIAS[day]}`
    return { openNow: false, label: `Abre ${cuando} a las ${hhmm(open)}` }
  }

  return { openNow: false, label: 'Consultá horarios' }
}
