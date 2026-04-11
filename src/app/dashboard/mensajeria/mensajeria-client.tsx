'use client'

import { useState } from 'react'
import { MessageSquare, Megaphone, Zap, MessageCircle, Settings } from 'lucide-react'
import { MensajeriaProvider } from './components/shared/mensajeria-context'
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
import type { MensajeriaProps, CrmSection } from './components/shared/types'

const NAV_ITEMS: { key: CrmSection; icon: React.ElementType; label: string }[] = [
  { key: 'inbox', icon: MessageSquare, label: 'Inbox' },
  { key: 'broadcasts', icon: Megaphone, label: 'Difusiones' },
  { key: 'automations', icon: Zap, label: 'Workflows' },
  { key: 'quick-replies', icon: MessageCircle, label: 'Rápidos' },
  { key: 'settings', icon: Settings, label: 'Config' },
]

export function MensajeriaClient(props: MensajeriaProps) {
  const [section, setSection] = useState<CrmSection>('inbox')
  const [showSettings, setShowSettings] = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)

  const handleNavClick = (key: CrmSection) => {
    if (key === 'settings') {
      setShowSettings(true)
    } else {
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
      initialTags={props.initialTags}
      appSettings={props.appSettings}
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
                className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-colors group ${
                  isActive
                    ? 'bg-green-600/15 text-green-400'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title={label}
              >
                <Icon className="size-4.5" />
                <span className="text-[9px] mt-0.5 font-medium leading-none">{label}</span>
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
                className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-lg transition-colors ${
                  isActive ? 'text-green-400' : 'text-muted-foreground'
                }`}
              >
                <Icon className="size-4.5" />
                <span className="text-[9px] mt-0.5 font-medium">{label}</span>
              </button>
            )
          })}
        </div>

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
