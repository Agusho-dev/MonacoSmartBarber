'use client'

// La info. del contacto.
// - Celular: una capa más (el modelo de capas de Mensajería): pantalla entera
//   encima del chat, como la de WhatsApp de iOS; se vuelve con «‹» o deslizando
//   desde el borde, y el chat de abajo queda inerte mientras tanto.
// - Compu: con lugar (las columnas desde 1500 px), una columna de 360 px al
//   lado de la conversación, como WhatsApp para Mac. Sin lugar, ocupa
//   EXACTAMENTE la columna de la conversación, con el contenido centrado: antes
//   tapaba sólo 360 px de la derecha y cortaba las burbujas a mitad de texto y
//   las acciones del encabezado.
// La columna la arma mensajeria-client: el contenedor de las columnas es
// `relative`, define --ancho-secciones y --ancho-lista (de dónde arranca la
// conversación) y es el @container/columnas. Este panel va después del chat.
//
// Al cerrarse, el foco vuelve a lo que lo abrió («Perfil», el nombre del
// encabezado): en el celular lo hace el gesto de volver (es una capa), en la
// compu el efecto de acá (foco-de-vuelta.ts).

import { useEffect, useLayoutEffect, useRef, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { Archive, CalendarClock, Check, CheckCircle2, ChevronLeft, Instagram, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEsCelular } from '@/hooks/use-es-celular'
import { Avatar } from '../shared/avatar'
import { StatusBadge } from '../shared/icons'
import { displayName, formatCurrency } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import type { ClienteInicial } from '../dialogs/schedule-dialog'
import { useDeslizarParaVolver } from './deslizar-para-volver'
import { devolverFoco, origenDelFoco } from './foco-de-vuelta'
import { subtituloDeContacto } from './contacto'

export function ClientProfile({
  onProgramar,
}: {
  /**
   * Si se pasa, aparece «Programar» entre las acciones: abre el diálogo de
   * mensajes programados con este cliente (con su foto, si tiene). Sólo con
   * una ficha de cliente (una conversación sin client_id no tiene a quién
   * programarle).
   */
  onProgramar?: (cliente: ClienteInicial) => void
}) {
  const {
    activeConv, showProfile, setShowProfile,
    tags, clientVisits, loadingVisits,
    handleStatusChange, handleToggleTag,
    taggingConv, isActing,
  } = useMensajeria()
  const esCelular = useEsCelular()
  const capaRef = useRef<HTMLElement>(null)
  const volverRef = useRef<HTMLButtonElement>(null)
  const cerrarRef = useRef<HTMLButtonElement>(null)

  // En el celular, volver al chat deslizando desde el borde (o con «‹», animado).
  // Es una capa: una entrada del historial encima de la del chat, así el
  // «atrás» del sistema vuelve al chat (deslizar-para-volver.ts).
  const volverAnimado = useDeslizarParaVolver(
    capaRef,
    esCelular && showProfile && !!activeConv,
    () => setShowProfile(false),
  )

  // Al abrir, el foco pasa al panel («‹» en el celular, la X en la compu): lo
  // de abajo queda tapado (en el celular, además, inerte) y el foco se quedaba
  // en un botón que ya no se ve.
  useEffect(() => {
    if (!showProfile) return
    ;(esCelular ? volverRef : cerrarRef).current?.focus({ preventScroll: true })
  }, [showProfile, esCelular])

  // En la compu, al cerrar, el foco vuelve a lo que lo abrió. De layout: anota
  // el origen antes de que el efecto de arriba mueva el foco al panel.
  useLayoutEffect(() => {
    const panel = capaRef.current
    if (!showProfile || esCelular || !panel) return
    const origen = origenDelFoco(panel)
    return () => devolverFoco(origen, panel)
  }, [showProfile, esCelular])

  if (!showProfile || !activeConv) return null

  const nombre = displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform)
  const subtitulo = subtituloDeContacto(activeConv)
  const notas = activeConv.client?.notes?.trim()
  const cerrar = () => setShowProfile(false)
  const clienteId = activeConv.client_id
  // Con la foto que se ve arriba: «Para» la muestra en vez de las iniciales.
  const programar = onProgramar && clienteId
    ? () => onProgramar({
        id: clienteId,
        nombre: activeConv.client?.name?.trim() || nombre,
        foto: activeConv.platform_user_avatar ?? null,
      })
    : null
  // En la compu, Escape con el foco adentro cierra el panel.
  const alTeclear = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !esCelular && !e.defaultPrevented) cerrar()
  }

  return (
    <aside
      ref={capaRef}
      // El shell cambia de sección deslizando de costado: acá no.
      data-sin-swipe=""
      // El nombre de su entrada del historial (#/chat/perfil).
      data-capa="perfil"
      aria-label="Info. del contacto"
      onKeyDown={alTeclear}
      className={cn(
        // Celular: pantalla entera, entra desde la derecha como en iOS; lo de
        // abajo se oscurece mientras entra y mientras se desliza (wa-capa). De
        // la duración, sólo la de la animación de entrada: con duration-*, que
        // fija transition-duration, el panel quedaba con `transition: all` y
        // lo que el gesto le saca al terminar (el transform) volvía animado.
        'wa-capa fixed inset-0 z-[60] flex min-h-0 flex-col bg-[var(--wa-bg)] max-lg:touch-pan-y max-lg:touch-pinch-zoom max-lg:animation-duration-300 max-lg:ease-out max-lg:motion-safe:animate-in max-lg:motion-safe:slide-in-from-right',
        // Compu sin lugar: encima de la conversación, exactamente sobre ella
        // (arranca donde terminan la columna de secciones y la lista).
        'lg:absolute lg:inset-y-0 lg:right-0 lg:left-[calc(var(--ancho-secciones)+var(--ancho-lista))] lg:z-30 lg:animation-duration-200 lg:motion-safe:animate-in lg:motion-safe:fade-in-0',
        // Compu con lugar (las columnas desde 1500 px: la conversación queda
        // en 550 px o más): una columna más, al lado.
        '@min-[1500px]/columnas:static @min-[1500px]/columnas:z-auto @min-[1500px]/columnas:w-[360px] @min-[1500px]/columnas:shrink-0 @min-[1500px]/columnas:border-l @min-[1500px]/columnas:border-[var(--wa-divider)]',
      )}
    >
      {/* En la compu, del alto del encabezado del chat y de la lista (h-14). */}
      <header className="relative flex h-14 shrink-0 items-center justify-center border-b-[0.5px] border-[var(--wa-divider)] bg-[var(--wa-bar)] px-12 backdrop-blur-xl backdrop-saturate-150 lg:justify-start lg:gap-3 lg:border-b lg:px-4">
        {/* Con el teclado, el anillo verde de foco del resto de Mensajería (sin
            él se veía el azul del sistema, cortado contra el borde). */}
        <button
          ref={volverRef}
          type="button"
          onClick={volverAnimado}
          className="absolute left-0.5 top-1/2 flex h-11 -translate-y-1/2 items-center rounded-lg pr-2 text-[var(--wa-accent)] outline-none transition-opacity [-webkit-tap-highlight-color:transparent] active:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:hidden"
          aria-label="Volver al chat"
        >
          <ChevronLeft className="size-[30px]" strokeWidth={2.25} />
        </button>
        <button
          ref={cerrarRef}
          type="button"
          onClick={cerrar}
          className="hidden size-8 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] outline-none transition-colors hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:flex"
          aria-label="Cerrar la info. del contacto"
          title="Cerrar"
        >
          <X className="size-[18px]" />
        </button>
        <h2 className="truncate text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">Info. del contacto</h2>
      </header>

      <div className="wa-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain max-lg:touch-pan-y max-lg:touch-pinch-zoom">
        <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-7 lg:gap-5 lg:pt-6">
          {/* Foto, nombre y teléfono. La foto se dibuja a 96 px, a tamaño real
              (antes era la de 48 agrandada al doble y se veía blanda). */}
          <div className="flex flex-col items-center text-center">
            <Avatar name={nombre} size={96} avatarUrl={activeConv.platform_user_avatar} />
            <p className="mt-4 max-w-full break-words text-[22px] font-semibold leading-tight text-[var(--wa-text)] lg:text-[20px]">
              {nombre}
            </p>
            {subtitulo && subtitulo.texto !== nombre && (
              <p className="mt-1 flex max-w-full items-center gap-1.5 text-[15px] text-[var(--wa-text-2)] lg:text-[14px]">
                {subtitulo.esInstagram && <Instagram className="size-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{subtitulo.texto}</span>
              </p>
            )}
            {activeConv.status !== 'open' && (
              <div className="mt-2.5"><StatusBadge status={activeConv.status} /></div>
            )}
          </div>

          {/* Acciones */}
          <div className={cn('grid gap-2.5', programar ? 'grid-cols-3' : 'grid-cols-2')}>
            {activeConv.status === 'open' ? (
              <>
                <Accion icono={CheckCircle2} etiqueta="Cerrar" onClick={() => handleStatusChange('closed')} disabled={isActing} />
                <Accion icono={Archive} etiqueta="Archivar" onClick={() => handleStatusChange('archived')} disabled={isActing} />
              </>
            ) : (
              <Accion icono={RotateCcw} etiqueta="Reabrir" onClick={() => handleStatusChange('open')} disabled={isActing} className="col-span-2" />
            )}
            {programar && <Accion icono={CalendarClock} etiqueta="Programar" onClick={programar} />}
          </div>

          {/* Etiquetas: tocar una la pone o la saca. */}
          {tags.length > 0 && (
            <Seccion titulo="Etiquetas">
              <div className="flex flex-wrap gap-2 p-3.5 lg:gap-1.5 lg:p-3">
                {tags.map(tag => {
                  const puesta = !!activeConv.tags?.some(t => t.tag_id === tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleToggleTag(activeConv.id, tag.id)}
                      disabled={taggingConv}
                      aria-pressed={puesta}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-medium transition-colors disabled:opacity-60 lg:px-2.5 lg:py-1 lg:text-[12px]',
                        !puesta && 'border-[var(--wa-divider)] text-[var(--wa-text-2)] hover:border-white/20 hover:text-[var(--wa-text)]',
                      )}
                      // Puesta: el color de la etiqueta tiñe el fondo y la letra va
                      // aclarada con blanco, como en la lista (fila-chat). Al 65 %
                      // la peor (el gris) da 5:1 sobre su fondo; con el color crudo,
                      // 2,6 a 3,7.
                      style={puesta ? {
                        color: `color-mix(in srgb, ${tag.color} 65%, white)`,
                        backgroundColor: `color-mix(in srgb, ${tag.color} 18%, transparent)`,
                        borderColor: `color-mix(in srgb, ${tag.color} 45%, transparent)`,
                      } : undefined}
                    >
                      {puesta
                        ? <Check className="size-3.5 shrink-0" strokeWidth={2.75} aria-hidden="true" />
                        : <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />}
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </Seccion>
          )}

          {/* Notas del cliente */}
          {notas && (
            <Seccion titulo="Notas">
              <p className="whitespace-pre-wrap px-4 py-3 text-[15px] leading-relaxed text-[var(--wa-text)] lg:px-3.5 lg:text-[13.5px]">{notas}</p>
            </Seccion>
          )}

          {/* Historial de visitas */}
          <Seccion titulo="Últimas visitas">
            {loadingVisits ? (
              <div className="flex justify-center py-5">
                <div className="size-5 animate-spin rounded-full border-2 border-[var(--wa-raised-2)] border-t-[var(--wa-accent)]" />
                <span className="sr-only" role="status">Cargando visitas</span>
              </div>
            ) : clientVisits.length === 0 ? (
              <p className="px-4 py-3.5 text-[14px] text-[var(--wa-text-2)] lg:px-3.5 lg:text-[13px]">Sin visitas registradas</p>
            ) : (
              <ul className="divide-y divide-[var(--wa-divider)]">
                {clientVisits.map(visit => (
                  <li key={visit.id} className="flex items-center gap-3 px-4 py-3 lg:px-3.5 lg:py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-[var(--wa-text)] lg:text-[13.5px]">{visit.service?.name || 'Servicio'}</p>
                      <p className="truncate text-[13px] text-[var(--wa-text-2)] lg:text-[12px]">
                        {[
                          visit.barber?.full_name,
                          new Date(visit.started_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums text-[var(--wa-accent)] lg:text-[13.5px]">
                      {formatCurrency(visit.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      </div>
    </aside>
  )
}

// Una sección de la info. del contacto: el título arriba y el contenido en una
// tarjeta redondeada, como las listas agrupadas de iOS.
function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-4 text-[13px] font-medium text-[var(--wa-text-2)] lg:px-3.5 lg:text-[12.5px]">{titulo}</h3>
      <div className="overflow-hidden rounded-2xl bg-[var(--wa-raised)] lg:rounded-xl">{children}</div>
    </section>
  )
}

function Accion({
  icono: Icono, etiqueta, onClick, disabled, className,
}: {
  icono: ComponentType<{ className?: string }>
  etiqueta: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-2xl bg-[var(--wa-raised)] px-2 py-3 text-[13px] font-medium text-[var(--wa-text)] transition-colors hover:bg-[var(--wa-raised-2)] active:bg-[var(--wa-raised-2)] disabled:opacity-50 lg:rounded-xl lg:py-2.5 lg:text-[12.5px]',
        className,
      )}
    >
      <Icono className="size-[22px] text-[var(--wa-accent)] lg:size-5" />
      {etiqueta}
    </button>
  )
}
