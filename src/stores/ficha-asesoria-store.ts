import { create } from 'zustand'
import { guardarFichaAsesoria, obtenerFichaAsesoria } from '@/lib/actions/ficha-asesoria'
import { avisarYRecargarPorVersion, esErrorDeVersion } from '@/lib/recarga-version'
import {
  aplicarCambios,
  leerDatosFicha,
  type CampoFicha,
  type DatosFicha,
  type FichaAsesoria,
  type FotoDeFicha,
  type MotivoErrorFicha,
  type PreviaFicha,
} from '@/lib/asesoria/ficha'

/*
 * La ficha de asesoría de cada cliente en el panel (mig 238), compartida por
 * todo lo que la muestra: la hoja donde se completa, la receta de la tarjeta del
 * corte (que el panel monta dos veces, una oculta por CSS), la ficha del cliente
 * y el cobro (los productos que se le recomendaron).
 *
 * Cada toque cambia la ficha EN EL ACTO (se ve sin esperar a la red) y queda
 * pendiente; un respiro después se manda sólo lo que cambió, de a un guardado
 * por cliente. Si falla la red se reintenta solo, con espera creciente, y lo
 * pendiente queda en localStorage: una recarga (por versión, por la sesión) no
 * pierde lo que el barbero marcó. Una falla se dice en la hoja («Sin guardar»),
 * nunca en silencio.
 */

/** Lo que dura una lectura buena antes de volver a pedirla. */
const VIGENCIA_MS = 60_000
/** Respiro entre el último toque y el guardado (los toques seguidos van juntos). */
const RESPIRO_MS = 650
/** Esperas de los reintentos cuando falla la red o la base. */
const REINTENTOS_MS = [2_000, 5_000, 10_000, 20_000, 30_000]
/** Lo pendiente en localStorage vale esto (después la visita ya se cerró). */
const VIGENCIA_PENDIENTE_MS = 12 * 3_600_000
const CLAVE_LOCAL = 'msb.ficha-asesoria.pendiente.v1:'

export type CargaFicha =
  | { tipo: 'cargando' }
  | { tipo: 'error'; motivo: MotivoErrorFicha; error: string }
  | { tipo: 'lista' }

/**
 * - `al_dia`: no hay nada sin guardar.
 * - `pendiente`: hay cambios esperando el respiro (o el guardado en vuelo).
 * - `guardando`: el guardado está en vuelo.
 * - `error`: el último guardado falló; `errorGuardado` dice por qué.
 */
export type EstadoGuardado = 'al_dia' | 'pendiente' | 'guardando' | 'error'

export interface FichaDelPanel {
  clienteId: string
  /** La entrada con la que se pidió (define el «antes»). */
  entradaId: string | null
  carga: CargaFicha
  /** Lo último que confirmó el servidor (null = el cliente todavía no tiene ficha). */
  servidor: FichaAsesoria | null
  previa: PreviaFicha | null
  fotos: FotoDeFicha[]
  /** Lo que se ve: lo del servidor + lo que todavía no se guardó. */
  datos: DatosFicha
  guardado: EstadoGuardado
  errorGuardado: string | null
  /** Si el error se arregla solo (red) o necesita algo del barbero (sesión, visita cerrada). */
  errorReintentable: boolean
  guardadoEn: number | null
  /** Entradas en las que se tocó la ficha en este panel (el cobro pide la foto). */
  entradasTocadas: string[]
}

interface EstadoStore {
  fichas: Record<string, FichaDelPanel>
}

export const useFichaAsesoriaStore = create<EstadoStore>(() => ({ fichas: {} }))

function vacia(clienteId: string, entradaId: string | null): FichaDelPanel {
  return {
    clienteId,
    entradaId,
    carga: { tipo: 'cargando' },
    servidor: null,
    previa: null,
    fotos: [],
    datos: {},
    guardado: 'al_dia',
    errorGuardado: null,
    errorReintentable: true,
    guardadoEn: null,
    entradasTocadas: [],
  }
}

function actualizar(clienteId: string, cambio: (f: FichaDelPanel) => Partial<FichaDelPanel>) {
  useFichaAsesoriaStore.setState((s) => {
    const previa = s.fichas[clienteId]
    if (!previa) return s
    return { fichas: { ...s.fichas, [clienteId]: { ...previa, ...cambio(previa) } } }
  })
}

// ─── Lo pendiente (fuera de React: no redibuja nada) ─────────────────────────

/** `QUITAR` = la pregunta se dejó sin responder. */
const QUITAR = Symbol('quitar')
type ValorPendiente = unknown | typeof QUITAR

interface Pendiente {
  entradaId: string
  cambios: Map<CampoFicha, ValorPendiente>
  /** Versión de cada campo: lo que cambió mientras se guardaba no se da por guardado. */
  version: Map<CampoFicha, number>
  enVuelo: boolean
  temporizador: ReturnType<typeof setTimeout> | null
  intento: number
}

const pendientes = new Map<string, Pendiente>()

function aplicarPendiente(datos: DatosFicha, p: Pendiente | undefined): DatosFicha {
  if (!p || p.cambios.size === 0) return datos
  const cambios: Record<string, unknown> = {}
  const quitar: CampoFicha[] = []
  for (const [campo, valor] of p.cambios) {
    if (valor === QUITAR) quitar.push(campo)
    else cambios[campo] = valor
  }
  return aplicarCambios(datos, cambios as DatosFicha, quitar)
}

function guardarLocal(clienteId: string) {
  try {
    const p = pendientes.get(clienteId)
    const clave = CLAVE_LOCAL + clienteId
    if (!p || p.cambios.size === 0) {
      window.localStorage.removeItem(clave)
      return
    }
    const cambios: Record<string, unknown> = {}
    for (const [campo, valor] of p.cambios) cambios[campo] = valor === QUITAR ? null : valor
    window.localStorage.setItem(clave, JSON.stringify({ entradaId: p.entradaId, cambios, desde: Date.now() }))
  } catch {
    // Sin localStorage (navegación privada, sitio bloqueado): queda en memoria.
  }
}

/** Lo que quedó sin guardar de antes de una recarga. Lo valida el catálogo de hoy. */
function leerLocal(clienteId: string): Map<CampoFicha, ValorPendiente> | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_LOCAL + clienteId)
    if (!crudo) return null
    const leido = JSON.parse(crudo) as { cambios?: Record<string, unknown>; desde?: number }
    if (!leido?.cambios || typeof leido.desde !== 'number' || Date.now() - leido.desde > VIGENCIA_PENDIENTE_MS) {
      window.localStorage.removeItem(CLAVE_LOCAL + clienteId)
      return null
    }
    const validos = leerDatosFicha(leido.cambios) as Record<string, unknown>
    const salida = new Map<CampoFicha, ValorPendiente>()
    for (const [campo, valor] of Object.entries(leido.cambios)) {
      if (valor === null) salida.set(campo as CampoFicha, QUITAR)
      else if (campo in validos) salida.set(campo as CampoFicha, validos[campo])
    }
    return salida.size > 0 ? salida : null
  } catch {
    return null
  }
}

function programar(clienteId: string, enMs: number) {
  const p = pendientes.get(clienteId)
  if (!p) return
  if (p.temporizador) clearTimeout(p.temporizador)
  p.temporizador = setTimeout(() => {
    p.temporizador = null
    void enviar(clienteId)
  }, enMs)
}

async function enviar(clienteId: string): Promise<void> {
  const p = pendientes.get(clienteId)
  if (!p || p.enVuelo || p.cambios.size === 0) return
  p.enVuelo = true
  const enviado = new Map(p.cambios)
  const versiones = new Map(p.version)
  const cambios: Record<string, unknown> = {}
  const quitar: CampoFicha[] = []
  for (const [campo, valor] of enviado) {
    if (valor === QUITAR) quitar.push(campo)
    else cambios[campo] = valor
  }
  actualizar(clienteId, () => ({ guardado: 'guardando' }))

  let r: Awaited<ReturnType<typeof guardarFichaAsesoria>>
  try {
    r = await guardarFichaAsesoria({ clienteId, entradaId: p.entradaId, cambios, quitar })
  } catch (e) {
    console.error('[ficha-asesoria] guardar', e)
    if (esErrorDeVersion(e)) {
      // Bundle de un deploy anterior: lo pendiente ya está en localStorage y
      // se vuelve a mandar después de la recarga (que espera a que se cierre
      // la hoja).
      p.enVuelo = false
      avisarYRecargarPorVersion()
      actualizar(clienteId, () => ({
        guardado: 'error',
        errorGuardado: 'Hay una versión nueva del panel: se guarda al recargar.',
        errorReintentable: false,
      }))
      return
    }
    r = { ok: false, motivo: 'error', error: 'Sin conexión: se guarda cuando vuelva.' }
  }
  p.enVuelo = false

  if (r.ok) {
    const ok = r
    for (const campo of enviado.keys()) {
      if (p.version.get(campo) === versiones.get(campo)) p.cambios.delete(campo)
    }
    p.intento = 0
    guardarLocal(clienteId)
    const ahora = new Date().toISOString()
    actualizar(clienteId, (f) => ({
      servidor: {
        id: ok.fichaId ?? f.servidor?.id ?? '',
        clienteId: f.servidor?.clienteId ?? clienteId,
        datos: ok.datos,
        creadaEn: f.servidor?.creadaEn ?? ok.actualizadaEn ?? ahora,
        actualizadaEn: ok.actualizadaEn ?? ahora,
        actualizadaPor: f.servidor?.actualizadaPor ?? null,
        visitas: f.servidor?.visitas ?? 1,
      },
      datos: aplicarPendiente(ok.datos, p),
      guardado: p.cambios.size > 0 ? 'pendiente' : 'al_dia',
      errorGuardado: null,
      errorReintentable: true,
      guardadoEn: Date.now(),
      entradasTocadas: f.entradasTocadas.includes(p.entradaId) ? f.entradasTocadas : [...f.entradasTocadas, p.entradaId],
    }))
    // Lo que se tocó mientras se guardaba sale enseguida.
    if (p.cambios.size > 0) programar(clienteId, RESPIRO_MS)
    return
  }

  const falla = r
  // Datos rechazados o visita cerrada: reintentar no cambia nada. Se descarta
  // lo pendiente y la hoja vuelve a lo que dice el servidor, avisando.
  if (falla.motivo === 'datos' || falla.motivo === 'entrada' || falla.motivo === 'acceso') {
    p.cambios.clear()
    p.version.clear()
    guardarLocal(clienteId)
    actualizar(clienteId, (f) => ({
      datos: f.servidor?.datos ?? {},
      guardado: 'error',
      errorGuardado: falla.error,
      errorReintentable: false,
    }))
    return
  }

  // Sesión vencida: queda guardado en la tablet; el vigía la manda al PIN y,
  // al volver, la próxima lectura lo reenvía.
  if (falla.motivo === 'sesion') {
    actualizar(clienteId, () => ({ guardado: 'error', errorGuardado: falla.error, errorReintentable: false }))
    return
  }

  const espera = REINTENTOS_MS[Math.min(p.intento, REINTENTOS_MS.length - 1)]
  p.intento += 1
  actualizar(clienteId, () => ({ guardado: 'error', errorGuardado: falla.error, errorReintentable: true }))
  programar(clienteId, espera)
}

// ─── API ─────────────────────────────────────────────────────────────────────

const lecturas = new Map<string, Promise<void>>()
/** Cuándo llegó la última lectura buena de cada cliente. */
const ultimaLectura = new Map<string, number>()

/**
 * Pide la ficha de un cliente. Una lectura buena vale un minuto; `forzar` la
 * pide igual. Mientras relee, lo que ya había sigue a la vista.
 */
export function cargarFichaAsesoria(
  clienteId: string,
  entradaId: string | null,
  opciones?: { forzar?: boolean },
): Promise<void> {
  const estado = useFichaAsesoriaStore.getState().fichas[clienteId]
  const vigente =
    estado?.carga.tipo === 'lista' &&
    estado.entradaId === entradaId &&
    ultimaLectura.has(clienteId) &&
    Date.now() - (ultimaLectura.get(clienteId) ?? 0) < VIGENCIA_MS
  if (!opciones?.forzar && vigente) return Promise.resolve()
  const enVuelo = lecturas.get(clienteId)
  if (enVuelo && !opciones?.forzar) return enVuelo

  if (!estado) {
    useFichaAsesoriaStore.setState((s) => ({ fichas: { ...s.fichas, [clienteId]: vacia(clienteId, entradaId) } }))
  } else if (estado.carga.tipo === 'error') {
    actualizar(clienteId, () => ({ carga: { tipo: 'cargando' } }))
  }

  const promesa = (async () => {
    let r: Awaited<ReturnType<typeof obtenerFichaAsesoria>>
    try {
      r = await obtenerFichaAsesoria(clienteId, entradaId)
    } catch (e) {
      console.error('[ficha-asesoria] leer', e)
      if (esErrorDeVersion(e)) avisarYRecargarPorVersion()
      r = { ok: false, motivo: 'error', error: 'No pudimos cargar la ficha de asesoría.' }
    }

    // Lo que quedó sin guardar antes de una recarga vuelve a la cola.
    if (entradaId && !pendientes.has(clienteId)) {
      const local = leerLocal(clienteId)
      if (local) {
        const version = new Map<CampoFicha, number>()
        for (const campo of local.keys()) version.set(campo, 1)
        pendientes.set(clienteId, { entradaId, cambios: local, version, enVuelo: false, temporizador: null, intento: 0 })
      }
    }
    const p = pendientes.get(clienteId)
    if (p && entradaId) p.entradaId = entradaId

    if (r.ok) {
      ultimaLectura.set(clienteId, Date.now())
      const ok = r
      actualizar(clienteId, (f) => ({
        entradaId,
        carga: { tipo: 'lista' },
        servidor: ok.ficha,
        previa: ok.previa,
        fotos: ok.fotos,
        datos: aplicarPendiente(ok.ficha?.datos ?? {}, p),
        ...(p && p.cambios.size > 0
          ? { guardado: f.guardado === 'error' ? 'error' : 'pendiente' }
          : { guardado: 'al_dia', errorGuardado: null, errorReintentable: true }),
      }))
      if (p && p.cambios.size > 0 && !p.enVuelo) programar(clienteId, RESPIRO_MS)
    } else {
      const falla = r
      actualizar(clienteId, (f) =>
        // Con datos buenos de antes, se quedan (la hoja no se vacía por un corte de red).
        f.carga.tipo === 'lista' ? {} : { carga: { tipo: 'error', motivo: falla.motivo, error: falla.error } },
      )
    }
  })().finally(() => {
    lecturas.delete(clienteId)
  })
  lecturas.set(clienteId, promesa)
  return promesa
}

/**
 * Cambia una pregunta de la ficha (`undefined` = dejarla sin responder). Se ve
 * en el acto y se guarda sola un respiro después.
 */
export function cambiarCampoFicha(clienteId: string, entradaId: string, campo: CampoFicha, valor: unknown) {
  let p = pendientes.get(clienteId)
  if (!p) {
    p = { entradaId, cambios: new Map(), version: new Map(), enVuelo: false, temporizador: null, intento: 0 }
    pendientes.set(clienteId, p)
  }
  p.entradaId = entradaId
  p.cambios.set(campo, valor === undefined ? QUITAR : valor)
  p.version.set(campo, (p.version.get(campo) ?? 0) + 1)
  const pendiente = p

  useFichaAsesoriaStore.setState((s) => {
    const previa = s.fichas[clienteId] ?? { ...vacia(clienteId, entradaId), carga: { tipo: 'lista' } as CargaFicha }
    return {
      fichas: {
        ...s.fichas,
        [clienteId]: {
          ...previa,
          datos: aplicarPendiente(previa.servidor?.datos ?? {}, pendiente),
          guardado: previa.guardado === 'error' && !previa.errorReintentable ? 'error' : 'pendiente',
        },
      },
    }
  })
  guardarLocal(clienteId)
  programar(clienteId, RESPIRO_MS)
}

/** Manda ya lo pendiente (al cerrar la hoja, o «Reintentar»). */
export function guardarFichaYa(clienteId: string) {
  const p = pendientes.get(clienteId)
  if (!p || p.cambios.size === 0) return
  if (p.temporizador) {
    clearTimeout(p.temporizador)
    p.temporizador = null
  }
  p.intento = 0
  void enviar(clienteId)
}

/** ¿Queda algo sin guardar de este cliente? */
export function hayFichaSinGuardar(clienteId: string): boolean {
  return (pendientes.get(clienteId)?.cambios.size ?? 0) > 0
}

/** Lo que el panel ya sabe de la ficha de un cliente (para otras superficies, sin pedir nada). */
export function datosFichaConocidos(clienteId: string | null | undefined): DatosFicha | null {
  if (!clienteId) return null
  const f = useFichaAsesoriaStore.getState().fichas[clienteId]
  return f && f.carga.tipo === 'lista' ? f.datos : null
}
