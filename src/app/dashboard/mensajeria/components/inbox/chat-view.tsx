'use client'

// El chat abierto. En el celular es la pantalla de chat de WhatsApp de iOS: el
// hilo ocupa toda la pantalla y el encabezado y el composer flotan encima,
// translúcidos (los mensajes pasan por debajo, desenfocados). En la compu es
// WhatsApp para Mac: encabezado, hilo y composer uno debajo del otro.
//
// En el celular el chat es una CAPA fija que tapa al shell entero (el modelo de
// capas de Mensajería): debajo quedan montados y quietos el encabezado del
// shell, la lista de chats y la barra de vidrio, así al volver deslizando se ve
// la pantalla de verdad.

import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  AlertCircle, Archive, CalendarPlus, CalendarSearch, CheckCircle2, ChevronLeft, Clock,
  Download, Ellipsis, ExternalLink, FileIcon, FileText, Instagram, Loader2, MessagesSquare,
  Plus, RotateCcw, Search, SendHorizontal, Settings, Sparkles, UserRound, X, Zap,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useEsCelular } from '@/hooks/use-es-celular'
import { Avatar } from '../shared/avatar'
import { MessageStatusIcon } from '../shared/icons'
import { displayName, formatTime, nombreLegibleDePlantilla, plantillaDelMarcador } from '../shared/helpers'
import { AudioPlayer } from '../shared/audio-player'
import { useMensajeria } from '../shared/mensajeria-context'
import type { QuickReply } from '../shared/mensajeria-context'
import { useDiaLocal } from '../shared/use-dia-local'
import type { Message } from '@/lib/types/database'
import type { WaTemplate } from '../shared/types'
import { AppointmentAvailabilityDialog } from '@/components/appointments/appointment-availability-dialog'
import {
  AppointmentBookingDialog,
  type BookingServiceOption,
} from '@/components/appointments/appointment-booking-dialog'
import { useDeslizarParaVolver } from './deslizar-para-volver'
import { subtituloDeContacto } from './contacto'
import { campoTrasDevolucion } from './borrador'
import {
  crearPastilla, diaDeLaPastilla, diaDelMensaje, etiquetaDeDia, PASTILLA_ESCONDIDA,
  type SeparadorMedido, type VistaPastilla,
} from './pastilla-fecha'
import { trozosDePlantilla } from './plantilla'

const MAX_MESSAGE_INPUT_PX = 280

// Los menús salen por un portal a <body>, fuera de .wa-scope: llevan la clase
// para tener los tokens. En el celular, renglones de toque cómodo, como iOS.
const MENU =
  'wa-scope min-w-56 rounded-2xl border border-[var(--wa-divider)] bg-[var(--wa-raised)] p-1.5 text-[var(--wa-text)] shadow-2xl shadow-black/60 lg:rounded-xl lg:p-1'
const ITEM =
  'gap-3 rounded-xl px-3 py-2.5 text-[15px] text-[var(--wa-text)] focus:bg-[var(--wa-selected)] focus:text-[var(--wa-text)] lg:gap-2.5 lg:rounded-lg lg:px-2.5 lg:py-2 lg:text-[13.5px]'
const ICONO_ITEM = 'size-[18px] lg:size-4'

// La pastilla de la fecha: la de los separadores del hilo y la flotante.
const FECHA =
  'rounded-full bg-[var(--wa-date-chip)] px-3 py-[3px] text-[12.5px] font-medium text-[var(--wa-text-2)]'

const NOMBRE_ADJUNTO: Record<string, string> = {
  image: 'Foto',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
}

// La última burbuja de cada tanda lleva la colita (-out/-in); las demás, no (-fill-).
function claseBurbuja(isOut: boolean, colita: boolean) {
  if (colita) return isOut ? 'wa-bubble-out' : 'wa-bubble-in'
  return isOut ? 'wa-fill-out' : 'wa-fill-in'
}

// Texto con la hora y las tildes flotando abajo a la derecha. El .wa-spacer
// escribe la misma hora, invisible, para reservarle su lugar en la última línea
// (ver .wa-meta en globals.css).
function TextoConHora({
  msg, isOut, className, children,
}: { msg: Message; isOut: boolean; className?: string; children: ReactNode }) {
  const hora = formatTime(msg.created_at)
  return (
    <div className="relative">
      <p className={cn('whitespace-pre-wrap', className)}>
        {children}
        <span className={cn('wa-spacer', isOut && 'wa-spacer-out')} data-hora={hora} aria-hidden="true" />
      </p>
      <span className={cn('wa-meta', isOut ? 'wa-meta-out' : 'wa-meta-in')}>
        {hora}
        {isOut && <MessageStatusIcon status={msg.status} />}
      </span>
    </div>
  )
}

// La hora en su propio renglón, para audio, documentos, plantillas y botones.
function HoraEnFila({ msg, isOut }: { msg: Message; isOut: boolean }) {
  return (
    <div
      className={cn(
        'mt-0.5 flex items-center justify-end gap-[3px] text-[11px] leading-[15px] tabular-nums',
        isOut ? 'text-[var(--wa-meta-out)]' : 'text-[var(--wa-meta-in)]',
      )}
    >
      {formatTime(msg.created_at)}
      {isOut && <MessageStatusIcon status={msg.status} />}
    </div>
  )
}

export function ChatView({
  onOpenSettings,
  onNewChat,
}: {
  onOpenSettings: () => void
  onNewChat: () => void
}) {
  const {
    activeConv, conversations, messages, loadingMessages,
    messageInput, setMessageInput,
    showMobileChat, setShowMobileChat,
    showProfile, setShowProfile, loadVisits,
    messagesEndRef,
    isConfigured, isInstagramConfigured,
    canReply, replyWindowState, replyWindowLeft,
    handleSend, handleResend, handleStatusChange,
    handleOpenTemplateDialog,
    handleAutoTag, autoTagging,
    isSending, isActing,
    waTemplates,
    quickReplies,
    branches,
  } = useMensajeria()
  const esCelular = useEsCelular()
  // La clave de hoy, para "Hoy" / "Ayer" en los separadores (el render no lee el reloj).
  const hoy = useDiaLocal()

  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showBooking, setShowBooking] = useState(false)
  const [appointmentServices, setAppointmentServices] = useState<BookingServiceOption[]>([])

  const loadAppointmentServices = async () => {
    if (appointmentServices.length) return
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data } = await supabase
      .from('services')
      .select('id, name, price, duration_minutes, branch_id, booking_mode')
      .eq('is_active', true)
    setAppointmentServices((data ?? []) as BookingServiceOption[])
  }

  const openAvailability = () => setShowAvailability(true)
  const openBooking = async () => {
    await loadAppointmentServices()
    setShowBooking(true)
  }

  const [quickReplySearch, setQuickReplySearch] = useState('')
  const quickReplySearchRef = useRef<HTMLInputElement>(null)
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null)
  const raizRef = useRef<HTMLElement>(null)
  const capaRef = useRef<HTMLDivElement>(null)
  const hiloRef = useRef<HTMLDivElement>(null)
  const contenidoRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLElement>(null)

  const hayChat = !!activeConv
  const puedeEscribir = !!activeConv && activeConv.status === 'open' && canReply
  // En el celular, con la info. del contacto encima (otra capa), el chat queda
  // debajo: ni se toca, ni se enfoca, ni lo lee el lector de pantalla.
  const tapado = esCelular && showProfile && hayChat

  // ── El campo ──
  // Lo que se escribe mientras sale un mensaje no se pierde (borrador.ts): si
  // el envío falla, el contexto vuelve a poner lo que no salió y pisaría lo
  // escrito mientras tanto; acá se ve ese cambio y se unen los dos. Hasta que
  // el contexto reciba la unión (al escribir o al mandar), el campo la muestra
  // desde `unido`. Se sigue con el patrón de "estado anterior" (no un efecto).
  const [enVuelo, setEnVuelo] = useState<string | null>(null)
  const [unido, setUnido] = useState<string | null>(null)
  const [propio, setPropio] = useState<string | null>(null)
  const [campoAntes, setCampoAntes] = useState(messageInput)
  const [enviandoAntes, setEnviandoAntes] = useState(isSending)
  if (campoAntes !== messageInput || enviandoAntes !== isSending) {
    setCampoAntes(messageInput)
    setEnviandoAntes(isSending)
    if (campoAntes !== messageInput) {
      const devuelto = campoTrasDevolucion({ enVuelo, antes: campoAntes, ahora: messageInput, propio })
      if (devuelto !== null) setUnido(devuelto)
    }
    // Terminó el envío (salió o volvió): ya no hay nada en vuelo.
    if (enviandoAntes && !isSending) setEnVuelo(null)
  }
  const valorCampo = unido ?? messageInput
  const hasText = valorCampo.trim().length > 0

  // Todo lo que el chat pone en el campo pasa por acá: se anota como propio
  // (no es una devolución del contexto) y reemplaza a una unión pendiente.
  const ponerEnElCampo = (valor: string) => {
    setPropio(valor)
    setUnido(null)
    setMessageInput(valor)
  }

  // handleSend lee el campo del render del contexto: para mandar una unión
  // recién puesta hace falta el handleSend del render siguiente.
  const enviarDelContexto = useRef(handleSend)
  useLayoutEffect(() => {
    enviarDelContexto.current = handleSend
  })

  // El campo crece con el texto hasta un tope. Corre también al aparecer el
  // campo y al cruzar el corte del celular, donde cambian la letra y el relleno.
  useEffect(() => {
    const el = messageTextareaRef.current
    if (!el) return
    el.style.height = '0px'
    const bordes = el.offsetHeight - el.clientHeight
    el.style.height = `${Math.min(el.scrollHeight + bordes, MAX_MESSAGE_INPUT_PX)}px`
  }, [valorCampo, puedeEscribir, esCelular])

  const filteredQuickReplies = useMemo(() => {
    if (!quickReplySearch) return quickReplies
    const s = quickReplySearch.toLowerCase()
    return quickReplies.filter(r =>
      r.title.toLowerCase().includes(s) ||
      r.content.toLowerCase().includes(s) ||
      (r.shortcut && r.shortcut.toLowerCase().includes(s))
    )
  }, [quickReplies, quickReplySearch])

  const insertQuickReply = (reply: QuickReply) => {
    ponerEnElCampo(reply.content)
    setShowQuickReplies(false)
    setQuickReplySearch('')
  }

  const cerrarRapidas = () => {
    setShowQuickReplies(false)
    setQuickReplySearch('')
  }

  useEffect(() => {
    if (showQuickReplies) quickReplySearchRef.current?.focus()
  }, [showQuickReplies])

  // En el celular el composer flota sobre el hilo, así que el hilo reserva abajo
  // lo que mide el composer (--alto-composer), que crece con el texto y con las
  // respuestas rápidas. Y si estabas al final del chat, te deja al final cuando
  // algo cambia de alto: el composer, el hilo (el teclado, girar el teléfono) o
  // el contenido (una foto que termina de cargar). «Estabas al final» se mide
  // con el alto de ANTES del cambio: con un listener de scroll, el evento de
  // nuestro propio salto llegaba después de que la foto agrandara el hilo y
  // decía que no.
  // El mismo alto va también a <html> (--alto-composer-chat): los avisos viven
  // fuera de Mensajería y lo usan para quedar arriba del composer (globals.css).
  // Con el chat escondido (la lista, en el celular) mide 0 y se saca.
  useEffect(() => {
    const raiz = raizRef.current
    const hilo = hiloRef.current
    const contenido = contenidoRef.current
    const composer = composerRef.current
    if (!hayChat || !raiz || !hilo || !contenido || !composer) return
    const html = document.documentElement
    // En cero, la primera medición cuenta como «al final»: el chat abre abajo.
    let altoAntes = 0
    let vistaAntes = 0
    const ro = new ResizeObserver(() => {
      const alto = composer.offsetHeight
      raiz.style.setProperty('--alto-composer', `${alto}px`)
      if (alto > 0) html.style.setProperty('--alto-composer-chat', `${alto}px`)
      else html.style.removeProperty('--alto-composer-chat')
      if (altoAntes - hilo.scrollTop - vistaAntes < 72) hilo.scrollTop = hilo.scrollHeight
      altoAntes = hilo.scrollHeight
      vistaAntes = hilo.clientHeight
    })
    ro.observe(composer)
    ro.observe(hilo)
    ro.observe(contenido)
    return () => {
      ro.disconnect()
      html.style.removeProperty('--alto-composer-chat')
    }
  }, [hayChat])

  // Volver a la lista deslizando desde el borde izquierdo, como en iOS, o con
  // el «‹» (la misma salida, animada).
  const volverAnimado = useDeslizarParaVolver(
    capaRef,
    esCelular && showMobileChat && hayChat && !showProfile,
    () => setShowMobileChat(false),
  )

  // Los mensajes que ya estaban al abrir el chat se dibujan quietos (WhatsApp
  // abre el hilo sin animar); entran animados los que llegan después. La foto
  // de los ids se toma cada vez que termina una carga del hilo.
  const [hiloBase, setHiloBase] = useState<{ convId: string; ids: ReadonlySet<string> } | null>(null)
  const [cargabaAntes, setCargabaAntes] = useState(loadingMessages)
  if (cargabaAntes !== loadingMessages) {
    setCargabaAntes(loadingMessages)
    if (!loadingMessages && activeConv) {
      setHiloBase({ convId: activeConv.id, ids: new Set(messages.map(m => m.id)) })
    }
  }

  // Agrupa por día y marca la primera y la última burbuja de cada tanda (cambio
  // de emisor): la primera separa la tanda (8 px; dentro de una tanda, 2 px) y
  // la última lleva la colita.
  const grupos = useMemo(() => {
    const out: { dia: string; fecha: string; msgs: { msg: Message; primero: boolean; ultimo: boolean }[] }[] = []
    for (const msg of messages) {
      const dia = diaDelMensaje(msg.created_at)
      let bucket = out[out.length - 1]
      if (!bucket || bucket.dia !== dia) {
        bucket = { dia, fecha: msg.created_at, msgs: [] }
        out.push(bucket)
      }
      const prev = bucket.msgs[bucket.msgs.length - 1]
      const primero = !prev || prev.msg.direction !== msg.direction
      if (prev && !primero) prev.ultimo = false
      bucket.msgs.push({ msg, primero, ultimo: true })
    }
    return out
  }, [messages])

  // Lo que dice cada separador ("Hoy", "Ayer", "Martes", "12 de octubre"): lo
  // usan los del hilo y la pastilla flotante.
  const etiquetas = useMemo(
    () => new Map(grupos.map(g => [g.dia, etiquetaDeDia(new Date(g.fecha), hoy)])),
    [grupos, hoy],
  )

  // Chats con mensajes sin leer, para el «‹ 418» de volver.
  const activeConvId = activeConv?.id
  const noLeidos = useMemo(
    () => conversations.filter(c => c.unread_count > 0 && c.id !== activeConvId).length,
    [conversations, activeConvId],
  )

  const nombre = activeConv
    ? displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform)
    : ''
  const subtitulo = activeConv ? subtituloDeContacto(activeConv) : null
  const isWhatsapp = activeConv?.channel?.platform === 'whatsapp'
  // Mientras se recarga el mismo hilo (al volver a la pestaña, al reconectar)
  // se siguen viendo los mensajes: el esqueleto es sólo para un hilo que no
  // está. Los mensajes de otra conversación tampoco se muestran.
  const hiloAjeno = !!activeConv && messages.length > 0 && messages[0].conversation_id !== activeConv.id
  const cargandoHilo = hiloAjeno || (loadingMessages && messages.length === 0)

  const alternarPerfil = () => {
    if (!activeConv) return
    setShowProfile(v => !v)
    if (!showProfile && activeConv.client_id) loadVisits(activeConv.client_id)
  }
  const verPerfil = () => {
    if (!activeConv) return
    setShowProfile(true)
    if (activeConv.client_id) loadVisits(activeConv.client_id)
  }
  // El campo no se deshabilita mientras sale un mensaje (en el iPhone eso cierra
  // el teclado): lo que se frena es el envío siguiente.
  const enviar = () => {
    if (isSending || !activeConv) return
    const texto = valorCampo.trim()
    if (!texto) return
    if (unido !== null) {
      // El contexto todavía tiene sólo lo que había fallado: primero recibe el
      // campo entero y después se manda con el handleSend de ese render.
      const valor = unido
      flushSync(() => ponerEnElCampo(valor))
      setEnVuelo(texto)
      enviarDelContexto.current()
      return
    }
    setEnVuelo(texto)
    handleSend()
  }
  const abrirTemplates = () => {
    if (activeConv) handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })
  }

  return (
    <section
      ref={raizRef}
      // El shell cambia de sección deslizando de costado: adentro de un chat no.
      data-sin-swipe=""
      aria-label={activeConv ? `Chat con ${nombre}` : 'Mensajería'}
      aria-hidden={tapado || undefined}
      inert={tapado}
      className={cn(
        // El chat es un contenedor (@container/chat): el encabezado, el audio y
        // los documentos se acomodan a su ancho, que en la compu va de 356 px
        // (a 1024) para arriba.
        '@container/chat relative h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip bg-[var(--wa-bg)]',
        // Celular: una capa fija que tapa al shell entero. z-[41]: arriba de la
        // barra de vidrio (z-40) y abajo del panel de Tex (z-45), de las hojas
        // (z-50), de la info. del contacto (z-60) y de los diálogos y menús
        // (z-110). Sin fondo propio: lo que entra desde la derecha es la capa de
        // adentro, y deslizar para volver va descubriendo la lista.
        'max-lg:fixed max-lg:inset-0 max-lg:z-[41] max-lg:bg-transparent',
        showMobileChat ? 'flex' : 'hidden lg:flex',
      )}
    >
      <div
        ref={capaRef}
        className={cn(
          // wa-capa: lo de abajo se oscurece y el canto hace sombra mientras
          // entra y mientras se desliza para volver (globals.css). Entra desde
          // la derecha; la animación no deja el transform puesto al terminar.
          'wa-capa relative flex min-h-0 flex-1 flex-col max-lg:touch-pan-y max-lg:touch-pinch-zoom',
          'max-lg:duration-300 max-lg:ease-out max-lg:motion-safe:animate-in max-lg:motion-safe:slide-in-from-right',
          activeConv ? 'bg-[var(--wa-wallpaper-base)]' : 'bg-[var(--wa-bg)]',
        )}
      >
        {!activeConv ? (
          <SinChat
            configurado={isConfigured || isInstagramConfigured}
            onNewChat={onNewChat}
            onOpenSettings={onOpenSettings}
            onVolver={volverAnimado}
          />
        ) : (
          <>
            {/* El fondo, fijo: el hilo scrollea encima. */}
            <div className="wa-wallpaper absolute inset-0" aria-hidden="true" />

            {/* ── Encabezado ── En la compu mide lo mismo que el de la lista de
                chats (h-14), como la barra de arriba de WhatsApp para Mac, que
                cruza las dos columnas a la misma altura. Con el chat angosto
                (menos de 560 px: a 1024 mide 356) se aprieta: "Perfil" queda en
                el ícono y la ventana de 24 h, en las horas. */}
            <header className="absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-1 border-b-[0.5px] border-[var(--wa-divider)] bg-[var(--wa-bar)] pl-0.5 pr-1.5 backdrop-blur-xl backdrop-saturate-150 lg:relative lg:shrink-0 lg:gap-3 lg:border-b lg:px-4 lg:@max-[560px]/chat:gap-2 lg:@max-[560px]/chat:px-3">
              <button
                type="button"
                onClick={volverAnimado}
                className="flex h-11 shrink-0 items-center pr-1 text-[var(--wa-accent)] transition-opacity active:opacity-50 lg:hidden"
                aria-label={noLeidos > 0 ? `Volver a los chats, ${noLeidos} sin leer` : 'Volver a los chats'}
              >
                <ChevronLeft className="size-[30px]" strokeWidth={2.25} />
                {noLeidos > 0 && (
                  <span className="-ml-1.5 text-[17px] leading-none tabular-nums">
                    {noLeidos > 999 ? '999+' : noLeidos}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={alternarPerfil}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 text-left transition-opacity active:opacity-60 lg:gap-3 lg:hover:opacity-90 lg:@max-[560px]/chat:gap-2.5"
                aria-label={`Ver la info. de ${nombre}`}
              >
                <Avatar name={nombre} size={esCelular ? 36 : 40} avatarUrl={activeConv.platform_user_avatar} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16.5px] font-semibold leading-[1.25] text-[var(--wa-text)] lg:text-[15px]">
                    {nombre}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 text-[12.5px] leading-[1.3] text-[var(--wa-text-2)]">
                    {subtitulo?.esInstagram && <Instagram className="size-3 shrink-0" aria-hidden="true" />}
                    <span className="truncate">
                      {subtitulo && subtitulo.texto !== nombre ? subtitulo.texto : 'Info. del contacto'}
                    </span>
                  </span>
                </span>
              </button>

              {replyWindowLeft && <VentanaRestante restante={replyWindowLeft} />}

              <button
                type="button"
                onClick={alternarPerfil}
                aria-pressed={showProfile}
                title="Info. del contacto"
                className={cn(
                  'hidden h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors lg:inline-flex lg:@max-[560px]/chat:w-8 lg:@max-[560px]/chat:px-0',
                  showProfile
                    ? 'bg-[var(--wa-chip-on-bg)] text-[var(--wa-chip-on-text)]'
                    : 'bg-[var(--wa-field)] text-[var(--wa-text)] hover:bg-[var(--wa-raised-2)]',
                )}
              >
                <UserRound className="size-4 shrink-0" aria-hidden="true" />
                <span className="@max-[560px]/chat:sr-only">Perfil</span>
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Más opciones"
                    title="Más opciones"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--wa-accent)] transition-colors active:bg-[var(--wa-hover)] data-[state=open]:bg-[var(--wa-selected)] lg:size-8 lg:bg-[var(--wa-field)] lg:text-[var(--wa-text)] lg:hover:bg-[var(--wa-raised-2)]"
                  >
                    <Ellipsis className="size-6 lg:size-[18px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6} className={MENU}>
                  <DropdownMenuItem onClick={() => handleAutoTag(activeConv.id)} disabled={autoTagging} className={ITEM}>
                    <Sparkles className={cn(ICONO_ITEM, 'text-violet-400', autoTagging && 'animate-pulse')} />
                    Auto-etiquetar con IA
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={verPerfil} className={ITEM}>
                    <UserRound className={cn(ICONO_ITEM, 'text-[var(--wa-text-2)]')} />
                    Ver perfil del cliente
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-1.5 my-1 bg-[var(--wa-divider)]" />
                  {activeConv.status === 'open' ? (
                    <>
                      <DropdownMenuItem onClick={() => handleStatusChange('closed')} disabled={isActing} className={ITEM}>
                        <CheckCircle2 className={cn(ICONO_ITEM, 'text-[var(--wa-text-2)]')} />
                        Cerrar conversación
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleStatusChange('archived')} disabled={isActing} className={ITEM}>
                        <Archive className={cn(ICONO_ITEM, 'text-[var(--wa-text-2)]')} />
                        Archivar
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onClick={() => handleStatusChange('open')} disabled={isActing} className={ITEM}>
                      <RotateCcw className={cn(ICONO_ITEM, 'text-[var(--wa-accent)]')} />
                      Reabrir conversación
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>

            {/* La fecha flotante: aparece al scrollear, debajo del encabezado. */}
            <PastillaFlotante key={activeConv.id} hiloRef={hiloRef} contenidoRef={contenidoRef} etiquetas={etiquetas} />

            {/* ── Hilo ── En el celular ocupa todo y deja arriba el alto del
                encabezado y abajo el del composer, que flotan encima. */}
            <div
              ref={hiloRef}
              className="wa-scroll relative z-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain max-lg:absolute max-lg:inset-0 max-lg:touch-pan-y max-lg:touch-pinch-zoom"
            >
              <div
                ref={contenidoRef}
                className="flex min-h-full flex-col px-4 pb-[calc(var(--alto-composer,3.75rem)+0.75rem)] pt-[4.25rem] lg:px-[5%] lg:pb-4 lg:pt-3 xl:px-[7%]"
              >
                {cargandoHilo ? (
                  <EsqueletoHilo />
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-10">
                    <div className="max-w-[18rem] rounded-2xl bg-[var(--wa-date-chip)] px-5 py-4 text-center shadow-sm backdrop-blur-md">
                      <MessagesSquare className="mx-auto mb-2 size-7 text-[var(--wa-text-3)]" strokeWidth={1.75} />
                      <p className="text-[14px] font-medium text-[var(--wa-text)]">No hay mensajes aún</p>
                      {isWhatsapp && (
                        <>
                          <p className="mt-1 text-[12.5px] leading-snug text-[var(--wa-text-2)]">
                            Enviá un template aprobado para iniciar la conversación.
                          </p>
                          <button
                            type="button"
                            onClick={abrirTemplates}
                            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-4 text-[13.5px] font-semibold text-[var(--wa-on-accent)] transition-colors hover:bg-[var(--wa-accent-hover)]"
                          >
                            <FileText className="size-4" /> Enviar template
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  grupos.map(({ dia, msgs }) => (
                    <div key={dia} className="flex flex-col pt-3 first:pt-0">
                      {/* El día, en el flujo: no se pega arriba (para eso está la
                          pastilla flotante, que sólo aparece al scrollear). */}
                      <div className="mb-1 flex justify-center">
                        <span data-dia={dia} className={cn(FECHA, 'shadow-sm')}>
                          {etiquetas.get(dia)}
                        </span>
                      </div>
                      {msgs.map(({ msg, primero, ultimo }) => {
                        const isOut = msg.direction === 'outbound'
                        const tp = msg.template_params as { interactive_type?: string; buttons?: Array<{ id: string; title: string }> } | null
                        const isInteractiveButtons =
                          msg.content_type === 'interactive' &&
                          tp?.interactive_type === 'button' &&
                          Array.isArray(tp.buttons) &&
                          tp.buttons.length > 0
                        // Una plantilla: la que el envío marcó como tal, o cualquier
                        // contenido que sea el marcador '[Template: nombre]' (que
                        // nunca se muestra crudo).
                        const marcador = plantillaDelMarcador(msg.content)
                        const isTemplate =
                          !isInteractiveButtons &&
                          (marcador !== null || (!!msg.template_name && (msg.content_type === 'template' || !msg.content)))
                        const isMedia = !!msg.media_url && ['image', 'video', 'audio', 'document'].includes(msg.content_type)
                        // Entra animado lo que llegó después de abrir: lo del cliente y lo que
                        // se está mandando desde acá (el temporal). El saliente real que lo
                        // reemplaza aparece quieto, para no animar dos veces el mismo mensaje.
                        const animar =
                          hiloBase?.convId === activeConv.id &&
                          !hiloBase.ids.has(msg.id) &&
                          (!isOut || msg.id.startsWith('tmp-'))
                        const reintentar = canReply ? handleResend : undefined
                        return (
                          <div
                            key={msg.id}
                            className={cn(
                              'flex',
                              isOut ? 'justify-end' : 'justify-start',
                              primero ? 'mt-2' : 'mt-0.5',
                              animar && 'motion-safe:animate-[msgIn_0.22s_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
                              animar && (isOut ? 'origin-bottom-right' : 'origin-bottom-left'),
                            )}
                          >
                            {isInteractiveButtons ? (
                              <InteractiveButtonsBubble msg={msg} isOut={isOut} tail={ultimo} onResend={reintentar} resending={isSending} />
                            ) : isTemplate ? (
                              <TemplateBubble
                                msg={msg}
                                nombre={msg.template_name || marcador || ''}
                                isOut={isOut}
                                tail={ultimo}
                                templates={waTemplates}
                              />
                            ) : isMedia ? (
                              <MediaBubble msg={msg} isOut={isOut} tail={ultimo} onResend={reintentar} resending={isSending} />
                            ) : (
                              <div className={cn('wa-bubble', claseBurbuja(isOut, ultimo))}>
                                {msg.content ? (
                                  <TextoConHora msg={msg} isOut={isOut}>{msg.content}</TextoConHora>
                                ) : NOMBRE_ADJUNTO[msg.content_type] ? (
                                  <TextoConHora msg={msg} isOut={isOut} className="italic opacity-75">
                                    {NOMBRE_ADJUNTO[msg.content_type]} (archivo no disponible)
                                  </TextoConHora>
                                ) : (
                                  <TextoConHora
                                    msg={msg}
                                    isOut={isOut}
                                    className={cn('italic', isOut ? 'text-[var(--wa-meta-out)]' : 'text-[var(--wa-meta-in)]')}
                                  >
                                    {msg.content_type === 'interactive' ? 'Mensaje interactivo' : 'Sticker o adjunto'}
                                  </TextoConHora>
                                )}
                                <AvisoNoEnviado msg={msg} onResend={reintentar} resending={isSending} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* ── Composer ── */}
            <footer
              ref={composerRef}
              className="absolute inset-x-0 bottom-0 z-20 border-t-[0.5px] border-[var(--wa-divider)] bg-[var(--wa-bar)] pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl backdrop-saturate-150 lg:relative lg:shrink-0 lg:border-t lg:pb-0"
            >
              {activeConv.status !== 'open' ? (
                <div className="flex items-center justify-center gap-3 px-4 py-2 lg:py-3.5">
                  <span className="inline-flex items-center gap-1.5 text-[14px] text-[var(--wa-text-2)] lg:text-[13px]">
                    {activeConv.status === 'closed' ? <CheckCircle2 className="size-4" /> : <Archive className="size-4" />}
                    Conversación {activeConv.status === 'closed' ? 'cerrada' : 'archivada'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStatusChange('open')}
                    disabled={isActing}
                    className="inline-flex h-8 items-center rounded-full bg-[var(--wa-field)] px-3.5 text-[14px] font-semibold text-[var(--wa-accent)] transition-colors hover:bg-[var(--wa-raised-2)] disabled:opacity-50 lg:h-7 lg:text-[13px]"
                  >
                    Reabrir
                  </button>
                </div>
              ) : !canReply ? (
                <div className="flex flex-col items-center gap-2.5 px-5 py-2.5 text-center lg:py-3.5">
                  <p className="flex max-w-md items-start gap-1.5 text-left text-[13.5px] leading-snug text-[var(--wa-text-2)] lg:text-[13px]">
                    <Clock className="mt-[3px] size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                    <span>
                      {replyWindowState === 'never'
                        ? isWhatsapp
                          ? 'El cliente todavía no te escribió: WhatsApp sólo deja empezar con un template aprobado.'
                          : 'El cliente todavía no te escribió.'
                        : isWhatsapp
                          ? 'Pasaron 24 h desde el último mensaje del cliente: para retomar la charla sólo podés mandar un template aprobado.'
                          : 'Pasaron 24 h desde el último mensaje del cliente: Instagram no deja escribirle hasta que vuelva a escribir.'}
                    </span>
                  </p>
                  {isWhatsapp ? (
                    <button
                      type="button"
                      onClick={abrirTemplates}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--wa-accent)] px-4 text-[14px] font-semibold text-[var(--wa-on-accent)] transition-colors hover:bg-[var(--wa-accent-hover)] lg:h-8 lg:text-[13px]"
                    >
                      <FileText className="size-4" /> Enviar template
                    </button>
                  ) : (
                    <p className="text-[12.5px] text-[var(--wa-text-2)]">Esperá a que responda para poder escribirle.</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Respuestas rápidas: buscador y carrusel. Deslizar acá es
                      recorrer el carrusel, no volver a la lista. */}
                  {showQuickReplies && quickReplies.length > 0 && (
                    <div data-sin-volver="" className="border-b-[0.5px] border-[var(--wa-divider)] px-3 pb-2.5 pt-2.5 lg:border-b lg:px-4">
                      <div className="flex items-center gap-2">
                        <label className="relative min-w-0 flex-1">
                          <span className="sr-only">Buscar respuesta rápida</span>
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--wa-text-3)]" />
                          <input
                            ref={quickReplySearchRef}
                            // 16 px en el celular: con menos, el iPhone agranda la pantalla al enfocar.
                            className="h-9 w-full rounded-full bg-[var(--wa-field)] pl-9 pr-3 text-[16px] text-[var(--wa-text)] outline-none placeholder:text-[var(--wa-text-2)] focus-visible:ring-1 focus-visible:ring-white/20 lg:h-8 lg:text-[13px]"
                            placeholder="Buscar respuesta rápida"
                            value={quickReplySearch}
                            onChange={e => setQuickReplySearch(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') cerrarRapidas() }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={cerrarRapidas}
                          aria-label="Cerrar respuestas rápidas"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-text-2)] transition-colors hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] lg:size-8"
                        >
                          <X className="size-[18px]" />
                        </button>
                      </div>
                      <div className="wa-scroll -mx-3 mt-2.5 flex snap-x gap-2 overflow-x-auto scroll-px-3 px-3 pb-0.5 lg:-mx-4 lg:scroll-px-4 lg:px-4">
                        {filteredQuickReplies.length === 0 ? (
                          <p className="px-1 py-2 text-[13px] text-[var(--wa-text-2)]">Sin resultados</p>
                        ) : (
                          filteredQuickReplies.map(reply => (
                            <button
                              key={reply.id}
                              type="button"
                              onClick={() => insertQuickReply(reply)}
                              className="w-52 shrink-0 snap-start rounded-2xl bg-[var(--wa-raised)] p-3 text-left ring-1 ring-inset ring-white/5 transition-colors hover:bg-[var(--wa-raised-2)] active:bg-[var(--wa-raised-2)] lg:w-56 lg:rounded-xl lg:p-2.5"
                            >
                              <span className="mb-1 flex items-center gap-1.5">
                                <span className="truncate text-[14px] font-semibold text-[var(--wa-text)] lg:text-[12.5px]">{reply.title}</span>
                                {reply.shortcut && (
                                  <span className="shrink-0 rounded-md bg-[var(--wa-chip-on-bg)] px-1.5 py-px font-mono text-[11px] text-[var(--wa-chip-on-text)] lg:text-[10px]">
                                    /{reply.shortcut}
                                  </span>
                                )}
                              </span>
                              <span className="line-clamp-2 text-[13px] leading-snug text-[var(--wa-text-2)] lg:text-[11.5px]">{reply.content}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* En el celular: + · respuestas rápidas · campo · enviar (iOS).
                      En la compu: + · campo · respuestas rápidas · enviar (Mac).
                      El orden del DOM es el de la compu, donde se usa el teclado.
                      Sin micrófono ni emojis: no graban ni abren nada. Con el
                      campo vacío, enviar queda apagado. */}
                  <div className="flex items-end gap-1.5 px-2 pt-2 lg:gap-2 lg:px-4 lg:py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Adjuntar"
                          title="Adjuntar"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-text)] transition-colors active:bg-[var(--wa-hover)] data-[state=open]:bg-[var(--wa-selected)] max-lg:order-1 lg:size-10 lg:bg-[var(--wa-field)] lg:hover:bg-[var(--wa-raised-2)]"
                        >
                          <Plus className="size-[26px] lg:size-[22px]" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="top" sideOffset={8} className={MENU}>
                        {isWhatsapp && (
                          <DropdownMenuItem onClick={abrirTemplates} className={ITEM}>
                            <FileText className={cn(ICONO_ITEM, 'text-[var(--wa-accent)]')} /> Enviar template
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={openAvailability} className={ITEM}>
                          <CalendarSearch className={cn(ICONO_ITEM, 'text-sky-400')} /> Ver disponibilidad
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={openBooking} className={ITEM}>
                          <CalendarPlus className={cn(ICONO_ITEM, 'text-violet-400')} /> Agendar turno
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="min-w-0 flex-1 max-lg:order-3">
                      <textarea
                        ref={messageTextareaRef}
                        rows={1}
                        aria-label="Mensaje"
                        enterKeyHint="send"
                        // 16 px en el celular: con menos, el iPhone agranda la pantalla al enfocar.
                        // "Mensaje", corto: un placeholder largo se partía en dos renglones en
                        // el chat angosto y el campo arrancaba con el doble de alto.
                        className="wa-scroll block max-h-[min(40vh,17.5rem)] w-full resize-none overflow-y-auto rounded-[20px] border border-white/10 bg-[var(--wa-field)] px-3.5 py-[6px] text-[16px] leading-[22px] text-[var(--wa-text)] outline-none transition-colors placeholder:text-[var(--wa-text-2)] focus:border-white/20 lg:border-transparent lg:px-4 lg:py-[9px] lg:text-[15px] lg:leading-5 lg:focus:border-white/10"
                        placeholder="Mensaje"
                        value={valorCampo}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val.startsWith('/') && quickReplies.length > 0) {
                            const query = val.slice(1)
                            const exact = quickReplies.find(r => r.shortcut && r.shortcut.toLowerCase() === query.toLowerCase())
                            if (exact) {
                              ponerEnElCampo(exact.content)
                              setShowQuickReplies(false)
                              setQuickReplySearch('')
                            } else {
                              ponerEnElCampo(val)
                              setShowQuickReplies(true)
                              setQuickReplySearch(query)
                            }
                            return
                          }
                          ponerEnElCampo(val)
                          if (!val && showQuickReplies) {
                            setShowQuickReplies(false)
                            setQuickReplySearch('')
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar() }
                          if (e.key === 'Escape' && showQuickReplies) cerrarRapidas()
                        }}
                      />
                    </div>

                    {quickReplies.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowQuickReplies(v => !v)}
                        aria-pressed={showQuickReplies}
                        aria-label="Respuestas rápidas"
                        title="Respuestas rápidas"
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors max-lg:order-2 lg:size-10',
                          showQuickReplies
                            ? 'bg-[var(--wa-chip-on-bg)] text-[var(--wa-chip-on-text)]'
                            : 'text-[var(--wa-text-2)] active:bg-[var(--wa-hover)] lg:hover:bg-[var(--wa-field)] lg:hover:text-[var(--wa-text)]',
                        )}
                      >
                        <Zap className="size-5" />
                      </button>
                    )}

                    {/* Enviar. Apretarlo no le saca el foco al campo (el teclado
                        del iPhone no se cierra). Mientras sale un mensaje, el
                        siguiente espera: el botón no se deshabilita. */}
                    <button
                      type="button"
                      onClick={enviar}
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={!hasText}
                      aria-disabled={(hasText && isSending) || undefined}
                      aria-label={hasText && isSending ? 'Enviando' : 'Enviar'}
                      title="Enviar"
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 max-lg:order-4 lg:size-10',
                        hasText
                          ? 'bg-[var(--wa-accent)] text-[var(--wa-on-accent)] hover:bg-[var(--wa-accent-hover)] active:scale-95'
                          : 'text-[var(--wa-text-3)]',
                      )}
                    >
                      {hasText && isSending
                        ? <Loader2 className="size-[18px] animate-spin" />
                        : <SendHorizontal className="size-[18px] lg:size-5" strokeWidth={2.25} />}
                    </button>
                  </div>
                </>
              )}
            </footer>
          </>
        )}
      </div>

      {activeConv && (
        <>
          <AppointmentAvailabilityDialog
            open={showAvailability}
            onOpenChange={setShowAvailability}
            branches={branches}
            onInsertText={(text) => ponerEnElCampo(text)}
          />
          <AppointmentBookingDialog
            open={showBooking}
            onOpenChange={setShowBooking}
            branches={branches}
            services={appointmentServices}
            clientName={activeConv.platform_user_name}
            clientPhone={activeConv.platform_user_id}
          />
        </>
      )}
    </section>
  )
}

// La pastilla de la fecha que flota arriba del hilo, debajo del encabezado
// (pastilla-fecha.ts): aparece al scrollear con el día de lo que se ve arriba y
// se desvanece un segundo después de que el scroll para. Tiene su propio
// estado para que el scroll no vuelva a dibujar el chat entero. Es una copia de
// los separadores, que se leen en el hilo: para el lector de pantalla no está.
function PastillaFlotante({
  hiloRef, contenidoRef, etiquetas,
}: {
  hiloRef: RefObject<HTMLDivElement | null>
  contenidoRef: RefObject<HTMLDivElement | null>
  etiquetas: ReadonlyMap<string, string>
}) {
  const pastillaRef = useRef<HTMLSpanElement>(null)
  const [vista, setVista] = useState<VistaPastilla>(PASTILLA_ESCONDIDA)

  useEffect(() => {
    const hilo = hiloRef.current
    const contenido = contenidoRef.current
    const pastilla = pastillaRef.current
    if (!hilo || !contenido || !pastilla) return
    const control = crearPastilla({
      programar: (fn, ms) => {
        const id = window.setTimeout(fn, ms)
        return () => window.clearTimeout(id)
      },
      pintar: setVista,
    })
    // Dónde están los separadores (en px del contenido del hilo) y a qué
    // distancia del borde de arriba del hilo queda la pastilla. Se mide con el
    // primer scroll que cuenta y otra vez después de cada cambio de tamaño.
    let medida: { separadores: SeparadorMedido[]; desfase: number; alto: number } | null = null
    const medir = () => {
      const caja = hilo.getBoundingClientRect()
      const origen = caja.top - hilo.scrollTop
      const separadores = Array.from(contenido.querySelectorAll<HTMLElement>('[data-dia]'), (el) => {
        const r = el.getBoundingClientRect()
        return { dia: el.dataset.dia ?? '', arriba: r.top - origen, alto: r.height }
      })
      const p = pastilla.getBoundingClientRect()
      return { separadores, desfase: p.top - caja.top, alto: p.height }
    }
    const ro = new ResizeObserver(() => {
      medida = null
    })
    ro.observe(hilo)
    ro.observe(contenido)

    const alScrollear = (e: Event) =>
      control.scroll(e.timeStamp, () => {
        medida ??= medir()
        return diaDeLaPastilla(medida.separadores, { arriba: hilo.scrollTop + medida.desfase, alto: medida.alto })
      })
    const alGesto = (e: Event) => control.gesto(e.timeStamp)
    const alApoyar = (e: TouchEvent) => control.dedo(true, e.timeStamp)
    const alLevantar = (e: TouchEvent) => {
      if (e.touches.length === 0) control.dedo(false, e.timeStamp)
    }
    hilo.addEventListener('scroll', alScrollear, { passive: true })
    hilo.addEventListener('wheel', alGesto, { passive: true })
    hilo.addEventListener('keydown', alGesto)
    // La barra de scroll (y el mouse en general).
    hilo.addEventListener('pointerdown', alGesto)
    hilo.addEventListener('touchstart', alApoyar, { passive: true })
    hilo.addEventListener('touchend', alLevantar)
    hilo.addEventListener('touchcancel', alLevantar)
    return () => {
      hilo.removeEventListener('scroll', alScrollear)
      hilo.removeEventListener('wheel', alGesto)
      hilo.removeEventListener('keydown', alGesto)
      hilo.removeEventListener('pointerdown', alGesto)
      hilo.removeEventListener('touchstart', alApoyar)
      hilo.removeEventListener('touchend', alLevantar)
      hilo.removeEventListener('touchcancel', alLevantar)
      ro.disconnect()
      control.destruir()
    }
  }, [hiloRef, contenidoRef])

  const etiqueta = vista.dia ? etiquetas.get(vista.dia) : undefined
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
      <span
        ref={pastillaRef}
        data-visible={vista.visible && etiqueta ? '' : undefined}
        className={cn(
          FECHA,
          'shadow-md opacity-0 motion-safe:transition-opacity motion-safe:duration-300 data-[visible]:opacity-100',
        )}
      >
        {/* Sin día, un espacio: la pastilla tiene que medir su alto igual. */}
        {etiqueta ?? ' '}
      </span>
    </div>
  )
}

// Sin chat elegido, como WhatsApp de escritorio. En el celular no debería
// verse (sin chat se ve la lista), pero si pasa tiene por dónde volver: el
// chat tapa el encabezado y la barra del dashboard.
function SinChat({
  configurado, onNewChat, onOpenSettings, onVolver,
}: { configurado: boolean; onNewChat: () => void; onOpenSettings: () => void; onVolver: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-0.5 lg:hidden">
        <button
          type="button"
          onClick={onVolver}
          className="flex h-11 items-center pr-2 text-[17px] text-[var(--wa-accent)] active:opacity-50"
        >
          <ChevronLeft className="size-[30px]" strokeWidth={2.25} /> Chats
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-10 text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-[var(--wa-raised)] ring-1 ring-inset ring-white/5">
          <MessagesSquare className="size-11 text-[var(--wa-text-2)]" strokeWidth={1.5} />
        </div>
        <h2 className="mt-6 text-[24px] font-semibold tracking-tight text-[var(--wa-text)]">Mensajería</h2>
        <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-[var(--wa-text-2)]">
          {configurado
            ? 'Elegí un chat de la lista o empezá una conversación nueva.'
            : 'Conectá WhatsApp o Instagram para empezar a chatear con tus clientes.'}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {configurado && (
            <button
              type="button"
              onClick={onNewChat}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--wa-accent)] px-5 text-[14px] font-semibold text-[var(--wa-on-accent)] transition-colors hover:bg-[var(--wa-accent-hover)]"
            >
              <Plus className="size-4" strokeWidth={2.5} /> Nueva conversación
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--wa-field)] px-5 text-[14px] font-medium text-[var(--wa-text)] transition-colors hover:bg-[var(--wa-raised-2)]"
          >
            <Settings className="size-4" /> Configuración
          </button>
        </div>
      </div>
    </div>
  )
}

// El tiempo que queda de la ventana de 24 h de Meta para mandar texto libre.
// Llega como «23h 12m»; con menos de 3 horas va en ámbar: se está por cerrar.
// Con el chat angosto dice sólo las horas («23h»), o los minutos si queda
// menos de una.
function VentanaRestante({ restante }: { restante: string }) {
  const horas = Number.parseInt(restante, 10)
  const minutos = Number.parseInt(restante.split(' ')[1] ?? '', 10)
  const poca = Number.isFinite(horas) && horas < 3
  const corta = Number.isFinite(horas) && horas > 0 ? `${horas}h` : Number.isFinite(minutos) ? `${minutos}m` : restante
  return (
    <span
      title="Tiempo que queda para responder con texto libre (ventana de 24 h)"
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium tabular-nums lg:h-7 lg:px-2.5 lg:text-[12px] @max-[560px]/chat:px-2',
        poca ? 'bg-amber-400/15 text-amber-300' : 'bg-[var(--wa-raised-2)] text-[var(--wa-text-2)]',
      )}
    >
      <Clock className="size-3" aria-hidden="true" />
      <span className="sr-only">Quedan para responder:</span>
      <span className="@max-[560px]/chat:hidden">{restante}</span>
      <span className="hidden @max-[560px]/chat:inline">{corta}</span>
    </span>
  )
}

function EsqueletoHilo() {
  const filas = [false, false, true, false, true, true, false]
  return (
    <>
      <span className="sr-only" role="status">Cargando mensajes</span>
      <div className="flex flex-col py-2" aria-hidden="true">
        <div className="mx-auto mb-1 h-[22px] w-16 rounded-full bg-[var(--wa-date-chip)]" />
        {filas.map((isOut, i) => (
          <div
            key={i}
            className={cn(
              'flex animate-pulse',
              isOut ? 'justify-end' : 'justify-start',
              i > 0 && filas[i - 1] === isOut ? 'mt-0.5' : 'mt-2',
            )}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div
              className={cn('rounded-2xl lg:rounded-xl', isOut ? 'bg-[var(--wa-out)]/60' : 'bg-[var(--wa-in)]/80')}
              style={{ width: `${34 + (i % 3) * 14}%`, height: isOut && i === 4 ? 58 : 36 }}
            />
          </div>
        ))}
      </div>
    </>
  )
}

// «No enviado» con el botón de reintento, para los salientes que fallaron. En
// una burbuja angosta el botón baja a su propio renglón.
function AvisoNoEnviado({ msg, onResend, resending }: { msg: Message; onResend?: (id: string) => void; resending?: boolean }) {
  if (msg.status !== 'failed' || msg.direction !== 'outbound') return null
  return (
    <div className="mt-1.5 border-t border-white/15 pt-1.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] lg:text-[12px]">
        <AlertCircle className="size-3.5 shrink-0 text-[var(--wa-danger)]" aria-hidden="true" />
        <span className="font-semibold">No enviado</span>
        {onResend && (
          <button
            type="button"
            onClick={() => onResend(msg.id)}
            disabled={resending}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[12.5px] font-medium transition-colors hover:bg-white/25 active:bg-white/30 disabled:opacity-50 lg:py-0.5 lg:text-[11.5px]"
          >
            <RotateCcw className="size-3" /> Reintentar
          </button>
        )}
      </div>
      {msg.error_message && (
        <p className="mt-1 text-[12px] leading-snug text-[var(--wa-meta-out)] wrap-break-word lg:text-[11px]">{msg.error_message}</p>
      )}
    </div>
  )
}

// Los botones de una plantilla o de un mensaje interactivo: renglones al pie
// de la burbuja, en azul, como los dibuja WhatsApp.
function BotonesDelMensaje({ botones }: { botones: { clave: string; texto: string; enlace?: boolean }[] }) {
  if (botones.length === 0) return null
  return (
    <div className="divide-y divide-white/10 border-t border-white/10">
      {botones.map(b => (
        <div
          key={b.clave}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-[15px] font-medium text-[var(--wa-tick)] lg:py-2 lg:text-[14px]"
        >
          {b.enlace && <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />}
          {b.texto}
        </div>
      ))}
    </div>
  )
}

function InteractiveButtonsBubble({ msg, isOut, tail, onResend, resending }: { msg: Message; isOut: boolean; tail: boolean; onResend?: (id: string) => void; resending?: boolean }) {
  const tp = msg.template_params as { buttons: Array<{ id: string; title: string }> }
  const buttons = tp?.buttons ?? []

  return (
    <div className={cn('wa-bubble w-72 max-w-[85%] p-0 lg:max-w-[65%]', claseBurbuja(isOut, tail))}>
      <div className="px-2.5 pb-1.5 pt-2">
        {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
        <HoraEnFila msg={msg} isOut={isOut} />
      </div>
      <BotonesDelMensaje botones={buttons.map((b, i) => ({ clave: b.id || String(i), texto: b.title }))} />
      {msg.status === 'failed' && (
        <div className="px-2.5 pb-2"><AvisoNoEnviado msg={msg} onResend={onResend} resending={resending} /></div>
      )}
    </div>
  )
}

// La foto ampliada va por un portal a <body>: dentro del chat la atrapaban la
// burbuja (que aísla su apilamiento por la colita) y el transform del deslizar.
// Es un diálogo: al abrir, el foco va a «Cerrar» (lo único que se puede tocar)
// y no sale de ahí; al cerrar, vuelve a la miniatura.
function VisorImagen({
  url, devolverA, onCerrar,
}: { url: string; devolverA: RefObject<HTMLElement | null>; onCerrar: () => void }) {
  const cerrarRef = useRef<HTMLButtonElement>(null)
  const cerrar = useEffectEvent(onCerrar)

  useEffect(() => {
    cerrarRef.current?.focus()
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cerrar()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        cerrarRef.current?.focus()
      }
    }
    window.addEventListener('keydown', alTeclear)
    const miniatura = devolverA.current
    return () => {
      window.removeEventListener('keydown', alTeclear)
      miniatura?.focus({ preventScroll: true })
    }
  }, [devolverA])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagen ampliada"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-4 duration-150 animate-in fade-in-0"
      onClick={onCerrar}
    >
      <button
        ref={cerrarRef}
        type="button"
        onClick={onCerrar}
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex size-10 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70"
        aria-label="Cerrar"
      >
        <X className="size-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Imagen" className="max-h-[90dvh] max-w-[92vw] rounded-lg object-contain" />
    </div>,
    document.body,
  )
}

function MediaBubble({ msg, isOut, tail, onResend, resending }: { msg: Message; isOut: boolean; tail: boolean; onResend?: (id: string) => void; resending?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const miniaturaRef = useRef<HTMLButtonElement>(null)
  const url = msg.media_url!
  const hasCaption = !!msg.content && msg.content_type !== 'document'
  const esVisual = msg.content_type === 'image' || msg.content_type === 'video'
  // El audio y el documento tienen el ancho de WhatsApp (264 px) mientras
  // entren; en un chat angosto se achican con la burbuja y no la desbordan.
  const esFicha = msg.content_type === 'audio' || msg.content_type === 'document'
  const colorMeta = isOut ? 'text-[var(--wa-meta-out)]' : 'text-[var(--wa-meta-in)]'

  return (
    <div
      className={cn(
        'wa-bubble max-w-[80%] lg:max-w-[min(65%,22rem)]',
        esVisual ? 'p-[3px]' : 'px-1.5 py-1',
        esFicha && 'w-[264px] min-w-0',
        claseBurbuja(isOut, tail),
      )}
    >
      {msg.content_type === 'image' && (
        <div className="relative">
          <button ref={miniaturaRef} type="button" onClick={() => setExpanded(true)} className="block w-full overflow-hidden rounded-[13px] lg:rounded-[9px]" aria-label="Ver la imagen">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Imagen" className="block min-h-24 w-full min-w-40 max-w-[260px] object-cover lg:max-w-[300px]" loading="lazy" />
          </button>
          {!hasCaption && (
            <>
              <div className="wa-img-scrim rounded-b-[13px] lg:rounded-b-[9px]" />
              <span className="wa-img-meta">
                {formatTime(msg.created_at)}
                {isOut && <MessageStatusIcon status={msg.status} />}
              </span>
            </>
          )}
          {expanded && <VisorImagen url={url} devolverA={miniaturaRef} onCerrar={() => setExpanded(false)} />}
        </div>
      )}

      {msg.content_type === 'video' && (
        <>
          {/* playsInline: en el iPhone se reproduce en la burbuja, sin saltar a pantalla completa. */}
          <video src={url} controls playsInline preload="metadata" className="block w-full max-w-[260px] rounded-[13px] lg:max-w-[300px] lg:rounded-[9px]" />
          {/* La hora va debajo: encima taparía los controles. */}
          {!hasCaption && <div className="px-1.5 pb-0.5"><HoraEnFila msg={msg} isOut={isOut} /></div>}
        </>
      )}

      {msg.content_type === 'audio' && (
        <div className="min-w-0">
          <AudioPlayer src={url} isOut={isOut} />
          <div className="px-1 pb-0.5"><HoraEnFila msg={msg} isOut={isOut} /></div>
        </div>
      )}

      {msg.content_type === 'document' && (
        <>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-3 rounded-[12px] bg-black/15 px-3 py-2.5 transition-colors hover:bg-black/25 lg:rounded-[8px] @max-[560px]/chat:gap-2.5 @max-[560px]/chat:px-2.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <FileIcon className="size-5 opacity-80" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium lg:text-[13.5px]">{msg.content || 'Documento'}</span>
              <span className={cn('block truncate text-[12px] lg:text-[11px]', colorMeta)}>Tocá para abrir</span>
            </span>
            <Download className="size-4 shrink-0 opacity-70" aria-hidden="true" />
          </a>
          <div className="px-1.5 pb-0.5"><HoraEnFila msg={msg} isOut={isOut} /></div>
        </>
      )}

      {/* El pie de foto o de video, con la hora flotando como en el texto. */}
      {hasCaption && (
        <div className="px-[7px] pb-1 pt-1">
          <TextoConHora msg={msg} isOut={isOut}>{msg.content}</TextoConHora>
        </div>
      )}

      <div className="px-1.5"><AvisoNoEnviado msg={msg} onResend={onResend} resending={resending} /></div>
    </div>
  )
}

interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | string
  text?: string
  buttons?: Array<{ text?: string; type?: string }>
}

// El texto de la definición de una plantilla: las variables cuyo valor no se
// guardó ({{1}}, {{2}}…) van como un «…» apagado, nunca crudas.
function TextoDePlantilla({ texto, claseVariable }: { texto: string; claseVariable: string }) {
  return (
    <>
      {trozosDePlantilla(texto).map((t, i) =>
        t.tipo === 'texto' ? (
          <Fragment key={i}>{t.texto}</Fragment>
        ) : (
          <span key={i} className={claseVariable} title="Un dato que se completó al enviar">…</span>
        ),
      )}
    </>
  )
}

function TemplateBubble({
  msg, nombre, isOut, tail, templates,
}: { msg: Message; nombre: string; isOut: boolean; tail: boolean; templates: WaTemplate[] }) {
  const tpl = nombre ? templates.find(t => t.name === nombre) : undefined
  const components = tpl?.components as TemplateComponent[] | undefined

  const header = components?.find((c) => c.type === 'HEADER')
  const body = components?.find((c) => c.type === 'BODY')
  const footer = components?.find((c) => c.type === 'FOOTER')
  const buttons = components?.find((c) => c.type === 'BUTTONS')
  const colorMeta = isOut ? 'text-[var(--wa-meta-out)]' : 'text-[var(--wa-meta-in)]'
  const legible = nombreLegibleDePlantilla(nombre)

  // El texto que de verdad le llegó al cliente, con las variables puestas (lo
  // guardan, por ejemplo, los avisos de Menor espera). El BODY de la definición
  // tiene {{1}}…{{4}}: quien contesta desde el inbox no sabría qué barbero,
  // cuántos minutos ni qué sucursal se le ofreció. Las plantillas que no lo
  // guardan dejan el marcador '[Template: nombre]' y siguen mostrando la
  // definición, con las variables apagadas.
  const renderizado = msg.content && plantillaDelMarcador(msg.content) === null ? msg.content : null

  if (!components) {
    return (
      <div className={cn('wa-bubble', claseBurbuja(isOut, tail))}>
        {(renderizado || legible) && (
          <p className={cn('mb-1 flex items-center gap-1.5 text-[12.5px] font-medium lg:text-[11.5px]', colorMeta)}>
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{renderizado && legible ? `Plantilla · ${legible}` : 'Plantilla'}</span>
          </p>
        )}
        {renderizado ? (
          <TextoConHora msg={msg} isOut={isOut}>{renderizado}</TextoConHora>
        ) : (
          <TextoConHora msg={msg} isOut={isOut} className="font-medium">{legible || 'Plantilla'}</TextoConHora>
        )}
      </div>
    )
  }

  return (
    <div className={cn('wa-bubble w-72 max-w-[85%] p-0 lg:max-w-[65%]', claseBurbuja(isOut, tail))}>
      <div className="px-2.5 pb-1.5 pt-2">
        {header?.text && (
          <p className="mb-0.5 font-semibold"><TextoDePlantilla texto={header.text} claseVariable={colorMeta} /></p>
        )}
        {renderizado ? (
          <p className="whitespace-pre-wrap">{renderizado}</p>
        ) : body?.text ? (
          <p className="whitespace-pre-wrap"><TextoDePlantilla texto={body.text} claseVariable={colorMeta} /></p>
        ) : null}
        {footer?.text && <p className={cn('mt-1 text-[13px] lg:text-[12px]', colorMeta)}>{footer.text}</p>}
        <HoraEnFila msg={msg} isOut={isOut} />
      </div>
      {buttons?.buttons && (
        <BotonesDelMensaje
          botones={buttons.buttons.map((b, i) => ({ clave: String(i), texto: b.text ?? '', enlace: b.type === 'URL' }))}
        />
      )}
    </div>
  )
}
