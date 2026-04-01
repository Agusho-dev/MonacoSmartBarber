'use client'

import {
  useState, useEffect, useMemo, useRef, useCallback, useTransition,
} from 'react'
import {
  Search, Send, Clock, Calendar, X, Plus, ArrowLeft,
  CheckCheck, Check, AlertCircle, Settings, Copy, Eye, EyeOff,
  MessageSquare, Wifi, WifiOff, ExternalLink, User, ChevronRight,
  Archive, CheckCircle2, RotateCcw, Pencil, Instagram, Facebook,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { sendMessage as sendMessageAction, markAsRead, cancelScheduledMessage } from '@/lib/actions/messaging'
import { saveOrgWhatsAppConfig } from '@/lib/actions/whatsapp-meta'
import { saveOrgInstagramConfig } from '@/lib/actions/instagram-meta'
import { startConversation, updateConversationStatus, getClientVisits, scheduleMessageAuto } from '@/lib/actions/conversations'
import { createConversationTag, deleteConversationTag, assignConversationTag, removeConversationTag } from '@/lib/actions/tags'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import type { Conversation, Message, SocialChannel, Client, OrgWhatsAppConfig, OrgInstagramConfig, ConversationTag } from '@/lib/types/database'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

const AVATAR_COLORS = [
  'bg-emerald-600', 'bg-sky-600', 'bg-violet-600',
  'bg-rose-600', 'bg-amber-600', 'bg-teal-600',
]

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

function Avatar({ name, size = 10 }: { name: string; size?: number }) {
  const sz = `size-${size}`
  const text = size <= 8 ? 'text-xs' : 'text-sm'
  return (
    <div className={`${sz} ${avatarColor(name)} rounded-full flex items-center justify-center text-white font-semibold ${text} shrink-0`}>
      {initials(name)}
    </div>
  )
}

function WhatsAppIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'sent': return <Check className="size-3 opacity-70" />
    case 'delivered': return <CheckCheck className="size-3 opacity-70" />
    case 'read': return <CheckCheck className="size-3 text-sky-300" />
    case 'failed': return <AlertCircle className="size-3 text-red-400" />
    default: return <Clock className="size-3 opacity-40" />
  }
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'open': return null
    case 'closed': return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">Cerrado</span>
    case 'archived': return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">Archivado</span>
    default: return null
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
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'ahora'
  if (diffMins < 60) return `${diffMins}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

function formatDateSeparator(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diffD = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffD === 0) return 'Hoy'
  if (diffD === 1) return 'Ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ConversationWithRelations extends Conversation {
  channel?: SocialChannel & { branch_id?: string }
  client?: Client
  tags?: Array<{ tag_id: string; tag: ConversationTag }>
}

interface ScheduledWithRelations {
  id: string
  client_id: string
  content: string | null
  scheduled_for: string
  status: string
  client?: { name: string; phone: string }
}

interface ClientVisit {
  id: string
  amount: number
  started_at: string
  payment_method: string
  service?: { name: string } | null
  barber?: { full_name: string } | null
}

interface Props {
  initialConversations: ConversationWithRelations[]
  channels: SocialChannel[]
  scheduledMessages: ScheduledWithRelations[]
  clients: Pick<Client, 'id' | 'name' | 'phone'>[]
  waConfig: OrgWhatsAppConfig | null
  igConfig: OrgInstagramConfig | null
  initialTags: ConversationTag[]
}

type SettingsTab = 'whatsapp' | 'instagram' | 'facebook' | 'tags'
type PlatformFilter = 'all' | 'whatsapp' | 'instagram'

const TAG_COLORS = [
  '#22C55E', '#EF4444', '#F97316', '#EAB308',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899', '#6B7280',
]

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────

export function MensajeriaClient({
  initialConversations,
  scheduledMessages: initialScheduled,
  clients,
  waConfig: initialWaConfig,
  igConfig: initialIgConfig,
  initialTags,
}: Props) {
  const supabase = useMemo(() => createClient(), [])

  // Conversations
  const [conversations, setConversations] = useState(initialConversations)
  const [activeConv, setActiveConv] = useState<ConversationWithRelations | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  // UI
  const [messageInput, setMessageInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'archived'>('all')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all')
  const [showMobileChat, setShowMobileChat] = useState(false)
  const [activeTab, setActiveTab] = useState<'inbox' | 'scheduled'>('inbox')
  const [isSending, startSending] = useTransition()
  const [isActing, startActing] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Tags
  const [tags, setTags] = useState<ConversationTag[]>(initialTags)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [creatingTag, startCreatingTag] = useTransition()
  const [taggingConv, startTaggingConv] = useTransition()

  // Client profile panel
  const [showProfile, setShowProfile] = useState(false)
  const [clientVisits, setClientVisits] = useState<ClientVisit[]>([])
  const [loadingVisits, setLoadingVisits] = useState(false)

  // Scheduled
  const [scheduled, setScheduled] = useState(initialScheduled)
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [scheduleData, setScheduleData] = useState({ clientId: '', content: '', scheduledFor: '' })

  // Nueva conversación
  const [showNewChat, setShowNewChat] = useState(false)
  const [newChatClientId, setNewChatClientId] = useState('')
  const [newChatSearch, setNewChatSearch] = useState('')
  const [isStarting, startStarting] = useTransition()

  // Settings
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('whatsapp')
  const [waConfig, setWaConfig] = useState<OrgWhatsAppConfig | null>(initialWaConfig)
  const [configForm, setConfigForm] = useState({
    whatsapp_access_token: initialWaConfig?.whatsapp_access_token ?? '',
    whatsapp_phone_id: initialWaConfig?.whatsapp_phone_id ?? '',
    whatsapp_business_id: initialWaConfig?.whatsapp_business_id ?? '',
  })
  const [showToken, setShowToken] = useState(false)
  const [savingConfig, startSavingConfig] = useTransition()

  // Instagram config
  const [igConfig, setIgConfig] = useState<OrgInstagramConfig | null>(initialIgConfig)
  const [igConfigForm, setIgConfigForm] = useState({
    instagram_page_id: initialIgConfig?.instagram_page_id ?? '',
    instagram_page_access_token: initialIgConfig?.instagram_page_access_token ?? '',
    instagram_account_id: initialIgConfig?.instagram_account_id ?? '',
  })
  const [showIgToken, setShowIgToken] = useState(false)
  const [savingIgConfig, startSavingIgConfig] = useTransition()

  // ── Load messages ──
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
    if (!activeConv) return
    loadMessages(activeConv.id)
    if (activeConv.unread_count > 0) {
      markAsRead(activeConv.id)
      setConversations(prev =>
        prev.map(c => c.id === activeConv.id ? { ...c, unread_count: 0 } : c)
      )
    }
  }, [activeConv, loadMessages])

  // ── Load client visits ──
  const loadVisits = useCallback(async (clientId: string) => {
    setLoadingVisits(true)
    const result = await getClientVisits(clientId)
    setClientVisits((result.data as ClientVisit[]) ?? [])
    setLoadingVisits(false)
  }, [])

  useEffect(() => {
    if (showProfile && activeConv?.client_id) {
      loadVisits(activeConv.client_id)
    }
  }, [showProfile, activeConv, loadVisits])

  // ── Scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Realtime ──
  useEffect(() => {
    const channel = supabase
      .channel('mensajeria-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message
        if (activeConv && newMsg.conversation_id === activeConv.id) {
          setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])
        }
        setConversations(prev =>
          prev.map(c => {
            if (c.id !== newMsg.conversation_id) return c
            return { ...c, last_message_at: newMsg.created_at, unread_count: activeConv?.id === c.id ? 0 : c.unread_count + 1 }
          }).sort((a, b) => {
            const da = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
            const db = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
            return db - da
          })
        )
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const updated = payload.new as Message
        setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, status: updated.status } : m))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, (payload) => {
        const newConv = payload.new as ConversationWithRelations
        setConversations(prev => prev.some(c => c.id === newConv.id) ? prev : [newConv, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, activeConv])

  // ── Filtered conversations ──
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (platformFilter !== 'all' && c.channel?.platform !== platformFilter) return false
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (tagFilter && !c.tags?.some(t => t.tag_id === tagFilter)) return false
      if (!search) return true
      const s = search.toLowerCase()
      const name = (c.client?.name || c.platform_user_name || '').toLowerCase()
      const phone = (c.client?.phone || c.platform_user_id || '').toLowerCase()
      return name.includes(s) || phone.includes(s)
    })
  }, [conversations, platformFilter, statusFilter, tagFilter, search])

  const filteredClientsForNewChat = useMemo(() => {
    if (!newChatSearch) return clients.slice(0, 20)
    const s = newChatSearch.toLowerCase()
    return clients.filter(c =>
      c.name.toLowerCase().includes(s) || (c.phone || '').toLowerCase().includes(s)
    ).slice(0, 20)
  }, [clients, newChatSearch])

  // ── Reply window ──
  const canReply = useMemo(() => {
    if (!activeConv?.can_reply_until) return true
    return new Date(activeConv.can_reply_until) > new Date()
  }, [activeConv])

  const replyWindowLeft = useMemo(() => {
    if (!activeConv?.can_reply_until) return null
    const diff = new Date(activeConv.can_reply_until).getTime() - Date.now()
    if (diff <= 0) return null
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `${h}h ${m}m`
  }, [activeConv])

  // ── Send message ──
  const handleSend = () => {
    if (!messageInput.trim() || !activeConv) return
    const content = messageInput.trim()
    setMessageInput('')
    const tempMsg: Message = {
      id: `tmp-${Date.now()}`, conversation_id: activeConv.id, direction: 'outbound',
      content_type: 'text', content, media_url: null, template_name: null,
      template_params: null, platform_message_id: null, status: 'pending',
      sent_by_staff_id: null, error_message: null, created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])
    startSending(async () => {
      const result = await sendMessageAction(activeConv.id, content)
      if (result.error) {
        toast.error(result.error)
        setMessageInput(content)
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      } else {
        // Eliminar el temporal — el realtime va a agregar el mensaje real con estado correcto
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      }
    })
  }

  // ── Nueva conversación ──
  const handleStartConversation = () => {
    if (!newChatClientId) { toast.error('Seleccioná un cliente'); return }
    startStarting(async () => {
      const result = await startConversation(newChatClientId)
      if (result.error) { toast.error(result.error); return }
      const conv = result.data as ConversationWithRelations
      setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
      setActiveConv(conv)
      setShowNewChat(false)
      setNewChatClientId('')
      setNewChatSearch('')
      setShowMobileChat(true)
    })
  }

  // ── Update conversation status ──
  const handleStatusChange = (status: 'open' | 'closed' | 'archived') => {
    if (!activeConv) return
    startActing(async () => {
      const result = await updateConversationStatus(activeConv.id, status)
      if (result.error) { toast.error(result.error); return }
      setConversations(prev => prev.map(c => c.id === activeConv.id ? { ...c, status } : c))
      setActiveConv(prev => prev ? { ...prev, status } : prev)
      toast.success(status === 'closed' ? 'Conversación cerrada' : status === 'archived' ? 'Conversación archivada' : 'Conversación reabierta')
    })
  }

  // ── Schedule message ──
  const handleSchedule = () => {
    if (!scheduleData.clientId || !scheduleData.content || !scheduleData.scheduledFor) {
      toast.error('Completá todos los campos'); return
    }
    startSending(async () => {
      const result = await scheduleMessageAuto({
        clientId: scheduleData.clientId,
        content: scheduleData.content,
        scheduledFor: new Date(scheduleData.scheduledFor).toISOString(),
      })
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Mensaje programado')
        setShowScheduleDialog(false)
        setScheduleData({ clientId: '', content: '', scheduledFor: '' })
      }
    })
  }

  const handleCancelScheduled = async (id: string) => {
    const result = await cancelScheduledMessage(id)
    if (result.error) { toast.error(result.error) }
    else { toast.success('Cancelado'); setScheduled(prev => prev.filter(s => s.id !== id)) }
  }

  // ── Save WhatsApp config ──
  const handleSaveConfig = () => {
    if (!configForm.whatsapp_access_token || !configForm.whatsapp_phone_id || !configForm.whatsapp_business_id) {
      toast.error('Completá los tres campos'); return
    }
    startSavingConfig(async () => {
      const result = await saveOrgWhatsAppConfig(configForm as any)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Configuración guardada — el canal WhatsApp fue creado automáticamente')
        if (result.data) setWaConfig(result.data as any)
      }
    })
  }

  // ── Tag handlers ──
  const handleCreateTag = () => {
    if (!newTagName.trim()) { toast.error('Escribí un nombre para la etiqueta'); return }
    startCreatingTag(async () => {
      const result = await createConversationTag(newTagName.trim(), newTagColor)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Etiqueta creada')
        if (result.data) setTags(prev => [...prev, result.data as ConversationTag].sort((a, b) => a.name.localeCompare(b.name)))
        setNewTagName('')
      }
    })
  }

  const handleDeleteTag = (tagId: string) => {
    startCreatingTag(async () => {
      const result = await deleteConversationTag(tagId)
      if (result.error) { toast.error(result.error) }
      else {
        setTags(prev => prev.filter(t => t.id !== tagId))
        if (tagFilter === tagId) setTagFilter(null)
        setConversations(prev => prev.map(c => ({ ...c, tags: c.tags?.filter(t => t.tag_id !== tagId) })))
        toast.success('Etiqueta eliminada')
      }
    })
  }

  const handleToggleTag = (conversationId: string, tagId: string) => {
    const conv = conversations.find(c => c.id === conversationId)
    if (!conv) return
    const hasTag = conv.tags?.some(t => t.tag_id === tagId)
    startTaggingConv(async () => {
      if (hasTag) {
        const result = await removeConversationTag(conversationId, tagId)
        if (result.error) { toast.error(result.error); return }
        setConversations(prev => prev.map(c =>
          c.id === conversationId ? { ...c, tags: c.tags?.filter(t => t.tag_id !== tagId) } : c
        ))
        if (activeConv?.id === conversationId) {
          setActiveConv(prev => prev ? { ...prev, tags: prev.tags?.filter(t => t.tag_id !== tagId) } : prev)
        }
      } else {
        const tag = tags.find(t => t.id === tagId)
        if (!tag) return
        const result = await assignConversationTag(conversationId, tagId)
        if (result.error) { toast.error(result.error); return }
        setConversations(prev => prev.map(c =>
          c.id === conversationId ? { ...c, tags: [...(c.tags ?? []), { tag_id: tagId, tag }] } : c
        ))
        if (activeConv?.id === conversationId) {
          setActiveConv(prev => prev ? { ...prev, tags: [...(prev.tags ?? []), { tag_id: tagId, tag }] } : prev)
        }
      }
    })
  }

  // ── Save Instagram config ──
  const handleSaveIgConfig = () => {
    if (!igConfigForm.instagram_page_id || !igConfigForm.instagram_page_access_token) {
      toast.error('Completá el Page ID y el Access Token'); return
    }
    startSavingIgConfig(async () => {
      const result = await saveOrgInstagramConfig(igConfigForm as any)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Instagram conectado — el canal fue creado automáticamente')
        if (result.data) setIgConfig(result.data as any)
      }
    })
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`))
  }

  // ── Message groups ──
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

  const isConfigured = !!(waConfig?.whatsapp_access_token && waConfig?.whatsapp_phone_id && waConfig?.whatsapp_business_id)
  const isInstagramConfigured = !!(igConfig?.instagram_page_id && igConfig?.instagram_page_access_token)
  const activeConvName = activeConv ? (activeConv.client?.name || activeConv.platform_user_name || activeConv.platform_user_id) : ''
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whatsapp` : '/api/webhooks/whatsapp'
  const webhookUrlInstagram = typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/instagram` : '/api/webhooks/instagram'

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#111B21]">

      {/* ═══ LEFT — Conversation list ═══ */}
      <div className={`flex flex-col border-r border-white/5 bg-[#111B21] w-full max-w-sm shrink-0 ${showMobileChat ? 'hidden lg:flex' : 'flex'}`}>

        {/* Header */}
        <div className="bg-[#202C33]">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="font-semibold text-white text-sm">Mensajería</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className={`size-8 ${activeTab === 'scheduled' ? 'text-green-400' : 'text-[#8696A0] hover:text-white'}`}
                onClick={() => setActiveTab(activeTab === 'scheduled' ? 'inbox' : 'scheduled')} title="Mensajes programados">
                <Calendar className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8 text-[#8696A0] hover:text-white"
                onClick={() => setShowSettings(true)} title="Configuración">
                <Settings className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8 text-green-400 hover:text-green-300"
                onClick={() => setShowNewChat(true)} title="Nueva conversación">
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${platformFilter === key ? 'bg-[#2A3942] text-white' : 'text-[#8696A0] hover:text-white'}`}>
                {key === 'whatsapp' && <WhatsAppIcon className="size-3 text-green-400" />}
                {key === 'instagram' && <Instagram className="size-3 text-pink-400" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'inbox' ? (
          <>
            {/* Search + status filter */}
            <div className="px-3 py-2 space-y-2 bg-[#111B21]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8696A0]" />
                <input className="w-full h-8 rounded-lg bg-[#202C33] pl-9 pr-3 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-green-500/50"
                  placeholder="Buscar o iniciar chat" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex gap-1">
                {(['all', 'open', 'closed', 'archived'] as const).map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${statusFilter === s ? 'bg-green-600 text-white' : 'bg-[#202C33] text-[#8696A0] hover:text-white'}`}>
                    {s === 'all' ? 'Todos' : s === 'open' ? 'Abiertos' : s === 'closed' ? 'Cerrados' : 'Archivados'}
                  </button>
                ))}
              </div>
              {tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tags.map(tag => (
                    <button key={tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border ${tagFilter === tag.id ? 'text-white border-transparent' : 'text-[#8696A0] border-white/10 hover:border-white/20'}`}
                      style={tagFilter === tag.id ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ScrollArea className="flex-1">
              {filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8696A0]">
                  <MessageSquare className="mb-3 size-10 opacity-20" />
                  <p className="text-sm">{!isConfigured ? 'Configurá WhatsApp para empezar' : 'No hay conversaciones'}</p>
                  {!isConfigured && (
                    <button className="mt-2 text-xs text-green-400 hover:underline" onClick={() => setShowSettings(true)}>
                      Ir a configuración →
                    </button>
                  )}
                  {isConfigured && (
                    <button className="mt-2 text-xs text-green-400 hover:underline" onClick={() => setShowNewChat(true)}>
                      Iniciar una conversación →
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  {filteredConversations.map(conv => {
                    const isActive = activeConv?.id === conv.id
                    const name = conv.client?.name || conv.platform_user_name || conv.platform_user_id
                    return (
                      <button key={conv.id}
                        onClick={() => { setActiveConv(conv); setShowMobileChat(true); setShowProfile(false) }}
                        className={`flex w-full items-center gap-3 px-3 py-3 transition-colors border-b border-white/4 ${isActive ? 'bg-[#2A3942]' : 'hover:bg-[#202C33]'}`}>
                        <div className="relative shrink-0">
                          <Avatar name={name} size={10} />
                          {conv.channel?.platform === 'instagram' && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-[#111B21] flex items-center justify-center">
                              <Instagram className="size-2.5 text-pink-400" />
                            </span>
                          )}
                          {conv.channel?.platform === 'facebook' && (
                            <span className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-[#111B21] flex items-center justify-center">
                              <Facebook className="size-2.5 text-blue-400" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="truncate text-sm font-medium text-white">{name}</p>
                              <StatusBadge status={conv.status} />
                            </div>
                            {conv.last_message_at && (
                              <span className={`shrink-0 text-[11px] ${conv.unread_count > 0 ? 'text-green-400' : 'text-[#8696A0]'}`}>
                                {formatRelativeDate(conv.last_message_at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <p className="truncate text-xs text-[#8696A0]">{conv.client?.phone || conv.platform_user_id}</p>
                            {conv.unread_count > 0 && (
                              <span className="shrink-0 min-w-4.5 h-4.5 flex items-center justify-center rounded-full bg-green-500 text-[10px] font-semibold text-white px-1">
                                {conv.unread_count}
                              </span>
                            )}
                          </div>
                          {conv.tags && conv.tags.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {conv.tags.map(({ tag_id, tag }) => (
                                <span key={tag_id} className="px-1.5 py-0.5 rounded-full text-[9px] font-medium text-white"
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
            </ScrollArea>
          </>
        ) : (
          /* Scheduled tab */
          <>
            <div className="px-3 py-2">
              <Button size="sm" onClick={() => setShowScheduleDialog(true)} className="w-full h-8 text-xs bg-green-600 hover:bg-green-700 text-white">
                <Plus className="mr-1.5 size-3" /> Programar mensaje
              </Button>
            </div>
            <ScrollArea className="flex-1">
              {scheduled.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#8696A0]">
                  <Calendar className="mb-3 size-10 opacity-20" />
                  <p className="text-sm">Sin mensajes programados</p>
                </div>
              ) : (
                <div>
                  {scheduled.map(msg => (
                    <div key={msg.id} className="px-3 py-3 border-b border-white/4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white">{msg.client?.name || 'Cliente'}</span>
                        <Badge variant="outline" className={`shrink-0 text-[10px] border-0 ${msg.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400' : msg.status === 'sent' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                          {msg.status === 'pending' ? 'Pendiente' : msg.status === 'sent' ? 'Enviado' : 'Falló'}
                        </Badge>
                      </div>
                      <p className="text-xs text-[#8696A0] line-clamp-2">{msg.content}</p>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-[10px] text-[#8696A0]">
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
            </ScrollArea>
          </>
        )}
      </div>

      {/* ═══ CENTER — Chat ═══ */}
      <div className={`flex flex-col flex-1 min-w-0 ${!showMobileChat ? 'hidden lg:flex' : 'flex'}`}>
        {!activeConv ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#0B141A]">
            <div className="flex size-24 items-center justify-center rounded-full bg-white/5 border border-white/10">
              <WhatsAppIcon className="size-12 text-green-500/50" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white/70">WhatsApp Web</p>
              <p className="text-sm text-[#8696A0] mt-1">
                {isConfigured ? 'Seleccioná una conversación o iniciá una nueva' : 'Configurá tus credenciales de Meta API para comenzar'}
              </p>
              <div className="flex items-center justify-center gap-2 mt-4">
                {isConfigured && (
                  <Button variant="outline" size="sm" className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                    onClick={() => setShowNewChat(true)}>
                    <Plus className="mr-1.5 size-3.5" /> Nueva conversación
                  </Button>
                )}
                <Button variant="outline" size="sm" className="border-white/10 text-[#8696A0] hover:text-white"
                  onClick={() => setShowSettings(true)}>
                  <Settings className="mr-1.5 size-3.5" /> Configuración
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col bg-[#0B141A]">
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-[#202C33] border-b border-white/5">
              <Button variant="ghost" size="icon" className="lg:hidden size-8 text-[#8696A0] hover:text-white shrink-0"
                onClick={() => setShowMobileChat(false)}>
                <ArrowLeft className="size-4" />
              </Button>
              <button onClick={() => { setShowProfile(v => !v); if (!showProfile && activeConv.client_id) loadVisits(activeConv.client_id) }}
                className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
                <Avatar name={activeConvName} size={9} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{activeConvName}</p>
                  <p className="text-[11px] text-[#8696A0]">{activeConv.client?.phone || activeConv.platform_user_id}</p>
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {replyWindowLeft && (
                  <Badge variant="outline" className="gap-1 text-[10px] border-yellow-500/30 text-yellow-400 bg-yellow-500/5">
                    <Clock className="size-2.5" />{replyWindowLeft}
                  </Badge>
                )}
                {/* Conversation actions */}
                {activeConv.status === 'open' && (
                  <>
                    <Button variant="ghost" size="icon" className="size-8 text-[#8696A0] hover:text-blue-400" title="Cerrar conversación"
                      onClick={() => handleStatusChange('closed')} disabled={isActing}>
                      <CheckCircle2 className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 text-[#8696A0] hover:text-white/50" title="Archivar"
                      onClick={() => handleStatusChange('archived')} disabled={isActing}>
                      <Archive className="size-4" />
                    </Button>
                  </>
                )}
                {activeConv.status !== 'open' && (
                  <Button variant="ghost" size="icon" className="size-8 text-[#8696A0] hover:text-green-400" title="Reabrir"
                    onClick={() => handleStatusChange('open')} disabled={isActing}>
                    <RotateCcw className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className={`size-8 ${showProfile ? 'text-green-400' : 'text-[#8696A0] hover:text-white'}`}
                  onClick={() => setShowProfile(v => !v)} title="Ver perfil">
                  <User className="size-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-[5%]">
              <div className="py-4 space-y-0.5">
                {loadingMessages ? (
                  <div className="flex justify-center py-12">
                    <div className="size-6 animate-spin rounded-full border-2 border-white/10 border-t-green-400" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-[#8696A0]">
                    <MessageSquare className="mb-2 size-8 opacity-20" />
                    <p className="text-xs">No hay mensajes aún</p>
                    <p className="text-[10px] mt-1 opacity-60">Para iniciar una conversación en WA necesitás un template aprobado</p>
                  </div>
                ) : (
                  groupedMessages().map(({ date, msgs }) => (
                    <div key={date}>
                      <div className="flex items-center justify-center my-3">
                        <span className="px-3 py-1 rounded-full bg-[#182229] text-[#8696A0] text-[11px]">
                          {formatDateSeparator(msgs[0].created_at)}
                        </span>
                      </div>
                      {msgs.map(msg => {
                        const isOut = msg.direction === 'outbound'
                        return (
                          <div key={msg.id} className={`flex mb-1.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                            <div className={`relative max-w-[65%] px-3 py-1.5 rounded-lg text-white text-sm ${isOut ? 'bg-[#005C4B] rounded-tr-none' : 'bg-[#202C33] rounded-tl-none'}`}>
                              {msg.content && <p className="whitespace-pre-wrap wrap-break-word leading-[1.45]">{msg.content}</p>}
                              {msg.template_name && !msg.content && <p className="italic text-xs text-white/60">📋 {msg.template_name}</p>}
                              <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : ''}`}>
                                <span className="text-[10px] text-white/50">{formatTime(msg.created_at)}</span>
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
            </ScrollArea>

            {/* Input */}
            <div className="px-4 py-3 bg-[#202C33]">
              {activeConv.status !== 'open' ? (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center flex items-center justify-center gap-2">
                  <p className="text-xs text-[#8696A0]">Conversación {activeConv.status === 'closed' ? 'cerrada' : 'archivada'}</p>
                  <button className="text-xs text-green-400 hover:underline" onClick={() => handleStatusChange('open')}>Reabrir</button>
                </div>
              ) : !canReply ? (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-center">
                  <p className="text-xs text-yellow-400">Ventana de 24h expirada — solo podés enviar templates aprobados</p>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea rows={1}
                    className="flex-1 rounded-lg bg-[#2A3942] px-3 py-2.5 text-sm text-white placeholder:text-[#8696A0] outline-none resize-none focus:ring-1 focus:ring-green-500/40 min-h-10 max-h-30 overflow-y-auto"
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
        )}
      </div>

      {/* ═══ RIGHT — Client profile panel ═══ */}
      {showProfile && activeConv && (
        <div className="hidden lg:flex flex-col w-72 shrink-0 bg-[#111B21] border-l border-white/5">
          <div className="flex items-center justify-between px-4 py-3 bg-[#202C33] border-b border-white/5">
            <span className="text-sm font-semibold text-white">Perfil del cliente</span>
            <button onClick={() => setShowProfile(false)} className="text-[#8696A0] hover:text-white">
              <X className="size-4" />
            </button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-5">
              {/* Avatar + nombre */}
              <div className="flex flex-col items-center gap-2 pt-2">
                <Avatar name={activeConvName} size={16} />
                <p className="font-semibold text-white text-center">{activeConvName}</p>
                {activeConv.client?.phone && (
                  <p className="text-xs text-[#8696A0]">{activeConv.client.phone}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <StatusBadge status={activeConv.status} />
                  {activeConv.status === 'open' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">Activo</span>}
                </div>
              </div>

              <Separator className="bg-white/5" />

              {/* Acciones rápidas */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-[#8696A0] uppercase tracking-wider">Acciones</p>
                <div className="grid grid-cols-2 gap-2">
                  {activeConv.status === 'open' ? (
                    <>
                      <button onClick={() => handleStatusChange('closed')}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-xs text-[#8696A0] hover:text-white transition-colors">
                        <CheckCircle2 className="size-3.5" /> Cerrar
                      </button>
                      <button onClick={() => handleStatusChange('archived')}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-xs text-[#8696A0] hover:text-white transition-colors">
                        <Archive className="size-3.5" /> Archivar
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleStatusChange('open')}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-green-600/10 hover:bg-green-600/20 text-xs text-green-400 transition-colors">
                      <RotateCcw className="size-3.5" /> Reabrir conversación
                    </button>
                  )}
                  <button onClick={() => { setScheduleData(prev => ({ ...prev, clientId: activeConv.client_id || '' })); setShowScheduleDialog(true) }}
                    className="col-span-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-xs text-[#8696A0] hover:text-white transition-colors">
                    <Calendar className="size-3.5" /> Programar mensaje
                  </button>
                </div>
              </div>

              <Separator className="bg-white/5" />

              {/* Etiquetas */}
              {tags.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-[#8696A0] uppercase tracking-wider">Etiquetas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(tag => {
                      const assigned = activeConv.tags?.some(t => t.tag_id === tag.id)
                      return (
                        <button key={tag.id} onClick={() => handleToggleTag(activeConv.id, tag.id)}
                          disabled={taggingConv}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all border ${assigned ? 'text-white border-transparent' : 'text-[#8696A0] border-white/10 hover:border-white/25'}`}
                          style={assigned ? { backgroundColor: tag.color } : {}}>
                          <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <Separator className="bg-white/5" />

              {/* Historial de visitas */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-[#8696A0] uppercase tracking-wider">Últimas visitas</p>
                {loadingVisits ? (
                  <div className="flex justify-center py-4">
                    <div className="size-4 animate-spin rounded-full border-2 border-white/10 border-t-green-400" />
                  </div>
                ) : clientVisits.length === 0 ? (
                  <p className="text-xs text-[#8696A0] italic">Sin visitas registradas</p>
                ) : (
                  <div className="space-y-2">
                    {clientVisits.map(visit => (
                      <div key={visit.id} className="rounded-lg bg-[#202C33] p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-white font-medium">{visit.service?.name || 'Servicio'}</span>
                          <span className="text-xs text-green-400 font-semibold">{formatCurrency(visit.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-[#8696A0]">{visit.barber?.full_name}</span>
                          <span className="text-[10px] text-[#8696A0]">
                            {new Date(visit.started_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notas del cliente */}
              {activeConv.client?.notes && (
                <>
                  <Separator className="bg-white/5" />
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-[#8696A0] uppercase tracking-wider">Notas</p>
                    <p className="text-xs text-[#8696A0] bg-[#202C33] rounded-lg p-2.5 leading-relaxed">{activeConv.client.notes}</p>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* ═══ SETTINGS SHEET ═══ */}
      <Sheet open={showSettings} onOpenChange={setShowSettings}>
        <SheetContent side="right" className="w-full max-w-md bg-[#111B21] border-white/5 text-white flex flex-col p-0">
          {/* Header fijo */}
          <div className="px-6 py-4 border-b border-white/5 shrink-0">
            <p className="font-semibold text-white mb-3">Canales conectados</p>
            {/* Platform tabs */}
            <div className="grid grid-cols-4 gap-1 bg-[#202C33] p-1 rounded-lg">
              {(['whatsapp', 'instagram', 'facebook', 'tags'] as SettingsTab[]).map(tab => (
                <button key={tab} onClick={() => setSettingsTab(tab)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-md text-[10px] font-medium transition-colors ${settingsTab === tab ? 'bg-[#2A3942] text-white' : 'text-[#8696A0] hover:text-white'}`}>
                  {tab === 'whatsapp' && <WhatsAppIcon className="size-3.5 text-green-400" />}
                  {tab === 'instagram' && <Instagram className="size-3.5 text-pink-400" />}
                  {tab === 'facebook' && <Facebook className="size-3.5 text-blue-400" />}
                  {tab === 'tags' && <span className="text-base leading-none">🏷️</span>}
                  <span>{tab === 'whatsapp' ? 'WA' : tab === 'instagram' ? 'IG' : tab === 'facebook' ? 'FB' : 'Tags'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* WhatsApp tab */}
            {settingsTab === 'whatsapp' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isConfigured ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                    {isConfigured ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                    {isConfigured ? 'Conectado' : 'Sin configurar'}
                  </div>
                </div>

                {/* Paso 1: Webhook */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 font-bold text-[10px]">1</div>
                    <h3 className="text-xs font-semibold text-[#8696A0] uppercase tracking-wider">Configurar Webhook en Meta</h3>
                  </div>
                  <p className="text-xs text-[#8696A0] leading-relaxed pl-7">
                    En Meta Developer Console → <strong className="text-white">WhatsApp → Configuración → Webhook</strong>
                  </p>
                  <div className="pl-7 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">URL de devolución de llamada</Label>
                      <div className="flex items-center gap-2">
                        <input readOnly className="flex-1 rounded-lg bg-[#202C33] px-3 py-2 text-xs text-white outline-none font-mono truncate" value={webhookUrl} />
                        <button className="shrink-0 p-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-[#8696A0] hover:text-white transition-colors" onClick={() => copyToClipboard(webhookUrl, 'URL')}>
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Token de verificación</Label>
                      {waConfig?.verify_token ? (
                        <div className="flex items-center gap-2">
                          <input readOnly className="flex-1 rounded-lg bg-[#202C33] px-3 py-2 text-xs text-white outline-none font-mono truncate" value={waConfig.verify_token} />
                          <button className="shrink-0 p-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-[#8696A0] hover:text-white transition-colors" onClick={() => copyToClipboard(waConfig.verify_token, 'Token')}>
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-[#202C33] px-3 py-2.5 text-xs text-[#8696A0] italic">
                          Se genera al guardar las credenciales →
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg bg-[#1A2530] border border-white/5 p-3 flex items-start gap-2.5">
                      <span className="text-green-400 text-[10px] font-mono shrink-0 mt-0.5">●</span>
                      <div>
                        <p className="text-[11px] text-[#8696A0]">Evento a suscribir:</p>
                        <code className="text-xs text-green-400 font-mono">messages</code>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator className="bg-white/5" />

                {/* Paso 2: Credenciales */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="size-5 rounded-full bg-green-500/10 flex items-center justify-center text-green-400 font-bold text-[10px]">2</div>
                    <h3 className="text-xs font-semibold text-[#8696A0] uppercase tracking-wider">Credenciales Meta API</h3>
                  </div>
                  <div className="pl-7 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Access Token</Label>
                      <div className="relative">
                        <input type={showToken ? 'text' : 'password'}
                          className="w-full rounded-lg bg-[#202C33] px-3 py-2 pr-10 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-green-500/40"
                          placeholder="EAA..." value={configForm.whatsapp_access_token ?? ''}
                          onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_access_token: e.target.value }))} />
                        <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696A0] hover:text-white" onClick={() => setShowToken(v => !v)}>
                          {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Phone Number ID</Label>
                      <input type="text" className="w-full rounded-lg bg-[#202C33] px-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-green-500/40"
                        placeholder="1068552459672379" value={configForm.whatsapp_phone_id ?? ''}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_phone_id: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">WhatsApp Business Account ID</Label>
                      <input type="text" className="w-full rounded-lg bg-[#202C33] px-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-green-500/40"
                        placeholder="868078746261917" value={configForm.whatsapp_business_id ?? ''}
                        onChange={(e) => setConfigForm(prev => ({ ...prev, whatsapp_business_id: e.target.value }))} />
                    </div>
                    <Button className="w-full bg-green-600 hover:bg-green-500 text-white" onClick={handleSaveConfig} disabled={savingConfig}>
                      {savingConfig ? 'Guardando...' : 'Guardar credenciales'}
                    </Button>
                  </div>
                </div>

                <Separator className="bg-white/5" />
                <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300">
                  <ExternalLink className="size-3" /> Guía Meta Cloud API
                </a>
              </div>
            )}

            {/* Instagram tab */}
            {settingsTab === 'instagram' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isInstagramConfigured ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                    {isInstagramConfigured ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
                    {isInstagramConfigured ? 'Conectado' : 'Sin configurar'}
                  </div>
                </div>

                {/* Paso 1: Webhook */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="size-5 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 font-bold text-[10px]">1</div>
                    <h3 className="text-xs font-semibold text-[#8696A0] uppercase tracking-wider">Configurar Webhook en Meta</h3>
                  </div>
                  <p className="text-xs text-[#8696A0] leading-relaxed pl-7">
                    En Meta Developer Console → <strong className="text-white">Instagram → Webhooks</strong>, suscribite al campo <code className="text-pink-400">messages</code>.
                  </p>
                  <div className="pl-7 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">URL de devolución de llamada</Label>
                      <div className="flex items-center gap-2">
                        <input readOnly className="flex-1 rounded-lg bg-[#202C33] px-3 py-2 text-xs text-white outline-none font-mono truncate" value={webhookUrlInstagram} />
                        <button className="shrink-0 p-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-[#8696A0] hover:text-white transition-colors" onClick={() => copyToClipboard(webhookUrlInstagram, 'URL')}>
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Token de verificación</Label>
                      {igConfig?.verify_token ? (
                        <div className="flex items-center gap-2">
                          <input readOnly className="flex-1 rounded-lg bg-[#202C33] px-3 py-2 text-xs text-white outline-none font-mono truncate" value={igConfig.verify_token} />
                          <button className="shrink-0 p-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-[#8696A0] hover:text-white transition-colors" onClick={() => copyToClipboard(igConfig.verify_token, 'Token')}>
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg bg-[#202C33] px-3 py-2.5 text-xs text-[#8696A0] italic">
                          Se genera al guardar las credenciales →
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Separator className="bg-white/5" />

                {/* Paso 2: Credenciales */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="size-5 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 font-bold text-[10px]">2</div>
                    <h3 className="text-xs font-semibold text-[#8696A0] uppercase tracking-wider">Credenciales Instagram API</h3>
                  </div>
                  <div className="pl-7 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Facebook Page ID <span className="text-pink-400">*</span></Label>
                      <input type="text" className="w-full rounded-lg bg-[#202C33] px-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-pink-500/40"
                        placeholder="123456789012345" value={igConfigForm.instagram_page_id}
                        onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_page_id: e.target.value }))} />
                      <p className="text-[10px] text-[#8696A0]">El ID de la Página de Facebook conectada a tu Instagram Business</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Page Access Token <span className="text-pink-400">*</span></Label>
                      <div className="relative">
                        <input type={showIgToken ? 'text' : 'password'}
                          className="w-full rounded-lg bg-[#202C33] px-3 py-2 pr-10 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-pink-500/40"
                          placeholder="EAA..." value={igConfigForm.instagram_page_access_token}
                          onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_page_access_token: e.target.value }))} />
                        <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696A0] hover:text-white" onClick={() => setShowIgToken(v => !v)}>
                          {showIgToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-[#8696A0]">Token con permiso <code className="text-pink-400">instagram_manage_messages</code></p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-[#8696A0]">Instagram Account ID <span className="text-[#8696A0] font-normal">(opcional)</span></Label>
                      <input type="text" className="w-full rounded-lg bg-[#202C33] px-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-pink-500/40"
                        placeholder="17841400000000000" value={igConfigForm.instagram_account_id}
                        onChange={(e) => setIgConfigForm(prev => ({ ...prev, instagram_account_id: e.target.value }))} />
                    </div>
                    <Button className="w-full bg-pink-600 hover:bg-pink-500 text-white" onClick={handleSaveIgConfig} disabled={savingIgConfig}>
                      {savingIgConfig ? 'Guardando...' : 'Guardar credenciales'}
                    </Button>
                  </div>
                </div>

                <Separator className="bg-white/5" />
                <div className="rounded-lg bg-[#1A2530] border border-white/5 p-3 space-y-1.5">
                  <p className="text-[11px] font-medium text-white">Requisitos previos</p>
                  {[
                    'Cuenta de Instagram Business o Creator',
                    'Página de Facebook conectada a la cuenta IG',
                    'App de Meta con instagram_manage_messages',
                    'Suscripción al webhook del producto Instagram',
                  ].map(r => (
                    <div key={r} className="flex items-start gap-2">
                      <div className="size-1.5 rounded-full bg-pink-400 mt-1.5 shrink-0" />
                      <span className="text-[11px] text-[#8696A0]">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Facebook tab */}
            {settingsTab === 'facebook' && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="size-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Facebook className="size-8 text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-white mb-1">Facebook Messenger</p>
                  <p className="text-sm text-[#8696A0] max-w-xs leading-relaxed">
                    Próximamente podrás conectar tu página de Facebook y atender todos los mensajes de Messenger desde el dashboard.
                  </p>
                </div>
                <div className="rounded-lg bg-[#202C33] border border-white/5 p-4 text-left w-full space-y-2">
                  <p className="text-xs font-medium text-white">¿Qué vas a poder hacer?</p>
                  {['Ver y responder mensajes de Messenger', 'Automatización de respuestas', 'Campañas a fans de tu página', 'Integración con el CRM'].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <div className="size-1.5 rounded-full bg-blue-400" />
                      <span className="text-xs text-[#8696A0]">{f}</span>
                    </div>
                  ))}
                </div>
                <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/5">Próximamente</Badge>
              </div>
            )}

            {/* Tags tab */}
            {settingsTab === 'tags' && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-semibold text-white mb-1">Gestión de etiquetas</p>
                  <p className="text-[11px] text-[#8696A0]">Las etiquetas se aplican a conversaciones de cualquier plataforma para organizar tu inbox.</p>
                </div>

                {/* Crear etiqueta */}
                <div className="space-y-3">
                  <Label className="text-[11px] text-[#8696A0] uppercase tracking-wider">Nueva etiqueta</Label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg bg-[#202C33] px-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-white/20"
                      placeholder="Ej: VIP, Seguimiento, Nuevo cliente..."
                      value={newTagName}
                      onChange={e => setNewTagName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateTag() }}
                    />
                    <Button size="sm" onClick={handleCreateTag} disabled={creatingTag || !newTagName.trim()}
                      className="shrink-0 bg-white/10 hover:bg-white/15 text-white border-0">
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                  {/* Paleta de colores */}
                  <div className="flex gap-2 flex-wrap">
                    {TAG_COLORS.map(color => (
                      <button key={color} onClick={() => setNewTagColor(color)}
                        className={`size-6 rounded-full transition-transform hover:scale-110 ${newTagColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-[#111B21]' : ''}`}
                        style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  {/* Preview */}
                  {newTagName.trim() && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#8696A0]">Vista previa:</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: newTagColor }}>
                        {newTagName.trim()}
                      </span>
                    </div>
                  )}
                </div>

                <Separator className="bg-white/5" />

                {/* Lista de etiquetas existentes */}
                <div className="space-y-2">
                  <Label className="text-[11px] text-[#8696A0] uppercase tracking-wider">Etiquetas creadas ({tags.length})</Label>
                  {tags.length === 0 ? (
                    <p className="text-xs text-[#8696A0] italic py-2">Todavía no creaste ninguna etiqueta</p>
                  ) : (
                    <div className="space-y-1.5">
                      {tags.map(tag => (
                        <div key={tag.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#202C33] px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                            <span className="text-sm text-white truncate">{tag.name}</span>
                          </div>
                          <button onClick={() => handleDeleteTag(tag.id)} disabled={creatingTag}
                            className="shrink-0 text-[#8696A0] hover:text-red-400 transition-colors">
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ NUEVA CONVERSACIÓN DIALOG ═══ */}
      <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
        <DialogContent className="bg-[#202C33] border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="size-4 text-green-400" /> Nueva conversación
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8696A0]" />
              <input className="w-full rounded-lg bg-[#111B21] pl-9 pr-3 py-2 text-sm text-white placeholder:text-[#8696A0] outline-none focus:ring-1 focus:ring-green-500/40"
                placeholder="Buscar cliente..." value={newChatSearch} onChange={(e) => setNewChatSearch(e.target.value)} />
            </div>
            <ScrollArea className="h-64 rounded-lg bg-[#111B21]">
              {filteredClientsForNewChat.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[#8696A0] text-sm py-8">Sin resultados</div>
              ) : (
                <div>
                  {filteredClientsForNewChat.map(c => (
                    <button key={c.id} onClick={() => setNewChatClientId(c.id)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 transition-colors border-b border-white/4 ${newChatClientId === c.id ? 'bg-green-600/20' : 'hover:bg-white/5'}`}>
                      <Avatar name={c.name} size={8} />
                      <div className="text-left min-w-0">
                        <p className="text-sm text-white font-medium truncate">{c.name}</p>
                        <p className="text-xs text-[#8696A0]">{c.phone || 'Sin teléfono'}</p>
                      </div>
                      {newChatClientId === c.id && <Check className="size-4 text-green-400 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
            {!isConfigured && (
              <p className="text-xs text-orange-400 flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> Necesitás configurar WhatsApp primero
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewChat(false)} className="text-[#8696A0] hover:text-white">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleStartConversation}
              disabled={!newChatClientId || !isConfigured || isStarting}>
              {isStarting ? 'Abriendo...' : 'Abrir chat'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ SCHEDULE DIALOG ═══ */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent className="bg-[#202C33] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Programar mensaje</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#8696A0]">Cliente</Label>
              <select className="w-full rounded-lg bg-[#111B21] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-green-500/40"
                value={scheduleData.clientId} onChange={e => setScheduleData(prev => ({ ...prev, clientId: e.target.value }))}>
                <option value="" className="bg-[#111B21]">Seleccioná un cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id} className="bg-[#111B21]">{c.name} — {c.phone}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#8696A0]">Mensaje</Label>
              <Textarea className="bg-[#111B21] border-white/10 text-white placeholder:text-[#8696A0] resize-none" rows={3}
                placeholder="Escribí el mensaje..." value={scheduleData.content}
                onChange={e => setScheduleData(prev => ({ ...prev, content: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#8696A0]">Fecha y hora</Label>
              <Input type="datetime-local" className="bg-[#111B21] border-white/10 text-white"
                value={scheduleData.scheduledFor} onChange={e => setScheduleData(prev => ({ ...prev, scheduledFor: e.target.value }))} />
            </div>
            <div className="rounded-lg bg-[#111B21] p-3 text-xs text-[#8696A0] flex items-start gap-2">
              <WhatsAppIcon className="size-3.5 text-green-400 shrink-0 mt-0.5" />
              El mensaje se envía automáticamente vía WhatsApp Business API
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowScheduleDialog(false)} className="text-[#8696A0] hover:text-white">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-500 text-white" onClick={handleSchedule} disabled={isSending}>Programar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
