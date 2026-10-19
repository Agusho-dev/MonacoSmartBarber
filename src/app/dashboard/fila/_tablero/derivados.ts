/**
 * Lecturas del tablero de `/dashboard/fila`. Módulo plano: lo usan el
 * contenedor (`fila-client.tsx`) y las piezas de `_tablero/`. Nada de acá muta
 * la fila ni decide a quién se atiende: eso vive en `claim_next_for_barber`.
 */

import { resolveStage, type TimerStage } from '@/hooks/use-timer-stage'
import { nivelEspera, type NivelEspera } from '@/components/barber/fila/espera'
import type { QueueEntry, StaffStatus } from '@/lib/types/database'

/** Id de la "columna" del pool (Menor espera) en el drag y en `updateQueueOrder`. */
export const POOL = '__dynamic__'

export interface BarberRow {
  id: string
  full_name: string
  branch_id: string | null
  status: StaffStatus
  is_active: boolean
  hidden_from_checkin: boolean
  avatar_url?: string | null
}

export interface BranchRow {
  id: string
  name: string
}

/**
 * Del pool ("Menor espera"): sin barbero, o marcado dinámico aunque traiga la
 * pista de un barbero. La misma regla que usaba el tablero de antes para
 * decidir su columna (modelo pool, mig 134).
 */
export function esDelPool(e: QueueEntry): boolean {
  return e.is_dynamic || !e.barber_id
}

/**
 * Orden de la fila: `priority_order` (la llegada, el FIFO real que usan el
 * motor y el panel) y `position` sólo para desempatar: se recicla y se repite.
 */
export function porOrdenDeLlegada(a: QueueEntry, b: QueueEntry): number {
  const pa = new Date(a.priority_order).getTime()
  const pb = new Date(b.priority_order).getTime()
  if (pa !== pb) return pa - pb
  return a.position - b.position
}

/** Minutos desde un instante (0 sin dato, con un dato inválido o futuro). */
export function minutosDesde(iso: string | null | undefined, ahora: number): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (ahora - t) / 60_000)
}

/** Etapa del semáforo del corte: los MISMOS umbrales que el panel del barbero. */
export function etapaDelCorte(minutos: number): TimerStage {
  return resolveStage(minutos)
}

/**
 * Color de los minutos del corte, por etapa del semáforo. En el tablero sólo se
 * colorean las dos últimas (ámbar desde los 35 min, rojo desde los 45): el
 * celeste y el azul del panel acá competirían con el celeste de Menor espera.
 */
export const TEXTO_ETAPA: Record<TimerStage, string> = {
  ok: 'text-foreground',
  'heads-up': 'text-foreground',
  focus: 'text-foreground',
  warn: 'text-amber-300',
  danger: 'text-red-400',
}

/**
 * Una espera, para dibujarla: el nivel (ámbar a los 40 min, rojo a los 70, los
 * mismos umbrales que el panel) y el largo de su barra. La barra se llena recién
 * a las 2 h: llenándose a los 70 min, la cabeza de una fila larga era un bloque
 * de barras rojas iguales y no se distinguía 1 h 10 de 2 h.
 */
export function lecturaDeEspera(minutos: number): { nivel: NivelEspera; fraccion: number } {
  return { nivel: nivelEspera(minutos), fraccion: Math.min(1, minutos / 120) }
}

export const TEXTO_NIVEL: Record<NivelEspera, string> = {
  normal: 'text-foreground/85',
  demorado: 'text-amber-300',
  critico: 'text-red-400',
}

export const BARRA_NIVEL: Record<NivelEspera, string> = {
  normal: 'bg-foreground/35',
  demorado: 'bg-amber-400',
  critico: 'bg-red-500',
}

/** "Fran Castillo" → "Fran". Para los botones ("Atender a Fran"). */
export function nombreDePila(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').trim()
  if (!limpio) return 'Cliente'
  return limpio.split(/\s+/)[0]
}

/** "Fran Castillo" → "FC", para el lugar de la foto. */
export function iniciales(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '·'
  return ((partes[0][0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

/** "1º", "2º"… el lugar de alguien en la fila de su barbero. */
export function ordinal(n: number): string {
  return `${n}º`
}

const formatosDeFecha = new Map<string, Intl.DateTimeFormat>()

/** "2026-10-19": la fecha de un instante en la zona de la sucursal (no la UTC). */
export function fechaLocal(instante: string | number, timezone: string): string {
  let formato = formatosDeFecha.get(timezone)
  if (!formato) {
    formato = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    formatosDeFecha.set(timezone, formato)
  }
  return formato.format(new Date(instante))
}

/**
 * El teléfono para llamar desde el menú, o null si no sirve: el "cliente
 * especial" (walk-in sin teléfono) tiene uno virtual que empieza con 00.
 */
export function telefonoLlamable(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '')
  if (digitos.length < 6 || digitos.startsWith('00')) return null
  return (telefono ?? '').trim()
}

/**
 * Qué lugar le tocaría a `entry` en la fila de un barbero si se lo pasa: el
 * cambio de barbero conserva su llegada (`priority_order`), así que cuenta
 * cuántos de esa fila van antes que él (`comparar`: el orden de atención del
 * tablero, con los turnos cuya hora llegó adelante).
 */
export function lugarAlPasar(
  entry: QueueEntry,
  filaDelBarbero: QueueEntry[],
  comparar: (a: QueueEntry, b: QueueEntry) => number = porOrdenDeLlegada,
): number {
  return filaDelBarbero.filter((e) => e.id !== entry.id && comparar(e, entry) < 0).length + 1
}
