/**
 * Store del giro 180° del panel del barbero: la ÚNICA fuente de verdad del lado
 * cliente. Lo inicia GiroPanelRaiz (useLayoutEffect) y lo leen los hooks de
 * src/hooks/use-giro-panel.ts con useSyncExternalStore.
 *
 * Tres modos, decididos SIEMPRE por la regla de nucleo.ts:
 *   - 'css':    el sistema muestra la pantalla al revés y el panel la da vuelta
 *               por CSS (html[data-giro="css"] + globals.css). Es el camino real.
 *   - 'nativo': Android bloqueó la orientación pedida (pantalla completa + lock).
 *               Gira TODO —teclado, permisos, notificaciones—, pero Chrome lo
 *               suelta al salir de pantalla completa y en cada recarga, y en
 *               Android 16+ con tablets no responde nunca. Es una mejora, no la base.
 *   - 'normal': nada que compensar.
 *
 * Como el modo sale de la regla y no de un historial de acciones, no hay doble
 * giro posible: si Android rota de verdad (por el lock o porque alguien prendió
 * la rotación automática), la regla apaga el CSS; si lo suelta, lo vuelve a prender.
 *
 * Este módulo NO importa React ni sonner: los avisos que dispara el sistema (no
 * un toque) salen por `suscribirAvisosGiro` y los muestra GiroPanelRaiz.
 */
import {
  CLAVE_GIRO,
  guardarPreferencia,
  leerPreferencia,
  motivoEsPersistente,
  nativoDescartado,
  necesitaCss,
  opuesta,
  orientacionActual,
  versionNavegador,
  type MotivoSinNativo,
  type Orientacion,
  type PreferenciaGiro,
} from './nucleo'

export type ModoGiro = 'normal' | 'css' | 'nativo'

export interface EstadoGiro {
  /** El store ya leyó la preferencia y la orientación (después de hidratar). */
  listo: boolean
  modo: ModoGiro
  preferencia: PreferenciaGiro | null
  actual: Orientacion | null
  /** Hay un pedido de bloqueo nativo en curso (hasta ESPERA_LOCK_MS). */
  bloqueando: boolean
  /** Por qué no se pudo girar el sistema la última vez (o el guardado para esta versión del navegador). */
  motivoSinNativo: MotivoSinNativo | null
  /** Vale la pena ofrecer "Girar también el teclado". */
  nativoPosible: boolean
  pantallaCompleta: boolean
  /** La app instalada ya corre a pantalla completa (display-mode fullscreen): no hay nada que prender. */
  pantallaCompletaDeApp: boolean
  /** El navegador deja pedir pantalla completa. */
  pantallaCompletaPosible: boolean
  /** La última preferencia que eligió el barbero se pudo guardar en la tablet. */
  persistido: boolean
}

/** Lo que el sistema hizo por su cuenta y el barbero tiene que enterarse. */
export type AvisoGiro = { tipo: 'sistema_gira' }

type Animacion = false | 'horario' | 'antihorario'

// TS 5.9 no declara ScreenOrientation.lock() (sólo unlock()).
type OrientacionConLock = ScreenOrientation & { lock?: (o: Orientacion) => Promise<void> }

/** En Android 16+ con tablets, lock() queda pendiente para siempre: se corta acá. */
const ESPERA_LOCK_MS = 1200
/** lock() resolvió pero screen.orientation.type todavía no se enteró. */
const ESPERA_CONFIRMACION_MS = 600
/** Un 'change' dentro de esta ventana después de un lock()/unlock() es nuestro, no del sistema. */
const GRACIA_MOVIMIENTO_PROPIO_MS = 2500
/** Cuánto esperar al arrancar antes de concluir que Android ya rota solo. */
const ESPERA_SISTEMA_GIRA_MS = 2500

const INICIAL: EstadoGiro = {
  listo: false,
  modo: 'normal',
  preferencia: null,
  actual: null,
  bloqueando: false,
  motivoSinNativo: null,
  nativoPosible: false,
  pantallaCompleta: false,
  pantallaCompletaDeApp: false,
  pantallaCompletaPosible: false,
  persistido: true,
}

let estado: EstadoGiro = INICIAL
const oyentes = new Set<() => void>()
const oyentesAvisos = new Set<(a: AvisoGiro) => void>()
let lockActivo = false
let intento: Promise<MotivoSinNativo | null> | null = null
let ultimoMovimientoPropio = 0
let animacionVigente = 0

// ── Suscripción (useSyncExternalStore) ──────────────────────────────────────

export function suscribirGiro(f: () => void): () => void {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}
export const leerGiro = (): EstadoGiro => estado
export const leerGiroServidor = (): EstadoGiro => INICIAL
/** Para los wrappers de shadcn y las cámaras: sólo importa si el panel está girado por CSS. */
export const esModoCss = (): boolean => estado.modo === 'css'

export function suscribirAvisosGiro(f: (a: AvisoGiro) => void): () => void {
  oyentesAvisos.add(f)
  return () => {
    oyentesAvisos.delete(f)
  }
}

function set(parcial: Partial<EstadoGiro>) {
  const claves = Object.keys(parcial) as (keyof EstadoGiro)[]
  if (!claves.some((k) => !Object.is(estado[k], parcial[k]))) return
  estado = { ...estado, ...parcial }
  oyentes.forEach((f) => f())
}

function avisar(a: AvisoGiro) {
  oyentesAvisos.forEach((f) => {
    try {
      f(a)
    } catch (e) {
      console.error('[giro] aviso:', e)
    }
  })
}

// ── Entorno ─────────────────────────────────────────────────────────────────

function orientacion(): OrientacionConLock | undefined {
  try {
    return (window.screen?.orientation as OrientacionConLock | undefined) ?? undefined
  } catch {
    return undefined
  }
}
function pantallaCompletaDeApp(): boolean {
  try {
    return window.matchMedia('(display-mode: fullscreen)').matches
  } catch {
    return false
  }
}
/** El lock exige pantalla completa: la de la API o la de una app instalada en display-mode fullscreen. */
function enPantallaCompleta(): boolean {
  return !!document.fullscreenElement || pantallaCompletaDeApp()
}
function reducirMovimiento(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}
const soportaBloqueo = (): boolean => typeof orientacion()?.lock === 'function'

function calcularNativoPosible(
  pref: PreferenciaGiro | null,
  motivoSesion: MotivoSinNativo | null = estado.motivoSinNativo,
): boolean {
  if (!soportaBloqueo()) return false
  if (!document.fullscreenEnabled && !pantallaCompletaDeApp()) return false
  if (motivoSesion && motivoEsPersistente(motivoSesion)) return false
  return nativoDescartado(pref, versionNavegador()) === null
}

function calcularModo(pref: PreferenciaGiro | null, actual: Orientacion | null): ModoGiro {
  if (necesitaCss(pref, actual)) return 'css'
  // Con el lock todavía pendiente, Android ya puede haber girado: el 'change' llega
  // antes de que lock() resuelva. Ese giro es nuestro, no un "normal" de paso.
  if (pref?.objetivo && (lockActivo || intento !== null) && actual === pref.objetivo) return 'nativo'
  return 'normal'
}

// ── Pintado: la ÚNICA función que escribe data-giro en <html> ────────────────

function pintar(animar: Animacion) {
  const d = document.documentElement
  const objetivo = estado.preferencia?.objetivo ?? null
  if (objetivo) d.setAttribute('data-giro-objetivo', objetivo)
  else d.removeAttribute('data-giro-objetivo')

  if ((d.getAttribute('data-giro') === 'css') === (estado.modo === 'css')) return

  // Lee el estado deseado AL EJECUTARSE, no al armarse: dentro de una View
  // Transition corre un cuadro después, y si en ese cuadro el modo volvió a
  // cambiar (un 'change' del sistema), aplicar el valor viejo dejaría la UI mal.
  const aplicar = () => {
    const css = estado.modo === 'css'
    const antes = d.getAttribute('data-giro') === 'css'
    if (antes === css) return
    // El scroll cambia de dueño: en modo CSS scrollea #giro-scroll y el documento
    // queda quieto; en modo normal, al revés. Se lleva la posición de uno al otro
    // para que girar no te mande al principio de la fila.
    const scroller = document.getElementById('giro-scroll')
    const y = antes ? (scroller?.scrollTop ?? 0) : window.scrollY
    if (css) d.setAttribute('data-giro', 'css')
    else d.removeAttribute('data-giro')
    if (css) scroller?.scrollTo({ top: y, behavior: 'instant' })
    else window.scrollTo({ top: y, behavior: 'instant' })
  }

  const puedeAnimar =
    animar &&
    !reducirMovimiento() &&
    document.visibilityState === 'visible' &&
    typeof document.startViewTransition === 'function'
  if (!puedeAnimar) {
    aplicar()
    return
  }
  // El snapshot nuevo es el viejo girado 180°: arrancarlo en ±180° hace que la
  // animación sea continua (globals.css, html[data-giro-anim]). Si el navegador
  // saltea la transición (pestaña oculta, otra en curso), el DOM se actualiza igual.
  const token = ++animacionVigente
  d.setAttribute('data-giro-anim', animar)
  try {
    const vt = document.startViewTransition(aplicar)
    vt.ready.catch(() => {})
    vt.updateCallbackDone.catch(() => {})
    vt.finished
      .catch(() => {})
      .finally(() => {
        if (token === animacionVigente) d.removeAttribute('data-giro-anim')
      })
  } catch {
    d.removeAttribute('data-giro-anim')
    aplicar()
  }
}

/** Relee el entorno, recalcula el modo y pinta. */
function sincronizar(animar: Animacion = false) {
  if (typeof window === 'undefined') return
  const actual = orientacionActual()
  const pref = estado.preferencia
  // Chrome suelta el bloqueo al salir de pantalla completa y en cada recarga: si la
  // orientación ya no es la pedida, el bloqueo ya no existe.
  if (lockActivo && (!pref?.objetivo || actual !== pref.objetivo)) lockActivo = false
  const modo = calcularModo(pref, actual)
  if (modo !== estado.modo && estado.listo) console.info('[giro] modo', estado.modo, '→', modo, { actual, objetivo: pref?.objetivo ?? null })
  set({
    actual,
    modo,
    pantallaCompleta: enPantallaCompleta(),
    pantallaCompletaDeApp: pantallaCompletaDeApp(),
    pantallaCompletaPosible: document.fullscreenEnabled === true,
    nativoPosible: calcularNativoPosible(pref),
  })
  pintar(animar)
}

// ── Bloqueo nativo ──────────────────────────────────────────────────────────

function motivoDeError(e: unknown): MotivoSinNativo {
  const nombre = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (nombre === 'SecurityError') return 'requiere_pantalla_completa'
  if (nombre === 'NotSupportedError') return 'no_soportado'
  return 'error'
}

/** Guarda el motivo. Sólo los que dependen de la tablet sobreviven a la recarga. */
function registrarFallo(motivo: MotivoSinNativo): MotivoSinNativo {
  let pref = estado.preferencia
  if (motivoEsPersistente(motivo)) {
    pref = {
      objetivo: pref?.objetivo ?? null,
      sistemaGira: pref?.sistemaGira ?? false,
      sinNativo: { motivo, navegador: versionNavegador() },
    }
    // Si no se puede guardar, igual vale para esta sesión (motivoSinNativo en memoria).
    guardarPreferencia(pref)
  }
  set({ motivoSinNativo: motivo, preferencia: pref, nativoPosible: calcularNativoPosible(pref, motivo) })
  return motivo
}

function soltarBloqueo() {
  if (!lockActivo) return
  ultimoMovimientoPropio = Date.now()
  try {
    orientacion()?.unlock()
  } catch {
    // nada que soltar
  }
  lockActivo = false
}

/** lock() puede resolver un instante antes de que `type` se actualice: se espera el 'change'. */
function confirmarOrientacion(objetivo: Orientacion): Promise<boolean> {
  if (orientacionActual() === objetivo) return Promise.resolve(true)
  return new Promise((resolve) => {
    const so = orientacion()
    const alCambiar = () => {
      if (orientacionActual() === objetivo) fin(true)
    }
    const limite = window.setTimeout(() => fin(orientacionActual() === objetivo), ESPERA_CONFIRMACION_MS)
    function fin(ok: boolean) {
      window.clearTimeout(limite)
      so?.removeEventListener('change', alCambiar)
      resolve(ok)
    }
    so?.addEventListener('change', alCambiar)
  })
}

/**
 * Pide al sistema la orientación objetivo. Un solo intento en curso (dos pedidos
 * simultáneos —fullscreenchange y el botón— comparten la misma promesa y nunca se
 * cancelan entre sí). Si no se confirma en ESPERA_LOCK_MS, se suelta y manda el
 * CSS. Devuelve null si Android giró, o el motivo por el que no.
 */
function intentarNativo(animarSiFalla: Animacion = false): Promise<MotivoSinNativo | null> {
  if (intento) return intento
  const so = orientacion()
  const objetivo = estado.preferencia?.objetivo ?? null
  if (!objetivo) return Promise.resolve(null)
  if (!so || typeof so.lock !== 'function') return Promise.resolve(registrarFallo('no_soportado'))
  if (!enPantallaCompleta()) return Promise.resolve(registrarFallo('requiere_pantalla_completa'))
  const descartado = nativoDescartado(estado.preferencia, versionNavegador())
  if (descartado) return Promise.resolve(descartado)

  const lock = so.lock.bind(so)
  set({ bloqueando: true })
  ultimoMovimientoPropio = Date.now()
  intento = new Promise<MotivoSinNativo | null>((resolve) => {
    const limite = window.setTimeout(() => resolve('android_lo_ignora'), ESPERA_LOCK_MS)
    lock(objetivo).then(
      () => {
        window.clearTimeout(limite)
        void confirmarOrientacion(objetivo).then((ok) => resolve(ok ? null : 'android_lo_ignora'))
      },
      (e: unknown) => {
        window.clearTimeout(limite)
        resolve(motivoDeError(e))
      },
    )
  })
    .then((motivo) => {
      if (!motivo && estado.preferencia?.objetivo !== objetivo) {
        // El barbero volvió a la orientación normal (o eligió otra) mientras Android
        // giraba: el bloqueo que llegó tarde ya no corresponde y se suelta.
        ultimoMovimientoPropio = Date.now()
        try {
          so.unlock()
        } catch {
          // nada que soltar
        }
        lockActivo = false
        return null
      }
      if (motivo) {
        ultimoMovimientoPropio = Date.now()
        try {
          so.unlock()
        } catch {
          // nada que soltar
        }
        lockActivo = false
        registrarFallo(motivo)
        console.info('[giro] sin bloqueo nativo:', motivo)
      } else {
        lockActivo = true
        set({ motivoSinNativo: null })
      }
      return motivo
    })
    .finally(() => {
      intento = null
      set({ bloqueando: false })
      sincronizar(animarSiFalla)
    })
  return intento
}

// ── Eventos del sistema ─────────────────────────────────────────────────────

let huboCambioDeOrientacion = false

function movimientoPropio(): boolean {
  return lockActivo || intento !== null || Date.now() - ultimoMovimientoPropio < GRACIA_MOVIMIENTO_PROPIO_MS
}

/**
 * Android puso la pantalla en el objetivo SIN que se lo pidiéramos: la rotación
 * automática está prendida (o el sistema quedó fijo a 180°). Desde ahora manda
 * el sistema: si alguien saca la tablet del soporte y la sostiene derecha, la UI
 * tiene que seguirlo y no quedar al revés para quien la tiene en la mano.
 * Tocar "Dar vuelta" otra vez arma una preferencia nueva y lo resetea.
 */
function marcarSistemaGira() {
  const pref = estado.preferencia
  if (!pref?.objetivo || pref.sistemaGira) return
  const nueva: PreferenciaGiro = { ...pref, sistemaGira: true }
  const persistido = guardarPreferencia(nueva)
  set({ preferencia: nueva, persistido })
  console.info('[giro] Android rota solo: se deja de compensar')
  avisar({ tipo: 'sistema_gira' })
}

function alCambiarOrientacion() {
  huboCambioDeOrientacion = true
  const pref = estado.preferencia
  const antes = estado.actual
  const actual = orientacionActual()
  if (
    pref?.objetivo &&
    !pref.sistemaGira &&
    actual === pref.objetivo &&
    antes !== pref.objetivo &&
    !movimientoPropio()
  ) {
    marcarSistemaGira()
  }
  // 180° no dispara 'resize': este evento es la única señal de que la tablet giró.
  sincronizar(false)
}

function alCambiarPantallaCompleta() {
  sincronizar(false)
  // Recién en pantalla completa Chrome acepta el lock: se intenta solo, sin gesto.
  // Si Android gira, la regla apaga el CSS; si no, no cambia nada a la vista.
  if (estado.modo === 'css' && enPantallaCompleta() && estado.nativoPosible) void intentarNativo()
}

function alCambiarVisibilidad() {
  if (document.visibilityState === 'visible') sincronizar(false)
}

function alCambiarStorage(e: StorageEvent) {
  // Otra pestaña del panel en la misma tablet cambió la preferencia.
  if (e.key !== CLAVE_GIRO && e.key !== null) return
  set({ preferencia: leerPreferencia() })
  sincronizar(false)
}

function alCambiarModoDeApp() {
  sincronizar(false)
}

/** Lo llama GiroPanelRaiz en useLayoutEffect; devuelve la limpieza. */
export function iniciarGiro(): () => void {
  if (typeof window === 'undefined') return () => {}
  huboCambioDeOrientacion = false
  const pref = leerPreferencia()
  set({
    preferencia: pref,
    persistido: true,
    motivoSinNativo: nativoDescartado(pref, versionNavegador()),
  })
  sincronizar(false) // normalmente coincide con lo que dejó el script pre-paint
  set({ listo: true })
  // Para diagnosticar una tablet por chrome://inspect sin ensuciar la consola de las que no giran.
  if (pref) console.info('[giro] arranque', { modo: estado.modo, actual: estado.actual, preferencia: pref })

  const so = orientacion()
  so?.addEventListener('change', alCambiarOrientacion)
  document.addEventListener('fullscreenchange', alCambiarPantallaCompleta)
  document.addEventListener('visibilitychange', alCambiarVisibilidad)
  window.addEventListener('storage', alCambiarStorage)
  let mq: MediaQueryList | null = null
  try {
    mq = window.matchMedia('(display-mode: fullscreen)')
    mq.addEventListener('change', alCambiarModoDeApp)
  } catch {
    mq = null
  }

  // App instalada en display-mode fullscreen: el lock no necesita gesto, pero Chrome
  // lo suelta en cada recarga, así que se vuelve a pedir al arrancar.
  if (estado.modo === 'css' && enPantallaCompleta() && estado.nativoPosible) void intentarNativo()

  // Si al arrancar Android YA muestra el objetivo sin bloqueo nuestro (el lock no
  // sobrevive a una recarga), el sistema rota solo. Se espera un rato antes de
  // concluirlo: una recarga en modo nativo suelta el lock y la pantalla tarda en
  // volver, y en ese caso llega un 'change' que cancela esta conclusión.
  const objetivoAlArrancar = estado.preferencia?.objetivo ?? null
  const arrancoEnObjetivo =
    !!objetivoAlArrancar && !estado.preferencia?.sistemaGira && estado.actual === objetivoAlArrancar
  const chequeo = arrancoEnObjetivo
    ? window.setTimeout(() => {
        const p = estado.preferencia
        if (
          !huboCambioDeOrientacion &&
          p?.objetivo === objetivoAlArrancar &&
          !p.sistemaGira &&
          orientacionActual() === objetivoAlArrancar &&
          !movimientoPropio()
        ) {
          marcarSistemaGira()
          sincronizar(false)
        }
      }, ESPERA_SISTEMA_GIRA_MS)
    : 0

  return () => {
    if (chequeo) window.clearTimeout(chequeo)
    so?.removeEventListener('change', alCambiarOrientacion)
    document.removeEventListener('fullscreenchange', alCambiarPantallaCompleta)
    document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    window.removeEventListener('storage', alCambiarStorage)
    mq?.removeEventListener('change', alCambiarModoDeApp)
    soltarBloqueo()
    const d = document.documentElement
    d.removeAttribute('data-giro')
    d.removeAttribute('data-giro-objetivo')
    d.removeAttribute('data-giro-anim')
    set(INICIAL)
  }
}

// ── Acciones del barbero ────────────────────────────────────────────────────

export interface ResultadoGiro {
  /** El panel quedó dado vuelta (por CSS o por el sistema). */
  girada: boolean
  /** La preferencia se guardó: sobrevive a la recarga. */
  persistido: boolean
  modo: ModoGiro
}

/**
 * "Dar vuelta 180°" / "Volver a la orientación normal". Decide por lo que el
 * barbero VE: si el panel está compensado (css o nativo), vuelve; si no, gira lo
 * que se ve ahora (el objetivo es la opuesta de la orientación actual).
 */
export async function alternarGiro(): Promise<ResultadoGiro> {
  if (typeof window === 'undefined') return { girada: false, persistido: true, modo: 'normal' }
  const pref = estado.preferencia
  const sinNativo = pref?.sinNativo ?? null

  if (estado.modo !== 'normal') {
    const nueva: PreferenciaGiro | null = sinNativo ? { objetivo: null, sistemaGira: false, sinNativo } : null
    const persistido = guardarPreferencia(nueva)
    soltarBloqueo()
    set({ preferencia: nueva, persistido })
    sincronizar('antihorario')
    return { girada: false, persistido, modo: leerGiro().modo }
  }

  const actual = orientacionActual()
  const objetivo: Orientacion = actual ? opuesta(actual) : 'landscape-secondary'
  const nueva: PreferenciaGiro = { objetivo, sistemaGira: false, sinNativo }
  const persistido = guardarPreferencia(nueva)
  set({ preferencia: nueva, persistido, nativoPosible: calcularNativoPosible(nueva) })

  // Ya en pantalla completa: primero el sistema. Si Android gira de verdad no se
  // suma el giro del CSS (se verían dos animaciones, una encima de la otra).
  if (enPantallaCompleta() && estado.nativoPosible) {
    await intentarNativo('horario')
  } else {
    sincronizar('horario')
  }
  // leerGiro(): el chequeo de arriba hace que TS dé `estado.modo` por 'normal'.
  const { modo } = leerGiro()
  return { girada: modo !== 'normal', persistido, modo }
}

/**
 * "Girar también el teclado": pantalla completa + bloqueo del sistema. Necesita
 * el toque del barbero (requestFullscreen exige un gesto). Si hubo que entrar a
 * pantalla completa sólo para esto y el bloqueo falla, se sale: el pedido no
 * prosperó y la tablet queda como estaba.
 */
export async function girarTeclado(): Promise<MotivoSinNativo | null> {
  if (typeof window === 'undefined') return 'error'
  if (estado.modo !== 'css' || !estado.preferencia?.objetivo) return null
  if (!soportaBloqueo()) return registrarFallo('no_soportado')
  const descartado = nativoDescartado(estado.preferencia, versionNavegador())
  if (descartado) return descartado

  let entramos = false
  if (!enPantallaCompleta()) {
    if (!document.fullscreenEnabled) return registrarFallo('requiere_pantalla_completa')
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      entramos = true
    } catch {
      return registrarFallo('requiere_pantalla_completa')
    }
  }
  const motivo = await intentarNativo()
  if (motivo && entramos && document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      // se queda en pantalla completa: no es un problema
    }
  }
  // "Listo" sólo si el sistema quedó girado de verdad (un intento cancelado a mitad
  // de camino también resuelve sin motivo).
  // (leerGiro() y no `estado`: TS lo daría por 'css' por el chequeo del principio,
  // pero el store cambió durante los await.)
  return motivo ?? (leerGiro().modo === 'nativo' ? null : 'error')
}

/** Entra o sale de pantalla completa. Devuelve false si el navegador no lo dejó. */
export async function alternarPantallaCompleta(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    return true
  } catch (e) {
    console.error('[giro] pantalla completa:', e)
    return false
  } finally {
    sincronizar(false)
  }
}
