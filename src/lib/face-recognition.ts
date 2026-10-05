import { createClient } from '@/lib/supabase/client'

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null
let modelsLoaded = false
let modelsLoading: Promise<void> | null = null

const MODEL_URL = '/models'
const DETECTION_SCORE_THRESHOLD = 0.3 // umbral más permisivo para detectar caras con poca luz o ángulo
// 0.40 era demasiado estricto (rechazaba mismo cliente con luz/ángulo distintos).
// 0.50 es el estándar de face-api.js; 0.45 ofrece balance entre recall y falsos positivos.
const MATCH_THRESHOLD = 0.48

async function loadFaceApi(): Promise<FaceApiModule> {
  if (faceapi) return faceapi
  faceapi = await import('@vladmandic/face-api')

  // Try to set WebGL backend for better performance on mobile
  interface TfBackend {
    setBackend: (name: string) => Promise<boolean>
    ready: () => Promise<void>
  }
  try {
    const tf = faceapi.tf as unknown as TfBackend
    await tf.setBackend('webgl')
    await tf.ready()
  } catch (e) {
    console.warn('WebGL backend not available, falling back', e)
    try {
      const tf = faceapi.tf as unknown as TfBackend
      await tf.setBackend('wasm')
      await tf.ready()
    } catch (e2) {
      console.warn('WASM backend not available, falling back to cpu', e2)
    }
  }

  // Optimize tensors globally
  faceapi.env.monkeyPatch({
    Canvas: HTMLCanvasElement,
    Image: HTMLImageElement,
    ImageData: ImageData,
    Video: HTMLVideoElement,
    createCanvasElement: () => document.createElement('canvas'),
    createImageElement: () => document.createElement('img')
  })

  return faceapi
}

export interface FaceLandmarkPoint {
  x: number
  y: number
}

export interface FaceDetectionResult {
  descriptor: Float32Array
  score: number
  box: { x: number; y: number; width: number; height: number }
  landmarks: FaceLandmarkPoint[]
}

export interface FaceMatchResult {
  clientId: string
  clientName: string
  clientPhone: string
  facePhotoUrl: string | null
  distance: number
}

export async function initFaceModels(): Promise<void> {
  if (modelsLoaded) return
  if (modelsLoading) return modelsLoading

  modelsLoading = (async () => {
    try {
      const api = await loadFaceApi()
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
      modelsLoaded = true
    } catch (err) {
      // Resetear el flag para permitir reintentos en próxima llamada,
      // sino la promise rejected queda cacheada para siempre.
      modelsLoading = null
      throw err
    }
  })()

  return modelsLoading
}

export function areModelsLoaded(): boolean {
  return modelsLoaded
}

export async function detectFace(
  video: HTMLVideoElement
): Promise<FaceDetectionResult | null> {
  if (!modelsLoaded || !faceapi) return null

  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: DETECTION_SCORE_THRESHOLD }))
    .withFaceLandmarks()
    .withFaceDescriptor()

  if (!detection) return null

  const { score } = detection.detection
  const { x, y, width, height } = detection.detection.box

  // Extraer los 68 puntos de landmarks faciales
  const positions = detection.landmarks.positions
  const landmarks: FaceLandmarkPoint[] = positions.map((p) => {
    const point = p as unknown as { x?: number; y?: number; _x?: number; _y?: number }
    return {
      x: point.x ?? point._x ?? 0,
      y: point.y ?? point._y ?? 0,
    }
  })

  return {
    descriptor: detection.descriptor,
    score,
    box: { x, y, width, height },
    landmarks,
  }
}

export async function matchFaceInDB(
  descriptor: Float32Array,
  targetRole: 'client' | 'staff' = 'client',
  orgId?: string | null
): Promise<FaceMatchResult | null> {
  const descriptorArray = Array.from(descriptor)

  if (targetRole === 'staff') return matchStaffEnServidor(descriptorArray, orgId)

  const supabase = createClient()
  const { data, error } = await supabase.rpc('match_face_descriptor', {
    query_descriptor: JSON.stringify(descriptorArray),
    match_threshold: MATCH_THRESHOLD,
    max_results: 1,
    p_org_id: orgId ?? null,
  })

  if (error || !data || data.length === 0) return null

  const best = data[0]
  return {
    clientId: best.client_id,
    clientName: best.client_name,
    clientPhone: best.client_phone,
    facePhotoUrl: best.face_photo_url,
    distance: best.distance,
  }
}

/**
 * Identificación del STAFF por la cara: va por el servidor
 * (`identificarStaffPorRostro`), no por la RPC con la anon key. La RPC
 * devolvía el teléfono del barbero y, sin org, buscaba en todas; la migración
 * 223 se la saca a anon. Sin org no se busca: el kiosko siempre la tiene (la
 * sucursal elegida) y sin ella la búsqueda no tiene sentido.
 *
 * Cualquier falla devuelve null, que la cámara cuenta como "no te reconozco":
 * a los tres intentos el kiosko pasa al PIN. Nunca deja la cámara colgada.
 */
async function matchStaffEnServidor(
  descriptor: number[],
  orgId?: string | null,
): Promise<FaceMatchResult | null> {
  if (!orgId) {
    console.error('[matchFaceInDB] identificación de staff sin organización: se pide el PIN')
    return null
  }
  try {
    const { identificarStaffPorRostro } = await import('@/lib/actions/rostro-staff')
    const res = await identificarStaffPorRostro({ descriptor, orgId })
    if (!res.ok) {
      console.error('[matchFaceInDB] staff:', res.error)
      return null
    }
    if (!res.staff) return null
    return {
      clientId: res.staff.id,
      clientName: res.staff.nombre,
      // El teléfono del barbero ya no sale de la base hacia la tablet.
      clientPhone: '',
      facePhotoUrl: null,
      distance: res.staff.distancia,
    }
  } catch (err) {
    console.error('[matchFaceInDB] staff:', err)
    return null
  }
}

export async function enrollFaceDescriptor(
  clientId: string,
  descriptor: Float32Array,
  source: 'checkin' | 'barber' = 'checkin',
  qualityScore = 0,
  branchId?: string | null,
): Promise<boolean> {
  const descriptorArray = Array.from(descriptor)
  const { enrollClientFace } = await import('@/lib/actions/clients')
  return await enrollClientFace(clientId, descriptorArray, source, qualityScore, branchId)
}

export async function saveFacePhoto(
  clientId: string,
  photoBlob: Blob,
  branchId?: string | null,
): Promise<string | null> {
  const supabase = createClient()
  const filename = `${clientId}/${crypto.randomUUID()}.webp`

  // Storage allows upload because anon has rights to upload to face-references
  const { error: uploadError } = await supabase.storage
    .from('face-references')
    .upload(filename, photoBlob, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    })

  if (uploadError) return null

  const { data } = supabase.storage
    .from('face-references')
    .getPublicUrl(filename)

  // Use Server Action to update the client's photo_url (bypasses RLS limits for anonymous users)
  const { saveClientFacePhotoUrl } = await import('@/lib/actions/clients')
  const success = await saveClientFacePhotoUrl(clientId, data.publicUrl, branchId)
  
  if (!success) {
    console.error('Failed to save public URL to client record via Server Action')
    return null
  }

  return data.publicUrl
}

/**
 * Registra la cara del barbero que acaba de verificar su PIN en el kiosko.
 *
 * `permiso` es el que devuelve `verificarPinStaffEnKiosko` (5 minutos de vida):
 * el servidor saca de ahí quién es el barbero, así que este camino no confía en
 * ningún id que mande el browser. Manda todas las capturas en UNA llamada.
 *
 * Nunca tira: un error de red o del servidor vuelve como `{ ok: false, error }`
 * con un texto para mostrar.
 */
export async function registrarRostroDelStaff(
  permiso: string,
  descriptores: Float32Array[],
  opciones: { calidad?: number; origen?: 'checkin' | 'barber' } = {},
): Promise<{ ok: true; guardados: number } | { ok: false; error: string }> {
  try {
    const { registrarRostroStaff } = await import('@/lib/actions/rostro-staff')
    const res = await registrarRostroStaff({
      permiso,
      descriptores: descriptores.map((d) => Array.from(d)),
      calidad: opciones.calidad,
      origen: opciones.origen ?? 'checkin',
    })
    if (!res.ok) console.error('[registrarRostroDelStaff]', res.error)
    return res
  } catch (err) {
    console.error('[registrarRostroDelStaff]', err)
    return { ok: false, error: 'No pudimos guardar tu rostro. Revisá la conexión y probá de nuevo.' }
  }
}

export function captureFrameAsBlob(
  video: HTMLVideoElement,
  maxWidth = 480,
  quality = 0.8
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ratio = Math.min(maxWidth / video.videoWidth, 1)
    canvas.width = Math.round(video.videoWidth * ratio)
    canvas.height = Math.round(video.videoHeight * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => resolve(blob),
      'image/webp',
      quality
    )
  })
}
