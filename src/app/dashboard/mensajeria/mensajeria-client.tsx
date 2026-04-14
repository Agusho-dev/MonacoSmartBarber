'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MessageSquare, Megaphone, Zap, MessageCircle, Settings, Bell } from 'lucide-react'
import { MensajeriaProvider, useMensajeria } from './components/shared/mensajeria-context'
import { ConversationList } from './components/inbox/conversation-list'
import { ChatView } from './components/inbox/chat-view'
import { ClientProfile } from './components/inbox/client-profile'
import { SettingsSheet } from './components/settings/settings-sheet'
import { NewChatDialog } from './components/dialogs/new-chat-dialog'
import { ScheduleDialog } from './components/dialogs/schedule-dialog'
import { TemplatePicker } from './components/dialogs/template-picker'
import { BroadcastSection } from './components/broadcasts/broadcast-section'
import { WorkflowList } from './components/workflows/workflow-list'
import { QuickReplySection } from './components/quick-replies/quick-reply-section'
import { CrmAlertsPanel } from './components/alerts/crm-alerts-panel'
import { getUnreadAlertCount } from '@/lib/actions/workflows'
import { createClient } from '@/lib/supabase/client'
import type { MensajeriaProps, CrmSection } from './components/shared/types'

const NAV_ITEMS: { key: CrmSection; icon: React.ElementType; label: string }[] = [
  { key: 'inbox', icon: MessageSquare, label: 'Inbox' },
  { key: 'broadcasts', icon: Megaphone, label: 'Difusiones' },
  { key: 'automations', icon: Zap, label: 'Workflows' },
  { key: 'alerts', icon: Bell, label: 'Alertas' },
  { key: 'quick-replies', icon: MessageCircle, label: 'Rápidos' },
  { key: 'settings', icon: Settings, label: 'Config' },
]

export function MensajeriaClient(props: MensajeriaProps) {
  const [section, setSection] = useState<CrmSection>('inbox')
  const [showSettings, setShowSettings] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  // Cargar count de alertas no leídas
  useEffect(() => {
    getUnreadAlertCount().then(r => setAlertCount(r.count))
  }, [])

  // Realtime para actualizar el badge cuando llega una alerta nueva
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('crm-alerts-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crm_alerts' }, () => {
        setAlertCount(prev => prev + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleNavClick = (key: CrmSection) => {
    if (key === 'settings') {
      setShowSettings(true)
    } else {
      if (key === 'alerts') {
        // Al entrar a alertas, refrescar count
        getUnreadAlertCount().then(r => setAlertCount(r.count))
      }
      setSection(key)
    }
  }

  return (
    <MensajeriaProvider
      initialConversations={props.initialConversations}
      scheduledMessages={props.scheduledMessages}
      clients={props.clients}
      waConfig={props.waConfig}
      igConfig={props.igConfig}
      aiConfig={props.aiConfig}
      initialTags={props.initialTags}
      appSettings={props.appSettings}
      branches={props.branches}
    >
      <div className="flex h-full min-h-0 overflow-hidden bg-background">

        {/* ═══ NAV BAR — Iconos de sección ═══ */}
        <div className="hidden lg:flex flex-col items-center w-14 shrink-0 bg-background border-r border py-3 gap-1">
          {NAV_ITEMS.map(({ key, icon: Icon, label }) => {
            const isActive = key === section || (key === 'settings' && showSettings)
            return (
              <button
                key={key}
                onClick={() => handleNavClick(key)}
                className={`relative flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-colors group ${
                  isActive
                    ? 'bg-green-600/15 text-green-400'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title={label}
              >
                <Icon className="size-4.5" />
                <span className="text-[9px] mt-0.5 font-medium leading-none">{label}</span>
                {key === 'alerts' && alertCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ═══ MOBILE NAV — Bottom bar (solo mobile) ═══ */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around bg-background border-t border py-1 px-2">
          {NAV_ITEMS.map(({ key, icon: Icon, label }) => {
            const isActive = key === section
            return (
              <button
                key={key}
                onClick={() => handleNavClick(key)}
                className={`relative flex flex-col items-center justify-center py-1.5 px-2 rounded-lg transition-colors ${
                  isActive ? 'text-green-400' : 'text-muted-foreground'
                }`}
              >
                <Icon className="size-4.5" />
                <span className="text-[9px] mt-0.5 font-medium">{label}</span>
                {key === 'alerts' && alertCount > 0 && (
                  <span className="absolute top-0.5 right-0 min-w-3.5 h-3.5 flex items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white px-0.5">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <DeepLinkHandler onSection={setSection} />

        {/* ═══ CONTENT ═══ */}
        {section === 'inbox' && (
          <>
            <ConversationList
              onNewChat={() => setShowNewChat(true)}
              onOpenSettings={() => setShowSettings(true)}
            />
            <ChatView
              onOpenSettings={() => setShowSettings(true)}
              onNewChat={() => setShowNewChat(true)}
            />
            <ClientProfile />
          </>
        )}

        {section === 'broadcasts' && <BroadcastSection />}
        {section === 'automations' && <WorkflowList />}
        {section === 'alerts' && <CrmAlertsPanel />}
        {section === 'quick-replies' && <QuickReplySection />}

        {/* ═══ Dialogs & Sheets ═══ */}
        <SettingsSheet open={showSettings} onOpenChange={setShowSettings} />
        <NewChatDialog open={showNewChat} onOpenChange={setShowNewChat} />
        <ScheduleDialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog} />
        <TemplatePicker />
      </div>
    </MensajeriaProvider>
  )
}

function DeepLinkHandler({ onSection }: { onSection: (s: CrmSection) => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { handleStartConversation, activeConv, setConversations, tags } = useMensajeria()
  const [pendingTag, setPendingTag] = useState<{ clientId: string; tagId: string } | null>(null)

  useEffect(() => {
    const clientId = searchParams.get('clientId')
    if (!clientId) return
    const tag = searchParams.get('tag')
    onSection('inbox')
    handleStartConversation(clientId)
    if (tag) setPendingTag({ clientId, tagId: tag })
    router.replace('/dashboard/mensajeria')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Cuando la conversacion objetivo queda activa, aplicamos la etiqueta pendiente.
  useEffect(() => {
    if (!pendingTag || !activeConv) return
    if (activeConv.client_id !== pendingTag.clientId) return
    const { tagId } = pendingTag
    setPendingTag(null)
    ;(async () => {
      const { assignConversationTag } = await import('@/lib/actions/tags')
      const res = await assignConversationTag(activeConv.id, tagId)
      if (res.error) return
      const tagObj = tags.find(t => t.id === tagId)
      if (!tagObj) return
      setConversations(prev => prev.map(c => {
        if (c.id !== activeConv.id) return c
        const already = c.tags?.some(t => t.tag_id === tagId)
        if (already) return c
        return {
          ...c,
          tags: [...(c.tags ?? []), { tag_id: tagId, tag: tagObj }],
        }
      }))
    })()
  }, [activeConv, pendingTag, setConversations])

  return null
}
