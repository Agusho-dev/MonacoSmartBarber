// =============================================================================
// src/lib/tex/formato.ts
// Cómo escribe Tex los números y las fechas: plata, cantidades, porcentajes,
// variaciones y rangos de fechas en castellano.
//
// PURO e isomórfico, a propósito sin imports: lo usan las herramientas, el
// "pulso del día" y las pruebas del scratchpad (que lo cargan con node, sin
// el bundler). Las fechas viajan como 'YYYY-MM-DD' de PARED en Argentina y se
// operan en UTC sobre esos números: nunca `new Date('2026-10-21')` + getDate(),
// que en el proceso de Vercel (UTC) o en un browser de otro huso corre el día.
// =============================================================================

export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires'

const ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const HASTA_UN_DECIMAL = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

/** Signo menos tipográfico: "−$26.000" se lee mejor que "-$26.000" en una tarjeta. */
const MENOS = '−'

/** "$1.384.000" (sin decimales, sin espacio después del signo, como en la especificación). */
export function pesos(n: number): string {
  const r = Math.round(Number.isFinite(n) ? n : 0)
  const abs = ENTERO.format(Math.abs(r))
  return r < 0 ? `${MENOS}$${abs}` : `$${abs}`
}

/** "$1,4 M" / "$850 mil": para títulos y textos cortos, nunca para una tabla. */
export function pesosAbreviados(n: number): string {
  const abs = Math.abs(n)
  const signo = n < 0 ? MENOS : ''
  if (abs >= 1_000_000) return `${signo}$${HASTA_UN_DECIMAL.format(abs / 1_000_000)} M`
  if (abs >= 10_000) return `${signo}$${ENTERO.format(Math.round(abs / 1000))} mil`
  return pesos(n)
}

/** "1.234" */
export function cantidad(n: number): string {
  return ENTERO.format(Math.round(Number.isFinite(n) ? n : 0))
}

/** "108,4" */
export function decimal(n: number): string {
  return HASTA_UN_DECIMAL.format(Number.isFinite(n) ? n : 0)
}

const DOS_DECIMALES = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "4,92": un promedio de calificaciones (siempre con dos decimales). */
export function decimalDos(n: number): string {
  return DOS_DECIMALES.format(Number.isFinite(n) ? n : 0)
}

/** "32 %" / "36,4 %": con espacio, como escribe el resto del dashboard. */
export function porcentaje(n: number): string {
  return `${HASTA_UN_DECIMAL.format(Number.isFinite(n) ? n : 0)} %`
}

/** "+12 %" / "−8 %" / "0 %". null = no hay contra qué comparar. */
export function variacion(pct: number | null | undefined): string | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined
  const redondeado = Math.round(pct * 10) / 10
  const signo = redondeado > 0 ? '+' : redondeado < 0 ? MENOS : ''
  return `${signo}${HASTA_UN_DECIMAL.format(Math.abs(redondeado))} %`
}

/** El tono de una variación. Media décima de punto es ruido, no tendencia. */
export function tonoDeVariacion(pct: number | null | undefined): 'sube' | 'baja' | 'neutro' {
  if (pct == null || !Number.isFinite(pct)) return 'neutro'
  if (pct > 0.5) return 'sube'
  if (pct < -0.5) return 'baja'
  return 'neutro'
}

// ─────────────────────────────────────────────────────────────────────────────
// Fechas ('YYYY-MM-DD' de pared, Argentina)
// ─────────────────────────────────────────────────────────────────────────────

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const MES = /^(\d{4})-(\d{2})$/

export function esFecha(s: string): boolean {
  const m = FECHA.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  // Rechaza "2026-02-31": Date lo pasaría a marzo sin avisar.
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Para aritmética: tira con una fecha mal formada (se valida antes de operar). */
function partesDeFecha(fecha: string): { y: number; m: number; d: number } {
  const m = FECHA.exec(fecha)
  if (!m) throw new Error(`Fecha inválida: ${fecha}`)
  return { y: +m[1], m: +m[2], d: +m[3] }
}

/**
 * Para mostrar: con algo que no es una fecha devuelve null y quien llama
 * muestra el texto tal cual. Un formato raro nunca tiene que voltear la
 * respuesta entera de una herramienta.
 */
function partesSeguras(fecha: string): { y: number; m: number; d: number } | null {
  const m = FECHA.exec(fecha)
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}

function aFecha(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** '2026-10-21' + 1 → '2026-10-22' (aritmética de calendario, sin husos). */
export function sumarDias(fecha: string, dias: number): string {
  const { y, m, d } = partesDeFecha(fecha)
  return aFecha(y, m, d + dias)
}

/** Días de calendario entre dos fechas (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  const a = partesDeFecha(desde)
  const b = partesDeFecha(hasta)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** 0 = domingo … 6 = sábado. */
export function diaDeSemana(fecha: string): number {
  const { y, m, d } = partesDeFecha(fecha)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "martes 21 de octubre de 2026" */
export function diaLargo(fecha: string): string {
  const p = partesSeguras(fecha)
  if (!p) return fecha
  return `${DIAS[diaDeSemana(fecha)]} ${p.d} de ${MESES[p.m - 1]} de ${p.y}`
}

/** "martes" */
export function nombreDelDia(fecha: string): string {
  return partesSeguras(fecha) ? DIAS[diaDeSemana(fecha)] : fecha
}

/** "21/10" */
export function fechaCorta(fecha: string): string {
  const p = partesSeguras(fecha)
  return p ? `${p.d}/${p.m}` : fecha
}

/** "21/10/2026" */
export function fechaConAnio(fecha: string): string {
  const p = partesSeguras(fecha)
  return p ? `${p.d}/${p.m}/${p.y}` : fecha
}

/** "21 oct" / "21 oct 2025" si no es del año de referencia. */
function diaYMes(fecha: string, anioReferencia?: number): string {
  const p = partesSeguras(fecha)
  if (!p) return fecha
  return anioReferencia != null && p.y !== anioReferencia ? `${p.d} ${MESES_CORTOS[p.m - 1]} ${p.y}` : `${p.d} ${MESES_CORTOS[p.m - 1]}`
}

/**
 * "21 oct" · "1–21 oct" · "28 sep–4 oct" · "15 dic 2025–10 ene 2026".
 * Es el formato de las fuentes ("Finanzas · 1–21 oct · Paraná"). El año sólo
 * aparece cuando el rango cruza años o no es el año de `hoy`.
 */
export function rangoFechas(desde: string, hasta: string, hoy?: string): string {
  const a = partesSeguras(desde)
  const b = partesSeguras(hasta)
  if (!a || !b) return desde === hasta ? desde : `${desde}–${hasta}`
  const anioHoy = (hoy ? partesSeguras(hoy)?.y : undefined) ?? b.y
  if (desde === hasta) return diaYMes(desde, anioHoy)
  if (a.y === b.y && a.m === b.m) {
    const sufijo = a.y !== anioHoy ? ` ${a.y}` : ''
    return `${a.d}–${b.d} ${MESES_CORTOS[a.m - 1]}${sufijo}`
  }
  if (a.y === b.y) {
    const sufijo = a.y !== anioHoy ? ` ${a.y}` : ''
    return `${a.d} ${MESES_CORTOS[a.m - 1]}–${b.d} ${MESES_CORTOS[b.m - 1]}${sufijo}`
  }
  return `${a.d} ${MESES_CORTOS[a.m - 1]} ${a.y}–${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`
}

/** Acepta 'YYYY-MM' (o una fecha completa, de la que toma el mes). null si no es un mes. */
function partesDeMes(mes: string): { y: number; m: number } | null {
  const r = MES.exec(mes.slice(0, 7))
  if (!r || +r[2] < 1 || +r[2] > 12) return null
  return { y: +r[1], m: +r[2] }
}

/** '2026-10' → "octubre de 2026" */
export function mesLargo(mes: string): string {
  const p = partesDeMes(mes)
  return p ? `${MESES[p.m - 1]} de ${p.y}` : mes
}

/** '2026-10' → "octubre" */
export function nombreDelMes(mes: string): string {
  const p = partesDeMes(mes)
  return p ? MESES[p.m - 1] : mes
}

/** '2026-10' → "oct" (o "oct 2025" si no es del año de referencia). */
export function mesCorto(mes: string, anioReferencia?: number): string {
  const p = partesDeMes(mes)
  if (!p) return mes
  return anioReferencia != null && p.y !== anioReferencia ? `${MESES_CORTOS[p.m - 1]} ${p.y}` : MESES_CORTOS[p.m - 1]
}

/** Días del mes de una fecha: '2026-02-10' → 28. */
export function diasDelMes(fecha: string): number {
  const { y, m } = partesDeFecha(fecha)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** "oct 2026" · "may–oct 2026" · "nov 2025–feb 2026" */
export function rangoMeses(desde: string, hasta: string): string {
  const a = partesDeMes(desde)
  const b = partesDeMes(hasta)
  if (!a || !b) return desde === hasta ? desde : `${desde}–${hasta}`
  if (desde === hasta) return `${MESES_CORTOS[a.m - 1]} ${a.y}`
  if (a.y === b.y) return `${MESES_CORTOS[a.m - 1]}–${MESES_CORTOS[b.m - 1]} ${a.y}`
  return `${MESES_CORTOS[a.m - 1]} ${a.y}–${MESES_CORTOS[b.m - 1]} ${b.y}`
}

/** 'YYYY-MM-DD' de pared en la zona dada para un instante. */
export function fechaEnZona(instante: Date | string, zona = ZONA_ARGENTINA): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    typeof instante === 'string' ? new Date(instante) : instante,
  )
}

/** "18:42" en la zona dada. */
export function horaEnZona(instante: Date | string, zona = ZONA_ARGENTINA): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    typeof instante === 'string' ? new Date(instante) : instante,
  )
}

/** "22/10/2026 17:32": un instante en la hora de pared de la zona (para tablas). */
export function fechaHoraEnZona(instante: Date | string, zona = ZONA_ARGENTINA): string {
  return `${fechaConAnio(fechaEnZona(instante, zona))} ${horaEnZona(instante, zona)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Personas
// ─────────────────────────────────────────────────────────────────────────────

/** "Juan Pérez" → "Juan". Para mandarle a Claude lo mínimo: el nombre de pila alcanza para conversar. */
export function nombreDePila(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim().split(/\s+/)[0] ?? ''
  if (!limpio) return null
  return limpio.charAt(0).toLocaleUpperCase('es-AR') + limpio.slice(1)
}

/**
 * "Juan Pérez" → "Juan P." · "Juan Carlos Pérez" → "Juan P." · "Juan" → "Juan".
 * Para desambiguar entre clientes con el mismo nombre de pila sin mandarle a Claude el
 * apellido (lo que la pantalla sí puede mostrar entero).
 */
export function nombreConInicial(nombre: string | null | undefined): string | null {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  const pila = nombreDePila(partes[0])
  if (!pila) return null
  const apellido = partes.length > 1 ? partes[partes.length - 1] : ''
  const inicial = apellido ? Array.from(apellido)[0].toLocaleUpperCase('es-AR') : ''
  return inicial ? `${pila} ${inicial}.` : pila
}

/** "+54 9 351 212-5249" → "···5249". Nunca el teléfono entero fuera de la ficha del cliente. */
export function telefonoEnmascarado(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '')
  if (digitos.length < 4) return null
  return `···${digitos.slice(-4)}`
}
