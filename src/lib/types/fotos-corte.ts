/**
 * Fotos del corte: tipos y reglas que comparten la tablet, el celular del
 * barbero y el servidor (mig 219).
 *
 * Sin 'use server' ni 'server-only' a propósito: las importan los componentes
 * del cobro (para dibujar el tope y los estados), la página del celular y el
 * módulo del servidor. Si el tope viviera en dos lugares, la tablet dejaría
 * elegir 15 fotos y el servidor rechazaría las últimas tres en silencio.
 */

/** Fotos por CORTE (todas las sesiones de la entrada). El mismo número valida la base. */
export const TOPE_FOTOS_POR_CORTE = 12

/** Vida de una sesión de fotos abierta. Se abre recién con la primera foto, al final del corte. */
export const MINUTOS_SESION_FOTOS = 45

/**
 * Minutos después del cobro en los que una foto todavía entra a la visita: la
 * que el celular estaba terminando de subir cuando el barbero tocó Cobrar.
 */
export const MINUTOS_GRACIA_TRAS_COBRO = 10

/**
 * Tope por foto, ya comprimida. Una foto de 1600 px en WebP o JPEG pesa unos
 * 300 KB; esto ataja lo que no se pudo achicar. El bucket rechaza más de 10 MB
 * como respaldo (mig 219).
 */
export const BYTES_MAXIMOS_FOTO = 4 * 1024 * 1024

/** Lo que se sube. PNG no: la compresión siempre sale en WebP o, si el navegador no lo codifica, JPEG. */
export const TIPOS_FOTO_SUBIBLES = ['image/webp', 'image/jpeg'] as const
export type TipoFotoSubible = (typeof TIPOS_FOTO_SUBIBLES)[number]

export type OrigenFoto = 'tablet' | 'celular'

/** Una foto registrada en la sesión de un cobro (qr_photo_uploads). */
export interface FotoDeSesion {
  id: string
  ruta: string
  /** URL pública del bucket visit-photos. */
  url: string
  origen: OrigenFoto
  creadaEn: string
}

/**
 * - `activa`: abierta y sin vencer.
 * - `cerrada`: ya atada a la visita (el cobro se hizo). Acepta fotos sólo
 *   durante los minutos de gracia.
 * - `vencida`: pasaron los 45 minutos sin cobrar.
 */
export type EstadoSesionFotos = 'activa' | 'cerrada' | 'vencida'

export interface SesionDeFotos {
  id: string
  /** El token del QR. Sólo viaja mientras la sesión está activa. */
  token: string | null
  estado: EstadoSesionFotos
  venceEn: string | null
  /** Si una foto que llega ahora todavía entra (activa, o cerrada dentro de la gracia). */
  aceptaFotos: boolean
}

/** Las fotos de un cobro: la sesión vigente y TODAS las fotos de la entrada. */
export interface FotosDeEntrada {
  sesion: SesionDeFotos | null
  fotos: FotoDeSesion[]
  tope: number
}

export type MotivoErrorFotos =
  | 'sesion' // la cookie del barbero o la sesión del dashboard vencieron
  | 'acceso' // la sucursal no es suya
  | 'entrada' // el corte no existe o no es de esta organización
  | 'cobro_cerrado' // el cobro ya se cerró (y pasó la gracia)
  | 'vencida' // la sesión de fotos venció
  | 'tope' // ya hay 12 fotos
  | 'formato' // no es una imagen que se pueda subir
  | 'pesada' // más de 4 MB ya comprimida
  | 'no_subida' // se confirmó una foto que no está en Storage
  | 'version' // el panel quedó viejo después de un deploy
  | 'red' // sin conexión / timeout
  | 'servidor' // falló algo de nuestro lado
  | 'datos' // la request llegó mal

export type ErrorFotos = { ok: false; error: string; motivo: MotivoErrorFotos }

/** `{ ok: true, ...datos }` o el error con su motivo. Nunca un vacío ambiguo. */
export type ResultadoFotos<T extends object> = ({ ok: true } & T) | ErrorFotos

/** Autorización para subir UNA foto: la ruta la arma el servidor y la URL está firmada para esa ruta. */
export interface SubidaAutorizada {
  ruta: string
  url: string
  sesion: SesionDeFotos
}

// ─── API de /api/fotos-corte/entradas/[id] (tablet y dashboard) ──────────────

export type RespuestaEstadoFotos = ResultadoFotos<{ datos: FotosDeEntrada }>
export type RespuestaAbrirSesion = ResultadoFotos<{ sesion: SesionDeFotos }>
export type RespuestaPedirSubida = ResultadoFotos<{ subida: SubidaAutorizada }>
export type RespuestaConfirmarSubida = ResultadoFotos<{
  foto: FotoDeSesion
  /** La foto ya quedó en la ficha (el cobro estaba hecho). */
  vinculada: boolean
  /** Fotos que tiene la visita después de sumarla (sólo si `vinculada`). */
  fotosEnVisita: number | null
}>
export type RespuestaQuitarFoto = ResultadoFotos<{ quitada: true }>
export type RespuestaVincularFotos = ResultadoFotos<{ guardadas: number }>

/** Cuerpo de POST /api/fotos-corte/entradas/[id]. */
export type PedidoFotosDeEntrada =
  | { accion: 'abrir' }
  | { accion: 'pedir'; contentType: string; bytes: number }
  | { accion: 'confirmar'; ruta: string }
  | { accion: 'quitar'; fotoId: string }
  | { accion: 'vincular' }

/**
 * Lo que `completeService` informa de las fotos al cerrar el cobro. `guardadas`
 * cuenta las fotos que quedaron en la visita en ese momento; `error` sólo viene
 * si el cobro tenía fotos y no se pudieron atar (el cobro se hizo igual).
 */
export interface ResultadoFotosDelCobro {
  guardadas: number
  error?: string
}

// ─── Página del celular (/upload/[token]) ────────────────────────────────────

export interface EstadoFotosCelular {
  /** `error`: no pudimos leer la sesión (no es lo mismo que un código inválido). */
  estado: EstadoSesionFotos | 'invalida' | 'error'
  organizacion: { nombre: string; logoUrl: string | null } | null
  /** "Juan P.": nombre de pila e inicial del apellido. null si el corte no tiene cliente. */
  cliente: string | null
  /** Nombre de pila del barbero. */
  barbero: string | null
  /** Fotos que ya tiene el corte (de la tablet y del celular). */
  cantidad: number
  aceptaFotos: boolean
  /** Fotos que todavía entran. */
  quedan: number
}

// ─── Historial: los últimos cortes de un cliente ─────────────────────────────

export interface FotoDeCorte {
  id: string
  url: string
  orden: number
}

/** Un corte del historial. Sirve también SIN fotos ("Corte + Barba · con Nico · hace 3 semanas"). */
export interface CorteDelCliente {
  visitId: string
  /** completed_at de la visita (ISO). */
  fecha: string
  servicio: string | null
  extras: string[]
  barbero: { id: string; nombre: string } | null
  sucursal: { id: string; nombre: string } | null
  fotos: FotoDeCorte[]
}

export interface FichaDelCliente {
  id: string
  nombre: string
  notas: string | null
  instagram: string | null
}

export type UltimosCortesResultado =
  | {
      ok: true
      cliente: FichaDelCliente
      /** Cortes del cliente en toda la organización (no sólo los que se devuelven). 0 = primera visita. */
      totalVisitas: number
      /** Del más reciente al más viejo, hasta `limite`. */
      cortes: CorteDelCliente[]
    }
  | { ok: false; error: string; motivo: 'sesion' | 'acceso' | 'no_existe' | 'datos' | 'error' }
