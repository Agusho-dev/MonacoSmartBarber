import { createClient } from '@/lib/supabase/client'

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null
let modelsLoaded = false
let modelsLoading: Promise<void> | null = null

const MODEL_URL = '/models'
const DETECTION_SCORE_THRESHOLD = 0.65
const MATCH_THRESHOLD = 0.55

async function loadFaceApi(): Promise<FaceApiModule> {
  if (faceapi) return faceapi
  faceapi = await import('@vladmandic/face-api')
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
      api.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
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
    .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: DETECTION_SCORE_THRESHOLD }))
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
  descriptor: Float32Array
): Promise<FaceMatchResult | null> {
  const supabase = createClient()

  const descriptorArray = Array.from(descriptor)

  const { data, error } = await supabase.rpc('match_face_descriptor', {
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
