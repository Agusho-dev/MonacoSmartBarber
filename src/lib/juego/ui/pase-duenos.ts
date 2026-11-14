/**
 * El pase de dueños en el celular (localStorage, `cf.duenos.v1`, sólo de este celular).
 *
 * Configuración → «Corte Final» → «Jugar como dueño» abre el juego con `?d=<pase>`
 * (`crearPaseDuenos`, src/lib/actions/juego-config.ts; el formato, en src/lib/juego/pase.ts). Al
 * abrir, el juego:
 *  1. saca el `?d=` de la dirección (no queda en el historial, en un link copiado de la barra ni en
 *     «Compartir»), con `history.replaceState(null, …)` para que el router de Next también se entere;
 *  2. lo valida en el servidor (`validarPaseDuenos`, src/lib/actions/juego.ts): firma, vencimiento
 *     (90 días) y organización;
 *  3. si vale, lo guarda acá. Mientras siga válido, este celular ve y elige a los personajes de los
 *     dueños (`soloDuenos`, personajes.ts): `usePaseDuenos()` da true recién cuando el servidor lo
 *     confirmó en esta visita.
 * Un pase vencido, alterado o de otra organización se borra sin avisar. Si el servidor no pudo
 * revisarlo (sin red, la base), queda guardado y se pregunta de nuevo al entrar a «Elegí tu
 * barbero» (`revisarPase`). Si el `?d=` nuevo no vale, sigue mandando el que ya estaba guardado.
 *
 * Es de la experiencia, no de seguridad: el catálogo entero viaja en el bundle.
 *
 * Cada acceso al storage va con try/catch: en modo privado o con el storage bloqueado, el pase vale
 * lo que dure la pestaña. Sin imports de `@/` (se prueba con Node): la validación llega como
 * parámetro. Sólo se llama desde efectos y handlers (nunca durante el render).
 */
import { useSyncExternalStore } from 'react'

/** Lo que contesta el servidor (`validarPaseDuenos`). `invalido`: no vale y se borra. */
export type RespuestaPaseDuenos = { ok: true; venceEn: number } | { ok: false; invalido: boolean }
export type ValidarPase = (pase: string) => Promise<RespuestaPaseDuenos>

export const CLAVE_PASE = 'cf.duenos.v1'
/** El parámetro del link de «Jugar como dueño». */
export const PARAMETRO_PASE = 'd'
/** Un pase real mide ~170 caracteres (el servidor rechaza más de 400). */
const LARGO_MAXIMO = 400

interface Guardado {
  pase: string
  /** Vencimiento que confirmó el servidor (unix, segundos). */
  vence: number
}

/** Confirmado por el servidor en esta visita. */
let valido = false
/** El `?d=` de esta carga (ya fuera de la dirección), mientras no se sepa si vale. */
let deLaDireccion: string | null = null
let direccionLeida = false
let enVuelo: Promise<boolean> | null = null
/** Si el storage no anda (modo privado), el pase confirmado vive acá. */
let enMemoria: Guardado | null = null
const oyentes = new Set<() => void>()

function avisar(): void {
  oyentes.forEach((f) => f())
}

function marcar(v: boolean): void {
  if (valido === v) return
  valido = v
  avisar()
}

function esPase(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= LARGO_MAXIMO && /^[A-Za-z0-9_.-]+$/.test(v)
}

function leerGuardado(): Guardado | null {
  let texto: string | null
  try {
    texto = window.localStorage.getItem(CLAVE_PASE)
  } catch {
    // Storage bloqueado: lo de esta pestaña.
    return enMemoria
  }
  if (texto === null) return enMemoria
  try {
    const g = JSON.parse(texto) as Partial<Guardado> | null
    if (g && esPase(g.pase) && typeof g.vence === 'number' && Number.isFinite(g.vence)) return { pase: g.pase, vence: g.vence }
  } catch {
    // No es JSON: no sirve.
  }
  // Un JSON roto, tocado a mano o de otra versión no sirve.
  borrar()
  return null
}

function guardar(g: Guardado): void {
  enMemoria = g
  try {
    window.localStorage.setItem(CLAVE_PASE, JSON.stringify(g))
  } catch {
    // Modo privado o storage lleno: vale lo que dure la pestaña.
  }
}

function borrar(): void {
  enMemoria = null
  try {
    window.localStorage.removeItem(CLAVE_PASE)
  } catch {
    // Nada que hacer.
  }
}

/**
 * Saca `?d=` de la dirección (una vez por carga) y lo deja para validar; true si cambió la
 * dirección. Va con `null` de estado: así el `replaceState` parchado de Next le avisa al router (con
 * el estado de Next, el router no se enteraría y su `HistoryUpdater` volvería a escribir la
 * dirección vieja en el próximo cambio).
 */
export function tomarPaseDeLaDireccion(): boolean {
  if (direccionLeida || typeof window === 'undefined') return false
  direccionLeida = true
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(PARAMETRO_PASE)) return false
    const valor = (url.searchParams.get(PARAMETRO_PASE) ?? '').trim()
    url.searchParams.delete(PARAMETRO_PASE)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    if (esPase(valor)) deLaDireccion = valor
    return true
  } catch {
    // Sin URL o sin history: queda lo guardado.
    return false
  }
}

/** Un turno de la cola de tareas (después de todas las microtareas pendientes). */
const otraVuelta = () => new Promise<void>((r) => setTimeout(r, 0))

/** Pregunta al servidor por ese pase. 'si' | 'no' (no vale) | 'nose' (no se pudo revisar). */
async function preguntar(validar: ValidarPase, pase: string): Promise<{ r: 'si'; vence: number } | { r: 'no' | 'nose' }> {
  try {
    const res = await validar(pase)
    if (res.ok && typeof res.venceEn === 'number') return { r: 'si', vence: res.venceEn }
    return { r: !res.ok && res.invalido ? 'no' : 'nose' }
  } catch {
    // Sin red o el servidor no contestó: no dice nada del pase.
    return { r: 'nose' }
  }
}

async function revisar(validar: ValidarPase, ahoraMs: number): Promise<boolean> {
  // El replaceState le manda al router de Next una restauración, que pasa adelante de la server
  // action que esté en vuelo (al abrir, las estadísticas). En Next 16.1 una server action que sale
  // en ese mismo instante se cuelga detrás de la descartada y no se manda nunca (medido en Chrome:
  // el «validar» quedaba sin POST). Con una vuelta de la cola en el medio la restauración ya terminó.
  if (tomarPaseDeLaDireccion()) await otraVuelta()

  // Primero el que trajo el link: si vale, reemplaza al guardado.
  const nuevo = deLaDireccion
  if (nuevo) {
    const r = await preguntar(validar, nuevo)
    if (r.r === 'si') {
      deLaDireccion = null
      guardar({ pase: nuevo, vence: r.vence })
      marcar(true)
      return true
    }
    // Sin respuesta, se vuelve a preguntar más tarde (queda en memoria); si no vale, se descarta y
    // sigue mandando el guardado.
    if (r.r === 'nose') return false
    deLaDireccion = null
  }

  const g = leerGuardado()
  if (!g) return false
  if (g.vence * 1000 <= ahoraMs) {
    borrar()
    return false
  }
  const r = await preguntar(validar, g.pase)
  if (r.r === 'si') {
    if (r.vence !== g.vence) guardar({ pase: g.pase, vence: r.vence })
    marcar(true)
    return true
  }
  if (r.r === 'no') {
    // Sólo si sigue siendo el mismo (otra pestaña pudo guardar uno nuevo en el medio).
    if (leerGuardado()?.pase === g.pase) borrar()
  }
  return false
}

/**
 * Valida el pase del link (`?d=`) o el guardado, y deja la respuesta para `usePaseDuenos`. Sin pase
 * no llama al servidor. Una vez confirmado en esta visita no vuelve a preguntar; si hay una vuelta
 * en marcha, devuelve ésa. `ahoraMs` existe para las pruebas.
 */
export function revisarPase(validar: ValidarPase, ahoraMs: number = Date.now()): Promise<boolean> {
  if (valido) return Promise.resolve(true)
  if (enVuelo) return enVuelo
  const vuelta = revisar(validar, ahoraMs).finally(() => {
    if (enVuelo === vuelta) enVuelo = null
  })
  enVuelo = vuelta
  return vuelta
}

/** ¿Este celular tiene un pase de dueños que el servidor confirmó en esta visita? */
export function hayPaseValido(): boolean {
  return valido
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** true cuando este celular ve a los dueños (el servidor confirmó el pase en esta visita). */
export function usePaseDuenos(): boolean {
  return useSyncExternalStore(suscribir, hayPaseValido, () => false)
}
