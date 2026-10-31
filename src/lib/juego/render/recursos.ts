/**
 * Carga de recursos de «Corte Final»: atlas de cada luchador (JSON + PNG), su cara y la arena.
 *
 * - Progreso real 0..1: cada archivo pesa según lo que suele tardar y, mientras baja, avanza por
 *   bytes (Content-Length). El 10 % final de cada imagen es la decodificación.
 * - Todo vuelve DECODIFICADO (createImageBitmap, o <img>.decode() si no hay), así el primer
 *   cuadro de la pelea no se traba decodificando.
 * - Si falta una cara se sigue sin ella; si falta un atlas, error claro; si falta la imagen de la
 *   arena, se dibuja un local de respaldo para que se pueda jugar igual.
 * - Las imágenes quedan en una caché del módulo: la revancha arranca al instante.
 * - Si está el atlas de efectos compartidos (public/juego/efectos/), también se baja y viaja como
 *   `efectosComunes` (propiedad extra, fuera del contrato): sin él, los efectos se dibujan a mano.
 * - Lo mismo con los sprites «rapados» de cada luchador (rapado.json + la imagen que nombra, de
 *   scripts/juego/generar_rapado.py): viajan como `rapados` y el remate ¡AL CERO! deja pelado al
 *   que lo recibe. Sin ellos, el remate sólo hace volar el pelo.
 * - Un pedido que falla por la red (o un 5xx) se reintenta una vez: el 4G de un local es inestable.
 * - Ningún pedido espera para siempre: si pasan INACTIVIDAD_MS sin que llegue nada (ni los
 *   encabezados ni un trozo) o TOPE_MS en total, se corta y cuenta como una falla de red (un
 *   reintento y después el error de la carga, con «Reintentar» y «Volver»). Antes, una conexión
 *   que dejaba de traer bytes sin cortar dejaba «Calentando la máquina» fija para siempre.
 * - Lo opcional (caras, efectos, rapado) no frena la pelea: listos los atlas y la arena, tiene
 *   ESPERA_OPCIONALES_MS más; lo que no llegó, la pelea lo hace sin eso.
 * - La arena y las caras se piden con el `?dpl=` de Vercel, igual que las <img> de next/image que
 *   las muestran fuera de la pelea: una sola bajada (ver `conDespliegue`).
 */
import { ARENAS } from '../arenas'
import { PERSONAJES } from '../personajes'
import type { ArenaDef, AtlasPersonaje, CuadroAtlas, IdArena, IdPersonaje, RecursosJuego } from '../tipos'
import type { AtlasEfectosComunes, RecursoEfectos } from './efectos'
import { contexto, crearLienzo, FUENTE_RESPALDO } from './lienzo'
import { rgba } from './util'

type Decodificada = ImageBitmap | HTMLImageElement | HTMLCanvasElement

interface Tarea {
  avanzar(fraccion: number): void
}

const MAX_CACHE = 10
const RUTA_EFECTOS = '/juego/efectos/efectos.json'
/** Sin que llegue nada (encabezados o un trozo) en este tiempo, el pedido se corta. */
const INACTIVIDAD_MS = 15_000
/** Tope de un intento aunque siga llegando de a gotas. */
const TOPE_MS = 60_000
/** Listos los atlas y la arena, cuánto más se espera a lo opcional (caras, efectos, rapado). */
const ESPERA_OPCIONALES_MS = 8_000

/**
 * public/juego/personajes/<id>/rapado.json: los cuadros de `danio` y `ko` con la cabeza pelada,
 * con el mismo w, h, ax, ay, cantidad y orden que el atlas (se cambian 1 a 1). `cabezas` es el
 * centro del cráneo de cada cuadro (px del cuadro) y `extras.gorra` la gorra de Chipi suelta,
 * con su `desfase` respecto del cráneo.
 */
export interface AtlasRapado {
  version: number
  imagen: string
  animaciones: Partial<Record<'danio' | 'ko', { cuadros: CuadroAtlas[] }>>
  extras?: Record<string, { cuadros: CuadroAtlas[]; desfase?: [number, number] }>
  cabezas?: Partial<Record<'danio' | 'ko', [number, number][]>>
}

export interface RecursoRapado {
  datos: AtlasRapado
  imagen: CanvasImageSource
}

/** RecursosJuego con los extras opcionales del render (fuera del contrato). */
export interface RecursosConEfectos extends RecursosJuego {
  efectosComunes?: RecursoEfectos | null
  rapados?: Partial<Record<IdPersonaje, RecursoRapado>>
}
const cacheImagenes = new Map<string, Promise<Decodificada>>()
const cacheAtlas = new Map<string, Promise<AtlasPersonaje>>()

function urlBase(): string {
  return typeof location !== 'undefined' && location.href ? location.href : 'http://localhost/'
}

/**
 * Skew Protection de Vercel: con un deployment en producción, next/image (con `unoptimized`) le
 * agrega `?dpl=<deployment>` a las imágenes de public/ (get-img-props de Next, lo saca de
 * `process.env.NEXT_DEPLOYMENT_ID`). La arena y las caras se ven con <img> en la portada, la
 * selección y el HUD, y el render las volvía a pedir SIN el parámetro: para el navegador eran otra
 * URL y cada pelea las bajaba dos veces (≈ 170–190 KB). Esas dos se piden con el mismo parámetro:
 * comparten la entrada del caché (que revalida por ETag). Los atlas, los efectos y el rapado NO lo
 * llevan a propósito: ninguna <img> los pide y, sin el parámetro, entre un deploy y otro un atlas
 * que no cambió revalida con un 304 en vez de bajarse de nuevo. Fuera de Vercel no hay id: la URL
 * queda igual.
 */
function conDespliegue(url: string): string {
  // Next reemplaza `process.env.NEXT_DEPLOYMENT_ID` por el texto del id al compilar (no queda
  // ninguna referencia a `process`). El try cuida el render empaquetado sin Next
  // (scripts/juego/render-audio/empaquetar.mjs), donde `process` no existe.
  let id: string | undefined
  try {
    id = process.env.NEXT_DEPLOYMENT_ID
  } catch {
    id = undefined
  }
  if (!id) return url
  try {
    const u = new URL(url)
    if (typeof location !== 'undefined' && u.origin !== location.origin) return url
    u.searchParams.set('dpl', id)
    return u.href
  } catch {
    return url
  }
}

function absoluta(ruta: string, base?: string): string {
  return new URL(ruta, base ?? urlBase()).href
}

function motivo(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function crearProgreso(alProgresar?: (fraccion: number) => void) {
  const pesos: number[] = []
  const hechos: number[] = []
  let informado = 0
  let cerrado = false
  const avisar = (f: number) => {
    if (!alProgresar) return
    try {
      alProgresar(f)
    } catch {
      // un error del que escucha no tiene que cortar la carga
    }
  }
  const informar = () => {
    if (cerrado) return
    let total = 0
    let hecho = 0
    for (let i = 0; i < pesos.length; i++) {
      total += pesos[i]
      hecho += pesos[i] * hechos[i]
    }
    // el 100 % se informa recién con todo decodificado (fin())
    const f = total > 0 ? Math.min(0.99, hecho / total) : 0
    if (f >= informado + 0.01) {
      informado = f
      avisar(f)
    }
  }
  return {
    tarea(peso: number): Tarea {
      const i = pesos.length
      pesos.push(peso)
      hechos.push(0)
      return {
        avanzar(fraccion: number) {
          const v = Math.min(1, Math.max(hechos[i], fraccion))
          if (v !== hechos[i]) {
            hechos[i] = v
            informar()
          }
        },
      }
    },
    inicio() {
      avisar(0)
    },
    fin() {
      if (cerrado) return
      cerrado = true
      avisar(1)
    },
  }
}

/** Un 4xx: el archivo no está (o no se puede pedir). No se reintenta. */
class ErrorHttp extends Error {
  readonly estado: number
  constructor(estado: number) {
    super(`HTTP ${estado}`)
    this.estado = estado
  }
}

/**
 * Un intento de bajar `url`, con vigía: se corta si pasan INACTIVIDAD_MS sin que llegue nada (los
 * encabezados o un trozo del cuerpo) o TOPE_MS en total. Informa el avance (0..0,9 de la tarea:
 * el resto es decodificar).
 */
async function bajarUnaVez(url: string, tarea: Tarea): Promise<Blob> {
  const control = new AbortController()
  /** Por qué lo cortó el vigía (null: no lo cortó). En un objeto: lo escribe un timer. */
  const vigilado: { corte: string | null } = { corte: null }
  const cortar = (motivoCorte: string) => {
    vigilado.corte = motivoCorte
    control.abort()
  }
  let vigia: ReturnType<typeof setTimeout> | undefined
  const rearmar = () => {
    clearTimeout(vigia)
    vigia = setTimeout(() => cortar(`${INACTIVIDAD_MS / 1000} s sin datos`), INACTIVIDAD_MS)
  }
  const tope = setTimeout(() => cortar(`más de ${TOPE_MS / 1000} s`), TOPE_MS)
  rearmar()
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: control.signal })
    rearmar()
    if (!res.ok) throw new ErrorHttp(res.status)
    const total = Number(res.headers.get('content-length')) || 0
    const tipo = res.headers.get('content-type') ?? ''
    if (!res.body) {
      const blob = await res.blob()
      tarea.avanzar(0.9)
      return blob
    }
    const lector = res.body.getReader()
    const partes: BlobPart[] = []
    let recibido = 0
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      if (value) {
        rearmar()
        partes.push(value)
        recibido += value.byteLength
        // con compresión el Content-Length es del cuerpo comprimido: se acota (sin él, se avisa al final)
        if (total > 0) tarea.avanzar(0.9 * Math.min(1, recibido / total))
      }
    }
    tarea.avanzar(0.9)
    return new Blob(partes, { type: tipo })
  } catch (e) {
    if (vigilado.corte) throw new Error(`se colgó (${vigilado.corte})`)
    throw e
  } finally {
    clearTimeout(vigia)
    clearTimeout(tope)
  }
}

/**
 * Baja un archivo: un corte de red, un 5xx o un pedido colgado se reintentan una vez (el 4G de un
 * local es inestable); un 4xx no.
 */
async function bajar(url: string, tarea: Tarea): Promise<Blob> {
  for (let intento = 0; ; intento++) {
    try {
      return await bajarUnaVez(url, tarea)
    } catch (e) {
      if (intento >= 1 || (e instanceof ErrorHttp && e.estado < 500)) throw e
      await new Promise((r) => setTimeout(r, 450))
    }
  }
}

async function decodificar(blob: Blob): Promise<Decodificada> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Safari viejo o formato que createImageBitmap no toma: se prueba con <img>
    }
  }
  const objeto = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = objeto
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(objeto)
  }
}

function recortarCache<T>(mapa: Map<string, T>, conservar: string): void {
  while (mapa.size > MAX_CACHE) {
    const primera = mapa.keys().next().value
    if (primera === undefined || primera === conservar) return
    mapa.delete(primera)
  }
}

function cargarImagen(url: string, tarea: Tarea): Promise<Decodificada> {
  const previa = cacheImagenes.get(url)
  if (previa) {
    previa.then(
      () => tarea.avanzar(1),
      () => undefined,
    )
    return previa
  }
  const promesa = (async () => {
    const blob = await bajar(url, tarea)
    const img = await decodificar(blob)
    tarea.avanzar(1)
    return img
  })()
  cacheImagenes.set(url, promesa)
  promesa.catch(() => cacheImagenes.delete(url))
  recortarCache(cacheImagenes, url)
  return promesa
}

function validarAtlas(datos: unknown, id: IdPersonaje): AtlasPersonaje {
  if (!datos || typeof datos !== 'object') throw new Error('el JSON no es un objeto')
  const a = datos as Partial<AtlasPersonaje>
  if (typeof a.imagen !== 'string' || !a.imagen) throw new Error('le falta «imagen»')
  if (!a.animaciones || typeof a.animaciones !== 'object') throw new Error('le faltan «animaciones»')
  let conCuadros = false
  for (const anim of Object.values(a.animaciones)) {
    if (anim && Array.isArray(anim.cuadros) && anim.cuadros.length > 0) {
      conCuadros = true
      break
    }
  }
  if (!conCuadros) throw new Error('no trae ningún cuadro')
  let ref = typeof a.alturaReferencia === 'number' && a.alturaReferencia > 0 ? a.alturaReferencia : 0
  if (!ref) ref = a.animaciones.quieto?.cuadros?.[0]?.h ?? 120
  return {
    version: 1,
    personaje: id,
    imagen: a.imagen,
    alturaReferencia: ref,
    animaciones: a.animaciones,
    efectos: a.efectos && typeof a.efectos === 'object' ? a.efectos : {},
  }
}

async function cargarAtlas(id: IdPersonaje, tJson: Tarea, tPng: Tarea) {
  const ficha = PERSONAJES[id]
  if (!ficha) throw new Error(`Corte Final: no existe el personaje «${id}»`)
  const ruta = absoluta(ficha.rutas.atlas)
  let datos: AtlasPersonaje
  try {
    let promesa = cacheAtlas.get(ruta)
    if (!promesa) {
      promesa = (async () => {
        const blob = await bajar(ruta, tJson)
        return validarAtlas(JSON.parse(await blob.text()), id)
      })()
      cacheAtlas.set(ruta, promesa)
      promesa.catch(() => cacheAtlas.delete(ruta))
      recortarCache(cacheAtlas, ruta)
    }
    datos = await promesa
    tJson.avanzar(1)
  } catch (e) {
    throw new Error(`Corte Final: no se pudo cargar el atlas de ${ficha.nombre} (${ficha.rutas.atlas}): ${motivo(e)}`)
  }
  const rutaPng = absoluta(datos.imagen, ruta)
  try {
    const imagen = await cargarImagen(rutaPng, tPng)
    return { id, datos, imagen }
  } catch (e) {
    throw new Error(`Corte Final: no se pudo cargar la hoja de sprites de ${ficha.nombre} (${rutaPng}): ${motivo(e)}`)
  }
}

async function cargarCara(id: IdPersonaje, tarea: Tarea): Promise<Decodificada | null> {
  const ficha = PERSONAJES[id]
  if (!ficha?.rutas.cara) {
    tarea.avanzar(1)
    return null
  }
  try {
    return await cargarImagen(conDespliegue(absoluta(ficha.rutas.cara)), tarea)
  } catch (e) {
    console.warn(`[juego] sin cara de ${ficha.nombre}: ${motivo(e)}`)
    tarea.avanzar(1)
    return null
  }
}

async function cargarEfectos(tJson: Tarea, tPng: Tarea): Promise<RecursoEfectos | null> {
  const ruta = absoluta(RUTA_EFECTOS)
  try {
    const blob = await bajar(ruta, tJson)
    const datos = JSON.parse(await blob.text()) as AtlasEfectosComunes
    tJson.avanzar(1)
    if (!datos || typeof datos.imagen !== 'string' || !datos.animaciones) throw new Error('JSON sin imagen o animaciones')
    const imagen = await cargarImagen(absoluta(datos.imagen, ruta), tPng)
    return { datos, imagen }
  } catch (e) {
    console.warn(`[juego] sin atlas de efectos compartidos (${motivo(e)}): se dibujan a mano`)
    tJson.avanzar(1)
    tPng.avanzar(1)
    return null
  }
}

/**
 * Los sprites pelados del remate (opcionales: sin ellos el remate no pela a nadie). Sólo se piden
 * si la ficha dice que existen (`rutas.rapado`): un barbero recién sumado no deja un 404.
 */
async function cargarRapado(id: IdPersonaje, tJson: Tarea, tPng: Tarea): Promise<RecursoRapado | null> {
  const ficha = PERSONAJES[id]
  if (ficha && !ficha.rutas.rapado) {
    tJson.avanzar(1)
    tPng.avanzar(1)
    return null
  }
  try {
    if (!ficha?.rutas.rapado) throw new Error('personaje desconocido')
    const ruta = absoluta(ficha.rutas.rapado.atlas)
    const blob = await bajar(ruta, tJson)
    const datos = JSON.parse(await blob.text()) as AtlasRapado
    tJson.avanzar(1)
    if (!datos || typeof datos.imagen !== 'string' || !datos.animaciones || typeof datos.animaciones !== 'object') {
      throw new Error('JSON sin imagen o animaciones')
    }
    const imagen = await cargarImagen(absoluta(datos.imagen, ruta), tPng)
    return { datos, imagen }
  } catch (e) {
    console.warn(`[juego] sin sprites rapados de ${ficha?.nombre ?? id} (${motivo(e)}): el remate sólo vuela pelo`)
    tJson.avanzar(1)
    tPng.avanzar(1)
    return null
  }
}

async function cargarArena(arena: IdArena, tarea: Tarea): Promise<{ def: ArenaDef; imagen: CanvasImageSource }> {
  const def = ARENAS[arena] ?? ARENAS.rondeau
  if (def.imagen) {
    try {
      const imagen = await cargarImagen(conDespliegue(absoluta(def.imagen)), tarea)
      return { def, imagen }
    } catch (e) {
      console.warn(`[juego] no se pudo cargar la arena ${def.nombre} (${motivo(e)}): se dibuja una de respaldo`)
    }
  }
  tarea.avanzar(1)
  return { def, imagen: arenaDeRespaldo(def) }
}

/**
 * Un local dibujado a mano (pared, espejos con luz cálida, tubos en el techo, piso de madera
 * brillante y el cartel de Monaco) para cuando la imagen de la arena no está.
 */
export function arenaDeRespaldo(def: ArenaDef): HTMLCanvasElement {
  const W = 1280
  const H = 720
  const c = crearLienzo(W, H)
  const g = contexto(c)
  const piso = Math.round(def.suelo * H)
  const fx = W / 2
  const fy = H * 0.42

  const pared = g.createLinearGradient(0, 0, 0, piso)
  pared.addColorStop(0, '#1b1c20')
  pared.addColorStop(0.55, def.tono || '#2a2622')
  pared.addColorStop(1, '#141312')
  g.fillStyle = pared
  g.fillRect(0, 0, W, piso)

  // tubos de luz del techo, en perspectiva hacia el fondo
  g.lineCap = 'round'
  for (let i = 0; i < 9; i++) {
    const x0 = (i / 8) * W
    const y0 = 18 + (i % 3) * 22
    const x1 = fx + (x0 - fx) * 0.35
    const y1 = fy - 70 + (i % 3) * 8
    g.strokeStyle = 'rgba(255,240,220,0.18)'
    g.lineWidth = 12
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
    g.stroke()
    g.strokeStyle = 'rgba(255,250,240,0.9)'
    g.lineWidth = 3
    g.stroke()
  }

  // espejos con luz cálida a los costados
  for (let i = 0; i < 4; i++) {
    for (const lado of [-1, 1]) {
      const t = i / 4
      const ancho = 120 * (1 - t * 0.6)
      const alto = 190 * (1 - t * 0.6)
      const x = fx + lado * (W * 0.46 - t * W * 0.3) - ancho / 2
      const y = fy - alto * 0.45
      const luz = g.createLinearGradient(x, y, x + ancho, y + alto)
      luz.addColorStop(0, 'rgba(255,170,90,0.55)')
      luz.addColorStop(1, 'rgba(60,40,30,0.85)')
      g.fillStyle = '#0b0b0c'
      g.fillRect(x - 6, y - 6, ancho + 12, alto + 12)
      g.fillStyle = luz
      g.fillRect(x, y, ancho, alto)
    }
  }

  // cartel de neón
  g.font = `bold 54px ${FUENTE_RESPALDO}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = '#F5B301'
  g.shadowBlur = 24
  g.fillStyle = '#FFE08A'
  g.fillText('MONACO', fx, fy - 40)
  g.shadowBlur = 0

  // piso de madera brillante con fugas de perspectiva
  const madera = g.createLinearGradient(0, piso - 140, 0, H)
  madera.addColorStop(0, '#3a3129')
  madera.addColorStop(0.5, '#2a231d')
  madera.addColorStop(1, '#16120f')
  g.fillStyle = madera
  g.beginPath()
  g.moveTo(0, piso - 60)
  g.lineTo(W, piso - 60)
  g.lineTo(W, H)
  g.lineTo(0, H)
  g.closePath()
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 2
  for (let i = -12; i <= 12; i++) {
    g.beginPath()
    g.moveTo(fx + i * 18, piso - 60)
    g.lineTo(fx + i * 150, H)
    g.stroke()
  }
  const brillo = g.createRadialGradient(fx, piso, 10, fx, piso, W * 0.5)
  brillo.addColorStop(0, 'rgba(255,220,180,0.16)')
  brillo.addColorStop(1, 'rgba(255,220,180,0)')
  g.fillStyle = brillo
  g.fillRect(0, piso - 60, W, H - piso + 60)
  g.fillStyle = rgba(def.tono || '#2a2622', 0.25)
  g.fillRect(0, 0, W, H)
  return c
}

export async function cargarRecursosImpl(
  personajes: IdPersonaje[],
  arena: IdArena,
  alProgresar?: (fraccion: number) => void,
): Promise<RecursosJuego> {
  const unicos = Array.from(new Set(personajes))
  if (unicos.length === 0) throw new Error('Corte Final: no se pidió ningún personaje')
  const progreso = crearProgreso(alProgresar)
  // las tareas se registran todas antes del primer await: el total se conoce de entrada
  const atlas = unicos.map((id) => cargarAtlas(id, progreso.tarea(1), progreso.tarea(10)))
  const caras = unicos.map((id) => opcional(cargarCara(id, progreso.tarea(1))))
  const fondo = cargarArena(arena, progreso.tarea(8))
  const efectos = opcional(cargarEfectos(progreso.tarea(0.5), progreso.tarea(1.5)))
  const rapados = unicos.map((id) => opcional(cargarRapado(id, progreso.tarea(0.2), progreso.tarea(0.8))))
  progreso.inicio()
  const [listos, arenaLista] = await Promise.all([Promise.all(atlas), fondo])
  // Lo opcional nunca frena la pelea: tiene ESPERA_OPCIONALES_MS más y lo que no llegó se hace
  // sin eso (la banda del especial sin cara, los efectos a mano, el remate sin pelar).
  let espera: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all([...caras, efectos, ...rapados].map((o) => o.listo)),
    new Promise<void>((r) => {
      espera = setTimeout(r, ESPERA_OPCIONALES_MS)
    }),
  ])
  clearTimeout(espera)

  const recursos: RecursosConEfectos = { atlas: {}, caras: {}, arena: arenaLista, efectosComunes: efectos.valor, rapados: {} }
  for (const a of listos) recursos.atlas[a.id] = { datos: a.datos, imagen: a.imagen }
  unicos.forEach((id, i) => {
    const cara = caras[i].valor
    if (cara) recursos.caras[id] = cara
    const rapado = rapados[i].valor
    if (rapado && recursos.rapados) recursos.rapados[id] = rapado
  })
  progreso.fin()
  return recursos
}

/** Un recurso opcional: `valor` es lo que haya llegado (null si todavía no, o si falló). */
interface Opcional<T> {
  valor: T | null
  /** Se cumple cuando llegó o falló (nunca se rechaza). */
  listo: Promise<void>
}

function opcional<T>(p: Promise<T | null>): Opcional<T> {
  const o: Opcional<T> = { valor: null, listo: Promise.resolve() }
  o.listo = p.then(
    (v) => {
      o.valor = v
    },
    () => undefined,
  )
  return o
}
