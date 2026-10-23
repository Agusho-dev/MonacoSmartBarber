'use client'

// Las pestañas del grupo activo, en el encabezado del shell. Son el nivel 1 de
// la navegación; las pestañas internas de cada pantalla (Equipo, Finanzas,
// Turnos…) son el nivel 2 y van en su contenedor gris.
//
// - Compu: a la izquierda, sólo texto, subrayadas sobre el borde inferior del
//   encabezado (como las pestañas de un proyecto en Vercel).
// - Celular: una tira con scroll horizontal entre el menú y el avatar, sin barra
//   y desvanecida en los bordes; la marcada siempre a la vista.
// - Con una sola pestaña visible, o en una pantalla que no es de ningún grupo,
//   el celular muestra el título (como antes) y la compu nada.
//
// No suma alto: las pestañas ocupan el alto del encabezado (h-12 / lg:h-14), del
// que dependen las pantallas con h-[calc(100dvh-…)].

import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { estaDesbloqueada, type GrupoVisible, type PestanaVisible } from '@/lib/navegacion/grupos'
import { useTiraConScroll } from './use-tira-con-scroll'

/**
 * ¿El clic navega en esta pestaña del navegador? (con ⌘, Ctrl, Shift, Alt o
 * la rueda se abre otra, y lo tocado no tiene que marcarse acá).
 */
export function esClicQueNavegaAca(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

interface PestanasEncabezadoProps {
  /** El grupo de la pantalla actual (null fuera de los grupos). */
  grupo: GrupoVisible | null
  /** El href de la pestaña de la pantalla actual (con los alias resueltos). */
  activa: string | null
  /** Lo que muestra el celular cuando no hay pestañas que mostrar. */
  tituloMovil: string
  /** Una pestaña "Pronto": abre el aviso del módulo en vez de navegar. */
  onBloqueada: (pestana: PestanaVisible) => void
}

export function PestanasEncabezado({ grupo, activa, tituloMovil, onBloqueada }: PestanasEncabezadoProps) {
  const pathname = usePathname()

  // La pestaña tocada se marca enseguida, sin esperar a que cargue la pantalla;
  // al cambiar la ruta manda otra vez la de la ruta.
  const [tocada, setTocada] = useState<string | null>(null)
  const [rutaVista, setRutaVista] = useState(pathname)
  if (rutaVista !== pathname) {
    setRutaVista(pathname)
    setTocada(null)
  }
  const marcada = tocada ?? activa

  const pestanas = grupo?.pestanas ?? []
  const conjunto = pestanas.map((p) => p.href).join('|')
  const { ref, onScroll, onFocus } = useTiraConScroll(pestanas.length >= 2 ? marcada : null, conjunto)

  if (!grupo || pestanas.length < 2) {
    return (
      <div className="flex min-w-0 flex-1 items-center">
        <span className="truncate text-sm font-semibold lg:hidden">{tituloMovil}</span>
      </div>
    )
  }

  function alTocar(e: ReactMouseEvent<HTMLAnchorElement>, href: string) {
    // Abrir en otra pestaña del navegador no cambia esta pantalla.
    if (esClicQueNavegaAca(e)) setTocada(href)
  }

  return (
    <nav aria-label={`Pestañas de ${grupo.etiqueta}`} className="flex min-w-0 flex-1 self-stretch">
      <div
        ref={ref}
        onScroll={onScroll}
        onFocus={onFocus}
        className="relative flex min-w-0 items-stretch overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:-ml-3.5 [&::-webkit-scrollbar]:hidden"
      >
        {pestanas.map((p) => {
          if (!estaDesbloqueada(p)) {
            return (
              <button
                key={p.href}
                type="button"
                onClick={() => onBloqueada(p)}
                className="group relative flex shrink-0 items-center px-0.5 outline-none [-webkit-tap-highlight-color:transparent] lg:px-1"
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground/70 transition-colors group-hover:bg-foreground/[0.06] group-hover:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring/60 lg:px-2.5 lg:text-sm">
                  {p.etiqueta}
                  <span className="rounded-full border border-amber-500/40 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-amber-500">
                    Pronto
                  </span>
                </span>
              </button>
            )
          }
          const esMarcada = p.href === marcada
          return (
            <Link
              key={p.href}
              href={p.href}
              onClick={(e) => alTocar(e, p.href)}
              data-marcada={esMarcada ? '' : undefined}
              aria-current={esMarcada ? 'page' : undefined}
              className="group relative flex shrink-0 items-center px-0.5 outline-none [-webkit-tap-highlight-color:transparent] lg:px-1"
            >
              <span
                className={cn(
                  'whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors duration-150 lg:px-2.5 lg:text-sm',
                  'group-hover:bg-foreground/[0.06] group-focus-visible:ring-2 group-focus-visible:ring-ring/60',
                  esMarcada ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                )}
              >
                {p.etiqueta}
              </span>
              {/* El subrayado va sobre la línea del borde inferior del encabezado. */}
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-0.5 bottom-0 h-0.5 rounded-full bg-foreground transition-[opacity,scale] duration-200 ease-out lg:inset-x-1',
                  esMarcada ? 'opacity-100' : 'scale-x-75 opacity-0',
                )}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
