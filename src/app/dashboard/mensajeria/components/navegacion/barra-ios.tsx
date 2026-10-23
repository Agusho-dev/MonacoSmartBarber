'use client'

// La barra de navegación de iOS de las pantallas de Mensajería que no son la
// lista de chats (Difusiones, Workflows, Alertas, Casos, Respuestas rápidas y
// Mensajes programados): "‹ Chats" vuelve a la lista, el título va centrado y a
// la derecha va la acción principal de la pantalla (el "+" verde).
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
 * derecha (motion-safe; la animación no deja el transform puesto al terminar) y
 * deja el arrastre horizontal para el gesto de volver (touch-action: pan-y).
 * `wa-capa` (globals.css) la pone quien la usa, en el mismo elemento.
 */
export const CLASE_CAPA_IOS = cn(
  'max-lg:fixed max-lg:inset-0 max-lg:z-[41]',
  'max-lg:touch-pan-y max-lg:touch-pinch-zoom',
  'max-lg:duration-300 max-lg:ease-out max-lg:motion-safe:animate-in max-lg:motion-safe:slide-in-from-right',
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

/** El "+" verde de la barra, como el de la lista de chats. */
export function BotonMasIos({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        'flex size-9 items-center justify-center rounded-full bg-[var(--wa-accent)] text-[var(--wa-on-accent)] outline-none [-webkit-tap-highlight-color:transparent]',
        'transition-[background-color,scale] duration-150 active:scale-95 active:bg-[var(--wa-accent-hover)]',
        'focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)]',
      )}
    >
      <Plus aria-hidden className="size-[22px]" strokeWidth={2.5} />
    </button>
  )
}

/** Un texto verde en la barra ("Leer todas", "Ver todos"), como los botones de texto de iOS. */
export function BotonTextoIos({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 items-center rounded-lg px-1 text-[17px] text-[var(--wa-accent)] outline-none transition-opacity duration-150 [-webkit-tap-highlight-color:transparent] active:opacity-40 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
    >
      {children}
    </button>
  )
}

/**
 * El encabezado de una sección en la compu: 56 px, a la misma altura que el de
 * la lista de chats y el del chat (en el celular el título va en la barra de
 * iOS y esta franja no existe).
 */
export function EncabezadoSeccion({
  icono,
  titulo,
  children,
  className,
}: {
  icono?: ReactNode
  titulo: string
  /** Las acciones, a la derecha. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('hidden h-14 shrink-0 items-center justify-between gap-3 border-b bg-card px-4 lg:flex', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 className="truncate text-sm font-semibold text-foreground">{titulo}</h2>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

/**
 * Para los diálogos y hojas de las secciones: van en un portal, fuera de
 * .wa-scope, y sin ella el verde de WhatsApp (--wa-accent) no resuelve. Con
 * .wa-scope vuelven los --wa-*; la letra queda la del dashboard (Geist), como la
 * de la sección: la de .wa-scope (la del sistema) le ganaría a font-sans, que es
 * una clase de Tailwind, así que va en el style.
 */
export const TEMA_DIALOGO_SECCION = {
  className: 'wa-scope',
  style: { fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif' },
} as const

/** La acción principal de una sección en la compu ("+ Nueva"), en el verde de WhatsApp. */
export function BotonPrincipal({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-3.5 text-[13px] font-semibold text-[var(--wa-on-accent)] outline-none transition-colors hover:bg-[var(--wa-accent-hover)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </button>
  )
}

/**
 * Las secciones de adentro (Difusiones, Workflows…) mantienen el tema del
 * dashboard: el marco las pone a sangre y les devuelve la letra del dashboard
 * (la de .wa-scope es la del sistema, la de WhatsApp). En el celular son una
 * capa con la barra de iOS; abajo dejan el área segura, porque la capa llega
 * hasta el borde y la rayita de inicio taparía los botones. En la compu ocupan
 * el lugar de la lista y la conversación.
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
      // wa-capa (globals.css): en el celular, la sombra del canto y el
      // oscurecido de lo que queda descubierto. Por eso el marco no recorta
      // (overflow): lo hace el contenido de adentro.
      className={cn('wa-capa flex min-h-0 min-w-0 flex-1 flex-col bg-background', CLASE_CAPA_IOS)}
    >
      <BarraIos
        titulo={titulo}
        onVolver={volver}
        derecha={<div ref={setRanura} className="flex items-center gap-2" />}
        className="lg:hidden"
      />
      <RanuraDeLaBarra.Provider value={ranura}>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-clip pb-[env(safe-area-inset-bottom,0px)] font-sans lg:pb-0">
          {children}
        </div>
      </RanuraDeLaBarra.Provider>
    </div>
  )
}
