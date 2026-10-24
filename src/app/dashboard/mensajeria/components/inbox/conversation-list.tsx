'use client'

// La lista de chats, como WhatsApp (23/oct/2026, pedido del dueño con
// capturas de su iPhone y de su Mac):
// - Celular: la de iOS. Arriba una barra fija con "…", el "Chats" chico que
//   aparece al scrollear, programados y el "+" verde; abajo, lo que scrollea:
//   el título grande, el buscador, los chips y las filas. La barra del
//   dashboard flota encima del final de la lista (ver el padding de abajo).
//   Lo que se abre desde acá (el chat, Programados, las secciones del "…") es
//   una CAPA fija que la tapa: la lista queda montada debajo, quieta.
// - Compu: la columna del medio de la Mac, con el buscador y los chips fijos
//   arriba de las filas. Mide --ancho-lista (mensajeria-client.tsx).
// - Lo táctil, como iOS: las filas, los chips y los botones de la lista se
//   resaltan al apretarlos con el dedo quieto y el resaltado se va apenas la
//   lista scrollea (apretado.ts; con :active quedaba marcado todo el scroll), y
//   mantener el dedo no selecciona texto ni abre el menú de iOS.

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction, type UIEvent,
} from 'react'
import {
  CalendarClock, ChevronLeft, ChevronRight, Instagram, Loader2, MessageSquare, Plus, Search, SearchX, Settings, Tag, X,
  type LucideIcon,
} from 'lucide-react'
import { useEsCelular } from '@/hooks/use-es-celular'
import { cn } from '@/lib/utils'
import { WhatsAppIcon } from '../shared/icons'
import { useMensajeria } from '../shared/mensajeria-context'
import type { ConversationWithRelations, PlatformFilter } from '../shared/types'
import { useDiaLocal } from '../shared/use-dia-local'
import { apretarAlTocar } from './apretado'
import { FilaChat } from './fila-chat'
import { VistaProgramados } from './vista-programados'

// Lo que ocupa una fila además de su línea de etiquetas (ver fila-chat.tsx).
// Celular: pl-4 + foto de 52 + gap-3 + pr-4. Compu: mx-2 a cada lado + pl-3 +
// foto de 48 + gap-3 + pr-3. Si cambian esas clases, cambian estos números.
const MARGEN_ETIQUETAS_CELULAR = 16 + 52 + 12 + 16
const MARGEN_ETIQUETAS_COMPU = 8 + 8 + 12 + 48 + 12 + 12

const formatoNumero = new Intl.NumberFormat('es-AR')

export function ConversationList({
  onNewChat,
  onOpenSettings,
  onProgramar,
  menu,
  seccionAbierta = false,
}: {
  onNewChat: () => void
  onOpenSettings: () => void
  /** Abre el diálogo de programar un mensaje (vista de programados). */
  onProgramar: () => void
  /** El botón "…" con su menú, que arma mensajeria-client (sabe de las secciones). */
  menu: ReactNode
  /** Hay una sección abierta (Difusiones, Workflows…): en la compu ocupa la columna de la lista. */
  seccionAbierta?: boolean
}) {
  const { showMobileChat, inboxTab, setInboxTab } = useMensajeria()
  const esCelular = useEsCelular()
  // Filtro "No leídos" local (no toca el context ni su realtime endurecido).
  // Vive acá y no en la lista: ir a programados y volver no lo apaga.
  const [unreadOnly, setUnreadOnly] = useState(false)
  const programados = inboxTab === 'scheduled'
  // En la compu, Programados y las secciones ocupan la columna de la lista.
  const ocultaEnLaCompu = programados || seccionAbierta
  // Tapada: en el celular, por cualquier capa (el chat, Programados o una
  // sección), que la deja montada DEBAJO en vez de esconderla: volver
  // deslizando desde el borde la va descubriendo, como en iOS. En la compu, por
  // lo que la reemplaza. Tapada no se toca, no se enfoca y el lector de
  // pantalla no la lee.
  const tapada = ocultaEnLaCompu || (esCelular && showMobileChat)

  return (
    <>
      <section
        aria-label="Chats"
        aria-hidden={tapada || undefined}
        inert={tapada}
        // La "pantalla de abajo" de iOS (la barra de "Chats", el buscador, los
        // chips y las filas): con una capa encima, en el celular, el paralaje la
        // corre (globals.css, «Paralaje de la lista»). Por eso no tiene nada fixed
        // adentro (el menú "…" va a un portal) y las capas (el chat, Programados,
        // las secciones) son hermanas suyas, nunca hijas: con un transform acá,
        // una capa adentro se mediría contra la lista y no contra la pantalla.
        data-wa-lista-paralaje=""
        className={cn(
          'flex min-h-0 w-full shrink-0 flex-col overflow-clip bg-[var(--wa-bg)] lg:w-[var(--ancho-lista)] lg:border-r lg:border-[var(--wa-divider)]',
          ocultaEnLaCompu && 'lg:hidden',
        )}
      >
        <ListaChats
          unreadOnly={unreadOnly}
          setUnreadOnly={setUnreadOnly}
          ocultaEnLaCompu={ocultaEnLaCompu}
          onNewChat={onNewChat}
          onOpenSettings={onOpenSettings}
          menu={menu}
        />
      </section>
      {/* Con una sección abierta no va: en la compu quedaba en la columna de la
          lista y la sección se apretaba en el lugar del chat. */}
      {programados && !seccionAbierta && (
        <VistaProgramados onVolver={() => setInboxTab('inbox')} onProgramar={onProgramar} />
      )}
    </>
  )
}

function ListaChats({
  unreadOnly,
  setUnreadOnly,
  ocultaEnLaCompu,
  onNewChat,
  onOpenSettings,
  menu,
}: {
  unreadOnly: boolean
  setUnreadOnly: Dispatch<SetStateAction<boolean>>
  ocultaEnLaCompu: boolean
  onNewChat: () => void
  onOpenSettings: () => void
  menu: ReactNode
}) {
  const {
    conversations,
    activeConv, setActiveConv,
    search, setSearch,
    platformFilter, setPlatformFilter,
    tags, tagFilter, setTagFilter,
    showMobileChat, setShowMobileChat,
    setInboxTab,
    setShowProfile,
    isConfigured, isInstagramConfigured,
    filteredConversations,
    buscando, hayMasConversaciones, cargandoMas, cargarMasConversaciones,
    conversacionesCargadas, totalConversaciones,
  } = useMensajeria()
  const dia = useDiaLocal()
  const esCelular = useEsCelular()

  // El número de «No leídos» es el de los chats sin leer cargados, el mismo del
  // globo de Chats en la columna de secciones (y el de WhatsApp): no cambia al
  // elegir una etiqueta o un canal, ni al buscar. Antes contaba sólo lo
  // filtrado: al elegir una etiqueta sin chats sin leer el número desaparecía,
  // la fila de chips se corría 14 px y la etiqueta recién elegida quedaba
  // debajo del degradé.
  const unreadTotal = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations],
  )
  const visibles = useMemo(
    () => (unreadOnly ? filteredConversations.filter((c) => c.unread_count > 0) : filteredConversations),
    [filteredConversations, unreadOnly],
  )
  const hayFilas = visibles.length > 0

  const textoBuscado = search.trim()
  // Scroll infinito: mientras se BUSCA no se pagina — la búsqueda ya consulta
  // toda la base, y seguir trayendo páginas viejas sólo mete ruido.
  const buscandoAlgo = textoBuscado.length >= 2
  const paginar = !buscandoAlgo && !unreadOnly && hayMasConversaciones
  const sinFiltros = !unreadOnly && platformFilter === 'all' && tagFilter === null
  const filtro = describirFiltro(unreadOnly, platformFilter, tags.find((t) => t.id === tagFilter)?.name ?? null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const centinelaRef = useRef<HTMLDivElement>(null)
  const tituloRef = useRef<HTMLParagraphElement>(null)
  const posicionRef = useRef(0)
  const [tituloChico, setTituloChico] = useState(false)
  const [anchoLista, setAnchoLista] = useState<number | null>(null)

  useEffect(() => {
    const nodo = centinelaRef.current
    const raiz = scrollRef.current
    if (!nodo || !raiz || !paginar) return
    const obs = new IntersectionObserver(
      (entradas) => { if (entradas[0]?.isIntersecting) cargarMasConversaciones() },
      // 400 px de anticipo dentro de la lista: la página siguiente empieza a
      // viajar antes de que el usuario llegue al fondo, así el scroll no se corta.
      { root: raiz, rootMargin: '0px 0px 400px 0px' },
    )
    obs.observe(nodo)
    return () => obs.disconnect()
  }, [paginar, cargarMasConversaciones, hayFilas])

  // El "Chats" chico de la barra aparece cuando el grande ya se fue más de la
  // mitad por arriba, como en iOS. En la compu el grande no está y el chico
  // queda siempre (por clase).
  useEffect(() => {
    const titulo = tituloRef.current
    const raiz = scrollRef.current
    if (!titulo || !raiz) return
    const obs = new IntersectionObserver(
      ([entrada]) => { if (entrada) setTituloChico(entrada.intersectionRatio < 0.5) },
      { root: raiz, threshold: [0, 0.5, 1] },
    )
    obs.observe(titulo)
    return () => obs.disconnect()
  }, [])

  // El ancho de la lista decide cuántas etiquetas entran en cada fila. Si la
  // lista llega a estar escondida mide 0: eso no se guarda.
  useEffect(() => {
    const raiz = scrollRef.current
    if (!raiz) return
    const obs = new ResizeObserver(([entrada]) => {
      const ancho = entrada ? Math.round(entrada.contentRect.width) : 0
      if (ancho > 0) setAnchoLista(ancho)
    })
    obs.observe(raiz)
    return () => obs.disconnect()
  }, [])

  // Al volver, la lista sigue donde estaba. En el celular nunca se esconde
  // (las capas la tapan) y conserva el scroll sola; en la compu, Programados y
  // las secciones la esconden (display: none) y el navegador la devuelve arriba
  // de todo: acá vuelve a donde estaba.
  const guardarPosicion = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.clientHeight > 0) posicionRef.current = el.scrollTop
  }
  useLayoutEffect(() => {
    if (showMobileChat || ocultaEnLaCompu) return
    const el = scrollRef.current
    if (el && el.scrollTop === 0 && posicionRef.current > 0) el.scrollTop = posicionRef.current
  }, [showMobileChat, ocultaEnLaCompu])

  const elegir = useCallback(
    (conv: ConversationWithRelations) => {
      setActiveConv(conv)
      setShowMobileChat(true)
      setShowProfile(false)
    },
    [setActiveConv, setShowMobileChat, setShowProfile],
  )

  const limpiarFiltros = () => {
    setUnreadOnly(false)
    setPlatformFilter('all')
    setTagFilter(null)
  }

  const anchoEtiquetas =
    anchoLista === null ? null : Math.max(0, anchoLista - (esCelular ? MARGEN_ETIQUETAS_CELULAR : MARGEN_ETIQUETAS_COMPU))
  const idElegida = activeConv?.id ?? null

  return (
    <>
      <header
        className={cn(
          'relative flex h-11 shrink-0 items-center gap-2 border-b-[0.5px] bg-[var(--wa-bg)] px-4 transition-colors duration-200 lg:h-14 lg:px-3',
          // Mantener el dedo sobre la barra no selecciona "Chats" ni abre el
          // menú de iOS (como las filas y los chips).
          'select-none [-webkit-touch-callout:none]',
          tituloChico ? 'border-[var(--wa-divider)] lg:border-transparent' : 'border-transparent',
        )}
      >
        {menu}
        <p
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-28 truncate text-center text-[17px] font-semibold text-[var(--wa-text)] transition-opacity duration-200 lg:inset-x-16',
            tituloChico ? 'opacity-100' : 'opacity-0 lg:opacity-100',
          )}
        >
          Chats
        </p>
        <div className="ml-auto flex items-center gap-2.5">
          <BotonRedondo etiqueta="Mensajes programados" onClick={() => setInboxTab('scheduled')} className="lg:hidden">
            <CalendarClock aria-hidden className="size-5" strokeWidth={1.9} />
          </BotonRedondo>
          <button
            type="button"
            onClick={onNewChat}
            aria-label="Nueva conversación"
            title="Nueva conversación"
            className={cn(
              'flex size-9 items-center justify-center rounded-full bg-[var(--wa-accent)] text-[var(--wa-on-accent)] outline-none [-webkit-tap-highlight-color:transparent]',
              'transition-[background-color,scale] duration-150 active:scale-95 active:bg-[var(--wa-accent-hover)] lg:size-8 lg:hover:bg-[var(--wa-accent-hover)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)]',
            )}
          >
            <Plus aria-hidden className="size-[22px] lg:size-5" strokeWidth={2.5} />
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={guardarPosicion}
        className="wa-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
        // En el celular la barra de vidrio del dashboard flota sobre el final de
        // la lista: --alto-barra-inferior (del shell) es lo que ocupa, área
        // segura incluida. Sin barra (modo foco) queda el área segura sola.
        style={{ paddingBottom: 'calc(max(var(--alto-barra-inferior, 0px), env(safe-area-inset-bottom, 0px)) + 8px)' }}
      >
        <h1 className="sr-only">Chats</h1>
        <p
          ref={tituloRef}
          aria-hidden
          className="select-none px-4 pb-1.5 pt-0.5 text-[34px] font-bold leading-[41px] tracking-tight text-[var(--wa-text)] [-webkit-touch-callout:none] lg:hidden"
        >
          Chats
        </p>

        {/* En la compu el buscador y los chips quedan fijos arriba de las filas. */}
        <div className="bg-[var(--wa-bg)] lg:sticky lg:top-0 lg:z-10">
          <div className="px-4 pb-3 pt-1 lg:px-3 lg:pb-2.5 lg:pt-0.5">
            <div className="relative flex h-10 items-center rounded-full bg-[var(--wa-field)] lg:h-9 lg:focus-within:ring-1 lg:focus-within:ring-white/15">
              <span aria-hidden className="pointer-events-none absolute left-3.5 flex text-[var(--wa-text-2)] lg:left-3">
                {buscando
                  ? <Loader2 className="size-[18px] animate-spin lg:size-4" />
                  : <Search className="size-[18px] lg:size-4" />}
              </span>
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Buscar chats"
                placeholder="Buscar"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && search) {
                    e.preventDefault()
                    setSearch('')
                  }
                }}
                // 16 px en todo lo táctil: iOS hace zoom al enfocar un campo de menos.
                className="h-full w-full appearance-none rounded-full bg-transparent pl-10 pr-10 text-base text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] lg:pl-9 lg:pointer-fine:text-[14px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Borrar la búsqueda"
                  className="absolute right-1.5 flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60"
                >
                  <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--wa-text-3)]">
                    <X aria-hidden className="size-3 text-[var(--wa-bg)]" strokeWidth={3} />
                  </span>
                </button>
              )}
            </div>
          </div>

          <FilaChips oculta={ocultaEnLaCompu}>
            <Chip prendido={sinFiltros} onClick={limpiarFiltros}>Todos</Chip>
            <Chip prendido={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>
              No leídos
              {unreadTotal > 0 && <span className="tabular-nums">{formatoNumero.format(unreadTotal)}</span>}
            </Chip>
            {isInstagramConfigured && (
              <>
                <Chip
                  prendido={platformFilter === 'whatsapp'}
                  onClick={() => setPlatformFilter(platformFilter === 'whatsapp' ? 'all' : 'whatsapp')}
                >
                  <WhatsAppIcon className="size-3.5" />
                  WhatsApp
                </Chip>
                <Chip
                  prendido={platformFilter === 'instagram'}
                  onClick={() => setPlatformFilter(platformFilter === 'instagram' ? 'all' : 'instagram')}
                >
                  <Instagram aria-hidden className="size-3.5" />
                  Instagram
                </Chip>
              </>
            )}
            {tags.map((tag) => (
              <Chip
                key={tag.id}
                prendido={tagFilter === tag.id}
                onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </Chip>
            ))}
          </FilaChips>
        </div>

        {hayFilas ? (
          <>
            <div className="lg:pt-0.5">
              {visibles.map((conv, i) => (
                <FilaChat
                  key={conv.id}
                  conv={conv}
                  elegida={conv.id === idElegida}
                  ultima={i === visibles.length - 1}
                  pegadaALaElegida={conv.id === idElegida || visibles[i + 1]?.id === idElegida}
                  dia={dia}
                  anchoEtiquetas={anchoEtiquetas}
                  onElegir={elegir}
                />
              ))}
            </div>
            {/* Centinela del scroll infinito. */}
            <div ref={centinelaRef} />
          </>
        ) : (
          <EstadoVacio
            {...describirVacio({
              buscando,
              hayCanal: isConfigured || isInstagramConfigured,
              textoBuscado,
              unreadOnly,
              tagFilter,
              platformFilter,
              puedeTraerMas: paginar,
              onOpenSettings,
              onNewChat,
              onVerTodos: limpiarFiltros,
            })}
          />
        )}

        <PieLista
          cargandoMas={cargandoMas}
          paginar={paginar}
          onCargarMas={cargarMasConversaciones}
          lineas={[
            // Con un filtro (No leídos, un canal, una etiqueta) cuenta lo que se
            // ve, no el total: antes decía "25 conversaciones" con 3 en pantalla.
            !buscandoAlgo && filtro && hayFilas
              ? `${cuantas(visibles.length)} ${filtro}${hayMasConversaciones ? ` entre las ${formatoNumero.format(conversacionesCargadas)} cargadas` : ''}`
              : null,
            !buscandoAlgo && !filtro && hayMasConversaciones && totalConversaciones > conversacionesCargadas
              ? `${formatoNumero.format(conversacionesCargadas)} de ${formatoNumero.format(totalConversaciones)} · el buscador mira todo el historial`
              : null,
            !buscandoAlgo && !filtro && !hayMasConversaciones && totalConversaciones > 0
              ? `${formatoNumero.format(totalConversaciones)} conversaciones · todo el historial`
              : null,
            buscandoAlgo && hayFilas
              ? buscando
                ? 'Buscando en todo el historial…'
                : `${formatoNumero.format(visibles.length)} resultado${visibles.length === 1 ? '' : 's'} en ${formatoNumero.format(totalConversaciones)} conversaciones`
              : null,
          ]}
        />
      </div>
    </>
  )
}

/** "1 conversación", "3 conversaciones". */
function cuantas(n: number): string {
  return `${formatoNumero.format(n)} ${n === 1 ? 'conversación' : 'conversaciones'}`
}

/** Lo que filtran los chips, para el pie: "sin leer de Instagram con «Reclamo»". Null sin filtros. */
function describirFiltro(unreadOnly: boolean, plataforma: PlatformFilter, etiqueta: string | null): string | null {
  const partes: string[] = []
  if (unreadOnly) partes.push('sin leer')
  if (plataforma !== 'all') partes.push(plataforma === 'instagram' ? 'de Instagram' : 'de WhatsApp')
  if (etiqueta) partes.push(`con «${etiqueta}»`)
  return partes.length > 0 ? partes.join(' ') : null
}

// Lo que se deja a cada lado de un chip al traerlo a la vista: en la compu, el
// degradé de BordeChips (w-14), que con la flecha encima tapaba el chip recién
// elegido; en el celular, el padding de la fila.
const MARGEN_CHIP_COMPU = 56
const MARGEN_CHIP_CELULAR = 16

/**
 * Corre la fila de chips lo justo para que `chip` quede entero a la vista, con
 * scrollLeft (scrollIntoView movería también la lista y la página).
 */
function traerALaVista(fila: HTMLElement, chip: HTMLElement, suave: boolean) {
  const maximo = fila.scrollWidth - fila.clientWidth
  if (maximo <= 0) return
  const margen = window.matchMedia('(min-width: 1024px)').matches ? MARGEN_CHIP_COMPU : MARGEN_CHIP_CELULAR
  // La fila es el offsetParent de los chips (relative): offsetLeft es la
  // posición en el contenido, sin importar cuánto esté corrida.
  const izquierda = chip.offsetLeft
  const derecha = izquierda + chip.offsetWidth
  let destino = fila.scrollLeft
  if (izquierda - margen < destino) destino = izquierda - margen
  else if (derecha + margen > destino + fila.clientWidth) destino = derecha + margen - fila.clientWidth
  destino = Math.min(maximo, Math.max(0, Math.round(destino)))
  if (Math.abs(destino - fila.scrollLeft) < 1) return
  const sinMovimiento = !suave || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  fila.scrollTo({ left: destino, behavior: sinMovimiento ? 'auto' : 'smooth' })
}

// La fila de chips. En el celular se desliza con el dedo, como en WhatsApp. En
// la compu, con el mouse no había forma de llegar a Instagram ni a las
// etiquetas (la fila mide ~1.600 px y la columna 340): la rueda vertical la
// corre de costado, el borde con más contenido se funde con un degradé y, al
// pasar el mouse, aparece una flecha de ese lado (también se llega con Tab).
// El chip que se toca queda entero a la vista (traerALaVista).
function FilaChips({ oculta, children }: { oculta: boolean; children: ReactNode }) {
  const filaRef = useRef<HTMLDivElement>(null)
  const [hay, setHay] = useState({ antes: false, despues: false })

  useEffect(() => {
    const fila = filaRef.current
    const contenido = fila?.firstElementChild
    if (!fila || !contenido) return
    const medir = () => {
      const antes = fila.scrollLeft > 1
      const despues = fila.scrollWidth - fila.clientWidth - fila.scrollLeft > 1
      setHay((h) => (h.antes === antes && h.despues === despues ? h : { antes, despues }))
    }
    // La fila cambia de ancho con la columna; el contenido, con las etiquetas
    // y el número de no leídos. El observador mide también al empezar.
    const obs = new ResizeObserver(medir)
    obs.observe(fila)
    obs.observe(contenido)
    // La rueda: un giro vertical corre la fila de costado. En el borde (ya no
    // hay más de ese lado) el giro sigue de largo y scrollea la lista, y el
    // trackpad de costado queda como siempre.
    const alRodar = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const maximo = fila.scrollWidth - fila.clientWidth
      if (maximo <= 0) return
      const paso = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * fila.clientWidth : e.deltaY
      const destino = Math.min(maximo, Math.max(0, fila.scrollLeft + paso))
      if (Math.abs(destino - fila.scrollLeft) < 0.5) return
      e.preventDefault()
      fila.scrollLeft = destino
    }
    fila.addEventListener('scroll', medir, { passive: true })
    fila.addEventListener('wheel', alRodar, { passive: false })
    return () => {
      obs.disconnect()
      fila.removeEventListener('scroll', medir)
      fila.removeEventListener('wheel', alRodar)
    }
  }, [])

  // Al verse (al montar, y en la compu al cerrar Programados o una sección, que
  // esconden la lista con display: none y la fila pierde lo que estaba
  // corrida), el filtro prendido que quedó afuera (una etiqueta, un canal) se
  // trae a la vista de una.
  useLayoutEffect(() => {
    const fila = filaRef.current
    if (oculta || !fila) return
    const prendidos = fila.querySelectorAll<HTMLElement>('[aria-pressed="true"]')
    const ultimo = prendidos[prendidos.length - 1]
    if (ultimo) traerALaVista(fila, ultimo, false)
  }, [oculta])

  // El chip tocado (con el dedo, el mouse o el teclado) queda entero a la
  // vista: si estaba cortado por el borde, o en la compu debajo del degradé y
  // la flecha, la fila se corre lo justo. Un cuadro después, con el filtro ya
  // aplicado.
  const alElegir = (e: ReactMouseEvent<HTMLDivElement>) => {
    const fila = filaRef.current
    const chip = (e.target as Element).closest<HTMLElement>('button[aria-pressed]')
    if (!fila || !chip || !fila.contains(chip)) return
    requestAnimationFrame(() => traerALaVista(fila, chip, true))
  }

  const correr = (sentido: -1 | 1) => {
    const fila = filaRef.current
    if (!fila) return
    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    fila.scrollBy({ left: sentido * Math.round(fila.clientWidth * 0.7), behavior: sinMovimiento ? 'auto' : 'smooth' })
  }

  return (
    <div className="group/chips relative">
      <div
        ref={filaRef}
        role="group"
        aria-label="Filtrar chats"
        // Deslizar los chips no tiene que cambiar de sección del dashboard.
        data-sin-swipe
        onClick={alElegir}
        // Mantener el dedo sobre un chip no selecciona su texto ni abre el menú de iOS.
        className="relative flex select-none overflow-x-auto px-4 pb-2.5 [-webkit-touch-callout:none] [scrollbar-width:none] lg:px-3 lg:pb-2 [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max gap-2">{children}</div>
      </div>
      <BordeChips lado="antes" hay={hay.antes} onClick={() => correr(-1)} />
      <BordeChips lado="despues" hay={hay.despues} onClick={() => correr(1)} />
    </div>
  )
}

// Un borde de la fila de chips en la compu: el degradé cuando hay más de ese
// lado y, encima, la flecha, que aparece al pasar el mouse por la fila (o al
// llegarle con Tab). Sin nada más de ese lado no hay flecha a la que llegar.
function BordeChips({ lado, hay, onClick }: { lado: 'antes' | 'despues'; hay: boolean; onClick: () => void }) {
  const antes = lado === 'antes'
  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-2 top-0 hidden w-14 items-center transition-opacity duration-200 lg:flex',
        antes
          ? 'left-0 justify-start bg-gradient-to-r from-[var(--wa-bg)] from-30% to-transparent pl-1.5'
          : 'right-0 justify-end bg-gradient-to-l from-[var(--wa-bg)] from-30% to-transparent pr-1.5',
        hay ? 'opacity-100' : 'opacity-0',
      )}
    >
      {hay && (
        <button
          type="button"
          onClick={onClick}
          aria-label={antes ? 'Ver los filtros anteriores' : 'Ver más filtros'}
          title={antes ? 'Filtros anteriores' : 'Más filtros'}
          className={cn(
            'pointer-events-auto flex size-7 items-center justify-center rounded-full bg-[var(--wa-raised-2)] text-[var(--wa-text)] shadow-[0_2px_8px_rgba(0,0,0,0.45)] outline-none',
            'opacity-0 transition-[opacity,background-color] duration-150 hover:bg-[var(--wa-field)] group-hover/chips:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60',
          )}
        >
          {antes
            ? <ChevronLeft aria-hidden className="size-4" strokeWidth={2.25} />
            : <ChevronRight aria-hidden className="size-4" strokeWidth={2.25} />}
        </button>
      )}
    </div>
  )
}

function BotonRedondo({
  etiqueta,
  onClick,
  className,
  children,
}: {
  etiqueta: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className={cn(
        'flex size-9 items-center justify-center rounded-full bg-[var(--wa-field)] text-[var(--wa-text)] outline-none [-webkit-tap-highlight-color:transparent]',
        'transition-[background-color,scale] duration-150 active:scale-95 active:bg-[var(--wa-raised-2)] lg:size-8 lg:hover:bg-[var(--wa-raised-2)]',
        'focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Chip({ prendido, onClick, children }: { prendido: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={prendido}
      onClick={onClick}
      // Apretado con el dedo como las filas (apretado.ts): con :active quedaba
      // marcado mientras se deslizaba la fila de chips.
      onPointerDown={apretarAlTocar}
      className={cn(
        'inline-flex h-8 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium outline-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]',
        'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-7 lg:px-3 lg:text-[13px]',
        prendido
          ? 'border-transparent bg-[var(--wa-chip-on-bg)] text-[var(--wa-chip-on-text)]'
          : 'border-white/10 text-[var(--wa-text)]/85 data-[apretada]:bg-[var(--wa-hover)] lg:hover:bg-[var(--wa-hover)]',
      )}
    >
      {children}
    </button>
  )
}

interface PropsEstadoVacio {
  icono: LucideIcon
  girando?: boolean
  titulo: string
  texto?: string
  accion?: { texto: string; onClick: () => void; principal?: boolean }
}

// Qué decir cuando no hay ninguna fila, del motivo más concreto al más general.
function describirVacio(p: {
  buscando: boolean
  hayCanal: boolean
  textoBuscado: string
  unreadOnly: boolean
  tagFilter: string | null
  platformFilter: string
  puedeTraerMas: boolean
  onOpenSettings: () => void
  onNewChat: () => void
  onVerTodos: () => void
}): PropsEstadoVacio {
  if (p.buscando) return { icono: Loader2, girando: true, titulo: 'Buscando en todo el historial…' }
  if (!p.hayCanal) {
    return {
      icono: Settings,
      titulo: 'Conectá WhatsApp o Instagram',
      texto: 'Con un canal conectado, los chats de tus clientes llegan acá.',
      accion: { texto: 'Ir a configuración', onClick: p.onOpenSettings, principal: true },
    }
  }
  if (p.textoBuscado) {
    return {
      icono: SearchX,
      titulo: `Sin resultados para “${p.textoBuscado}”`,
      texto: 'El buscador mira todo el historial, no sólo los chats cargados.',
    }
  }
  if (p.unreadOnly) {
    // Con una etiqueta o un canal además, puede haber chats sin leer en otro
    // lado (el número de «No leídos» los cuenta a todos): no se dice "al día".
    const conOtroFiltro = !!p.tagFilter || p.platformFilter !== 'all'
    return {
      icono: MessageSquare,
      titulo: conOtroFiltro ? 'No hay chats sin leer con ese filtro' : 'No hay chats sin leer',
      texto: conOtroFiltro ? undefined : 'Estás al día.',
      accion: { texto: 'Ver todos los chats', onClick: p.onVerTodos },
    }
  }
  if (p.tagFilter || p.platformFilter !== 'all') {
    // La etiqueta y el canal filtran lo que ya está cargado (el contexto), no la base.
    return {
      icono: p.tagFilter ? Tag : p.platformFilter === 'instagram' ? Instagram : MessageSquare,
      titulo: p.tagFilter ? 'Ningún chat cargado tiene esa etiqueta' : 'No hay chats de ese canal',
      texto: p.puedeTraerMas ? 'Podés traer conversaciones anteriores desde abajo.' : undefined,
      accion: { texto: 'Ver todos los chats', onClick: p.onVerTodos },
    }
  }
  return {
    icono: MessageSquare,
    titulo: 'No hay conversaciones',
    accion: { texto: 'Iniciar una conversación', onClick: p.onNewChat, principal: true },
  }
}

function EstadoVacio({ icono: Icono, girando = false, titulo, texto, accion }: PropsEstadoVacio) {
  return (
    <div className="flex flex-col items-center px-8 pb-4 pt-14 text-center lg:pt-16">
      <span className="flex size-16 items-center justify-center rounded-full bg-[var(--wa-field)]">
        <Icono aria-hidden className={cn('size-7 text-[var(--wa-text-2)]', girando && 'animate-spin')} strokeWidth={1.8} />
      </span>
      <p className="mt-4 max-w-xs break-words text-[17px] font-semibold text-[var(--wa-text)] lg:text-[15px]">{titulo}</p>
      {texto && <p className="mt-1 max-w-xs text-[15px] leading-5 text-[var(--wa-text-2)] lg:text-[13px] lg:leading-[18px]">{texto}</p>}
      {accion && (
        <button
          type="button"
          onClick={accion.onClick}
          // Con el dedo, apretado.ts (con :active quedaba achicado si el dedo
          // scrolleaba la lista); con el mouse, :active.
          onPointerDown={apretarAlTocar}
          className={cn(
            'mt-5 h-9 select-none rounded-full px-4 text-[15px] font-semibold outline-none transition-[background-color,scale] duration-150 data-[apretada]:scale-95 pointer-fine:active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:h-8 lg:text-[13px]',
            accion.principal
              ? 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)] lg:hover:bg-[var(--wa-accent-hover)]'
              : 'bg-[var(--wa-field)] text-[var(--wa-text)] lg:hover:bg-[var(--wa-raised-2)]',
          )}
        >
          {accion.texto}
        </button>
      )}
    </div>
  )
}

// El pie de la lista: el estado de la paginación y cuánto del historial se ve.
function PieLista({
  cargandoMas,
  paginar,
  onCargarMas,
  lineas,
}: {
  cargandoMas: boolean
  paginar: boolean
  onCargarMas: () => void
  lineas: (string | null)[]
}) {
  const textos = lineas.filter((l): l is string => !!l)
  if (!cargandoMas && !paginar && textos.length === 0) return null
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 pb-2 pt-4 text-center text-[13px] leading-[18px] text-[var(--wa-text-2)] lg:text-[12px] lg:leading-4">
      {cargandoMas ? (
        <p className="flex items-center gap-2">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          Cargando conversaciones anteriores…
        </p>
      ) : paginar ? (
        <button
          type="button"
          onClick={onCargarMas}
          // Apretado con el dedo como las filas (apretado.ts): está al final de la lista que scrollea.
          onPointerDown={apretarAlTocar}
          className="select-none rounded-full px-3 py-1 font-medium text-[var(--wa-accent)] outline-none transition-colors data-[apretada]:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[var(--wa-accent)]/60 lg:hover:bg-[var(--wa-hover)]"
        >
          Cargar conversaciones anteriores
        </button>
      ) : null}
      {textos.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </div>
  )
}
