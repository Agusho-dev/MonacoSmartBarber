'use client'

import { useState, useMemo } from 'react'
import {
  Search, Calendar, Plus, Pencil, MessageSquare, Instagram, Facebook, Clock, X,
  Camera, Video, Mic, FileText, LayoutTemplate, Sticker, MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar } from '../shared/avatar'
import { WhatsAppIcon, MessageStatusIcon } from '../shared/icons'
import {
  displayName, formatRelativeDate, formatLastMessagePreview, lastMessageMediaKind,
  type LastMessageMediaKind,
} from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import type { PlatformFilter } from '../shared/types'

function PreviewIcon({ kind }: { kind: LastMessageMediaKind }) {
  const cls = 'size-3.5 shrink-0'
  switch (kind) {
    case 'image': return <Camera className={cls} />
    case 'video': return <Video className={cls} />
    case 'audio': return <Mic className={cls} />
    case 'document': return <FileText className={cls} />
    case 'template': return <LayoutTemplate className={cls} />
    case 'sticker': return <Sticker className={cls} />
    case 'location': return <MapPin className={cls} />
  }
}

export function ConversationList({
  onNewChat,
  onOpenSettings,
}: {
  onNewChat: () => void
  onOpenSettings: () => void
}) {
  const {
    activeConv, setActiveConv,
    search, setSearch,
    platformFilter, setPlatformFilter,
    showMobileChat, setShowMobileChat,
    inboxTab, setInboxTab,
    setShowProfile,
    isConfigured, isInstagramConfigured,
    filteredConversations,
    scheduled, handleCancelScheduled,
  } = useMensajeria()

  // Filtro "No leídos" local (no toca el context ni su realtime endurecido).
  const [unreadOnly, setUnreadOnly] = useState(false)
  const unreadTotal = useMemo(
    () => filteredConversations.filter(c => c.unread_count > 0).length,
    [filteredConversations],
  )
  const visibleConversations = useMemo(
    () => (unreadOnly ? filteredConversations.filter(c => c.unread_count > 0) : filteredConversations),
    [filteredConversations, unreadOnly],
  )

  const chipBase = 'px-3 py-1 rounded-full text-[13px] font-medium shrink-0 transition-colors'
  const chipOn = 'bg-[#103629] text-[#00a884]'
  const chipOff = 'bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942]'

  return (
    <div className={`flex flex-col bg-[#111b21] w-full lg:w-[400px] lg:max-w-md shrink-0 overflow-hidden border-r border-[#222d34] ${showMobileChat ? 'hidden lg:flex' : 'flex'}`}>

      {/* Header estilo WhatsApp */}
      <div className="bg-[#111b21]">
        <div className="flex items-center justify-between px-4 h-14">
          <span className="font-semibold text-[#e9edef] text-[19px] tracking-tight">Chats</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon"
              className={`size-9 rounded-full hover:bg-[#202c33] ${inboxTab === 'scheduled' ? 'text-[#00a884]' : 'text-[#aebac1] hover:text-[#e9edef]'}`}
              onClick={() => setInboxTab(inboxTab === 'scheduled' ? 'inbox' : 'scheduled')} title="Mensajes programados">
              <Calendar className="size-5" />
            </Button>
            <Button variant="ghost" size="icon"
              className="size-9 rounded-full text-[#aebac1] hover:text-[#e9edef] hover:bg-[#202c33]"
              onClick={onNewChat} title="Nueva conversación">
              <Pencil className="size-5" />
            </Button>
          </div>
        </div>
      </div>

      {inboxTab === 'inbox' ? (
        <>
          {/* Buscar */}
          <div className="px-3 pt-1 pb-2 bg-[#111b21]">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#8696a0]" />
              <input
                className="w-full h-9 rounded-lg bg-[#202c33] pl-11 pr-3 text-sm text-[#e9edef] placeholder:text-[#8696a0] outline-none focus:ring-1 focus:ring-[#00a884]/40"
                placeholder="Buscar o iniciar un chat nuevo" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {/* Chips de filtro (Todos / No leídos [+ plataformas si hay IG]) */}
          <div className="flex items-center gap-2 px-3 pb-2 bg-[#111b21] overflow-x-auto wa-scroll">
            <button onClick={() => { setUnreadOnly(false); setPlatformFilter('all') }}
              className={`${chipBase} ${!unreadOnly && platformFilter === 'all' ? chipOn : chipOff}`}>
              Todos
            </button>
            <button onClick={() => setUnreadOnly(v => !v)}
              className={`${chipBase} ${unreadOnly ? chipOn : chipOff}`}>
              No leídos{unreadTotal > 0 ? ` ${unreadTotal}` : ''}
            </button>
            {isInstagramConfigured && (
              <>
                <button onClick={() => setPlatformFilter(platformFilter === 'whatsapp' ? 'all' : 'whatsapp')}
                  className={`${chipBase} flex items-center gap-1.5 ${platformFilter === 'whatsapp' ? chipOn : chipOff}`}>
                  <WhatsAppIcon className="size-3.5" /> WhatsApp
                </button>
                <button onClick={() => setPlatformFilter(platformFilter === 'instagram' ? 'all' : 'instagram')}
                  className={`${chipBase} flex items-center gap-1.5 ${platformFilter === 'instagram' ? chipOn : chipOff}`}>
                  <Instagram className="size-3.5" /> Instagram
                </button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 wa-scroll">
            {visibleConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#8696a0] px-6 text-center">
                <MessageSquare className="mb-3 size-10 opacity-20" />
                <p className="text-sm">
                  {unreadOnly ? 'No hay chats sin leer'
                    : !(isConfigured || isInstagramConfigured) ? 'Configurá WhatsApp o Instagram para empezar'
                      : 'No hay conversaciones'}
                </p>
                {!(isConfigured || isInstagramConfigured) && (
                  <button className="mt-2 text-xs text-[#00a884] hover:underline" onClick={onOpenSettings}>
                    Ir a configuración →
                  </button>
                )}
                {!unreadOnly && (isConfigured || isInstagramConfigured) && (
                  <button className="mt-2 text-xs text-[#00a884] hover:underline" onClick={onNewChat}>
                    Iniciar una conversación →
                  </button>
                )}
              </div>
            ) : (
              <div>
                {visibleConversations.map(conv => {
                  const isActive = activeConv?.id === conv.id
                  const rawName = conv.client?.name || conv.platform_user_name || conv.platform_user_id
                  const name = displayName(rawName, conv.channel?.platform)
                  const last = conv.last_message?.[0]
                  const isUnread = conv.unread_count > 0
                  const kind = lastMessageMediaKind(last)
                  const isOutbound = last?.direction === 'outbound'
                  return (
                    <button key={conv.id}
                      onClick={() => { setActiveConv(conv); setShowMobileChat(true); setShowProfile(false) }}
                      className={`flex w-full items-center gap-3 pl-3 pr-3 transition-colors ${isActive ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]'}`}>
                      <div className="relative shrink-0 py-2.5">
                        <Avatar name={name} size={12} avatarUrl={conv.platform_user_avatar} />
                        {conv.channel?.platform === 'instagram' && (
                          <span className="absolute bottom-2 -right-0.5 size-4 rounded-full bg-[#111b21] flex items-center justify-center">
                            <Instagram className="size-2.5 text-pink-400" />
                          </span>
                        )}
                        {conv.channel?.platform === 'facebook' && (
                          <span className="absolute bottom-2 -right-0.5 size-4 rounded-full bg-[#111b21] flex items-center justify-center">
                            <Facebook className="size-2.5 text-blue-400" />
                          </span>
                        )}
                      </div>
                      <div className={`min-w-0 flex-1 text-left py-3 border-b ${isActive ? 'border-transparent' : 'border-[color:var(--wa-divider)]'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="truncate text-[15px] text-[#e9edef]">{name}</p>
                            {conv.status === 'inactive' && (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#202c33] text-[#8696a0]">
                                Inactiva
                              </span>
                            )}
                            {conv.status === 'closed' && (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#202c33] text-[#8696a0] line-through">
                                Cerrada
                              </span>
                            )}
                          </div>
                          {conv.last_message_at && (
                            <span className={`shrink-0 text-[12px] ${isUnread ? 'text-[#25d366]' : 'text-[#8696a0]'}`}>
                              {formatRelativeDate(conv.last_message_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className={`flex items-center gap-1 truncate text-[13px] ${isUnread && !isOutbound ? 'text-[#e9edef]' : 'text-[#8696a0]'}`}>
                            {isOutbound && last && (
                              <span className="shrink-0 text-[#8696a0] [&_svg]:size-3.5">
                                <MessageStatusIcon status={last.status} />
                              </span>
                            )}
                            {kind && <PreviewIcon kind={kind} />}
                            <span className="truncate">
                              {formatLastMessagePreview(
                                last,
                                conv.client?.phone || (conv.channel?.platform === 'instagram' ? (conv.client?.instagram || 'Instagram DM') : conv.platform_user_id),
                              )}
                            </span>
                          </p>
                          {isUnread && (
                            <span className="shrink-0 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-[#25d366] text-[11px] font-semibold text-[#111b21] px-1.5">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                        {conv.tags && conv.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {conv.tags.map(({ tag_id, tag }) => (
                              <span key={tag_id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white"
                                style={{ backgroundColor: tag?.color ?? '#6B7280' }}>
                                {tag?.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Scheduled tab */
        <>
          <div className="px-3 py-2 bg-[#111b21]">
            <Button size="sm" className="w-full h-8 text-xs bg-[#00a884] hover:bg-[#02735e] text-white">
              <Plus className="mr-1.5 size-3" /> Programar mensaje
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 wa-scroll">
            {scheduled.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#8696a0]">
                <Calendar className="mb-3 size-10 opacity-20" />
                <p className="text-sm">Sin mensajes programados</p>
              </div>
            ) : (
              <div>
                {scheduled.map(msg => (
                  <div key={msg.id} className="px-3 py-3 border-b border-[color:var(--wa-divider)] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[#e9edef]">{msg.client?.name || 'Cliente'}</span>
                      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${msg.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' : msg.status === 'sent' ? 'bg-[#00a884]/15 text-[#00a884]' : 'bg-red-500/10 text-red-400'}`}>
                        {msg.status === 'pending' ? 'Pendiente' : msg.status === 'sent' ? 'Enviado' : 'Falló'}
                      </span>
                    </div>
                    <p className="text-xs text-[#8696a0] line-clamp-2">{msg.content}</p>
                    {msg.status === 'failed' && (msg as { error_message?: string | null }).error_message && (
                      <p className="text-[10px] text-red-400/90 line-clamp-2 leading-snug">
                        {(msg as { error_message?: string | null }).error_message}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[10px] text-[#8696a0]">
                        <Clock className="size-2.5" />
                        {new Date(msg.scheduled_for).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {msg.status === 'pending' && (
                        <button className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-0.5" onClick={() => handleCancelScheduled(msg.id)}>
                          <X className="size-2.5" /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
