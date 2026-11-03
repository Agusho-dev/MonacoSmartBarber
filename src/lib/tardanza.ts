// Cuándo una fichada de entrada es una llegada tarde. Funciones puras: las usan
// `checkTardiness` (al fichar) y `scripts/recalcular-tardanzas.ts` (el historial), para
// que lo que se calcula hacia atrás sea exactamente lo mismo que se calcula en vivo.
//
// Por qué no alcanza con el horario semanal (`staff_schedules`): en Monaco se entra a las
// 10:00 o a las 13:00 y casi todos rotan entre los dos turnos, a mano, de una semana a
// otra. Un horario fijo por día de la semana no puede decir eso, y de hecho no lo decía:
// medido sobre 30 días (3/nov/2026), el 47 % de los días-barbero no se evaluaba porque 10
// barberos no tenían horario, y Nico Ulloque, con 10–13 y 16–21 cargado desde marzo,
// entraba a las 13:05 y caía "en el hueco" entre los bloques, sin ninguna tardanza.
//
// La regla se configura por organización en `app_settings` (mig 236). Sin ella, el
// comportamiento de siempre: sólo el horario cargado y sin tolerancia.

export interface ReglaTardanza {
  /** Horas de entrada de los turnos, en minutos del día (600 = 10:00). */
  entradas: number[]
  /** Hora de la vuelta del turno cortado (960 = 16:00). null = no se mide. */
  vuelta: number | null
  toleranciaMin: number
}

export interface BloqueDeHorario {
  start_time: string
  end_time: string
}

export interface MarcaDelDia {
  action_type: 'clock_in' | 'clock_out'
  minutos: number
}

export type ResultadoLlegada =
  | { tarde: false }
  | { tarde: true; esperadaMin: number; minutosTarde: number; motivo: 'entrada' | 'vuelta' | 'horario' }

/**
 * Hasta cuánto antes de una entrada se considera que alguien llegó para esa entrada.
 * Con entradas a las 10 y a las 13, llegar a las 12:30 es llegar temprano al turno de las
 * 13, no dos horas y media tarde al de las 10. En 30 días no hubo ninguna primera fichada
 * entre las 11:30 y las 12:15, así que el corte no es sensible al número exacto.
 */
const VENTANA_ANTES_MIN = 60

/** "13:06:18" o "13:06" → 786. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/** 786 → "13:06". */
export function aHora(minutos: number): string {
  const h = Math.floor(minutos / 60)
  return `${String(h).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
}

/** "HH:MM:SS" de un instante en la zona de la sucursal. */
export function horaEnZona(instante: Date, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante)
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00'
  return `${de('hour')}:${de('minute')}:${de('second')}`
}

/**
 * La regla de la organización a partir de su fila de `app_settings`. Sin entradas
 * cargadas devuelve null y se usa sólo el horario, como las demás organizaciones.
 */
export function leerReglaTardanza(ajustes: {
  tardanza_entradas?: string[] | null
  tardanza_vuelta?: string | null
  tardanza_tolerancia_minutos?: number | null
} | null | undefined): ReglaTardanza | null {
  const entradas = ajustes?.tardanza_entradas
  if (!entradas || entradas.length === 0) return null
  return {
    entradas: entradas.map(aMinutos).sort((a, b) => a - b),
    vuelta: ajustes?.tardanza_vuelta ? aMinutos(ajustes.tardanza_vuelta) : null,
    toleranciaMin: Math.max(0, ajustes?.tardanza_tolerancia_minutos ?? 0),
  }
}

/**
 * Evalúa una fichada de entrada. `marcasPrevias` son las del mismo día ANTES de ésta, en
 * orden, y `bloques` los del horario cargado para ese día, en el orden de `block_index`.
 *
 * Una tardanza es por minuto cumplido: con 5 de tolerancia y entrada a las 13:00, 13:05:59
 * es a tiempo y 13:06:00 es tarde.
 */
export function evaluarLlegada({
  llegadaMin,
  marcasPrevias,
  bloques,
  regla,
}: {
  llegadaMin: number
  marcasPrevias: MarcaDelDia[]
  bloques: BloqueDeHorario[]
  regla: ReglaTardanza | null
}): ResultadoLlegada {
  if (!regla) return contraElHorario(llegadaMin, bloques)
  const primeraPrevia = marcasPrevias.find((m) => m.action_type === 'clock_in')
  return primeraPrevia
    ? laVuelta(llegadaMin, primeraPrevia.minutos, marcasPrevias, bloques, regla)
    : laPrimeraEntrada(llegadaMin, bloques, regla)
}

/**
 * La primera fichada del día se mide contra la última entrada que ya pasó, salvo que esté
 * llegando temprano a la que viene. Un inicio de bloque cargado para ese día cuenta como
 * una entrada más: así se respeta a quien tiene otro horario (Rodrigo, a las 11:00).
 */
function laPrimeraEntrada(
  llegadaMin: number,
  bloques: BloqueDeHorario[],
  regla: ReglaTardanza,
): ResultadoLlegada {
  const horas = [...new Set([...regla.entradas, ...bloques.map((b) => aMinutos(b.start_time))])].sort((a, b) => a - b)

  const proxima = horas.find((h) => h >= llegadaMin)
  if (proxima !== undefined && proxima - llegadaMin <= VENTANA_ANTES_MIN) return { tarde: false }

  const referencia = horas.filter((h) => h < llegadaMin).at(-1)
  if (referencia === undefined) return { tarde: false }

  const minutosTarde = llegadaMin - referencia
  return minutosTarde > regla.toleranciaMin
    ? { tarde: true, esperadaMin: referencia, minutosTarde, motivo: 'entrada' }
    : { tarde: false }
}

/**
 * Una fichada posterior sólo cuenta si es la vuelta del turno cortado: entró a la mañana,
 * salió antes de la hora de la vuelta y volvió después. Salir a almorzar y volver en un
 * horario corrido no es llegar tarde; antes se marcaba como tal.
 *
 * Es «corrido» el bloque que va de su entrada de la mañana hasta pasada la vuelta (10–21).
 * Uno de 13–21 no lo es para alguien que ese día entró a las 10: es un horario de otra
 * rotación, y ese día está haciendo el cortado.
 */
function laVuelta(
  llegadaMin: number,
  primeraEntrada: number,
  marcasPrevias: MarcaDelDia[],
  bloques: BloqueDeHorario[],
  regla: ReglaTardanza,
): ResultadoLlegada {
  const { vuelta, entradas, toleranciaMin } = regla
  if (vuelta === null) return { tarde: false }

  const segundaEntrada = entradas[1]
  const entroALaManana = segundaEntrada === undefined || primeraEntrada < segundaEntrada - VENTANA_ANTES_MIN
  if (!entroALaManana) return { tarde: false }

  const ultimaSalida = marcasPrevias.filter((m) => m.action_type === 'clock_out').at(-1)
  if (!ultimaSalida || ultimaSalida.minutos >= vuelta) return { tarde: false }

  const corrido = bloques.some((b) => {
    const inicio = aMinutos(b.start_time)
    return inicio - VENTANA_ANTES_MIN <= primeraEntrada && inicio < vuelta && aMinutos(b.end_time) > vuelta
  })
  if (corrido) return { tarde: false }

  const minutosTarde = llegadaMin - vuelta
  return minutosTarde > toleranciaMin
    ? { tarde: true, esperadaMin: vuelta, minutosTarde, motivo: 'vuelta' }
    : { tarde: false }
}

/** Las organizaciones sin regla: dentro de un bloque ya empezado, sin tolerancia. */
function contraElHorario(llegadaMin: number, bloques: BloqueDeHorario[]): ResultadoLlegada {
  for (const bloque of bloques) {
    const inicio = aMinutos(bloque.start_time)
    if (llegadaMin < inicio) break
    if (llegadaMin <= aMinutos(bloque.end_time)) {
      return llegadaMin > inicio
        ? { tarde: true, esperadaMin: inicio, minutosTarde: llegadaMin - inicio, motivo: 'horario' }
        : { tarde: false }
    }
  }
  return { tarde: false }
}

/** La nota que queda en el evento y que ve el barbero en su panel. */
export function notaDeTardanza(llegadaMin: number, esperadaMin: number, motivo: 'entrada' | 'vuelta' | 'horario'): string {
  const llego = aHora(llegadaMin)
  const debia = aHora(esperadaMin)
  if (motivo === 'vuelta') return `Volvió tarde a las ${llego} (vuelta de las ${debia})`
  if (motivo === 'entrada') return `Llegada tarde a las ${llego} (entrada de las ${debia})`
  return `Llegada tarde a las ${llego} (Horario: ${debia})`
}
