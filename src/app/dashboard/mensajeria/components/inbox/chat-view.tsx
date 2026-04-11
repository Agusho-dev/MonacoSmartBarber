'use client'

import {
  Send, Clock, ArrowLeft, Plus, Settings,
  CheckCircle2, Archive, RotateCcw, User, MessageSquare, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '../shared/avatar'
import { MessageStatusIcon } from '../shared/icons'
import { displayName, formatTime, formatDateSeparator } from '../shared/helpers'
import { useMensajeria } from '../shared/mensajeria-context'
import type { Message } from '@/lib/types/database'

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
    canReply, replyWindowLeft,
    handleSend, handleStatusChange,
    handleOpenTemplateDialog,
    isSending, isActing,
  } = useMensajeria()

  const activeConvName = activeConv ? displayName(activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id, activeConv.channel?.platform) : ''

  function groupedMessages() {
    const groups: { date: string; msgs: Message[] }[] = []
    for (const msg of messages) {
      const day = new Date(msg.created_at).toDateString()
      const last = groups[groups.length - 1]
      if (!last || last.date !== day) groups.push({ date: day, msgs: [msg] })
      else last.msgs.push(msg)
    }
    return groups
  }

  if (!activeConv) {
    return (
      <div className={`flex flex-col flex-1 min-w-0 ${!showMobileChat ? 'hidden lg:flex' : 'flex'}`}>
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
          <div className="flex size-24 items-center justify-center rounded-full bg-muted border">
            <MessageSquare className="size-12 text-green-500/50" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground/70">Mensajería</p>
            <p className="text-sm text-muted-foreground mt-1">
              {(isConfigured || isInstagramConfigured) ? 'Seleccioná una conversación o iniciá una nueva' : 'Configurá WhatsApp o Instagram para comenzar'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              {(isConfigured || isInstagramConfigured) && (
                <Button variant="outline" size="sm" className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                  onClick={onNewChat}>
                  <Plus className="mr-1.5 size-3.5" /> Nueva conversación
                </Button>
              )}
              <Button variant="outline" size="sm" className="border text-muted-foreground hover:text-foreground"
                onClick={onOpenSettings}>
                <Settings className="mr-1.5 size-3.5" /> Configuración
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col flex-1 min-w-0 ${!showMobileChat ? 'hidden lg:flex' : 'flex'}`}>
      <div className="flex h-full flex-col bg-background">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-card border-b border">
          <Button variant="ghost" size="icon" className="lg:hidden size-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setShowMobileChat(false)}>
            <ArrowLeft className="size-4" />
          </Button>
          <button onClick={() => { setShowProfile(v => !v); if (!showProfile && activeConv.client_id) loadVisits(activeConv.client_id) }}
            className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
            <Avatar name={activeConvName} size={9} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{activeConvName}</p>
              <p className="text-[11px] text-muted-foreground">
                {activeConv.client?.phone || (activeConv.channel?.platform === 'instagram' ? (activeConv.client?.instagram || 'Instagram DM') : activeConv.platform_user_id)}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {replyWindowLeft && (
              <Badge variant="outline" className="gap-1 text-[10px] border-yellow-500/30 text-yellow-400 bg-yellow-500/5">
                <Clock className="size-2.5" />{replyWindowLeft}
              </Badge>
            )}
            {activeConv.status === 'open' ? (
              <>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-blue-400" title="Cerrar conversación"
                  onClick={() => handleStatusChange('closed')} disabled={isActing}>
                  <CheckCircle2 className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground/50" title="Archivar"
                  onClick={() => handleStatusChange('archived')} disabled={isActing}>
                  <Archive className="size-4" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-green-400" title="Reabrir"
                onClick={() => handleStatusChange('open')} disabled={isActing}>
                <RotateCcw className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className={`size-8 ${showProfile ? 'text-green-400' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setShowProfile(v => !v)} title="Ver perfil">
              <User className="size-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto min-h-0 px-[5%]">
          <div className="py-4 space-y-0.5">
            {loadingMessages ? (
              <div className="flex justify-center py-12">
                <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-green-400" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="mb-2 size-8 opacity-20" />
                <p className="text-xs">No hay mensajes aún</p>
                {activeConv.channel?.platform === 'whatsapp' && (
                  <>
                    <p className="text-[10px] mt-1 opacity-60">Enviá un template aprobado para iniciar la conversación</p>
                    <button
                      onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                      className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs transition-colors"
                    >
                      <FileText className="size-3.5" />
                      Enviar template
                    </button>
                  </>
                )}
              </div>
            ) : (
              groupedMessages().map(({ date, msgs }) => (
                <div key={date}>
                  <div className="flex items-center justify-center my-3">
                    <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[11px]">
                      {formatDateSeparator(msgs[0].created_at)}
                    </span>
                  </div>
                  {msgs.map(msg => {
                    const isOut = msg.direction === 'outbound'
                    return (
                      <div key={msg.id} className={`flex mb-1.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`relative max-w-[65%] px-3 py-1.5 rounded-lg text-sm ${isOut ? 'bg-green-700 text-white rounded-tr-none' : 'bg-card text-card-foreground rounded-tl-none'}`}>
                          {msg.content && <p className="whitespace-pre-wrap wrap-break-word leading-[1.45]">{msg.content}</p>}
                          {msg.template_name && !msg.content && <p className="italic text-xs text-foreground/60">📋 {msg.template_name}</p>}
                          <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : ''}`}>
                            <span className="text-[10px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                            {isOut && <MessageStatusIcon status={msg.status} />}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="px-4 py-3 bg-card">
          {activeConv.status !== 'open' ? (
            <div className="rounded-lg border bg-muted px-3 py-2 text-center flex items-center justify-center gap-2">
              <p className="text-xs text-muted-foreground">Conversación {activeConv.status === 'closed' ? 'cerrada' : 'archivada'}</p>
              <button className="text-xs text-green-400 hover:underline" onClick={() => handleStatusChange('open')}>Reabrir</button>
            </div>
          ) : !canReply ? (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-center">
              <p className="text-xs text-yellow-400">Ventana de 24h expirada — solo podés enviar templates aprobados</p>
              {activeConv.channel?.platform === 'whatsapp' && (
                <button
                  onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 text-white text-xs transition-colors"
                >
                  <FileText className="size-3" />
                  Enviar template
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-end gap-2">
              {activeConv.channel?.platform === 'whatsapp' && (
                <button
                  onClick={() => handleOpenTemplateDialog({ type: 'conversation', conversationId: activeConv.id })}
                  className="size-10 shrink-0 rounded-full bg-accent hover:bg-accent flex items-center justify-center transition-colors"
                  title="Enviar template"
                >
                  <FileText className="size-4 text-muted-foreground" />
                </button>
              )}
              <textarea rows={1}
                className="flex-1 rounded-lg bg-accent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-1 focus:ring-ring min-h-10 max-h-30 overflow-y-auto"
                placeholder="Escribí un mensaje..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                disabled={isSending}
              />
              <button onClick={handleSend} disabled={!messageInput.trim() || isSending}
                className="size-10 shrink-0 rounded-full bg-green-600 hover:bg-green-500 disabled:opacity-40 flex items-center justify-center transition-colors">
                <Send className="size-4 text-white" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
