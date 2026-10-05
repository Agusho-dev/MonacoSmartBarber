/**
 * Recarga por versión: que las pantallas que quedan prendidas todo el día (panel
 * del barbero, kiosko, TV) no sigan corriendo el bundle de un deploy anterior.
 *
 * El problema. Producción tiene Skew Protection: una pantalla abierta antes del
 * deploy sigue pegándole al deployment VIEJO (sus server actions mandan
 * `x-deployment-id`) hasta que vence la ventana, y recién ahí sus server
 * actions empiezan a fallar con "Server Action … was not found" (los ids salen
 * de la clave de cifrado del build, que Next regenera cuando tiene más de 14
 * días o cuando el build no tiene caché). Mientras tanto
 * corre código viejo contra la base de hoy: una regla nueva que vive en el
 * bundle nuevo (la "Mi fila" de Menor espera, el cobro de una asesoría) no
 * llega a la tablet que nadie recarga.
 *
 * Dos piezas:
 *
 * 1. `iniciarRecargaPorVersion(superficie)` (lo monta `RecargaPorVersion`):
 *    pregunta `/api/version` cada ~5 min (con jitter), al volver a la pantalla
 *    y al volver la red. Si el servidor dice otra versión, queda PENDIENTE y
 *    recarga recién cuando la pantalla está ociosa (`motivoParaNoRecargar`):
 *    nunca a mitad de un cobro, de un diálogo, de algo que se está escribiendo
 *    o de fotos subiendo.
 *
 * 2. `esErrorDeVersion(e)` + `avisarYRecargarPorVersion()` para los catch de
 *    los call-sites (check-in, Atender, Cobrar, refresco de la TV): cuando una
 *    server action ya falló por versión, la pantalla no puede seguir: avisa y
 *    recarga (esperando a que terminen de subirse las fotos, si hay).
 *
 * Guardas: nunca más de una recarga por la misma versión objetivo cada 10
 * minutos (sessionStorage; sin sessionStorage, la recarga automática no corre),
 * y apagado si el bundle no tiene versión (desarrollo).
 */
import { toast } from 'sonner'
import { unstable_isUnrecognizedActionError } from 'next/navigation'
import { VERSION_APP } from '@/lib/version-app'

export type SuperficieRecarga = 'panel' | 'kiosko' | 'tv'

/** Para el call-site cuando la guarda no deja recargar sola (ya se recargó hace menos de 10 min). */
export const TEXTO_RECARGA_MANUAL = 'Hay una versión nueva del sistema. Recargá la página para seguir.'

const TEXTO_RECARGANDO = 'Hay una versión nueva del sistema: recargando…'
const ID_AVISO = 'recarga-por-version'

const CLAVE_GUARDA = 'msb.recarga-version.v1'
const CLAVE_PANTALLA_COMPLETA = 'msb.recarga-version.pantalla-completa'

const VENTANA_GUARDA_MS = 10 * 60_000
const INACTIVIDAD_MS = 60_000
const INTERVALO_MS = 5 * 60_000
const JITTER_MS = 60_000
/** Piso entre consultas: foco, visibilidad y red pueden dispararse en ráfaga. */
const ENTRE_CONSULTAS_MS = 30_000
/** Cada cuánto se mira si la pantalla ya está ociosa mientras hay una versión pendiente. */
const REVISION_OCIOSA_MS = 15_000
const TIMEOUT_CONSULTA_MS = 8_000
/** Cuánto se espera a que terminen de subirse las fotos antes de recargar igual. */
const ESPERA_FOTOS_MAX_MS = 5 * 60_000
/** Pausa para que el aviso se alcance a leer antes de recargar. */
const PAUSA_AVISO_MS = 1_200

/**
 * Lo que se considera "algo abierto": cualquier diálogo, hoja o alerta. Un
 * overlay que sólo muestra estado del servidor (lo vuelve a dibujar igual
 * después de recargar) puede marcarse con `data-recarga-permitida` para no
 * frenar la recarga.
 */
const SELECTOR_DIALOGO =
  '[role="dialog"]:not([data-recarga-permitida]), [role="alertdialog"]:not([data-recarga-permitida])'

/**
 * Un aviso de sonner que ofrece una acción ("Reintentar") es trabajo pendiente:
 * recargar lo haría desaparecer y con él la única forma de reintentar.
 */
const SELECTOR_AVISO_CON_ACCION = '[data-sonner-toast]:not([data-removed="true"]) [data-button]'

const TIPOS_SIN_ESCRITURA = new Set(['button', 'submit', 'reset', 'image', 'hidden'])

// ─── Detección de errores de versión ────────────────────────────────────────

/**
 * ¿La server action falló porque este bundle quedó viejo? Misma detección que
 * `esVersionDesactualizada` (src/lib/fotos-corte/subida.ts), duplicada a
 * propósito para no depender de ese módulo.
 */
export function esErrorDeVersion(e: unknown): boolean {
  try {
    if (unstable_isUnrecognizedActionError(e)) return true
  } catch {
    // La API es inestable (y en el servidor tira): si cambia, el texto alcanza.
  }
  const mensaje = e instanceof Error ? e.message : String(e ?? '')
  return /server action .* was not found|failed to find server action/i.test(mensaje)
}

// ─── Guarda anti-bucle (sessionStorage) ─────────────────────────────────────

type Guarda = Record<string, number>

/** null = sessionStorage no disponible (navegación privada, sitio bloqueado). */
function leerGuarda(): Guarda | null {
  try {
    const crudo = window.sessionStorage.getItem(CLAVE_GUARDA)
    if (!crudo) return {}
    const valor: unknown = JSON.parse(crudo)
    if (!valor || typeof valor !== 'object') return {}
    const guarda: Guarda = {}
    for (const [clave, en] of Object.entries(valor as Record<string, unknown>)) {
      if (typeof en === 'number' && Number.isFinite(en)) guarda[clave] = en
    }
    return guarda
  } catch {
    return null
  }
}

function escribirGuarda(guarda: Guarda): boolean {
  try {
    window.sessionStorage.setItem(CLAVE_GUARDA, JSON.stringify(guarda))
    return true
  } catch {
    return false
  }
}

function recargaRecientePor(guarda: Guarda, clave: string, ahora: number): boolean {
  const en = guarda[clave]
  return typeof en === 'number' && ahora - en >= 0 && ahora - en < VENTANA_GUARDA_MS
}

/** Anota la recarga (y poda lo vencido). false si no se pudo escribir. */
function anotarRecarga(guarda: Guarda, clave: string, ahora: number): boolean {
  const podada: Guarda = {}
  for (const [k, en] of Object.entries(guarda)) {
    if (ahora - en >= 0 && ahora - en < VENTANA_GUARDA_MS) podada[k] = en
  }
  podada[clave] = ahora
  return escribirGuarda(podada)
}

// ─── Pantalla completa a través de la recarga ───────────────────────────────

/**
 * Recargar saca de la pantalla completa de la API (la del botón del kiosko o
 * del panel en el navegador) y volver a entrar exige un toque. Se anota antes
 * de recargar y se restaura con el primer toque después. La pantalla completa
 * de una app instalada (display-mode) no pasa por acá: sobrevive a la recarga.
 */
function recordarPantallaCompleta() {
  try {
    if (document.fullscreenElement) window.sessionStorage.setItem(CLAVE_PANTALLA_COMPLETA, '1')
  } catch {
    // sin sessionStorage: después de recargar habrá que tocar el botón de pantalla completa
  }
}

let restauracionInstalada = false

function restaurarPantallaCompletaAlTocar() {
  if (restauracionInstalada) return
  let habia = false
  try {
    habia = window.sessionStorage.getItem(CLAVE_PANTALLA_COMPLETA) === '1'
    if (habia) window.sessionStorage.removeItem(CLAVE_PANTALLA_COMPLETA)
  } catch {
    return
  }
  if (!habia || !document.fullscreenEnabled) return
  restauracionInstalada = true
  const alTocar = () => {
    window.removeEventListener('click', alTocar, true)
    window.removeEventListener('keydown', alTocar, true)
    if (document.fullscreenElement) return
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch((e: unknown) => {
      console.warn('[version] no se pudo volver a pantalla completa:', e)
    })
  }
  // click/keydown: los dos dan la "activación de usuario" que requestFullscreen exige.
  window.addEventListener('click', alTocar, true)
  window.addEventListener('keydown', alTocar, true)
}

// ─── Recarga ─────────────────────────────────────────────────────────────────

/**
 * Recarga si la guarda lo permite. `exigirGuarda`: sin sessionStorage no hay
 * forma de cortar un bucle entre recargas, así que la recarga AUTOMÁTICA no
 * corre; la que pide un call-site después de una action fallida sí (cada una
 * necesita que alguien toque algo: no puede entrar en bucle sola).
 */
function recargarConGuarda(clave: string, exigirGuarda: boolean): boolean {
  const ahora = Date.now()
  const guarda = leerGuarda()
  if (guarda === null) {
    if (exigirGuarda) return false
  } else {
    if (recargaRecientePor(guarda, clave, ahora)) return false
    if (!anotarRecarga(guarda, clave, ahora) && exigirGuarda) return false
  }
  recordarPantallaCompleta()
  console.info('[version] recargando', { desde: VERSION_APP || '(sin versión)', motivo: clave })
  window.location.reload()
  return true
}

function hayFotosSubiendo(): boolean {
  return document.documentElement.dataset.subiendoFotos === 'true'
}

const pausa = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

let recargaProgramada = false

/**
 * Para el catch de un call-site cuyo server action falló con `esErrorDeVersion`:
 * avisa ("Hay una versión nueva del sistema: recargando…") y recarga.
 *
 * Antes de recargar espera (hasta 5 min) a que terminen de subirse las fotos
 * del corte —van por Route Handler y siguen funcionando aunque las actions no—
 * y a que haya red. No mira diálogos ni inactividad: la pantalla ya no puede
 * completar lo que se estaba haciendo.
 *
 * Devuelve true si va a recargar (el call-site no muestra su propio error) y
 * false si la guarda no lo deja (ya se recargó por esto hace menos de 10 min):
 * ahí el call-site muestra su error, por ejemplo con `TEXTO_RECARGA_MANUAL`.
 * Llamarla varias veces seguidas muestra un solo aviso y recarga una vez.
 */
export function avisarYRecargarPorVersion(): boolean {
  if (typeof window === 'undefined') return false
  if (recargaProgramada) return true

  const clave = `accion:${VERSION_APP || 'sin-version'}`
  const guarda = leerGuarda()
  if (guarda && recargaRecientePor(guarda, clave, Date.now())) {
    console.warn('[version] la acción sigue fallando por versión y ya se recargó hace menos de 10 min')
    return false
  }

  recargaProgramada = true
  toast.loading(TEXTO_RECARGANDO, { id: ID_AVISO, duration: Infinity })

  void (async () => {
    const desde = Date.now()
    let avisoFotos = false
    // Fotos subiendo (con tope) y sin red (sin tope: recargar sin red deja la
    // pantalla en la página de error del navegador).
    while (
      (hayFotosSubiendo() && Date.now() - desde < ESPERA_FOTOS_MAX_MS) ||
      navigator.onLine === false
    ) {
      if (hayFotosSubiendo() && !avisoFotos) {
        avisoFotos = true
        toast.loading(TEXTO_RECARGANDO, {
          id: ID_AVISO,
          duration: Infinity,
          description: 'Primero terminan de subirse las fotos.',
        })
      }
      await pausa(1_000)
    }
    await pausa(PAUSA_AVISO_MS)
    if (!recargarConGuarda(clave, false)) {
      recargaProgramada = false
      toast.error(TEXTO_RECARGA_MANUAL, { id: ID_AVISO, duration: 10_000 })
      return
    }
    // Si el navegador frenó la recarga (por ejemplo, el aviso de "¿Salir del
    // sitio?" con fotos pendientes y el barbero eligió quedarse), se libera
    // para que un próximo fallo lo vuelva a intentar (la guarda decide).
    await pausa(10_000)
    recargaProgramada = false
    toast.dismiss(ID_AVISO)
  })()

  return true
}

// ─── Motor de la recarga en reposo ──────────────────────────────────────────

/**
 * ¿Por qué NO recargar ahora? null = la pantalla está ociosa. La TV siempre lo
 * está (sólo se exige red: sin red la recarga la dejaría en la página de error
 * del navegador, sin nadie que la toque).
 */
function motivoParaNoRecargar(superficie: SuperficieRecarga, ultimaInteraccion: number): string | null {
  if (navigator.onLine === false) return 'sin red'
  if (superficie === 'tv') return null
  if (document.visibilityState !== 'visible') return 'pantalla oculta'
  if (Date.now() - ultimaInteraccion < INACTIVIDAD_MS) return 'en uso'
  const raiz = document.documentElement
  if (hayFotosSubiendo()) return 'fotos subiendo'
  if (superficie === 'kiosko' && raiz.dataset.kioskoEnReposo !== 'true') return 'kiosko fuera de reposo'
  if (document.querySelector(SELECTOR_DIALOGO)) return 'diálogo abierto'
  if (hayCampoEnfocado()) return 'campo enfocado'
  if (document.querySelector(SELECTOR_AVISO_CON_ACCION)) return 'aviso con acción'
  return null
}

function hayCampoEnfocado(): boolean {
  const el = document.activeElement
  if (!el || el === document.body) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !TIPOS_SIN_ESCRITURA.has(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

let fallasDeConsultaAvisadas = 0

/** Versión que sirve producción AHORA, o null si no se pudo saber. */
async function versionDelServidor(): Promise<string | null> {
  const control = new AbortController()
  const corte = window.setTimeout(() => control.abort(), TIMEOUT_CONSULTA_MS)
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: control.signal,
    })
    if (!res.ok) {
      // Una ruta que no responde apaga el mecanismo entero: que se vea, sin
      // llenar la consola (una vez por carga de página alcanza para diagnosticar).
      if (fallasDeConsultaAvisadas++ === 0) console.warn('[version] /api/version respondió', res.status)
      return null
    }
    const cuerpo: unknown = await res.json()
    const version = (cuerpo as { version?: unknown } | null)?.version
    return typeof version === 'string' ? version.trim() : null
  } catch {
    // Sin red o timeout: se vuelve a intentar en la próxima vuelta.
    return null
  } finally {
    window.clearTimeout(corte)
  }
}

let motorActivo = false

/**
 * Arranca la recarga en reposo para esta pantalla. Devuelve la limpieza. Una
 * sola instancia por página: un segundo montaje no hace nada.
 */
export function iniciarRecargaPorVersion(superficie: SuperficieRecarga): () => void {
  if (typeof window === 'undefined') return () => {}
  // Va antes del corte por versión vacía: también restaura después de una
  // recarga pedida por un call-site.
  restaurarPantallaCompletaAlTocar()
  if (!VERSION_APP || motorActivo) return () => {}
  motorActivo = true

  let pendiente: string | null = null
  let ultimaConsulta = 0
  let consultando = false
  let intentando = false
  let ultimaInteraccion = Date.now()
  let temporizador = 0
  let revision = 0
  let detenido = false

  const alInteractuar = () => {
    ultimaInteraccion = Date.now()
  }

  const dejarDeRevisar = () => {
    if (revision) window.clearInterval(revision)
    revision = 0
  }

  const intentarRecargar = async () => {
    if (!pendiente || intentando || detenido) return
    // Guarda antes que nada: si ya se recargó hacia esta versión hace menos de
    // 10 min (o no hay sessionStorage), ni siquiera se pregunta al servidor.
    const guarda = leerGuarda()
    if (guarda === null || recargaRecientePor(guarda, `version:${pendiente}`, Date.now())) return
    if (motivoParaNoRecargar(superficie, ultimaInteraccion)) return
    intentando = true
    try {
      // Confirmación justo antes: que el servidor responda (recargar sin red
      // deja la página de error) y que siga diciendo una versión distinta.
      const version = await versionDelServidor()
      if (detenido || !version) return
      if (version === VERSION_APP) {
        pendiente = null
        dejarDeRevisar()
        return
      }
      pendiente = version
      // El await pudo durar segundos: se vuelve a mirar antes de recargar.
      if (motivoParaNoRecargar(superficie, ultimaInteraccion)) return
      // Si la guarda frena (ya se recargó hacia esta versión hace menos de 10
      // min, o sessionStorage no deja anotar), queda pendiente y se reintenta
      // en la próxima revisión.
      recargarConGuarda(`version:${version}`, true)
    } finally {
      intentando = false
    }
  }

  const revisarSiPendiente = () => {
    if (revision || !pendiente) return
    revision = window.setInterval(() => void intentarRecargar(), REVISION_OCIOSA_MS)
  }

  const consultar = async () => {
    if (consultando || detenido) return
    if (superficie !== 'tv' && document.visibilityState !== 'visible') return
    if (navigator.onLine === false) return
    const ahora = Date.now()
    if (ahora - ultimaConsulta < ENTRE_CONSULTAS_MS) return
    ultimaConsulta = ahora
    consultando = true
    try {
      const version = await versionDelServidor()
      if (detenido || !version) return
      if (version === VERSION_APP) {
        // Por ejemplo, un rollback a la versión que ya corre esta pantalla.
        pendiente = null
        dejarDeRevisar()
        return
      }
      if (pendiente !== version) {
        console.info('[version] hay una versión nueva; se recarga cuando la pantalla esté ociosa', {
          actual: VERSION_APP,
          nueva: version,
          superficie,
        })
      }
      pendiente = version
      revisarSiPendiente()
      void intentarRecargar()
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

  const alVolver = () => {
    if (document.visibilityState === 'visible') void consultar()
  }
  const alVolverLaRed = () => {
    void consultar()
    void intentarRecargar()
  }
  const alMostrarPagina = (e: PageTransitionEvent) => {
    // Restaurada del bfcache: puede ser una página de hace horas.
    if (e.persisted) void consultar()
  }

  const opcionesPasivas: AddEventListenerOptions = { capture: true, passive: true }
  window.addEventListener('pointerdown', alInteractuar, opcionesPasivas)
  window.addEventListener('keydown', alInteractuar, opcionesPasivas)
  window.addEventListener('wheel', alInteractuar, opcionesPasivas)
  document.addEventListener('visibilitychange', alVolver)
  window.addEventListener('focus', alVolver)
  window.addEventListener('online', alVolverLaRed)
  window.addEventListener('pageshow', alMostrarPagina)
  programar()

  return () => {
    detenido = true
    motorActivo = false
    window.clearTimeout(temporizador)
    dejarDeRevisar()
    window.removeEventListener('pointerdown', alInteractuar, opcionesPasivas)
    window.removeEventListener('keydown', alInteractuar, opcionesPasivas)
    window.removeEventListener('wheel', alInteractuar, opcionesPasivas)
    document.removeEventListener('visibilitychange', alVolver)
    window.removeEventListener('focus', alVolver)
    window.removeEventListener('online', alVolverLaRed)
    window.removeEventListener('pageshow', alMostrarPagina)
  }
}
