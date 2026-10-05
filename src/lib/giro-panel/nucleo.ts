/**
 * Núcleo del giro 180° del panel del barbero (sin React, sin efectos).
 *
 * Hay tablets montadas con el cargador arriba: la pantalla queda al revés y
 * Android no siempre la endereza (rotación automática apagada, o Android 16+ en
 * tablets, que ignora los pedidos de orientación de las apps). El panel la da
 * vuelta por CSS y, cuando se puede, le pide al sistema que la gire de verdad.
 *
 * TODA la decisión sale de UNA regla (`necesitaCss`). La usan el script que
 * corre antes del primer paint (script-pre-paint.ts), el store del cliente
 * (store.ts) y la página offline del service worker (public/sw.js): si cambia
 * acá, cambia en los tres.
 */

/** Clave de localStorage. La preferencia es POR TABLET, no por barbero. */
export const CLAVE_GIRO = 'msb.panel.giro.v1'

export type Orientacion =
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary'

const ORIENTACIONES: readonly string[] = [
  'portrait-primary',
  'portrait-secondary',
  'landscape-primary',
  'landscape-secondary',
]

export function esOrientacion(v: unknown): v is Orientacion {
  return typeof v === 'string' && ORIENTACIONES.includes(v)
}

/** La orientación dada vuelta 180°: primary ↔ secondary en el mismo eje. */
export function opuesta(o: Orientacion): Orientacion {
  return (
    o.endsWith('-primary')
      ? o.replace('-primary', '-secondary')
      : o.replace('-secondary', '-primary')
  ) as Orientacion
}

/**
 * Lo que la tablet recuerda.
 *
 * - `objetivo`: la orientación ABSOLUTA en la que el barbero quiere ver el panel.
 *   No es un booleano "girado": si después alguien prende la rotación automática
 *   y Android ya pone la pantalla derecha, un booleano la daría vuelta otra vez.
 *   `null` = el panel va derecho, y la fila existe sólo para recordar `sinNativo`
 *   (volver a la orientación normal no tiene que olvidar que el bloqueo del
 *   sistema no anda en esta tablet, o el próximo giro lo reintenta en vano).
 * - `sistemaGira`: se detectó que Android rota solo hacia el objetivo (rotación
 *   automática prendida). Mientras esté en true el panel NO compensa por CSS:
 *   si alguien saca la tablet del soporte y la sostiene derecha, la UI tiene que
 *   seguir al sistema, no quedar al revés.
 * - `sinNativo`: por qué no se pudo bloquear la orientación del sistema la última
 *   vez, con la versión del navegador. No se reintenta hasta que cambie la
 *   versión: en Android 16+ el bloqueo queda colgado para siempre.
 */
export interface PreferenciaGiro {
  objetivo: Orientacion | null
  sistemaGira: boolean
  sinNativo: { motivo: MotivoSinNativo; navegador: string } | null
}

export type MotivoSinNativo =
  | 'requiere_pantalla_completa'
  | 'no_soportado'
  | 'android_lo_ignora'
  | 'error'

/**
 * Los motivos que dependen de la tablet y del navegador, no del momento: son los
 * únicos que se guardan. "Sin pantalla completa" o un error suelto pueden andar
 * al toque siguiente; reintentarlos no cuesta nada.
 */
const MOTIVOS_PERSISTENTES: readonly MotivoSinNativo[] = ['no_soportado', 'android_lo_ignora']

export function motivoEsPersistente(m: MotivoSinNativo): boolean {
  return MOTIVOS_PERSISTENTES.includes(m)
}

const MOTIVOS: readonly string[] = ['requiere_pantalla_completa', 'no_soportado', 'android_lo_ignora', 'error']

/**
 * LA regla. El CSS gira la UI si y sólo si la tablet tiene un objetivo, Android
 * no la está girando solo, y la pantalla está HOY en la orientación opuesta.
 *
 * Sin la API de orientación (navegadores viejos) el giro es relativo: si hay
 * objetivo, se gira.
 *
 * Si esto cambia, hay que cambiar también SCRIPT_GIRO_PRE_PAINT y el script de
 * la página offline de public/sw.js.
 */
export function necesitaCss(
  pref: Pick<PreferenciaGiro, 'objetivo' | 'sistemaGira'> | null,
  actual: Orientacion | null,
): boolean {
  if (!pref || !pref.objetivo) return false
  if (pref.sistemaGira) return false
  if (!actual) return true
  return actual === opuesta(pref.objetivo)
}

/**
 * El motivo guardado por el que el bloqueo nativo NO se va a reintentar, o null
 * si vale la pena intentarlo (nunca falló, o el navegador se actualizó desde
 * entonces: una versión nueva de Chrome puede traer el arreglo).
 */
export function nativoDescartado(
  pref: Pick<PreferenciaGiro, 'sinNativo'> | null,
  navegador: string,
): MotivoSinNativo | null {
  const s = pref?.sinNativo
  if (!s || s.navegador !== navegador || !motivoEsPersistente(s.motivo)) return null
  return s.motivo
}

/** Lee la preferencia de la tablet. Nunca tira: un JSON roto es "sin preferencia". */
export function leerPreferencia(): PreferenciaGiro | null {
  try {
    const raw = window.localStorage.getItem(CLAVE_GIRO)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<PreferenciaGiro> | null
    if (!v || typeof v !== 'object') return null
    const sinNativo =
      v.sinNativo &&
      typeof v.sinNativo === 'object' &&
      typeof v.sinNativo.navegador === 'string' &&
      MOTIVOS.includes(v.sinNativo.motivo as string)
        ? (v.sinNativo as PreferenciaGiro['sinNativo'])
        : null
    const objetivo = esOrientacion(v.objetivo) ? v.objetivo : null
    if (!objetivo && !sinNativo) return null
    return { objetivo, sistemaGira: objetivo ? v.sistemaGira === true : false, sinNativo }
  } catch {
    return null
  }
}

/**
 * Guarda (o borra, con null) la preferencia. Devuelve false si el navegador no
 * deja escribir (modo incógnito, almacenamiento bloqueado): el giro vale igual
 * para esta sesión, pero no sobrevive a una recarga.
 */
export function guardarPreferencia(pref: PreferenciaGiro | null): boolean {
  try {
    if (pref && (pref.objetivo || pref.sinNativo)) {
      window.localStorage.setItem(
        CLAVE_GIRO,
        JSON.stringify({ ...pref, guardadoEn: new Date().toISOString() }),
      )
    } else {
      window.localStorage.removeItem(CLAVE_GIRO)
    }
    return true
  } catch {
    return false
  }
}

/** La orientación que reporta el sistema ahora, o null si no hay API. */
export function orientacionActual(): Orientacion | null {
  try {
    const t = window.screen?.orientation?.type
    return esOrientacion(t) ? t : null
  } catch {
    return null
  }
}

/** Versión mayor del navegador, para no reintentar el bloqueo nativo en vano. */
export function versionNavegador(): string {
  try {
    const m = /(?:Chrome|CriOS|Firefox|Version)\/(\d+)/.exec(navigator.userAgent)
    return m ? m[0] : navigator.userAgent.slice(0, 40)
  } catch {
    return 'desconocido'
  }
}

// ── Menús flotantes (Select, DropdownMenu) ─────────────────────────────────
// Viven en <body>, que es el marco REAL de la pantalla: floating-ui mide y ubica
// bien ahí. Con la UI girada, "abajo del botón" para el barbero es "arriba" en la
// pantalla física, así que el wrapper de shadcn les pasa el lado y la alineación
// invertidos y el CSS gira el contenido sobre su centro.

export type Lado = 'top' | 'right' | 'bottom' | 'left'
export type Alineacion = 'start' | 'center' | 'end'

export const LADO_OPUESTO: Record<Lado, Lado> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

export const ALINEACION_OPUESTA: Record<Alineacion, Alineacion> = {
  start: 'end',
  center: 'center',
  end: 'start',
}
