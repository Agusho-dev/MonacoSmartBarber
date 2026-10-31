// =============================================================================
// Reglas del guardado de partidas de «Corte Final» que comparten la server
// action (src/lib/actions/juego.ts) y el celular (pantalla-resultado.tsx y la
// cola de pendientes.ts): los topes del rate limit, sus claves y la respuesta.
//
// El rate limit es `check_rate_limit` (ventana FIJA que arranca con el primer
// pedido; cada pedido suma 1 aunque se rechace; pasa si count <= limit; leído
// vivo con pg_get_functiondef el 30/oct). Hasta el 30/oct el tope era 6 cada
// 10 min y, sin QR, la clave era la IP: un solo jugador que encadena
// «Revancha» perdía hasta la mitad de sus partidas, y todo un local en el mismo
// wifi compartía esas 6 (con 4 celulares se perdían 3 de cada 4).
//
// Sin imports de `@/` ni `server-only` (se prueba con Node tal cual): sólo
// tipos de ./tipos.
// =============================================================================

import type { PartidaParaGuardar } from './tipos'

/**
 * Tope por jugador. La pelea más corta (un 2–0 rápido) dura 26–31 s de motor y
 * entre «Revancha» y la pelea siguiente pasan ≈ 4 s: nadie que juega de verdad
 * guarda más de ≈ 20 cada 10 min.
 */
export const LIMITE_GUARDAR_JUGADOR = { limit: 24, window: 600 }

/**
 * Techo por IP para TODAS las partidas (con QR, con dispositivo o sin nada):
 * los celulares de un local comparten el wifi, y el id del dispositivo lo arma
 * el celular (alguien puede inventar uno en cada pedido). Con 150 cada 10 min,
 * 12 celulares en el mismo wifi jugando sin parar las peleas más cortas no
 * pierden ninguna (simulado: el 97 % se guarda en el momento y el resto por la
 * cola de pendientes.ts); con duraciones normales, 15 guardan todo al instante.
 */
export const LIMITE_GUARDAR_IP = { limit: 150, window: 600 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El id del dispositivo si es un UUID (en minúsculas); null si falta o no tiene forma de UUID. */
export function normalizarDispositivo(valor: unknown): string | null {
  return typeof valor === 'string' && UUID.test(valor) ? valor.toLowerCase() : null
}

/**
 * La clave del tope por jugador: con QR, IP + entrada de la fila; sin QR, IP +
 * id del dispositivo; sin ninguno de los dos (la página de antes del 30/oct,
 * que no lo manda), la IP sola, como siempre. Los prefijos no se pisan: un
 * UUID nunca empieza con «d:».
 */
export function claveJugador(ip: string, queueEntryId: string | null, dispositivo: string | null): string {
  if (queueEntryId) return `${ip}:${queueEntryId}`
  if (dispositivo) return `${ip}:d:${dispositivo}`
  return ip
}

/**
 * Segundos hasta `resetAt` (el fin de la ventana que devuelve check_rate_limit),
 * entre 1 y la ventana. Si la fecha no se puede leer, la ventana entera.
 */
export function segundosHasta(resetAt: string | null | undefined, ahoraMs: number, ventanaSeg: number): number {
  const fin = typeof resetAt === 'string' ? Date.parse(resetAt) : Number.NaN
  if (!Number.isFinite(fin)) return ventanaSeg
  return Math.min(ventanaSeg, Math.max(1, Math.ceil((fin - ahoraMs) / 1000)))
}

/**
 * Lo que manda el celular: la partida y, desde el 30/oct, el id del
 * dispositivo. Es OPCIONAL: un celular con la página de antes no lo manda y la
 * server action lo sigue aceptando (Known Risk #38).
 */
export type PartidaAGuardar = PartidaParaGuardar & { dispositivo?: string | null }

/** Rechazo por el tope del rate limit: pasó ANTES de insertar, así que no se guardó nada. */
export interface RechazoPorTope {
  ok: false
  error: string
  motivo: 'tope'
  /** Segundos hasta que se libera el cupo (lo que tarda en terminar la ventana). */
  esperarSeg: number
}

/**
 * La respuesta de guardarPartidaJuego. La forma de siempre ({ ok, puesto } o
 * { ok, error }); el rechazo por el tope suma `motivo` y `esperarSeg`, campos
 * nuevos que la página de antes ignora (Known Risk #38).
 */
export type RespuestaGuardado =
  | { ok: true; puesto: number | null }
  | { ok: false; error: string; motivo?: undefined; esperarSeg?: undefined }
  | RechazoPorTope

/**
 * ¿El servidor la frenó por el tope? Es el ÚNICO rechazo después del cual
 * reintentar no puede duplicar la partida: cualquier otro error (de red, un
 * timeout, uno desconocido) pudo haber llegado a insertar.
 */
export function esRechazoPorTope(r: RespuestaGuardado | null | undefined): r is RechazoPorTope {
  return !!r && r.ok === false && r.motivo === 'tope'
}
