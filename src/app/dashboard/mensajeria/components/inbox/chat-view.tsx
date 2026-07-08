'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Send, Clock, ArrowLeft, Plus, Settings, MoreVertical,
  CheckCircle2, Archive, RotateCcw, User, MessageSquare, FileText,
  ExternalLink, Zap, Search, X, Sparkles, Mic, Smile, Lock,
  Download, FileIcon, CalendarPlus, CalendarSearch, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '../shared/avatar'
import { MessageStatusIcon } from '../shared/icons'
import { displayName, formatTime, formatDateSeparator } from '../shared/helpers'
import { AudioPlayer } from '../shared/audio-player'
import { useMensajeria } from '../shared/mensajeria-context'
import type { QuickReply } from '../shared/mensajeria-context'
import type { Message } from '@/lib/types/database'
import type { WaTemplate } from '../shared/types'
import { AppointmentAvailabilityDialog } from '@/components/appointments/appointment-availability-dialog'
import {
  AppointmentBookingDialog,
  type BookingServiceOption,
} from '@/components/appointments/appointment-booking-dialog'

// Meta (hora + ticks) que flota abajo-derecha de la burbuja de texto. El
// <span.wa-spacer> reserva el ancho en la última línea (técnica WhatsApp).
function TextMeta({ msg, isOut }: { msg: Message; isOut: boolean }) {
  return (
    <>
      <span className={`wa-spacer ${isOut ? 'wa-spacer-out' : 'wa-spacer-in'}`} aria-hidden="true" />
      <span className={`wa-meta ${isOut ? 'wa-meta-out' : 'wa-meta-in'}`}>
        {formatTime(msg.created_at)}
        {isOut && <MessageStatusIcon status={msg.status} />}
      </span>
    </>
  )
}

// Meta en fila (para media/template/interactive)
function RowMeta({ msg, isOut }: { msg: Message; isOut: boolean }) {
  return (
    <div className={`flex items-center gap-1 ${isOut ? 'justify-end' : ''}`}>
      <span className={`text-[11px] ${isOut ? 'text-[#e9edef]/60' : 'text-[#8696a0]'}`}>{formatTime(msg.created_at)}</span>
      {isOut && <span className={isOut ? 'text-[#e9edef]/60' : ''}><MessageStatusIcon status={msg.status} /></span>}
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
    activeConv, messages, loadingMessages,
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

  const MAX_MESSAGE_INPUT_PX = 280

  useEffect(() => {
    const el = messageTextareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(el.scrollHeight, MAX_MESSAGE_INPUT_PX)
    el.style.height = `${next}px`
  }, [messageInput])

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
    setMessageInput(reply.content)
    setShowQuickReplies(false)
    setQuickReplySearch('')
  }

  useEffect(() => {
    if (showQuickReplies) quickReplySearchRef.current?.focus()
  }, [showQuickReplies])

  const activeConvName = activeConv ? displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform) : ''
  const isWhatsapp = activeConv?.channel?.platform === 'whatsapp'
  const hasText = messageInput.trim().length > 0

  // Agrupa por día y marca el primer mensaje de cada "run" (cambio de emisor)
  // para dibujar el tail sólo ahí y espaciar los runs, como WhatsApp.
  const groups = useMemo(() => {
    const out: { date: string; msgs: { msg: Message; firstOfRun: boolean }[] }[] = []
    for (const msg of messages) {
      const day = new Date(msg.created_at).toDateString()
      let bucket = out[out.length - 1]
      if (!bucket || bucket.date !== day) {
        bucket = { date: day, msgs: [] }
        out.push(bucket)
      }
      const prev = bucket.msgs[bucket.msgs.length - 1]?.msg
      const firstOfRun = !prev || prev.direction !== msg.direction
      bucket.msgs.push({ msg, firstOfRun })
    }
    return out
  }, [messages])

  if (!activeConv) {
    return (
      <div className={`flex flex-col flex-1 min-w-0 ${!showMobileChat ? 'hidden lg:flex' : 'flex'}`}>
        <div className="relative flex h-full flex-col items-center justify-center gap-4 bg-[#222e35] border-b-[6px] border-[#00a884]">
          <div className="flex size-28 items-center justify-center rounded-full bg-[#182229]">
            <MessageSquare className="size-14 text-[#00a884]/60" />
          </div>
          <div className="text-center px-6">
            <p className="text-2xl font-light text-[#e9edef]">Mensajería</p>
            <p className="text-sm text-[#8696a0] mt-2 max-w-sm">
              {(isConfigured || isInstagramConfigured) ? 'Seleccioná una conversación de la lista o iniciá una nueva.' : 'Configurá WhatsApp o Instagram para comenzar a chatear con tus clientes.'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-5">
              {(isConfigured || isInstagramConfigured) && (
                <Button size="sm" className="bg-[#00a884] hover:bg-[#02735e] text-white" onClick={onNewChat}>
                  <Plus className="mr-1.5 size-3.5" /> Nueva conversación
                </Button>
              )}
              <Button variant="outline" size="sm" className="border-[#2a3942] bg-transparent text-[#8696a0] hover:text-[#e9edef] hover:bg-[#202c33]"
                onClick={onOpenSettings}>
                <Settings className="mr-1.5 size-3.5" /> Configuración
              </Button>
            </div>
          </div>
          <div className="absolute bottom-8 flex items-center gap-1.5 text-[13px] text-[#8696a0]">
            <Lock className="size-3.5" /> Cifrado de extremo a extremo
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col flex-1 min-w-0 ${!showMobileChat ? 'hidden lg:flex' : 'flex'}`}>
      <div className="flex h-full flex-col bg-[#0b141a]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-16 bg-[#202c33] shrink-0 z-10">
          <Button variant="ghost" size="icon" className="lg:hidden size-9 text-[#aebac1] hover:text-[#e9edef] hover:bg-[#2a3942] shrink-0"
            onClick={() => setShowMobileChat(false)}>
            <ArrowLeft className="size-5" />
          </Button>
          <button onClick={() => { setShowProfile(v => !v); if (!showProfile && activeConv.client_id) loadVisits(activeConv.client_id) }}
            className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-90 transition-opacity">
            <Avatar name={activeConvName} size={10} avatarUrl={activeConv.platform_user_avatar} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-medium text-[#e9edef]">{activeConvName}</p>
              <p className="text-[13px] text-[#8696a0] truncate">
                {activeConv.client?.phone || (activeConv.channel?.platform === 'instagram' ? (activeConv.client?.instagram || 'Instagram DM') : activeConv.platform_user_id)}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0 text-[#aebac1]">
            {replyWindowLeft && (
              <span className="flex items-center gap-1 text-[11px] rounded-full border border-yellow-500/30 text-yellow-400 bg-yellow-500/5 px-2 py-0.5">
                <Clock className="size-2.5" />{replyWindowLeft}
              </span>
            )}
            <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-[#2a3942] hover:text-[#e9edef]"
              onClick={() => { setShowProfile(v => !v); if (!showProfile && activeConv.client_id) loadVisits(activeConv.client_id) }} title="Ver perfil">
              <User className={`size-5 ${showProfile ? 'text-[#00a884]' : ''}`} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-9 rounded-full hover:bg-[#2a3942] hover:text-[#e9edef]" title="Más opciones">
                  <MoreVertical className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 bg-[#233138] border-[#2a3942] text-[#e9edef]">
                <DropdownMenuItem onClick={() => handleAutoTag(activeConv.id)} disabled={autoTagging}
                  className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                  <Sparkles className={`size-4 ${autoTagging ? 'text-purple-400 animate-pulse' : 'text-purple-400'}`} />
                  Auto-etiquetar con IA
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setShowProfile(true); if (activeConv.client_id) loadVisits(activeConv.client_id) }}
                  className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                  <User className="size-4" /> Ver perfil del cliente
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2a3942]" />
                {activeConv.status === 'open' ? (
                  <>
                    <DropdownMenuItem onClick={() => handleStatusChange('closed')} disabled={isActing}
                      className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                      <CheckCircle2 className="size-4 text-blue-400" /> Cerrar conversación
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStatusChange('archived')} disabled={isActing}
                      className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                      <Archive className="size-4" /> Archivar
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => handleStatusChange('open')} disabled={isActing}
                    className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                    <RotateCcw className="size-4 text-[#00a884]" /> Reabrir conversación
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Mensajes: wallpaper fijo + hilo scrolleable encima */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div className="absolute inset-0 wa-wallpaper" aria-hidden="true" />
          <div className="relative h-full overflow-y-auto wa-scroll px-[5%] md:px-[6%] scroll-smooth">
            <div className="py-4 flex flex-col">
              {loadingMessages ? (
                <div className="space-y-3 py-4">
                  <div className="flex justify-center">
                    <div className="h-6 w-24 rounded-lg bg-[#1d282f] animate-pulse" />
                  </div>
                  {[false, false, true, false, true, true, false].map((isOut, i) => (
                    <div key={i} className={`flex ${isOut ? 'justify-end' : 'justify-start'} animate-pulse`} style={{ animationDelay: `${i * 60}ms` }}>
                      <div className={`rounded-lg ${isOut ? 'rounded-tr-none bg-[#005c4b]/40' : 'rounded-tl-none bg-[#202c33]'}`}
                        style={{ width: `${34 + (i % 3) * 14}%`, height: isOut && i === 4 ? 52 : 36 }} />
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8696a0]">
                  <div className="rounded-lg bg-[#182229]/90 px-4 py-3 text-center max-w-xs">
                    <MessageSquare className="mb-2 size-7 opacity-40 mx-auto" />
                    <p className="text-xs">No hay mensajes aún</p>
                    {isWhatsapp && (
                      <>
                        <p className="text-[10px] mt-1 opacity-70">Enviá un template aprobado para iniciar la conversación</p>
                        <button
                          onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#02735e] text-white text-xs transition-colors"
                        >
                          <FileText className="size-3.5" /> Enviar template
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                groups.map(({ date, msgs }) => (
                  <div key={date} className="flex flex-col">
                    <div className="flex items-center justify-center my-2 sticky top-1 z-[1]">
                      <span className="px-3 py-1 rounded-lg bg-[#182229]/95 text-[#8696a0] text-[12px] uppercase shadow-sm">
                        {formatDateSeparator(msgs[0].msg.created_at)}
                      </span>
                    </div>
                    {msgs.map(({ msg, firstOfRun }) => {
                      const isOut = msg.direction === 'outbound'
                      const tp = msg.template_params as { interactive_type?: string; buttons?: Array<{ id: string; title: string }> } | null
                      const isInteractiveButtons =
                        msg.content_type === 'interactive' &&
                        tp?.interactive_type === 'button' &&
                        Array.isArray(tp.buttons) &&
                        tp.buttons.length > 0
                      const isTemplate =
                        !isInteractiveButtons &&
                        (msg.content_type === 'template' || (msg.template_name && (!msg.content || msg.content.startsWith('[Template:'))))
                      const isMedia = !!msg.media_url && ['image', 'video', 'audio', 'document'].includes(msg.content_type)
                      return (
                        <div key={msg.id}
                          className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${firstOfRun ? 'mt-2' : 'mt-0.5'} animate-[msgIn_0.18s_ease-out_both]`}>
                          {isInteractiveButtons ? (
                            <InteractiveButtonsBubble msg={msg} isOut={isOut} tail={firstOfRun} onResend={canReply ? handleResend : undefined} resending={isSending} />
                          ) : isTemplate && msg.template_name ? (
                            <TemplateBubble msg={msg} isOut={isOut} tail={firstOfRun} templates={waTemplates} />
                          ) : isMedia ? (
                            <MediaBubble msg={msg} isOut={isOut} tail={firstOfRun} onResend={canReply ? handleResend : undefined} resending={isSending} />
                          ) : (
                            <div className={`wa-bubble ${firstOfRun ? (isOut ? 'wa-bubble-out' : 'wa-bubble-in') : (isOut ? 'wa-fill-out' : 'wa-fill-in')}`}>
                              {msg.content ? (
                                <p className="whitespace-pre-wrap">
                                  {msg.content}
                                  <TextMeta msg={msg} isOut={isOut} />
                                </p>
                              ) : ['image', 'video', 'audio', 'document'].includes(msg.content_type) ? (
                                <p className="text-[13px] italic text-[#e9edef]/70">
                                  {msg.content_type === 'image' ? 'Foto' : msg.content_type === 'video' ? 'Video' : msg.content_type === 'audio' ? 'Audio' : 'Documento'}
                                  {' (archivo no disponible)'}
                                  <TextMeta msg={msg} isOut={isOut} />
                                </p>
                              ) : (
                                <p className={`text-[13px] italic ${isOut ? 'text-[#e9edef]/60' : 'text-[#8696a0]'}`}>
                                  {msg.content_type === 'interactive' ? 'Mensaje interactivo' : 'Sticker o adjunto'}
                                  <TextMeta msg={msg} isOut={isOut} />
                                </p>
                              )}
                              <FailedNotice msg={msg} onResend={canReply ? handleResend : undefined} resending={isSending} />
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
        </div>

        {/* Composer */}
        <div className="bg-[#202c33] shrink-0">
          {activeConv.status !== 'open' ? (
            <div className="px-4 py-4 text-center flex items-center justify-center gap-2">
              <p className="text-xs text-[#8696a0]">Conversación {activeConv.status === 'closed' ? 'cerrada' : 'archivada'}</p>
              <button className="text-xs text-[#00a884] hover:underline" onClick={() => handleStatusChange('open')}>Reabrir</button>
            </div>
          ) : !canReply ? (
            <div className="px-4 py-3 text-center">
              <p className="text-xs text-yellow-400">
                {replyWindowState === 'never'
                  ? 'El cliente todavía no te escribió — WhatsApp solo permite iniciar con un template aprobado'
                  : 'Pasaron 24h desde el último mensaje del cliente — para reabrir la charla solo podés enviar un template aprobado'}
              </p>
              {isWhatsapp ? (
                <button
                  onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#00a884] hover:bg-[#02735e] text-white text-xs transition-colors"
                >
                  <FileText className="size-3" /> Enviar template
                </button>
              ) : (
                <p className="mt-1 text-[11px] text-[#8696a0]">Esperá a que responda para poder escribirle.</p>
              )}
            </div>
          ) : (
            <div>
              {/* Carrusel de respuestas rápidas */}
              {showQuickReplies && quickReplies.length > 0 && (
                <div className="border-b border-[#2a3942] px-3 py-2 space-y-2 bg-[#111b21]">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-[#8696a0]" />
                      <input
                        ref={quickReplySearchRef}
                        className="w-full h-7 rounded-md bg-[#2a3942] pl-8 pr-3 text-xs text-[#e9edef] placeholder:text-[#aebac1] outline-none focus:ring-1 focus:ring-[#00a884]/40"
                        placeholder="Buscar mensaje rápido..."
                        value={quickReplySearch}
                        onChange={e => setQuickReplySearch(e.target.value)}
                      />
                    </div>
                    <button onClick={() => { setShowQuickReplies(false); setQuickReplySearch('') }}
                      className="size-6 shrink-0 rounded-md hover:bg-[#2a3942] flex items-center justify-center text-[#8696a0] hover:text-[#e9edef]">
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 wa-scroll">
                    {filteredQuickReplies.length === 0 ? (
                      <p className="text-xs text-[#8696a0] py-2 px-1">Sin resultados</p>
                    ) : (
                      filteredQuickReplies.map(reply => (
                        <button
                          key={reply.id}
                          onClick={() => insertQuickReply(reply)}
                          className="shrink-0 w-48 text-left rounded-lg border border-[#2a3942] bg-[#202c33] hover:bg-[#2a3942] p-2.5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-medium text-[#e9edef] truncate">{reply.title}</span>
                            {reply.shortcut && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-[#00a884]/15 text-[#00a884] font-mono shrink-0">/{reply.shortcut}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#8696a0] line-clamp-2 leading-relaxed">{reply.content}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-1.5 px-3 py-2">
                {/* Emoji (decorativo, enfoca el input) */}
                <button
                  onClick={() => messageTextareaRef.current?.focus()}
                  className="size-10 shrink-0 rounded-full flex items-center justify-center text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] transition-colors"
                  title="Emojis"
                  tabIndex={-1}
                >
                  <Smile className="size-6" />
                </button>

                {/* Adjuntar: template / disponibilidad / turno */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="size-10 shrink-0 rounded-full flex items-center justify-center text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] transition-colors"
                      title="Adjuntar"
                    >
                      <Plus className="size-6" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" className="w-56 bg-[#233138] border-[#2a3942] text-[#e9edef]">
                    {isWhatsapp && (
                      <DropdownMenuItem
                        onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                        className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]"
                      >
                        <FileText className="size-4 text-[#00a884]" /> Enviar template
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={openAvailability} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                      <CalendarSearch className="size-4 text-sky-400" /> Ver disponibilidad
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={openBooking} className="gap-2 focus:bg-[#2a3942] focus:text-[#e9edef]">
                      <CalendarPlus className="size-4 text-violet-400" /> Agendar turno
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Respuestas rápidas */}
                {quickReplies.length > 0 && (
                  <button
                    onClick={() => setShowQuickReplies(v => !v)}
                    className={`size-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                      showQuickReplies ? 'bg-[#00a884]/20 text-[#00a884]' : 'text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942]'
                    }`}
                    title="Respuestas rápidas"
                  >
                    <Zap className="size-5" />
                  </button>
                )}

                <textarea
                  ref={messageTextareaRef}
                  rows={1}
                  className="flex-1 rounded-lg bg-[#2a3942] px-4 py-2.5 text-[15px] text-[#e9edef] placeholder:text-[#aebac1] outline-none resize-none min-h-11 max-h-[min(40vh,17.5rem)] overflow-y-auto wa-scroll leading-[1.4]"
                  style={{ height: '2.75rem' }}
                  placeholder="Escribí un mensaje"
                  value={messageInput}
                  onChange={(e) => {
                    const val = e.target.value
                    setMessageInput(val)
                    if (val.startsWith('/') && quickReplies.length > 0) {
                      const query = val.slice(1)
                      const exact = quickReplies.find(r => r.shortcut && r.shortcut.toLowerCase() === query.toLowerCase())
                      if (exact) {
                        setMessageInput(exact.content)
                        setShowQuickReplies(false)
                        setQuickReplySearch('')
                      } else {
                        setShowQuickReplies(true)
                        setQuickReplySearch(query)
                      }
                    } else if (!val && showQuickReplies) {
                      setShowQuickReplies(false)
                      setQuickReplySearch('')
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
                    if (e.key === 'Escape' && showQuickReplies) { setShowQuickReplies(false); setQuickReplySearch('') }
                  }}
                  disabled={isSending}
                />

                {hasText ? (
                  <button onClick={handleSend} disabled={isSending}
                    className="size-10 shrink-0 rounded-full bg-[#00a884] hover:bg-[#02735e] disabled:opacity-50 flex items-center justify-center transition-colors"
                    title="Enviar">
                    <Send className="size-5 text-white" />
                  </button>
                ) : (
                  <button onClick={() => messageTextareaRef.current?.focus()}
                    className="size-10 shrink-0 rounded-full flex items-center justify-center text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] transition-colors"
                    title="Escribir mensaje" tabIndex={-1}>
                    <Mic className="size-5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <AppointmentAvailabilityDialog
        open={showAvailability}
        onOpenChange={setShowAvailability}
        branches={branches}
        onInsertText={(text) => setMessageInput(text)}
      />
      <AppointmentBookingDialog
        open={showBooking}
        onOpenChange={setShowBooking}
        branches={branches}
        services={appointmentServices}
        clientName={activeConv ? activeConv.platform_user_name : null}
        clientPhone={activeConv ? activeConv.platform_user_id : null}
      />
    </div>
  )
}

// Aviso de "no enviado" con botón de reintento para mensajes salientes fallidos.
function FailedNotice({ msg, onResend, resending }: { msg: Message; onResend?: (id: string) => void; resending?: boolean }) {
  if (msg.status !== 'failed' || msg.direction !== 'outbound') return null
  return (
    <div className="mt-1 border-t border-red-300/30 pt-1">
      <div className="flex items-center gap-1.5 text-[10px] text-red-100">
        <AlertCircle className="size-3 shrink-0" />
        <span className="font-semibold">No enviado</span>
        {onResend && (
          <button
            onClick={() => onResend(msg.id)}
            disabled={resending}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-white/15 hover:bg-white/25 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="size-2.5" /> Reintentar
          </button>
        )}
      </div>
      {msg.error_message && (
        <p className="text-[10px] text-red-100/80 mt-0.5 wrap-break-word leading-snug">{msg.error_message}</p>
      )}
    </div>
  )
}

function bubbleFill(isOut: boolean, tail: boolean) {
  if (tail) return isOut ? 'wa-bubble-out' : 'wa-bubble-in'
  return isOut ? 'wa-fill-out' : 'wa-fill-in'
}

function InteractiveButtonsBubble({ msg, isOut, tail, onResend, resending }: { msg: Message; isOut: boolean; tail: boolean; onResend?: (id: string) => void; resending?: boolean }) {
  const tp = msg.template_params as { buttons: Array<{ id: string; title: string }> }
  const buttons = tp?.buttons ?? []

  return (
    <div className={`wa-bubble ${bubbleFill(isOut, tail)} !p-0 overflow-hidden max-w-[75%] w-72`}>
      <div>
        {msg.content && (
          <div className="px-2.5 pt-2 pb-1">
            <p className="whitespace-pre-wrap text-[14px] leading-[1.4]">{msg.content}</p>
          </div>
        )}
        <div className="px-2.5 pb-1.5">
          <RowMeta msg={msg} isOut={isOut} />
        </div>
      </div>
      <div className={`border-t ${isOut ? 'border-white/10' : 'border-white/10'}`}>
        {buttons.map((btn, i) => (
          <div
            key={btn.id || i}
            className={`flex items-center justify-center py-2.5 text-[14px] font-medium text-[#53bdeb] ${i < buttons.length - 1 ? 'border-b border-white/10' : ''}`}
          >
            {btn.title}
          </div>
        ))}
      </div>
      <div className="px-2 pb-1"><FailedNotice msg={msg} onResend={onResend} resending={resending} /></div>
    </div>
  )
}

function MediaBubble({ msg, isOut, tail, onResend, resending }: { msg: Message; isOut: boolean; tail: boolean; onResend?: (id: string) => void; resending?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const url = msg.media_url!
  const hasCaption = !!msg.content && msg.content_type !== 'document'

  return (
    <div className={`wa-bubble ${bubbleFill(isOut, tail)} !p-1 overflow-hidden max-w-[65%]`}>
      {msg.content_type === 'image' && (
        <div className="relative">
          <button onClick={() => setExpanded(true)} className="block w-full cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Imagen" className="w-full max-w-xs rounded-[6px] object-cover" loading="lazy" />
          </button>
          {!hasCaption && (
            <>
              <div className="wa-img-scrim rounded-b-[6px]" />
              <span className="wa-img-meta">
                {formatTime(msg.created_at)}
                {isOut && <MessageStatusIcon status={msg.status} />}
              </span>
            </>
          )}
          {expanded && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setExpanded(false)}>
              <button className="absolute top-4 right-4 text-white hover:text-gray-300" onClick={() => setExpanded(false)}>
                <X className="size-6" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Imagen" className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg" />
            </div>
          )}
        </div>
      )}

      {msg.content_type === 'video' && (
        <div className="relative">
          <video src={url} controls preload="metadata" className="w-full max-w-xs rounded-[6px]" />
          {!hasCaption && (
            <>
              <div className="wa-img-scrim rounded-b-[6px]" />
              <span className="wa-img-meta">
                {formatTime(msg.created_at)}
                {isOut && <MessageStatusIcon status={msg.status} />}
              </span>
            </>
          )}
        </div>
      )}

      {msg.content_type === 'audio' && (
        <div className="min-w-[230px]">
          <AudioPlayer src={url} isOut={isOut} />
          <div className="px-2 pb-0.5"><RowMeta msg={msg} isOut={isOut} /></div>
        </div>
      )}

      {msg.content_type === 'document' && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-[6px] transition-colors hover:bg-white/5">
          <div className="flex items-center justify-center size-10 rounded-lg shrink-0 bg-white/10">
            <FileIcon className="size-5 opacity-80" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{msg.content || 'Documento'}</p>
            <p className="text-[10px] text-[#e9edef]/60">Toca para descargar</p>
          </div>
          <Download className="size-4 opacity-60 shrink-0" />
        </a>
      )}

      {/* Caption + meta (para imágenes/videos con texto) */}
      {hasCaption && (
        <div className="px-2 pt-1 pb-0.5">
          <p className="whitespace-pre-wrap text-[14px] leading-[1.4]">
            {msg.content}
            <TextMeta msg={msg} isOut={isOut} />
          </p>
        </div>
      )}

      {msg.content_type === 'document' && (
        <div className="px-2 pb-0.5"><RowMeta msg={msg} isOut={isOut} /></div>
      )}

      <div className="px-2"><FailedNotice msg={msg} onResend={onResend} resending={resending} /></div>
    </div>
  )
}

interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | string
  text?: string
  buttons?: Array<{ text?: string; type?: string }>
}

function TemplateBubble({ msg, isOut, tail, templates }: { msg: Message; isOut: boolean; tail: boolean; templates: WaTemplate[] }) {
  const tpl = templates.find(t => t.name === msg.template_name)
  const components = tpl?.components as TemplateComponent[] | undefined

  const header = components?.find((c) => c.type === 'HEADER')
  const body = components?.find((c) => c.type === 'BODY')
  const footer = components?.find((c) => c.type === 'FOOTER')
  const buttons = components?.find((c) => c.type === 'BUTTONS')

  if (!components) {
    return (
      <div className={`wa-bubble ${bubbleFill(isOut, tail)} max-w-[65%]`}>
        <div className="flex items-center gap-1.5 mb-1">
          <FileText className="size-3.5 opacity-60" />
          <span className="text-xs font-medium opacity-70">Plantilla</span>
        </div>
        <p className="font-medium text-sm">
          {msg.template_name}
          <TextMeta msg={msg} isOut={isOut} />
        </p>
      </div>
    )
  }

  return (
    <div className={`wa-bubble ${bubbleFill(isOut, tail)} !p-0 overflow-hidden max-w-[75%] w-72`}>
      <div>
        {header?.text && (
          <div className="px-2.5 pt-2 pb-0.5"><p className="font-bold text-sm">{header.text}</p></div>
        )}
        {body?.text && (
          <div className="px-2.5 py-1"><p className="whitespace-pre-wrap text-[14px] leading-[1.4]">{body.text}</p></div>
        )}
        {footer?.text && (
          <div className="px-2.5 pb-1"><p className="text-[11px] text-[#e9edef]/50">{footer.text}</p></div>
        )}
        <div className="px-2.5 pb-1.5"><RowMeta msg={msg} isOut={isOut} /></div>
      </div>

      {buttons?.buttons && buttons.buttons.length > 0 && (
        <div className="border-t border-white/10">
          {buttons.buttons.map((btn, i) => (
            <div key={i}
              className={`flex items-center justify-center gap-1.5 py-2 text-[14px] font-medium text-[#53bdeb] ${i < buttons.buttons!.length - 1 ? 'border-b border-white/10' : ''}`}>
              {btn.type === 'URL' && <ExternalLink className="size-3" />}
              {btn.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
