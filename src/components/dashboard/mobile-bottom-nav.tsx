'use client'

// La barra inferior del celular: los cinco grupos del menú. Tocar uno lleva a
// la última pestaña que se usó de ese grupo (o a la primera); las pestañas del
// grupo van arriba, en el encabezado. Reemplazó a "anterior / siguiente +
// puntitos", que con quince secciones no decía dónde estaba cada cosa.
//
// Mide 52 px (h-13) más su borde de 1 px y el área segura de abajo (como
// mínimo 4 px). El shell publica ese mismo alto en --alto-barra-inferior (lo
// usa el botón flotante de Tex para quedar arriba de la barra): si cambia acá,
// cambia allá. Cada grupo es un objetivo de 52 px de alto por un quinto del
// ancho (70 px en 360).

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { estaDesbloqueada, type GrupoId, type GrupoVisible, type PestanaVisible } from '@/lib/navegacion/grupos'
import { ICONOS_NAV } from './iconos-nav'
import { esClicQueNavegaAca } from './pestanas-encabezado'

interface MobileBottomNavProps {
  grupos: readonly GrupoVisible[]
  /** El grupo de la pantalla (o el recién tocado, que se marca sin esperar a que cargue). */
  grupoMarcado: GrupoId | null
  /** Adónde lleva cada grupo (la última pestaña usada o la primera). */
  destinos: ReadonlyMap<GrupoId, PestanaVisible | null>
  /** Descansos pendientes: van en ámbar sobre Equipo. */
  descansosPendientes: number
  hidden?: boolean
  onTocado: (grupo: GrupoId) => void
  /** Un grupo con todas sus pestañas en "Pronto" abre el aviso del módulo. */
  onBloqueada: (pestana: PestanaVisible) => void
}

export function MobileBottomNav({
  grupos,
  grupoMarcado,
  destinos,
  descansosPendientes,
  hidden = false,
  onTocado,
  onBloqueada,
}: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Secciones"
      aria-hidden={hidden || undefined}
      inert={hidden}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-md transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] lg:hidden',
        hidden && 'pointer-events-none translate-y-full',
      )}
      // Sin área segura (Android, iPhone con botón) quedan 4 px de aire abajo.
      style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <ul className="mx-auto flex h-13 max-w-lg items-stretch px-1">
        {grupos.map((g) => {
          const destino = destinos.get(g.id) ?? null
          if (!destino) return null
          const activo = g.id === grupoMarcado
          const bloqueado = !estaDesbloqueada(destino)
          const Icono = ICONOS_NAV[g.icono]
          const pendientes = g.id === 'equipo' ? descansosPendientes : 0
          const clase = cn(
            'group flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 outline-none [-webkit-tap-highlight-color:transparent]',
            bloqueado && 'opacity-60',
          )
          const contenido = (
            <>
              <span
                className={cn(
                  // `scale` y no `transform`: en Tailwind v4 scale-90 escribe la propiedad `scale`.
                  'relative flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,color,scale] duration-200 ease-out',
                  'group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-ring/60',
                  activo ? 'bg-foreground/[0.12] text-foreground' : 'text-muted-foreground',
                )}
              >
                <Icono aria-hidden className="size-[18px]" strokeWidth={activo ? 2.25 : 1.75} />
                {pendientes > 0 && (
                  // Anclado a la derecha del ícono y creciendo hacia afuera: con dos
                  // cifras (o "99+") anclado al borde tapaba las tijeras.
                  <span
                    aria-hidden
                    className="absolute -top-1 left-[calc(50%+5px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none tabular-nums text-amber-950 ring-2 ring-background"
                  >
                    {pendientes > 99 ? '99+' : pendientes}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'max-w-full truncate px-0.5 text-[10.5px] font-medium leading-3 transition-colors duration-200',
                  activo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {g.etiquetaCorta}
              </span>
              {pendientes > 0 && (
                <span className="sr-only">
                  , {pendientes} {pendientes === 1 ? 'descanso pendiente' : 'descansos pendientes'}
                </span>
              )}
            </>
          )
          return (
            <li key={g.id} className="flex min-w-0 flex-1">
              {!bloqueado ? (
                <Link
                  href={destino.href}
                  onClick={(e) => {
                    if (esClicQueNavegaAca(e)) onTocado(g.id)
                  }}
                  aria-current={activo ? 'true' : undefined}
                  className={clase}
                >
                  {contenido}
                </Link>
              ) : (
                <button type="button" onClick={() => onBloqueada(destino)} className={clase}>
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
