'use client'

// Toda server action de la pantalla pasa por acá. Una action puede TIRAR (sin
// red, el servidor cortó, o la pestaña quedó con el bundle de un deploy viejo y
// la action ya no existe): eso no puede quedar como un botón que "no hace
// nada" ni como una promesa rechazada sin atrapar. Se convierte en un
// { ok: false, error } que la pantalla muestra, y si es por versión se avisa y
// se recarga (src/lib/recarga-version.ts, Known Risk #38).

import { toast } from 'sonner'
import { avisarYRecargarPorVersion, esErrorDeVersion, TEXTO_RECARGA_MANUAL } from '@/lib/recarga-version'

export interface Fallo {
  ok: false
  error: string
}

export const ERROR_SIN_CONEXION = 'No pudimos hablar con el servidor. Revisá la conexión y probá de nuevo.'

export async function llamar<T>(accion: () => Promise<T>): Promise<T | Fallo> {
  try {
    return await accion()
  } catch (e) {
    if (esErrorDeVersion(e)) {
      if (!avisarYRecargarPorVersion()) toast.error(TEXTO_RECARGA_MANUAL, { id: 'recarga-manual' })
      return { ok: false, error: TEXTO_RECARGA_MANUAL }
    }
    console.error('[conciliacion-mp]', e)
    return { ok: false, error: ERROR_SIN_CONEXION }
  }
}

/** Copia un texto. false si el navegador no dejó (la pantalla ofrece copiarlo a mano). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
