'use client'

// El botón flotante de Tex: la puerta a Tex en todas las pantallas del
// dashboard, en la compu y en el celular. Lo pidió el dueño el 22/oct/2026,
// cuando Tex salió del menú, y reemplaza al lanzador del header.
//
// Abajo a la derecha ya había tres cosas, y por eso hasta entonces no existía:
//  - Los avisos (sonner): en el dashboard se corren hacia arriba y no quedan ni
//    encima ni debajo del botón (`--avisos-abajo` en globals.css, toaster-raiz.tsx).
//  - Mensajería, que va a sangre como WhatsApp (la lista de chats pasa por
//    debajo de la barra y un chat abierto tiene el composer abajo): ahí el shell
//    lo oculta (`oculto`).
// En /dashboard/asistente/* (Tex y Configurar Tex) el shell ni lo monta, igual
// que el panel que abre: montado y escondido, `:root:has([data-tex-flotante])`
// lo contaba y los avisos quedaban 64 px arriba de un hueco.
//  - Los destinos de arrastre de la Fila: mientras se arrastra una tarjeta
//    (`html[data-arrastrando]`, lo pone fila-client.tsx) el botón se va.
// También se va con el teclado virtual abierto y, en el celular, al scrollear
// hacia abajo: vuelve al subir o un rato después de que el scroll se detiene,
// salvo al final de la página (ahí taparía la esquina de lo último que se lee:
// vuelve al subir o al cambiar de pantalla).
// Y mientras una página muestra una barra de guardar abajo (la fija de Turnos >
// Configuración, z-50, o la sticky de Fidelización > Categorías), se corre por
// CSS (globals.css).
//
// Escondido NO es desmontado: se va con una transición, no captura toques, sale
// del orden de tabulación y lleva aria-hidden (y si tenía el foco, lo suelta).
//
// Liviano a propósito, porque está en todas las pantallas: la cara es una imagen
// quieta, lo que depende del ancho va por CSS (nada cambia al hidratar) y el chat
// se precarga recién cuando el mouse se acerca, cuando se enfoca o cuando se
// apoya el dedo.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { TexIcono } from './tex-icono'
import { abrirTex, EVENTO_ABRIR_TEX } from './abrir-tex'
import { esAtajoTex, useAtajoTex, useHayTecladoVirtual } from './chat/hooks'
import { precargarPanelTex } from './chat/precarga'

export interface TexBotonFlotanteProps {
  /**
   * Lo decide el shell: Mensajería (abajo están su lista de chats y su
   * composer), el modo foco y el panel de Tex abierto. En la pantalla de Tex y
   * en Configurar Tex el botón no se monta.
   */
  oculto: boolean
}

export function TexBotonFlotante({ oculto }: TexBotonFlotanteProps) {
  const atajo = useAtajoTex()
  // Sí/no y no los px: con el teclado abierto, los px cambian en cada scroll.
  const conTeclado = useHayTecladoVirtual()
  const arrastrando = useSyncExternalStore(suscribirArrastre, leerArrastre, () => false)
  const porScroll = useSyncExternalStore(suscribirScroll, leerScroll, () => false)
  // En el servidor, "visto": la invitación aparece recién después de hidratar.
  const visto = useSyncExternalStore(suscribirVisto, leerVisto, () => true)
  const [invitacionTerminada, setInvitacionTerminada] = useState(false)
  const pathname = usePathname()
  const ref = useRef<HTMLButtonElement>(null)

  const escondido = oculto || arrastrando || conTeclado || porScroll

  // Otra pantalla empieza arriba de todo: el botón vuelve aunque se haya ido
  // scrolleando en la anterior.
  useEffect(() => {
    reiniciarScroll()
  }, [pathname])

  // Escondido no se queda con el foco: sería un foco invisible y con aria-hidden.
  // (Al cerrar el panel, Tex le devuelve el foco cuando ya está a la vista.)
  useEffect(() => {
    const boton = ref.current
    if (escondido && boton && document.activeElement === boton) boton.blur()
  }, [escondido])

  // La invitación termina la primera vez que se abre Tex, desde donde sea: este
  // botón, ⌘K o un "Preguntale a Tex" de otra pantalla (todos pasan por el evento).
  useEffect(() => {
    if (visto) return
    const alAbrir = () => marcarVisto()
    const alTeclear = (e: KeyboardEvent) => {
      if (esAtajoTex(e)) marcarVisto()
    }
    window.addEventListener(EVENTO_ABRIR_TEX, alAbrir)
    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener(EVENTO_ABRIR_TEX, alAbrir)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [visto])

  return (
    <button
      ref={ref}
      type="button"
      data-tex-flotante=""
      // El mismo texto que la píldora (WCAG 2.5.3: el nombre contiene lo que se ve).
      aria-label="Preguntale a Tex"
      aria-keyshortcuts="Meta+K Control+K"
      aria-hidden={escondido || undefined}
      tabIndex={escondido ? -1 : undefined}
      onClick={() => abrirTex()}
      onPointerEnter={precargarPanelTex}
      onPointerDown={precargarPanelTex}
      onFocus={precargarPanelTex}
      className={cn(
        'tex-flotante group/tex fixed z-40 flex touch-manipulation select-none items-center rounded-full',
        // Celular: 12 px arriba de la barra inferior. El shell publica lo que la
        // barra ocupa desde el borde de abajo CON el área segura (60 px más su
        // separación del borde, max(10 px, área segura − 12 px); 0 si no está):
        // el max() evita contar el área segura dos veces y la respeta sin barra.
        // Compu: en la esquina.
        'bottom-[calc(max(var(--alto-barra-inferior,0px),env(safe-area-inset-bottom,0px))+12px)] right-4 lg:bottom-6 lg:right-6',
        'transition-[opacity,translate,scale,bottom,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[color:var(--tex)]',
        'active:scale-[0.96]',
        escondido && 'pointer-events-none translate-y-3 scale-90 opacity-0',
      )}
    >
      {!visto && !invitacionTerminada && (
        <span
          aria-hidden
          className="tex-flotante-pulso pointer-events-none absolute inset-0 rounded-full"
          onAnimationEnd={() => setInvitacionTerminada(true)}
        />
      )}

      {/* La píldora de la compu: se estira hacia la izquierda (la cara queda
          quieta en la esquina) al pasar el mouse o con el foco del teclado. La
          columna va de 0fr a 1fr: anima al ancho exacto del texto, sin medirlo. */}
      <span
        aria-hidden
        className={cn(
          'grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          'lg:group-hover/tex:grid-cols-[1fr] lg:group-focus-visible/tex:grid-cols-[1fr]',
        )}
      >
        <span className="min-w-0 overflow-hidden">
          <span
            className={cn(
              'flex items-center gap-2.5 whitespace-nowrap pl-[18px] pr-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
              'lg:group-hover/tex:opacity-100 lg:group-hover/tex:delay-75 lg:group-focus-visible/tex:opacity-100',
            )}
          >
            <span className="text-sm font-medium text-foreground">Preguntale a Tex</span>
            {atajo && (
              <kbd className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-sans text-[11px] font-medium tabular-nums text-muted-foreground">
                {atajo}
              </kbd>
            )}
          </span>
        </span>
      </span>

      <span className="tex-flotante-cara grid size-[52px] shrink-0 place-items-center rounded-full lg:size-14">
        <TexIcono className="size-8 translate-y-px lg:size-[34px]" />
      </span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrastre de la Fila: `html[data-arrastrando]` mientras se lleva una tarjeta.
// ─────────────────────────────────────────────────────────────────────────────

function suscribirArrastre(avisar: () => void): () => void {
  const observador = new MutationObserver(avisar)
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-arrastrando'] })
  return () => observador.disconnect()
}

function leerArrastre(): boolean {
  return document.documentElement.hasAttribute('data-arrastrando')
}

// ─────────────────────────────────────────────────────────────────────────────
// Scroll en el celular. Un store chico fuera de React: el scroll se escucha en
// captura sobre `document` (hay pantallas que scrollean adentro de un panel, no
// el <main>) y React se entera sólo cuando el botón pasa de visible a escondido
// o al revés, no en cada evento.
// ─────────────────────────────────────────────────────────────────────────────

/** Debajo del `lg` del shell: el celular y la tablet, con barra inferior. */
const MEDIA_CELULAR = '(max-width: 1023.98px)'
/** Lo que hay que recorrer en un mismo sentido para que cambie: filtra el temblor del dedo. */
export const UMBRAL_SCROLL_PX = 12
/** Con el scroll quieto este tiempo, vuelve aunque no se haya subido (salvo al final). */
export const VUELVE_QUIETO_MS = 1200
/** Margen para dar por llegado el final (redondeos de subpíxel y del zoom). */
const MARGEN_FINAL_PX = 2

/** ¿El contenedor llegó al final? Ahí el botón taparía lo último: no vuelve solo. */
export function estaAlFinal(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= MARGEN_FINAL_PX
}

export interface EstadoScroll {
  escondido: boolean
  /** Lo recorrido en el sentido actual (positivo, hacia abajo). */
  recorrido: number
}

/** Un paso del scroll: `y` es la posición después del paso y `d`, lo que se movió. */
export function pasoDeScroll(estado: EstadoScroll, y: number, d: number): EstadoScroll {
  // Arriba de todo (o en el rebote de iOS) siempre está a la vista.
  if (y <= 0) return { escondido: false, recorrido: 0 }
  const recorrido = Math.sign(d) === Math.sign(estado.recorrido) ? estado.recorrido + d : d
  if (recorrido > UMBRAL_SCROLL_PX) return { escondido: true, recorrido }
  if (recorrido < -UMBRAL_SCROLL_PX) return { escondido: false, recorrido }
  return { escondido: estado.escondido, recorrido }
}

let scroll: EstadoScroll = { escondido: false, recorrido: 0 }
let posiciones = new WeakMap<Element, number>()
let quieto: ReturnType<typeof setTimeout> | undefined
let mediaCelular: MediaQueryList | null = null
const oyentesScroll = new Set<() => void>()

function ponerScroll(siguiente: EstadoScroll) {
  const cambio = siguiente.escondido !== scroll.escondido
  scroll = siguiente
  if (cambio) oyentesScroll.forEach((avisar) => avisar())
}

function reiniciarScroll() {
  clearTimeout(quieto)
  ponerScroll({ escondido: false, recorrido: 0 })
}

function alCambiarAncho() {
  // Las posiciones viejas darían un salto falso en el primer scroll.
  posiciones = new WeakMap()
  reiniciarScroll()
}

function alScrollear(e: Event) {
  // En la compu no se esconde: ni se mira la posición.
  if (!mediaCelular?.matches) return
  const el = e.target === document ? document.scrollingElement : e.target
  if (!(el instanceof Element)) return
  const y = el.scrollTop
  const antes = posiciones.get(el)
  posiciones.set(el, y)
  // El primer evento de cada contenedor sólo marca dónde está; sin cambio
  // vertical es un scroll de costado (una tira de pestañas, una tabla).
  if (antes === undefined || y === antes) return
  clearTimeout(quieto)
  ponerScroll(pasoDeScroll(scroll, y, y - antes))
  if (scroll.escondido && !estaAlFinal(y, el.clientHeight, el.scrollHeight)) {
    quieto = setTimeout(reiniciarScroll, VUELVE_QUIETO_MS)
  }
}

function suscribirScroll(avisar: () => void): () => void {
  oyentesScroll.add(avisar)
  if (oyentesScroll.size === 1) {
    mediaCelular = window.matchMedia(MEDIA_CELULAR)
    mediaCelular.addEventListener('change', alCambiarAncho)
    document.addEventListener('scroll', alScrollear, { capture: true, passive: true })
  }
  return () => {
    oyentesScroll.delete(avisar)
    if (oyentesScroll.size > 0) return
    document.removeEventListener('scroll', alScrollear, { capture: true })
    mediaCelular?.removeEventListener('change', alCambiarAncho)
    mediaCelular = null
    posiciones = new WeakMap()
    reiniciarScroll()
  }
}

function leerScroll(): boolean {
  return scroll.escondido
}

// ─────────────────────────────────────────────────────────────────────────────
// La invitación de la primera vez (un pulso del anillo, tres veces) hasta que
// la persona abre Tex. Sin almacenamiento no hay cómo recordar que ya lo abrió,
// así que no se invita: repetirla en cada carga sería peor que no mostrarla.
// ─────────────────────────────────────────────────────────────────────────────

export const CLAVE_VISTO = 'tex.flotante.visto.v1'

let visto: boolean | null = null
const oyentesVisto = new Set<() => void>()

function leerVisto(): boolean {
  if (visto === null) {
    try {
      visto = localStorage.getItem(CLAVE_VISTO) === '1'
    } catch {
      visto = true
    }
  }
  return visto
}

function marcarVisto() {
  if (leerVisto()) return
  visto = true
  try {
    localStorage.setItem(CLAVE_VISTO, '1')
  } catch {
    // Queda recordado hasta que se recargue la página.
  }
  oyentesVisto.forEach((avisar) => avisar())
}

function suscribirVisto(avisar: () => void): () => void {
  oyentesVisto.add(avisar)
  return () => {
    oyentesVisto.delete(avisar)
  }
}
