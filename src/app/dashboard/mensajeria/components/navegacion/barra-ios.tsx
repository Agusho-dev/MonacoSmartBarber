'use client'

// La barra de navegación de iOS de las pantallas de Mensajería que no son la
// lista de chats (Difusiones, Automatizaciones, Alertas, Casos, Respuestas
// rápidas y Mensajes programados): "‹ Chats" vuelve a la lista, el título va
// centrado y a la derecha va la acción principal de la pantalla (el "+" verde).
//
// En el celular esas pantallas son CAPAS (23/oct/2026, segunda ronda): fixed
// sobre el shell entero, con z-[41] (encima de la barra de vidrio, z-40; debajo
// del panel de Tex, de las hojas y de los diálogos). Entran desde la derecha y
// se vuelven con "‹ Chats" o deslizando desde el borde izquierdo, como en iOS.
// Debajo queda todo montado y quieto (el encabezado del dashboard, la lista de
// chats y la barra de vidrio): al volver deslizando se ve la pantalla de
// verdad. En la compu nada de esto aplica: son columnas.

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import { useEsCelular } from '@/hooks/use-es-celular'
import { cn } from '@/lib/utils'
import { useDeslizarParaVolver } from '../inbox/deslizar-para-volver'

export function BarraIos({
  titulo,
  onVolver,
  derecha,
  className,
}: {
  titulo: string
  onVolver: () => void
  derecha?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex h-11 shrink-0 items-center justify-between border-b-[0.5px] border-[var(--wa-divider)] bg-[var(--wa-bg)] pl-1 pr-3',
        className,
      )}
    >
      <button
        type="button"
        onClick={onVolver}
        className="relative z-10 flex h-11 items-center gap-0.5 rounded-lg pr-2 text-[17px] text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:text-[15px] lg:hover:opacity-75"
      >
        <ChevronLeft aria-hidden className="size-7 lg:size-6" strokeWidth={2.2} />
        Chats
      </button>
      {/* Centrado sobre la barra entera (no entre los botones), como en iOS;
          los costados le reservan lugar al "‹ Chats". */}
      <h1 className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold text-[var(--wa-text)] lg:inset-x-20 lg:text-[15px]">
        {titulo}
      </h1>
      <div className="relative z-10 flex items-center gap-2">{derecha}</div>
    </div>
  )
}

/**
 * Las clases de una capa del celular: fixed sobre el shell, entra desde la
 * derecha y deja el arrastre horizontal para el gesto de volver (touch-action:
 * pan-y). `wa-capa` (globals.css) la pone quien la usa, en el mismo elemento.
 *
 * La entrada es una animación (motion-safe; no deja el transform puesto al
 * terminar) y lo único que se le fija es SU duración: con `duration-300`, que
 * fija transition-duration, la capa quedaba con `transition: all 300ms` y
 * cualquier estilo que el gesto le sacara (el transform al soltar) se animaba
 * por su cuenta: con «‹» justo después de un arrastre corto, la capa volvía a
 * entrar a mitad de la salida (revisión de la ronda 2).
 */
export const CLASE_CAPA_IOS = cn(
  'max-lg:fixed max-lg:inset-0 max-lg:z-[41]',
  'max-lg:touch-pan-y max-lg:touch-pinch-zoom',
  'max-lg:animation-duration-300 max-lg:ease-out max-lg:motion-safe:animate-in max-lg:motion-safe:slide-in-from-right',
)

/**
 * Lo que necesita una capa del celular: la ref del elemento que se mueve, el
 * gesto de volver deslizando desde el borde y el "‹ Chats" (`volver`), que en
 * el celular la saca hacia la derecha antes de volver (volverAnimado, de
 * deslizar-para-volver.ts) y en la compu vuelve de una.
 */
export function useCapaIos<T extends HTMLElement>(onVolver: () => void) {
  const esCelular = useEsCelular()
  const capaRef = useRef<T>(null)
  const volver = useDeslizarParaVolver(capaRef, esCelular, onVolver)
  return { capaRef, volver }
}

// La ranura de la derecha de la barra del marco: cada sección pone ahí su
// acción principal (AccionDeBarraIos) sin que el marco tenga que saber cuál es.
const RanuraDeLaBarra = createContext<HTMLElement | null>(null)

/** La acción principal de una sección, en la barra de iOS del celular. */
export function AccionDeBarraIos({ children }: { children: ReactNode }) {
  const ranura = useContext(RanuraDeLaBarra)
  return ranura ? createPortal(children, ranura) : null
}

/**
 * El "+" verde de la barra, como el de la lista de chats. Se ve de 36 px y se
 * toca en 44 (el margen negativo lo deja ocupar lo mismo en la barra).
 */
export function BotonMasIos({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="group/mas -m-1 flex size-11 items-center justify-center rounded-full outline-none [-webkit-tap-highlight-color:transparent]"
    >
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full bg-[var(--wa-accent)] text-[var(--wa-on-accent)]',
          'transition-[background-color,scale] duration-150 group-active/mas:scale-95 group-active/mas:bg-[var(--wa-accent-hover)]',
          'group-focus-visible/mas:ring-2 group-focus-visible/mas:ring-[var(--wa-accent)]/60 group-focus-visible/mas:ring-offset-2 group-focus-visible/mas:ring-offset-[var(--wa-bg)]',
        )}
      >
        <Plus aria-hidden className="size-[22px]" strokeWidth={2.5} />
      </span>
    </button>
  )
}

/** Un texto verde en la barra ("Leer todas", "Ver todos", "Editar"), como los botones de texto de iOS. */
export function BotonTextoIos({
  children,
  onClick,
  disabled,
  negrita = false,
  etiqueta,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  /** «Listo»: la acción que cierra un modo va en negrita, como en iOS. */
  negrita?: boolean
  etiqueta?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      className={cn(
        'flex h-11 min-w-11 items-center justify-center rounded-lg px-1 text-[17px] text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60',
        negrita && 'font-semibold',
      )}
    >
      {children}
    </button>
  )
}

/**
 * El encabezado de una sección en la compu, como el del chat de WhatsApp para
 * Mac: 56 px, a la misma altura que el de la lista de chats y el del chat, con
 * el título a la izquierda y las acciones a la derecha (en el celular el título
 * va en la barra de iOS y esta franja no existe).
 */
export function EncabezadoSeccion({
  titulo,
  subtitulo,
  children,
  className,
}: {
  titulo: string
  /** Una línea gris debajo del título («3 sin leer»). */
  subtitulo?: string
  /** Las acciones, a la derecha. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'hidden h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--wa-divider)] bg-[var(--wa-bg)] px-5 lg:flex',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[16px] font-semibold leading-5 text-[var(--wa-text)]">{titulo}</h2>
        {subtitulo && <p className="truncate text-[12px] leading-4 text-[var(--wa-text-2)]">{subtitulo}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/**
 * Para los diálogos del editor de automatizaciones: van en un portal, fuera de
 * .wa-scope, y sin ella el verde de WhatsApp (--wa-accent) no resuelve. Con
 * .wa-scope vuelven los --wa-*; la letra queda la del dashboard (Geist), como la
 * del editor: la de .wa-scope (la del sistema) le ganaría a font-sans, que es
 * una clase de Tailwind, así que va en el style.
 */
export const TEMA_DIALOGO_SECCION = {
  className: 'wa-scope',
  style: { fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif' },
} as const

/** La acción principal de una sección en la compu ("+ Nueva difusión"), en el verde de WhatsApp. */
export function BotonPrincipal({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-3.5 text-[13px] font-semibold text-[var(--wa-on-accent)] outline-none transition-colors hover:bg-[var(--wa-accent-hover)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)]"
    >
      {children}
    </button>
  )
}

/** Una acción de texto del encabezado de la compu («Editar», «Leer todas»). */
export function BotonSecundario({
  children,
  onClick,
  disabled,
  negrita = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  negrita?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--wa-accent)] outline-none transition-colors hover:bg-[var(--wa-hover)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60',
        negrita ? 'font-semibold' : 'font-medium',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Cada sección es una pantalla de WhatsApp: el fondo y la letra del sistema de
 * .wa-scope (la San Francisco en el iPhone y en la Mac), a sangre. En el
 * celular es una capa con la barra de iOS; en la compu ocupa el lugar de la
 * lista y la conversación. El área segura de abajo la deja el contenido de cada
 * sección (ContenidoSeccion, lista-ios.tsx): la lista pasa por debajo de la
 * rayita de inicio, como en iOS.
 */
export function MarcoSeccion({
  titulo,
  onVolver,
  children,
}: {
  titulo: string
  onVolver: () => void
  children: ReactNode
}) {
  const { capaRef, volver } = useCapaIos<HTMLDivElement>(onVolver)
  const [ranura, setRanura] = useState<HTMLDivElement | null>(null)

  return (
    <div
      ref={capaRef}
      // El shell cambia de sección deslizando de costado: acá no.
      data-sin-swipe=""
      // El nombre de la capa en el historial (#/seccion: historial-capas.ts).
      data-capa="seccion"
      // wa-capa (globals.css): en el celular, la sombra del canto y el
      // oscurecido de lo que queda descubierto. Por eso el marco no recorta
      // (overflow): lo hace el contenido de adentro.
      className={cn('wa-capa flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--wa-bg)] text-[var(--wa-text)]', CLASE_CAPA_IOS)}
    >
      <BarraIos
        titulo={titulo}
        onVolver={volver}
        derecha={<div ref={setRanura} className="flex items-center gap-1" />}
        className="lg:hidden"
      />
      <RanuraDeLaBarra.Provider value={ranura}>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-clip">{children}</div>
      </RanuraDeLaBarra.Provider>
    </div>
  )
}
