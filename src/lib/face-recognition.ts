import { createClient } from '@/lib/supabase/client'
import type { TNetInput } from '@vladmandic/face-api'

type FaceApiModule = typeof import('@vladmandic/face-api')

let faceapi: FaceApiModule | null = null
let modelsLoaded = false
let modelsLoading: Promise<void> | null = null

const MODEL_URL = '/models'
const DETECTION_SCORE_THRESHOLD = 0.3 // umbral más permisivo para detectar caras con poca luz o ángulo
// 0.40 era demasiado estricto (rechazaba mismo cliente con luz/ángulo distintos).
// 0.50 es el estándar de face-api.js; 0.45 ofrece balance entre recall y falsos positivos.
const MATCH_THRESHOLD = 0.48

/**
 * Lo que se usa de tfjs. El paquete trae tfjs entero, pero sus tipos exponen
 * sólo una parte (por eso antes se casteaba `setBackend`).
 */
interface Tensor {
  readonly shape: number[]
  dispose(): void
  data(): Promise<ArrayLike<number>>
}
interface Tf {
  setBackend(name: string): Promise<boolean>
  ready(): Promise<void>
  tidy<T extends Tensor>(fn: () => T): T
  browser: { fromPixels(fuente: HTMLVideoElement): Tensor }
  cast(x: Tensor, dtype: 'float32' | 'int32'): Tensor
  avgPool(x: Tensor, filtro: number, paso: number, relleno: 'valid'): Tensor
  slice(x: Tensor, inicio: number[], tamano: number[]): Tensor
  mean(x: Tensor): Tensor
  zeros(forma: number[], dtype?: 'float32' | 'int32'): Tensor
  expandDims(x: Tensor, eje?: number): Tensor
  squeeze(x: Tensor, ejes?: number[]): Tensor
  tensor1d(valores: number[], dtype?: 'int32'): Tensor
  tensor2d(valores: number[][]): Tensor
  image: {
    cropAndResize(
      imagen: Tensor,
      cajas: Tensor,
      indices: Tensor,
      tamano: [number, number],
      metodo?: 'bilinear' | 'nearest',
      relleno?: number,
    ): Tensor
  }
}

function tfDe(api: FaceApiModule): Tf {
  return api.tf as unknown as Tf
}

async function loadFaceApi(): Promise<FaceApiModule> {
  if (faceapi) return faceapi
  faceapi = await import('@vladmandic/face-api')
  const tf = tfDe(faceapi)

  // NO prender `WEBGL_USE_SHAPES_UNIFORMS` (evitaría recompilar shaders con
  // cada forma nueva): con tfjs 4.22, el detector deja de encontrar caras con
  // entradas distintas de 320 y no tira ningún error. Medido el 19/10/2026: la
  // misma imagen da una cara con 416 y el flag apagado, y ninguna con el flag
  // prendido. Un bug así en la red del descriptor sería invisible. Las
  // recompilaciones se evitan de otra forma: el rastreo trabaja con recortes de
  // tamaño fijo (`recortar`).

  // Try to set WebGL backend for better performance on mobile
  try {
    await tf.setBackend('webgl')
    await tf.ready()
  } catch (e) {
    console.warn('WebGL backend not available, falling back', e)
    try {
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

/** Baja los tres modelos una vez por carga de la página. Desde afuera se usa `precalentarReconocimiento`. */
async function initFaceModels(): Promise<void> {
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

/**
 * Detector + 68 puntos + descriptor por el camino de siempre de face-api (el
 * video pasa por canvas). Es el camino con el que se calcularon los
 * descriptores guardados, así que es el único que se compara contra la base.
 */
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

// ── Rastreo (seguir la cara cuadro a cuadro, sin descriptor) ────────────────

/**
 * La cara del cuadro actual, para SEGUIRLA: dibujar la malla, encuadrar y
 * decidir si la lectura sirve. No trae descriptor; ése sale de `detectFace`.
 */
export interface RastreoCara {
  /** 68 puntos intercalados [x0, y0, x1, y1, …] en px del video. */
  puntos: Float32Array
  caja: { x: number; y: number; width: number; height: number }
  confianza: number
  /** Brillo medio del centro de la cara (0–255). */
  luz: number
  ancho: number
  alto: number
}

/**
 * Lado al que se lleva el recorte de la cara antes de bajarlo a los 112 px de
 * la red de puntos con un promedio 2×2 (sin serrucho).
 */
const LADO_CARA = 224
/** Lado al que se lleva una zona de búsqueda (entrada 416 del detector). */
const LADO_ZONA = 416

function opcionesRastreo(api: FaceApiModule, entrada = 320) {
  return new api.TinyFaceDetectorOptions({ inputSize: entrada, scoreThreshold: 0.35 })
}

/**
 * Recorta el cuadrado (x, y, lado) —en px, puede salirse del cuadro: lo que
 * cae afuera queda negro, como el relleno de face-api— y lo lleva a
 * `salida`×`salida`. Con un recorte de tamaño FIJO la GPU siempre corre los
 * mismos programas: con `slice` del tamaño de la cara, cada tamaño nuevo
 * compilaba shaders y trababa la pantalla (100–200 ms medidos en una Mac; en la
 * Mali de la tablet, bastante más).
 */
function recortar(tf: Tf, imagen: Tensor, x: number, y: number, lado: number, salida: number): Tensor {
  const [alto, ancho] = imagen.shape
  return tf.tidy(() => {
    const caja = tf.tensor2d([
      [y / (alto - 1), x / (ancho - 1), (y + lado) / (alto - 1), (x + lado) / (ancho - 1)],
    ])
    const recorte = tf.image.cropAndResize(tf.expandDims(imagen, 0), caja, tf.tensor1d([0], 'int32'), [salida, salida], 'bilinear', 0)
    return tf.squeeze(recorte, [0])
  })
}

/** Zona del video (en px) donde buscar la cara a resolución completa: un zoom digital para caras lejanas. */
export interface RegionBusqueda {
  /** Centro de la zona. */
  x: number
  y: number
  /** Lado del cuadrado. */
  lado: number
}

/**
 * Detector + 68 puntos sobre UN tensor del cuadro, sin pasar por canvas.
 *
 * `detectFace` le da el video a face-api, que por cada red redibuja el cuadro
 * entero en un canvas y baja el recorte de la cara a la CPU con `getImageData`:
 * tres copias del cuadro y dos lecturas de la GPU por llamada, más la red del
 * descriptor, que es la más pesada. Para SEGUIR la cara diez veces por segundo
 * eso no da; acá el cuadro se sube una vez y todo lo demás pasa en la GPU:
 *   - el detector corre sobre el cuadro reducido a la mitad con un promedio
 *     2×2 (un cuarto de los píxeles, con un filtro que no deja serrucho),
 *   - los 68 puntos salen de un recorte de la cara a resolución completa, de
 *     tamaño fijo (ver `recortar`): después del precalentado no se compila
 *     ningún shader más, sea cual sea el tamaño de la cara,
 *   - el brillo de la cara sale del mismo recorte.
 *
 * Los descriptores que se COMPARAN contra la base siguen saliendo de
 * `detectFace`, por el mismo camino con el que se calcularon los que hay
 * guardados: éste da puntos casi idénticos, que para dibujar alcanzan, pero
 * para reconocer no se arriesga ni una décima.
 *
 * Una cara a más de un metro, en el cuadro reducido, mide menos de lo que el
 * detector alcanza a ver. Para esos casos:
 *   - `completo`: el detector mira el cuadro entero, sin reducir, con entrada
 *     416. Cuesta casi el doble; el escáner lo usa mientras no ve a nadie.
 *   - `region`: mira sólo esa zona, a resolución completa (un zoom digital). El
 *     escáner la usa para seguir a una cara lejana sin perderla.
 * Así puede decir "acercate" en vez de quedarse en "mirá a la cámara".
 */
export async function rastrearCara(
  video: HTMLVideoElement,
  opciones: { region?: RegionBusqueda; completo?: boolean } = {},
): Promise<RastreoCara | null> {
  if (!modelsLoaded || !faceapi) return null
  const ancho = video.videoWidth
  const alto = video.videoHeight
  if (!ancho || !alto || video.readyState < 2) return null

  const api = faceapi
  const tf = tfDe(api)
  const cuadro = tf.tidy(() => tf.cast(tf.browser.fromPixels(video), 'float32'))
  try {
    let entrada: Tensor = cuadro
    let escala = 1
    let ox = 0
    let oy = 0
    let tamanoEntrada = 320
    const region = opciones.region
    if (region) {
      const lado = Math.min(region.lado, ancho, alto)
      ox = region.x - lado / 2
      oy = region.y - lado / 2
      entrada = recortar(tf, cuadro, ox, oy, lado, LADO_ZONA)
      escala = lado / LADO_ZONA
      tamanoEntrada = LADO_ZONA
    } else if (opciones.completo) {
      tamanoEntrada = 416
    } else if (Math.max(ancho, alto) >= 960) {
      entrada = tf.avgPool(cuadro, 2, 2, 'valid')
      escala = 2
    }
    let detecciones: Awaited<ReturnType<typeof api.nets.tinyFaceDetector.locateFaces>>
    try {
      detecciones = await api.nets.tinyFaceDetector.locateFaces(
        entrada as unknown as TNetInput,
        opcionesRastreo(api, tamanoEntrada),
      )
    } finally {
      if (entrada !== cuadro) entrada.dispose()
    }
    if (detecciones.length === 0) return null

    // Con dos caras (alguien atrás), la más grande: es la de quien está frente a la tablet.
    let mejor = detecciones[0]
    for (const d of detecciones) {
      if (d.box.width * d.box.height > mejor.box.width * mejor.box.height) mejor = d
    }
    const bx = ox + mejor.box.x * escala
    const by = oy + mejor.box.y * escala
    const bw = mejor.box.width * escala
    const bh = mejor.box.height * escala

    // La red de puntos espera la caja del detector llevada a cuadrado: el lado
    // mayor, centrado (face-api rellena con negro; acá lo que cae afuera del
    // cuadro también queda negro).
    const lado = Math.max(bw, bh)
    const x = bx + bw / 2 - lado / 2
    const y = by + bh / 2 - lado / 2
    const cara = tf.tidy(() => tf.avgPool(recortar(tf, cuadro, x, y, lado, LADO_CARA), 2, 2, 'valid'))
    try {
      const marcas = await api.nets.faceLandmark68Net.detectLandmarks(cara as unknown as TNetInput)
      const posiciones = (Array.isArray(marcas) ? marcas[0] : marcas).positions

      // Brillo del centro de la cara (ojos, nariz, mejillas), sin pelo ni fondo.
      const medio = LADO_CARA / 2
      const brillo = tf.tidy(() => tf.mean(tf.slice(cara, [medio / 4, medio / 4, 0], [medio / 2, medio / 2, 3])))
      let luz = 128
      try {
        luz = (await brillo.data())[0]
      } finally {
        brillo.dispose()
      }

      // Los puntos vienen en px del recorte de 112: vuelven a px del video.
      const k = lado / medio
      const puntos = new Float32Array(posiciones.length * 2)
      for (let i = 0; i < posiciones.length; i++) {
        puntos[2 * i] = x + posiciones[i].x * k
        puntos[2 * i + 1] = y + posiciones[i].y * k
      }
      return { puntos, caja: { x: bx, y: by, width: bw, height: bh }, confianza: mejor.score, luz, ancho, alto }
    } finally {
      cara.dispose()
    }
  } finally {
    cuadro.dispose()
  }
}

let precalentado: Promise<void> | null = null

/**
 * Carga los modelos y los hace correr una vez en vacío.
 *
 * La primera inferencia de cada red en WebGL compila sus shaders: en la Mali de
 * la Redmi Pad 2 es más de un segundo con la pantalla trabada, y la pagaba la
 * primera persona que miraba la cámara. El kiosko llama a esto mientras está en
 * el inicio sin nadie. Si falla, la próxima llamada lo vuelve a intentar.
 */
export function precalentarReconocimiento(): Promise<void> {
  if (precalentado) return precalentado
  const promesa = (async () => {
    await initFaceModels()
    const api = faceapi
    if (!api) return
    const tf = tfDe(api)
    // Rastreo, con las mismas formas que `rastrearCara` sobre un 720p: el
    // detector sobre el cuadro reducido (320), entero (416) y sobre una zona
    // (416), y la red de puntos sobre el recorte fijo de la cara.
    const cuadro = tf.zeros([720, 1280, 3])
    try {
      const reducido = tf.avgPool(cuadro, 2, 2, 'valid')
      try {
        await api.nets.tinyFaceDetector.locateFaces(reducido as unknown as TNetInput, opcionesRastreo(api))
      } finally {
        reducido.dispose()
      }
      await api.nets.tinyFaceDetector.locateFaces(cuadro as unknown as TNetInput, opcionesRastreo(api, 416))
      const zona = recortar(tf, cuadro, 400, 160, 480, LADO_ZONA)
      try {
        await api.nets.tinyFaceDetector.locateFaces(zona as unknown as TNetInput, opcionesRastreo(api, LADO_ZONA))
      } finally {
        zona.dispose()
      }
      const cara = tf.tidy(() => tf.avgPool(recortar(tf, cuadro, 500, 220, 280, LADO_CARA), 2, 2, 'valid'))
      try {
        await api.nets.faceLandmark68Net.detectLandmarks(cara as unknown as TNetInput)
        const brillo = tf.tidy(() => tf.mean(tf.slice(cara, [28, 28, 0], [56, 56, 3])))
        await brillo.data()
        brillo.dispose()
      } finally {
        cara.dispose()
      }
    } finally {
      cuadro.dispose()
    }
    // Muestra (`detectFace`): la red de puntos a 112 y la del descriptor, la más pesada.
    const puntos = tf.zeros([112, 112, 3])
    try {
      await api.nets.faceLandmark68Net.detectLandmarks(puntos as unknown as TNetInput)
    } finally {
      puntos.dispose()
    }
    const cara = tf.zeros([150, 150, 3])
    try {
      await api.nets.faceRecognitionNet.computeFaceDescriptor(cara as unknown as TNetInput)
    } finally {
      cara.dispose()
    }
  })()
  precalentado = promesa
  promesa.catch(() => {
    if (precalentado === promesa) precalentado = null
  })
  return promesa
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

