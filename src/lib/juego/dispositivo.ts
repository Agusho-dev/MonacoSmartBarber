// =============================================================================
// Id de este celular para «Corte Final» (localStorage, `cf.dispositivo.v1`).
//
// Un UUID al azar que se arma la primera vez y viaja con cada partida que se
// guarda, sólo para que el tope del rate limit sea POR JUGADOR cuando no hay
// QR (ver guardado.ts): antes la clave era la IP y todo un local en el mismo
// wifi compartía el cupo. No se guarda en `juego_partidas`, no identifica a
// nadie fuera de este celular y no sirve para saltear nada: la server action
// le suma un techo por IP. Si se borra el storage, se arma otro.
//
// Cada acceso al storage va con try/catch: en modo privado o con el storage
// bloqueado vale lo que dure la pestaña. Sin crypto (nunca pasó en un
// navegador que corre el juego) devuelve null y el servidor usa la IP.
// Sólo se llama desde handlers y efectos (nunca durante el render).
// =============================================================================

const CLAVE = 'cf.dispositivo.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let enMemoria: string | null = null

/** UUID v4 nuevo. `crypto.randomUUID` sólo existe con HTTPS (o localhost): si no, `getRandomValues`. */
function uuidNuevo(): string | null {
  const c = globalThis.crypto
  try {
    if (typeof c?.randomUUID === 'function') return c.randomUUID()
  } catch {
    // Sigue con getRandomValues.
  }
  try {
    if (typeof c?.getRandomValues !== 'function') return null
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // versión 4
    b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  } catch {
    return null
  }
}

/** El id de este celular (lo arma y lo guarda la primera vez). Null sólo sin `window` o sin crypto. */
export function idDispositivo(): string | null {
  if (enMemoria) return enMemoria
  if (typeof window === 'undefined') return null
  let guardado: string | null = null
  try {
    guardado = window.localStorage.getItem(CLAVE)
  } catch {
    guardado = null
  }
  if (guardado && UUID.test(guardado)) {
    enMemoria = guardado.toLowerCase()
    return enMemoria
  }
  const nuevo = uuidNuevo()
  if (!nuevo) return null
  enMemoria = nuevo.toLowerCase()
  try {
    window.localStorage.setItem(CLAVE, enMemoria)
  } catch {
    // Modo privado o storage lleno: vale mientras dure la pestaña.
  }
  return enMemoria
}
