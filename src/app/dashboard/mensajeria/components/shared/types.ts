import type { Conversation, SocialChannel, Client, OrgWhatsAppConfig, OrgInstagramConfig, ConversationTag } from '@/lib/types/database'
import type { OrgAiConfig } from '@/lib/actions/ai-config'

export interface ConversationWithRelations extends Conversation {
  channel?: SocialChannel & { branch_id?: string }
  client?: Client
  tags?: Array<{ tag_id: string; tag: ConversationTag }>
}

export interface ScheduledWithRelations {
  id: string
  client_id: string
  content: string | null
  scheduled_for: string
  status: string
  client?: { name: string; phone: string }
}

export interface ClientVisit {
  id: string
  amount: number
  started_at: string
  payment_method: string
  service?: { name: string } | null
  barber?: { full_name: string } | null
}

export interface WaTemplateComponent {
  type?: string
  text?: string
  buttons?: Array<{ text?: string; type?: string }>
  format?: string
  example?: Record<string, unknown>
}

export interface WaTemplate {
  id: string
  name: string
  language: string
  category: string
  status: string
  components: WaTemplateComponent[]
}

export interface ReviewAutoSettings {
  review_auto_send: boolean
  review_delay_minutes: number
  review_template_name: string | null
}

export interface MensajeriaProps {
  initialConversations: ConversationWithRelations[]
  channels: SocialChannel[]
  scheduledMessages: ScheduledWithRelations[]
  // clients removido: los dialogs NewChat y Schedule usan searchClients() on-demand
  waConfig: OrgWhatsAppConfig | null
  igConfig: OrgInstagramConfig | null
  aiConfig: OrgAiConfig | null
  initialTags: ConversationTag[]
  appSettings: ReviewAutoSettings | null
  branches: { id: string; name: string }[]
}

export type SettingsTab = 'whatsapp' | 'instagram' | 'facebook' | 'tags'
export type PlatformFilter = 'all' | 'whatsapp' | 'instagram'
export type CrmSection = 'inbox' | 'broadcasts' | 'automations' | 'quick-replies' | 'alerts' | 'settings'
