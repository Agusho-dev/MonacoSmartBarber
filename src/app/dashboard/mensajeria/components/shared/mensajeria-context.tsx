'use client'

import { createContext, useContext, useState, useMemo, useRef, useCallback, useTransition, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendMessage as sendMessageAction, markAsRead, cancelScheduledMessage, sendTemplateToConversation, sendTemplateToClient } from '@/lib/actions/messaging'
import { syncWhatsAppTemplates } from '@/lib/actions/whatsapp-meta'
import { startConversation, updateConversationStatus, getClientVisits, scheduleMessageAuto } from '@/lib/actions/conversations'
import { createConversationTag, deleteConversationTag, assignConversationTag, removeConversationTag } from '@/lib/actions/tags'
import { toast } from 'sonner'
import type { Message, ConversationTag, OrgWhatsAppConfig, OrgInstagramConfig, Client } from '@/lib/types/database'
import type { ConversationWithRelations, ScheduledWithRelations, ClientVisit, WaTemplate, ReviewAutoSettings, PlatformFilter } from './types'

interface MensajeriaContextValue {
  // Supabase
  supabase: ReturnType<typeof createClient>

  // Conversations
  conversations: ConversationWithRelations[]
  setConversations: React.Dispatch<React.SetStateAction<ConversationWithRelations[]>>
  activeConv: ConversationWithRelations | null
  setActiveConv: React.Dispatch<React.SetStateAction<ConversationWithRelations | null>>
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  loadingMessages: boolean
  loadMessages: (convId: string) => Promise<void>

  // UI
  messageInput: string
  setMessageInput: React.Dispatch<React.SetStateAction<string>>
  search: string
  setSearch: React.Dispatch<React.SetStateAction<string>>
  statusFilter: 'all' | 'open' | 'closed' | 'archived'
  setStatusFilter: React.Dispatch<React.SetStateAction<'all' | 'open' | 'closed' | 'archived'>>
  platformFilter: PlatformFilter
  setPlatformFilter: React.Dispatch<React.SetStateAction<PlatformFilter>>
  showMobileChat: boolean
  setShowMobileChat: React.Dispatch<React.SetStateAction<boolean>>
  inboxTab: 'inbox' | 'scheduled'
  setInboxTab: React.Dispatch<React.SetStateAction<'inbox' | 'scheduled'>>
  messagesEndRef: React.RefObject<HTMLDivElement | null>

  // Tags
  tags: ConversationTag[]
  setTags: React.Dispatch<React.SetStateAction<ConversationTag[]>>
  tagFilter: string | null
  setTagFilter: React.Dispatch<React.SetStateAction<string | null>>

  // Client profile
  showProfile: boolean
  setShowProfile: React.Dispatch<React.SetStateAction<boolean>>
  clientVisits: ClientVisit[]
  loadingVisits: boolean
  loadVisits: (clientId: string) => Promise<void>

  // Scheduled
  scheduled: ScheduledWithRelations[]
  setScheduled: React.Dispatch<React.SetStateAction<ScheduledWithRelations[]>>

  // Configs
  waConfig: OrgWhatsAppConfig | null
  setWaConfig: React.Dispatch<React.SetStateAction<OrgWhatsAppConfig | null>>
  igConfig: OrgInstagramConfig | null
  setIgConfig: React.Dispatch<React.SetStateAction<OrgInstagramConfig | null>>
  clients: Pick<Client, 'id' | 'name' | 'phone'>[]
  appSettings: ReviewAutoSettings | null

  // Templates
  waTemplates: WaTemplate[]
  setWaTemplates: React.Dispatch<React.SetStateAction<WaTemplate[]>>
  showTemplateDialog: boolean
  setShowTemplateDialog: React.Dispatch<React.SetStateAction<boolean>>
  templateTarget: { type: 'conversation'; conversationId: string } | { type: 'client'; clientId: string } | null
  setTemplateTarget: React.Dispatch<React.SetStateAction<{ type: 'conversation'; conversationId: string } | { type: 'client'; clientId: string } | null>>

  // Computed
  isConfigured: boolean
  isInstagramConfigured: boolean
  filteredConversations: ConversationWithRelations[]
  canReply: boolean
  replyWindowLeft: string | null

  // Handlers
  handleSend: () => void
  handleStatusChange: (status: 'open' | 'closed' | 'archived') => void
  handleStartConversation: (clientId: string) => void
  handleSchedule: (data: { clientId: string; content: string; scheduledFor: string }) => void
  handleCancelScheduled: (id: string) => void
  handleSyncTemplates: () => void
  handleOpenTemplateDialog: (target: { type: 'conversation'; conversationId: string } | { type: 'client'; clientId: string }) => void
  handleSendTemplate: (tpl: WaTemplate) => void
  handleCreateTag: (name: string, color: string) => void
  handleDeleteTag: (tagId: string) => void
  handleToggleTag: (conversationId: string, tagId: string) => void

  // Transition states
  isSending: boolean
  isActing: boolean
  isStarting: boolean
  syncingTemplates: boolean
  sendingTemplate: boolean
  creatingTag: boolean
  taggingConv: boolean
}

const MensajeriaContext = createContext<MensajeriaContextValue | null>(null)

export function useMensajeria() {
  const ctx = useContext(MensajeriaContext)
  if (!ctx) throw new Error('useMensajeria must be used within MensajeriaProvider')
  return ctx
}

export function MensajeriaProvider({
  children,
  initialConversations,
  scheduledMessages: initialScheduled,
  clients,
  waConfig: initialWaConfig,
  igConfig: initialIgConfig,
  initialTags,
  appSettings,
}: {
  children: React.ReactNode
  initialConversations: ConversationWithRelations[]
  scheduledMessages: ScheduledWithRelations[]
  clients: Pick<Client, 'id' | 'name' | 'phone'>[]
  waConfig: OrgWhatsAppConfig | null
  igConfig: OrgInstagramConfig | null
  initialTags: ConversationTag[]
  appSettings: ReviewAutoSettings | null
}) {
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
  const [inboxTab, setInboxTab] = useState<'inbox' | 'scheduled'>('inbox')
  const [isSending, startSending] = useTransition()
  const [isActing, startActing] = useTransition()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Tags
  const [tags, setTags] = useState<ConversationTag[]>(initialTags)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [creatingTag, startCreatingTag] = useTransition()
  const [taggingConv, startTaggingConv] = useTransition()

  // Client profile
  const [showProfile, setShowProfile] = useState(false)
  const [clientVisits, setClientVisits] = useState<ClientVisit[]>([])
  const [loadingVisits, setLoadingVisits] = useState(false)

  // Scheduled
  const [scheduled, setScheduled] = useState(initialScheduled)

  // New conversation
  const [isStarting, startStarting] = useTransition()

  // Configs
  const [waConfig, setWaConfig] = useState<OrgWhatsAppConfig | null>(initialWaConfig)
  const [igConfig, setIgConfig] = useState<OrgInstagramConfig | null>(initialIgConfig)

  // Templates
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([])
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [syncingTemplates, startSyncingTemplates] = useTransition()
  const [sendingTemplate, startSendingTemplate] = useTransition()
  const [templateTarget, setTemplateTarget] = useState<{ type: 'conversation'; conversationId: string } | { type: 'client'; clientId: string } | null>(null)

  // Load messages
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

  // Load client visits
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

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_tag_assignments' }, async (payload) => {
        const assignment = payload.new as { conversation_id: string; tag_id: string }
        // Cargar info del tag
        const { data: tag } = await supabase
          .from('conversation_tags')
          .select('*')
          .eq('id', assignment.tag_id)
          .single()
        if (!tag) return
        setConversations(prev => prev.map(c => {
          if (c.id !== assignment.conversation_id) return c
          if (c.tags?.some(t => t.tag_id === assignment.tag_id)) return c
          return { ...c, tags: [...(c.tags ?? []), { tag_id: assignment.tag_id, tag }] }
        }))
        if (activeConv?.id === assignment.conversation_id) {
          setActiveConv(prev => {
            if (!prev || prev.tags?.some(t => t.tag_id === assignment.tag_id)) return prev
            return { ...prev, tags: [...(prev.tags ?? []), { tag_id: assignment.tag_id, tag }] }
          })
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversation_tag_assignments' }, (payload) => {
        const old = payload.old as { conversation_id: string; tag_id: string }
        setConversations(prev => prev.map(c =>
          c.id === old.conversation_id ? { ...c, tags: c.tags?.filter(t => t.tag_id !== old.tag_id) } : c
        ))
        if (activeConv?.id === old.conversation_id) {
          setActiveConv(prev => prev ? { ...prev, tags: prev.tags?.filter(t => t.tag_id !== old.tag_id) } : prev)
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, async (payload) => {
        const newConvRaw = payload.new as ConversationWithRelations
        const { data: fullConv } = await supabase
          .from('conversations')
          .select(`
            *,
            channel:social_channels(id, platform, display_name, branch_id),
            client:clients(id, name, phone, instagram, notes),
            tags:conversation_tag_assignments(tag_id, tag:conversation_tags(id, name, color))
          `)
          .eq('id', newConvRaw.id)
          .single()
        const conv = (fullConv ?? newConvRaw) as ConversationWithRelations
        setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, activeConv])

  // Filtered conversations
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

  // Reply window
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

  const isConfigured = !!(waConfig?.whatsapp_access_token && waConfig?.whatsapp_phone_id && waConfig?.whatsapp_business_id)
  const isInstagramConfigured = !!(igConfig?.instagram_page_id && igConfig?.instagram_page_access_token)

  // Handlers
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
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id))
      }
    })
  }

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

  const handleStartConversation = (clientId: string) => {
    if (!clientId) { toast.error('Seleccioná un cliente'); return }
    startStarting(async () => {
      const result = await startConversation(clientId)
      if (result.error) { toast.error(result.error); return }
      const conv = result.data as ConversationWithRelations
      setConversations(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev])
      setActiveConv(conv)
      setShowMobileChat(true)
    })
  }

  const handleSchedule = (data: { clientId: string; content: string; scheduledFor: string }) => {
    if (!data.clientId || !data.content || !data.scheduledFor) {
      toast.error('Completá todos los campos'); return
    }
    startSending(async () => {
      const result = await scheduleMessageAuto({
        clientId: data.clientId,
        content: data.content,
        scheduledFor: new Date(data.scheduledFor).toISOString(),
      })
      if (result.error) { toast.error(result.error) }
      else { toast.success('Mensaje programado') }
    })
  }

  const handleCancelScheduled = async (id: string) => {
    const result = await cancelScheduledMessage(id)
    if (result.error) { toast.error(result.error) }
    else { toast.success('Cancelado'); setScheduled(prev => prev.filter(s => s.id !== id)) }
  }

  const handleSyncTemplates = () => {
    startSyncingTemplates(async () => {
      const result = await syncWhatsAppTemplates()
      if (result.error) { toast.error(result.error); return }
      if (result.data) {
        setWaTemplates(result.data.map((t, i) => ({ id: `tpl-${i}`, ...t })))
        toast.success(`${result.data.length} template(s) sincronizado(s)`)
      }
    })
  }

  const handleOpenTemplateDialog = (target: typeof templateTarget) => {
    setTemplateTarget(target)
    setShowTemplateDialog(true)
    if (waTemplates.length === 0) handleSyncTemplates()
  }

  const handleSendTemplate = (tpl: WaTemplate) => {
    if (!templateTarget) return
    startSendingTemplate(async () => {
      let result: { success?: boolean; error?: string }
      if (templateTarget.type === 'conversation') {
        result = await sendTemplateToConversation(templateTarget.conversationId, tpl.name, tpl.language)
      } else {
        result = await sendTemplateToClient(templateTarget.clientId, tpl.name, tpl.language)
      }
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Template enviado')
        setShowTemplateDialog(false)
        setTemplateTarget(null)
      }
    })
  }

  const handleCreateTag = (name: string, color: string) => {
    if (!name.trim()) { toast.error('Escribí un nombre para la etiqueta'); return }
    startCreatingTag(async () => {
      const result = await createConversationTag(name.trim(), color)
      if (result.error) { toast.error(result.error) }
      else {
        toast.success('Etiqueta creada')
        if (result.data) setTags(prev => [...prev, result.data as ConversationTag].sort((a, b) => a.name.localeCompare(b.name)))
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

  const value: MensajeriaContextValue = {
    supabase,
    conversations, setConversations,
    activeConv, setActiveConv,
    messages, setMessages,
    loadingMessages, loadMessages,
    messageInput, setMessageInput,
    search, setSearch,
    statusFilter, setStatusFilter,
    platformFilter, setPlatformFilter,
    showMobileChat, setShowMobileChat,
    inboxTab, setInboxTab,
    messagesEndRef,
    tags, setTags,
    tagFilter, setTagFilter,
    showProfile, setShowProfile,
    clientVisits, loadingVisits, loadVisits,
    scheduled, setScheduled,
    waConfig, setWaConfig,
    igConfig, setIgConfig,
    clients, appSettings,
    waTemplates, setWaTemplates,
    showTemplateDialog, setShowTemplateDialog,
    templateTarget, setTemplateTarget,
    isConfigured, isInstagramConfigured,
    filteredConversations,
    canReply, replyWindowLeft,
    handleSend, handleStatusChange, handleStartConversation,
    handleSchedule, handleCancelScheduled,
    handleSyncTemplates, handleOpenTemplateDialog, handleSendTemplate,
    handleCreateTag, handleDeleteTag, handleToggleTag,
    isSending, isActing, isStarting,
    syncingTemplates, sendingTemplate, creatingTag, taggingConv,
  }

  return (
    <MensajeriaContext.Provider value={value}>
      {children}
    </MensajeriaContext.Provider>
  )
}
