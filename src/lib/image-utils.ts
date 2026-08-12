import type { SupabaseClient } from '@supabase/supabase-js'

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

/** Extensión que corresponde a un content-type de imagen. */
export function extensionDe(contentType: string): string {
  const sub = contentType.split('/')[1]?.split(';')[0] ?? 'bin'
  return sub === 'jpeg' ? 'jpg' : sub
}

export async function uploadVisitPhotos(
  supabase: SupabaseClient,
  visitId: string,
  imagenes: ImagenComprimida[]
): Promise<string[]> {
  const paths: string[] = []
  for (const img of imagenes) {
    // El nombre sigue al tipo REAL. Antes todo se llamaba `.webp` aunque los
    // bytes fueran PNG, y el `contentType` declarado tampoco coincidía: en el
    // bucket quedaron archivos `.webp` servidos como `image/png`.
    const filename = `${crypto.randomUUID()}.${extensionDe(img.contentType)}`
    const path = `${visitId}/${filename}`
    const { error } = await supabase.storage
      .from('visit-photos')
      .upload(path, img.blob, {
        contentType: img.contentType,
        cacheControl: '31536000',
      })
    if (error) {
      console.error('[uploadVisitPhotos]', error.message)
      continue
    }
    paths.push(path)
  }
  return paths
}

export function getPhotoUrl(
  supabase: SupabaseClient,
  path: string
): string {
  const { data } = supabase.storage.from('visit-photos').getPublicUrl(path)
  return data.publicUrl
}

// La subida del avatar del barbero se mudó a `src/lib/actions/uploads.ts`.
//
// Vivía acá y subía desde el BROWSER con la anon key, contra una policy de
// storage que exige `auth.role() = 'authenticated'`. Cuando fallaba devolvía
// `null` y el único call-site lo ignoraba: el diálogo se cerraba como si
// hubiera guardado. Entre el 22/abr/2026 y hoy no se subió un solo avatar y
// nadie vio jamás un error.
