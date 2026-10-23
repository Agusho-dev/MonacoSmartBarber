// =============================================================================
// Guardar un archivo que arma el dashboard (CSV, PDF, ZIP, el QR en SVG, el
// pedido de certificado), también con el dashboard instalado en el iPhone.
// 23/oct/2026.
//
// La app instalada de iOS no tiene gestor de descargas: un <a download> con un
// blob, o el doc.save() de jsPDF, pueden no hacer nada —ni archivo ni mensaje—
// o abrir una vista previa sin forma de volver a la app. Lo que sí anda es la
// hoja de compartir con el archivo adjunto ("Guardar en Archivos"). Entonces:
//
//   - app instalada + iOS/iPadOS + el navegador comparte archivos → la hoja;
//   - todo lo demás → la descarga de siempre. En Safari sin instalar, en
//     Android (instalado o no) y en la compu la descarga anda: ahí no cambia
//     nada, ni el nombre ni el contenido del archivo.
//
// A la hoja va SÓLO el archivo: hay reportes de que, con `title` o `text` al
// lado, iOS falla o descarta el adjunto. Y `navigator.share` exige un toque reciente: si armar el
// archivo tardó (traer los datos, el import de jsPDF en un teléfono lento), el
// navegador lo rechaza con NotAllowedError y queda un aviso con "Guardar", cuyo
// toque sí vale.
//
// Nunca rechaza: los que la llaman no esperan ni atrapan. Toda descarga nueva
// del dashboard pasa por acá.
// =============================================================================

import { toast } from 'sonner'
import { esAppInstalada } from '@/lib/app-instalable'

export type ResultadoGuardar =
  /** Se descargó como siempre (la compu, Safari sin instalar, Android). */
  | 'descargado'
  /** Se abrió la hoja de compartir y la persona eligió dónde (Guardar en Archivos, WhatsApp…). */
  | 'compartido'
  /**
   * No se guardó nada y el que llama no tiene que avisar: la persona cerró la
   * hoja (o ya había una abierta). Si fue un error, guardarArchivo ya avisó.
   */
  | 'cancelado'
  /** El archivo tardó y se venció el toque: quedó el aviso "Tu archivo está listo" con "Guardar". */
  | 'pendiente'

/** ¿Va el aviso de éxito del que llama ("Descargado")? Sólo si el archivo salió. */
export function salioElArchivo(r: ResultadoGuardar | null | undefined): boolean {
  return r === 'descargado' || r === 'compartido'
}

// ─── Funciones puras (probadas sin navegador) ────────────────────────────────

export type CaminoGuardar = 'compartir' | 'descargar'

export interface EntornoGuardar {
  /** El dashboard corre como app instalada (pantalla de inicio). */
  esAppInstalada: boolean
  /** iPhone, iPod o iPad, también el iPad que se presenta como Mac. */
  esIOS: boolean
  /** El navegador comparte ESTE archivo (`share` y `canShare` con `files`). */
  puedeCompartirArchivos: boolean
}

/** La hoja de compartir SÓLO en la app instalada de iOS/iPadOS que comparte archivos. */
export function caminoParaGuardar(entorno: EntornoGuardar): CaminoGuardar {
  return entorno.esAppInstalada && entorno.esIOS && entorno.puedeCompartirArchivos ? 'compartir' : 'descargar'
}

/** iPhone/iPod/iPad por el userAgent, o un iPad con iPadOS: se presenta como Mac, pero táctil. */
export function esDispositivoIOS(nav: { userAgent: string; platform: string; maxTouchPoints: number }): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

// Un Map y no un objeto: "x.constructor" no tiene que devolver una función.
const TIPO_POR_EXTENSION = new Map<string, string>([
  ['csv', 'text/csv'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['json', 'application/json'],
  ['txt', 'text/plain'],
  ['svg', 'image/svg+xml'],
  ['zip', 'application/zip'],
  ['csr', 'application/pkcs10'],
])

/** El tipo del File: el del blob y, si viene vacío, el de la extensión del nombre. */
export function tipoDeArchivo(nombre: string, tipoDelBlob: string): string {
  if (tipoDelBlob.trim()) return tipoDelBlob
  const extension = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase() ?? ''
  return TIPO_POR_EXTENSION.get(extension) ?? 'application/octet-stream'
}

/**
 * Qué hacer cuando `navigator.share` falla, según el nombre del error:
 *  - AbortError: la persona cerró la hoja. No es un error.
 *  - InvalidStateError: ya hay una hoja abierta (un doble toque): sigue esa. Una
 *    descarga además podía abrir la vista previa sin vuelta a la app.
 *  - NotAllowedError: el archivo tardó y el navegador ya no reconoce el toque.
 *  - Cualquier otro: la descarga de siempre.
 */
export function siFallaLaHoja(nombreDelError: string): 'cancelado' | 'avisar' | 'descargar' {
  if (nombreDelError === 'AbortError' || nombreDelError === 'InvalidStateError') return 'cancelado'
  if (nombreDelError === 'NotAllowedError') return 'avisar'
  return 'descargar'
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

export interface AvisosGuardar {
  /** "Tu archivo está listo" con el botón "Guardar", que llama a `guardar` desde ese toque nuevo. */
  listo: (nombre: string, detalle: string, guardar: () => void) => void
  /** No se pudo ni compartir ni descargar. */
  fallo: () => void
}

const AVISOS_SONNER: AvisosGuardar = {
  listo: (nombre, detalle, guardar) => {
    toast('Tu archivo está listo', {
      // Pedir dos veces el mismo archivo reemplaza el aviso en vez de apilar otro.
      id: `guardar-archivo:${nombre}`,
      description: detalle,
      // Más que los 4 s de siempre: hay que leerlo y tocar "Guardar".
      duration: 20_000,
      action: { label: 'Guardar', onClick: guardar },
    })
  },
  fallo: () => {
    toast.error('No pude guardar el archivo. Probá de nuevo.')
  },
}

export interface OpcionesGuardar {
  /**
   * La segunda línea del aviso "Tu archivo está listo" (por defecto, el nombre
   * del archivo). Lo que el que llama iba a avisar después de guardar —que el
   * CSV salió recortado, por ejemplo— va acá: un aviso suyo encima taparía
   * el botón "Guardar".
   */
  detalle?: string
  /** Para las pruebas: otros avisos en lugar de los de sonner. */
  avisos?: AvisosGuardar
}

// ─── Guardar ─────────────────────────────────────────────────────────────────

/** Descarga, o la hoja de compartir en la app instalada del iPhone. Nunca rechaza. */
export async function guardarArchivo(
  blob: Blob,
  nombre: string,
  opciones: OpcionesGuardar = {},
): Promise<ResultadoGuardar> {
  const avisos = opciones.avisos ?? AVISOS_SONNER
  try {
    const archivo = archivoParaLaHoja(blob, nombre)
    if (archivo) {
      try {
        await navigator.share({ files: [archivo] })
        return 'compartido'
      } catch (e) {
        const paso = siFallaLaHoja(nombreDeError(e))
        if (paso === 'cancelado') return 'cancelado'
        if (paso === 'avisar') {
          avisos.listo(nombre, opciones.detalle || nombre, () => compartirDesdeElAviso(archivo, blob, nombre, avisos))
          return 'pendiente'
        }
        console.warn('[guardar-archivo] la hoja de compartir falló: va la descarga', e)
      }
    }
    descargar(blob, nombre)
    return 'descargado'
  } catch (e) {
    // En un navegador de verdad no pasa; igual, sin rechazar y sin un "listo" falso.
    console.error('[guardar-archivo] no se pudo guardar', e)
    avisarFallo(avisos)
    return 'cancelado'
  }
}

/** El File para la hoja de compartir, o null si en este navegador va la descarga. */
function archivoParaLaHoja(blob: Blob, nombre: string): File | null {
  try {
    if (typeof navigator === 'undefined' || typeof File === 'undefined') return null
    const instalada = esAppInstalada()
    const ios = esDispositivoIOS(navigator)
    // El File se arma sólo donde puede hacer falta: en la compu ni se intenta.
    const archivo = instalada && ios ? new File([blob], nombre, { type: tipoDeArchivo(nombre, blob.type) }) : null
    const camino = caminoParaGuardar({
      esAppInstalada: instalada,
      esIOS: ios,
      puedeCompartirArchivos: archivo !== null && compartible(archivo),
    })
    return camino === 'compartir' ? archivo : null
  } catch (e) {
    console.warn('[guardar-archivo] no se pudo preparar la hoja de compartir', e)
    return null
  }
}

function compartible(archivo: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  return navigator.canShare({ files: [archivo] })
}

/** "Guardar" en el aviso: ese toque es nuevo y alcanza para abrir la hoja. */
function compartirDesdeElAviso(archivo: File, blob: Blob, nombre: string, avisos: AvisosGuardar): void {
  let hoja: Promise<void>
  try {
    hoja = navigator.share({ files: [archivo] })
  } catch (e) {
    hoja = Promise.reject(e)
  }
  hoja.catch((e: unknown) => {
    if (siFallaLaHoja(nombreDeError(e)) === 'cancelado') return
    console.warn('[guardar-archivo] la hoja no abrió ni desde el aviso: va la descarga', e)
    try {
      descargar(blob, nombre)
    } catch (errorDescarga) {
      console.error('[guardar-archivo] no se pudo descargar', errorDescarga)
      avisarFallo(avisos)
    }
  })
}

/** La descarga de siempre. */
function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari en iOS abre la vista previa y lee el blob después del click: con
  // 1 s a veces llegaba revocado. Un minuto no cuesta nada.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function avisarFallo(avisos: AvisosGuardar): void {
  try {
    avisos.fallo()
  } catch {
    // Sin avisos no queda nada más que hacer: el error ya está en la consola.
  }
}

function nombreDeError(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string' ? e.name : ''
}
