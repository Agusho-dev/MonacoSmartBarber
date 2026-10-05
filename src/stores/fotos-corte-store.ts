import { create } from 'zustand'
import { toast } from 'sonner'
import { comprimirFotoDeCorte } from '@/lib/image-utils'
import { esVersionDesactualizada, subirAUrlFirmada, TEXTO_VERSION_NUEVA } from '@/lib/fotos-corte/subida'
import { cantidadDeFotos, primerNombre } from '@/lib/fotos-corte/textos'
import type { PedidoDeFotos, RespuestaDescartarFotos } from '@/lib/fotos-corte/contrato'
import {
  BYTES_MAXIMOS_FOTO,
  MINUTOS_GRACIA_TRAS_COBRO,
  TOPE_FOTOS_POR_CORTE,
  type ErrorFotos,
  type FotosDeEntrada,
  type MotivoErrorFotos,
  type OrigenFoto,
  type RespuestaAbrirSesion,
  type RespuestaConfirmarSubida,
  type RespuestaEstadoFotos,
  type RespuestaPedirSubida,
  type RespuestaQuitarFoto,
  type RespuestaVincularFotos,
  type ResultadoFotosDelCobro,
  type SesionDeFotos,
} from '@/lib/types/fotos-corte'

/*
 * Las fotos del corte que se están subiendo, POR COBRO (entrada de la fila).
 *
 * Vive en un store global y no en el diálogo de cobro por la misma razón que
 * loyalty-result-store: /dashboard/fila, la agenda y barber-timeline DESMONTAN
 * el diálogo apenas termina el cobro, y el cobro no espera a las fotos. Las
 * subidas siguen acá y el aviso posterior ("Guardando 2 fotos de Juan…" →
 * "2 fotos guardadas en la ficha de Juan") es un toast de sonner, que dibuja el
 * Toaster que ya está montado en cada layout: no hace falta montar nada más.
 *
 * Cada foto pasa por: preparando (comprimir) → subiendo (URL firmada, directo
 * a Storage, con progreso) → confirmando (el servidor la verifica y la
 * registra) → lista. Nada de eso pasa por server actions: es un Route Handler
 * con timeout propio (ver /api/fotos-corte/entradas/[id]).
 *
 * Una foto que el barbero QUITA mientras sube no llega a la ficha: se mira en
 * cada paso (al volver la URL firmada, antes de confirmar y al confirmar), lo
 * que alcanzó a quedar en el servidor se borra, y si no se puede borrar se dice
 * con UN aviso persistente por cobro, nunca en silencio.
 *
 * Contrato con la recarga por versión (sin imports cruzados): mientras haya
 * fotos subiendo —o algo de fotos en vuelo, como borrar una quitada—,
 * <html data-subiendo-fotos="true">. Recargar en ese momento las pierde.
 */

export type EstadoFotoDelCobro = 'preparando' | 'subiendo' | 'confirmando' | 'lista' | 'error'

export interface FotoDelCobro {
  /** Id local (o `srv:<id>` para las que vinieron del servidor, p. ej. del celular). */
  id: string
  /** Id en el servidor (qr_photo_uploads) una vez confirmada. */
  fotoId: string | null
  origen: OrigenFoto
  estado: EstadoFotoDelCobro
  /** 0..1 mientras sube. */
  progreso: number
  /** URL de la miniatura: blob: (local) o la pública del bucket. */
  vista: string
  /** true = blob: (se dibuja con <img>, no pasa por next/image). */
  vistaLocal: boolean
  error: string | null
  /** false para los errores que reintentar no arregla (formato, tope). */
  reintentable: boolean
  /** Orden de llegada, para la tira. */
  orden: number
}

interface CierreDelCobro {
  visitId: string | null
  clienteNombre: string | null
  /** Fotos que tiene la visita según lo último que dijo el servidor. */
  guardadas: number
  /** El servidor no pudo atar las fotos al cobrar (el cobro se hizo igual). */
  error: string | null
}

export interface CobroDeFotos {
  entradaId: string
  sesion: SesionDeFotos | null
  abriendoSesion: boolean
  errorSesion: string | null
  fotos: FotoDelCobro[]
  cierre: CierreDelCobro | null
}

interface EstadoStore {
  cobros: Record<string, CobroDeFotos>
}

export const useFotosCorteStore = create<EstadoStore>(() => ({ cobros: {} }))

const PENDIENTES = new Set<EstadoFotoDelCobro>(['preparando', 'subiendo', 'confirmando'])

export const TEXTO_FORMATO = 'Ese formato no se puede subir. Sacá la foto con la cámara o elegí otra.'
const TEXTO_PESADA = 'La foto es muy pesada. Probá con otra.'
const TEXTO_RED = 'No se subió. Revisá la conexión y tocá para reintentar.'
const TEXTO_TOPE = `Llegaste al máximo de ${TOPE_FOTOS_POR_CORTE} fotos por corte.`

/** Vida mínima para seguir mostrando en el QR una sesión ya guardada mientras se renueva. */
const VIDA_MINIMA_QR_MS = 10 * 60_000

// ─── Lo que no es estado de React (archivos, controladores, promesas) ─────────

interface DatosLocales {
  archivo: File
  blob?: Blob
  contentType?: 'image/webp' | 'image/jpeg'
  /** Ruta ya subida a Storage: un reintento confirma sin volver a subir. */
  rutaSubida?: string
  /**
   * La última confirmación se cortó (red, o error del servidor después de
   * llamar a la base): la foto PUDO haber quedado registrada aunque diga error.
   */
  confirmacionIncierta?: boolean
}

/** Una foto quitada que no se pudo borrar del servidor (un solo aviso por cobro). */
interface QuitaFallida {
  /** fotoId ('quitar'), ruta ('descartar') o CLAVE_DESCARTE_TODO. */
  clave: string
  accion: 'quitar' | 'descartar' | 'descartar_todo'
  /** Ya quedó en la ficha y no hay vuelta (el servidor dijo cobro_cerrado). */
  definitiva: boolean
}

const datosLocales = new Map<string, DatosLocales>()
const controladores = new Map<string, AbortController>()
/** Fotos que el barbero quitó mientras se procesaban: `procesar` se entera en cada paso. */
const cancelados = new Set<string>()
const aperturas = new Map<string, Promise<SesionDeFotos | null>>()
const consultas = new Map<string, Promise<RespuestaEstadoFotos>>()
const limpiezas = new Map<string, ReturnType<typeof setTimeout>>()
/**
 * Por cobro: fotoId y rutas que el barbero quitó. Una consulta (sondeo del QR)
 * que salió ANTES de quitarlas vuelve con ellas: sin esto reaparecían en la
 * tira como "listas", con la miniatura rota (fotos-del-corte-08).
 */
const quitadas = new Map<string, Set<string>>()
/** Por cobro: sube cada vez que se limpia o se descarta. Una consulta de antes se ignora. */
const generaciones = new Map<string, number>()
/** Cobros cerrados SIN visita (solo asesoría): sus fotos no van a ninguna ficha. */
const descartados = new Set<string>()
const quitasFallidas = new Map<string, Map<string, QuitaFallida>>()
const CLAVE_DESCARTE_TODO = 'descartar_todo'
/** Trabajo de fotos en vuelo (subidas y borrados), para la marca del DOM y el aviso de salida. */
let tareasEnCurso = 0

// Dos colas: comprimir es CPU y memoria (una foto de 12 MP decodificada son
// ~48 MB), así que de a una; la red, de a tres.
function semaforo(maximo: number) {
  let enCurso = 0
  const espera: Array<() => void> = []
  return {
    tomar(): Promise<void> {
      if (enCurso < maximo) {
        enCurso++
        return Promise.resolve()
      }
      return new Promise((resolve) => espera.push(() => { enCurso++; resolve() }))
    },
    soltar() {
      enCurso = Math.max(0, enCurso - 1)
      espera.shift()?.()
    },
  }
}
const colaCompresion = semaforo(1)
const colaRed = semaforo(3)

function idLocal(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // contexto no seguro: sigue abajo
  }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ─── Lectura y escritura del store ────────────────────────────────────────────

function cobroVacio(entradaId: string): CobroDeFotos {
  return { entradaId, sesion: null, abriendoSesion: false, errorSesion: null, fotos: [], cierre: null }
}

function leerCobro(entradaId: string): CobroDeFotos | undefined {
  return useFotosCorteStore.getState().cobros[entradaId]
}

/**
 * Edita un cobro. Sólo lo CREA si `crear` (abrir el diálogo, sumar fotos,
 * abrir el QR, cobrar): un paso de fondo que termina después de que el cobro se
 * limpió o se descartó no lo resucita vacío.
 */
function editarCobro(entradaId: string, cambio: (c: CobroDeFotos) => CobroDeFotos, crear = false) {
  useFotosCorteStore.setState((s) => {
    const actual = s.cobros[entradaId]
    if (!actual && !crear) return s
    return { cobros: { ...s.cobros, [entradaId]: cambio(actual ?? cobroVacio(entradaId)) } }
  })
}

function editarFoto(entradaId: string, id: string, cambios: Partial<FotoDelCobro>) {
  editarCobro(entradaId, (c) => ({
    ...c,
    fotos: c.fotos.map((f) => (f.id === id ? { ...f, ...cambios } : f)),
  }))
}

function fallar(entradaId: string, id: string, error: string, reintentable: boolean) {
  editarFoto(entradaId, id, { estado: 'error', error, reintentable, progreso: 0 })
}

function quitadasDe(entradaId: string): Set<string> {
  let s = quitadas.get(entradaId)
  if (!s) {
    s = new Set()
    quitadas.set(entradaId, s)
  }
  return s
}

function generacion(entradaId: string): number {
  return generaciones.get(entradaId) ?? 0
}

// ─── Actividad: marca del DOM y aviso de salida ──────────────────────────────

function hayActividad(): boolean {
  if (tareasEnCurso > 0) return true
  return Object.values(useFotosCorteStore.getState().cobros).some((c) =>
    c.fotos.some((f) => PENDIENTES.has(f.estado)),
  )
}

/** <html data-subiendo-fotos="true"> mientras haya fotos en vuelo (la lee la recarga por versión). */
function marcarActividadEnElDom() {
  if (typeof document === 'undefined') return
  try {
    const raiz = document.documentElement
    const hay = hayActividad()
    const marcada = raiz.dataset.subiendoFotos === 'true'
    if (hay && !marcada) raiz.dataset.subiendoFotos = 'true'
    else if (!hay && marcada) delete raiz.dataset.subiendoFotos
  } catch {
    // Sin DOM utilizable no hay nada que marcar.
  }
}

/** Cuenta un trabajo de fotos en vuelo mientras dura (la promesa ya arrancó). */
function contarActividad<T>(trabajo: Promise<T>): Promise<T> {
  tareasEnCurso++
  marcarActividadEnElDom()
  return trabajo.finally(() => {
    tareasEnCurso = Math.max(0, tareasEnCurso - 1)
    marcarActividadEnElDom()
  })
}

if (typeof window !== 'undefined') {
  // Cualquier cambio del store (una foto que empieza o termina) re-evalúa la marca.
  useFotosCorteStore.subscribe(marcarActividadEnElDom)
}

// ─── Red ─────────────────────────────────────────────────────────────────────

const RUTA = (entradaId: string) => `/api/fotos-corte/entradas/${encodeURIComponent(entradaId)}`

function errorDeRed(): ErrorFotos {
  return { ok: false, motivo: 'red', error: TEXTO_RED }
}

/**
 * Llama a la ruta de fotos con un timeout real (AbortController). Nunca lanza:
 * un corte de red vuelve como `{ ok: false, motivo: 'red' }`.
 */
async function llamar<T extends { ok: boolean }>(
  entradaId: string,
  pedido: PedidoDeFotos | null,
  timeoutMs = 15_000,
): Promise<T | ErrorFotos> {
  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs)
  try {
    const res = await fetch(RUTA(entradaId), {
      method: pedido ? 'POST' : 'GET',
      headers: pedido ? { 'content-type': 'application/json' } : undefined,
      body: pedido ? JSON.stringify(pedido) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controlador.signal,
    })
    const cuerpo = (await res.json().catch(() => null)) as (T | ErrorFotos) | null
    if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.ok === 'boolean') return cuerpo
    return { ok: false, motivo: 'servidor', error: 'No pudimos guardar la foto. Probá de nuevo.' }
  } catch {
    return errorDeRed()
  } finally {
    clearTimeout(temporizador)
  }
}

/** Un reintento automático para los cortes de red (el wifi del local parpadea). */
async function conReintento<T extends { ok: boolean }>(
  intento: () => Promise<T | ErrorFotos>,
): Promise<T | ErrorFotos> {
  const primero = await intento()
  if (primero.ok || (primero as ErrorFotos).motivo !== 'red') return primero
  await new Promise((r) => setTimeout(r, 1500))
  return intento()
}

const NO_REINTENTABLES = new Set<MotivoErrorFotos>(['formato', 'pesada', 'tope', 'cobro_cerrado', 'entrada', 'acceso', 'version'])

// ─── Sesión ──────────────────────────────────────────────────────────────────

/**
 * Abre (o retoma) la sesión de fotos del cobro. La usa el QR; las subidas no
 * la necesitan (el servidor la abre sola con la primera foto). Dos llamadas
 * simultáneas comparten la misma promesa.
 *
 * SIEMPRE pregunta al servidor: retomar la sesión la renueva (219g), así el QR
 * nunca sale con un código al que le quedan segundos. Mientras tanto, la
 * guardada se sigue mostrando sólo si le quedan 10 minutos o más; si no, el QR
 * espera la respuesta (fotos-del-corte-06).
 */
export function asegurarSesion(entradaId: string): Promise<SesionDeFotos | null> {
  const enVuelo = aperturas.get(entradaId)
  if (enVuelo) return enVuelo

  const ahora = Date.now()
  editarCobro(
    entradaId,
    (c) => {
      const s = c.sesion
      const sirve =
        s?.estado === 'activa' && !!s.token && !!s.venceEn && new Date(s.venceEn).getTime() - ahora >= VIDA_MINIMA_QR_MS
      return { ...c, abriendoSesion: true, errorSesion: null, sesion: sirve ? s : null }
    },
    true,
  )
  const promesa = llamar<RespuestaAbrirSesion>(entradaId, { accion: 'abrir' })
    .then((r) => {
      if (r.ok) {
        editarCobro(entradaId, (c) => ({ ...c, sesion: r.sesion, abriendoSesion: false, errorSesion: null }))
        return r.sesion
      }
      editarCobro(entradaId, (c) => ({ ...c, abriendoSesion: false, errorSesion: r.error }))
      return null
    })
    .finally(() => aperturas.delete(entradaId))
  aperturas.set(entradaId, promesa)
  return promesa
}

/**
 * Trae del servidor la sesión vigente y TODAS las fotos del cobro, y suma las
 * que la tablet no conocía (las del celular, o las de antes de una recarga).
 * Nunca saca una foto local: una consulta que salió antes de una confirmación
 * no puede borrar lo que se acaba de subir. Y nunca revive una quitada.
 */
export function hidratarFotos(entradaId: string): Promise<RespuestaEstadoFotos> {
  const enVuelo = consultas.get(entradaId)
  if (enVuelo) return enVuelo

  const gen = generacion(entradaId)
  const promesa = llamar<RespuestaEstadoFotos>(entradaId, null, 10_000)
    .then((r) => {
      // Si el cobro se limpió o se descartó mientras tanto, la respuesta es vieja.
      if (r.ok && generacion(entradaId) === gen) aplicarEstado(entradaId, r.datos)
      return r
    })
    .finally(() => consultas.delete(entradaId))
  consultas.set(entradaId, promesa)
  return promesa
}

function aplicarEstado(entradaId: string, datos: FotosDeEntrada) {
  const sacadas = quitadas.get(entradaId)
  editarCobro(
    entradaId,
    (c) => {
      const conocidas = new Set(c.fotos.map((f) => f.fotoId).filter(Boolean))
      // Una foto de la tablet que el servidor ya registró pero cuya confirmación
      // todavía no volvió: la consulta la trae y no hay que dibujarla dos veces.
      const rutasLocales = new Set(
        c.fotos.map((f) => datosLocales.get(f.id)?.rutaSubida).filter((r): r is string => !!r),
      )
      const nuevas: FotoDelCobro[] = datos.fotos
        .filter(
          (f) =>
            !conocidas.has(f.id) &&
            !rutasLocales.has(f.ruta) &&
            // La quitó el barbero: la consulta salió antes de que se borrara.
            !sacadas?.has(f.id) &&
            !sacadas?.has(f.ruta),
        )
        .map((f) => ({
          id: `srv:${f.id}`,
          fotoId: f.id,
          origen: f.origen,
          estado: 'lista',
          progreso: 1,
          vista: f.url,
          vistaLocal: false,
          error: null,
          reintentable: false,
          orden: Date.parse(f.creadaEn) || Date.now(),
        }))
      return {
        ...c,
        // Mientras se (re)abre la sesión del QR manda la respuesta de 'abrir',
        // que la renueva: una consulta de antes traería el vencimiento viejo.
        sesion: c.abriendoSesion ? c.sesion : (datos.sesion ?? c.sesion),
        fotos: nuevas.length > 0 ? [...c.fotos, ...nuevas] : c.fotos,
      }
    },
    true,
  )
  if (leerCobro(entradaId)?.cierre) revisarCierre(entradaId)
}

// ─── Subidas ─────────────────────────────────────────────────────────────────

let avisoDeSalidaInstalado = false

/** Recargar o cerrar la pestaña con fotos subiendo las pierde: el navegador pregunta antes. */
function instalarAvisoDeSalida() {
  if (avisoDeSalidaInstalado || typeof window === 'undefined') return
  avisoDeSalidaInstalado = true
  window.addEventListener('beforeunload', (e) => {
    if (hayActividad()) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}

/**
 * Suma fotos al cobro y las empieza a subir en segundo plano. Devuelve cuántas
 * entraron (las que pasan del tope no se agregan y se avisa).
 */
export function agregarFotos(entradaId: string, archivos: File[], origen: OrigenFoto = 'tablet'): number {
  if (archivos.length === 0) return 0
  const c = leerCobro(entradaId) ?? cobroVacio(entradaId)
  const ocupadas = c.fotos.filter((f) => f.estado !== 'error').length
  const lugar = Math.max(0, TOPE_FOTOS_POR_CORTE - ocupadas)
  const entran = archivos.slice(0, lugar)
  if (entran.length < archivos.length) toast.warning(TEXTO_TOPE)
  if (entran.length === 0) return 0

  instalarAvisoDeSalida()
  const ahora = Date.now()
  const nuevas: FotoDelCobro[] = entran.map((archivo, i) => {
    const id = idLocal()
    datosLocales.set(id, { archivo })
    return {
      id,
      fotoId: null,
      origen,
      estado: 'preparando',
      progreso: 0,
      vista: URL.createObjectURL(archivo),
      vistaLocal: true,
      error: null,
      reintentable: true,
      orden: ahora + i,
    }
  })
  editarCobro(entradaId, (cobro) => ({ ...cobro, fotos: [...cobro.fotos, ...nuevas] }), true)
  for (const f of nuevas) void contarActividad(procesar(entradaId, f.id))
  return entran.length
}

function mensajeDePut(motivo: string): { texto: string; reintentable: boolean } {
  if (motivo === 'pesada') return { texto: TEXTO_PESADA, reintentable: false }
  if (motivo === 'formato') return { texto: TEXTO_FORMATO, reintentable: false }
  return { texto: TEXTO_RED, reintentable: true }
}

async function procesar(entradaId: string, id: string): Promise<void> {
  try {
    // 1) Comprimir (una sola vez: un reintento reusa lo comprimido).
    const datos = datosLocales.get(id)
    if (!datos || cancelados.has(id)) return
    if (!datos.blob) {
      await colaCompresion.tomar()
      try {
        if (cancelados.has(id)) return
        editarFoto(entradaId, id, { estado: 'preparando', progreso: 0, error: null })
        const comprimida = await comprimirFotoDeCorte(datos.archivo, { bytesMaximos: BYTES_MAXIMOS_FOTO })
        if (!comprimida.ok) {
          fallar(entradaId, id, comprimida.motivo === 'formato' ? TEXTO_FORMATO : TEXTO_PESADA, false)
          return
        }
        datos.blob = comprimida.blob
        datos.contentType = comprimida.contentType
        // La miniatura pasa a la versión liviana: 12 fotos de 12 MP como
        // blob: son cientos de MB de memoria en una tablet.
        const anterior = leerCobro(entradaId)?.fotos.find((f) => f.id === id)?.vista
        if (!cancelados.has(id) && anterior) {
          editarFoto(entradaId, id, { vista: URL.createObjectURL(comprimida.blob) })
          if (anterior.startsWith('blob:')) URL.revokeObjectURL(anterior)
        }
      } finally {
        colaCompresion.soltar()
      }
    }

    await colaRed.tomar()
    try {
      if (cancelados.has(id) || !datos.blob || !datos.contentType) return

      // 2) Pedir la URL firmada y 3) subir directo a Storage. Si un intento
      //    anterior ya subió los bytes, se va derecho a confirmar.
      if (!datos.rutaSubida) {
        editarFoto(entradaId, id, { estado: 'subiendo', progreso: 0.02, error: null })
        const pedido = await conReintento(() =>
          llamar<RespuestaPedirSubida>(entradaId, { accion: 'pedir', contentType: datos.contentType!, bytes: datos.blob!.size }),
        )
        // La quitaron mientras se pedía la URL: no se sube nada (una URL
        // firmada sola no crea ningún objeto).
        if (cancelados.has(id)) return
        if (!pedido.ok) {
          fallar(entradaId, id, pedido.error, !NO_REINTENTABLES.has(pedido.motivo))
          return
        }
        // Con el QR renovándose, manda la respuesta de 'abrir' (asegurarSesion).
        editarCobro(entradaId, (c) => (c.abriendoSesion ? c : { ...c, sesion: pedido.subida.sesion }))

        const controlador = new AbortController()
        controladores.set(id, controlador)
        let ultimo = 0
        const put = await subirAUrlFirmada(pedido.subida.url, datos.blob, {
          signal: controlador.signal,
          onProgreso: (f) => {
            // De a 5 %: cada evento de progreso re-dibujaría la tira entera.
            if (f === 1 || f - ultimo >= 0.05) {
              ultimo = f
              editarFoto(entradaId, id, { progreso: Math.max(0.02, f) })
            }
          },
        })
        controladores.delete(id)
        if (!put.ok) {
          if (put.motivo === 'cancelada') {
            // La quitaron con la subida en vuelo: los bytes pudieron llegar
            // igual. Se borran sin registrarla (nunca se confirmó: no puede
            // estar en ninguna ficha, así que un fallo acá no se avisa).
            await limpiarQuitada(entradaId, { accion: 'descartar', clave: pedido.subida.ruta }, false)
            return
          }
          if (put.detalle) console.warn('[fotos-corte] subida rechazada por Storage', put.detalle)
          const { texto, reintentable } = mensajeDePut(put.motivo)
          fallar(entradaId, id, texto, reintentable)
          return
        }
        datos.rutaSubida = pedido.subida.ruta
      }

      // La quitaron con los bytes ya en Storage: se descartan SIN registrarla.
      // Antes se confirmaba igual y, si el cobro la ataba en el medio, quedaba
      // en la ficha del cliente para siempre (fotos-del-corte-02).
      if (cancelados.has(id)) {
        await limpiarQuitada(
          entradaId,
          { accion: 'descartar', clave: datos.rutaSubida },
          datos.confirmacionIncierta === true,
        )
        return
      }

      // 4) Confirmar: el servidor verifica los bytes y la registra (y, si el
      //    cobro ya se hizo, la suma a la visita en el acto).
      editarFoto(entradaId, id, { estado: 'confirmando', progreso: 1 })
      const confirmada = await conReintento(() =>
        llamar<RespuestaConfirmarSubida>(entradaId, { accion: 'confirmar', ruta: datos.rutaSubida! }),
      )
      if (!confirmada.ok) {
        // Un corte (red, o falla del servidor después de llamar a la base) no
        // dice si quedó registrada.
        datos.confirmacionIncierta = confirmada.motivo === 'red' || confirmada.motivo === 'servidor'
        if (cancelados.has(id)) {
          // Quitada mientras se confirmaba: si pudo quedar registrada, se saca.
          if (datos.confirmacionIncierta) {
            await limpiarQuitada(entradaId, { accion: 'descartar', clave: datos.rutaSubida! }, true)
          }
          return
        }
        // Si Storage no la tiene, el próximo intento vuelve a subirla.
        if (confirmada.motivo === 'no_subida' || confirmada.motivo === 'formato') datos.rutaSubida = undefined
        fallar(entradaId, id, confirmada.error, !NO_REINTENTABLES.has(confirmada.motivo))
        return
      }
      datos.confirmacionIncierta = false
      const fotoId = confirmada.foto.id
      if (cancelados.has(id)) {
        // La quitaron mientras se confirmaba: se saca también del servidor. Si
        // el cobro alcanzó a atarla, la base la deja sacar de la ficha dentro de
        // los minutos de gracia (219g); si no se puede, se avisa.
        await limpiarQuitada(entradaId, { accion: 'quitar', clave: fotoId }, true)
        return
      }
      editarCobro(entradaId, (c) => ({
        ...c,
        // Si una consulta la trajo antes que la confirmación, queda una sola.
        fotos: c.fotos
          .filter((f) => f.id === id || f.fotoId !== fotoId)
          .map((f) => (f.id === id ? { ...f, estado: 'lista', fotoId, error: null, reintentable: false } : f)),
      }))
      if (confirmada.vinculada && confirmada.fotosEnVisita !== null) {
        const visto = confirmada.fotosEnVisita
        editarCobro(entradaId, (c) =>
          c.cierre ? { ...c, cierre: { ...c.cierre, guardadas: Math.max(c.cierre.guardadas, visto), error: null } } : c,
        )
      }
    } finally {
      colaRed.soltar()
    }
  } catch (e) {
    // Nada de lo de arriba lanza a propósito; esto es la red de seguridad para
    // que una foto nunca quede "subiendo" para siempre.
    console.error('[fotos-corte] procesar', e)
    fallar(entradaId, id, esVersionDesactualizada(e) ? TEXTO_VERSION_NUEVA : TEXTO_RED, true)
  } finally {
    if (cancelados.has(id)) {
      // Una quitada termina acá: ya no hay nada que hacer con sus datos.
      cancelados.delete(id)
      datosLocales.delete(id)
    }
    revisarCierre(entradaId)
  }
}

export function reintentarFoto(entradaId: string, id: string) {
  const foto = leerCobro(entradaId)?.fotos.find((f) => f.id === id)
  if (!foto || foto.estado !== 'error' || !foto.reintentable || !datosLocales.has(id)) return
  editarFoto(entradaId, id, { estado: 'preparando', error: null, progreso: 0 })
  void contarActividad(procesar(entradaId, id))
}

/**
 * Saca una foto del cobro. Una que está subiendo se cancela (`procesar` borra
 * lo que haya llegado al servidor); una ya registrada se borra del servidor
 * (antes de cobrar, o dentro de la gracia si el cobro la alcanzó a atar).
 * Optimista: si el servidor no la pudo quitar, vuelve a la tira y se avisa.
 */
export async function quitarFoto(entradaId: string, id: string): Promise<void> {
  const cobro = leerCobro(entradaId)
  const foto = cobro?.fotos.find((f) => f.id === id)
  if (!foto) return

  editarCobro(entradaId, (c) => ({ ...c, fotos: c.fotos.filter((f) => f.id !== id) }))
  const sacadas = quitadasDe(entradaId)
  const datos = datosLocales.get(id)

  if (PENDIENTES.has(foto.estado)) {
    cancelados.add(id)
    controladores.get(id)?.abort()
  } else if (foto.estado === 'lista' && foto.fotoId) {
    sacadas.add(foto.fotoId)
    const r = await contarActividad(llamar<RespuestaQuitarFoto>(entradaId, { accion: 'quitar', fotoId: foto.fotoId }))
    if (!r.ok) {
      sacadas.delete(foto.fotoId)
      editarCobro(entradaId, (c) => ({
        ...c,
        fotos: [...c.fotos, foto].sort((a, b) => a.orden - b.orden),
      }))
      toast.error(r.error)
      return
    }
  } else if (foto.estado === 'error' && datos?.rutaSubida) {
    // Falló la confirmación con los bytes ya subidos: se borran (y si una
    // confirmación cortada alcanzó a registrarla, se quita).
    void contarActividad(
      limpiarQuitada(entradaId, { accion: 'descartar', clave: datos.rutaSubida }, datos.confirmacionIncierta === true),
    )
  }
  if (foto.vistaLocal) URL.revokeObjectURL(foto.vista)
  // Una que se procesa todavía usa sus datos: `procesar` los suelta al terminar.
  if (!PENDIENTES.has(foto.estado)) datosLocales.delete(id)
}

// ─── Fotos quitadas que no se pudieron borrar: UN aviso por cobro ────────────

const ID_AVISO_QUITAS = (entradaId: string) => `fotos-quitar-${entradaId}`

/**
 * Borra del servidor una foto que el barbero quitó cuando ya no estaba en la
 * tira: 'quitar' (registrada) o 'descartar' (bytes subidos y sin confirmar).
 * Nunca lo hace en silencio si la foto pudo quedar en la ficha (`avisar`): el
 * fallo queda en el aviso persistente del cobro, con Reintentar.
 */
async function limpiarQuitada(
  entradaId: string,
  quita: { accion: 'quitar' | 'descartar'; clave: string },
  avisar: boolean,
): Promise<boolean> {
  // Que un sondeo que salió antes no la reviva (si el cobro sigue en el store).
  if (leerCobro(entradaId)) quitadasDe(entradaId).add(quita.clave)
  const pedido: PedidoDeFotos =
    quita.accion === 'quitar' ? { accion: 'quitar', fotoId: quita.clave } : { accion: 'descartar', ruta: quita.clave }
  const r = await conReintento(() => llamar<RespuestaQuitarFoto>(entradaId, pedido))
  if (r.ok) {
    resolverQuitaFallida(entradaId, quita.clave)
    return true
  }
  const definitiva = r.motivo === 'cobro_cerrado'
  // Sin visita (solo asesoría) o nunca confirmada: no puede estar en ninguna
  // ficha. Si no se borró, es un archivo huérfano y nada más.
  if (!definitiva && (!avisar || descartados.has(entradaId))) {
    console.warn('[fotos-corte] no se pudo borrar una foto quitada', { entradaId, accion: quita.accion, motivo: r.motivo })
    return false
  }
  registrarQuitaFallida(entradaId, { ...quita, definitiva })
  return false
}

function registrarQuitaFallida(entradaId: string, quita: QuitaFallida) {
  let pendientes = quitasFallidas.get(entradaId)
  if (!pendientes) {
    pendientes = new Map()
    quitasFallidas.set(entradaId, pendientes)
  }
  pendientes.set(quita.clave, quita)
  avisarQuitasFallidas(entradaId)
}

function resolverQuitaFallida(entradaId: string, clave: string) {
  if (quitasFallidas.get(entradaId)?.delete(clave)) avisarQuitasFallidas(entradaId)
}

function avisarQuitasFallidas(entradaId: string) {
  const id = ID_AVISO_QUITAS(entradaId)
  const todas = [...(quitasFallidas.get(entradaId)?.values() ?? [])]
  if (todas.length === 0) {
    quitasFallidas.delete(entradaId)
    toast.dismiss(id)
    return
  }

  const reintentables = todas.filter((q) => !q.definitiva)
  const definitivas = todas.length - reintentables.length
  const accion = reintentables.length > 0
    ? { label: 'Reintentar', onClick: () => void contarActividad(reintentarQuitas(entradaId)) }
    : undefined

  // Un corte cerrado sin cobro: no hay ficha, lo que queda es un archivo guardado de más.
  if (todas.some((q) => q.accion === 'descartar_todo')) {
    toast.error('No pudimos borrar las fotos de este corte', {
      id,
      description: 'No quedan en la ficha de nadie (se cerró sin cobro), pero siguen guardadas. Tocá Reintentar.',
      duration: Infinity,
      closeButton: true,
      action: accion,
    })
    return
  }

  const nombre = primerNombre(leerCobro(entradaId)?.cierre?.clienteNombre ?? null)
  const enLaFicha = nombre ? `en la ficha de ${nombre}` : 'en la ficha del cliente'
  if (reintentables.length > 0) {
    const n = reintentables.length
    toast.error(n === 1 ? 'No pudimos borrar una foto que quitaste' : `No pudimos borrar ${n} fotos que quitaste`, {
      id,
      description:
        `Si no se borran, pueden quedar ${enLaFicha}. Revisá la conexión y tocá Reintentar.` +
        (definitivas > 0 ? ` ${definitivas === 1 ? 'Otra ya quedó' : `Otras ${definitivas} ya quedaron`} guardada${definitivas === 1 ? '' : 's'}.` : ''),
      duration: Infinity,
      closeButton: true,
      action: accion,
    })
    return
  }
  toast.error(
    definitivas === 1 ? `Una foto que quitaste quedó ${enLaFicha}` : `${definitivas} fotos que quitaste quedaron ${enLaFicha}`,
    {
      id,
      description: 'Se guardaron con el cobro antes de que se pudieran sacar, y desde acá ya no se pueden borrar.',
      duration: Infinity,
      closeButton: true,
    },
  )
}

async function reintentarQuitas(entradaId: string): Promise<void> {
  const reintentables = [...(quitasFallidas.get(entradaId)?.values() ?? [])].filter((q) => !q.definitiva)
  if (reintentables.length === 0) return
  toast.loading('Borrando las fotos que quitaste…', { id: ID_AVISO_QUITAS(entradaId), description: undefined, duration: Infinity })
  await Promise.all(
    reintentables.map((q) =>
      q.accion === 'descartar_todo'
        ? descartarTodoEnServidor(entradaId, 0)
        : limpiarQuitada(entradaId, { accion: q.accion, clave: q.clave }, true),
    ),
  )
  if ((quitasFallidas.get(entradaId)?.size ?? 0) === 0) {
    toast.success('Listo: se borraron', { id: ID_AVISO_QUITAS(entradaId), description: undefined, duration: 4000 })
  } else {
    avisarQuitasFallidas(entradaId)
  }
}

// ─── Corte cerrado SIN cobro (solo asesoría) ─────────────────────────────────

export interface ResultadoDescarte {
  /** Fotos que se borraron del servidor. */
  quitadas: number
  /** Fotos que no se pudieron borrar (queda UN aviso persistente con Reintentar). */
  fallidas: number
}

/**
 * «Cerrar como solo asesoría»: el corte se cerró SIN visita y sus fotos no van
 * a ninguna ficha. Cancela y aborta lo que se está subiendo, borra del
 * servidor TODAS las fotos del corte —también las que el celular subió sin
 * que la tablet se enterara— y limpia el cobro y sus blobs.
 *
 * Si algo no se pudo borrar, UN solo aviso persistente con Reintentar. Si
 * salió todo bien, ninguno: el diálogo ya dice «Asesoría cerrada sin cobro».
 *
 * Llamarla DESPUÉS de cerrar la entrada (cerrarSoloAsesoria): desde ahí la base
 * rechaza cualquier foto nueva de ese corte (219g), así que no queda nada
 * colgado. Nunca toca las fotos de una visita: con el cobro ya hecho en esta
 * tablet no hace nada, y el servidor rechaza descartar un corte cobrado.
 */
export function descartarFotosDelCobro(entradaId: string): Promise<ResultadoDescarte> {
  const cobro = leerCobro(entradaId)
  if (cobro?.cierre) {
    console.warn('[fotos-corte] descartarFotosDelCobro sobre un cobro ya cobrado: no se toca nada', { entradaId })
    return Promise.resolve({ quitadas: 0, fallidas: 0 })
  }
  descartados.add(entradaId)

  // 1) Lo que se está subiendo se cancela ya: `procesar` borra lo que haya
  //    alcanzado a llegar a Storage.
  let conocidas = 0
  for (const f of cobro?.fotos ?? []) {
    if (PENDIENTES.has(f.estado)) {
      cancelados.add(f.id)
      controladores.get(f.id)?.abort()
    }
    if (f.estado !== 'error') conocidas++
  }

  // 2) El cobro y sus blobs se sueltan ya: el diálogo se está cerrando.
  limpiarCobro(entradaId, { sacarAviso: true })

  // 3) Lo registrado en el servidor, en un solo pedido.
  return contarActividad(descartarTodoEnServidor(entradaId, conocidas))
}

async function descartarTodoEnServidor(entradaId: string, conocidas: number): Promise<ResultadoDescarte> {
  const r = await conReintento(() => llamar<RespuestaDescartarFotos>(entradaId, { accion: 'descartar_todo' }, 30_000))
  if (r.ok && r.fallidas === 0) {
    resolverQuitaFallida(entradaId, CLAVE_DESCARTE_TODO)
    return { quitadas: r.quitadas, fallidas: 0 }
  }
  if (!r.ok) console.error('[fotos-corte] descartar las fotos del corte', { entradaId, motivo: r.motivo, error: r.error })
  registrarQuitaFallida(entradaId, {
    clave: CLAVE_DESCARTE_TODO,
    accion: 'descartar_todo',
    definitiva: !r.ok && r.motivo === 'cobro_cerrado',
  })
  return r.ok ? { quitadas: r.quitadas, fallidas: r.fallidas } : { quitadas: 0, fallidas: Math.max(1, conocidas) }
}

// ─── Después del cobro ───────────────────────────────────────────────────────

const ID_AVISO = (entradaId: string) => `fotos-cobro-${entradaId}`

/**
 * El cobro se hizo: el diálogo se cierra YA y las fotos siguen solas. Muestra
 * el aviso mientras falten subir y el resultado cuando terminen.
 * `fotos` es lo que devolvió completeService (cuántas quedaron atadas al cerrar).
 */
export function cerrarCobroFotos(
  entradaId: string,
  datos: { visitId: string | null; clienteNombre: string | null; fotos?: ResultadoFotosDelCobro | null },
) {
  editarCobro(
    entradaId,
    (c) => ({
      ...c,
      // La sesión quedó atada a la visita: el QR ya no sirve.
      sesion: c.sesion ? { ...c.sesion, estado: 'cerrada', token: null } : c.sesion,
      cierre: {
        visitId: datos.visitId,
        clienteNombre: datos.clienteNombre,
        guardadas: datos.fotos?.guardadas ?? 0,
        error: datos.fotos?.error ?? null,
      },
    }),
    true,
  )
  revisarCierre(entradaId)
}

function revisarCierre(entradaId: string) {
  const c = leerCobro(entradaId)
  if (!c?.cierre) return

  const id = ID_AVISO(entradaId)
  const nombre = primerNombre(c.cierre.clienteNombre)
  const deQuien = nombre ? ` de ${nombre}` : ''
  const pendientes = c.fotos.filter((f) => PENDIENTES.has(f.estado))
  const fallidas = c.fotos.filter((f) => f.estado === 'error')

  if (pendientes.length > 0) {
    toast.loading(`Guardando ${cantidadDeFotos(pendientes.length)}${deQuien}…`, {
      id,
      description: 'Podés seguir con el próximo cliente.',
      duration: Infinity,
    })
    return
  }

  const guardadas = c.cierre.guardadas
  const enLaFicha = nombre ? `en la ficha de ${nombre}` : 'en la ficha del cliente'

  if (c.cierre.error && guardadas === 0) {
    // Sin vencimiento y con X: son fotos que se pierden si nadie lo ve.
    toast.error('Las fotos no se guardaron en la ficha', {
      id,
      description: `${c.cierre.error} El cobro quedó registrado igual.`,
      duration: Infinity,
      closeButton: true,
      action: { label: 'Reintentar', onClick: () => void reintentarVinculacion(entradaId) },
    })
    return
  }

  if (fallidas.length > 0) {
    const reintentables = fallidas.filter((f) => f.reintentable && datosLocales.has(f.id))
    const total = guardadas + fallidas.length
    toast.warning(`Se guardaron ${guardadas} de ${total} fotos`, {
      id,
      description:
        reintentables.length > 0
          ? `${fallidas.length === 1 ? 'Una no se pudo subir' : `${fallidas.length} no se pudieron subir`}. Tenés ${MINUTOS_GRACIA_TRAS_COBRO} minutos para reintentar.`
          : (fallidas[0].error ?? TEXTO_FORMATO),
      duration: Infinity,
      closeButton: true,
      action:
        reintentables.length > 0
          ? { label: 'Reintentar', onClick: () => reintentables.forEach((f) => reintentarFoto(entradaId, f.id)) }
          : undefined,
    })
    // Las que se pueden reintentar se guardan hasta que pase la gracia.
    programarLimpieza(entradaId, (MINUTOS_GRACIA_TRAS_COBRO + 1) * 60_000)
    return
  }

  if (guardadas > 0) {
    toast.success(`${cantidadDeFotos(guardadas)} ${guardadas === 1 ? 'guardada' : 'guardadas'} ${enLaFicha}`, { id })
  } else {
    toast.dismiss(id)
  }
  programarLimpieza(entradaId, 0)
}

async function reintentarVinculacion(entradaId: string) {
  const id = ID_AVISO(entradaId)
  toast.loading('Guardando las fotos en la ficha…', { id, description: undefined, duration: Infinity })
  const r = await conReintento(() => llamar<RespuestaVincularFotos>(entradaId, { accion: 'vincular' }))
  editarCobro(entradaId, (c) =>
    c.cierre
      ? { ...c, cierre: { ...c.cierre, guardadas: r.ok ? r.guardadas : c.cierre.guardadas, error: r.ok ? null : r.error } }
      : c,
  )
  revisarCierre(entradaId)
}

/**
 * Suelta el cobro: sus blobs, sus archivos y su lugar en el store. Una consulta
 * que salió antes ya no lo puede resucitar (generación). `sacarAviso`: el
 * descarte saca el aviso del cobro; la limpieza después de cobrar lo deja (el
 * "2 fotos guardadas en la ficha de Juan" tiene que quedar a la vista).
 */
function limpiarCobro(entradaId: string, { sacarAviso }: { sacarAviso: boolean }) {
  const previa = limpiezas.get(entradaId)
  if (previa) {
    clearTimeout(previa)
    limpiezas.delete(entradaId)
  }
  generaciones.set(entradaId, generacion(entradaId) + 1)
  quitadas.delete(entradaId)
  if (sacarAviso) toast.dismiss(ID_AVISO(entradaId))
  const c = leerCobro(entradaId)
  if (!c) return
  for (const f of c.fotos) {
    if (f.vistaLocal) URL.revokeObjectURL(f.vista)
    // Una que se procesa todavía usa sus datos: `procesar` los suelta al terminar.
    if (!PENDIENTES.has(f.estado)) datosLocales.delete(f.id)
  }
  useFotosCorteStore.setState((s) => {
    const resto = { ...s.cobros }
    delete resto[entradaId]
    return { cobros: resto }
  })
}

/** Libera la memoria del cobro (blobs y archivos) cuando ya no hay nada que hacer con él. */
function programarLimpieza(entradaId: string, demoraMs: number) {
  const previa = limpiezas.get(entradaId)
  if (previa) clearTimeout(previa)
  limpiezas.set(
    entradaId,
    setTimeout(() => {
      limpiezas.delete(entradaId)
      const c = leerCobro(entradaId)
      if (!c || c.fotos.some((f) => PENDIENTES.has(f.estado))) return
      limpiarCobro(entradaId, { sacarAviso: false })
    }, demoraMs),
  )
}
