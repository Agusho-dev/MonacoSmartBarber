/** Lo que sale de comprimir: los bytes y con qué tipo hay que subirlos. */
export interface ImagenComprimida {
  blob: Blob
  /** El tipo REAL del blob, que no siempre es el pedido (ver abajo). */
  contentType: string
  /** true si no se pudo redimensionar y va el archivo original. */
  original: boolean
}

/**
 * Achica una imagen para subirla, sin fallar cuando no puede.
 *
 * Dos cosas que la versión anterior daba por sentadas y no son ciertas:
 *
 *   · **Que el browser puede decodificar el archivo.** Un HEIC de iPhone
 *     elegido desde una Mac dispara `img.onerror` y la promesa se rechazaba:
 *     la foto no se subía y el usuario no veía nada. Ahora, si no se puede
 *     decodificar, se sube el ORIGINAL — pesa más, pero llega.
 *   · **Que `canvas.toBlob(…, 'image/webp')` devuelve WebP.** Si el browser no
 *     sabe codificar WebP, la especificación dice que caiga en PNG, y eso es
 *     exactamente lo que pasó en producción: hay archivos `.webp` de 2 MB
 *     guardados con `mimetype: image/png`. Por eso el tipo real se lee del
 *     blob y se devuelve, en vez de asumirlo al subir.
 */
export async function compressToWebP(
  file: File,
  maxWidth = 1200,
  quality = 0.75
): Promise<ImagenComprimida> {
  let bitmap: ImageBitmap | null = null

  try {
    // `createImageBitmap` decodifica fuera del hilo principal y acepta más
    // formatos que `new Image()`.
    bitmap = await createImageBitmap(file)
  } catch {
    bitmap = null
  }

  if (!bitmap) {
    return { blob: file, contentType: file.type || 'application/octet-stream', original: true }
  }

  try {
    const ratio = Math.min(maxWidth / bitmap.width, maxWidth / bitmap.height, 1)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin contexto 2d')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', quality)
    )
    if (!blob) throw new Error('toBlob vacío')

    return { blob, contentType: blob.type || 'image/webp', original: false }
  } catch {
    // Cualquier tropiezo del canvas: mejor el original que nada.
    return { blob: file, contentType: file.type || 'application/octet-stream', original: true }
  } finally {
    bitmap.close()
  }
}

// ─── Fotos del corte ────────────────────────────────────────────────────────

/** Resultado de comprimir una foto del corte: o los bytes listos para subir, o por qué no. */
export type FotoDeCorteComprimida =
  | { ok: true; blob: Blob; contentType: 'image/webp' | 'image/jpeg'; ancho: number; alto: number }
  | { ok: false; motivo: 'formato' | 'pesada' }

/** Codifica el canvas; null si el navegador no pudo. */
function codificar(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), tipo, calidad)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Comprime una foto del corte para subirla. Es distinta de `compressToWebP` a
 * propósito, y NO la reemplaza (esa la usan premios, campañas, avatares y
 * comprobantes, donde un PNG con transparencia tiene que seguir siendo PNG):
 *
 *   · **WebP y, si el navegador no lo codifica, JPEG 0,82.** Safari (el iPhone
 *     del barbero que escanea el QR) no codifica WebP y `toBlob` caía a PNG:
 *     las dos fotos del 27/8/2026 pesaban 2,0 y 2,1 MB. En JPEG son ~250 KB.
 *   · **Si la imagen no se puede decodificar (un HEIC desde una Mac), NO se
 *     sube nada** y se dice por qué. Subir el original sólo servía para que el
 *     servidor o el bucket lo rechazaran después, en silencio.
 *   · **Respeta la orientación de la cámara (EXIF) y nunca endereza nada más.**
 *     Con el panel girado 180° la foto igual sale derecha: la toma la cámara
 *     nativa con la tablet en la mano (ver src/lib/giro-panel/camara.ts).
 *   · El canvas descarta el EXIF al recodificar, incluido el GPS del celular.
 */
export async function comprimirFotoDeCorte(
  archivo: File | Blob,
  opciones: { ladoMaximo?: number; calidad?: number; bytesMaximos?: number } = {},
): Promise<FotoDeCorteComprimida> {
  const ladoMaximo = opciones.ladoMaximo ?? 1600
  const calidad = opciones.calidad ?? 0.82
  const bytesMaximos = opciones.bytesMaximos ?? 4 * 1024 * 1024

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
  } catch {
    try {
      // Navegadores que no aceptan el diccionario de opciones.
      bitmap = await createImageBitmap(archivo)
    } catch {
      bitmap = null
    }
  }
  if (!bitmap) return { ok: false, motivo: 'formato' }

  try {
    // Dos intentos: el normal y, si todavía pesa de más, uno más chico.
    for (const [lado, q] of [[ladoMaximo, calidad], [Math.round(ladoMaximo * 0.75), Math.min(calidad, 0.7)]] as const) {
      const ratio = Math.min(lado / bitmap.width, lado / bitmap.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      const ctx = canvas.getContext('2d')
      if (!ctx) return { ok: false, motivo: 'formato' }
      // Fondo blanco: una foto no lleva transparencia y JPEG la pintaría negra.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      let blob = await codificar(canvas, 'image/webp', q)
      if (!blob || blob.type !== 'image/webp') blob = await codificar(canvas, 'image/jpeg', q)
      if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) return { ok: false, motivo: 'formato' }

      if (blob.size <= bytesMaximos) {
        return {
          ok: true,
          blob,
          contentType: blob.type as 'image/webp' | 'image/jpeg',
          ancho: canvas.width,
          alto: canvas.height,
        }
      }
    }
    return { ok: false, motivo: 'pesada' }
  } catch {
    return { ok: false, motivo: 'formato' }
  } finally {
    bitmap.close()
  }
}

// La subida del avatar del barbero se mudó a `src/lib/actions/uploads.ts`.
//
// Vivía acá y subía desde el BROWSER con la anon key, contra una policy de
// storage que exige `auth.role() = 'authenticated'`. Cuando fallaba devolvía
// `null` y el único call-site lo ignoraba: el diálogo se cerraba como si
// hubiera guardado. Entre el 22/abr/2026 y hoy no se subió un solo avatar y
// nadie vio jamás un error.
