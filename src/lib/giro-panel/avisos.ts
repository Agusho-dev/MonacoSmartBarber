/**
 * Textos y toasts del giro del panel. Viven fuera del store para que el store no
 * dependa de la UI; los usan ControlPantalla y GiroPanelRaiz.
 *
 * Regla de los textos: honestos y con una salida concreta. Cuando el panel no
 * puede girar el teclado del sistema, la salida correcta es la rotación
 * automática de la tablet (Android gira TODO, también en Android 16+, porque esa
 * restricción ignora los pedidos de las apps, no la rotación del usuario). Nunca
 * "Android lo bloquea": deja al barbero sin nada que hacer.
 */
import { toast } from 'sonner'
import type { MotivoSinNativo } from './nucleo'
import type { ResultadoGiro } from './store'

export const SUGERENCIA_ROTACION_AUTOMATICA =
  'Para que también quede derecho, activá la rotación automática de la tablet (Ajustes › Pantalla).'

const EL_PANEL_SIGUE = 'El panel sigue derecho y los montos se cargan con el teclado del panel.'

/** Lo que pasó con "Girar también el teclado", explicado por cada motivo. */
export function avisarResultadoTeclado(motivo: MotivoSinNativo | null): void {
  switch (motivo) {
    case null:
      toast.success('Listo: el teclado también sale derecho', {
        description: 'Android giró toda la pantalla.',
      })
      return
    case 'requiere_pantalla_completa':
      toast.error('No se pudo pasar a pantalla completa', {
        description: 'Sin pantalla completa Chrome no deja girar el teclado. Probá de nuevo.',
      })
      return
    case 'no_soportado':
      toast.error('Este navegador no deja girar el teclado desde el panel', {
        description: `${SUGERENCIA_ROTACION_AUTOMATICA} ${EL_PANEL_SIGUE}`,
        duration: 10_000,
      })
      return
    case 'android_lo_ignora':
      toast.error('Android no aceptó girar el teclado en esta tablet', {
        description: `${SUGERENCIA_ROTACION_AUTOMATICA} ${EL_PANEL_SIGUE}`,
        duration: 10_000,
      })
      return
    default:
      toast.error('No se pudo girar el teclado', {
        description: 'El panel sigue derecho. Probá de nuevo.',
      })
  }
}

/** Confirmación del giro, siempre con "Deshacer": un toque de más no puede dejar la tablet al revés. */
export function avisarGiro(r: ResultadoGiro, deshacer: () => void): void {
  const accion = { label: 'Deshacer', onClick: deshacer }
  if (r.girada) {
    if (!r.persistido) {
      toast.warning('Se dio vuelta, pero esta tablet no deja guardarlo', {
        description: 'Si recargás el panel, vuelve a la orientación normal.',
        action: accion,
      })
      return
    }
    toast.success('Pantalla dada vuelta', {
      description:
        r.modo === 'nativo'
          ? 'Android giró todo, también el teclado. Queda guardado en esta tablet.'
          : 'Queda guardado en esta tablet.',
      action: accion,
    })
    return
  }
  if (!r.persistido) {
    toast.warning('Volvió a la orientación normal, pero esta tablet no deja guardarlo', {
      description: 'Si recargás el panel, se vuelve a dar vuelta.',
      action: accion,
    })
    return
  }
  toast('Orientación normal', { description: 'Queda guardado en esta tablet.', action: accion })
}

export function avisarErrorPantallaCompleta(): void {
  toast.error('No se pudo cambiar la pantalla completa', { description: 'Probá de nuevo.' })
}

/** El sistema empezó a rotar solo hacia el objetivo (store: sistemaGira). */
export function avisarSistemaGira(): void {
  toast.info('Esta tablet ya se acomoda sola', {
    description:
      'Android la pone derecha por su cuenta, así que el panel deja de darla vuelta. Si alguna vez la ves al revés, tocá Pantalla › Dar vuelta 180°.',
    duration: 9_000,
  })
}

// ── Aviso del teclado de Android al revés: una vez por sesión ──────────────

const CLAVE_AVISO_TECLADO = 'msb.panel.giro.aviso-teclado.v1'
let avisoTecladoMostrado = false

function yaSeAvisoTeclado(): boolean {
  if (avisoTecladoMostrado) return true
  try {
    return window.sessionStorage.getItem(CLAVE_AVISO_TECLADO) === '1'
  } catch {
    return false
  }
}

function marcarAvisoTeclado(): void {
  avisoTecladoMostrado = true
  try {
    window.sessionStorage.setItem(CLAVE_AVISO_TECLADO, '1')
  } catch {
    // con el almacenamiento bloqueado alcanza con la variable del módulo
  }
}

/**
 * Al enfocar un campo de texto con el panel girado por CSS: el teclado de Android
 * no gira y sale al revés. Se avisa UNA vez por sesión; si el sistema puede girar
 * de verdad, el aviso trae la acción para hacerlo.
 */
export function avisarTecladoAlReves(opciones: {
  nativoPosible: boolean
  girarTeclado: () => Promise<MotivoSinNativo | null>
}): void {
  if (yaSeAvisoTeclado()) return
  marcarAvisoTeclado()
  if (opciones.nativoPosible) {
    toast('El teclado de Android sale al revés', {
      description: 'Tocá «Girar teclado» y Android da vuelta toda la pantalla (pasa a pantalla completa).',
      duration: 12_000,
      action: {
        label: 'Girar teclado',
        onClick: () => {
          void opciones.girarTeclado().then(avisarResultadoTeclado)
        },
      },
    })
    return
  }
  toast('El teclado de Android sale al revés', {
    description: `${SUGERENCIA_ROTACION_AUTOMATICA} Los montos y las cantidades se cargan con el teclado del panel.`,
    duration: 12_000,
  })
}
