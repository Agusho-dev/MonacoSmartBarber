/**
 * «Neon Dash», la canción de Monaco en versión pixel: la música de fondo del menú y de la pelea.
 * Este módulo sólo la BAJA y la DECODIFICA (una vez por página); la reproduce musica.ts.
 *
 * El MP3 (public/juego/audio/neon-dash.mp3) ya viene armado para el bucle: el tema desde el
 * principio hasta donde arranca su tercera sección (que repite la primera y termina en un
 * fundido), y ahí el empalme cocinado: 10 ms de fundido en el respiro que el tema ya tiene antes
 * de ese compás y, enseguida, una copia del comienzo. Los puntos de bucle caen 100 ms DESPUÉS
 * del ataque de cada lado, sobre audio idéntico, con 300 ms de cola: aunque un navegador
 * decodifique el MP3 corrido unos milisegundos (el retardo del codificador que no todos
 * descuentan), el salto no se oye. Medido con el decodificador de Chrome: corrimiento 0.
 *
 * Sin `window` al importar; sin fetch o sin WebAudio, simplemente no hay pista (la música
 * vuelve a los temas sintetizados).
 *
 * Cuándo se baja: recién con el primer gesto (index.ts → desbloquear) y nunca contra los atlas de
 * una pelea. Mientras una pelea carga sus recursos (ui/precarga.ts → `retenerPista`), la canción
 * espera; si ya se estaba bajando y no llegó a la mitad, se corta y se vuelve a pedir cuando la
 * pelea terminó de cargar (en 3G le sumaba ≈ 5 s a la carga). Ese rato lo cubre el tema
 * sintetizado de reserva de musica.ts.
 */

export const RUTA_PISTA = '/juego/audio/neon-dash.mp3'
/** Segundos del archivo: el bucle va de acá… */
export const BUCLE_INICIO = 0.13871
/** …hasta acá (67,05 s exactos de música entre uno y otro). */
export const BUCLE_FIN = 67.18846

export type EstadoPista = 'sin-pedir' | 'en-espera' | 'bajando' | 'decodificando' | 'lista' | 'fallo'

interface Carga {
  bytes: Promise<ArrayBuffer | null> | null
  buffer: AudioBuffer | null
  decodificando: Promise<AudioBuffer | null> | null
  estado: EstadoPista
  /** Intentos de bajarla: un corte de red se reintenta (pocas veces), un archivo roto no. */
  intentos: number
}

const MAX_INTENTOS = 3
/**
 * Si una pelea empieza a cargar con la canción a medio bajar: por debajo de esta fracción se corta
 * (y se vuelve a pedir después); por encima se deja terminar, porque cortarla tira lo ya bajado.
 */
const TERMINAR_DESDE = 0.5

/** Una sola carga por página: si el audio se destruye y se vuelve a crear, no se baja de nuevo. */
const carga: Carga = { bytes: null, buffer: null, decodificando: null, estado: 'sin-pedir', intentos: 0 }

/** Cargas de pelea en curso: mientras haya alguna, la canción no pide nada. */
let retenciones = 0
/** Los que esperan a que la red quede libre. */
let alLiberar: Array<() => void> = []
/** El pedido de la canción en vuelo (para cederle la red a una pelea que empieza a cargar). */
let enVuelo: { control: AbortController; recibido: number; total: number; cedido: boolean } | null = null

export function estadoPista(): EstadoPista {
  return carga.estado
}

/**
 * Una pelea empieza a cargar sus recursos: la canción le deja la red hasta que se llame a la
 * función que devuelve (una vez, al terminar bien o mal). Ver el encabezado.
 */
export function retenerPista(): () => void {
  retenciones++
  const v = enVuelo
  if (v && !v.cedido && (v.total <= 0 || v.recibido / v.total < TERMINAR_DESDE)) {
    v.cedido = true
    v.control.abort()
  }
  let suelta = false
  return () => {
    if (suelta) return
    suelta = true
    retenciones = Math.max(0, retenciones - 1)
    if (retenciones > 0) return
    const esperando = alLiberar
    alLiberar = []
    for (const f of esperando) f()
  }
}

function redLibre(): Promise<void> {
  if (retenciones === 0) return Promise.resolve()
  return new Promise((listo) => alLiberar.push(listo))
}

/** Los bytes de la canción, cuando la red esté libre (null si falló). */
async function traer(): Promise<ArrayBuffer | null> {
  for (;;) {
    if (retenciones > 0) carga.estado = 'en-espera'
    await redLibre()
    carga.estado = 'bajando'
    const v = { control: new AbortController(), recibido: 0, total: 0, cedido: false }
    enVuelo = v
    try {
      // Prioridad baja (Chrome): que no le gane a los sprites ni a las arenas.
      const r = await fetch(RUTA_PISTA, { priority: 'low', signal: v.control.signal } as RequestInit)
      if (!r.ok) return null
      v.total = Number(r.headers.get('content-length')) || 0
      if (!r.body) return await r.arrayBuffer()
      const lector = r.body.getReader()
      const partes: BlobPart[] = []
      for (;;) {
        const { done, value } = await lector.read()
        if (done) break
        if (value) {
          partes.push(value)
          v.recibido += value.byteLength
        }
      }
      return await new Blob(partes).arrayBuffer()
    } catch {
      // Le cedió la red a una pelea que empezó a cargar: se vuelve a pedir cuando termine.
      if (v.cedido) continue
      return null
    } finally {
      if (enVuelo === v) enVuelo = null
    }
  }
}

/** Empieza a bajar el archivo (una sola vez). No necesita contexto de audio. */
export function bajarPista(): void {
  if (typeof fetch !== 'function') {
    // Sin fetch no hay canción: la música es la sintetizada desde el primer momento.
    carga.estado = 'fallo'
    carga.intentos = MAX_INTENTOS
    return
  }
  if (carga.bytes || carga.intentos >= MAX_INTENTOS) return
  carga.intentos++
  carga.estado = retenciones > 0 ? 'en-espera' : 'bajando'
  const pedido = traer()
    .catch(() => null)
    .then((b) => {
      if (!b || b.byteLength === 0) {
        carga.estado = 'fallo'
        // Sin bytes (red): el próximo pedido lo vuelve a intentar.
        if (carga.bytes === pedido) {
          carga.bytes = null
          carga.decodificando = null
        }
        return null
      }
      return b
    })
  carga.bytes = pedido
}

/** decodeAudioData con promesa o con callbacks (Safari viejo sólo tiene la forma vieja). */
function decodificar(ctx: BaseAudioContext, datos: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((ok, mal) => {
    try {
      const p = ctx.decodeAudioData(datos, ok, mal) as Promise<AudioBuffer> | undefined
      if (p && typeof p.then === 'function') p.then(ok, mal)
    } catch (e) {
      mal(e)
    }
  })
}

/**
 * La pista decodificada, lista para sonar en `ctx` (null si no se pudo). Se decodifica una vez:
 * un AudioBuffer no depende del contexto, así que sirve también para uno nuevo.
 */
export function obtenerPista(ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  if (carga.buffer) return Promise.resolve(carga.buffer)
  if (carga.decodificando) return carga.decodificando
  bajarPista()
  const bytes = carga.bytes ?? Promise.resolve(null)
  const decodificando = bytes.then(async (b) => {
    if (!b) {
      carga.estado = 'fallo'
      if (carga.decodificando === decodificando) carga.decodificando = null
      return null
    }
    carga.estado = 'decodificando'
    try {
      const buffer = await decodificar(ctx, b)
      if (buffer.duration < BUCLE_FIN) throw new Error('pista más corta que el bucle')
      carga.buffer = buffer
      carga.estado = 'lista'
      return buffer
    } catch {
      // Un archivo que no se puede decodificar no se reintenta: queda la música sintetizada.
      carga.estado = 'fallo'
      carga.intentos = MAX_INTENTOS
      return null
    }
  })
  carga.decodificando = decodificando
  return decodificando
}

/** ¿Vale la pena pedirla de nuevo? (falló por red y quedan intentos). */
export function pistaReintentable(): boolean {
  return carga.estado === 'fallo' && carga.buffer === null && carga.intentos < MAX_INTENTOS
}
