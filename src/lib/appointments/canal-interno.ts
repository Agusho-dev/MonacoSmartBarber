import 'server-only'
import { randomUUID } from 'node:crypto'

/**
 * Canal interno: la prueba de que una llamada a `createAppointment` viene de
 * OTRO MÓDULO DEL SERVIDOR y no de un POST armado a mano.
 *
 * Por qué existe: `createAppointment` vive en un archivo `'use server'`, así que
 * es un endpoint HTTP con un action-id que viaja en el bundle del cliente
 * (`espera-client.tsx` lo importa directo). Las banderas `viaKiosk` / `viaApp`
 * que saltean el rate-limit por IP eran booleanos del body: cualquiera podía
 * mandar `viaApp: true` y reservar sin límite desde una sola IP, que es
 * exactamente lo que ese gate existe para impedir.
 *
 * El token NO es un booleano ni un string fijo: es un valor aleatorio que se
 * genera al arrancar el proceso, vive sólo en memoria y nunca sale del
 * servidor (`server-only` impide que este módulo entre a un bundle de cliente).
 * Los llamadores legítimos —las rutas de la API mobile, el kiosko y el motor de
 * señas— corren en el MISMO proceso que la action, así que lo obtienen
 * llamando a `canalInterno(...)`; un atacante que POSTea al action-id no tiene
 * de dónde sacarlo. Si el proceso se recicla, el token cambia y los dos lados
 * cambian juntos: nunca hay un secreto que rotar ni que guardar.
 *
 * NO es una autorización: sólo dice "esta llamada nació adentro". Todo lo que
 * es plata o identidad (que la seña esté pagada, que el JWT del cliente sea
 * suyo, los permisos del dashboard) se sigue verificando contra la base.
 */

/** Para qué se pide el salteo. Sirve para leerlo en los logs y para acotar. */
export type ExencionInterna =
  /** Tablet del local: todos los clientes comparten la IP de la tablet. */
  | 'kiosko'
  /** App mobile: ya pasó por rate-limit POR USUARIO y el teléfono sale del JWT. */
  | 'app'
  /** Webhook de Mercado Pago: el pago ya se acreditó; la IP es la de MP. */
  | 'sena_acreditada'

const EXENCIONES: readonly ExencionInterna[] = ['kiosko', 'app', 'sena_acreditada']

/**
 * Secreto del proceso: se calcula una sola vez al cargar el módulo y nunca se
 * persiste. Todos los llamadores legítimos corren en el MISMO proceso que la
 * action, así que no hace falta compartirlo entre instancias (y no compartirlo
 * es justamente lo que lo vuelve infalsificable desde afuera).
 */
const SECRETO_DEL_PROCESO: string = randomUUID()

/** Token a pasar en `createAppointment({ canalInterno: canalInterno('app') })`. */
export function canalInterno(exencion: ExencionInterna): string {
  return `${exencion}.${SECRETO_DEL_PROCESO}`
}

/**
 * Devuelve la exención si el token es de este proceso, o `null` si viene de
 * afuera (o no vino). Comparación de largo constante: el secreto es un UUID v4
 * (122 bits de entropía), pero medir el tiempo de un `===` sobre un secreto no
 * cuesta nada de evitar.
 */
export function leerCanalInterno(token: string | null | undefined): ExencionInterna | null {
  if (!token) return null
  const corte = token.indexOf('.')
  if (corte <= 0) return null

  const exencion = token.slice(0, corte) as ExencionInterna
  if (!EXENCIONES.includes(exencion)) return null

  return igualEnTiempoConstante(token.slice(corte + 1), SECRETO_DEL_PROCESO) ? exencion : null
}

function igualEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}
