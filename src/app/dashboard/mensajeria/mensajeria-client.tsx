'use client'

import { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react'
import {
  MessageSquare, Search, Send, Phone, Instagram, Clock,
  Calendar, X, Plus, Filter, ArrowLeft,
  CheckCheck, Check, AlertCircle, Image as ImageIcon,
  Settings, Smartphone, Wifi, WifiOff, QrCode, RefreshCw, LogOut, Star, Save,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  sendMessage as sendMessageAction,
  markAsRead,
  scheduleMessage,
  cancelScheduledMessage,
} from '@/lib/actions/messaging'
import { updateWaApiUrl, updateReviewAutoConfig } from '@/lib/actions/settings'
import { getWhatsAppStatus, getWhatsAppQR, logoutWhatsApp } from '@/lib/actions/whatsapp'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import type { AppSettings, Conversation, Message, SocialChannel, ScheduledMessage, Client } from '@/lib/types/database'

// ============================================
// Platform icons and colors
// ============================================
function PlatformIcon({ platform, className = 'size-4' }: { platform: string; className?: string }) {
  switch (platform) {
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      )
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/>
        </svg>
      )
    case 'instagram':
      return <Instagram className={className} />
    default:
      return <MessageSquare className={className} />
  }
}

function platformColor(platform: string) {
  switch (platform) {
    case 'whatsapp': return 'text-green-400'
    case 'facebook': return 'text-blue-400'
    case 'instagram': return 'text-pink-400'
    default: return 'text-muted-foreground'
  }
}

function platformBg(platform: string) {
  switch (platform) {
    case 'whatsapp': return 'bg-green-500/10 border-green-500/20'
    case 'facebook': return 'bg-blue-500/10 border-blue-500/20'
    case 'instagram': return 'bg-pink-500/10 border-pink-500/20'
    default: return 'bg-muted'
  }
}

function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'sent': return <Check className="size-3 text-muted-foreground" />
    case 'delivered': return <CheckCheck className="size-3 text-muted-foreground" />
    case 'read': return <CheckCheck className="size-3 text-blue-400" />
    case 'failed': return <AlertCircle className="size-3 text-red-400" />
    default: return <Clock className="size-3 text-muted-foreground/50" />
  }
}

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function formatRelativeDate(date: string) {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'ahora'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

function formatScheduledDate(date: string) {
  return new Date(date).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ============================================
// Main Component
// ============================================

interface ConversationWithRelations extends Conversation {
  channel?: SocialChannel & { branch_id?: string }
  client?: Client
}

interface ScheduledWithRelations {
  id: string
  channel_id: string
  client_id: string
  template_id: string | null
  content: string | null
  template_params: Record<string, unknown> | null
  scheduled_for: string
  status: string
  sent_at: string | null
  error_message: string | null
  created_by: string | null
  created_at: string
  channel?: { platform: string; display_name: string }
  client?: { name: string; phone: string }
}

interface Props {
  initialConversations: ConversationWithRelations[]
  channels: SocialChannel[]
  scheduledMessages: ScheduledWithRelations[]
  templates: any[]
  clients: Pick<Client, 'id' | 'name' | 'phone'>[]
  appSettings: AppSettings | null
}

type TabView = 'inbox' | 'scheduled'

export function MensajeriaClient({
  initialConversations,
  channels,
  scheduledMessages: initialScheduled,
  templates,
  clients,
  appSettings,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [conversations, setConversations] = useState(initialConversations)
  const [scheduled, setScheduled] = useState(initialScheduled)
  const [activeConv, setActiveConv] = useState<ConversationWithRelations | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [activeTab, setActiveTab] = useState<TabView>('inbox')
  const [isSending, startSending] = useTransition()
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [scheduleData, setScheduleData] = useState({
    clientId: '',
    channelId: '',
    content: '',
    scheduledFor: '',
  })
  const [showMobileChat, setShowMobileChat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load messages when active conversation changes
  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true)
    const { data } = await supabase
      .from('messages')
      .select('*, sent_by:staff(full_name)')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
    setMessages(data ?? [])
    setLoadingMessages(false)
  }, [supabase])

  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv.id)
      // Mark as read
      if (activeConv.unread_count > 0) {
        markAsRead(activeConv.id)
        setConversations(prev =>
          prev.map(c => c.id === activeConv.id ? { ...c, unread_count: 0 } : c)
        )
      }
    }
  }, [activeConv, loadMessages])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('messages-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const newMsg = payload.new as Message
        // If this message belongs to the active conversation, add it
        if (activeConv && newMsg.conversation_id === activeConv.id) {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev
            return [...prev, newMsg]
          })
        }
        // Update conversation list
        setConversations(prev =>
          prev.map(c => {
            if (c.id === newMsg.conversation_id) {
              return {
                ...c,
                last_message_at: newMsg.created_at,
                unread_count: activeConv?.id === c.id ? 0 : c.unread_count + 1,
              }
            }
            return c
          }).sort((a, b) => {
            const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
            const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
            return db - da
          })
        )
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversations',
      }, (payload) => {
        const newConv = payload.new as ConversationWithRelations
        setConversations(prev => {
          if (prev.some(c => c.id === newConv.id)) return prev
          return [newConv, ...prev]
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, activeConv])

  const handleSend = () => {
    if (!messageInput.trim() || !activeConv) return
    const content = messageInput.trim()
    setMessageInput('')

    startSending(async () => {
      const result = await sendMessageAction(activeConv.id, content)
      if (result.error) {
        toast.error(result.error)
        setMessageInput(content)
      }
    })
  }

  const handleSchedule = () => {
    if (!scheduleData.clientId || !scheduleData.channelId || !scheduleData.content || !scheduleData.scheduledFor) {
      toast.error('Completá todos los campos')
      return
    }

    startSending(async () => {
      const result = await scheduleMessage({
        channelId: scheduleData.channelId,
        clientId: scheduleData.clientId,
        content: scheduleData.content,
        scheduledFor: new Date(scheduleData.scheduledFor).toISOString(),
      })

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Mensaje programado')
        setShowScheduleDialog(false)
        setScheduleData({ clientId: '', channelId: '', content: '', scheduledFor: '' })
        // Refresh scheduled list
        const { data } = await supabase
          .from('scheduled_messages')
          .select('*, channel:social_channels(platform, display_name), client:clients(name, phone)')
          .in('status', ['pending', 'sent', 'failed'])
          .order('scheduled_for', { ascending: true })
        setScheduled(data ?? [])
      }
    })
  }

  const handleCancelScheduled = async (id: string) => {
    const result = await cancelScheduledMessage(id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Mensaje cancelado')
      setScheduled(prev => prev.filter(s => s.id !== id))
    }
  }

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (platformFilter !== 'all' && c.channel?.platform !== platformFilter) return false
      if (search) {
        const s = search.toLowerCase()
        const name = (c.client?.name || c.platform_user_name || '').toLowerCase()
        const phone = (c.client?.phone || c.platform_user_id || '').toLowerCase()
        if (!name.includes(s) && !phone.includes(s)) return false
      }
      return true
    })
  }, [conversations, platformFilter, search])

  // Can reply check (WhatsApp 24h window)
  const canReply = useMemo(() => {
    if (!activeConv) return true
    if (activeConv.channel?.platform !== 'whatsapp') return true
    if (!activeConv.can_reply_until) return false
    return new Date(activeConv.can_reply_until) > new Date()
  }, [activeConv])

  const timeUntilExpiry = useMemo(() => {
    if (!activeConv?.can_reply_until) return null
    const diff = new Date(activeConv.can_reply_until).getTime() - Date.now()
    if (diff <= 0) return null
    const hours = Math.floor(diff / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    return `${hours}h ${mins}m`
  }, [activeConv])

  // ============================================
  // Conversation list sidebar
  // ============================================
  function ConversationList() {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-3">
          <h2 className="text-lg font-bold tracking-tight">Mensajería</h2>
          <div className="flex items-center gap-1">
            <Button
              variant={activeTab === 'inbox' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('inbox')}
              className="h-7 text-xs"
            >
              <MessageSquare className="mr-1 size-3" />
              Inbox
            </Button>
            <Button
              variant={activeTab === 'scheduled' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('scheduled')}
              className="h-7 text-xs"
            >
              <Calendar className="mr-1 size-3" />
              Programados
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="h-7 w-7 ml-1"
              title="Configuración de WhatsApp"
            >
              <Settings className="size-3.5" />
            </Button>
          </div>
        </div>

        {activeTab === 'inbox' ? (
          <>
            {/* Search and filter */}
            <div className="space-y-2 px-4 pb-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-sm"
                  placeholder="Buscar conversación..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1">
                {['all', 'whatsapp', 'facebook', 'instagram'].map(p => (
                  <button
                    key={p}
                    onClick={() => setPlatformFilter(p)}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      platformFilter === p
                        ? p === 'all'
                          ? 'border-foreground/30 bg-foreground/10 text-foreground'
                          : `${platformBg(p)} ${platformColor(p)}`
                        : 'border-border text-muted-foreground hover:border-foreground/20'
                    }`}
                  >
                    {p === 'all' ? (
                      <Filter className="size-3" />
                    ) : (
                      <PlatformIcon platform={p} className="size-3" />
                    )}
                    {p === 'all' ? 'Todos' : p === 'whatsapp' ? 'WA' : p === 'facebook' ? 'FB' : 'IG'}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Conversation list */}
            <ScrollArea className="flex-1">
              {filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <MessageSquare className="mb-3 size-10 opacity-20" />
                  <p className="text-sm">No hay conversaciones</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Configurá un canal para empezar
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredConversations.map(conv => {
                    const isActive = activeConv?.id === conv.id
                    const name = conv.client?.name || conv.platform_user_name || conv.platform_user_id
                    return (
                      <button
                        key={conv.id}
                        onClick={() => {
                          setActiveConv(conv)
                          setShowMobileChat(true)
                        }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                          isActive ? 'bg-muted/80' : ''
                        }`}
                      >
                        {/* Platform icon */}
                        <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border ${platformBg(conv.channel?.platform || '')}`}>
                          <PlatformIcon
                            platform={conv.channel?.platform || ''}
                            className={`size-4 ${platformColor(conv.channel?.platform || '')}`}
                          />
                        </div>
                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{name}</p>
                            {conv.last_message_at && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {formatRelativeDate(conv.last_message_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs text-muted-foreground">
                              {conv.client?.phone || conv.platform_user_id}
                            </p>
                            {conv.unread_count > 0 && (
                              <Badge className="h-4 min-w-[16px] shrink-0 justify-center rounded-full bg-green-500 px-1 text-[10px] text-white">
                                {conv.unread_count}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          /* Scheduled messages tab */
          <>
            <div className="px-4 pb-3">
              <Button
                size="sm"
                onClick={() => setShowScheduleDialog(true)}
                className="w-full h-8 text-xs"
              >
                <Plus className="mr-1.5 size-3" />
                Programar mensaje
              </Button>
            </div>
            <Separator />
            <ScrollArea className="flex-1">
              {scheduled.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Calendar className="mb-3 size-10 opacity-20" />
                  <p className="text-sm">No hay mensajes programados</p>
                </div>
              ) : (
                <div className="divide-y">
                  {scheduled.map(msg => (
                    <div key={msg.id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <PlatformIcon
                            platform={msg.channel?.platform || ''}
                            className={`size-3 shrink-0 ${platformColor(msg.channel?.platform || '')}`}
                          />
                          <span className="truncate text-sm font-medium">
                            {msg.client?.name || 'Cliente'}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] ${
                            msg.status === 'pending'
                              ? 'text-yellow-400 border-yellow-500/30'
                              : msg.status === 'sent'
                              ? 'text-green-400 border-green-500/30'
                              : 'text-red-400 border-red-500/30'
                          }`}
                        >
                          {msg.status === 'pending' ? 'Pendiente' : msg.status === 'sent' ? 'Enviado' : 'Falló'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{msg.content}</p>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="size-2.5" />
                          {formatScheduledDate(msg.scheduled_for)}
                        </span>
                        {msg.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => handleCancelScheduled(msg.id)}
                          >
                            <X className="mr-0.5 size-2.5" />
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    )
  }

  // ============================================
  // Chat view
  // ============================================
  function ChatView() {
    if (!activeConv) {
      return (
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
          <div className="relative mb-6">
            <div className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-green-500/10 via-blue-500/10 to-pink-500/10 border border-white/5">
              <MessageSquare className="size-8 opacity-30" />
            </div>
          </div>
          <p className="text-sm font-medium">Seleccioná una conversación</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Elegí una conversación de la lista para ver los mensajes
          </p>
        </div>
      )
    }

    const name = activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id
    const platform = activeConv.channel?.platform || ''

    return (
      <div className="flex h-full flex-col">
        {/* Chat header */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden size-8"
            onClick={() => setShowMobileChat(false)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className={`flex size-8 items-center justify-center rounded-full border ${platformBg(platform)}`}>
            <PlatformIcon platform={platform} className={`size-3.5 ${platformColor(platform)}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-[11px] text-muted-foreground">
              {activeConv.client?.phone || activeConv.platform_user_id}
            </p>
          </div>
          {platform === 'whatsapp' && timeUntilExpiry && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-yellow-400 border-yellow-500/30">
              <Clock className="size-2.5" />
              {timeUntilExpiry}
            </Badge>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-3 py-4">
            {loadingMessages ? (
              <div className="flex justify-center py-10">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="mb-2 size-8 opacity-20" />
                <p className="text-xs">No hay mensajes aún</p>
              </div>
            ) : (
              messages.map(msg => {
                const isOutbound = msg.direction === 'outbound'
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                        isOutbound
                          ? 'bg-primary text-primary-foreground rounded-br-md'
                          : 'bg-muted rounded-bl-md'
                      }`}
                    >
                      {msg.content_type === 'image' && msg.media_url && (
                        <div className="mb-1.5 overflow-hidden rounded-lg">
                          <ImageIcon className="size-12 text-muted-foreground/30" />
                        </div>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                      {msg.template_name && !msg.content && (
                        <p className="italic text-xs opacity-70">📋 Template: {msg.template_name}</p>
                      )}
                      <div className={`mt-1 flex items-center gap-1 ${isOutbound ? 'justify-end' : ''}`}>
                        <span className="text-[10px] opacity-60">{formatTime(msg.created_at)}</span>
                        {isOutbound && <MessageStatusIcon status={msg.status} />}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t p-3">
          {!canReply && platform === 'whatsapp' ? (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5 text-center">
              <p className="text-xs text-yellow-400">
                ⏰ La ventana de 24hs expiró. Solo podés enviar mensajes con templates aprobados.
              </p>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Escribí un mensaje..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={isSending}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!messageInput.trim() || isSending}
                className="shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ============================================
  // Client profile panel
  // ============================================
  function ClientPanel() {
    if (!activeConv?.client) return null

    const client = activeConv.client

    return (
      <div className="flex h-full flex-col border-l">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Ficha del cliente</h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            {/* Name & phone */}
            <div className="text-center">
              <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
                <span className="text-lg font-bold text-primary">
                  {client.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <p className="font-semibold">{client.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{client.phone}</p>
            </div>

            <Separator />

            {/* Instagram */}
            {client.instagram && (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <Instagram className="size-3.5 text-pink-400" />
                <span className="text-sm text-muted-foreground">{client.instagram}</span>
              </div>
            )}

            {/* Notes */}
            {client.notes && (
              <div className="rounded-lg border bg-card/30 p-3">
                <p className="mb-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Notas</p>
                <p className="text-xs text-muted-foreground">{client.notes}</p>
              </div>
            )}

            {/* Quick actions */}
            <div className="space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs justify-start bg-green-500/5 text-green-400 border-green-500/20 hover:bg-green-500/10"
                onClick={() => window.open(`https://wa.me/${client.phone.replace(/\D/g, '')}`, '_blank')}
              >
                <Phone className="mr-2 size-3" />
                Abrir en WhatsApp
              </Button>
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }

  // ============================================
  // Schedule dialog
  // ============================================
  function ScheduleDialog() {
    return (
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="size-4" />
              Programar mensaje
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Client select */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cliente</label>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={scheduleData.clientId}
                onChange={(e) => setScheduleData(prev => ({ ...prev, clientId: e.target.value }))}
              >
                <option value="">Seleccionar cliente...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                ))}
              </select>
            </div>

            {/* Channel select */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Canal</label>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={scheduleData.channelId}
                onChange={(e) => setScheduleData(prev => ({ ...prev, channelId: e.target.value }))}
              >
                <option value="">Seleccionar canal...</option>
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>
                    {ch.platform === 'whatsapp' ? '🟢 WhatsApp' : ch.platform === 'facebook' ? '🔵 Facebook' : '🩷 Instagram'} — {ch.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Message content */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Mensaje</label>
              <textarea
                className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Contenido del mensaje..."
                value={scheduleData.content}
                onChange={(e) => setScheduleData(prev => ({ ...prev, content: e.target.value }))}
              />
            </div>

            {/* Date/time */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Fecha y hora de envío</label>
              <Input
                type="datetime-local"
                className="h-9"
                value={scheduleData.scheduledFor}
                onChange={(e) => setScheduleData(prev => ({ ...prev, scheduledFor: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowScheduleDialog(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSchedule} disabled={isSending}>
              <Calendar className="mr-1.5 size-3" />
              {isSending ? 'Programando...' : 'Programar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // ============================================
  // Layout
  // ============================================
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden -m-4 lg:-m-6">
      {/* Conversation list — always visible on desktop, hidden when chat open on mobile */}
      <div className={`w-full lg:w-80 xl:w-96 shrink-0 border-r flex flex-col bg-background ${
        showMobileChat ? 'hidden lg:flex' : 'flex'
      }`}>
        <ConversationList />
      </div>

      {/* Chat — hidden on mobile when no chat selected */}
      <div className={`flex-1 min-w-0 ${
        !showMobileChat ? 'hidden lg:flex' : 'flex'
      } flex-col`}>
        <ChatView />
      </div>

      {/* Client panel — only visible on xl screens when a conversation with a client is active */}
      {activeConv?.client && (
        <div className="hidden xl:flex w-72 shrink-0">
          <ClientPanel />
        </div>
      )}

      {/* Schedule dialog */}
      <ScheduleDialog />

      {/* Settings sheet — WhatsApp + Reseña automática */}
      <Sheet open={showSettings} onOpenChange={setShowSettings}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Settings className="size-4" />
              Configuración de mensajería
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-6">
            <WaConfigSection settings={appSettings} />
            <Separator />
            <ReviewAutoSection settings={appSettings} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ============================================
// WA Config Section — dentro del Sheet de configuración
// ============================================

type WaStatus = 'connected' | 'disconnected' | 'qr_pending' | 'not_configured' | 'loading'

function WaConfigSection({ settings }: { settings: AppSettings | null }) {
  const [waUrl, setWaUrl] = useState(settings?.wa_api_url ?? '')
  const [status, setStatus] = useState<WaStatus>('loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const checkStatus = async () => {
    const result = await getWhatsAppStatus()
    setStatus(result.status)
    if (result.status === 'qr_pending') {
      const qrResult = await getWhatsAppQR()
      setQrCode(qrResult.qr)
    } else {
      setQrCode(null)
    }
  }

  useEffect(() => {
    checkStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status !== 'qr_pending') return
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveUrl = () => {
    startTransition(async () => {
      const result = await updateWaApiUrl(waUrl)
      if (result.error) toast.error(result.error)
      else {
        toast.success('URL guardada')
        await checkStatus()
      }
    })
  }

  const handleLogout = () => {
    startTransition(async () => {
      const result = await logoutWhatsApp()
      if (result.error) toast.error(result.error)
      else {
        toast.success('WhatsApp desconectado')
        setStatus('disconnected')
        setQrCode(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Título + estado */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">WhatsApp de la barbería</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status === 'connected' && (
            <Badge className="h-5 gap-1 bg-green-500/15 text-green-400 border-green-500/25 text-[10px]">
              <Wifi className="size-2.5" /> Conectado
            </Badge>
          )}
          {status === 'disconnected' && (
            <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
              <WifiOff className="mr-1 size-2.5" /> Desconectado
            </Badge>
          )}
          {status === 'qr_pending' && (
            <Badge className="h-5 gap-1 bg-yellow-500/15 text-yellow-400 border-yellow-500/25 text-[10px]">
              <QrCode className="size-2.5" /> Esperando QR
            </Badge>
          )}
          {status === 'not_configured' && (
            <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
              Sin configurar
            </Badge>
          )}
          {status === 'loading' && (
            <div className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
          )}
        </div>
      </div>

      {/* URL del microservicio */}
      <div className="space-y-1.5">
        <Label className="text-xs">URL del microservicio</Label>
        <div className="flex gap-2">
          <Input
            value={waUrl}
            onChange={(e) => setWaUrl(e.target.value)}
            placeholder="https://msb-wa.up.railway.app"
            className="h-8 text-xs"
          />
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveUrl} disabled={isPending}>
            <Save className="size-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Railway/Render donde corre Baileys</p>
      </div>

      {/* QR code */}
      {status === 'qr_pending' && qrCode && (
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-white p-4">
          <p className="text-sm font-medium text-black">Escaneá con WhatsApp</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="Código QR de WhatsApp" className="size-44" />
          <p className="text-center text-[11px] text-gray-500">
            WhatsApp → Dispositivos vinculados → Vincular dispositivo
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={checkStatus} disabled={isPending} className="flex-1 h-8 text-xs">
          <RefreshCw className="mr-1.5 size-3" />
          Actualizar
        </Button>
        {status === 'connected' && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={isPending}
            className="h-8 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
          >
            <LogOut className="mr-1.5 size-3" />
            Desconectar
          </Button>
        )}
      </div>
    </div>
  )
}

// ============================================
// Review Auto Section — dentro del Sheet de configuración
// ============================================

const REVIEW_VARIABLES = ['{nombre}', '{barbero}', '{servicio}', '{link_resena}']
const DEFAULT_TEMPLATE =
  '¡Hola {nombre}! Gracias por visitarnos en Monaco Smart Barber 💈. Nos encantaría saber qué te pareció tu experiencia. Dejanos tu opinión acá: {link_resena} ⭐'

function ReviewAutoSection({ settings }: { settings: AppSettings | null }) {
  const [autoSend, setAutoSend] = useState(settings?.review_auto_send ?? false)
  const [delayMinutes, setDelayMinutes] = useState(settings?.review_delay_minutes ?? 15)
  const [template, setTemplate] = useState(settings?.review_message_template ?? DEFAULT_TEMPLATE)
  const [isPending, startTransition] = useTransition()

  const preview = template
    .replaceAll('{nombre}', 'Juan')
    .replaceAll('{barbero}', 'Carlos')
    .replaceAll('{servicio}', 'Corte de cabello')
    .replaceAll('{link_resena}', 'https://monaco.app/review/abc123')

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateReviewAutoConfig({
        reviewAutoSend: autoSend,
        reviewDelayMinutes: delayMinutes,
        reviewMessageTemplate: template,
        waApiUrl: settings?.wa_api_url ?? '',
      })
      if (result.error) toast.error(result.error)
      else toast.success('Configuración de reseña guardada')
    })
  }

  return (
    <div className="space-y-4">
      {/* Título + toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Reseña automática</span>
        </div>
        <Switch checked={autoSend} onCheckedChange={setAutoSend} />
      </div>

      <p className="text-[11px] text-muted-foreground -mt-2">
        Enviá un mensaje de WhatsApp pidiendo reseña al finalizar el servicio
      </p>

      {/* Delay */}
      <div className="space-y-1.5">
        <Label className="text-xs">Enviar a los</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={120}
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(Number(e.target.value))}
            className="h-8 w-20 text-xs"
          />
          <span className="text-xs text-muted-foreground">minutos de finalizar</span>
        </div>
      </div>

      {/* Template */}
      <div className="space-y-1.5">
        <Label className="text-xs">Mensaje</Label>
        <div className="flex flex-wrap gap-1">
          {REVIEW_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTemplate((prev) => prev + v)}
              className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-mono hover:bg-muted/70 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={4}
          placeholder="Escribí el mensaje..."
          className="text-xs resize-none"
        />
      </div>

      {/* Preview */}
      <div className="rounded-lg bg-muted/50 p-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Vista previa
        </p>
        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
          {preview}
        </p>
      </div>

      <Button onClick={handleSave} disabled={isPending} size="sm" className="w-full">
        <Save className="mr-2 size-3.5" />
        {isPending ? 'Guardando...' : 'Guardar configuración'}
      </Button>
    </div>
  )
}
