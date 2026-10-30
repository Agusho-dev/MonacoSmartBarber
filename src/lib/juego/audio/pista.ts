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
 */

export const RUTA_PISTA = '/juego/audio/neon-dash.mp3'
/** Segundos del archivo: el bucle va de acá… */
export const BUCLE_INICIO = 0.13871
/** …hasta acá (67,05 s exactos de música entre uno y otro). */
export const BUCLE_FIN = 67.18846

export type EstadoPista = 'sin-pedir' | 'bajando' | 'decodificando' | 'lista' | 'fallo'

interface Carga {
  bytes: Promise<ArrayBuffer | null> | null
  buffer: AudioBuffer | null
  decodificando: Promise<AudioBuffer | null> | null
  estado: EstadoPista
  /** Intentos de bajarla: un corte de red se reintenta (pocas veces), un archivo roto no. */
  intentos: number
}

const MAX_INTENTOS = 3

/** Una sola carga por página: si el audio se destruye y se vuelve a crear, no se baja de nuevo. */
const carga: Carga = { bytes: null, buffer: null, decodificando: null, estado: 'sin-pedir', intentos: 0 }

export function estadoPista(): EstadoPista {
  return carga.estado
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
  carga.estado = 'bajando'
  let opciones: RequestInit = {}
  try {
    // Prioridad baja (Chrome): que no le gane a los sprites ni a las arenas.
    opciones = { priority: 'low' } as RequestInit
  } catch {
    opciones = {}
  }
  const pedido = fetch(RUTA_PISTA, opciones)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
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
