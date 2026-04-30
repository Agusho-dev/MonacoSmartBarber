'use client'

import { Search, Calendar, Plus, Pencil, MessageSquare, Instagram, Facebook, Clock, X, Settings, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '../shared/avatar'
import { WhatsAppIcon } from '../shared/icons'
import { displayName, formatRelativeDate, formatLastMessagePreview } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import type { PlatformFilter } from '../shared/types'

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

  return (
    <div className={`flex flex-col border-r border bg-background w-full lg:w-[340px] lg:max-w-sm shrink-0 overflow-hidden ${showMobileChat ? 'hidden lg:flex' : 'flex'}`}>

      {/* Header */}
      <div className="bg-card">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-semibold text-foreground text-sm">Mensajería</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className={`size-8 ${inboxTab === 'scheduled' ? 'text-green-400' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setInboxTab(inboxTab === 'scheduled' ? 'inbox' : 'scheduled')} title="Mensajes programados">
              <Calendar className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground"
              onClick={onOpenSettings} title="Configuración">
              <Settings className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-green-400 hover:text-green-300"
              onClick={onNewChat} title="Nueva conversación">
              <Pencil className="size-4" />
            </Button>
          </div>
        </div>
        {/* Platform filter tabs */}
        <div className="flex px-3 pb-2 gap-1">
          {([
            { key: 'all', label: 'Todos' },
            { key: 'whatsapp', label: 'WhatsApp' },
            { key: 'instagram', label: 'Instagram' },
          ] as { key: PlatformFilter; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => setPlatformFilter(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${platformFilter === key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {key === 'whatsapp' && <WhatsAppIcon className="size-3 text-green-400" />}
              {key === 'instagram' && <Instagram className="size-3 text-pink-400" />}
              {label}
            </button>
          ))}
        </div>
      </div>

      {inboxTab === 'inbox' ? (
        <>
          {/* Search + status filter */}
          <div className="px-3 py-2 space-y-2 bg-background">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full h-8 rounded-lg bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
                placeholder="Buscar o iniciar chat" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            {filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="mb-3 size-10 opacity-20" />
                <p className="text-sm">{!(isConfigured || isInstagramConfigured) ? 'Configurá WhatsApp o Instagram para empezar' : 'No hay conversaciones'}</p>
                {!(isConfigured || isInstagramConfigured) && (
                  <button className="mt-2 text-xs text-green-400 hover:underline" onClick={onOpenSettings}>
                    Ir a configuración →
                  </button>
                )}
                {(isConfigured || isInstagramConfigured) && (
                  <button className="mt-2 text-xs text-green-400 hover:underline" onClick={onNewChat}>
                    Iniciar una conversación →
                  </button>
                )}
              </div>
            ) : (
              <div>
                {filteredConversations.map(conv => {
                  const isActive = activeConv?.id === conv.id
                  const rawName = conv.client?.name || conv.platform_user_name || conv.platform_user_id
                  const name = displayName(rawName, conv.channel?.platform)
                  return (
                    <button key={conv.id}
                      onClick={() => { setActiveConv(conv); setShowMobileChat(true); setShowProfile(false) }}
                      className={`flex w-full items-center gap-3 px-3 py-3 transition-colors border-b border ${isActive ? 'bg-accent' : 'hover:bg-card'}`}>
                      <div className="relative shrink-0">
                        <Avatar name={name} size={10} />
                        {conv.channel?.platform === 'instagram' && (
                          <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-background flex items-center justify-center">
                            <Instagram className="size-2.5 text-pink-400" />
                          </span>
                        )}
                        {conv.channel?.platform === 'facebook' && (
                          <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-background flex items-center justify-center">
                            <Facebook className="size-2.5 text-blue-400" />
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{name}</p>
                            {conv.status === 'inactive' && (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                Inactiva
                              </span>
                            )}
                            {conv.status === 'closed' && (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground line-through">
                                Cerrada
                              </span>
                            )}
                          </div>
                          {conv.last_message_at && (
                            <span className={`shrink-0 text-[11px] ${conv.unread_count > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>
                              {formatRelativeDate(conv.last_message_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className={`truncate text-xs ${conv.unread_count > 0 && conv.last_message?.[0]?.direction === 'inbound' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {formatLastMessagePreview(
                              conv.last_message?.[0],
                              conv.client?.phone || (conv.channel?.platform === 'instagram' ? (conv.client?.instagram || 'Instagram DM') : conv.platform_user_id),
                            )}
                          </p>
                          {conv.unread_count > 0 && (
                            <span className="shrink-0 min-w-4.5 h-4.5 flex items-center justify-center rounded-full bg-green-500 text-[10px] font-semibold text-white px-1">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                        {conv.tags && conv.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {conv.tags.map(({ tag_id, tag }) => (
                              <span key={tag_id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white"
                                style={{ backgroundColor: tag?.color ?? '#6B7280' }}>
                                {tag?.ai_auto_assign && <Sparkles className="size-2" />}
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
          <div className="px-3 py-2">
            <Button size="sm" className="w-full h-8 text-xs bg-green-600 hover:bg-green-700 text-white">
              <Plus className="mr-1.5 size-3" /> Programar mensaje
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {scheduled.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Calendar className="mb-3 size-10 opacity-20" />
                <p className="text-sm">Sin mensajes programados</p>
              </div>
            ) : (
              <div>
                {scheduled.map(msg => (
                  <div key={msg.id} className="px-3 py-3 border-b border space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{msg.client?.name || 'Cliente'}</span>
                      <Badge variant="outline" className={`shrink-0 text-[10px] border-0 ${msg.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' : msg.status === 'sent' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {msg.status === 'pending' ? 'Pendiente' : msg.status === 'sent' ? 'Enviado' : 'Falló'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{msg.content}</p>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
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
