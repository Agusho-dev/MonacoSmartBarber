// =============================================================================
// Reglas del guardado de partidas de «Corte Final» que comparten la server
// action (src/lib/actions/juego.ts) y el celular (pantalla-resultado.tsx y la
// cola de pendientes.ts): los topes del rate limit, sus claves, la clave de
// idempotencia de cada pelea y la respuesta.
//
// El rate limit es `check_rate_limit` (ventana FIJA que arranca con el primer
// pedido; cada pedido suma 1 aunque se rechace; pasa si count <= limit; leído
// vivo con pg_get_functiondef el 30/oct). Hasta el 30/oct el tope era 6 cada
// 10 min y, sin QR, la clave era la IP: un solo jugador que encadena
// «Revancha» perdía hasta la mitad de sus partidas, y todo un local en el mismo
// wifi compartía esas 6 (con 4 celulares se perdían 3 de cada 4).
//
// Idempotencia (31/oct, mig 234): cada partida viaja con `idPartida`, el id de
// la pelea (un UUID que arma el celular), y `juego_partidas.id_partida` es
// UNIQUE. Mandar dos veces la misma pelea deja UNA fila: así se puede
// reintentar después de una falla que no dice si se guardó (red caída, el
// timeout de 8 s, que corta la respuesta y no la escritura). Sin la clave
// (la página de antes del 31/oct o un navegador sin crypto) eso sigue sin
// reintentarse.
//
// Sin imports de `@/` ni `server-only` (se prueba con Node tal cual): sólo
// tipos de ./tipos.
// =============================================================================

import type { PartidaParaGuardar } from './tipos'

/**
 * El apodo de una pelea que se cerró sin confirmar uno: cuenta para el % de
 * victorias de cada barbero, pero no entra al ranking (obtenerRankingJuego la
 * saca). Es el ÚNICO apodo que el servidor cambia después: si llega la misma
 * pelea con un apodo confirmado, se lo pone a esa fila (nunca al revés).
 */
export const APODO_ANONIMO = 'Anónimo'

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

/** El valor si es un UUID (en minúsculas); null si falta o no tiene forma de UUID. */
function uuidONulo(valor: unknown): string | null {
  return typeof valor === 'string' && UUID.test(valor) ? valor.toLowerCase() : null
}

/** El id del dispositivo si es un UUID (en minúsculas); null si falta o no tiene forma de UUID. */
export function normalizarDispositivo(valor: unknown): string | null {
  return uuidONulo(valor)
}

/**
 * La clave de idempotencia de la pelea si es un UUID (en minúsculas); null si
 * falta (la página de antes del 31/oct) o no tiene forma de UUID. La misma
 * regla en el celular y en el servidor: lo que el celular cree reintentable,
 * el servidor lo deduplica.
 */
export function normalizarIdPartida(valor: unknown): string | null {
  return uuidONulo(valor)
}

/** ¿La partida lleva clave de idempotencia? Sólo entonces una falla ambigua se puede reintentar. */
export function tieneClave(partida: { idPartida?: unknown } | null | undefined): boolean {
  return normalizarIdPartida(partida?.idPartida) !== null
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
 * dispositivo; desde el 31/oct, `idPartida`, la clave de idempotencia de la
 * pelea (el `id` del resultado). Los dos son OPCIONALES: un celular con la
 * página de antes no los manda y la server action lo sigue aceptando
 * (Known Risk #38).
 */
export type PartidaAGuardar = PartidaParaGuardar & { dispositivo?: string | null; idPartida?: string | null }

/** Rechazo por el tope del rate limit: pasó ANTES de insertar, así que no se guardó nada. */
export interface RechazoPorTope {
  ok: false
  error: string
  motivo: 'tope'
  /** Segundos hasta que se libera el cupo (lo que tarda en terminar la ventana). */
  esperarSeg: number
}

/**
 * Rechazo de lo que mandó el celular, ANTES de tocar la base (no se guardó
 * nada): `'apodo'`, el apodo no pasó `validarApodo` (con otro, o como
 * «Anónimo», se guarda); `'datos'`, la partida no es válida (mandarla de
 * nuevo no sirve: se rechaza siempre).
 */
export interface RechazoPorDatos {
  ok: false
  error: string
  motivo: 'apodo' | 'datos'
  esperarSeg?: undefined
}

/**
 * La respuesta de guardarPartidaJuego. La forma de siempre ({ ok, puesto } o
 * { ok, error }) con campos nuevos y opcionales que la página de antes ignora
 * (Known Risk #38): `motivo` y `esperarSeg` en los rechazos, y `apodo` en la
 * guardada (con qué apodo quedó: si la pelea ya estaba guardada, el de esa
 * fila). Un `{ ok: false }` sin `motivo` es una falla que NO dice si se
 * guardó (la base, un timeout).
 */
export type RespuestaGuardado =
  | { ok: true; puesto: number | null; apodo?: string }
  | { ok: false; error: string; motivo?: undefined; esperarSeg?: undefined }
  | RechazoPorTope
  | RechazoPorDatos

/**
 * ¿El servidor la frenó por el tope? Pasó ANTES del insert: reintentarla no
 * puede duplicarla, con clave o sin ella.
 */
export function esRechazoPorTope(r: RespuestaGuardado | null | undefined): r is RechazoPorTope {
  return !!r && r.ok === false && r.motivo === 'tope'
}

/** ¿El servidor rechazó el apodo? Pasó antes de tocar la base: con otro apodo (o «Anónimo») se guarda. */
export function esRechazoPorApodo(r: RespuestaGuardado | null | undefined): r is RechazoPorDatos {
  return !!r && r.ok === false && r.motivo === 'apodo'
}

/** ¿La partida no es válida? Mandarla de nuevo no sirve: el servidor la va a rechazar siempre. */
export function esRechazoPorDatos(r: RespuestaGuardado | null | undefined): r is RechazoPorDatos {
  return !!r && r.ok === false && r.motivo === 'datos'
}

/**
 * ¿Una falla que no dice si la partida se guardó? null es la red (el pedido
 * tiró: sin conexión, el servidor no contestó); un `{ ok: false }` sin un
 * `motivo` conocido es un error de la base o un timeout, que puede llegar
 * DESPUÉS del insert. Reintentarla sólo es seguro con clave (`tieneClave`).
 */
export function pudoHaberseGuardado(r: RespuestaGuardado | null | undefined): boolean {
  if (!r) return true
  if (r.ok) return false
  return r.motivo !== 'tope' && r.motivo !== 'apodo' && r.motivo !== 'datos'
}
