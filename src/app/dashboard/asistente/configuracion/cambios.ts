// =============================================================================
// Los cambios que Configurar Tex guarda al tocarlos (profundidad, acceso a
// datos, Modo Pro), sin React: lo que se manda, el cambio optimista y cómo se
// deshace si el servidor dice que no. Lo usa asistente-config-client.tsx y lo
// prueban las suites del scratchpad.
//
// Cada pedido manda SÓLO lo que cambió (el servidor mezcla los dominios con lo
// guardado) y, si falla, se deshace sólo eso y sólo si nadie lo volvió a tocar.
// Antes cada pedido llevaba el mapa entero de dominios, armado con cambios
// todavía sin confirmar, y deshacer uno fallido restauraba el mapa entero:
// pisaba otro cambio que sí se había guardado y la pantalla quedaba distinta
// de la base (decía que Tex no leía Sueldos, un dominio sensible, y sí lo leía).
// =============================================================================

import type { TexConfigVista, TexEsfuerzo } from '@/lib/tex/contrato'

export interface CambioConfig {
  /** Lo que va a `guardarConfigTex`. */
  pedido: { esfuerzo?: TexEsfuerzo; accesoDatos?: Record<string, boolean>; modoPro?: boolean }
  optimista: (c: TexConfigVista) => TexConfigVista
  /** Si el pedido falla: vuelve atrás sólo este cambio, y sólo si sigue puesto. */
  revertir: (c: TexConfigVista) => TexConfigVista
}

export function cambioDeDominio(id: string, encendido: boolean): CambioConfig {
  return {
    pedido: { accesoDatos: { [id]: encendido } },
    optimista: (c) => ({ ...c, accesoDatos: { ...c.accesoDatos, [id]: encendido } }),
    revertir: (c) => (c.accesoDatos[id] === encendido ? { ...c, accesoDatos: { ...c.accesoDatos, [id]: !encendido } } : c),
  }
}

export function cambioDeEsfuerzo(previo: TexEsfuerzo, esfuerzo: TexEsfuerzo): CambioConfig {
  return {
    pedido: { esfuerzo },
    optimista: (c) => ({ ...c, esfuerzo }),
    revertir: (c) => (c.esfuerzo === esfuerzo ? { ...c, esfuerzo: previo } : c),
  }
}

export function cambioDeModoPro(modoPro: boolean): CambioConfig {
  return {
    pedido: { modoPro },
    optimista: (c) => ({ ...c, modoPro }),
    revertir: (c) => (c.modoPro === modoPro ? { ...c, modoPro: !modoPro } : c),
  }
}

/** Lo guardado de verdad, para volver a mostrarlo después de un error. */
export function conLoGuardado(c: TexConfigVista, guardado: TexConfigVista): TexConfigVista {
  return { ...c, esfuerzo: guardado.esfuerzo, accesoDatos: guardado.accesoDatos, modoPro: guardado.modoPro }
}

/**
 * Cuándo volver a leer lo guardado después de un error, y si lo leído se puede
 * mostrar. Las server actions van en fila: un cambio que sale mientras se lee
 * llega a la base DESPUÉS de la lectura, así que lo leído no lo tiene. Mostrarlo
 * igual le volvía a poner a ese interruptor el valor viejo: la pantalla decía
 * que Tex leía un dominio que en la base estaba apagado (o al revés). Entonces
 * esa lectura se descarta y se lee otra vez cuando termina el último pedido.
 */
export interface SincronizadorConfig {
  /** Sale un pedido. */
  empezar: () => void
  /** Terminó un pedido: true si ahora hay que releer (falló alguno y no queda ninguno en vuelo). */
  terminar: (fallo: boolean) => boolean
  /** Llegó la relectura: ¿se puede mostrar? Si salió otro cambio mientras tanto, no (se relee cuando termine). */
  puedeAplicar: () => boolean
}

export function crearSincronizadorConfig(): SincronizadorConfig {
  let enCurso = 0
  let releer = false
  return {
    empezar: () => {
      enCurso++
    },
    terminar: (fallo) => {
      enCurso = Math.max(0, enCurso - 1)
      if (fallo) releer = true
      if (enCurso > 0 || !releer) return false
      releer = false
      return true
    },
    puedeAplicar: () => {
      if (enCurso === 0) return true
      releer = true
      return false
    },
  }
}
