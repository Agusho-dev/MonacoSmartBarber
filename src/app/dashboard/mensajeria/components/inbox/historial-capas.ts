'use client'

// Cada capa abierta en el celular (el chat, la info. del contacto, una sección,
// Programados) es una entrada del historial, como una pantalla de iOS o de
// Android: así el «atrás» del sistema (deslizar desde el borde en el iPhone, el
// botón o el gesto de Android, la flecha del navegador) cierra la capa de
// arriba en vez de sacarte de Mensajería, y deslizar desde el borde en la app
// instalada del iPhone ya no corre dos gestos a la vez (el del sistema y el
// nuestro, con tres planos desfasados: 23/oct/2026).
//
// - Abrir una capa empuja UNA entrada; la info. del contacto sobre el chat son
//   dos. Cambiar de conversación con el chat abierto no empuja otra (la capa
//   sigue abierta).
// - Las hojas (Nuevo chat, Programar, las plantillas, la nueva difusión,
//   Configuración y sus pantallas) también son entradas, encima de lo que haya
//   (#/hoja, #/chat/perfil/hoja), pero no corren la lista: entrada-de-hoja.ts.
//   Sin entrada, con una hoja abierta el «atrás» cerraba la capa de abajo y
//   dejaba la hoja sobre la lista, o sacaba de Mensajería.
// - El «atrás» del sistema cierra la de arriba (la cierra quien la registró:
//   deslizar-para-volver.ts). Si el navegador ya animó ese «atrás» (el
//   popstate trae hasUAVisualTransition: el gesto de Android con la vista
//   previa de Chrome), se le avisa para que no la vuelva a animar.
// - Cerrarla por la interfaz («‹», el gesto, archivar…) saca su entrada con un
//   history.go(-n) cuyo popstate se ignora: el «atrás» siguiente sale de
//   Mensajería, como corresponde, y no queda una entrada que no hace nada.
// - Nunca se navega fuera de Mensajería ni se recarga: si la ruta ya no es la
//   de Mensajería (se fue a otra pantalla con una capa abierta) o Mensajería se
//   desmontó, las entradas se dan por perdidas y no se toca el historial.
// - En la compu no hay capas y no hay entradas.
//
// El marcador va en el hash (#/chat, #/chat/perfil): no viaja al servidor, no
// cambia useSearchParams y sobrevive a lo que hace Next con el historial. Next
// 16 (app-router.js) parchea pushState y replaceState: copian su estado (__NA
// y el árbol) a la entrada nueva y le avisan al router de la dirección nueva
// (un ACTION_RESTORE, sin pedirle nada al servidor). Después de una server
// action, un router.refresh() o una navegación, el HistoryUpdater de Next
// reemplaza el estado de la entrada por uno nuevo sin lo nuestro, pero con la
// dirección que conoce el router: la que tiene el hash. Por eso el marcador no
// va en history.state. Y por eso siempre se usan los parcheados: una entrada
// sin __NA hace que Next recargue la página en el popstate, y una dirección
// que el router no conoce vuelve a aparecer (o se empuja de nuevo) en la
// próxima server action.
//
// Dos esperas antes de empujar (de hasta unos 3 s cada una):
// - Hasta que Next parchee el historial (lo hace en un efecto al hidratar):
//   antes, un replaceState no le avisa al router.
// - Mientras la dirección tenga ?clientId= (el deep link: el contexto y
//   DeepLinkHandler abren el chat y lo sacan con router.replace). Un pushState
//   con dirección es una navegación para Next y DESCARTA la que está en curso:
//   la entrada de abajo se quedaba con ?clientId y, al volver, el deep link
//   volvía a abrir el chat.
//
// Este archivo es el núcleo (sin React): crearHistorialDeCapas recibe el
// navegador (Entorno) para poder probarlo solo. Lo usan los hooks de
// deslizar-para-volver.ts a través de montarHistorial y abrirCapa.
//
// También lleva el paralaje de la lista: con una capa encima, la lista de
// chats se corre un 30 % a la izquierda, como la pantalla de abajo en iOS
// (globals.css, «Paralaje de la lista»). Lo decide la capa de más abajo de la
// pila que corre la lista (las hojas no la corren), sin renders: el momento va
// en <html data-wa-paralaje> (cambia pocas
// veces) y el progreso del dedo en --wa-paralaje, en la lista misma
// ([data-wa-lista-paralaje]) y no en <html>: cambia en cada cuadro del gesto, y
// en <html> haría recalcular el estilo de toda la página en cada cuadro (está
// registrada sin herencia: en la lista, sólo se recalcula la lista).

/** Lo que el núcleo necesita del navegador. */
export interface Entorno {
  /** El hash de la dirección, con su '#' ('' si no hay). */
  hash(): string
  /** La ruta, sin búsqueda ni hash. */
  ruta(): string
  /** ¿Next ya parcheó pushState y replaceState? */
  listo(): boolean
  /** ¿La dirección tiene algo que Mensajería está por sacar con router.replace? */
  pendiente(): boolean
  /** Una entrada nueva con este hash (misma ruta y búsqueda). */
  empujar(hash: string): void
  /** La entrada actual con este hash ('' lo saca). */
  reemplazar(hash: string): void
  /** history.go(-n). */
  retroceder(n: number): void
  /**
   * Escucha el popstate; devuelve con qué dejar de escuchar. `yaAnimado`: el
   * navegador ya mostró su propia transición (hasUAVisualTransition).
   */
  oirAtras(f: (yaAnimado: boolean) => void): () => void
  /** Después de lo que se está haciendo (una microtarea). */
  enSeguida(f: () => void): void
  /** Dentro de `ms`; devuelve con qué cancelarlo. */
  despues(f: () => void, ms: number): () => void
  /**
   * El paralaje de la lista (null: sin capa, la lista sin transform).
   * `progreso`: 1 tapada del todo, 0 descubierta (sin él, tapada del todo).
   */
  paralaje(estado: EstadoParalaje | null, progreso?: number): void
}

/**
 * - abierta: tapada por una capa, corrida (la transición de la entrada).
 * - arrastrando: sigue al dedo (sin transición), con el progreso.
 * - volviendo: la capa vuelve a su lugar después de un arrastre corto.
 * - saliendo: la capa termina de irse; la lista vuelve a su lugar.
 */
export type EstadoParalaje = 'abierta' | 'arrastrando' | 'volviendo' | 'saliendo'

/** Una capa registrada, para quien la registró (deslizar-para-volver.ts). */
export interface RegistroDeCapa {
  /** Ya no está abierta: se cerró por la interfaz o por el sistema. */
  quitar(): void
  /** ¿Es la de arriba de todo? Sólo esa toma el gesto de volver. */
  arriba(): boolean
  /**
   * Mueve la lista de abajo, si esta capa es la que la tapa (la de más abajo
   * de la pila de las que corren la lista). `progreso`: 1 tapada del todo, 0
   * descubierta.
   */
  moverLista(estado: EstadoParalaje, progreso?: number): void
}

export interface OpcionesDeCapa {
  /**
   * ¿Corre la lista de abajo (el paralaje)? Las capas sí (default); las hojas
   * no: en iOS una hoja entra desde abajo y la pantalla de abajo no se mueve.
   */
  mueveLista?: boolean
}

export interface HistorialDeCapas {
  /** Una instancia del hook montada (Mensajería está en pantalla). Devuelve el desmontar. */
  montar(): () => void
  /**
   * Una capa que se abre; `cerrar` la cierra cuando el «atrás» del sistema la
   * saca (`yaAnimado`: el navegador ya animó ese «atrás»).
   */
  abrir(nombre: string, cerrar: (yaAnimado: boolean) => void, opciones?: OpcionesDeCapa): RegistroDeCapa
}

const PREFIJO = '#/'
/** Cada cuánto se vuelve a probar si todavía no se puede empujar. */
const REINTENTO_MS = 120
/**
 * Cuántas veces se espera (unos 3 s) al parche de Next y al deep link. Después
 * se sigue igual: Next parchea al hidratar (sin parche no hay router que
 * avisar) y un ?clientId que nadie sacó no es una navegación en curso.
 */
const ESPERAS = 25
/** Si el popstate de un go(-n) propio no llega, se resincroniza con la dirección. */
const SEGURO_MS = 2000

/** Cuántas capas dice el hash: '#/chat/perfil' → 2; sin el marcador → 0. */
export function profundidadDelHash(hash: string): number {
  if (!hash.startsWith(PREFIJO)) return 0
  return hash.slice(PREFIJO.length).split('/').filter(Boolean).length
}

/** El hash de una pila de capas ('' sin capas). */
export function hashDeLaPila(nombres: readonly string[]): string {
  return nombres.length > 0 ? PREFIJO + nombres.join('/') : ''
}

/** El nombre de una capa para el hash: minúsculas, números y guiones ('capa' si no queda nada). */
export function nombreDeCapa(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return limpio || 'capa'
}

interface Capa {
  readonly id: number
  readonly nombre: string
  readonly cerrar: (yaAnimado: boolean) => void
  /** Corre la lista (una capa); una hoja no. */
  readonly mueveLista: boolean
  /** El sistema la está cerrando (con animación, fuera de iOS): ya no tiene entrada. */
  cerrando: boolean
}

export function crearHistorialDeCapas(e: Entorno): HistorialDeCapas {
  let pila: Capa[] = []
  /** Cuántas entradas nuestras hay debajo de la actual, contando la actual. */
  let empujadas = 0
  let montadas = 0
  let encendido = false
  let ruta = ''
  /** Recién montada: lo que diga el hash es de antes (una recarga, volver desde otra pantalla). */
  let fresco = false
  let programado = false
  /** Un go(-n) propio en vuelo (con qué cancelar su seguro). */
  let enVuelo: (() => void) | null = null
  /** Un reintento pendiente (Next sin parchear o el deep link en curso). */
  let espera: (() => void) | null = null
  /** Cuántos reintentos van (hasta ESPERAS). */
  let esperas = 0
  let dejarDeOir: (() => void) | null = null
  let ultimoId = 0

  const vivas = () => pila.filter((c) => !c.cerrando)

  function programar() {
    if (programado) return
    programado = true
    e.enSeguida(reconciliar)
  }

  /** ¿Hay que esperar para tocar el historial? (cuenta el reintento) */
  function esperar(motivo: boolean): boolean {
    if (!motivo || esperas >= ESPERAS) return false
    esperas++
    if (!espera) {
      espera = e.despues(() => {
        espera = null
        reconciliar()
      }, REINTENTO_MS)
    }
    return true
  }

  function retroceder(n: number) {
    enVuelo = e.despues(() => {
      // El popstate no llegó: se cree en la dirección.
      enVuelo = null
      empujadas = profundidadDelHash(e.hash())
      programar()
    }, SEGURO_MS)
    e.retroceder(n)
  }

  // Lleva el historial a la pila: empuja lo que falta, saca lo que sobra.
  function reconciliar() {
    programado = false
    if (!encendido || montadas === 0 || enVuelo) return
    // Se fue de Mensajería (navegó con una capa abierta): esas entradas ya no
    // son nuestras. Nada de volver atrás: sacaría a la persona de donde fue.
    if (e.ruta() !== ruta) {
      empujadas = 0
      return
    }
    const capas = vivas()
    if (fresco) {
      if (esperar(!e.listo())) return
      fresco = false
      empujadas = 0
      esperas = 0
      // Un marcador de antes sin capa abierta (recarga con un chat abierto,
      // volver desde otra pantalla): se saca, la entrada queda como la lista.
      if (profundidadDelHash(e.hash()) > 0) e.reemplazar('')
    }
    const deseada = capas.length
    if (deseada > empujadas) {
      if (esperar(!e.listo() || e.pendiente())) return
      esperas = 0
      for (let k = empujadas + 1; k <= deseada; k++) {
        e.empujar(hashDeLaPila(capas.slice(0, k).map((c) => c.nombre)))
      }
      empujadas = deseada
      return
    }
    if (deseada < empujadas) {
      retroceder(empujadas - deseada)
      return
    }
    // Las mismas que entradas. Si la de arriba cambió de nombre (una capa se
    // cerró y otra se abrió de una vez) o un router.replace le borró el
    // marcador, se lo vuelve a poner.
    if (empujadas > 0 && e.listo()) {
      const hash = hashDeLaPila(capas.map((c) => c.nombre))
      const actual = e.hash()
      if (actual !== hash && (actual === '' || actual.startsWith(PREFIJO))) e.reemplazar(hash)
    }
  }

  function alAtras(yaAnimado: boolean) {
    if (!encendido || montadas === 0) return
    // Hacia otra pantalla: es de Next.
    if (e.ruta() !== ruta) return
    const d = profundidadDelHash(e.hash())
    if (enVuelo) {
      // El nuestro (cerrar por la interfaz): no se cierra nada.
      enVuelo()
      enVuelo = null
      empujadas = d
      programar()
      return
    }
    if (d < empujadas) {
      // El «atrás» del sistema: se cierran las capas de más arriba, de arriba
      // para abajo. Ya no tienen entrada: aunque tarden en irse (la animación),
      // no cuentan.
      empujadas = d
      const capas = vivas()
      const sobran = capas.slice(d).reverse()
      for (const capa of sobran) capa.cerrando = true
      for (const capa of sobran) capa.cerrar(yaAnimado)
      programar()
      return
    }
    if (d > empujadas) {
      // Hacia adelante, a una entrada de una capa que ya se cerró: se deshace
      // (la capa no se puede volver a abrir sin saber cuál era).
      retroceder(d - empujadas)
    }
  }

  function encender() {
    encendido = true
    ruta = e.ruta()
    fresco = true
    empujadas = 0
    esperas = 0
    dejarDeOir = e.oirAtras(alAtras)
    programar()
  }

  function apagar() {
    encendido = false
    dejarDeOir?.()
    dejarDeOir = null
    enVuelo?.()
    enVuelo = null
    espera?.()
    espera = null
    e.paralaje(null)
    pila = []
    empujadas = 0
  }

  return {
    montar() {
      montadas++
      if (!encendido) encender()
      let desmontada = false
      return () => {
        if (desmontada) return
        desmontada = true
        montadas--
        // Una pantalla que se cambia por otra (el chat por una sección) se
        // desmonta y se monta en el mismo commit: se apaga sólo si después de
        // eso no quedó ninguna.
        if (montadas === 0) {
          e.enSeguida(() => {
            if (montadas === 0 && encendido) apagar()
          })
        }
      }
    },

    abrir(nombre, cerrar, opciones) {
      const capa: Capa = {
        id: ++ultimoId,
        nombre: nombreDeCapa(nombre),
        cerrar,
        mueveLista: opciones?.mueveLista ?? true,
        cerrando: false,
      }
      // La primera que tapa la lista la corre (también si la de abajo se está
      // yendo: la nueva la vuelve a tapar). Una hoja no la tapa ni la corre.
      if (capa.mueveLista && !vivas().some((c) => c.mueveLista)) e.paralaje('abierta')
      pila.push(capa)
      // Al toque (en el efecto de layout, antes de que se pinte la capa): así
      // la foto que guarda iOS de la entrada de abajo es la lista y no la capa
      // entrando. Si hay algo pendiente, se acomoda con eso.
      if (!programado && !enVuelo && !espera) reconciliar()
      let quitada = false
      return {
        quitar() {
          if (quitada) return
          quitada = true
          pila = pila.filter((c) => c.id !== capa.id)
          // Sin ninguna que la tape (las hojas no cuentan), la lista vuelve a
          // su lugar sin transform.
          if (capa.mueveLista && !pila.some((c) => c.mueveLista)) e.paralaje(null)
          programar()
        },
        arriba() {
          const capas = vivas()
          return capas[capas.length - 1]?.id === capa.id
        },
        moverLista(estado, progreso) {
          if (pila.find((c) => c.mueveLista)?.id === capa.id) e.paralaje(estado, progreso)
        },
      }
    },
  }
}

// ── El navegador ────────────────────────────────────────────────────────────

function direccionCon(hash: string): string {
  return location.pathname + location.search + hash
}

/** ¿Next ya parcheó el historial? Antes sólo están los nativos, en el prototipo. */
function historialDeNext(): boolean {
  return window.history.replaceState !== History.prototype.replaceState
}

/** La raíz de la lista que hace el paralaje (la marca conversation-list.tsx). */
const LISTA_PARALAJE = '[data-wa-lista-paralaje]'

export function entornoDelNavegador(): Entorno {
  // Las listas del paralaje, para no buscarlas en cada cuadro del gesto: se
  // vuelven a buscar cuando cambia el momento o si alguna ya no está.
  let listas: HTMLElement[] = []
  const lasListas = (buscar: boolean) => {
    if (buscar || listas.length === 0 || listas.some((l) => !l.isConnected)) {
      listas = Array.from(document.querySelectorAll<HTMLElement>(LISTA_PARALAJE))
    }
    return listas
  }
  return {
    hash: () => location.hash,
    ruta: () => location.pathname,
    listo: historialDeNext,
    pendiente: () => new URLSearchParams(location.search).has('clientId'),
    // Los de Next (window.history.*, parcheados): copian __NA y el árbol y le
    // avisan al router. El estado propio va vacío: no se lee nunca.
    empujar: (hash) => window.history.pushState(null, '', direccionCon(hash)),
    reemplazar: (hash) => window.history.replaceState(null, '', direccionCon(hash)),
    retroceder: (n) => window.history.go(-n),
    oirAtras: (f) => {
      // hasUAVisualTransition: Chrome (y quien lo implemente) avisa si ya
      // mostró su propia transición de «atrás»; sin el campo, como si no.
      const alPopstate = (e: PopStateEvent) =>
        f((e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true)
      window.addEventListener('popstate', alPopstate)
      return () => window.removeEventListener('popstate', alPopstate)
    },
    enSeguida: (f) => queueMicrotask(f),
    despues: (f, ms) => {
      const reloj = window.setTimeout(f, ms)
      return () => window.clearTimeout(reloj)
    },
    paralaje: (estado, progreso) => {
      const html = document.documentElement
      if (estado === null) {
        html.removeAttribute('data-wa-paralaje')
        for (const l of lasListas(true)) l.style.removeProperty('--wa-paralaje')
        listas = []
        return
      }
      // El atributo sólo cuando cambia el momento (no en cada cuadro).
      const cambio = html.getAttribute('data-wa-paralaje') !== estado
      if (cambio) html.setAttribute('data-wa-paralaje', estado)
      for (const l of lasListas(cambio)) {
        if (progreso === undefined) l.style.removeProperty('--wa-paralaje')
        else l.style.setProperty('--wa-paralaje', String(progreso))
      }
    },
  }
}

let instancia: HistorialDeCapas | null = null
const historial = () => (instancia ??= crearHistorialDeCapas(entornoDelNavegador()))

/** Para el hook: Mensajería montada (una instancia más). Devuelve el desmontar. */
export function montarHistorial(): () => void {
  return historial().montar()
}

/** Para los hooks: una capa (o una hoja) que se abre en el celular. */
export function abrirCapa(nombre: string, cerrar: (yaAnimado: boolean) => void, opciones?: OpcionesDeCapa): RegistroDeCapa {
  return historial().abrir(nombre, cerrar, opciones)
}

/**
 * ¿El sistema tiene su propio «atrás» deslizando desde el borde, con la foto
 * de la pantalla anterior? Es WebKit con pantalla táctil: Safari y la app
 * instalada del iPhone y del iPad (en iOS todos los navegadores son WebKit:
 * Chrome dice CriOS). Ahí el gesto propio deja la franja del borde y el
 * «atrás» del sistema cierra la capa sin volver a animarla. En el iPad, Safari
 * dice ser una Mac: lo delata la pantalla táctil (una Mac no tiene).
 */
export function sistemaConAtrasDeslizando(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /AppleWebKit/.test(ua) && !/Chrome\/|Chromium|Android/.test(ua) && navigator.maxTouchPoints > 0
}
