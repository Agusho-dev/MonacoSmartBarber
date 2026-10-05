/**
 * Subida de UNA foto desde el navegador directo a Storage, con la URL firmada
 * que entregó el servidor (mig 219). Los bytes no pasan por Next: un server
 * action los serializaba con el cobro y Vercel corta los cuerpos de más de
 * 4,5 MB.
 *
 * XMLHttpRequest y no fetch: es lo único que informa el progreso de una SUBIDA
 * (la tira de miniaturas lo dibuja) y trae timeout y abort propios.
 */

import { unstable_isUnrecognizedActionError } from 'next/navigation'

export type ResultadoPut =
  | { ok: true }
  | { ok: false; motivo: 'red' | 'timeout' | 'cancelada' | 'pesada' | 'formato' | 'rechazada'; detalle?: string }

interface OpcionesPut {
  onProgreso?: (fraccion: number) => void
  signal?: AbortSignal
  /** Por defecto 90 s: una foto de 300 KB con el wifi del local tarda 1–3 s. */
  timeoutMs?: number
}

export function subirAUrlFirmada(url: string, blob: Blob, opciones: OpcionesPut = {}): Promise<ResultadoPut> {
  return new Promise((resolve) => {
    if (opciones.signal?.aborted) {
      resolve({ ok: false, motivo: 'cancelada' })
      return
    }

    const xhr = new XMLHttpRequest()
    let terminado = false
    const terminar = (r: ResultadoPut) => {
      if (terminado) return
      terminado = true
      opciones.signal?.removeEventListener('abort', alCancelar)
      resolve(r)
    }
    const alCancelar = () => {
      xhr.abort()
      terminar({ ok: false, motivo: 'cancelada' })
    }
    opciones.signal?.addEventListener('abort', alCancelar)

    xhr.open('PUT', url)
    xhr.timeout = opciones.timeoutMs ?? 90_000
    // Mismo pedido que hace storage-js con un cuerpo binario. La URL ya trae el
    // token de la firma; apikey es la clave pública (va en el bundle igual).
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream')
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.setRequestHeader('x-upsert', 'false')
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (anon) xhr.setRequestHeader('apikey', anon)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opciones.onProgreso?.(Math.min(1, e.loaded / e.total))
    }
    xhr.onload = () => {
      const cuerpo = typeof xhr.responseText === 'string' ? xhr.responseText : ''
      if (xhr.status >= 200 && xhr.status < 300) {
        opciones.onProgreso?.(1)
        terminar({ ok: true })
        return
      }
      // Ya estaba subida: el primer intento llegó y se perdió la respuesta. La
      // firma es sin sobrescribir, así que Storage contesta "Duplicate".
      if (xhr.status === 409 || /duplicate|already exists/i.test(cuerpo)) {
        terminar({ ok: true })
        return
      }
      if (xhr.status === 413 || /maximum allowed size|payload too large|entity too large/i.test(cuerpo)) {
        terminar({ ok: false, motivo: 'pesada', detalle: cuerpo.slice(0, 200) })
        return
      }
      if (xhr.status === 415 || /mime type|invalid_mime/i.test(cuerpo)) {
        terminar({ ok: false, motivo: 'formato', detalle: cuerpo.slice(0, 200) })
        return
      }
      terminar({ ok: false, motivo: 'rechazada', detalle: `${xhr.status} ${cuerpo.slice(0, 200)}` })
    }
    xhr.onerror = () => terminar({ ok: false, motivo: 'red' })
    xhr.ontimeout = () => terminar({ ok: false, motivo: 'timeout' })
    xhr.onabort = () => terminar({ ok: false, motivo: 'cancelada' })

    xhr.send(blob)
  })
}

/**
 * ¿El panel quedó viejo? Después de un deploy, las server actions del bundle
 * anterior dejan de existir ("Server Action … was not found on the server"):
 * la única salida es recargar la página, y hay que decirlo así.
 */
export function esVersionDesactualizada(e: unknown): boolean {
  try {
    if (unstable_isUnrecognizedActionError(e)) return true
  } catch {
    // La API es inestable: si cambia, el texto del error alcanza.
  }
  const mensaje = e instanceof Error ? e.message : String(e ?? '')
  return /server action .* was not found|failed to find server action/i.test(mensaje)
}

export const TEXTO_VERSION_NUEVA = 'Hay una versión nueva del panel. Recargá la página para seguir.'
