/**
 * Validadores síncronos compartidos.
 * NO marcar este archivo con 'use server' — las funciones son sync utilities.
 */

/** Valida UUID v4 antes de interpolarlo en .or() u otras queries dinámicas. */
export function isValidUUID(str: string | undefined | null): boolean {
  if (!str) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}
