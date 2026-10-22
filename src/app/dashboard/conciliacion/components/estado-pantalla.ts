// Las reglas del estado de la pantalla de conciliación que no dibujan nada:
// qué datos se ven, cuándo son de otro período y qué hacer cuando llega otro
// `inicial` del servidor; y la tira de 30 días, que es de UNA sucursal.
//
// Puro (sin React): lo usa conciliacion-client.tsx y se prueba con node.

import type { RespuestaConciliacion, RespuestaTira, ResultadoConciliacion, ResumenDia } from '@/lib/conciliacion-mp/contrato'
import { clavePeriodo, type Periodo } from './periodo'

// ─────────────────────────────────────────────────────────────────────────────
// Lo que se ve
// ─────────────────────────────────────────────────────────────────────────────

export interface Datos {
  /** El período (y la sucursal) al que corresponde lo que se muestra. */
  clave: string
  periodo: Periodo
  sucursalId: string | null
  resultado: ResultadoConciliacion | null
  error: string | null
}

export function claveDe(p: Periodo, sucursalId: string | null): string {
  return `${clavePeriodo(p)}|${sucursalId ?? 'todas'}`
}

export function datosDesde(p: Periodo, s: string | null, r: RespuestaConciliacion): Datos {
  const clave = claveDe(p, s)
  return r.ok
    ? { clave, periodo: p, sucursalId: s, resultado: r, error: null }
    : { clave, periodo: p, sucursalId: s, resultado: null, error: r.error }
}

/**
 * Lo que queda en pantalla cuando una carga falla: si lo que había es del MISMO
 * período, se queda (con la banda roja que lo aclara); si es de otro, no se
 * muestra: sería un número ajeno (Known Risk #15).
 */
export function datosConError(prev: Datos, p: Periodo, s: string | null, error: string): Datos {
  const clave = claveDe(p, s)
  return prev.clave === clave && prev.resultado ? { ...prev, error } : { clave, periodo: p, sucursalId: s, resultado: null, error }
}

/** ¿El resultado nuevo es al menos tan reciente como el que se ve? (un refresco del servidor no pisa uno más nuevo del cliente). */
export function esMasNuevo(nuevo: ResultadoConciliacion, actual: Pick<Datos, 'resultado'>): boolean {
  if (!actual.resultado) return true
  const a = Date.parse(nuevo.generadoEn)
  const b = Date.parse(actual.resultado.generadoEn)
  return !Number.isFinite(b) || (Number.isFinite(a) && a >= b)
}

/**
 * Llegó otro `inicial` del servidor (Next volvió a correr page.tsx: un enlace a
 * esta misma página con otros parámetros, o un refresco). Navegar a la misma
 * página conserva la instancia del cliente, así que el estado no se reinicia
 * solo:
 *   - 'adoptar': es otro período o sucursal (el enlace «Ver la conciliación» de
 *     Tex): la pantalla pasa a ése, con los datos que ya trajo el servidor.
 *   - 'refrescar': es lo mismo que se ve, con datos más nuevos.
 *   - 'ignorar': es lo mismo y no trae nada mejor.
 */
export function queHacerConInicial(
  actual: { periodo: Periodo; sucursalId: string | null; datos: Pick<Datos, 'resultado'> },
  nuevo: { periodo: Periodo; sucursalId: string | null; respuesta: RespuestaConciliacion },
): 'adoptar' | 'refrescar' | 'ignorar' {
  if (claveDe(nuevo.periodo, nuevo.sucursalId) !== claveDe(actual.periodo, actual.sucursalId)) return 'adoptar'
  return nuevo.respuesta.ok && esMasNuevo(nuevo.respuesta, actual.datos) ? 'refrescar' : 'ignorar'
}

// ─────────────────────────────────────────────────────────────────────────────
// La tira de 30 días
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoTira {
  estado: 'cargando' | 'ok' | 'error'
  dias: ResumenDia[]
  error: string | null
  /** De qué sucursal son esos días: los de otra nunca se muestran como de ésta. */
  sucursalId: string | null
}

export function tiraCargando(sucursalId: string | null): EstadoTira {
  return { estado: 'cargando', dias: [], error: null, sucursalId }
}

/** Al pedir la tira de una sucursal: la de la MISMA queda a la vista mientras se recalcula; la de otra, no. */
export function tiraAlPedir(prev: EstadoTira, sucursalId: string | null): EstadoTira {
  return prev.sucursalId === sucursalId ? prev : tiraCargando(sucursalId)
}

/**
 * Llegó la respuesta de la tira de `sucursalId`. Si falló, sólo se conservan los
 * días que ya eran de ESA sucursal ("lo que ves puede estar viejo"); los de otra
 * sucursal no: con días vacíos la pantalla muestra el error con Reintentar, en
 * vez de los colores de otra sucursal como si fueran de ésta.
 */
export function tiraConRespuesta(prev: EstadoTira, sucursalId: string | null, r: RespuestaTira): EstadoTira {
  if (r.ok) return { estado: 'ok', dias: r.dias, error: null, sucursalId }
  return { estado: 'error', dias: prev.sucursalId === sucursalId ? prev.dias : [], error: r.error, sucursalId }
}

/** Lo que se dibuja: la tira de la sucursal elegida o, mientras llega, el esqueleto. */
export function tiraVisible(tira: EstadoTira, sucursalId: string | null): EstadoTira {
  return tira.sucursalId === sucursalId ? tira : tiraCargando(sucursalId)
}
