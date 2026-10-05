/**
 * Textos de las fotos del corte y del historial. Funciones puras: las usan la
 * tablet, el celular y el servidor, así "hace 3 semanas" se dice igual en las
 * tres pantallas.
 */

const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires'

/** "1 foto" / "3 fotos". */
export function cantidadDeFotos(n: number): string {
  return `${n} ${n === 1 ? 'foto' : 'fotos'}`
}

/** Nombre de pila, sin espacios sobrantes ("Fabrizio Galeassi " → "Fabrizio"). */
export function primerNombre(nombreCompleto: string | null | undefined): string | null {
  const limpio = (nombreCompleto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return null
  return limpio.split(' ')[0]
}

/**
 * "Juan P.": nombre de pila e inicial del apellido. Es lo que se muestra en el
 * celular, que puede quedar a la vista de cualquiera en el local: alcanza para
 * que el barbero sepa de quién son las fotos, sin el nombre completo.
 */
export function nombreCorto(nombreCompleto: string | null | undefined): string | null {
  const limpio = (nombreCompleto ?? '').trim().replace(/\s+/g, ' ')
  if (!limpio) return null
  const partes = limpio.split(' ')
  if (partes.length === 1) return partes[0]
  const inicial = partes[partes.length - 1].charAt(0).toLocaleUpperCase('es-AR')
  return `${partes[0]} ${inicial}.`
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona de la barbería. */
function diaLocal(fecha: Date, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha)
}

/** Días de calendario entre dos fechas locales (no 24 h corridas: "ayer" a las 23:50 es ayer). */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/**
 * "hoy", "ayer", "hace 4 días", "hace una semana", "hace 3 semanas",
 * "hace un mes", "hace 5 meses", "hace un año". En días de calendario de la
 * barbería, no en horas: un corte de ayer a la noche es "ayer", no "hoy".
 */
export function haceCuanto(fechaIso: string, ahora: Date = new Date(), zona = ZONA_POR_DEFECTO): string {
  const fecha = new Date(fechaIso)
  if (Number.isNaN(fecha.getTime())) return ''
  const dias = diasEntre(diaLocal(fecha, zona), diaLocal(ahora, zona))
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 7) return `hace ${dias} días`
  if (dias < 14) return 'hace una semana'
  if (dias < 31) return `hace ${Math.floor(dias / 7)} semanas`
  const meses = Math.floor(dias / 30.44)
  if (meses <= 1) return 'hace un mes'
  if (meses < 12) return `hace ${meses} meses`
  const anios = Math.floor(dias / 365.25)
  return anios <= 1 ? 'hace un año' : `hace ${anios} años`
}

/** "12 de agosto" (y el año si no es el actual): para el epígrafe del visor. */
export function fechaLarga(fechaIso: string, ahora: Date = new Date(), zona = ZONA_POR_DEFECTO): string {
  const fecha = new Date(fechaIso)
  if (Number.isNaN(fecha.getTime())) return ''
  const mismoAnio = diaLocal(fecha, zona).slice(0, 4) === diaLocal(ahora, zona).slice(0, 4)
  return fecha.toLocaleDateString('es-AR', {
    timeZone: zona,
    day: 'numeric',
    month: 'long',
    ...(mismoAnio ? {} : { year: 'numeric' }),
  })
}

/** "Corte + Barba" con los extras: el servicio principal y los extras del cobro. */
export function descripcionDelServicio(servicio: string | null, extras: string[]): string | null {
  const partes = [servicio?.trim(), ...extras.map((e) => e.trim())].filter((p): p is string => !!p)
  return partes.length > 0 ? partes.join(' + ') : null
}
