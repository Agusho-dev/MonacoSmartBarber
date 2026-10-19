/**
 * Cómo se lee una espera en el panel del barbero. Módulo plano (sin
 * 'use client'): lo usan la ficha, el tramo de "Cortando ahora" y la vista
 * previa.
 */

export type NivelEspera = 'normal' | 'demorado' | 'critico'

/**
 * La espera deja de ser un dato gris cuando se vuelve un problema. Medido sobre
 * 90 días de producción: la mediana de espera es de 5 a 12 min y el p90 no pasa
 * de 51; los clientes que terminaron anotados-y-nunca-atendidos habían esperado
 * 1 a 4 HORAS mientras se atendía a gente que llegó después. A los 40 min la
 * ficha se pone ámbar y a los 70 roja: "a éste lo estamos dejando pasar" tiene
 * que verse de reojo.
 */
export function nivelEspera(minutos: number): NivelEspera {
  if (minutos >= 70) return 'critico'
  if (minutos >= 40) return 'demorado'
  return 'normal'
}

/** "8 min", "1 h 05". Sin segundos: en una espera son ruido, y saltaban cada 5 s. */
export function formatoEspera(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** La espera en partes: los números van en mono y las unidades en la letra del texto. */
export function partesDeEspera(minutos: number): { valor: string; unidad: string }[] {
  const m = Math.max(0, Math.floor(minutos))
  if (m < 60) return [{ valor: String(m), unidad: 'min' }]
  return [
    { valor: String(Math.floor(m / 60)), unidad: 'h' },
    { valor: String(m % 60).padStart(2, '0'), unidad: '' },
  ]
}
