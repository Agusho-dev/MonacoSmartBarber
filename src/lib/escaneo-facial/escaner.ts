/**
 * Motor del escáner facial del kiosko (sin React).
 *
 * Junta las piezas y les marca el ritmo:
 *   - la cámara frontal en 720p: el doble de píxeles sobre la cara que el 480p
 *     de antes, que es detalle real para el descriptor;
 *   - el RASTREO (`rastrearCara`), 10–20 veces por segundo: dónde está la cara,
 *     hacia dónde mira y si sirve para leerla;
 *   - las MUESTRAS (`detectFace`, el camino canónico): sólo cuando la cara
 *     sirve, 2–3 de la misma persona, y se compara el PROMEDIO;
 *   - el DIBUJO, a la tasa de la pantalla, con los puntos suavizados y el
 *     encuadre que sigue a la cara (como el Center Stage de un iPad: la persona
 *     no tiene que acomodarse en un recuadro, la lente la busca a ella).
 *
 * Por qué dos ritmos: para que la malla se sienta pegada a la cara hay que
 * dibujar a 60–90 cuadros por segundo, y la tablet no puede correr las redes a
 * esa velocidad. Entre una medición y la siguiente el dibujo predice con la
 * velocidad de la cara y se acerca con un resorte: se ve continuo aunque las
 * mediciones lleguen cada 70–120 ms.
 *
 * Lo que cambió respecto de la cámara anterior y por qué:
 *   - Antes cada vuelta calculaba el descriptor (la red más pesada) aunque sólo
 *     hiciera falta saber si había una cara, y cada intento fallido tapaba la
 *     cámara 2 segundos con "No te reconocemos". Un cliente nuevo esperaba ~8 s
 *     antes de que le ofrecieran el teléfono.
 *   - Se comparaban muestras sueltas y hacían falta dos coincidencias seguidas,
 *     cada una con su viaje a la base. Ahora el promedio de 2 muestras
 *     coherentes va en un solo viaje: menos ruido y la mitad de espera.
 *   - La malla se dibujaba donde estaba la cara hace medio segundo y con un
 *     `shadowBlur` por punto; ahora sigue a la cara y no tiene blur.
 */

import {
  detectFace,
  precalentarReconocimiento,
  rastrearCara,
  type RastreoCara,
  type RegionBusqueda,
} from '@/lib/face-recognition'
import { EscenaEscaner } from './dibujo'
import { FiltroCara } from './filtro'
import {
  CANTIDAD_PUNTOS,
  LIMITES_IDENTIFICAR,
  LIMITES_REGISTRAR,
  distanciaDescriptores,
  encuadreDeCara,
  evaluarCara,
  leerPose,
  promedioDescriptores,
  solapamiento,
  type LimitesLectura,
  type MedicionCara,
  type PoseCara,
} from './geometria'
import type {
  ErrorEscaner,
  EstadoVisible,
  FaseEscaner,
  Guia,
  LecturaFacial,
  ModoEscaner,
  ResultadoEscaner,
  Veredicto,
} from './tipos'

/**
 * Cuánto dura cada final antes de avisarle a la pantalla: la animación tiene
 * que verse entera (en el éxito, el tilde del sello termina a los 1180 ms).
 */
const DURACION_EXITO_MS = 1300
const DURACION_FALLO_MS = 1100
const DURACION_REINTENTO_MS = 850
/** Sin cara este tiempo, se vuelve a "buscando". */
const CARA_PERDIDA_MS = 650
/** Sin cara este tiempo, las muestras se descartan: la persona se fue. */
const OLVIDO_MS = 1600
const ENTRE_MUESTRAS_MS = 170
/** Mediciones buenas seguidas para empezar a leer, malas seguidas para volver a pedir ajustes. */
const CUADROS_BUENOS = 2
const CUADROS_MALOS = 3
/** Una guía tiene que sostenerse esto antes de reemplazar a otra (si no, los textos titilan). */
const GUIA_MIN_MS = 550
const ESPERA_MODELOS_MS = 25_000
const ESPERA_CAMARA_MS = 8_000
/**
 * Más lejos que esto del promedio, la muestra no es de la misma cara (otra
 * persona se cruzó) o salió mala. Dos cuadros de la misma persona quedan
 * típicamente a 0,15–0,30; dos personas distintas, arriba de 0,5.
 */
const DISTANCIA_MISMA_CARA = 0.4
/**
 * Debajo de este tamaño (distancia interocular sobre el lado mayor del video)
 * la cara se sigue en una ventana a resolución completa: en el cuadro reducido
 * ya casi no se ve.
 */
const TAMANO_AMPLIO = 0.05

/** Zoom digital sobre el video: 1 = la lente muestra el lado corto entero. */
const ZOOM_MIN = 1
const ZOOM_MAX = 1.75
const ZOOM_REPOSO = 1.12
/** Fracción del diámetro de la lente que ocupa la cara (frente → mentón) a buena distancia. */
const LLENADO = 0.6
/** Resorte del encuadre (rad/s): ~1 s en asentarse, como un camarógrafo y no como un sensor. */
const RESORTE = 3.4

export interface OpcionesEscaner {
  modo: ModoEscaner
  video: HTMLVideoElement
  lienzo: HTMLCanvasElement
  /** Caja cuadrada con la lente y el anillo; se mide con ResizeObserver. */
  contenedor: HTMLElement
  /** Viñeta que sigue a la cara (opcional). */
  vineta: HTMLElement | null
  tema: 'oscuro' | 'claro'
  /** Espacio del anillo entre el borde del contenedor y la lente (px CSS). */
  margen: number
  /** Muestras por intento. */
  muestras: number
  intentos: number
  alCambiar(estado: EstadoVisible): void
  alLeer(lectura: LecturaFacial, intento: number): Promise<Veredicto>
  alTerminar(resultado: ResultadoEscaner): void
}

interface Muestra {
  descriptor: Float32Array
  confianza: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}

/** Traduce el error de getUserMedia a lo que la pantalla sabe explicar. */
function errorDeCamara(e: unknown): ErrorEscaner {
  const nombre = (e as { name?: string } | null)?.name
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') return 'permiso'
  if (nombre === 'NotReadableError' || nombre === 'AbortError' || nombre === 'TrackStartError') return 'camara_ocupada'
  return 'sin_camara'
}

export class MotorEscaner {
  private vivo = true
  private fase: FaseEscaner = 'preparando'
  private tFase: number
  private guia: Guia | null = null
  private guiaPendiente: Guia | null = null
  private tGuiaPendiente = 0
  private error: ErrorEscaner | undefined
  private nombre: string | undefined
  private mensaje: string | undefined
  private camaraLista = false
  private ultimoEmitido = ''

  private stream: MediaStream | null = null
  private raf = 0
  private observador: ResizeObserver | null = null
  private readonly escena: EscenaEscaner | null
  private readonly limites: LimitesLectura
  private readonly reducido: boolean

  // Rastreo
  private ultima: MedicionCara | null = null
  private tamanoCara = 0
  private tUltimaCara = 0
  private hayCara = false
  private cuadrosBuenos = 0
  private cuadrosMalos = 0
  private erroresSeguidos = 0
  private costoRastreo = 60
  private readonly filtro = new FiltroCara()
  private readonly filtrados = new Float32Array(CANTIDAD_PUNTOS * 2)
  private readonly filtradosPrevios = new Float32Array(CANTIDAD_PUNTOS * 2)
  private tFiltrado = 0
  private tFiltradoPrevio = 0
  private hayFiltrados = false
  /** Los puntos que se dibujan: predichos y suavizados a la tasa de la pantalla. */
  private readonly render = new Float32Array(CANTIDAD_PUNTOS * 2)
  private hayRender = false
  private poseRender: PoseCara | null = null
  private presencia = 0
  private tEnganche: number | null = null

  // Muestras
  private muestras: Muestra[] = []
  private tMuestras: number[] = []
  private tUltimaMuestra = 0
  private tomando = false
  private foto: HTMLCanvasElement | null = null
  private confianzaFoto = 0
  private intento = 1

  // Encuadre: punto del video en el centro de la lente, zoom y sus velocidades.
  private fx = 0
  private fy = 0
  private z = ZOOM_REPOSO
  private vfx = 0
  private vfy = 0
  private vz = 0
  private s = 1
  private encuadreListo = false
  private ultimoTransform = ''
  private ultimaVineta = ''
  private ultimaOpacidadVineta = ''

  // Dibujo
  private progreso = 0
  private progresoObjetivo = 0
  private tExito: number | null = null
  private tAviso: number | null = null
  private tCuadro = 0
  private promedioCuadro = 16
  private cuadrosLentos = 0
  private alivianado = false
  private lado = 0
  private dpr = 1

  // Exposición sobre la cara
  private tExposicion = 0
  private exposicion: boolean | null = null

  private readonly temporizadores = new Set<ReturnType<typeof setTimeout>>()

  constructor(private readonly o: OpcionesEscaner) {
    this.tFase = performance.now()
    this.limites = o.modo === 'registrar' ? LIMITES_REGISTRAR : LIMITES_IDENTIFICAR
    this.reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    let escena: EscenaEscaner | null = null
    try {
      escena = new EscenaEscaner(o.lienzo, o.tema, o.margen)
    } catch (e) {
      console.error('[escaner] sin canvas 2D', e)
    }
    this.escena = escena
  }

  async iniciar(): Promise<void> {
    if (!this.escena) {
      this.fallarCon('motor')
      return
    }
    this.observar()
    this.raf = requestAnimationFrame(this.cuadro)
    this.emitir()

    // Modelos y cámara en paralelo: la cámara tarda medio segundo en Android y
    // no tiene por qué esperar a que terminen de cargar los modelos.
    const modelos = precalentarReconocimiento()
    modelos.catch(() => {})
    try {
      await this.abrirCamara()
    } catch (e) {
      if (!this.vivo) return
      console.error('[escaner] cámara', e)
      this.fallarCon(errorDeCamara(e))
      return
    }
    if (!this.vivo) return

    let plazo: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        modelos,
        new Promise<never>((_, rechazar) => {
          plazo = setTimeout(() => rechazar(new Error('Los modelos tardaron demasiado')), ESPERA_MODELOS_MS)
        }),
      ])
    } catch (e) {
      if (!this.vivo) return
      console.error('[escaner] modelos de reconocimiento', e)
      this.fallarCon('modelos')
      return
    } finally {
      clearTimeout(plazo)
    }
    if (!this.vivo) return
    this.cambiarFase('buscando')
    void this.bucleRastreo()
  }

  /** Vuelve a empezar la lectura (un registro que no se pudo guardar → "Probar de nuevo"). */
  reiniciar(): void {
    if (!this.vivo || this.fase === 'error' || this.fase === 'preparando') return
    this.intento = 1
    this.descartarMuestras()
    this.tExito = null
    this.tAviso = null
    this.nombre = undefined
    this.mensaje = undefined
    this.cuadrosBuenos = 0
    this.cambiarFase(this.hayCara ? 'ajustando' : 'buscando')
  }

  destruir(): void {
    this.vivo = false
    cancelAnimationFrame(this.raf)
    for (const t of this.temporizadores) clearTimeout(t)
    this.temporizadores.clear()
    this.observador?.disconnect()
    const v = this.o.video
    v.removeEventListener('resize', this.alCambiarVideo)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    try {
      v.srcObject = null
    } catch {
      // nada que limpiar
    }
  }

  // ── Cámara ────────────────────────────────────────────────────────────────

  private async abrirCamara(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('getUserMedia no disponible'), { name: 'NotFoundError' })
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'OverconstrainedError') throw e
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } })
    }
    if (!this.vivo) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    const v = this.o.video
    v.muted = true
    v.playsInline = true
    v.srcObject = stream
    v.addEventListener('resize', this.alCambiarVideo)
    if (v.readyState < 1) {
      await Promise.race([
        new Promise<void>((resolver) => v.addEventListener('loadedmetadata', () => resolver(), { once: true })),
        esperar(ESPERA_CAMARA_MS),
      ])
      // Sin el evento pero con imagen, se sigue; sin imagen después de 8 s, la cámara no anda.
      if (this.vivo && v.readyState < 1 && !v.videoWidth) {
        throw Object.assign(new Error('La cámara no entregó imagen'), { name: 'NotReadableError' })
      }
    }
    try {
      await v.play()
    } catch {
      // Silenciado y en línea, Chrome no debería frenarlo; si lo hace, el
      // rastreo sigue esperando cuadros y la pantalla queda en "Mirá a la cámara".
    }
    if (!this.vivo) return
    this.alCambiarVideo()
    this.camaraLista = true
    this.emitir()
  }

  /** El video se dibuja a su tamaño real y se encuadra con un transform (ver `actualizarEncuadre`). */
  private alCambiarVideo = (): void => {
    const v = this.o.video
    if (!v.videoWidth || !v.videoHeight) return
    v.style.width = `${v.videoWidth}px`
    v.style.height = `${v.videoHeight}px`
    if (!this.encuadreListo) {
      this.fx = v.videoWidth / 2
      this.fy = v.videoHeight / 2
      this.encuadreListo = true
    }
  }

  /**
   * Mide la exposición sobre la cara cuando se ve oscura (contraluz: la ventana
   * del local atrás). Es una pista para la cámara, no una orden: si el equipo
   * no la soporta, Chrome la ignora sin error.
   */
  private ajustarExposicion(r: RastreoCara, t: number): void {
    if (this.exposicion === false || r.luz > 95 || t - this.tExposicion < 2500) return
    const pista = this.stream?.getVideoTracks()[0]
    if (!pista?.applyConstraints) return
    if (this.exposicion === null) {
      const capacidades = (pista.getCapabilities?.() ?? {}) as Record<string, unknown>
      this.exposicion = 'exposureMode' in capacidades
      if (!this.exposicion) return
    }
    this.tExposicion = t
    const x = clamp((r.caja.x + r.caja.width / 2) / r.ancho, 0, 1)
    const y = clamp((r.caja.y + r.caja.height / 2) / r.alto, 0, 1)
    pista
      .applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet] })
      .catch(() => {
        this.exposicion = false
      })
  }

  // ── Rastreo ───────────────────────────────────────────────────────────────

  private siguienteCuadroDeVideo(): Promise<void> {
    const v = this.o.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number
    }
    return new Promise((resolver) => {
      let listo = false
      const seguir = () => {
        if (listo) return
        listo = true
        resolver()
      }
      if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(seguir)
      // Red de seguridad: si el video se frena, el bucle no queda colgado.
      setTimeout(seguir, 150)
    })
  }

  private async bucleRastreo(): Promise<void> {
    while (this.vivo) {
      await this.siguienteCuadroDeVideo()
      if (!this.vivo) return
      if (this.fase === 'error') return
      if (document.hidden || this.fase === 'fallo') {
        await esperar(250)
        continue
      }

      const t0 = performance.now()
      let r: RastreoCara | null = null
      try {
        // Sin nadie a la vista, el cuadro entero sin reducir: ve también al que
        // todavía está lejos. Con una cara chica, una ventana a su alrededor.
        r = await rastrearCara(this.o.video, { completo: !this.hayCara, region: this.regionDeBusqueda() })
        this.erroresSeguidos = 0
      } catch (e) {
        this.erroresSeguidos++
        console.warn('[escaner] rastreo', e)
        if (this.erroresSeguidos >= 4) {
          this.fallarCon('motor')
          return
        }
      }
      if (!this.vivo) return
      const t1 = performance.now()
      this.costoRastreo += 0.2 * (t1 - t0 - this.costoRastreo)
      this.procesarRastreo(r, t1)
      if (r && this.debeMuestrear(t1)) await this.tomarMuestra(r)

      // Respiro para el dibujo: la GPU es una sola y la comparten las redes y la pantalla.
      await esperar(clamp(this.costoRastreo * 0.5, 25, 110))
    }
  }

  /**
   * Una cara chica (lejos) se sigue en una ventana a resolución completa a su
   * alrededor (zoom digital): en el cuadro reducido casi no se ve y se perdería
   * a cada rato.
   */
  private regionDeBusqueda(): RegionBusqueda | undefined {
    if (!this.hayCara || !this.ultima || this.tamanoCara >= TAMANO_AMPLIO) return undefined
    const pose = leerPose(this.ultima.puntos)
    return { x: pose.centroOjos.x, y: pose.centroOjos.y + pose.iod, lado: Math.max(320, pose.iod * 9) }
  }

  private procesarRastreo(r: RastreoCara | null, t: number): void {
    if (!r) {
      if (this.hayCara && t - this.tUltimaCara > CARA_PERDIDA_MS) {
        this.hayCara = false
        this.ultima = null
        this.cuadrosBuenos = 0
        this.cuadrosMalos = 0
        if (this.fase === 'ajustando' || this.fase === 'leyendo') this.cambiarFase('buscando')
      }
      if (this.muestras.length > 0 && !this.hayCara && t - this.tUltimaCara > OLVIDO_MS) {
        this.descartarMuestras()
        this.recalcularProgreso()
        this.emitir()
      }
      return
    }

    this.tUltimaCara = t
    const medicion: MedicionCara = {
      puntos: r.puntos,
      confianza: r.confianza,
      luz: r.luz,
      ancho: r.ancho,
      alto: r.alto,
      t,
    }
    const evaluacion = evaluarCara(medicion, this.ultima, this.limites)
    this.ultima = medicion
    this.tamanoCara = evaluacion.tamano

    if (!this.hayCara) {
      // Apareció una cara: el dibujo arranca de cero en su lugar (sin volar
      // desde donde estaba la anterior) y dispara el enganche del óvalo.
      this.hayCara = true
      this.tEnganche = t
      this.hayFiltrados = false
      this.hayRender = false
      this.filtro.reiniciar()
      this.cuadrosBuenos = 0
      this.cuadrosMalos = 0
    }

    const filtrados = this.filtro.filtrar(r.puntos, t / 1000, evaluacion.pose.iod)
    if (this.hayFiltrados) {
      this.filtradosPrevios.set(this.filtrados)
      this.tFiltradoPrevio = this.tFiltrado
    } else {
      this.filtradosPrevios.set(filtrados)
      this.tFiltradoPrevio = t
    }
    this.filtrados.set(filtrados)
    this.tFiltrado = t
    this.hayFiltrados = true

    if (evaluacion.guia === null) {
      this.cuadrosBuenos++
      this.cuadrosMalos = 0
    } else {
      this.cuadrosMalos++
      this.cuadrosBuenos = 0
    }
    this.actualizarGuia(evaluacion.guia, t)
    this.ajustarExposicion(r, t)

    if (this.fase === 'buscando') this.cambiarFase('ajustando')
    if (this.fase === 'ajustando' && this.cuadrosBuenos >= CUADROS_BUENOS) this.cambiarFase('leyendo')
    else if (this.fase === 'leyendo' && this.cuadrosMalos >= CUADROS_MALOS) this.cambiarFase('ajustando')
  }

  /**
   * La guía que se muestra en "ajustando". Una medición buena no la borra (se
   * borra al empezar a leer): si no, entre "Acercate" y "Quedate quieto" el
   * texto titilaría con cada medición. Y una guía nueva tiene que sostenerse un
   * poco antes de reemplazar a otra.
   */
  private actualizarGuia(nueva: Guia | null, t: number): void {
    if (nueva === null) {
      this.guiaPendiente = null
      return
    }
    if (this.guia === null) {
      this.guia = nueva
      this.emitir()
      return
    }
    if (nueva === this.guia) {
      this.guiaPendiente = null
      return
    }
    if (this.guiaPendiente !== nueva) {
      this.guiaPendiente = nueva
      this.tGuiaPendiente = t
      return
    }
    if (t - this.tGuiaPendiente >= GUIA_MIN_MS) {
      this.guia = nueva
      this.guiaPendiente = null
      this.emitir()
    }
  }

  // ── Muestras ──────────────────────────────────────────────────────────────

  private debeMuestrear(t: number): boolean {
    return (
      this.fase === 'leyendo' &&
      !this.tomando &&
      this.cuadrosBuenos >= CUADROS_BUENOS &&
      t - this.tUltimaMuestra >= ENTRE_MUESTRAS_MS &&
      this.muestras.length < this.o.muestras &&
      this.o.video.readyState >= 3
    )
  }

  private async tomarMuestra(r: RastreoCara): Promise<void> {
    this.tomando = true
    try {
      const deteccion = await detectFace(this.o.video)
      if (!this.vivo || this.fase !== 'leyendo') return
      this.tUltimaMuestra = performance.now()
      if (!deteccion || deteccion.score < this.limites.confianza) return
      // Tiene que ser la cara que se está siguiendo, no la de alguien que pasa atrás.
      if (solapamiento(deteccion.box, r.caja) < 0.3) return

      if (this.muestras.length > 0) {
        const centro = promedioDescriptores(this.muestras.map((m) => m.descriptor))
        if (distanciaDescriptores(deteccion.descriptor, centro) > DISTANCIA_MISMA_CARA) {
          // Cambió la persona o la muestra anterior salió mala: se empieza con ésta.
          this.descartarMuestras()
        }
      }
      this.muestras.push({ descriptor: deteccion.descriptor, confianza: deteccion.score })
      this.tMuestras.push(this.tUltimaMuestra)
      if (!this.foto || deteccion.score >= this.confianzaFoto) {
        this.confianzaFoto = deteccion.score
        this.capturarFoto()
      }
      this.recalcularProgreso()
      this.emitir()
      if (this.muestras.length >= this.o.muestras) void this.consultar()
    } catch (e) {
      console.warn('[escaner] muestra', e)
    } finally {
      this.tomando = false
    }
  }

  /** El cuadro de la mejor muestra, a 480 px de ancho (lo mismo que guardaba la cámara anterior). */
  private capturarFoto(): void {
    const v = this.o.video
    if (!v.videoWidth || !v.videoHeight) return
    const ancho = Math.min(480, v.videoWidth)
    const alto = Math.round((v.videoHeight * ancho) / v.videoWidth)
    const lienzo = this.foto ?? document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    lienzo.getContext('2d')?.drawImage(v, 0, 0, ancho, alto)
    this.foto = lienzo
  }

  private descartarMuestras(): void {
    this.muestras = []
    this.tMuestras = []
    this.confianzaFoto = 0
    this.foto = null
  }

  private armarLectura(): LecturaFacial {
    const descriptores = this.muestras.map((m) => m.descriptor)
    const calidad = this.muestras.reduce((max, m) => Math.max(max, m.confianza), 0)
    const lienzo = this.foto
    this.foto = null
    let foto: Promise<Blob | null> | null = null
    return {
      descriptor: promedioDescriptores(descriptores),
      muestras: descriptores,
      calidad,
      foto: () => {
        if (!foto) {
          foto = lienzo
            ? new Promise((resolver) => lienzo.toBlob((b) => resolver(b), 'image/webp', 0.8))
            : Promise.resolve(null)
        }
        return foto
      },
    }
  }

  private async consultar(): Promise<void> {
    this.cambiarFase('consultando')
    const lectura = this.armarLectura()
    let veredicto: Veredicto
    try {
      veredicto = await this.o.alLeer(lectura, this.intento)
    } catch (e) {
      console.error('[escaner] al leer', e)
      veredicto = { tipo: 'reintento' }
    }
    if (!this.vivo) return

    if (veredicto.tipo === 'exito') {
      this.nombre = veredicto.nombre
      this.tExito = performance.now()
      this.cambiarFase('exito')
      this.despues(DURACION_EXITO_MS, () => this.o.alTerminar({ tipo: 'exito', lectura }))
      return
    }

    this.tAviso = performance.now()
    this.descartarMuestras()
    if (veredicto.tipo === 'reintento' && this.intento < this.o.intentos) {
      this.intento++
      this.cambiarFase('reintento')
      this.despues(DURACION_REINTENTO_MS, () => {
        if (this.fase === 'reintento') this.cambiarFase(this.hayCara ? 'ajustando' : 'buscando')
      })
      return
    }
    this.mensaje = veredicto.tipo === 'fallo' ? veredicto.mensaje : undefined
    this.cambiarFase('fallo')
    this.despues(DURACION_FALLO_MS, () => this.o.alTerminar({ tipo: 'fallo', lectura }))
  }

  private despues(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.temporizadores.delete(id)
      if (this.vivo) fn()
    }, ms)
    this.temporizadores.add(id)
  }

  // ── Fases ─────────────────────────────────────────────────────────────────

  private cambiarFase(f: FaseEscaner): void {
    if (this.fase === f) return
    this.fase = f
    this.tFase = performance.now()
    if (f === 'leyendo' || f === 'buscando') {
      this.guia = null
      this.guiaPendiente = null
    }
    if (f === 'reintento' || f === 'fallo') this.cuadrosBuenos = 0
    this.recalcularProgreso()
    this.emitir()
  }

  private fallarCon(tipo: ErrorEscaner): void {
    this.error = tipo
    this.cambiarFase('error')
  }

  private recalcularProgreso(): void {
    switch (this.fase) {
      case 'buscando':
      case 'ajustando':
      case 'leyendo':
        this.progresoObjetivo =
          this.muestras.length > 0
            ? 0.1 + (0.7 * this.muestras.length) / this.o.muestras
            : this.fase === 'leyendo'
              ? 0.1
              : 0
        break
      case 'exito':
        this.progresoObjetivo = 1
        break
      case 'consultando':
        break
      default:
        this.progresoObjetivo = 0
    }
  }

  private emitir(): void {
    if (!this.vivo) return
    const guia = this.fase === 'ajustando' ? this.guia : null
    const clave = `${this.fase}|${guia}|${this.muestras.length}|${this.intento}|${this.camaraLista}`
    if (clave === this.ultimoEmitido) return
    this.ultimoEmitido = clave
    this.o.alCambiar({
      fase: this.fase,
      guia,
      muestras: this.muestras.length,
      total: this.o.muestras,
      intento: this.intento,
      camara: this.camaraLista,
      nombre: this.nombre,
      error: this.error,
      mensaje: this.mensaje,
    })
  }

  // ── Dibujo ────────────────────────────────────────────────────────────────

  private observar(): void {
    const medir = () => {
      const lado = this.o.contenedor.clientWidth
      const dpr = Math.min(window.devicePixelRatio || 1, this.alivianado ? 1.25 : 2)
      if (!lado || (lado === this.lado && dpr === this.dpr)) return
      this.lado = lado
      this.dpr = dpr
      this.escena?.medir(lado, dpr)
    }
    medir()
    this.observador = new ResizeObserver(medir)
    this.observador.observe(this.o.contenedor)
  }

  private cuadro = (): void => {
    if (!this.vivo) return
    this.raf = requestAnimationFrame(this.cuadro)
    const t = performance.now()
    const dt = this.tCuadro ? Math.min(0.05, (t - this.tCuadro) / 1000) : 1 / 60
    this.medirRendimiento(t)
    this.tCuadro = t

    this.actualizarCara(t, dt)
    this.actualizarEncuadre(dt)
    this.actualizarProgreso(t, dt)

    this.escena?.dibujar({
      t,
      fase: this.fase,
      tFase: this.tFase,
      progreso: this.progreso,
      guia: this.fase === 'ajustando' ? this.guia : null,
      presencia: this.presencia,
      puntos: this.hayRender ? this.render : null,
      pose: this.poseRender,
      encuadre: { s: this.s, fx: this.fx, fy: this.fy },
      tEnganche: this.tEnganche,
      muestras: this.tMuestras,
      tExito: this.tExito,
      tAviso: this.tAviso,
      reducido: this.reducido,
    })
  }

  /** Si la tablet no llega a ~40 cuadros por segundo, se dibuja con menos detalle. */
  private medirRendimiento(t: number): void {
    if (!this.tCuadro || this.alivianado) return
    const intervalo = t - this.tCuadro
    if (intervalo > 100) return // volvió de segundo plano
    this.promedioCuadro += 0.05 * (intervalo - this.promedioCuadro)
    this.cuadrosLentos = this.promedioCuadro > 25 ? this.cuadrosLentos + 1 : 0
    if (this.cuadrosLentos > 90) {
      this.alivianado = true
      this.escena?.aliviar()
      this.lado = 0
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      const lado = this.o.contenedor.clientWidth
      if (lado) {
        this.lado = lado
        this.dpr = dpr
        this.escena?.medir(lado, dpr)
      }
    }
  }

  /**
   * Puntos a dibujar: la última medición filtrada, adelantada con su velocidad
   * hasta el instante del cuadro (como mucho 80 ms) y alcanzada con un resorte,
   * que es lo que hace que la malla no salte cuando llega una medición nueva.
   */
  private actualizarCara(t: number, dt: number): void {
    const objetivo = this.hayCara ? 1 : 0
    this.presencia += (objetivo - this.presencia) * (1 - Math.exp(-dt * (this.hayCara ? 7 : 4)))
    if (!this.hayFiltrados) return

    const intervalo = (this.tFiltrado - this.tFiltradoPrevio) / 1000
    const adelanto = Math.min(0.08, Math.max(0, (t - this.tFiltrado) / 1000)) * 0.7
    const predice = intervalo > 0.005 && intervalo < 0.5
    const seguir = this.hayRender ? 1 - Math.exp(-dt * 20) : 1
    for (let i = 0; i < this.render.length; i++) {
      let destino = this.filtrados[i]
      if (predice) destino += ((this.filtrados[i] - this.filtradosPrevios[i]) / intervalo) * adelanto
      this.render[i] += (destino - this.render[i]) * seguir
    }
    this.hayRender = true
    this.poseRender = leerPose(this.render)
  }

  /**
   * El encuadre: la lente sigue a la cara y la acerca hasta que ocupa ~60 % de
   * su alto. Pasado el zoom máximo la cara se ve chica a propósito: es la señal
   * de "acercate". El video sólo se mueve con transform (lo resuelve el
   * compositor, sin repintar), y el mismo encuadre lo usa la malla, así que
   * los dos quedan pegados.
   */
  private actualizarEncuadre(dt: number): void {
    const v = this.o.video
    const vw = v.videoWidth
    const vh = v.videoHeight
    const radio = this.escena?.radio ?? 0
    if (!vw || !vh || radio <= 1 || !this.encuadreListo) return

    const s0 = (2 * radio) / Math.min(vw, vh)
    let fxObjetivo = vw / 2
    let fyObjetivo = vh / 2
    let zObjetivo = ZOOM_REPOSO
    let cara: { x: number; y: number; alto: number } | null = null
    if (this.hayCara && this.poseRender) {
      cara = encuadreDeCara(this.poseRender)
      fxObjetivo = cara.x
      fyObjetivo = cara.y
      zObjetivo = clamp((LLENADO * 2 * radio) / (cara.alto * s0), ZOOM_MIN, ZOOM_MAX)
      // Al reconocer, un acercamiento leve: el momento es de la persona.
      if (this.fase === 'exito' && !this.reducido) zObjetivo = Math.min(ZOOM_MAX * 1.06, zObjetivo * 1.06)
    }

    const w = this.reducido ? RESORTE * 2 : RESORTE
    const resorte = (x: number, vel: number, destino: number): [number, number] => {
      const a = -2 * w * vel - w * w * (x - destino)
      const nv = vel + a * dt
      return [x + nv * dt, nv]
    }
    ;[this.fx, this.vfx] = resorte(this.fx, this.vfx, fxObjetivo)
    ;[this.fy, this.vfy] = resorte(this.fy, this.vfy, fyObjetivo)
    ;[this.z, this.vz] = resorte(this.z, this.vz, zObjetivo)

    // El video siempre tiene que cubrir la lente: nada de bordes negros.
    this.z = Math.max(this.z, ZOOM_MIN)
    this.s = s0 * this.z
    const visible = radio / this.s
    this.fx = clamp(this.fx, visible, vw - visible)
    this.fy = clamp(this.fy, visible, vh - visible)

    const tx = radio + this.s * this.fx
    const ty = radio - this.s * this.fy
    const transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${(-this.s).toFixed(4)},${this.s.toFixed(4)})`
    if (transform !== this.ultimoTransform) {
      v.style.transform = transform
      this.ultimoTransform = transform
    }

    this.actualizarVineta(radio, cara)
  }

  /** Un foco sobre la cara: el resto de la imagen se oscurece y la malla resalta. */
  private actualizarVineta(radio: number, cara: { x: number; y: number; alto: number } | null): void {
    const vineta = this.o.vineta
    if (!vineta) return
    let x = radio
    let y = radio
    let escala = 1.15
    if (cara) {
      x = radio - this.s * (cara.x - this.fx)
      y = radio + this.s * (cara.y - this.fy)
      // La zona clara de la viñeta mide 0,56 × radio a escala 1 (ver el gradiente en el componente).
      escala = clamp(((cara.alto * this.s) / 2 / (0.56 * radio)) * 1.1, 0.6, 1.8)
    }
    const transform = `translate3d(${(x - 2 * radio).toFixed(1)}px,${(y - 2 * radio).toFixed(1)}px,0) scale(${escala.toFixed(3)})`
    if (transform !== this.ultimaVineta) {
      vineta.style.transform = transform
      this.ultimaVineta = transform
    }
    const opacidad =
      this.fase === 'preparando' || this.fase === 'error' || this.fase === 'exito'
        ? '0'
        : this.fase === 'buscando'
          ? '0.55'
          : this.fase === 'fallo'
            ? '0.6'
            : '1'
    if (opacidad !== this.ultimaOpacidadVineta) {
      vineta.style.opacity = opacidad
      this.ultimaOpacidadVineta = opacidad
    }
  }

  private actualizarProgreso(t: number, dt: number): void {
    let objetivo = this.progresoObjetivo
    // Mientras consulta, el anillo sigue avanzando despacio hacia el final.
    if (this.fase === 'consultando') objetivo = 0.86 + 0.1 * (1 - Math.exp(-(t - this.tFase) / 900))
    const velocidad = objetivo < this.progreso ? 4.5 : 9
    this.progreso += (objetivo - this.progreso) * (1 - Math.exp(-dt * velocidad))
  }
}
