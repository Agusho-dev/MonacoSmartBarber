import { createClient } from '@/lib/supabase/client'

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null
let modelsLoaded = false
let modelsLoading: Promise<void> | null = null

const MODEL_URL = '/models'
const DETECTION_SCORE_THRESHOLD = 0.65
const MATCH_THRESHOLD = 0.40 // umbral estricto para evitar falsos positivos con caras nuevas

async function loadFaceApi(): Promise<FaceApiModule> {
  if (faceapi) return faceapi
  faceapi = await import('@vladmandic/face-api')

  // Try to set WebGL backend for better performance on mobile
  try {
    const tf = faceapi.tf as any
    await tf.setBackend('webgl')
    await tf.ready()
  } catch (e) {
    console.warn('WebGL backend not available, falling back', e)
    try {
      const tf = faceapi.tf as any
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

export interface FaceDetectionResult {
  descriptor: Float32Array
  score: number
  box: { x: number; y: number; width: number; height: number }
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
    const api = await loadFaceApi()
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    modelsLoaded = true
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

  return {
    descriptor: detection.descriptor,
    score,
    box: { x, y, width, height },
  }
}

export async function matchFaceInDB(
  descriptor: Float32Array,
  targetRole: 'client' | 'staff' = 'client'
): Promise<FaceMatchResult | null> {
  const supabase = createClient()

  const descriptorArray = Array.from(descriptor)
  const rpcName = targetRole === 'staff' ? 'match_staff_face_descriptor' : 'match_face_descriptor'

  const { data, error } = await supabase.rpc(rpcName as any, {
    query_descriptor: JSON.stringify(descriptorArray),
    match_threshold: MATCH_THRESHOLD,
    max_results: 1,
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

export async function enrollFaceDescriptor(
  clientId: string,
  descriptor: Float32Array,
  source: 'checkin' | 'barber' = 'checkin',
  qualityScore = 0
): Promise<boolean> {
  const supabase = createClient()
  const descriptorArray = Array.from(descriptor)

  const { error } = await supabase.from('client_face_descriptors').insert({
    client_id: clientId,
    descriptor: JSON.stringify(descriptorArray),
    quality_score: qualityScore,
    source,
  })

  return !error
}

export async function saveFacePhoto(
  clientId: string,
  photoBlob: Blob
): Promise<string | null> {
  const supabase = createClient()
  const filename = `${clientId}/${crypto.randomUUID()}.webp`

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

  await supabase
    .from('clients')
    .update({ face_photo_url: data.publicUrl })
    .eq('id', clientId)

  return data.publicUrl
}

export async function enrollStaffFaceDescriptor(
  staffId: string,
  descriptor: Float32Array,
  source: 'checkin' | 'barber' = 'barber',
  qualityScore = 0
): Promise<boolean> {
  const supabase = createClient()
  const descriptorArray = Array.from(descriptor)

  const { error } = await supabase.from('staff_face_descriptors').insert({
    staff_id: staffId,
    descriptor: JSON.stringify(descriptorArray),
    quality_score: qualityScore,
    source,
  })

  return !error
}

export async function saveStaffFacePhoto(
  staffId: string,
  photoBlob: Blob
): Promise<string | null> {
  const supabase = createClient()
  const filename = `${staffId}/${crypto.randomUUID()}-staff.webp`

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

  // We don't have face_photo_url on staff table yet, so we just return the URL for now 
  // or could optionally update if we add that column later.
  return data.publicUrl
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
