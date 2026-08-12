/**
 * Tramos horarios 'HH:MM'–'HH:MM' y sus operaciones.
 *
 * Vive fuera de `src/lib/actions/` a propósito: `appointments.ts` es un archivo
 * `'use server'` y ahí sólo se pueden exportar funciones async. Estas son puras
 * y las consumen las DOS puntas — el servidor para calcular la ventana real de
 * un barbero, el cliente para escribirla en castellano.
 *
 * Las horas se comparan como STRING: 'HH:MM' de largo fijo ordena igual que el
 * número de minutos, así que no hace falta parsear nada.
 */

export interface Rango {
  start: string
  end: string
}

/**
 * Intersección de dos conjuntos de tramos, con los resultados adyacentes
 * fusionados.
 *
 * Con `b` vacío devuelve vacío, NO `a`: que la sucursal no tenga ninguna
 * ventana ese día significa que no da turnos, no que dé el día entero.
 */
export function intersectarRangos(a: Rango[], b: Rango[]): Rango[] {
  const out: Rango[] = []
  for (const x of a) {
    for (const y of b) {
      const start = x.start > y.start ? x.start : y.start
      const end = x.end < y.end ? x.end : y.end
      if (start < end) out.push({ start, end })
    }
  }
  out.sort((p, q) => p.start.localeCompare(q.start))

  const fusionado: Rango[] = []
  for (const r of out) {
    const ultimo = fusionado[fusionado.length - 1]
    if (ultimo && r.start <= ultimo.end) {
      if (r.end > ultimo.end) ultimo.end = r.end
    } else {
      fusionado.push({ ...r })
    }
  }
  return fusionado
}

/** "10:00 a 13:00 y 16:00 a 19:00" */
export function textoRangos(rangos: Rango[]): string {
  const partes = rangos.map(r => `${r.start} a ${r.end}`)
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

const DIAS_PLURAL = [
  'domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados',
]

/** "los martes" / "martes y jueves" / "casi todos los días". */
export function textoDias(days: number[]): string {
  if (!days.length) return ''
  if (days.length >= 6) return 'casi todos los días'
  const nombres = days.map(d => DIAS_PLURAL[d])
  if (nombres.length === 1) return `los ${nombres[0]}`
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/** "Mar" / "Mié" — para las etiquetas cortas de la grilla semanal. */
export const DIAS_ABREV_3 = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
