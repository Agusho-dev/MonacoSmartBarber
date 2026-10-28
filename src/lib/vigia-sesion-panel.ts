/**
 * Vigía de la sesión del panel del barbero: que el panel no siga mostrando una
 * sesión que el servidor ya no acepta.
 *
 * El problema (Pueyrredón, 28/oct/2026). La cookie `barber_session` dura 14 h
 * (`loginWithPin`) y la tablet queda prendida de un día para el otro con el
 * panel abierto. El panel sigue mostrando la fila —la lee con la anon key y
 * Realtime, que no piden sesión—, pero desde que el navegador borra la cookie
 * TODA server action se queda sin saber quién llama: Atender y Cobrar
 * contestaban «No autorizado para esta sucursal» y los refrescos de cada 30 s
 * devolvían ceros sin avisar. Fran entró con su PIN el 27/oct a las 10:09, la
 * cookie murió a las 00:09, y a la mañana siguiente su tablet parecía andar
 * pero no podía tomar ni cobrar a nadie: los cortes se cobraron desde el
 * dashboard hasta que, pasado el mediodía, volvió a entrar con el PIN. Mientras
 * hubo deploys casi diarios no se veía: la recarga por versión llevaba el panel
 * al PIN de paso.
 *
 * Qué hace. Le pregunta a /api/barbero/sesion si la sesión con la que se dibujó
 * el panel sigue viva: cada ~5 min, al volver a la pantalla o a la red, y con el
 * primer toque después de un minuto quieto (lo primero que se toca en una
 * tablet quieta suele ser «Atender» o «Cobrar»). Si venció —o la cookie ahora
 * es de otro barbero— avisa y recarga: la página vuelve a decidir con la cookie
 * de verdad (sin sesión, al PIN; con la de otro, su panel).
 *
 * Con un diálogo abierto, un campo enfocado o fotos subiendo no recarga: deja el
 * aviso con «Entrar con mi PIN» (se puede tocar con el diálogo abierto, Known
 * Risk #39) y recarga sola apenas se cierra. No espera un minuto sin tocar como
 * la recarga por versión: sin sesión, el panel ya no puede hacer nada.
 *
 * Sin red o con la base caída no hay sesión vencida (Known Risk #11): ante
 * cualquier respuesta que no sea un estado claro, no hace nada. Y nunca recarga
 * sola por la sesión dos veces en 2 minutos (sessionStorage): si después de
 * recargar el servidor sigue diciendo lo mismo, queda el aviso con el botón.
 */
import { toast } from 'sonner'
import {
  hayCampoEnfocado,
  hayDialogoAbierto,
  hayFotosSubiendo,
  recordarPantallaCompleta,
} from '@/lib/recarga-version'

/**
 * Lo que contesta /api/barbero/sesion:
 * - `vigente`: la cookie es válida, del mismo barbero, y el barbero sigue activo.
 * - `vencida`: sin cookie, con una firma que no verifica o con el barbero dado de baja.
 * - `otra`: la cookie es de otro barbero (entró otra persona en esta tablet).
 * - `desconocido`: no se pudo saber (base caída). El panel no hace nada.
 */
export type EstadoSesionPanel = 'vigente' | 'vencida' | 'otra' | 'desconocido'

const ID_AVISO = 'vigia-sesion'
const TITULO_AVISO = 'Se cerró tu sesión'
const TEXTO_AVISO = 'Volvé a entrar con tu PIN para seguir.'

const INTERVALO_MS = 5 * 60_000
const JITTER_MS = 60_000
/** Piso entre consultas: foco, visibilidad, red y toques pueden llegar en ráfaga. */
const ENTRE_CONSULTAS_MS = 30_000
/** Un toque después de este rato sin tocar dispara una consulta. */
const QUIETO_MS = 60_000
/** Con la recarga pendiente, cada cuánto se mira si ya se puede. */
const REVISION_MS = 3_000
const TIMEOUT_CONSULTA_MS = 8_000
/** Para que el aviso se alcance a leer antes de recargar. */
const PAUSA_AVISO_MS = 1_200
/** Si la recarga no pasó (el navegador la frenó), vuelve el aviso con el botón. */
const RECARGA_FRENADA_MS = 10_000

const CLAVE_GUARDA = 'msb.vigia-sesion.v1'
const VENTANA_GUARDA_MS = 2 * 60_000

/** El estado según el servidor; `desconocido` ante cualquier duda. */
async function estadoDelServidor(staffId: string): Promise<EstadoSesionPanel> {
  const control = new AbortController()
  const corte = window.setTimeout(() => control.abort(), TIMEOUT_CONSULTA_MS)
  try {
    const res = await fetch(`/api/barbero/sesion?staff=${encodeURIComponent(staffId)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: control.signal,
    })
    if (!res.ok) return 'desconocido'
    const cuerpo: unknown = await res.json()
    const estado = cuerpo && typeof cuerpo === 'object' ? (cuerpo as { estado?: unknown }).estado : null
    return estado === 'vigente' || estado === 'vencida' || estado === 'otra' ? estado : 'desconocido'
  } catch {
    return 'desconocido'
  } finally {
    window.clearTimeout(corte)
  }
}

/** ¿Ya se recargó sola por la sesión hace menos de 2 min? Sin sessionStorage, sí: sin guarda no recarga sola. */
function recargoHacePoco(): boolean {
  try {
    const en = Number(window.sessionStorage.getItem(CLAVE_GUARDA))
    const ahora = Date.now()
    return en > 0 && ahora - en >= 0 && ahora - en < VENTANA_GUARDA_MS
  } catch {
    return true
  }
}

function anotarRecarga(): void {
  try {
    window.sessionStorage.setItem(CLAVE_GUARDA, String(Date.now()))
  } catch {
    // sin sessionStorage la próxima vez no recarga sola: queda el botón
  }
}

/** Qué está a medio hacer en la pantalla, o null si se puede recargar ya. */
function motivoParaEsperar(): string | null {
  // Sin red, la recarga dejaría la pantalla de error del navegador.
  if (navigator.onLine === false) return 'sin red'
  if (document.visibilityState !== 'visible') return 'pantalla oculta'
  if (hayFotosSubiendo()) return 'fotos subiendo'
  if (hayDialogoAbierto()) return 'diálogo abierto'
  if (hayCampoEnfocado()) return 'campo enfocado'
  return null
}

let activo = false

/**
 * Arranca el vigía para la sesión de `staffId`, la del layout que dibujó el
 * panel. Devuelve la función que lo apaga. Uno solo por página.
 */
export function iniciarVigiaSesion(staffId: string): () => void {
  if (activo) return () => {}
  activo = true

  // El layout acaba de verificar la sesión para dibujar el panel.
  let ultimaConsulta = Date.now()
  let ultimoToque = Date.now()
  let consultando = false
  let motivo: 'vencida' | 'otra' | null = null
  let avisada = false
  let recargando = false
  let temporizador = 0
  let revision = 0
  let detenido = false

  const dejarDeRevisar = () => {
    if (revision) window.clearInterval(revision)
    revision = 0
  }

  // El toque en el botón recarga sin pasar por la guarda: no puede entrar en
  // bucle solo (mismo criterio que «Actualizar» de la recarga por versión).
  const recargar = () => {
    if (recargando) return
    recargando = true
    dejarDeRevisar()
    toast.loading(TITULO_AVISO, {
      id: ID_AVISO,
      description: motivo === 'otra' ? 'Entró otra persona en esta tablet: recargando…' : 'Volviendo a la pantalla del PIN…',
      duration: Infinity,
    })
    recordarPantallaCompleta()
    console.info('[sesion] recargando: el servidor ya no acepta la sesión de este panel', { motivo })
    window.setTimeout(() => window.location.reload(), PAUSA_AVISO_MS)
    window.setTimeout(() => {
      // Seguimos acá: el navegador frenó la recarga (por ejemplo, el aviso de
      // «¿Salir del sitio?» y el barbero eligió quedarse).
      recargando = false
      avisada = false
      avisarConBoton()
    }, PAUSA_AVISO_MS + RECARGA_FRENADA_MS)
  }

  const avisarConBoton = () => {
    if (avisada || detenido) return
    avisada = true
    toast.error(TITULO_AVISO, {
      id: ID_AVISO,
      description: TEXTO_AVISO,
      duration: Infinity,
      action: { label: 'Entrar con mi PIN', onClick: recargar },
    })
  }

  /** Con la sesión cerrada: recarga ya si se puede; si no, aviso con botón y se reintenta. */
  const intentarRecargar = () => {
    if (detenido || !motivo || recargando) return
    if (recargoHacePoco()) {
      // Ya se recargó por esto hace menos de 2 min y el servidor sigue
      // diciendo lo mismo: sin bucles, queda el botón.
      dejarDeRevisar()
      avisarConBoton()
      return
    }
    if (motivoParaEsperar()) {
      avisarConBoton()
      if (!revision) revision = window.setInterval(intentarRecargar, REVISION_MS)
      return
    }
    anotarRecarga()
    recargar()
  }

  const consultar = async () => {
    if (detenido || consultando || motivo) return
    if (document.visibilityState !== 'visible' || navigator.onLine === false) return
    const ahora = Date.now()
    if (ahora - ultimaConsulta < ENTRE_CONSULTAS_MS) return
    ultimaConsulta = ahora
    consultando = true
    try {
      const estado = await estadoDelServidor(staffId)
      if (detenido || (estado !== 'vencida' && estado !== 'otra')) return
      console.warn('[sesion] el servidor ya no acepta la sesión de este panel', { estado })
      motivo = estado
      intentarRecargar()
    } finally {
      consultando = false
    }
  }

  const programar = () => {
    const espera = INTERVALO_MS - JITTER_MS + Math.random() * 2 * JITTER_MS
    temporizador = window.setTimeout(() => {
      void consultar()
      programar()
    }, espera)
  }

  const alTocar = () => {
    const ahora = Date.now()
    const estuvoQuieto = ahora - ultimoToque >= QUIETO_MS
    ultimoToque = ahora
    if (estuvoQuieto) void consultar()
  }
  const alVolver = () => {
    if (document.visibilityState !== 'visible') return
    void consultar()
    intentarRecargar()
  }
  const alVolverLaRed = () => {
    void consultar()
    intentarRecargar()
  }
  const alMostrarPagina = (e: PageTransitionEvent) => {
    // Restaurada del bfcache: puede ser una página de hace horas.
    if (e.persisted) void consultar()
  }

  const opcionesPasivas: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener('pointerdown', alTocar, opcionesPasivas)
  window.addEventListener('keydown', alTocar, opcionesPasivas)
  document.addEventListener('visibilitychange', alVolver)
  window.addEventListener('focus', alVolver)
  window.addEventListener('online', alVolverLaRed)
  window.addEventListener('pageshow', alMostrarPagina)
  programar()

  return () => {
    detenido = true
    activo = false
    window.clearTimeout(temporizador)
    dejarDeRevisar()
    window.removeEventListener('pointerdown', alTocar, opcionesPasivas)
    window.removeEventListener('keydown', alTocar, opcionesPasivas)
    document.removeEventListener('visibilitychange', alVolver)
    window.removeEventListener('focus', alVolver)
    window.removeEventListener('online', alVolverLaRed)
    window.removeEventListener('pageshow', alMostrarPagina)
  }
}
