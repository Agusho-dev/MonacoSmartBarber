import type { SupabaseClient } from '@supabase/supabase-js'

export async function compressToWebP(
  file: File,
  maxWidth = 1200,
  quality = 0.75
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(maxWidth / img.width, maxWidth / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/webp',
        quality
      )
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

export async function uploadVisitPhotos(
  supabase: SupabaseClient,
  visitId: string,
  blobs: Blob[]
): Promise<string[]> {
  const paths: string[] = []
  for (const blob of blobs) {
    const filename = `${crypto.randomUUID()}.webp`
    const path = `${visitId}/${filename}`
    const { error } = await supabase.storage
      .from('visit-photos')
      .upload(path, blob, {
        contentType: 'image/webp',
        cacheControl: '31536000',
      })
    if (!error) paths.push(path)
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
