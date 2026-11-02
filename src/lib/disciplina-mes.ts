// El mes de Disciplina: qué mes es hoy y dónde empieza y termina en la hora de la
// sucursal. Funciones puras: las usan las páginas, la server action y el cliente.
//
// Un mes es "YYYY-MM". El borde se calcula en la zona de la organización, no en
// UTC: con `new Date().toISOString()` el mes cambiaba a las 21:00 del último día y
// las marcas de esas tres horas aparecían en el mes siguiente.

import { getLocalDateStr, getTzOffsetISO } from '@/lib/time-utils'

export function mesDeHoy(timeZone?: string): string {
  return getLocalDateStr(timeZone).slice(0, 7)
}

export function esMes(valor: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor)
}

export function moverMes(mes: string, delta: number): string {
  const [anio, numero] = mes.split('-').map(Number)
  const destino = new Date(Date.UTC(anio, numero - 1 + delta, 1))
  return `${destino.getUTCFullYear()}-${String(destino.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Para `event_date` (fecha) y `recorded_at` (timestamptz). `hasta` es exclusivo. */
export function limitesDelMes(
  mes: string,
  timeZone: string,
): { desdeFecha: string; hastaFecha: string; desdeIso: string; hastaIso: string } {
  const desdeFecha = `${mes}-01`
  const hastaFecha = `${moverMes(mes, 1)}-01`
  const inicioDe = (fecha: string) =>
    `${fecha}T00:00:00${getTzOffsetISO(new Date(`${fecha}T12:00:00Z`), timeZone)}`
  return { desdeFecha, hastaFecha, desdeIso: inicioDe(desdeFecha), hastaIso: inicioDe(hastaFecha) }
}

/** "octubre de 2026" */
export function nombreDelMes(mes: string): string {
  const [anio, numero] = mes.split('-').map(Number)
  return new Date(Date.UTC(anio, numero - 1, 15)).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
