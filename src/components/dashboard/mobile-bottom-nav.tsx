'use client'

// La barra inferior del celular: los cinco grupos del menú en una cápsula de
// vidrio que flota sobre la página, como la de iOS 26 (pedido del dueño,
// 23/oct/2026, con una captura de WhatsApp: "me gustaría que el navbar lo hagas
// para que pueda deslizar con el dedo al estilo apple"). Tocar un grupo lleva a
// la última pestaña que se usó de ese grupo (o a la primera); las pestañas del
// grupo van arriba, en el encabezado.
//
// Medidas (tokens en globals.css, bloque "Barra inferior del celular"): 60 px de
// alto, 12 px a cada lado (28rem como mucho, centrada) y separada del borde de
// abajo max(10 px, área segura − 12 px). Lo que ocupa desde abajo (82 px en un
// iPhone con rayita, 70 sin área segura) es el --alto-barra-inferior que publica
// el shell, y entra en el padding de abajo del <main>: la página pasa por debajo
// del vidrio y lo último queda a la vista. Cada grupo es un objetivo de 52 px de
// alto por un quinto de la pista (~66 px en 360).
//
// La píldora de la marcada es UN solo elemento que viaja de ranura en ranura,
// con resorte y un leve estiramiento. Deslizar el dedo de costado sobre la barra
// (o mantenerlo quieto) la levanta como una lente de vidrio: una cápsula más
// ancha que alta y más grande que la barra (1,4 ranuras × 70 px, en globals.css),
// que lo sigue y agranda las pestañas que va pasando; al soltar se asienta en la
// más cercana y ese grupo queda elegido. Como en iOS:
// - un dedo que se va en vertical antes de levantar la lente quiso scrollear:
//   el gesto se abandona (sin lente, sin navegar y sin clic);
// - con la lente arriba, el dedo que se aleja de la cápsula la desinfla, y
//   soltarlo ahí no elige: la píldora vuelve a su grupo;
// - soltar (o mantener) sobre el grupo en el que ya está, desde una
//   sub-pantalla o un alias, vuelve a su pestaña, igual que el toque.
// Las decisiones del gesto son puras y están en barra-lente.ts, con la
// matemática de la lente. La lente se mueve con `translate` y
// requestAnimationFrame: ni un re-render de React por cuadro.
//
// El toque simple sigue siendo un Link (prefetch, ⌘/Ctrl + clic, teclado): el
// arrastre recién toma el puntero cuando arranca, así un toque ni se entera.
//
// Con una capa de Mensajería encima (la pantalla inmersiva) la barra sigue
// dibujada debajo, quieta e inerte (`tapada`), para que al volver deslizando se
// vea la pantalla de verdad. `hidden` es otra cosa: la barra se va de verdad.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { estaDesbloqueada, type GrupoId, type GrupoVisible, type PestanaVisible } from '@/lib/navegacion/grupos'
import { ICONOS_NAV } from './iconos-nav'
import { esClicQueNavegaAca } from './pestanas-encabezado'
import {
  ESPERA_LENTE_MS,
  anchoDeRanura,
  arrancaPorEspera,
  brilloPorCercania,
  centroDeLente,
  centroDeRanura,
  cercania,
  corrimientoDeRanura,
  corrimientoParaCentro,
  decidirMovimiento,
  escalaPorCercania,
  estiramientoDeViaje,
  indiceEn,
  seguir,
  sueltaElige,
  type Pista,
} from './barra-lente'

interface MobileBottomNavProps {
  grupos: readonly GrupoVisible[]
  /** El grupo de la pantalla (o el recién tocado, que se marca sin esperar a que cargue). */
  grupoMarcado: GrupoId | null
  /** Adónde lleva cada grupo (la última pestaña usada o la primera). */
  destinos: ReadonlyMap<GrupoId, PestanaVisible | null>
  /** Descansos pendientes: van en ámbar sobre Equipo. */
  descansosPendientes: number
  /** La barra no va (Tex, el modo foco, la hoja de Tex abierta): se baja y se desvanece. */
  hidden?: boolean
  /**
   * Tapada por una capa que ocupa la pantalla entera (la pantalla inmersiva):
   * se sigue viendo debajo, pero no recibe toques, ni el foco del teclado, ni
   * la lee el lector de pantalla.
   */
  tapada?: boolean
  onTocado: (grupo: GrupoId) => void
  /** Un grupo con todas sus pestañas en "Pronto" abre el aviso del módulo. */
  onBloqueada: (pestana: PestanaVisible) => void
}

/** El resorte de la píldora: se pasa un poco y vuelve, como en iOS. */
const RESORTE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const DURACION_VIAJE_MS = 380
/** Lo que tarda la lente en alcanzar al dedo (un resorte amortiguado; barra-lente.ts). */
const TAU_LENTE_MS = 34
/** Al soltar, el navegador puede mandar un clic a la pestaña de abajo: se descarta. */
const VENTANA_CLIC_FANTASMA_MS = 700

/** Lo que dura un gesto sobre la barra. Vive fuera de React: cambia en cada cuadro. */
interface Arrastre {
  /** El puntero que manda: el primer dedo o el botón principal del mouse. */
  readonly id: number
  readonly x0: number
  readonly y0: number
  /** Dónde está el dedo ahora. */
  x: number
  y: number
  /**
   * - pendiente: todavía puede ser un toque, la lente o un scroll;
   * - lente: se levantó (el dedo se corrió de costado, o se quedó quieto la espera);
   * - abandonado: el dedo se fue en vertical (quiso scrollear): no hace nada más.
   */
  fase: 'pendiente' | 'lente' | 'abandonado'
  pista: Pista | null
  nav: HTMLElement | null
  pildora: HTMLElement | null
  /** Lo de adentro de cada pestaña, en el orden de la barra: lo que se agranda. */
  contenidos: HTMLElement[]
  /** El centro de la lente, desde el borde izquierdo de la pista. */
  centro: number
  /** La pestaña que está debajo de la lente. */
  indice: number
  /** La ranura del grupo marcado (adonde vuelve la píldora con el dedo lejos); -1 sin grupo. */
  casa: number
  /** El borde de arriba de la cápsula, como `clientY`. */
  techo: number
  /** El dedo está lejos de la cápsula: soltar ahí no elige. */
  fuera: boolean
  reducido: boolean
  ultimoCuadro: number
  espera: ReturnType<typeof setTimeout> | null
  cuadro: number | null
}

export function MobileBottomNav({
  grupos,
  grupoMarcado,
  destinos,
  descansosPendientes,
  hidden = false,
  tapada = false,
  onTocado,
  onBloqueada,
}: MobileBottomNavProps) {
  const router = useRouter()
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)
  const pistaRef = useRef<HTMLDivElement>(null)
  const pildoraRef = useRef<HTMLSpanElement>(null)
  const arrastreRef = useRef<Arrastre | null>(null)
  const viajeRef = useRef<Animation | null>(null)
  const estiramientoRef = useRef<Animation | null>(null)
  const tragarClicHastaRef = useRef(0)
  const asentadaAlSoltarRef = useRef(false)
  const marcadaAntesRef = useRef<{ grupo: GrupoId | null; indice: number } | null>(null)
  const quieta = hidden || tapada

  // Cada grupo con adónde lleva (todos lo tienen: un grupo visible tiene alguna
  // pestaña). Su índice acá es su ranura en la pista.
  const items = grupos.flatMap((grupo) => {
    const destino = destinos.get(grupo.id) ?? null
    return destino ? [{ grupo, destino }] : []
  })
  const n = items.length
  const indiceMarcado = items.findIndex((it) => it.grupo.id === grupoMarcado)

  // La píldora viaja cuando cambia el grupo marcado (un toque, el deslizar entre
  // pantallas, atrás y adelante). Antes de pintar: el HTML ya la puso en la
  // ranura nueva y la animación sale de la vieja, sin un cuadro de salto.
  useLayoutEffect(() => {
    const antes = marcadaAntesRef.current
    marcadaAntesRef.current = { grupo: grupoMarcado, indice: indiceMarcado }
    // La primera vez ya está donde va; con el mismo grupo (cambió el orden de la
    // barra) salta sin viajar.
    if (!antes || antes.grupo === grupoMarcado) return
    // Al soltar un arrastre se asentó sola.
    if (asentadaAlSoltarRef.current) {
      asentadaAlSoltarRef.current = false
      return
    }
    // Aparece o se va (una pantalla fuera de los grupos): la opacidad del CSS.
    if (antes.grupo === null || antes.indice < 0 || indiceMarcado < 0) return
    // Con la lente en el dedo (terminó de cargar la pantalla de un toque
    // anterior), la píldora es del dedo: al soltar se asienta donde va.
    if (arrastreRef.current?.fase === 'lente') return
    const pildora = pildoraRef.current
    const pista = pistaRef.current
    if (!pildora || !pista || n === 0 || movimientoReducido()) return
    const caja = pista.getBoundingClientRect()
    const ranura = caja.width / n
    // Si venía viajando, sale de donde está ahora; si no, de su ranura de antes.
    const viaje = viajeRef.current
    const desde =
      viaje?.playState === 'running' ? pildora.getBoundingClientRect().left - caja.left : antes.indice * ranura
    viaje?.cancel()
    viajeRef.current = pildora.animate(
      [{ translate: `${desde}px 0` }, { translate: `${indiceMarcado * ranura}px 0` }],
      { duration: DURACION_VIAJE_MS, easing: RESORTE },
    )
    const estirada = estiramientoDeViaje(Math.abs(indiceMarcado - antes.indice))
    estiramientoRef.current?.cancel()
    estiramientoRef.current =
      pildora.firstElementChild?.animate(
        [{ scale: '1 1' }, { scale: `${estirada} ${2 - estirada}`, offset: 0.35 }, { scale: '1 1' }],
        { duration: DURACION_VIAJE_MS, easing: 'ease-out' },
      ) ?? null
  }, [grupoMarcado, indiceMarcado, n])

  // La lente se levanta: toma el puntero y arranca donde está la píldora (o bajo
  // el dedo, si no hay grupo marcado); de ahí va hacia el dedo con el resorte.
  const levantar = () => {
    const a = arrastreRef.current
    const nav = navRef.current
    const pista = pistaRef.current
    const pildora = pildoraRef.current
    if (!a || a.fase !== 'pendiente' || !nav || !pista || !pildora || n === 0) return
    if (a.espera !== null) clearTimeout(a.espera)
    a.espera = null
    const caja = pista.getBoundingClientRect()
    const geo: Pista = { izquierda: caja.left, ancho: caja.width, n }
    a.centro =
      indiceMarcado >= 0
        ? pildora.getBoundingClientRect().left - caja.left + anchoDeRanura(geo) / 2
        : centroDeLente(a.x, geo)
    // Lo que venía animando la píldora le ganaría a la posición en línea y a la
    // escala de la lente: se corta (ya se leyó dónde estaba).
    viajeRef.current?.cancel()
    estiramientoRef.current?.cancel()
    a.pista = geo
    a.nav = nav
    a.pildora = pildora
    a.casa = indiceMarcado
    a.techo = nav.getBoundingClientRect().top
    a.reducido = movimientoReducido()
    a.indice = indiceEn(a.centro, geo)
    a.contenidos = Array.from(nav.querySelectorAll<HTMLElement>('[data-barra-contenido]'))
    a.fase = 'lente'
    a.ultimoCuadro = performance.now()
    // Hasta soltar, ningún clic cuenta: el que mande el navegador lo resuelve el arrastre.
    tragarClicHastaRef.current = Number.POSITIVE_INFINITY
    try {
      nav.setPointerCapture(a.id)
    } catch {
      // El dedo ya se levantó: el pointerup termina el arrastre igual.
    }
    nav.setAttribute('data-lente', '')
    pildora.style.translate = `${corrimientoParaCentro(a.centro, geo)}px 0`
    pedirCuadro(a)
  }

  // Con el dedo quieto la lente se levanta sola, como en iOS. Si se movió sin
  // decidirse (ni de costado ni en vertical, más que el temblor), no.
  const alVencerEspera = () => {
    const a = arrastreRef.current
    if (!a || a.fase !== 'pendiente') return
    a.espera = null
    if (arrancaPorEspera(a.x - a.x0, a.y - a.y0)) levantar()
  }

  // Cada movimiento del puntero que manda (lo escucha la ventana: con el mouse,
  // antes de tomar el puntero, el cursor puede salir de la barra).
  const alMover = (e: PointerEvent) => {
    const a = arrastreRef.current
    if (!a || e.pointerId !== a.id || a.fase === 'abandonado') return
    a.x = e.clientX
    a.y = e.clientY
    if (a.fase === 'lente') {
      pedirCuadro(a)
      return
    }
    const decision = decidirMovimiento(a.x - a.x0, a.y - a.y0)
    if (decision === 'levantar') {
      levantar()
    } else if (decision === 'abandonar') {
      // Quiso scrollear: sin lente, sin captura y sin navegar. El clic que el
      // navegador pueda mandar al soltar (con el mouse, sobre la misma pestaña)
      // tampoco cuenta.
      a.fase = 'abandonado'
      if (a.espera !== null) clearTimeout(a.espera)
      a.espera = null
      tragarClicHastaRef.current = Number.POSITIVE_INFINITY
    }
  }

  // Termina el gesto. Con `elegir` (se soltó el dedo) y el dedo cerca de la
  // cápsula, queda elegido el grupo de abajo del dedo; sin él (pointercancel,
  // la barra se escondió) o con el dedo lejos, la píldora vuelve al grupo de la
  // pantalla sin navegar.
  const terminar = (elegir: boolean) => {
    const a = arrastreRef.current
    if (!a) return
    arrastreRef.current = null
    if (a.espera !== null) clearTimeout(a.espera)
    if (a.cuadro !== null) cancelAnimationFrame(a.cuadro)
    if (a.fase === 'abandonado') {
      tragarClicHastaRef.current = performance.now() + VENTANA_CLIC_FANTASMA_MS
      return
    }
    // Un toque sin arrastre: lo resuelve el clic del Link, como siempre.
    if (a.fase !== 'lente' || !a.pista) return
    const nav = a.nav
    const pildora = a.pildora
    tragarClicHastaRef.current = performance.now() + VENTANA_CLIC_FANTASMA_MS
    try {
      nav?.releasePointerCapture(a.id)
    } catch {
      // Ya la había soltado el navegador.
    }

    let asentarEn = indiceMarcado
    if (elegir && sueltaElige(a.y, a.techo)) {
      // Bajo el dedo y no bajo la lente, que viene unos milisegundos atrás.
      const i = indiceEn(centroDeLente(a.x, a.pista), a.pista)
      const item = items[i]
      if (item) {
        vibrar(10)
        if (!estaDesbloqueada(item.destino)) {
          onBloqueada(item.destino)
        } else if (item.grupo.id === grupoMarcado) {
          asentarEn = i
          // El grupo en el que ya está: desde una sub-pantalla o un alias
          // (/dashboard/turnos/agenda, /dashboard/sueldos) vuelve a su pestaña,
          // como el toque. Sin asentadaAlSoltarRef: el grupo marcado no cambia,
          // el efecto del viaje no lo consumiría y se comería el próximo viaje.
          if (pathname !== item.destino.href) {
            onTocado(item.grupo.id)
            router.push(item.destino.href)
          }
        } else {
          asentarEn = i
          asentadaAlSoltarRef.current = true
          onTocado(item.grupo.id)
          router.push(item.destino.href)
        }
      }
    }

    // La lente vuelve a ser píldora (las transiciones del CSS) y las pestañas a
    // su tamaño; la píldora se asienta con resorte en su ranura (sin grupo
    // marcado, se desvanece donde quedó).
    nav?.removeAttribute('data-lente')
    nav?.removeAttribute('data-lente-fuera')
    for (const el of a.contenidos) {
      el.style.removeProperty('--barra-brillo')
      el.style.removeProperty('scale')
    }
    if (!pildora) return
    pildora.style.removeProperty('translate')
    if (a.reducido) return
    const desde = corrimientoParaCentro(a.centro, a.pista)
    const hasta = asentarEn >= 0 ? corrimientoDeRanura(asentarEn, a.pista) : desde
    viajeRef.current = pildora.animate([{ translate: `${desde}px 0` }, { translate: `${hasta}px 0` }], {
      duration: asentarEn >= 0 ? DURACION_VIAJE_MS : 200,
      easing: RESORTE,
    })
  }

  // El movimiento, el pointerup y el pointercancel se escuchan en la ventana:
  // con el mouse, el botón se puede mover y soltar fuera de la barra antes de
  // que la lente tome el puntero. Las funciones cambian con cada render: van
  // por una ref, y también la espera (que se arma en un render y vence en otro).
  const accionesRef = useRef({ alMover, alVencerEspera, terminar })
  useLayoutEffect(() => {
    accionesRef.current = { alMover, alVencerEspera, terminar }
  })
  useEffect(() => {
    const mover = (e: PointerEvent) => accionesRef.current.alMover(e)
    const fin = (e: PointerEvent) => {
      if (arrastreRef.current?.id === e.pointerId) accionesRef.current.terminar(e.type === 'pointerup')
    }
    window.addEventListener('pointermove', mover, { capture: true, passive: true })
    window.addEventListener('pointerup', fin, true)
    window.addEventListener('pointercancel', fin, true)
    return () => {
      window.removeEventListener('pointermove', mover, { capture: true })
      window.removeEventListener('pointerup', fin, true)
      window.removeEventListener('pointercancel', fin, true)
      const a = arrastreRef.current
      arrastreRef.current = null
      if (a?.espera != null) clearTimeout(a.espera)
      if (a?.cuadro != null) cancelAnimationFrame(a.cuadro)
    }
  }, [])

  // Escondida o tapada a mitad de un arrastre (se abrió Tex, una capa de
  // Mensajería): vuelve sin navegar.
  useEffect(() => {
    if (quieta) accionesRef.current.terminar(false)
  }, [quieta])

  const alApoyar = (e: ReactPointerEvent<HTMLElement>) => {
    // Un segundo dedo, otro botón del mouse o un clic con ⌘/Ctrl/Shift/Alt (abre
    // otra pestaña del navegador): eso no es deslizar.
    if (quieta || n === 0 || !e.isPrimary) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    // Un puntero principal nuevo: si quedó un gesto colgado, se descarta.
    if (arrastreRef.current) terminar(false)
    tragarClicHastaRef.current = 0
    arrastreRef.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      fase: 'pendiente',
      pista: null,
      nav: null,
      pildora: null,
      contenidos: [],
      centro: 0,
      indice: -1,
      casa: -1,
      techo: 0,
      fuera: false,
      reducido: false,
      ultimoCuadro: 0,
      espera: setTimeout(() => accionesRef.current.alVencerEspera(), ESPERA_LENTE_MS),
      cuadro: null,
    }
  }

  // Después de un arrastre (o de un scroll abandonado) el navegador puede
  // mandar un clic sintético a la pestaña de abajo: ése no navega (el arrastre
  // ya eligió). El `timeStamp` del evento usa el mismo reloj que performance.now().
  const esClicDeArrastre = (e: ReactMouseEvent) => {
    if (e.timeStamp >= tragarClicHastaRef.current) return false
    e.preventDefault()
    return true
  }

  return (
    <nav
      ref={navRef}
      aria-label="Secciones"
      aria-hidden={quieta || undefined}
      inert={quieta}
      data-oculta={hidden ? '' : undefined}
      className="barra-vidrio fixed inset-x-3 z-40 mx-auto max-w-md lg:hidden"
      style={{ '--barra-n': Math.max(n, 1), '--barra-i': Math.max(indiceMarcado, 0) } as CSSProperties}
      onPointerDown={alApoyar}
      // El menú del enlace de Android aparece con el dedo apretado: con la lente arriba, no.
      onContextMenu={(e) => {
        if (arrastreRef.current?.fase === 'lente') e.preventDefault()
      }}
    >
      <span aria-hidden className="barra-vidrio-fondo" />
      <div ref={pistaRef} aria-hidden className="barra-vidrio-pista">
        <span ref={pildoraRef} className="barra-pildora" data-visible={indiceMarcado >= 0 ? '' : undefined}>
          {/* El cuerpo es la píldora en reposo (el primer hijo: el que se estira
              al viajar); la lente es una pieza aparte, más grande que la barra,
              que aparece al levantarla. */}
          <span className="barra-pildora-cuerpo" />
          <span className="barra-pildora-lente" />
        </span>
      </div>
      <ul className="barra-vidrio-items">
        {items.map(({ grupo: g, destino }) => {
          const activo = g.id === grupoMarcado
          const bloqueado = !estaDesbloqueada(destino)
          const Icono = ICONOS_NAV[g.icono]
          const pendientes = g.id === 'equipo' ? descansosPendientes : 0
          const clase = cn(
            'barra-item flex h-full w-full min-w-0 items-center justify-center rounded-full outline-none',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70',
            bloqueado && 'opacity-60',
          )
          const contenido = (
            <span
              data-barra-contenido=""
              className="barra-item-contenido flex min-w-0 max-w-full flex-col items-center gap-[3px]"
            >
              <span className="relative flex">
                <Icono aria-hidden className="size-[22px]" strokeWidth={activo ? 2.25 : 1.75} />
                {pendientes > 0 && (
                  // Anclado a la derecha del ícono y creciendo hacia afuera: con dos
                  // cifras (o "99+") anclado al borde tapaba las tijeras.
                  <span
                    aria-hidden
                    className="absolute -top-1.5 left-[calc(50%+5px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none tabular-nums text-amber-950 shadow-[0_0_0_2px_rgb(22_22_24/0.9)]"
                  >
                    {pendientes > 99 ? '99+' : pendientes}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate px-0.5 text-[10.5px] font-medium leading-3">{g.etiquetaCorta}</span>
              {pendientes > 0 && (
                <span className="sr-only">
                  , {pendientes} {pendientes === 1 ? 'descanso pendiente' : 'descansos pendientes'}
                </span>
              )}
            </span>
          )
          return (
            <li key={g.id} className="flex min-w-0 flex-1">
              {!bloqueado ? (
                <Link
                  href={destino.href}
                  // Sin esto, arrastrar un enlace con el mouse arranca el arrastre
                  // nativo del navegador (y un pointercancel).
                  draggable={false}
                  onClick={(e) => {
                    if (esClicDeArrastre(e)) return
                    if (esClicQueNavegaAca(e)) onTocado(g.id)
                  }}
                  onKeyDown={activarConEspacio}
                  aria-current={activo ? 'true' : undefined}
                  className={clase}
                >
                  {contenido}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    if (!esClicDeArrastre(e)) onBloqueada(destino)
                  }}
                  className={clase}
                >
                  {contenido}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Un cuadro del arrastre: la lente se acerca al dedo y las pestañas cercanas se
 * agrandan. Con el dedo lejos de la cápsula (soltar ahí no elige) la lente se
 * desinfla, las pestañas vuelven a como estaban y la píldora vuelve a su grupo:
 * es lo que va a pasar si suelta ahí. ¿Le falta llegar?
 */
function pintarLente(a: Arrastre, ahora: number): boolean {
  const { pista, pildora, nav } = a
  if (!pista || !pildora || !nav) return false
  const fuera = !sueltaElige(a.y, a.techo)
  if (fuera !== a.fuera) {
    a.fuera = fuera
    nav.toggleAttribute('data-lente-fuera', fuera)
    if (fuera) {
      for (const el of a.contenidos) {
        el.style.removeProperty('--barra-brillo')
        el.style.removeProperty('scale')
      }
    }
  }
  const objetivo = fuera && a.casa >= 0 ? centroDeRanura(a.casa, pista) : centroDeLente(a.x, pista)
  a.centro = a.reducido ? objetivo : seguir(a.centro, objetivo, ahora - a.ultimoCuadro, TAU_LENTE_MS)
  a.ultimoCuadro = ahora
  pildora.style.translate = `${corrimientoParaCentro(a.centro, pista)}px 0`
  const indice = indiceEn(a.centro, pista)
  if (indice !== a.indice) {
    a.indice = indice
    if (!fuera) vibrar(6)
  }
  if (!fuera) {
    a.contenidos.forEach((el, i) => {
      const c = cercania(a.centro, i, pista)
      el.style.setProperty('--barra-brillo', brilloPorCercania(c).toFixed(3))
      // Sin animaciones: se aclaran, pero no se agrandan.
      if (!a.reducido) el.style.scale = escalaPorCercania(c).toFixed(4)
    })
  }
  return a.centro !== objetivo
}

/** Un cuadro por vez: los pointermove de un mismo cuadro se juntan en uno. */
function pedirCuadro(a: Arrastre) {
  if (a.cuadro !== null) return
  a.cuadro = requestAnimationFrame((ahora) => {
    a.cuadro = null
    if (a.fase === 'lente' && pintarLente(a, ahora)) pedirCuadro(a)
  })
}

/** Espacio también elige, como en un botón (Enter ya lo hace el enlace). */
function activarConEspacio(e: ReactKeyboardEvent<HTMLAnchorElement>) {
  if (e.key !== ' ') return
  e.preventDefault()
  e.currentTarget.click()
}

/**
 * Un toque mínimo, sólo en Android: Safari no tiene la API de vibración (y el
 * truco del <input switch> escondido de iOS no se usa: tiene efectos de foco y
 * de clic, y Apple lo habría cerrado).
 */
function vibrar(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // Sin vibración.
  }
}

function movimientoReducido(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
